/** Single source of truth for the worker API base URL (plain JS so Next
 *  config, the renderer, and Electron main can all import it).
 *
 *  Set NEXT_PUBLIC_BACKEND_API_URL at build time (e.g. in `.env.local`) to
 *  point the app and dashboards at your deployed worker. Packaged Electron
 *  builds read this file at runtime without the env var, so change the
 *  fallback below before running `electron:build`. */

let fromEnv;
try {
  // Literal reference so Next inlines it into client bundles.
  fromEnv = process.env.NEXT_PUBLIC_BACKEND_API_URL;
} catch {
  fromEnv = undefined;
}

export const BACKEND_API_URL = (fromEnv || "http://localhost:8787").replace(
  /\/+$/,
  "",
);

export const BACKEND_API_ORIGIN = new URL(BACKEND_API_URL).origin;
