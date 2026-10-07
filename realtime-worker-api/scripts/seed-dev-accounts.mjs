// Create + approve the local test accounts. LOCAL DEV ONLY.
//
//   1. bun run dev            (wrangler dev on http://localhost:8787)
//   2. bun run seed:dev       (this script, in another terminal)
//
// Accounts (all share DEV_PASSWORD below — a throwaway local value, never
// use it on a deployed worker):
//   admin@meetingai.test  → /admin + /dashboard (must be in ADMIN_EMAILS in .dev.vars)
//   sara@meetingai.test   → regular user with sample data
//   omar@meetingai.test   → regular user
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEV_PASSWORD = "TestPass!2345";
const API = process.env.API_URL || "http://localhost:8787";
const ACCOUNTS = [
  { email: "admin@meetingai.test", name: "Admin User" },
  { email: "sara@meetingai.test", name: "Sara Ahmed" },
  { email: "omar@meetingai.test", name: "Omar Khaled" },
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) {
  console.error(`Refusing to seed ${API} — this script is for local wrangler dev only.`);
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  Origin: "http://localhost:3000",
  "X-Requested-With": "RIC-Desktop",
};

for (const { email, name } of ACCOUNTS) {
  let res;
  try {
    res = await fetch(`${API}/api/auth/sign-up/email`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, name, password: DEV_PASSWORD }),
    });
  } catch {
    console.error(`Cannot reach ${API}. Start the worker first: bun run dev`);
    process.exit(1);
  }
  const text = await res.text();
  if (res.ok) console.log(`created   ${email}`);
  else if (/exist/i.test(text)) console.log(`exists    ${email}`);
  else console.log(`sign-up ${res.status} ${email}: ${text.slice(0, 160)}`);
}

const list = ACCOUNTS.map((a) => `'${a.email}'`).join(",");
execSync(
  `npx --no-install wrangler d1 execute DB --local --command "UPDATE user SET isApproved = 1, isBanned = 0, banReason = NULL WHERE email IN (${list})"`,
  { cwd: root, stdio: "ignore" },
);
console.log("approved  all test accounts");

let devVars = "";
try {
  devVars = readFileSync(join(root, ".dev.vars"), "utf8");
} catch {}
if (!/^ADMIN_EMAILS=.*admin@meetingai\.test/m.test(devVars)) {
  console.warn("note: add ADMIN_EMAILS=admin@meetingai.test to .dev.vars and restart wrangler for /admin access");
}
console.log("\nOpen http://localhost:3000/login — password is DEV_PASSWORD in scripts/seed-dev-accounts.mjs");
