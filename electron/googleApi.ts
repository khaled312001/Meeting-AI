/** Google Calendar + Tasks calls (main process only) and the normalized
 *  shapes handed to the renderer: join link, provider and an interview
 *  hint are worked out here so the renderer never parses raw events. */

import { net } from "electron";
import { randomUUID } from "node:crypto";

import {
  GoogleError,
  getAccessToken,
  getAccountStatus,
  invalidateAccessToken,
} from "./googleAuth";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const TASKS_API = "https://tasks.googleapis.com/tasks/v1";

export type MeetingProvider = "meet" | "zoom" | "teams" | "webex" | "other";

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO date-time; for all-day events, local midnight of that day. */
  start: string;
  end: string;
  allDay: boolean;
  joinUrl: string | null;
  provider: MeetingProvider | null;
  isInterview: boolean;
  htmlLink: string | null;
  location: string | null;
  organizer: string | null;
  attendees: number;
}

export interface GoogleTask {
  id: string;
  title: string;
  notes: string | null;
  /** YYYY-MM-DD (Google stores only the date). */
  due: string | null;
}

// ── HTTP ──────────────────────────────────────────────────────────────

async function googleFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken();
    let res: Response;
    try {
      res = await net.fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch {
      throw new GoogleError(
        "network",
        "Couldn't reach Google. Check your connection.",
      );
    }
    if (res.status === 401 && attempt === 0) {
      invalidateAccessToken();
      continue;
    }
    if (res.status === 204) return undefined as T;
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; status?: string };
    };
    if (!res.ok) {
      if (res.status === 403 && body.error?.status === "PERMISSION_DENIED") {
        throw new GoogleError(
          "missing-scope",
          "Google didn't allow this. Reconnect and tick every permission.",
        );
      }
      throw new GoogleError(
        "google",
        body.error?.message || `Google request failed (${res.status}).`,
      );
    }
    return body as T;
  }
  throw new GoogleError(
    "reauth",
    "Your Google sign-in expired. Connect again.",
  );
}

// ── Join links ────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>"'()[\]{}]+/gi;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function stripHtml(text: string): string {
  return decodeEntities(
    text.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "),
  );
}

export function classifyMeetingUrl(raw: string): MeetingProvider | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const p = url.pathname;
  if (host === "meet.google.com" && p.length > 1) return "meet";
  if (
    (host === "zoom.us" ||
      host.endsWith(".zoom.us") ||
      host.endsWith("zoomgov.com")) &&
    /^\/(j|my|w|s|wc)\//.test(p)
  ) {
    return "zoom";
  }
  if (
    (host === "teams.microsoft.com" && p.includes("/meet")) ||
    (host === "teams.live.com" && p.startsWith("/meet"))
  ) {
    return "teams";
  }
  if (host.endsWith(".webex.com")) return "webex";
  return null;
}

/** First meeting link found in free text (location / description). */
function findMeetingUrl(text: string | undefined): string | null {
  if (!text) return null;
  // href="..." first: descriptions are often HTML with the visible text
  // shortened.
  const candidates = [
    ...Array.from(text.matchAll(/href="([^"]+)"/gi), (m) => m[1] ?? ""),
    ...(stripHtml(text).match(URL_RE) ?? []),
  ];
  for (const candidate of candidates) {
    const cleaned = decodeEntities(candidate).replace(/[.,;:!?]+$/, "");
    if (classifyMeetingUrl(cleaned)) return cleaned;
  }
  return null;
}

interface RawEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
    createRequest?: { status?: { statusCode?: string } };
  };
}

function detectJoinUrl(
  ev: RawEvent,
): { url: string; provider: MeetingProvider } | null {
  if (ev.hangoutLink) return { url: ev.hangoutLink, provider: "meet" };
  const video = ev.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video" && e.uri?.startsWith("https://"),
  );
  if (video?.uri) {
    return {
      url: video.uri,
      provider: classifyMeetingUrl(video.uri) ?? "other",
    };
  }
  const fromText =
    findMeetingUrl(ev.location) ?? findMeetingUrl(ev.description);
  if (fromText) {
    return { url: fromText, provider: classifyMeetingUrl(fromText) ?? "other" };
  }
  return null;
}

// ── Interview hint ────────────────────────────────────────────────────

