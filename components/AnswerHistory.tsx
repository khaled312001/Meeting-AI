"use client";

/** Earlier answers, oldest first, shown above the live one so the user can
 *  scroll back while new answers keep arriving. */

import { memo } from "react";
import SafeMarkdown from "@/components/SafeMarkdown";
import { AnswerSources } from "@/components/AnswerSources";
import { AnswerHeader } from "@/components/AnswerHeader";
import type { PastAnswer } from "@/components/AssistantSessionProvider";
import { cn } from "@/lib/utils";
import { sentencePerLine } from "@/lib/answer-display";

interface AnswerHistoryProps {
  answers: PastAnswer[];
  /** Markdown classes of the surface (full vs compact). */
  proseClassName: string;
  /** Answer text size in px (the user's choice). */
  fontPx?: number;
  compact?: boolean;
}

export const AnswerHistory = memo(function AnswerHistory({
  answers,
  proseClassName,
  fontPx,
  compact = false,
}: AnswerHistoryProps) {
  if (answers.length === 0) return null;
  return (
    <div className="flex flex-col">
      {answers.map((a) => (
        <div
          key={a.id}
          dir="auto"
          className={cn(
            "border-b border-border-subtle/40 opacity-75 transition-opacity hover:opacity-100",
            compact ? "pb-2 mb-2" : "pb-4 mb-4",
            a.kind === "review" && "border-l-2 border-l-amber-300/50 pl-2",
          )}
        >
          <AnswerHeader kind={a.kind} at={a.at} n={a.n} text={a.text} />
          <div
            className={proseClassName}
            style={fontPx ? { fontSize: fontPx } : undefined}
          >
            <SafeMarkdown>{sentencePerLine(a.text)}</SafeMarkdown>
          </div>
          <AnswerSources
            citations={a.citations}
            compact={compact}
            className={compact ? "mt-2" : "not-prose mt-3"}
          />
        </div>
      ))}
    </div>
  );
});
