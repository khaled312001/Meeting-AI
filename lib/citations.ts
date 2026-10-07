/** Helpers for knowledge-file citations streamed with Anthropic answers. */

import type { AnswerCitation } from "@/lib/types";

/** Append a citation unless the same passage is already listed. */
export function addCitation(
  list: AnswerCitation[],
  next: AnswerCitation,
): AnswerCitation[] {
  const duplicate = list.some(
    (c) =>
      c.documentIndex === next.documentIndex && c.citedText === next.citedText,
  );
  return duplicate ? list : [...list, next];
}

export interface CitationGroup {
  title: string;
  passages: string[];
}

/** Group citations by source file, keeping first-seen order. */
export function groupCitations(list: AnswerCitation[]): CitationGroup[] {
  const groups = new Map<string, CitationGroup>();
  for (const c of list) {
    const title = c.documentTitle?.trim() || `File ${c.documentIndex + 1}`;
    const group = groups.get(title) ?? { title, passages: [] };
    const passage = c.citedText.trim();
    if (passage && !group.passages.includes(passage)) group.passages.push(passage);
    groups.set(title, group);
  }
  return [...groups.values()];
}
