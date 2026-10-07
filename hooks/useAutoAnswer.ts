"use client";

/** Fires an answer on its own once the other side stops talking: after
 *  `pauseMs` without new transcript and at least `minWords` of new speech
 *  since the last answer. Waits out an answer that is still streaming and
 *  re-checks when it finishes. */

import { useEffect, useRef } from "react";

interface UseAutoAnswerArgs {
  enabled: boolean;
  isLive: boolean;
  isBusy: boolean;
  transcript: string;
  onTrigger: () => void;
  pauseMs?: number;
  minWords?: number;
}

export function useAutoAnswer({
  enabled,
  isLive,
  isBusy,
  transcript,
  onTrigger,
  pauseMs = 700,
  minWords = 3,
}: UseAutoAnswerArgs) {
  const answeredUpTo = useRef(0);
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;

  // Speech from before this listening session was not asked live.
  const wasLive = useRef(false);
  useEffect(() => {
    if (isLive && !wasLive.current) answeredUpTo.current = transcript.length;
    wasLive.current = isLive;
    // Only on the live transition — not on every transcript change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive]);

  useEffect(() => {
    if (!enabled || !isLive || isBusy) return;
    // Transcript was cleared, or recent lines were re-transcribed in the
    // detected language: answer only speech that comes after this point.
    if (transcript.length < answeredUpTo.current)
      answeredUpTo.current = transcript.length;
    const fresh = transcript.slice(answeredUpTo.current).trim();
    if (fresh.split(/\s+/).filter(Boolean).length < minWords) return;

    const timer = setTimeout(() => {
      answeredUpTo.current = transcript.length;
      onTriggerRef.current();
    }, pauseMs);
    return () => clearTimeout(timer);
  }, [enabled, isLive, isBusy, transcript, pauseMs, minWords]);
}
