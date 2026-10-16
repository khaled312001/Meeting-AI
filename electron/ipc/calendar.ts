import { app, type BrowserWindow, ipcMain, shell } from "electron";

import {
  GoogleError,
  type GoogleErrorCode,
  cancelSignIn,
  getAccountStatus,
  signIn,
  signOut,
} from "../googleAuth";
import {
  addTask,
  classifyMeetingUrl,
  completeTask,
  createEvent,
  listOpenTasks,
  listUpcomingEvents,
  parseNewEventInput,
} from "../googleApi";
import {
  clearMeetingReminders,
  initMeetingReminders,
  scheduleMeetingReminders,
} from "../meetingReminders";

type WindowAccessor = () => BrowserWindow | null;

/** Every call resolves (never rejects) so the renderer gets a readable
 *  message instead of Electron's "Error invoking remote method …". */
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: GoogleErrorCode | "unknown"; error: string };

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof GoogleError) {
      return { ok: false, code: err.code, error: err.message };
    }
    console.error("[calendar]", err instanceof Error ? err.message : err);
    return {
      ok: false,
      code: "unknown",
      error: "Something went wrong. Try again.",
    };
  }
}

/** Only links that came from the user's own calendar (or that look like a
 *  meeting link) may be opened, so the renderer can't ask the main
 *  process to open arbitrary URLs. */
const knownLinks = new Set<string>();

function remember(urls: Array<string | null>): void {
  for (const url of urls) if (url) knownLinks.add(url);
}

/** Matches build.appId: Windows only shows toasts for a registered
 *  AppUserModelID (the installer's shortcut carries this one). */
const APP_USER_MODEL_ID = "app.meetingai.desktop";

export function registerCalendarIpc(getWindow: WindowAccessor): void {
  initMeetingReminders(getWindow);
  if (process.platform === "win32" && app.isPackaged) {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }

  ipcMain.handle("google:status", () => wrap(async () => getAccountStatus()));

  ipcMain.handle("google:connect", () =>
    wrap(async () => {
      const status = await signIn();
      // The browser has focus after consent; bring the app back.
      const w = getWindow();
      if (w && !w.isDestroyed()) {
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
      }
      return status;
    }),
  );

  ipcMain.handle("google:cancel-connect", () =>
    wrap(async () => {
      cancelSignIn();
      return getAccountStatus();
    }),
  );

  ipcMain.handle("google:disconnect", () =>
    wrap(async () => {
      clearMeetingReminders();
      knownLinks.clear();
      return signOut();
    }),
  );

  ipcMain.handle("calendar:list-events", () =>
    wrap(async () => {
      const events = await listUpcomingEvents(7);
      remember(events.flatMap((e) => [e.joinUrl, e.htmlLink]));
      scheduleMeetingReminders(events);
      return events;
    }),
  );

  ipcMain.handle("calendar:create-event", (_e, input: unknown) =>
    wrap(async () => {
      const event = await createEvent(parseNewEventInput(input));
      remember([event.joinUrl, event.htmlLink]);
      return event;
    }),
  );

  ipcMain.handle("calendar:open-link", (_e, url: unknown) =>
    wrap(async () => {
      if (typeof url !== "string" || url.length > 2048) return false;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return false;
      }
      if (parsed.protocol !== "https:") return false;
      if (!knownLinks.has(url) && !classifyMeetingUrl(url)) return false;
      await shell.openExternal(parsed.toString());
      return true;
    }),
  );

  ipcMain.handle("tasks:list", () => wrap(() => listOpenTasks()));

  ipcMain.handle("tasks:add", (_e, input: unknown) =>
    wrap(() => addTask(input)),
  );

  ipcMain.handle("tasks:complete", (_e, id: unknown) =>
    wrap(async () => {
      await completeTask(id);
      return true;
    }),
  );
}
