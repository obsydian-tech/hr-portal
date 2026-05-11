const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '../.screenshots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('http://localhost:4200', { waitUntil: 'networkidle', timeout: 15000 });

  // Attempt login if on auth page
  try {
    const emailInput = await page.$('input[type="email"], input[formcontrolname="email"]');
    if (emailInput) {
      await page.fill('input[type="email"], input[formcontrolname="email"]', 'lindiwe.khumalo@naleko.co.za');
      await page.fill('input[type="password"], input[formcontrolname="password"]', 'Test@1234!');
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);
      await page.waitForLoadState('networkidle');
    }
  } catch (e) { console.log('Login step skipped:', e.message); }

  await page.waitForTimeout(1000);

  // Screenshot 1: Dashboard with AI Assistant toggle button visible
  await page.screenshot({ path: path.join(OUT, '01-dashboard-toggle-btn.png') });
  console.log('✅ 01-dashboard-toggle-btn.png');

  // Click the AI Assistant toggle
  try {
    await page.click('.ai-mode-toggle-btn', { timeout: 5000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, '02-ai-panel-open.png') });
    console.log('✅ 02-ai-panel-open.png');

    // Close-up of the panel
    const panel = await page.$('.p-drawer');
    if (panel) {
      await panel.screenshot({ path: path.join(OUT, '03-panel-closeup.png') });
      console.log('✅ 03-panel-closeup.png');
    }
  } catch (e) { console.log('Panel open step failed:', e.message); }

  await browser.close();
  console.log(`\nDone. Files in: ${OUT}`);
})();
