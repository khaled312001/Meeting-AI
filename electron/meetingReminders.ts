/** Desktop notification shortly before a meeting that has a join link.
 *  Rescheduled from every fresh event list; clicking a notification brings
 *  the app forward with that meeting selected. */

import { type BrowserWindow, Notification } from "electron";

import type { CalendarEvent } from "./googleApi";

const LEAD_MS = 2 * 60 * 1000;
/** Only arm timers this far ahead; later ones get armed by a later refresh. */
const HORIZON_MS = 12 * 60 * 60 * 1000;

type WindowAccessor = () => BrowserWindow | null;

const PROVIDER_LABEL: Record<string, string> = {
  meet: "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
  webex: "Webex",
};

const timers = new Map<string, NodeJS.Timeout>();
const notified = new Set<string>();
/** Held so a shown notification isn't garbage-collected (which drops its
 *  click handler). */
const live = new Set<Notification>();

let getWindow: WindowAccessor = () => null;

export function initMeetingReminders(accessor: WindowAccessor): void {
  getWindow = accessor;
}

function keyOf(ev: CalendarEvent): string {
  return `${ev.id}|${ev.start}`;
}

function focusEvent(eventId: string): void {
  const w = getWindow();
  if (!w || w.isDestroyed()) return;
  if (w.isMinimized()) w.restore();
  if (!w.isVisible()) w.show();
  w.focus();
  w.webContents.send("calendar:open-event", eventId);
}

function show(ev: CalendarEvent): void {
  if (!Notification.isSupported()) return;
  const minutes = Math.max(
    1,
    Math.round((Date.parse(ev.start) - Date.now()) / 60_000),
  );
  const where = ev.provider ? PROVIDER_LABEL[ev.provider] : null;
  const parts = [
    `Starts in ${minutes} min`,
    ev.isInterview ? "Interview" : null,
    where ? `Join on ${where}` : "Join link ready",
  ].filter(Boolean);
  const n = new Notification({
    title: ev.title,
    body: `${parts.join(" · ")}. Click to open.`,
    silent: false,
  });
  live.add(n);
  const release = () => live.delete(n);
  n.on("click", () => {
    release();
    focusEvent(ev.id);
  });
  n.on("close", release);
  n.on("failed", release);
  n.show();
}

/** Arm (or re-arm) reminders for these events; anything no longer listed
 *  is dropped. */
export function scheduleMeetingReminders(events: CalendarEvent[]): void {
  const now = Date.now();
  const wanted = new Set<string>();
  for (const ev of events) {
    if (!ev.joinUrl || ev.allDay) continue;
    const startMs = Date.parse(ev.start);
    if (!Number.isFinite(startMs) || startMs <= now) continue;
    const key = keyOf(ev);
    if (notified.has(key)) continue;
    const delay = startMs - LEAD_MS - now;
    if (delay > HORIZON_MS) continue;
    wanted.add(key);
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    const fire = () => {
      timers.delete(key);
      notified.add(key);
      show(ev);
    };
    if (delay <= 0) fire();
    else timers.set(key, setTimeout(fire, delay));
  }
  for (const [key, timer] of timers) {
    if (!wanted.has(key)) {
      clearTimeout(timer);
      timers.delete(key);
    }
  }
}

export function clearMeetingReminders(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}
