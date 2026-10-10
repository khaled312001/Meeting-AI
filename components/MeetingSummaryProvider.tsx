"use client";

/** End-of-meeting summary: when listening stops after a real conversation,
 *  the summary is written and saved on its own — a PDF in Downloads on
 *  desktop, an .html download in the browser — with the answers suggested
 *  during the meeting and the full transcript.
 *
 *  Each meeting (one interview, one job) gets a summary of its own: once a
 *  meeting's summary is saved, the next one starts after it, so nothing from
 *  an earlier interview leaks in. The job description and notes go along so
 *  the summary names the right role.
 *
 *  Runs beside the answer panel (never through it), so an answer that is
 *  still streaming when the meeting ends is not disturbed. The normal view
 *  shows a small card; focus mode shows the status in its bar. */

import { CheckCircle2, FileText, FolderOpen, Loader2, RotateCcw, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAssistantSession } from "@/components/AssistantSessionProvider";
import { useInterviewContext } from "@/components/InterviewContextProvider";
import { useTab } from "@/components/TabContext";
import { buildTranscriptTexts, useTranscription } from "@/components/TranscriptionContext";
import { buildSummaryDocument, summaryFileBaseName } from "@/lib/meeting-summary";
import { buildContextBlock } from "@/lib/prompt-context";
import { streamCompletion } from "@/lib/stream-completion";
import { FLAGS } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Too little was said for a summary to be worth a file. */
const MIN_WORDS = 40;

export type MeetingSummaryStatus =
  | { state: "idle" }
  | { state: "writing" }
  | { state: "saved"; name: string; file: string | null }
  | { state: "error"; message: string };

interface MeetingSummaryContextValue {
  status: MeetingSummaryStatus;
  /** Summarize the transcript now and save it (also used to retry). */
  saveSummary: () => void;
  openSummary: () => void;
  showSummaryInFolder: () => void;
  dismiss: () => void;
}

const MeetingSummaryContext = createContext<MeetingSummaryContextValue | null>(null);

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

function downloadInBrowser(html: string, name: string) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function MeetingSummaryProvider({ children }: { children: ReactNode }) {
  const { sessionState, transcriptionSegments, language } = useTranscription();
  const { pastAnswers, completion, answerKind, answerAt } = useAssistantSession();
  const { interviewNotes, jobDescription } = useInterviewContext();
  const { compactMode } = useTab();
  const [status, setStatus] = useState<MeetingSummaryStatus>({ state: "idle" });

  const answersRef = useRef({ pastAnswers, completion, answerKind, answerAt });
  answersRef.current = { pastAnswers, completion, answerKind, answerAt };
  const segmentsRef = useRef(transcriptionSegments);
  segmentsRef.current = transcriptionSegments;
  const listeningNowRef = useRef(sessionState !== "idle");
  listeningNowRef.current = sessionState !== "idle";
  // The job this meeting is for (the resume stays out: it isn't the meeting).
  const jobContextRef = useRef("");
  jobContextRef.current = buildContextBlock({ existingBg: interviewNotes, jobDescription });
  const languageRef = useRef(language);
  languageRef.current = language;
  const runningRef = useRef<AbortController | null>(null);
  const savedFileRef = useRef<string | null>(null);

  /** Where the current meeting starts: speech after `afterSegmentId`,
   *  answers written from `since` on. */
  const meetingStartRef = useRef<{ afterSegmentId: string | null; since: number }>({
    afterSegmentId: null,
    since: 0,
  });
  // A cleared transcript (and a fresh launch) starts a new meeting.
  const transcriptEmpty = transcriptionSegments.length === 0;
  useEffect(() => {
    if (transcriptEmpty) meetingStartRef.current = { afterSegmentId: null, since: Date.now() };
  }, [transcriptEmpty]);

  const meetingSegments = useCallback(() => {
    const all = segmentsRef.current;
    const { afterSegmentId } = meetingStartRef.current;
    const i = afterSegmentId ? all.findIndex((s) => s.id === afterSegmentId) : -1;
    return i < 0 ? all : all.slice(i + 1);
  }, []);
  const meetingTranscript = useCallback(
    () => buildTranscriptTexts(meetingSegments()).transcribedText,
    [meetingSegments],
  );

  /** The answers suggested during this meeting (reviews of the user's own
   *  replies stay out). */
  const meetingAnswers = useCallback(() => {
    const { since } = meetingStartRef.current;
    const { pastAnswers, completion, answerKind, answerAt } = answersRef.current;
    return [
      ...pastAnswers.filter((a) => a.kind !== "review" && (a.at ?? 0) >= since).map((a) => a.text),
      ...(answerKind !== "review" && completion.trim() && (answerAt ?? 0) >= since ? [completion] : []),
    ].filter((a) => a.trim());
  }, []);

  const saveSummary = useCallback(async () => {
    if (runningRef.current) return;
    const segments = meetingSegments();
    const transcript = buildTranscriptTexts(segments).transcribedText;
    // Saved after listening stopped → this meeting is over; the next
    // summary covers only what comes after it.
    const endsMeeting = !listeningNowRef.current;
    const lastSegmentId = segments.at(-1)?.id ?? null;
    if (wordCount(transcript) < MIN_WORDS) {
      setStatus({ state: "error", message: "Not enough was said for a summary yet." });
      return;
    }
    const controller = new AbortController();
    runningRef.current = controller;
    setStatus({ state: "writing" });
    const lang = languageRef.current;
    const at = new Date();
    try {
      let summary = "";
      await streamCompletion({
        flag: FLAGS.SUMMARIZER,
        bg: jobContextRef.current,
        prompt: transcript,
        lang,
        useKnowledge: false,
        signal: controller.signal,
        onChunk: (text) => {
          summary += text;
        },
      });
      if (!summary.trim()) throw new Error("The summary came back empty.");

      const html = buildSummaryDocument({
        summary,
        transcript,
        answers: meetingAnswers(),
        language: lang,
        startedAt: at,
      });
      const name = summaryFileBaseName(lang, at);
      const api = typeof window !== "undefined" ? window.electronAPI : undefined;
      if (api?.saveSummaryPdf) {
        const file = await api.saveSummaryPdf(html, name);
        savedFileRef.current = file;
        setStatus({ state: "saved", name: file.split(/[\\/]/).pop() ?? name, file });
      } else {
        downloadInBrowser(html, name);
        setStatus({ state: "saved", name: `${name}.html`, file: null });
      }
      if (endsMeeting && lastSegmentId) {
        meetingStartRef.current = { afterSegmentId: lastSegmentId, since: Date.now() };
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Couldn't save the summary.",
      });
    } finally {
      if (runningRef.current === controller) runningRef.current = null;
    }
  }, [meetingSegments, meetingAnswers]);

  // Listening stopped after a real conversation → summarize and save.
  const listeningRef = useRef(false);
  const wordsAtStartRef = useRef(0);
  useEffect(() => {
    const listening = sessionState !== "idle";
    if (listening && !listeningRef.current) {
      wordsAtStartRef.current = wordCount(meetingTranscript());
      setStatus((s) => (s.state === "writing" ? s : { state: "idle" }));
    }
    if (!listening && listeningRef.current) {
      const words = wordCount(meetingTranscript());
      if (words >= MIN_WORDS && words > wordsAtStartRef.current) void saveSummary();
    }
    listeningRef.current = listening;
  }, [sessionState, meetingTranscript, saveSummary]);

  useEffect(() => () => runningRef.current?.abort(), []);

  const openSummary = useCallback(() => {
    const file = savedFileRef.current;
    if (file) void window.electronAPI?.openSavedFile?.(file);
  }, []);
  const showSummaryInFolder = useCallback(() => {
    const file = savedFileRef.current;
    if (file) void window.electronAPI?.showSavedFile?.(file);
  }, []);
  const dismiss = useCallback(() => setStatus({ state: "idle" }), []);

  const value = useMemo(
    () => ({
      status,
      saveSummary: () => void saveSummary(),
      openSummary,
      showSummaryInFolder,
      dismiss,
    }),
    [status, saveSummary, openSummary, showSummaryInFolder, dismiss],
  );

  return (
    <MeetingSummaryContext.Provider value={value}>
      {children}
      {!compactMode && <MeetingSummaryCard />}
    </MeetingSummaryContext.Provider>
  );
}

