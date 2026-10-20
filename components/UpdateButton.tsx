"use client";

/** The app-update button, labelled so it is easy to spot: "Update" while
 *  idle, the download progress while it runs, and a bright "Restart to
 *  update" once the new version is ready. Desktop app only. */

import { CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { cn } from "@/lib/utils";

export function UpdateButton({
  variant,
  className,
}: {
  /** "titlebar": the full view's top bar. "focus": the focus-mode pill. */
  variant: "titlebar" | "focus";
  className?: string;
}) {
  const update = useAppUpdate();
  const { status } = update;
  const focus = variant === "focus";
  // The focus bar is tight: an icon until there is something to act on.
  const iconOnly =
    focus && !update.ready && !update.busy && status.type !== "error";

  const short =
    status.type === "downloaded"
      ? "Restart to update"
      : status.type === "downloading"
        ? `Updating ${Math.round(status.percent)}%`
        : status.type === "available"
          ? "Updating…"
          : status.type === "checking"
            ? "Checking…"
            : status.type === "not-available"
              ? "Up to date"
              : status.type === "error"
                ? "Update again"
                : "Update";

  const icon = update.busy ? (
    <Loader2 className={cn(focus ? "h-3.5 w-3.5" : "h-3 w-3", "animate-spin")} />
  ) : update.ready ? (
    <RefreshCw className={focus ? "h-3.5 w-3.5" : "h-3 w-3"} />
  ) : status.type === "not-available" ? (
    <CheckCircle2 className={focus ? "h-3.5 w-3.5" : "h-3 w-3"} />
  ) : (
    <Download className={focus ? "h-3.5 w-3.5" : "h-3 w-3"} />
  );

  return (
    <button
      type="button"
      onClick={update.ready ? update.install : update.check}
      disabled={update.busy}
      title={update.label}
      aria-label={update.label}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold transition-colors disabled:cursor-default",
        focus ? "h-7 text-[12px]" : "h-6 px-2.5 text-[11px]",
        focus && (iconOnly ? "w-7 justify-center px-0" : "px-2.5"),
        update.ready
          ? "bg-emerald-500 text-white shadow-[0_0_0_3px_rgba(16,185,129,0.25)] hover:bg-emerald-400"
          : update.busy
            ? "border border-sky-400/40 bg-sky-500/15 text-sky-200"
            : status.type === "error"
              ? "border border-amber-400/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
              : "border border-sky-400/50 bg-sky-500/15 text-sky-100 hover:border-sky-300/70 hover:bg-sky-500/30",
        className,
      )}
    >
      {update.ready && (
        <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-300" />
        </span>
      )}
      {icon}
      {!iconOnly && <span>{short}</span>}
      {!focus && update.version && status.type === "not-available" && (
        <span className="font-mono text-[10px] font-medium opacity-60">
          v{update.version}
        </span>
      )}
    </button>
  );
}
