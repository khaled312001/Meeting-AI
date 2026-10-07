/**
 * Typed client for the self-hosted admin API (Better Auth plugin mounted at
 * /api/auth/self-hosted-admin/*). Every call requires an admin session.
 */

import { ricFetch } from "@/lib/ric-fetch";
import type { QuotaSummary, TimeseriesRow, UsageAgg } from "@/lib/dashboard-api";

const BASE = "/api/auth/self-hosted-admin";

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

async function toError(res: Response): Promise<AdminApiError> {
  let message = "";
  try {
    const data = (await res.json()) as { message?: string; error?: string };
    message = data.message || data.error || "";
  } catch {
    /* 403 from Better Auth has an empty body */
  }
  if (!message) {
    message =
      res.status === 401
        ? "Your session expired. Sign in again."
        : res.status === 403
          ? "This account is not an administrator."
          : res.status === 404
            ? "Not found."
            : `Request failed (HTTP ${res.status}).`;
  }
  return new AdminApiError(message, res.status);
}

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(query?: Query): string {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function adminGet<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  const res = await ricFetch(`${BASE}${path}${qs(query)}`, { signal });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

export async function adminPost<T = { ok: true }>(path: string, body?: unknown): Promise<T> {
  const res = await ricFetch(`${BASE}${path}`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

/* ───────────────────────────── Types ───────────────────────────── */

export type Provider = "anthropic" | "gemini" | "openai";
export type KeySource = "dashboard" | "env" | "none";

export interface AdminMe {
  admin: true;
  email: string;
  name: string;
}

export interface Overview {
  stats: {
    totalUsers: number;
    newUsers24h: number;
    newUsersWeek: number;
    pendingApproval: number;
    bannedUsers: number;
    activeSessions: number;
    totalAuditEvents: number;
    securityBlocks24h: number;
  };
  runtime: {
    cfAccountConfigured: boolean;
    cfGatewayConfigured: boolean;
    cfApiTokenConfigured: boolean;
    anthropicModel: string;
    anthropicKeyConfigured: boolean;
    anthropicKeySource: KeySource;
    provider: Provider;
    geminiModel: string;
    geminiKeyConfigured: boolean;
    deepgramKeyConfigured: boolean;
    geminiKeySource: KeySource;
    deepgramKeySource: KeySource;
    customModelName: string;
    customBaseUrl: string;
    customApiKeyConfigured: boolean;
    useCustomModel: boolean;
  };
}

export interface HealthCheck {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface Health {
  status: "healthy" | "degraded";
  timestamp: string;
  activeProvider: Provider;
  checks: {
    database: HealthCheck;
    geminiKey: HealthCheck;
    deepgramKey: HealthCheck;
    anthropicKey: HealthCheck;
  };
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  isApproved: boolean | null;
  isBanned: boolean | null;
  banReason: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
  quota: {
    planTier: string | null;
    consumedCompletions: number | null;
    monthlyAllowanceCompletions: number | null;
  } | null;
}

export type UserFilter = "all" | "pending" | "approved" | "banned";

export interface AuditEvent {
  id: string;
  eventType: string;
  userId: string | null;
  userEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: string | null;
  createdAt: string;
}

export interface SecurityEvent {
  id: string;
  eventType: string;
  ipAddress: string | null;
  userEmail: string | null;
  action: string;
  metadata: string | null;
  createdAt: string;
}

export interface ModelParamsOverride {
  maxOutputTokens: number | null;
  temperature: number | null;
  topP: number | null;
  thinkingBudget: ThinkingBudget | null;
  updatedAt: string;
}

export interface UserDetail {
  user: AdminUser & { image: string | null };
  sessions: Array<{
    id: string;
    expiresAt: string;
    createdAt: string;
    ipAddress: string | null;
    userAgent: string | null;
  }>;
  notesCount: number;
  hasInterviewContext: boolean;
  recentAuditEvents: AuditEvent[];
  modelParamsOverride: ModelParamsOverride | null;
  quota: QuotaSummary;
  usage: {
    window: "30d";
    since: string;
    totals: UsageAgg;
    perAction: Array<UsageAgg & { action: string }>;
  };
}

export type AdminUsageWindow = "1h" | "24h" | "7d" | "30d" | "90d";

export interface UsageSummary {
  window: AdminUsageWindow;
  since: string;
  totals: UsageAgg & { uniqueUsers: number };
  perAction: Array<UsageAgg & { action: string }>;
}

export interface UsageTimeseries {
  window: AdminUsageWindow;
  since: string;
  bucketSeconds: number;
  userId: string | null;
  timeseries: TimeseriesRow[];
}

export interface UsageByUser {
  window: AdminUsageWindow;
  since: string;
  users: Array<
    UsageAgg & {
      userId: string;
      userEmail: string | null;
      userName: string | null;
      /** Epoch SECONDS. */
      lastSeen: number;
    }
  >;
}

export interface UsageEvent {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  flag: string | null;
  model: string | null;
  promptChars: number | null;
  responseChars: number | null;
  durationMs: number | null;
  status: string;
  errorCode: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface LiveSession {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  surface: string | null;
  ipAddress: string | null;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  endedBy: string | null;
  endReason: string | null;
  eventCount: number;
  status: "active" | "stale" | "ended";
  durationMs: number;
}

export interface SupportThread {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  subject: string | null;
  body: string;
  status: "open" | "pending" | "resolved";
  unreadByAdmin: number | boolean;
  unreadByUser: number | boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupportMessageRow {
  id: string;
  parentId: string | null;
  authorType: "user" | "admin";
  authorEmail: string | null;
  userEmail: string | null;
  userName: string | null;
  subject: string | null;
  body: string;
  status: string;
  createdAt: string;
}

export type AnnouncementKind = "banner" | "popup" | "toast";
export type AnnouncementSeverity = "info" | "success" | "warning" | "error" | "announcement";
export type AnnouncementStatus = "active" | "paused" | "archived";

export interface Announcement {
  id: string;
  kind: AnnouncementKind;
  severity: AnnouncementSeverity;
  title: string | null;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  audience: "all" | "users";
  /** JSON-encoded string[] (or null). */
  targetUserIds: string | null;
  status: AnnouncementStatus;
  dismissable: number | boolean;
  startsAt: string | null;
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementInput {
  kind: AnnouncementKind;
  severity: AnnouncementSeverity;
  title: string | null;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  audience: "all" | "users";
  targetUserIds?: string[];
  status: AnnouncementStatus;
  dismissable: boolean;
  startsAt: string | null;
  expiresAt: string | null;
}

export type ThinkingBudget = "off" | "low" | "medium" | "high";

export interface ModelParams {
  maxOutputTokens: number;
  temperature: number;
  topP: number;
  thinkingBudget: ThinkingBudget;
}

export interface ConfigResponse {
  config: Record<string, string>;
  maskedKeys: string[];
}

export interface OpenAiConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  enabled: boolean;
  activeProvider: Provider;
  defaults: { baseUrl: string; model: string };
}

export type TestResult =
  | { ok: true; reply: string; model?: string }
  | { ok: false; error: string; status?: number };

export interface Admins {
  envAdmins: string[];
  dbAdmins: string[];
  effective: string[];
}

export interface QuotaTiers {
  defaultTierForNewUsers: string;
  tiers: Record<string, { monthlyAllowanceSeconds: number | null; monthlyAllowanceCompletions: number | null }>;
}

export const PLAN_TIERS = ["legacy_unlimited", "free_tier", "early_access", "unlimited"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/* ───────────────────────────── Calls ───────────────────────────── */

export const adminApi = {
  me: (signal?: AbortSignal) => adminGet<AdminMe>("/me", undefined, signal),
  overview: (signal?: AbortSignal) => adminGet<Overview>("/overview", undefined, signal),
  health: (signal?: AbortSignal) => adminGet<Health>("/health", undefined, signal),
  chartSignups: (signal?: AbortSignal) =>
    adminGet<{ chart: Array<{ weekStart: string; count: number }> }>("/chart-signups", undefined, signal),
  activity: (limit: number, signal?: AbortSignal) =>
    adminGet<{ events: AuditEvent[] }>("/activity", { limit }, signal),
  exportStats: () => adminGet<{ csv: string; exportedAt: string }>("/export-stats"),

  listUsers: (q: { limit: number; offset: number; q?: string; filter?: UserFilter }, signal?: AbortSignal) =>
    adminGet<{ users: AdminUser[]; total: number }>(
      "/list-users",
      { ...q, filter: q.filter === "all" ? undefined : q.filter },
      signal,
    ),
  getUser: (userId: string, signal?: AbortSignal) => adminGet<UserDetail>("/get-user", { userId }, signal),
  updateUser: (body: { userId: string; isApproved?: boolean; isBanned?: boolean; banReason?: string }) =>
    adminPost("/update-user", body),
  deleteUser: (userId: string) => adminPost("/delete-user", { userId }),
  bulkApprove: (userIds: string[], approve: boolean) =>
    adminPost<{ ok: true; affected: number }>("/bulk-approve", { userIds, approve }),
  bulkBan: (userIds: string[], ban: boolean, banReason?: string) =>
    adminPost<{ ok: true; affected: number }>("/bulk-ban", { userIds, ban, banReason }),
  bulkDelete: (userIds: string[]) => adminPost<{ ok: true; affected: number }>("/bulk-delete", { userIds }),
  exportUsers: () => adminGet<{ csv: string; total: number }>("/export-users"),
  revokeAllSessions: (userId: string) => adminPost("/revoke-all-sessions", { userId }),

  getQuota: (userId: string, signal?: AbortSignal) =>
    adminGet<{ userId: string; summary: QuotaSummary }>("/quota", { userId }, signal),
  setQuota: (body: {
    userId: string;
    planTier?: PlanTier;
    monthlyAllowanceSeconds?: number | null;
    monthlyAllowanceCompletions?: number | null;
    overageAllowed?: boolean;
  }) => adminPost<{ ok: true; summary: QuotaSummary }>("/quota", body),
  resetQuotaCycle: (userId: string) => adminPost<{ ok: true; cycleResetAt: string }>("/quota-reset-cycle", { userId }),
  quotaTiers: (signal?: AbortSignal) => adminGet<QuotaTiers>("/quota-tiers", undefined, signal),

  setUserModelParams: (body: {
    userId: string;
    maxOutputTokens?: number | null;
    temperature?: number | null;
    topP?: number | null;
    thinkingBudget?: ThinkingBudget | null;
  }) => adminPost("/user-model-params", body),
  deleteUserModelParams: (userId: string) => adminPost("/user-model-params-delete", { userId }),

  usageSummary: (window: AdminUsageWindow, signal?: AbortSignal) =>
    adminGet<UsageSummary>("/usage/summary", { window }, signal),
  usageTimeseries: (window: AdminUsageWindow, userId?: string, signal?: AbortSignal) =>
    adminGet<UsageTimeseries>("/usage/timeseries", { window, userId }, signal),
  usageByUser: (window: AdminUsageWindow, limit: number, signal?: AbortSignal) =>
    adminGet<UsageByUser>("/usage/by-user", { window, limit }, signal),
  usageEvents: (
    q: { limit: number; offset: number; userId?: string; action?: string; status?: string },
    signal?: AbortSignal,
  ) => adminGet<{ events: UsageEvent[]; total: number }>("/usage/events", q, signal),
  usageExport: (window: AdminUsageWindow) =>
    adminGet<{ csv: string; total: number }>("/usage/export.csv", { window }),

  liveSessions: (
    q: { limit: number; offset: number; status?: string; q?: string },
    signal?: AbortSignal,
  ) => adminGet<{ sessions: LiveSession[]; total: number }>("/live-sessions", q, signal),
  terminateLiveSession: (sessionId: string, reason?: string, revokeAuthSessions = false) =>
    adminPost<{ ok: true; deepgramRevoked: boolean; deepgramError: string | null }>(
      "/live-session-terminate",
      { sessionId, reason, revokeAuthSessions },
    ),

  supportThreads: (
    q: { limit: number; offset: number; status?: string; unreadOnly?: boolean; q?: string },
    signal?: AbortSignal,
  ) =>
    adminGet<{ threads: SupportThread[]; total: number; totalUnread: number }>("/support/threads", q, signal),
  supportThread: (id: string, signal?: AbortSignal) =>
    adminGet<{ thread: SupportThread; messages: SupportMessageRow[] }>("/support/thread", { id }, signal),
  supportReply: (threadId: string, body: string, closeAfter: boolean) =>
    adminPost<{ ok: true; replyId: string }>("/support/reply", { threadId, body, closeAfter }),
  supportStatus: (threadId: string, status: SupportThread["status"]) =>
    adminPost("/support/update-status", { threadId, status }),
  supportDelete: (threadId: string) => adminPost("/support/delete", { threadId }),

  announcements: (q: { limit: number; offset: number; status?: string }, signal?: AbortSignal) =>
    adminGet<{ announcements: Announcement[]; total: number }>("/announcements", q, signal),
  createAnnouncement: (body: AnnouncementInput) => adminPost<{ ok: true; id: string }>("/announcements/create", body),
  updateAnnouncement: (id: string, body: Partial<AnnouncementInput>) =>
    adminPost("/announcements/update", { id, ...body }),
  deleteAnnouncement: (id: string) => adminPost("/announcements/delete", { id }),
  announcementStats: (id: string, signal?: AbortSignal) =>
    adminGet<{ id: string; dismissed: number }>("/announcements/stats", { id }, signal),

  auditLogs: (q: { limit: number; offset: number; eventType?: string; q?: string }, signal?: AbortSignal) =>
    adminGet<{ events: AuditEvent[]; total: number }>("/audit-logs", q, signal),
  securityEvents: (q: { limit: number; offset: number; eventType?: string; q?: string }, signal?: AbortSignal) =>
    adminGet<{ events: SecurityEvent[]; total: number }>("/security-events", q, signal),
  cleanup: () => adminPost<{ ok: true; cleanedAt: string }>("/cleanup"),

  config: (signal?: AbortSignal) => adminGet<ConfigResponse>("/config", undefined, signal),
  updateConfig: (key: string, value: string) => adminPost("/update-config", { key, value }),
  deleteConfig: (key: string) => adminPost("/delete-config", { key }),
  setProvider: (provider: Provider) =>
    adminPost<{ ok: true; provider: Provider } | { ok: false; error: string }>("/provider", { provider }),
  testAnthropic: (body: { model?: string; apiKey?: string }) => adminPost<TestResult>("/test-anthropic", body),
  testModel: (body: { modelName?: string; baseUrl?: string; apiKey?: string }) =>
    adminPost<TestResult>("/test-model", body),
  openaiConfig: (signal?: AbortSignal) => adminGet<OpenAiConfig>("/openai-config", undefined, signal),
  saveOpenaiConfig: (body: { apiKey?: string; baseUrl?: string; model?: string }) =>
    adminPost<{ ok: true }>("/openai-config", body),
  clearOpenaiConfig: () => adminPost("/openai-config/clear"),
  modelParams: (signal?: AbortSignal) =>
    adminGet<{ defaults: ModelParams; bakedDefaults: ModelParams }>("/model-params", undefined, signal),
  saveModelParams: (body: Partial<ModelParams>) => adminPost<{ ok: true; updated: number }>("/model-params", body),
  appConfig: (signal?: AbortSignal) =>
    adminGet<{ geminiModels: Array<{ id: string; label: string }> }>("/app-config", undefined, signal),

  admins: (signal?: AbortSignal) => adminGet<Admins>("/admins", undefined, signal),
  setAdmins: (emails: string[]) => adminPost<{ ok: true; dbAdmins: string[] }>("/admins", { emails }),
};

/** Trigger a browser download of a CSV string. */
export function downloadCsv(csv: string, fileName: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
