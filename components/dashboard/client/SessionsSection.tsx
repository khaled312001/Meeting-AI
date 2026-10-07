"use client";

import * as React from "react";
import { Radio } from "lucide-react";
import { Card, DataTable, EmptyState, ErrorBanner, LoadingBlock, PageHeader, Pagination, Pill, RefreshButton } from "../ui";
import { useApi } from "@/lib/use-api";
import { listMySessions, type MySession } from "@/lib/dashboard-api";
import { formatDateTime, formatDuration, formatNumber, formatRelative, humanizeKey } from "@/lib/format";

const PAGE = 20;

export function sessionStatusPill(status: MySession["status"]) {
  if (status === "active")
    return (
      <Pill tone="success" dot>
        Live
      </Pill>
    );
  if (status === "stale") return <Pill tone="warning">Idle</Pill>;
  return <Pill tone="neutral">Ended</Pill>;
}

export function SessionsSection() {
  const [offset, setOffset] = React.useState(0);
  const sessions = useApi((signal) => listMySessions(PAGE, offset, signal), [offset]);
  const rows = sessions.data?.sessions ?? [];

  return (
    <>
      <PageHeader
        title="Session history"
        description="Every live assistant session you've run — when it started, how long it lasted and how much happened."
        actions={<RefreshButton onClick={() => void sessions.reload()} spinning={sessions.refreshing} />}
      />
      {sessions.error && (
        <div className="mb-4">
          <ErrorBanner message={sessions.error} onRetry={sessions.reload} />
        </div>
      )}
      <Card>
        {sessions.loading ? (
          <LoadingBlock rows={6} />
        ) : (
          <>
            <DataTable<MySession>
              rows={rows}
              rowKey={(r) => r.id}
              dimmed={sessions.refreshing}
              empty={
                <EmptyState
                  icon={Radio}
                  title="No sessions yet"
                  description="Start the assistant during a meeting or interview — your sessions will show up here."
                />
              }
              columns={[
                {
                  key: "started",
                  header: "Started",
                  cell: (r) => (
                    <div>
                      <div className="text-text-primary">{formatDateTime(r.startedAt)}</div>
                      <div className="text-xs text-text-tertiary">{formatRelative(r.startedAt)}</div>
                    </div>
                  ),
                },
                { key: "status", header: "Status", cell: (r) => sessionStatusPill(r.status) },
                {
                  key: "duration",
                  header: "Duration",
                  align: "right",
                  cell: (r) => formatDuration(r.durationMs),
                },
                {
                  key: "events",
                  header: "Events",
                  align: "right",
                  hideOnMobile: true,
                  cell: (r) => formatNumber(r.eventCount),
                },
                {
                  key: "surface",
                  header: "Source",
                  hideOnMobile: true,
                  cell: (r) => <span className="text-text-secondary">{r.surface ? humanizeKey(r.surface) : "—"}</span>,
                },
                {
                  key: "end",
                  header: "Ended by",
                  hideOnMobile: true,
                  cell: (r) => (
                    <span className="text-text-tertiary">{r.endReason ? humanizeKey(r.endReason) : "—"}</span>
                  ),
                },
              ]}
            />
            <Pagination offset={offset} limit={PAGE} total={sessions.data?.total ?? 0} onChange={setOffset} />
          </>
        )}
      </Card>
    </>
  );
}
