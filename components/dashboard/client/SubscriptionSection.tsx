"use client";

import * as React from "react";
import {
  CalendarClock,
  CreditCard,
  ExternalLink,
  LifeBuoy,
  MessageSquareText,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  ErrorBanner,
  KeyValue,
  LoadingBlock,
  Meter,
  PageHeader,
  Pill,
  type PillTone,
  RefreshButton,
  StatCard,
} from "../ui";
import { useApi } from "@/lib/use-api";
import { getMyUsage, type SubscriptionSummary } from "@/lib/dashboard-api";
import { formatDate, formatNumber } from "@/lib/format";
import { PRICING_URL } from "@/lib/constant";
import type { ClientSection } from "./ClientDashboard";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const STATE: Record<SubscriptionSummary["state"], { label: string; tone: PillTone }> = {
  active: { label: "Active", tone: "success" },
  exhausted: { label: "Credit used up", tone: "danger" },
  expired: { label: "Expired", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

function daysLeft(endsAt: string): number {
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000));
}

/** Plan, remaining answer credit and how to pay or renew. */
export function SubscriptionSection({ onNavigate }: { onNavigate: (s: ClientSection) => void }) {
  // Polls so the balance visibly drops while the assistant is in use.
  const usage = useApi((signal) => getMyUsage("30d", signal), [], { pollMs: 30_000 });
  const sub = usage.data?.subscription ?? null;

  return (
    <>
      <PageHeader
        title="Subscription & billing"
        description="Your plan, the credit left on it and how to renew. Every answered question uses a small part of the credit."
        actions={<RefreshButton onClick={() => void usage.reload()} spinning={usage.refreshing} />}
      />

      {usage.error && <ErrorBanner message={usage.error} onRetry={() => void usage.reload()} />}
      {!usage.data && usage.loading && <LoadingBlock rows={4} />}

      {usage.data && !sub && (
        <Card title="No active plan">
          <p className="text-[13px] leading-relaxed text-text-secondary">
            This account has no paid plan yet. Plans are activated by our support team after payment.
          </p>
          <PayActions onNavigate={onNavigate} />
        </Card>
      )}

      {sub && <PlanView sub={sub} dimmed={usage.refreshing} onNavigate={onNavigate} />}
    </>
  );
}

function PlanView({
  sub,
  dimmed,
  onNavigate,
}: {
  sub: SubscriptionSummary;
  dimmed: boolean;
  onNavigate: (s: ClientSection) => void;
}) {
  const state = STATE[sub.state];
  const remainingPct = sub.creditUsd > 0 ? (sub.remainingUsd / sub.creditUsd) * 100 : 0;
  const days = daysLeft(sub.endsAt);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          hero
          label="Credit left"
          value={usd(sub.remainingUsd)}
          icon={Wallet}
          hint={`of ${usd(sub.creditUsd)}`}
        />
        <StatCard
          label="Questions left"
          value={formatNumber(sub.answersLeft)}
          icon={MessageSquareText}
          hint={`${usd(sub.answerPriceUsd)} per answered question`}
        />
        <StatCard
          label="Questions answered"
          value={formatNumber(sub.answersUsed)}
          icon={MessageSquareText}
          hint={`${usd(sub.usedUsd)} used`}
        />
        <StatCard
          label="Days left"
          value={formatNumber(days)}
          icon={CalendarClock}
          tone={days <= 14 ? "warning" : "default"}
          hint={`Renews ${formatDate(sub.endsAt)}`}
        />
      </div>

      <Card
        title={sub.planLabel}
        description="Answers from the assistant, Ask AI and practice questions all draw from this credit. Meeting summaries are free."
        actions={<Pill tone={state.tone} dot>{state.label}</Pill>}
        dimmed={dimmed}
      >
        <Meter
          value={sub.usedUsd}
          max={sub.creditUsd}
          label="Credit used"
          detail={`${usd(sub.usedUsd)} / ${usd(sub.creditUsd)} · ${Math.round(remainingPct)}% left`}
        />
        <div className="mt-5">
          <KeyValue
            items={[
              { label: "Plan", value: sub.planLabel },
              { label: "Status", value: state.label },
              { label: "Started", value: formatDate(sub.startsAt) },
              { label: "Ends", value: formatDate(sub.endsAt) },
              { label: "Total questions", value: formatNumber(sub.answersTotal) },
              { label: "Price per question", value: usd(sub.answerPriceUsd) },
            ]}
          />
        </div>
        {sub.state !== "active" && (
          <p className="mt-4 rounded-lg bg-destructive-muted px-3 py-2 text-[12.5px] text-destructive">
            {sub.state === "exhausted"
              ? "Your credit is used up, so new answers are paused. Contact support to top up."
              : "Your plan is not active, so new answers are paused. Contact support to renew."}
          </p>
        )}
      </Card>

      <Card
        title="Payment & renewal"
        description="Payments are made by bank transfer or card. Our support team activates or tops up your plan once payment arrives."
      >
        <PayActions onNavigate={onNavigate} />
      </Card>
    </div>
  );
}

function PayActions({ onNavigate }: { onNavigate: (s: ClientSection) => void }) {
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      <Button onClick={() => onNavigate("support")}>
        <LifeBuoy className="mr-1.5 h-3.5 w-3.5" /> Contact support to renew or top up
      </Button>
      <Button variant="outline" asChild>
        <a href={PRICING_URL} target="_blank" rel="noopener noreferrer">
          <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Plans & prices
          <ExternalLink className="ml-1.5 h-3 w-3" />
        </a>
      </Button>
    </div>
  );
}
