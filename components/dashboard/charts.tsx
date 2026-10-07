"use client";

/**
 * Lightweight SVG charts for the dashboards (no chart library).
 *
 * Conventions (see the dataviz rules these follow):
 *  - one series per chart, so no legend — the card title names it;
 *  - 2px line + ~10% area fill, bars ≤ 24px with 4px rounded data ends;
 *  - hairline solid grid one step off the surface; text in text tokens;
 *  - crosshair + tooltip on time series, per-mark tooltip on bars, the same
 *    readout on keyboard focus; every chart has a table view.
 */

import * as React from "react";
import { BarChart3, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCompact, formatNumber } from "@/lib/format";
import { Card, EmptyState } from "./ui";

export interface SeriesPoint {
  /** Epoch ms of the bucket start. */
  t: number;
  value: number;
}

const SERIES_COLOR = "var(--accent)";
const GRID_COLOR = "var(--border-subtle)";

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T | null>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Axis max = 4 gridline steps of 1/2/5 × 10^n, so counts get whole-number ticks. */
function niceMax(v: number): number {
  const raw = v / 4;
  if (raw <= 1) return 4;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / exp;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
  return step * 4;
}

function Tooltip({
  x,
  y,
  containerWidth,
  value,
  label,
}: {
  x: number;
  y: number;
  containerWidth: number;
  value: string;
  label: string;
}) {
  const flip = x > containerWidth - 140;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[96px] rounded-md border border-border-default bg-surface-overlay px-2.5 py-1.5 shadow-lg"
      style={{
        left: flip ? undefined : x + 12,
        right: flip ? containerWidth - x + 12 : undefined,
        top: Math.max(0, y - 18),
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="h-0.5 w-2.5 rounded-full" style={{ background: SERIES_COLOR }} aria-hidden />
        <span className="text-[13px] font-semibold tabular-nums text-text-primary">{value}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-text-tertiary">{label}</div>
    </div>
  );
}

/* ───────────────────────────── Time series (area) ───────────────────────────── */

export function AreaChart({
  points,
  height = 200,
  formatX,
  valueLabel = "events",
}: {
  points: ReadonlyArray<SeriesPoint>;
  height?: number;
  formatX: (t: number) => string;
  valueLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = React.useState<number | null>(null);

  const m = { top: 10, right: 8, bottom: 22, left: 34 };
  const w = Math.max(0, width - m.left - m.right);
  const h = height - m.top - m.bottom;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const n = points.length;
  const xAt = (i: number) => m.left + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const yAt = (v: number) => m.top + h - (v / max) * h;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join("");
  const area = n > 0 ? `${line}L${xAt(n - 1).toFixed(1)},${m.top + h}L${xAt(0).toFixed(1)},${m.top + h}Z` : "";
  const gridValues = [0, max / 4, max / 2, (3 * max) / 4, max];
  const tickCount = Math.min(n, width < 420 ? 3 : 5);
  const tickIdx =
    tickCount <= 1 ? [0] : Array.from({ length: tickCount }, (_, k) => Math.round((k * (n - 1)) / (tickCount - 1)));

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / Math.max(1, rect.width);
    setActive(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
    else return;
    e.preventDefault();
  };

  const activePoint = active != null ? points[active] : null;

  return (
    <div
      ref={ref}
      className="relative w-full select-none outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
      style={{ height }}
      tabIndex={0}
      role="img"
      aria-label={`Time series of ${valueLabel}. Use arrow keys to read values.`}
      onKeyDown={onKey}
      onFocus={() => setActive((a) => a ?? n - 1)}
      onBlur={() => setActive(null)}
    >
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible">
          {gridValues.map((v) => (
            <g key={v}>
              <line x1={m.left} x2={m.left + w} y1={yAt(v)} y2={yAt(v)} stroke={GRID_COLOR} strokeWidth={1} />
              <text
                x={m.left - 8}
                y={yAt(v)}
                dy="0.32em"
                textAnchor="end"
                className="fill-text-tertiary text-[10px] tabular-nums"
              >
                {formatCompact(v)}
              </text>
            </g>
          ))}
          {tickIdx.map((i) => (
            <text
              key={i}
              x={xAt(i)}
              y={height - 6}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              className="fill-text-tertiary text-[10px]"
            >
              {points[i] ? formatX(points[i].t) : ""}
            </text>
          ))}
          <path d={area} fill={SERIES_COLOR} fillOpacity={0.1} />
          <path d={line} fill="none" stroke={SERIES_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {activePoint && active != null && (
            <g>
              <line x1={xAt(active)} x2={xAt(active)} y1={m.top} y2={m.top + h} stroke="var(--border-strong)" strokeWidth={1} />
              <circle
                cx={xAt(active)}
                cy={yAt(activePoint.value)}
                r={4}
                fill={SERIES_COLOR}
                stroke="var(--surface-raised)"
                strokeWidth={2}
              />
            </g>
          )}
          <rect
            x={m.left}
            y={m.top}
            width={w}
            height={h}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}
      {activePoint && active != null && (
        <Tooltip
          x={xAt(active)}
          y={yAt(activePoint.value)}
          containerWidth={width}
          value={`${formatNumber(activePoint.value)} ${valueLabel}`}
          label={formatX(activePoint.t)}
        />
      )}
    </div>
  );
}

/* ───────────────────────────── Columns (daily counts) ───────────────────────────── */

/** Rect with only the top corners rounded — the data end; the baseline end stays square. */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function ColumnChart({
  points,
  height = 200,
  formatX,
  valueLabel = "events",
}: {
  points: ReadonlyArray<SeriesPoint>;
  height?: number;
  formatX: (t: number) => string;
  valueLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = React.useState<number | null>(null);
  const m = { top: 10, right: 8, bottom: 22, left: 34 };
  const w = Math.max(0, width - m.left - m.right);
  const h = height - m.top - m.bottom;
  const n = points.length;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const band = n > 0 ? w / n : w;
  const barW = Math.max(2, Math.min(24, band - 2));
  const xAt = (i: number) => m.left + i * band + (band - barW) / 2;
  const yAt = (v: number) => m.top + h - (v / max) * h;
  const gridValues = [0, max / 4, max / 2, (3 * max) / 4, max];
  const tickCount = Math.min(n, width < 420 ? 3 : 6);
  const tickIdx =
    tickCount <= 1 ? [0] : Array.from({ length: tickCount }, (_, k) => Math.round((k * (n - 1)) / (tickCount - 1)));

  const activePoint = active != null ? points[active] : null;

  return (
    <div
      ref={ref}
      className="relative w-full select-none outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
      style={{ height }}
      tabIndex={0}
      role="img"
      aria-label={`Column chart of ${valueLabel}. Use arrow keys to read values.`}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
        else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
        else return;
        e.preventDefault();
      }}
      onFocus={() => setActive((a) => a ?? n - 1)}
      onBlur={() => setActive(null)}
      onPointerLeave={() => setActive(null)}
    >
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible">
          {gridValues.map((v) => (
            <g key={v}>
              <line x1={m.left} x2={m.left + w} y1={yAt(v)} y2={yAt(v)} stroke={GRID_COLOR} strokeWidth={1} />
              <text x={m.left - 8} y={yAt(v)} dy="0.32em" textAnchor="end" className="fill-text-tertiary text-[10px] tabular-nums">
                {formatCompact(v)}
              </text>
            </g>
          ))}
          {tickIdx.map((i) => (
            <text
              key={i}
              x={xAt(i) + barW / 2}
              y={height - 6}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              className="fill-text-tertiary text-[10px]"
            >
              {points[i] ? formatX(points[i].t) : ""}
            </text>
          ))}
          {points.map((p, i) => (
            <g key={p.t}>
              <path
                d={topRoundedRect(xAt(i), yAt(p.value), barW, m.top + h - yAt(p.value), 4)}
                fill={SERIES_COLOR}
                opacity={active == null || active === i ? 1 : 0.55}
              />
              {/* Hit area: the whole band, taller than the mark. */}
              <rect
                x={m.left + i * band}
                y={m.top}
                width={band}
                height={h}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
              />
            </g>
          ))}
        </svg>
      )}
      {activePoint && active != null && (
        <Tooltip
          x={xAt(active) + barW / 2}
          y={yAt(activePoint.value)}
          containerWidth={width}
          value={`${formatNumber(activePoint.value)} ${valueLabel}`}
          label={formatX(activePoint.t)}
        />
      )}
    </div>
  );
}

