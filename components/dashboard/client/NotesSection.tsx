"use client";

import * as React from "react";
import { Download, FileDown, NotebookPen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import SafeMarkdown from "@/components/SafeMarkdown";
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  Pagination,
  Pill,
  SearchInput,
  useConfirm,
} from "../ui";
import { useToast } from "../toast";
import { useApi } from "@/lib/use-api";
import { deleteNote, listNotes } from "@/lib/dashboard-api";
import { useExport } from "@/hooks/useExport";
import { formatDateTime, humanizeKey } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE = 10;

const TAG_LABELS: Record<string, string> = {
  assistant: "Assistant",
  "ask-ai": "Ask AI",
  ask_ai: "Ask AI",
  summary: "Summary",
};

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function NotesSection() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [search, setSearch] = React.useState("");
  const q = useDebounced(search.trim());
  const [page, setPage] = React.useState(1);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const { exportNotes, isExporting } = useExport();

  React.useEffect(() => setPage(1), [q]);

  const notes = useApi((signal) => listNotes({ page, limit: PAGE, q: q || undefined }, signal), [page, q]);
  const rows = notes.data?.notes ?? [];
  const total = notes.data?.pagination.total ?? 0;

  const remove = async (id: string) => {
    const ok = await confirm({
      title: "Delete this note?",
      description: "It will be removed from your saved answers. This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteNote(id);
      notes.setData((prev) =>
        prev
          ? {
              ...prev,
              notes: prev.notes.filter((n) => n.id !== id),
              pagination: { ...prev.pagination, total: Math.max(0, prev.pagination.total - 1) },
            }
          : prev,
      );
      toast.success("Note deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the note");
    }
  };

  return (
    <>
      {dialog}
      <PageHeader
        title="Saved answers"
        description="Answers and notes you saved from the assistant. Export them to review after the call."
        actions={
          <>
            <Button variant="outline" disabled={isExporting || total === 0} onClick={() => void exportNotes("markdown")}>
              <FileDown className="mr-1.5 h-3.5 w-3.5" /> Markdown
            </Button>
            <Button variant="outline" disabled={isExporting || total === 0} onClick={() => void exportNotes("pdf")}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> PDF
            </Button>
          </>
        }
      />

      <div className="mb-4 max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder="Search saved answers…" />
      </div>

      {notes.error && (
        <div className="mb-4">
          <ErrorBanner message={notes.error} onRetry={notes.reload} />
        </div>
      )}

      {notes.loading ? (
        <Card>
          <LoadingBlock rows={4} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={NotebookPen}
            title={q ? "No notes match your search" : "No saved answers yet"}
            description={q ? "Try a different word." : "Use the save button on any assistant answer to keep it here."}
          />
        </Card>
      ) : (
        <div className={cn("space-y-3 transition-opacity", notes.refreshing && "opacity-60")}>
          {rows.map((n) => {
            const open = expanded === n.id;
            return (
              <article key={n.id} className="rounded-xl border border-border-subtle bg-surface-raised">
                <header className="flex items-center gap-2 px-4 pt-3">
                  {n.tag && <Pill tone="accent">{TAG_LABELS[n.tag] ?? humanizeKey(n.tag)}</Pill>}
                  <span className="text-xs text-text-tertiary">{formatDateTime(n.createdAt)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto hover:bg-destructive-muted hover:text-destructive"
                    onClick={() => void remove(n.id)}
                    aria-label="Delete note"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </header>
                <div
                  className={cn(
                    "dash-md relative px-4 pb-3 text-[13px] leading-relaxed text-text-primary",
                    !open && "max-h-40 overflow-hidden",
                  )}
                >
                  <SafeMarkdown>{n.content}</SafeMarkdown>
                  {!open && n.content.length > 400 && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface-raised to-transparent" />
                  )}
                </div>
                {n.content.length > 400 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : n.id)}
                    className="w-full border-t border-border-subtle px-4 py-2 text-left text-xs font-medium text-text-secondary hover:text-text-primary"
                  >
                    {open ? "Show less" : "Show more"}
                  </button>
                )}
              </article>
            );
          })}
          <Pagination
            offset={(page - 1) * PAGE}
            limit={PAGE}
            total={total}
            onChange={(off) => setPage(Math.floor(off / PAGE) + 1)}
          />
        </div>
      )}
    </>
  );
}
