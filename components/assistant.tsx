"use client";

import { sendGTMEvent } from "@next/third-parties/google";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ContextCard } from "@/components/assistant/ContextCard";
import { OutputCard } from "@/components/assistant/OutputCard";
import { TranscriptionCard } from "@/components/assistant/TranscriptionCard";
import { AlertBanner } from "@/components/shell/AlertBanner";
import { useTranscription } from "@/components/TranscriptionContext";
import { useClientReady } from "@/hooks/useClientReady";
import { useAssistantSubmit } from "@/hooks/useAssistantSubmit";
import { useAutoAnswer } from "@/hooks/useAutoAnswer";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { useInterviewContext } from "@/components/InterviewContextProvider";
import { useAssistantSession } from "@/components/AssistantSessionProvider";
import { useTab } from "@/components/TabContext";
import { authClient } from "@/lib/auth-client";
import { buildContextBlock } from "@/lib/prompt-context";
import { trackEvent } from "@/lib/session-tracking";
import { FLAGS, type HistoryData } from "@/lib/types";

interface AssistantProps {
  addInSavedData: (data: HistoryData) => void;
  isActive?: boolean;
}

export function Assistant({ addInSavedData, isActive = false }: AssistantProps) {
  const isClientReady = useClientReady();
  const { data: session } = authClient.useSession();
  const { compactMode } = useTab();
  const {
    interviewNotes,
    resumeText,
    resumeFileName,
    jobDescription,
    setInterviewNotes,
    setJobDescription,
    setResumeParsed,
    clearResume,
    isLoading: contextLoading,
    isSaving,
    error: contextError,
  } = useInterviewContext();

  const {
    transcriptionSegments,
    clearTranscription,
    getTranscribedText,
    hasRestoredTranscript,
    transcribedText,
    sessionState,
  } = useTranscription();
  const { flag, citations, pastAnswers, clearAnswers } = useAssistantSession();
  const {
    ref: transcriptionBoxRef,
    showLatest,
    handleScroll: handleTranscriptScroll,
    scrollToLatest,
  } = useStickToBottom(transcriptionSegments);

  const effectiveBg = useMemo(
    () =>
      buildContextBlock({
        existingBg: interviewNotes,
        resumeText,
        jobDescription,
      }),
    [interviewNotes, resumeText, jobDescription],
  );

  const {
    completion,
    isLoading,
    error,
    submit,
    generateNow,
    summarizeNow,
    stop,
    regenerate,
    canRegenerate,
  } = useAssistantSubmit({
    flag,
    bg: effectiveBg,
    getTranscribedText,
  });

  useAutoAnswer({
    enabled: isActive,
    isLive: sessionState === "live",
    isBusy: isLoading,
    transcript: transcribedText,
    onTrigger: () => void generateNow(),
  });

  const formRef = useRef<HTMLFormElement>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTypingInInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      switch (event.key.toLowerCase()) {
        case "enter":
          if (!isTypingInInput) {
            event.preventDefault();
            formRef.current?.dispatchEvent(
              new Event("submit", { cancelable: true, bubbles: true }),
            );
          }
          break;
        case "s":
          if (!isTypingInInput) {
            event.preventDefault();
            void summarizeNow();
          }
          break;
      }
    },
    [summarizeNow],
  );

  useEffect(() => {
    if (!isActive) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown, isActive]);

  const handleSave = () => {
    addInSavedData({
      createdAt: new Date().toISOString(),
      data: completion,
      tag: flag === FLAGS.ASSISTANT ? "Assistant" : "Summarizer",
    });
    sendGTMEvent({
      event: "save_completion",
      tag: flag === FLAGS.ASSISTANT ? "Assistant" : "Summarizer",
    });
    posthog.capture("completion_saved", {
      mode: flag === FLAGS.ASSISTANT ? "assistant" : "summarizer",
      completion_length: completion.length,
    });
    trackEvent("completion_saved", {
      metadata: {
        mode: flag === FLAGS.ASSISTANT ? "assistant" : "summarizer",
        completion_length: completion.length,
      },
    });
  };

  useEffect(() => {
    if (!isActive || compactMode) return;
    if (typeof window !== "undefined" && window.electronAPI && session) {
      window.electronAPI.windowSetSize(1180, 640);
    }
  }, [session, isActive, compactMode]);

  if (!isClientReady) {
    return <AssistantSkeleton />;
  }

  const displayError = error ?? (contextError ? new Error(contextError) : null);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
      {displayError && (
        <AlertBanner
          message={displayError.message}
          className="fixed left-1/2 top-12 z-[60] max-w-md -translate-x-1/2 rounded-md animate-fade-in-scale"
          action={
            canRegenerate && error ? (
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => void regenerate()}
              >
                Retry
              </button>
            ) : undefined
          }
        />
      )}

      <ContextCard
        interviewNotes={interviewNotes}
        onInterviewNotesChange={setInterviewNotes}
        resumeText={resumeText}
        resumeFileName={resumeFileName}
        jobDescription={jobDescription}
        onJobDescriptionChange={setJobDescription}
        onResumeParsed={setResumeParsed}
        onClearResume={clearResume}
        isSaving={isSaving}
        isLoading={contextLoading}
        formRef={formRef}
        isLoadingGenerate={isLoading}
        onSummarize={() => void summarizeNow()}
        onSubmit={submit}
        onStop={stop}
      />

      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-0 overflow-hidden rounded-lg border border-border-subtle/40 bg-transparent md:flex-row">
        <div className="flex min-h-[200px] min-w-0 flex-1 flex-col border-border-subtle/40 md:max-w-[45%] md:border-r">
          <TranscriptionCard
            transcriptionBoxRef={transcriptionBoxRef}
            segments={transcriptionSegments}
            onClear={clearTranscription}
            onScroll={handleTranscriptScroll}
            showLatest={showLatest}
            onJumpToLatest={scrollToLatest}
            hasRestoredTranscript={hasRestoredTranscript}
          />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <OutputCard
            completion={completion}
            citations={citations}
            pastAnswers={pastAnswers}
            onSave={handleSave}
            onClear={clearAnswers}
          />
        </div>
      </div>
    </div>
  );
}

function AssistantSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <div className="surface-panel h-24 animate-skeleton" />
      <div className="mt-3 flex min-h-[320px] gap-0 overflow-hidden rounded-lg border border-border-subtle/40 bg-transparent">
        <div className="min-h-0 flex-1 border-r border-border-subtle/40 p-4">
          <div className="mb-3 h-3 w-32 animate-skeleton rounded" />
          <div className="h-full min-h-[200px] animate-skeleton rounded-md" />
        </div>
        <div className="min-h-0 flex-1 p-4">
          <div className="mb-3 h-3 w-20 animate-skeleton rounded" />
          <div className="h-full min-h-[200px] animate-skeleton rounded-md" />
        </div>
      </div>
    </div>
  );
}
