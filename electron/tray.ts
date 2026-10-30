/**
 * Keeps the app out of the taskbar (Windows) and the Dock (macOS), so it
 * is not visible to anyone looking at the screen during a meeting.
 *
 * With no taskbar button the app is reached from a small icon next to the
 * clock (Windows notification area / macOS menu bar) or with
 * Ctrl+Shift+Space. "Minimize" hides the window instead of minimizing it,
 * since a minimized window without a taskbar button is hard to bring back.
 * The tray menu can put the taskbar button back.
 */

import { app, BrowserWindow, Menu, nativeImage, Tray } from "electron";
import * as fs from "fs";
import * as path from "path";

import { readStateValue, writeStateValue } from "./windowState";

const STATE_KEY = "hideFromTaskbar";
const HINT_KEY = "trayHintShownAt";
const IS_MAC = process.platform === "darwin";

let tray: Tray | null = null;
let getWindow: () => BrowserWindow | null = () => null;

/** On by default: the app stays out of the taskbar / Dock. */
export function isHiddenFromTaskbar(): boolean {
  return readStateValue<boolean>(STATE_KEY) !== false;
}

/** Apply the taskbar / Dock preference to the window. */
export function applyTaskbarVisibility(win: BrowserWindow | null): void {
  const hidden = isHiddenFromTaskbar();
  if (IS_MAC) {
    if (hidden) app.dock?.hide();
    else void app.dock?.show();
    // Hiding the Dock icon can hide the window with it.
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
    return;
  }
  if (win && !win.isDestroyed()) win.setSkipTaskbar(hidden);
}

export function showWindow(): void {
  const w = getWindow();
  if (!w || w.isDestroyed()) return;
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
}

/** "Minimize": hidden to the tray when there is no taskbar button. */
export function minimizeWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  if (isHiddenFromTaskbar()) win.hide();
  else win.minimize();
}

function trayIcon(): Electron.NativeImage {
  const name = IS_MAC ? "android-chrome-192x192.png" : "favicon.ico";
  // Packaged: public/ ships inside the static export (out/icons).
  const file =
    [
      path.join(app.getAppPath(), "out", "icons", name),
      path.join(__dirname, "..", "public", "icons", name),
    ].find((p) => fs.existsSync(p)) ?? "";
  const image = nativeImage.createFromPath(file);
  return IS_MAC ? image.resize({ width: 18, height: 18 }) : image;
}

function buildMenu(): Menu {
  const w = getWindow();
  const visible = !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized();
  return Menu.buildFromTemplate([
    {
      label: visible ? `Hide ${app.getName()}` : `Show ${app.getName()}`,
      accelerator: "CommandOrControl+Shift+Space",
      click: () => (visible ? getWindow()?.hide() : showWindow()),
    },
    { type: "separator" },
    {
      label: IS_MAC ? "Show in Dock" : "Show in taskbar",
      type: "checkbox",
      checked: !isHiddenFromTaskbar(),
      click: (item) => {
        writeStateValue(STATE_KEY, !item.checked);
        applyTaskbarVisibility(getWindow());
      },
    },
    { type: "separator" },
    { label: `Quit ${app.getName()}`, click: () => app.quit() },
  ]);
}

/** Tray icon with Show / Hide, the taskbar option and Quit. */
export function initTray(windowGetter: () => BrowserWindow | null): void {
  if (tray) return;
  getWindow = windowGetter;
  try {
    tray = new Tray(trayIcon());
  } catch (err) {
    console.error("[tray] unavailable:", err instanceof Error ? err.message : err);
    return;
  }
  tray.setToolTip(`${app.getName()} — Ctrl+Shift+Space to show or hide`);
  // Rebuilt on open so Show / Hide matches the window.
  const popUp = () => tray?.popUpContextMenu(buildMenu());
  tray.on("right-click", popUp);
  if (IS_MAC) {
    tray.on("click", popUp);
  } else {
    tray.on("click", () => {
      const w = getWindow();
      if (w && w.isVisible() && !w.isMinimized()) w.hide();
      else showWindow();
    });
  }
}

/** Once per install, point at the tray icon (Windows), since the taskbar
 *  button the user is used to is gone. */
export function showTrayHintOnce(): void {
  if (IS_MAC || !tray || !isHiddenFromTaskbar()) return;
  if (readStateValue<string>(HINT_KEY)) return;
  writeStateValue(HINT_KEY, new Date().toISOString());
  try {
    tray.displayBalloon({
      title: `${app.getName()} is running here`,
      content:
        "It stays out of the taskbar. Click this icon or press Ctrl+Shift+Space to show or hide it.",
      iconType: "info",
    });
  } catch {
    /* balloons are best-effort */
  }
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
