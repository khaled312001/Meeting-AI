"use client";

/** Owns the single-shot Assistant/Summarizer completion flow for the
 *  compact surface (abort controller, error mapping, PostHog payload,
 *  SSE parsing). */

import posthog from "posthog-js";
import { useCallback, useRef } from "react";
import { humanizeHttpStatus } from "@/lib/api-errors";
import { dbg } from "@/lib/debug";
import { createStreamFlusher } from "@/lib/stream-flush";
import {
  humanizeStreamError,
  isAbortError,
  streamCompletion,
} from "@/lib/stream-completion";
import { FLAGS } from "@/lib/types";
import { addCitation } from "@/lib/citations";
import { useAssistantSession } from "@/components/AssistantSessionProvider";
import { useTranscription } from "@/components/TranscriptionContext";
import {
  createLiveAnswer,
  isQuietReview,
  type LiveAnswerOptions,
} from "@/lib/live-answer";
import { collectSaidFigures } from "@/lib/said-figures";
import { getInterviewFiles } from "@/lib/interview-files";
import { guessLanguage } from "@/lib/meeting-language";
import {
  isVisionScreenshotDataUrl,
  VISION_FALLBACK_PROMPT,
} from "@/lib/vision-screenshot";
import type { CompactOutputMode } from "./OutputPanel";

interface UseCompactGenerateArgs {
  bg: string;
  transcribedText: string;
  attachedImages: string[];
  isLoading: boolean;
  setError: (msg: string | null) => void;
  setCompletion: React.Dispatch<React.SetStateAction<string>>;
  setIsLoading: (v: boolean) => void;
  setActiveFlag: (f: FLAGS | null) => void;
  setOutputCollapsed: (v: boolean) => void;
  setOutputMode: (m: CompactOutputMode) => void;
}

export interface CompactGenerateHandle {
  generate: (
    flag: FLAGS,
    customPrompt?: string,
    opts?: LiveAnswerOptions,
  ) => Promise<void>;
  abort: () => void;
  controllerRef: React.MutableRefObject<AbortController | null>;
}

