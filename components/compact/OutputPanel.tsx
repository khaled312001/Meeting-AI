"use client";

/** Focus mode answer panel: a frosted panel under the bar.
 *
 *  Header: what is shown (Answer / Notes on your answer / Chat) with the
 *  time it was written, feedback, copy, Clear and expand. Body: earlier
 *  answers above the current one (auto-scrolls to the newest; scroll up to
 *  read older ones), or the Ask AI chat thread. The bottom edge, right edge
 *  and corner can be dragged to size it. */

import {
  Maximize2,
  Minimize2,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import posthog from "posthog-js";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import SafeMarkdown from "@/components/SafeMarkdown";
import { ChatThread } from "@/components/ui/ChatThread";
import type { ChatMessage } from "@/hooks/useAskChat";
import { overlayErrorBlock } from "@/components/compact/compactTextStyles";
import { FLAGS, type AnswerCitation } from "@/lib/types";
import { AnswerSources } from "@/components/AnswerSources";
import { AnswerHistory } from "@/components/AnswerHistory";
import { CopyButton, formatClock } from "@/components/AnswerHeader";
import type {
  AnswerKind,
  PastAnswer,
} from "@/components/AssistantSessionProvider";
import type { AnswerPanelSize } from "@/hooks/useAnswerPanelSize";
import { COMPACT_WINDOW_WIDTH } from "@/hooks/useCompactWindowSize";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { cn } from "@/lib/utils";
import { focusGlass } from "./FocusBar";

const COMPACT_PROSE =
  "prose prose-invert max-w-none break-words text-[14.5px] leading-relaxed text-text-primary prose-strong:text-accent-text prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-pre:rounded-md prose-headings:my-2 prose-headings:font-semibold prose-code:text-accent-text prose-code:before:content-none prose-code:after:content-none prose-a:text-accent-text";

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
  /** When the current answer was started, and what it is. */
  answerAt?: number | null;
  answerKind?: AnswerKind;
  isGenerating?: boolean;
  error: string | null;
  activeFlag: FLAGS | null;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onClear?: () => void;
  /**
   * Clear the surface-level capture/error state. Used by the dismiss
   * button on the inline error row so the user can banish a stale
   * "Something went wrong" without losing the chat thread underneath.
   */
  onDismissError?: () => void;
  /** Shown above user bubbles in compact Ask AI thread. */
  chatUserLabel?: string;
  /** The size the user dragged the panel to; the window follows it. */
  size?: AnswerPanelSize;
  onResize?: (size: AnswerPanelSize) => void;
  /** The drag ended (remember the size). */
  onResizeEnd?: (size: AnswerPanelSize) => void;
}

/** Panel width that puts its right edge at window x `right`. The panel is
 *  centered, 8px in from each side, in a window at least
 *  COMPACT_WINDOW_WIDTH wide that grows to the right. */
function widthForRightEdge(right: number): number {
  const centered = 2 * (right - COMPACT_WINDOW_WIDTH / 2);
  return centered + 16 <= COMPACT_WINDOW_WIDTH ? centered : right - 8;
}

type ResizeEdge = "bottom" | "right" | "corner";

