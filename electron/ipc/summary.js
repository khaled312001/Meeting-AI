"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSummaryIpc = registerSummaryIpc;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** Meeting summaries: render the summary HTML to a PDF in Downloads, then
 *  open it or show it in the folder. Only files saved here can be opened,
 *  so the renderer can't ask the main process to open arbitrary paths. */
const saved = new Set();
function safeBaseName(name) {
    const base = typeof name === "string" ? name : "";
    const cleaned = base
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
    return cleaned || "Meeting summary";
}
function uniquePath(dir, base) {
    let candidate = path.join(dir, `${base}.pdf`);
    for (let i = 2; fs.existsSync(candidate); i++) {
        candidate = path.join(dir, `${base} (${i}).pdf`);
    }
    return candidate;
}
async function htmlToPdf(html) {
    // A hidden window with scripts off: it only lays out our own HTML.
    const win = new electron_1.BrowserWindow({
        show: false,
        webPreferences: {
            javascript: false,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    try {
        await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`);
        return await win.webContents.printToPDF({
            pageSize: "A4",
            printBackground: true,
            margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
        });
    }
    finally {
        win.destroy();
    }
}
function registerSummaryIpc() {
    electron_1.ipcMain.handle("summary:save-pdf", async (_, html, baseName) => {
        if (typeof html !== "string" || html.length === 0 || html.length > 5000000) {
            throw new Error("Invalid summary");
        }
        const pdf = await htmlToPdf(html);
        const target = uniquePath(electron_1.app.getPath("downloads"), safeBaseName(baseName));
        await fs.promises.writeFile(target, pdf);
        saved.add(target);
        return target;
    });
    electron_1.ipcMain.handle("summary:open", async (_, file) => {
        if (typeof file !== "string" || !saved.has(file))
            return false;
        const err = await electron_1.shell.openPath(file);
        return err === "";
    });
    electron_1.ipcMain.handle("summary:show", (_, file) => {
        if (typeof file !== "string" || !saved.has(file))
            return false;
        electron_1.shell.showItemInFolder(file);
        return true;
    });
}
