"use client";

import * as React from "react";
import { ArrowLeft, LogOut, Menu, X } from "lucide-react";
import { Avatar } from "./ui";
import { cn } from "@/lib/utils";
import { APP_DISPLAY_NAME } from "@/lib/constant";

export interface NavItem<K extends string = string> {
  key: K;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Small count shown at the right of the nav item (e.g. unread). */
  badge?: number | null;
  group?: string;
}

/**
 * Section routing through the URL hash (#knowledge, #users …). The app is a
 * static export loaded from file:// in Electron, so one page per dashboard
 * with hash sections works everywhere and survives reloads.
 */
export function useHashSection<K extends string>(keys: readonly K[], fallback: K) {
  const read = React.useCallback((): K => {
    if (typeof window === "undefined") return fallback;
    const raw = window.location.hash.replace(/^#/, "").split("?")[0] as K;
    return keys.includes(raw) ? raw : fallback;
  }, [keys, fallback]);

  const [section, setSectionState] = React.useState<K>(fallback);

  React.useEffect(() => {
    setSectionState(read());
    const onHash = () => setSectionState(read());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [read]);

  const setSection = React.useCallback((k: K) => {
    if (window.location.hash !== `#${k}`) {
      window.history.pushState(null, "", `#${k}`);
    }
    setSectionState(k);
    document.getElementById("dash-main")?.scrollTo({ top: 0 });
  }, []);

  return [section, setSection] as const;
}

export function DashboardShell<K extends string>({
  brandSuffix,
  nav,
  active,
  onNavigate,
  user,
  onSignOut,
  backHref,
  backLabel = "Back to app",
  topRight,
  children,
}: {
  brandSuffix: string;
  nav: ReadonlyArray<NavItem<K>>;
  active: K;
  onNavigate: (k: K) => void;
  user: { name?: string | null; email?: string | null };
  onSignOut: () => void;
  backHref?: string;
  backLabel?: string;
  topRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  // In the desktop app the fixed 32px TitleBar sits on top of every page.
  const [inElectron, setInElectron] = React.useState(false);
  React.useEffect(() => setInElectron(Boolean(window.electronAPI)), []);
  const activeItem = nav.find((n) => n.key === active);

  const groups: Array<{ name: string | undefined; items: NavItem<K>[] }> = [];
  for (const item of nav) {
    const last = groups[groups.length - 1];
    if (last && last.name === item.group) last.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-[13px] font-bold text-accent-foreground">
          {APP_DISPLAY_NAME.charAt(0)}
        </span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13px] font-semibold text-text-primary">{APP_DISPLAY_NAME}</div>
          <div className="text-[11px] text-text-tertiary">{brandSuffix}</div>
        </div>
      </div>

      <nav className="dash-scroll min-h-0 flex-1 overflow-y-auto px-2.5 py-2" aria-label={`${brandSuffix} sections`}>
        {groups.map((g, gi) => (
          <div key={g.name ?? gi} className={cn(gi > 0 && "mt-4")}>
            {g.name && (
              <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                {g.name}
              </div>
            )}
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.key === active;
                return (
                  <li key={item.key}>
                    <a
                      href={`#${item.key}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onNavigate(item.key);
                        setMobileOpen(false);
                      }}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
                        isActive
                          ? "bg-surface-overlay font-medium text-text-primary"
                          : "text-text-secondary hover:bg-surface-overlay/60 hover:text-text-primary",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isActive ? "text-accent-text" : "text-text-tertiary group-hover:text-text-secondary",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.badge ? (
                        <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold tabular-nums text-accent-foreground">
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      ) : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border-subtle p-2.5">
        {backHref && (
          <a
            href={backHref}
            className="mb-1 flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-text-secondary hover:bg-surface-overlay/60 hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4 text-text-tertiary" />
            {backLabel}
          </a>
        )}
        <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <Avatar name={user.name} email={user.email} size={28} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-xs font-medium text-text-primary">{user.name || user.email}</div>
            {user.name && <div className="truncate text-[11px] text-text-tertiary">{user.email}</div>}
          </div>
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-destructive-muted hover:text-destructive"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "flex h-screen min-h-0 w-full overflow-hidden bg-surface-base text-text-primary",
        inElectron && "pt-8",
      )}
      style={{ colorScheme: "dark" }}
    >
      <aside className="hidden w-60 shrink-0 border-r border-border-subtle bg-surface-inset lg:block">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-[90] lg:hidden" data-clickable>
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="dash-drawer-in relative h-full w-64 border-r border-border-default bg-surface-inset shadow-2xl">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="absolute right-2 top-3.5 flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-overlay"
            >
              <X className="h-4 w-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-subtle px-4 sm:px-6">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-surface-overlay lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <span className="hidden text-text-tertiary sm:inline">{brandSuffix}</span>
            <span className="hidden text-text-tertiary sm:inline">/</span>
            <span className="truncate font-medium text-text-primary">{activeItem?.label}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">{topRight}</div>
        </header>
        <main id="dash-main" className="dash-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
