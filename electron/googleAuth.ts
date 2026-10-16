/** Google sign-in for Calendar / Tasks, done entirely in the main process.
 *
 *  OAuth "installed app" flow: a one-shot HTTP server on a random
 *  127.0.0.1 port receives the redirect, PKCE (S256) protects the code, and
 *  the consent page opens in the system browser. The refresh token is kept
 *  encrypted with `safeStorage` in userData; access tokens live in memory
 *  only. The renderer never sees a token. */

import { app, net, safeStorage, shell } from "electron";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export const SCOPE_CALENDAR_EVENTS =
  "https://www.googleapis.com/auth/calendar.events";
export const SCOPE_TASKS = "https://www.googleapis.com/auth/tasks";
const SCOPES = ["openid", "email", SCOPE_CALENDAR_EVENTS, SCOPE_TASKS];

/** How long the browser sign-in may take before we give up. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

// ── Config ────────────────────────────────────────────────────────────

interface GoogleOAuthConfig {
  clientId: string;
  /** Desktop-app clients get a secret that Google still asks for at the
   *  token endpoint. It is not confidential (it ships in the app). */
  clientSecret: string;
}

let cachedConfig: GoogleOAuthConfig | null | undefined;

/** Dev: read the two keys from `.env.local` / `.env` without loading the
 *  rest of the file into process.env. */
function readDotEnvValue(key: string): string {
  for (const name of [".env.local", ".env"]) {
    try {
      const file = path.join(app.getAppPath(), name);
      const text = fs.readFileSync(file, "utf8");
      const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m"));
      const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    } catch {
      /* file missing */
    }
  }
  return "";
}

/** Client id / secret: env first (dev and CI), then the values
 *  scripts/apply-app-constants.js baked into electron/google-oauth.json
 *  for packaged builds. Null when calendar sign-in isn't configured. */
export function getOAuthConfig(): GoogleOAuthConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  let clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  let clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  if (!clientId && !app.isPackaged) {
    clientId = readDotEnvValue("GOOGLE_OAUTH_CLIENT_ID");
    clientSecret = readDotEnvValue("GOOGLE_OAUTH_CLIENT_SECRET");
  }
  if (!clientId) {
    try {
      const baked = JSON.parse(
        fs.readFileSync(path.join(__dirname, "google-oauth.json"), "utf8"),
      ) as { clientId?: string; clientSecret?: string };
      clientId = baked.clientId?.trim() ?? "";
      clientSecret = baked.clientSecret?.trim() ?? "";
    } catch {
      /* not baked */
    }
  }
  cachedConfig = clientId ? { clientId, clientSecret } : null;
  return cachedConfig;
}

// ── Stored account ────────────────────────────────────────────────────

interface StoredAccount {
  refreshToken: string;
  email: string | null;
  scopes: string[];
}

const ACCOUNT_FILE = () =>
  path.join(app.getPath("userData"), "google-account.bin");

let account: StoredAccount | null = null;
let accountLoaded = false;
let accessToken: { token: string; expiresAt: number } | null = null;
/** False when the OS has no keychain: the account then lasts until quit. */
let persisted = true;

function loadAccount(): StoredAccount | null {
  if (accountLoaded) return account;
  accountLoaded = true;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const raw = fs.readFileSync(ACCOUNT_FILE());
    const parsed = JSON.parse(safeStorage.decryptString(raw)) as StoredAccount;
    if (typeof parsed.refreshToken === "string" && parsed.refreshToken) {
      account = {
        refreshToken: parsed.refreshToken,
        email: typeof parsed.email === "string" ? parsed.email : null,
        scopes: Array.isArray(parsed.scopes) ? parsed.scopes : [],
      };
    }
  } catch {
    account = null;
  }
  return account;
}

function saveAccount(next: StoredAccount): void {
  account = next;
  accountLoaded = true;
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      persisted = false;
      return;
    }
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(
      ACCOUNT_FILE(),
      safeStorage.encryptString(JSON.stringify(next)),
    );
    persisted = true;
  } catch {
    persisted = false;
  }
}

