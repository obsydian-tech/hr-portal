import { join } from 'node:path';
import type { TestInfo } from '@playwright/test';
import { ON_DEV, expect, test } from './support/fixtures';
import { blocks, tfFiles } from './support/infra-harness';
import { policyOf, resourcesNamed } from './support/onb-15/tf-policy';
import { tablesIn, tenancyGrant } from './support/ten-02/relock';
import type { Statement } from './support/ops-05/iam-eval';
import {
  GOOD_PASSWORD, HR, INVITES, OTHER_PASSWORD, T0, at, cognitoCalls, create, current, dynamoCalls, employees, existingUser, invites, issue, issueArgs, logLines,
  lookup, mails, plain, redeem, sha256, storedEmployee, tokenOf, userOf, validBody, withUser, worldWithPool, type Run, type World,
} from './support/onb-04.2/lambda-harness';

/**
 * ONB-04.2 · An invite never takes over an existing sign-in (Jira NH-191, epic NH-150; follows ONB-04, NH-170).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-04.2.md (16 Nov 2026)
 *
 * The rule: a link may only finish setting up a sign-in nobody has used yet (Cognito status FORCE_CHANGE_PASSWORD)
 * that belongs to no group except `employee`. AC-1 to AC-4 run the real createEmployee and redeemInvite handlers
 * and lambda/shared/invite.mjs (issueInvite), each in a fresh Node process, against support/onb-04.2/fake-aws
 * (ONB-04's fake AWS plus Cognito's AdminListGroupsForUser), with a fixed clock. They run once, in desktop-1280.
 * AC-5 reads infra/*.tf as text. Nothing runs on pepla-dev, and nothing here calls AWS, Postmark or any AI service.
 *
 * ONB-04's success answer for redeem is 204 with no body (ONB-04 AC-2, locked). The card says "200"; the tests
 * hold the locked 204.
 *
 * These files are locked once the lock check accepts them: see ./README.md and cards/onb-04.2.md.
 */

const RETRY = 'Could not set the password. Try again.';
const TOKEN43 = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;
const EMAIL = 'ayanda.zulu@mokoena.co.za';

function lambdaOnce(testInfo: TestInfo): void {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambdas against a fake AWS.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Runs the Lambdas once: they have no screen width.');
}
const textOnce = (testInfo: TestInfo) => {
  test.skip(ON_DEV, 'No-backend run only: it reads the repository as text.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Reads the repository once: it has no screen width.');
};

function expectStatus(run: Run, status: number, what: string): void {
  expect(run.error, `${what}: the handler did not throw (${run.error?.message})`).toBeUndefined();
  expect(run.status, `${what}: HTTP ${status} (got ${run.status}, ${run.raw.slice(0, 300)})`).toBe(status);
}

/** A log line as one string: its message and every extra field. */
const said = (l: { message: string; extra?: unknown }) => `${l.message} ${JSON.stringify(l.extra ?? '')}`;

/** No log line of a run carries the address, a token, a link or a password. */
function logsClean(run: Run, what: string, secrets: string[]): void {
  for (const l of logLines(run)) {
    const s = said(l);
    expect(s.toLowerCase(), `${what}: no log line carries the address (${s.slice(0, 200)})`).not.toContain(EMAIL);
    expect(s, `${what}: no log line carries a token or a link`).not.toMatch(new RegExp(`${TOKEN43.source}|set-password#token=`));
    for (const x of secrets) expect(s, `${what}: no log line carries a token or a password`).not.toContain(x);
  }
}

/** Registers a person from a normal HR login and hands back the run and the emailed token. */
function registered(w: World, over: Record<string, unknown> = {}): { run: Run; token: string; email: string } {
  const b = validBody(over);
  const run = create(w, HR, b);
  expectStatus(run, 201, `createEmployee for ${String(b['email'])}`);
  return { run, token: tokenOf(run), email: String(b['email']).toLowerCase() };
}

/** issueInvite for a stored person; hands back the run, and the token when it made one. */
function issueFor(w: World, person: ReturnType<typeof storedEmployee>): { run: Run; token: string } {
  const run = issue(w, issueArgs(person));
  return { run, token: String((run.response as { token?: string } | undefined)?.token ?? '') };
}

// ================================================================ the tests

