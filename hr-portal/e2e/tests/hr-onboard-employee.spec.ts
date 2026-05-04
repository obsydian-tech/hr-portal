import { test, expect, Page } from '@playwright/test';

/**
 * Journey 1: HR Partner onboards a new employee
 *
 * This spec covers the full multi-step registration wizard:
 *   Step 1 — Personal Details (first name, last name, email, phone)
 *   Step 2 — Employment Details (department, start dates)
 *   Step 3 — Document Upload (skipped in this journey, documents added post-onboarding)
 *   Step 4 — Review & Submit → success state
 *
 * Env vars required:
 *   E2E_HR_EMAIL     — HR Partner ID or email (e.g. AS00001)
 *   E2E_HR_PASSWORD  — HR Partner password
 */

const HR_EMAIL = process.env['E2E_HR_EMAIL'] ?? '';
const HR_PASSWORD = process.env['E2E_HR_PASSWORD'] ?? '';

async function loginAsHR(page: Page): Promise<string> {
  await page.goto('/login');
  await page.locator('[data-testid="email"]').fill(HR_EMAIL);
  await page.locator('[data-testid="password-field"] input').fill(HR_PASSWORD);
  await page.locator('[data-testid="login-btn"] button').click();

  // HR dashboard URL is /hr/:staffId — wait for navigation
  await expect(page).toHaveURL(/\/hr\/[A-Z0-9]+/, { timeout: 15_000 });

  // Return the staffId from the URL for constructing child routes
  const url = page.url();
  const match = url.match(/\/hr\/([^/]+)/);
  return match ? match[1] : '';
}

test.describe('HR Partner onboards a new employee', () => {
  test.skip(!HR_EMAIL || !HR_PASSWORD, 'E2E_HR_EMAIL / E2E_HR_PASSWORD not set — skipping');

  let uniqueEmail: string;
  let staffId: string;

  test.beforeEach(async ({ page }) => {
    uniqueEmail = `e2e.test+${Date.now()}@naleko.co.za`;
    staffId = await loginAsHR(page);
  });

  test('HR partner can navigate to new employee registration', async ({ page }) => {
    // Click the "New Hire" sidebar action button
    await page.locator('[data-testid="new-hire-btn"]').click();
    await expect(page).toHaveURL(/\/hr\/[A-Z0-9]+\/new-employee/, { timeout: 10_000 });
    await expect(page.locator('h2:has-text("Register New Employee")')).toBeVisible();
  });

  test('HR partner can complete step 1 — Personal Details', async ({ page }) => {
    await page.goto(`/hr/${staffId}/new-employee`);

    // Step 1: Personal Details
    await page.locator('[data-testid="first-name"]').fill('E2E');
    await page.locator('[data-testid="last-name"]').fill('TestEmployee');
    await page.locator('[data-testid="email"]').fill(uniqueEmail);
    await page.locator('[data-testid="phone"]').fill('0812345678');

    // Proceed to step 2
    await page.locator('[data-testid="next-btn"] button').click();

    // Should now be on step 2 — Employment Details header visible
    await expect(page.locator('text=Employment Details')).toBeVisible({ timeout: 5_000 });
  });

  test('HR partner can create and onboard a new employee (full journey)', async ({ page }) => {
    await page.goto(`/hr/${staffId}/new-employee`);

    // ── Step 1: Personal Details ──
    await page.locator('[data-testid="first-name"]').fill('E2E');
    await page.locator('[data-testid="last-name"]').fill('TestEmployee');
    await page.locator('[data-testid="email"]').fill(uniqueEmail);
    await page.locator('[data-testid="phone"]').fill('0812345678');
    await page.locator('[data-testid="next-btn"] button').click();
    await expect(page.locator('text=Employment Details')).toBeVisible({ timeout: 5_000 });

    // ── Step 2: Employment Details ──
    // Select a department via the p-select dropdown
    await page.locator('p-select[id="department"]').click();
    await page.locator('.p-select-option').first().click();

    // Pick offer accept date — use the input directly
    const today = new Date().toISOString().split('T')[0]; // yyyy-mm-dd
    await page.locator('p-datepicker[id="offerDate"] input').fill(today);
    await page.locator('p-datepicker[id="startDate"] input').fill(today);
    await page.keyboard.press('Escape'); // close any open datepicker overlay

    await page.locator('[data-testid="next-btn"] button').click();
    await expect(page.locator('text=Document Upload')).toBeVisible({ timeout: 5_000 });

    // ── Step 3: Document Upload (skip — no docs required) ──
    await page.locator('[data-testid="next-btn"] button').click();
    await expect(page.locator('text=Personal Details')).toBeVisible({ timeout: 5_000 }); // review step header

    // ── Step 4: Review & Submit ──
    await page.locator('[data-testid="register-btn"] button').click();

    // Success state
    await expect(page.locator('[data-testid="success-card"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="success-employee-name"]')).toContainText('E2E TestEmployee');
    await expect(page.locator('[data-testid="success-employee-id"]')).toBeVisible();

    // Verify employee appears in dashboard list
    // Navigate back to HR home
    await page.locator('button:has-text("Back to Dashboard")').click();
    await expect(page).toHaveURL(/\/hr\/[A-Z0-9]+$/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="employee-list"]')).toContainText('E2E TestEmployee');
  });
});
