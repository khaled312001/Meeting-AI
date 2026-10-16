"use client";

/** Meetings tab: the next 7 days from Google Calendar, one-click join (and
 *  join + start the assistant), scheduling with a Meet link, and Google
 *  Tasks. Google is reached only through the main process. */

import {
  Bell,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  Loader2,
  LogOut,
  Mic,
  MonitorSmartphone,
  RefreshCw,
  Settings2,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MeetingCard } from "@/components/meetings/MeetingCard";
import { ScheduleMeetingCard } from "@/components/meetings/ScheduleMeetingCard";
import { TasksCard } from "@/components/meetings/TasksCard";
import { AlertBanner } from "@/components/shell/AlertBanner";
import { useTab } from "@/components/TabContext";
import { useTranscription } from "@/components/TranscriptionContext";
import { Button } from "@/components/ui/button";
import { useGoogleCalendar } from "@/hooks/useGoogleCalendar";
import { type CalendarEvent, calendarApi, groupByDay } from "@/lib/calendar";
import { cn } from "@/lib/utils";

/** Re-render on a slow tick so "in 5 min" / "Live now" stay current. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function updatedAgo(at: number | null, now: number): string {
  if (!at) return "";
  const mins = Math.floor((now - at) / 60_000);
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins} min ago`;
  return `Updated ${Math.floor(mins / 60)} h ago`;
}

interface MeetingsPanelProps {
  /** Bring the full view forward on this tab (from a reminder click). */
  onReveal: () => void;
}

