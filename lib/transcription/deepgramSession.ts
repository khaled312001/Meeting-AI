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
 *  Both listen for the language the user picked. On Auto each source has
 *  two streams, the Arabic model and the multilingual one, and each line
 *  comes from whichever heard it (see languagePicker).
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
import type { ListenLanguage } from "@/lib/meeting-language";
import { createLanguagePicker, type Lane } from "@/lib/transcription/languagePicker";
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
  language?: string;
}

type SegmentsUpdater = (prev: TranscriptionSegment[]) => TranscriptionSegment[];

export interface DeepgramSessionCallbacks {
  isElectron: boolean;
  language: ListenLanguage;
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
  switchLanguage: (language: ListenLanguage) => void;
  getLiveSessionId: () => string | null;
}

interface Channel {
  source: TranscriptSource;
  media: MediaStream;
  interimId: string;
  /** Auto: which of the source's two streams this is. */
  lane: Lane | null;
  connection: DeepgramLiveConnection | null;
  recorder: MediaRecorder | null;
  /** When its audio started (word times count from here). */
  startedAt: number;
  /** Last time Deepgram sent anything on this channel's connection. */
  heardAt: number;
}

/** A finished line, before Auto settles which stream's line is shown. */
interface FinalLine {
  source: TranscriptSource;
  interimId: string;
  text: string;
  words: TranscriptionWord[];
  speaker?: number;
}

const LATIN_LANGUAGES = new Set(["en", "de"]);

/** A connection that hasn't opened by now is retried. */
const OPEN_TIMEOUT_MS = 10_000;
/** Deepgram answers about every second, silence included; a connection
 *  quiet for this long has stalled without closing and is replaced. */
const STALL_MS = 12_000;
const WATCHDOG_MS = 2_000;

/** Recent meeting lines kept to spot mic echo of the speakers. */
const ECHO_WINDOW_MS = 12_000;
const ECHO_OVERLAP = 0.6;
/** The mic can finish a line before the meeting audio does: a mic line
 *  this recent is dropped too once the meeting's line shows it was echo. */
