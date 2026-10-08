/** Plain-TS Deepgram live session for the meeting transcript.
 *
 *  Owns the full media + WS lifecycle so the React provider can stay a
 *  thin wrapper. The caller drives state via the supplied callbacks
 *  (`onState`, `onError`, `onSegments`, ...) and receives back a handle.
 *  `stop()` is idempotent and tears down everything the session opened.
 *
 *  Two channels, each with its own Deepgram stream:
 *  - "them": the meeting — system audio (loopback on desktop, the share
 *    picker in browsers).
 *  - "me": the user's microphone, optional. Lines the mic only picked up
 *    from the speakers (the other side, echoed) are dropped.
 *
 *  Both transcribe in the one meeting language the user picked, so a turn
 *  is never split across languages.
 *
 *  On unexpected WebSocket drops while live, re-mints a key and reconnects
 *  with exponential backoff before surfacing a fatal error. */

import {
  type DeepgramProjectKeyResponse,
  closeDeepgramLive,
  connectDeepgramLive,
  deepgramReconnectDelayMs,
  DEEPGRAM_RECONNECT_MAX_ATTEMPTS,
  isDeepgramResultsMessage,
  startDeepgramLiveConnection,
  type DeepgramLiveConnection,
} from "@/lib/transcription/deepgramLiveConnection";
import type { MeetingLanguage } from "@/lib/meeting-language";
import posthog from "posthog-js";
import { ricFetch } from "@/lib/ric-fetch";
import {
  endLiveSession,
  startLiveSession,
  trackEvent,
} from "@/lib/session-tracking";
import type {
  TranscriptSource,
  TranscriptionSegment,
  TranscriptionWord,
} from "@/lib/types";

export type SessionState =
  | "idle"
  | "fetching-key"
  | "connecting"
  | "live"
  | "reconnecting";

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  confidence?: number;
}

type SegmentsUpdater = (prev: TranscriptionSegment[]) => TranscriptionSegment[];

export interface DeepgramSessionCallbacks {
  isElectron: boolean;
  language: MeetingLanguage;
  /** Also transcribe the user's microphone as "me". */
  includeMic: boolean;
  nextSegmentId: () => string;
  onState: (state: SessionState) => void;
  onError: (message: string) => void;
  /** Non-fatal problem worth showing (e.g. the mic could not be opened). */
  onWarning?: (message: string) => void;
  /** Apply a change to the displayed segments (adds, replacements and the
   *  in-progress interim lines). */
  onSegments: (update: SegmentsUpdater) => void;
}

export interface DeepgramSessionHandle {
  stop: () => void;
  /** Re-open transcription in another language on the same audio. */
  switchLanguage: (language: MeetingLanguage) => void;
  getLiveSessionId: () => string | null;
}

interface Channel {
  source: TranscriptSource;
  media: MediaStream;
  interimId: string;
  connection: DeepgramLiveConnection | null;
  recorder: MediaRecorder | null;
}

/** Recent meeting lines kept to spot mic echo of the speakers. */
const ECHO_WINDOW_MS = 12_000;
const ECHO_OVERLAP = 0.6;

async function mintDeepgramKey(sessionId: string): Promise<string> {
  const res = await ricFetch(
    `/api/deepgram?sessionId=${encodeURIComponent(sessionId)}`,
    { cache: "no-store" },
  );
  const object = await res.json();
  if (typeof object !== "object" || object === null || !("key" in object)) {
    throw new Error("No api key returned");
  }
  const apiKeyResponse = object as DeepgramProjectKeyResponse;
  if (!apiKeyResponse.key) {
    throw new Error("Deepgram returned an empty API key");
  }
  return apiKeyResponse.key;
}

function toSegment(
  id: string,
  text: string,
  words: TranscriptionWord[],
  isFinal: boolean,
  source: TranscriptSource,
  speaker?: number,
): TranscriptionSegment {
  return {
    id,
    text,
    words,
    startTime: words[0]?.start ?? 0,
    endTime: words[words.length - 1]?.end ?? 0,
    confidence:
      words.length > 0
        ? words.reduce((acc, w) => acc + (w.confidence ?? 0), 0) / words.length
        : 0,
    speaker,
    source,
    isFinal,
    timestamp: new Date().toISOString(),
  };
}

const normalizeWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Share of `mine` words that also appear in `theirs`. */
function overlap(mine: string[], theirs: Set<string>): number {
  if (mine.length === 0) return 0;
  return mine.filter((w) => theirs.has(w)).length / mine.length;
}

async function captureMeetingAudio(): Promise<MediaStream> {
  // The desktop app answers this with loopback audio in the main process,
  // so no picker appears there. Browsers only expose system audio through
  // the share picker; the Chromium hints preselect "Entire screen" with
  // system audio on. Raw audio: echo cancellation / noise suppression hurt
  // call audio.
  const media = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "monitor" },
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      suppressLocalAudioPlayback: false,
    },
    systemAudio: "include",
    windowAudio: "system",
    selfBrowserSurface: "exclude",
    monitorTypeSurfaces: "include",
    surfaceSwitching: "exclude",
  } as DisplayMediaStreamOptions);
  media.getVideoTracks().forEach((track) => track.stop());
  if (media.getAudioTracks().length === 0) {
    media.getTracks().forEach((t) => t.stop());
    throw new Error("No audio track available");
  }
  return media;
}

