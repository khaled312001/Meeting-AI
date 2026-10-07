"use client";

import { memo } from "react";
import { BookmarkPlus } from "lucide-react";
import SafeMarkdown from "@/components/SafeMarkdown";
import {
  compactTextSurface,
  overlayPanel,
  overlayTextShadow,
} from "@/components/compact/compactTextStyles";
import { Button } from "@/components/ui/button";
import { AnswerSources } from "@/components/AnswerSources";
import { AnswerHistory } from "@/components/AnswerHistory";
import type { PastAnswer } from "@/components/AssistantSessionProvider";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import type { AnswerCitation } from "@/lib/types";

const PROSE =
  "prose prose-invert max-w-none text-[15px] leading-7 text-text-primary prose-p:my-2 prose-ul:my-2 prose-li:my-1 prose-strong:text-accent-text";

interface OutputCardProps {
  completion: string;
  citations?: AnswerCitation[];
  /** Earlier answers kept above the current one. */
  pastAnswers?: PastAnswer[];
  onSave: () => void;
  onClear?: () => void;
}

export const OutputCard = memo(function OutputCard({
  completion,
  citations = [],
  pastAnswers = [],
  onSave,
  onClear,
}: OutputCardProps) {
  // Follow new answers, unless the user scrolled up to read an older one.
  const { ref, showLatest, handleScroll, scrollToLatest } = useStickToBottom(
    `${pastAnswers.length}:${completion.length}`,
  );
  const isEmpty = !completion && pastAnswers.length === 0;

  return (
    <div
      className={`flex h-full min-h-0 flex-1 flex-col overflow-hidden ${overlayPanel}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle/40 px-4 py-2">
        <span
          className={`min-w-0 truncate pr-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary ${overlayTextShadow}`}
        >
          Output
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
        {onClear && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isEmpty}
            className="h-8 text-[11px] text-text-tertiary"
            onClick={onClear}
          >
            Clear
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!completion.trim()}
          className="h-8 shrink-0 gap-1.5 text-[11px]"
          onClick={onSave}
        >
          <BookmarkPlus className="h-3.5 w-3.5 shrink-0" />
          Save note
        </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        onScroll={handleScroll}
        className="custom-scrollbar h-full overflow-y-auto px-4 py-4 sm:px-5 sm:py-5"
      >
        {isEmpty ? (
          <div
            className={`flex h-full min-h-[80px] flex-col items-start justify-center px-1 ${overlayTextShadow}`}
          >
            <p className="text-sm font-medium text-text-secondary">
              Ready when you are
            </p>
            <p className="mt-1 text-xs text-text-tertiary">
              Start listening — answers appear on their own when the speaker
              pauses.
            </p>
          </div>
        ) : (
          <div className={`${compactTextSurface} ${overlayTextShadow}`}>
            <AnswerHistory answers={pastAnswers} proseClassName={PROSE} />
            {completion && (
              <div dir="auto" className={PROSE}>
                <SafeMarkdown>{completion}</SafeMarkdown>
                <AnswerSources citations={citations} className="not-prose mt-4" />
              </div>
            )}
          </div>
        )}
      </div>
      {showLatest && (
        <button
          type="button"
          onClick={scrollToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 animate-fade-in-scale rounded-full border border-border-subtle bg-surface-raised px-3 py-1 text-[10px] font-medium text-text-secondary shadow-sm transition-colors hover:text-text-primary"
        >
          Latest ↓
        </button>
      )}
      </div>
    </div>
  );
});
