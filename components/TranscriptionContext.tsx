"use client";

/**
 * Owns the live Deepgram session for the entire app.
 *
 * Why this exists: previously the recorder was mounted inside Assistant (full)
 * and CompactAssistant (compact). Toggling between those two surfaces unmounted
 * the recorder, which tore down the WebSocket and media stream. This
 * provider lifts the session above the surface boundary so flipping
 * compact ↔ full no longer interrupts an active recording.
 *
 * Both surfaces consume the same `transcribedText` / `transcriptionSegments`
 * and call the same `startSession` / `stopSession` actions, so a recording
 * started from the compact toolbar can be observed and stopped from the
 * full Assistant view (and vice-versa).
 */

import posthog from "posthog-js";
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
import { useClientReady } from "@/hooks/useClientReady";
import {
  type DeepgramSessionHandle,
  type SessionState,
  startDeepgramSession,
} from "@/lib/transcription/deepgramSession";
import {
  clearPersistedSegments,
  loadPersistedSegments,
  restorePersistedSegments,
} from "@/lib/transcription/transcript-persistence";
import {
  deleteMeeting,
  MIN_ARCHIVE_WORDS,
  newMeetingId,
  saveMeeting,
  toArchivedMeeting,
} from "@/lib/transcription/meeting-archive";
import { endLiveSession, trackEvent } from "@/lib/session-tracking";
import {
  DEFAULT_MEETING_LANGUAGE,
  type MeetingLanguage,
  readMeetingLanguage,
  writeMeetingLanguage,
} from "@/lib/meeting-language";
import type { TranscriptionSegment } from "@/lib/types";

interface TranscriptionContextValue {
  /** Finalized speech; once the mic is in play, one labeled line per turn
   *  ("Interviewer: …" / "Me: …"). */
  transcribedText: string;
  /** Finalized speech from the other side only. */
  interviewerText: string;
  /** Finalized speech from the user's microphone only. */
  myText: string;
  /** Words from the other side are being heard right now. */
  interviewerSpeaking: boolean;
  /** Words from the user's microphone are being heard right now. */
  meSpeaking: boolean;
  /** Transcribe the user's microphone too (applies from the next start). */
  includeMic: boolean;
  setIncludeMic: (on: boolean) => void;
  transcriptionSegments: TranscriptionSegment[];
  sessionState: SessionState;
  errorMessage: string | null;
  isElectron: boolean | null;
  isClientReady: boolean;
  isActive: boolean;
  isBusy: boolean;
  isReconnecting: boolean;
  startSession: () => Promise<void>;
  stopSession: () => void;
  clearTranscription: () => void;
  dismissError: () => void;
  /** Read-at-submit access to the transcript without subscribing to
   *  per-interim updates (submit callbacks stay referentially stable). */
  getTranscribedText: () => string;
  /** Language the meeting is held in — transcription and answers use it. */
  language: MeetingLanguage;
  /** Switch language; a live session restarts in the new language. */
  setLanguage: (language: MeetingLanguage) => void;
}

const MIC_STORAGE_KEY = "meeting-ai-include-mic";

const SPEAKER_LABEL = { them: "Interviewer", me: "Me" } as const;

/** Prompt texts from the finalized segments. Labels appear only once the
 *  user's mic is part of the transcript; until then it reads as before. */
export function buildTranscriptTexts(segments: TranscriptionSegment[]) {
  const finals = segments.filter((s) => s.isFinal && s.text.trim());
  const join = (list: TranscriptionSegment[]) =>
    list.map((s) => s.text.trim()).join(" ");
  const interviewerText = join(finals.filter((s) => s.source !== "me"));
  const myText = join(finals.filter((s) => s.source === "me"));
  if (!myText) return { transcribedText: interviewerText, interviewerText, myText };

  const lines: string[] = [];
  let current: "them" | "me" | null = null;
  for (const s of finals) {
    const who = s.source === "me" ? "me" : "them";
    if (who === current) {
      lines[lines.length - 1] += ` ${s.text.trim()}`;
    } else {
      lines.push(`${SPEAKER_LABEL[who]}: ${s.text.trim()}`);
      current = who;
    }
  }
  return { transcribedText: lines.join("\n"), interviewerText, myText };
}

const TranscriptionContext = createContext<TranscriptionContextValue | null>(
  null,
);

