"use client";

/** Past meetings: every meeting's transcript, saved on this device, read
 *  back on demand. The live transcript always starts empty. */

import { Check, ChevronLeft, Copy, FileDown, History, Loader2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TranscriptionDisplay } from "@/components/TranscriptionDisplay";
import {
  type ArchivedMeeting,
  deleteMeeting,
  getMeeting,
  listMeetings,
  type MeetingSummaryRow,
  toSegments,
} from "@/lib/transcription/meeting-archive";
import {
  downloadTranscriptMarkdown,
  formatTranscriptMarkdown,
} from "@/lib/transcription/transcript-persistence";
import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/utils";

const LANGUAGE_LABEL = { en: "English", ar: "Arabic", de: "German" } as const;

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function minutes(meeting: MeetingSummaryRow): string {
  const mins = Math.max(1, Math.round((meeting.updatedAt - meeting.startedAt) / 60000));
  return `${mins} min`;
}

export function PastMeetingsButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        title="Transcripts of your past meetings"
      >
        <span className="inline-flex items-center gap-1">
          <History className="h-3 w-3" /> Past meetings
        </span>
      </button>
      {open && <PastMeetingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function PastMeetingsDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<MeetingSummaryRow[] | null>(null);
  const [selected, setSelected] = useState<ArchivedMeeting | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    void listMeetings().then((list) => {
      if (alive) setRows(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const open = useCallback(async (id: string) => {
    setLoadingId(id);
    setConfirmDelete(false);
    const meeting = await getMeeting(id);
    setLoadingId(null);
    setSelected(meeting);
  }, []);

  const segments = selected ? toSegments(selected) : [];

  const copy = async () => {
    if (!segments.length) return;
    if (!(await copyText(formatTranscriptMarkdown(segments)))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const remove = async () => {
    if (!selected) return;
    await deleteMeeting(selected.id);
    setRows((list) => (list ?? []).filter((m) => m.id !== selected.id));
    setSelected(null);
    setConfirmDelete(false);
  };

  const action =
    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-text-tertiary transition-colors hover:bg-surface-overlay hover:text-text-primary";

  return (
    <div
      data-clickable
      role="dialog"
      aria-modal="true"
      aria-label="Past meetings"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-surface-base/80 p-4 backdrop-blur-sm animate-overlay-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(640px,calc(100vh-32px))] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-raised shadow-2xl shadow-black/40 animate-panel-in">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="flex items-center gap-2">
            {selected && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-overlay hover:text-text-primary md:hidden"
                aria-label="Back to the list"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <History className="h-4 w-4 text-text-tertiary" />
            <h2 className="m-0 text-sm font-semibold text-text-primary">Past meetings</h2>
            <span className="text-[11px] text-text-tertiary">Saved on this device</span>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-overlay hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* List */}
          <div
            className={cn(
              "custom-scrollbar min-h-0 w-full shrink-0 overflow-y-auto border-border-subtle md:w-[260px] md:border-r",
              selected && "hidden md:block",
            )}
          >
            {rows === null ? (
              <div className="flex items-center justify-center p-6 text-text-tertiary">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <p className="p-5 text-[13px] text-text-tertiary">
                No past meetings yet. When a meeting ends, its transcript is kept here.
              </p>
            ) : (
              <ul className="m-0 list-none p-2">
                {rows.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => void open(m.id)}
                      className={cn(
                        "w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-overlay",
                        selected?.id === m.id && "bg-surface-overlay",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12.5px] font-semibold text-text-primary">{when(m.startedAt)}</span>
                        {loadingId === m.id && <Loader2 className="h-3 w-3 animate-spin text-text-tertiary" />}
                      </div>
                      <div className="mt-0.5 text-[11px] text-text-tertiary">
                        {minutes(m)} · {m.words.toLocaleString()} words · {LANGUAGE_LABEL[m.language] ?? m.language}
                      </div>
                      {m.preview && (
                        <div className="mt-1 line-clamp-2 text-[12px] text-text-secondary">{m.preview}</div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Transcript */}
          <div className={cn("min-h-0 min-w-0 flex-1 flex-col", selected ? "flex" : "hidden md:flex")}>
            {selected ? (
              <>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-4 py-2">
                  <span className="text-[12px] text-text-secondary">
                    {when(selected.startedAt)} · {selected.words.toLocaleString()} words
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button type="button" className={action} onClick={() => void copy()}>
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                    <button type="button" className={action} onClick={() => downloadTranscriptMarkdown(segments)}>
                      <FileDown className="h-3 w-3" /> .md
                    </button>
                    {confirmDelete ? (
                      <>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-[11px] font-semibold text-white"
                          onClick={() => void remove()}
                        >
                          Delete
                        </button>
                        <button type="button" className={action} onClick={() => setConfirmDelete(false)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={cn(action, "hover:bg-destructive-muted hover:text-destructive")}
                        onClick={() => setConfirmDelete(true)}
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    )}
                  </div>
                </div>
                <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  <TranscriptionDisplay segments={segments} showAll />
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-text-tertiary">
                Pick a meeting to read its transcript.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
