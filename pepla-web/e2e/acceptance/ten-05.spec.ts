import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { ON_DEV, expect, test } from './support/fixtures';
import { attributes, blocks, tfFiles, type Block } from './support/infra-harness';
import { devEnv } from './support/ten-02/dev';
import { DOCUMENT_CHECK, HR_GROUP_HELPER, LAMBDA, REPO, ROLES_HELPER, awsCalls, httpEvent, runModule, type Run } from './support/ten-05/lambda-harness';
import {
  A, B, CALLER_SUB, ID, POOL_GROUPS, TABLE, TENANTS, TEN05, ask, aws, bodyOf, describe, pool, rowsOf, statusOf, tables, type Caller,
} from './support/ten-05/world';
import {
  ALL_CALLERS, NEW_CALLERS, NEW_GROUPS, NOBODY_CALLERS, OLD_CALLERS, OLD_GROUPS, OLD_MANAGED, PERMS, PROBES, ROLES, ROLE_HANDLERS, grantOf, grantOfCaller, type Probe,
} from './support/ten-05/access';

/**
 * TEN-05 · One sign-in pool with five roles, every group in Terraform (Jira NH-197, epic NH-192). Red.
 * One test per acceptance criterion (AC-3 is split in three by route family), written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/TEN-05.md (16 Nov 2026), corrected against develop 1420ef9 in
 * TEN-05-refresh.md (17 Nov). Notes for the lock check: TEN-05-tests-for-review.md.
 *
 * The Lambda tests run the real handlers and shared modules, each call in its own Node process, against a fake AWS
 * (support/ten-05/fake-aws, copied from TEN-03's with code added only: Cognito AdminRemoveUserFromGroup and
 * AdminDisableUser, and the pool's group list). Company A is the founding company; B is a second one. Any AI client
 * fails; outbound HTTP is refused. AC-1, AC-4 and AC-8 read Terraform and code as text; AC-7 runs the old app's
 * deriveModules on its own. AC-9 runs on pepla-dev only.
 *
 * Pinned by the verifier (TEN-05-refresh.md says why):
 *  - R1 rolesOf(event) answers { roles, perms } with the group names themselves: roles admin, hr_staff, manager, employee,
 *    guest; perms perm-recruitment, perm-it, perm-approve-offers. Old names map through OLD_GROUPS (support/ten-05/access.ts),
 *    except that naleko-onboarding-hr gives nothing and naleko-talentflow-hr / HRDirector give perm-recruitment only:
 *    none of them passes an HR check today, and hrOnly keeps its answers (rule 3; BE-17.1, ONB-12, ONB-13 pin it).
 *    custom:isAdmin "true" and custom:roles (ADMIN, HM, IT, TA) map like TalentFlowAdmin, HiringManager, ITAdmin, HRDirector.
 *    Groups are split into exact names (JSON list, "[a b]", "a,b" and a real list); a token that is not an ID token has none.
 *  - R2 requireRole(event, { roles, perms }) is null when the caller holds one of them, else 403 {"error":"Forbidden"}.
 *  - R3 Who may do what is the table in support/ten-05/access.ts (PROBES). No caller of today's groups loses anything it
 *    can do on develop 1420ef9 (support/ten-05/baseline-1420ef9.json); where two old names now mean the same role, each
 *    gets what either had (listed in the refresh file).
 *  - R4 The user admin routes take { role, permissions } with the group names (role one of the five, permissions any
 *    of the three perm- names), or today's roles ADMIN, HM, IT, TA (ADMIN = admin + every tick, HM = manager +
 *    perm-recruitment, IT = perm-it, TA = perm-recruitment). They add only the eight new groups; an update also removes
 *    the eight and today's managed TalentFlowAdmin, HiringManager, ITAdmin, HRDirector, and touches nothing else.
 *  - R5 No read or write of the tenants table from the user admin routes or the pickers: it needs an IAM grant Iggie owes.
 *    A new user's profile row carries the caller's company; the Member row waits for that grant.
 * Nothing here calls AWS or any AI.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const FORBIDDEN = { error: 'Forbidden' };
const NOT_FOUND = { error: 'Not found' };

/** A company named outside the token: a header and the query string. It must change nothing (the company comes from the token only). */
const named = (company: string) => ({ headers: { 'x-tenant-id': company }, query: { tenant_id: company, tenantId: company, company } });
const steady = (s: string) => s.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<time>').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>');
/** The same answer and the same AWS calls as the call without the header and query. */
function sameAs(plainRun: Run, namedRun: Run, what: string) {
  expect(statusOf(namedRun), `${what}: same status as without the header and query\n${describe(namedRun)}`).toBe(statusOf(plainRun));
  expect(steady(JSON.stringify(bodyOf(namedRun))), `${what}: same answer as without the header and query`).toBe(steady(JSON.stringify(bodyOf(plainRun))));
  expect(steady(JSON.stringify(aws(namedRun))), `${what}: same AWS calls as without the header and query`).toBe(steady(JSON.stringify(aws(plainRun))));
}
/** More is more access: an answer below the one develop gave is a loss. */
const RANK: Record<string, number> = { no: 0, own: 0, scoped: 1, 'not-claimer': 1, yes: 2, all: 2, lead: 2 };
const BASELINE = JSON.parse(readFileSync(join(__dirname, 'support', 'ten-05', 'baseline-1420ef9.json'), 'utf8')) as Record<string, Record<string, string>>;

/** What a run answered, read the way the probe asks. */
function outcome(p: Probe, r: Run): string {
  const s = statusOf(r);
  const noAws = aws(r).length === 0;
  const body = bodyOf(r);
  if (p.read === 'gate') {
    if (s === 403 && noAws) return 'no';
    if ((p.ok ?? [200]).includes(s ?? -1)) return 'yes';
  } else if (p.read === 'bundle') {
    if (s === 200) return 'all';
    if (s === 404) return 'own';
  } else if (p.read === 'list') {
    if (s === 200) return (body?.bundles ?? []).some((b: any) => b.bundleId === ID.bundleA) ? 'all' : 'own';
  } else if (p.read === 'itList') {
    if (s === 403 && noAws) return 'no';
    if (s === 200) {
      const n = (body?.tasks ?? []).length;
      return n === 0 ? 'scoped' : n >= 5 ? 'all' : `? ${n} tasks`;
    }
  } else if (p.read === 'lead') {
    if (s === 403 && noAws) return 'no';
    if (s === 403) return 'not-claimer';
    if (s === 200) return 'lead';
  }
  return `? ${describe(r)}`;
}

/** Runs every caller on the probes and reports each answer that differs from the frozen one. */
function judge(probes: Probe[], callers: Caller[]) {
  const wrong: string[] = [];
  const refusals: string[] = [];
  for (const p of probes) {
    for (const c of callers) {
      const r = ask(p.handler, c, p.ask);
      const got = outcome(p, r);
      const want = p.want(c);
      if (got !== want) wrong.push(`${p.name} | ${c.name}: want ${want}, got ${got}`);
      // R3: nobody of today's groups loses what develop gave them.
      const before = BASELINE[p.name]?.[c.name];
      if (before !== undefined && (RANK[got] ?? -1) < (RANK[before] ?? -1)) wrong.push(`${p.name} | ${c.name}: LOST what develop gives (${before}), got ${got}`);
      if (p.gated && got === 'no' && JSON.stringify(bodyOf(r)) !== JSON.stringify(FORBIDDEN)) refusals.push(`${p.name} | ${c.name}: ${describe(r)}`);
    }
  }
  return { wrong, refusals };
}

