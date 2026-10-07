"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface StickToBottom {
  ref: React.RefObject<HTMLDivElement | null>;
  stickToBottomRef: React.RefObject<boolean>;
  showLatest: boolean;
  handleScroll: () => void;
  scrollToLatest: () => void;
}

/**
 * Keeps a scroll container pinned to the bottom as content streams in, unless
 * the user scrolls up to read. `showLatest` is true while the user has drifted
 * away from the bottom so callers can offer a "jump to latest" affordance.
 */
export function useStickToBottom(
  trigger: unknown,
  threshold = 48,
): StickToBottom {
  const ref = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [showLatest, setShowLatest] = useState(false);

  // The dep below exists to re-run this effect on every streaming update;
  // the body reads state only through refs, which exhaustive-deps can't see.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger drives re-run, not body reads
  useEffect(() => {
    const el = ref.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [trigger]);

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < threshold;
    stickToBottomRef.current = atBottom;
    setShowLatest(!atBottom && el.scrollHeight > el.clientHeight + 80);
  }, [threshold]);

  const scrollToLatest = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    stickToBottomRef.current = true;
    setShowLatest(false);
  }, []);

  return { ref, stickToBottomRef, showLatest, handleScroll, scrollToLatest };
}
