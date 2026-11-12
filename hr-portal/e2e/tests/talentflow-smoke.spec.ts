import { test, expect, Page } from '../fixtures/no-ai';

/**
 * TalentFlow quick checks (old app).
 *
 * The new app replaces TalentFlow with a simpler Hire module, so the old one
 * only gets these three checks: HR can open it, the candidate list loads, and
 * a candidate can be added and moved one stage. Full Hire journeys are written
 * against the new app.
 *
 * The candidate's email carries the run marker, so it counts as test data
 * (no AI, see lambda/shared/ai-guard.mjs) and scripts/ci/cleanup-dev-e2e.py
 * deletes it after the run.
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

test.describe('TalentFlow quick checks', () => {
  test.skip(!HR_EMAIL || !HR_PASSWORD, 'E2E_HR_EMAIL / E2E_HR_PASSWORD not set — skipping');

  test.beforeEach(async ({ page }) => {
    await loginAsHR(page);
  });

  test('HR can open TalentFlow', async ({ page }) => {
    await page.goto('/platform/talentflow');
    // A login without TalentFlow access is sent back to /platform/home?locked=talentflow.
    await expect(page).toHaveURL(/\/platform\/talentflow/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Add Candidate' })).toBeVisible({ timeout: 15_000 });
  });

  test('Candidate list loads', async ({ page }) => {
    await page.goto('/platform/talentflow/candidates');
    await expect(page.getByRole('heading', { level: 1, name: 'Candidates' })).toBeVisible({ timeout: 15_000 });
  });

  test('HR adds a candidate and moves them one stage', async ({ page }) => {
    const email = `e2e.run-${process.env['GITHUB_RUN_ID'] ?? 'local'}-${Date.now()}@blackhole.postmarkapp.com`;

    await page.goto('/platform/talentflow');
    await page.getByRole('button', { name: 'Add Candidate' }).click();

    await page.locator('#cr-firstName').fill('Robot');
    await page.locator('#cr-lastName').fill('Candidate');
    await page.locator('#cr-email').fill(email);
    await page.locator('#cr-role').fill('Junior baker');
    await page.getByRole('button', { name: /^Junior/ }).click();
    await page.getByRole('button', { name: /Create Candidate/ }).click();

    // The shell opens the new candidate's workspace.
    await expect(page).toHaveURL(/\/platform\/talentflow\/candidates\/CAND-/, { timeout: 20_000 });

    const advance = page.getByRole('button', { name: /^Advance to / }).first();
    await expect(advance).toBeVisible({ timeout: 15_000 });
    await advance.click();
    await expect(page.getByText(/Stage advanced to/)).toBeVisible({ timeout: 15_000 });
  });
});
