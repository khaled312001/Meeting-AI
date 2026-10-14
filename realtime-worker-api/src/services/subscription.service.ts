/** Prepaid AI credit per subscriber.
 *
 *  A subscription holds a dollar credit (stored as micro-USD) for a fixed
 *  period. Every answered question takes a flat ANSWER_PRICE_USD off it, so
 *  $400 is 1000 answers. Users without a subscription row are not limited. */

import { eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { subscription } from "../db/schema";
import type * as schemaTypes from "../db/schema";

type Db = DrizzleD1Database<typeof schemaTypes>;
export type SubscriptionRow = typeof subscription.$inferSelect;

export const MICROS_PER_USD = 1_000_000;

/** Plans an admin can assign. Credit is the AI budget for the whole period. */
export const PLANS = {
  "elite-yearly": { label: "Elite · Yearly", creditUsd: 400, months: 12 },
  "elite-quarterly": { label: "Elite · Quarterly", creditUsd: 100, months: 3 },
  "elite-monthly": { label: "Elite · Monthly", creditUsd: 35, months: 1 },
  "pro-yearly": { label: "Pro · Yearly", creditUsd: 200, months: 12 },
  "pro-quarterly": { label: "Pro · Quarterly", creditUsd: 50, months: 3 },
  "pro-monthly": { label: "Pro · Monthly", creditUsd: 18, months: 1 },
} as const;
export type PlanId = keyof typeof PLANS;

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && Object.hasOwn(PLANS, v);
}

/** Each answered question costs the same: $400 buys 1000 answers. */
export const ANSWER_PRICE_USD = 0.4;
export const ANSWER_PRICE_MICROS = ANSWER_PRICE_USD * MICROS_PER_USD;

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
  if (row.usedMicros >= row.creditMicros) return "exhausted";
  return "active";
}

export function toSubscriptionSummary(row: SubscriptionRow | null) {
  if (!row) return null;
  const plan = isPlanId(row.plan) ? PLANS[row.plan] : null;
  const remaining = Math.max(0, row.creditMicros - row.usedMicros);
  return {
    plan: row.plan,
    planLabel: plan?.label ?? row.plan,
    state: subscriptionState(row),
    creditUsd: row.creditMicros / MICROS_PER_USD,
    usedUsd: row.usedMicros / MICROS_PER_USD,
    remainingUsd: remaining / MICROS_PER_USD,
    answerPriceUsd: ANSWER_PRICE_USD,
    answersTotal: Math.floor(row.creditMicros / ANSWER_PRICE_MICROS),
    answersUsed: Math.round(row.usedMicros / ANSWER_PRICE_MICROS),
    answersLeft: Math.floor(remaining / ANSWER_PRICE_MICROS),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    note: row.note,
  };
}
export type SubscriptionSummary = NonNullable<ReturnType<typeof toSubscriptionSummary>>;

/** Blocks AI calls for subscribers whose credit or period has run out. */
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
        message: "Your answer credit is used up. Contact support to top up your plan.",
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

export async function chargeSubscription(
  db: Db,
  userId: string,
  micros = ANSWER_PRICE_MICROS,
): Promise<void> {
  if (!(micros > 0)) return;
  await db
    .update(subscription)
    .set({
      usedMicros: sql`${subscription.usedMicros} + ${Math.ceil(micros)}`,
      updatedAt: new Date(),
    })
    .where(eq(subscription.userId, userId));
}

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Create or replace a user's plan. A new plan starts with nothing used. */
export async function setSubscription(
  db: Db,
  userId: string,
  input: {
    plan: string;
    creditUsd: number;
    startsAt: Date;
    endsAt: Date;
    status?: string;
    usedUsd?: number;
    note?: string | null;
  },
): Promise<SubscriptionRow> {
  const now = new Date();
  const values = {
    plan: input.plan,
    status: input.status ?? "active",
    creditMicros: Math.round(input.creditUsd * MICROS_PER_USD),
    usedMicros: Math.round((input.usedUsd ?? 0) * MICROS_PER_USD),
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

export async function deleteSubscription(db: Db, userId: string): Promise<void> {
  await db.delete(subscription).where(eq(subscription.userId, userId));
}

export type CreditAdjustment =
  /** Adds to (or, when negative, takes from) the plan's total credit. */
  | { action: "add"; usd: number }
  /** Sets what is left; the total grows if needed. */
  | { action: "set-left"; usd: number }
  /** Gives the whole credit back (nothing used). */
  | { action: "restore" };

export async function adjustCredit(
  db: Db,
  userId: string,
  change: CreditAdjustment,
): Promise<SubscriptionRow | null> {
  const row = await getSubscription(db, userId);
  if (!row) return null;
  let creditMicros = row.creditMicros;
  let usedMicros = row.usedMicros;
  if (change.action === "add") {
    creditMicros = Math.max(0, creditMicros + Math.round(change.usd * MICROS_PER_USD));
  } else if (change.action === "set-left") {
    const left = Math.max(0, Math.round(change.usd * MICROS_PER_USD));
    if (left > creditMicros) creditMicros = left;
    usedMicros = creditMicros - left;
  } else {
    usedMicros = 0;
  }
  await db
    .update(subscription)
    .set({ creditMicros, usedMicros, updatedAt: new Date() })
    .where(eq(subscription.userId, userId));
  return getSubscription(db, userId);
}
