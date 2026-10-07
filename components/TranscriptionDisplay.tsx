"use client";

import React, { memo } from "react";
import { TranscriptionSegment } from "@/lib/types";
import { TranscriptionLine } from "@/components/TranscriptionLine";
import { cn } from "@/lib/utils";

interface TranscriptionDisplayProps {
  segments: TranscriptionSegment[];
  className?: string;
}

/**
 * Only the most recent MAX_RENDERED segments are rendered. Older history
 * stays in state (for prompts/export/persistence) but is dropped from the
 * DOM so multi-hour sessions don't accumulate thousands of live nodes.
 * The cap is generous — far more than a user scrolls back through.
 */
const MAX_RENDERED = 300;

const MemoizedTranscriptionLine = memo(TranscriptionLine);

export function TranscriptionDisplay({
  segments,
  className,
}: TranscriptionDisplayProps) {
  const rendered =
    segments.length > MAX_RENDERED ? segments.slice(-MAX_RENDERED) : segments;

  if (rendered.length === 0) {
    return null;
  }

  return (
    <div className={cn("w-full space-y-1", className)}>
      {rendered.map((segment) => (
        <MemoizedTranscriptionLine
          key={segment.id}
          segment={segment}
          isFinal={segment.isFinal}
        />
      ))}
    </div>
  );
}
