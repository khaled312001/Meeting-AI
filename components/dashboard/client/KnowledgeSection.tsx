"use client";

import * as React from "react";
import {
  BookOpen,
  ClipboardPaste,
  FileText,
  Loader2,
  Quote,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  Dialog,
  EmptyState,
  ErrorBanner,
  Field,
  LoadingBlock,
  Meter,
  PageHeader,
  Pill,
  Textarea,
  useConfirm,
} from "../ui";
import { useToast } from "../toast";
import { useApi } from "@/lib/use-api";
import {
  createKnowledge,
  deleteKnowledge,
  estimateTokens,
  listKnowledge,
  setKnowledgeEnabled,
  type KnowledgeDoc,
} from "@/lib/knowledge";
import { DOCUMENT_ACCEPT, parseDocumentFile } from "@/lib/resume-parser";
import { formatCompact, formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

interface UploadItem {
  id: string;
  name: string;
  state: "parsing" | "uploading" | "done" | "error";
  message?: string;
}

export function KnowledgeSection() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const list = useApi((signal) => listKnowledge(signal), []);
  const [uploads, setUploads] = React.useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const docs = list.data?.docs ?? [];
  const limits = list.data?.limits;
  const totalChars = docs.reduce((s, d) => s + d.charCount, 0);
  const enabledChars = docs.filter((d) => d.enabled).reduce((s, d) => s + d.charCount, 0);

  const patchUpload = (id: string, patch: Partial<UploadItem>) =>
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  const addDoc = (doc: KnowledgeDoc) =>
    list.setData((prev) => (prev ? { ...prev, docs: [...prev.docs, doc] } : prev));

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const maxChars = limits?.maxDocChars ?? 200_000;
    for (const file of arr) {
      const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setUploads((prev) => [...prev, { id, name: file.name, state: "parsing" }]);
      try {
        const parsed = await parseDocumentFile(file, { maxChars });
        if (!parsed.text.trim()) throw new Error("No readable text found in this file.");
        patchUpload(id, { state: "uploading" });
        const doc = await createKnowledge(parsed.fileName, parsed.text);
        addDoc(doc);
        patchUpload(id, {
          state: "done",
          message: parsed.truncated ? `Trimmed to ${formatCompact(maxChars)} characters` : undefined,
        });
      } catch (err) {
        patchUpload(id, {
          state: "error",
          message: err instanceof Error ? err.message : "Upload failed",
        });
      }
    }
    window.setTimeout(() => setUploads((prev) => prev.filter((u) => u.state === "error")), 4000);
  };

  const toggle = async (doc: KnowledgeDoc, enabled: boolean) => {
    setBusyId(doc.id);
    list.setData((prev) =>
      prev ? { ...prev, docs: prev.docs.map((d) => (d.id === doc.id ? { ...d, enabled } : d)) } : prev,
    );
    try {
      await setKnowledgeEnabled(doc.id, enabled);
    } catch (err) {
      list.setData((prev) =>
        prev
          ? { ...prev, docs: prev.docs.map((d) => (d.id === doc.id ? { ...d, enabled: !enabled } : d)) }
          : prev,
      );
      toast.error(err instanceof Error ? err.message : "Couldn't update the file");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (doc: KnowledgeDoc) => {
    const ok = await confirm({
      title: `Delete “${doc.fileName}”?`,
      description: "The assistant will stop using this file in answers. This can't be undone.",
      confirmLabel: "Delete file",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(doc.id);
    try {
      await deleteKnowledge(doc.id);
      list.setData((prev) => (prev ? { ...prev, docs: prev.docs.filter((d) => d.id !== doc.id) } : prev));
      toast.success("File deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the file");
    } finally {
      setBusyId(null);
    }
  };

  const atDocLimit = limits ? docs.length >= limits.maxDocs : false;

  return (
    <>
      {dialog}
      <PageHeader
        title="Knowledge base"
        description="Files the assistant reads before answering. Turn a file off to keep it without using it. With Anthropic, answers cite the exact passage they came from."
        actions={
          <>
            <Button variant="outline" onClick={() => setPasteOpen(true)} disabled={atDocLimit}>
              <ClipboardPaste className="mr-1.5 h-3.5 w-3.5" /> Paste text
            </Button>
            <Button onClick={() => inputRef.current?.click()} disabled={atDocLimit}>
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload files
            </Button>
          </>
        }
      />
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={DOCUMENT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {list.error && (
        <div className="mb-4">
          <ErrorBanner message={list.error} onRetry={list.reload} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!atDocLimit) void handleFiles(e.dataTransfer.files);
            }}
            disabled={atDocLimit}
            className={cn(
              "flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition-colors",
              dragOver
                ? "border-accent bg-accent-muted"
                : "border-border-strong bg-surface-raised hover:border-accent/60 hover:bg-surface-overlay/40",
              atDocLimit && "cursor-not-allowed opacity-60",
            )}
          >
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-muted text-accent-text">
              <Upload className="h-5 w-5" />
            </span>
            <span className="text-[13px] font-medium text-text-primary">
              {atDocLimit ? "File limit reached — delete a file to add more" : "Drop files here or click to browse"}
            </span>
            <span className="mt-1 text-xs text-text-tertiary">
              PDF, Word (.docx), Markdown or text · up to {formatCompact(limits?.maxDocChars ?? 200_000)} characters
              each
            </span>
          </button>

          {uploads.length > 0 && (
            <ul className="space-y-1.5">
              {uploads.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-[13px]"
                >
                  {u.state === "parsing" || u.state === "uploading" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
                  ) : (
                    <FileText className={cn("h-4 w-4", u.state === "error" ? "text-destructive" : "text-success")} />
                  )}
                  <span className="min-w-0 flex-1 truncate text-text-primary">{u.name}</span>
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      u.state === "error" ? "text-destructive" : "text-text-tertiary",
                    )}
                  >
                    {u.state === "parsing"
                      ? "Reading…"
                      : u.state === "uploading"
                        ? "Uploading…"
                        : u.state === "done"
                          ? (u.message ?? "Added")
                          : u.message}
                  </span>
                  {u.state === "error" && (
                    <button
                      type="button"
                      className="text-xs text-text-tertiary hover:text-text-primary"
                      onClick={() => setUploads((prev) => prev.filter((x) => x.id !== u.id))}
                    >
                      Dismiss
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <Card
            title="Your files"
            description={docs.length ? `${docs.length} file${docs.length === 1 ? "" : "s"}` : undefined}
            bodyClassName="p-0"
          >
            {list.loading ? (
              <div className="p-5">
                <LoadingBlock rows={3} />
              </div>
            ) : docs.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="No knowledge files yet"
                description="Upload product docs, project write-ups, case studies or meeting notes. The assistant grounds its answers in them."
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {docs.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-3 px-5 py-3">
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        doc.enabled ? "bg-accent-muted text-accent-text" : "bg-surface-overlay text-text-tertiary",
                      )}
                    >
                      <FileText className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "truncate text-[13px] font-medium",
                          doc.enabled ? "text-text-primary" : "text-text-tertiary",
                        )}
                        title={doc.fileName}
                      >
                        {doc.fileName}
                      </div>
                      <div className="mt-0.5 text-xs text-text-tertiary">
                        {formatCompact(doc.charCount)} chars · ~{formatCompact(estimateTokens(doc.charCount))} tokens ·
                        added {formatRelative(doc.createdAt)}
                      </div>
                    </div>
                    {!doc.enabled && (
                      <Pill tone="neutral" className="hidden sm:inline-flex">
                        Off
                      </Pill>
                    )}
                    <Switch
                      checked={doc.enabled}
                      disabled={busyId === doc.id}
                      onCheckedChange={(v) => void toggle(doc, v)}
                      aria-label={`Use ${doc.fileName} in answers`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busyId === doc.id}
                      onClick={() => void remove(doc)}
                      aria-label={`Delete ${doc.fileName}`}
                      className="hover:bg-destructive-muted hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Capacity">
            {limits ? (
              <div className="space-y-5">
                <Meter
                  label="Files"
                  value={docs.length}
                  max={limits.maxDocs}
                  detail={`${docs.length} / ${limits.maxDocs}`}
                />
                <Meter
                  label="Total characters"
                  value={totalChars}
                  max={limits.maxTotalChars}
                  detail={`${formatCompact(totalChars)} / ${formatCompact(limits.maxTotalChars)}`}
                />
                <p className="text-xs leading-relaxed text-text-tertiary">
                  {formatNumber(enabledChars)} characters (~{formatCompact(estimateTokens(enabledChars))} tokens) are
                  active and sent with each answer. Anthropic caches them, so repeat questions stay fast.
                </p>
              </div>
            ) : (
              <LoadingBlock rows={2} />
            )}
          </Card>

          <Card title="How it works">
            <ol className="space-y-3 text-xs leading-relaxed text-text-secondary">
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-overlay text-[10px] font-semibold text-text-primary">
                  1
                </span>
                Upload the material you&apos;d want in front of you during the call.
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-overlay text-[10px] font-semibold text-text-primary">
                  2
                </span>
                When a question comes up, the assistant reads your active files with your résumé and the transcript.
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-overlay text-[10px] font-semibold text-text-primary">
                  3
                </span>
                <span>
                  Answers show <Quote className="inline h-3 w-3" /> source chips — click one to see the exact passage.
                </span>
              </li>
            </ol>
          </Card>
        </div>
      </div>

      <PasteDialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        maxChars={limits?.maxDocChars ?? 200_000}
        onCreated={(doc) => {
          addDoc(doc);
          toast.success(`Added “${doc.fileName}”`);
        }}
      />
    </>
  );
}

function PasteDialog({
  open,
  onClose,
  maxChars,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  maxChars: number;
  onCreated: (doc: KnowledgeDoc) => void;
}) {
  const [name, setName] = React.useState("");
  const [content, setContent] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName("");
      setContent("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!content.trim()) {
      setError("Paste some text first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const doc = await createKnowledge(
        (name.trim() || "Pasted notes").slice(0, 200),
        content.slice(0, maxChars),
      );
      onCreated(doc);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add text to your knowledge base"
      description="Paste talking points, a product brief or anything else you want the assistant to know."
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" htmlFor="kb-title">
          <Input id="kb-title" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Product FAQ" />
        </Field>
        <Field
          label="Content"
          htmlFor="kb-content"
          error={error}
          hint={`${formatNumber(content.length)} / ${formatCompact(maxChars)} characters`}
        >
          <Textarea
            id="kb-content"
            rows={10}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste text here…"
          />
        </Field>
      </div>
    </Dialog>
  );
}
