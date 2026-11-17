import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { ON_DEV, expect, test, type Login, type SignInPage } from './support/fixtures';
import { blocks, stripComments, tfFiles } from './support/infra-harness';
import { policyOf, resourcesNamed } from './support/onb-15/tf-policy';
import { tablesIn, tenancyGrant } from './support/ten-02/relock';
import type { Statement } from './support/ops-05/iam-eval';
import {
  APP_URL, COMPANY, DAY, GOOD_PASSWORD, HR, INVITES, LINK, LINK_IN_TEXT, LOOKUP, OTHER_PASSWORD, PARTNER, REDEEM, REPO, ROBOT_ADDRESS, ROBOT_HR, T0,
  at, cognitoCalls, create, current, dynamoCalls, employees, invites, issue, issueArgs, logLines, lookup, mails, plain, publicEvent, published, redeem, runModule,
  sha256, storedEmployee, tokenOf, validBody, worldWithPool, type Run, type World,
} from './support/onb-04.2/lambda-harness';
import { EMPLOYEE } from './support/onb-03/lambda-harness';

/**
 * ONB-04 · Invite link instead of a password (Jira NH-170, epic NH-150).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-04.md (16 Nov 2026)
 *
 * No screen: ONB-17 builds the page. AC-1 to AC-10 run the real createEmployee, lookupInvite and redeemInvite
 * handlers and lambda/shared/invite.mjs (issueInvite), each in a fresh Node process, against
 * support/onb-04/fake-aws (ONB-03's fake AWS plus the employee_invites table, a Cognito user status and the
 * pool's password rules, a fixed clock, every console line recorded, and two requests that can race). They run
 * once, in desktop-1280. AC-11 reads infra/*.tf, the Lambda folders, scripts and the API description as text.
 * AC-12 renders the email at 1280 and 390. AC-5's last test runs on pepla-dev only, red until merge.
 * Nothing here calls AWS, Postmark or any AI service.
 *
 * ONB-04.2 (NH-191, lock onb-04.2) changed three things here: the tests run on support/onb-04.2 (the same fake AWS
 * plus Cognito's AdminListGroupsForUser); AC-7 expects a new link for a sign-in already in use to be refused; and
 * AC-11 lets redeemInvite and createEmployee read a sign-in and its groups (AdminGetUser, AdminListGroupsForUser).
 *
 * These files are locked once the lock check accepts them: see ./README.md and cards/onb-04.md.
 */

const SUBJECT = `${COMPANY}: set your password for Naleko People`;
const HEADING = 'Get ready for your first day';
const lead = (first: string) => `Hi ${first}. ${COMPANY} uses Naleko People for new employees. Set your password, then upload your ID and bank letter.`;
const footer = (partner: string, partnerFirst: string, sent: string, expires: string) =>
  `Sent by ${partner}, HR at ${COMPANY}, on ${sent}. The link works once and expires on ${expires}. If it has expired, ask ${partnerFirst} for a new one.`;
// T0 is 16 Nov 2026 22:30 UTC: already 17 Nov in South Africa. Seven days on is 24 Nov.
const SENT_ON = '17 Nov 2026';
const EXPIRES_ON = '24 Nov 2026';
const RETRY = 'Could not set the password. Try again.';
const TOKEN43 = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function lambdaOnce(testInfo: TestInfo): void {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambdas against a fake AWS.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Runs the Lambdas once: they have no screen width.');
}
const textOnce = (testInfo: TestInfo) => {
  test.skip(ON_DEV, 'No-backend run only: it reads the repository as text.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Reads the repository once: it has no screen width.');
};

/** The words of an HTML email as a person reads them (tags gone, entities decoded), from the browser. */
async function readHtml(page: Page, html: string): Promise<{ text: string; links: Array<{ href: string; text: string }> }> {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const text = clean(await page.locator('body').innerText());
  const links = await page.locator('a[href]').evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href') ?? '', text: (a.textContent ?? '').replace(/\s+/g, ' ').trim() })));
  return { text, links };
}

function expectStatus(run: Run, status: number, what: string): void {
  expect(run.error, `${what}: the handler did not throw (${run.error?.message})`).toBeUndefined();
  expect(run.status, `${what}: HTTP ${status} (got ${run.status}, ${run.raw.slice(0, 300)})`).toBe(status);
}

