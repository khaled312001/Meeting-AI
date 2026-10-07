/** Typed client for the signed-in user's own endpoints (client dashboard). */

import { parseApiErrorResponse } from "@/lib/api-errors";
import { ricFetch } from "@/lib/ric-fetch";
import type { NotesResponse, UserInterviewContext } from "@/lib/types";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await ricFetch(path, { signal });
  if (!res.ok) throw new Error(await parseApiErrorResponse(res));
  return (await res.json()) as T;
}

async function sendJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await ricFetch(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseApiErrorResponse(res));
  return (await res.json()) as T;
}

/* ── Usage ── */

export type UsageWindow = "24h" | "7d" | "30d" | "90d";

export interface UsageAgg {
  events: number;
  promptChars: number;
  responseChars: number;
  durationMs: number;
  errors: number;
}

export interface TimeseriesRow extends UsageAgg {
  bucket: number;
}

export interface QuotaSummary {
  planTier: string;
  monthlyAllowanceSeconds: number | null;
  monthlyAllowanceCompletions: number | null;
  consumedSeconds: number;
  consumedCompletions: number;
  remainingSeconds: number | null;
  remainingCompletions: number | null;
  cycleResetAt: string;
  overageAllowed: boolean;
  enforcementEnabled: boolean;
  recordConsumption: boolean;
}

export interface MyUsage {
  window: UsageWindow;
  since: string;
  bucketSeconds: number;
  totals: UsageAgg;
  perAction: Array<UsageAgg & { action: string }>;
  timeseries: TimeseriesRow[];
  quota: QuotaSummary;
}

export function getMyUsage(window: UsageWindow, signal?: AbortSignal) {
  return getJson<MyUsage>(`/api/usage/me?window=${window}`, signal);
}

/* ── Sessions ── */

export interface MySession {
  id: string;
  surface: string | null;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  endReason: string | null;
  eventCount: number;
  status: "active" | "stale" | "ended";
  durationMs: number;
}

export interface MySessions {
  sessions: MySession[];
  total: number;
  pagination: { limit: number; offset: number };
}

export function listMySessions(limit: number, offset: number, signal?: AbortSignal) {
  return getJson<MySessions>(`/api/sessions?limit=${limit}&offset=${offset}`, signal);
}

/* ── Interview profile ── */

export function getInterviewContext(signal?: AbortSignal) {
  return getJson<{ context: UserInterviewContext }>("/api/interview-context", signal);
}

export function patchInterviewContext(fields: Partial<Omit<UserInterviewContext, "updatedAt">>) {
  return sendJson<{ ok: true; context: UserInterviewContext }>("/api/interview-context", "PATCH", fields);
}

/* ── Notes ── */

export function listNotes(
  opts: { page: number; limit: number; q?: string; tag?: string },
  signal?: AbortSignal,
) {
  const p = new URLSearchParams({ page: String(opts.page), limit: String(opts.limit) });
  if (opts.q) p.set("q", opts.q);
  if (opts.tag) p.set("tag", opts.tag);
  return getJson<NotesResponse>(`/api/notes?${p.toString()}`, signal);
}

export function deleteNote(id: string) {
  return sendJson<{ success: true }>(`/api/notes/${encodeURIComponent(id)}`, "DELETE");
}