function ErrorRow({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="alert"
      className={`flex items-start justify-between gap-2 px-2 py-1.5 text-[12px] text-red-300 ${overlayErrorBlock}`}
    >
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          title="Dismiss error"
          className="-mr-0.5 shrink-0 rounded p-0.5 text-red-300/80 transition-colors hover:bg-red-500/15 hover:text-red-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

const iconButton =
  "inline-flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-white/10 hover:text-text-primary";

export function OutputPanel({
  outputMode,
  chatMessages,
  chatError,
  chatIsStreaming,
  completion,
  citations = [],
  pastAnswers = [],
  answerAt = null,
  answerKind = "answer",
  isGenerating = false,
  error,
  activeFlag,
  expanded = false,
  onToggleExpanded,
  onClear,
  onDismissError,
  chatUserLabel,
  size,
  onResize,
  onResizeEnd,
}: OutputPanelProps) {
  // Follow new answers, unless the user scrolled up to read an older one.
  const { ref, showLatest, handleScroll, scrollToLatest } = useStickToBottom(
    `${pastAnswers.length}:${completion.length}:${chatMessages.length}`,
  );

  // Feedback belongs to the answer it was given on.
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  useEffect(() => setVote(null), [answerAt]);
  const sendVote = (value: "up" | "down") => {
    setVote(value);
    posthog.capture("answer_feedback", { value, kind: answerKind });
  };

  const panelRef = useRef<HTMLDivElement>(null);
  const startResize = (e: ReactPointerEvent<HTMLDivElement>, edge: ResizeEdge) => {
    if (!size || !onResize || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    // Keep the grip where it was grabbed, not jumped to the cursor.
    const fromRight = (panelRef.current?.getBoundingClientRect().right ?? e.clientX) - e.clientX;
    const startY = e.clientY;
    const start = size;
    let latest = start;
    let frame = 0;
    const move = (ev: PointerEvent) => {
      latest = {
        width: edge === "bottom" ? start.width : widthForRightEdge(ev.clientX + fromRight),
        height: edge === "right" ? start.height : start.height + ev.clientY - startY,
      };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => onResize(latest));
    };
    const end = () => {
      cancelAnimationFrame(frame);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      onResize(latest);
      onResizeEnd?.(latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  const resizable = !!size && !!onResize;

  const isChat = outputMode === "chat";
  const title = isChat
    ? "Chat"
    : activeFlag === FLAGS.SUMMARIZER
      ? "Summary"
      : answerKind === "review"
        ? "Notes on your answer"
        : "Answer";
  const lastChat = chatMessages[chatMessages.length - 1];
  const copyText = isChat
    ? lastChat?.role === "assistant"
      ? lastChat.text
      : ""
    : completion;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 pt-1.5">
      <div
        ref={panelRef}
        data-clickable
        style={size ? { width: size.width } : undefined}
        className={cn(
          "relative mx-auto flex min-h-[96px] w-full flex-1 flex-col overflow-hidden rounded-2xl animate-panel-in",
          size ? "max-w-full" : "max-w-[860px]",
          focusGlass,
        )}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.07] px-3.5 py-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[12px] font-semibold",
              answerKind === "review" && !isChat
                ? "text-amber-300"
                : "text-text-primary",
            )}
          >
            {(isGenerating || chatIsStreaming) && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            )}
            {title}
          </span>
          {!isChat && answerAt && (
            <span className="font-mono text-[11px] tabular-nums text-text-tertiary">
              {formatClock(answerAt)}
            </span>
          )}
          {!isChat && completion && (
            <span className="ml-1 flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => sendVote("up")}
                title="Good answer"
                aria-pressed={vote === "up"}
                className={cn(iconButton, vote === "up" && "text-emerald-300")}
              >
                <ThumbsUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => sendVote("down")}
                title="Bad answer"
                aria-pressed={vote === "down"}
                className={cn(iconButton, vote === "down" && "text-red-300")}
              >
                <ThumbsDown className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          <span className="ml-auto flex items-center gap-0.5">
            <CopyButton text={copyText} />
            {onClear && (
              <button
                type="button"
                onClick={onClear}
                title="Clear the answers (Ctrl+Alt+Backspace from any app)"
                className="ml-1 inline-flex h-7 items-center gap-1.5 rounded-full border border-red-400/35 bg-red-500/10 px-3 text-[12px] font-semibold text-red-200 transition-colors hover:border-red-400/60 hover:bg-red-500/25"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear answer
              </button>
            )}
            {onToggleExpanded && (
              <button
                type="button"
                onClick={onToggleExpanded}
                title={expanded ? "Smaller panel" : "Larger panel"}
                className={iconButton}
              >
                {expanded ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </span>
        </div>

        <div
          ref={ref}
          onScroll={handleScroll}
          className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3"
        >
          {isChat ? (
            <div className="flex flex-col gap-2">
              {(chatError || error) && (
                <ErrorRow message={chatError ?? error ?? ""} onDismiss={onDismissError} />
              )}
              {chatMessages.length > 0 ? (
                <ChatThread
                  messages={chatMessages}
                  density="compact"
                  userLabel={chatUserLabel}
                />
              ) : chatIsStreaming ? (
                <p className="text-[13px] text-text-secondary">Writing the answer…</p>
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
                <ErrorRow message={error} onDismiss={onDismissError} />
              ) : completion ? (
                <div
                  key={answerAt ?? "answer"}
                  dir="auto"
                  className={cn(
                    "animate-answer-in",
                    answerKind === "review" &&
                      "border-l-2 border-l-amber-300/50 pl-2",
                  )}
                >
                  <div className={COMPACT_PROSE}>
                    <SafeMarkdown>{completion}</SafeMarkdown>
                  </div>
                  <AnswerSources citations={citations} compact className="mt-2" />
                </div>
              ) : isGenerating ? (
                <p className="inline-flex items-center gap-2 text-[13px] text-text-secondary">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                  {activeFlag === FLAGS.SUMMARIZER
                    ? "Writing the summary…"
                    : "Writing the answer…"}
                </p>
              ) : null}
            </>
          )}
        </div>

        {showLatest && (
          <button
            type="button"
            onClick={scrollToLatest}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-3 py-1 text-[11px] font-medium text-text-secondary shadow-sm backdrop-blur hover:text-text-primary"
          >
            Latest ↓
          </button>
        )}

        {resizable && (
          <>
            <div
              aria-hidden
              title="Drag to resize"
              onPointerDown={(e) => startResize(e, "bottom")}
              className="absolute inset-x-6 bottom-0 h-2 cursor-ns-resize"
            />
            <div
              aria-hidden
              title="Drag to resize"
              onPointerDown={(e) => startResize(e, "right")}
              className="absolute inset-y-6 right-0 w-2 cursor-ew-resize"
            />
            <div
              aria-hidden
              title="Drag to resize"
              onPointerDown={(e) => startResize(e, "corner")}
              className="group absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-1"
            >
              <svg
                viewBox="0 0 10 10"
                className="h-2.5 w-2.5 text-text-tertiary transition-colors group-hover:text-text-primary"
              >
                <path
                  d="M9 3 3 9M9 6.5 6.5 9"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
