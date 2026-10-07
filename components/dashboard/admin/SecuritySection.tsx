"use client";

import * as React from "react";
import { Download, Loader2, Plus, ShieldCheck, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  Pagination,
  Pill,
  SearchInput,
  Segmented,
  useConfirm,
} from "../ui";
import { useToast } from "../toast";
import { useApi } from "@/lib/use-api";
import { adminApi, downloadCsv, type AuditEvent, type SecurityEvent } from "@/lib/admin-api";
import { formatDateTime, humanizeKey } from "@/lib/format";
import { useDebounced } from "./shared";

type Tab = "audit" | "security" | "admins" | "maintenance";
const PAGE = 30;

function MetadataCell({ raw }: { raw: string | null }) {
  if (!raw) return <span className="text-text-tertiary">—</span>;
  let text = raw;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    text = Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" · ");
  } catch {
    /* show raw */
  }
  return (
    <span className="block max-w-[320px] truncate text-xs text-text-tertiary" title={text}>
      {text || "—"}
    </span>
  );
}

export function SecuritySection({ me }: { me: { email: string } }) {
  const [tab, setTab] = React.useState<Tab>("audit");
  return (
    <>
      <PageHeader title="Security & access" description="Audit trail, blocked sign-in attempts, who can administer the app and housekeeping." />
      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          ariaLabel="Security sections"
          options={[
            { value: "audit", label: "Audit log" },
            { value: "security", label: "Threats" },
            { value: "admins", label: "Admins" },
            { value: "maintenance", label: "Maintenance" },
          ]}
        />
      </div>
      {tab === "audit" && <AuditLog />}
      {tab === "security" && <SecurityEvents />}
      {tab === "admins" && <AdminsEditor me={me} />}
      {tab === "maintenance" && <Maintenance />}
    </>
  );
}

function AuditLog() {
  const [search, setSearch] = React.useState("");
  const q = useDebounced(search.trim());
  const [offset, setOffset] = React.useState(0);
  React.useEffect(() => setOffset(0), [q]);
  const logs = useApi((s) => adminApi.auditLogs({ limit: PAGE, offset, q: q || undefined }, s), [offset, q]);
  return (
    <Card
      title="Audit log"
      description="Sign-ins, approvals, bans, password changes and admin actions."
      actions={<SearchInput value={search} onChange={setSearch} placeholder="Email or IP…" className="w-56" />}
    >
      {logs.error && <ErrorBanner message={logs.error} onRetry={logs.reload} />}
      {logs.loading ? (
        <LoadingBlock rows={8} />
      ) : (
        <>
          <DataTable<AuditEvent>
            rows={logs.data?.events ?? []}
            rowKey={(r) => r.id}
            dimmed={logs.refreshing}
            empty={<EmptyState title="No events" />}
            columns={[
              { key: "time", header: "Time", cell: (r) => <span className="whitespace-nowrap text-text-secondary">{formatDateTime(r.createdAt)}</span> },
              { key: "event", header: "Event", cell: (r) => humanizeKey(r.eventType) },
              { key: "user", header: "User", cell: (r) => <span className="text-text-secondary">{r.userEmail ?? "—"}</span> },
              { key: "ip", header: "IP", hideOnMobile: true, cell: (r) => <span className="text-xs text-text-tertiary">{r.ipAddress ?? "—"}</span> },
              { key: "meta", header: "Details", hideOnMobile: true, cell: (r) => <MetadataCell raw={r.metadata} /> },
            ]}
          />
          <Pagination offset={offset} limit={PAGE} total={logs.data?.total ?? 0} onChange={setOffset} />
        </>
      )}
    </Card>
  );
}

