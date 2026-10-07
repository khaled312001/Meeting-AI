"use client";

import * as React from "react";
import { Ban, CheckCircle2, Download, Trash2, UserCheck, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Avatar,
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
import { adminApi, downloadCsv, type AdminUser, type UserFilter } from "@/lib/admin-api";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import { planLabel } from "../labels";
import { UserDrawer } from "./UserDrawer";
import { useBanReason, useDebounced, userStatusPill } from "./shared";

const PAGE = 25;

export function UsersSection({ initialUserId }: { initialUserId?: string | null }) {
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { ask: askBanReason, dialog: banDialog } = useBanReason();
  const [filter, setFilter] = React.useState<UserFilter>("all");
  const [search, setSearch] = React.useState("");
  const q = useDebounced(search.trim());
  const [offset, setOffset] = React.useState(0);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [openUserId, setOpenUserId] = React.useState<string | null>(initialUserId ?? null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setOffset(0);
    setSelected(new Set());
  }, [filter, q]);

  const users = useApi(
    (s) => adminApi.listUsers({ limit: PAGE, offset, q: q || undefined, filter }, s),
    [offset, q, filter],
  );
  const overview = useApi((s) => adminApi.overview(s), []);
  const stats = overview.data?.stats;

  const rows = users.data?.users ?? [];
  const ids = [...selected];

  const runBulk = async (label: string, fn: () => Promise<{ affected: number }>) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(`${label}: ${formatNumber(res.affected)} user${res.affected === 1 ? "" : "s"}`);
      setSelected(new Set());
      void users.reload();
      void overview.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk action failed");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    try {
      const { csv } = await adminApi.exportUsers();
      downloadCsv(csv, `users-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  return (
    <>
      {confirmDialog}
      {banDialog}
      <PageHeader
        title="Users"
        description="Approve sign-ups, manage access, plans and per-user AI settings."
        actions={
          <>
            <RefreshButton onClick={() => void users.reload()} spinning={users.refreshing} />
            <Button variant="outline" onClick={() => void exportCsv()}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Segmented
          value={filter}
          onChange={setFilter}
          ariaLabel="Filter users"
          options={[
            { value: "all", label: "All", count: stats?.totalUsers },
            { value: "pending", label: "Pending", count: stats?.pendingApproval },
            { value: "approved", label: "Approved" },
            { value: "banned", label: "Banned", count: stats?.bannedUsers },
          ]}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Search name or email…" className="sm:ml-auto sm:w-72" />
      </div>

      {selected.size > 0 && (
        <div className="dash-toast-in mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent-muted px-4 py-2.5">
          <span className="mr-auto text-[13px] font-medium text-text-primary">{selected.size} selected</span>
          <Button size="sm" disabled={busy} onClick={() => void runBulk("Approved", () => adminApi.bulkApprove(ids, true))}>
            <UserCheck className="mr-1.5 h-3 w-3" /> Approve
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void runBulk("Approval revoked", () => adminApi.bulkApprove(ids, false))}
          >
            Revoke approval
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              const reason = await askBanReason(ids.length);
              if (reason === null) return;
              void runBulk("Banned", () => adminApi.bulkBan(ids, true, reason || undefined));
            }}
          >
            <Ban className="mr-1.5 h-3 w-3" /> Ban
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void runBulk("Unbanned", () => adminApi.bulkBan(ids, false))}
          >
            <CheckCircle2 className="mr-1.5 h-3 w-3" /> Unban
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              const ok = await confirm({
                title: `Delete ${ids.length} user${ids.length === 1 ? "" : "s"}?`,
                description: "Their accounts, notes and interview profiles are permanently removed.",
                confirmLabel: "Delete permanently",
                destructive: true,
              });
              if (ok) void runBulk("Deleted", () => adminApi.bulkDelete(ids));
            }}
          >
            <Trash2 className="mr-1.5 h-3 w-3" /> Delete
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setSelected(new Set())} aria-label="Clear selection">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {users.error && (
        <div className="mb-4">
          <ErrorBanner message={users.error} onRetry={users.reload} />
        </div>
      )}

      <Card>
        {users.loading ? (
          <LoadingBlock rows={8} />
        ) : (
          <>
            <DataTable<AdminUser>
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => setOpenUserId(r.id)}
              selectable
              selected={selected}
              onSelectedChange={setSelected}
              dimmed={users.refreshing}
              empty={
                <EmptyState
                  icon={Users}
                  title={q || filter !== "all" ? "No users match" : "No users yet"}
                  description={q || filter !== "all" ? "Try another filter or search." : undefined}
                />
              }
              columns={[
                {
                  key: "user",
                  header: "User",
                  cell: (u) => (
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={u.name} email={u.email} size={30} />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-text-primary">{u.name || "—"}</div>
                        <div className="truncate text-xs text-text-tertiary">{u.email}</div>
                      </div>
                    </div>
                  ),
                },
                { key: "status", header: "Status", cell: (u) => userStatusPill(u) },
                {
                  key: "plan",
                  header: "Plan",
                  hideOnMobile: true,
                  cell: (u) => (
                    <div>
                      <div className="text-text-secondary">{planLabel(u.quota?.planTier ?? "legacy_unlimited")}</div>
                      {u.quota && (
                        <div className="text-xs tabular-nums text-text-tertiary">
                          {formatNumber(u.quota.consumedCompletions ?? 0)}
                          {u.quota.monthlyAllowanceCompletions != null
                            ? ` / ${formatNumber(u.quota.monthlyAllowanceCompletions)}`
                            : ""}{" "}
                          answers
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: "active",
                  header: "Last active",
                  hideOnMobile: true,
                  cell: (u) => <span className="text-text-secondary">{u.lastActiveAt ? formatRelative(u.lastActiveAt) : "Never"}</span>,
                },
                {
                  key: "joined",
                  header: "Joined",
                  hideOnMobile: true,
                  cell: (u) => <span className="text-text-secondary">{formatDate(u.createdAt)}</span>,
                },
              ]}
            />
            <Pagination offset={offset} limit={PAGE} total={users.data?.total ?? 0} onChange={setOffset} />
          </>
        )}
      </Card>

      <UserDrawer
        userId={openUserId}
        onClose={() => setOpenUserId(null)}
        onChanged={() => {
          void users.reload();
          void overview.reload();
        }}
      />
    </>
  );
}
