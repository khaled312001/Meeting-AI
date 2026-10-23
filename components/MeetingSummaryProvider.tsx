"use client";

/** End-of-meeting summary: when a real conversation ends — listening
 *  stops, the transcript is cleared, or the desktop app is quit mid-meeting —
 *  the summary is written and saved on its own (retried if the connection
 *  drops) — a PDF in Downloads on
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
import {
  type AnswerLogEntry,
  useAssistantSession,
} from "@/components/AssistantSessionProvider";
import { useInterviewContext } from "@/components/InterviewContextProvider";
import { useTab } from "@/components/TabContext";
import { buildTranscriptTexts, useTranscription } from "@/components/TranscriptionContext";
import { buildSummaryDocument, summaryFileBaseName } from "@/lib/meeting-summary";
import { buildInterviewLog, interviewLogFileBaseName } from "@/lib/interview-log";
import { buildContextBlock } from "@/lib/prompt-context";
import { streamCompletion } from "@/lib/stream-completion";
import { FLAGS, type TranscriptionSegment } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Too little was said for a summary to be worth a file. */
const MIN_WORDS = 40;
/** Waits before trying an automatic summary again after it failed. */
const RETRY_DELAYS_MS = [3_000, 10_000];

/** One meeting, captured when it ended. */
interface MeetingSnapshot {
  segments: TranscriptionSegment[];
  answers: string[];
  jobContext: string;
  /** Listening had stopped: later speech is a new meeting. */
  endsMeeting: boolean;
}

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

