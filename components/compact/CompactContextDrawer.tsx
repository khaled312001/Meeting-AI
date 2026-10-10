"use client";

/** Optional context drawer for the Compact surface. Pure presentational
 *  — the parent owns the `bg` state and the visibility flag. */

import { overlayInput } from "@/components/compact/compactTextStyles";
import { KnowledgeUploadButton } from "@/components/KnowledgeUploadButton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { focusGlass } from "./FocusBar";

interface CompactContextDrawerProps {
  bg: string;
  onChange: (value: string) => void;
  hasSavedResumeOrJd?: boolean;
}

export function CompactContextDrawer({
  bg,
  onChange,
  hasSavedResumeOrJd = false,
}: CompactContextDrawerProps) {
  return (
    <div
      data-clickable
      className={cn(
        "mx-auto mt-1.5 w-[calc(100%-1rem)] max-w-[860px] space-y-1.5 rounded-2xl px-3 py-2",
        focusGlass,
      )}
    >
      <p className="text-[11px] font-semibold text-text-primary">
        Notes for this meeting
        <span className="ml-1.5 font-normal text-text-tertiary">
          saved automatically · used in every answer
        </span>
      </p>
      {hasSavedResumeOrJd && (
        <p className="text-[10px] text-accent-text">
          Your resume, job description and enabled knowledge files are used too.
        </p>
      )}
      <KnowledgeUploadButton />
      <Textarea
        placeholder="Topics, facts to mention, things to avoid…"
        className={cn(
          "max-h-[120px] min-h-[64px] resize-none text-xs leading-relaxed",
          overlayInput,
        )}
        value={bg}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
