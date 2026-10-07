/**
 * Local persistence for the live transcript.
 *
 * The transcription session is memory-only by design (fast interim merges),
 * but losing the whole transcript when the window closes is unrecoverable.
 * This module keeps a ring buffer of the most recent *finalized* segments in
 * localStorage so a relaunch can restore recent context. Interim segments are
 * never persisted — they mutate constantly and would thrash the storage.
 */

import type { TranscriptionSegment } from "@/lib/types";

const STORAGE_KEY = "ric.transcript.v1";
const MAX_PERSISTED_SEGMENTS = 400;
/** localStorage is shared and small (~5MB); keep our slice well under it. */
const MAX_PERSISTED_BYTES = 1024 * 1024;

/** Load previously persisted finalized segments (oldest first). */
export function loadPersistedSegments(): TranscriptionSegment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is TranscriptionSegment =>
        !!s &&
        typeof s === "object" &&
        typeof (s as TranscriptionSegment).id === "string" &&
        typeof (s as TranscriptionSegment).text === "string",
    );
  } catch {
    return [];
  }
}

/** Persist the tail of the finalized segments. Fails silently (quota etc.). */
export function persistSegments(segments: TranscriptionSegment[]): void {
  if (typeof window === "undefined") return;
  try {
    let trimmed = segments
      .filter((s) => s.isFinal)
      .slice(-MAX_PERSISTED_SEGMENTS);
    // localStorage is shared and small (~5MB); keep our slice well under it.
    let json = JSON.stringify(trimmed);
    while (json.length > MAX_PERSISTED_BYTES && trimmed.length > 10) {
      // Drop the oldest quarter and retry.
      trimmed = trimmed.slice(-Math.max(10, Math.floor(trimmed.length * 0.75)));
      json = JSON.stringify(trimmed);
    }
    window.localStorage.setItem(STORAGE_KEY, json);
  } catch {
    /* non-fatal */
  }
}

export function clearPersistedSegments(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/** Render segments as a Markdown document with timestamped lines. */
export function formatTranscriptMarkdown(
  segments: TranscriptionSegment[],
): string {
  const lines = segments
    .filter((s) => s.text.trim().length > 0)
    .map((s) => `- \`${formatClock(s.startTime)}\` ${s.text.trim()}`);
  const date = new Date();
  const header = `# Transcript\n\nExported ${date.toLocaleString()}\n`;
  return `${header}\n${lines.join("\n")}\n`;
}

/** Download the transcript as a `.md` file (browser only). */
export function downloadTranscriptMarkdown(
  segments: TranscriptionSegment[],
): void {
  if (typeof window === "undefined" || segments.length === 0) return;
  const blob = new Blob([formatTranscriptMarkdown(segments)], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "-")
    .replace(":", "");
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `transcript-${stamp}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
