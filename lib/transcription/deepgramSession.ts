/** Plain-TS Deepgram live session for the system-audio interview pipeline.
 *
 *  Owns the full media + WS lifecycle so the React provider can stay a
 *  thin wrapper. The caller drives state via the supplied callbacks
 *  (`onState`, `onError`, `onSegments`, ...) and receives back a
 *  `{ stop }` handle. `stop()` is idempotent and tears down everything
 *  the session opened.
 *
 *  Two Deepgram streams hear the same audio — multilingual ("multi") and
 *  Arabic — and `LanguageArbiter` keeps whichever matches the speaker, so
 *  any of those languages is detected automatically.
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
import {
  type FinalChunk,
  LanguageArbiter,
  STREAM_LANGS,
  type StreamLang,
} from "@/lib/transcription/languageArbiter";
import posthog from "posthog-js";
import { ricFetch } from "@/lib/ric-fetch";
import {
  endLiveSession,
  startLiveSession,
  trackEvent,
} from "@/lib/session-tracking";
import type { TranscriptionSegment, TranscriptionWord } from "@/lib/types";

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
  nextSegmentId: () => string;
  onState: (state: SessionState) => void;
  onError: (message: string) => void;
  /** Apply a change to the displayed segments (adds, replacements and the
   *  single in-progress interim line). */
  onSegments: (update: SegmentsUpdater) => void;
}

export interface DeepgramSessionHandle {
  stop: () => void;
  getLiveSessionId: () => string | null;
}

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
    isFinal,
    timestamp: new Date().toISOString(),
  };
}

