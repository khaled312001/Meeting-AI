/** Paid plans: a dollar credit for a fixed period and the number of questions
 *  it buys. Questions are the balance — every answered question uses one —
 *  and the dollars left follow from them (credit × questions left / limit).
 *  An admin can set both per customer, e.g. $400 for 1200 questions. Users
 *  without a subscription row are not limited. */

import { eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { subscription } from "../db/schema";
import type * as schemaTypes from "../db/schema";

type Db = DrizzleD1Database<typeof schemaTypes>;
export type SubscriptionRow = typeof subscription.$inferSelect;

export const MICROS_PER_USD = 1_000_000;

/** Plans an admin can assign: the credit, its questions, and the period. */
export const PLANS = {
  "elite-yearly": { label: "Elite · Yearly", creditUsd: 400, questions: 1000, months: 12 },
  "elite-quarterly": { label: "Elite · Quarterly", creditUsd: 100, questions: 250, months: 3 },
  "elite-monthly": { label: "Elite · Monthly", creditUsd: 35, questions: 87, months: 1 },
  "pro-yearly": { label: "Pro · Yearly", creditUsd: 200, questions: 500, months: 12 },
  "pro-quarterly": { label: "Pro · Quarterly", creditUsd: 50, questions: 125, months: 3 },
  "pro-monthly": { label: "Pro · Monthly", creditUsd: 18, questions: 45, months: 1 },
} as const;
export type PlanId = keyof typeof PLANS;

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && Object.hasOwn(PLANS, v);
}

export async function getSubscription(
  db: Db,
  userId: string,
): Promise<SubscriptionRow | null> {
  const [row] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.userId, userId))
    .limit(1);
  return row ?? null;
}

export type SubscriptionState = "active" | "exhausted" | "expired" | "cancelled";

export function subscriptionState(row: SubscriptionRow, now = Date.now()): SubscriptionState {
  if (row.status !== "active") return "cancelled";
  if (row.endsAt.getTime() <= now) return "expired";
  if (row.questionsUsed >= row.questionLimit) return "exhausted";
  return "active";
}

export function toSubscriptionSummary(row: SubscriptionRow | null) {
  if (!row) return null;
  const plan = isPlanId(row.plan) ? PLANS[row.plan] : null;
  const creditUsd = row.creditMicros / MICROS_PER_USD;
  const total = row.questionLimit;
  const used = Math.min(row.questionsUsed, total);
  const priceUsd = total > 0 ? creditUsd / total : 0;
  const usedUsd = Math.round(priceUsd * used * 100) / 100;
  return {
    plan: row.plan,
    planLabel: plan?.label ?? row.plan,
    state: subscriptionState(row),
    creditUsd,
    usedUsd,
    remainingUsd: Math.max(0, Math.round((creditUsd - usedUsd) * 100) / 100),
    answerPriceUsd: priceUsd,
    answersTotal: total,
    answersUsed: row.questionsUsed,
    answersLeft: Math.max(0, total - row.questionsUsed),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    note: row.note,
  };
}
export type SubscriptionSummary = NonNullable<ReturnType<typeof toSubscriptionSummary>>;

/** Blocks AI calls for subscribers whose questions or period have run out. */
export async function checkSubscription(
  db: Db,
  userId: string,
): Promise<{ allowed: true } | { allowed: false; message: string }> {
  const row = await getSubscription(db, userId);
  if (!row) return { allowed: true };
  switch (subscriptionState(row)) {
    case "active":
      return { allowed: true };
    case "exhausted":
      return {
        allowed: false,
        message: "You have used all the questions in your plan. Contact support to add more.",
      };
    case "expired":
      return {
        allowed: false,
        message: "Your subscription has ended. Contact support to renew it.",
      };
    default:
      return {
        allowed: false,
        message: "Your subscription is not active. Contact support.",
      };
  }
}

/** One answered question. */
export async function chargeSubscription(db: Db, userId: string): Promise<void> {
  await db
    .update(subscription)
    .set({
      questionsUsed: sql`${subscription.questionsUsed} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(subscription.userId, userId));
}

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Create or replace a user's plan. */
export async function setSubscription(
  db: Db,
  userId: string,
  input: {
    plan: string;
    creditUsd: number;
    questions: number;
    questionsUsed?: number;
    startsAt: Date;
    endsAt: Date;
    status?: string;
    note?: string | null;
  },
): Promise<SubscriptionRow> {
  const now = new Date();
  const values = {
    plan: input.plan,
    status: input.status ?? "active",
    creditMicros: Math.round(input.creditUsd * MICROS_PER_USD),
    questionLimit: Math.max(0, Math.floor(input.questions)),
    questionsUsed: Math.max(0, Math.floor(input.questionsUsed ?? 0)),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    note: input.note ?? null,
    updatedAt: now,
  };
  await db
    .insert(subscription)
    .values({ userId, ...values, createdAt: now })
    .onConflictDoUpdate({ target: subscription.userId, set: values });
  return (await getSubscription(db, userId))!;
}

export type QuestionAdjustment =
  /** Adds to (or, when negative, takes from) the plan's question limit. */
  | { action: "add"; questions: number }
  /** Sets how many questions are left; the limit grows if needed. */
  | { action: "set-left"; questions: number }
  /** Gives every used question back. */
  | { action: "restore" };

export async function adjustQuestions(
  db: Db,
  userId: string,
  change: QuestionAdjustment,
): Promise<SubscriptionRow | null> {
  const row = await getSubscription(db, userId);
  if (!row) return null;
  let limit = row.questionLimit;
  let used = row.questionsUsed;
  if (change.action === "add") {
    limit = Math.max(0, limit + Math.trunc(change.questions));
  } else if (change.action === "set-left") {
    const left = Math.max(0, Math.trunc(change.questions));
    if (left > limit) limit = left;
    used = limit - left;
  } else {
    used = 0;
  }
  await db
    .update(subscription)
    .set({ questionLimit: limit, questionsUsed: used, updatedAt: new Date() })
    .where(eq(subscription.userId, userId));
  return getSubscription(db, userId);
}

export async function deleteSubscription(db: Db, userId: string): Promise<void> {
  await db.delete(subscription).where(eq(subscription.userId, userId));
}
