// Exports one PNG per experiment (E1–E7) for the deck, by screenshotting the figures on /simulate.
// The figures are drawn from web/public/results/*.json, so the deck and the site show the same numbers.
//
// Usage (from web/):  npm run build && npx next start -p 3100   (in another terminal), then
//                     npm run charts --  [--url http://localhost:3100] [--out public/results/charts]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const base = opt("--url", "http://localhost:3100");
const out = opt("--out", join("public", "results", "charts"));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce", colorScheme: "light" });
await page.goto(`${base}/simulate`, { waitUntil: "networkidle" });
for (const id of ["E1", "E2", "E3", "E4", "E5", "E6", "E7"]) {
  const fig = page.locator(`[data-experiment="${id}"]`);
  await fig.scrollIntoViewIfNeeded();
  await fig.locator(".recharts-surface").first().waitFor();
  const file = join(out, `${id.toLowerCase()}.png`);
  await fig.screenshot({ path: file });
  console.log(`wrote ${file}`);
}
await browser.close();
