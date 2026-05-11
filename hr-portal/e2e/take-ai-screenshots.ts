/**
 * Quick visual verification screenshots for AI Assistant panel changes.
 * Run: npx ts-node e2e/take-ai-screenshots.ts
 *      (or via: npx playwright test e2e/take-ai-screenshots.ts if adapted)
 */
import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.join(__dirname, '../.screenshots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── Login ────────────────────────────────────────────────────────────────
  await page.goto('http://localhost:4200', { waitUntil: 'networkidle' });
  // Fill login if required
  try {
    await page.fill('input[type="email"], input[name="email"]', 'lindiwe.khumalo@naleko.co.za');
    await page.fill('input[type="password"], input[name="password"]', 'Test@1234!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/hr/**', { timeout: 8000 });
  } catch {}

  // ── Screenshot 1: Dashboard with toggle button ─────────────────────────
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '01-dashboard-toggle-btn.png'), fullPage: false });
  console.log('✅ Screenshot 1: Dashboard + toggle button');

  // ── Screenshot 2: AI Assistant panel open (gallery) ────────────────────
  const toggleBtn = page.locator('.ai-mode-toggle-btn');
  await toggleBtn.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '02-ai-panel-gallery.png'), fullPage: false });
  console.log('✅ Screenshot 2: AI Assistant panel open (gallery)');

  // ── Screenshot 3: Close-up of header + first 2 cards ───────────────────
  const panel = page.locator('.ai-mode-drawer');
  await panel.screenshot({ path: path.join(OUT, '03-panel-header-close-up.png') });
  console.log('✅ Screenshot 3: Panel header + cards close-up');

  await browser.close();
  console.log(`\nScreenshots saved to: ${OUT}`);
})();
