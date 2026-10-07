"use client";

import * as React from "react";
import {
  BookOpen,
  History,
  LayoutDashboard,
  LifeBuoy,
  NotebookPen,
  Shield,
  Sparkles,
  UserRound,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardShell, useHashSection, type NavItem } from "../DashboardShell";
import { ToastProvider } from "../toast";
import { OverviewSection } from "./OverviewSection";
import { KnowledgeSection } from "./KnowledgeSection";
import { ProfileSection } from "./ProfileSection";
import { SessionsSection } from "./SessionsSection";
import { NotesSection } from "./NotesSection";
import { SupportSection } from "./SupportSection";
import { AccountSection } from "./AccountSection";
import { authClient, signOutAndTrack } from "@/lib/auth-client";
import { useSupportMessages } from "@/hooks/useSupportMessages";
import { adminApi } from "@/lib/admin-api";
import { appHref } from "@/lib/app-href";

const SECTIONS = ["overview", "knowledge", "profile", "sessions", "notes", "support", "account"] as const;
export type ClientSection = (typeof SECTIONS)[number];

/** True when the signed-in user can open the admin panel (403 otherwise). */
function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = React.useState(false);
  React.useEffect(() => {
    const controller = new AbortController();
    adminApi
      .me(controller.signal)
      .then(() => setIsAdmin(true))
      .catch(() => setIsAdmin(false));
    return () => controller.abort();
  }, []);
  return isAdmin;
}

export default function ClientDashboard() {
  const { data: session } = authClient.useSession();
  const [section, setSection] = useHashSection(SECTIONS, "overview");
  const support = useSupportMessages({ enabled: true, pollMs: 60_000 });
  const isAdmin = useIsAdmin();
  const { refresh } = support;

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const unread = support.threads.filter((t) => t.unreadByUser).length;
  const user = session?.user as
    | { name?: string | null; email?: string | null; createdAt?: Date | string }
    | undefined;

  const nav: NavItem<ClientSection>[] = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "knowledge", label: "Knowledge base", icon: BookOpen, group: "Prepare" },
    { key: "profile", label: "Interview profile", icon: UserRound, group: "Prepare" },
    { key: "sessions", label: "Session history", icon: History, group: "Review" },
    { key: "notes", label: "Saved answers", icon: NotebookPen, group: "Review" },
    { key: "support", label: "Support", icon: LifeBuoy, badge: unread || null, group: "Account" },
    { key: "account", label: "Account", icon: UserCog, group: "Account" },
  ];

  return (
    <ToastProvider>
      <DashboardShell
        brandSuffix="Dashboard"
        nav={nav}
        active={section}
        onNavigate={setSection}
        user={user ?? {}}
        onSignOut={() => void signOutAndTrack()}
        backHref={appHref("home")}
        backLabel="Open assistant"
        topRight={
          <>
            {isAdmin && (
              <Button variant="ghost" size="sm" asChild>
                <a href={appHref("admin")}>
                  <Shield className="mr-1.5 h-3.5 w-3.5" /> Admin
                </a>
              </Button>
            )}
            <Button size="sm" asChild>
              <a href={appHref("home")}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Assistant
              </a>
            </Button>
          </>
        }
      >
        {section === "overview" && (
          <OverviewSection userName={user?.name || user?.email || ""} onNavigate={setSection} />
        )}
        {section === "knowledge" && <KnowledgeSection />}
        {section === "profile" && <ProfileSection />}
        {section === "sessions" && <SessionsSection />}
        {section === "notes" && <NotesSection />}
        {section === "support" && <SupportSection />}
        {section === "account" && user && (
          <AccountSection user={user} currentSessionId={session?.session.id} />
        )}
      </DashboardShell>
    </ToastProvider>
  );
}
