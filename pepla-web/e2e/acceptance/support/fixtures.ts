import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { CognitoFake, type FakeAccount } from './cognito-fake';

/**
 * Shared set-up for acceptance tests.
 *
 * Two targets, picked by ACCEPTANCE_TARGET:
 *   (unset)     no-backend run: the app is served locally and Cognito is the
 *               fake in cognito-fake.ts. Every criterion runs here.
 *   pepla-dev   the app is served locally against pepla-dev, with the seeded
 *               test logins (E2E_HR_EMAIL / _PASSWORD, E2E_EMP_EMAIL / _PASSWORD,
 *               from Secrets Manager pepla-dev/e2e/{hr,employee}). Only tests
 *               tagged @pepla-dev run.
 *
 * AI cost guardrail: every request to an AI route or an AWS AI service is
 * refused in the browser, in both targets. No test calls Bedrock or any paid AI.
 */

export const TARGET = process.env['ACCEPTANCE_TARGET'] === 'pepla-dev' ? 'pepla-dev' : 'no-backend';
export const ON_DEV = TARGET === 'pepla-dev';

export type Login = { email: string; password: string; givenName: string };

/** The people in the no-backend run. Names follow the product's demo names. */
export const FAKE = {
  hr: { email: 'jane.smith@mokoena-logistics.co.za', givenName: 'Jane', familyName: 'Smith', groups: ['hr_staff'] },
  employee: { email: 'john.doe@mokoena-logistics.co.za', givenName: 'John', familyName: 'Doe', groups: ['employee'] },
  newHr: {
    email: 'thabo.nkosi@mokoena-logistics.co.za',
    givenName: 'Thabo',
    familyName: 'Nkosi',
    groups: ['hr_staff'],
    newPasswordRequired: true,
  },
} satisfies Record<string, FakeAccount>;

const FAKE_PASSWORD = 'winter-protea-2026';

function devLogin(prefix: 'E2E_HR' | 'E2E_EMP', givenName: string): Login {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) throw new Error(`${prefix}_EMAIL and ${prefix}_PASSWORD must be set for the pepla-dev run.`);
  return { email, password, givenName };
}

/** HR home (ONB-01 in scope item 4). */
export const HR_HOME = '/hr';
export const SIGN_IN = '/sign-in';
export const ON_SIGN_IN = /\/sign-in(\?.*)?$/;

const AI_URLS = [
  /\/agent\/v1\//,
  /\/verifications\/[^/]+\/summary/,
  /\/employees\/risk-report/,
  /\/employees\/[^/]+\/assess-risk/,
  /^https:\/\/bedrock[a-z-]*\.[a-z0-9-]+\.amazonaws\.com\//,
  /^https:\/\/textract\.[a-z0-9-]+\.amazonaws\.com\//,
];

type Fixtures = {
  blockAi: void;
  cognito: CognitoFake | null;
  hr: Login;
  employee: Login;
  newHr: Login;
  signIn: SignInPage;
};

export const test = base.extend<Fixtures>({
  blockAi: [
    async ({ context }, use) => {
      await context.route((url) => AI_URLS.some((r) => r.test(url.href)), (route) => route.abort('blockedbyclient'));
      await use();
    },
    { auto: true },
  ],

  cognito: async ({ context }, use) => {
    if (ON_DEV) return use(null);
    const fake = new CognitoFake(Object.values(FAKE));
    await fake.install(context);
    await use(fake);
  },

  hr: async ({}, use) => {
    await use(ON_DEV ? devLogin('E2E_HR', process.env['E2E_HR_GIVEN_NAME'] ?? 'Thandi') : { ...FAKE.hr, password: FAKE_PASSWORD });
  },
  employee: async ({}, use) => {
    await use(ON_DEV ? devLogin('E2E_EMP', process.env['E2E_EMP_GIVEN_NAME'] ?? 'Sipho') : { ...FAKE.employee, password: FAKE_PASSWORD });
  },
  newHr: async ({}, use) => {
    await use({ ...FAKE.newHr, password: FAKE_PASSWORD });
  },

  // Depends on `cognito` so the fake is in place before the first page load.
  signIn: async ({ page, cognito }, use) => {
    void cognito;
    await use(new SignInPage(page));
  },
});

export { expect };

/** The sign-in page, found the way a person finds it: by its words. */
export class SignInPage {
  readonly mark: Locator;
  readonly heading: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly forgot: Locator;

  constructor(readonly page: Page) {
    this.mark = page.getByText('Naleko People', { exact: true }).or(page.getByRole('img', { name: /Naleko People/ })).first();
    this.heading = page.getByRole('heading', { name: 'Sign in', exact: true });
    this.email = page.getByLabel('Work email', { exact: true });
    this.password = page.getByLabel('Password', { exact: true });
    this.submit = page.getByRole('button', { name: 'Sign in', exact: true });
    this.forgot = page.getByText(/Forgot your password\?\s*Your Admin can send you a new link\./);
  }

  async open(): Promise<void> {
    await this.page.goto(SIGN_IN);
    await expect(this.email).toBeVisible();
  }

  async fill(login: { email: string; password: string }): Promise<void> {
    await this.email.fill(login.email);
    await this.password.fill(login.password);
  }

  async signInAs(login: { email: string; password: string }): Promise<void> {
    await this.fill(login);
    await this.submit.click();
  }

  /** A message on the page, matched exactly. */
  message(text: string): Locator {
    return this.page.getByText(text, { exact: true });
  }
}

/** The account menu in the HR shell (ONB-01 in scope item 7). */
export function avatarButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Your account/ });
}

const JWT = /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*/;

/** No sign-in token is kept anywhere the browser stores it. */
export async function expectNoSession(page: Page): Promise<void> {
  const stored = await page.evaluate(() => {
    const values: string[] = [];
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length; i++) values.push(store.getItem(store.key(i) ?? '') ?? '');
    }
    return values;
  });
  expect(stored.filter((v) => JWT.test(v)), 'no token in local or session storage').toEqual([]);
  const cookies = await page.context().cookies();
  expect(cookies.filter((c) => JWT.test(c.value)).map((c) => c.name), 'no token in cookies').toEqual([]);
}

/**
 * The element holding `text` is announced: it sits in a live region
 * (role alert or status, or aria-live), or it describes the field it belongs to.
 */
export async function expectAnnounced(page: Page, text: string, field?: Locator): Promise<void> {
  const el = page.getByText(text, { exact: true });
  await expect(el).toBeVisible();
  const live = await el.evaluate((node) => {
    for (let n: Element | null = node as Element; n; n = n.parentElement) {
      const role = n.getAttribute('role');
      const ariaLive = n.getAttribute('aria-live');
      if (role === 'alert' || role === 'status' || ariaLive === 'polite' || ariaLive === 'assertive') return true;
    }
    return false;
  });
  if (live) return;
  if (field) {
    await expect(field, `"${text}" is not in a live region, so the field must be described by it`).toHaveAccessibleDescription(
      new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    return;
  }
  throw new Error(`"${text}" is not announced: it is not inside role=alert, role=status or an aria-live region.`);
}
