/** Customer accounts and paid plans. Public sign-up is off, so admins create
 *  accounts here, assign a plan with its AI credit, and reset passwords. */

import { eq } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { z } from "zod";
import { session, user } from "../../../db/schema";
import {
  PLANS,
  addMonths,
  adjustCredit,
  deleteSubscription,
  getSubscription,
  isPlanId,
  setSubscription,
  toSubscriptionSummary,
} from "../../../services/subscription.service";
import { ensureQuotaRow } from "../../../services/quota.service";
import { parseAdminQuery } from "../helpers";
import { requiredUserIdQuerySchema } from "../query-schemas";
import type { AdminDeps } from "../types";

const userIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const passwordSchema = z.string().min(8).max(128);
const planSchema = z.string().refine(isPlanId, "unknown plan");

const setSubscriptionSchema = z.object({
  userId: userIdSchema,
  plan: planSchema,
  /** Defaults to the plan's credit. */
  creditUsd: z.number().min(0).max(100_000).optional(),
  /** Keeps the amount already used when omitted on an existing plan. */
  usedUsd: z.number().min(0).max(100_000).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  status: z.enum(["active", "cancelled"]).optional(),
  note: z.string().max(500).nullable().optional(),
});

const adjustCreditSchema = z.discriminatedUnion("action", [
  z.object({ userId: userIdSchema, action: z.literal("add"), usd: z.number().min(-100_000).max(100_000) }),
  z.object({ userId: userIdSchema, action: z.literal("set-left"), usd: z.number().min(0).max(100_000) }),
  z.object({ userId: userIdSchema, action: z.literal("restore") }),
]);

const createUserSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(120),
  password: passwordSchema.optional(),
  plan: planSchema.optional(),
});

const resetPasswordSchema = z.object({
  userId: userIdSchema,
  password: passwordSchema.optional(),
});

/** 16 characters without look-alikes (0/O, 1/l/I). */
export function generatePassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12).join("")}`;
}

export function subscriptionEndpoints(deps: AdminDeps) {
  const { isAdmin, opts, recordAudit } = deps;

  return {
    adminGetSubscription: createAuthEndpoint(
      "/self-hosted-admin/subscription",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const { userId } = parseAdminQuery(url, requiredUserIdQuerySchema, ["userId"]);
        const row = await getSubscription(opts.getDb(), userId);
        return ctx.json({ subscription: toSubscriptionSummary(row), plans: PLANS });
      },
    ),

    adminSetSubscription: createAuthEndpoint(
      "/self-hosted-admin/subscription",
      { method: "POST", use: [sessionMiddleware], body: setSubscriptionSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const body = ctx.body;
        const [found] = await db.select({ id: user.id }).from(user).where(eq(user.id, body.userId));
        if (!found) throw new APIError("NOT_FOUND", { message: "User not found" });

        const plan = PLANS[body.plan as keyof typeof PLANS];
        const existing = await getSubscription(db, body.userId);
        const startsAt = body.startsAt ? new Date(body.startsAt) : new Date();
        const row = await setSubscription(db, body.userId, {
          plan: body.plan,
          creditUsd: body.creditUsd ?? plan.creditUsd,
          usedUsd: body.usedUsd ?? (existing ? existing.usedMicros / 1_000_000 : 0),
          startsAt,
          endsAt: body.endsAt ? new Date(body.endsAt) : addMonths(startsAt, plan.months),
          status: body.status,
          note: body.note,
        });
        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "set_subscription", userId: body.userId, plan: body.plan },
        });
        return ctx.json({ ok: true, subscription: toSubscriptionSummary(row) });
      },
    ),

    adminAdjustCredit: createAuthEndpoint(
      "/self-hosted-admin/subscription-credit",
      { method: "POST", use: [sessionMiddleware], body: adjustCreditSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const { userId, ...change } = ctx.body;
        const row = await adjustCredit(opts.getDb(), userId, change);
        if (!row) throw new APIError("NOT_FOUND", { message: "This user has no plan yet" });
        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "adjust_credit", userId, change },
        });
        return ctx.json({ ok: true, subscription: toSubscriptionSummary(row) });
      },
    ),

    adminDeleteSubscription: createAuthEndpoint(
      "/self-hosted-admin/subscription-delete",
      { method: "POST", use: [sessionMiddleware], body: z.object({ userId: userIdSchema }) },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        await deleteSubscription(opts.getDb(), ctx.body.userId);
        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "delete_subscription", userId: ctx.body.userId },
        });
        return ctx.json({ ok: true });
      },
    ),

    adminCreateUser: createAuthEndpoint(
      "/self-hosted-admin/create-user",
      { method: "POST", use: [sessionMiddleware], body: createUserSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const email = ctx.body.email.trim().toLowerCase();
        const [taken] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
        if (taken) throw new APIError("CONFLICT", { message: "An account with this email already exists" });

        const password = ctx.body.password ?? generatePassword();
        const created = await ctx.context.internalAdapter.createUser({
          email,
          name: ctx.body.name.trim(),
          emailVerified: true,
        }, { method: "admin" });
        await ctx.context.internalAdapter.linkAccount({
          userId: created.id,
          providerId: "credential",
          accountId: created.id,
          password: await ctx.context.password.hash(password),
        });
        await db.update(user).set({ isApproved: true }).where(eq(user.id, created.id));
        await ensureQuotaRow(db, created.id);

        let subscription = null;
        if (ctx.body.plan) {
          const plan = PLANS[ctx.body.plan as keyof typeof PLANS];
          const startsAt = new Date();
          subscription = toSubscriptionSummary(
            await setSubscription(db, created.id, {
              plan: ctx.body.plan,
              creditUsd: plan.creditUsd,
              startsAt,
              endsAt: addMonths(startsAt, plan.months),
            }),
          );
        }
        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "create_user", userId: created.id, email, plan: ctx.body.plan ?? null },
        });
        // The password is returned once so the admin can hand it over.
        return ctx.json({
          ok: true,
          user: { id: created.id, email, name: created.name },
          password,
          subscription,
        });
      },
    ),

    adminResetPassword: createAuthEndpoint(
      "/self-hosted-admin/reset-password",
      { method: "POST", use: [sessionMiddleware], body: resetPasswordSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userId } = ctx.body;
        const [found] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
        if (!found) throw new APIError("NOT_FOUND", { message: "User not found" });

        const password = ctx.body.password ?? generatePassword();
        const hash = await ctx.context.password.hash(password);
        const accounts = await ctx.context.internalAdapter.findAccounts(userId);
        if (accounts.some((a) => a.providerId === "credential")) {
          await ctx.context.internalAdapter.updatePassword(userId, hash);
        } else {
          await ctx.context.internalAdapter.linkAccount({
            userId,
            providerId: "credential",
            accountId: userId,
            password: hash,
          });
        }
        // Signs the user out everywhere: every device must use the new password.
        await db.delete(session).where(eq(session.userId, userId));
        await recordAudit({
          eventType: "password_changed",
          userEmail: adminEmail,
          metadata: { action: "admin_reset_password", userId, sessionsRevoked: true },
        });
        return ctx.json({ ok: true, password });
      },
    ),
  };
}
