import "./backend-env";
import {
  app,
  BrowserWindow,
  globalShortcut,
  screen,
  session,
  shell,
  systemPreferences,
} from "electron";
import * as fs from "fs";
import * as path from "path";

import { installSingleInstanceAndDeepLinks } from "./deepLink";
import { registerAppIpc } from "./ipc/app";
import { registerSummaryIpc } from "./ipc/summary";
import { registerCaptureAndAskShortcut, registerScreenIpc } from "./ipc/screen";
import { attachWindowFocusNotifier, registerWindowIpc } from "./ipc/window";
import {
  installCsp,
  installOriginHeaderInjection,
  pickCsp,
} from "./security/csp";
import {
  installDisplayMediaHandler,
  installPermissionRequestHandler,
} from "./security/permissions";
import { isTrustedOrigin } from "./security/origin";
import { initAutoUpdater } from "./updater";
import {
  loadRestoredBounds,
  loadWindowState,
  readStateValue,
  trackWindowState,
  writeStateValue,
} from "./windowState";

let mainWindow: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

// Hide from screen share and screen recording on macOS
if (process.platform === "darwin") {
  app.commandLine.appendSwitch(
    "disable-features",
    "MediaFoundationVideoCapture",
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveIconPath(): string {
  if (process.platform === "darwin") {
    // macOS - use larger PNG or .icns if available
    return path.join(__dirname, "../public/icons/android-chrome-512x512.png");
  }
  if (process.platform === "win32") {
    return path.join(__dirname, "../public/icons/favicon.ico");
  }
  return path.join(__dirname, "../public/icons/android-chrome-512x512.png");
}

function loadDisplayName(): string {
  const candidates = [
    path.join(__dirname, "../package.json"),
    path.join(app.getAppPath(), "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as {
          build?: { productName?: string };
        };
        const name = parsed.build?.productName;
        if (typeof name === "string" && name.length > 0) {
          return name;
        }
      }
    } catch {
      /* try next candidate */
    }
  }
  return "Meeting AI";
}

/** Exclude the overlay from screen sharing and recording. The user still
 *  sees it; the other side of the call sees what is behind it.
 *  Windows 10 2004+ (WDA_EXCLUDEFROMCAPTURE) and macOS (NSWindowSharingNone). */
function hideFromScreenCapture(win: BrowserWindow) {
  try {
    win.setContentProtection(true);
  } catch {
    // Content protection not available on this platform
  }
}

/** A hidden overlay has no window to click, so a global shortcut brings it
 *  back (the taskbar / Dock icon does too). */
function registerToggleOverlayShortcut() {
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    const w = mainWindow;
    if (!w) return;
    if (w.isVisible() && !w.isMinimized()) {
      w.hide();
    } else {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
  });
}

/** Shortcuts that work while the meeting app has focus: answer, clear the
 *  answer, switch Auto / Manual, and nudge the overlay around the screen. */
const SHORTCUT_ACTIONS: Record<string, string> = {
  "CommandOrControl+Alt+Enter": "answer",
  "CommandOrControl+Alt+Backspace": "clear-answer",
  "CommandOrControl+Alt+M": "toggle-mode",
};
const MOVE_STEP = 40;

function registerMeetingShortcuts() {
  for (const [accelerator, action] of Object.entries(SHORTCUT_ACTIONS)) {
    globalShortcut.register(accelerator, () => {
      const w = mainWindow;
      if (!w || w.isDestroyed()) return;
      if (!w.isVisible()) w.show();
      w.webContents.send("shortcut:action", action);
    });
  }
  const moves: Record<string, [number, number]> = {
    Up: [0, -MOVE_STEP],
    Down: [0, MOVE_STEP],
    Left: [-MOVE_STEP, 0],
    Right: [MOVE_STEP, 0],
  };
  for (const [key, [dx, dy]] of Object.entries(moves)) {
    globalShortcut.register(`CommandOrControl+Alt+${key}`, () => {
      const w = mainWindow;
      if (!w || w.isDestroyed()) return;
      const [x, y] = w.getPosition();
      w.setPosition(x + dx, y + dy);
    });
  }
}

