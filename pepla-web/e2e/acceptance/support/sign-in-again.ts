import type { Page } from '@playwright/test';
import { expectNoSession } from './fixtures';

/** A page at the app's own address that is not the app: nothing starts that could write a session back. */
const BLANK = '/__acceptance-blank';

/**
 * ONB-23.1: forget the first sign-in before a test signs in as someone else.
 *
 * Since ONB-23 an employee's session is kept, the same as HR's, so a signed-in person who opens
 * /sign-in is sent on to their own page and the Email field never shows. A test that signs in
 * twice (the employee, then HR) calls this between the two, and the browser is then like a new
 * one: no cookies, and nothing in local or session storage for the app's address.
 *
 * The app keeps its Cognito session in local storage, which about:blank cannot reach, so the
 * clearing happens on a blank page served at the app's own address. The app itself never loads
 * there. It ends on about:blank, as these tests did before.
 */
export async function forgetSignIn(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.route(`**${BLANK}`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }));
  try {
    await page.goto(BLANK);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await expectNoSession(page);
  } finally {
    await page.unroute(`**${BLANK}`);
  }
  await page.goto('about:blank');
}
