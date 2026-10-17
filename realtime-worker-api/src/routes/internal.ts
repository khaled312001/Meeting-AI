/** /api/internal/* — server-to-server lookups for the customer site's dashboard.
 *
 *  The site keeps its own accounts; a customer links their desktop account to
 *  it once by entering the desktop email and password there. These endpoints
 *  let the site's backend check that password and read the plan afterwards.
 *
 *  Off unless INTERNAL_API_SECRET is set (32+ characters); every call carries
 *  it as a Bearer token. Emails travel in the POST body, never the URL. */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { account, user } from "../db/schema";
import { verifyPassword } from "../crypto";
import { jsonResponse } from "../lib/http";
import {
  getSubscription,
  toSubscriptionSummary,
} from "../services/subscription.service";
import type { Env } from "../env";

function authorized(request: Request, env: Env): boolean {
  const secret = env.INTERNAL_API_SECRET?.trim() ?? "";
  if (secret.length < 32) return false;
  const got = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (got.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) {
    diff |= got.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return diff === 0;
}

/** Password checks per email per hour, on top of the site's own limit. */
const ATTEMPTS_PER_HOUR = 10;
const attempts = new Map<string, number[]>();

function allowAttempt(email: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(email) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= ATTEMPTS_PER_HOUR) {
    attempts.set(email, recent);
    return false;
  }
  recent.push(now);
  attempts.set(email, recent);
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) {
      if (v.every((t) => now - t >= 3_600_000)) attempts.delete(k);
    }
  }
  return true;
}

/**
 * POST /api/internal/account  { email, password? }
 *
 * Without a password: the account's standing and plan, for a link the site
 * already verified. With one: the same, plus whether the password is right —
 * and nothing else when it is wrong, so a guess learns only "no".
 */
export async function handleInternalAccount(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!authorized(request, env)) return jsonResponse({ error: "Not found" }, 404);

  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 200 || !email.includes("@")) {
    return jsonResponse({ error: "email is required" }, 400);
  }
  const password = typeof body.password === "string" ? body.password : null;

  const db = getDb(env);
  const [found] = await db
    .select({
      id: user.id,
      name: user.name,
      isApproved: user.isApproved,
      isBanned: user.isBanned,
    })
    .from(user)
    .where(eq(user.email, email));

  if (password !== null) {
    if (!allowAttempt(email)) return jsonResponse({ error: "Too many attempts" }, 429);
    if (!found) return jsonResponse({ passwordOk: false });
    const [cred] = await db
      .select({ password: account.password })
      .from(account)
      .where(and(eq(account.userId, found.id), eq(account.providerId, "credential")));
    const ok = Boolean(cred?.password) &&
      (await verifyPassword({ hash: cred!.password!, password }));
    if (!ok) return jsonResponse({ passwordOk: false });
  }

  if (!found) return jsonResponse({ exists: false });

  return jsonResponse({
    exists: true,
    ...(password !== null ? { passwordOk: true } : {}),
    name: found.name,
    approved: Boolean(found.isApproved),
    banned: Boolean(found.isBanned),
    subscription: publicSummary(toSubscriptionSummary(await getSubscription(db, found.id))),
  });
}

/** The plan as the customer sees it — the admin's note stays here. */
function publicSummary(s: ReturnType<typeof toSubscriptionSummary>) {
  if (!s) return null;
  const { note: _note, ...rest } = s;
  return rest;
}