/** Start a Deepgram live transcription session. */
export async function startDeepgramSession(
  callbacks: DeepgramSessionCallbacks,
): Promise<DeepgramSessionHandle> {
  const { isElectron, includeMic, nextSegmentId, onState, onError, onSegments } =
    callbacks;
  let language = callbacks.language;

  const channels: Channel[] = [];
  let liveSessionId: string | null = null;
  let stale = false;
  let currentState: SessionState = "idle";
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let hasStartedOnce = false;
  // Bumped per teardown so a connect still in flight knows it was replaced.
  let connectionGen = 0;
  const baseId = nextSegmentId();
  /** Recent meeting words, for dropping mic lines that only echo them. */
  const recentThem: Array<{ at: number; words: string[] }> = [];

  function setState(s: SessionState) {
    currentState = s;
    onState(s);
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function stopRecorder(ch: Channel) {
    if (!ch.recorder) return;
    try {
      ch.recorder.stop();
    } catch {
      /* already stopped */
    }
    ch.recorder = null;
  }

  function clearInterims() {
    const ids = new Set(channels.map((c) => c.interimId));
    onSegments((prev) => prev.filter((s) => !ids.has(s.id)));
  }

  function teardownConnections() {
    connectionGen++;
    for (const ch of channels) {
      stopRecorder(ch);
      if (ch.connection) closeDeepgramLive(ch.connection);
      ch.connection = null;
    }
  }

  function teardown() {
    clearReconnectTimer();
    teardownConnections();
    clearInterims();
    for (const ch of channels) ch.media.getTracks().forEach((t) => t.stop());
    channels.length = 0;
    setState("idle");
  }

  function stop() {
    stale = true;
    clearReconnectTimer();
    teardown();
  }

  function switchLanguage(next: MeetingLanguage) {
    if (next === language) return;
    language = next;
    if (stale || !liveSessionId || channels.length === 0) return;
    clearReconnectTimer();
    teardownConnections();
    clearInterims();
    reconnectAttempt = 0;
    void reconnectLive("language_change");
  }

  const handle: DeepgramSessionHandle = {
    stop,
    switchLanguage,
    getLiveSessionId: () => liveSessionId,
  };

  function isEcho(text: string): boolean {
    const now = Date.now();
    while (recentThem.length > 0 && now - recentThem[0].at > ECHO_WINDOW_MS)
      recentThem.shift();
    const theirs = new Set(recentThem.flatMap((r) => r.words));
    return overlap(normalizeWords(text), theirs) >= ECHO_OVERLAP;
  }

  function bindMessageHandler(ch: Channel, conn: DeepgramLiveConnection) {
    conn.on("message", (data: unknown) => {
      if (stale || ch.connection !== conn) return;
      if (!isDeepgramResultsMessage(data)) return;

      const alt = data.channel?.alternatives?.[0];
      if (!alt || !Array.isArray(alt.words)) return;
      const raw: DeepgramWord[] = alt.words;
      const text = raw.map((w) => w.punctuated_word ?? w.word).join(" ");
      const speaker = data.channel?.speaker;
      const words: TranscriptionWord[] = raw.map((w) => ({
        word: w.word,
        punctuated_word: w.punctuated_word,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
        speaker,
      }));
      const dropInterim = (prev: TranscriptionSegment[]) =>
        prev.filter((s) => s.id !== ch.interimId);

      if (data.is_final) {
        if (text === "") return;
        if (ch.source === "them") {
          recentThem.push({ at: Date.now(), words: normalizeWords(text) });
        } else if (isEcho(text)) {
          onSegments(dropInterim);
          return;
        }
        const final = toSegment(
          nextSegmentId(),
          text,
          words,
          true,
          ch.source,
          speaker,
        );
        onSegments((prev) => [...dropInterim(prev), final]);
        return;
      }

      // One live "typing" line per channel for the words still being heard.
      if (text === "") {
        onSegments(dropInterim);
        return;
      }
      const interim = toSegment(
        ch.interimId,
        text,
        words,
        false,
        ch.source,
        speaker,
      );
      onSegments((prev) => [...dropInterim(prev), interim]);
    });
  }

  /** Fresh recorder per connection: a new Deepgram stream must receive the
   *  container header that only the first chunk carries. */
  function startRecorder(ch: Channel) {
    stopRecorder(ch);
    if (stale) return;
    const recorder = new MediaRecorder(ch.media);
    ch.recorder = recorder;
    recorder.ondataavailable = (e) => {
      if (stale || e.data.size === 0) return;
      try {
        ch.connection?.sendMedia(e.data);
      } catch {
        /* connection gone */
      }
    };
    recorder.start(250);

    if (!hasStartedOnce && ch.source === "them") {
      hasStartedOnce = true;
      posthog.capture("recording_started", {
        platform: isElectron ? "electron" : "browser",
        capture_mode: isElectron ? "system_audio_loopback" : "screen_share_audio",
        with_mic: channels.length > 1,
      });
      trackEvent("recording_start", {
        sessionId: liveSessionId,
        metadata: { platform: isElectron ? "electron" : "browser" },
      });
    }
  }

  function scheduleReconnect(reason: string) {
    if (stale || !liveSessionId || channels.length === 0) return;
    if (reconnectTimer !== null) return;
    if (reconnectAttempt >= DEEPGRAM_RECONNECT_MAX_ATTEMPTS) {
      onError(
        "Transcription connection lost. Please stop and start recording again.",
      );
      const sid = liveSessionId;
      void endLiveSession(sid, reason);
      liveSessionId = null;
      teardown();
      return;
    }

    teardownConnections();
    clearInterims();
    setState("reconnecting");
    const delay = deepgramReconnectDelayMs(reconnectAttempt);
    reconnectAttempt++;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void reconnectLive(reason);
    }, delay);
  }

  async function openConnection(ch: Channel, apiKey: string, gen: number) {
    const conn = await connectDeepgramLive(apiKey, { language });
    if (stale || gen !== connectionGen || ch.connection !== null) {
      closeDeepgramLive(conn);
      return;
    }
    ch.connection = conn;
    bindMessageHandler(ch, conn);

    conn.on("open", () => {
      if (stale || ch.connection !== conn) {
        closeDeepgramLive(conn);
        return;
      }
      if (ch.source === "them") {
        reconnectAttempt = 0;
        setState("live");
      }
      startRecorder(ch);
    });

    const onDrop = (reason: string) => {
      if (ch.connection !== conn || stale) return;
      if (currentState === "live" || currentState === "reconnecting") {
        scheduleReconnect(reason);
        return;
      }
      teardownConnections();
    };
    conn.on("close", () => onDrop("websocket_closed"));
    conn.on("error", (error) => {
      console.error(`Deepgram (${ch.source}) connection error:`, error);
      onDrop("websocket_error");
    });

    startDeepgramLiveConnection(conn);
  }

  async function openConnections(apiKey: string) {
    const gen = connectionGen;
    await Promise.all(channels.map((ch) => openConnection(ch, apiKey, gen)));
  }

  async function reconnectLive(reason: string) {
    if (stale || !liveSessionId || channels.length === 0) return;
    const sid = liveSessionId;

    setState("reconnecting");
    try {
      const apiKey = await mintDeepgramKey(sid);
      if (stale) return;
      await openConnections(apiKey);
    } catch (e) {
      console.error("Deepgram reconnect failed:", e);
      if (stale) return;
      scheduleReconnect(reason);
    }
  }

  setState("fetching-key");

  let meeting: MediaStream;
  try {
    meeting = await captureMeetingAudio();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const hint = isElectron
      ? "Grant Screen Recording permission in System Settings, then try again."
      : 'Choose "Entire screen" and turn on "Share system audio" — or use the desktop app, which needs no sharing.';
    onError(`Could not capture audio. ${hint} (${msg})`);
    setState("idle");
    return handle;
  }
  if (stale) {
    meeting.getTracks().forEach((t) => t.stop());
    return handle;
  }
  channels.push({
    source: "them",
    media: meeting,
    interimId: `${baseId}-interim-them`,
    connection: null,
    recorder: null,
  });

  if (includeMic) {
    try {
      // Echo cancellation on: keeps the speakers out of the mic as much as
      // the device allows; what still leaks through is dropped as echo.
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (stale) {
        mic.getTracks().forEach((t) => t.stop());
      } else {
        channels.push({
          source: "me",
          media: mic,
          interimId: `${baseId}-interim-me`,
          connection: null,
          recorder: null,
        });
      }
    } catch (error) {
      console.warn("Microphone unavailable, transcribing the meeting only:", error);
      callbacks.onWarning?.(
        "Your microphone could not be opened, so only the other side is transcribed.",
      );
    }
  }
  if (stale) {
    teardown();
    return handle;
  }

  const live = await startLiveSession({
    surface: isElectron ? "electron" : "web",
    metadata: {
      capture_mode: isElectron ? "system_audio_loopback" : "screen_share_audio",
      with_mic: channels.length > 1,
    },
  });
  if (stale) {
    teardown();
    return handle;
  }
  if (!live) {
    onError("Could not start session. Are you signed in?");
    teardown();
    return handle;
  }
  liveSessionId = live.sessionId;

  setState("connecting");

  try {
    const apiKey = await mintDeepgramKey(live.sessionId);
    if (stale) {
      teardown();
      return handle;
    }
    await openConnections(apiKey);
  } catch (e) {
    console.error("Failed to start Deepgram session:", e);
    onError("Failed to connect to transcription service. Please try again.");
    void endLiveSession(live.sessionId, "deepgram_connect_failed");
    liveSessionId = null;
    teardown();
  }

  return handle;
}
