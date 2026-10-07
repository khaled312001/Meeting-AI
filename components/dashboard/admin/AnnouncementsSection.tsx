"use client";

import * as React from "react";
import { Megaphone, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  Drawer,
  EmptyState,
  ErrorBanner,
  Field,
  LoadingBlock,
  PageHeader,
  Pagination,
  Pill,
  Segmented,
  Select,
  Textarea,
  useConfirm,
  type PillTone,
} from "../ui";
import { useToast } from "../toast";
import { useApi } from "@/lib/use-api";
import {
  adminApi,
  type Announcement,
  type AnnouncementInput,
  type AnnouncementKind,
  type AnnouncementSeverity,
  type AnnouncementStatus,
} from "@/lib/admin-api";
import { formatDateTime, formatRelative, humanizeKey } from "@/lib/format";

const PAGE = 20;

const SEVERITY_TONE: Record<AnnouncementSeverity, PillTone> = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "danger",
  announcement: "accent",
};

const STATUS_TONE: Record<AnnouncementStatus, PillTone> = {
  active: "success",
  paused: "warning",
  archived: "neutral",
};

/** ISO → value for <input type="datetime-local"> (local time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const EMPTY: AnnouncementInput = {
  kind: "banner",
  severity: "info",
  title: null,
  body: "",
  ctaLabel: null,
  ctaUrl: null,
  audience: "all",
  status: "active",
  dismissable: true,
  startsAt: null,
  expiresAt: null,
};

export function AnnouncementsSection() {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [status, setStatus] = React.useState<AnnouncementStatus | "all">("all");
  const [offset, setOffset] = React.useState(0);
  const [editing, setEditing] = React.useState<Announcement | "new" | null>(null);

  React.useEffect(() => setOffset(0), [status]);
  const list = useApi(
    (s) => adminApi.announcements({ limit: PAGE, offset, status: status === "all" ? undefined : status }, s),
    [offset, status],
  );

  const setRowStatus = async (a: Announcement, next: AnnouncementStatus) => {
    try {
      await adminApi.updateAnnouncement(a.id, { status: next });
      toast.success(next === "active" ? "Announcement live" : `Announcement ${next}`);
      void list.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update");
    }
  };

  const remove = async (a: Announcement) => {
    const ok = await confirm({
      title: "Delete this announcement?",
      description: "It disappears for everyone immediately.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.deleteAnnouncement(a.id);
      toast.success("Announcement deleted");
      void list.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete");
    }
  };

  const rows = list.data?.announcements ?? [];

  return (
    <>
      {dialog}
      <PageHeader
        title="Announcements"
        description="Banners, pop-ups and toasts shown inside the app — maintenance notices, new features, plan changes."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New announcement
          </Button>
        }
      />
      <div className="mb-4">
        <Segmented
          value={status}
          onChange={setStatus}
          ariaLabel="Status"
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "Live" },
            { value: "paused", label: "Paused" },
            { value: "archived", label: "Archived" },
          ]}
        />
      </div>
      {list.error && (
        <div className="mb-4">
          <ErrorBanner message={list.error} onRetry={list.reload} />
        </div>
      )}
      {list.loading ? (
        <Card>
          <LoadingBlock rows={4} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Megaphone}
            title="No announcements"
            description="Create one to reach every user the next time they open the app."
            action={<Button onClick={() => setEditing("new")}>New announcement</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((a) => (
            <article key={a.id} className="rounded-xl border border-border-subtle bg-surface-raised p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={STATUS_TONE[a.status]} dot={a.status === "active"}>
                  {a.status === "active" ? "Live" : humanizeKey(a.status)}
                </Pill>
                <Pill tone={SEVERITY_TONE[a.severity]}>{humanizeKey(a.severity)}</Pill>
                <Pill>{humanizeKey(a.kind)}</Pill>
                {a.audience === "users" && <Pill tone="info">Targeted</Pill>}
                <span className="ml-auto text-xs text-text-tertiary">Created {formatRelative(a.createdAt)}</span>
              </div>
              {a.title && <h3 className="mt-3 text-[14px] font-semibold text-text-primary">{a.title}</h3>}
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">{a.body}</p>
              {(a.startsAt || a.expiresAt) && (
                <p className="mt-2 text-xs text-text-tertiary">
                  {a.startsAt && `From ${formatDateTime(a.startsAt)}`}
                  {a.startsAt && a.expiresAt && " · "}
                  {a.expiresAt && `until ${formatDateTime(a.expiresAt)}`}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-3">
                <DismissCount id={a.id} />
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing(a)}>
                  <Pencil className="mr-1.5 h-3 w-3" /> Edit
                </Button>
                {a.status === "active" ? (
                  <Button variant="ghost" size="sm" onClick={() => void setRowStatus(a, "paused")}>
                    <Pause className="mr-1.5 h-3 w-3" /> Pause
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => void setRowStatus(a, "active")}>
                    <Play className="mr-1.5 h-3 w-3" /> Go live
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="hover:bg-destructive-muted hover:text-destructive"
                  onClick={() => void remove(a)}
                >
                  <Trash2 className="mr-1.5 h-3 w-3" /> Delete
                </Button>
              </div>
            </article>
          ))}
          <Pagination offset={offset} limit={PAGE} total={list.data?.total ?? 0} onChange={setOffset} />
        </div>
      )}

      <AnnouncementEditor
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void list.reload();
        }}
      />
    </>
  );
}

function DismissCount({ id }: { id: string }) {
  const stats = useApi((s) => adminApi.announcementStats(id, s), [id]);
  return (
    <span className="text-xs text-text-tertiary">
      {stats.data ? `Dismissed by ${stats.data.dismissed} user${stats.data.dismissed === 1 ? "" : "s"}` : " "}
    </span>
  );
}

function AnnouncementEditor({
  target,
  onClose,
  onSaved,
}: {
  target: Announcement | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = React.useState<AnnouncementInput>(EMPTY);
  const [targets, setTargets] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setError(null);
    if (target === "new" || target === null) {
      setForm(EMPTY);
      setTargets("");
      return;
    }
    setForm({
      kind: target.kind,
      severity: target.severity,
      title: target.title,
      body: target.body,
      ctaLabel: target.ctaLabel,
      ctaUrl: target.ctaUrl,
      audience: target.audience,
      status: target.status,
      dismissable: Boolean(target.dismissable),
      startsAt: target.startsAt,
      expiresAt: target.expiresAt,
    });
    try {
      setTargets(target.targetUserIds ? (JSON.parse(target.targetUserIds) as string[]).join("\n") : "");
    } catch {
      setTargets("");
    }
  }, [target]);

  const set = <K extends keyof AnnouncementInput>(k: K, v: AnnouncementInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setError(null);
    if (!form.body.trim()) return setError("The message can't be empty.");
    const ids = targets
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (form.audience === "users" && ids.length === 0) return setError("Add at least one user ID for a targeted announcement.");
    if (form.ctaUrl && !/^https?:\/\//i.test(form.ctaUrl)) return setError("Button link must start with http:// or https://");
    const body: AnnouncementInput = {
      ...form,
      title: form.title?.trim() || null,
      body: form.body.trim(),
      ctaLabel: form.ctaLabel?.trim() || null,
      ctaUrl: form.ctaUrl?.trim() || null,
      targetUserIds: form.audience === "users" ? ids : undefined,
    };
    setSaving(true);
    try {
      if (target === "new") await adminApi.createAnnouncement(body);
      else if (target) await adminApi.updateAnnouncement(target.id, body);
      toast.success(target === "new" ? "Announcement created" : "Announcement updated");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={target !== null}
      onClose={onClose}
      title={target === "new" ? "New announcement" : "Edit announcement"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {target === "new" ? "Publish" : "Save changes"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type" htmlFor="an-kind">
            <Select
              id="an-kind"
              value={form.kind}
              onChange={(v) => set("kind", v as AnnouncementKind)}
              className="w-full"
              options={[
                { value: "banner", label: "Banner" },
                { value: "popup", label: "Pop-up" },
                { value: "toast", label: "Toast" },
              ]}
            />
          </Field>
          <Field label="Style" htmlFor="an-sev">
            <Select
              id="an-sev"
              value={form.severity}
              onChange={(v) => set("severity", v as AnnouncementSeverity)}
              className="w-full"
              options={[
                { value: "info", label: "Info" },
                { value: "announcement", label: "Announcement" },
                { value: "success", label: "Success" },
                { value: "warning", label: "Warning" },
                { value: "error", label: "Critical" },
              ]}
            />
          </Field>
          <Field label="Status" htmlFor="an-status">
            <Select
              id="an-status"
              value={form.status}
              onChange={(v) => set("status", v as AnnouncementStatus)}
              className="w-full"
              options={[
                { value: "active", label: "Live" },
                { value: "paused", label: "Paused" },
                { value: "archived", label: "Archived" },
              ]}
            />
          </Field>
        </div>
        <Field label="Title (optional)" htmlFor="an-title">
          <Input id="an-title" maxLength={200} value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Message" htmlFor="an-body" hint={`${form.body.length} / 4000`}>
          <Textarea id="an-body" rows={5} maxLength={4000} value={form.body} onChange={(e) => set("body", e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Button label (optional)" htmlFor="an-cta">
            <Input id="an-cta" maxLength={80} value={form.ctaLabel ?? ""} onChange={(e) => set("ctaLabel", e.target.value)} />
          </Field>
          <Field label="Button link" htmlFor="an-url">
            <Input id="an-url" value={form.ctaUrl ?? ""} onChange={(e) => set("ctaUrl", e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Show from (optional)" htmlFor="an-start">
            <Input
              id="an-start"
              type="datetime-local"
              value={toLocalInput(form.startsAt)}
              onChange={(e) => set("startsAt", fromLocalInput(e.target.value))}
            />
          </Field>
          <Field label="Hide after (optional)" htmlFor="an-end">
            <Input
              id="an-end"
              type="datetime-local"
              value={toLocalInput(form.expiresAt)}
              onChange={(e) => set("expiresAt", fromLocalInput(e.target.value))}
            />
          </Field>
        </div>
        <Field label="Audience" htmlFor="an-aud">
          <Select
            id="an-aud"
            value={form.audience}
            onChange={(v) => set("audience", v as "all" | "users")}
            className="w-full"
            options={[
              { value: "all", label: "Everyone" },
              { value: "users", label: "Specific users" },
            ]}
          />
        </Field>
        {form.audience === "users" && (
          <Field label="User IDs" htmlFor="an-targets" hint="One per line. Copy IDs from a user's detail panel.">
            <Textarea id="an-targets" rows={4} value={targets} onChange={(e) => setTargets(e.target.value)} className="font-mono text-xs" />
          </Field>
        )}
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2.5">
          <span>
            <span className="block text-[13px] text-text-primary">Users can dismiss it</span>
            <span className="block text-xs text-text-tertiary">Turn off for must-read notices.</span>
          </span>
          <Switch checked={form.dismissable} onCheckedChange={(v) => set("dismissable", v)} />
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </Drawer>
  );
}
