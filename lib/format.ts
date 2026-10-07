/** Display formatting shared by the dashboards. */

const compactFmt = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const fullFmt = new Intl.NumberFormat();

/** 1234 → "1.2K"; small numbers stay exact. */
export function formatCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.abs(n) < 10_000 ? fullFmt.format(n) : compactFmt.format(n);
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return fullFmt.format(n);
}

export function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(typeof v === "number" && v < 1e12 ? v * 1000 : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "3 minutes ago", "yesterday", … */
export function formatRelative(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 30 * 86_400) return rtf.format(Math.round(diffSec / 86_400), "day");
  return formatDate(d);
}

/** 3_725_000 ms → "1h 2m"; 42_000 → "42s"; 2_340 → "2.3s". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms === 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Humanize a snake_case action / event name: "ask_ai_completion" → "Ask ai completion". */
export function humanizeKey(key: string): string {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}