function forgetAccount(): void {
  account = null;
  accountLoaded = true;
  accessToken = null;
  try {
    fs.rmSync(ACCOUNT_FILE(), { force: true });
  } catch {
    /* best effort */
  }
}

// ── Status ────────────────────────────────────────────────────────────

export interface GoogleAccountStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  canUseCalendar: boolean;
  canUseTasks: boolean;
  /** False when the sign-in can't be kept across restarts. */
  persisted: boolean;
  signingIn: boolean;
}

export function getAccountStatus(): GoogleAccountStatus {
  const acc = loadAccount();
  return {
    configured: getOAuthConfig() !== null,
    connected: acc !== null,
    email: acc?.email ?? null,
    canUseCalendar: !!acc?.scopes.includes(SCOPE_CALENDAR_EVENTS),
    canUseTasks: !!acc?.scopes.includes(SCOPE_TASKS),
    persisted,
    signingIn: pendingSignIn !== null,
  };
}

// ── Errors ────────────────────────────────────────────────────────────

export type GoogleErrorCode =
  | "not-configured"
  | "not-connected"
  | "reauth"
  | "cancelled"
  | "missing-scope"
  | "network"
  | "google";

export class GoogleError extends Error {
  constructor(
    readonly code: GoogleErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// ── Token endpoint ────────────────────────────────────────────────────

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function postToken(
  params: Record<string, string>,
): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await net.fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
  } catch {
    throw new GoogleError(
      "network",
      "Couldn't reach Google. Check your connection.",
    );
  }
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    if (body.error === "invalid_grant") {
      throw new GoogleError(
        "reauth",
        "Your Google sign-in expired. Connect your calendar again.",
      );
    }
    throw new GoogleError(
      "google",
      body.error_description ||
        body.error ||
        `Google sign-in failed (${res.status}).`,
    );
  }
  return body;
}

/** The id token comes straight from Google's token endpoint over TLS, so
 *  reading its email claim needs no signature check. */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/** A valid access token, refreshed when it is about to expire. */
