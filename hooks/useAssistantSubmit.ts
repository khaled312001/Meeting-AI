"use client";

/** Owns the single-shot Assistant/Summarizer completion flow for the
 *  full Assistant surface. */

import { sendGTMEvent } from "@next/third-parties/google";
import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { humanizeHttpStatus } from "@/lib/api-errors";
import {
  humanizeStreamError,
  isAbortError,
  streamCompletion,
} from "@/lib/stream-completion";
import { createStreamFlusher } from "@/lib/stream-flush";
import { FLAGS } from "@/lib/types";
import { addCitation } from "@/lib/citations";
import { useAssistantSession } from "@/components/AssistantSessionProvider";
import { useTranscription } from "@/components/TranscriptionContext";
import { isQuietReview, type LiveAnswerOptions } from "@/lib/live-answer";

interface UseAssistantSubmitArgs {
  flag: FLAGS;
  bg: string;
  /** Read-at-submit transcript accessor — keeps `submit` referentially
   *  stable across interim transcription updates. */
  getTranscribedText: () => string;
}

export interface AssistantSubmitHandle {
  completion: string;
  setCompletion: React.Dispatch<React.SetStateAction<string>>;
  isLoading: boolean;
  error: Error | null;
  setError: (err: Error | null) => void;
  submit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  /** Answer now — the given question, or the whole transcript. */
  generateNow: (opts?: LiveAnswerOptions) => Promise<void>;
  /** Notes on the answer the user just gave aloud. */
  reviewNow: (opts: LiveAnswerOptions) => Promise<void>;
  /** Summarize the conversation so far (one-off). */
  summarizeNow: () => Promise<void>;
  stop: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  regenerate: () => Promise<void>;
  canRegenerate: boolean;
}

export function useAssistantSubmit({
  flag,
  bg,
  getTranscribedText,
}: UseAssistantSubmitArgs): AssistantSubmitHandle {
  const {
    completion,
    setCompletion,
    setCitations,
    startNewAnswer,
    getRememberedAnswers,
  } = useAssistantSession();
  const { language } = useTranscription();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [canRegenerate, setCanRegenerate] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const lastFailedRef = useRef<{
    flag: FLAGS;
    bg: string;
    prompt: string;
  } | null>(null);

  const stop = useCallback((e?: React.MouseEvent<HTMLButtonElement>) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.blur();
    }
    if (controller.current) {
      controller.current.abort();
      controller.current = null;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (controller.current) {
        controller.current.abort();
        controller.current = null;
      }
    };
  }, []);

  const runCompletion = useCallback(
    async (
      runFlag: FLAGS,
      runBg: string,
      prompt: string,
      opts: LiveAnswerOptions = {},
    ) => {
      if (isLoading || controller.current) return;
      if (!prompt.trim()) {
        setError(new Error(humanizeHttpStatus(0, { kind: "no-input" })));
        return;
      }

      const isReview = runFlag === FLAGS.REVIEW;
      setError(null);
      // A review only takes the answer slot once it has something to say.
      const previousAnswers = isReview
        ? getRememberedAnswers()
        : startNewAnswer({ replace: opts.replace });
      let shown = !isReview;
      setIsLoading(true);
      controller.current = new AbortController();

      sendGTMEvent({ event: "generate_completion", flag: runFlag });
      posthog.capture("completion_generated", {
        mode: runFlag === FLAGS.ASSISTANT ? "assistant" : "summarizer",
        has_context: runBg.length > 0,
        transcription_length: prompt.length,
      });

      try {
        // Accumulate tokens locally and apply to React state at a bounded
        // rate — one render per token is wasteful for long answers.
        let acc = "";
        const flusher = createStreamFlusher(() => setCompletion(acc));
        try {
          await streamCompletion({
            flag: runFlag,
            bg: runBg,
            prompt,
            lang: language,
            question: opts.question,
            previousAnswers,
            myAnswer: opts.myAnswer,
            signal: controller.current.signal,
            onChunk: (text) => {
              acc += text;
              if (!shown) {
                if (isQuietReview(acc)) return;
                startNewAnswer({ kind: "review" });
                shown = true;
              }
              flusher.schedule();
            },
            onCitation: (citation) =>
              setCitations((prev) => addCitation(prev, citation)),
          });
          flusher.flush();
        } finally {
          flusher.dispose();
        }
        lastFailedRef.current = null;
        setCanRegenerate(false);
      } catch (err: unknown) {
        if (!isAbortError(err) && !isReview) {
          console.error("Stream error:", err);
          setError(new Error(humanizeStreamError(err)));
          posthog.captureException(err);
          lastFailedRef.current = {
            flag: runFlag,
            bg: runBg,
            prompt,
          };
          setCanRegenerate(true);
        }
      } finally {
        setIsLoading(false);
        controller.current = null;
      }
    },
    [
      getRememberedAnswers,
      isLoading,
      language,
      setCitations,
      setCompletion,
      startNewAnswer,
    ],
  );

  const submit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      e.stopPropagation();
      await runCompletion(flag, bg, getTranscribedText());
    },
    [bg, flag, runCompletion, getTranscribedText],
  );

  const generateNow = useCallback(
    (opts?: LiveAnswerOptions) =>
      runCompletion(FLAGS.ASSISTANT, bg, getTranscribedText(), opts),
    [bg, runCompletion, getTranscribedText],
  );

  const reviewNow = useCallback(
    (opts: LiveAnswerOptions) =>
      runCompletion(FLAGS.REVIEW, bg, getTranscribedText(), opts),
    [bg, runCompletion, getTranscribedText],
  );

  const summarizeNow = useCallback(
    () => runCompletion(FLAGS.SUMMARIZER, bg, getTranscribedText()),
    [bg, runCompletion, getTranscribedText],
  );

  const regenerate = useCallback(async () => {
    const last = lastFailedRef.current;
    if (!last) return;
    await runCompletion(last.flag, last.bg, last.prompt);
  }, [runCompletion]);

  return {
    completion,
    setCompletion,
    isLoading,
    error,
    setError,
    submit,
    generateNow,
    reviewNow,
    summarizeNow,
    stop,
    regenerate,
    canRegenerate,
  };
}
