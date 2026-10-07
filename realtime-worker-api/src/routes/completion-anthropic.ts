/** Anthropic Messages API streaming completion provider.
 *
 *  Prompt layout, ordered so the stable parts form a cached prefix:
 *    system   = per-flag instructions + candidate background   [cache bp 1]
 *    user #1  = knowledge files as citable document blocks    [cache bp 2]
 *               + images + the first turn's text
 *    ...      = remaining chat turns                     [auto cache bp 3]
 *
 *  Within a session only the transcript / latest question changes, so
 *  every request after the first reads the instructions, background and
 *  knowledge files from the prompt cache.
 *
 *  Emits the same SSE frames as the other providers (`{ text }`,
 *  `{ error }`, `[DONE]`) plus `{ citation }` frames whenever Anthropic cites a
 *  knowledge file. */

import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaRequestDocumentBlock,
  BetaTextBlockParam,
  BetaTextCitation,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { encoder } from "../lib/http";
import type { ModelParams, ThinkingBudget } from "../config-cache";
import type { AuthedUser } from "../middleware/auth";
import type { KnowledgeDocForPrompt } from "./knowledge";
import type { InlineImage, WireMessage } from "./completion-types";

const EFFORT_BY_BUDGET: Record<ThinkingBudget, "low" | "medium" | "high"> = {
  off: "low",
  low: "low",
  medium: "medium",
  high: "high",
};

/** Models that accept server-side refusal fallbacks in the "default" form. */
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;

/** Citation payload forwarded to the client. */
export interface AnthropicCitation {
  documentTitle: string | null;
  documentIndex: number;
  citedText: string;
}

export interface StreamAnthropicArgs {
  messages: WireMessage[];
  system: string;
  background: string | null;
  docs: KnowledgeDocForPrompt[];
  model: string;
  apiKey: string;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  params: ModelParams;
  trackedUser?: AuthedUser | null;
}

function sse(writer: WritableStreamDefaultWriter<Uint8Array>, payload: unknown) {
  return writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function imageBlock(image: InlineImage): BetaContentBlockParam {
  const mime = image.mimeType.toLowerCase();
  const mediaType =
    mime === "image/jpg" || mime === "image/jpeg"
      ? "image/jpeg"
      : mime === "image/gif"
        ? "image/gif"
        : mime === "image/webp"
          ? "image/webp"
          : "image/png";
  return {
    type: "image",
    source: { type: "base64", media_type: mediaType, data: image.base64 },
  };
}

function documentBlocks(docs: KnowledgeDocForPrompt[]): BetaRequestDocumentBlock[] {
  const blocks: BetaRequestDocumentBlock[] = docs.map((doc) => ({
    type: "document",
    source: { type: "text", media_type: "text/plain", data: doc.content },
    title: doc.fileName,
    citations: { enabled: true },
  }));
  if (blocks.length > 0) {
    blocks[blocks.length - 1].cache_control = { type: "ephemeral" };
  }
  return blocks;
}

function toAnthropicMessages(
  messages: WireMessage[],
  docs: KnowledgeDocForPrompt[],
): BetaMessageParam[] {
  return messages.map((m, i) => {
    const content: BetaContentBlockParam[] = [];
    // Knowledge files ride on the first user turn so they sit inside the
    // cached prefix for the whole conversation.
    if (i === 0 && m.role === "user") content.push(...documentBlocks(docs));
    if (m.role === "user") content.push(...m.images.map(imageBlock));
    content.push({ type: "text", text: m.text });
    return { role: m.role, content };
  });
}

function toCitation(c: BetaTextCitation): AnthropicCitation | null {
  if (
    c.type === "char_location" ||
    c.type === "page_location" ||
    c.type === "content_block_location"
  ) {
    return {
      documentTitle: c.document_title,
      documentIndex: c.document_index,
      citedText: c.cited_text,
    };
  }
  return null;
}

function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY or the admin dashboard key.";
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return "This Anthropic API key can't use the configured Anthropic model.";
  }
  if (error instanceof Anthropic.NotFoundError) {
    return "The configured Anthropic model was not found. Check ANTHROPIC_MODEL.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Anthropic is rate limited right now. Try again in a few seconds.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `Anthropic rejected the request: ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach Anthropic. Check the network and try again.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error (${error.status ?? "unknown"}). Try again.`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function streamAnthropicCompletion({
  messages,
  system,
  background,
  docs,
  model,
  apiKey,
  writer,
  params,
  trackedUser,
}: StreamAnthropicArgs) {
  if (!apiKey) {
    throw new Error(
      "Missing Anthropic API key — set ANTHROPIC_API_KEY or add anthropic_key in the Admin Dashboard",
    );
  }
  if (messages.length === 0) {
    throw new Error("streamAnthropicCompletion: messages[] is empty");
  }

  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const systemBlocks: BetaTextBlockParam[] = [{ type: "text", text: system }];
  if (background) systemBlocks.push({ type: "text", text: background });
  systemBlocks[systemBlocks.length - 1].cache_control = { type: "ephemeral" };

  const useFallbacks = FALLBACK_MODELS.test(model);

  try {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: params.maxOutputTokens,
      system: systemBlocks,
      messages: toAnthropicMessages(messages, docs),
      // Caches the conversation history too, for multi-turn Ask AI chats.
      cache_control: { type: "ephemeral" },
      // Live answers need the first token fast; thinking depth follows the
      // admin "thinking budget" (forced to "off" → low for live flags).
      output_config: { effort: EFFORT_BY_BUDGET[params.thinkingBudget] },
      ...(trackedUser?.id
        ? { metadata: { user_id: trackedUser.id.slice(0, 64) } }
        : {}),
      ...(useFallbacks
        ? {
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default" as const,
          }
        : {}),
    });

    for await (const event of stream) {
      if (event.type !== "content_block_delta") continue;
      if (event.delta.type === "text_delta" && event.delta.text) {
        await sse(writer, { text: event.delta.text });
      } else if (event.delta.type === "citations_delta") {
        const citation = toCitation(event.delta.citation);
        if (citation) await sse(writer, { citation });
      }
    }

    const final = await stream.finalMessage();
    console.log(
      "[anthropic] done",
      JSON.stringify({
        model: final.model,
        stop: final.stop_reason,
        input: final.usage.input_tokens,
        cacheRead: final.usage.cache_read_input_tokens,
        cacheWrite: final.usage.cache_creation_input_tokens,
        output: final.usage.output_tokens,
      }),
    );

    if (final.stop_reason === "refusal") {
      await sse(writer, {
        error: "Anthropic declined to answer this request.",
      });
      return;
    }

    await writer.write(encoder.encode("data: [DONE]\n\n"));
  } catch (error: unknown) {
    console.error(
      "[anthropic] stream failed:",
      error instanceof Error ? error.message : "unknown",
    );
    try {
      await sse(writer, { error: describeApiError(error) });
    } catch {
      // Stream already closed
    }
  }
}
