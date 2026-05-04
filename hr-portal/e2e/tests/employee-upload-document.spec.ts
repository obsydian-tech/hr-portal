import { test, expect, Page } from '@playwright/test';
import path from 'path';

/**
 * Journey 2: New Employee uploads ID document
 *
 * This spec covers the employee self-service document upload flow:
 *   1. Login as new employee
 *   2. Navigate to employee dashboard (/employees/:employeeId)
 *   3. Locate the ID Document card (doc-card-ID_DOCUMENT)
 *   4. Upload a test PDF fixture via the hidden file input
 *   5. Assert upload progress spinner appears
 *   6. Assert upload success state is visible within timeout
 *
 * Env vars required:
 *   E2E_EMP_EMAIL     — Employee identifier (e.g. EMP-0000001)
 *   E2E_EMP_PASSWORD  — Employee password
 */

const EMP_EMAIL = process.env['E2E_EMP_EMAIL'] ?? '';
const EMP_PASSWORD = process.env['E2E_EMP_PASSWORD'] ?? '';

const TEST_PDF_PATH = path.join(__dirname, '../fixtures/test-id.pdf');

async function loginAsEmployee(page: Page): Promise<string> {
  await page.goto('/login');
  await page.locator('[data-testid="email"]').fill(EMP_EMAIL);
  await page.locator('[data-testid="password-field"] input').fill(EMP_PASSWORD);
  await page.locator('[data-testid="login-btn"] button').click();

  // Employee dashboard URL is /employees/:employeeId
  await expect(page).toHaveURL(/\/employees\/[A-Z0-9-]+/, { timeout: 15_000 });

  const url = page.url();
  const match = url.match(/\/employees\/([^/]+)/);
  return match ? match[1] : '';
}

test.describe('New employee uploads ID document', () => {
  test.skip(!EMP_EMAIL || !EMP_PASSWORD, 'E2E_EMP_EMAIL / E2E_EMP_PASSWORD not set — skipping');

  let employeeId: string;

  test.beforeEach(async ({ page }) => {
    employeeId = await loginAsEmployee(page);
  });

  test('Employee dashboard loads and document checklist is visible', async ({ page }) => {
    await expect(page).toHaveURL(/\/employees\//, { timeout: 10_000 });
    // Document checklist section should be present
    await expect(page.locator('text=Upload Your Documents')).toBeVisible({ timeout: 10_000 });
  });

  test('New employee can upload ID document', async ({ page }) => {
    // Locate the ID document card
    const idDocCard = page.locator('[data-testid="doc-card-ID_DOCUMENT"]');
    await expect(idDocCard).toBeVisible({ timeout: 10_000 });

    // The hidden file input within this card
    const fileInput = idDocCard.locator('[data-testid="document-input"]');
    await expect(fileInput).toBeAttached();

    // Upload the test PDF fixture by setting input files directly
    await fileInput.setInputFiles(TEST_PDF_PATH);

    // Upload progress indicator should appear near immediately
    await expect(idDocCard.locator('[data-testid="upload-progress"]')).toBeVisible({ timeout: 5_000 });

    // Wait for upload + OCR to complete — 30s timeout for network round-trip
    await expect(idDocCard.locator('[data-testid="upload-success"]')).toBeVisible({ timeout: 30_000 });
  });

  test('ID document appears in list after successful upload', async ({ page }) => {
    // After a successful upload, the card should show the verified extracted fields
    // and NOT show the dropzone anymore.
    const idDocCard = page.locator('[data-testid="doc-card-ID_DOCUMENT"]');
    await expect(idDocCard).toBeVisible({ timeout: 10_000 });

    // If already uploaded in a previous run, success state should be immediately visible
    const alreadyUploaded = await idDocCard.locator('[data-testid="upload-success"]').isVisible();
    if (!alreadyUploaded) {
      const fileInput = idDocCard.locator('[data-testid="document-input"]');
      await fileInput.setInputFiles(TEST_PDF_PATH);
      await expect(idDocCard.locator('[data-testid="upload-success"]')).toBeVisible({ timeout: 30_000 });
    }

    // No raw dropzone should remain
    await expect(idDocCard.locator('.doc-card__dropzone')).not.toBeVisible();
  });
});
