import { defineConfig } from '@playwright/test';

/**
 * Acceptance tests: one test per acceptance criterion of a card, written from
 * the card before the code, and locked once Iggie accepts them (README.md).
 *
 *   npm run e2e:acceptance                      no-backend run, every criterion
 *   ACCEPTANCE_TARGET=pepla-dev \
 *     E2E_HR_EMAIL=... E2E_HR_PASSWORD=... \
 *     E2E_EMP_EMAIL=... E2E_EMP_PASSWORD=... \
 *     npm run e2e:acceptance                    pepla-dev run, @pepla-dev tests only
 *
 * Every criterion is checked at 1280 and 390 wide. Nothing here calls an AI service.
 */
const PORT = 4310;
const ON_DEV = process.env['ACCEPTANCE_TARGET'] === 'pepla-dev';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: './.output',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0, // an acceptance test passes first time or it fails
  workers: 1,
  reporter: process.env['CI']
    ? [['list'], ['json', { outputFile: './.output/results.json' }]]
    : [['list']],
  grep: ON_DEV ? /@pepla-dev/ : undefined,

  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? `http://localhost:${PORT}`,
    locale: 'en-ZA',
    timezoneId: 'Africa/Johannesburg',
    colorScheme: 'light',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'desktop-1280', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    {
      name: 'phone-390',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],

  webServer: process.env['E2E_BASE_URL']
    ? undefined
    : {
        command: `npx ng serve --port ${PORT}`,
        cwd: '../..',
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env['CI'],
        timeout: 180_000,
      },
});
