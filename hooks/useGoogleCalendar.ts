"use client";

/** Google Calendar / Tasks state for the Meetings panel: account status,
 *  the next 7 days of events (refreshed every few minutes, which also
 *  re-arms the main process's meeting reminders) and open tasks. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CalendarEvent,
  type GoogleAccountStatus,
  type GoogleTask,
  type NewCalendarEventInput,
  calendarApi,
} from "@/lib/calendar";

const REFRESH_MS = 3 * 60 * 1000;
/** Window focus refreshes only when the list is at least this old. */
const FOCUS_REFRESH_MS = 60 * 1000;

type Failure = { ok: false; code: string; error: string };

export function useGoogleCalendar() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<GoogleAccountStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<GoogleTask[] | null>(null);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const lastUpdatedRef = useRef<number>(0);
  const inFlight = useRef(false);

  const loadStatus = useCallback(async () => {
    const api = calendarApi();
    if (!api) return null;
    const res = await api.getStatus();
    if (res.ok) setStatus(res.data);
    return res.ok ? res.data : null;
  }, []);

  /** An expired / revoked sign-in drops back to "connect". */
  const handleFailure = useCallback(
    (res: Failure, setErr: (msg: string | null) => void) => {
      if (res.code === "reauth" || res.code === "not-connected") {
        setEvents(null);
        setTasks(null);
        void loadStatus();
      }
      setErr(res.error);
    },
    [loadStatus],
  );

  const refreshEvents = useCallback(async () => {
    const api = calendarApi();
    if (!api || inFlight.current) return;
    inFlight.current = true;
    setEventsLoading(true);
    try {
      const res = await api.listEvents();
      if (res.ok) {
        setEvents(res.data);
        setError(null);
        const now = Date.now();
        lastUpdatedRef.current = now;
        setLastUpdated(now);
      } else {
        handleFailure(res, setError);
      }
    } finally {
      inFlight.current = false;
      setEventsLoading(false);
    }
  }, [handleFailure]);

  const refreshTasks = useCallback(async () => {
    const api = calendarApi();
    if (!api) return;
    setTasksLoading(true);
    try {
      const res = await api.listTasks();
      if (res.ok) {
        setTasks(res.data);
        setTasksError(null);
      } else {
        handleFailure(res, setTasksError);
      }
    } finally {
      setTasksLoading(false);
    }
  }, [handleFailure]);

  useEffect(() => {
    const api = calendarApi();
    setAvailable(!!api);
    if (api) void loadStatus();
  }, [loadStatus]);

  const connected = !!status?.connected;
  const canUseTasks = connected && !!status?.canUseTasks;

  // Initial load + periodic refresh while connected.
  useEffect(() => {
    if (!connected) return;
    void refreshEvents();
    const id = window.setInterval(() => void refreshEvents(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [connected, refreshEvents]);

  useEffect(() => {
    if (canUseTasks) void refreshTasks();
  }, [canUseTasks, refreshTasks]);

  // Coming back to the app refreshes a stale list.
  useEffect(() => {
    if (!connected) return;
    const onFocus = () => {
      if (Date.now() - lastUpdatedRef.current > FOCUS_REFRESH_MS) {
        void refreshEvents();
      }
    };
    const off = window.electronAPI?.onWindowFocus?.(onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      off?.();
      window.removeEventListener("focus", onFocus);
    };
  }, [connected, refreshEvents]);

  const connect = useCallback(async () => {
    const api = calendarApi();
    if (!api) return;
    setConnecting(true);
    setError(null);
    try {
      const res = await api.connect();
      if (res.ok) setStatus(res.data);
      else if (res.code !== "cancelled") setError(res.error);
    } finally {
      setConnecting(false);
    }
  }, []);

  const cancelConnect = useCallback(async () => {
    await calendarApi()?.cancelConnect();
  }, []);

  const disconnect = useCallback(async () => {
    const api = calendarApi();
    if (!api) return;
    const res = await api.disconnect();
    if (res.ok) setStatus(res.data);
    setEvents(null);
    setTasks(null);
    setError(null);
    setTasksError(null);
  }, []);

  const createEvent = useCallback(
    async (input: NewCalendarEventInput) => {
      const api = calendarApi();
      if (!api) return { ok: false as const, error: "Desktop app only." };
      const res = await api.createEvent(input);
      if (!res.ok) {
        handleFailure(res, () => {});
        return { ok: false as const, error: res.error };
      }
      void refreshEvents();
      return { ok: true as const, event: res.data };
    },
    [handleFailure, refreshEvents],
  );

  const openLink = useCallback(async (url: string) => {
    const res = await calendarApi()?.openLink(url);
    return !!res?.ok && res.data;
  }, []);

  const addTask = useCallback(
    async (title: string, due?: string) => {
      const api = calendarApi();
      if (!api) return false;
      const res = await api.addTask({ title, due });
      if (!res.ok) {
        handleFailure(res, setTasksError);
        return false;
      }
      setTasksError(null);
      setTasks((list) => [res.data, ...(list ?? [])]);
      return true;
    },
    [handleFailure],
  );

  const completeTask = useCallback(
    async (id: string) => {
      const api = calendarApi();
      if (!api) return false;
      // Optimistic: drop it now, put it back if Google refuses.
      let removed: GoogleTask | undefined;
      let index = -1;
      setTasks((list) => {
        if (!list) return list;
        index = list.findIndex((t) => t.id === id);
        removed = list[index];
        return list.filter((t) => t.id !== id);
      });
      const res = await api.completeTask(id);
      if (!res.ok) {
        handleFailure(res, setTasksError);
        const back = removed;
        if (back) {
          setTasks((list) => {
            const next = [...(list ?? [])];
            next.splice(Math.max(0, index), 0, back);
            return next;
          });
        }
        return false;
      }
      return true;
    },
    [handleFailure],
  );

  return {
    available,
    status,
    connected,
    canUseTasks,
    connecting,
    events,
    eventsLoading,
    lastUpdated,
    error,
    dismissError: () => setError(null),
    refreshEvents,
    connect,
    cancelConnect,
    disconnect,
    createEvent,
    openLink,
    tasks,
    tasksLoading,
    tasksError,
    refreshTasks,
    addTask,
    completeTask,
  };
}

export type GoogleCalendarState = ReturnType<typeof useGoogleCalendar>;
