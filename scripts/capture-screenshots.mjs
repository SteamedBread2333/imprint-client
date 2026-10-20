import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "assets/screenshots");

const pages = [
  { file: "preview-dashboard.html", out: "dashboard.png", width: 1100, height: 900, fullPage: true },
  { file: "preview-embed.html", out: "embed-wizard.png", width: 1100, height: 820, fullPage: false },
  { file: "preview-settings.html", out: "settings.png", width: 1100, height: 720, fullPage: false },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
for (const p of pages) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: p.width, height: p.height });
  await page.goto(`file://${path.join(root, "scripts/previews", p.file)}`);
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(outDir, p.out),
    fullPage: Boolean(p.fullPage),
  });
  await page.close();
}
await browser.close();
console.log("Wrote screenshots to", outDir);
