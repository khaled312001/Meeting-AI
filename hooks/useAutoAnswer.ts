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

import { useCallback, useEffect, useRef, useState } from "react";

export interface AutoAnswerTrigger {
  /** The speech to answer — the full question, word for word. */
  question: string;
  /** True when this replaces the previous answer (the question went on). */
  replace: boolean;
  /** Asked for with Update. */
  updated?: boolean;
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
  /** Finalized speech from the user's microphone: when the user starts
   *  replying, the question is over, so the answer comes at once. */
  myTranscript?: string;
  onTrigger: (trigger: AutoAnswerTrigger) => void;
  /** Stop the answer that is streaming now. */
  onInterrupt: () => void;
}

/** Pause after a question mark before answering, on top of the pause the
 *  speech-to-text already waited for. None: the answer starts the moment
 *  the question is final. If the interviewer carries on, the answer
 *  restarts with the full question (CONTINUE_WINDOW_MS), and the stopped
 *  one is not charged. */
const QUESTION_PAUSE_MS = 0;
/** Pause after speech that does not end in a question mark. */
const SENTENCE_PAUSE_MS = 300;
/** Words the user must say before their reply counts as "question over". */
const REPLY_MIN_WORDS = 3;
const MIN_WORDS = 3;
/** Speech this soon after an answer started continues the same question. */
const CONTINUE_WINDOW_MS = 2500;
/** …and must be at least this long to replace the answer. */
const CONTINUE_MIN_WORDS = 3;

/** Manual mode: Answer pressed while the other side is still talking waits
 *  for the whole question — this long after their last words (shorter
 *  when it ends in a question mark), however long the question is. */
const MANUAL_END_PAUSE_MS = 1200;
const MANUAL_QUESTION_END_PAUSE_MS = 500;
/** Manual mode: more speech this soon after Answer means the question
 *  went on; it is answered again, whole, once it ends. */
const MANUAL_CONTINUE_WINDOW_MS = 4000;

const wordCount = (text: string) =>
  text.split(/\s+/).filter(Boolean).length;
const words = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/** The user's words are their own reply, not the interviewer's voice
 *  picked up by the microphone (speakers instead of headphones). */
function isOwnReply(mine: string, theirs: string): boolean {
  const own = words(mine);
  if (own.length < REPLY_MIN_WORDS) return false;
  const heard = new Set(words(theirs));
  const shared = own.filter((w) => heard.has(w)).length;
  return shared / own.length < 0.6;
}

