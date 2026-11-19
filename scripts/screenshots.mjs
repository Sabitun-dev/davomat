// Design review: builds the app with demo data, then screenshots every main screen
// in light and dark at 360 and 414 px wide. Output: screenshots/ (not committed).
//   npm run screenshots            all screens
//   npm run screenshots -- worker  only shots whose name contains "worker"

import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";

const root = process.cwd();
const out = join(tmpdir(), "davomat-mock-build");
const shotsDir = join(root, "screenshots");
mkdirSync(shotsDir, { recursive: true });

console.log("Building demo app…");
execSync("npx vite build --config webapp/vite.config.ts --logLevel warn", {
  stdio: "inherit",
  env: { ...process.env, VITE_MOCK: "1", VITE_OUT_DIR: out },
});

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/app\/?/, "");
  let file = join(out, path);
  if (!path || !existsSync(file) || statSync(file).isDirectory()) file = join(out, "index.html");
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(4789);

const shots = [
  ["01-consent", "s=consent"],
  ["02-phone", "s=phone"],
  ["03-name", "s=name"],
  ["04-intro", "s=intro"],
  ["10-worker-home", "s=worker"],
  ["11-worker-working", "s=worker-working"],
  ["12-worker-break", "s=worker-break"],
  ["13-worker-finished", "s=worker-finished"],
  ["14-worker-success", "s=worker&screen=scan&p=" + encodeURIComponent('{"eventType":"CHECK_IN"}')],
  ["15-worker-success-late", "s=worker-late&screen=scan&p=" + encodeURIComponent('{"eventType":"CHECK_IN"}')],
  ["16-worker-fail-far", "s=worker-fail-far&screen=scan&p=" + encodeURIComponent('{"eventType":"CHECK_IN"}')],
  ["17-worker-fail-location", "s=worker-fail-location&screen=scan&p=" + encodeURIComponent('{"eventType":"CHECK_IN"}')],
  ["18-worker-month", "s=worker&screen=month"],
  ["19-worker-history", "s=worker&screen=history"],
  ["20-worker-day", "s=worker&screen=day&p=" + encodeURIComponent(JSON.stringify({ date: `${new Date().toISOString().slice(0, 8)}16` }))],
  ["30-admin-today", "s=admin", "today"],
  ["31-admin-branches", "s=admin", "branches"],
  ["32-admin-branch-workers", "s=admin&screen=branch&p=" + encodeURIComponent('{"id":1}')],
  ["33-admin-branch-qr", "s=admin&screen=branch&p=" + encodeURIComponent('{"id":1,"tab":"qr"}')],
  ["34-admin-branch-invites", "s=admin&screen=branch&p=" + encodeURIComponent('{"id":1,"tab":"invites"}')],
  ["35-admin-branch-settings", "s=admin&screen=branch&p=" + encodeURIComponent('{"id":1,"tab":"settings"}')],
  ["36-admin-branch-editor", "s=admin&screen=branchEditor"],
  ["37-admin-schedule", "s=admin&screen=schedule&p=" + encodeURIComponent('{"branchId":1}')],
  ["38-admin-amounts", "s=admin&screen=amounts&p=" + encodeURIComponent('{"branchId":1}')],
  ["39-admin-reports", "s=admin", "reports"],
  ["40-admin-review", "s=admin&screen=review"],
  ["41-admin-worker-report", "s=admin&screen=workerReport&p=" + encodeURIComponent('{"userId":1,"name":"Ali Valiyev"}')],
  ["42-admin-company", "s=admin&screen=company"],
  ["43-admin-more", "s=admin", "more"],
  ["44-admin-year", "s=admin", "reports", "year"],
];
const filter = process.argv[2];
const exe = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true });
let count = 0;
for (const [name, query, tab, extra] of shots) {
  if (filter && !name.includes(filter)) continue;
  for (const width of [360, 414]) {
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({
        viewport: { width, height: 800 },
        deviceScaleFactor: 2,
        colorScheme: scheme,
        geolocation: { latitude: 41.2856, longitude: 69.2034, accuracy: 9 },
        permissions: ["geolocation"],
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      if (tab) await page.addInitScript((t) => sessionStorage.setItem("adminTab", t), tab);
      await page.goto(`http://localhost:4789/app/?${query}`);
      await page.waitForTimeout(1200);
      if (extra === "year") {
        await page.getByRole("tab").nth(1).click();
        await page.waitForTimeout(1200);
      }
      await page.screenshot({ path: join(shotsDir, `${name}-${width}-${scheme}.png`), fullPage: true });
      await ctx.close();
      count++;
    }
  }
}
await browser.close();
server.close();
console.log(`Saved ${count} screenshots to ${shotsDir}`);
