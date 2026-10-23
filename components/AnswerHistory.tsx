"use client";

/** Earlier answers below the current one, newest first. Each is a closed
 *  line with its number and the first words of its question; a click opens
 *  it, another closes it. The list is the interview history the model gets
 *  with every new question, with the same numbers and order. */

import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useState } from "react";
import { AnswerBody, parseLiveAnswer } from "@/components/AnswerBody";
import { AnswerSources } from "@/components/AnswerSources";
import { CopyButton, formatClock } from "@/components/AnswerHeader";
import type { PastAnswer } from "@/components/AssistantSessionProvider";
import { cn } from "@/lib/utils";

interface AnswerHistoryProps {
  answers: PastAnswer[];
  /** Markdown classes of the surface (full vs compact). */
  proseClassName: string;
  /** Answer text size in px (the user's choice). */
  fontPx?: number;
  compact?: boolean;
}

/** The closed line's text: the question's first words, or what it is. */
function summaryLine(a: PastAnswer): string {
  const parsed = parseLiveAnswer(a.text);
  const words = (parsed?.question ?? a.text.replace(/[*#>`[\]]/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  const lead = words.length > 70 ? `${words.slice(0, 70).trimEnd()}…` : words;
  if (a.kind === "review") return `Notes on your answer · ${lead}`;
  return lead;
}

function HistoryItem({
  answer,
  proseClassName,
  fontPx,
  compact,
}: {
  answer: PastAnswer;
  proseClassName: string;
  fontPx?: number;
  compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div
      className={cn(
        "border-t border-border-subtle/40",
        answer.kind === "review" && "border-l-2 border-l-amber-300/50 pl-2",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-1.5 text-left text-[12px] text-text-secondary hover:text-text-primary"
      >
        <Chevron className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        {answer.n ? (
          <span className="shrink-0 font-mono font-semibold text-accent-text">
            {answer.n}
          </span>
        ) : null}
        <span dir="auto" className="min-w-0 flex-1 truncate">
          {summaryLine(answer)}
        </span>
        {answer.updated && (
          <span className="shrink-0 text-[10px] text-text-tertiary">updated</span>
        )}
        {answer.at ? (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-tertiary">
            {formatClock(answer.at)}
          </span>
        ) : null}
      </button>
      {open && (
        <div className={cn("pl-5", compact ? "pb-2" : "pb-4")}>
          <div className="mb-1 flex justify-end">
            <CopyButton text={answer.text} />
          </div>
          <AnswerBody text={answer.text} proseClassName={proseClassName} fontPx={fontPx} />
          <AnswerSources
            citations={answer.citations}
            compact={compact}
            className={compact ? "mt-2" : "not-prose mt-3"}
          />
        </div>
      )}
    </div>
  );
}

export const AnswerHistory = memo(function AnswerHistory({
  answers,
  proseClassName,
  fontPx,
  compact = false,
}: AnswerHistoryProps) {
  if (answers.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col">
      {[...answers].reverse().map((a) => (
        <HistoryItem
          key={a.id}
          answer={a}
          proseClassName={proseClassName}
          fontPx={fontPx}
          compact={compact}
        />
      ))}
    </div>
  );
});
