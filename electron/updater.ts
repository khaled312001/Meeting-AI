import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { app, BrowserWindow, dialog, net, shell } from "electron";
import {
  autoUpdater,
  type ProgressInfo,
  type UpdateInfo,
} from "electron-updater";

export type UpdaterStatus =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available"; version: string }
  | { type: "downloading"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };

const LATEST_RELEASE_URL = "https://interprova.com/download/";

/** Same repo as `build.publish` in package.json (the update feed). */
const RELEASES_BASE = "https://github.com/khaled312001/Meeting-AI/releases/download";

/**
 * Windows: electron-updater downloads the new installer in the background and
 * runs it silently on restart.
 *
 * macOS: Squirrel.Mac refuses builds without an Apple Developer ID, so the
 * update is done here instead: download the release zip, check its sha512,
 * unpack it, and on restart a small script swaps the .app bundle and opens
 * the new version. If anything stops that (app run from the DMG, no write
 * access), the download page opens instead.
 */
const AUTO_UPDATE_ENABLED = true;
const IS_MAC = process.platform === "darwin";

let status: UpdaterStatus = { type: "idle" };
let getMainWindow: () => BrowserWindow | null = () => null;
let started = false;
/** macOS: unpacked new version waiting for a restart. */
let macPending: { version: string; appPath: string } | null = null;
let macDownloading = false;

function broadcastStatus(next: UpdaterStatus): void {
  status = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("updater:status", next);
    }
  }
}

export function getUpdaterStatus(): UpdaterStatus {
  return status;
}

export function getAppVersion(): string {
  return app.getVersion();
}

function updaterActive(): boolean {
  return AUTO_UPDATE_ENABLED && app.isPackaged && !process.env.DEV_PORT;
}

async function showMessage(options: Electron.MessageBoxOptions) {
  const win = getMainWindow();
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

function promptRestart(version: string): void {
  void showMessage({
    type: "info",
    title: "Update ready",
    message: `Version ${version} has been downloaded.`,
    detail: "Restart the app to finish updating. It takes a few seconds.",
    buttons: ["Restart now", "Later"],
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) installUpdate();
  });
}

function openDownloadPage(): void {
  shell.openExternal(LATEST_RELEASE_URL).catch(() => {
    /* best-effort */
  });
}

export function initAutoUpdater(
  mainWindowGetter: () => BrowserWindow | null,
): void {
  if (!updaterActive() || started) return;
  started = true;

  getMainWindow = mainWindowGetter;
  autoUpdater.autoDownload = !IS_MAC;
  autoUpdater.autoInstallOnAppQuit = !IS_MAC;

  autoUpdater.on("checking-for-update", () => {
    if (!macDownloading) broadcastStatus({ type: "checking" });
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    broadcastStatus({ type: "available", version: info.version });
    if (IS_MAC) void downloadMacUpdate(info);
  });

  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    broadcastStatus({ type: "not-available", version: info.version });
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    broadcastStatus({ type: "downloading", percent: progress.percent });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    broadcastStatus({ type: "downloaded", version: info.version });
    promptRestart(info.version);
  });

  autoUpdater.on("error", (err: Error) => {
    const msg = err?.message ?? String(err);
    console.error("[updater]", msg);
    broadcastStatus({ type: "error", message: msg });
  });

  setTimeout(() => {
    void checkForUpdates();
  }, 30_000);

  // Re-check periodically so long-running sessions (the app is meant to
  // stay open all day) still pick up new releases. Skipped while an
  // update is already downloaded — restarting is the user's call.
  const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
  setInterval(() => {
    if (status.type === "downloaded") return;
    void checkForUpdates();
  }, RECHECK_INTERVAL_MS);
}

export async function checkForUpdates(): Promise<void> {
  if (!updaterActive()) {
    broadcastStatus({
      type: "error",
      message: app.isPackaged
        ? "Automatic updates are turned off in this build."
        : "Updates only run in the installed app.",
    });
    return;
  }
  if (status.type === "downloaded") {
    broadcastStatus(status);
    return;
  }
  if (macDownloading) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[updater] check failed:", msg);
    broadcastStatus({ type: "error", message: msg });
  }
}

