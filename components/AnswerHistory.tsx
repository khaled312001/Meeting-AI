"use client";

/** Earlier answers, oldest first, shown above the live one so the user can
 *  scroll back while new answers keep arriving. */

import { memo } from "react";
import SafeMarkdown from "@/components/SafeMarkdown";
import { AnswerSources } from "@/components/AnswerSources";
import type { PastAnswer } from "@/components/AssistantSessionProvider";
import { cn } from "@/lib/utils";

interface AnswerHistoryProps {
  answers: PastAnswer[];
  /** Markdown classes of the surface (full vs compact). */
  proseClassName: string;
  compact?: boolean;
}

export const AnswerHistory = memo(function AnswerHistory({
  answers,
  proseClassName,
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
            "border-b border-border-subtle/40 opacity-75",
            compact ? "pb-2 mb-2" : "pb-4 mb-4",
          )}
        >
          <div className={proseClassName}>
            <SafeMarkdown>{a.text}</SafeMarkdown>
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
