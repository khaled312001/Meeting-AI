/** Client for /api/knowledge — the user's knowledge files. */

import { parseApiErrorResponse } from "@/lib/api-errors";
import { ricFetch } from "@/lib/ric-fetch";

export interface KnowledgeDoc {
  id: string;
  fileName: string;
  charCount: number;
  enabled: boolean;
  createdAt: string;
}

export interface KnowledgeLimits {
  maxDocs: number;
  maxDocChars: number;
  maxTotalChars: number;
}

export interface KnowledgeList {
  docs: KnowledgeDoc[];
  limits: KnowledgeLimits;
}

async function ensureOk(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(await parseApiErrorResponse(res));
  return res;
}

export async function listKnowledge(signal?: AbortSignal): Promise<KnowledgeList> {
  const res = await ensureOk(await ricFetch("/api/knowledge", { signal }));
  return (await res.json()) as KnowledgeList;
}

export async function createKnowledge(
  fileName: string,
  content: string,
): Promise<KnowledgeDoc> {
  const res = await ensureOk(
    await ricFetch("/api/knowledge", {
      method: "POST",
      body: JSON.stringify({ fileName, content }),
    }),
  );
  return ((await res.json()) as { doc: KnowledgeDoc }).doc;
}

export async function setKnowledgeEnabled(
  id: string,
  enabled: boolean,
): Promise<KnowledgeDoc> {
  const res = await ensureOk(
    await ricFetch(`/api/knowledge/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  );
  return ((await res.json()) as { doc: KnowledgeDoc }).doc;
}

export async function deleteKnowledge(id: string): Promise<void> {
  await ensureOk(
    await ricFetch(`/api/knowledge/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  );
}

/** Rough token estimate for display (≈4 chars per token for English). */
export function estimateTokens(chars: number): number {
  return Math.round(chars / 4);
}
