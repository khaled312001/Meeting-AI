#!/usr/bin/env node

// Reads lib/constant.ts → updates package.json build.productName,
// pins artifactName for stable download filenames, and rewrites macOS
// permission strings to use displayName.

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pkgPath = path.join(root, "package.json");
const constantPath = path.join(root, "lib/constant.ts");

const src = fs.readFileSync(constantPath, "utf8");
const match = src.match(/export const APP_DISPLAY_NAME = "([^"]+)"/);
const displayName =
  match?.[1] && match[1].length > 0 ? match[1] : "Meeting AI";

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (!pkg.build) pkg.build = {};

pkg.build.productName = displayName;
// Keep legacy download filenames (spaces) so CI sync + Homebrew/WinGet URLs stay
// compatible with v0.14.x releases. productName alone controls the bundled .app name.
pkg.build.artifactName =
  "MeetingAI-${version}-${os}-${arch}.${ext}";

if (pkg.build.mac?.extendInfo) {
  const info = pkg.build.mac.extendInfo;
  if (typeof info.NSMicrophoneUsageDescription === "string") {
    info.NSMicrophoneUsageDescription = `${displayName} uses the microphone to transcribe your voice for the Ask AI feature.`;
  }
  if (typeof info.NSCameraUsageDescription === "string") {
    info.NSCameraUsageDescription = `${displayName} does not record from the camera; this permission is requested only by macOS for media capture APIs and will not be used.`;
  }
  if (typeof info.NSAppleEventsUsageDescription === "string") {
    info.NSAppleEventsUsageDescription = `${displayName} does not script other apps; this permission is requested only by macOS for system integration.`;
  }
}

fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(
  `Applied displayName "${displayName}" to package.json build config.`,
);

// Bake the API URL the renderer was built with (loads .env* files the same
// way `next build` does) for the packaged main process — see
// electron/backend-env.ts.
require("@next/env").loadEnvConfig(root, false, {
  info: () => {},
  error: console.error,
});
const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_API_URL || "").trim();
fs.writeFileSync(
  path.join(root, "electron", "backend-url.json"),
  `${JSON.stringify({ url: backendUrl }, null, 2)}\n`,
);
console.log(
  backendUrl
    ? `Baked backend URL ${backendUrl} into electron/backend-url.json.`
    : "NEXT_PUBLIC_BACKEND_API_URL not set — packaged app will use http://localhost:8787.",
);