const INTERVIEW_PATTERNS: RegExp[] = [
  // English
  /\binterview(s|ing|er)?\b/i,
  /\bphone screen(ing)?\b/i,
  /\bscreening (call|interview)\b/i,
  /\b(technical|coding|final|hr|onsite|on-site) round\b/i,
  /\brecruiter (call|chat|screen)\b/i,
  /\bhiring manager\b/i,
  // Arabic (no \b: it doesn't work for Arabic letters)
  /مقابل[ةه]/,
  /[اإ]نترف[يى]و/,
  /توظيف/,
  // German
  /vorstellungsgespr[aä]ch/i,
  /bewerbungsgespr[aä]ch/i,
];

export function looksLikeInterview(title: string, description = ""): boolean {
  const text = `${title}\n${stripHtml(description).slice(0, 2000)}`;
  return INTERVIEW_PATTERNS.some((re) => re.test(text));
}

// ── Events ────────────────────────────────────────────────────────────

/** All-day dates come as YYYY-MM-DD; treat them as local midnight. */
function dateOnlyToIso(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toISOString();
}

function normalizeEvent(ev: RawEvent): CalendarEvent | null {
  if (!ev.id || ev.status === "cancelled") return null;
  const startRaw = ev.start?.dateTime ?? ev.start?.date;
  if (!startRaw) return null;
  const allDay = !ev.start?.dateTime;
  const start = allDay
    ? dateOnlyToIso(startRaw)
    : new Date(startRaw).toISOString();
  const endRaw = ev.end?.dateTime ?? ev.end?.date ?? startRaw;
  const end = allDay ? dateOnlyToIso(endRaw) : new Date(endRaw).toISOString();
  const title = ev.summary?.trim() || "(No title)";
  const join = detectJoinUrl(ev);
  return {
    id: ev.id,
    title,
    start,
    end,
    allDay,
    joinUrl: join?.url ?? null,
    provider: join?.provider ?? null,
    isInterview: looksLikeInterview(title, ev.description),
    htmlLink: ev.htmlLink ?? null,
    location: ev.location?.trim() || null,
    organizer: ev.organizer?.displayName || ev.organizer?.email || null,
    attendees: ev.attendees?.length ?? 0,
  };
}

function requireCalendar(): void {
  const status = getAccountStatus();
  if (!status.configured) {
    throw new GoogleError(
      "not-configured",
      "Google Calendar isn't set up in this build.",
    );
  }
  if (!status.connected)
    throw new GoogleError("not-connected", "Connect Google Calendar first.");
}

/** Events from now until `days` days ahead on the primary calendar,
 *  declined ones left out. */
export async function listUpcomingEvents(days = 7): Promise<CalendarEvent[]> {
  requireCalendar();
  const now = new Date();
  // Include meetings that started in the last hour so a running one can
  // still be joined.
  const timeMin = new Date(now.getTime() - 60 * 60 * 1000);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + days);
  timeMax.setHours(23, 59, 59, 999);
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "150",
  });
  const data = await googleFetch<{ items?: RawEvent[] }>(
    `${CALENDAR_API}/calendars/primary/events?${params.toString()}`,
  );
  return (data.items ?? [])
    .filter(
      (ev) =>
        !ev.attendees?.some((a) => a.self && a.responseStatus === "declined"),
    )
    .map(normalizeEvent)
    .filter((ev): ev is CalendarEvent => ev !== null)
    .filter((ev) => new Date(ev.end).getTime() > now.getTime());
}

