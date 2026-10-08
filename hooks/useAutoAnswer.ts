"use client";

/** Live assist: answers the other side's questions.
 *
 *  When `enabled` (Auto mode):
 *  - Waits while the other side is still being heard and for a pause after
 *    their last finalized words: shorter when the text ends in a question
 *    mark, longer otherwise, so a mid-sentence breath does not cut the
 *    question in half.
 *  - If they keep going while the answer is being written (or just after
 *    it started), the question was not finished: the answer is stopped and
 *    the whole question, old part plus new, is answered again in its place. */

import { useCallback, useEffect, useRef } from "react";

export interface AutoAnswerTrigger {
  /** The speech to answer — the full question, word for word. */
  question: string;
  /** True when this replaces the previous answer (the question went on). */
  replace: boolean;
}

interface UseAutoAnswerArgs {
  /** Answer questions on their own (Auto mode). */
  enabled: boolean;
  isLive: boolean;
  isBusy: boolean;
  /** Finalized speech from the other side. */
  transcript: string;
  /** The other side is still being heard (not finalized yet). */
  hasInterim: boolean;
  onTrigger: (trigger: AutoAnswerTrigger) => void;
  /** Stop the answer that is streaming now. */
  onInterrupt: () => void;
}

/** Pause after a question mark before answering. */
const QUESTION_PAUSE_MS = 500;
/** Pause after speech that does not end in a question mark. */
const SENTENCE_PAUSE_MS = 1000;
const MIN_WORDS = 3;
/** Speech this soon after an answer started continues the same question. */
const CONTINUE_WINDOW_MS = 2500;
/** …and must be at least this long to replace the answer. */
const CONTINUE_MIN_WORDS = 3;

const wordCount = (text: string) =>
  text.split(/\s+/).filter(Boolean).length;
const endsWithQuestion = (text: string) => /[?؟]\s*["'»”)]*\s*$/.test(text);

export function useAutoAnswer({
  enabled,
  isLive,
  isBusy,
  transcript,
  hasInterim,
  onTrigger,
  onInterrupt,
}: UseAutoAnswerArgs) {
  /** Transcript offset already covered by an answer. */
  const answeredUpTo = useRef(0);
  /** Where the last answered question began. */
  const questionStart = useRef(0);
  /** The last answered question. */
  const lastQuestion = useRef("");
  /** When the last answer was triggered (0 = none this session). */
  const triggeredAt = useRef(0);
  /** When speech after the last answer was first heard (0 = not yet). */
  const speechStartedAt = useRef(0);
  /** The question in progress continues the last answered one. */
  const continuing = useRef(false);
  /** An answer is streaming now. */
  const running = useRef<"answer" | null>(null);

  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;
  const onInterruptRef = useRef(onInterrupt);
  onInterruptRef.current = onInterrupt;

  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;

  /** Mark the question as answered and return it. */
  const take = useCallback((text: string): AutoAnswerTrigger => {
    const replace = continuing.current;
    const from = replace ? questionStart.current : answeredUpTo.current;
    const question = text.slice(from).trim();
    questionStart.current = from;
    answeredUpTo.current = text.length;
    lastQuestion.current = question;
    triggeredAt.current = Date.now();
    speechStartedAt.current = 0;
    continuing.current = false;
    running.current = "answer";
    return { question, replace };
  }, []);

  useEffect(() => {
    if (!isBusy) running.current = null;
  }, [isBusy]);

  // Speech from before this listening session was not asked live.
  const wasLive = useRef(false);
  useEffect(() => {
    if (isLive && !wasLive.current) {
      answeredUpTo.current = transcript.length;
      questionStart.current = transcript.length;
      triggeredAt.current = 0;
      continuing.current = false;
    }
    wasLive.current = isLive;
    // Only on the live transition — not on every transcript change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive]);

  // Answer the other side.
  useEffect(() => {
    if (!isLive) return;
    // Transcript was cleared: answer only speech that comes after this.
    if (transcript.length < answeredUpTo.current) {
      answeredUpTo.current = transcript.length;
      questionStart.current = transcript.length;
      continuing.current = false;
    }
    if (!enabled) return;
    const fresh = transcript.slice(answeredUpTo.current).trim();
    if ((fresh || hasInterim) && speechStartedAt.current === 0)
      speechStartedAt.current = Date.now();

    // Did the speaker carry on with the question just answered?
    if (fresh && triggeredAt.current > 0 && !continuing.current) {
      const answering = isBusy && running.current === "answer";
      const soon =
        speechStartedAt.current - triggeredAt.current < CONTINUE_WINDOW_MS;
      if ((answering || soon) && wordCount(fresh) >= CONTINUE_MIN_WORDS) {
        continuing.current = true;
        if (answering) onInterruptRef.current();
      }
    }
    if (isBusy || hasInterim) return;
    const enough =
      wordCount(fresh) >= MIN_WORDS ||
      (wordCount(fresh) >= 1 && endsWithQuestion(fresh));
    if (!enough) return;

    const timer = setTimeout(
      () => onTriggerRef.current(take(transcript)),
      endsWithQuestion(fresh) ? QUESTION_PAUSE_MS : SENTENCE_PAUSE_MS,
    );
    return () => clearTimeout(timer);
  }, [enabled, isLive, isBusy, hasInterim, transcript, take]);

  /** For the manual Answer button: the speech not answered yet, or the
   *  last question again when nothing new was said. */
  const takeQuestion = useCallback((): AutoAnswerTrigger => {
    const text = transcriptRef.current;
    if (!text.slice(answeredUpTo.current).trim()) {
      running.current = "answer";
      triggeredAt.current = Date.now();
      return {
        question:
          lastQuestion.current || text.slice(questionStart.current).trim(),
        replace: true,
      };
    }
    return take(text);
  }, [take]);

  return { takeQuestion };
}
