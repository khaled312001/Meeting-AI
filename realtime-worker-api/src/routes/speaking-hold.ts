/** Holds a live answer back while the speaking step fixes its words.
 *
 *  The provider writes its SSE frames here instead of to the client. The
 *  question line (the first line of a `questionLine` reply) goes through at
 *  once, so the heading updates while the answer is being written; citation
 *  frames pass through too. The answer itself is kept until the provider
 *  finishes, then the speaking step runs and the screen it gives is sent,
 *  followed by `[DONE]`. */

import { encoder } from "../lib/http";
import { type Feed, runSpeakingPass, type SpeakingPassResult } from "./speaking-pass";

/** The app's limit for a question line (lib/live-answer.ts). */
const QUESTION_LINE_MAX_CHARS = 400;

export interface SpeakingHoldOptions {
  out: WritableStreamDefaultWriter<Uint8Array>;
  apiKey: string;
  /** The reply starts with the question restated on one line. */
  questionLine: boolean;
  /** The question as heard, when the reply has no question line. */
  question: string;
  /** The candidate's files, for the checks made in code. */
  feed?: Feed | null;
  signal?: AbortSignal;
  /** For tests: replaces the model call. */
  pass?: typeof runSpeakingPass;
}

function frame(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function cleanQuestion(line: string): string {
  return line
    .replace(/\*\*/g, "")
    .replace(/^\s*(question|q|frage|السؤال)\s*\d*\s*[:：]\s*/i, "")
    .trim();
}

export function createSpeakingHold(opts: SpeakingHoldOptions) {
  let held = "";
  let lineSent = -1; // chars of `held` already sent (the question line)
  let done = false;
  let error: unknown = null;
  let pending = "";

  const flushQuestionLine = async () => {
    if (!opts.questionLine || lineSent >= 0) return;
    const lead = held.length - held.trimStart().length;
    const nl = held.indexOf("\n", lead);
    if (nl < 0) return;
    if (nl - lead > QUESTION_LINE_MAX_CHARS) {
      lineSent = 0; // not a question line: hold everything
      return;
    }
    lineSent = nl + 1;
    await opts.out.write(frame({ text: held.slice(0, lineSent) }));
  };

  const writer = {
    async write(chunk: Uint8Array) {
      pending += new TextDecoder().decode(chunk);
      let end = pending.indexOf("\n\n");
      while (end >= 0) {
        const raw = pending.slice(0, end).replace(/^data:\s*/, "");
        pending = pending.slice(end + 2);
        end = pending.indexOf("\n\n");
        if (raw === "[DONE]") {
          done = true;
          continue;
        }
        let parsed: { text?: unknown; error?: unknown; citation?: unknown };
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }
        if (typeof parsed.text === "string") {
          held += parsed.text;
          await flushQuestionLine();
        } else if (parsed.error !== undefined) {
          error = parsed.error;
        } else if (parsed.citation !== undefined) {
          await opts.out.write(frame({ citation: parsed.citation }));
        }
      }
    },
  } as unknown as WritableStreamDefaultWriter<Uint8Array>;

  /** The provider is finished: run the speaking step and send the screen.
   *  Returns the step's result and the question line sent before it. */
  async function finish(): Promise<{ result: SpeakingPassResult; questionLine: string } | null> {
    if (error !== null) {
      await opts.out.write(frame({ error }));
      return null;
    }
    if (!done || opts.signal?.aborted) return null;
    const sent = Math.max(lineSent, 0);
    const rest = held.slice(sent);
    const lead = rest.slice(0, rest.length - rest.trimStart().length);
    const body = rest.trim();
    if (!body) {
      if (rest) await opts.out.write(frame({ text: rest }));
      await opts.out.write(encoder.encode("data: [DONE]\n\n"));
      return null;
    }
    const question = sent > 0 ? cleanQuestion(held.slice(0, sent)) || opts.question : opts.question;
    const result = await (opts.pass ?? runSpeakingPass)({
      apiKey: opts.apiKey,
      question,
      answer: body,
      feed: opts.feed,
      signal: opts.signal,
    });
    const questionLine = held.slice(0, sent).trim();
    if (opts.signal?.aborted) return { result, questionLine };
    await opts.out.write(frame({ text: lead + result.text }));
    await opts.out.write(encoder.encode("data: [DONE]\n\n"));
    return { result, questionLine };
  }

  return { writer, finish };
}
