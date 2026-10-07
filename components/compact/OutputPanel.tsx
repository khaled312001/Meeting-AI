"use client";

/** The answer panel rendered beneath the toolbar.
 *
 *  Pure presentational. Renders one of:
 *    - the multi-turn chat thread (with an inline, dismissable error row)
 *    - a single-shot error message
 *    - the rendered markdown for a transcript-driven completion
 *    - a "generating…" indicator with the appropriate copy
 *
 *  The outer wrapper is `data-clickable` with a minimum height so
 *  generated answers stay visible and interactive in the Electron overlay. */

import { X } from "lucide-react";
import SafeMarkdown from "@/components/SafeMarkdown";
import { ChatThread } from "@/components/ui/ChatThread";
import type { ChatMessage } from "@/hooks/useAskChat";
import {
  overlayTextShadow,
  compactTextSurface,
  overlayErrorBlock,
} from "@/components/compact/compactTextStyles";
import { FLAGS, type AnswerCitation } from "@/lib/types";
import { AnswerSources } from "@/components/AnswerSources";
import { AnswerHistory } from "@/components/AnswerHistory";
import type { PastAnswer } from "@/components/AssistantSessionProvider";
import { useStickToBottom } from "@/hooks/useStickToBottom";

const COMPACT_PROSE =
  "prose prose-invert prose-sm max-w-none break-words text-sm prose-strong:text-accent-text prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-pre:my-2 prose-pre:rounded-md prose-headings:my-2 prose-headings:font-semibold prose-code:text-accent-text prose-code:before:content-none prose-code:after:content-none prose-a:text-accent-text";

export type CompactOutputMode = "transcript" | "chat";

interface OutputPanelProps {
  outputMode: CompactOutputMode;
  chatMessages: ChatMessage[];
  chatError: string | null;
  chatIsStreaming: boolean;
  completion: string;
  /** Knowledge-file passages cited by `completion`. */
  citations?: AnswerCitation[];
  /** Earlier answers kept above the current one. */
  pastAnswers?: PastAnswer[];
  isGenerating?: boolean;
  error: string | null;
  activeFlag: FLAGS | null;
  /**
   * Clear the surface-level capture/error state. Used by the dismiss
   * button on the inline error row so the user can banish a stale
   * "Something went wrong" without losing the chat thread underneath.
   * Optional — call sites that don't expose error state can omit it.
   */
  onDismissError?: () => void;
  /** Shown above user bubbles in compact Ask AI thread. */
  chatUserLabel?: string;
}

export function OutputPanel({
  outputMode,
  chatMessages,
  chatError,
  chatIsStreaming,
  completion,
  citations = [],
  pastAnswers = [],
  isGenerating = true,
  error,
  activeFlag,
  onDismissError,
  chatUserLabel,
}: OutputPanelProps) {
  // Follow new answers, unless the user scrolled up to read an older one.
  const { ref, showLatest, handleScroll, scrollToLatest } = useStickToBottom(
    `${pastAnswers.length}:${completion.length}:${chatMessages.length}`,
  );

  return (
    <div className="relative flex min-h-[96px] flex-1 flex-col">
    <div
      ref={ref}
      onScroll={handleScroll}
      data-clickable
      className="custom-scrollbar min-h-0 flex-1 overflow-y-auto border-t border-border-subtle/40 px-3 py-2"
    >
      {outputMode === "chat" ? (
        <div data-clickable className="flex flex-col gap-2">
          {(chatError || error) && (
            <div
              role="alert"
              className={`flex items-start justify-between gap-2 px-2 py-1.5 text-[11px] text-red-300 ${overlayErrorBlock}`}
            >
              <span className="flex-1 min-w-0 break-words">
                {chatError ?? error}
              </span>
              {onDismissError && (
                <button
                  type="button"
                  onClick={onDismissError}
                  aria-label="Dismiss error"
                  title="Dismiss error"
                  className="shrink-0 -mr-0.5 p-0.5 rounded text-red-300/80 hover:text-red-100 hover:bg-red-500/15 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          {chatMessages.length > 0 ? (
            <ChatThread
              messages={chatMessages}
              density="compact"
              userLabel={chatUserLabel}
            />
          ) : chatIsStreaming ? (
            <div
              className={`inline-flex items-center gap-2 text-xs text-text-primary ${compactTextSurface} ${overlayTextShadow}`}
            >
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              Generating answer…
            </div>
          ) : null}
        </div>
      ) : (
      <>
      {pastAnswers.length > 0 && (
        <AnswerHistory
          answers={pastAnswers}
          proseClassName={COMPACT_PROSE}
          compact
        />
      )}
      {error ? (
        <div
          data-clickable
          role="alert"
          className={`flex items-start justify-between gap-2 px-2 py-1.5 text-[11px] text-red-300 ${overlayErrorBlock}`}
        >
          <span className="flex-1 min-w-0 break-words">{error}</span>
          {onDismissError && (
            <button
              type="button"
              onClick={onDismissError}
              aria-label="Dismiss error"
              title="Dismiss error"
              className="shrink-0 -mr-0.5 p-0.5 rounded text-red-300/80 hover:text-red-100 hover:bg-red-500/15 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ) : completion ? (
        <div
          data-clickable
          dir="auto"
          className={`rounded-lg px-2.5 py-1.5 text-sm leading-relaxed text-text-primary ${compactTextSurface} ${overlayTextShadow}`}
        >
          <div className={COMPACT_PROSE}>
            <SafeMarkdown>{completion}</SafeMarkdown>
          </div>
          <AnswerSources citations={citations} compact className="mt-2" />
        </div>
      ) : isGenerating ? (
        <div
          data-clickable
          className={`inline-flex items-center gap-2 text-xs text-text-primary ${compactTextSurface} ${overlayTextShadow}`}
        >
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          {activeFlag === FLAGS.SUMMARIZER
            ? "Generating summary…"
            : "Generating answer…"}
        </div>
      ) : null}
      </>
      )}
    </div>
    {showLatest && (
      <button
        type="button"
        data-clickable
        onClick={scrollToLatest}
        className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-border-subtle bg-surface-raised px-3 py-1 text-[10px] font-medium text-text-secondary shadow-sm hover:text-text-primary"
      >
        Latest ↓
      </button>
    )}
    </div>
  );
}