/** Restart into the downloaded version. */
export function installUpdate(): void {
  if (status.type !== "downloaded") return;
  if (!IS_MAC) {
    // Silent install, then relaunch the updated app.
    autoUpdater.quitAndInstall(true, true);
    return;
  }
  try {
    installMacUpdate();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[updater] mac install failed:", msg);
    broadcastStatus({ type: "error", message: msg });
    void showMessage({
      type: "warning",
      title: "Couldn't update in place",
      message: "Download the new version from the download page instead.",
      detail: msg,
      buttons: ["Open download page", "Dismiss"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) openDownloadPage();
    });
  }
}

/* ───────────────────────────── macOS ───────────────────────────── */

const execFileAsync = promisify(execFile);

function updateDir(): string {
  return path.join(app.getPath("temp"), "meetingai-update");
}

/** /Applications/Meeting AI.app from …/Contents/MacOS/Meeting AI. */
function currentBundlePath(): string {
  return path.resolve(path.dirname(process.execPath), "..", "..");
}

async function downloadMacUpdate(info: UpdateInfo): Promise<void> {
  if (macDownloading || macPending?.version === info.version) return;
  macDownloading = true;
  try {
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const file = info.files.find((f) => f.url.endsWith(`-mac-${arch}.zip`));
    if (!file) throw new Error(`No macOS ${arch} update in release ${info.version}`);

    const dir = updateDir();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const zipPath = path.join(dir, path.basename(file.url));

    const res = await net.fetch(`${RELEASES_BASE}/v${info.version}/${file.url}`);
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
    const total = file.size || Number(res.headers.get("content-length")) || 0;

    const hash = createHash("sha512");
    const out = fs.createWriteStream(zipPath);
    let received = 0;
    let lastPercent = -1;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) {
        await new Promise<void>((resolve) => out.once("drain", resolve));
      }
      const percent = total ? Math.floor((received / total) * 100) : 0;
      if (percent !== lastPercent) {
        lastPercent = percent;
        broadcastStatus({ type: "downloading", percent });
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.once("error", reject);
    });

    if (file.sha512 && hash.digest("base64") !== file.sha512) {
      throw new Error("The downloaded update is damaged (checksum mismatch)");
    }

    const unpacked = path.join(dir, "app");
    await execFileAsync("/usr/bin/ditto", ["-x", "-k", zipPath, unpacked]);
    const bundle = fs.readdirSync(unpacked).find((n) => n.endsWith(".app"));
    if (!bundle) throw new Error("The update has no app inside");
    fs.rmSync(zipPath, { force: true });

    macPending = { version: info.version, appPath: path.join(unpacked, bundle) };
    broadcastStatus({ type: "downloaded", version: info.version });
    promptRestart(info.version);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[updater] mac download failed:", msg);
    broadcastStatus({ type: "error", message: msg });
  } finally {
    macDownloading = false;
  }
}

/** Waits for this process to exit, swaps the bundle (restoring the old one on
 *  failure), clears quarantine and opens the app. */
const SWAP_SCRIPT = `#!/bin/bash
PID="$1"; NEW="$2"; TARGET="$3"
for _ in $(seq 1 150); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
BACKUP="\${TARGET%.app}.previous.app"
rm -rf "$BACKUP"
if mv "$TARGET" "$BACKUP"; then
  if /usr/bin/ditto "$NEW" "$TARGET"; then
    rm -rf "$BACKUP"
  else
    rm -rf "$TARGET"
    mv "$BACKUP" "$TARGET"
  fi
fi
/usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
/usr/bin/open "$TARGET"
`;

function installMacUpdate(): void {
  if (!macPending || !fs.existsSync(macPending.appPath)) {
    throw new Error("The downloaded update is missing. Check for updates again.");
  }
  const target = currentBundlePath();
  if (!target.endsWith(".app")) throw new Error(`Unexpected app location: ${target}`);
  if (target.startsWith("/Volumes/")) {
    throw new Error("The app is running from the installer disk. Drag it to Applications first.");
  }
  fs.accessSync(path.dirname(target), fs.constants.W_OK);

  const script = path.join(updateDir(), "install.sh");
  fs.writeFileSync(script, SWAP_SCRIPT, { mode: 0o755 });
  const child = spawn(
    "/bin/bash",
    [script, String(process.pid), macPending.appPath, target],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  app.quit();
}
