"use client";

import { useState, type RefObject } from "react";
import { Check, Copy, FileDown } from "lucide-react";
import { PastMeetingsButton } from "@/components/PastMeetings";
import { TranscriptionDisplay } from "@/components/TranscriptionDisplay";
import {
  overlayPanel,
  overlayTextShadow,
} from "@/components/compact/compactTextStyles";
import { Label } from "@/components/ui/label";
import { copyText } from "@/lib/copy-text";
import {
  downloadTranscriptMarkdown,
  formatTranscriptMarkdown,
} from "@/lib/transcription/transcript-persistence";
import type { TranscriptionSegment } from "@/lib/types";

interface TranscriptionCardProps {
  transcriptionBoxRef: RefObject<HTMLDivElement | null>;
  segments: TranscriptionSegment[];
  onClear: () => void;
  onScroll?: () => void;
  showLatest?: boolean;
  onJumpToLatest?: () => void;
}

export function TranscriptionCard({
  transcriptionBoxRef,
  segments,
  onClear,
  onScroll,
  showLatest = false,
  onJumpToLatest,
}: TranscriptionCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (segments.length === 0) return;
    if (!(await copyText(formatTranscriptMarkdown(segments)))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`flex h-full min-h-0 flex-col p-3 ${overlayPanel}`}>
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <Label
          htmlFor="transcription"
          className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary ${overlayTextShadow}`}
        >
          <span className="h-1.5 w-1.5 animate-recording-pulse rounded-full bg-signal-assistant" />
          Live transcript
        </Label>
        <div className="flex items-center gap-0.5">
          <PastMeetingsButton className="rounded px-2 py-1 text-[10px] font-medium text-text-tertiary transition-colors hover:bg-surface-overlay hover:text-text-secondary" />
          <button
            type="button"
            className="rounded px-2 py-1 text-[10px] font-medium text-text-tertiary transition-colors hover:bg-surface-overlay hover:text-text-secondary disabled:opacity-40"
            onClick={() => void handleCopy()}
            disabled={segments.length === 0}
            title="Copy transcript as Markdown"
          >
            {copied ? (
              <span className="inline-flex items-center gap-1">
                <Check className="h-3 w-3" /> Copied
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Copy className="h-3 w-3" /> Copy
              </span>
            )}
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-[10px] font-medium text-text-tertiary transition-colors hover:bg-surface-overlay hover:text-text-secondary disabled:opacity-40"
            onClick={() => downloadTranscriptMarkdown(segments)}
            disabled={segments.length === 0}
            title="Download transcript (.md)"
          >
            <span className="inline-flex items-center gap-1">
              <FileDown className="h-3 w-3" /> .md
            </span>
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-[10px] font-medium text-text-tertiary transition-colors hover:bg-destructive-muted hover:text-destructive"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={transcriptionBoxRef}
          onScroll={onScroll}
          className="custom-scrollbar -mr-1 h-full min-h-0 overflow-y-auto pr-1"
        >
          <TranscriptionDisplay segments={segments} />
        </div>
        {showLatest && onJumpToLatest && (
          <button
            type="button"
            onClick={onJumpToLatest}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 animate-fade-in-scale rounded-full border border-border-subtle bg-surface-raised px-3 py-1 text-[10px] font-medium text-text-secondary shadow-sm transition-colors hover:text-text-primary"
          >
            Latest ↓
          </button>
        )}
      </div>
    </div>
  );
}
