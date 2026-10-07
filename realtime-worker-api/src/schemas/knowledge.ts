/** Zod schemas + limits for per-user knowledge files. */

import { z } from "zod";

/** Per-file cap on extracted text (~50k tokens of English). */
export const MAX_KNOWLEDGE_DOC_CHARS = 200_000;
/** Cap across all of a user's files, enabled or not. Every enabled char is
 *  sent (cached) on each Assistant / Ask AI request, so this bounds cost. */
export const MAX_KNOWLEDGE_TOTAL_CHARS = 400_000;
export const MAX_KNOWLEDGE_DOCS = 20;

export const knowledgeCreateSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(MAX_KNOWLEDGE_DOC_CHARS),
});

export const knowledgePatchSchema = z.object({
  enabled: z.boolean(),
});
