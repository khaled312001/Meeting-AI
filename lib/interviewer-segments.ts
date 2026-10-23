/** Numbered interviewer segments, and which of them reached an answer, so
 *  a segment that was never sent shows as a gap instead of being lost. */

import type { TranscriptionSegment } from "@/lib/types";

export interface InterviewerSegment {
  id: string;
  /** Its number in this meeting, from 1. */
  n: number;
  text: string;
  /** Where it sits in the interviewer text (see buildTranscriptTexts). */
  start: number;
  end: number;
  /** Part of a question that was sent for an answer. */
  sent: boolean;
}

/** The interviewer's final segments, numbered, with their offsets in the
 *  interviewer text (the finals joined by single spaces, as
 *  buildTranscriptTexts builds it) and whether a sent range covers them. */
export function numberInterviewerSegments(
  segments: TranscriptionSegment[],
  sentRanges: ReadonlyArray<readonly [number, number]>,
): InterviewerSegment[] {
  const out: InterviewerSegment[] = [];
  let offset = 0;
  for (const s of segments) {
    if (!s.isFinal || s.source === "me") continue;
    const text = s.text.trim();
    if (!text) continue;
    const start = offset;
    const end = start + text.length;
    offset = end + 1;
    out.push({
      id: s.id,
      n: out.length + 1,
      text,
      start,
      end,
      sent: sentRanges.some(([from, to]) => start < to && end > from),
    });
  }
  return out;
}

/** "#3", or "#3–#5" for a run of numbers. */
export function numberRuns(ns: number[]): string[] {
  const runs: string[] = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    runs.push(i === j ? `#${ns[i]}` : `#${ns[i]}–#${ns[j]}`);
    i = j;
  }
  return runs;
}
