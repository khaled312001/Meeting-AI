import { app, BrowserWindow, ipcMain, shell } from "electron";
import * as fs from "fs";
import * as path from "path";

/** Meeting summaries: render the summary HTML to a PDF in Downloads, then
 *  open it or show it in the folder. Only files saved here can be opened,
 *  so the renderer can't ask the main process to open arbitrary paths. */

const saved = new Set<string>();

function safeBaseName(name: unknown): string {
  const base = typeof name === "string" ? name : "";
  const cleaned = base
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "Meeting summary";
}

function uniquePath(dir: string, base: string): string {
  let candidate = path.join(dir, `${base}.pdf`);
  for (let i = 2; fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${base} (${i}).pdf`);
  }
  return candidate;
}

async function htmlToPdf(html: string): Promise<Buffer> {
  // A hidden window with scripts off: it only lays out our own HTML.
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  try {
    await win.loadURL(
      `data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`,
    );
    return await win.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
    });
  } finally {
    win.destroy();
  }
}

export function registerSummaryIpc(): void {
  ipcMain.handle(
    "summary:save-pdf",
    async (_, html: unknown, baseName: unknown): Promise<string> => {
      if (typeof html !== "string" || html.length === 0 || html.length > 5_000_000) {
        throw new Error("Invalid summary");
      }
      const pdf = await htmlToPdf(html);
      const target = uniquePath(app.getPath("downloads"), safeBaseName(baseName));
      await fs.promises.writeFile(target, pdf);
      saved.add(target);
      return target;
    },
  );

  ipcMain.handle("summary:open", async (_, file: unknown) => {
    if (typeof file !== "string" || !saved.has(file)) return false;
    const err = await shell.openPath(file);
    return err === "";
  });

  ipcMain.handle("summary:show", (_, file: unknown) => {
    if (typeof file !== "string" || !saved.has(file)) return false;
    shell.showItemInFolder(file);
    return true;
  });
}
