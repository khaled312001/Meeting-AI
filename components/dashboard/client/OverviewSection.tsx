"use client";

import * as React from "react";
import {
  Activity,
  BookOpen,
  Check,
  FileText,
  Gauge,
  MessageSquareText,
  Radio,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  ErrorBanner,
  Meter,
  PageHeader,
  Pill,
  Segmented,
  Skeleton,
  StatCard,
} from "../ui";
import { AreaChart, BarList, ChartCard, densifyBuckets } from "../charts";
import { useApi } from "@/lib/use-api";
import { getMyUsage, getInterviewContext, type UsageWindow } from "@/lib/dashboard-api";
import { listKnowledge } from "@/lib/knowledge";
import {
  formatDate,
  formatDuration,
  formatNumber,
} from "@/lib/format";
import { appHref } from "@/lib/app-href";
import { cn } from "@/lib/utils";
import type { ClientSection } from "./ClientDashboard";
import { actionLabel, isUserFacingAction, planLabel, xFormatter } from "../labels";
import { DesktopAppCard } from "./DesktopAppCard";

const WINDOWS: ReadonlyArray<{ value: UsageWindow; label: string }> = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

export function OverviewSection({
  userName,
  onNavigate,
}: {
  userName: string;
  onNavigate: (s: ClientSection) => void;
}) {
  const [range, setRange] = React.useState<UsageWindow>("30d");
  const usage = useApi((signal) => getMyUsage(range, signal), [range]);
  const knowledge = useApi((signal) => listKnowledge(signal), []);
  const profile = useApi((signal) => getInterviewContext(signal), []);

  const u = usage.data;
  const visibleActions = (u?.perAction ?? []).filter((p) => isUserFacingAction(p.action));
  const totalVisible = visibleActions.reduce((s, p) => s + p.events, 0);
  const perAction = new Map(visibleActions.map((p) => [p.action, p]));
  const answers = perAction.get("completion")?.events ?? 0;
  const sessions = perAction.get("session_started")?.events ?? 0;
  const avgAnswerMs =
    answers > 0 ? (perAction.get("completion")?.durationMs ?? 0) / answers : null;

  const points = u
    ? densifyBuckets(u.timeseries, new Date(u.since).getTime(), u.bucketSeconds, (r) => r.events)
    : [];
  const fmtX = xFormatter(range);

  const docs = knowledge.data?.docs ?? [];
  const enabledDocs = docs.filter((d) => d.enabled).length;
  const ctx = profile.data?.context;
  const checklist: Array<{ done: boolean; label: string; hint: string; go: ClientSection }> = [
    {
      done: Boolean(ctx?.resumeText?.trim()),
      label: "Upload your résumé",
      hint: "Answers draw on your real experience.",
      go: "profile",
    },
    {
      done: Boolean(ctx?.jobDescription?.trim()),
      label: "Add the job description",
      hint: "Tailors answers to the role.",
      go: "profile",
    },
    {
      done: docs.length > 0,
      label: "Add knowledge files",
      hint: "Product docs, notes, case studies — cited live.",
      go: "knowledge",
    },
    {
      done: sessions > 0 || answers > 0,
      label: "Run your first live session",
      hint: "Open the assistant and start listening.",
      go: "overview",
    },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  const quota = u?.quota;
  const firstName = userName.split(/\s+/)[0] || "there";

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Your meeting assistant at a glance — activity, plan usage and what to set up next."
        actions={
          <>
            <Segmented value={range} onChange={setRange} options={WINDOWS} ariaLabel="Time range" />
            <Button asChild>
              <a href={appHref("home")}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Open assistant
              </a>
            </Button>
          </>
        }
      />

      {usage.error && (
        <div className="mb-4">
          <ErrorBanner message={usage.error} onRetry={usage.reload} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {usage.loading ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[112px] rounded-xl" />)
        ) : (
          <>
            <StatCard
              hero
              label="AI answers"
              value={answers}
              icon={MessageSquareText}
              hint={avgAnswerMs ? `avg ${formatDuration(avgAnswerMs)} to answer` : "in this period"}
            />
            <StatCard label="Live sessions" value={sessions} icon={Radio} hint="in this period" />
            <StatCard
              label="Knowledge files"
              value={knowledge.data ? `${enabledDocs}/${docs.length}` : "—"}
              icon={BookOpen}
              hint="active / uploaded"
            />
            <StatCard
              label="Total activity"
              value={totalVisible}
              icon={Activity}
              tone={u && u.totals.errors > 0 ? "warning" : "default"}
              hint={u && u.totals.errors > 0 ? `${formatNumber(u.totals.errors)} failed` : "all events"}
            />
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Activity over time"
          description="Every assistant event — answers, sessions, captures."
          dimmed={usage.refreshing && !usage.loading}
          isEmpty={!usage.loading && totalVisible === 0}
          chart={
            usage.loading ? (
              <Skeleton className="h-[200px] w-full" />
            ) : (
              <AreaChart points={points} formatX={fmtX} valueLabel="events" />
            )
          }
          table={{
            headers: ["Period", "Events"],
            rows: points.filter((p) => p.value > 0).map((p) => [fmtX(p.t), formatNumber(p.value)]),
          }}
        />

        <Card title="Plan & usage" description={quota ? `Resets ${formatDate(quota.cycleResetAt)}` : undefined}>
          {quota ? (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">Current plan</span>
                <Pill tone="accent">{planLabel(quota.planTier)}</Pill>
              </div>
              <Meter
                label="AI answers"
                value={quota.consumedCompletions}
                max={quota.monthlyAllowanceCompletions}
                detail={
                  quota.monthlyAllowanceCompletions == null
                    ? `${formatNumber(quota.consumedCompletions)} · unlimited`
                    : `${formatNumber(quota.consumedCompletions)} / ${formatNumber(quota.monthlyAllowanceCompletions)}`
                }
              />
              <Meter
                label="Transcription time"
                value={quota.consumedSeconds}
                max={quota.monthlyAllowanceSeconds}
                detail={
                  quota.monthlyAllowanceSeconds == null
                    ? `${formatDuration(quota.consumedSeconds * 1000)} · unlimited`
                    : `${formatDuration(quota.consumedSeconds * 1000)} / ${formatDuration(quota.monthlyAllowanceSeconds * 1000)}`
                }
              />
              <p className="flex items-start gap-2 text-xs leading-relaxed text-text-tertiary">
                <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Need more? Message support from the Support tab and we&apos;ll upgrade your plan.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Activity by type"
          dimmed={usage.refreshing && !usage.loading}
          isEmpty={!usage.loading && visibleActions.length === 0}
          chart={
            usage.loading ? (
              <Skeleton className="h-[160px] w-full" />
            ) : (
              <BarList
                data={visibleActions.map((p) => ({
                  key: p.action,
                  label: actionLabel(p.action),
                  value: p.events,
                  detail: p.errors > 0 ? `${formatNumber(p.errors)} failed` : undefined,
                }))}
              />
            )
          }
          table={{
            headers: ["Type", "Events"],
            rows: visibleActions
              .slice()
              .sort((a, b) => b.events - a.events)
              .map((p) => [actionLabel(p.action), formatNumber(p.events)]),
          }}
        />

        <Card
          title="Get set up"
          description={`${doneCount} of ${checklist.length} done`}
          bodyClassName="p-2"
        >
          <ul>
            {checklist.map((item) => (
              <li key={item.label}>
                <button
                  type="button"
                  onClick={() => {
                    if (item.go === "overview") window.location.href = appHref("home");
                    else onNavigate(item.go);
                  }}
                  className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-overlay/60"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                      item.done
                        ? "border-transparent bg-accent text-accent-foreground"
                        : "border-border-strong text-transparent",
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block text-[13px] font-medium",
                        item.done ? "text-text-tertiary line-through" : "text-text-primary",
                      )}
                    >
                      {item.label}
                    </span>
                    <span className="block text-xs text-text-tertiary">{item.hint}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {docs.length > 0 && (
            <div className="mx-3 mb-2 mt-1 flex items-center gap-2 border-t border-border-subtle pt-3 text-xs text-text-tertiary">
              <FileText className="h-3.5 w-3.5" />
              {formatNumber(docs.reduce((s, d) => s + d.charCount, 0))} characters of knowledge loaded
            </div>
          )}
        </Card>
      </div>

      <DesktopAppCard className="mt-4" />
    </>
  );
}