/** Start a Deepgram live transcription session. */
export async function startDeepgramSession(
  callbacks: DeepgramSessionCallbacks,
): Promise<DeepgramSessionHandle> {
  const { isElectron, nextSegmentId, onState, onError, onSegments } =
    callbacks;

  let connections: Partial<Record<StreamLang, DeepgramLiveConnection>> = {};
  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let liveSessionId: string | null = null;
  let stale = false;
  let currentState: SessionState = "idle";
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let hasStartedOnce = false;

  const arbiter = new LanguageArbiter();
  const interimId = `${nextSegmentId()}-interim`;

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

  function stopRecorder() {
    if (mediaRecorder) {
      try {
        mediaRecorder.stop();
      } catch {
        /* already stopped */
      }
      mediaRecorder = null;
    }
  }

  function clearInterim() {
    onSegments((prev) => prev.filter((s) => s.id !== interimId));
  }

  function teardownMedia() {
    stopRecorder();
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  }

  function teardownConnections() {
    for (const conn of Object.values(connections)) {
      if (conn) closeDeepgramLive(conn);
    }
    connections = {};
  }

  function teardown() {
    clearReconnectTimer();
    teardownMedia();
    teardownConnections();
    clearInterim();
    setState("idle");
  }

  function stop() {
    stale = true;
    clearReconnectTimer();
    teardown();
  }

  const handle: DeepgramSessionHandle = {
    stop,
    getLiveSessionId: () => liveSessionId,
  };

  function applyFinal(chunk: FinalChunk) {
    const change = arbiter.addFinal(chunk);
    if (change.add.length === 0 && change.remove.length === 0) return;
    const remove = new Set([...change.remove, interimId]);
    const added = change.add.map((c) =>
      toSegment(c.id, c.text, c.words, true, c.speaker),
    );
    onSegments((prev) => {
      const kept = prev.filter((s) => !remove.has(s.id));
      const known = new Set(kept.map((s) => s.id));
      return [...kept, ...added.filter((s) => !known.has(s.id))];
    });
  }

  function bindMessageHandler(conn: DeepgramLiveConnection, lang: StreamLang) {
    conn.on("message", (data: unknown) => {
      if (stale || connections[lang] !== conn) return;
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

      if (data.is_final) {
        if (text === "") return;
        applyFinal({
          id: nextSegmentId(),
          lang,
          start: words[0]?.start ?? 0,
          end: words[words.length - 1]?.end ?? 0,
          text,
          words,
          confidence:
            words.reduce((acc, w) => acc + (w.confidence ?? 0), 0) /
            words.length,
          speaker,
        });
        return;
      }

      // One live "typing" line, from the stream currently trusted.
      if (lang !== arbiter.active) return;
      if (text === "") {
        clearInterim();
        return;
      }
      const interim = toSegment(interimId, text, words, false, speaker);
      onSegments((prev) => [...prev.filter((s) => s.id !== interimId), interim]);
    });
  }

  /** Fresh recorder per connection pair: each Deepgram stream must receive
   *  the container header that only the first chunk carries. */
  function startRecorder(media: MediaStream) {
    stopRecorder();
    if (stale) return;
    const recorder = new MediaRecorder(media);
    mediaRecorder = recorder;
    recorder.ondataavailable = (e) => {
      if (stale || e.data.size === 0) return;
      for (const conn of Object.values(connections)) {
        try {
          conn?.sendMedia(e.data);
        } catch {
          /* connection gone */
        }
      }
    };
    recorder.start(250);

    if (!hasStartedOnce) {
      hasStartedOnce = true;
      posthog.capture("recording_started", {
        platform: isElectron ? "electron" : "browser",
        capture_mode: isElectron ? "system_audio_loopback" : "screen_share_audio",
      });
      trackEvent("recording_start", {
        sessionId: liveSessionId,
        metadata: { platform: isElectron ? "electron" : "browser" },
      });
    }
  }

  function scheduleReconnect(reason: string) {
    if (stale || !liveSessionId || !mediaStream) return;
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

    stopRecorder();
    teardownConnections();
    clearInterim();
    setState("reconnecting");
    const delay = deepgramReconnectDelayMs(reconnectAttempt);
    reconnectAttempt++;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void reconnectLive(reason);
    }, delay);
  }

  async function openConnections(apiKey: string, media: MediaStream) {
    arbiter.reset();
    const opened = new Set<StreamLang>();
    const pair: Partial<Record<StreamLang, DeepgramLiveConnection>> = {};
    for (const lang of STREAM_LANGS) {
      pair[lang] = await connectDeepgramLive(apiKey, { language: lang });
    }
    connections = pair;

    for (const lang of STREAM_LANGS) {
      const conn = pair[lang]!;
      bindMessageHandler(conn, lang);

      conn.on("open", () => {
        if (stale) {
          closeDeepgramLive(conn);
          return;
        }
        opened.add(lang);
        if (opened.size < STREAM_LANGS.length) return;
        reconnectAttempt = 0;
        setState("live");
        startRecorder(media);
      });

      const onDrop = (reason: string) => {
        if (connections[lang] !== conn || stale) return;
        if (currentState === "live" || currentState === "reconnecting") {
          scheduleReconnect(reason);
          return;
        }
        teardownConnections();
      };
      conn.on("close", () => onDrop("websocket_closed"));
      conn.on("error", (error) => {
        console.error(`Deepgram (${lang}) connection error:`, error);
        onDrop("websocket_error");
      });

      startDeepgramLiveConnection(conn);
    }
  }

  async function reconnectLive(reason: string) {
    if (stale || !liveSessionId || !mediaStream) return;
    const sid = liveSessionId;
    const media = mediaStream;

    setState("reconnecting");
    try {
      const apiKey = await mintDeepgramKey(sid);
      if (stale) return;
      await openConnections(apiKey, media);
    } catch (e) {
      console.error("Deepgram reconnect failed:", e);
      if (stale) return;
      scheduleReconnect(reason);
    }
  }

  setState("fetching-key");

  let media: MediaStream;
  try {
    // System audio only (never the mic). The desktop app answers this with
    // loopback audio in the main process, so no picker appears there.
    // Browsers only expose system audio through the share picker; the
    // Chromium hints preselect "Entire screen" with system audio on.
    // Raw audio: echo cancellation / noise suppression hurt call audio.
    media = await navigator.mediaDevices.getDisplayMedia({
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
    media.getTracks().forEach((t) => t.stop());
    return handle;
  }
  mediaStream = media;

  const live = await startLiveSession({
    surface: isElectron ? "electron" : "web",
    metadata: {
      capture_mode: isElectron ? "system_audio_loopback" : "screen_share_audio",
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
    await openConnections(apiKey, media);
  } catch (e) {
    console.error("Failed to start Deepgram session:", e);
    onError("Failed to connect to transcription service. Please try again.");
    void endLiveSession(live.sessionId, "deepgram_connect_failed");
    liveSessionId = null;
    teardown();
  }

  return handle;
}