/** Every string anywhere inside a value (keys included). */
/** The text of an HCL string literal ("…" with \" and \\ escapes). */
const hclString = (v: string) => (/^"(.*)"$/s.exec(v.trim())?.[1] ?? v).replace(/\\(["\\])/g, '$1');

/**
 * Does a CloudWatch Logs filter pattern match this log line, as CloudWatch would see it? A Powertools line is JSON
 * ({ level: "ERROR", message, ...extra }); a console line is plain text. JSON patterns: `{ $.a = "x" && $.b = y }`
 * (|| too, * as a wildcard in a value). Term patterns: every quoted phrase or bare word must appear, -word must not.
 */
function filterMatches(pattern: string, line: { level: string; message: string; extra?: unknown }): boolean {
  const powertools = !line.level.startsWith('console.');
  const extra = Array.isArray(line.extra) && line.extra[0] && typeof line.extra[0] === 'object' ? (line.extra[0] as Record<string, unknown>) : {};
  const json: Record<string, unknown> | null = powertools ? { level: line.level.toUpperCase(), message: line.message, ...extra } : null;
  const text = json ? JSON.stringify(json) : line.message;
  const p = pattern.trim();
  if (p.startsWith('{')) {
    if (!json) return false;
    const inner = p.replace(/^\{|\}$/g, '').trim();
    const clause = (c: string): boolean => {
      const m = /^\(?\s*\$\.([\w.]+)\s*(=|!=)\s*(?:"((?:[^"\\]|\\.)*)"|([^\s)]+))\s*\)?$/.exec(c.trim());
      if (!m) throw new Error(`filter pattern clause not understood by the test: ${c}`);
      const got = m[1]!.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), json);
      const want = (m[3] ?? m[4]!).replace(/\\(.)/g, '$1');
      const re = new RegExp(`^${want.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      const hit = got !== undefined && re.test(String(got));
      return m[2] === '=' ? hit : !hit;
    };
    return inner.split('||').some((alt) => alt.split('&&').every(clause));
  }
  const terms = [...p.matchAll(/(-?)(?:"((?:[^"\\]|\\.)*)"|(\S+))/g)].map((m) => ({ not: m[1] === '-', t: (m[2] ?? m[3]!).replace(/\\(.)/g, '$1') }));
  return terms.length > 0 && terms.every(({ not, t }) => text.includes(t) !== not);
}

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); strings(x, out); }
  return out;
}
/** Every key anywhere inside a value. */
function keys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keys(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keys(x, out); }
  return out;
}

/** Registers a normal person (from a normal HR login) and hands back the run and its token. */
function registered(w: World, over: Record<string, unknown> = {}, now = T0): { run: Run; token: string; email: string } {
  const b = validBody(over);
  const run = create(w, HR, b, { now });
  expectStatus(run, 201, `createEmployee for ${String(b['email'])}`);
  return { run, token: tokenOf(run), email: String(b['email']).toLowerCase() };
}

// ---------------------------------------------------------------- pepla-dev helpers

function devEnv(): { api: string; clientId: string; region: string } {
  const file = join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts');
  const src = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const pick = (name: string) => new RegExp(`${name}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`).exec(src)?.[1] ?? '';
  const api = pick('employeesApiUrl');
  expect(api, 'employeesApiUrl points at pepla-dev, not the placeholder').not.toMatch(/\.invalid\b|^$/);
  const clientId = pick('clientId');
  expect(clientId, 'the Cognito app client id is set for pepla-dev').not.toMatch(/^not-configured$|^$/);
  return { api: api.replace(/\/+$/, ''), clientId, region: pick('region') || 'af-south-1' };
}
async function signInForToken(page: Page, signIn: SignInPage, login: Login): Promise<string> {
  let token = '';
  const listen = async (r: import('@playwright/test').Response) => {
    if (!/cognito-idp\.[a-z0-9-]+\.amazonaws\.com/.test(r.url()) || r.request().method() !== 'POST') return;
    try {
      const b = (await r.json()) as { AuthenticationResult?: { IdToken?: string } };
      if (b.AuthenticationResult?.IdToken) token = b.AuthenticationResult.IdToken;
    } catch {
      /* not JSON */
    }
  };
  page.on('response', listen);
  await signIn.open();
  await signIn.signInAs(login);
  await expect.poll(() => token, { message: `Cognito hands ${login.email} an ID token`, timeout: 30_000 }).not.toBe('');
  page.off('response', listen);
  return token;
}

// ================================================================ the tests

test.describe('ONB-04 Invite link instead of a password', () => {
  // -------------------------------------------------------------- AC-1
  test('AC-1 The email: company, first name, HR partner, one "Set your password" link, the send and expiry dates in South Africa time', async ({ page }, testInfo) => {
    lambdaOnce(testInfo);
    let w = worldWithPool();

    // With an HR partner chosen (Thandi Nkosi), the address typed with capitals.
    const run = create(w, HR, validBody({ hr_staff_id: PARTNER.id, email: 'Ayanda.Zulu@Mokoena.co.za' }));
    expectStatus(run, 201, 'createEmployee');
    w = run.world;
    const sent = mails(run);
    expect(sent, 'exactly one Postmark message').toHaveLength(1);
    const msg = sent[0]!.message;
    expect(msg.To, 'to the saved, lower-case address').toBe('ayanda.zulu@mokoena.co.za');
    expect(msg.Subject, 'the subject').toBe(SUBJECT);
    expect(msg.From, 'from the sender as today').toBe('sender@example.test');
    expect(msg.MessageStream, 'the outbound stream, as today').toBe('outbound');

    const html = await readHtml(page, String(msg.HtmlBody ?? ''));
    expect(html.text, 'the heading').toContain(HEADING);
    expect(html.text, 'the lead names the first name and the company').toContain(lead('Ayanda'));
    expect(html.text, 'the footer: the saved HR partner, the company, sent today and expiring 7 days on (South Africa dates)').toContain(footer(PARTNER.name, PARTNER.first, SENT_ON, EXPIRES_ON));
    expect(html.links, 'the HTML carries exactly one link').toHaveLength(1);
    expect(html.links[0]!.text, 'the one link is the "Set your password" button').toBe('Set your password');
    const m = LINK.exec(html.links[0]!.href);
    expect(m, `the button links to ${APP_URL}/set-password#token=<43 characters> (got ${html.links[0]!.href.replace(/token=.*/, 'token=…')})`).toBeTruthy();
    const token = m![1]!;

    const text = String(msg.TextBody ?? '');
    expect(text, 'the plain text has the heading').toContain(HEADING);
    expect(clean(text), 'the plain text has the lead').toContain(lead('Ayanda'));
    expect(clean(text), 'the plain text has the footer').toContain(footer(PARTNER.name, PARTNER.first, SENT_ON, EXPIRES_ON));
    expect([...text.matchAll(LINK_IN_TEXT)].map((x) => x[1]), 'the plain text carries the same link, once').toEqual([token]);
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    const linkLine = lines.indexOf(`${APP_URL}/set-password#token=${token}`);
    expect(linkLine, 'the link is on a line of its own').toBeGreaterThan(-1);
    const label = lines.findIndex((l) => l === 'Set your password:');
    expect(label, 'under "Set your password:"').toBeGreaterThan(-1);
    expect(label, '"Set your password:" comes just before the link (blank lines allowed)').toBeLessThan(linkLine);
    expect(lines.slice(label + 1, linkLine).every((l) => l === ''), 'nothing but blank lines between them').toBe(true);

    // With no partner chosen: the HR person who registered them (Jane Smith). A second token, not the first.
    const second = create(w, HR, validBody({ first_name: 'Sipho', last_name: 'Dube', email: 'sipho.dube@mokoena.co.za' }));
    expectStatus(second, 201, 'createEmployee, no partner chosen');
    const msg2 = mails(second)[0]!.message;
    const html2 = await readHtml(page, String(msg2.HtmlBody ?? ''));
    expect(html2.text, 'the lead greets Sipho').toContain(lead('Sipho'));
    expect(html2.text, 'the footer names the HR person who registered them').toContain(footer('Jane Smith', 'Jane', SENT_ON, EXPIRES_ON));
    expect(clean(String(msg2.TextBody)), 'so does the plain text').toContain(footer('Jane Smith', 'Jane', SENT_ON, EXPIRES_ON));
    const token2 = tokenOf(second);
    expect(token2, 'two registrations make two different tokens').not.toBe(token);
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 The link works once, and for 7 days; a password that breaks a rule is refused and does not use the link up', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const reg = registered(worldWithPool());
    let w = reg.run.world;
    const row = invites(w).find((r) => sha256(reg.token).includes(String(r['token_hash'])));
    expect(row, 'the invite row is found by the token\'s SHA-256').toBeTruthy();
    expect((Date.parse(String(row!['expires_at'])) - Date.parse(String(row!['created_at']))) / 1000, 'expires_at is exactly 7 days (604 800 s) after created_at').toBe(604_800);
    expect(Date.parse(String(row!['created_at'])), 'created_at is the moment of sending').toBe(Date.parse(T0));

    const look = (now: string) => lookup(w, reg.token, { now });
    for (const [now, want, what] of [
      [T0, 'ok', 'straight after sending'],
      [at(T0, 7 * DAY - 3600), 'ok', 'at 6 days 23 hours'],
      [at(T0, 7 * DAY + 1), 'expired', 'one second after 7 days'],
    ] as const) {
      const r = look(now);
      expectStatus(r, 200, `lookup ${what}`);
      expect(r.body?.status, `lookup ${what}`).toBe(want);
    }

    // A password that breaks a rule: 400, the rules it broke, nothing set, and the link still works.
    const day1 = at(T0, DAY);
    // Rule names (ONB-17 words them): minLength, maxLength, lower, upper, number, symbol. Four refusals here (the
    // fifth would close the link, AC-13); the other two cases run on the second person's link below.
    const refuse = (world: World, token: string, password: string, rules: string[]) => {
      const r = redeem(world, token, password, { now: day1 });
      expectStatus(r, 400, `redeem with "${password.slice(0, 20)}"`);
      expect(r.body?.error, 'the 400 says what to do').toBe('Check the password');
      expect([...(r.body?.fields?.password ?? [])].sort(), `fields.password names exactly the broken rules for "${password.slice(0, 20)}"`).toEqual([...rules].sort());
      expect(cognitoCalls(r, 'AdminSetUserPassword'), 'no password is set').toEqual([]);
      return r.world;
    };
    const cases: Array<[string, string[]]> = [
      ['Short1!a', ['minLength']],
      ['alllowercaseletters', ['upper', 'number', 'symbol']],
      ['ALLUPPERCASE-2026', ['lower']],
      ['NoNumbersHere-ok', ['number']],
    ];
    for (const [password, rules] of cases) w = refuse(w, reg.token, password, rules);
    const still = lookup(w, reg.token, { now: day1 });
    expect(still.body?.status, 'after the refused passwords the link still says ok').toBe('ok');

    // Inside 7 days: 204, set once, permanent, for the person's address.
    const ok = redeem(w, reg.token, GOOD_PASSWORD, { now: at(T0, 6 * DAY) });
    expectStatus(ok, 204, 'redeem inside 7 days');
    expect(ok.raw, '204 has an empty body').toBe('');
    const sets = cognitoCalls(ok, 'AdminSetUserPassword');
    expect(sets, 'AdminSetUserPassword once').toHaveLength(1);
    expect(sets[0]!.input.Permanent, 'Permanent: true').toBe(true);
    expect(String(sets[0]!.input.Username).toLowerCase(), 'for the person\'s address').toBe(reg.email);
    w = ok.world;
    const user = w.cognito.users.find((u) => u.username.toLowerCase() === reg.email);
    expect(user?.status, 'the person can now sign in').toBe('CONFIRMED');

    // The same link again: used.
    const again = redeem(w, reg.token, OTHER_PASSWORD, { now: at(T0, 6 * DAY + 60) });
    expectStatus(again, 410, 'the same link a second time');
    expect(again.body, '410 { status: "used" }').toEqual({ status: 'used' });
    expect(cognitoCalls(again, 'AdminSetUserPassword'), 'nothing set the second time').toEqual([]);
    expect(lookup(again.world, reg.token, { now: at(T0, 6 * DAY + 120) }).body?.status, 'lookup says used').toBe('used');

    // A second person's link, redeemed after 7 days: expired, and no password set.
    const late = registered(again.world, { first_name: 'Sipho', last_name: 'Dube', email: 'sipho.dube@mokoena.co.za' });
    let lw = refuse(late.run.world, late.token, 'NoSymbols2026abc', ['symbol']);
    lw = refuse(lw, late.token, 'Aa1!' + 'x'.repeat(253), ['maxLength']);
    expect(lookup(lw, late.token, { now: day1 }).body?.status, 'Sipho\'s link still says ok').toBe('ok');
    const after = redeem(lw, late.token, GOOD_PASSWORD, { now: at(T0, 7 * DAY + 1) });
    expectStatus(after, 410, 'redeem after 7 days');
    expect(after.body, '410 { status: "expired" }').toEqual({ status: 'expired' });
    expect(cognitoCalls(after, 'AdminSetUserPassword'), 'the password is not set').toEqual([]);
    expect(after.world.cognito.users.find((u) => u.username.toLowerCase() === late.email)?.status, 'Sipho still cannot sign in').toBe('FORCE_CHANGE_PASSWORD');
    // The link is checked before the password: an expired link with a weak password is a 410, not a 400.
    const weakLate = redeem(after.world, late.token, 'short', { now: at(T0, 7 * DAY + 1) });
    expectStatus(weakLate, 410, 'redeem after 7 days with a weak password');
    expect(weakLate.body, '410 { status: "expired" }, not a list of rules').toEqual({ status: 'expired' });
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 No password is made or sent: no AdminSetUserPassword at create, no password in the email, the answer, the logs or the event', async ({ page }, testInfo) => {
    lambdaOnce(testInfo);
    const reg = registered(worldWithPool(), { hr_staff_id: PARTNER.id });
    const run = reg.run;
    const employeeId = String(run.body?.employee?.employee_id ?? '');
    expect(employeeId, 'the answer names the new employee').toMatch(/^[0-9a-f-]{36}$/);

    const cog = cognitoCalls(run);
    expect(cog.map((c) => c.op), 'createEmployee never calls AdminSetUserPassword').not.toContain('AdminSetUserPassword');
    for (const c of cog) {
      expect(keys(c.input).filter((k) => /password/i.test(k)), `${c.op}: no parameter holds a password (TemporaryPassword or any other)`).toEqual([]);
    }
    const create = cog.find((c) => c.op === 'AdminCreateUser');
    expect(create, 'the sign-in is made with AdminCreateUser').toBeTruthy();
    expect(create!.input.MessageAction, 'Cognito sends nothing itself').toBe('SUPPRESS');

    const msg = mails(run)[0]!.message;
    const everything = [JSON.stringify(msg), run.raw, JSON.stringify(logLines(run)), JSON.stringify(published(run)), run.output].join('\n');
    expect(everything, 'no old Np1! password anywhere').not.toContain('Np1!');
    expect(everything, 'no TemporaryPassword anywhere').not.toMatch(/TemporaryPassword|tempPassword/i);

    const html = await readHtml(page, String(msg.HtmlBody ?? ''));
    for (const [name, words] of [['HTML', html.text], ['plain text', String(msg.TextBody ?? '')], ['subject', String(msg.Subject ?? '')]] as const) {
      expect(words, `${name}: no "credentials"`).not.toMatch(/credentials/i);
      expect(words, `${name}: no "Employee ID"`).not.toMatch(/employee\s*id/i);
      expect(words, `${name}: no employee id`).not.toContain(employeeId);
      expect(words, `${name}: no department`).not.toContain('Finance');
      expect(words.replace(/https?:\/\/\S+/g, '').replace(/set your password/gi, ''), `${name}: "password" only in "Set your password" (the button, the lead, the text line, the subject)`).not.toMatch(/password/i);
    }
    expect(String(msg.HtmlBody), 'no "Password" label in the HTML').not.toMatch(/>\s*Password\s*:?\s*</);

    // The other senders never carry one either.
    const others = join(REPO, 'lambda', 'sendNotificationEmail');
    const src = readdirSync(others).filter((f) => /\.(m?js)$/.test(f) && !/\.test\./.test(f)).map((f) => readFileSync(join(others, f), 'utf8')).join('\n');
    expect(src.length, 'sendNotificationEmail has code').toBeGreaterThan(0);
    expect(src, 'sendNotificationEmail never mentions a password').not.toMatch(/password/i);
  });

  // -------------------------------------------------------------- AC-4
  test('AC-4 Test logins never get a real email: a test address or a test caller skips Postmark, the invite is still made', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    for (const [caller, email, what] of [
      [HR, ROBOT_ADDRESS, 'a test address from a normal HR login'],
      [ROBOT_HR, 'ayanda.zulu@mokoena.co.za', 'a normal address from a test login'],
      [ROBOT_HR, ROBOT_ADDRESS, 'a test address from a test login'],
    ] as const) {
      const run = create(worldWithPool(), caller, validBody({ email }));
      expectStatus(run, 201, what);
      expect(mails(run), `${what}: Postmark is never called`).toEqual([]);
      expect(run.body?.email, `${what}: email { sent: false, skipped: 'test' }`).toEqual({ sent: false, skipped: 'test' });
      expect(run.body?.cognito?.userCreated, `${what}: the sign-in is made`).toBe(true);
      expect(invites(run.world), `${what}: the invite is still made`).toHaveLength(1);
      expect(run.body?.invite, `${what}: no link in the answer without INVITE_TEST_LINK`).toBeUndefined();
      expect(run.raw, `${what}: no link anywhere in the answer`).not.toContain('set-password');
    }
    const normal = create(worldWithPool(), HR, validBody());
    expectStatus(normal, 201, 'a normal address from a normal HR login');
    expect(mails(normal), 'is sent').toHaveLength(1);
    expect(normal.body?.email?.sent, 'email.sent').toBe(true);
    expect(normal.body?.email?.skipped, 'nothing skipped').toBeUndefined();
  });

  // -------------------------------------------------------------- AC-5 (unit)
  test('AC-5 The link is in the answer only on pepla-dev, for a test login registering a test address', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const on = { env: { INVITE_TEST_LINK: 'true' } };
    const run = create(worldWithPool(), ROBOT_HR, validBody({ email: ROBOT_ADDRESS }), on);
    expectStatus(run, 201, 'all three conditions');
    expect(run.body?.email, 'email { sent: false, skipped: "test" }').toEqual({ sent: false, skipped: 'test' });
    const link = String(run.body?.invite?.link ?? '');
    const m = LINK.exec(link);
    expect(m, 'invite.link is <APP_URL>/set-password#token=<43 characters>').toBeTruthy();
    expect(sha256(m![1]!), 'and is the link of the stored invite').toContain(String(invites(run.world)[0]?.['token_hash']));
    const look = lookup(run.world, m![1]!);
    expect(look.body?.status, 'the link works').toBe('ok');
    expect(look.body?.email, 'for the test address').toBe(ROBOT_ADDRESS);

    for (const [caller, email, env, what] of [
      [ROBOT_HR, ROBOT_ADDRESS, {}, 'INVITE_TEST_LINK not set'],
      [ROBOT_HR, ROBOT_ADDRESS, { INVITE_TEST_LINK: 'false' }, 'INVITE_TEST_LINK "false"'],
      [HR, ROBOT_ADDRESS, { INVITE_TEST_LINK: 'true' }, 'a normal HR login'],
      [ROBOT_HR, 'ayanda.zulu@mokoena.co.za', { INVITE_TEST_LINK: 'true' }, 'a normal address'],
      [HR, 'ayanda.zulu@mokoena.co.za', { INVITE_TEST_LINK: 'true' }, 'a normal login and a normal address'],
    ] as const) {
      const r = create(worldWithPool(), caller, validBody({ email }), { env });
      expectStatus(r, 201, what);
      expect(r.body?.invite, `${what}: no invite in the answer`).toBeUndefined();
      expect(r.raw, `${what}: no link anywhere in the answer`).not.toMatch(/set-password|token=/);
    }
  });

  // -------------------------------------------------------------- AC-6
  test('AC-6 The sign-in exists but cannot be used yet; a Cognito failure is answered, logged and sends nothing', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const reg = registered(worldWithPool());
    const user = reg.run.world.cognito.users.find((u) => u.username.toLowerCase() === reg.email);
    expect(user, 'the person has a sign-in in the pool').toBeTruthy();
    expect(user!.groups, 'in group employee').toContain('employee');
    expect(user!.status, 'in the first-password state').toBe('FORCE_CHANGE_PASSWORD');
    expect(user!.password, 'no password of ours is set: no password signs them in').toBeUndefined();
    expect(user!.tempPassword, 'no temporary password of ours either').toBeUndefined();
    expect(user!.attributes['email'], 'the email is kept on the sign-in').toBe(reg.email);
    expect(user!.attributes['given_name'], 'the first name is kept on the sign-in (ONB-17 greets them)').toBe('Ayanda');
    expect(user!.attributes['family_name'], 'the last name is kept on the sign-in').toBe('Zulu');
    expect(reg.run.body?.cognito?.userCreated, 'cognito.userCreated').toBe(true);
    expect(reg.run.body?.email?.sent, 'email.sent').toBe(true);

    // AdminCreateUser fails (the card's case), or adding to the employee group does: neither is swallowed.
    for (const op of ['AdminCreateUser', 'AdminAddUserToGroup']) {
    const w = worldWithPool();
    w.cognitoFail = [op];
    const run = create(w, HR, validBody());
    expectStatus(run, 201, `createEmployee when Cognito refuses ${op}`);
    const id = String(run.body?.employee?.employee_id ?? '');
    expect(id, 'the saved employee is in the answer').toMatch(/^[0-9a-f-]{36}$/);
    expect(employees(run.world).map((e) => e['employee_id']), 'the employee row stays').toEqual([id]);
    expect(run.body?.cognito?.userCreated, 'cognito.userCreated: false').toBe(false);
    expect(run.body?.email?.sent, 'email.sent: false').toBe(false);
    expect(run.body?.invite, 'no invite').toBeUndefined();
    expect(invites(run.world), 'no row in employee_invites').toEqual([]);
    expect(mails(run), 'no email').toEqual([]);
    const errors = logLines(run).filter((l) => /error/i.test(l.level));
    const said = errors.map((l) => `${l.message} ${JSON.stringify(l.extra ?? '')}`);
    expect(said.some((s) => s.includes(id)), `an error line carries the employee id (error lines: ${said.join(' | ').slice(0, 400)})`).toBe(true);
    for (const l of logLines(run)) expect(`${l.message} ${JSON.stringify(l.extra ?? '')}`, 'no log line carries a token or a link').not.toMatch(new RegExp(`${TOKEN43.source}|set-password#token=`));
    }
  });

  // -------------------------------------------------------------- AC-7
  test('AC-7 One current link per person: a new link expires the earlier ones; a used link stays used', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const person = storedEmployee();
    let w = worldWithPool();
    w.tables.employees.push(person);
    const issued: string[] = [];
    const issueOnce = (label: string) => {
      const r = issue(w, issueArgs(person));
      expect(r.error, `${label}: issueInvite did not throw (${r.error?.message})`).toBeUndefined();
      const out = r.response as { token: string; expiresAt: string; link: string };
      expect(out?.token, `${label}: a 43-character token`).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(out.link, `${label}: link = <APP_URL>/set-password#token=<token>`).toBe(`${APP_URL}/set-password#token=${out.token}`);
      expect(Date.parse(out.expiresAt) - Date.parse(T0), `${label}: expiresAt is 7 days on`).toBe(7 * DAY * 1000);
      expect(cognitoCalls(r, 'AdminSetUserPassword'), `${label}: issueInvite never sets a password`).toEqual([]);
      w = r.world;
      issued.push(out.token);
      return out.token;
    };

    const t1 = issueOnce('first link');
    const user = w.cognito.users.find((u) => u.username.toLowerCase() === 'lindiwe.mokoena@x.co.za');
    expect(user, 'issueInvite makes the sign-in when there is none').toBeTruthy();
    expect(user!.groups, 'in group employee').toContain('employee');
    expect(user!.status, 'in the first-password state').toBe('FORCE_CHANGE_PASSWORD');
    expect(user!.attributes['given_name'], 'given_name kept (ONB-17)').toBe('Lindiwe');
    expect(user!.attributes['family_name'], 'family_name kept (ONB-17)').toBe('Mokoena');

    const t2 = issueOnce('second link (the sign-in already exists)');
    expect(t2, 'a new token').not.toBe(t1);
    expect(lookup(w, t1).body?.status, 'the first link now says expired').toBe('expired');
    const r1 = redeem(w, t1, GOOD_PASSWORD);
    expectStatus(r1, 410, 'redeem of the first link');
    expect(r1.body, '410 { status: "expired" }').toEqual({ status: 'expired' });
    expect(cognitoCalls(r1, 'AdminSetUserPassword'), 'nothing set').toEqual([]);
    expect(lookup(w, t2).body?.status, 'the second link says ok').toBe('ok');
    expect(current(w), 'exactly one row is current').toHaveLength(1);

    const t3 = issueOnce('third link');
    for (const [t, want] of [[t1, 'expired'], [t2, 'expired'], [t3, 'ok']] as const) expect(lookup(w, t).body?.status, `after three links: ${t === t3 ? 'the last' : 'an earlier'} one is ${want}`).toBe(want);
    expect(current(w), 'three links in a row leave only the last usable').toHaveLength(1);
    expect(invites(w), 'every link has its own row').toHaveLength(3);

    // A used link is not "replaced" later. ONB-04.2: once the password is set, a new link is refused (InviteRefused).
    const used = redeem(w, t3, GOOD_PASSWORD);
    expectStatus(used, 204, 'redeem of the third link');
    w = used.world;
    const late = issue(w, issueArgs(person));
    expect(late.error?.name, 'a link after the last one was used is refused: the sign-in is in use (ONB-04.2)').toBe('InviteRefused');
    w = late.world;
    expect(lookup(w, t3).body?.status, 'the used link still says used').toBe('used');
    const t3row = invites(w).find((r) => sha256(t3).includes(String(r['token_hash'])));
    expect(t3row?.['replaced_at'] ?? '', 'the used row is not marked replaced').toBeFalsy();
  });

  // -------------------------------------------------------------- AC-8
  test('AC-8 One link, one person, once: two redeems at the same moment, one wins; a Cognito failure gives the link back', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const reg = registered(worldWithPool());
    const ev = publicEvent('/v1/invites/redeem', { token: reg.token, password: GOOD_PASSWORD });
    const race = runModule(REDEEM, reg.run.world, [ev, ev], { now: at(T0, DAY), concurrent: true });
    for (const a of race.all) expect(a.error, `no redeem threw (${a.error?.message})`).toBeUndefined();
    expect(race.all.map((a) => a.status).sort(), 'exactly one 204 and one 410').toEqual([204, 410]);
    expect(race.all.find((a) => a.status === 410)!.body, 'the loser gets { status: "used" }').toEqual({ status: 'used' });
    expect(cognitoCalls(race, 'AdminSetUserPassword'), 'AdminSetUserPassword ran once').toHaveLength(1);
    expect(lookup(race.world, reg.token, { now: at(T0, DAY) }).body?.status, 'and the link is used').toBe('used');

    const other = registered(race.world, { first_name: 'Sipho', last_name: 'Dube', email: 'sipho.dube@mokoena.co.za' });
    const w: World = { ...other.run.world, cognitoFail: ['AdminSetUserPassword'] };
    const failed = redeem(w, other.token, GOOD_PASSWORD, { now: at(T0, DAY) });
    expectStatus(failed, 502, 'redeem when Cognito refuses to set the password');
    expect(failed.body, '502 { error }').toEqual({ error: RETRY });
    // A 502 is our failure, not a refused password: five of them do not close the link (AC-13 counts refusals only).
    let w5 = failed.world;
    for (let i = 2; i <= 5; i++) {
      const again = redeem({ ...w5, cognitoFail: ['AdminSetUserPassword'] }, other.token, GOOD_PASSWORD, { now: at(T0, DAY) });
      expectStatus(again, 502, `redeem ${i} when Cognito refuses`);
      w5 = again.world;
    }
    for (const r of invites(w5)) expect(Number(r['failed_attempts'] ?? 0), 'a 502 does not count as a refused password').toBe(0);
    const back: World = { ...w5, cognitoFail: [] };
    expect(lookup(back, other.token, { now: at(T0, DAY) }).body?.status, 'the link works again afterwards').toBe('ok');
    const retry = redeem(back, other.token, GOOD_PASSWORD, { now: at(T0, DAY) });
    expectStatus(retry, 204, 'the retry');
  });

  // -------------------------------------------------------------- AC-9
  test('AC-9 The link itself is never kept: only its SHA-256 is stored, nothing logs it, and a bad token is simply invalid', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const runs: Run[] = [];
    const reg = registered(worldWithPool(), { hr_staff_id: PARTNER.id });
    runs.push(reg.run);
    let w = reg.run.world;
    const step = (r: Run) => { runs.push(r); w = r.world; return r; };
    step(lookup(w, reg.token));
    step(redeem(w, reg.token, 'too-short'));
    step(redeem(w, reg.token, GOOD_PASSWORD));
    step(redeem(w, reg.token, GOOD_PASSWORD));
    step(lookup(w, reg.token));
    const person = storedEmployee();
    w.tables.employees.push(person);
    const helper = step(issue(w, issueArgs(person)));
    const helperToken = String(helper.response?.token ?? '');
    expect(helperToken, 'issueInvite hands back its token').toMatch(/^[A-Za-z0-9_-]{43}$/);
    step(lookup(w, helperToken));

    for (const [token, label] of [[reg.token, 'the emailed token'], [helperToken, 'issueInvite\'s token']] as const) {
      for (const r of runs) {
        const answer = r === helper ? '' : r.raw;
        const kept = [JSON.stringify(r.world.tables), JSON.stringify(r.world.cognito), JSON.stringify(logLines(r)), JSON.stringify(published(r)), answer, r.output, JSON.stringify(dynamoCalls(r))].join('\n');
        expect(kept.includes(token), `${label}: not in any table, log line, event, answer or DynamoDB request`).toBe(false);
      }
    }
    const rows = invites(w);
    expect(rows, 'two invite rows').toHaveLength(2);
    for (const [token, label] of [[reg.token, 'the emailed token'], [helperToken, 'issueInvite\'s token']] as const) {
      expect(rows.filter((r) => sha256(token).includes(String(r['token_hash']))), `${label}: its row is keyed by its SHA-256`).toHaveLength(1);
    }
    // TEN-02 (re-lock): an invite row also carries its company (tenant_id).
    const ALLOWED = ['token_hash', 'employee_id', 'created_at', 'expires_at', 'used_at', 'replaced_at', 'sent_by', 'ttl', 'failed_attempts', 'tenant_id'];
    for (const r of rows) {
      expect(Object.keys(r).filter((k) => !ALLOWED.includes(k)), 'an invite row holds only the card\'s fields').toEqual([]);
      const text = JSON.stringify(r).toLowerCase();
      for (const personal of ['ayanda', 'zulu', 'mokoena.co.za', 'lindiwe', 'x.co.za', '082 555', '081 234']) expect(text, `no ${personal} in an invite row`).not.toContain(personal);
      expect(Number(r['ttl']), 'ttl is 30 days after the link expires (epoch seconds)').toBe(Math.floor(Date.parse(String(r['expires_at'])) / 1000) + 30 * DAY);
    }

    // Unknown, short, long and wrongly-shaped tokens: { status: 'invalid' } and nothing else, never a throw.
    const known = reg.token;
    const bad = [
      'A'.repeat(43), known.slice(0, 42), known + 'A', known.slice(0, 42) + '+', known.slice(0, 42) + '/', known.slice(0, 42) + '=', '',
      ' ' + known.slice(1), 'abc', '../../etc/passwd', 'x'.repeat(10_000), known.toUpperCase() === known ? known.toLowerCase() : known.toUpperCase(),
    ];
    const all = runModule(LOOKUP, w, bad.map((token) => publicEvent('/v1/invites/lookup', { token })));
    all.all.forEach((a, i) => {
      expect(a.error, `lookup of bad token #${i} does not throw`).toBeUndefined();
      expect(a.status, `lookup of bad token #${i}: 200`).toBe(200);
      expect(a.body, `lookup of bad token #${i}: { status: 'invalid' } only`).toEqual({ status: 'invalid' });
    });
  });

  // -------------------------------------------------------------- AC-10
  test('AC-10 Only what the page needs: lookup hands out six fields at most, the routes are public and refuse bad bodies', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const person = storedEmployee();
    let w = worldWithPool();
    w.tables.employees.push(person);
    const issued = issue(w, issueArgs(person));
    w = issued.world;
    const token = String(issued.response?.token ?? '');
    expect(token, 'a token').toMatch(/^[A-Za-z0-9_-]{43}$/);

    const ok = lookup(w, token);
    expectStatus(ok, 200, 'lookup');
    expect(Object.keys(ok.body ?? {}).sort(), 'ok: exactly status, company, firstName, email, startDate, hrPartnerName').toEqual(['company', 'email', 'firstName', 'hrPartnerName', 'startDate', 'status']);
    expect(ok.body, 'ok: the values').toMatchObject({ status: 'ok', company: COMPANY, firstName: 'Lindiwe', email: 'lindiwe.mokoena@x.co.za', hrPartnerName: 'Thandi Nkosi' });
    expect(ok.body.startDate, 'ok: the start date as YYYY-MM-DD (ONB-17 formats it)').toBe('2026-12-01');
    const p = plain(person)!;
    for (const [what, value] of [
      ['employee_id', p['employee_id']], ['the phone', '0147'], ['the ID digits', '4087'], ['the ID ciphertext', p['id_number_encrypted']], ['the salary', '38500'],
      ['the bank account', '62841937055'], ['the bank', 'First National'], ['the note', 'Private HR note'], ['the last name', 'Mokoena'], ['the department', 'Finance'],
      ['the HR partner\'s email', 'thandi.nkosi@'], ['the HR partner\'s id', 'HR0042'],
    ] as const) expect(ok.raw, `lookup never hands out ${what}`).not.toContain(String(value));
    expect(ok.raw, 'no employee_id key').not.toContain('employee_id');
    const reads = dynamoCalls(ok).filter((c) => c.table === 'employees');
    expect(reads.map((c) => c.op), 'lookup reads the employee with one GetItem').toEqual(['GetItem']);
    const named = String(reads[0]!.input.ProjectionExpression ?? '').split(',').map((n) => n.trim()).map((n) => (n.startsWith('#') ? reads[0]!.input.ExpressionAttributeNames?.[n] : n));
    // TEN-02 (re-lock): it may also read the row's company (tenant_id), to check it against the invite's.
    expect(named.filter(Boolean).filter((n) => n !== 'tenant_id').sort(), 'and asks only for email, first_name, planned_start_date, hr_staff_name (and tenant_id)').toEqual(['email', 'first_name', 'hr_staff_name', 'planned_start_date']);
    expect(ok.calls.filter((c) => c.service === 'kms'), 'lookup decrypts nothing').toEqual([]);

    const expired = lookup(w, token, { now: at(T0, 7 * DAY + 1) });
    expect(Object.keys(expired.body ?? {}).sort(), 'expired: status, company, hrPartnerName only').toEqual(['company', 'hrPartnerName', 'status']);
    expect(expired.body, 'expired: the values').toEqual({ status: 'expired', company: COMPANY, hrPartnerName: 'Thandi Nkosi' });

    // Public: an Authorization header and an employee's claims change nothing.
    const withAuth = runModule(LOOKUP, w, [publicEvent('/v1/invites/lookup', { token }, { caller: EMPLOYEE, headers: { authorization: 'Bearer not-a-real-token' } })]);
    expect(withAuth.status, 'lookup ignores an Authorization header').toBe(200);
    expect(withAuth.body, 'and answers the same').toEqual(ok.body);
    const redeemed = runModule(REDEEM, w, [publicEvent('/v1/invites/redeem', { token, password: GOOD_PASSWORD }, { caller: EMPLOYEE, headers: { authorization: 'Bearer not-a-real-token' } })]);
    expectStatus(redeemed, 204, 'redeem with an Authorization header');
    const used = lookup(redeemed.world, token);
    expect(used.body, 'used: status, company, hrPartnerName only').toEqual({ status: 'used', company: COMPANY, hrPartnerName: 'Thandi Nkosi' });

    // Missing and non-JSON bodies: 400 on both routes.
    for (const [file, route] of [[LOOKUP, '/v1/invites/lookup'], [REDEEM, '/v1/invites/redeem']] as const) {
      for (const [b, what] of [[undefined, 'no body'], ['not json', 'a body that is not JSON'], ['{"token":', 'broken JSON']] as const) {
        const r = runModule(file, w, [publicEvent(route, b)]);
        expectStatus(r, 400, `${route} with ${what}`);
      }
    }

    // A removed row answers as a token that never existed.
    const second = storedEmployee({ employee_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', email: 'kagiso.molefe@x.co.za', first_name: 'Kagiso', last_name: 'Molefe' });
    w.tables.employees.push(second);
    const gone = issue(w, issueArgs(second));
    const goneToken = String(gone.response?.token ?? '');
    const removed: World = structuredClone(gone.world);
    removed.tables[INVITES] = removed.tables[INVITES]!.filter((r) => !sha256(goneToken).includes(String(plain(r)!['token_hash'])));
    expect(removed.tables[INVITES]!.length, 'the row is removed').toBe(gone.world.tables[INVITES]!.length - 1);
    const never = 'Q'.repeat(43);
    expect(lookup(removed, goneToken).body, 'lookup of a removed row: invalid').toEqual({ status: 'invalid' });
    expect(lookup(removed, goneToken).body, 'the same as a token that never existed').toEqual(lookup(removed, never).body);
    const rGone = redeem(removed, goneToken, GOOD_PASSWORD);
    const rNever = redeem(removed, never, GOOD_PASSWORD);
    expectStatus(rGone, 410, 'redeem of a removed row');
    expect(rGone.body, 'redeem of a removed row: 410 { status: "invalid" }').toEqual({ status: 'invalid' });
    expect(rNever.status, 'the same as a token that never existed').toBe(410);
    expect(rGone.body, 'word for word').toEqual(rNever.body);
  });

  // -------------------------------------------------------------- AC-11
  test('AC-11 Terraform and the API description match: the table, two public rate-limited routes, three roles, the alarm, the settings', async ({}, testInfo) => {
    textOnce(testInfo);
    const files = tfFiles();
    const res = (type: string) => blocks(files, 'resource').filter((b) => b.labels[0] === type);
    const attr = (b: { body: string }, name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm').exec(b.body)?.[1]?.trim().replace(/\s+/g, '') ?? '';
    const flat = (s: Statement | Statement[]) => (Array.isArray(s) ? s : [s]).flatMap((st) => {
      const actions = ([] as string[]).concat((st.Action as string | string[] | undefined) ?? []);
      const resources = ([] as string[]).concat((st.Resource as string | string[] | undefined) ?? []);
      return actions.flatMap((action) => resources.map((resource) => ({ effect: st.Effect, action, resource: resource.replace(/\$\{([^}]+)\}/g, '$1') })));
    });
    const ordinary = (a: string) => !a.startsWith('logs:') && !a.startsWith('xray:');

    // 1. The table.
    const table = res('aws_dynamodb_table').find((b) => attr(b, 'name') === `"${INVITES}"`);
    expect(table, `a DynamoDB table named ${INVITES}`).toBeTruthy();
    const T = table!.labels[1]!;
    expect(T, `the resource label is ${INVITES} too (ONB-03 AC-12, re-lock onb-03.4, reads the policy lines by that name)`).toBe(INVITES);
    expect(attr(table!, 'deletion_protection_enabled'), 'deletion protection').toBe('true');
    expect(attr(table!, 'billing_mode'), 'pay per request').toBe('"PAY_PER_REQUEST"');
    expect(attr(table!, 'hash_key'), 'hash key token_hash').toBe('"token_hash"');
    expect(table!.body, 'token_hash is a string').toMatch(/attribute\s*\{\s*name\s*=\s*"token_hash"\s*type\s*=\s*"S"\s*\}/);
    expect(table!.body, 'employee_id is a string').toMatch(/attribute\s*\{\s*name\s*=\s*"employee_id"\s*type\s*=\s*"S"\s*\}/);
    expect(table!.body, 'a global index employee-index on employee_id').toMatch(/global_secondary_index\s*\{[^}]*name\s*=\s*"employee-index"[^}]*hash_key\s*=\s*"employee_id"/);
    expect(table!.body, 'lifecycle { prevent_destroy = true }, as every table (OPS-05)').toMatch(/lifecycle\s*\{[^}]*prevent_destroy\s*=\s*true/);
    expect(table!.body, 'time to live on ttl').toMatch(/ttl\s*\{[^}]*attribute_name\s*=\s*"ttl"[^}]*enabled\s*=\s*true/);
    const isTable = (r: string) => r === `arn:aws:dynamodb:af-south-1:000000000000:table/${INVITES}` || r === `aws_dynamodb_table.${T}.arn`;
    const isIndex = (r: string) => r === `arn:aws:dynamodb:af-south-1:000000000000:table/${INVITES}/index/employee-index` || r === `aws_dynamodb_table.${T}.arn/index/employee-index`;
    const isEmployees = (r: string) => r === 'arn:aws:dynamodb:af-south-1:000000000000:table/employees' || r === 'aws_dynamodb_table.employees.arn';
    const isPool = (r: string) => /^arn:aws:cognito-idp:af-south-1:000000000000:userpool\/aws_cognito_user_pool\.naleko_dev\.id$/.test(r) || r === 'aws_cognito_user_pool.naleko_dev.arn';

    // 2. Two new Lambdas, each with its own role, its exact actions, a public route with a rate limit.
    const NEW = [
      { fn: 'lookupInvite', route: 'POST /v1/invites/lookup', want: [['dynamodb:GetItem', isTable], ['dynamodb:GetItem', isEmployees]] as const },
      // ONB-04.2: redeemInvite also reads the sign-in and its groups before it sets a password.
      { fn: 'redeemInvite', route: 'POST /v1/invites/redeem', want: [['dynamodb:GetItem', isTable], ['dynamodb:UpdateItem', isTable], ['dynamodb:GetItem', isEmployees], ['cognito-idp:AdminSetUserPassword', isPool], ['cognito-idp:AdminGetUser', isPool], ['cognito-idp:AdminListGroupsForUser', isPool]] as const },
    ];
    const stage = res('aws_apigatewayv2_stage').find((b) => b.labels[1] === 'employees_api_default');
    expect(stage, 'the employees API stage').toBeTruthy();
    const routeSettings = [...stage!.body.matchAll(/route_settings\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    const roles: string[] = [];
    for (const n of NEW) {
      expect(existsSync(join(REPO, 'lambda', n.fn, 'index.mjs')), `lambda/${n.fn}/index.mjs exists`).toBe(true);
      expect(existsSync(join(REPO, 'lambda', n.fn, 'package.json')), `lambda/${n.fn}/package.json exists (build-lambdas.py builds, and the deploy ships, every folder that has one)`).toBe(true);
      const fn = res('aws_lambda_function').find((b) => attr(b, 'function_name') === `"${n.fn}"`);
      expect(fn, `a Terraform function named ${n.fn}`).toBeTruthy();
      expect(attr(fn!, 'handler'), `${n.fn}: handler`).toBe('"index.handler"');
      expect(attr(fn!, 'runtime'), `${n.fn}: runtime`).toBe('"nodejs22.x"');
      expect(fn!.body, `${n.fn}: X-Ray on`).toMatch(/tracing_config\s*\{\s*mode\s*=\s*"Active"/);
      expect(fn!.body, `${n.fn}: its own log group`).toContain(`"/aws/lambda/${n.fn}"`);
      expect(fn!.body, `${n.fn}: ignore_changes for code`).toMatch(/ignore_changes\s*=\s*\[[^\]]*filename/);
      const roleRef = /aws_iam_role\.(\w+)\.arn/.exec(attr(fn!, 'role'));
      expect(roleRef, `${n.fn}: a role of its own`).toBeTruthy();
      roles.push(roleRef![1]!);
      expect(res('aws_lambda_function').filter((b) => attr(b, 'role') === attr(fn!, 'role')).map((b) => attr(b, 'function_name')), `${n.fn}: the role is used by this function only`).toEqual([`"${n.fn}"`]);
      const policies = res('aws_iam_role_policy').filter((b) => attr(b, 'role') === `aws_iam_role.${roleRef![1]}.name`);
      expect(policies, `${n.fn}: one inline policy`).toHaveLength(1);
      expect(res('aws_iam_role_policy_attachment').filter((b) => attr(b, 'role').includes(`aws_iam_role.${roleRef![1]}.`)), `${n.fn}: no attached managed policy`).toEqual([]);
      const rows = flat(policyOf(resourcesNamed('aws_iam_role_policy', policies[0]!.labels[1]!)[0]!).Statement);
      expect(rows.every((r) => r.effect === 'Allow'), `${n.fn}: Allow only`).toBe(true);
      for (const r of rows) {
        expect(r.action, `${n.fn}: no wildcard action (${r.action})`).not.toMatch(/\*/);
        if (r.resource === '*') expect(r.action, `${n.fn}: Resource "*" only for X-Ray`).toMatch(/^xray:/);
      }
      expect(rows.filter((r) => r.action.startsWith('logs:')).every((r) => r.resource.includes(`/aws/lambda/${n.fn}`)), `${n.fn}: logs only into its own group`).toBe(true);
      const extra = rows.filter((r) => ordinary(r.action));
      for (const [action, on] of n.want) expect(extra.some((r) => r.action === action && on(r.resource)), `${n.fn}: may ${action} on the right resource`).toBe(true);
      const unexpected = extra.filter((r) => !n.want.some(([action, on]) => r.action === action && on(r.resource)));
      expect(unexpected.map((r) => `${r.action} ${r.resource}`), `${n.fn}: nothing else`).toEqual([]);

      const route = res('aws_apigatewayv2_route').find((b) => attr(b, 'route_key') === `"${n.route.replace(/\s+/g, '')}"` || attr(b, 'route_key') === `"${n.route}"`.replace(/\s+/g, ''));
      expect(route, `a route ${n.route}`).toBeTruthy();
      expect(attr(route!, 'api_id'), `${n.route}: on the employees API`).toBe('aws_apigatewayv2_api.employees_api.id');
      expect(['', '"NONE"'], `${n.route}: public (no authorization)`).toContain(attr(route!, 'authorization_type'));
      expect(attr(route!, 'authorizer_id'), `${n.route}: no authorizer`).toBe('');
      const integration = /aws_apigatewayv2_integration\.(\w+)\.id/.exec(attr(route!, 'target'));
      const ib = res('aws_apigatewayv2_integration').find((b) => b.labels[1] === integration?.[1]);
      expect(ib, `${n.route}: has an integration`).toBeTruthy();
      expect(attr(ib!, 'integration_uri'), `${n.route}: calls ${n.fn}`).toContain(`aws_lambda_function.${fn!.labels[1]}.invoke_arn`);
      const perm = res('aws_lambda_permission').find((b) => attr(b, 'function_name').includes(`aws_lambda_function.${fn!.labels[1]}.`));
      expect(perm, `${n.fn}: API Gateway may invoke it`).toBeTruthy();
      expect(attr(perm!, 'principal'), 'principal').toBe('"apigateway.amazonaws.com"');
      const limit = routeSettings.find((s) => new RegExp(`route_key\\s*=\\s*"${n.route}"`).test(s));
      expect(limit, `${n.route}: has its own route settings on the stage`).toBeTruthy();
      expect(limit, `${n.route}: burst 10`).toMatch(/throttling_burst_limit\s*=\s*10\b/);
      expect(limit, `${n.route}: 5 per second`).toMatch(/throttling_rate_limit\s*=\s*5\b/);
    }

    // 3. createEmployee: loses AdminSetUserPassword, gains PutItem, Query (index) and UpdateItem on the invite table, and
    //    (ONB-04.2) AdminGetUser and AdminListGroupsForUser on the pool, nothing else.
    const baselineFile = join(__dirname, 'support', 'onb-04', 'iam.create-employee.ae7bba4.tf.txt');
    const show = (r: { effect: string; action: string; resource: string }) => `${r.effect} ${r.action} ${r.resource}`;
    const before = flat(policyOf(resourcesNamed('aws_iam_role_policy', 'create_employee', [baselineFile])[0]!).Statement).map(show).sort();
    const now = flat(policyOf(resourcesNamed('aws_iam_role_policy', 'create_employee')[0]!).Statement);
    const after = now.map(show).sort();
    const removed = before.filter((x) => !after.includes(x));
    const added = now.filter((r) => !before.includes(show(r)));
    expect(removed, 'createEmployee loses exactly AdminSetUserPassword on the pool').toEqual([
      'Allow cognito-idp:AdminSetUserPassword arn:aws:cognito-idp:af-south-1:000000000000:userpool/aws_cognito_user_pool.naleko_dev.id',
    ]);
    const wantAdded = [['dynamodb:PutItem', isTable], ['dynamodb:Query', isIndex], ['dynamodb:UpdateItem', isTable], ['cognito-idp:AdminGetUser', isPool], ['cognito-idp:AdminListGroupsForUser', isPool]] as const;
    for (const [action, on] of wantAdded) expect(added.some((r) => r.action === action && on(r.resource)), `createEmployee gains ${action} on ${action.startsWith('cognito-idp:') ? 'the pool' : 'the invite table'}${action === 'dynamodb:Query' ? '\'s employee-index' : ''}`).toBe(true);
    // TEN-02 (re-lock): the company grants (Member rows, the employees tenant-index) are TEN-02's, not this card's.
    expect(added.filter((r) => !wantAdded.some(([action, on]) => r.action === action && on(r.resource)) && !tenancyGrant(r.action, r.resource, tablesIn(before.map((b) => b.split(' ')[2]!)), true)).map(show), 'and nothing else').toEqual([]);
    for (const r of now) {
      expect(r.action, `createEmployee: no wildcard action (${r.action})`).not.toMatch(/\*/);
      if (r.resource === '*') expect(r.action, 'createEmployee: Resource "*" only for X-Ray').toMatch(/^xray:/);
    }

    // 4. KMS: both new roles read through DynamoDB only.
    const kms = blocks(files, 'module').find((b) => b.labels[0] === 'kms_pii');
    expect(kms, 'module kms_pii').toBeTruthy();
    const list = (name: string) => /\[([^\]]*)\]/.exec(new RegExp(`${name}\\s*=\\s*\\[[^\\]]*\\]`).exec(kms!.body)?.[0] ?? '')?.[1] ?? '';
    for (const role of roles) {
      expect(list('dynamodb_read_role_arns'), `${role} is in kms_pii dynamodb_read_role_arns`).toContain(`aws_iam_role.${role}.arn`);
      expect(list('allowed_role_arns'), `${role} is not in allowed_role_arns`).not.toContain(`aws_iam_role.${role}.arn`);
    }

    // 5. Nothing of Cognito or KMS is moved, removed or replaced.
    const whole = files.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
    const moves = [...whole.matchAll(/^\s*(moved|removed)\s*\{[^}]*\}/gm)].map((m) => m[0]);
    expect(moves.filter((m) => /cognito|kms|employee_invites|create_employee|lookup_invite|redeem_invite/i.test(m)), 'no moved or removed block touches Cognito, KMS or this card').toEqual([]);
    for (const addr of ['aws_cognito_user_pool" "naleko_dev', 'aws_cognito_user_pool_client" "web', 'aws_cognito_user_group" "employee', 'aws_cognito_user_group" "hr_staff', 'aws_cognito_user_group" "e2e_robots']) {
      expect(whole, `resource "${addr}" keeps its address`).toContain(`resource "${addr}"`);
    }
    const pool = res('aws_cognito_user_pool').find((b) => b.labels[1] === 'naleko_dev')!;
    expect(attr(pool, 'name'), 'the pool keeps its name').toBe('"naleko-dev-user-pool"');
    expect(attr(pool, 'username_attributes'), 'and its username attributes').toBe('["email"]');
    expect(kms!.body, 'the KMS module keeps its source').toMatch(/source\s*=\s*"\.\/modules\/kms"/);
    expect(kms!.body, 'and its alias').toMatch(/alias_name\s*=\s*"naleko-onboarding-pii"/);

    // 6. Alarm, log group and dashboard lists, and the InviteFailed alarm.
    for (const file of ['alarms.tf', 'cloudwatch.tf', 'dashboards.tf']) {
      const text = stripComments(readFileSync(join(REPO, 'infra', file), 'utf8'));
      const named = (list: string, name: string) => new RegExp(`"(/aws/lambda/)?${name}"`).test(list);
      const lists = [...text.matchAll(/\[[^\[\]]*\]/g)].map((m) => m[0]).filter((l) => named(l, 'createEmployee'));
      expect(lists.length, `infra/${file} has a list naming createEmployee`).toBeGreaterThan(0);
      for (const n of NEW) for (const l of lists) expect(named(l, n.fn), `infra/${file}: every list that names createEmployee names ${n.fn}`).toBe(true);
    }
    const allTf = [...files, ...readdirSync(join(REPO, 'infra', 'modules'), { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => tfFiles(join(REPO, 'infra', 'modules', d.name)))];
    const anyRes = (type: string) => blocks(allTf, 'resource').filter((b) => b.labels[0] === type);
    const filters = anyRes('aws_cloudwatch_log_metric_filter').filter((b) => /createEmployee/.test(attr(b, 'log_group_name')));
    expect(filters, 'a metric filter on createEmployee\'s log group').not.toHaveLength(0);
    const metricNames = filters.map((b) => /metric_transformation\s*\{[^}]*name\s*=\s*"([^"]+)"/.exec(b.body)?.[1]).filter(Boolean);
    const alarm = anyRes('aws_cloudwatch_metric_alarm').find((b) => /InviteFailed/.test(attr(b, 'alarm_name')));
    expect(alarm, 'an alarm named …InviteFailed…').toBeTruthy();
    expect(metricNames, 'the alarm watches the metric the filter makes').toContain(/^"([^"]+)"$/.exec(attr(alarm!, 'metric_name'))?.[1]);
    // The filter matches the line createEmployee really logs when the invite fails, and no line of a good registration.
    const watched = filters.filter((b) => metricNames.includes(/metric_transformation\s*\{[^}]*name\s*=\s*"([^"]+)"/.exec(b.body)?.[1]) && /metric_name\s*=\s*"([^"]+)"/.exec(alarm!.body)?.[1] === /metric_transformation\s*\{[^}]*name\s*=\s*"([^"]+)"/.exec(b.body)?.[1]);
    const patterns = watched.map((b) => hclString(/^\s*pattern\s*=\s*("(?:[^"\\]|\\.)*")\s*$/m.exec(b.body)?.[1] ?? '""'));
    expect(patterns, 'the filter has a pattern').not.toHaveLength(0);
    for (const op of ['AdminCreateUser', 'AdminAddUserToGroup']) {
      const w = worldWithPool();
      w.cognitoFail = [op];
      const bad = create(w, HR, validBody());
      const lines = logLines(bad).filter((l) => /error/i.test(l.level));
      expect(patterns.some((pat) => lines.some((l) => filterMatches(pat, l))), `the InviteFailed filter (${patterns.join(' | ')}) matches an error line createEmployee logs when ${op} fails (${lines.map((l) => l.message).join(' | ').slice(0, 300)})`).toBe(true);
    }
    const good = create(worldWithPool(), HR, validBody());
    expect(good.status, 'a good registration').toBe(201);
    expect(patterns.some((pat) => logLines(good).some((l) => filterMatches(pat, l))), 'the filter matches no line of a good registration').toBe(false);

    // 7. Settings: COMPANY_NAME and APP_URL where read; INVITE_TEST_LINK on pepla-dev only.
    const variables = blocks(files, 'variable');
    const dev = stripComments(readFileSync(join(REPO, 'infra', 'env', 'dev.tfvars'), 'utf8'));
    const tfvar = (name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm').exec(dev)?.[1]?.trim();
    const defaultOf = (name: string) => /default\s*=\s*(.+)/.exec(variables.find((v) => v.labels[0] === name)?.body ?? '')?.[1]?.trim();
    expect(variables.find((v) => v.labels[0] === 'company_name'), 'variable company_name').toBeTruthy();
    expect(variables.find((v) => v.labels[0] === 'app_url'), 'variable app_url').toBeTruthy();
    expect(defaultOf('company_name'), 'company_name has a prod value').toBeTruthy();
    expect(defaultOf('app_url') ?? '', 'app_url has a prod value with no trailing slash').toMatch(/^"https?:\/\/[^"]*[^/"]"$/);
    expect(tfvar('company_name'), 'dev: Sunbird Bakery').toBe('"Sunbird Bakery"');
    expect(tfvar('app_url'), 'dev: the local app').toBe('"http://localhost:4300"');
    const sourceOf = (fn: string) => {
      const dir = join(REPO, 'lambda', fn);
      const own = existsSync(join(dir, 'index.mjs')) ? readFileSync(join(dir, 'index.mjs'), 'utf8') : '';
      // createEmployee's settings include the helper it calls (issueInvite reads APP_URL); the routes are judged on their own code.
      if (fn !== 'createEmployee') return own;
      const shared = [...own.matchAll(/from\s+['"]\.\.?\/shared\/([\w.-]+)['"]/g)].map((m) => join(REPO, 'lambda', 'shared', m[1]!)).filter(existsSync).map((f) => readFileSync(f, 'utf8'));
      return [own, ...shared].join('\n');
    };
    const envOf = (fn: string) => {
      const b = res('aws_lambda_function').find((x) => attr(x, 'function_name') === `"${fn}"`);
      return /environment\s*\{\s*variables\s*=\s*\{([\s\S]*?)\}\s*\}/.exec(b?.body ?? '')?.[1] ?? '';
    };
    for (const fn of ['createEmployee', 'lookupInvite', 'redeemInvite']) {
      const src = sourceOf(fn);
      const env = envOf(fn);
      if (/COMPANY_NAME/.test(src)) expect(env, `${fn} reads COMPANY_NAME, so it is set from var.company_name`).toMatch(/COMPANY_NAME\s*=\s*var\.company_name\b/);
      if (/APP_URL/.test(src)) expect(env, `${fn} reads APP_URL, so it is set from var.app_url`).toMatch(/APP_URL\s*=\s*var\.app_url\b/);
      if (fn !== 'createEmployee') expect(env, `${fn}: no INVITE_TEST_LINK`).not.toMatch(/INVITE_TEST_LINK/);
    }
    expect(sourceOf('createEmployee'), 'createEmployee (or the helper it imports) reads COMPANY_NAME').toMatch(/COMPANY_NAME/);
    expect(sourceOf('createEmployee'), 'and APP_URL').toMatch(/APP_URL/);
    expect(sourceOf('lookupInvite'), 'lookupInvite reads COMPANY_NAME').toMatch(/COMPANY_NAME/);
    const flag = /INVITE_TEST_LINK\s*=\s*(.+)/.exec(envOf('createEmployee'))?.[1]?.trim() ?? '';
    expect(flag, 'createEmployee has INVITE_TEST_LINK').not.toBe('');
    const byEnv = /^var\.environment\s*==\s*"dev"\s*\?\s*"true"\s*:\s*"false"$/.test(flag);
    const byVar = /^(?:tostring\()?var\.(\w+)\)?$/.exec(flag);
    expect(byEnv || !!byVar, `INVITE_TEST_LINK is var.environment == "dev" ? "true" : "false", or a variable (got ${flag})`).toBe(true);
    if (byVar) {
      expect(String(defaultOf(byVar[1]!) ?? ''), `var.${byVar[1]}: prod default is not true`).toMatch(/^(false|"false")$/);
      expect(String(tfvar(byVar[1]!) ?? ''), `dev.tfvars sets ${byVar[1]} to true`).toMatch(/^(true|"true")$/);
    }

    // 8. The cleanup removes the invite rows of the people it removes.
    const cleanup = readFileSync(join(REPO, 'scripts', 'ci', 'cleanup-dev-e2e.py'), 'utf8');
    expect(cleanup, 'cleanup-dev-e2e.py knows the invite table').toContain(INVITES);
    expect(cleanup, 'and finds a person\'s links by employee-index').toContain('employee-index');

    // 9. The API description, in both copies.
    for (const spec of [join(REPO, 'api', 'openapi.yaml'), join(REPO, 'lambda', 'serveDocs', 'spec.yaml')]) {
      const route = (p: string, m: string) => JSON.parse(execFileSync('python3', [join(__dirname, 'support', 'onb-15', 'openapi_route.py'), spec, p, m], { encoding: 'utf8' })) as { found: boolean; responses: string[]; fields: Record<string, string[]>; request: string[] };
      const where = spec.includes('serveDocs') ? 'serveDocs/spec.yaml' : 'api/openapi.yaml';
      const look = route('/v1/invites/lookup', 'post');
      expect(look.found, `${where}: POST /v1/invites/lookup`).toBe(true);
      expect(look.responses, `${where}: lookup 200 and 400`).toEqual(expect.arrayContaining(['200', '400']));
      expect(look.request, `${where}: lookup takes token`).toContain('token');
      expect(look.fields['200'], `${where}: lookup 200 fields`).toEqual(expect.arrayContaining(['status', 'company', 'firstName', 'email', 'startDate', 'hrPartnerName']));
      expect(look.fields['200'], `${where}: no employee_id`).not.toContain('employee_id');
      const red = route('/v1/invites/redeem', 'post');
      expect(red.found, `${where}: POST /v1/invites/redeem`).toBe(true);
      expect(red.responses, `${where}: redeem 204, 400, 410 and 502`).toEqual(expect.arrayContaining(['204', '400', '410', '502']));
      expect(red.request, `${where}: redeem takes token and password`).toEqual(expect.arrayContaining(['token', 'password']));
      expect(red.fields['400'], `${where}: redeem 400 has error and fields`).toEqual(expect.arrayContaining(['error', 'fields']));
      expect(red.fields['410'], `${where}: redeem 410 has status`).toContain('status');
      const post = route('/v1/employees', 'post');
      expect(post.fields['201'], `${where}: POST /v1/employees 201 describes invite.link and email.skipped`).toEqual(expect.arrayContaining(['invite', 'link', 'skipped']));
    }
  });

  // -------------------------------------------------------------- AC-12
  test('AC-12 The email reads on a phone and in plain text: heading and button in full, nothing wider than the screen, a 44-pixel button', async ({ page }, testInfo) => {
    test.skip(ON_DEV, 'No-backend run only: it runs createEmployee against a fake AWS.');
    const run = create(worldWithPool(), HR, validBody({ hr_staff_id: PARTNER.id }));
    expectStatus(run, 201, 'createEmployee');
    const msg = mails(run)[0]!.message;
    await page.setContent(String(msg.HtmlBody ?? ''), { waitUntil: 'load' });
    const width = page.viewportSize()!.width;
    expect(await page.evaluate(() => window.innerWidth), `the email lays out at the screen's ${width} pixels (a viewport meta tag)`).toBe(width);
    const heading = page.getByText(HEADING, { exact: true }).first();
    await expect(heading, 'the heading is visible').toBeVisible();
    const hb = (await heading.boundingBox())!;
    expect(hb.x, 'the heading starts on screen').toBeGreaterThanOrEqual(0);
    expect(hb.x + hb.width, 'the heading ends on screen').toBeLessThanOrEqual(width + 0.5);
    const btn = page.getByRole('link', { name: 'Set your password', exact: true });
    await expect(btn, 'the button is visible').toBeVisible();
    const bb = (await btn.boundingBox())!;
    expect(bb.x, 'the button starts on screen').toBeGreaterThanOrEqual(0);
    expect(bb.x + bb.width, 'the button ends on screen').toBeLessThanOrEqual(width + 0.5);
    expect(bb.height, 'the button is at least 44 pixels tall').toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'nothing is wider than the screen').toBeLessThanOrEqual(width);

    const text = String(msg.TextBody ?? '');
    expect(text, 'the plain text has no HTML').not.toMatch(/<\/?[a-z][^>]*>|&[a-z]+;|&#\d+;/i);
    const link = [...text.matchAll(LINK_IN_TEXT)][0]?.[0];
    expect(link, 'the plain text has the link').toBeTruthy();
    expect(text.split(/\r?\n/).some((l) => l.trim() === link), 'on one line, by itself').toBe(true);
  });

  // -------------------------------------------------------------- AC-13
  test('AC-13 Five refused passwords close the link: the fifth is still a 400, then the link says expired and sets nothing', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const reg = registered(worldWithPool(), { hr_staff_id: PARTNER.id });
    let w = reg.run.world;
    const day1 = at(T0, DAY);
    for (let i = 1; i <= 4; i++) {
      const r = redeem(w, reg.token, `weak${i}`, { now: day1 });
      expectStatus(r, 400, `refused password ${i}`);
      w = r.world;
      expect(lookup(w, reg.token, { now: day1 }).body?.status, `after ${i} refused password(s) the link still works`).toBe('ok');
    }
    const row = invites(w).find((r) => sha256(reg.token).includes(String(r['token_hash'])));
    expect(Number(row?.['failed_attempts']), 'the row counts the refused passwords in failed_attempts').toBe(4);
    const fifth = redeem(w, reg.token, 'weak5', { now: day1 });
    expectStatus(fifth, 400, 'the fifth refused password');
    expect(fifth.body?.fields?.password, 'still names the rules').toContain('minLength');
    w = fifth.world;
    const closed = lookup(w, reg.token, { now: day1 });
    expect(closed.body, 'after five, lookup says expired, as for an old link (HR sends a new one)').toEqual({ status: 'expired', company: COMPANY, hrPartnerName: PARTNER.name });
    const good = redeem(w, reg.token, GOOD_PASSWORD, { now: day1 });
    expectStatus(good, 410, 'a good password after five refusals');
    expect(good.body, '410 { status: "expired" }').toEqual({ status: 'expired' });
    expect(cognitoCalls(good, 'AdminSetUserPassword'), 'nothing is set').toEqual([]);
    expect(good.world.cognito.users.find((u) => u.username.toLowerCase() === reg.email)?.status, 'the person still cannot sign in').toBe('FORCE_CHANGE_PASSWORD');
    expect(current(good.world), 'no usable link is left').toEqual([]);

    // A new link (ONB-18's resend) starts again at zero.
    const person = employees(good.world).find((e) => e['email'] === reg.email)!;
    const again = issue(good.world, { employee: { ...person, employeeId: person['employee_id'], firstName: person['first_name'], lastName: person['last_name'] }, hrPartner: null, sentBy: 'E2EHR01' });
    expect(again.error, `issueInvite did not throw (${again.error?.message})`).toBeUndefined();
    const fresh = String(again.response?.token ?? '');
    const r = redeem(again.world, fresh, 'weak6', { now: day1 });
    expectStatus(r, 400, 'a refused password on the new link');
    expect(lookup(r.world, fresh, { now: day1 }).body?.status, 'the new link still works').toBe('ok');
    expectStatus(redeem(r.world, fresh, GOOD_PASSWORD, { now: day1 }), 204, 'and sets the password');
  });

  // -------------------------------------------------------------- AC-5 (pepla-dev)
  test('AC-5 pepla-dev: HR registers a test address, gets the link, sets a password once, and the person signs in with it @pepla-dev', async ({ page, signIn, hr }, testInfo) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only: AC-1 to AC-12 hold everything else in the no-backend run.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once, at one width.');
    test.setTimeout(180_000);
    const { api, clientId, region } = devEnv();
    const token = await signInForToken(page, signIn, hr);
    const email = `e2e.run-onb04-${Date.now()}-${Math.floor(Math.random() * 1e4)}@blackhole.postmarkapp.com`;
    const created = await page.request.post(`${api}/v1/employees`, {
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      data: { first_name: 'Zinhle', last_name: 'Invite', email, phone: '082 000 0000', department: 'Operations', job_title: 'Test starter', planned_start_date: '2026-12-01' },
    });
    expect(created.status(), 'POST /v1/employees: 201').toBe(201);
    const body = (await created.json()) as { email?: { sent?: boolean; skipped?: string }; invite?: { link?: string } };
    expect(body.email, 'email { sent: false, skipped: "test" }').toEqual({ sent: false, skipped: 'test' });
    const m = /\/set-password#token=([A-Za-z0-9_-]{43})$/.exec(body.invite?.link ?? '');
    expect(m, 'invite.link carries a 43-character token').toBeTruthy();
    const invite = m![1]!;

    const look = async () => {
      const r = await page.request.post(`${api}/v1/invites/lookup`, { headers: { 'content-type': 'application/json' }, data: { token: invite } });
      expect(r.status(), 'lookup: 200').toBe(200);
      return (await r.json()) as { status: string; email?: string };
    };
    const first = await look();
    expect(first.status, 'lookup says ok').toBe('ok');
    expect(first.email, 'with the test address').toBe(email);

    const password = `Dev-${Math.random().toString(36).slice(2, 10)}-Aa9!`;
    const set = await page.request.post(`${api}/v1/invites/redeem`, { headers: { 'content-type': 'application/json' }, data: { token: invite, password } });
    expect(set.status(), 'redeem: 204').toBe(204);
    const again = await page.request.post(`${api}/v1/invites/redeem`, { headers: { 'content-type': 'application/json' }, data: { token: invite, password: `${password}x` } });
    expect(again.status(), 'the same link again: 410').toBe(410);
    expect(((await again.json()) as { status?: string }).status, 'used').toBe('used');
    expect((await look()).status, 'lookup now says used').toBe('used');

    const auth = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
      data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: email, PASSWORD: password } }),
    });
    expect(auth.status(), 'the new password signs the person in at Cognito').toBe(200);
    const result = (await auth.json()) as { AuthenticationResult?: { IdToken?: string }; ChallengeName?: string };
    expect(result.ChallengeName, 'with no new-password challenge').toBeUndefined();
    expect(result.AuthenticationResult?.IdToken, 'and an ID token').toBeTruthy();
  });
});