export function useMeetingSummary(): MeetingSummaryContextValue {
  const ctx = useContext(MeetingSummaryContext);
  if (!ctx) throw new Error("useMeetingSummary must be used inside MeetingSummaryProvider");
  return ctx;
}

/** Normal view: a small card in the corner while the summary is written,
 *  then where it was saved. */
function MeetingSummaryCard() {
  const { status, saveSummary, openSummary, showSummaryInFolder, dismiss } = useMeetingSummary();
  if (status.state === "idle") return null;
  const desktop = status.state === "saved" && status.file !== null;
  return (
    <div
      role="status"
      data-clickable
      className="fixed bottom-4 right-4 z-50 flex w-[340px] max-w-[calc(100vw-32px)] items-start gap-3 rounded-xl border border-border-subtle bg-surface-raised p-3.5 shadow-xl animate-panel-in"
    >
      <span
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          status.state === "error" ? "bg-red-500/15 text-red-300" : "bg-accent-muted text-accent-text",
        )}
      >
        {status.state === "writing" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : status.state === "saved" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <FileText className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-text-primary">
          {status.state === "writing"
            ? "Writing the meeting summary…"
            : status.state === "saved"
              ? desktop
                ? "Summary saved to Downloads"
                : "Summary downloaded"
              : "Couldn't save the summary"}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-text-tertiary" title={status.state === "saved" ? status.name : undefined}>
          {status.state === "writing"
            ? "It downloads on its own when it's ready."
            : status.state === "saved"
              ? status.name
              : status.message}
        </p>
        {(desktop || status.state === "error") && (
          <div className="mt-2 flex gap-2">
            {desktop && (
              <>
                <button
                  type="button"
                  onClick={openSummary}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[12px] font-semibold text-white hover:bg-accent-hover"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Open
                </button>
                <button
                  type="button"
                  onClick={showSummaryInFolder}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-subtle px-2.5 text-[12px] font-medium text-text-secondary hover:text-text-primary"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Show in folder
                </button>
              </>
            )}
            {status.state === "error" && (
              <button
                type="button"
                onClick={saveSummary}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-subtle px-2.5 text-[12px] font-medium text-text-secondary hover:text-text-primary"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Try again
              </button>
            )}
          </div>
        )}
      </div>
      {status.state !== "writing" && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 rounded p-1 text-text-tertiary hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