export function TranscriptionProvider({ children }: { children: ReactNode }) {
  const isClientReady = useClientReady();

  const [isElectron, setIsElectron] = useState<boolean | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcriptionSegments, setTranscriptionSegments] = useState<
    TranscriptionSegment[]
  >([]);
  // Prompt text = finalized speech only; the in-progress interim lines are
  // display-only so partial words are never duplicated into answers.
  const { transcribedText, interviewerText, myText } = useMemo(
    () => buildTranscriptTexts(transcriptionSegments),
    [transcriptionSegments],
  );
  const interviewerSpeaking = transcriptionSegments.some(
    (s) => !s.isFinal && s.source !== "me",
  );
  const meSpeaking = transcriptionSegments.some(
    (s) => !s.isFinal && s.source === "me",
  );
  const [includeMic, setIncludeMicState] = useState(true);
  const includeMicRef = useRef(includeMic);
  includeMicRef.current = includeMic;
  useEffect(() => {
    try {
      setIncludeMicState(localStorage.getItem(MIC_STORAGE_KEY) !== "off");
    } catch {
      /* storage unavailable — keep the default */
    }
  }, []);
  const setIncludeMic = useCallback((on: boolean) => {
    setIncludeMicState(on);
    try {
      localStorage.setItem(MIC_STORAGE_KEY, on ? "on" : "off");
    } catch {
      /* storage unavailable — applies for this session */
    }
  }, []);
  const [language, setLanguageState] = useState<MeetingLanguage>(
    DEFAULT_MEETING_LANGUAGE,
  );
  const languageRef = useRef(language);
  languageRef.current = language;
  useEffect(() => {
    setLanguageState(readMeetingLanguage());
  }, []);

  // Mirror of `transcribedText` for read-at-submit consumers — keeps
  // their callbacks stable without subscribing them to token updates.
  const transcribedTextRef = useRef("");
  transcribedTextRef.current = transcribedText;
  const getTranscribedText = useCallback(() => transcribedTextRef.current, []);

  const sessionHandleRef = useRef<DeepgramSessionHandle | null>(null);
  const segmentCounterRef = useRef<number>(0);
  // Each call to startSession bumps this. Any async work (key fetch, ws
  // open, etc.) checks `isStale()` to bail out if a newer session has
  // started in the meantime. Without this, double-clicking Start could
  // leave two parallel sessions running.
  const sessionIdRef = useRef<number>(0);

  useEffect(() => {
    setIsElectron(typeof window !== "undefined" && !!window.electronAPI);
  }, []);

  const stopHandle = useCallback(() => {
    if (sessionHandleRef.current) {
      sessionHandleRef.current.stop();
      sessionHandleRef.current = null;
    }
  }, []);

  const startSession = useCallback(async () => {
    stopHandle();
    const thisSession = ++sessionIdRef.current;
    setErrorMessage(null);

    const handle = await startDeepgramSession({
      isElectron: !!isElectron,
      language: languageRef.current,
      includeMic: includeMicRef.current,
      // Unique across launches: restored segments keep their old ids.
      nextSegmentId: () =>
        `segment-${Date.now().toString(36)}-${segmentCounterRef.current++}`,
      onState: (s) => {
        // Ignore state updates from an older session that was stopped
        // before its async startup finished.
        if (sessionIdRef.current !== thisSession) return;
        setSessionState(s);
      },
      onError: (msg) => {
        if (sessionIdRef.current !== thisSession) return;
        setErrorMessage(msg);
      },
      onWarning: (msg) => {
        if (sessionIdRef.current !== thisSession) return;
        setErrorMessage(msg);
      },
      onSegments: (update) => {
        if (sessionIdRef.current !== thisSession) return;
        setTranscriptionSegments(update);
      },
    });

    if (sessionIdRef.current !== thisSession) {
      handle.stop();
      return;
    }
    sessionHandleRef.current = handle;
  }, [isElectron, stopHandle]);

  // Each meeting is saved to the past-meetings archive as it happens.
  // Interim updates mutate constantly; a fixed 1s tick writes at most once
  // per second regardless of speech rate, and stop/clear flush immediately.
  // The live view itself always starts empty.
  const transcriptionSegmentsRef = useRef(transcriptionSegments);
  transcriptionSegmentsRef.current = transcriptionSegments;
  const persistDirtyRef = useRef(false);
  const meetingRef = useRef<{ id: string; startedAt: number } | null>(null);

  const flushTranscriptPersist = useCallback(() => {
    if (!persistDirtyRef.current) return;
    persistDirtyRef.current = false;
    const segments = transcriptionSegmentsRef.current;
    if (!segments.some((s) => s.isFinal && s.text.trim())) return;
    meetingRef.current ??= { id: newMeetingId(), startedAt: Date.now() };
    const { id, startedAt } = meetingRef.current;
    void saveMeeting(toArchivedMeeting(id, startedAt, languageRef.current, segments));
  }, []);

  useEffect(() => {
    if (transcriptionSegments.length > 0) {
      persistDirtyRef.current = true;
    }
  }, [transcriptionSegments]);

  useEffect(() => {
    const id = setInterval(flushTranscriptPersist, 1000);
    return () => clearInterval(id);
  }, [flushTranscriptPersist]);

  const stopSession = useCallback(() => {
    sessionIdRef.current++;
    const sid = sessionHandleRef.current?.getLiveSessionId() ?? null;
    stopHandle();
    flushTranscriptPersist();
    setSessionState("idle");
    posthog.capture("recording_stopped", {
      platform: isElectron ? "electron" : "browser",
    });
    trackEvent("recording_stop", {
      sessionId: sid,
      metadata: { platform: isElectron ? "electron" : "browser" },
    });
    if (sid) void endLiveSession(sid, "user_stopped");
  }, [stopHandle, isElectron, flushTranscriptPersist]);

  // Clearing ends the meeting: it stays in Past meetings (unless it was too
  // short to matter) and the next words start a new one.
  const clearTranscription = useCallback(() => {
    persistDirtyRef.current = true;
    flushTranscriptPersist();
    const meeting = meetingRef.current;
    const words = transcriptionSegmentsRef.current
      .filter((s) => s.isFinal)
      .reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
    if (meeting && words < MIN_ARCHIVE_WORDS) void deleteMeeting(meeting.id);
    meetingRef.current = null;
    persistDirtyRef.current = false;
    setTranscriptionSegments([]);
  }, [flushTranscriptPersist]);

  const dismissError = useCallback(() => setErrorMessage(null), []);

  const setLanguage = useCallback(
    (next: MeetingLanguage) => {
      if (next === languageRef.current) return;
      languageRef.current = next;
      setLanguageState(next);
      writeMeetingLanguage(next);
      // A running session keeps its audio and re-listens in the new language.
      sessionHandleRef.current?.switchLanguage(next);
    },
    [],
  );

  // Older versions kept the last transcript in localStorage and showed it
  // again on launch. Move it into Past meetings once, and start empty.
  useEffect(() => {
    const saved = loadPersistedSegments();
    if (saved.length === 0) return;
    // Take it out right away so a second mount can't archive it twice;
    // put it back if it couldn't be saved.
    clearPersistedSegments();
    const startedAt = Date.parse(saved[0]?.timestamp ?? "") || Date.now();
    const finals = saved.map((s) => ({ ...s, isFinal: true }));
    const lastSecond = Math.max(0, ...finals.map((s) => s.endTime || s.startTime || 0));
    void saveMeeting(
      toArchivedMeeting(
        newMeetingId(),
        startedAt,
        readMeetingLanguage(),
        finals,
        startedAt + lastSecond * 1000,
      ),
    ).then((ok) => {
      if (!ok) restorePersistedSegments(saved);
    });
  }, []);

  // Tear down for real when the provider itself unmounts (i.e. app close /
  // hard navigation). Toggling compact ↔ full no longer remounts the
  // provider, so this only fires on real teardown.
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate in-flight async on unmount
      sessionIdRef.current++;
      const sid = sessionHandleRef.current?.getLiveSessionId() ?? null;
      stopHandle();
      if (sid) void endLiveSession(sid, "client_unmount");
    };
  }, [stopHandle]);

  const isActive = sessionState !== "idle";
  const isReconnecting = sessionState === "reconnecting";
  const isBusy =
    sessionState === "fetching-key" ||
    sessionState === "connecting" ||
    isReconnecting;

  // Memoize so consumers don't re-render on unrelated parent re-renders.
  // Every callback in the value is already wrapped in useCallback, so
  // identity is stable as long as state and isElectron don't change.
  const value = useMemo<TranscriptionContextValue>(
    () => ({
      transcribedText,
      interviewerText,
      myText,
      interviewerSpeaking,
      meSpeaking,
      includeMic,
      setIncludeMic,
      transcriptionSegments,
      sessionState,
      errorMessage,
      isElectron,
      isClientReady,
      isActive,
      isBusy,
      isReconnecting,
      startSession,
      stopSession,
      clearTranscription,
      dismissError,
      getTranscribedText,
      language,
      setLanguage,
    }),
    [
      transcribedText,
      interviewerText,
      myText,
      interviewerSpeaking,
      meSpeaking,
      includeMic,
      setIncludeMic,
      transcriptionSegments,
      sessionState,
      errorMessage,
      isElectron,
      isClientReady,
      isActive,
      isBusy,
      isReconnecting,
      startSession,
      stopSession,
      clearTranscription,
      dismissError,
      getTranscribedText,
      language,
      setLanguage,
    ],
  );

  return (
    <TranscriptionContext.Provider value={value}>
      {children}
    </TranscriptionContext.Provider>
  );
}

export function useTranscription(): TranscriptionContextValue {
  const ctx = useContext(TranscriptionContext);
  if (!ctx) {
    throw new Error(
      "useTranscription must be used within a TranscriptionProvider",
    );
  }
  return ctx;
}
