const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '../.screenshots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── Step 1: Go directly to login page ──────────────────────────────────
  await page.goto('http://localhost:4200/login', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(500);
  console.log('Initial URL:', page.url());

  // ── Step 2: Login ────────────────────────────────────────────────────────
  try {
    await page.waitForSelector('[data-testid="email"]', { timeout: 8000 });
    await page.locator('[data-testid="email"]').fill('Lindiwe.Khumalo@gcu.co.za');
    await page.locator('[data-testid="password-field"] input').fill('Naleko@2026#Dev');
    await page.locator('[data-testid="login-btn"] button').click();
    // Wait for auth guard to land on HR dashboard
    await page.waitForURL(/\/hr\//, { timeout: 15000 });
    console.log('Logged in. URL:', page.url());
  } catch (e) {
    console.log('Login step failed:', e.message);
    await page.screenshot({ path: path.join(OUT, 'debug-login-failure.png') });
  }

  // ── Step 3: Navigate to HR home if not already there ────────────────────
  if (!page.url().includes('/hr/') && !page.url().includes('/hr')) {
    await page.goto('http://localhost:4200/hr/AS00004', { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    console.log('Dashboard URL:', page.url());
  }

  // Screenshot 1: Dashboard — toggle button prominently visible top-right
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '01-dashboard-toggle.png') });
  console.log('✅ 01-dashboard-toggle.png saved');

  // Screenshot 2: Open AI Assistant panel
  try {
    await page.waitForSelector('.ai-mode-toggle-btn', { timeout: 8000 });
    // Scroll to toggle button and capture it in isolation
    const toggleEl = await page.$('.ai-mode-toggle-btn');
    if (toggleEl) {
      await toggleEl.screenshot({ path: path.join(OUT, '02-toggle-btn-closeup.png') });
      console.log('✅ 02-toggle-btn-closeup.png saved');
    }
    await page.click('.ai-mode-toggle-btn');
    // Wait for PrimeNG drawer animation
    await page.waitForSelector('.p-drawer', { timeout: 5000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, '03-panel-open.png') });
    console.log('✅ 03-panel-open.png saved');

    // Screenshot 4: Panel only (close-up)
    const panelEl = await page.$('.p-drawer');
    if (panelEl) {
      await panelEl.screenshot({ path: path.join(OUT, '04-panel-closeup.png') });
      console.log('✅ 04-panel-closeup.png saved');
    }

    // Screenshot 5: Gallery card grid close-up
    const galleryEl = await page.$('.ai-gallery');
    if (galleryEl) {
      await galleryEl.screenshot({ path: path.join(OUT, '05-card-grid-closeup.png') });
      console.log('✅ 05-card-grid-closeup.png saved');
    }
  } catch (e) {
    console.log('❌ Panel step failed:', e.message);
    await page.screenshot({ path: path.join(OUT, 'error-state.png') });
  }

  await browser.close();
  console.log('\nAll screenshots saved to:', OUT);
})();
