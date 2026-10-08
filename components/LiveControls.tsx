"use client";

/** Live session settings shared by the full view and focus mode: the
 *  meeting language, Auto / Manual answers, and whether the user's own
 *  microphone is transcribed. */

import { Hand, Mic, MicOff, Zap } from "lucide-react";
import { useAssistantSession } from "@/components/AssistantSessionProvider";
import { useTranscription } from "@/components/TranscriptionContext";
import { MEETING_LANGUAGES } from "@/lib/meeting-language";
import { cn } from "@/lib/utils";

type Variant = "toolbar" | "glass";

const groupClass: Record<Variant, string> = {
  toolbar:
    "inline-flex h-8 items-center rounded-md border border-border-subtle/60 bg-black/15 p-0.5",
  glass:
    "inline-flex h-7 items-center rounded-full border border-white/10 bg-white/[0.06] p-0.5",
};

function segmentClass(variant: Variant, active: boolean) {
  return cn(
    "inline-flex h-full items-center gap-1 px-2 text-[11px] font-medium transition-colors",
    variant === "glass" ? "rounded-full" : "rounded",
    active
      ? "bg-accent text-accent-foreground shadow-sm"
      : "text-text-secondary hover:text-text-primary",
  );
}

export function LanguageSwitch({ variant = "toolbar" }: { variant?: Variant }) {
  const { language, setLanguage } = useTranscription();
  return (
    <div
      role="radiogroup"
      aria-label="Meeting language"
      title="Meeting language: listening and answers use only this language"
      className={groupClass[variant]}
    >
      {MEETING_LANGUAGES.map((l) => (
        <button
          key={l.id}
          type="button"
          role="radio"
          aria-checked={language === l.id}
          aria-label={l.label}
          title={l.label}
          onClick={() => setLanguage(l.id)}
          className={cn(segmentClass(variant, language === l.id), "min-w-[30px] justify-center")}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}

export function AnswerModeSwitch({ variant = "toolbar" }: { variant?: Variant }) {
  const { answerMode, setAnswerMode } = useAssistantSession();
  return (
    <div role="radiogroup" aria-label="Answer mode" className={groupClass[variant]}>
      <button
        type="button"
        role="radio"
        aria-checked={answerMode === "auto"}
        onClick={() => setAnswerMode("auto")}
        title="Auto: answer as soon as a question ends, and add notes on your own answers"
        aria-label="Auto"
        className={segmentClass(variant, answerMode === "auto")}
      >
        <Zap className="h-3 w-3" />
        <span className={variant === "glass" ? "hidden sm:inline" : undefined}>
          Auto
        </span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={answerMode === "manual"}
        onClick={() => setAnswerMode("manual")}
        title="Manual: answer only when you press Answer"
        aria-label="Manual"
        className={segmentClass(variant, answerMode === "manual")}
      >
        <Hand className="h-3 w-3" />
        <span className={variant === "glass" ? "hidden sm:inline" : undefined}>
          Manual
        </span>
      </button>
    </div>
  );
}

export function MicSwitch({ variant = "toolbar" }: { variant?: Variant }) {
  const { includeMic, setIncludeMic, isActive } = useTranscription();
  const title = includeMic
    ? "Your microphone is transcribed too, so answers know what you said"
    : "Only the other side is transcribed";
  return (
    <button
      type="button"
      aria-pressed={includeMic}
      onClick={() => setIncludeMic(!includeMic)}
      title={isActive ? `${title} (applies the next time you start)` : title}
      className={cn(
        groupClass[variant],
        "gap-1 px-2 text-[11px] font-medium transition-colors",
        includeMic
          ? "text-emerald-300 hover:text-emerald-200"
          : "text-text-tertiary hover:text-text-secondary",
      )}
    >
      {includeMic ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
      Me
    </button>
  );
}

export function LiveControls({
  variant = "toolbar",
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <LanguageSwitch variant={variant} />
      <AnswerModeSwitch variant={variant} />
      <MicSwitch variant={variant} />
    </div>
  );
}
