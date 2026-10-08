"use client";

import * as React from "react";
import { ChevronDown, FileText, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, ErrorBanner, LoadingBlock, PageHeader, Textarea } from "../ui";
import { useToast } from "../toast";
import { useApi } from "@/lib/use-api";
import { getInterviewContext, patchInterviewContext } from "@/lib/dashboard-api";
import { DOCUMENT_ACCEPT, parseResumeFile } from "@/lib/resume-parser";
import { formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const RESUME_MAX = 30_000;
const JD_MAX = 20_000;
const NOTES_MAX = 40_000;

interface Draft {
  resumeText: string | null;
  resumeFileName: string | null;
  jobDescription: string;
  interviewNotes: string;
}

function Counter({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span className={cn("tabular-nums", over ? "text-destructive" : "text-text-tertiary")}>
      {formatNumber(value.length)} / {formatNumber(max)}
    </span>
  );
}

export function ProfileSection() {
  const toast = useToast();
  const remote = useApi((signal) => getInterviewContext(signal), []);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [parsing, setParsing] = React.useState(false);
  const [showResume, setShowResume] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const server: Draft | null = remote.data
    ? {
        resumeText: remote.data.context.resumeText,
        resumeFileName: remote.data.context.resumeFileName,
        jobDescription: remote.data.context.jobDescription ?? "",
        interviewNotes: remote.data.context.interviewNotes ?? "",
      }
    : null;

  React.useEffect(() => {
    if (server && draft === null) setDraft(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote.data]);

  const dirty =
    draft !== null &&
    server !== null &&
    (draft.resumeText !== server.resumeText ||
      draft.resumeFileName !== server.resumeFileName ||
      draft.jobDescription !== server.jobDescription ||
      draft.interviewNotes !== server.interviewNotes);

  const tooLong =
    draft !== null && (draft.jobDescription.length > JD_MAX || draft.interviewNotes.length > NOTES_MAX);

  const onResume = async (file: File) => {
    setParsing(true);
    try {
      const { text, fileName } = await parseResumeFile(file);
      if (!text.trim()) throw new Error("No readable text found in this file.");
      setDraft((d) => (d ? { ...d, resumeText: text, resumeFileName: fileName } : d));
      toast.info("Résumé read — remember to save.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read that file");
    } finally {
      setParsing(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await patchInterviewContext({
        resumeText: draft.resumeText?.trim() ? draft.resumeText : null,
        resumeFileName: draft.resumeText?.trim() ? draft.resumeFileName : null,
        jobDescription: draft.jobDescription.trim() ? draft.jobDescription : null,
        interviewNotes: draft.interviewNotes.trim() ? draft.interviewNotes : null,
      });
      remote.setData({ context: res.context });
      setDraft({
        resumeText: res.context.resumeText,
        resumeFileName: res.context.resumeFileName,
        jobDescription: res.context.jobDescription ?? "",
        interviewNotes: res.context.interviewNotes ?? "",
      });
      toast.success("Profile saved — the assistant will use it in your next answer.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Interview profile"
        description="Your background, the role and your talking points. The assistant uses these to answer as you — it never invents experience you don't have."
        actions={
          remote.data?.context.updatedAt ? (
            <span className="text-xs text-text-tertiary">
              Last saved {formatRelative(remote.data.context.updatedAt as string)}
            </span>
          ) : undefined
        }
      />

      {remote.error && (
        <div className="mb-4">
          <ErrorBanner message={remote.error} onRetry={remote.reload} />
        </div>
      )}

      {!draft ? (
        <Card>
          <LoadingBlock rows={5} />
        </Card>
      ) : (
        <div className="space-y-4 pb-20">
          <Card
            title="Résumé"
            description="PDF, Word, Markdown or text. We keep the first 6,000 characters."
            actions={
              draft.resumeText ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={parsing}>
                    <RefreshCw className="mr-1.5 h-3 w-3" /> Replace
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDraft({ ...draft, resumeText: null, resumeFileName: null })}
                    className="hover:bg-destructive-muted hover:text-destructive"
                  >
                    <Trash2 className="mr-1.5 h-3 w-3" /> Remove
                  </Button>
                </>
              ) : undefined
            }
          >
            <input
              ref={fileRef}
              type="file"
              accept={DOCUMENT_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onResume(f);
                e.target.value = "";
              }}
            />
            {draft.resumeText ? (
              <div>
                <button
                  type="button"
                  onClick={() => setShowResume((v) => !v)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border-subtle bg-surface-inset px-3 py-2.5 text-left"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-muted text-accent-text">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-text-primary">
                      {draft.resumeFileName || "Résumé"}
                    </span>
                    <span className="block text-xs text-text-tertiary">
                      {formatNumber(draft.resumeText.length)} characters
                    </span>
                  </span>
                  <ChevronDown
                    className={cn("h-4 w-4 text-text-tertiary transition-transform", showResume && "rotate-180")}
                  />
                </button>
                {showResume && (
                  <Textarea
                    className="mt-3 font-mono text-xs"
                    rows={12}
                    value={draft.resumeText}
                    maxLength={RESUME_MAX}
                    onChange={(e) => setDraft({ ...draft, resumeText: e.target.value })}
                    aria-label="Résumé text"
                  />
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={parsing}
                className="flex w-full flex-col items-center rounded-xl border border-dashed border-border-strong px-6 py-8 text-center hover:border-accent/60 hover:bg-surface-overlay/40"
              >
                {parsing ? (
                  <Loader2 className="mb-2 h-5 w-5 animate-spin text-text-tertiary" />
                ) : (
                  <Upload className="mb-2 h-5 w-5 text-accent-text" />
                )}
                <span className="text-[13px] font-medium text-text-primary">
                  {parsing ? "Reading your résumé…" : "Upload your résumé"}
                </span>
                <span className="mt-1 text-xs text-text-tertiary">Click to choose a file</span>
              </button>
            )}
          </Card>

          <Card
            title="Job description"
            description="Paste the posting or a summary of the role and company."
            actions={<span className="text-xs"><Counter value={draft.jobDescription} max={JD_MAX} /></span>}
          >
            <Textarea
              rows={8}
              value={draft.jobDescription}
              onChange={(e) => setDraft({ ...draft, jobDescription: e.target.value })}
              placeholder="e.g. Senior Backend Engineer at Acme — Go, Postgres, distributed systems…"
              aria-label="Job description"
            />
          </Card>

          <Card
            title="Talking points & notes"
            description="Stories to tell, numbers to mention, things to avoid, the tone you want."
            actions={<span className="text-xs"><Counter value={draft.interviewNotes} max={NOTES_MAX} /></span>}
          >
            <Textarea
              rows={8}
              value={draft.interviewNotes}
              onChange={(e) => setDraft({ ...draft, interviewNotes: e.target.value })}
              placeholder={"• Led the payments migration — cut latency 40%\n• Prefer remote; notice period 30 days\n• Answer in Arabic if asked in Arabic"}
              aria-label="Talking points"
            />
          </Card>
        </div>
      )}

      {dirty && (
        <div className="dash-toast-in fixed bottom-4 left-1/2 z-[95] flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-border-default bg-surface-overlay px-4 py-3 shadow-2xl lg:left-[calc(50%+7.5rem)]">
          <span className="min-w-0 flex-1 text-[13px] text-text-primary">
            {tooLong ? "Some fields are over the limit." : "You have unsaved changes."}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setDraft(server)} disabled={saving}>
            Discard
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving || tooLong}>
            {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />} Save changes
          </Button>
        </div>
      )}
    </>
  );
}
