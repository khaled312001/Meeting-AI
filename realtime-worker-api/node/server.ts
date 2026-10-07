/** Node entrypoint for hosting the worker on a regular Node host (e.g.
 *  Hostinger / Passenger). Serves the static Next.js export and forwards
 *  /api/* to the unchanged worker `fetch`, with D1 / KV / rate-limit
 *  bindings backed by a local SQLite file (see ./bindings.ts).
 *
 *  Layout next to the bundled server.js:
 *    .env          secrets + settings (BETTER_AUTH_SECRET, ADMIN_EMAILS, …)
 *    migrations/   drizzle/*.sql
 *    public/       `next build` output (out/)
 *    data/         SQLite database (created on first start) */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import worker from "../src/index";
import type { Env } from "../src/env";
import { applyMigrations, createD1, createKv, createRateLimiter, openDatabase } from "./bindings";

const ROOT = process.env.APP_ROOT || __dirname;
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const STATIC_DIR = path.join(ROOT, "public");
const DB_FILE = process.env.DATABASE_FILE || path.join(ROOT, "data", "app.db");
const MAX_BODY_BYTES = 25 * 1024 * 1024;

const db = openDatabase(DB_FILE);
const migrated = applyMigrations(db, path.join(ROOT, "migrations"));
if (migrated.length) console.log(`[node] applied migrations: ${migrated.join(", ")}`);

const kv = createKv(db);
const env = {
  QUOTA_ENFORCEMENT: "false",
  QUOTA_RECORD_CONSUMPTION: "true",
  ...(Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === "string")) as Record<string, string>),
  DB: createD1(db),
  CONFIG_KV: kv,
  // Same limits as wrangler.toml's COMPLETION_LIMITER.
  COMPLETION_LIMITER: createRateLimiter(db, 30, 60),
} as unknown as Env;

function makeCtx() {
  return {
    waitUntil(p: Promise<unknown>) {
      p.catch((e) => console.error("[node] waitUntil task failed:", e instanceof Error ? e.message : e));
    },
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

/** The client IP the proxy in front of us saw. Client-sent copies of the
 *  header the worker trusts (cf-connecting-ip) are always discarded. */
function clientIp(req: http.IncomingMessage): string | null {
  const header = process.env.CLIENT_IP_HEADER?.toLowerCase();
  if (header) {
    const raw = req.headers[header];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v) {
      const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
      // x-forwarded-for: the right-most entry was appended by our proxy.
      return (header === "x-forwarded-for" ? parts[parts.length - 1] : parts[0]) ?? null;
    }
  }
  return req.socket.remoteAddress ?? null;
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Payload too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse) {
  const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0].trim();
  const url = new URL(req.url ?? "/", `${proto}://${req.headers.host ?? "localhost"}`);

  // Set LOG_REQUEST_HEADERS=1 once to see which header your proxy uses for
  // the client IP (then set CLIENT_IP_HEADER to it).
  if (process.env.LOG_REQUEST_HEADERS === "1") {
    console.log("[node] headers:", JSON.stringify({ ...req.headers, cookie: undefined }), "socket:", req.socket.remoteAddress);
  }

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || k.startsWith(":")) continue;
    if (Array.isArray(v)) for (const item of v) headers.append(k, item);
    else headers.set(k, v);
  }
  headers.delete("cf-connecting-ip");
  const ip = clientIp(req);
  if (ip) headers.set("cf-connecting-ip", ip.replace(/^::ffff:/, ""));

  const method = req.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
  const request = new Request(url, { method, headers, body: body ? new Uint8Array(body) : undefined });

  const response = await worker.fetch(request, env, makeCtx());

  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("set-cookie", cookies);
  if (!response.body || method === "HEAD") {
    res.end();
    return;
  }
  // Stream (SSE answers) — don't let a proxy buffer them.
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Cache-Control", "no-cache, no-transform");
  }
  res.flushHeaders();
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    res.write(chunk);
  }
  res.end();
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".dmg": "application/x-apple-diskimage",
  ".zip": "application/zip",
  ".yml": "text/yaml; charset=utf-8",
};

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(self), display-capture=(self), payment=()",
};

function resolveStatic(pathname: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const base = path.resolve(STATIC_DIR);
  const candidates = rel.endsWith("/") ? [`${rel}index.html`] : [rel, `${rel}.html`, `${rel}/index.html`];
  for (const c of candidates) {
    const full = path.resolve(base, `.${path.posix.normalize(c)}`);
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch {
      /* try next */
    }
  }
  return null;
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  let file = resolveStatic(pathname);
  let status = 200;
  if (!file) {
    file = resolveStatic("/404.html");
    status = 404;
  }
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  res.setHeader("Content-Type", TYPES[ext] ?? "application/octet-stream");
  res.setHeader("Content-Length", stat.size);
  if (pathname.startsWith("/_next/static/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  else if (ext === ".html") res.setHeader("Cache-Control", "no-cache");
  else res.setHeader("Cache-Control", "public, max-age=3600");
  if (pathname.startsWith("/download/")) {
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(file).replace(/"/g, "")}"`);
  }
  res.statusCode = status;
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const pathname = (req.url ?? "/").split("?")[0];
  const isApi = pathname === "/api" || pathname.startsWith("/api/");
  if (!isApi) {
    serveStatic(req, res, pathname);
    return;
  }
  handleApi(req, res).catch((e: unknown) => {
    const status = (e as { status?: number }).status ?? 500;
    console.error("[node] request failed:", req.method, pathname, e instanceof Error ? e.message : e);
    if (!res.headersSent) {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: status === 413 ? "Payload too large" : "Internal error" }));
    } else {
      res.end();
    }
  });
});

// Hourly maintenance — the worker's cron trigger ("0 * * * *").
const HOUR = 60 * 60 * 1000;
setInterval(() => {
  kv.purgeExpired();
  void worker.scheduled(
    { cron: "0 * * * *", scheduledTime: Date.now(), noRetry() {} } as unknown as ScheduledController,
    env,
    makeCtx(),
  );
}, HOUR).unref();

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`[node] listening on :${port} (static: ${STATIC_DIR}, db: ${DB_FILE})`));
