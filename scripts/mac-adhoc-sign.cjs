// electron-builder afterPack hook: ad-hoc sign the macOS app.
//
// Release builds are not signed with an Apple certificate
// (CSC_IDENTITY_AUTO_DISCOVERY=false). Packaging edits the Electron bundle,
// which breaks Electron's own signature, and Apple Silicon refuses to open
// an app whose signature is broken ("is damaged and can't be opened").
// An ad-hoc signature keeps the bundle valid, so macOS only shows the usual
// "unidentified developer" prompt, and it embeds the microphone entitlement.
// Skipped when a real signing certificate is configured.

const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const app = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const entitlements = path.join(__dirname, "..", "build", "entitlements.mac.plist");
  console.log(`  • ad-hoc signing ${app}`);
  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", "--options", "runtime", "--entitlements", entitlements, app],
    { stdio: "inherit" },
  );
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], {
    stdio: "inherit",
  });
};
