/* Runs every suite under tests/ one after another and fails if any does.
     npm test                 everything
     npm test -- whoop        only suites whose path contains "whoop"
   Backend suites (tests/backend/*.test.mjs) need nothing but Node. Browser
   suites (tests/ui/*.test.cjs) need Playwright's Chromium — see _browser.cjs. */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || "";
const suites = ["backend", "ui"].flatMap(dir =>
  readdirSync(path.join(here, dir))
    .filter(f => /\.test\.(mjs|cjs)$/.test(f))
    .map(f => path.join(dir, f)))
  .filter(f => f.includes(filter));

const failed = [];
for (const s of suites){
  console.log(`\n━━ ${s}`);
  const r = spawnSync(process.execPath, [path.join(here, s)], { stdio: "inherit" });
  if (r.status !== 0) failed.push(s);
}
console.log(`\n${suites.length - failed.length}/${suites.length} suites passed` +
            (failed.length ? ` — failed: ${failed.join(", ")}` : ""));
process.exit(failed.length ? 1 : 0);
