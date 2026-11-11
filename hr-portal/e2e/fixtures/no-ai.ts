import { test as base, expect } from '@playwright/test';

/**
 * AI cost guardrail for E2E: the browser never reaches an AI endpoint.
 *
 * Every request to a route that can call Bedrock or Textract is answered
 * here with a labelled stand-in, so a test run costs nothing even if the
 * backend switch were wrong. Every spec imports `test` from this file.
 */
const AI_ROUTES = [
  /\/agent\/v1\/ai-chat(\?|$)/,
  /\/agent\/v1\/talentflow\/chat(\?|$)/,
  /\/agent\/v1\/chat(\?|$)/,
  /\/verifications\/[^/]+\/summary(\?|$)/,
  /\/employees\/risk-report(\?|$)/,
  /\/employees\/[^/]+\/assess-risk(\?|$)/,
];

export const AI_STAND_IN = 'AI is switched off in tests (cost guardrail).';

export const test = base.extend<{ blockAi: void }>({
  blockAi: [async ({ context }, use) => {
    await context.route((url) => AI_ROUTES.some((r) => r.test(url.pathname)), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: AI_STAND_IN, summary: AI_STAND_IN, status: 'AI_DISABLED',
                               risk: 'UNKNOWN', reason: AI_STAND_IN, high: [], medium: [], low: [], no_data: [] }),
      }));
    await use();
  }, { auto: true }],
});

export { expect };
export type { Page } from '@playwright/test';