const endsWithQuestion = (text: string) => /[?؟]\s*["'»”)]*\s*$/.test(text);

export function useAutoAnswer({
  enabled,
  isLive,
  isBusy,
  transcript,
  hasInterim,
  myTranscript = "",
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

  /** Where the user's own speech stood when the current question began. */
  const myStartAt = useRef(0);
  const myTranscriptRef = useRef(myTranscript);
  myTranscriptRef.current = myTranscript;

  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const hasInterimRef = useRef(hasInterim);
  hasInterimRef.current = hasInterim;

  /** Manual mode: Answer was pressed and the question is still going. */
  const [waitingForEnd, setWaitingForEnd] = useState(false);
  const waitingRef = useRef(false);
  /** Manual mode: the last answer came from the Answer button. */
  const manualAnswer = useRef(false);
  const setWaiting = useCallback((on: boolean) => {
    waitingRef.current = on;
    setWaitingForEnd(on);
  }, []);

  /** Transcript ranges sent for an answer, so speech that never reached
   *  one shows as a gap. */
  const [sentRanges, setSentRanges] = useState<Array<[number, number]>>([]);
  /** `answeredUpTo` for rendering: speech before it that no range covers
   *  was skipped (a gap); speech after it waits for the next answer. */
  const [answeredTo, setAnsweredTo] = useState(0);

  /** Mark the question as answered and return it. */
  const take = useCallback((text: string): AutoAnswerTrigger => {
    const replace = continuing.current;
    const from = replace ? questionStart.current : answeredUpTo.current;
    const question = text.slice(from).trim();
    setSentRanges((ranges) => [...ranges, [from, text.length]]);
    setAnsweredTo(text.length);
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
      setAnsweredTo(transcript.length);
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
      setSentRanges([]);
      setAnsweredTo(transcript.length);
    }
    if (!enabled) {
      // Manual: the question went on after Answer → stop that answer and
      // answer the whole question once it ends (see the wait below).
      const more = transcript.slice(answeredUpTo.current).trim();
      if (
        manualAnswer.current &&
        more &&
        !waitingRef.current &&
        !continuing.current &&
        Date.now() - triggeredAt.current < MANUAL_CONTINUE_WINDOW_MS &&
        wordCount(more) >= CONTINUE_MIN_WORDS
      ) {
        continuing.current = true;
        if (isBusy && running.current === "answer") onInterruptRef.current();
        setWaiting(true);
      }
      return;
    }
    const fresh = transcript.slice(answeredUpTo.current).trim();
    if ((fresh || hasInterim) && speechStartedAt.current === 0) {
      speechStartedAt.current = Date.now();
      myStartAt.current = myTranscriptRef.current.length;
    }

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

    // The user started replying: the interviewer is done, answer now.
    const replying = isOwnReply(myTranscript.slice(myStartAt.current), fresh);
    const timer = setTimeout(
      () => {
        manualAnswer.current = false;
        onTriggerRef.current(take(transcript));
      },
      replying ? 0 : endsWithQuestion(fresh) ? QUESTION_PAUSE_MS : SENTENCE_PAUSE_MS,
    );
    return () => clearTimeout(timer);
  }, [enabled, isLive, isBusy, hasInterim, transcript, myTranscript, take, setWaiting]);

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

  // Manual: answer once the other side has finished the question.
  useEffect(() => {
    if (!waitingForEnd || hasInterim || isBusy) return;
    const fresh = transcript.slice(answeredUpTo.current).trim();
    const timer = setTimeout(
      () => {
        setWaiting(false);
        onTriggerRef.current(takeQuestion());
      },
      endsWithQuestion(fresh) ? MANUAL_QUESTION_END_PAUSE_MS : MANUAL_END_PAUSE_MS,
    );
    return () => clearTimeout(timer);
  }, [waitingForEnd, hasInterim, isBusy, transcript, setWaiting, takeQuestion]);

  // Nothing to wait for once listening stops or Auto takes over.
  useEffect(() => {
    if ((!isLive || enabled) && waitingRef.current) setWaiting(false);
  }, [isLive, enabled, setWaiting]);

  /** Manual mode's Answer: while the other side is still talking, wait
   *  for the end of the question and answer all of it (through
   *  `onTrigger`). Pressed again while waiting, it answers right away. */
  const answerWhenQuestionEnds = useCallback(() => {
    manualAnswer.current = true;
    if (waitingRef.current || !hasInterimRef.current) {
      setWaiting(false);
      onTriggerRef.current(takeQuestion());
      return;
    }
    setWaiting(true);
  }, [takeQuestion, setWaiting]);

  /** Update: Answer was pressed too early and the question went on. The
   *  answer on screen stops and the whole question, old part plus new, is
   *  answered once more in its place, so each question keeps one answer. */
  const [updateRequested, setUpdateRequested] = useState(false);
  const updateAnswer = useCallback(() => {
    if (triggeredAt.current === 0) return;
    setWaiting(false);
    continuing.current = true;
    manualAnswer.current = true;
    if (running.current === "answer") onInterruptRef.current();
    setUpdateRequested(true);
  }, [setWaiting]);
  useEffect(() => {
    if (!updateRequested || isBusy) return;
    setUpdateRequested(false);
    onTriggerRef.current({ ...take(transcriptRef.current), updated: true });
  }, [updateRequested, isBusy, take]);

  /** Answer one earlier stretch of speech that was never sent (a gap). */
  const answerRange = useCallback((from: number, to: number) => {
    const question = transcriptRef.current.slice(from, to).trim();
    if (!question) return;
    setSentRanges((ranges) => [...ranges, [from, to]]);
    lastQuestion.current = question;
    triggeredAt.current = Date.now();
    running.current = "answer";
    manualAnswer.current = false;
    onTriggerRef.current({ question, replace: false });
  }, []);

  return {
    takeQuestion,
    answerWhenQuestionEnds,
    waitingForEnd,
    sentRanges,
    answeredTo,
    answerRange,
    updateAnswer,
  };
}
