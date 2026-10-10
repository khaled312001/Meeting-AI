/**
 * Past meetings, kept on this device.
 *
 * Every meeting's finalized transcript is saved to IndexedDB as it happens
 * (one record per meeting, rewritten as it grows), so nothing is lost when
 * the app closes. The live view always opens empty; past meetings are read
 * back on demand from the "Past meetings" list.
 */

import type { MeetingLanguage } from "@/lib/meeting-language";
import type { TranscriptionSegment } from "@/lib/types";

const DB_NAME = "meeting-ai";
const DB_VERSION = 1;
const STORE = "meetings";
/** Oldest meetings beyond this are dropped. */
const MAX_MEETINGS = 100;
/** A "meeting" with fewer words than this was noise or a test. */
export const MIN_ARCHIVE_WORDS = 10;

export interface ArchivedSegment {
  source?: TranscriptionSegment["source"];
  text: string;
  startTime: number;
}

export interface ArchivedMeeting {
  id: string;
  startedAt: number;
  updatedAt: number;
  language: MeetingLanguage;
  words: number;
  /** First thing the interviewer said, for the list. */
  preview: string;
  segments: ArchivedSegment[];
}

export type MeetingSummaryRow = Omit<ArchivedMeeting, "segments">;

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function newMeetingId(): string {
  return `meeting-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Build the record for a meeting from its segments (finals only). */
export function toArchivedMeeting(
  id: string,
  startedAt: number,
  language: MeetingLanguage,
  segments: TranscriptionSegment[],
  /** When it ended; defaults to now (the meeting is live). */
  endedAt = Date.now(),
): ArchivedMeeting {
  const finals = segments
    .filter((s) => s.isFinal && s.text.trim())
    .map((s) => ({ source: s.source, text: s.text.trim(), startTime: s.startTime }));
  const first = finals.find((s) => s.source !== "me") ?? finals[0];
  return {
    id,
    startedAt,
    updatedAt: endedAt,
    language,
    words: finals.reduce((n, s) => n + countWords(s.text), 0),
    preview: (first?.text ?? "").slice(0, 160),
    segments: finals,
  };
}

/** Save (or update) a meeting. Fails silently — the live view never waits on it. */
export async function saveMeeting(meeting: ArchivedMeeting): Promise<boolean> {
  try {
    await run("readwrite", (store) => store.put(meeting));
    return true;
  } catch {
    return false;
  }
}

export async function deleteMeeting(id: string): Promise<void> {
  try {
    await run("readwrite", (store) => store.delete(id));
  } catch {
    /* non-fatal */
  }
}

export async function getMeeting(id: string): Promise<ArchivedMeeting | null> {
  try {
    return (await run<ArchivedMeeting | undefined>("readonly", (store) => store.get(id))) ?? null;
  } catch {
    return null;
  }
}

/** Newest first, without the transcripts. Also drops meetings beyond the cap. */
export async function listMeetings(): Promise<MeetingSummaryRow[]> {
  let all: ArchivedMeeting[];
  try {
    all = await run<ArchivedMeeting[]>("readonly", (store) => store.getAll());
  } catch {
    return [];
  }
  all.sort((a, b) => b.startedAt - a.startedAt);
  const keep = all.filter((m) => m.words >= MIN_ARCHIVE_WORDS);
  for (const m of [...keep.slice(MAX_MEETINGS), ...all.filter((m) => m.words < MIN_ARCHIVE_WORDS)]) {
    void deleteMeeting(m.id);
  }
  return keep.slice(0, MAX_MEETINGS).map(({ segments: _segments, ...row }) => row);
}

/** Back to the live-view shape, for display and export. */
export function toSegments(meeting: ArchivedMeeting): TranscriptionSegment[] {
  const at = new Date(meeting.startedAt).toISOString();
  return meeting.segments.map((s, i) => ({
    id: `${meeting.id}-${i}`,
    text: s.text,
    words: [],
    startTime: s.startTime,
    endTime: s.startTime,
    isFinal: true,
    source: s.source,
    timestamp: at,
  }));
}
