"use client";

import { memo, useEffect, useRef } from "react";
import { ALargeSmall, BookmarkPlus, RefreshCw } from "lucide-react";
import {
  compactTextSurface,
  overlayPanel,
  overlayTextShadow,
} from "@/components/compact/compactTextStyles";
import { Button } from "@/components/ui/button";
import { AnswerSources } from "@/components/AnswerSources";
import { AnswerHistory } from "@/components/AnswerHistory";
import { AnswerBody } from "@/components/AnswerBody";
import { InterviewFilesSummary } from "@/components/InterviewFilesPicker";
import type {
  AnswerKind,
  PastAnswer,
} from "@/components/AssistantSessionProvider";
import { AnswerHeader } from "@/components/AnswerHeader";
import type { AnswerCitation } from "@/lib/types";
import {
  ANSWER_FONT_PX,
  useAnswerTextSize,
} from "@/lib/answer-display";

const PROSE =
  "prose prose-invert max-w-none text-[15px] leading-7 text-text-primary prose-p:my-2 prose-ul:my-2 prose-li:my-1 prose-strong:text-accent-text";

interface OutputCardProps {
  completion: string;
  citations?: AnswerCitation[];
  /** Earlier answers kept above the current one. */
  pastAnswers?: PastAnswer[];
  /** When the current answer was started, and what it is. */
  answerAt?: number | null;
  answerKind?: AnswerKind;
  /** The current answer's question number. */
  answerNumber?: number | null;
  isGenerating?: boolean;
  onSave: () => void;
  onClear?: () => void;
  /** Update: answer the whole question again in place of this answer. */
  onUpdate?: () => void;
}

export const OutputCard = memo(function OutputCard({
  completion,
  citations = [],
  pastAnswers = [],
  answerAt = null,
  answerKind = "answer",
  answerNumber = null,
  isGenerating = false,
  onSave,
  onClear,
  onUpdate,
}: OutputCardProps) {
  // The newest answer is on top: back to the top when one starts.
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [answerAt]);
  const { size: textSize, cycle: cycleTextSize } = useAnswerTextSize();
  const fontPx = ANSWER_FONT_PX.full[textSize];
  const isEmpty =
    !completion && pastAnswers.length === 0 && !isGenerating;

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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-text-tertiary"
          onClick={cycleTextSize}
          title={`Answer text size: ${textSize} (click to change)`}
        >
          <ALargeSmall className="h-4 w-4" />
        </Button>
        {onUpdate && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-[11px] text-text-secondary"
            onClick={onUpdate}
            title="Answer the whole question again, with what was said since — replaces the current answer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Update
          </Button>
        )}
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
              Start listening — the language is found on its own (Arabic,
              English, German, also mixed), or pick one. In Auto mode
              each question is answered as soon as the speaker finishes; in
              Manual mode press Answer.
            </p>
            <InterviewFilesSummary className="mt-2" />
          </div>
        ) : (
          <div className={`${compactTextSurface} ${overlayTextShadow}`}>
            {completion ? (
              <div
                key={answerAt ?? "answer"}
                dir="auto"
                className={
                  answerKind === "review"
                    ? "animate-answer-in border-l-2 border-l-amber-300/50 pl-2"
                    : "animate-answer-in"
                }
              >
                <AnswerHeader
                  kind={answerKind}
                  at={answerAt}
                  n={answerNumber}
                  live={isGenerating}
                  text={completion}
                />
                <AnswerBody text={completion} proseClassName={PROSE} fontPx={fontPx} />
                <AnswerSources citations={citations} className="not-prose mt-4" />
              </div>
            ) : null}
            {isGenerating && !completion && (
              <p className="inline-flex items-center gap-2 text-sm text-text-secondary">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                Writing the answer…
              </p>
            )}
            <AnswerHistory
              answers={pastAnswers}
              proseClassName={PROSE}
              fontPx={fontPx}
            />
          </div>
        )}
      </div>
      </div>
    </div>
  );
});
