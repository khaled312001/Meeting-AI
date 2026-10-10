"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAppIpc = registerAppIpc;
const electron_1 = require("electron");
const updater_1 = require("../updater");
/** App lifecycle IPC: quit + relaunch + updater.
 *
 *  Relaunch is needed after macOS Screen Recording permission changes
 *  because TCC state is cached per-process until the next launch. */
function registerAppIpc() {
    electron_1.ipcMain.handle("app-quit", () => {
        electron_1.app.quit();
    });
    // The renderer's clipboard API fails while the overlay isn't focused.
    electron_1.ipcMain.handle("clipboard:write-text", (_, text) => {
        if (typeof text !== "string" || text.length > 2000000)
            return false;
        electron_1.clipboard.writeText(text);
        return true;
    });
    electron_1.ipcMain.handle("app-relaunch", () => {
        electron_1.app.relaunch();
        electron_1.app.exit(0);
    });
    electron_1.ipcMain.handle("updater:get-version", () => (0, updater_1.getAppVersion)());
    electron_1.ipcMain.handle("updater:get-status", () => (0, updater_1.getUpdaterStatus)());
    electron_1.ipcMain.handle("updater:check", () => (0, updater_1.checkForUpdates)());
}
