import { test, expect, Page } from '../fixtures/no-ai';

/**
 * TalentFlow quick checks (old app).
 *
 * The new app replaces TalentFlow with a simpler Hire module, so the old one
 * only keeps two checks: HR can open it, and the candidate list loads. Full
 * Hire journeys are written against the new app.
 *
 * Adding a candidate is no longer checked here: the old Add Candidate drawer
 * posts the old body, which POST /v1/candidates no longer accepts (REC-15 step
 * B). Adding one is judged by rec-ui-02-add.spec.ts AC-17 @pepla-dev (a real
 * add in the new app, with company B unable to see it), and moving one stage
 * by rec-ui-01.spec.ts AC-13 @pepla-dev.
 *
 * Env vars: E2E_HR_EMAIL, E2E_HR_PASSWORD (the HR login is in
 * naleko-talentflow-hr, which opens TalentFlow).
 */

const HR_EMAIL = process.env['E2E_HR_EMAIL'] ?? '';
const HR_PASSWORD = process.env['E2E_HR_PASSWORD'] ?? '';

async function loginAsHR(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('[data-testid="email"]').fill(HR_EMAIL);
  await page.locator('[data-testid="password-field"] input').fill(HR_PASSWORD);
  await page.locator('[data-testid="login-btn"] button').click();
  await expect(page).toHaveURL(/\/platform\/home|\/hr\//, { timeout: 15_000 });
}

test.describe('TalentFlow quick checks', { tag: ['@hire'] }, () => {
  test.skip(!HR_EMAIL || !HR_PASSWORD, 'E2E_HR_EMAIL / E2E_HR_PASSWORD not set — skipping');

  test.beforeEach(async ({ page }) => {
    await loginAsHR(page);
  });

  test('HR can open TalentFlow', { tag: ['@smoke'] }, async ({ page }) => {
    await page.goto('/platform/talentflow');
    // A login without TalentFlow access is sent back to /platform/home?locked=talentflow.
    await expect(page).toHaveURL(/\/platform\/talentflow/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Add Candidate' })).toBeVisible({ timeout: 15_000 });
  });

  test('Candidate list loads', async ({ page }) => {
    await page.goto('/platform/talentflow/candidates');
    await expect(page.getByRole('heading', { level: 1, name: 'Candidates' })).toBeVisible({ timeout: 15_000 });
  });
});
