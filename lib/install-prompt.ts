"use client";

import * as React from "react";

/** Chromium's install-as-app event (not in lib.dom yet). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Captured at module load: Chrome/Edge fire `beforeinstallprompt` once, often
// before the component that wants it has mounted.
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", cb);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", cb);
  };
}

/**
 * Browser "install as app" (PWA) for the web build. `canInstall` is true when
 * Chrome/Edge offered the install prompt; `installed` when this window is
 * already running as an installed app. Always false inside Electron.
 */
export function useInstallPrompt() {
  const canInstall = React.useSyncExternalStore(
    subscribe,
    () => deferred !== null,
    () => false,
  );
  const installed = React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(display-mode: standalone)").matches,
    () => false,
  );

  const install = React.useCallback(async () => {
    const ev = deferred;
    if (!ev) return false;
    // The event can only prompt once.
    deferred = null;
    notify();
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    return outcome === "accepted";
  }, []);

  return { canInstall, installed, install };
}

const noopSubscribe = () => () => {};

/** True when running inside the Electron desktop shell. */
export function useIsElectron() {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => Boolean(window.electronAPI),
    () => false,
  );
}
