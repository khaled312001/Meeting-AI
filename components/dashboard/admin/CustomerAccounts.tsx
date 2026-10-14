"use client";

/** Admin tools for paid customers: create an account with a plan, edit the
 *  plan's credit and dates, and hand over a new password. Public sign-up is
 *  off, so this is the only way new customers get an account. */

import * as React from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyButton, Dialog, Field, Meter, Pill, Select, useConfirm } from "../ui";
import { useToast } from "../toast";
import { useApi } from "@/lib/use-api";
import { adminApi, ANSWER_PRICE_USD, SUBSCRIPTION_PLANS } from "@/lib/admin-api";
import { formatDate, formatNumber } from "@/lib/format";

const NO_PLAN = "__none";
const usd = (n: number) => `$${n.toFixed(2)}`;
const dateInput = (iso: string) => iso.slice(0, 10);

/** Shows a password once, with copy, so the admin can send it to the customer. */
export function PasswordDialog({
  shown,
  onClose,
}: {
  shown: { email: string; password: string; note?: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={shown !== null}
      onClose={onClose}
      title="Send these sign-in details"
      description={
        shown?.note ??
        "This password is shown only once. Copy it now and send it to the customer privately."
      }
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {shown && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-inset px-3 py-2">
            <span className="truncate text-[13px] text-text-primary">{shown.email}</span>
            <CopyButton text={shown.email} label="Copy" />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-inset px-3 py-2">
            <code className="truncate text-[14px] font-semibold tracking-wide text-text-primary">
              {shown.password}
            </code>
            <CopyButton text={shown.password} label="Copy" />
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function AddCustomerDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [plan, setPlan] = React.useState("elite-yearly");
  const [saving, setSaving] = React.useState(false);
  const [shown, setShown] = React.useState<{ email: string; password: string } | null>(null);

  const submit = async () => {
    if (!name.trim() || !email.trim()) {
      toast.error("Name and email are required");
      return;
    }
    setSaving(true);
    try {
      const res = await adminApi.createUser({
        name: name.trim(),
        email: email.trim(),
        plan: plan === NO_PLAN ? undefined : plan,
      });
      setShown({ email: res.user.email, password: res.password });
      setName("");
      setEmail("");
      onClose();
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the account");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PasswordDialog shown={shown} onClose={() => setShown(null)} />
      <Dialog
        open={open}
        onClose={onClose}
        title="Add customer"
        description="Creates an approved account with a generated password. Sign-up is closed, so customers get their account from you after they pay."
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Create account
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" htmlFor="new-name">
            <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Email" htmlFor="new-email">
            <Input
              id="new-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Plan" htmlFor="new-plan">
            <Select
              id="new-plan"
              value={plan}
              onChange={setPlan}
              options={[...SUBSCRIPTION_PLANS, { value: NO_PLAN, label: "No plan yet" }]}
              className="w-full"
            />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

/** Drawer tab: the user's plan and question balance, with controls to add
 *  questions, set what is left, and edit the plan itself. */
export function SubscriptionTab({ userId }: { userId: string }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const data = useApi((s) => adminApi.getSubscription(userId, s), [userId]);
  const sub = data.data?.subscription ?? null;

  const [plan, setPlan] = React.useState("elite-yearly");
  const [total, setTotal] = React.useState("");
  const [used, setUsed] = React.useState("");
  const [startsAt, setStartsAt] = React.useState("");
  const [endsAt, setEndsAt] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!data.data) return;
    const s = data.data.subscription;
    setPlan(s?.plan ?? "elite-yearly");
    setTotal(s ? String(s.answersTotal) : "");
    setUsed(s ? String(s.answersUsed) : "");
    setStartsAt(s ? dateInput(s.startsAt) : "");
    setEndsAt(s ? dateInput(s.endsAt) : "");
  }, [data.data]);

  const questions = (v: string) => (v.trim() === "" ? undefined : Math.floor(Number(v)));

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setSaving(true);
    try {
      await fn();
      toast.success(label);
      void data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the plan");
    } finally {
      setSaving(false);
    }
  };

  const adjust = (action: "add" | "set-left", q: number | undefined) => {
    if (q === undefined || !Number.isFinite(q) || (action === "set-left" && q < 0)) {
      toast.error("Enter a number of questions");
      return;
    }
    void run(
      action === "add"
        ? `${q > 0 ? "Added" : "Removed"} ${Math.abs(q)} questions`
        : `Balance set to ${q} questions`,
      () => adminApi.adjustCredit({ userId, action, usd: q * ANSWER_PRICE_USD }),
    );
  };

  const save = () => {
    const t = questions(total);
    const u = questions(used);
    if ([t, u].some((n) => n !== undefined && !(n >= 0))) {
      toast.error("Questions must be zero or more");
      return;
    }
    void run("Subscription saved", () =>
      adminApi.setSubscription({
        userId,
        plan,
        creditUsd: t === undefined ? undefined : t * ANSWER_PRICE_USD,
        usedUsd: u === undefined ? undefined : u * ANSWER_PRICE_USD,
        startsAt: startsAt ? new Date(`${startsAt}T00:00:00Z`).toISOString() : undefined,
        endsAt: endsAt ? new Date(`${endsAt}T23:59:59Z`).toISOString() : undefined,
      }),
    );
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Remove this subscription?",
      description: "The user keeps their account but no longer has a plan or questions.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) void run("Subscription removed", () => adminApi.deleteSubscription(userId));
  };

  return (
    <div className="space-y-6">
      {dialog}
      {sub ? (
        <div className="space-y-4 rounded-xl border border-border-subtle bg-surface-raised p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-text-primary">{sub.planLabel}</h3>
            <Pill tone={sub.state === "active" ? "success" : "danger"} dot>
              {sub.state}
            </Pill>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-text-primary">
              {formatNumber(sub.answersLeft)}
            </span>
            <span className="text-xs text-text-tertiary">
              of {formatNumber(sub.answersTotal)} questions left · {usd(sub.remainingUsd)}
            </span>
          </div>
          <Meter
            label="Questions used"
            value={sub.answersUsed}
            max={sub.answersTotal}
            detail={`${formatNumber(sub.answersUsed)} / ${formatNumber(sub.answersTotal)}`}
          />
          <p className="text-xs text-text-tertiary">
            {formatDate(sub.startsAt)} → {formatDate(sub.endsAt)} · {usd(ANSWER_PRICE_USD)} per question
          </p>

          <div className="space-y-2 border-t border-border-subtle pt-4">
            <div className="text-xs font-medium text-text-secondary">Add questions</div>
            <div className="flex flex-wrap gap-2">
              {[50, 100, 250, 500, 1000].map((q) => (
                <Button key={q} variant="outline" size="sm" disabled={saving} onClick={() => adjust("add", q)}>
                  +{q}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Input
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Questions"
                className="h-8 w-28"
                aria-label="Number of questions"
              />
              <Button size="sm" disabled={saving} onClick={() => adjust("add", questions(amount))}>
                Add
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => adjust("set-left", questions(amount))}
              >
                Set questions left
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving || sub.answersUsed === 0}
                onClick={() =>
                  void run("Full balance restored", () => adminApi.adjustCredit({ userId, action: "restore" }))
                }
              >
                <RotateCcw className="mr-1.5 h-3 w-3" /> Restore full balance
              </Button>
            </div>
            <p className="text-xs text-text-tertiary">
              Add a negative number to remove questions. &quot;Set questions left&quot; raises the total when needed.
            </p>
          </div>
        </div>
      ) : (
        data.data && (
          <p className="rounded-lg bg-surface-inset px-3 py-2 text-[13px] text-text-secondary">
            No plan. Pick one below and save to activate it.
          </p>
        )
      )}

      <div className="space-y-4">
        <Field label="Plan" htmlFor="sub-plan" hint="A new plan starts today with the plan's questions.">
          <Select
            id="sub-plan"
            value={plan}
            onChange={(v) => {
              setPlan(v);
              if (!sub) {
                setTotal("");
                setStartsAt("");
                setEndsAt("");
              }
            }}
            options={SUBSCRIPTION_PLANS}
            className="w-full"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Total questions" htmlFor="sub-total" hint={`${usd(ANSWER_PRICE_USD)} of credit each.`}>
            <Input
              id="sub-total"
              inputMode="numeric"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              placeholder="Plan default"
            />
          </Field>
          <Field label="Questions used" htmlFor="sub-used" hint="Set to 0 to give the full balance back.">
            <Input id="sub-used" inputMode="numeric" value={used} onChange={(e) => setUsed(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Starts" htmlFor="sub-start">
            <Input id="sub-start" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field label="Ends" htmlFor="sub-end" hint="Empty: the plan's length from the start date.">
            <Input id="sub-end" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-between gap-2">
          {sub ? (
            <Button
              variant="ghost"
              className="hover:bg-destructive-muted hover:text-destructive"
              onClick={() => void remove()}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove plan
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save subscription
          </Button>
        </div>
      </div>
    </div>
  );
}
