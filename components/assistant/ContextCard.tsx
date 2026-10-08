"use client";

/** Context toolbar on the full Assistant surface. */

import dynamic from "next/dynamic";
import {
  ChevronDown,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { memo, type ChangeEvent, type RefObject } from "react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/Kbd";
import { LiveControls } from "@/components/LiveControls";
import { hasAttachedContext } from "@/lib/prompt-context";
import { parseResumeFile } from "@/lib/resume-parser";
import { cn } from "@/lib/utils";

const RecorderTranscriber = dynamic(() => import("@/components/recorder"), {
  ssr: false,
  loading: () => (
    <div className="h-8 w-20 shrink-0 animate-skeleton rounded-md" />
  ),
});

interface ContextCardProps {
  interviewNotes: string;
  onInterviewNotesChange: (value: string) => void;
  resumeText: string | null;
  resumeFileName: string | null;
  jobDescription: string;
  onJobDescriptionChange: (value: string) => void;
  onResumeParsed: (text: string, fileName: string) => void;
  onClearResume: () => void;
  isSaving?: boolean;
  isLoading?: boolean;
  formRef: RefObject<HTMLFormElement | null>;
  isLoadingGenerate: boolean;
  onSummarize: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop: (e?: React.MouseEvent<HTMLButtonElement>) => void;
}

export const ContextCard = memo(function ContextCard({
  interviewNotes,
  onInterviewNotesChange,
  resumeText,
  resumeFileName,
  jobDescription,
  onJobDescriptionChange,
  onResumeParsed,
  onClearResume,
  isSaving = false,
  isLoading = false,
  formRef,
  isLoadingGenerate,
  onSummarize,
  onSubmit,
  onStop,
}: ContextCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const attached = hasAttachedContext({ resumeText, jobDescription });

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParseError(null);
    setIsParsing(true);
    try {
      const { text, fileName } = await parseResumeFile(file);
      onResumeParsed(text, fileName);
    } catch (err: unknown) {
      setParseError(
        err instanceof Error ? err.message : "Failed to parse file",
      );
    } finally {
      setIsParsing(false);
    }
  };

  return (
    <div className="app-toolbar shrink-0 overflow-hidden rounded-lg border border-border-subtle/40">
      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle/40 px-3 py-2">
          <RecorderTranscriber inline />

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSummarize}
            disabled={isLoadingGenerate}
            title="Summarize the conversation so far (S)"
            className="h-8 gap-1.5 text-[11px]"
          >
            <FileText className="h-3.5 w-3.5" />
            Summarize
          </Button>

          <div className="flex flex-wrap items-center gap-1.5">
            {resumeText?.trim() && <Badge variant="secondary">Resume</Badge>}
            {jobDescription.trim() && <Badge variant="secondary">JD</Badge>}
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              className="inline-flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary"
              aria-expanded={detailsOpen}
            >
              Context
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  detailsOpen && "rotate-180",
                )}
              />
            </button>
            {isSaving && (
              <span className="inline-flex items-center gap-1 text-[10px] text-text-tertiary">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving
              </span>
            )}
          </div>

          <LiveControls className="ml-auto" />

          {/* Auto mode answers on its own; Answer works in both modes. */}
          <div className="flex items-center gap-2">
            {isLoadingGenerate ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onStop}
                title="Stop this answer"
                className="h-8 gap-1.5 text-[11px]"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Answering… Stop
              </Button>
            ) : (
              <Button
                type="submit"
                size="sm"
                title="Answer the latest question now (Enter)"
                className="h-8 gap-1.5 text-[11px]"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Answer
                <Kbd keys="↵" size="xs" className="hidden md:inline-flex" />
              </Button>
            )}
          </div>
        </div>

        {detailsOpen && (
          <div className="space-y-2 border-b border-border-subtle/40 px-3 py-2">
            <div>
              <Label htmlFor="interview_notes" className="mb-1 block">
                Interview notes
              </Label>
              <Textarea
                id="interview_notes"
                placeholder="Role focus, talking points, or interview topic..."
                className="min-h-[64px] max-h-[96px] resize-none border-border-subtle/50 bg-black/15 text-xs backdrop-blur-[2px]"
                value={interviewNotes}
                onChange={(e) => onInterviewNotesChange(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => void handleFileChange(e)}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 gap-1.5 text-[10px]"
                disabled={isParsing || isLoading}
                onClick={() => fileInputRef.current?.click()}
              >
                {isParsing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Upload className="h-3 w-3" />
                )}
                Upload resume
              </Button>
              {resumeFileName && (
                <span className="inline-flex max-w-[160px] items-center gap-1 text-[10px] text-text-secondary">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate" title={resumeFileName}>
                    {resumeFileName}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-text-tertiary hover:text-text-primary"
                    aria-label="Clear resume"
                    onClick={onClearResume}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>
            {parseError && (
              <p className="text-[10px] text-destructive">{parseError}</p>
            )}
            <div>
              <Label htmlFor="job_description" className="mb-1 block">
                Job description
              </Label>
              <Textarea
                id="job_description"
                placeholder="Paste the job description..."
                className="min-h-[56px] max-h-[80px] resize-none border-border-subtle/50 bg-black/15 text-xs backdrop-blur-[2px]"
                value={jobDescription}
                onChange={(e) => onJobDescriptionChange(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>
        )}

        {!detailsOpen && attached && (
          <p className="border-b border-border-subtle/40 px-3 py-1.5 text-[10px] text-text-tertiary">
            Resume and JD saved. Open Context to edit.
          </p>
        )}
      </form>
    </div>
  );
});
