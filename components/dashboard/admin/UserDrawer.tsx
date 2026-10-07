"use client";

import * as React from "react";
import { Ban, CheckCircle2, Loader2, LogOut, RotateCcw, Trash2, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Avatar,
  Drawer,
  ErrorBanner,
  Field,
  KeyValue,
  LoadingBlock,
  Meter,
  Pill,
  Segmented,
  Select,
  StatCard,
  useConfirm,
} from "../ui";
import { BarList } from "../charts";
import { useToast } from "../toast";
import { useApi } from "@/lib/use-api";
import {
  adminApi,
  PLAN_TIERS,
  type PlanTier,
  type ThinkingBudget,
  type UserDetail,
} from "@/lib/admin-api";
import { formatDate, formatDateTime, formatDuration, formatNumber, formatRelative, humanizeKey } from "@/lib/format";
import { actionLabel, planLabel } from "../labels";
import { useBanReason, userStatusPill } from "./shared";

type Tab = "overview" | "plan" | "ai" | "activity";

export function UserDrawer({
  userId,
  onClose,
  onChanged,
}: {
  userId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { ask: askBanReason, dialog: banDialog } = useBanReason();
  const [tab, setTab] = React.useState<Tab>("overview");
  const [busy, setBusy] = React.useState(false);
  const detail = useApi((s) => adminApi.getUser(userId!, s), [userId], { enabled: Boolean(userId) });

  React.useEffect(() => {
    setTab("overview");
    detail.setData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const d = detail.data;
  const u = d?.user;

  const act = async (label: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      onChanged();
      if (after) after();
      else void detail.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {confirmDialog}
      {banDialog}
      <Drawer
        open={userId !== null}
        onClose={onClose}
        width="max-w-2xl"
        title={
          u ? (
            <span className="flex items-center gap-2.5">
              <Avatar name={u.name} email={u.email} size={28} />
              <span className="truncate">{u.name || u.email}</span>
            </span>
          ) : (
            "User"
          )
        }
        subtitle={
          u ? (
            <span className="flex flex-wrap items-center gap-2 pl-[38px]">
              {u.email} {userStatusPill(u)}
              {u.emailVerified && <Pill tone="info">Email verified</Pill>}
            </span>
          ) : undefined
        }
        footer={
          u ? (
            <>
              <Button
                variant="ghost"
                className="mr-auto hover:bg-destructive-muted hover:text-destructive"
                disabled={busy}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete ${u.email}?`,
                    description: "Their account, notes and interview profile are permanently removed.",
                    confirmLabel: "Delete permanently",
                    destructive: true,
                  });
                  if (ok) void act("User deleted", () => adminApi.deleteUser(u.id), onClose);
                }}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void act("Signed out everywhere", () => adminApi.revokeAllSessions(u.id))}
              >
                <LogOut className="mr-1.5 h-3.5 w-3.5" /> Sign out everywhere
              </Button>
              {u.isBanned ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act("User unbanned", () => adminApi.updateUser({ userId: u.id, isBanned: false }))}
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Unban
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    const reason = await askBanReason(1);
                    if (reason === null) return;
                    void act("User banned", () =>
                      adminApi.updateUser({ userId: u.id, isBanned: true, banReason: reason || undefined }),
                    );
                  }}
                >
                  <Ban className="mr-1.5 h-3.5 w-3.5" /> Ban
                </Button>
              )}
              {u.isApproved ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act("Approval revoked", () => adminApi.updateUser({ userId: u.id, isApproved: false }))
                  }
                >
                  <UserX className="mr-1.5 h-3.5 w-3.5" /> Revoke approval
                </Button>
              ) : (
                <Button
                  disabled={busy}
                  onClick={() => void act("User approved", () => adminApi.updateUser({ userId: u.id, isApproved: true }))}
                >
                  <UserCheck className="mr-1.5 h-3.5 w-3.5" /> Approve
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {detail.error && <ErrorBanner message={detail.error} onRetry={detail.reload} />}
        {!d ? (
          !detail.error && <LoadingBlock rows={6} />
        ) : (
          <>
            {u?.isBanned && u.banReason && (
              <div className="mb-4 rounded-lg bg-destructive-muted px-3 py-2 text-[13px] text-text-primary">
                <span className="font-medium text-destructive">Ban reason:</span> {u.banReason}
              </div>
            )}
            <div className="mb-5">
              <Segmented
                value={tab}
                onChange={setTab}
                ariaLabel="User details"
                options={[
                  { value: "overview", label: "Overview" },
                  { value: "plan", label: "Plan & quota" },
                  { value: "ai", label: "AI settings" },
                  { value: "activity", label: "Activity" },
                ]}
              />
            </div>
            {tab === "overview" && <OverviewTab d={d} />}
            {tab === "plan" && <PlanTab d={d} onSaved={() => void detail.reload()} />}
            {tab === "ai" && <AiTab d={d} onSaved={() => void detail.reload()} />}
            {tab === "activity" && <ActivityTab d={d} />}
          </>
        )}
      </Drawer>
    </>
  );
}

function OverviewTab({ d }: { d: UserDetail }) {
  const per = new Map(d.usage.perAction.map((p) => [p.action, p]));
  const answers = per.get("completion")?.events ?? 0;
  return (
    <div className="space-y-5">
      <KeyValue
        items={[
          { label: "Joined", value: formatDateTime(d.user.createdAt) },
          { label: "Last active", value: d.user.lastActiveAt ? formatRelative(d.user.lastActiveAt) : "Never" },
          { label: "Saved answers", value: formatNumber(d.notesCount) },
          { label: "Interview profile", value: d.hasInterviewContext ? "Filled in" : "Empty" },
          { label: "Plan", value: planLabel(d.quota.planTier) },
          { label: "User ID", value: <code className="text-xs text-text-secondary">{d.user.id}</code> },
        ]}
      />
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">Last 30 days</h3>
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="AI answers" value={answers} />
          <StatCard label="All events" value={d.usage.totals.events} />
          <StatCard
            label="Failed"
            value={d.usage.totals.errors}
            tone={d.usage.totals.errors > 0 ? "warning" : "default"}
          />
        </div>
      </div>
      {d.usage.perAction.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-tertiary">Activity by type</h3>
          <BarList
            data={d.usage.perAction.map((p) => ({
              key: p.action,
              label: actionLabel(p.action),
              value: p.events,
              detail: p.errors ? `${p.errors} failed` : undefined,
            }))}
          />
        </div>
      )}
    </div>
  );
}

function numOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function PlanTab({ d, onSaved }: { d: UserDetail; onSaved: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const tiers = useApi((s) => adminApi.quotaTiers(s), []);
  const q = d.quota;
  const [tier, setTier] = React.useState<PlanTier>((PLAN_TIERS as readonly string[]).includes(q.planTier) ? (q.planTier as PlanTier) : "legacy_unlimited");
  const [answers, setAnswers] = React.useState(q.monthlyAllowanceCompletions?.toString() ?? "");
  const [minutes, setMinutes] = React.useState(
    q.monthlyAllowanceSeconds != null ? Math.round(q.monthlyAllowanceSeconds / 60).toString() : "",
  );
  const [overage, setOverage] = React.useState(q.overageAllowed);
  const [saving, setSaving] = React.useState(false);

  const applyTierDefaults = (t: PlanTier) => {
    setTier(t);
    const preset = tiers.data?.tiers[t];
    if (preset) {
      setAnswers(preset.monthlyAllowanceCompletions?.toString() ?? "");
      setMinutes(preset.monthlyAllowanceSeconds != null ? Math.round(preset.monthlyAllowanceSeconds / 60).toString() : "");
    } else if (t === "unlimited" || t === "legacy_unlimited") {
      setAnswers("");
      setMinutes("");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const mins = numOrNull(minutes);
      await adminApi.setQuota({
        userId: d.user.id,
        planTier: tier,
        monthlyAllowanceCompletions: numOrNull(answers),
        monthlyAllowanceSeconds: mins == null ? null : mins * 60,
        overageAllowed: overage,
      });
      toast.success("Plan updated");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the plan");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    const ok = await confirm({
      title: "Reset this billing cycle?",
      description: "Usage counters go back to zero and the next reset moves to 30 days from now.",
      confirmLabel: "Reset cycle",
    });
    if (!ok) return;
    try {
      await adminApi.resetQuotaCycle(d.user.id);
      toast.success("Cycle reset");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reset the cycle");
    }
  };

  return (
    <div className="space-y-6">
      {dialog}
      <div className="space-y-4 rounded-xl border border-border-subtle bg-surface-raised p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-text-primary">This cycle</h3>
          <span className="text-xs text-text-tertiary">Resets {formatDate(q.cycleResetAt)}</span>
        </div>
        <Meter
          label="AI answers"
          value={q.consumedCompletions}
          max={q.monthlyAllowanceCompletions}
          detail={`${formatNumber(q.consumedCompletions)}${q.monthlyAllowanceCompletions != null ? ` / ${formatNumber(q.monthlyAllowanceCompletions)}` : " · unlimited"}`}
        />
        <Meter
          label="Transcription"
          value={q.consumedSeconds}
          max={q.monthlyAllowanceSeconds}
          detail={`${formatDuration(q.consumedSeconds * 1000)}${q.monthlyAllowanceSeconds != null ? ` / ${formatDuration(q.monthlyAllowanceSeconds * 1000)}` : " · unlimited"}`}
        />
        <Button variant="outline" size="sm" onClick={() => void reset()}>
          <RotateCcw className="mr-1.5 h-3 w-3" /> Reset cycle
        </Button>
      </div>

      <div className="space-y-4">
        <Field label="Plan" htmlFor="plan-tier" hint="Choosing a plan fills in its default allowances.">
          <Select
            id="plan-tier"
            value={tier}
            onChange={(v) => applyTierDefaults(v as PlanTier)}
            options={PLAN_TIERS.map((t) => ({ value: t, label: planLabel(t) }))}
            className="w-full"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="AI answers per month" htmlFor="plan-answers" hint="Leave empty for unlimited.">
            <Input id="plan-answers" inputMode="numeric" value={answers} onChange={(e) => setAnswers(e.target.value)} placeholder="Unlimited" />
          </Field>
          <Field label="Transcription minutes per month" htmlFor="plan-minutes" hint="Leave empty for unlimited.">
            <Input id="plan-minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Unlimited" />
          </Field>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2.5">
          <span>
            <span className="block text-[13px] text-text-primary">Allow overage</span>
            <span className="block text-xs text-text-tertiary">Keep working past the allowance (when enforcement is on).</span>
          </span>
          <Switch checked={overage} onCheckedChange={setOverage} />
        </label>
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save plan
          </Button>
        </div>
      </div>
    </div>
  );
}

const INHERIT = "__inherit";

function AiTab({ d, onSaved }: { d: UserDetail; onSaved: () => void }) {
  const toast = useToast();
  const o = d.modelParamsOverride;
  const [maxTokens, setMaxTokens] = React.useState(o?.maxOutputTokens?.toString() ?? "");
  const [temperature, setTemperature] = React.useState(o?.temperature?.toString() ?? "");
  const [topP, setTopP] = React.useState(o?.topP?.toString() ?? "");
  const [budget, setBudget] = React.useState<string>(o?.thinkingBudget ?? INHERIT);
  const [saving, setSaving] = React.useState(false);

  const parse = (v: string, int = false): number | null => {
    if (!v.trim()) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return int ? Math.round(n) : n;
  };

  const save = async () => {
    setSaving(true);
    try {
      await adminApi.setUserModelParams({
        userId: d.user.id,
        maxOutputTokens: parse(maxTokens, true),
        temperature: parse(temperature),
        topP: parse(topP),
        thinkingBudget: budget === INHERIT ? null : (budget as ThinkingBudget),
      });
      toast.success("AI settings saved for this user");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await adminApi.deleteUserModelParams(d.user.id);
      setMaxTokens("");
      setTemperature("");
      setTopP("");
      setBudget(INHERIT);
      toast.success("Overrides cleared — global defaults apply");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't clear");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-text-secondary">
        Override the global AI settings for this user only. Empty fields inherit the defaults from{" "}
        <span className="text-text-primary">AI settings</span>. With Anthropic, “Reasoning effort” sets how hard the model
        thinks; temperature and top-p apply to Gemini / OpenAI-compatible models.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Max answer length (tokens)" htmlFor="ump-max" hint="1 – 32,768">
          <Input id="ump-max" inputMode="numeric" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="Inherit" />
        </Field>
        <Field label="Reasoning effort" htmlFor="ump-budget">
          <Select
            id="ump-budget"
            value={budget}
            onChange={setBudget}
            className="w-full"
            options={[
              { value: INHERIT, label: "Inherit" },
              { value: "off", label: "Fastest (off / low)" },
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ]}
          />
        </Field>
        <Field label="Temperature" htmlFor="ump-temp" hint="0 – 2">
          <Input id="ump-temp" inputMode="decimal" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="Inherit" />
        </Field>
        <Field label="Top-p" htmlFor="ump-topp" hint="0 – 1">
          <Input id="ump-topp" inputMode="decimal" value={topP} onChange={(e) => setTopP(e.target.value)} placeholder="Inherit" />
        </Field>
      </div>
      {o && <p className="text-xs text-text-tertiary">Last changed {formatRelative(o.updatedAt)}</p>}
      <div className="flex justify-end gap-2">
        {o && (
          <Button variant="ghost" onClick={() => void clear()} disabled={saving}>
            Clear overrides
          </Button>
        )}
        <Button onClick={() => void save()} disabled={saving}>
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save
        </Button>
      </div>
    </div>
  );
}

function ActivityTab({ d }: { d: UserDetail }) {
  const [now] = React.useState(() => Date.now());
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">Account events</h3>
        {d.recentAuditEvents.length === 0 ? (
          <p className="text-[13px] text-text-tertiary">No events.</p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
            {d.recentAuditEvents.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-text-primary">{humanizeKey(e.eventType)}</span>
                <span className="hidden truncate text-xs text-text-tertiary sm:inline">{e.ipAddress}</span>
                <span className="shrink-0 text-xs text-text-tertiary">{formatRelative(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">Sign-in sessions</h3>
        {d.sessions.length === 0 ? (
          <p className="text-[13px] text-text-tertiary">No sessions.</p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
            {d.sessions.map((s) => {
              const expired = new Date(s.expiresAt).getTime() < now;
              return (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-text-primary" title={s.userAgent ?? undefined}>
                    {s.ipAddress || "Unknown IP"}
                  </span>
                  {expired ? <Pill tone="neutral">Expired</Pill> : <Pill tone="success">Active</Pill>}
                  <span className="shrink-0 text-xs text-text-tertiary">{formatRelative(s.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
