import { test, expect, Page } from '../fixtures/no-ai';

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
// Staff ID of the seeded HR login (scripts/ci/seed-dev.py HR_STAFF_ID).
// Names allow letters, spaces, hyphens and apostrophes only (no digits).
const FIRST_NAME = 'Robot';
const HR_STAFF_ID = process.env['E2E_HR_STAFF_ID'] ?? 'E2EHR01';

async function loginAsHR(page: Page): Promise<string> {
  await page.goto('/login');
  await page.locator('[data-testid="email"]').fill(HR_EMAIL);
  await page.locator('[data-testid="password-field"] input').fill(HR_PASSWORD);
  await page.locator('[data-testid="login-btn"] button').click();

  // HR staff land on the platform home (Epic 5). The onboarding dashboard
  // lives at /hr/:staffId and has no link from the home yet, so open it directly.
  await expect(page).toHaveURL(/\/platform\/home|\/hr\//, { timeout: 15_000 });
  await page.goto(`/hr/${HR_STAFF_ID}`);
  await expect(page).toHaveURL(new RegExp(`/hr/${HR_STAFF_ID}`), { timeout: 15_000 });
  return HR_STAFF_ID;
}

test.describe('HR Partner onboards a new employee', { tag: ['@onboard'] }, () => {
  test.skip(!HR_EMAIL || !HR_PASSWORD, 'E2E_HR_EMAIL / E2E_HR_PASSWORD not set — skipping');

  let uniqueEmail: string;
  let staffId: string;

  test.beforeEach(async ({ page }) => {
    // Run marker: scripts/ci/cleanup-dev-e2e.py deletes every record whose
    // email starts with "e2e.run-". Postmark's blackhole domain never delivers.
    uniqueEmail = `e2e.run-${process.env['GITHUB_RUN_ID'] ?? 'local'}-${Date.now()}@blackhole.postmarkapp.com`;
    staffId = await loginAsHR(page);
  });

  test('HR partner can navigate to new employee registration', { tag: ['@smoke'] }, async ({ page }) => {
    // Click the "New Hire" sidebar action button
    await page.locator('[data-testid="new-hire-btn"]').click();
    await expect(page).toHaveURL(/\/hr\/[A-Z0-9]+\/new-employee/, { timeout: 10_000 });
    await expect(page.locator('h2:has-text("Register New Employee")')).toBeVisible();
  });

  test('HR partner can complete step 1 — Personal Details', async ({ page }) => {
    await page.goto(`/hr/${staffId}/new-employee`);

    // Step 1: Personal Details
    await page.locator('[data-testid="first-name"]').fill(FIRST_NAME);
    await page.locator('[data-testid="last-name"]').fill('TestEmployee');
    await page.locator('[data-testid="email"]').fill(uniqueEmail);
    await page.locator('[data-testid="phone"]').fill('0812345678');

    // Proceed to step 2
    await page.locator('[data-testid="next-btn"] button').click();

    // Should now be on step 2 — Employment Details header visible
    await expect(page.locator('.step-card__badge', { hasText: 'Step 2 of 4' })).toBeVisible({ timeout: 5_000 });
  });

  test('HR partner can create and onboard a new employee (full journey)', async ({ page }) => {
    await page.goto(`/hr/${staffId}/new-employee`);

    // ── Step 1: Personal Details ──
    await page.locator('[data-testid="first-name"]').fill(FIRST_NAME);
    await page.locator('[data-testid="last-name"]').fill('TestEmployee');
    await page.locator('[data-testid="email"]').fill(uniqueEmail);
    await page.locator('[data-testid="phone"]').fill('0812345678');
    await page.locator('[data-testid="next-btn"] button').click();
    await expect(page.locator('.step-card__badge', { hasText: 'Step 2 of 4' })).toBeVisible({ timeout: 5_000 });

    // ── Step 2: Employment Details ──
    // Select a department via the p-select dropdown
    await page.locator('p-select[id="department"]').click();
    await page.locator('.p-select-option').first().click();

    // Pick offer accept date — use the input directly
    // Offer date must be today or earlier; start date must be in the future.
    const iso = (d: Date) => d.toISOString().split('T')[0]; // yyyy-mm-dd
    const today = new Date();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // Type key by key: the date picker only saves a typed date on key events,
    // so fill() shows the text but leaves the field empty and Next disabled.
    await page.locator('p-datepicker[id="offerDate"] input').pressSequentially(iso(today));
    await page.keyboard.press('Escape'); // close the date picker overlay
    await page.locator('p-datepicker[id="startDate"] input').pressSequentially(iso(tomorrow));
    await page.keyboard.press('Escape');

    await page.locator('[data-testid="next-btn"] button').click();
    await expect(page.locator('.step-card__badge', { hasText: 'Step 3 of 4' })).toBeVisible({ timeout: 5_000 });

    // ── Step 3: Document Upload (skip — no docs required) ──
    await page.locator('[data-testid="next-btn"] button').click();
    await expect(page.locator('[data-testid="register-btn"]')).toBeVisible({ timeout: 5_000 }); // review step

    // ── Step 4: Review & Submit ──
    await page.locator('[data-testid="register-btn"] button').click();

    // Success state
    await expect(page.locator('[data-testid="success-card"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="success-employee-name"]')).toContainText(`${FIRST_NAME} TestEmployee`);
    await expect(page.locator('[data-testid="success-employee-id"]')).toBeVisible();

    // Verify employee appears in dashboard list
    // Navigate back to HR home
    await page.locator('button:has-text("Back to Dashboard")').first().click();
    await expect(page).toHaveURL(/\/hr\/[A-Z0-9]+$/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="employee-list"]')).toContainText(`${FIRST_NAME} TestEmployee`);
  });
});