test.describe('ONB-04.2 An invite never takes over an existing sign-in', () => {
  // -------------------------------------------------------------- AC-1
  test('AC-1 A brand-new address works as before: the sign-in is made, one link is sent, and the link sets the password once', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const w0 = worldWithPool();
    expect(userOf(w0, EMAIL), 'the address has no sign-in before').toBeUndefined();
    const run = create(w0, HR, validBody());
    expectStatus(run, 201, 'createEmployee for a new address');
    expect(run.body?.cognito?.userCreated, 'cognito.userCreated: true').toBe(true);
    expect(run.body?.email?.sent, 'email.sent: true').toBe(true);
    expect(cognitoCalls(run, 'AdminCreateUser'), 'AdminCreateUser once').toHaveLength(1);
    const adds = cognitoCalls(run, 'AdminAddUserToGroup');
    expect(adds.map((c) => c.input.GroupName), 'AdminAddUserToGroup employee, once').toEqual(['employee']);
    expect(cognitoCalls(run, 'AdminSetUserPassword'), 'no password is set at create').toEqual([]);
    expect(invites(run.world), 'one invite row').toHaveLength(1);
    expect(mails(run), 'one email').toHaveLength(1);
    const token = tokenOf(run);
    const user = userOf(run.world, EMAIL);
    expect(user?.status, 'the new sign-in waits for its first password').toBe('FORCE_CHANGE_PASSWORD');
    expect(user?.groups, 'and is in employee only').toEqual(['employee']);

    const ok = redeem(run.world, token, GOOD_PASSWORD, { now: at(T0, 3600) });
    expectStatus(ok, 204, 'redeem with a good password');
    const sets = cognitoCalls(ok, 'AdminSetUserPassword');
    expect(sets, 'AdminSetUserPassword once').toHaveLength(1);
    expect(sets[0]!.input.Permanent, 'Permanent: true').toBe(true);
    expect(String(sets[0]!.input.Username).toLowerCase(), 'for the person\'s address').toBe(EMAIL);
    expect(userOf(ok.world, EMAIL)?.status, 'the person can now sign in (CONFIRMED)').toBe('CONFIRMED');
    expect(userOf(ok.world, EMAIL)?.password, 'with the password they chose').toBe(GOOD_PASSWORD);
    expect(lookup(ok.world, token, { now: at(T0, 3660) }).body?.status, 'the link is used').toBe('used');
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 A resend to someone who never set a password works: a new link, the old one closed, and the new one sets the password', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    // (a) The first link was made by issueInvite, so the sign-in exists in FORCE_CHANGE_PASSWORD with [employee].
    const person = storedEmployee();
    const email = String(plain(person)!['email']).toLowerCase();
    const w0 = worldWithPool();
    w0.tables.employees.push(person);
    const first = issueFor(w0, person);
    expect(first.run.error, `first link: issueInvite did not throw (${first.run.error?.message})`).toBeUndefined();
    expect(userOf(first.run.world, email)?.status, 'the sign-in waits for its first password').toBe('FORCE_CHANGE_PASSWORD');
    expect(userOf(first.run.world, email)?.groups, 'in employee only').toEqual(['employee']);

    // (b) The same sign-in, but in no group at all (an earlier AdminAddUserToGroup never ran).
    const noGroups = withUser(first.run.world, email, (u) => { u.groups = []; });

    for (const [w, what] of [[first.run.world, 'groups [employee]'], [noGroups, 'no groups']] as const) {
      const again = issueFor(w, person);
      expect(again.run.error, `${what}: issueInvite did not throw (${again.run.error?.name}: ${again.run.error?.message})`).toBeUndefined();
      expect(again.token, `${what}: a new 43-character token`).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(again.token, `${what}: not the first one`).not.toBe(first.token);
      expect(cognitoCalls(again.run, 'AdminSetUserPassword'), `${what}: issueInvite never sets a password`).toEqual([]);
      expect(userOf(again.run.world, email)?.groups, `${what}: the sign-in ends in employee only`).toEqual(['employee']);
      expect(userOf(again.run.world, email)?.status, `${what}: still waiting for its first password`).toBe('FORCE_CHANGE_PASSWORD');
      expect(lookup(again.run.world, first.token).body?.status, `${what}: the first link now says expired`).toBe('expired');
      expect(current(again.run.world), `${what}: exactly one link is current`).toHaveLength(1);
      expect(sha256(again.token), `${what}: the current link is the new one`).toContain(String(current(again.run.world)[0]!['token_hash']));

      const ok = redeem(again.run.world, again.token, GOOD_PASSWORD, { now: at(T0, 3600) });
      expectStatus(ok, 204, `${what}: redeem of the new link`);
      expect(cognitoCalls(ok, 'AdminSetUserPassword'), `${what}: AdminSetUserPassword once`).toHaveLength(1);
      expect(userOf(ok.world, email)?.status, `${what}: the person can now sign in`).toBe('CONFIRMED');
    }

    // (c) A sign-in that exists in FORCE_CHANGE_PASSWORD with no group and no earlier link (made outside this flow).
    const w1 = worldWithPool();
    w1.tables.employees.push(person);
    w1.cognito.users.push(existingUser(email, 'FORCE_CHANGE_PASSWORD', [], 'Lindiwe', 'Mokoena'));
    const fresh = issueFor(w1, person);
    expect(fresh.run.error, `existing sign-in, no groups, no earlier link: issueInvite did not throw (${fresh.run.error?.name})`).toBeUndefined();
    expect(fresh.token, 'a token').toMatch(/^[A-Za-z0-9_-]{43}$/);
    const ok = redeem(fresh.run.world, fresh.token, GOOD_PASSWORD, { now: at(T0, 3600) });
    expectStatus(ok, 204, 'redeem of that link');
    expect(userOf(ok.world, email)?.status, 'the person can now sign in').toBe('CONFIRMED');
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 An address that is already in use is refused at invite time: nothing is added, written or sent, and the log says InviteRefused', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const STATES: Array<[string, string, string[]]> = [
      ['(a) CONFIRMED with [employee]', 'CONFIRMED', ['employee']],
      ['(b) CONFIRMED with [hr_staff]', 'CONFIRMED', ['hr_staff']],
      ['(c) FORCE_CHANGE_PASSWORD with [hr_staff]', 'FORCE_CHANGE_PASSWORD', ['hr_staff']],
      ['(d) FORCE_CHANGE_PASSWORD with [employee, naleko-onboarding-hr]', 'FORCE_CHANGE_PASSWORD', ['employee', 'naleko-onboarding-hr']],
      ['(e) RESET_REQUIRED with no group', 'RESET_REQUIRED', []],
    ];

    // Through createEmployee: HR adds a person whose address already has a sign-in.
    for (const [what, status, groups] of STATES) {
      const w = worldWithPool();
      w.cognito.users.push(existingUser(EMAIL, status, groups));
      const before = structuredClone(userOf(w, EMAIL)!);
      const run = create(w, HR, validBody());
      expectStatus(run, 201, `${what}: createEmployee still saves the employee`);
      const id = String(run.body?.employee?.employee_id ?? '');
      expect(id, `${what}: the saved employee is in the answer`).toMatch(/^[0-9a-f-]{36}$/);
      expect(employees(run.world).map((e) => e['employee_id']), `${what}: the employee row stays`).toEqual([id]);
      expect(run.body?.cognito?.userCreated, `${what}: cognito.userCreated: false`).toBe(false);
      expect(run.body?.email?.sent, `${what}: email.sent: false`).toBe(false);
      expect(run.body?.invite, `${what}: no invite in the answer`).toBeUndefined();
      expect(run.raw, `${what}: no link anywhere in the answer`).not.toMatch(/set-password|token=/);

      expect(cognitoCalls(run, 'AdminAddUserToGroup'), `${what}: no AdminAddUserToGroup`).toEqual([]);
      expect(cognitoCalls(run, 'AdminSetUserPassword'), `${what}: no AdminSetUserPassword`).toEqual([]);
      const inviteWrites = dynamoCalls(run).filter((c) => c.table === INVITES && ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'].includes(c.op));
      expect(inviteWrites.map((c) => c.op), `${what}: nothing written to the invite table (no PutItem, no replaced_at update)`).toEqual([]);
      expect(invites(run.world), `${what}: no invite row`).toEqual([]);
      expect(userOf(run.world, EMAIL), `${what}: the sign-in is exactly as it was (status, groups, password)`).toEqual(before);
      expect(mails(run), `${what}: Postmark is not called`).toEqual([]);

      const failed = logLines(run).filter((l) => l.message.includes('Invite failed'));
      expect(failed, `${what}: one "Invite failed" log line (lines: ${logLines(run).map((l) => l.message).join(' | ').slice(0, 300)})`).toHaveLength(1);
      expect(failed[0]!.level, `${what}: logged as an error, as the InviteFailed alarm expects`).toMatch(/error/i);
      expect(said(failed[0]!), `${what}: the line carries the employee id`).toContain(id);
      expect(said(failed[0]!), `${what}: the line names InviteRefused`).toContain('InviteRefused');
      logsClean(run, what, []);
    }

    // Through issueInvite directly (ONB-18's resend): the person already has a current link, then the sign-in is in use.
    const person = storedEmployee({ email: EMAIL });
    for (const [what, status, groups] of STATES) {
      const w0 = worldWithPool();
      w0.tables.employees.push(person);
      const first = issueFor(w0, person);
      expect(first.run.error, `${what}: the first link is made (${first.run.error?.message})`).toBeUndefined();
      const w = withUser(first.run.world, EMAIL, (u) => {
        u.status = status;
        u.groups = [...groups];
        if (status === 'CONFIRMED') u.password = 'Someone-Elses-Pass1!';
      });
      const before = structuredClone(userOf(w, EMAIL)!);
      const rowsBefore = invites(w);
      const again = issueFor(w, person);
      expect(again.run.error?.name, `${what}: issueInvite throws InviteRefused (got ${again.run.error?.name ?? 'no error'})`).toBe('InviteRefused');
      expect(again.token, `${what}: no token handed back`).toBe('');
      expect(cognitoCalls(again.run, 'AdminAddUserToGroup'), `${what}: no AdminAddUserToGroup`).toEqual([]);
      expect(cognitoCalls(again.run, 'AdminSetUserPassword'), `${what}: no AdminSetUserPassword`).toEqual([]);
      const writes = dynamoCalls(again.run).filter((c) => c.table === INVITES && ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'].includes(c.op));
      expect(writes.map((c) => c.op), `${what}: no invite PutItem and no replaced_at update`).toEqual([]);
      expect(invites(again.run.world), `${what}: the invite rows are untouched`).toEqual(rowsBefore);
      expect(lookup(again.run.world, first.token).body?.status, `${what}: the earlier link is not closed by the refused resend`).toBe('ok');
      expect(userOf(again.run.world, EMAIL), `${what}: the sign-in is exactly as it was`).toEqual(before);
      expect(mails(again.run), `${what}: no email`).toEqual([]);
      logsClean(again.run, `${what} (issueInvite)`, [first.token]);
    }
  });

  // -------------------------------------------------------------- AC-4
  test('AC-4 A link cannot set the password of a sign-in that is already in use: 410 used, nothing set, the link stays used', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const CASES: Array<[string, (u: any) => void, RegExp | null]> = [
      ['(a) CONFIRMED (set by another route)', (u) => { u.status = 'CONFIRMED'; u.password = 'Someone-Elses-Pass1!'; }, /\bstatus\b/],
      ['(b) FORCE_CHANGE_PASSWORD but now also in hr_staff', (u) => { u.groups = [...u.groups, 'hr_staff']; }, /\bgroups?\b/],
      ['(c) deleted', () => {}, null],
    ];
    for (const [what, change, reason] of CASES) {
      const reg = registered(worldWithPool());
      const id = String(reg.run.body?.employee?.employee_id ?? '');
      const w = what.startsWith('(c)') ? withUser(reg.run.world, EMAIL, null) : withUser(reg.run.world, EMAIL, change);
      const before = structuredClone(userOf(w, EMAIL));
      const r = redeem(w, reg.token, GOOD_PASSWORD, { now: at(T0, 3600) });
      expectStatus(r, 410, `${what}: redeem with a good password`);
      expect(r.body, `${what}: 410 { status: "used" }`).toEqual({ status: 'used' });
      expect(cognitoCalls(r, 'AdminSetUserPassword'), `${what}: no AdminSetUserPassword`).toEqual([]);
      expect(userOf(r.world, EMAIL), `${what}: the sign-in is exactly as it was`).toEqual(before);
      const row = invites(r.world).find((x) => sha256(reg.token).includes(String(x['token_hash'])));
      expect(row?.['used_at'], `${what}: the link stays claimed (used_at kept)`).toBeTruthy();
      expect(lookup(r.world, reg.token, { now: at(T0, 3660) }).body?.status, `${what}: lookup then says used`).toBe('used');
      const again = redeem(r.world, reg.token, OTHER_PASSWORD, { now: at(T0, 3720) });
      expectStatus(again, 410, `${what}: a second try`);
      expect(again.body, `${what}: still 410 { status: "used" }`).toEqual({ status: 'used' });
      expect(cognitoCalls(again, 'AdminSetUserPassword'), `${what}: nothing set on the second try`).toEqual([]);

      const refused = logLines(r).filter((l) => l.message.includes('Invite redeem refused'));
      expect(refused, `${what}: one "Invite redeem refused" line (lines: ${logLines(r).map((l) => l.message).join(' | ').slice(0, 300)})`).toHaveLength(1);
      expect(said(refused[0]!), `${what}: the line carries the employee id`).toContain(id);
      if (reason) expect(said(refused[0]!), `${what}: the line names the reason`).toMatch(reason);
      expect(said(refused[0]!), `${what}: the line names no group`).not.toMatch(/hr_staff/);
      logsClean(r, what, [reg.token, GOOD_PASSWORD]);
    }

    // A Cognito failure on either read is the 502 path: the claim is released and the same link works afterwards.
    for (const op of ['AdminGetUser', 'AdminListGroupsForUser']) {
      const reg = registered(worldWithPool());
      const sick: World = { ...reg.run.world, cognitoFail: [op] };
      const failed = redeem(sick, reg.token, GOOD_PASSWORD, { now: at(T0, 3600) });
      expectStatus(failed, 502, `redeem when Cognito ${op} fails`);
      expect(failed.body, `${op} fails: 502 { error }`).toEqual({ error: RETRY });
      expect(cognitoCalls(failed, 'AdminSetUserPassword'), `${op} fails: no AdminSetUserPassword`).toEqual([]);
      expect(cognitoCalls(failed, op), `${op} fails: redeem asked Cognito ${op}`).not.toHaveLength(0);
      const healthy: World = { ...failed.world, cognitoFail: [] };
      expect(lookup(healthy, reg.token, { now: at(T0, 3660) }).body?.status, `${op} fails: the claim is released (lookup says ok)`).toBe('ok');
      const retry = redeem(healthy, reg.token, GOOD_PASSWORD, { now: at(T0, 3720) });
      expectStatus(retry, 204, `${op} fails: the same link works once Cognito is healthy`);
      expect(userOf(retry.world, EMAIL)?.status, `${op} fails: the person can then sign in`).toBe('CONFIRMED');
      logsClean(failed, `${op} fails`, [reg.token, GOOD_PASSWORD]);
    }
  });

  // -------------------------------------------------------------- AC-5
  test('AC-5 The roles hold exactly this: redeemInvite and createEmployee may read the sign-in and its groups, nothing more', async ({}, testInfo) => {
    textOnce(testInfo);
    const files = tfFiles();
    const res = (type: string) => blocks(files, 'resource').filter((b) => b.labels[0] === type);
    const attr = (b: { body: string }, name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm').exec(b.body)?.[1]?.trim().replace(/\s+/g, '') ?? '';
    const flat = (s: Statement | Statement[]) => (Array.isArray(s) ? s : [s]).flatMap((st) => {
      const actions = ([] as string[]).concat((st.Action as string | string[] | undefined) ?? []);
      const resources = ([] as string[]).concat((st.Resource as string | string[] | undefined) ?? []);
      return actions.flatMap((action) => resources.map((resource) => ({ effect: st.Effect, action, resource: resource.replace(/\$\{([^}]+)\}/g, '$1') })));
    });
    const show = (r: { effect: string; action: string; resource: string }) => `${r.effect} ${r.action} ${r.resource}`;
    const ordinary = (a: string) => !a.startsWith('logs:') && !a.startsWith('xray:');
    const T = res('aws_dynamodb_table').find((b) => attr(b, 'name') === `"${INVITES}"`)?.labels[1] ?? INVITES;
    const isTable = (r: string) => r === `arn:aws:dynamodb:af-south-1:000000000000:table/${INVITES}` || r === `aws_dynamodb_table.${T}.arn`;
    const isEmployees = (r: string) => r === 'arn:aws:dynamodb:af-south-1:000000000000:table/employees' || r === 'aws_dynamodb_table.employees.arn';
    const isPool = (r: string) => /^arn:aws:cognito-idp:af-south-1:000000000000:userpool\/aws_cognito_user_pool\.naleko_dev\.id$/.test(r) || r === 'aws_cognito_user_pool.naleko_dev.arn';
    const noWildcards = (who: string, rows: ReturnType<typeof flat>) => {
      expect(rows.every((r) => r.effect === 'Allow'), `${who}: Allow only`).toBe(true);
      for (const r of rows) {
        expect(r.action, `${who}: no wildcard action (${r.action})`).not.toMatch(/\*/);
        if (r.resource === '*') expect(r.action, `${who}: Resource "*" only for X-Ray (${r.action})`).toMatch(/^xray:/);
      }
    };

    // redeemInvite: exactly these, and nothing else.
    const fn = res('aws_lambda_function').find((b) => attr(b, 'function_name') === '"redeemInvite"');
    expect(fn, 'a Terraform function named redeemInvite').toBeTruthy();
    const roleName = /aws_iam_role\.(\w+)\.arn/.exec(attr(fn!, 'role'))?.[1];
    expect(roleName, 'redeemInvite has a role of its own').toBeTruthy();
    const policies = res('aws_iam_role_policy').filter((b) => attr(b, 'role') === `aws_iam_role.${roleName}.name`);
    expect(policies, 'redeemInvite: one inline policy').toHaveLength(1);
    expect(res('aws_iam_role_policy_attachment').filter((b) => attr(b, 'role').includes(`aws_iam_role.${roleName}.`)), 'redeemInvite: no attached managed policy').toEqual([]);
    const rows = flat(policyOf(resourcesNamed('aws_iam_role_policy', policies[0]!.labels[1]!)[0]!).Statement);
    noWildcards('redeemInvite', rows);
    const WANT = [
      ['dynamodb:GetItem', isTable], ['dynamodb:UpdateItem', isTable], ['dynamodb:GetItem', isEmployees],
      ['cognito-idp:AdminSetUserPassword', isPool], ['cognito-idp:AdminGetUser', isPool], ['cognito-idp:AdminListGroupsForUser', isPool],
    ] as const;
    const extra = rows.filter((r) => ordinary(r.action));
    for (const [action, on] of WANT) expect(extra.some((r) => r.action === action && on(r.resource)), `redeemInvite may ${action} on the right resource`).toBe(true);
    expect(extra.filter((r) => !WANT.some(([action, on]) => r.action === action && on(r.resource))).map(show), 'redeemInvite: nothing else').toEqual([]);

    // createEmployee: against its policy at ONB-04 (#331, 9b22758), it gains exactly the two reads on the pool.
    const baselineFile = join(__dirname, 'support', 'onb-04.2', 'iam.create-employee.9b22758.tf.txt');
    const before = flat(policyOf(resourcesNamed('aws_iam_role_policy', 'create_employee', [baselineFile])[0]!).Statement).map(show).sort();
    const now = flat(policyOf(resourcesNamed('aws_iam_role_policy', 'create_employee')[0]!).Statement);
    const after = now.map(show).sort();
    expect(before.filter((x) => !after.includes(x)), 'createEmployee loses nothing').toEqual([]);
    const added = now.filter((r) => !before.includes(show(r)));
    const GAIN = [['cognito-idp:AdminGetUser', isPool], ['cognito-idp:AdminListGroupsForUser', isPool]] as const;
    for (const [action, on] of GAIN) expect(added.some((r) => r.action === action && on(r.resource)), `createEmployee gains ${action} on the pool`).toBe(true);
    // TEN-02 (re-lock): the company grants (Member rows, the employees tenant-index) are TEN-02's, not this card's.
    expect(added.filter((r) => !GAIN.some(([action, on]) => r.action === action && on(r.resource)) && !tenancyGrant(r.action, r.resource, tablesIn(before.map((b) => b.split(' ')[2]!)), true)).map(show), 'createEmployee gains nothing else').toEqual([]);
    expect(now.filter((r) => r.action === 'cognito-idp:AdminSetUserPassword').map(show), 'createEmployee still holds no AdminSetUserPassword').toEqual([]);
    noWildcards('createEmployee', now);
  });
});