/* ───────────────────────────── Ranked bars (categories) ───────────────────────────── */

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Secondary readout for the tooltip, e.g. "3 errors · avg 1.2s". */
  detail?: string;
}

export function BarList({
  data,
  valueLabel = "events",
  max: maxRows = 8,
}: {
  data: ReadonlyArray<BarDatum>;
  valueLabel?: string;
  max?: number;
}) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, maxRows);
  const rest = sorted.slice(maxRows);
  if (rest.length > 0) {
    shown.push({
      key: "__other",
      label: `Other (${rest.length})`,
      value: rest.reduce((s, d) => s + d.value, 0),
    });
  }
  const max = Math.max(1, ...shown.map((d) => d.value));
  const [active, setActive] = React.useState<string | null>(null);

  return (
    <ul className="space-y-2.5">
      {shown.map((d) => (
        <li
          key={d.key}
          className="relative"
          tabIndex={0}
          onPointerEnter={() => setActive(d.key)}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(d.key)}
          onBlur={() => setActive(null)}
          aria-label={`${d.label}: ${formatNumber(d.value)} ${valueLabel}${d.detail ? `, ${d.detail}` : ""}`}
        >
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-text-secondary">{d.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-text-primary">{formatCompact(d.value)}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-surface-overlay/60">
            <div
              className="h-full rounded-full transition-[width,opacity] duration-300"
              style={{
                width: `${Math.max(1.5, (d.value / max) * 100)}%`,
                background: SERIES_COLOR,
                opacity: active == null || active === d.key ? 1 : 0.55,
              }}
            />
          </div>
          {active === d.key && d.detail && (
            <div className="pointer-events-none absolute right-0 top-full z-10 mt-1 rounded-md border border-border-default bg-surface-overlay px-2.5 py-1.5 text-[11px] text-text-secondary shadow-lg">
              <span className="font-semibold tabular-nums text-text-primary">
                {formatNumber(d.value)} {valueLabel}
              </span>
              <span className="ml-1.5">{d.detail}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────────── Chart card with table view ───────────────────────────── */

export function ChartCard({
  title,
  description,
  actions,
  chart,
  table,
  isEmpty,
  emptyText = "No activity in this period yet.",
  dimmed,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  chart: React.ReactNode;
  table: { headers: [string, string]; rows: ReadonlyArray<[string, string]> };
  isEmpty?: boolean;
  emptyText?: string;
  dimmed?: boolean;
  className?: string;
}) {
  const [view, setView] = React.useState<"chart" | "table">("chart");
  return (
    <Card
      title={title}
      description={description}
      className={className}
      dimmed={dimmed}
      actions={
        <>
          {actions}
          <button
            type="button"
            onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-overlay hover:text-text-primary"
            aria-label={view === "chart" ? "Show as table" : "Show as chart"}
            title={view === "chart" ? "Show as table" : "Show as chart"}
          >
            {view === "chart" ? <Table2 className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
          </button>
        </>
      }
    >
      {isEmpty ? (
        <EmptyState icon={BarChart3} title={emptyText} />
      ) : view === "chart" ? (
        chart
      ) : (
        <div className="dash-scroll max-h-[260px] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-text-tertiary">
                <th className="pb-2 font-medium">{table.headers[0]}</th>
                <th className="pb-2 text-right font-medium">{table.headers[1]}</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map(([a, b], i) => (
                <tr key={`${a}-${i}`} className={cn("border-t border-border-subtle")}>
                  <td className="py-1.5 text-text-secondary">{a}</td>
                  <td className="py-1.5 text-right tabular-nums text-text-primary">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * Densify sparse `{bucket,…}` rows (bucket = index since `sinceMs`) into a
 * continuous series so gaps render as zero instead of being bridged.
 */
export function densifyBuckets<T extends { bucket: number }>(
  rows: ReadonlyArray<T>,
  sinceMs: number,
  bucketSeconds: number,
  value: (row: T) => number,
  nowMs = Date.now(),
): SeriesPoint[] {
  const byBucket = new Map(rows.map((r) => [Math.floor(Number(r.bucket)), value(r)]));
  // floor, not ceil: the client clock runs a little past the server's
  // `since`, which would otherwise add an empty trailing bucket.
  const maxBucket = rows.length ? Math.max(...byBucket.keys()) : -1;
  const count = Math.max(1, Math.floor((nowMs - sinceMs) / (bucketSeconds * 1000)), maxBucket + 1);
  return Array.from({ length: count }, (_, i) => ({
    t: sinceMs + i * bucketSeconds * 1000,
    value: byBucket.get(i) ?? 0,
  }));
}
