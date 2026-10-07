"use client";

import * as React from "react";
import {
  CheckCircle2,
  Clock,
  Cpu,
  Radio,
  ShieldAlert,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  Pill,
  RefreshButton,
  Skeleton,
  StatCard,
} from "../ui";
import { ChartCard, ColumnChart } from "../charts";
import { useApi } from "@/lib/use-api";
import { adminApi, type Provider } from "@/lib/admin-api";
import { formatNumber, formatRelative, humanizeKey } from "@/lib/format";
import type { AdminSection } from "./AdminDashboard";

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  openai: "OpenAI-compatible",
};

function HealthRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <li className="flex items-center gap-3 py-2">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-destructive" />
      )}
      <span className="min-w-0 flex-1 text-[13px] text-text-primary">{label}</span>
      <span className="truncate text-xs text-text-tertiary">{detail ?? (ok ? "OK" : "Missing")}</span>
    </li>
  );
}

export function AdminOverview({ onNavigate }: { onNavigate: (s: AdminSection) => void }) {
  const overview = useApi((s) => adminApi.overview(s), [], { pollMs: 60_000 });
  const health = useApi((s) => adminApi.health(s), [], { pollMs: 60_000 });
  const signups = useApi((s) => adminApi.chartSignups(s), []);
  const activity = useApi((s) => adminApi.activity(12, s), [], { pollMs: 60_000 });

  const st = overview.data?.stats;
  const rt = overview.data?.runtime;
  const points = (signups.data?.chart ?? []).map((p) => ({
    t: new Date(`${p.weekStart}T00:00:00Z`).getTime(),
    value: p.count,
  }));
  const fmtWeek = (t: number) =>
    `Week of ${new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  const activeModel =
    rt?.provider === "anthropic" ? rt.anthropicModel : rt?.provider === "openai" ? rt.customModelName : rt?.geminiModel;

  const reloadAll = () => {
    void overview.reload();
    void health.reload();
    void signups.reload();
    void activity.reload();
  };

  return (
    <>
      <PageHeader
        title="Overview"
        description="Users, live activity and system health across your deployment."
        actions={<RefreshButton onClick={reloadAll} spinning={overview.refreshing} />}
      />

      {overview.error && (
        <div className="mb-4">
          <ErrorBanner message={overview.error} onRetry={overview.reload} />
        </div>
      )}

      {st && st.pendingApproval > 0 && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-[color-mix(in_oklch,var(--warning)_35%,transparent)] bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-4 py-3 sm:flex-row sm:items-center">
          <Clock className="h-4 w-4 shrink-0 text-warning" />
          <span className="flex-1 text-[13px] text-text-primary">
            <strong className="font-semibold">{formatNumber(st.pendingApproval)}</strong>{" "}
            {st.pendingApproval === 1 ? "person is" : "people are"} waiting for approval.
          </span>
          <Button size="sm" onClick={() => onNavigate("users")}>
            Review sign-ups
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!st ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[112px] rounded-xl" />)
        ) : (
          <>
            <StatCard
              hero
              label="Total users"
              value={st.totalUsers}
              icon={Users}
              hint={`+${formatNumber(st.newUsersWeek)} this week`}
            />
            <StatCard label="New today" value={st.newUsers24h} icon={UserPlus} hint="last 24 hours" />
            <StatCard label="Signed-in sessions" value={st.activeSessions} icon={Radio} hint="not expired" />
            <StatCard
              label="Security blocks"
              value={st.securityBlocks24h}
              icon={ShieldAlert}
              tone={st.securityBlocks24h > 0 ? "warning" : "default"}
              hint={`last 24 hours · ${formatNumber(st.bannedUsers)} banned`}
            />
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="New sign-ups per week"
          description="Last 8 weeks, up to today (UTC)."
          isEmpty={!signups.loading && points.every((p) => p.value === 0)}
          emptyText="No sign-ups in the last 8 weeks."
          chart={
            signups.loading ? (
              <Skeleton className="h-[200px] w-full" />
            ) : (
              <ColumnChart points={points} formatX={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })} valueLabel="sign-ups" />
            )
          }
          table={{ headers: ["Week", "Sign-ups"], rows: points.map((p) => [fmtWeek(p.t), formatNumber(p.value)]) }}
        />

        <Card
          title="System health"
          actions={
            health.data ? (
              <Pill tone={health.data.status === "healthy" ? "success" : "warning"} dot>
                {health.data.status === "healthy" ? "Healthy" : "Degraded"}
              </Pill>
            ) : undefined
          }
        >
          {!health.data || !rt ? (
            <LoadingBlock rows={4} />
          ) : (
            <>
              <div className="mb-3 flex items-center gap-3 rounded-lg bg-surface-inset px-3 py-2.5">
                <Cpu className="h-4 w-4 text-accent-text" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-text-primary">{PROVIDER_LABEL[rt.provider]}</div>
                  <div className="truncate text-xs text-text-tertiary">{activeModel || "default model"}</div>
                </div>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onNavigate("ai")}>
                  Configure
                </Button>
              </div>
              <ul className="divide-y divide-border-subtle">
                <HealthRow
                  label="Database"
                  ok={health.data.checks.database.ok}
                  detail={
                    health.data.checks.database.ok
                      ? `${health.data.checks.database.latencyMs} ms`
                      : health.data.checks.database.error
                  }
                />
                <HealthRow
                  label="Deepgram (transcription)"
                  ok={health.data.checks.deepgramKey.ok}
                  detail={health.data.checks.deepgramKey.ok ? `key from ${rt.deepgramKeySource}` : undefined}
                />
                <HealthRow
                  label="Anthropic API key"
                  ok={health.data.checks.anthropicKey.ok}
                  detail={health.data.checks.anthropicKey.ok ? `key from ${rt.anthropicKeySource}` : "Not set"}
                />
                <HealthRow
                  label="Gemini API key"
                  ok={health.data.checks.geminiKey.ok}
                  detail={health.data.checks.geminiKey.ok ? `key from ${rt.geminiKeySource}` : "Not set"}
                />
              </ul>
            </>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card
          title="Recent activity"
          description="Sign-ups, approvals, bans and other account events."
          actions={
            <Button variant="ghost" size="sm" onClick={() => onNavigate("security")}>
              View all
            </Button>
          }
          bodyClassName="p-0"
        >
          {activity.loading ? (
            <div className="p-5">
              <LoadingBlock rows={4} />
            </div>
          ) : (activity.data?.events ?? []).length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {activity.data!.events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-tertiary" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                    {humanizeKey(e.eventType)}
                    {e.userEmail && <span className="text-text-tertiary"> · {e.userEmail}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-text-tertiary">{formatRelative(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