test.describe('TEN-05 · One sign-in pool with five roles, every group in Terraform', () => {
  // ---------------------------------------------------------------- control

  test('Control: today\'s strongest TalentFlow sign-in gets through every route, and the frozen baseline is today\'s', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const strong: Caller = { name: 'strong', groups: ['TalentFlowAdmin', 'naleko-talentflow-admin', 'ITAdmin', 'HiringManager', 'hr_staff'], claims: { 'custom:isAdmin': 'true', 'custom:roles': '["ADMIN"]' } };
    const wrong: string[] = [];
    for (const p of PROBES) {
      const r = ask(p.handler, strong, p.ask);
      const got = outcome(p, r);
      if (!['yes', 'all', 'lead'].includes(got)) wrong.push(`${p.name}: ${got}`);
    }
    expect(wrong, 'the world is good enough: a sign-in with every old group gets a yes everywhere').toEqual([]);
    // The baseline file holds one answer per probe for every old-group caller.
    for (const p of PROBES) for (const c of OLD_CALLERS) expect(BASELINE[p.name]?.[c.name], `baseline holds ${p.name} | ${c.name}`).toBeTruthy();
  });

  // ---------------------------------------------------------------- AC-1

  test('AC-1 Groups exist in Terraform: the eight groups in the Naleko pool in both accounts, nothing removed', async ({}, testInfo) => {
    once(testInfo.project.name);
    const infra = join(REPO, 'infra');
    const groups = blocks(tfFiles(infra), 'resource').filter((b) => b.labels[0] === 'aws_cognito_user_group');
    const nameOf = (b: Block) => /^"(.*)"$/.exec(attributes(b.body).get('name') ?? '')?.[1];
    for (const name of NEW_GROUPS) {
      const found = groups.filter((b) => nameOf(b) === name);
      expect(found.map((b) => `${b.file}: ${b.labels[1]}`), `exactly one Terraform group named ${name} in infra/`).toHaveLength(1);
      const b = found[0]!;
      const a = attributes(b.body);
      expect(a.get('user_pool_id'), `${name}: in the Naleko pool`).toBe('aws_cognito_user_pool.naleko_dev.id');
      expect(a.has('count') || a.has('for_each'), `${name}: no count or for_each, so prod gets it too`).toBe(false);
      expect(b.file.endsWith('cognito.tf'), `${name}: in infra/cognito.tf`).toBe(true);
    }
    // Every group Terraform had on develop 1420ef9 is still there under the same address and name.
    const before: Array<[string, string]> = [['onboarding_hr', 'naleko-onboarding-hr'], ['talentflow_hr', 'naleko-talentflow-hr'], ['it_provisioning', 'naleko-it-provisioning'], ['hr_staff', 'hr_staff'], ['employee', 'employee'], ['e2e_robots', 'e2e-robots']];
    for (const [label, name] of before) {
      const b = groups.filter((x) => x.labels[1] === label);
      expect(b, `aws_cognito_user_group.${label} is still there`).toHaveLength(1);
      expect(nameOf(b[0]!), `aws_cognito_user_group.${label} keeps the name ${name}`).toBe(name);
    }
    const squash = (s: string) => s.replace(/#.*$/gm, '').replace(/\s+/g, '');
    const robots = groups.find((x) => x.labels[1] === 'e2e_robots')!;
    expect(squash(robots.body), 'e2e-robots is unchanged (dev only)').toBe(squash(`count = var.environment == "prod" ? 0 : 1
      name         = "e2e-robots"
      user_pool_id = aws_cognito_user_pool.naleko_dev.id
      description  = "Test logins for end-to-end runs: AI services are never called for them"`));
    // No group is removed or moved, in either stack; the TalentFlow pool's groups stay as they are (TEN-06).
    for (const dir of [infra, join(REPO, 'talent-flow-infra')]) {
      const files = tfFiles(dir);
      const gone = [...blocks(files, 'removed'), ...blocks(files, 'moved')].map((b) => b.raw.replace(/\s+/g, '')).filter((t) => /aws_cognito_user_group/.test(t));
      expect(gone, `${dir}: no removed or moved block for a group`).toEqual([]);
    }
    const tfGroups = blocks(tfFiles(join(REPO, 'talent-flow-infra')), 'resource').filter((b) => b.labels[0] === 'aws_cognito_user_group');
    expect(tfGroups.map((b) => b.labels[1]), 'the TalentFlow pool keeps its one group resource').toEqual(['talent_flow']);
    const locals = readFileSync(join(REPO, 'talent-flow-infra', 'locals.tf'), 'utf8');
    const set = /tf_cognito_groups\s*=\s*toset\(\[([\s\S]*?)\]\)/.exec(locals)?.[1] ?? '';
    expect([...set.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort(), 'the TalentFlow pool keeps its seven groups').toEqual(['ComplianceOfficer', 'FinanceLead', 'HRDirector', 'HiringManager', 'ITAdmin', 'PanelMember', 'TalentFlowAdmin']);
    // Imports: the BE-16 ones stay; any new one adopts one of the new groups, by the pool id and its name, in both accounts.
    const imports = blocks(tfFiles(infra), 'import');
    const to = (b: Block) => attributes(b.body).get('to') ?? '';
    for (const label of ['hr_staff', 'employee']) expect(imports.filter((b) => to(b) === `aws_cognito_user_group.${label}`), `the import of ${label} stays`).toHaveLength(1);
    const groupImports = imports.filter((b) => /^aws_cognito_user_group\./.test(to(b)));
    const newLabels = new Set(groups.filter((b) => NEW_GROUPS.includes(nameOf(b) ?? '') && !['hr_staff', 'employee'].includes(nameOf(b) ?? '')).map((b) => b.labels[1]));
    for (const b of groupImports) {
      const label = /^aws_cognito_user_group\.([\w-]+)(\[.*\])?$/.exec(to(b))?.[1] ?? '';
      if (['hr_staff', 'employee', 'e2e_robots'].includes(label)) continue;
      expect(newLabels.has(label), `an import adopts only a new group (${to(b)})`).toBe(true);
      const g = groups.find((x) => x.labels[1] === label)!;
      expect(attributes(b.body).get('id'), `${to(b)}: id is the pool id and the group name`).toBe(`"\${aws_cognito_user_pool.naleko_dev.id}/${nameOf(g)}"`);
      expect(attributes(b.body).has('for_each'), `${to(b)}: in both accounts`).toBe(false);
    }
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 The helper: rolesOf maps every old and new group, ignores near names, reads both claim forms; requireRole answers Forbidden', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect(existsSync(ROLES_HELPER), 'lambda/shared/roles.mjs exists').toBe(true);
    const ev = (claims: Record<string, unknown> | undefined) => httpEvent({ authorizer: claims === undefined ? undefined : { jwt: { claims: { sub: CALLER_SUB, token_use: 'id', tenant_id: A, ...claims }, scopes: null } } });
    const sorted = (v: any) => ({ roles: [...(v?.roles ?? [])].sort(), perms: [...(v?.perms ?? [])].sort() });

    // Every single name: the new ones as themselves, the old ones through OLD_GROUPS, the near ones as nothing.
    const names = [...NEW_GROUPS, ...Object.keys(OLD_GROUPS), 'e2e-robots', 'hr_staffx', 'xhr_staff', 'hr_staff2', 'employees', 'x-employee', 'managers', 'xmanager', 'guests', 'admins', 'administrator', 'Admin', 'ADMIN',
      'perm-recruitmentx', 'xperm-recruitment', 'perm-', 'perm-itx', 'perm-approve-offersx', 'perm-approve', 'not_hr_staff', 'TalentFlowAdminx', 'xITAdmin', 'itadmin', 'naleko-talentflow-adminx', 'naleko-talentflow', 'HiringManagers'];
    const cases: Array<[string, Record<string, unknown> | undefined, ReturnType<typeof grantOf>]> = [];
    for (const n of names) cases.push([`"[${n}]"`, { 'cognito:groups': `[${n}]` }, grantOf([n])]);
    // Both forms API Gateway sends, a JSON list, a comma list and a real list, with several names.
    const many = ['employee', 'perm-it', 'PanelMember', 'naleko-onboarding-hr', 'xhr_staff'];
    const want = grantOf(many);
    cases.push(['"[a b c]" form', { 'cognito:groups': `[${many.join(' ')}]` }, want]);
    cases.push(['JSON list form', { 'cognito:groups': JSON.stringify(many) }, want]);
    cases.push(['comma form', { 'cognito:groups': many.join(',') }, want]);
    cases.push(['a real list', { 'cognito:groups': many }, want]);
    cases.push(['every new group', { 'cognito:groups': `[${NEW_GROUPS.join(' ')}]` }, { roles: [...ROLES].sort(), perms: [...PERMS].sort() }]);
    cases.push(['substring of a list', { 'cognito:groups': '[hr_staff_reader employee_x]' }, { roles: [], perms: [] }]);
    // The TalentFlow pool claims.
    for (const [k, v] of [['custom:isAdmin', 'true'], ['custom:roles', '["ADMIN"]'], ['custom:roles', '["HM"]'], ['custom:roles', '["IT"]'], ['custom:roles', '["TA"]'], ['custom:roles', '["HM","IT"]'], ['custom:isAdmin', 'false'], ['custom:isAdmin', 'TRUE'], ['custom:roles', 'ADMIN'], ['custom:roles', '["admin"]']] as const) {
      cases.push([`${k} = ${v}`, { [k]: v }, grantOf([], { [k]: v })]);
    }
    // Nothing for a token that is not an ID token, for no claims, for an agent.
    const none = { roles: [], perms: [] };
    cases.push(['access token in admin', { 'cognito:groups': '[admin hr_staff]', token_use: 'access' }, none]);
    cases.push(['token_use "ID"', { 'cognito:groups': '[admin]', token_use: 'ID' }, none]);
    cases.push(['no groups claim', {}, none]);
    cases.push(['empty "[]"', { 'cognito:groups': '[]' }, none]);
    cases.push(['no authorizer', undefined, none]);

    const steps = cases.map(([, claims]) => ({ fn: 'rolesOf', args: [ev(claims)] }));
    const run = runModule(ROLES_HELPER, steps);
    expect(run.importError, 'roles.mjs imports').toBeUndefined();
    for (const name of ['rolesOf', 'requireRole', 'OLD_GROUPS']) expect(run.exports, `roles.mjs exports ${name}`).toContain(name);
    const wrong = cases.map(([what, , w], i) => ({ what, want: w, got: run.results[i]?.ok ? sorted(run.results[i]!.value) : run.results[i] })).filter((x) => JSON.stringify(x.want) !== JSON.stringify(x.got));
    expect(wrong, 'rolesOf gives exactly the pinned roles and ticks').toEqual([]);
    expect(awsCalls(run.calls), 'rolesOf calls no AWS service').toEqual([]);

    // requireRole: null when one listed role or tick is held, else 403 {"error":"Forbidden"}.
    const rr: Array<[string, Record<string, unknown>, { roles?: string[]; perms?: string[] }, boolean]> = [
      ['admin for admin', { 'cognito:groups': '[admin]' }, { roles: ['admin'] }, true],
      ['manager for admin', { 'cognito:groups': '[manager]' }, { roles: ['admin'] }, false],
      ['perm-it for admin or perm-it', { 'cognito:groups': '[perm-it]' }, { roles: ['admin'], perms: ['perm-it'] }, true],
      ['ITSpecialist for admin or perm-it', { 'cognito:groups': '[ITSpecialist]' }, { roles: ['admin'], perms: ['perm-it'] }, true],
      ['naleko-talentflow-admin for admin', { 'cognito:groups': '[naleko-talentflow-admin]' }, { roles: ['admin'] }, true],
      ['custom:isAdmin for admin', { 'custom:isAdmin': 'true' }, { roles: ['admin'] }, true],
      ['hr_staffx for hr_staff', { 'cognito:groups': '[hr_staffx]' }, { roles: ['hr_staff'] }, false],
      ['xhr_staff for hr_staff', { 'cognito:groups': '[xhr_staff]' }, { roles: ['hr_staff'] }, false],
      ['naleko-onboarding-hr for hr_staff', { 'cognito:groups': '[naleko-onboarding-hr]' }, { roles: ['hr_staff'] }, false],
      ['no groups for anything', {}, { roles: [...ROLES], perms: [...PERMS] }, false],
      ['access token admin for admin', { 'cognito:groups': '[admin]', token_use: 'access' }, { roles: ['admin'] }, false],
      ['perm-recruitment for perms perm-recruitment', { 'cognito:groups': '[perm-recruitment]' }, { perms: ['perm-recruitment'] }, true],
      ['manager for perms perm-recruitment', { 'cognito:groups': '[manager]' }, { perms: ['perm-recruitment'] }, false],
    ];
    const rrun = runModule(ROLES_HELPER, rr.map(([, claims, need]) => ({ fn: 'requireRole', args: [ev(claims), need] })));
    const bad: string[] = [];
    rr.forEach(([what, , , pass], i) => {
      const res = rrun.results[i];
      if (!res?.ok) { bad.push(`${what}: threw ${JSON.stringify(res?.error)}`); return; }
      if (pass && res.value !== null) bad.push(`${what}: want null, got ${JSON.stringify(res.value)}`);
      if (!pass) {
        const v = res.value as any;
        let body: unknown;
        try { body = JSON.parse(v?.body ?? 'null'); } catch { body = v?.body; }
        if (v?.statusCode !== 403 || JSON.stringify(body) !== JSON.stringify(FORBIDDEN)) bad.push(`${what}: want 403 {"error":"Forbidden"}, got ${JSON.stringify(v).slice(0, 200)}`);
      }
    });
    expect(bad, 'requireRole answers exactly null or 403 {"error":"Forbidden"}').toEqual([]);
    expect(awsCalls(rrun.calls), 'requireRole calls no AWS service').toEqual([]);

    // hrOnly (hr-group.mjs) keeps its answers and reads roles through rolesOf; requireHr (document-check.mjs) keeps its answers.
    const hrSrc = strip(readFileSync(HR_GROUP_HELPER, 'utf8'));
    expect(hrSrc, 'hr-group.mjs imports rolesOf from ./roles.mjs').toMatch(/import\s*\{[^}]*\brolesOf\b[^}]*\}\s*from\s*['"]\.\/roles\.mjs['"]/);
    const callers = ALL_CALLERS;
    const evOf = (c: Caller) => ev({ ...(c.groups === undefined ? {} : { 'cognito:groups': Array.isArray(c.groups) ? `[${c.groups.join(' ')}]` : c.groups }), ...(c.claims ?? {}) });
    const hrWant = (c: Caller) => Array.isArray(c.groups) && c.groups.includes('hr_staff');
    const hr = runModule(HR_GROUP_HELPER, callers.map((c) => ({ fn: 'hrOnly', args: [evOf(c), 'Only HR can do this'] })));
    const doc = runModule(DOCUMENT_CHECK, callers.map((c) => ({ fn: 'requireHr', args: [evOf(c)] })));
    const hrWrong: string[] = [];
    callers.forEach((c, i) => {
      const h = hr.results[i];
      const d = doc.results[i];
      const okH = hrWant(c) ? h?.ok && h.value === null : h?.ok && h.value?.statusCode === 403 && h.value?.body === JSON.stringify({ error: 'Only HR can do this' });
      const okD = hrWant(c) ? d?.ok && d.value === null : d?.ok && d.value?.statusCode === 403 && d.value?.body === JSON.stringify({ error: 'Only HR can open documents' });
      if (!okH) hrWrong.push(`hrOnly | ${c.name}: ${JSON.stringify(h).slice(0, 200)}`);
      if (!okD) hrWrong.push(`requireHr | ${c.name}: ${JSON.stringify(d).slice(0, 200)}`);
    });
    expect(hrWrong, 'hrOnly and requireHr: HR is hr_staff only, exactly as on develop').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-3

  const family = (prefix: RegExp) => PROBES.filter((p) => prefix.test(p.handler));
  const ac3 = (title: string, probes: Probe[]) =>
    test(title, async ({}, testInfo) => {
      once(testInfo.project.name);
      test.setTimeout(900_000);
      const { wrong, refusals } = judge(probes, ALL_CALLERS);
      expect(wrong, 'every caller gets the frozen answer (old groups: never less than develop gives; new groups: what their role and ticks give)').toEqual([]);
      expect(refusals, 'a refusal by the role check is 403 {"error":"Forbidden"} and nothing else').toEqual([]);
    });

  ac3('AC-3 Same access as today: user admin and settings routes', family(/^admin|^manageTalentFlowConfig$/));
  ac3('AC-3 Same access as today: IT task routes', family(/ItTask/));
  ac3('AC-3 Same access as today: provisioning bundles and the pickers', family(/Provisioning|^get(HiringManagers|PanelMembers)$/));

  test('AC-3 The role check comes before the company check, and another company is still not found', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const wrong: string[] = [];
    for (const p of PROBES.filter((x) => x.gated)) {
      // No role: Forbidden, no AWS call, with or without a company.
      for (const c of [{ name: 'guest of A', groups: ['guest'] }, { name: 'guest without a company', groups: ['guest'], company: null }] as Caller[]) {
        if (p.want(c) !== 'no') continue;
        const r = ask(p.handler, c, p.ask);
        if (statusOf(r) !== 403 || JSON.stringify(bodyOf(r)) !== JSON.stringify(FORBIDDEN) || aws(r).length) wrong.push(`${p.name} | ${c.name}: ${describe(r)} calls ${awsCalls(r.calls).join(', ')}`);
      }
      // The role but no company: Forbidden, no AWS call.
      const noCompany: Caller = { name: 'admin + perm-it without a company', groups: ['admin', 'perm-it'], company: null };
      const r = ask(p.handler, noCompany, p.ask);
      if (statusOf(r) !== 403 || JSON.stringify(bodyOf(r)) !== JSON.stringify(FORBIDDEN) || aws(r).length) wrong.push(`${p.name} | ${noCompany.name}: ${describe(r)} calls ${awsCalls(r.calls).join(', ')}`);
    }
    // A caller of B with every role reaches nothing of A's by id.
    const bAdmin: Caller = { name: 'admin of B', groups: ['admin', ...PERMS], company: B };
    for (const p of PROBES.filter((x) => /getItTask$|claimItTask|getProvisioningBundle$|getProvisioningBundleProgress|approveProvisioningBundle|updateProvisioningBundle/.test(x.handler))) {
      const r = ask(p.handler, bAdmin, p.ask);
      if (statusOf(r) !== 404 || JSON.stringify(bodyOf(r)) !== JSON.stringify(NOT_FOUND)) wrong.push(`${p.name} | admin of B on A's record: ${describe(r)}`);
    }
    expect(wrong, 'Forbidden before any AWS call without the role or without a company; 404 for another company\'s record').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 No group names in handlers: every role handler reads roles through lambda/shared/roles.mjs', async ({}, testInfo) => {
    once(testInfo.project.name);
    const OLD_NAMES = ['TalentFlowAdmin', 'naleko-talentflow-', 'naleko-it-provisioning', 'naleko-onboarding-hr', 'ITAdmin', 'ITSpecialist', 'HiringManager', 'PanelMember', 'FinanceLead', 'HRDirector', 'ComplianceOfficer'];
    const CLAIMS = ['cognito:groups', 'custom:isAdmin', 'custom:roles'];
    const files: string[] = [];
    for (const h of ROLE_HANDLERS) files.push(...codeFiles(join(LAMBDA, h)));
    files.push(HR_GROUP_HELPER, DOCUMENT_CHECK);
    // A name counts as a whole name (getHiringManagers or isITSpecialist are not HiringManager or ITSpecialist); a claim
    // counts when it is read (claims['cognito:groups'], { 'custom:roles': x }), not when an answer's words mention it (BE-19 pins one).
    const nameRe = (n: string) => new RegExp(`(?<![\\w-])${n.replace(/[-]/g, '\\-')}${n.endsWith('-') ? '' : '(?![\\w-])'}`);
    const claimRe = (n: string) => new RegExp(`\\[\\s*(['"\`])${n}\\1\\s*\\]|(['"\`])${n}\\2\\s*:`);
    const found: string[] = [];
    for (const f of files) {
      const src = strip(readFileSync(f, 'utf8'));
      for (const n of OLD_NAMES) if (nameRe(n).test(src)) found.push(`${f.slice(REPO.length + 1)}: ${n}`);
      for (const n of CLAIMS) if (claimRe(n).test(src)) found.push(`${f.slice(REPO.length + 1)}: reads ${n}`);
    }
    expect(found, 'no role handler (nor hr-group.mjs, document-check.mjs) names an old group or reads a group or admin claim itself').toEqual([]);
    for (const h of ROLE_HANDLERS) {
      const src = codeFiles(join(LAMBDA, h)).map((f) => strip(readFileSync(f, 'utf8'))).join('\n');
      expect(src, `${h}: loads the shared roles helper`).toMatch(/shared\/[\w.-]*roles[\w.-]*\.(mjs|js|cjs)['"]/);
    }
    // A CommonJS go-between, if one is used, loads roles.mjs and names no group itself.
    for (const f of readdirSync(join(LAMBDA, 'shared')).filter((n) => /roles/.test(n) && n !== 'roles.mjs' && !/\.test\./.test(n))) {
      const src = strip(readFileSync(join(LAMBDA, 'shared', f), 'utf8'));
      expect(src, `shared/${f}: loads ./roles.mjs`).toMatch(/['"]\.\/roles\.mjs['"]/);
      for (const n of OLD_NAMES) expect(nameRe(n).test(src), `shared/${f} does not name ${n}`).toBe(false);
      for (const n of CLAIMS) expect(claimRe(n).test(src), `shared/${f} does not read ${n}`).toBe(false);
    }
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 User admin writes the new groups: exactly those, old roles mapped, e2e-robots never touched, admins only, the caller\'s company', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const adminA: Caller = { name: 'admin of A', groups: ['admin'] };
    const adminB: Caller = { name: 'admin of B', groups: ['admin'], company: B };
    const world = () => ({ pool: pool([], POOL_GROUPS) });
    const groupsOf = (r: Run, username: string) => [...(r.cognito.users.find((u) => u.username === username)?.groups ?? [])].sort();
    const touched = (r: Run) => r.calls.filter((c: any) => c.service === 'cognito' && /UserToGroup|UserFromGroup/.test(c.op)).map((c: any) => String(c.input?.GroupName));
    const allowed = new Set([...NEW_GROUPS, ...OLD_MANAGED]);
    const NEW_EMAIL = 'new.person@example.test';
    const create = (body: Record<string, unknown>, who: Caller = adminA) => ask('adminCreateUser', who, { method: 'POST', body: { email: NEW_EMAIL, givenName: 'Nomsa', familyName: 'New', ...body } }, world());
    const sortedList = (l: string[]) => [...l].sort();

    // Create: new form and old form.
    const creates: Array<[string, Record<string, unknown>, string[]]> = [
      ['role manager, two ticks', { role: 'manager', permissions: ['perm-recruitment', 'perm-it'] }, ['manager', 'perm-it', 'perm-recruitment']],
      ['role hr_staff, no ticks', { role: 'hr_staff', permissions: [] }, ['hr_staff']],
      ['role guest, ticks left out', { role: 'guest' }, ['guest']],
      ['role admin, every tick', { role: 'admin', permissions: [...PERMS] }, ['admin', ...PERMS]],
      ['old roles ADMIN', { roles: ['ADMIN'] }, ['admin', ...PERMS]],
      ['old roles HM', { roles: ['HM'] }, ['manager', 'perm-recruitment']],
      ['old roles IT', { roles: ['IT'] }, ['perm-it']],
      ['old roles TA', { roles: ['TA'] }, ['perm-recruitment']],
      ['old roles HM and IT', { roles: ['HM', 'IT'] }, ['manager', 'perm-it', 'perm-recruitment']],
    ];
    for (const [what, body, want] of creates) {
      const r = create({ ...body, tenant_id: B, tenantId: B });
      expect([201, 200], `create, ${what}: created\n${describe(r)}`).toContain(statusOf(r));
      expect(groupsOf(r, NEW_EMAIL), `create, ${what}: exactly these groups`).toEqual(sortedList(want));
      expect(touched(r).filter((gname) => !NEW_GROUPS.includes(gname)), `create, ${what}: adds only the eight new groups`).toEqual([]);
      const row = rowsOf(r.tables, TABLE.users).find((x) => x['email'] === NEW_EMAIL);
      expect(row?.['tenant_id'], `create, ${what}: the profile row carries the caller's company (never the body's)`).toBe(A);
      expect(JSON.stringify(aws(r)), `create, ${what}: no read or write of the tenants table (R5)`).not.toContain(TENANTS);
      expect(JSON.stringify(aws(r)), `create, ${what}: B named in the body reaches no call`).not.toContain(B);
    }
    // Refused bodies: 400, no Cognito call.
    for (const [what, body] of [
      ['role e2e-robots', { role: 'e2e-robots' }], ['role TalentFlowAdmin', { role: 'TalentFlowAdmin' }], ['role hr', { role: 'hr' }], ['role perm-it', { role: 'perm-it' }],
      ['tick admin', { role: 'manager', permissions: ['admin'] }], ['tick e2e-robots', { role: 'manager', permissions: ['e2e-robots'] }], ['old role SUPER', { roles: ['SUPER'] }], ['nothing', {}],
    ] as Array<[string, Record<string, unknown>]>) {
      const r = create(body);
      expect(statusOf(r), `create, ${what}: 400\n${describe(r)}`).toBe(400);
      expect(r.calls.filter((c: any) => c.service === 'cognito'), `create, ${what}: no Cognito call`).toEqual([]);
    }

    // Update: the eight (and today's four TalentFlow names) are set; everything else stays.
    const A_USER = 'thandeka.a@example.test';
    const u1 = ask('adminUpdateUser', adminA, { method: 'PUT', path: { userId: TEN05.userA }, body: { role: 'manager', permissions: ['perm-recruitment'], tenant_id: B } }, world());
    expect(statusOf(u1), `update, new form: 200\n${describe(u1)}`).toBe(200);
    expect(groupsOf(u1, A_USER), 'update, new form: managed groups set, e2e-robots and the old module groups kept').toEqual(sortedList(['manager', 'perm-recruitment', 'e2e-robots', 'naleko-onboarding-hr', 'naleko-talentflow-admin']));
    expect(touched(u1).filter((gname) => !allowed.has(gname)), 'update: adds or removes only the eight and today\'s managed TalentFlow names').toEqual([]);
    const added = u1.calls.filter((c: any) => c.service === 'cognito' && c.op === 'AdminAddUserToGroup').map((c: any) => c.input.GroupName);
    expect(added.filter((gname: string) => !NEW_GROUPS.includes(gname)), 'update: never adds an old group name').toEqual([]);
    const u2 = ask('adminUpdateUser', adminA, { method: 'PUT', path: { userId: TEN05.userA2 }, body: { roles: ['IT'] } }, world());
    expect(statusOf(u2), `update, old roles IT: 200\n${describe(u2)}`).toBe(200);
    expect(groupsOf(u2, 'musa.a@example.test'), 'update, old roles IT: the role is unchanged, the ticks become perm-it, e2e-robots kept').toEqual(sortedList(['manager', 'perm-it', 'e2e-robots']));
    const u3 = ask('adminUpdateUser', adminA, { method: 'PUT', path: { userId: TEN05.userA2 }, body: { roles: ['ADMIN'] } }, world());
    expect(groupsOf(u3, 'musa.a@example.test'), 'update, old roles ADMIN: admin and every tick, the old role group replaced').toEqual(sortedList(['admin', ...PERMS, 'e2e-robots']));
    for (const r of [u1, u2, u3]) expect(touched(r), 'update: e2e-robots is never added or removed').not.toContain('e2e-robots');
    for (const r of [u1, u2, u3]) expect(JSON.stringify(aws(r)), 'update: no read or write of the tenants table').not.toContain(TENANTS);
    const bad = ask('adminUpdateUser', adminA, { method: 'PUT', path: { userId: TEN05.userA2 }, body: { role: 'e2e-robots' } }, world());
    expect(statusOf(bad), 'update, role e2e-robots: 400').toBe(400);
    expect(bad.calls.filter((c: any) => c.service === 'cognito'), 'update, role e2e-robots: no Cognito call').toEqual([]);

    // Another company's user: 404, nothing changed.
    for (const [h, a] of [['adminUpdateUser', { method: 'PUT', path: { userId: TEN05.userA }, body: { role: 'guest' } }], ['adminDeactivateUser', { method: 'DELETE', path: { userId: TEN05.userA } }]] as const) {
      const r = ask(h, adminB, a, world());
      expect(statusOf(r), `${h}, admin of B on A's user: 404\n${describe(r)}`).toBe(404);
      expect(bodyOf(r), `${h}: {"error":"Not found"}`).toEqual(NOT_FOUND);
      expect(r.calls.filter((c: any) => c.service === 'cognito'), `${h}, admin of B: no Cognito call`).toEqual([]);
      expect(r.calls.filter((c: any) => c.service === 'dynamodb' && c.op !== 'GetItem' && c.op !== 'Query'), `${h}, admin of B: no write`).toEqual([]);
    }
    // The list shows the caller's company only.
    const la = ask('adminGetUsers', adminA, {}, world());
    const lb = ask('adminGetUsers', adminB, {}, world());
    expect(statusOf(la), `list, admin of A: 200\n${describe(la)}`).toBe(200);
    expect((bodyOf(la)?.users ?? []).map((u: any) => u.userId).sort(), 'list, admin of A: A\'s users only').toEqual([TEN05.userA, TEN05.userA2].sort());
    expect((bodyOf(lb)?.users ?? []).map((u: any) => u.userId), 'list, admin of B: B\'s user only').toEqual([TEN05.userB]);
    expect(JSON.stringify(bodyOf(lb)), 'list, admin of B: nothing of A').not.toMatch(/thandeka|musa/i);

    // The company never comes from a header or the query string (company B named by an admin of A, and A by an admin of B).
    const withB = named(B);
    const withA = named(A);
    sameAs(la, ask('adminGetUsers', adminA, withB, world()), 'list, admin of A naming company B');
    sameAs(lb, ask('adminGetUsers', adminB, withA, world()), 'list, admin of B naming company A');
    sameAs(ask('adminGetDashboard', adminA, {}, world()), ask('adminGetDashboard', adminA, withB, world()), 'dashboard, admin of A naming company B');
    const cPlain = create({ role: 'manager', permissions: ['perm-recruitment'] });
    const cNamed = ask('adminCreateUser', adminA, { method: 'POST', body: { email: NEW_EMAIL, givenName: 'Nomsa', familyName: 'New', role: 'manager', permissions: ['perm-recruitment'] }, ...withB }, world());
    expect(statusOf(cNamed), `create, naming company B: same status\n${describe(cNamed)}`).toBe(statusOf(cPlain));
    expect(groupsOf(cNamed, NEW_EMAIL), 'create, naming company B: same groups').toEqual(groupsOf(cPlain, NEW_EMAIL));
    expect(rowsOf(cNamed.tables, TABLE.users).find((x) => x['email'] === NEW_EMAIL)?.['tenant_id'], 'create, naming company B: the row carries the token\'s company').toBe(A);
    expect(JSON.stringify(aws(cNamed)), 'create, naming company B: B reaches no call').not.toContain(B);
    const uPlain = ask('adminUpdateUser', adminA, { method: 'PUT', path: { userId: TEN05.userA2 }, body: { role: 'guest' } }, world());
    const uNamed = ask('adminUpdateUser', adminA, { method: 'PUT', path: { userId: TEN05.userA2 }, body: { role: 'guest' }, ...withB }, world());
    expect(statusOf(uNamed), `update, naming company B: same status\n${describe(uNamed)}`).toBe(statusOf(uPlain));
    expect(groupsOf(uNamed, 'musa.a@example.test'), 'update, naming company B: same groups').toEqual(groupsOf(uPlain, 'musa.a@example.test'));
    expect(JSON.stringify(aws(uNamed)), 'update, naming company B: B reaches no call').not.toContain(B);
    for (const [h, a] of [['adminUpdateUser', { method: 'PUT', path: { userId: TEN05.userA }, body: { role: 'guest' } }], ['adminDeactivateUser', { method: 'DELETE', path: { userId: TEN05.userA } }]] as const) {
      const r = ask(h, adminB, { ...a, ...withA }, world());
      expect(statusOf(r), `${h}, admin of B naming company A on A's user: still 404\n${describe(r)}`).toBe(404);
      expect(bodyOf(r), `${h}, admin of B naming company A: {"error":"Not found"}`).toEqual(NOT_FOUND);
      expect(r.calls.filter((c: any) => c.service === 'cognito'), `${h}, admin of B naming company A: no Cognito call`).toEqual([]);
      expect(r.calls.filter((c: any) => c.service === 'dynamodb' && c.op !== 'GetItem' && c.op !== 'Query'), `${h}, admin of B naming company A: no write`).toEqual([]);
    }

    // Not an admin: 403 Forbidden, no AWS call at all, on all five.
    for (const c of [{ name: 'manager', groups: ['manager', ...PERMS] }, { name: 'hr_staff', groups: ['hr_staff'] }, { name: 'naleko-talentflow-hr', groups: ['naleko-talentflow-hr'] }, { name: 'HiringManager', groups: ['HiringManager'] }] as Caller[]) {
      for (const [h, a] of [['adminCreateUser', { method: 'POST', body: { email: NEW_EMAIL, givenName: 'N', familyName: 'N', role: 'admin' } }], ['adminUpdateUser', { method: 'PUT', path: { userId: TEN05.userA2 }, body: { role: 'admin' } }],
        ['adminDeactivateUser', { method: 'DELETE', path: { userId: TEN05.userA2 } }], ['adminGetUsers', {}], ['adminGetDashboard', {}]] as const) {
        const r = ask(h, c, a, world());
        expect(statusOf(r), `${h}, ${c.name}: 403\n${describe(r)}`).toBe(403);
        expect(bodyOf(r), `${h}, ${c.name}: {"error":"Forbidden"}`).toEqual(FORBIDDEN);
        expect(aws(r), `${h}, ${c.name}: no AWS call`).toEqual([]);
      }
    }
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 Pickers: the new groups are listed, people outside them are not, and no tenants table read yet', async ({}, testInfo) => {
    once(testInfo.project.name);
    const p = (u: string, sub: string, groups: string[]) => ({ username: u, sub, status: 'CONFIRMED', attributes: { email: u, given_name: u.split('.')[0]!, family_name: 'Picker' }, groups });
    const people = [
      p('hm.old@example.test', 'sub-p-hmold', ['naleko-talentflow-hiringmanager']),
      p('manager.new@example.test', 'sub-p-mgr', ['manager']),
      p('recruiter.new@example.test', 'sub-p-rec', ['perm-recruitment']),
      p('tfadmin.old@example.test', 'sub-p-nta', ['naleko-talentflow-admin']),
      p('tfhr.old@example.test', 'sub-p-nth', ['naleko-talentflow-hr']),
      p('hronly@example.test', 'sub-p-hr', ['hr_staff']),
      p('employee@example.test', 'sub-p-emp', ['employee']),
      p('guest@example.test', 'sub-p-guest', ['guest']),
      p('itonly@example.test', 'sub-p-it', ['perm-it']),
      p('robot@example.test', 'sub-p-robot', ['e2e-robots']),
      p('adminonly@example.test', 'sub-p-admin', ['admin']),
      p('manager.b@example.test', 'sub-p-mgr-b', ['manager']),
    ];
    const world = { pool: { users: people, groups: POOL_GROUPS } };
    const caller: Caller = { name: 'manager of A', groups: ['manager', 'perm-recruitment'] };
    const listed = (r: Run, key: string) => ((bodyOf(r)?.[key] ?? []) as any[]).map((m) => m.email);

    const hm = ask('getHiringManagers', caller, {}, world);
    expect(statusOf(hm), `hiring managers: 200\n${describe(hm)}`).toBe(200);
    const hms = listed(hm, 'hiringManagers');
    for (const e of ['hm.old@example.test', 'manager.new@example.test', 'recruiter.new@example.test']) expect(hms, `hiring managers list ${e}`).toContain(e);
    for (const e of ['hronly@example.test', 'employee@example.test', 'guest@example.test', 'itonly@example.test', 'robot@example.test', 'adminonly@example.test']) expect(hms, `hiring managers do not list ${e}`).not.toContain(e);
    expect(new Set(hms).size, 'hiring managers: nobody twice').toBe(hms.length);

    const pm = ask('getPanelMembers', caller, {}, world);
    expect(statusOf(pm), `panel members: 200\n${describe(pm)}`).toBe(200);
    const pms = listed(pm, 'members');
    for (const e of ['tfadmin.old@example.test', 'tfhr.old@example.test', 'manager.new@example.test']) expect(pms, `panel members list ${e}`).toContain(e);
    for (const e of ['hronly@example.test', 'employee@example.test', 'guest@example.test', 'itonly@example.test', 'robot@example.test', 'adminonly@example.test']) expect(pms, `panel members do not list ${e}`).not.toContain(e);
    expect(new Set(pms).size, 'panel members: nobody twice').toBe(pms.length);

    for (const r of [hm, pm]) {
      expect(JSON.stringify(aws(r)), 'no read of the tenants table until Iggie grants it (R5)').not.toContain(TENANTS);
      expect(aws(r).filter((c: any) => c.service === 'cognito' && c.input?.UserPoolId !== 'af-south-1_Ten05Fake'), 'only the Naleko pool is read').toEqual([]);
    }
    // Panel members by candidate: the scoring links of another company's candidate stay out (TEN-03, unchanged).
    const linked = ask('getPanelMembers', { name: 'manager of B', groups: ['manager'], company: B }, { query: { candidateId: ID.a1 } }, world);
    expect(JSON.stringify(bodyOf(linked)), 'panel members of B for A\'s candidate: none of A\'s scoring links').not.toMatch(/Pia Alpha|panel\.a|sub-panel-a/);

    // The company never comes from a header or the query string.
    sameAs(hm, ask('getHiringManagers', caller, named(B), world), 'hiring managers, manager of A naming company B');
    sameAs(pm, ask('getPanelMembers', caller, named(B), world), 'panel members, manager of A naming company B');
    const managerB: Caller = { name: 'manager of B', groups: ['manager'], company: B };
    const linkedA = ask('getPanelMembers', managerB, { headers: named(A).headers, query: { candidateId: ID.a1, ...named(A).query } }, world);
    sameAs(linked, linkedA, 'panel members of B for A\'s candidate, naming company A');
    expect(JSON.stringify(bodyOf(linkedA)), 'panel members of B naming company A: none of A\'s scoring links').not.toMatch(/Pia Alpha|panel\.a|sub-panel-a/);
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 Old app modules: deriveModules maps the new groups and keeps every old mapping', async ({}, testInfo) => {
    once(testInfo.project.name);
    const fn = deriveModules();
    const set = (l: string[]) => [...new Set(l)].sort();
    const cases: Array<[string[], string[]]> = [
      // Old mappings, unchanged.
      [['naleko-onboarding-hr'], ['onboarding']], [['naleko-talentflow-hr'], ['talentflow']], [['naleko-talentflow-hiringmanager'], ['talentflow']],
      [['naleko-talentflow-admin'], ['talentflow']], [['naleko-it-provisioning'], ['it-provisioning']], [[], []], [['employee'], []], [['e2e-robots'], []],
      [['TalentFlowAdmin'], []], [['ITAdmin'], []], [['HiringManager'], []],
      [['naleko-onboarding-hr', 'naleko-talentflow-hr', 'naleko-it-provisioning'], ['it-provisioning', 'onboarding', 'talentflow']],
      // New groups.
      [['admin'], ['it-provisioning', 'onboarding', 'talentflow']], [['hr_staff'], ['onboarding']], [['perm-recruitment'], ['talentflow']], [['perm-it'], ['it-provisioning']],
      [['manager'], []], [['guest'], []], [['perm-approve-offers'], []],
      [['hr_staff', 'perm-recruitment'], ['onboarding', 'talentflow']], [['hr_staff', 'naleko-onboarding-hr'], ['onboarding']],
      // Near names give nothing.
      [['hr_staffx'], []], [['xhr_staff'], []], [['admins'], []], [['perm-itx'], []], [['Admin'], []],
    ];
    const wrong = cases.map(([g, want]) => ({ g, want, got: set(fn(g)) })).filter((x) => JSON.stringify(x.got) !== JSON.stringify(x.want));
    expect(wrong, 'deriveModules gives these modules (as a set)').toEqual([]);
    // One-group answers that existed before stay exactly as they were (no duplicates added for one group).
    for (const g of ['naleko-onboarding-hr', 'naleko-talentflow-hr', 'naleko-talentflow-hiringmanager', 'naleko-talentflow-admin', 'naleko-it-provisioning']) expect(fn([g]), `${g}: one module, as today`).toHaveLength(1);
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Roles: the user admin roles are unchanged (IAM has no group-level resource) and no Cognito action has a wildcard resource', async ({}, testInfo) => {
    once(testInfo.project.name);
    const iam = readFileSync(join(REPO, 'talent-flow-infra', 'talent-flow-iam.tf'), 'utf8');
    const base = readFileSync(join(__dirname, 'support', 'ten-05', 'iam.admin-users.1420ef9.tf.txt'), 'utf8');
    const squash = (s: string) => s.replace(/#.*$/gm, '').replace(/\s+/g, '');
    const policy = (src: string, name: string) => blocksIn(src).find((b) => b.type === 'aws_iam_role_policy' && b.name === name)?.raw ?? '';
    for (const name of ['admin_create_user', 'admin_update_user', 'admin_deactivate_user']) {
      expect(policy(iam, name), `aws_iam_role_policy.${name} is there`).not.toBe('');
      expect(squash(policy(iam, name)), `aws_iam_role_policy.${name} is exactly as on develop 1420ef9`).toBe(squash(policy(base, name)));
    }
    // Everywhere: a statement that names a cognito-idp action has no "*" resource and no wildcard pool.
    const wild: string[] = [];
    for (const dir of ['infra', 'talent-flow-infra']) {
      for (const f of tfFiles(join(REPO, dir))) {
        const s = squash(readFileSync(f, 'utf8'));
        for (const m of s.matchAll(/"cognito-idp:[A-Za-z*]+"/g)) {
          const stmt = enclosing(s, m.index!);
          if (/Resource=("\*"|\["\*"\]|\[[^\]]*"\*")/.test(stmt) || /userpool\/\*/.test(stmt) || /"cognito-idp:\*"/.test(stmt)) wild.push(`${f.slice(REPO.length + 1)}: ${stmt.slice(0, 200)}`);
        }
      }
    }
    expect(wild, 'no Cognito action on "*" or on every pool').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 Today\'s users still get in after the dev apply and seed @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-3.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    const env = (k: string) => process.env[k] ?? '';
    const counts = join(REPO, 'scripts', 'tenancy', 'ten-05-dev-count.json');
    test.skip(!existsSync(counts), 'The merger records the number of candidates the TalentFlow test login saw before the TEN-05 dev apply in scripts/tenancy/ten-05-dev-count.json ({ "candidates": <n> }); not recorded yet.');
    const before = (JSON.parse(readFileSync(counts, 'utf8')) as { candidates: number }).candidates;
    const { clientId, region } = devEnv();
    const oldEnv = readFileSync(join(REPO, 'hr-portal', 'src', 'environments', 'environment.ts'), 'utf8');
    const tfApi = (/talentFlow\s*:\s*\{[^}]*?apiUrl\s*:\s*['"`]([^'"`]+)['"`]/s.exec(oldEnv)?.[1] ?? '').replace(/\/+$/, '');
    const itApi = (/itProvisioning\s*:\s*\{[^}]*?apiUrl\s*:\s*['"`]([^'"`]+)['"`]/s.exec(oldEnv)?.[1] ?? '').replace(/\/+$/, '');
    expect(tfApi, 'the TalentFlow API address is written for pepla-dev').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    expect(itApi, 'the IT API address is written for pepla-dev').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const tokenOf = async (email: string, password: string) => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: email, PASSWORD: password } }),
      });
      expect(r.status(), `${email.replace(/@.*/, '@...')} signs in at Cognito`).toBe(200);
      return ((await r.json()) as any).AuthenticationResult.IdToken as string;
    };
    const get = (url: string, token: string) => page.request.get(url, { headers: { Authorization: `Bearer ${token}` } });

    // HR: pepla-web HR home loads as before.
    const hr = { email: env('E2E_HR_EMAIL'), password: env('E2E_HR_PASSWORD') };
    expect(hr.email, 'E2E_HR_EMAIL is set').toBeTruthy();
    await page.goto('/sign-in');
    await page.getByLabel(/email/i).fill(hr.email);
    await page.getByLabel(/password/i).fill(hr.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page, 'HR lands on HR home').toHaveURL(/\/hr(\/|$|\?)/, { timeout: 30_000 });

    // TalentFlow: the same candidates as before.
    const tf = { email: env('E2E_TF_EMAIL') || env('E2E_HR_EMAIL'), password: env('E2E_TF_PASSWORD') || env('E2E_HR_PASSWORD') };
    const tfToken = await tokenOf(tf.email, tf.password);
    const list = await get(`${tfApi}/candidates`, tfToken);
    expect(list.status(), 'TalentFlow login: GET /v1/candidates 200').toBe(200);
    expect(((await list.json()) as { candidates?: unknown[] }).candidates?.length ?? 0, 'the same number of candidates as before').toBe(before);

    // IT: the task list loads.
    const it = { email: env('E2E_IT_EMAIL'), password: env('E2E_IT_PASSWORD') };
    expect(it.email, 'E2E_IT_EMAIL is set (the seeded IT test login)').toBeTruthy();
    const itList = await get(`${itApi}/it/tasks`, await tokenOf(it.email, it.password));
    expect(itList.status(), 'IT login: GET /v1/it/tasks 200').toBe(200);

    // Guest: refused on a role route (GET /v1/candidates has no role check today: see the refresh file).
    const guest = { email: env('E2E_GUEST_EMAIL'), password: env('E2E_GUEST_PASSWORD') };
    expect(guest.email, 'E2E_GUEST_EMAIL is set (the seeded guest login of company A)').toBeTruthy();
    const g = await get(`${itApi}/it/tasks`, await tokenOf(guest.email, guest.password));
    expect(g.status(), 'guest: GET /v1/it/tasks 403').toBe(403);
    expect(await g.json(), 'guest: {"error":"Forbidden"}').toEqual(FORBIDDEN);
  });
});

// ---------------------------------------------------------------- helpers

/** Code with comments removed (strings kept). */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}
/** Every .js/.mjs/.cjs file of a Lambda folder (not tests, not node_modules, not shared copies of other modules). */
function codeFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.') || e === '__tests__' || e === 'tests') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...codeFiles(p));
    else if (/\.(js|mjs|cjs)$/.test(e) && !/\.(test|spec)\./.test(e)) out.push(p);
  }
  return out;
}
/** Resource blocks in one Terraform text: type, name and raw text. */
function blocksIn(src: string): Array<{ type: string; name: string; raw: string }> {
  const out: Array<{ type: string; name: string; raw: string }> = [];
  for (const m of src.matchAll(/^resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/gm)) {
    let depth = 0;
    let i = m.index! + m[0].length - 1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '"') { i++; while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1; continue; }
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) break; }
    }
    out.push({ type: m[1]!, name: m[2]!, raw: src.slice(m.index!, i + 1) });
  }
  return out;
}
/** The smallest { ... } around a position in squashed text. */
function enclosing(s: string, at: number): string {
  let depth = 0;
  let start = at;
  for (; start >= 0; start--) {
    if (s[start] === '}') depth++;
    if (s[start] === '{') { if (depth === 0) break; depth--; }
  }
  depth = 0;
  let end = at;
  for (; end < s.length; end++) {
    if (s[end] === '{') depth++;
    if (s[end] === '}') { if (depth === 0) break; depth--; }
  }
  return s.slice(Math.max(start, 0), end + 1);
}
/** The old app's AuthService.deriveModules, compiled on its own from the TypeScript source. */
function deriveModules(): (groups: string[]) => string[] {
  const src = readFileSync(join(REPO, 'hr-portal', 'src', 'app', 'core', 'services', 'auth.service.ts'), 'utf8');
  const at = /static\s+deriveModules\s*\(\s*groups\s*:\s*string\[\]\s*\)\s*:\s*string\[\]\s*\{/.exec(src);
  expect(at, 'AuthService has static deriveModules(groups: string[]): string[]').toBeTruthy();
  let depth = 0;
  let i = at!.index + at![0].length - 1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(at!.index + at![0].length, i);
  const js = ts.transpileModule(`function deriveModules(groups: string[]): string[] {${body}}\nmodule.exports = deriveModules;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: undefined as unknown };
  new Function('module', 'exports', js)(mod, {});
  return mod.exports as (groups: string[]) => string[];
}
void [NEW_CALLERS, NOBODY_CALLERS, grantOfCaller, tables];
