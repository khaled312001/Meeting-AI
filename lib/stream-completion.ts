import { humanizeError, parseApiErrorResponse } from "@/lib/api-errors";
import { ricFetch } from "@/lib/ric-fetch";
import { parseSseStream } from "@/lib/sse";
import { FLAGS, type AnswerCitation } from "@/lib/types";

const SSE_CLIENT_BUFFER_MAX = 1_000_000;
/** Server prompt limits (realtime-worker-api completion-types). Live
 *  answers send the latest part of the transcript; the question itself
 *  travels separately, so older talk can be dropped. */
const MAX_PROMPT_CHARS = 30_000;
const MAX_SUMMARY_PROMPT_CHARS = 195_000;

/** The end of `text`, at most `max` characters, starting on a line. */
function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  const nl = cut.indexOf("\n");
  return nl > 0 && nl < 2000 ? cut.slice(nl + 1) : cut;
}

export interface StreamCompletionParams {
  flag: FLAGS;
  bg: string;
  prompt: string;
  signal: AbortSignal;
  image?: string | string[];
  onChunk: (text: string) => void;
  /** Called for each knowledge-file citation Anthropic attaches. */
  onCitation?: (citation: AnswerCitation) => void;
  /** Send the user's knowledge files with the request (default true). */
  useKnowledge?: boolean;
  /** Meeting language — answers are written in it. */
  lang?: string;
  /** The exact question to answer (live answers). */
  question?: string;
  /** Earlier answers, oldest first, so follow-ups stay consistent. */
  previousAnswers?: string[];
  /** What the user said aloud (reviews). */
  myAnswer?: string;
  resolveErrorMessage?: (
    response: Response,
    defaultMessage: string,
  ) => string | Promise<string>;
}

export async function streamCompletion({
  flag,
  bg,
  prompt,
  signal,
  image,
  resolveErrorMessage,
  onChunk,
  onCitation,
  useKnowledge,
  lang,
  question,
  previousAnswers,
  myAnswer,
}: StreamCompletionParams): Promise<void> {
  const response = await ricFetch("/api/completion", {
    method: "POST",
    body: JSON.stringify({
      bg,
      flag,
      prompt: tail(
        prompt,
        flag === FLAGS.SUMMARIZER ? MAX_SUMMARY_PROMPT_CHARS : MAX_PROMPT_CHARS,
      ),
      ...(image !== undefined ? { image } : {}),
      ...(useKnowledge !== undefined ? { useKnowledge } : {}),
      ...(lang ? { lang } : {}),
      ...(question ? { question } : {}),
      ...(previousAnswers?.length ? { previousAnswers } : {}),
      ...(myAnswer ? { myAnswer } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const defaultMessage = await parseApiErrorResponse(response);
    const message = resolveErrorMessage
      ? await resolveErrorMessage(response, defaultMessage)
      : defaultMessage;
    throw new Error(message);
  }

  let streamError: string | null = null;
  await parseSseStream(response, {
    signal,
    maxBufferChars: SSE_CLIENT_BUFFER_MAX,
    onChunk: (delta) => {
      if (delta.text) {
        onChunk(delta.text);
      }
      if (delta.citation) {
        onCitation?.(delta.citation);
      }
    },
    onError: (message) => {
      streamError = message;
    },
    onParseError: (err) => {
      console.error("Error parsing SSE data:", err);
    },
  });

  if (streamError) {
    throw new Error(streamError);
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function humanizeStreamError(err: unknown): string {
  return humanizeError(err);
}
