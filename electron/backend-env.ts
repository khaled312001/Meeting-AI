/** Packaged builds can't see build-time env vars, but lib/backend-url.mjs
 *  (CSP + Origin rewrite in the main process) reads
 *  NEXT_PUBLIC_BACKEND_API_URL at runtime. scripts/apply-app-constants.js
 *  bakes the build's value into electron/backend-url.json; load it before
 *  anything imports lib/backend-url.mjs. Must be main.ts's first import. */
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

if (app.isPackaged && !process.env.NEXT_PUBLIC_BACKEND_API_URL) {
  try {
    const { url } = JSON.parse(
      fs.readFileSync(path.join(__dirname, "backend-url.json"), "utf8"),
    ) as { url?: string };
    if (url) process.env.NEXT_PUBLIC_BACKEND_API_URL = url;
  } catch {
    // No baked URL: lib/backend-url.mjs falls back to localhost.
  }
}