async function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const iconPath = resolveIconPath();

  // Restore last session's window position (and size when the renderer
  // doesn't override it) and overlay pin preference. Falls back to the
  // historical top-center default on first run.
  const restored = loadRestoredBounds();
  const savedAlwaysOnTop = loadWindowState().alwaysOnTop;
  const defaultWidth = 1000;
  const defaultHeight = 600;

  mainWindow = new BrowserWindow({
    width: restored?.width ?? defaultWidth,
    height: restored?.height ?? defaultHeight,
    x: restored?.x ?? Math.floor((width - defaultWidth) / 2),
    y: restored?.y ?? 0,
    frame: false,
    resizable: true,
    transparent: true,
    alwaysOnTop: savedAlwaysOnTop !== false,
    backgroundColor: "#00000000",
    hasShadow: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: true,
      backgroundThrottling: false,
    },
    // Taskbar button + Alt-Tab entry so a minimized window can be found
    // again. Content protection keeps the window itself out of screen shares.
    skipTaskbar: false,
    show: false,
  });

  trackWindowState(mainWindow);
  attachWindowFocusNotifier(mainWindow);

  const isPackaged = app.isPackaged && !process.env.DEV_PORT;
  installCsp(mainWindow.webContents.session, pickCsp(isPackaged));
  installOriginHeaderInjection(mainWindow.webContents.session);

  if (process.platform === "darwin") {
    mainWindow.setWindowButtonVisibility(false);
    // Stay visible even when the meeting app goes fullscreen (Zoom, Meet,
    // Teams). Content protection still hides us from the screen share.
    try {
      mainWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        // Otherwise macOS turns the app into an accessory and drops the
        // Dock icon / Cmd-Tab entry.
        skipTransformProcessType: true,
      });
    } catch {
      // Not supported on this macOS version
    }
  }

  hideFromScreenCapture(mainWindow);
  // Windows can drop the capture exclusion when a window is hidden and
  // shown again, so re-apply it every time the overlay comes back.
  mainWindow.on("show", () => mainWindow && hideFromScreenCapture(mainWindow));
  mainWindow.on("restore", () => mainWindow && hideFromScreenCapture(mainWindow));

  const buildPath = path.join(app.getAppPath(), "out");
  const isDev = !app.isPackaged || !!process.env.DEV_PORT;
  // Auto-open DevTools when ANY of these signal a debug session:
  //   - `isDev` (renderer pointed at `next dev`)
  //   - `ELECTRON_DEBUG=true` (set by `bun run electron:debug`)
  //   - a `.debug-build` marker file shipped alongside `main.js`
  //     (env vars don't survive a packaged binary, so the marker is
  //     how `bun run electron:build:debug` flags a distributable
  //     debug artifact at build time).
  // Detached mode so the overlay window keeps its declared 1000×600
  // even with DevTools visible — otherwise DevTools docks inside and
  // steals half the UI.
  const debugMarker = (() => {
    try {
      return fs.existsSync(path.join(__dirname, "DEBUG_BUILD"));
    } catch {
      return false;
    }
  })();
  const debugMode =
    isDev || process.env.ELECTRON_DEBUG === "true" || debugMarker;

  const devPort = process.env.DEV_PORT || "3000";
  const indexFile = path.join(buildPath, "index.html");
  try {
    if (isDev) {
      const devUrl = `http://localhost:${devPort}`;
      await mainWindow.loadURL(devUrl);

      setTimeout(() => {
        mainWindow?.webContents.reloadIgnoringCache();
      }, 200);
    } else {
      await mainWindow.loadFile(indexFile);

      setTimeout(() => {
        mainWindow?.webContents.reloadIgnoringCache();
      }, 200);
    }
    if (debugMode) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } catch (error) {
    console.error("Error loading window content:", error);
    mainWindow.show();
    const safeMsg = escapeHtml(
      error instanceof Error ? error.message : String(error),
    );
    // Render via data URL with an explicit charset; content is fully escaped.
    // The retry button reloads the real target (dev URL / index.html) so a
    // transient failure (e.g. `next dev` not up yet) is recoverable in-app.
    const retryTarget = isDev
      ? `http://localhost:${devPort}`
      : `file://${indexFile}`;
    mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<!doctype html><html><body style="font-family:system-ui;background:#141210;color:#edeceb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center;max-width:32rem;padding:2rem"><h1 style="font-size:1.1rem;margin:0 0 .5rem">Error loading application</h1><p style="opacity:.7;font-size:.85rem;margin:0 0 1.25rem">${safeMsg}</p><button onclick="location.href='${retryTarget}'" style="background:#34d399;color:#0a0a0a;border:none;padding:.55rem 1.1rem;border-radius:.5rem;font-weight:600;font-size:.85rem;cursor:pointer">Retry</button></div></body></html>`,
      )}`,
    );
  }

  // Lock navigation to trusted origins. Any attempt to navigate the main
  // window elsewhere (e.g. via a hijacked link) is cancelled, and
  // window.open is blocked — external links are opened in the default
  // browser instead.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedOrigin(url)) {
      event.preventDefault();
      shell.openExternal(url).catch((e) => console.error("openExternal:", e));
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedOrigin(url)) {
      return { action: "allow" };
    }
    shell.openExternal(url).catch((e) => console.error("openExternal:", e));
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    // Whole-window opacity is not used for "see-through" (that is CSS backdrop only).
    mainWindow?.setOpacity(1);
    mainWindow?.show();
  });

  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 3000);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  app.setName(loadDisplayName());

  installPermissionRequestHandler(session.defaultSession);
  installDisplayMediaHandler(session.defaultSession);

  // On macOS, proactively request microphone access so the OS-level TCC
  // dialog appears at app launch rather than the first time the user
  // holds Space. We AWAIT this so the permission is resolved before any
  // renderer code calls getUserMedia — otherwise the renderer races the
  // dialog and gets NotAllowedError.
  if (process.platform === "darwin") {
    const micStatus = systemPreferences.getMediaAccessStatus("microphone");
    if (micStatus === "not-determined") {
      try {
        await systemPreferences.askForMediaAccess("microphone");
      } catch {
        /* user denied — renderer will surface the error on first use */
      }
    } else if (micStatus === "denied" || micStatus === "restricted") {
      // Nudge the user toward System Settings only ONCE per install.
      // Force-opening the privacy pane on every launch felt hijacky and
      // gave no way to opt out; the in-app mic UI still surfaces a clear
      // error on first use afterwards.
      const nudgeAt = readStateValue<string>("micSettingsNudgeAt");
      if (!nudgeAt) {
        writeStateValue("micSettingsNudgeAt", new Date().toISOString());
        shell
          .openExternal(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
          )
          .catch(() => {
            /* best-effort deep link */
          });
      }
    }
  }

  createWindow().catch((error) => {
    console.error("Failed to create Electron window:", error);
    app.quit();
  });

  initAutoUpdater(getMainWindow);

  registerCaptureAndAskShortcut(getMainWindow);
  registerToggleOverlayShortcut();
  registerMeetingShortcuts();

  // Dock icon + Cmd-Tab entry on macOS, so a minimized window can be found.
  if (process.platform === "darwin") void app.dock?.show();

  app.on("activate", () => {
    const w = mainWindow;
    if (!w || w.isDestroyed()) {
      createWindow();
      return;
    }
    if (w.isMinimized()) w.restore();
    if (!w.isVisible()) w.show();
    w.focus();
  });
});

// Quit on macOS too: the close button means "quit" in both views.
app.on("window-all-closed", () => {
  app.quit();
});

registerWindowIpc(getMainWindow);
registerScreenIpc(getMainWindow);
registerAppIpc();
registerSummaryIpc();

// Clean up global shortcuts on quit. We must guard with `app.isReady()`
// because `app.quit()` is called synchronously in the single-instance
// branch below, BEFORE the ready event fires. Touching globalShortcut
// before ready throws "globalShortcut cannot be used until the app is
// ready", which then bubbles up as an uncaughtException at startup.
app.on("will-quit", () => {
  if (!app.isReady()) return;
  try {
    globalShortcut.unregisterAll();
  } catch (err) {
    console.error("Failed to unregister global shortcuts:", err);
  }
});

installSingleInstanceAndDeepLinks(getMainWindow);

// Log and swallow top-level errors so a single failing handler does not
// crash the whole process silently. Keep messages generic to avoid leaking
// tokens from thrown errors.
process.on("uncaughtException", (err) => {
  console.error("[electron main] uncaughtException:", err?.message ?? err);
});
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error("[electron main] unhandledRejection:", msg);
});