function SecurityEvents() {
  const [search, setSearch] = React.useState("");
  const q = useDebounced(search.trim());
  const [offset, setOffset] = React.useState(0);
  React.useEffect(() => setOffset(0), [q]);
  const events = useApi((s) => adminApi.securityEvents({ limit: PAGE, offset, q: q || undefined }, s), [offset, q]);
  return (
    <Card
      title="Threat events"
      description="Credential stuffing, rate-limit hits and disposable-email sign-ups caught by the sentinel."
      actions={<SearchInput value={search} onChange={setSearch} placeholder="Email or IP…" className="w-56" />}
    >
      {events.error && <ErrorBanner message={events.error} onRetry={events.reload} />}
      {events.loading ? (
        <LoadingBlock rows={8} />
      ) : (
        <>
          <DataTable<SecurityEvent>
            rows={events.data?.events ?? []}
            rowKey={(r) => r.id}
            dimmed={events.refreshing}
            empty={<EmptyState icon={ShieldCheck} title="No threats recorded" description="Nothing suspicious so far." />}
            columns={[
              { key: "time", header: "Time", cell: (r) => <span className="whitespace-nowrap text-text-secondary">{formatDateTime(r.createdAt)}</span> },
              { key: "event", header: "Threat", cell: (r) => humanizeKey(r.eventType) },
              {
                key: "action",
                header: "Response",
                cell: (r) => (
                  <Pill tone={r.action === "block" ? "danger" : r.action === "challenge" ? "warning" : "neutral"}>
                    {humanizeKey(r.action)}
                  </Pill>
                ),
              },
              { key: "who", header: "Email / IP", cell: (r) => <span className="text-xs text-text-secondary">{r.userEmail ?? r.ipAddress ?? "—"}</span> },
              { key: "meta", header: "Details", hideOnMobile: true, cell: (r) => <MetadataCell raw={r.metadata} /> },
            ]}
          />
          <Pagination offset={offset} limit={PAGE} total={events.data?.total ?? 0} onChange={setOffset} />
        </>
      )}
    </Card>
  );
}

function AdminsEditor({ me }: { me: { email: string } }) {
  const toast = useToast();
  const admins = useApi((s) => adminApi.admins(s), []);
  const [draft, setDraft] = React.useState<string[] | null>(null);
  const [email, setEmail] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (admins.data) setDraft(admins.data.dbAdmins);
  }, [admins.data]);

  const add = () => {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return toast.error("Enter a valid email address");
    if (draft?.includes(e) || admins.data?.envAdmins.includes(e)) return toast.info("Already an admin");
    setDraft([...(draft ?? []), e]);
    setEmail("");
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await adminApi.setAdmins(draft);
      toast.success("Admin list saved");
      void admins.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const dirty = admins.data && draft && JSON.stringify([...draft].sort()) !== JSON.stringify([...admins.data.dbAdmins].sort());

  return (
    <Card
      title="Administrators"
      description="People who can open this panel. Admins from the ADMIN_EMAILS environment variable can only be changed on the server."
    >
      {admins.error && <ErrorBanner message={admins.error} onRetry={admins.reload} />}
      {!admins.data || !draft ? (
        <LoadingBlock rows={3} />
      ) : (
        <div className="space-y-4">
          <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
            {admins.data.envAdmins.map((e) => (
              <li key={`env-${e}`} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{e}</span>
                {e === me.email.toLowerCase() && <Pill tone="accent">You</Pill>}
                <Pill>Environment</Pill>
              </li>
            ))}
            {draft.map((e) => (
              <li key={`db-${e}`} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{e}</span>
                {e === me.email.toLowerCase() && <Pill tone="accent">You</Pill>}
                <Pill tone="info">Dashboard</Pill>
                <button
                  type="button"
                  onClick={() => setDraft(draft.filter((x) => x !== e))}
                  aria-label={`Remove ${e}`}
                  className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary hover:bg-destructive-muted hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
              placeholder="new.admin@company.com"
              aria-label="Admin email"
            />
            <Button variant="secondary" onClick={add}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add
            </Button>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void save()} disabled={!dirty || saving}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save admin list
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Maintenance() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = React.useState<string | null>(null);

  const cleanup = async () => {
    const ok = await confirm({
      title: "Run cleanup?",
      description: "Removes expired sign-in sessions and old rate-limit records. Active users are not affected.",
      confirmLabel: "Run cleanup",
    });
    if (!ok) return;
    setBusy("cleanup");
    try {
      await adminApi.cleanup();
      toast.success("Cleanup complete");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cleanup failed");
    } finally {
      setBusy(null);
    }
  };

  const exportStats = async () => {
    setBusy("stats");
    try {
      const { csv } = await adminApi.exportStats();
      downloadCsv(csv, `stats-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {dialog}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Clean up expired data">
          <p className="mb-4 text-[13px] leading-relaxed text-text-secondary">
            Deletes expired sign-in sessions and rate-limit counters to keep the database lean.
          </p>
          <Button variant="outline" onClick={() => void cleanup()} disabled={busy !== null}>
            {busy === "cleanup" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            Run cleanup
          </Button>
        </Card>
        <Card title="Export platform stats">
          <p className="mb-4 text-[13px] leading-relaxed text-text-secondary">
            Download a CSV snapshot: users, sign-ups, sessions, notes and security blocks.
          </p>
          <Button variant="outline" onClick={() => void exportStats()} disabled={busy !== null}>
            {busy === "stats" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            Download CSV
          </Button>
        </Card>
      </div>
    </>
  );
}
