"use client";

/** Choose the two files for this interview — the instructions file and the
 *  feed — and show each one's name and size before starting. Only the chosen
 *  files are sent, so an older copy of a file can't slip in. */

import { FileCheck2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type KnowledgeDoc, listKnowledge } from "@/lib/knowledge";
import { type InterviewFiles, useInterviewFiles } from "@/lib/interview-files";
import { cn } from "@/lib/utils";

const ROLES: { role: keyof InterviewFiles; label: string }[] = [
  { role: "instructionsDocId", label: "Instructions" },
  { role: "feedDocId", label: "Feed" },
];

function chars(n: number): string {
  return `${n.toLocaleString("en-US")} chars`;
}

/** The user's files, reloaded when the window comes back (files uploaded
 *  elsewhere show up), with chosen files that were deleted let go. */
function useChosenFiles() {
  const { files, choose } = useInterviewFiles();
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const list = await listKnowledge(signal);
      setDocs(list.docs);
      setError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : "Could not load your files");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    // Files uploaded elsewhere show up when the window comes back.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      controller.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // A chosen file that was deleted is no longer chosen.
  useEffect(() => {
    if (!docs) return;
    for (const { role } of ROLES) {
      const id = files[role];
      if (id && !docs.some((d) => d.id === id)) choose(role, undefined);
    }
  }, [docs, files, choose]);

  const picked = ROLES.map(({ role, label }) => ({
    role,
    label,
    doc: docs?.find((d) => d.id === files[role]),
  }));
  return { files, choose, docs, error, load, picked };
}

/** One line naming the chosen files and their sizes, for before the start. */
export function InterviewFilesSummary({ className }: { className?: string }) {
  const { picked } = useChosenFiles();
  if (!picked.some((p) => p.doc)) return null;
  return (
    <p className={cn("text-[10px] text-text-tertiary", className)}>
      {picked.map(({ role, label, doc }) => (
        <span key={role} className="mr-3 inline-flex items-center gap-1">
          <FileCheck2 className="h-3 w-3 text-accent-text" />
          {label}:{" "}
          {doc ? (
            <>
              <span className="text-text-secondary">{doc.fileName}</span> ·{" "}
              {chars(doc.charCount)}
            </>
          ) : (
            "not chosen"
          )}
        </span>
      ))}
    </p>
  );
}

export function InterviewFilesPicker({ className }: { className?: string }) {
  const { files, choose, docs, error, load, picked } = useChosenFiles();
  const anyPicked = picked.some((p) => p.doc);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-semibold text-text-primary">
          Files for this interview
          <span className="ml-1.5 font-normal text-text-tertiary">
            {anyPicked ? "only these are used" : "none chosen · all enabled files are used"}
          </span>
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto text-text-tertiary transition-colors hover:text-text-primary"
          title="Reload your files"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
      <div className="grid gap-1.5 sm:grid-cols-2">
        {picked.map(({ role, label, doc }) => (
          <label key={role} className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10px] font-medium text-text-secondary">{label}</span>
            <select
              value={files[role] ?? ""}
              onChange={(e) => choose(role, e.target.value || undefined)}
              disabled={!docs}
              className="h-7 min-w-0 rounded-md border border-border-subtle bg-surface-inset px-2 text-[11px] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">{docs ? "— not chosen —" : "Loading…"}</option>
              {docs?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fileName} · {chars(d.charCount)}
                </option>
              ))}
            </select>
            {doc && (
              <span className="flex min-w-0 items-center gap-1 text-[10px] text-accent-text">
                <FileCheck2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{doc.fileName}</span>
                <span className="shrink-0 text-text-tertiary">· {chars(doc.charCount)}</span>
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
