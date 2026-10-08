"use client";

import React from "react";
import {
  overlayTextBlock,
  overlayTextShadow,
} from "@/components/compact/compactTextStyles";
import { TranscriptionSegment } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TranscriptionLineProps {
  segment: TranscriptionSegment;
  isFinal?: boolean;
  className?: string;
}

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

export function TranscriptionLine({
  segment,
  isFinal = false,
  className,
}: TranscriptionLineProps) {
  const final = isFinal || segment.isFinal;
  const isMe = segment.source === "me";
  return (
    <div
      className={cn(
        "flex items-baseline gap-2.5 px-2.5 py-1.5 break-words transition-colors",
        overlayTextBlock,
        overlayTextShadow,
        isMe && "bg-emerald-500/[0.07]",
        className,
      )}
    >
      {segment.source ? (
        <span
          className={cn(
            "w-[68px] shrink-0 text-[10px] font-semibold uppercase tracking-wide",
            isMe ? "text-emerald-300" : "text-sky-300",
          )}
        >
          {isMe ? "Me" : "Interviewer"}
        </span>
      ) : (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-tertiary">
          {formatTime(segment.startTime)}
        </span>
      )}
      {/* dir="auto": Arabic lines read right-to-left, others left-to-right. */}
      <span
        dir="auto"
        className={cn(
          "min-w-0 flex-1 text-[15px] leading-relaxed",
          final ? "text-text-primary" : "italic text-text-secondary",
        )}
      >
        {segment.text}
        {!final && (
          <span className="ml-1 inline-block animate-pulse text-accent-text">…</span>
        )}
      </span>
    </div>
  );
}
