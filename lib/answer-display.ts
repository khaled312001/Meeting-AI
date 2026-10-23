"use client";

/** How live answers are shown: one sentence per line, in a size the user
 *  picks, so the candidate can read the next sentence at a glance while
 *  the rest is still being written. */

import { useCallback, useEffect, useState } from "react";

/** A sentence end followed by the next sentence; common abbreviations
 *  ("e.g.", "Dr.") and numbers ("2.5") don't end a sentence. */
const SENTENCE_END_RE =
  /(?<!\b(?:e\.g|i\.e|etc|vs|approx|Mr|Mrs|Ms|Dr|Prof|St|Inc|Ltd|bzw|ca|z\.B|d\.h))([.!?؟…])["'”’»)]*[ \t]+(?=\S)/g;

/** The answer text with each sentence on its own line (a Markdown line
 *  break). Code blocks stay as they are. */
export function sentenceLines(reply: string): string {
  // Odd parts are fenced code blocks.
  return reply
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((part, i) =>
      i % 2 === 1 ? part : part.replace(SENTENCE_END_RE, (m) => `${m.trimEnd()}  \n`),
    )
    .join("");
}

export type AnswerTextSize = "normal" | "large" | "larger";

const SIZE_KEY = "meeting-ai-answer-text-size";
const SIZES: AnswerTextSize[] = ["normal", "large", "larger"];

/** Font size in px per surface and size. */
export const ANSWER_FONT_PX: Record<"compact" | "full", Record<AnswerTextSize, number>> = {
  compact: { normal: 14.5, large: 17, larger: 20 },
  full: { normal: 15, large: 18, larger: 21 },
};

const listeners = new Set<(size: AnswerTextSize) => void>();

/** The answer text size (large by default), shared by every answer view
 *  and remembered on this device. */
export function useAnswerTextSize() {
  const [size, setSize] = useState<AnswerTextSize>("large");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIZE_KEY) as AnswerTextSize | null;
      if (stored && SIZES.includes(stored)) setSize(stored);
    } catch {
      /* storage unavailable — keep the default */
    }
    listeners.add(setSize);
    return () => {
      listeners.delete(setSize);
    };
  }, []);
  const cycle = useCallback(() => {
    const next = SIZES[(SIZES.indexOf(size) + 1) % SIZES.length];
    try {
      localStorage.setItem(SIZE_KEY, next);
    } catch {
      /* storage unavailable — applies for this session */
    }
    for (const l of listeners) l(next);
  }, [size]);
  return { size, cycle };
}
