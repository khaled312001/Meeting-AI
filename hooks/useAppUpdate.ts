"use client";

/** Desktop app updates: current version, live updater status, and the two
 *  actions behind the update button (check now / restart into the update). */

import { useCallback, useEffect, useState } from "react";

type UpdaterStatus = Parameters<
  Parameters<NonNullable<NonNullable<Window["electronAPI"]>["onUpdaterStatus"]>>[0]
>[0];

export function useAppUpdate() {
  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdaterStatus>({ type: "idle" });

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (!api) return;
    void api.updaterGetVersion?.().then(setVersion);
    void api.updaterGetStatus?.().then(setStatus);
    return api.onUpdaterStatus?.(setStatus);
  }, []);

  const check = useCallback(() => {
    setStatus({ type: "checking" });
    void window.electronAPI?.updaterCheck?.();
  }, []);

  const install = useCallback(() => {
    void window.electronAPI?.updaterInstall?.();
  }, []);

  const busy = status.type === "checking" || status.type === "downloading" || status.type === "available";

  let label: string;
  switch (status.type) {
    case "checking":
      label = "Checking for updates…";
      break;
    case "available":
      label = `Downloading ${status.version}…`;
      break;
    case "downloading":
      label = `Downloading update ${Math.round(status.percent)}%`;
      break;
    case "downloaded":
      label = `Restart to update to ${status.version}`;
      break;
    case "not-available":
      label = `Up to date${version ? ` (v${version})` : ""}`;
      break;
    case "error":
      label = "Update failed — try again";
      break;
    default:
      label = `Check for updates${version ? ` (v${version})` : ""}`;
  }

  return { version, status, label, busy, ready: status.type === "downloaded", check, install };
}
