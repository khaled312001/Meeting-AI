"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Minimize2,
  Maximize2,
  X,
  Pin,
  PinOff,
  Minus,
  Plus,
  Focus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authClient, signOutAndTrack } from "@/lib/auth-client";
import { useTab } from "@/components/TabContext";
import { useAppBackdrop } from "@/components/AppBackdropContext";
import { useInterviewContext } from "@/components/InterviewContextProvider";
import { SignalStrip } from "@/components/shell/SignalStrip";
import { UserMenu } from "@/components/shell/UserMenu";
import { WorkspaceTabs } from "@/components/shell/WorkspaceTabs";
import { APP_DISPLAY_NAME } from "@/lib/constant";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { UpdateButton } from "@/components/UpdateButton";

export default function TitleBar() {
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isElectron, setIsElectron] = useState(false);
  const { onPointerDown: startDrag } = useWindowDrag();
  const update = useAppUpdate();
  const [updateToast, setUpdateToast] = useState<string | null>(null);
  const { backdropOpacity, adjustBackdropOpacity } = useAppBackdrop();
  const { data: session } = authClient.useSession();
  const { activeTab, setActiveTab, compactMode, setCompactMode } = useTab();
  const { saveContext } = useInterviewContext();

  useEffect(() => {
    if (typeof window !== "undefined" && window.electronAPI) {
      setIsElectron(true);
      window.electronAPI.windowIsAlwaysOnTop().then(setIsAlwaysOnTop);
      window.electronAPI.windowIsMaximized().then(setIsMaximized);

    }
  }, []);

  // Non-modal toast so the user can act even after dismissing the native
  // dialog.
  const updateType = update.status.type;
  const updateVersion = "version" in update.status ? update.status.version : null;
  useEffect(() => {
    if (updateType === "downloaded") {
      setUpdateToast(`Update ${updateVersion} is ready — restart to install.`);
    } else if (updateType === "error") {
      setUpdateToast("Update failed. Try again from the update button.");
    }
  }, [updateType, updateVersion]);

  const handleMinimize = async () => {
    if (window.electronAPI) {
      await window.electronAPI.windowMinimize();
    }
  };

  const handleMaximize = async () => {
    if (window.electronAPI) {
      const maximized = await window.electronAPI.windowMaximize();
      setIsMaximized(maximized);
    }
  };

  const handleClose = async () => {
    if (window.electronAPI) {
      await window.electronAPI.windowClose();
    }
  };

  const handleToggleAlwaysOnTop = async () => {
    if (window.electronAPI) {
      const newState = !isAlwaysOnTop;
      await window.electronAPI.windowAlwaysOnTop(newState);
      setIsAlwaysOnTop(newState);
    }
  };

  const handleBackdropChange = (delta: number) => {
    if (window.electronAPI) {
      adjustBackdropOpacity(delta);
    }
  };

  const handleLogout = () => void signOutAndTrack();

  const toggleCompactMode = () => {
    void saveContext().finally(() => setCompactMode(!compactMode));
  };

  // Focus mode brings its own floating bar (move, back, menu, close).
  if (!isElectron || compactMode) {
    return null;
  }

  return (
    <div
      data-clickable
      data-window-chrome
      className="titlebar-chrome fixed left-0 right-0 top-0 z-50 flex h-8 cursor-grab select-none flex-col active:cursor-grabbing"
      // Moved from the renderer, like the focus bar: a CSS drag region
      // stops responding on Windows once focus mode's click-through ran.
      onPointerDown={(e) => {
        if (!isMaximized) startDrag(e);
      }}
    >
      {!compactMode && <SignalStrip activeTab={activeTab} />}
      <div className="flex min-h-0 flex-1 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full rounded-full bg-accent/40" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          <span className="truncate text-[11px] font-semibold text-text-primary">
            {APP_DISPLAY_NAME}
          </span>

          {!compactMode && (
            <WorkspaceTabs
              activeTab={activeTab}
              onTabChange={setActiveTab}
              variant="titlebar"
              className="ml-1 hidden md:flex"
            />
          )}
        </div>

        <div className="flex cursor-default items-center gap-1">
          {session?.user && (
            <UserMenu
              user={session.user}
              onLogout={() => void handleLogout()}
              variant="titlebar"
              className="mr-1 hidden sm:flex"
            />
          )}

          <div
            className="mr-1 flex items-center gap-0.5 rounded-md border border-border-subtle px-1.5 py-0.5"
            style={{
              backgroundColor: `color-mix(in oklch, var(--surface-raised) ${Math.round(backdropOpacity * 100)}%, transparent)`,
            }}
          >
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={() => handleBackdropChange(-0.1)}
              title="More see-through (background only)"
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="min-w-[28px] text-center text-[10px] font-medium text-text-secondary">
              {Math.round(backdropOpacity * 100)}%
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={() => handleBackdropChange(0.1)}
              title="Darker background (UI stays sharp)"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "h-6 gap-1 px-1.5",
              compactMode && "text-accent-text",
            )}
            onClick={toggleCompactMode}
            title={
              compactMode
                ? "Back to the full view"
                : "Focus mode"
            }
          >
            {compactMode ? (
              <>
                <Maximize2 className="h-3 w-3" />
                <span className="text-[10px] font-medium">Full</span>
              </>
            ) : (
              <Focus className="h-3 w-3" />
            )}
          </Button>

          <UpdateButton variant="titlebar" className="mx-1" />

          <Button
            size="icon"
            variant="ghost"
            className={cn("h-6 w-6", isAlwaysOnTop && "text-info")}
            onClick={handleToggleAlwaysOnTop}
            title={
              isAlwaysOnTop ? "Disable always on top" : "Enable always on top"
            }
          >
            {isAlwaysOnTop ? (
              <Pin className="h-3 w-3" />
            ) : (
              <PinOff className="h-3 w-3" />
            )}
          </Button>

          <div className="ml-1 flex items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={handleMinimize}
              title="Minimize"
            >
              <Minimize2 className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={handleMaximize}
              title={isMaximized ? "Restore" : "Maximize"}
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 hover:bg-destructive hover:text-accent-foreground"
              onClick={handleClose}
              title="Close"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      {updateToast && (
        <div
          data-clickable
          className="fixed bottom-14 right-4 z-[95] flex max-w-xs items-center gap-2 rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 shadow-lg animate-fade-in-scale"
          role="status"
        >
          <span className="text-[11px] leading-snug text-text-secondary">
            {updateToast}
          </span>
          {update.ready && (
            <button
              type="button"
              className="shrink-0 rounded-md bg-accent px-2 py-1 text-[10px] font-semibold text-accent-foreground hover:opacity-90"
              onClick={() => {
                setUpdateToast(null);
                update.install();
              }}
            >
              Restart
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss update notification"
            className="shrink-0 rounded p-0.5 text-text-tertiary hover:text-text-primary"
            onClick={() => setUpdateToast(null)}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
