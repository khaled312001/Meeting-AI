"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** "1. Tell me…", "Q3: Tell me…", "- Tell me…" → "Tell me…". */
const LEAD_RE = /^\s*(?:(?:q(?:uestion)?\s*)?\d+\s*[.):-]|[-•*])\s*/i;

/** One question per filled line, without its number or bullet. */
export function typedQuestions(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\*\*/g, "").replace(LEAD_RE, "").trim())
    .filter(Boolean);
}

interface TypedQuestionsBoxProps {
  /** The typed questions being answered, if any. */
  run: { done: number; total: number } | null;
  /** Another answer is being written. */
  busy: boolean;
  onAnswer: (questions: string[]) => void;
  onStop: () => void;
}

/** Questions typed to test the files: each line is answered as if the
 *  interviewer had asked it after Start. */
export function TypedQuestionsBox({
  run,
  busy,
  onAnswer,
  onStop,
}: TypedQuestionsBoxProps) {
  const [text, setText] = useState("");
  const questions = typedQuestions(text);
  const answer = () => {
    if (!busy && !run && questions.length > 0) onAnswer(questions);
  };

  return (
    <div className="shrink-0 border-t border-border-subtle/40 p-3">
      <label
        htmlFor="typed-questions"
        className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-text-tertiary"
      >
        Type questions
      </label>
      <Textarea
        id="typed-questions"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            answer();
          }
        }}
        placeholder="One question per line. Each is answered as if the interviewer asked it."
        className="min-h-[56px] max-h-[120px] resize-y border-border-subtle/50 bg-black/15 text-xs"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className="min-w-0 truncate text-[11px] text-text-tertiary"
          aria-live="polite"
        >
          {run
            ? `Answering ${Math.min(run.done + 1, run.total)} of ${run.total}`
            : questions.length > 0
              ? `${questions.length} question${questions.length === 1 ? "" : "s"} · Ctrl+Enter`
              : "Answered the same way as after Start"}
        </span>
        {run ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={onStop}
          >
            Stop
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="h-7 text-[11px]"
            disabled={busy || questions.length === 0}
            onClick={answer}
          >
            Answer
          </Button>
        )}
      </div>
    </div>
  );
}