export interface NewEventInput {
  title: string;
  /** ISO date-time. */
  start: string;
  durationMinutes: number;
  addMeet: boolean;
  timeZone: string;
  description?: string;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Validate untrusted renderer input. */
export function parseNewEventInput(input: unknown): NewEventInput {
  const v = (input ?? {}) as Record<string, unknown>;
  const title = typeof v.title === "string" ? v.title.trim().slice(0, 300) : "";
  const start = typeof v.start === "string" ? v.start : "";
  const startMs = Date.parse(start);
  const duration = Number(v.durationMinutes);
  const tz = typeof v.timeZone === "string" ? v.timeZone : "UTC";
  if (!title) throw new GoogleError("google", "Give the meeting a title.");
  if (!Number.isFinite(startMs))
    throw new GoogleError("google", "Pick a valid date and time.");
  if (!Number.isFinite(duration) || duration < 5 || duration > 24 * 60) {
    throw new GoogleError(
      "google",
      "Pick a duration between 5 minutes and 24 hours.",
    );
  }
  return {
    title,
    start: new Date(startMs).toISOString(),
    durationMinutes: Math.round(duration),
    addMeet: v.addMeet === true,
    timeZone: isValidTimeZone(tz) ? tz : "UTC",
    description:
      typeof v.description === "string"
        ? v.description.slice(0, 8000)
        : undefined,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Create an event; with `addMeet`, Google attaches a Meet link (which
 *  can take a moment, so a pending request is polled briefly). */
export async function createEvent(
  input: NewEventInput,
): Promise<CalendarEvent> {
  requireCalendar();
  const startMs = Date.parse(input.start);
  const body: Record<string, unknown> = {
    summary: input.title,
    start: {
      dateTime: new Date(startMs).toISOString(),
      timeZone: input.timeZone,
    },
    end: {
      dateTime: new Date(
        startMs + input.durationMinutes * 60_000,
      ).toISOString(),
      timeZone: input.timeZone,
    },
  };
  if (input.description) body.description = input.description;
  if (input.addMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  const base = `${CALENDAR_API}/calendars/primary/events`;
  let raw = await googleFetch<RawEvent>(
    `${base}?conferenceDataVersion=${input.addMeet ? 1 : 0}`,
    { method: "POST", body: JSON.stringify(body) },
  );
  for (
    let i = 0;
    input.addMeet &&
    raw.id &&
    !raw.hangoutLink &&
    raw.conferenceData?.createRequest?.status?.statusCode === "pending" &&
    i < 6;
    i++
  ) {
    await sleep(800);
    raw = await googleFetch<RawEvent>(`${base}/${encodeURIComponent(raw.id)}`);
  }
  const ev = normalizeEvent(raw);
  if (!ev)
    throw new GoogleError("google", "Google didn't return the new event.");
  return ev;
}

// ── Tasks ─────────────────────────────────────────────────────────────

function requireTasks(): void {
  requireCalendar();
  if (!getAccountStatus().canUseTasks) {
    throw new GoogleError(
      "missing-scope",
      "Tasks access wasn't allowed. Reconnect and tick the Tasks permission.",
    );
  }
}

interface RawTask {
  id?: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: string;
}

function normalizeTask(t: RawTask): GoogleTask | null {
  if (!t.id || t.status === "completed") return null;
  const title = t.title?.trim();
  if (!title) return null;
  return {
    id: t.id,
    title,
    notes: t.notes?.trim() || null,
    due: t.due ? t.due.slice(0, 10) : null,
  };
}

const DEFAULT_LIST = `${TASKS_API}/lists/%40default/tasks`;

export async function listOpenTasks(): Promise<GoogleTask[]> {
  requireTasks();
  const params = new URLSearchParams({
    showCompleted: "false",
    showHidden: "false",
    maxResults: "50",
  });
  const data = await googleFetch<{ items?: RawTask[] }>(
    `${DEFAULT_LIST}?${params}`,
  );
  return (data.items ?? [])
    .map(normalizeTask)
    .filter((t): t is GoogleTask => t !== null);
}

export async function addTask(input: unknown): Promise<GoogleTask> {
  requireTasks();
  const v = (input ?? {}) as Record<string, unknown>;
  const title =
    typeof v.title === "string" ? v.title.trim().slice(0, 1024) : "";
  if (!title) throw new GoogleError("google", "Write the task first.");
  const body: Record<string, string> = { title };
  if (typeof v.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.due)) {
    body.due = `${v.due}T00:00:00.000Z`;
  }
  const raw = await googleFetch<RawTask>(DEFAULT_LIST, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const task = normalizeTask(raw);
  if (!task)
    throw new GoogleError("google", "Google didn't return the new task.");
  return task;
}

export async function completeTask(id: unknown): Promise<void> {
  requireTasks();
  if (typeof id !== "string" || !/^[\w-]{1,200}$/.test(id)) {
    throw new GoogleError("google", "Unknown task.");
  }
  await googleFetch<RawTask>(`${DEFAULT_LIST}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "completed" }),
  });
}
