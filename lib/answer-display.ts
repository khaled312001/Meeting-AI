"use client";

/** How live answers are shown: each line as the model wrote it, in a size
 *  the user picks. A bullet stays one line even when it holds two
 *  sentences; sentences are never put on lines of their own. */

import { useCallback, useEffect, useState } from "react";

/** A line all in bold (the closing line) right after a bullet: Markdown
 *  would fold it into that bullet. */
const BOLD_LINE_AFTER_BULLET_RE =
  /^([ \t]*[-*•][ \t].*)\n([ \t]*\*\*[^*\n]+\*\*[ \t]*)$/gm;

/** A line end between two written lines. */
const LINE_END_RE = /([^\n])[ \t]*\n(?=[^\n])/g;

/** The answer text with each written line on a line of its own (a Markdown
 *  line break, so the title and the opening don't run together), and a
 *  bold closing line kept apart from the last bullet. Code blocks stay as
 *  they are. */
export function answerLines(reply: string): string {
  // Odd parts are fenced code blocks.
  return reply
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(BOLD_LINE_AFTER_BULLET_RE, "$1\n\n$2")
            .replace(LINE_END_RE, "$1  \n"),
    )
    .join("");
}

export type AnswerTextSize = "normal" | "large" | "larger";

const SIZE_KEY = "meeting-ai-answer-text-size";
const SIZES: AnswerTextSize[] = ["normal", "large", "larger"];

/** Font size in px per surface and size. */
export const ANSWER_FONT_PX: Record<
  "compact" | "full",
  Record<AnswerTextSize, number>
> = {
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
