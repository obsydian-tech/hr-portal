import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for Naleko HR Portal.
 *
 * Local:   BASE_URL defaults to http://localhost:4200 (ng serve)
 * CI/Staging: set E2E_BASE_URL env var to the staging CloudFront URL
 *
 * Required env vars:
 *   E2E_HR_EMAIL      — HR Partner login identifier (e.g. AS00001)
 *   E2E_HR_PASSWORD   — HR Partner password
 *   E2E_EMP_EMAIL     — Employee login identifier (e.g. EMP-0000001)
 *   E2E_EMP_PASSWORD  — Employee password
 */
export default defineConfig({
  testDir: './e2e/tests',
  timeout: 60_000,
  retries: process.env['CI'] ? 1 : 0,
  workers: 1, // Sequential — Cognito rate-limit friendly
  fullyParallel: false,

  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4200',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    headless: true,
  },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e/reports', open: 'never' }],
  ],

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