function downloadInBrowser(content: string, name: string, type = "text/html", ext = "html") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function MeetingSummaryProvider({ children }: { children: ReactNode }) {
  const { sessionState, transcriptionSegments, language, stopSession } = useTranscription();
  const { pastAnswers, completion, answerKind, answerAt, getAnswerLog } =
    useAssistantSession();
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
  /** Summaries run one after another, never two at once. */
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  /** The last segment a saved summary covered. */
  const summarizedUpToRef = useRef<string | null>(null);
  /** A meeting whose summary failed, for "Try again". */
  const failedRef = useRef<MeetingSnapshot | null>(null);
  /** Quitting: the quit handler saves the meeting itself. */
  const quittingRef = useRef(false);

  /** Where the current meeting starts: speech after `afterSegmentId`,
   *  answers written from `since` on. */
  const meetingStartRef = useRef<{ afterSegmentId: string | null; since: number }>({
    afterSegmentId: null,
    since: 0,
  });

  /** The interview log: saved once per meeting, on its own, when the
   *  meeting ends — however little was said, and even if the summary fails.
   *  Kept from the last render too, so clearing everything still saves it. */
  const getAnswerLogRef = useRef(getAnswerLog);
  getAnswerLogRef.current = getAnswerLog;
  const lastLogRef = useRef<AnswerLogEntry[]>([]);
  const meetingLog = getAnswerLog(meetingStartRef.current.since);
  if (meetingLog.length > 0) lastLogRef.current = meetingLog;
  const loggedRef = useRef<string | null>(null);
  const saveInterviewLog = useCallback((entries: AnswerLogEntry[]) => {
    if (entries.length === 0) return;
    const key = entries.map((e) => `${e.at}:${e.answer.length}`).join("|");
    if (key === loggedRef.current) return;
    loggedRef.current = key;
    const at = new Date(entries[0]?.at ?? Date.now());
    const text = buildInterviewLog(entries, at);
    const name = interviewLogFileBaseName(at);
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (api?.saveTextFile) {
      void api.saveTextFile(text, name).catch((err) => {
        console.error("Interview log not saved:", err);
        loggedRef.current = null;
      });
    } else {
      downloadInBrowser(text, name, "text/markdown", "md");
    }
  }, []);
  const takeMeetingLog = useCallback(() => {
    const live = getAnswerLogRef.current(meetingStartRef.current.since);
    const entries = live.length > 0 ? live : lastLogRef.current;
    lastLogRef.current = [];
    return entries;
  }, []);

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

  const writeSummary = useCallback(async (meeting: MeetingSnapshot, auto: boolean) => {
    const transcript = buildTranscriptTexts(meeting.segments).transcribedText;
    const lastSegmentId = meeting.segments.at(-1)?.id ?? null;
    if (wordCount(transcript) < MIN_WORDS) {
      if (!auto) setStatus({ state: "error", message: "Not enough was said for a summary yet." });
      return;
    }
    const controller = new AbortController();
    runningRef.current = controller;
    setStatus({ state: "writing" });
    const lang = languageRef.current;
    const at = new Date();
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          let summary = "";
          await streamCompletion({
            flag: FLAGS.SUMMARIZER,
            bg: meeting.jobContext,
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
            answers: meeting.answers,
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
          summarizedUpToRef.current = lastSegmentId;
          if (failedRef.current === meeting) failedRef.current = null;
          // Saved after listening stopped → this meeting is over; the next
          // summary covers only what comes after it.
          if (meeting.endsMeeting && lastSegmentId) {
            meetingStartRef.current = { afterSegmentId: lastSegmentId, since: Date.now() };
          }
          return;
        } catch (err) {
          if (controller.signal.aborted) return;
          // A dropped connection shouldn't cost the meeting its summary.
          if (auto && attempt < RETRY_DELAYS_MS.length) {
            await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
            if (controller.signal.aborted) return;
            continue;
          }
          failedRef.current = meeting;
          setStatus({
            state: "error",
            message: err instanceof Error ? err.message : "Couldn't save the summary.",
          });
          return;
        }
      }
    } finally {
      if (runningRef.current === controller) runningRef.current = null;
    }
  }, []);

  const queueSummary = useCallback(
    (meeting: MeetingSnapshot, auto: boolean) => {
      queueRef.current = queueRef.current
        .then(() => writeSummary(meeting, auto))
        .catch(() => {});
      return queueRef.current;
    },
    [writeSummary],
  );

  const snapshot = useCallback(
    (): MeetingSnapshot => ({
      segments: meetingSegments(),
      answers: meetingAnswers(),
      jobContext: jobContextRef.current,
      endsMeeting: !listeningNowRef.current,
    }),
    [meetingSegments, meetingAnswers],
  );

  /** Summarize the meeting now and save it (the button, and "Try again"). */
  const saveSummary = useCallback(() => {
    if (runningRef.current) return;
    void queueSummary(failedRef.current ?? snapshot(), false);
  }, [queueSummary, snapshot]);

  // Clearing the transcript ends the meeting: summarize what was cleared
  // (unless its summary is already saved), then start a new one.
  const lastSegmentsRef = useRef<TranscriptionSegment[]>([]);
  if (transcriptionSegments.length > 0) lastSegmentsRef.current = transcriptionSegments;
  const wordsAtStartRef = useRef(0);
  const transcriptEmpty = transcriptionSegments.length === 0;
  useEffect(() => {
    if (!transcriptEmpty) return;
    const before = lastSegmentsRef.current;
    lastSegmentsRef.current = [];
    const { afterSegmentId } = meetingStartRef.current;
    const i = afterSegmentId ? before.findIndex((s) => s.id === afterSegmentId) : -1;
    const segments = i < 0 ? before : before.slice(i + 1);
    const last = segments.at(-1)?.id ?? null;
    saveInterviewLog(takeMeetingLog());
    if (
      last &&
      last !== summarizedUpToRef.current &&
      wordCount(buildTranscriptTexts(segments).transcribedText) >= MIN_WORDS
    ) {
      void queueSummary(
        { segments, answers: meetingAnswers(), jobContext: jobContextRef.current, endsMeeting: false },
        true,
      );
    }
    meetingStartRef.current = { afterSegmentId: null, since: Date.now() };
    wordsAtStartRef.current = 0;
  }, [transcriptEmpty, queueSummary, meetingAnswers, saveInterviewLog, takeMeetingLog]);

  /** Speech in this listening session that no summary covers yet. */
  const hasUnsavedMeeting = useCallback(() => {
    const words = wordCount(meetingTranscript());
    return words >= MIN_WORDS && words > wordsAtStartRef.current;
  }, [meetingTranscript]);

  // Listening stopped after a real conversation → summarize and save.
  const listeningRef = useRef(false);
  useEffect(() => {
    const listening = sessionState !== "idle";
    if (listening && !listeningRef.current) {
      wordsAtStartRef.current = wordCount(meetingTranscript());
      setStatus((s) => (s.state === "writing" ? s : { state: "idle" }));
    }
    if (!listening && listeningRef.current && !quittingRef.current) {
      saveInterviewLog(takeMeetingLog());
      if (hasUnsavedMeeting()) void queueSummary(snapshot(), true);
    }
    listeningRef.current = listening;
  }, [
    sessionState,
    meetingTranscript,
    hasUnsavedMeeting,
    queueSummary,
    snapshot,
    saveInterviewLog,
    takeMeetingLog,
  ]);

  // Desktop: quitting mid-meeting saves the summary first (see quitGuard).
  const writing = status.state === "writing";
  const segmentCount = transcriptionSegments.length;
  useEffect(() => {
    const pending = writing || (sessionState !== "idle" && hasUnsavedMeeting());
    window.electronAPI?.setMeetingPending?.(pending);
  }, [writing, sessionState, segmentCount, hasUnsavedMeeting]);

  const stopSessionRef = useRef(stopSession);
  stopSessionRef.current = stopSession;
  useEffect(() => {
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;
    return api?.onFinishMeetingBeforeQuit?.(() => {
      quittingRef.current = true;
      if (listeningNowRef.current) saveInterviewLog(takeMeetingLog());
      const save = listeningNowRef.current && hasUnsavedMeeting();
      const meeting = { ...snapshot(), endsMeeting: true };
      if (listeningNowRef.current) stopSessionRef.current();
      const done = save ? queueSummary(meeting, true) : queueRef.current;
      void done.finally(() => api.meetingFinished?.());
    });
  }, [hasUnsavedMeeting, snapshot, queueSummary, saveInterviewLog, takeMeetingLog]);

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
