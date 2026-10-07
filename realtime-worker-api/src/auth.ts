import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, Env } from "./db";
import * as schema from "./db/schema";
import { hashPassword, verifyPassword } from "./crypto";
import { selfHostedAdmin } from "./plugins/self-hosted-admin";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_MODEL,
  invalidateConfigCache,
} from "./config-cache";

/**
 * Canonical list of browser origins we accept. Shared with the worker's CORS
 * layer (see src/index.ts) so Better Auth's origin check and the CORS
 * Access-Control-Allow-Origin response never disagree.
 */
export const TRUSTED_ORIGINS = [
  "null",
  "file://",
  "http://localhost:3000",
  "http://localhost:3001",
] as const;

/** Extra browser origins (web dashboard, admin panel, worker itself) from
 *  the comma-separated APP_ORIGINS env var, e.g.
 *  "https://app.example.com,https://api.example.com". */
export function appOriginsFromEnv(env: { APP_ORIGINS?: string }): string[] {
  return (env.APP_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter((o) => /^https?:\/\/[^/\s]+$/.test(o));
}

function perHourLimit(raw: string | undefined, fallback: number): number {
  const n = Number(raw?.trim());
  return raw?.trim() && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export const auth = (env: Env & { CONFIG_KV?: KVNamespace }) => {
  const db = getDb(env);

  const adminEmails = (env.ADMIN_EMAILS?.trim() ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL || "http://localhost:8787",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: schema,
    }),
    emailAndPassword: {
      enabled: true,
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
    },
    user: {
      additionalFields: {
        // input: false — clients must never set approval through
        // /api/auth/sign-up or /api/auth/update-user; only admins can.
        isApproved: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },
    trustedOrigins: [...TRUSTED_ORIGINS, ...appOriginsFromEnv(env)],
    databaseHooks: {
      user: {
        create: {
          // Admins from ADMIN_EMAILS skip the approval queue — otherwise the
          // first admin is locked out of the app they administer.
          before: async (newUser) =>
            adminEmails.includes(newUser.email.toLowerCase())
              ? { data: { ...newUser, isApproved: true } }
              : undefined,
        },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
      },
    },
    plugins: [
      selfHostedAdmin({
        getDb: () => db,
        d1: env.DB,
        adminEmails,
        onConfigChange: () => invalidateConfigCache(env),
        sentinel: {
          // Per IP per hour; 0 disables. Env-overridable for shared NATs.
          maxLoginAttemptsPerHour: perHourLimit(env.LOGIN_ATTEMPTS_PER_HOUR, 100),
          maxSignupsPerHour: perHourLimit(env.SIGNUPS_PER_HOUR, 30),
          blockDisposableEmails: true,
        },
        runtimeInfo: () => ({
          geminiModel: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
          geminiKey: env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || "",
          deepgramKey: env.DEEPGRAM_API_KEY?.trim() || "",
          geminiKeyConfigured: Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()),
          anthropicKey: env.ANTHROPIC_API_KEY?.trim() || "",
          anthropicKeyConfigured: Boolean(env.ANTHROPIC_API_KEY?.trim()),
          anthropicModel: env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
          deepgramKeyConfigured: Boolean(env.DEEPGRAM_API_KEY?.trim()),
          cfAccountId: (env as unknown as Record<string, string>).CF_ACCOUNT_ID?.trim() || "",
          cfGatewayId: (env as unknown as Record<string, string>).CF_GATEWAY_ID?.trim() || "",
          cfApiToken: (env as unknown as Record<string, string>).CF_API_TOKEN?.trim() || "",
        }),
      }),
    ],
  });
};
