"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCalendarIpc = registerCalendarIpc;
const electron_1 = require("electron");
const googleAuth_1 = require("../googleAuth");
const googleApi_1 = require("../googleApi");
const meetingReminders_1 = require("../meetingReminders");
async function wrap(fn) {
    try {
        return { ok: true, data: await fn() };
    }
    catch (err) {
        if (err instanceof googleAuth_1.GoogleError) {
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
const knownLinks = new Set();
function remember(urls) {
    for (const url of urls)
        if (url)
            knownLinks.add(url);
}
/** Matches build.appId: Windows only shows toasts for a registered
 *  AppUserModelID (the installer's shortcut carries this one). */
const APP_USER_MODEL_ID = "app.meetingai.desktop";
function registerCalendarIpc(getWindow) {
    (0, meetingReminders_1.initMeetingReminders)(getWindow);
    if (process.platform === "win32" && electron_1.app.isPackaged) {
        electron_1.app.setAppUserModelId(APP_USER_MODEL_ID);
    }
    electron_1.ipcMain.handle("google:status", () => wrap(async () => (0, googleAuth_1.getAccountStatus)()));
    electron_1.ipcMain.handle("google:connect", () => wrap(async () => {
        const status = await (0, googleAuth_1.signIn)();
        // The browser has focus after consent; bring the app back.
        const w = getWindow();
        if (w && !w.isDestroyed()) {
            if (w.isMinimized())
                w.restore();
            w.show();
            w.focus();
        }
        return status;
    }));
    electron_1.ipcMain.handle("google:cancel-connect", () => wrap(async () => {
        (0, googleAuth_1.cancelSignIn)();
        return (0, googleAuth_1.getAccountStatus)();
    }));
    electron_1.ipcMain.handle("google:disconnect", () => wrap(async () => {
        (0, meetingReminders_1.clearMeetingReminders)();
        knownLinks.clear();
        return (0, googleAuth_1.signOut)();
    }));
    electron_1.ipcMain.handle("calendar:list-events", () => wrap(async () => {
        const events = await (0, googleApi_1.listUpcomingEvents)(7);
        remember(events.flatMap((e) => [e.joinUrl, e.htmlLink]));
        (0, meetingReminders_1.scheduleMeetingReminders)(events);
        return events;
    }));
    electron_1.ipcMain.handle("calendar:create-event", (_e, input) => wrap(async () => {
        const event = await (0, googleApi_1.createEvent)((0, googleApi_1.parseNewEventInput)(input));
        remember([event.joinUrl, event.htmlLink]);
        return event;
    }));
    electron_1.ipcMain.handle("calendar:open-link", (_e, url) => wrap(async () => {
        if (typeof url !== "string" || url.length > 2048)
            return false;
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch {
            return false;
        }
        if (parsed.protocol !== "https:")
            return false;
        if (!knownLinks.has(url) && !(0, googleApi_1.classifyMeetingUrl)(url))
            return false;
        await electron_1.shell.openExternal(parsed.toString());
        return true;
    }));
    electron_1.ipcMain.handle("tasks:list", () => wrap(() => (0, googleApi_1.listOpenTasks)()));
    electron_1.ipcMain.handle("tasks:add", (_e, input) => wrap(() => (0, googleApi_1.addTask)(input)));
    electron_1.ipcMain.handle("tasks:complete", (_e, id) => wrap(async () => {
        await (0, googleApi_1.completeTask)(id);
        return true;
    }));
}
