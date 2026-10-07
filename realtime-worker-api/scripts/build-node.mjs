// Bundle the worker + Node adapter into dist-node/ for a plain Node host.
//   node scripts/build-node.mjs [--static ../out]
// Output: server.js (single file, no node_modules needed), migrations/,
// public/ (static site, when --static is given), package.json.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist-node");
const staticArg = process.argv.indexOf("--static");
const staticDir = staticArg > 0 ? path.resolve(process.argv[staticArg + 1]) : null;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "migrations"), { recursive: true });

await build({
  entryPoints: [path.join(root, "node/server.ts")],
  outfile: path.join(out, "server.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
});

for (const f of fs.readdirSync(path.join(root, "drizzle")).filter((f) => f.endsWith(".sql"))) {
  fs.copyFileSync(path.join(root, "drizzle", f), path.join(out, "migrations", f));
}
fs.writeFileSync(
  path.join(out, "package.json"),
  `${JSON.stringify({ name: "meeting-ai-server", private: true, type: "commonjs", engines: { node: ">=22.13" } }, null, 2)}\n`,
);
if (staticDir) {
  if (!fs.existsSync(path.join(staticDir, "index.html"))) throw new Error(`No index.html in ${staticDir} — run next build first`);
  fs.cpSync(staticDir, path.join(out, "public"), { recursive: true });
  fs.copyFileSync(path.join(root, "node/public.htaccess"), path.join(out, "public", ".htaccess"));
}
console.log(`built ${path.relative(process.cwd(), out)}${staticDir ? " (with static site)" : ""}`);
