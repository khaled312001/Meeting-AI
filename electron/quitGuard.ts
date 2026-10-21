/**
 * Every meeting gets its summary, even when the app is quit mid-meeting.
 *
 * The renderer reports whether a meeting still needs its summary (listening
 * after a real conversation, or a summary being written). Quitting then —
 * the close button, the tray's Quit, Cmd+Q, Alt+F4 — first asks the
 * renderer to stop listening and save the summary, and quits once it is
 * done (or after MAX_WAIT_MS, so a stuck request never keeps the app open).
 */

import { app, BrowserWindow, ipcMain } from "electron";

const MAX_WAIT_MS = 60_000;

let pending = false;
let finishing = false;
let released = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function release(): void {
  if (released) return;
  released = true;
  if (timer) clearTimeout(timer);
  app.quit();
}

export function registerQuitGuard(getWindow: () => BrowserWindow | null): void {
  ipcMain.on("meeting:pending", (_, value: unknown) => {
    pending = value === true;
  });
  ipcMain.on("meeting:finished", () => {
    if (finishing) release();
  });

  /** True when the quit was held back to save the meeting first. */
  const holdForSummary = (): boolean => {
    if (released || !pending) return false;
    const w = getWindow();
    if (!w || w.isDestroyed()) return false;
    if (finishing) return true;
    finishing = true;
    // Keep it on screen so the "Saving summary" status is visible.
    if (!w.isVisible()) w.show();
    w.webContents.send("meeting:finish-before-quit");
    timer = setTimeout(release, MAX_WAIT_MS);
    return true;
  };

  app.on("before-quit", (event) => {
    if (holdForSummary()) event.preventDefault();
  });
  app.on("browser-window-created", (_, win) => {
    win.on("close", (event) => {
      if (win === getWindow() && holdForSummary()) event.preventDefault();
    });
  });
}
