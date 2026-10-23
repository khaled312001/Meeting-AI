/** The interview log, saved when the meeting ends: per question its number,
 *  the question as sent, the answer as shown, when it was shown, and whether
 *  it was given again with Update. Plain Markdown, one file per meeting. */

import type { AnswerLogEntry } from "@/components/AssistantSessionProvider";
import { parseLiveAnswer } from "@/components/AnswerBody";

const pad = (n: number) => String(n).padStart(2, "0");

function clock(at: number | undefined): string {
  if (!at) return "—";
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function buildInterviewLog(entries: AnswerLogEntry[], startedAt: Date): string {
  const day = `${startedAt.getFullYear()}-${pad(startedAt.getMonth() + 1)}-${pad(startedAt.getDate())}`;
  const lines = [`# Interview log ${day}`, "", `${entries.length} answers`, ""];
  entries.forEach((e, i) => {
    const parsed = parseLiveAnswer(e.answer);
    const answer = (parsed ? parsed.body : e.answer).trim();
    lines.push(
      `## ${e.n ?? i + 1}`,
      "",
      `- Time shown: ${clock(e.at)}`,
      `- Update pressed: ${e.updated ? "yes" : "no"}`,
      "",
      "**Question sent:**",
      "",
      (e.question ?? "").trim() || "—",
      "",
      "**Answer shown:**",
      "",
      answer,
      "",
    );
  });
  return lines.join("\n");
}

export function interviewLogFileBaseName(at: Date): string {
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}-${pad(at.getMinutes())}`;
  return `Interview log ${stamp}`;
}
