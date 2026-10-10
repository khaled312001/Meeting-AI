"use client";

/**
 * Dashboard UI kit — cards, stat tiles, tables, drawers and form controls
 * shared by the client dashboard (/dashboard) and the admin panel (/admin).
 * Built on the app's oklch design tokens (app/globals.css).
 */

import * as React from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/utils";
import { formatCompact } from "@/lib/format";

/* ───────────────────────────── Layout ───────────────────────────── */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-text-secondary">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  dimmed,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Refetch in flight: hold the previous render at reduced opacity. */
  dimmed?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border-subtle bg-surface-raised",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[13px] font-semibold text-text-primary">{title}</h2>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-text-tertiary">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div
        className={cn(
          "p-5 transition-opacity duration-200",
          dimmed && "opacity-60",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/* ───────────────────────────── Stat tiles ───────────────────────────── */

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  hero,
}: {
  label: string;
  value: number | string | null | undefined;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "default" | "success" | "warning" | "danger";
  /** The one headline figure of the view: larger value. */
  hero?: boolean;
}) {
  const display = typeof value === "number" ? formatCompact(value) : (value ?? "—");
  return (
    <div
      className={cn(
        "flex flex-col justify-between rounded-xl border border-border-subtle bg-surface-raised p-4",
        hero && "bg-gradient-to-br from-accent-muted to-surface-raised",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-secondary">{label}</span>
        {Icon && (
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg bg-surface-overlay text-text-tertiary",
              tone === "success" && "text-success",
              tone === "warning" && "text-warning",
              tone === "danger" && "text-destructive",
              hero && "bg-accent-muted text-accent-text",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <div
        className={cn(
          "mt-3 font-semibold tabular-nums tracking-tight text-text-primary",
          hero ? "text-3xl" : "text-2xl",
        )}
        title={typeof value === "number" ? value.toLocaleString() : undefined}
      >
        {display}
      </div>
      {hint && <div className="mt-1 text-xs text-text-tertiary">{hint}</div>}
    </div>
  );
}

/** Horizontal meter. The fill carries severity; the track is a faint step of the same hue. */
export function Meter({
  value,
  max,
  label,
  detail,
}: {
  value: number;
  max: number | null;
  label?: string;
  detail?: React.ReactNode;
}) {
  const unlimited = max == null || max <= 0;
  const pct = unlimited ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const tone = pct >= 90 ? "var(--destructive)" : pct >= 75 ? "var(--warning)" : "var(--accent)";
  return (
    <div>
      {(label || detail) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
          {label && <span className="font-medium text-text-secondary">{label}</span>}
          {detail && <span className="tabular-nums text-text-tertiary">{detail}</span>}
        </div>
      )}
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{
          background: unlimited
            ? "var(--surface-overlay)"
            : `color-mix(in oklch, ${tone} 16%, transparent)`,
        }}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={unlimited ? undefined : max}
        aria-valuenow={value}
        aria-label={label}
      >
        {!unlimited && (
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${pct}%`, background: tone }}
          />
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Status ───────────────────────────── */

export type PillTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const PILL_TONES: Record<PillTone, string> = {
  neutral: "bg-surface-overlay text-text-secondary",
  success: "bg-[color-mix(in_oklch,var(--success)_14%,transparent)] text-success",
  warning: "bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] text-warning",
  danger: "bg-destructive-muted text-destructive",
  info: "bg-[color-mix(in_oklch,var(--info)_14%,transparent)] text-info",
  accent: "bg-accent-muted text-accent-text",
};

export function Pill({
  tone = "neutral",
  dot,
  children,
  className,
}: {
  tone?: PillTone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
        PILL_TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/* ───────────────────────────── Feedback ───────────────────────────── */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-text-tertiary", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-overlay", className)} />;
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-[color-mix(in_oklch,var(--destructive)_30%,transparent)] bg-destructive-muted px-4 py-3 text-[13px] text-text-primary"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary"
        >
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-surface-overlay text-text-tertiary">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-[13px] font-medium text-text-primary">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-text-tertiary">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function RefreshButton({
  onClick,
  spinning,
}: {
  onClick: () => void;
  spinning?: boolean;
}) {
  return (
    <Button variant="ghost" size="icon" onClick={onClick} aria-label="Refresh" title="Refresh">
      <RefreshCw className={cn("h-3.5 w-3.5", spinning && "animate-spin")} />
    </Button>
  );
}

/* ───────────────────────────── Form controls ───────────────────────────── */

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-text-secondary">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-text-tertiary">{hint}</p>
      ) : null}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  className,
  ariaLabel,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  className?: string;
  ariaLabel?: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 rounded-md border border-border-subtle bg-surface-inset px-2.5 text-[13px] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-md border border-border-subtle bg-surface-inset pl-8 pr-3 text-[13px] text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

/** Segmented control: small set of mutually exclusive options (filters, time ranges). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string; count?: number }>;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg border border-border-subtle bg-surface-inset p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
              active
                ? "bg-surface-overlay text-text-primary shadow-sm"
                : "text-text-tertiary hover:text-text-secondary",
            )}
          >
            {o.label}
            {o.count != null && (
              <span className="tabular-nums text-[10px] text-text-tertiary">{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={cn(
        "w-full rounded-md border border-border-subtle bg-surface-inset px-3 py-2 text-[13px] leading-relaxed text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
    />
  );
}

/* ───────────────────────────── Tables ───────────────────────────── */

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  /** Hide below the md breakpoint. */
  hideOnMobile?: boolean;
  align?: "left" | "right";
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  selectable,
  selected,
  onSelectedChange,
  dimmed,
}: {
  columns: ReadonlyArray<Column<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onSelectedChange?: (next: Set<string>) => void;
  dimmed?: boolean;
}) {
  const allIds = rows.map(rowKey);
  const allSelected = selectable && allIds.length > 0 && allIds.every((id) => selected?.has(id));
  const toggleAll = () => {
    if (!onSelectedChange) return;
    onSelectedChange(allSelected ? new Set() : new Set(allIds));
  };
  const toggleOne = (id: string) => {
    if (!onSelectedChange) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };

  if (rows.length === 0) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;

  return (
    <div className={cn("-mx-5 overflow-x-auto transition-opacity", dimmed && "opacity-60")}>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border-subtle text-left text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
            {selectable && (
              <th className="w-10 py-2 pl-5">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={Boolean(allSelected)}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
              </th>
            )}
            {columns.map((c, i) => (
              <th
                key={c.key}
                className={cn(
                  "py-2 pr-4 font-medium",
                  i === 0 && !selectable && "pl-5",
                  c.align === "right" && "text-right",
                  c.hideOnMobile && "hidden md:table-cell",
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = rowKey(row);
            return (
              <tr
                key={id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b border-border-subtle last:border-0",
                  onRowClick && "cursor-pointer hover:bg-surface-overlay/60",
                  selected?.has(id) && "bg-accent-muted",
                )}
              >
                {selectable && (
                  <td className="py-2.5 pl-5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label="Select row"
                      checked={Boolean(selected?.has(id))}
                      onChange={() => toggleOne(id)}
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                    />
                  </td>
                )}
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={cn(
                      "py-2.5 pr-4 align-middle text-text-primary",
                      i === 0 && !selectable && "pl-5",
                      c.align === "right" && "text-right tabular-nums",
                      c.hideOnMobile && "hidden md:table-cell",
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(total, offset + limit);
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-text-tertiary">
      <span className="tabular-nums">
        {from}–{to} of {total.toLocaleString()}
      </span>
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={to >= total}
          onClick={() => onChange(offset + limit)}
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────────── Overlays ───────────────────────────── */

function useEscape(open: boolean, onClose: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex justify-end" data-clickable>
      <button
        type="button"
        aria-label="Close panel"
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative flex h-full w-full flex-col border-l border-border-default bg-surface-base shadow-2xl dash-drawer-in",
          width,
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-text-primary">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-text-tertiary">{subtitle}</div>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" data-clickable>
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative w-full max-w-md rounded-xl border border-border-default bg-surface-raised shadow-2xl",
          className,
        )}
      >
        <div className="px-5 pb-2 pt-5">
          <h2 className="text-[15px] font-semibold text-text-primary">{title}</h2>
          {description && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">{description}</p>
          )}
        </div>
        {children && <div className="px-5 py-3">{children}</div>}
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
}

/**
 * Promise-based confirm dialog:
 *   const { confirm, dialog } = useConfirm();
 *   if (await confirm({ title: "Delete?" })) …
 *   return <>{dialog}…</>
 */
export function useConfirm() {
  const [state, setState] = React.useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);

  const confirm = React.useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setState({ ...opts, resolve })),
    [],
  );

  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  const dialog = (
    <Dialog
      open={state !== null}
      onClose={() => close(false)}
      title={state?.title ?? ""}
      description={state?.description}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            variant={state?.destructive ? "destructive" : "primary"}
            onClick={() => close(true)}
            autoFocus
          >
            {state?.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    />
  );

  return { confirm, dialog };
}

/* ───────────────────────────── Misc ───────────────────────────── */

export function KeyValue({
  items,
}: {
  items: ReadonlyArray<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
            {it.label}
          </dt>
          <dd className="mt-0.5 truncate text-[13px] text-text-primary">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar({ name, email, size = 32 }: { name?: string | null; email?: string | null; size?: number }) {
  const source = (name || email || "?").trim();
  const initials = source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-muted font-semibold text-accent-text"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
