"use client";

import * as React from "react";
import { Radio, Square } from "lucide-react";
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
  RefreshButton,
  SearchInput,
  Segmented,
  useConfirm,
} from "../ui";
import { useToast } from "../toast";
import { useApi } from "@/lib/use-api";
import { adminApi, type LiveSession } from "@/lib/admin-api";
import { formatDuration, formatNumber, formatRelative, humanizeKey } from "@/lib/format";
import { useDebounced } from "./shared";

const PAGE = 25;
type StatusFilter = "active" | "stale" | "ended" | "all";

function statusPill(s: LiveSession["status"]) {
  if (s === "active")
    return (
      <Pill tone="success" dot>
        Live
      </Pill>
    );
  if (s === "stale") return <Pill tone="warning">Idle</Pill>;
  return <Pill tone="neutral">Ended</Pill>;
}

export function LiveSessionsSection() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [status, setStatus] = React.useState<StatusFilter>("active");
  const [search, setSearch] = React.useState("");
  const q = useDebounced(search.trim());
  const [offset, setOffset] = React.useState(0);

  React.useEffect(() => setOffset(0), [status, q]);

  const sessions = useApi(
    (s) =>
      adminApi.liveSessions(
        { limit: PAGE, offset, status: status === "all" ? undefined : status, q: q || undefined },
        s,
      ),
    [offset, status, q],
    { pollMs: 15_000 },
  );

  const terminate = async (row: LiveSession) => {
    const ok = await confirm({
      title: "End this session?",
      description: `${row.userEmail ?? "This user"} will lose live transcription immediately. Their transcription key is revoked.`,
      confirmLabel: "End session",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await adminApi.terminateLiveSession(row.id, "terminated_by_admin");
      toast.success(res.deepgramRevoked ? "Session ended" : "Session ended (transcription key revoke pending)");
      void sessions.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't end the session");
    }
  };

  return (
    <>
      {dialog}
      <PageHeader
        title="Live sessions"
        description="Assistant sessions in progress right now. Refreshes every 15 seconds."
        actions={<RefreshButton onClick={() => void sessions.reload()} spinning={sessions.refreshing} />}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Segmented
          value={status}
          onChange={setStatus}
          ariaLabel="Session status"
          options={[
            { value: "active", label: "Live" },
            { value: "stale", label: "Idle" },
            { value: "ended", label: "Ended" },
            { value: "all", label: "All" },
          ]}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Search email or IP…" className="sm:ml-auto sm:w-72" />
      </div>

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
            <DataTable<LiveSession>
              rows={sessions.data?.sessions ?? []}
              rowKey={(r) => r.id}
              empty={
                <EmptyState
                  icon={Radio}
                  title={status === "active" ? "Nobody is live right now" : "No sessions found"}
                  description={status === "active" ? "Sessions appear here as soon as someone starts the assistant." : undefined}
                />
              }
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
                { key: "status", header: "Status", cell: (r) => statusPill(r.status) },
                {
                  key: "started",
                  header: "Started",
                  cell: (r) => <span className="text-text-secondary">{formatRelative(r.startedAt)}</span>,
                },
                { key: "duration", header: "Duration", align: "right", cell: (r) => formatDuration(r.durationMs) },
                {
                  key: "events",
                  header: "Events",
                  align: "right",
                  hideOnMobile: true,
                  cell: (r) => formatNumber(r.eventCount),
                },
                {
                  key: "where",
                  header: "Source",
                  hideOnMobile: true,
                  cell: (r) => (
                    <div className="text-xs text-text-tertiary">
                      <div>{r.surface ? humanizeKey(r.surface) : "—"}</div>
                      <div>{r.ipAddress ?? ""}</div>
                    </div>
                  ),
                },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  cell: (r) =>
                    r.status !== "ended" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="hover:bg-destructive-muted hover:text-destructive"
                        onClick={() => void terminate(r)}
                      >
                        <Square className="mr-1.5 h-3 w-3" /> End
                      </Button>
                    ) : (
                      <span className="text-xs text-text-tertiary">{r.endReason ? humanizeKey(r.endReason) : ""}</span>
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
