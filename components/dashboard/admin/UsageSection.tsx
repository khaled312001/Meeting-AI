"use client";

import * as React from "react";
import { Activity, AlertTriangle, Download, Timer, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  Pagination,
  Pill,
  Segmented,
  Select,
  Skeleton,
  StatCard,
} from "../ui";
import { AreaChart, BarList, ChartCard, densifyBuckets } from "../charts";
import { useToast } from "../toast";
import { useApi } from "@/lib/use-api";
import { adminApi, downloadCsv, type AdminUsageWindow, type UsageEvent } from "@/lib/admin-api";
import { formatCompact, formatDateTime, formatDuration, formatNumber, formatRelative, humanizeKey } from "@/lib/format";
import { actionLabel, xFormatter } from "../labels";

const WINDOWS: ReadonlyArray<{ value: AdminUsageWindow; label: string }> = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

const EVENTS_PAGE = 25;

export function UsageSection({ onOpenUser }: { onOpenUser: (userId: string) => void }) {
  const toast = useToast();
  const [range, setRange] = React.useState<AdminUsageWindow>("7d");
  const summary = useApi((s) => adminApi.usageSummary(range, s), [range]);
  const series = useApi((s) => adminApi.usageTimeseries(range, undefined, s), [range]);
  const byUser = useApi((s) => adminApi.usageByUser(range, 10, s), [range]);

  const [action, setAction] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  React.useEffect(() => setOffset(0), [action, status]);
  const events = useApi(
    (s) =>
      adminApi.usageEvents(
        { limit: EVENTS_PAGE, offset, action: action || undefined, status: status || undefined },
        s,
      ),
    [offset, action, status],
  );

  const t = summary.data?.totals;
  const per = new Map((summary.data?.perAction ?? []).map((p) => [p.action, p]));
  const completions = per.get("completion");
  const avgAnswer = completions && completions.events > 0 ? completions.durationMs / completions.events : null;
  const points = series.data
    ? densifyBuckets(series.data.timeseries, new Date(series.data.since).getTime(), series.data.bucketSeconds, (r) => r.events)
    : [];
  const fmtX = xFormatter(range);
  const dim = summary.refreshing && !summary.loading;

  const exportCsv = async () => {
    try {
      const { csv, total } = await adminApi.usageExport(range);
      downloadCsv(csv, `usage-${range}-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success(`Exported ${formatNumber(total)} events`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  const actionOptions = [
    { value: "", label: "All actions" },
    ...(summary.data?.perAction ?? [])
      .map((p) => p.action)
      .sort()
      .map((a) => ({ value: a, label: actionLabel(a) })),
  ];

  return (
    <>
      <PageHeader
        title="Usage & analytics"
        description="What people do with the assistant, who uses it most and where requests fail."
        actions={
          <>
            <Segmented value={range} onChange={setRange} options={WINDOWS} ariaLabel="Time range" />
            <Button variant="outline" onClick={() => void exportCsv()}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
            </Button>
          </>
        }
      />

      {summary.error && (
        <div className="mb-4">
          <ErrorBanner message={summary.error} onRetry={summary.reload} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!t ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[112px] rounded-xl" />)
        ) : (
          <>
            <StatCard hero label="AI answers" value={completions?.events ?? 0} icon={Activity} hint={`${formatCompact(t.events)} events in total`} />
            <StatCard label="Active users" value={t.uniqueUsers} icon={Users} hint="used the app in this period" />
            <StatCard
              label="Avg answer time"
              value={avgAnswer != null ? formatDuration(avgAnswer) : "—"}
              icon={Timer}
              hint="from request to full answer"
            />
            <StatCard
              label="Failed requests"
              value={t.errors}
              icon={AlertTriangle}
              tone={t.errors > 0 ? "warning" : "default"}
              hint={t.events > 0 ? `${((t.errors / t.events) * 100).toFixed(1)}% of events` : "—"}
            />
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Events over time"
          dimmed={series.refreshing && !series.loading}
          isEmpty={!series.loading && points.every((p) => p.value === 0)}
          chart={series.loading ? <Skeleton className="h-[200px] w-full" /> : <AreaChart points={points} formatX={fmtX} />}
          table={{
            headers: ["Period", "Events"],
            rows: points.filter((p) => p.value > 0).map((p) => [fmtX(p.t), formatNumber(p.value)]),
          }}
        />
        <ChartCard
          title="By action"
          dimmed={dim}
          isEmpty={!summary.loading && (summary.data?.perAction.length ?? 0) === 0}
          chart={
            summary.loading ? (
              <LoadingBlock rows={5} />
            ) : (
              <BarList
                data={(summary.data?.perAction ?? []).map((p) => ({
                  key: p.action,
                  label: actionLabel(p.action),
                  value: p.events,
                  detail: p.errors ? `${formatNumber(p.errors)} failed` : undefined,
                }))}
              />
            )
          }
          table={{
            headers: ["Action", "Events"],
            rows: (summary.data?.perAction ?? [])
              .slice()
              .sort((a, b) => b.events - a.events)
              .map((p) => [actionLabel(p.action), formatNumber(p.events)]),
          }}
        />
      </div>

      <div className="mt-4">
        <Card title="Top users" description="Most active accounts in this period." dimmed={byUser.refreshing && !byUser.loading}>
          {byUser.loading ? (
            <LoadingBlock rows={5} />
          ) : (
            <DataTable
              rows={byUser.data?.users ?? []}
              rowKey={(r) => r.userId}
              onRowClick={(r) => onOpenUser(r.userId)}
              empty={<EmptyState icon={Users} title="No usage in this period" />}
              columns={[
                {
                  key: "user",
                  header: "User",
                  cell: (r) => (
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.userName || r.userEmail || r.userId}</div>
                      {r.userName && <div className="truncate text-xs text-text-tertiary">{r.userEmail}</div>}
                    </div>
                  ),
                },
                { key: "events", header: "Events", align: "right", cell: (r) => formatNumber(r.events) },
                {
                  key: "errors",
                  header: "Failed",
                  align: "right",
                  hideOnMobile: true,
                  cell: (r) => (r.errors ? <span className="text-warning">{formatNumber(r.errors)}</span> : "0"),
                },
                {
                  key: "chars",
                  header: "Answer chars",
                  align: "right",
                  hideOnMobile: true,
                  cell: (r) => formatCompact(r.responseChars),
                },
                {
                  key: "seen",
                  header: "Last seen",
                  hideOnMobile: true,
                  cell: (r) => <span className="text-text-secondary">{formatRelative(r.lastSeen * 1000)}</span>,
                },
              ]}
            />
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card
          title="Event log"
          description="Every request, newest first."
          actions={
            <>
              <Select value={action} onChange={setAction} options={actionOptions} ariaLabel="Filter by action" className="h-8 text-xs" />
              <Select
                value={status}
                onChange={setStatus}
                ariaLabel="Filter by status"
                className="h-8 text-xs"
                options={[
                  { value: "", label: "Any status" },
                  { value: "ok", label: "OK" },
                  { value: "error", label: "Error" },
                  { value: "rate_limited", label: "Rate limited" },
                ]}
              />
            </>
          }
        >
          {events.error && <ErrorBanner message={events.error} onRetry={events.reload} />}
          {events.loading ? (
            <LoadingBlock rows={6} />
          ) : (
            <>
              <DataTable<UsageEvent>
                rows={events.data?.events ?? []}
                rowKey={(r) => r.id}
                dimmed={events.refreshing}
                empty={<EmptyState title="No events match" />}
                columns={[
                  {
                    key: "time",
                    header: "Time",
                    cell: (r) => <span className="whitespace-nowrap text-text-secondary">{formatDateTime(r.createdAt)}</span>,
                  },
                  {
                    key: "user",
                    header: "User",
                    cell: (r) =>
                      r.userId ? (
                        <button
                          type="button"
                          className="max-w-[220px] truncate text-left hover:text-accent-text hover:underline"
                          onClick={() => onOpenUser(r.userId!)}
                        >
                          {r.userEmail ?? r.userId}
                        </button>
                      ) : (
                        <span className="text-text-tertiary">—</span>
                      ),
                  },
                  { key: "action", header: "Action", cell: (r) => actionLabel(r.action) },
                  {
                    key: "status",
                    header: "Status",
                    cell: (r) =>
                      r.status === "ok" ? (
                        <Pill tone="success">OK</Pill>
                      ) : (
                        <Pill tone={r.status === "rate_limited" ? "warning" : "danger"}>
                          {r.errorCode ? humanizeKey(r.errorCode) : humanizeKey(r.status)}
                        </Pill>
                      ),
                  },
                  {
                    key: "model",
                    header: "Model",
                    hideOnMobile: true,
                    cell: (r) => <span className="text-xs text-text-tertiary">{r.model ?? "—"}</span>,
                  },
                  {
                    key: "duration",
                    header: "Time taken",
                    align: "right",
                    hideOnMobile: true,
                    cell: (r) => (r.durationMs != null ? formatDuration(r.durationMs) : "—"),
                  },
                ]}
              />
              <Pagination offset={offset} limit={EVENTS_PAGE} total={events.data?.total ?? 0} onChange={setOffset} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
