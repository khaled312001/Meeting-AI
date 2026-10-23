"use client";

/** A live answer as the candidate reads it: the question as its title, then
 *  the answer, split into its parts when the model marks them with a part
 *  line ("[1/3 Current role]", shown small and grey because it is not said),
 *  one sentence per line, in the user's text size. **Bold** shows as bold. */

import SafeMarkdown from "@/components/SafeMarkdown";
import { sentenceLines } from "@/lib/answer-display";
import { cn } from "@/lib/utils";

/** "**Question 3:** …\n\n**Answer:** …" */
const LIVE_ANSWER_RE =
  /^\*\*([^*\n]{1,40}):\*\*[ \t]*([^\n]*)\n\n\*\*[^*\n]{1,30}:\*\*[ \t]*([\s\S]*)$/;
/** A part line: "[1/3 Current role]", on a line of its own. */
const PART_RE = /^[ \t]*\[(\d+)\s*\/\s*(\d+)\s+([^\]\n]+)\][ \t]*(?:\n|$)/gm;

export interface ParsedLiveAnswer {
  /** "Question 3" */
  title: string;
  question: string;
  body: string;
}

export function parseLiveAnswer(text: string): ParsedLiveAnswer | null {
  const m = LIVE_ANSWER_RE.exec(text);
  if (!m) return null;
  return {
    title: m[1].trim(),
    question: m[2].replace(/\*\*/g, "").trim(),
    body: m[3],
  };
}

interface AnswerPart {
  label: string | null;
  text: string;
}

/** The answer split at its part lines; text before the first one is a part
 *  without a label. A part line still being written is held back. */
export function splitAnswerParts(body: string): AnswerPart[] {
  const text = body.replace(/\n[ \t]*\[[^\]\n]*$/, "").replace(/^[ \t]*\[[^\]\n]*$/, "");
  const parts: AnswerPart[] = [];
  let last = 0;
  let label: string | null = null;
  for (const m of text.matchAll(PART_RE)) {
    const before = text.slice(last, m.index);
    if (label !== null || before.trim()) parts.push({ label, text: before });
    label = `[${m[1]}/${m[2]} ${m[3].trim()}]`;
    last = (m.index ?? 0) + m[0].length;
  }
  const rest = text.slice(last);
  if (label !== null || rest.trim()) parts.push({ label, text: rest });
  return parts;
}

/** An unclosed "**" (bold still being written) is hidden, so the stars
 *  never show on screen. */
function hideOpenBold(text: string): string {
  const count = text.match(/\*\*/g)?.length ?? 0;
  if (count % 2 === 0) return text;
  const at = text.lastIndexOf("**");
  return text.slice(0, at) + text.slice(at + 2);
}

export function AnswerBody({
  text,
  proseClassName,
  fontPx,
}: {
  text: string;
  proseClassName: string;
  fontPx?: number;
}) {
  const style = fontPx ? { fontSize: fontPx } : undefined;
  const parsed = parseLiveAnswer(text);
  if (!parsed) {
    return (
      <div className={proseClassName} style={style}>
        <SafeMarkdown>{hideOpenBold(text)}</SafeMarkdown>
      </div>
    );
  }
  const parts = splitAnswerParts(parsed.body);
  return (
    <div dir="auto">
      <p className="mb-2 text-[13px] leading-snug">
        <span className="font-semibold text-accent-text">{parsed.title}:</span>{" "}
        <span className="text-text-secondary">{parsed.question}</span>
      </p>
      {parts.map((part, i) => (
        <div key={`${i}-${part.label ?? ""}`} className={cn(i > 0 && "mt-4")}>
          {part.label && (
            <div className="mb-0.5 font-mono text-[11px] text-text-tertiary">
              {part.label}
            </div>
          )}
          <div className={proseClassName} style={style}>
            <SafeMarkdown>{sentenceLines(hideOpenBold(part.text.trim()))}</SafeMarkdown>
          </div>
        </div>
      ))}
    </div>
  );
}