export async function getAccessToken(): Promise<string> {
  const config = getOAuthConfig();
  if (!config) {
    throw new GoogleError(
      "not-configured",
      "Google Calendar isn't set up in this build.",
    );
  }
  const acc = loadAccount();
  if (!acc)
    throw new GoogleError("not-connected", "Connect Google Calendar first.");
  if (accessToken && accessToken.expiresAt - 60_000 > Date.now()) {
    return accessToken.token;
  }
  try {
    const body = await postToken({
      client_id: config.clientId,
      ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
      refresh_token: acc.refreshToken,
      grant_type: "refresh_token",
    });
    if (!body.access_token) {
      throw new GoogleError("google", "Google returned no access token.");
    }
    accessToken = {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return accessToken.token;
  } catch (err) {
    if (err instanceof GoogleError && err.code === "reauth") forgetAccount();
    throw err;
  }
}

/** Drop the cached access token (e.g. after a 401). */
export function invalidateAccessToken(): void {
  accessToken = null;
}

// ── Sign-in (loopback + PKCE) ─────────────────────────────────────────

let pendingSignIn: { cancel: () => void } | null = null;

const base64url = (buf: Buffer) => buf.toString("base64url");

function resultPage(ok: boolean, message: string): string {
  const color = ok ? "#34d399" : "#f87171";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${ok ? "Connected" : "Sign-in failed"}</title></head><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#13151c;color:#eceef3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center;max-width:28rem;padding:2rem"><div style="width:44px;height:44px;border-radius:50%;margin:0 auto 1rem;background:${color}22;border:1px solid ${color}66;display:flex;align-items:center;justify-content:center;color:${color};font-size:22px">${ok ? "&#10003;" : "!"}</div><h1 style="font-size:1.1rem;margin:0 0 .5rem">${message}</h1><p style="opacity:.65;font-size:.85rem;margin:0">You can close this tab and go back to the app.</p></div></body></html>`;
}

/** Cancel a sign-in that is waiting for the browser. */
export function cancelSignIn(): void {
  pendingSignIn?.cancel();
}

/** Open Google's consent page in the system browser and wait for the
 *  redirect. Resolves with the new status once tokens are stored. */
export async function signIn(): Promise<GoogleAccountStatus> {
  const config = getOAuthConfig();
  if (!config) {
    throw new GoogleError(
      "not-configured",
      "Google Calendar isn't set up in this build.",
    );
  }
  pendingSignIn?.cancel();

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  const code = await new Promise<{ code: string; redirectUri: string }>(
    (resolve, reject) => {
      let settled = false;
      let redirectUri = "";
      const server = http.createServer();
      const finish = (err: Error | null, value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pendingSignIn = null;
        // Let the browser get its response before the socket closes.
        setTimeout(() => server.close(), 500);
        if (err) reject(err);
        else resolve({ code: value ?? "", redirectUri });
      };
      const timer = setTimeout(
        () => finish(new GoogleError("cancelled", "Sign-in timed out.")),
        SIGN_IN_TIMEOUT_MS,
      );
      pendingSignIn = {
        cancel: () =>
          finish(new GoogleError("cancelled", "Sign-in cancelled.")),
      };

      server.on("request", (req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/") {
          res.writeHead(404).end();
          return;
        }
        const reply = (ok: boolean, message: string) => {
          res.writeHead(ok ? 200 : 400, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(resultPage(ok, message));
        };
        if (url.searchParams.get("state") !== state) {
          reply(false, "This sign-in link is no longer valid.");
          return;
        }
        const error = url.searchParams.get("error");
        if (error) {
          reply(false, "Google sign-in was cancelled.");
          finish(
            new GoogleError(
              "cancelled",
              error === "access_denied"
                ? "Sign-in was cancelled."
                : `Google sign-in failed: ${error}`,
            ),
          );
          return;
        }
        const value = url.searchParams.get("code");
        if (!value) {
          reply(false, "Google didn't send a sign-in code.");
          finish(
            new GoogleError("google", "Google didn't send a sign-in code."),
          );
          return;
        }
        reply(true, "Google Calendar is connected");
        finish(null, value);
      });
      server.on("error", (err) =>
        finish(
          new GoogleError("network", `Couldn't start sign-in: ${err.message}`),
        ),
      );
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        redirectUri = `http://127.0.0.1:${port}`;
        const authUrl = new URL(AUTH_ENDPOINT);
        authUrl.search = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: SCOPES.join(" "),
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
          access_type: "offline",
          // Always show consent so Google returns a refresh token.
          prompt: "consent",
          include_granted_scopes: "true",
        }).toString();
        shell
          .openExternal(authUrl.toString())
          .catch(() =>
            finish(new GoogleError("network", "Couldn't open the browser.")),
          );
      });
    },
  );

  const body = await postToken({
    client_id: config.clientId,
    ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
    code: code.code,
    code_verifier: verifier,
    redirect_uri: code.redirectUri,
    grant_type: "authorization_code",
  });
  if (!body.refresh_token || !body.access_token) {
    throw new GoogleError(
      "google",
      "Google didn't return a sign-in token. Try again.",
    );
  }
  // People can untick scopes on Google's consent screen.
  const scopes = (body.scope ?? "").split(/\s+/).filter(Boolean);
  if (!scopes.includes(SCOPE_CALENDAR_EVENTS)) {
    void revoke(body.refresh_token);
    throw new GoogleError(
      "missing-scope",
      "Calendar access wasn't allowed. Connect again and tick the calendar permission.",
    );
  }
  saveAccount({
    refreshToken: body.refresh_token,
    email: emailFromIdToken(body.id_token),
    scopes,
  });
  accessToken = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return getAccountStatus();
}

async function revoke(token: string): Promise<void> {
  try {
    await net.fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    /* best effort: the local copy is gone either way */
  }
}

/** Revoke the grant at Google and forget it locally. */
export async function signOut(): Promise<GoogleAccountStatus> {
  pendingSignIn?.cancel();
  const acc = loadAccount();
  forgetAccount();
  if (acc) await revoke(acc.refreshToken);
  return getAccountStatus();
}
