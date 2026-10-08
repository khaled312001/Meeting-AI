"use client";

/** Focus mode controls: two floating glass pills.
 *
 *  Top pill: move handle, Answer, Screenshot, Chat, meeting settings
 *  (language, Auto / Manual, my mic), back to the full view, a menu, and
 *  Start / End.
 *  Second pill (while listening or once there is a transcript): who is
 *  speaking and the line being heard right now, Clear, and show / hide
 *  the answer. */

import {
  BookmarkPlus,
  Camera,
  ChevronDown,
  ChevronUp,
  Eraser,
  FileText,
  GripVertical,
  Loader2,
  Maximize2,
  MessageSquare,
  Minus,
  MoreVertical,
  Play,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranscription } from "@/components/TranscriptionContext";
import { useAssistantSession } from "@/components/AssistantSessionProvider";
import {
  AnswerModeSwitch,
  LanguageSwitch,
  MicSwitch,
} from "@/components/LiveControls";
import { Kbd } from "@/components/ui/Kbd";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import { cn } from "@/lib/utils";
import { LoadingDots } from "./LoadingDots";

/** Frosted glass shared by the pills and the answer panel. */
export const focusGlass =
  "border border-white/10 bg-[rgba(18,20,26,0.72)] shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl";


function PillButton({
  onClick,
  disabled,
  title,
  active,
  children,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  active?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-35",
        active
          ? "bg-accent/20 text-accent-text"
          : "text-text-primary hover:bg-white/10",
        className,
      )}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-4 w-px shrink-0 bg-white/12" />;

/** Equalizer bars that move while someone is speaking. */
function SpeakingBars({ who }: { who: "them" | "me" | null }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-3.5 items-end gap-[2px]",
        who === "me" ? "text-emerald-300" : "text-sky-300",
      )}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-full bg-current",
            who ? "animate-focus-eq" : "opacity-30",
          )}
          style={{
            height: who ? undefined : "30%",
            animationDelay: `${i * 110}ms`,
          }}
        />
      ))}
    </span>
  );
}

interface FocusBarProps {
  isElectron: boolean;
  isLoading: boolean;
  isCapturing: boolean;
  askMode: boolean;
  showContext: boolean;
  menuOpen: boolean;
  hasContextAttached: boolean;
  hasOutput: boolean;
  outputCollapsed: boolean;
  completion: string;
  onAnswer: () => void;
  onStop: () => void;
  onScreenshot: () => void;
  onToggleChat: () => void;
  onToggleContext: () => void;
  onToggleMenu: (open: boolean) => void;
  onToggleOutputCollapsed: () => void;
  onSummarize: () => void;
  onSave: () => void;
  onClearTranscription: () => void;
  onClearAll: () => void;
  onExitFocus?: () => void;
}

