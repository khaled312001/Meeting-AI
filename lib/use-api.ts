"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { humanizeError } from "@/lib/api-errors";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  /** True only for the first load (no data yet). */
  loading: boolean;
  /** True for any in-flight request, including background refreshes. */
  refreshing: boolean;
  reload: () => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * Minimal data-fetching hook for the dashboards. Keeps the previous data
 * while refetching (so charts and tables hold their frame instead of
 * flashing a skeleton) and aborts stale requests when deps change.
 */
export function useApi<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: React.DependencyList,
  opts: { enabled?: boolean; pollMs?: number } = {},
): ApiState<T> {
  const { enabled = true, pollMs } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fetcherRef = useRef(fetcher);
  // Callers pass primitive deps (ids, filters, page offsets); a stable
  // string key lets the effect below re-run exactly when one changes.
  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRefreshing(true);
    try {
      const result = await fetcherRef.current(controller.signal);
      if (controller.signal.aborted) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof Error && err.name === "AbortError") return;
      setError(humanizeError(err) || "Something went wrong.");
    } finally {
      if (abortRef.current === controller) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void run();
    return () => abortRef.current?.abort();
  }, [run, enabled, depsKey]);

  useEffect(() => {
    if (!enabled || !pollMs) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [run, enabled, pollMs]);

  return {
    data,
    error,
    loading: data === null && error === null && enabled,
    refreshing,
    reload: run,
    setData,
  };
}
