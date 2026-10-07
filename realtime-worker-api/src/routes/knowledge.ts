/** /api/knowledge — per-user knowledge files (list, add, toggle, delete).
 *
 *  The client extracts plain text from PDF / DOCX / TXT / MD files and
 *  uploads only the text. Enabled files are loaded by /api/completion and
 *  sent to Anthropic as citable document blocks. */

import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { userKnowledgeDoc } from "../db/schema";
import {
  authErrorResponse,
  getAuthenticatedUser,
  isAuthed,
} from "../middleware/auth";
import { jsonResponse } from "../lib/http";
import { SAFE_RESOURCE_ID_RE } from "../lib/ids";
import {
  knowledgeCreateSchema,
  knowledgePatchSchema,
  MAX_KNOWLEDGE_DOC_CHARS,
  MAX_KNOWLEDGE_DOCS,
  MAX_KNOWLEDGE_TOTAL_CHARS,
} from "../schemas/knowledge";
import { recordUsage } from "../usage";
import type { Env } from "../env";

const LIMITS = {
  maxDocs: MAX_KNOWLEDGE_DOCS,
  maxDocChars: MAX_KNOWLEDGE_DOC_CHARS,
  maxTotalChars: MAX_KNOWLEDGE_TOTAL_CHARS,
};

/** Metadata columns only — list responses never ship the full text. */
const docMetaColumns = {
  id: userKnowledgeDoc.id,
  fileName: userKnowledgeDoc.fileName,
  charCount: userKnowledgeDoc.charCount,
  enabled: userKnowledgeDoc.enabled,
  createdAt: userKnowledgeDoc.createdAt,
};

export interface KnowledgeDocForPrompt {
  fileName: string;
  content: string;
}

/** Enabled docs for one user, oldest first. The order must be stable:
 *  the docs form part of the model's cached prompt prefix. */
export async function loadEnabledKnowledgeDocs(
  env: Env,
  userId: string,
): Promise<KnowledgeDocForPrompt[]> {
  const db = getDb(env);
  return db
    .select({
      fileName: userKnowledgeDoc.fileName,
      content: userKnowledgeDoc.content,
    })
    .from(userKnowledgeDoc)
    .where(
      and(
        eq(userKnowledgeDoc.userId, userId),
        eq(userKnowledgeDoc.enabled, true),
      ),
    )
    .orderBy(asc(userKnowledgeDoc.createdAt), asc(userKnowledgeDoc.id));
}

export async function handleListKnowledge(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);

  const db = getDb(env);
  const docs = await db
    .select(docMetaColumns)
    .from(userKnowledgeDoc)
    .where(eq(userKnowledgeDoc.userId, auth.id))
    .orderBy(asc(userKnowledgeDoc.createdAt), asc(userKnowledgeDoc.id));

  return jsonResponse({ docs, limits: LIMITS });
}

export async function handleCreateKnowledge(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const parsed = knowledgeCreateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        error: `Invalid file. Text must be 1..${MAX_KNOWLEDGE_DOC_CHARS} characters.`,
      },
      400,
    );
  }
  const { fileName, content } = parsed.data;

  const db = getDb(env);
  const existing = await db
    .select({ charCount: userKnowledgeDoc.charCount })
    .from(userKnowledgeDoc)
    .where(eq(userKnowledgeDoc.userId, auth.id));

  if (existing.length >= MAX_KNOWLEDGE_DOCS) {
    return jsonResponse(
      { error: `You can keep up to ${MAX_KNOWLEDGE_DOCS} files. Remove one first.` },
      409,
    );
  }
  const usedChars = existing.reduce((sum, d) => sum + d.charCount, 0);
  if (usedChars + content.length > MAX_KNOWLEDGE_TOTAL_CHARS) {
    return jsonResponse(
      {
        error: `Knowledge base is full (${MAX_KNOWLEDGE_TOTAL_CHARS.toLocaleString("en-US")} characters max). Remove a file first.`,
      },
      413,
    );
  }

  const doc = {
    id: crypto.randomUUID(),
    userId: auth.id,
    fileName,
    content,
    charCount: content.length,
    enabled: true,
    createdAt: new Date(),
  };
  await db.insert(userKnowledgeDoc).values(doc);

  recordUsage(env, ctx, request, auth, "knowledge_create", {
    promptChars: content.length,
    metadata: { docId: doc.id },
  });

  const { content: _content, userId: _userId, ...meta } = doc;
  return jsonResponse({ doc: meta }, 201);
}

export async function handlePatchKnowledge(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  docId: string,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);
  if (!SAFE_RESOURCE_ID_RE.test(docId)) {
    return jsonResponse({ error: "Invalid file id" }, 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const parsed = knowledgePatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: "enabled must be a boolean" }, 400);
  }

  const db = getDb(env);
  const [updated] = await db
    .update(userKnowledgeDoc)
    .set({ enabled: parsed.data.enabled })
    .where(
      and(eq(userKnowledgeDoc.id, docId), eq(userKnowledgeDoc.userId, auth.id)),
    )
    .returning(docMetaColumns);
  if (!updated) return jsonResponse({ error: "File not found" }, 404);

  return jsonResponse({ doc: updated });
}

export async function handleDeleteKnowledge(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  docId: string,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);
  if (!SAFE_RESOURCE_ID_RE.test(docId)) {
    return jsonResponse({ error: "Invalid file id" }, 400);
  }

  const db = getDb(env);
  await db
    .delete(userKnowledgeDoc)
    .where(
      and(eq(userKnowledgeDoc.id, docId), eq(userKnowledgeDoc.userId, auth.id)),
    );

  recordUsage(env, ctx, request, auth, "knowledge_delete", {
    metadata: { docId },
  });

  return jsonResponse({ success: true });
}