export function MeetingsPanel({ onReveal }: MeetingsPanelProps) {
  const cal = useGoogleCalendar();
  const { startSession, isActive: listening, isBusy } = useTranscription();
  const { setActiveTab } = useTab();
  const now = useNow(30_000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);

  const { refreshEvents, openLink } = cal;

  // Reminder notification clicked: show this tab with that meeting.
  useEffect(() => {
    const api = calendarApi();
    if (!api) return;
    return api.onOpenEvent((id) => {
      onReveal();
      setSelectedId(id);
      void refreshEvents();
    });
  }, [onReveal, refreshEvents]);

  // The highlight fades after a while.
  useEffect(() => {
    if (!selectedId) return;
    const id = window.setTimeout(() => setSelectedId(null), 20_000);
    return () => window.clearTimeout(id);
  }, [selectedId]);

  const join = useCallback(
    (ev: CalendarEvent) => {
      if (ev.joinUrl) void openLink(ev.joinUrl);
    },
    [openLink],
  );

  /** Same start as the assistant's Start Listening button, after opening
   *  the meeting in the browser. */
  const joinAndStart = useCallback(
    (ev: CalendarEvent) => {
      if (!ev.joinUrl) return;
      setStartingId(ev.id);
      setActiveTab("assistant");
      if (!listening && !isBusy) {
        void startSession().finally(() => setStartingId(null));
      } else {
        setStartingId(null);
      }
      void openLink(ev.joinUrl);
    },
    [isBusy, listening, openLink, setActiveTab, startSession],
  );

  const openInCalendar = useCallback(
    (ev: CalendarEvent) => {
      if (ev.htmlLink) void openLink(ev.htmlLink);
    },
    [openLink],
  );

  const groups = useMemo(
    () => (cal.events ? groupByDay(cal.events, new Date(now)) : []),
    [cal.events, now],
  );

  // ── States before the list ──────────────────────────────────────────

  if (cal.available === null || (cal.available && cal.status === null)) {
    return <PanelSkeleton />;
  }

  if (!cal.available) {
    return (
      <CenteredState
        icon={<MonitorSmartphone className="h-5 w-5" />}
        title="Calendar lives in the desktop app"
        body="Open the desktop app to see your upcoming meetings, join them with one click and get a reminder before they start."
      />
    );
  }

  const status = cal.status;
  if (status && !status.configured) {
    return (
      <CenteredState
        icon={<Settings2 className="h-5 w-5" />}
        title="Google Calendar isn't set up yet"
        body="This version of the app doesn't have Google sign-in configured, so the calendar can't be connected yet. It will turn on in an update."
        hint={
          process.env.NODE_ENV === "development"
            ? "Set GOOGLE_OAUTH_CLIENT_ID (and GOOGLE_OAUTH_CLIENT_SECRET) in .env, then restart Electron."
            : undefined
        }
      />
    );
  }

  if (!cal.connected) {
    return (
      <ConnectState
        connecting={cal.connecting}
        error={cal.error}
        onConnect={() => void cal.connect()}
        onCancel={() => void cal.cancelConnect()}
      />
    );
  }

  // ── Connected ───────────────────────────────────────────────────────

  const meetingCount = cal.events?.length ?? 0;

  return (
    <div className="custom-scrollbar flex h-full min-h-0 w-full flex-col overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 md:overflow-hidden">
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-signal-meetings/15 text-signal-meetings">
            <CalendarDays className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-semibold tracking-tight text-text-primary">
              Upcoming meetings
            </h2>
            <p className="m-0 text-[11px] text-text-tertiary">
              Next 7 days · {meetingCount}{" "}
              {meetingCount === 1 ? "meeting" : "meetings"}
              <span className="hidden sm:inline"> · reminder 2 min before</span>
            </p>
          </div>
        </div>
        <div className="ms-auto flex items-center gap-1.5">
          <span className="hidden text-[11px] text-text-tertiary md:inline">
            {updatedAgo(cal.lastUpdated, now)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => void cal.refreshEvents()}
            disabled={cal.eventsLoading}
            title="Refresh"
            aria-label="Refresh meetings"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                cal.eventsLoading && "motion-safe:animate-spin",
              )}
            />
          </Button>
          <AccountMenu
            email={status?.email ?? null}
            onDisconnect={() => void cal.disconnect()}
          />
        </div>
      </header>

      {cal.error && (
        <AlertBanner
          message={cal.error}
          onDismiss={cal.dismissError}
          className="mb-3 rounded-md animate-fade-in-up"
        />
      )}
      {status && !status.persisted && (
        <AlertBanner
          variant="info"
          message="This device has no secure storage, so you'll need to connect again after restarting the app."
          className="mb-3 rounded-md"
        />
      )}

      <div className="grid gap-3 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_288px]">
        <section
          aria-label="Upcoming meetings"
          className="surface-panel flex flex-col md:min-h-0"
        >
          <div className="custom-scrollbar px-2.5 pb-2.5 md:min-h-0 md:flex-1 md:overflow-y-auto">
            {cal.events === null ? (
              <ListSkeleton />
            ) : groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-14 text-center animate-panel-in">
                <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-overlay text-text-tertiary">
                  <CalendarPlus className="h-5 w-5" aria-hidden />
                </span>
                <p className="m-0 text-[13px] font-medium text-text-primary">
                  Nothing on your calendar this week
                </p>
                <p className="m-0 mt-1 max-w-xs text-[12px] text-text-tertiary">
                  Meetings you add in Google Calendar show up here. You can
                  schedule one on the right.
                </p>
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.key} className="pt-1">
                  <div className="sticky top-0 z-10 -mx-2.5 flex items-baseline gap-2 bg-surface-raised/95 px-3.5 pb-1.5 pt-2 backdrop-blur-sm">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                      {group.label}
                    </span>
                    <span className="text-[11px] text-text-tertiary">
                      {group.sublabel}
                    </span>
                    <span className="ms-auto text-[10.5px] tabular-nums text-text-tertiary">
                      {group.events.length}
                    </span>
                  </div>
                  <ul className="m-0 list-none space-y-1.5 p-0">
                    {group.events.map((ev, i) => (
                      <MeetingCard
                        key={`${ev.id}-${ev.start}`}
                        event={ev}
                        now={now}
                        index={i}
                        selected={selectedId === ev.id}
                        assistantLive={listening}
                        starting={startingId === ev.id && isBusy}
                        onJoin={join}
                        onJoinAndStart={joinAndStart}
                        onOpenInCalendar={openInCalendar}
                      />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </section>

        <aside className="custom-scrollbar flex flex-col gap-3 md:min-h-0 md:overflow-y-auto">
          <ScheduleMeetingCard
            onCreate={cal.createEvent}
            onOpenLink={(url) => void openLink(url)}
          />
          <TasksCard
            className="md:min-h-[180px] md:flex-1"
            canUseTasks={cal.canUseTasks}
            tasks={cal.tasks}
            loading={cal.tasksLoading}
            error={cal.tasksError}
            onAdd={cal.addTask}
            onComplete={cal.completeTask}
            onRefresh={() => void cal.refreshTasks()}
            onReconnect={() => void cal.connect()}
          />
        </aside>
      </div>
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────

function AccountMenu({
  email,
  onDisconnect,
}: {
  email: string | null;
  onDisconnect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setConfirm(false);
  }, [open]);

  const initial = (email?.[0] ?? "G").toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-7 max-w-[220px] items-center gap-1.5 rounded-md border border-border-subtle bg-surface-overlay/60 ps-1 pe-1.5 text-[11px] text-text-secondary outline-none hover:border-border-default hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
        title={email ?? "Google account"}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-signal-meetings/20 text-[10px] font-semibold text-signal-meetings">
          {initial}
        </span>
        <span className="hidden truncate sm:inline">
          {email ?? "Google account"}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 transition-transform duration-150",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-full z-30 mt-1.5 w-60 rounded-lg border border-border-subtle bg-surface-raised p-1.5 shadow-xl shadow-black/40 animate-fade-in-scale"
        >
          <p className="m-0 truncate px-2 pb-1.5 pt-1 text-[11px] text-text-tertiary">
            Connected as{" "}
            <span className="text-text-secondary">{email ?? "Google"}</span>
          </p>
          {confirm ? (
            <div className="space-y-1.5 px-2 pb-1 pt-0.5">
              <p className="m-0 text-[11.5px] leading-snug text-text-secondary">
                Disconnect Google Calendar? Reminders stop until you connect
                again.
              </p>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-7 flex-1 text-[11px]"
                  onClick={() => {
                    setOpen(false);
                    onDisconnect();
                  }}
                >
                  Disconnect
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 flex-1 text-[11px]"
                  onClick={() => setConfirm(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => setConfirm(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[12px] text-text-secondary hover:bg-destructive-muted hover:text-destructive"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              Disconnect Google
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectState({
  connecting,
  error,
  onConnect,
  onCancel,
}: {
  connecting: boolean;
  error: string | null;
  onConnect: () => void;
  onCancel: () => void;
}) {
  const features = [
    {
      icon: CalendarDays,
      title: "Your week at a glance",
      body: "Meetings and interviews for the next 7 days.",
    },
    {
      icon: Mic,
      title: "Join with the assistant ready",
      body: "Opens the call and starts listening in one click.",
    },
    {
      icon: Bell,
      title: "A nudge before it starts",
      body: "A reminder 2 minutes before each call.",
    },
  ];
  return (
    <div className="custom-scrollbar flex h-full min-h-0 w-full items-center justify-center overflow-y-auto px-4 py-6">
      <div className="w-full max-w-md text-center animate-panel-in">
        <div className="relative mx-auto mb-4 h-14 w-14">
          <span className="absolute -inset-1.5 rounded-[20px] bg-signal-meetings/10 blur-md" />
          <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-signal-meetings/30 bg-surface-raised text-signal-meetings">
            <CalendarDays className="h-6 w-6" aria-hidden />
          </span>
          <span className="absolute -bottom-1 -end-1 flex h-6 w-6 items-center justify-center rounded-full border border-border-subtle bg-surface-overlay text-success">
            <Video className="h-3 w-3" aria-hidden />
          </span>
        </div>
        <h2 className="m-0 text-base font-semibold tracking-tight text-text-primary">
          Connect Google Calendar
        </h2>
        <p className="mx-auto mt-1.5 mb-0 max-w-sm text-[12.5px] leading-relaxed text-text-secondary">
          See what&apos;s coming up, join Meet, Zoom or Teams calls with one
          click, and have the assistant listening from the first question.
        </p>

        <ul className="m-0 mt-5 list-none space-y-2 p-0 text-start">
          {features.map((f, i) => (
            <li
              key={f.title}
              className="animate-list-in flex items-start gap-3 rounded-lg border border-border-subtle bg-surface-raised/60 px-3 py-2.5"
              style={{ animationDelay: `${80 + i * 60}ms` }}
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-muted text-accent-text">
                <f.icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-text-primary">
                  {f.title}
                </span>
                <span className="block text-[11.5px] text-text-tertiary">
                  {f.body}
                </span>
              </span>
            </li>
          ))}
        </ul>

        {error && (
          <p
            role="alert"
            className="mt-4 mb-0 rounded-md border border-destructive/30 bg-destructive-muted px-3 py-2 text-[12px] text-destructive animate-fade-in-up"
          >
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-col items-center gap-2">
          {connecting ? (
            <>
              <div
                role="status"
                className="flex items-center gap-2 text-[12.5px] text-text-secondary"
              >
                <Loader2 className="h-4 w-4 animate-spin text-accent-text" />
                Finish signing in in your browser…
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={onCancel}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              type="button"
              onClick={onConnect}
              className="h-9 gap-2 px-5 shadow-md shadow-accent/25"
            >
              <CalendarDays className="h-4 w-4" aria-hidden />
              Connect Google Calendar
            </Button>
          )}
          <p className="m-0 max-w-xs text-[11px] leading-relaxed text-text-tertiary">
            Sign-in happens in your browser. Access stays encrypted on this
            device and you can disconnect at any time.
          </p>
        </div>
      </div>
    </div>
  );
}

function CenteredState({
  icon,
  title,
  body,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  hint?: string;
}) {
  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center px-4 py-6">
      <div className="max-w-sm text-center animate-panel-in">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border-subtle bg-surface-raised text-text-tertiary">
          {icon}
        </span>
        <h2 className="m-0 text-sm font-semibold text-text-primary">{title}</h2>
        <p className="mt-1.5 mb-0 text-[12.5px] leading-relaxed text-text-secondary">
          {body}
        </p>
        {hint && (
          <p className="mt-3 mb-0 rounded-md border border-border-subtle bg-surface-inset px-3 py-2 font-mono text-[11px] text-text-tertiary">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2 pt-3">
      <div className="h-3 w-24 animate-skeleton rounded" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[58px] animate-skeleton rounded-lg" />
      ))}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="h-8 w-48 animate-skeleton rounded-md" />
      <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_288px]">
        <div className="surface-panel animate-skeleton" />
        <div className="surface-panel hidden animate-skeleton md:block" />
      </div>
    </div>
  );
}