export function FocusBar({
  isElectron,
  isLoading,
  isCapturing,
  askMode,
  showContext,
  menuOpen,
  hasContextAttached,
  hasOutput,
  outputCollapsed,
  completion,
  onAnswer,
  onStop,
  onScreenshot,
  onToggleChat,
  onToggleContext,
  onToggleMenu,
  onToggleOutputCollapsed,
  onSummarize,
  onSave,
  onClearTranscription,
  onClearAll,
  onExitFocus,
}: FocusBarProps) {
  const {
    sessionState,
    isActive,
    isBusy,
    isReconnecting,
    isClientReady,
    startSession,
    stopSession,
    errorMessage,
    transcriptionSegments,
    transcribedText,
    interviewerSpeaking,
    meSpeaking,
  } = useTranscription();
  const { answerMode } = useAssistantSession();
  // Grab any empty part of either pill to move the window.
  const { onPointerDown: startDrag } = useWindowDrag();

  const live = sessionState === "live";
  const latest = transcriptionSegments[transcriptionSegments.length - 1];
  const speaking: "them" | "me" | null = interviewerSpeaking
    ? "them"
    : meSpeaking
      ? "me"
      : null;
  const showStatusRow = isActive || transcribedText.trim().length > 0;

  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onToggleMenu(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menuOpen, onToggleMenu]);

  const menuItem = (
    icon: ReactNode,
    label: string,
    action: () => void,
    opts: { disabled?: boolean; danger?: boolean } = {},
  ) => (
    <button
      type="button"
      role="menuitem"
      disabled={opts.disabled}
      onClick={() => {
        onToggleMenu(false);
        action();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors disabled:opacity-35",
        opts.danger
          ? "text-red-300 hover:bg-red-500/15"
          : "text-text-primary hover:bg-white/10",
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex flex-col items-center gap-1.5 px-2 pt-2">
      {/* ── Top pill ─────────────────────────────────────────────── */}
      <div
        data-clickable
        data-window-chrome
        onPointerDown={isElectron ? startDrag : undefined}
        className={cn(
          // Above the panels below so the ⋮ menu drops over them; wraps
          // into two lines on narrow (phone) screens.
          "relative z-30 flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-[22px] p-1",
          isElectron && "cursor-grab active:cursor-grabbing",
          focusGlass,
        )}
      >
        {isElectron && (
          <span
            title="Drag to move (or Ctrl+Alt+arrow keys)"
            className="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-white/10"
          >
            <GripVertical className="h-4 w-4" />
          </span>
        )}

        <div className="flex min-w-0 flex-wrap items-center justify-center gap-0.5">
          {isLoading ? (
            <PillButton onClick={onStop} title="Stop this answer" active>
              <LoadingDots color="bg-sky-300" />
              Stop
            </PillButton>
          ) : (
            <PillButton
              onClick={onAnswer}
              title={
                answerMode === "auto"
                  ? "Answer now — questions are also answered on their own (Ctrl+Alt+Enter from any app)"
                  : "Answer the latest question (Ctrl+Alt+Enter from any app)"
              }
              className="bg-accent/15 text-accent-text hover:bg-accent/25"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent-text" />
              Answer
              <Kbd
                keys={["Mod", "Enter"]}
                size="xs"
                className="hidden opacity-70 sm:inline-flex"
              />
            </PillButton>
          )}

          {isElectron && (
            <PillButton
              onClick={onScreenshot}
              disabled={isCapturing}
              title="Answer what is on screen"
            >
              {isCapturing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
              <span className="hidden md:inline">Screenshot</span>
              <Kbd
                keys={["Mod", "Shift", "Enter"]}
                size="xs"
                className="hidden opacity-70 lg:inline-flex"
              />
            </PillButton>
          )}

          <PillButton onClick={onToggleChat} title="Ask AI chat" active={askMode}>
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Chat</span>
            <Kbd keys={["Alt", "A"]} size="xs" className="hidden opacity-70 lg:inline-flex" />
          </PillButton>

          <Divider />
          <LanguageSwitch variant="glass" />
          <AnswerModeSwitch variant="glass" />
          <MicSwitch variant="glass" />
          <Divider />

          {onExitFocus && (
            <PillButton
              onClick={onExitFocus}
              title="Back to the full view"
              className="w-7 justify-center px-0"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </PillButton>
          )}

          <div ref={menuRef} className="relative">
            <PillButton
              onClick={() => onToggleMenu(!menuOpen)}
              title="More"
              active={menuOpen || showContext}
              className="relative w-7 justify-center px-0"
            >
              <MoreVertical className="h-3.5 w-3.5" />
              {hasContextAttached && (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-info" />
              )}
            </PillButton>
            {menuOpen && (
              <div
                role="menu"
                data-clickable
                className={cn(
                  "absolute right-0 top-9 z-50 w-52 rounded-xl p-1",
                  focusGlass,
                )}
              >
                {menuItem(
                  <Settings2 className="h-3.5 w-3.5" />,
                  showContext ? "Hide notes & context" : "Notes & context",
                  onToggleContext,
                )}
                {menuItem(
                  <FileText className="h-3.5 w-3.5" />,
                  "Summarize the meeting",
                  onSummarize,
                  { disabled: isLoading || !transcribedText.trim() },
                )}
                {menuItem(
                  <BookmarkPlus className="h-3.5 w-3.5" />,
                  "Save answer to notes",
                  onSave,
                  { disabled: !completion.trim() },
                )}
                {menuItem(
                  <Trash2 className="h-3.5 w-3.5" />,
                  "Clear everything",
                  onClearAll,
                  { danger: true },
                )}
                {isElectron && (
                  <>
                    <div className="my-1 h-px bg-white/10" />
                    {menuItem(
                      <Minus className="h-3.5 w-3.5" />,
                      "Minimize",
                      () => void window.electronAPI?.windowMinimize(),
                    )}
                    {menuItem(
                      <X className="h-3.5 w-3.5" />,
                      "Close",
                      () => void window.electronAPI?.windowClose(),
                      { danger: true },
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={isActive ? stopSession : () => void startSession()}
            disabled={!isClientReady}
            title={
              errorMessage ??
              (isReconnecting
                ? "Reconnecting… click to end"
                : isActive
                  ? "Stop listening"
                  : "Start listening")
            }
            className={cn(
              "ml-0.5 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors",
              isActive
                ? "bg-red-500 text-white hover:bg-red-400"
                : "bg-emerald-500 text-white hover:bg-emerald-400",
            )}
          >
            {isBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isActive ? (
              <Square className="h-3 w-3 fill-current" />
            ) : (
              <Play className="h-3 w-3 fill-current" />
            )}
            {isActive ? (isBusy && !live ? "Starting" : "End") : "Start"}
          </button>
          {isElectron && (
            <button
              type="button"
              onClick={() => void window.electronAPI?.windowClose()}
              title="Close Meeting AI"
              aria-label="Close Meeting AI"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-red-500/80 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Status pill ──────────────────────────────────────────── */}
      {showStatusRow && (
        <div
          data-clickable
          onPointerDown={isElectron ? startDrag : undefined}
          className={cn(
            "flex w-full max-w-[680px] items-center gap-2 rounded-full py-1 pl-3 pr-1",
            isElectron && "cursor-grab active:cursor-grabbing",
            focusGlass,
          )}
        >
          <SpeakingBars who={live ? speaking : null} />
          <span
            className={cn(
              "shrink-0 text-[10px] font-semibold uppercase tracking-wide",
              latest?.source === "me" ? "text-emerald-300" : "text-sky-300",
            )}
          >
            {!live
              ? isActive
                ? isReconnecting
                  ? "Reconnecting"
                  : "Starting"
                : "Paused"
              : latest
                ? latest.source === "me"
                  ? "Me"
                  : "Interviewer"
                : "Listening"}
          </span>
          <span
            dir="auto"
            className={cn(
              "min-w-0 flex-1 truncate text-[12px]",
              latest && !latest.isFinal
                ? "italic text-text-secondary"
                : "text-text-primary",
            )}
            title={latest?.text}
          >
            {latest?.text ?? "Waiting for the first words…"}
          </span>
          <PillButton
            onClick={onClearTranscription}
            disabled={!transcribedText.trim()}
            title="Clear the transcript"
            className="border border-white/15 bg-white/[0.06] text-text-primary hover:border-white/25 hover:bg-white/15"
          >
            <Eraser className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Clear text</span>
            <Kbd
              keys={["Mod", "Shift", "⌫"]}
              size="xs"
              className="hidden opacity-70 md:inline-flex"
            />
          </PillButton>
          {hasOutput && (
            <PillButton
              onClick={onToggleOutputCollapsed}
              title={outputCollapsed ? "Show the answer" : "Hide the answer"}
              className="w-7 justify-center px-0 text-text-secondary"
            >
              {outputCollapsed ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </PillButton>
          )}
        </div>
      )}
    </div>
  );
}
