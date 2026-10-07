"use client";

import { LayoutDashboard, LogOut, MonitorDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sessionDisplayName, sessionUserTitle } from "@/lib/session-display";
import { cn } from "@/lib/utils";
import { appHref } from "@/lib/app-href";
import { DESKTOP_DOWNLOAD_URL } from "@/lib/constant";
import { useInstallPrompt, useIsElectron } from "@/lib/install-prompt";

interface UserMenuProps {
  user: { name?: string | null; email?: string | null };
  onLogout: () => void;
  variant?: "header" | "titlebar";
  className?: string;
}

export function UserMenu({
  user,
  onLogout,
  variant = "header",
  className,
}: UserMenuProps) {
  const isTitlebar = variant === "titlebar";
  // Web build only. The real desktop app captures meeting audio without the
  // share picker, so prefer its installer over the browser's app install.
  const inElectron = useIsElectron();
  const { canInstall, install } = useInstallPrompt();
  const showInstall = !inElectron && (!!DESKTOP_DOWNLOAD_URL || canInstall);

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        !isTitlebar &&
          "max-w-[14rem] rounded-md border border-border-subtle bg-surface-overlay px-2 py-1",
        className,
      )}
    >
      <span
        className={cn(
          "min-w-0 truncate font-medium text-text-primary",
          isTitlebar ? "text-[10px] mr-1" : "text-[11px] hidden sm:inline",
        )}
        title={sessionUserTitle(user)}
      >
        {sessionDisplayName(user)}
      </span>
      {showInstall && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "shrink-0 text-text-tertiary hover:bg-surface-raised hover:text-text-primary",
            isTitlebar ? "h-6 w-6" : "h-7 w-7",
          )}
          onClick={() => {
            if (DESKTOP_DOWNLOAD_URL) window.open(DESKTOP_DOWNLOAD_URL, "_blank", "noopener");
            else void install();
          }}
          title="Install desktop app"
          aria-label="Install desktop app"
        >
          <MonitorDown className={isTitlebar ? "h-3 w-3" : "h-3.5 w-3.5"} />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "shrink-0 text-text-tertiary hover:bg-surface-raised hover:text-text-primary",
          isTitlebar ? "h-6 w-6" : "h-7 w-7",
        )}
        // Resolved on click: the href differs between file:// (Electron) and http.
        onClick={() => {
          window.location.href = appHref("dashboard");
        }}
        title="Dashboard"
        aria-label="Open dashboard"
      >
        <LayoutDashboard className={isTitlebar ? "h-3 w-3" : "h-3.5 w-3.5"} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "shrink-0 text-text-tertiary hover:bg-destructive-muted hover:text-destructive",
          isTitlebar ? "h-6 w-6" : "h-7 w-7",
        )}
        onClick={onLogout}
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut className={isTitlebar ? "h-3 w-3" : "h-3.5 w-3.5"} />
      </Button>
    </div>
  );
}