const ECHO_LATE_MS = 5_000;

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
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let hasStartedOnce = false;
  // Bumped per teardown so a connect still in flight knows it was replaced.
  let connectionGen = 0;
  const baseId = nextSegmentId();
  /** Recent meeting words, for dropping mic lines that only echo them. */
  const recentThem: Array<{ at: number; words: string[] }> = [];
  /** The meeting words still being heard (not final yet). */
  let themInterim: string[] = [];
  /** Recent mic lines, rechecked when the meeting's line arrives. */
  const recentMine: Array<{ at: number; id: string; words: string[] }> = [];
  /** Auto: one picker per source between its two streams. */
  const pickers = new Map<TranscriptSource, ReturnType<typeof createLanguagePicker<FinalLine>>>();
  let pickerTimer: ReturnType<typeof setTimeout> | null = null;

  /** The channels for one audio source: one stream, or two on Auto. */
  function sourceChannels(source: TranscriptSource, media: MediaStream): Channel[] {
    const lanes: Array<Lane | null> = language === "auto" ? ["ar", "multi"] : [null];
    return lanes.map((lane) => ({
      source,
      media,
      interimId: `${baseId}-interim-${source}`,
      lane,
      connection: null,
      recorder: null,
      startedAt: 0,
      heardAt: 0,
    }));
  }

  function pickerFor(source: TranscriptSource) {
    let picker = pickers.get(source);
    if (!picker) {
      picker = createLanguagePicker<FinalLine>((line) => emitFinal(line));
      pickers.set(source, picker);
    }
    return picker;
  }

  /** Lines waiting for the other stream are settled as time passes. */
  function settleLater() {
    if (pickerTimer !== null) return;
    pickerTimer = setTimeout(() => {
      pickerTimer = null;
      if (stale) return;
      let waiting = false;
      for (const p of pickers.values()) waiting = p.settle() || waiting;
      if (waiting) settleLater();
    }, 150);
  }

  function clearPickers() {
    for (const p of pickers.values()) p.clear();
    if (pickerTimer !== null) {
      clearTimeout(pickerTimer);
      pickerTimer = null;
    }
  }

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
    clearPickers();
    for (const ch of channels) {
      stopRecorder(ch);
      // Detach first: closing can fire "close" right away, and that must
      // not count as a fresh drop (it used to use up the retries at once).
      const conn = ch.connection;
      ch.connection = null;
      if (conn) closeDeepgramLive(conn);
    }
  }

  function teardown() {
    clearReconnectTimer();
    if (watchdog !== null) {
      clearInterval(watchdog);
      watchdog = null;
    }
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

  function switchLanguage(next: ListenLanguage) {
    if (next === language) return;
    language = next;
    if (stale || !liveSessionId || channels.length === 0) return;
    clearReconnectTimer();
    teardownConnections();
    clearInterims();
    // Auto has two streams per source, one language one.
    const sources = new Map(channels.map((c) => [c.source, c.media]));
    channels.length = 0;
    for (const [source, media] of sources) channels.push(...sourceChannels(source, media));
    reconnectAttempt = 0;
    void reconnectLive("language_change");
  }

  const handle: DeepgramSessionHandle = {
    stop,
    switchLanguage,
    getLiveSessionId: () => liveSessionId,
  };

  // The other side is who the meeting audio carries, the user is the mic —
  // never a speaker label. A mic line that only repeats the meeting audio
  // (speakers heard by the mic) is not the user speaking and is dropped.
  function theirWords(): Set<string> {
    const now = Date.now();
    while (recentThem.length > 0 && now - recentThem[0].at > ECHO_WINDOW_MS)
      recentThem.shift();
    return new Set([...recentThem.flatMap((r) => r.words), ...themInterim]);
  }

  function isEcho(text: string): boolean {
    return overlap(normalizeWords(text), theirWords()) >= ECHO_OVERLAP;
  }

  /** The meeting's line arrived after the mic's: drop mic lines it echoed. */
  function dropLateEcho() {
    const now = Date.now();
    while (recentMine.length > 0 && now - recentMine[0].at > ECHO_LATE_MS)
      recentMine.shift();
    if (recentMine.length === 0) return;
    const theirs = theirWords();
    const echoed = new Set<string>();
    for (let i = recentMine.length - 1; i >= 0; i--) {
      if (overlap(recentMine[i].words, theirs) >= ECHO_OVERLAP) {
        echoed.add(recentMine[i].id);
        recentMine.splice(i, 1);
      }
    }
    if (echoed.size > 0) onSegments((prev) => prev.filter((s) => !echoed.has(s.id)));
  }

  function bindMessageHandler(ch: Channel, conn: DeepgramLiveConnection) {
    conn.on("message", (data: unknown) => {
      if (stale || ch.connection !== conn) return;
      ch.heardAt = Date.now();
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
        const line: FinalLine = {
          source: ch.source,
          interimId: ch.interimId,
          text,
          words,
          speaker,
        };
        if (!ch.lane) {
          emitFinal(line);
          return;
        }
        const share = (match: (lang: string) => boolean) =>
          raw.filter((w) => w.language && match(w.language)).length / raw.length;
        const waiting = pickerFor(ch.source).add({
          lane: ch.lane,
          start: ch.startedAt + (raw[0]?.start ?? 0) * 1000,
          end: ch.startedAt + (raw[raw.length - 1]?.end ?? 0) * 1000,
          words: raw.length,
          latin: share((l) => LATIN_LANGUAGES.has(l)),
          arabic: share((l) => l === "ar"),
          at: Date.now(),
          line,
        });
        if (waiting) settleLater();
        return;
      }

      // Auto: only the stream whose lines are being shown shows its words
      // still being heard.
      if (ch.lane && pickerFor(ch.source).current !== ch.lane) return;
      if (ch.source === "them") themInterim = normalizeWords(text);

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

  /** Show a finished line (after Auto chose it): echo of the meeting heard
   *  by the mic is dropped. */
  function emitFinal({ source, interimId, text, words, speaker }: FinalLine) {
    const dropInterim = (prev: TranscriptionSegment[]) =>
      prev.filter((s) => s.id !== interimId);
    if (source === "them") {
      recentThem.push({ at: Date.now(), words: normalizeWords(text) });
      themInterim = [];
    } else if (isEcho(text)) {
      onSegments(dropInterim);
      return;
    }
    const final = toSegment(nextSegmentId(), text, words, true, source, speaker);
    onSegments((prev) => [...dropInterim(prev), final]);
    if (source === "them") dropLateEcho();
    else recentMine.push({ at: Date.now(), id: final.id, words: normalizeWords(text) });
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
    ch.startedAt = Date.now();

    if (!hasStartedOnce && ch.source === "them") {
      hasStartedOnce = true;
      posthog.capture("recording_started", {
        platform: isElectron ? "electron" : "browser",
        capture_mode: isElectron ? "system_audio_loopback" : "screen_share_audio",
        with_mic: channels.some((c) => c.source === "me"),
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
    const conn = await connectDeepgramLive(
      apiKey,
      ch.lane === "multi"
        ? { language: "multi", languageHints: ["ar", "en", "de"] }
        : { language: ch.lane ?? (language === "auto" ? "multi" : language) },
    );
    if (stale || gen !== connectionGen || ch.connection !== null) {
      closeDeepgramLive(conn);
      return;
    }
    ch.connection = conn;
    ch.heardAt = Date.now();
    bindMessageHandler(ch, conn);

    let opened = false;
    const openTimer = setTimeout(() => {
      if (!opened) onDrop("open_timeout");
    }, OPEN_TIMEOUT_MS);

    conn.on("open", () => {
      opened = true;
      clearTimeout(openTimer);
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

    function onDrop(reason: string) {
      clearTimeout(openTimer);
      if (ch.connection !== conn || stale) return;
      // Also while the first connection is still opening: left alone, a
      // drop there would leave the session "starting" forever.
      if (
        currentState === "live" ||
        currentState === "reconnecting" ||
        currentState === "connecting"
      ) {
        scheduleReconnect(reason);
        return;
      }
      teardownConnections();
    }
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

  // Everything that doesn't wait on another step starts at once: the first
  // listen used to wait for the audio, then the mic, then the session and
  // then the key, one after another.
  const sessionStart = startLiveSession({
    surface: isElectron ? "electron" : "web",
    metadata: {
      capture_mode: isElectron ? "system_audio_loopback" : "screen_share_audio",
      with_mic: includeMic,
    },
  });
  const keyMint = sessionStart.then((live) =>
    live ? mintDeepgramKey(live.sessionId) : null,
  );
  keyMint.catch(() => {}); // handled where it is awaited
  // Echo cancellation on: keeps the speakers out of the mic as much as the
  // device allows; what still leaks through is dropped as echo.
  const micOpen = includeMic
    ? navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    : null;
  micOpen?.catch(() => {}); // handled where it is awaited

  /** Undo what started in parallel when the start gives up early. */
  const abandon = (reason: string) => {
    void micOpen?.then((mic) => mic.getTracks().forEach((t) => t.stop()));
    void sessionStart.then((live) => {
      if (live) void endLiveSession(live.sessionId, reason);
    });
  };

  let meeting: MediaStream;
  try {
    meeting = await captureMeetingAudio();
  } catch (error) {
    abandon("capture_failed");
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
    abandon("stopped");
    return handle;
  }
  channels.push(...sourceChannels("them", meeting));

  if (micOpen) {
    try {
      const mic = await micOpen;
      if (stale) {
        mic.getTracks().forEach((t) => t.stop());
      } else {
        channels.push(...sourceChannels("me", mic));
      }
    } catch (error) {
      console.warn("Microphone unavailable, transcribing the meeting only:", error);
      callbacks.onWarning?.(
        "Your microphone could not be opened, so only the other side is transcribed.",
      );
    }
  }
  if (stale) {
    abandon("stopped");
    teardown();
    return handle;
  }

  const live = await sessionStart;
  if (stale) {
    abandon("stopped");
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
  watchdog = setInterval(() => {
    if (stale || currentState !== "live") return;
    const now = Date.now();
    if (channels.some((ch) => ch.connection && now - ch.heardAt > STALL_MS)) {
      scheduleReconnect("stalled");
    }
  }, WATCHDOG_MS);

  try {
    const apiKey = await keyMint;
    if (stale) {
      teardown();
      return handle;
    }
    if (!apiKey) throw new Error("No Deepgram key");
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
