/** Renderer-side helpers for the Google Calendar panel. All Google calls
 *  go through `window.electronAPI.calendar` (main process). */

type ElectronCalendar = NonNullable<
  NonNullable<Window["electronAPI"]>["calendar"]
>;
type Ok<R> =
  Awaited<R> extends infer A
    ? A extends { ok: true; data: infer D }
      ? D
      : never
    : never;

export type GoogleAccountStatus = Ok<ReturnType<ElectronCalendar["getStatus"]>>;
export type CalendarEvent = Ok<
  ReturnType<ElectronCalendar["listEvents"]>
>[number];
export type GoogleTask = Ok<ReturnType<ElectronCalendar["listTasks"]>>[number];
export type NewCalendarEventInput = Parameters<
  ElectronCalendar["createEvent"]
>[0];
export type CalendarErrorCode = Extract<
  Awaited<ReturnType<ElectronCalendar["getStatus"]>>,
  { ok: false }
>["code"];

export function calendarApi(): ElectronCalendar | null {
  if (typeof window === "undefined") return null;
  return window.electronAPI?.calendar ?? null;
}

export const PROVIDER_LABEL: Record<
  NonNullable<CalendarEvent["provider"]>,
  string
> = {
  meet: "Google Meet",
  zoom: "Zoom",
  teams: "Teams",
  webex: "Webex",
  other: "Video call",
};

/** Local YYYY-MM-DD (day grouping key, `<input type="date">` value). */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** `<input type="time">` value for a date, local time. */
export function localTimeValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export interface DayGroup {
  key: string;
  label: string;
  sublabel: string;
  events: CalendarEvent[];
}

/** Events grouped per local day, in order. Multi-day / ongoing events sit
 *  on today when they already started. */
export function groupByDay(
  events: CalendarEvent[],
  now = new Date(),
): DayGroup[] {
  const todayKey = localDateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowKey = localDateKey(tomorrow);

  const groups = new Map<string, DayGroup>();
  for (const ev of events) {
    const start = new Date(ev.start);
    const key = start < now ? todayKey : localDateKey(start);
    let group = groups.get(key);
    if (!group) {
      const day = key === todayKey ? now : start;
      group = {
        key,
        label:
          key === todayKey
            ? "Today"
            : key === tomorrowKey
              ? "Tomorrow"
              : day.toLocaleDateString(undefined, { weekday: "long" }),
        sublabel: day.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        }),
        events: [],
      };
      groups.set(key, group);
    }
    group.events.push(ev);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function formatTimeRange(ev: CalendarEvent): string {
  if (ev.allDay) return "All day";
  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  const start = new Date(ev.start).toLocaleTimeString(undefined, opts);
  const end = new Date(ev.end).toLocaleTimeString(undefined, opts);
  return `${start} – ${end}`;
}

export function formatStartTime(ev: CalendarEvent): string {
  if (ev.allDay) return "All day";
  return new Date(ev.start).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDuration(ev: CalendarEvent): string {
  const mins = Math.max(
    0,
    Math.round((Date.parse(ev.end) - Date.parse(ev.start)) / 60_000),
  );
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export type EventTiming =
  | { kind: "live" }
  | { kind: "soon"; minutes: number }
  | { kind: "later" }
  | { kind: "all-day" };

/** "Live" while it runs, "soon" within the next 15 minutes. */
export function eventTiming(ev: CalendarEvent, now = Date.now()): EventTiming {
  if (ev.allDay) return { kind: "all-day" };
  const start = Date.parse(ev.start);
  const end = Date.parse(ev.end);
  if (start <= now && now < end) return { kind: "live" };
  const minutes = Math.ceil((start - now) / 60_000);
  if (minutes > 0 && minutes <= 15) return { kind: "soon", minutes };
  return { kind: "later" };
}
