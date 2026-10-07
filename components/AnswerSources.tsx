"use client";

/** "Sources" strip under an answer: which knowledge files Anthropic used,
 *  with the quoted passages one click away. */

import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { groupCitations } from "@/lib/citations";
import type { AnswerCitation } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AnswerSourcesProps {
  citations: AnswerCitation[];
  /** Tighter type scale for the compact overlay. */
  compact?: boolean;
  className?: string;
}

export function AnswerSources({
  citations,
  compact = false,
  className,
}: AnswerSourcesProps) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = groupCitations(citations);
  if (groups.length === 0) return null;

  return (
    <div data-clickable className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "font-semibold uppercase tracking-wider text-text-tertiary",
            compact ? "text-[9px]" : "text-[10px]",
          )}
        >
          Sources
        </span>
        {groups.map((g) => {
          const isOpen = open === g.title;
          return (
            <button
              key={g.title}
              type="button"
              onClick={() => setOpen(isOpen ? null : g.title)}
              aria-expanded={isOpen}
              title={`Show what was used from ${g.title}`}
              className={cn(
                "inline-flex max-w-[220px] items-center gap-1 rounded-full border px-2 py-0.5 transition-colors",
                compact ? "text-[10px]" : "text-[11px]",
                isOpen
                  ? "border-accent/40 bg-accent-muted text-accent-text"
                  : "border-border-subtle bg-black/20 text-text-secondary hover:text-text-primary",
              )}
            >
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{g.title}</span>
              <span className="shrink-0 text-text-tertiary">
                {g.passages.length}
              </span>
              <ChevronDown
                className={cn(
                  "h-3 w-3 shrink-0 transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </button>
          );
        })}
      </div>
      {groups
        .filter((g) => g.title === open)
        .map((g) => (
          <ul
            key={g.title}
            className="space-y-1 rounded-md border border-border-subtle bg-black/25 p-2"
          >
            {g.passages.map((p) => (
              <li
                key={p}
                className={cn(
                  "border-l-2 border-accent/50 pl-2 leading-relaxed text-text-secondary",
                  compact ? "text-[10px]" : "text-xs",
                )}
              >
                {p.length > 400 ? `${p.slice(0, 400)}…` : p}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
