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
  /** Answer the current transcript now (auto-answer). */
  generateNow: () => Promise<void>;
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
  const { completion, setCompletion, setCitations, startNewAnswer } =
    useAssistantSession();
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
    async (runFlag: FLAGS, runBg: string, prompt: string) => {
      if (isLoading || controller.current) return;
      if (!prompt.trim()) {
        setError(new Error(humanizeHttpStatus(0, { kind: "no-input" })));
        return;
      }

      setError(null);
      startNewAnswer();
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
            signal: controller.current.signal,
            onChunk: (text) => {
              acc += text;
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
        if (!isAbortError(err)) {
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
    [isLoading, setCitations, setCompletion, startNewAnswer],
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
    () => runCompletion(flag, bg, getTranscribedText()),
    [bg, flag, runCompletion, getTranscribedText],
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
    summarizeNow,
    stop,
    regenerate,
    canRegenerate,
  };
}
