"use client";

/** Small header over each answer: what it is, when it was written, and a
 *  copy button. */

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { AnswerKind } from "@/components/AssistantSessionProvider";
import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/utils";

export function formatClock(at: number | null | undefined): string {
  if (!at) return "";
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CopyButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-clickable
      disabled={!text.trim()}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      title={copied ? "Copied" : "Copy"}
      aria-label="Copy answer"
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-white/10 hover:text-text-primary disabled:opacity-30",
        className,
      )}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-300" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

export function AnswerHeader({
  kind = "answer",
  at,
  live = false,
  text,
  className,
}: {
  kind?: AnswerKind;
  at?: number | null;
  /** Still being written. */
  live?: boolean;
  text: string;
  className?: string;
}) {
  const clock = formatClock(at);
  return (
    <div className={cn("not-prose mb-1.5 flex items-center gap-2", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] font-semibold",
          kind === "review" ? "text-amber-300" : "text-accent-text",
        )}
      >
        {live && (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
        )}
        {kind === "review" ? "Notes on your answer" : "Answer"}
      </span>
      {clock && (
        <span className="font-mono text-[10px] tabular-nums text-text-tertiary">
          {clock}
        </span>
      )}
      <CopyButton text={text} className="ml-auto" />
    </div>
  );
}
