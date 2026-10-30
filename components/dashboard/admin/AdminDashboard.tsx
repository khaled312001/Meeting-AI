"use client";

import * as React from "react";
import {
  Activity,
  BarChart3,
  Bot,
  Inbox,
  LayoutDashboard,
  Megaphone,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardShell, useHashSection, type NavItem } from "../DashboardShell";
import { ToastProvider } from "../toast";
import { AdminGuard } from "./AdminGuard";
import { AdminOverview } from "./AdminOverview";
import { UsersSection } from "./UsersSection";
import { LiveSessionsSection } from "./LiveSessionsSection";
import { UsageSection } from "./UsageSection";
import { AiSettingsSection } from "./AiSettingsSection";
import { AnnouncementsSection } from "./AnnouncementsSection";
import { SupportInboxSection } from "./SupportInboxSection";
import { SecuritySection } from "./SecuritySection";
import { UserDrawer } from "./UserDrawer";
import { signOutAndTrack } from "@/lib/auth-client";
import { adminApi, type AdminMe } from "@/lib/admin-api";
import { useApi } from "@/lib/use-api";
import { appHref } from "@/lib/app-href";

const SECTIONS = ["overview", "users", "live", "usage", "ai", "announcements", "support", "security"] as const;
export type AdminSection = (typeof SECTIONS)[number];

function AdminApp({ me }: { me: AdminMe }) {
  const [section, setSection] = useHashSection(SECTIONS, "overview");
  const [drawerUserId, setDrawerUserId] = React.useState<string | null>(null);
  const counts = useApi(
    async (s) => {
      const [overview, inbox] = await Promise.all([
        adminApi.overview(s),
        adminApi.supportThreads({ limit: 1, offset: 0 }, s),
      ]);
      return { pending: overview.stats.pendingApproval, unread: inbox.totalUnread };
    },
    [],
    { pollMs: 60_000 },
  );
  const [unreadOverride, setUnreadOverride] = React.useState<number | null>(null);

  const nav: NavItem<AdminSection>[] = [
    {
      key: "overview",
      label: "Overview",
      icon: LayoutDashboard,
      hint: "See users, sign-ups and system health at a glance",
    },
    {
      key: "users",
      label: "Users",
      icon: Users,
      badge: counts.data?.pending || null,
      group: "People",
      hint: "Add customers, approve or ban people and change their plans",
    },
    {
      key: "live",
      label: "Live sessions",
      icon: Activity,
      group: "People",
      hint: "See who is using the assistant right now and end a session",
    },
    {
      key: "support",
      label: "Support inbox",
      icon: Inbox,
      badge: (unreadOverride ?? counts.data?.unread) || null,
      group: "People",
      hint: "Read and reply to messages from users",
    },
    {
      key: "usage",
      label: "Usage & analytics",
      icon: BarChart3,
      group: "Insights",
      hint: "See how much the assistant is used, by whom, and what fails",
    },
    {
      key: "ai",
      label: "AI & integrations",
      icon: Bot,
      group: "Configure",
      hint: "Choose the AI provider and model and manage API keys",
    },
    {
      key: "announcements",
      label: "Announcements",
      icon: Megaphone,
      group: "Configure",
      hint: "Show banners, pop-ups and toasts to users inside the app",
    },
    {
      key: "security",
      label: "Security & access",
      icon: ShieldCheck,
      group: "Configure",
      hint: "See the audit log and threats, choose admins and clean up data",
    },
  ];

  return (
    <DashboardShell
      brandSuffix="Admin"
      nav={nav}
      active={section}
      onNavigate={setSection}
      user={{ name: me.name, email: me.email }}
      onSignOut={() => void signOutAndTrack()}
      backHref={appHref("dashboard")}
      backLabel="My dashboard"
      backHint="Go to your own customer dashboard"
      topRight={
        <Button variant="ghost" size="sm" asChild>
          <a href={appHref("home")} title="Open the interview assistant app">
            Open assistant
          </a>
        </Button>
      }
    >
      {section === "overview" && <AdminOverview onNavigate={setSection} />}
      {section === "users" && <UsersSection />}
      {section === "live" && <LiveSessionsSection />}
      {section === "usage" && <UsageSection onOpenUser={setDrawerUserId} />}
      {section === "ai" && <AiSettingsSection />}
      {section === "announcements" && <AnnouncementsSection />}
      {section === "support" && <SupportInboxSection onUnreadChange={setUnreadOverride} />}
      {section === "security" && <SecuritySection me={me} />}

      {section !== "users" && (
        <UserDrawer userId={drawerUserId} onClose={() => setDrawerUserId(null)} onChanged={() => void counts.reload()} />
      )}
    </DashboardShell>
  );
}

export default function AdminDashboard() {
  return (
    <ToastProvider>
      <AdminGuard>{(me) => <AdminApp me={me} />}</AdminGuard>
    </ToastProvider>
  );
}