export function useCompactGenerate({
  bg,
  transcribedText,
  attachedImages,
  isLoading,
  setError,
  setCompletion,
  setIsLoading,
  setActiveFlag,
  setOutputCollapsed,
  setOutputMode,
}: UseCompactGenerateArgs): CompactGenerateHandle {
  const controllerRef = useRef<AbortController | null>(null);
  const { setCitations, startNewAnswer, getRememberedAnswers, getAnswerHistory } =
    useAssistantSession();
  const { replyLanguage } = useTranscription();

  const abort = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
      setIsLoading(false);
      setActiveFlag(null);
    }
  }, [setActiveFlag, setIsLoading]);

  const generate = useCallback(
    async (flag: FLAGS, customPrompt?: string, opts: LiveAnswerOptions = {}) => {
      if (isLoading || controllerRef.current) return;
      const isTypedAsk = customPrompt !== undefined;
      let prompt = (customPrompt ?? transcribedText).trim();

      const validImages = isTypedAsk
        ? attachedImages
            .map((s) => s.trim())
            .filter((s) => isVisionScreenshotDataUrl(s))
        : [];
      const imagePayload: string | string[] | undefined =
        validImages.length === 0
          ? undefined
          : validImages.length === 1
            ? validImages[0]
            : validImages;
      if (validImages.length > 0 && !prompt) {
        prompt = VISION_FALLBACK_PROMPT;
      }

      if (!prompt) {
        setError(
          isTypedAsk
            ? humanizeHttpStatus(0, { kind: "ask-ai" })
            : humanizeHttpStatus(0, { kind: "no-input" }),
        );
        return;
      }

      const isReview = flag === FLAGS.REVIEW;
      setError(null);
      // A review only takes the answer slot once it has something to say.
      // A live answer to a heard question gets the question's number.
      const numbered =
        flag === FLAGS.ASSISTANT && !isTypedAsk && !!opts.question?.trim();
      const { previous: previousAnswers, n } = isReview
        ? { previous: getRememberedAnswers(), n: undefined }
        : startNewAnswer({
            replace: opts.replace,
            numbered,
            question: opts.question?.trim(),
            updated: opts.updated,
          });
      let shown = !isReview;
      setIsLoading(true);
      setActiveFlag(flag);
      if (!isReview) setOutputCollapsed(false);
      setOutputMode("transcript");
      controllerRef.current = new AbortController();

      posthog.capture("completion_generated", {
        mode: flag === FLAGS.ASSISTANT ? "assistant" : "summarizer",
        has_context: bg.length > 0,
        prompt_length: prompt.length,
        has_image: validImages.length > 0,
        image_count: validImages.length,
        source: isTypedAsk ? "typed" : "transcription",
        surface: "compact",
      });

      const t0 = performance.now();
      let sseEvents = 0;
      let firstTokenMs: number | null = null;
      dbg(
        "ask-completion",
        "POST /api/completion (compact) ·",
        flag,
        "· prompt_len:",
        prompt.length,
        "· images:",
        validImages.length,
        "· typed:",
        isTypedAsk,
      );

      try {
        // Accumulate tokens locally; apply to state at a bounded rate.
        // A live answer shows its question at once; the reply follows it.
        const liveQuestion =
          flag === FLAGS.ASSISTANT && !isTypedAsk ? opts.question?.trim() : undefined;
        // It shows the question as heard until the model's clean one-line
        // version of it arrives.
        const live = liveQuestion
          ? createLiveAnswer(liveQuestion, replyLanguage ?? guessLanguage(liveQuestion), n)
          : null;
        let acc = live ? live.text() : "";
        const flusher = createStreamFlusher(() => setCompletion(acc));
        if (acc) flusher.schedule();
        try {
          await streamCompletion({
            flag,
            answerOnly: !!liveQuestion,
            questionLine: !!liveQuestion,
            ...getInterviewFiles(),
            // Live answers and reviews keep to the figures already said.
            saidFigures:
              liveQuestion || isReview
                ? collectSaidFigures(getAnswerHistory(), prompt)
                : undefined,
            bg,
            prompt,
            image: imagePayload,
            lang: replyLanguage,
            question: opts.question,
            previousAnswers,
            myAnswer: opts.myAnswer,
            signal: controllerRef.current.signal,
            resolveErrorMessage: (response, defaultMessage) => {
              if (
                isTypedAsk &&
                defaultMessage === humanizeHttpStatus(0, { kind: "no-input" })
              ) {
                return humanizeHttpStatus(response.status, { kind: "ask-ai" });
              }
              return defaultMessage;
            },
            onChunk: (text) => {
              sseEvents++;
              if (firstTokenMs === null) {
                firstTokenMs = Math.round(performance.now() - t0);
                dbg("ask-completion", "first token at", firstTokenMs, "ms");
              }
              if (live) {
                live.push(text);
                acc = live.text();
              } else {
                acc += text;
              }
              if (!shown) {
                if (isQuietReview(acc)) return;
                startNewAnswer({ kind: "review" });
                setOutputCollapsed(false);
                shown = true;
              }
              flusher.schedule();
            },
            onCitation: (citation) =>
              setCitations((prev) => addCitation(prev, citation)),
          });
          if (live) {
            live.finish();
            acc = live.text();
          }
          flusher.flush();
        } finally {
          flusher.dispose();
        }
        dbg(
          "ask-completion",
          "stream done · events:",
          sseEvents,
          "· total:",
          Math.round(performance.now() - t0),
          "ms",
        );
      } catch (err: unknown) {
        if (isAbortError(err)) {
          dbg(
            "ask-completion",
            "aborted after",
            Math.round(performance.now() - t0),
            "ms (",
            sseEvents,
            "events received)",
          );
        } else if (err instanceof Error && !isReview) {
          console.error("Stream error:", err);
          dbg("ask-completion", "FAILED:", err.message);
          setError(humanizeStreamError(err));
          posthog.captureException(err);
        }
      } finally {
        setIsLoading(false);
        setActiveFlag(null);
        controllerRef.current = null;
      }
    },
    [
      attachedImages,
      bg,
      getAnswerHistory,
      getRememberedAnswers,
      isLoading,
      replyLanguage,
      setActiveFlag,
      setCitations,
      setCompletion,
      setError,
      setIsLoading,
      setOutputCollapsed,
      setOutputMode,
      startNewAnswer,
      transcribedText,
    ],
  );

  return { generate, abort, controllerRef };
}
