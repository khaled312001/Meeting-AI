/** Identity (admin/me + app-config) + dashboard summary endpoints. */

import { count, eq, gte } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import {
  adminConfig,
  auditEvent,
  securityEvent,
  session,
  user,
} from "../../../db/schema";
import adminCfg from "../../../config.json";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_MODEL,
  isCustomActive,
  resolveProvider,
} from "../../../config-cache";
import type { AdminDeps } from "../types";

export function dashboardEndpoints(deps: AdminDeps) {
  const { isAdmin, opts } = deps;
  return {
    adminAppConfig: createAuthEndpoint(
      "/self-hosted-admin/app-config",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        return ctx.json(adminCfg);
      },
    ),

    adminMe: createAuthEndpoint(
      "/self-hosted-admin/me",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        const u = ctx.context.session.user;
        if (!(await isAdmin(u.email)))
          throw new APIError("FORBIDDEN", { message: "Not an admin" });
        return ctx.json({ admin: true, email: u.email, name: u.name });
      },
    ),

    adminOverview: createAuthEndpoint(
      "/self-hosted-admin/overview",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 86_400_000);
        const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

        const [
          [{ totalUsers }],
          [{ newUsers24h }],
          [{ newUsersWeek }],
          [{ pendingApproval }],
          [{ bannedUsers }],
          [{ activeSessions }],
          [{ totalAuditEvents }],
          [{ securityBlocks24h }],
          configRows,
        ] = await Promise.all([
          db.select({ totalUsers: count() }).from(user),
          db.select({ newUsers24h: count() }).from(user).where(gte(user.createdAt, dayAgo)),
          db.select({ newUsersWeek: count() }).from(user).where(gte(user.createdAt, weekAgo)),
          db.select({ pendingApproval: count() }).from(user).where(eq(user.isApproved, false)),
          db.select({ bannedUsers: count() }).from(user).where(eq(user.isBanned, true)),
          db.select({ activeSessions: count() }).from(session).where(gte(session.expiresAt, now)),
          db.select({ totalAuditEvents: count() }).from(auditEvent),
          db.select({ securityBlocks24h: count() }).from(securityEvent).where(gte(securityEvent.createdAt, dayAgo)),
          db.select().from(adminConfig),
        ]);

        const cfgMap = new Map(configRows.map((r) => [r.key, r.value]));
        const envRuntime = (opts.runtimeInfo?.() as Record<string, unknown>) ?? {};

        const customModelName = cfgMap.get("custom_model_name") || "";
        const customBaseUrl = cfgMap.get("custom_base_url") || "";
        const customApiKey = cfgMap.get("custom_api_key") || "";
        const useCustomModel = isCustomActive(cfgMap);

        // Only non-secret runtime fields go to the browser. runtimeInfo()
        // also carries raw env keys for server-side probes.
        const runtime = {
          cfAccountConfigured: Boolean(cfgMap.get("cf_account_id") || envRuntime.cfAccountId),
          cfGatewayConfigured: Boolean(cfgMap.get("cf_gateway_id") || envRuntime.cfGatewayId),
          cfApiTokenConfigured: Boolean(cfgMap.get("cf_api_token") || envRuntime.cfApiToken),
          anthropicModel:
            cfgMap.get("anthropic_model") ||
            (envRuntime.anthropicModel as string | undefined) ||
            DEFAULT_ANTHROPIC_MODEL,
          anthropicKeyConfigured: Boolean(
            cfgMap.get("anthropic_key") || envRuntime.anthropicKeyConfigured,
          ),
          anthropicKeySource: cfgMap.has("anthropic_key")
            ? "dashboard"
            : envRuntime.anthropicKeyConfigured
              ? "env"
              : "none",
          provider: resolveProvider(cfgMap, {
            anthropicKeyAvailable: Boolean(
              cfgMap.get("anthropic_key") || envRuntime.anthropicKeyConfigured,
            ),
          }),
          geminiModel: cfgMap.get("gemini_model") || envRuntime.geminiModel || DEFAULT_GEMINI_MODEL,
          geminiKeyConfigured: Boolean(cfgMap.get("gemini_key") || envRuntime.geminiKeyConfigured),
          deepgramKeyConfigured: Boolean(cfgMap.get("deepgram_key") || envRuntime.deepgramKeyConfigured),
          geminiKeySource: cfgMap.has("gemini_key") ? "dashboard" : envRuntime.geminiKeyConfigured ? "env" : "none",
          deepgramKeySource: cfgMap.has("deepgram_key") ? "dashboard" : envRuntime.deepgramKeyConfigured ? "env" : "none",
          customModelName,
          customBaseUrl: customBaseUrl ? customBaseUrl.replace(/\/+$/, "") : "",
          customApiKeyConfigured: Boolean(customApiKey),
          useCustomModel,
        };

        return ctx.json({
          stats: {
            totalUsers,
            newUsers24h,
            newUsersWeek,
            pendingApproval,
            bannedUsers,
            activeSessions,
            totalAuditEvents,
            securityBlocks24h,
          },
          runtime,
        });
      },
    ),

    adminChartSignups: createAuthEndpoint(
      "/self-hosted-admin/chart-signups",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const weeks = 8;
        const now = new Date();
        const weekMs = 7 * 86_400_000;
        // Week boundaries are computed in UTC so buckets align exactly
        // with the `weekStart` labels rendered by the dashboard.
        const startTs = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
          ),
        );
        // End the last bucket at the end of today (UTC) so today's
        // sign-ups count — a brand-new deployment otherwise looks empty.
        startTs.setUTCDate(startTs.getUTCDate() + 1 - weeks * 7);
        const startEpoch = Math.floor(startTs.getTime() / 1000);
        const weekSecs = 7 * 24 * 60 * 60;

        // Bucket in JS rather than SQL integer division — same result,
        // but immune to driver/type quirks and trivially testable.
        const rawResult = await opts.d1
          .prepare(`SELECT createdAt FROM user WHERE createdAt >= ?1`)
          .bind(startEpoch)
          .all<{ createdAt: number }>();

        const counts = new Array<number>(weeks).fill(0);
        for (const row of rawResult.results) {
          const bucket = Math.floor((row.createdAt - startEpoch) / weekSecs);
          if (bucket >= 0 && bucket < weeks) {
            counts[bucket] += 1;
          }
        }

        const points: { weekStart: string; count: number }[] = [];
        for (let i = 0; i < weeks; i++) {
          const ws = new Date(startTs.getTime() + i * weekMs);
          points.push({
            weekStart: ws.toISOString().split("T")[0],
            count: counts[i],
          });
        }
        return ctx.json({ chart: points }, {
          headers: { "Cache-Control": "no-store" },
        });
      },
    ),

    adminHealth: createAuthEndpoint(
      "/self-hosted-admin/health",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const now = new Date();

        const checks: Record<string, { ok: boolean; latencyMs: number; error?: string }> = {};

        const dbStart = Date.now();
        try {
          await db.select({ n: count() }).from(user);
          checks.database = { ok: true, latencyMs: Date.now() - dbStart };
        } catch (e) {
          checks.database = {
            ok: false,
            latencyMs: Date.now() - dbStart,
            error: e instanceof Error ? e.message : String(e),
          };
        }

        const configRows = await db
          .select()
          .from(adminConfig)
          .catch(() => [] as { key: string; value: string }[]);
        const cfgMap = new Map(configRows.map((r) => [r.key, r.value]));
        const envRuntime = (opts.runtimeInfo?.() as Record<string, unknown>) ?? {};

        checks.geminiKey = {
          ok: Boolean(cfgMap.get("gemini_key") || envRuntime.geminiKeyConfigured),
          latencyMs: 0,
        };
        checks.deepgramKey = {
          ok: Boolean(cfgMap.get("deepgram_key") || envRuntime.deepgramKeyConfigured),
          latencyMs: 0,
        };
        checks.anthropicKey = {
          ok: Boolean(cfgMap.get("anthropic_key") || envRuntime.anthropicKeyConfigured),
          latencyMs: 0,
        };

        // Healthy = database + transcription + the ACTIVE provider's key.
        const activeProvider = resolveProvider(cfgMap, {
          anthropicKeyAvailable: checks.anthropicKey.ok,
        });
        const providerOk =
          activeProvider === "anthropic"
            ? checks.anthropicKey.ok
            : activeProvider === "openai"
              ? isCustomActive(cfgMap)
              : checks.geminiKey.ok;
        const allOk =
          checks.database.ok && checks.deepgramKey.ok && providerOk;

        return ctx.json({
          status: allOk ? "healthy" : "degraded",
          timestamp: now.toISOString(),
          activeProvider,
          checks,
        });
      },
    ),
  };
}
