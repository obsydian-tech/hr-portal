import { defineConfig } from '@playwright/test';

/**
 * Journey tests for the new app.
 *
 *   npm run e2e         normal run: checks the journeys, fast, no pictures
 *   npm run e2e:help    help mode (HELP_SHOTS=1): same journeys, slowed down,
 *                       saves help pictures and walkthrough videos into
 *                       help/media/<desktop|phone>/
 *
 * Help pictures only ever show the fixed fake company in
 * e2e/fixtures/help-company.ts. Nothing here calls an AI service.
 */
const HELP = process.env['HELP_SHOTS'] === '1';
const PORT = 4300;

export default defineConfig({
  testDir: './journeys',
  testMatch: '**/*.e2e.ts', // not *.spec.ts: those are unit tests
  outputDir: './.output',
  timeout: HELP ? 180_000 : 60_000,
  retries: process.env['CI'] && !HELP ? 1 : 0,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? `http://localhost:${PORT}`,
    locale: 'en-ZA',
    timezoneId: 'Africa/Johannesburg',
    colorScheme: 'light',
    screenshot: HELP ? 'off' : 'only-on-failure',
    trace: HELP ? 'off' : 'retain-on-failure',
    // Help mode records every journey; normal runs keep video only on failure.
    video: HELP ? 'on' : 'retain-on-failure',
    // Slow enough to follow on the walkthrough video.
    launchOptions: { slowMo: HELP ? 300 : 0 },
  },

  projects: [
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, video: HELP ? { mode: 'on', size: { width: 1440, height: 900 } } : 'retain-on-failure' },
    },
    {
      name: 'phone',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        video: HELP ? { mode: 'on', size: { width: 390, height: 844 } } : 'retain-on-failure',
      },
    },
  ],

  webServer: process.env['E2E_BASE_URL']
    ? undefined
    : { command: `npx ng serve --port ${PORT}`, url: `http://localhost:${PORT}`, reuseExistingServer: !process.env['CI'], timeout: 180_000 },
});
