"use client";

/** Upload knowledge files from the assistant views (the same library as the
 *  dashboard's Knowledge base). Any material the candidate wants answers to
 *  come from: CV, project stories, notes, prepared answers. */

import { BookOpen, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { createKnowledge } from "@/lib/knowledge";
import { DOCUMENT_ACCEPT, parseDocumentFile } from "@/lib/resume-parser";
import { cn } from "@/lib/utils";

type Status =
  | { state: "idle" }
  | { state: "busy"; done: number; total: number }
  | { state: "done"; added: number; failed: string[] };

export function KnowledgeUploadButton({
  className,
  buttonClassName,
}: {
  className?: string;
  buttonClassName?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    const failed: string[] = [];
    let added = 0;
    setStatus({ state: "busy", done: 0, total: files.length });
    for (const [i, file] of files.entries()) {
      try {
        const parsed = await parseDocumentFile(file, { maxChars: 200_000 });
        if (!parsed.text.trim()) throw new Error("no readable text");
        await createKnowledge(parsed.fileName, parsed.text);
        added++;
      } catch (err) {
        failed.push(`${file.name}${err instanceof Error ? ` (${err.message})` : ""}`);
      }
      setStatus({ state: "busy", done: i + 1, total: files.length });
    }
    setStatus({ state: "done", added, failed });
  };

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={DOCUMENT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void upload(files);
        }}
      />
      <Button
        type="button"
        size="sm"
        className={cn("h-7 gap-1.5 text-[10px]", buttonClassName)}
        disabled={status.state === "busy"}
        onClick={() => inputRef.current?.click()}
        title="CV, project stories, notes, prepared answers — answers come from these files first"
      >
        {status.state === "busy" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <BookOpen className="h-3 w-3" />
        )}
        {status.state === "busy"
          ? `Uploading ${status.done}/${status.total}…`
          : "Upload knowledge files"}
      </Button>
      {status.state === "done" ? (
        <span
          className={cn(
            "text-[10px]",
            status.failed.length ? "text-destructive" : "text-accent-text",
          )}
        >
          {status.added > 0 &&
            `${status.added} file${status.added === 1 ? "" : "s"} added — answers use them first.`}
          {status.failed.length > 0 && ` Couldn't add: ${status.failed.join(", ")}`}
        </span>
      ) : (
        <span className="text-[10px] text-text-tertiary">
          CV, stories, notes, prepared answers · several at once
        </span>
      )}
    </div>
  );
}
