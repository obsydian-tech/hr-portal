import { spawnSync } from 'node:child_process';
import { isRec062Grant, isRec09Policy } from './support/rec-09.1/grants'; // child lock rec-09.1 (REC-09), on top of rec-06.2.1
import { isRec16Role } from './support/rec-16.1/grants'; // child lock rec-16.1
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { LAMBDA, REPO, callsOfStep, httpEvent, jwtAuthorizer, logLines, runModule, runScript, type Row, type Run, type Sts, type Tables } from './support/mod-01/lambda-harness';
import {
  A, B, C, COMPANY_NAME, D, E, F, G, ID, NAME, SUB, TABLE, TENANTS, TENANTS_PROD, X, ask, av, bodyOf, callLines, calls, companyRows, describe, fileOf,
  NEW_GROUPS, isModulesRead, plain, profileOf, rowsOf, runEvent, sent, settings, statusOf, tables, type Ask, type Caller,
} from './support/mod-01/world';
import { GATED_LAMBDAS, GATED_ROUTE_LAMBDAS, ROUTES, TOOLS, callerFor } from './support/mod-01/routes';
import {
  TENANTS_RESOURCE, kmsList, lambdaNamed, lambdaNamesIn, policyLines, readTf, resourcesOf, roleInfo, roleResourceOf, settingsOf, squash, valueOf, type Stack,
} from './support/mod-01/iam';
import { attributes } from './support/infra-harness';
import { devEnv } from './support/ten-02/dev';
import { isCardGrant } from './support/ten-04.2/grants';
import { MARKETPLACE_DEV_KEY, marketplaceDev } from './support/marketplace-dev/grant';
import { ownerLinkGrant } from './support/onb-11/owner-link';
import { isRec07Grant } from './support/rec-07.1/grants';
import { OLD_ROUTE, isOldOfferWrite, isRec05Grant, isRec05Role } from './support/rec-05.1/grants'; // child lock rec-05.1
import { isRec15bGrant } from './support/rec-15b.1/grants';
import { isRec15cGrant } from './support/rec-15c.1/grants'; // child lock rec-15c.1
import { isRec15dGrant } from './support/rec-15d.1/grants'; // child lock rec-15d.1
import { isInt01Grant } from './support/int-01.1/grants'; // child lock int-01.1

/**
 * MOD-01 · A company has modules switched on, and the server refuses a module that is off (epic Modules).
 * Red. One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/MOD-01.md (17 Nov 2026). Notes: cards/mod-01.md and MOD-01-tests-for-review.md.
 *
 * The Lambda tests run the real handlers and the real helper, each in a fresh Node process, against a fake AWS
 * (support/mod-01/fake-aws, copied from TEN-03's and added to: STS, credential helpers, a clock). The script test runs
 * scripts/tenancy/set-modules.mjs against the same fake. Companies (support/mod-01/world.ts): A founding with no
 * modules attribute, B {onboarding}, C {recruitment}, D suspended {recruitment}, and E, F, G, X for the edges.
 * AC-7, AC-8 and AC-9 read code and Terraform as text, run the CI test on a copy, and run the pepla-dev seed against a
 * fake boto3. AC-10 runs on pepla-dev only. Nothing here calls AWS or any AI: Bedrock is refused, outbound HTTP is refused.
 *
 * Pinned by the verifier (decisions D-1 to D-12 in cards/mod-01.md):
 *  - D-1 GET /v1/company/modules lives on the employees API (aws_apigatewayv2_api.employees_api, the one MOD-02 calls
 *    through employeesApiUrl) with its Cognito JWT authorizer.
 *  - D-2 The rule 4 list is support/mod-01/routes.ts (TEN-03's routes less IT tasks and bundles).
 *  - D-3 The TalentFlow chat itself is Ask Batsi and stays open; its Recruitment tools are refused in resolveToolCall.
 *  - D-4 The helper reads the company list named by the TENANTS_TABLE setting; modules are a string set.
 *  - D-5 The script's table is naleko-people-<env>-tenants; its command line is rule 6's and nothing more.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const FORBIDDEN = { error: 'Forbidden' };
/** The rule 4 routes whose role check refuses a person in no group before any AWS call (develop 6122df1, TEN-05). */
// REC-01 adds a role answer to the Recruitment routes below (the first fifteen); TEN-05's admin-only and HR routes follow.
const ROLE_CHECKED = ['PATCH /v1/candidates/{id}', 'PUT /v1/candidates/{id}/stage', 'PATCH /v1/candidates/{id}/interviews/{interviewId}', 'POST /v1/candidates/{id}/interviews', 'POST /v1/candidates/{id}/sentiment', 'POST /v1/candidates/{id}/scoring-links', 'POST /v1/candidates/{id}/offer', 'PUT /v1/candidates/{id}/offer', 'POST /v1/intelligence/tiles/{id}/dismiss', 'POST /v1/intelligence/tiles/{id}/snooze', 'POST /v1/intelligence/tiles/{id}/acknowledge', 'GET /v1/candidates', 'POST /v1/candidates', 'GET /v1/intelligence/tiles', 'GET /v1/config', 'POST /v1/config', 'PUT /v1/config', 'GET /v1/actions/pending (HR)', 'POST /v1/actions/{id}/approve (HR)', 'POST /v1/actions/{id}/reject (HR)'];
const READ_FAILED = 'Modules read failed';
const MODULE_OFF = 'Module off, skipped';
// Child lock rec-12.1: REC-12 fills the seed. It no longer prints "not available yet"; it prints how many settings it wrote.
const NOT_AVAILABLE_LINE = 'Recruitment Standard pack: not available yet (REC-12)';
const STANDARD_PACK_LINE = /^Recruitment Standard pack: \d+ setting\(s\) written$/;
const BOTH = ['onboarding', 'recruitment'];
const PEOPLE = /John|Doe\b|Jane|Smith|Bongi|Mahlangu|Bea\b|Ndlovu|Sipho|Khumalo|Pia\b|Pule\b|Paul\b|@example\.test/;
const NAMES = new RegExp(Object.values(COMPANY_NAME).join('|'));
const DEV_STS: Sts = { Account: '424556617428', Arn: 'arn:aws:sts::424556617428:assumed-role/pepla-dev-operator/mod01-ac6', UserId: 'AROAMOD01DEV:mod01-ac6' };
const PROD_STS: Sts = { Account: '937137806477', Arn: 'arn:aws:sts::937137806477:assumed-role/naleko-prod-operator/mod01-ac6', UserId: 'AROAMOD01PROD:mod01-ac6' };

/** A helper result's value as a sorted list of keys (the helper may answer a Set or an array). */
const keysOf = (v: any): string[] | undefined => (Array.isArray(v) ? [...v].map(String).sort() : v && Array.isArray(v.set) ? [...v.set].sort() : undefined);
/** A signed-in event of company `c` (or none), for the helper. */
const eventOf = (c: string | null, extra: { query?: Record<string, string>; body?: unknown; headers?: Record<string, string>; path?: Record<string, string>; claims?: Record<string, unknown> } = {}) =>
  httpEvent({ authorizer: jwtAuthorizer({ ...(c ? { tenant_id: c } : {}), ...(extra.claims ?? {}) }), query: extra.query, body: extra.body, headers: extra.headers, path: extra.path });
const header = (r: Run | { response: any }, name: string) => {
  const h = (r as any).response?.headers ?? {};
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : String(h[k]);
};
const putEvents = (r: Run) => (r.calls as any[]).filter((c) => c.service === 'events' && c.op === 'PutEvents');
const sortKeys = (o: any): any => (Array.isArray(o) ? o.map(sortKeys) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o);
const same = (a: Tables, b: Tables) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
/** Rows new or changed by a run (plain values), per table. */
function changed(before: Tables, after: Tables): { table: string; row: Record<string, any> }[] {
  const out: { table: string; row: Record<string, any> }[] = [];
  for (const [table, rows] of Object.entries(after)) {
    const was = new Set((before[table] ?? []).map((r) => JSON.stringify(sortKeys(r))));
    for (const r of rows) if (!was.has(JSON.stringify(sortKeys(r)))) out.push({ table, row: plain(r) });
  }
  return out;
}
/** The AWS calls of a run that are not reads of DynamoDB. */
const notReads = (r: Run) => calls(r).filter((c) => !(c.service === 'dynamodb' && /^(GetItem|Query|Scan|BatchGetItem)$/.test(c.op)));
/** A candidate SAGA row as a stream hands it over. */
function sagaImage(cand: string): Record<string, unknown> {
  return { ...(tables()[TABLE.state] ?? []).find((r) => plain(r)['PK'] === `CANDIDATE#${cand}` && plain(r)['SK'] === 'SAGA')! };
}
const stream = (image: Record<string, unknown>) => ({ Records: [{ eventID: 'ev-1', eventName: 'MODIFY', dynamodb: { NewImage: image } }] });
const ev = (detail: Record<string, unknown>) => ({ source: 'talent-flow.test', 'detail-type': 'MOD01', detail });

test.describe('MOD-01 · A company has modules switched on, and the server refuses a module that is off', () => {
  // ---------------------------------------------------------------- AC-1

  test('AC-1 The helper', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect(existsSync(join(LAMBDA, 'shared', 'modules.mjs')), 'lambda/shared/modules.mjs exists').toBe(true);
    const env = { TENANTS_TABLE: TENANTS };
    const world = tables();

    const keys = runModule([{ get: 'MODULE_KEYS' }, { get: 'modulesOf' }, { get: 'requireModule' }], { tables: world, env });
    expect(keys.importError, `modules.mjs imports (${keys.importError?.message})`).toBeUndefined();
    // CHAT-02 (re-lock mod-01.N): Ask Batsi is the third key; the founding default below still holds the first two.
    expect(keys.results[0]?.value, 'MODULE_KEYS is the one list: onboarding, recruitment, ask_batsi').toEqual([...BOTH, 'ask_batsi']);
    expect(keys.results[1]?.type, 'modulesOf is exported').toBe('function');
    expect(keys.results[2]?.type, 'requireModule is exported').toBe('function');
    expect(callLines(keys), 'importing the helper makes no AWS call').toEqual([]);

    // modulesOf, one company per fresh process (no cache between them).
    const CASES: { c: string; want: string[]; what: string; logs: boolean }[] = [
      { c: A, want: BOTH, what: 'A, founding with no modules attribute: both', logs: false },
      { c: B, want: ['onboarding'], what: 'B: onboarding only', logs: false },
      { c: C, want: ['recruitment'], what: 'C: recruitment only', logs: false },
      { c: D, want: [], what: 'D, suspended: none', logs: true },
      { c: E, want: [], what: 'E, not founding with no attribute: none (the founding default is not inherited)', logs: false },
      { c: F, want: ['recruitment'], what: 'F: the unknown key "payroll" is dropped', logs: false },
      { c: G, want: ['onboarding'], what: 'G, founding WITH an attribute: the attribute, not the default', logs: false },
      { c: X, want: [], what: 'X, no Company row: none', logs: true },
    ];
    for (const k of CASES) {
      const r = runModule([{ fn: 'modulesOf', args: [k.c] }], { tables: world, env });
      const res = r.results[0]!;
      expect.soft(res.ok, `${k.what}: modulesOf does not throw (${res.error?.message})`).toBe(true);
      expect.soft(keysOf(res.value), `${k.what} (got ${JSON.stringify(res.value)})`).toEqual(k.want);
      const reads = calls(r);
      expect.soft(reads.map((c) => `${c.op} ${c.table}`), `${k.what}: one GetItem on the tenants table and nothing else`).toEqual([`GetItem ${TENANTS}`]);
      expect.soft(reads[0]?.input?.Key, `${k.what}: it reads the Company row TENANT#<id> / PROFILE`).toEqual({ pk: { S: `TENANT#${k.c}` }, sk: { S: 'PROFILE' } });
      expect.soft(reads[0]?.input?.ConsistentRead, `${k.what}: strongly consistent`).toBe(true);
      const logs = logLines(r.calls);
      const failed = logs.filter((l) => l.includes(READ_FAILED));
      if (k.logs) {
        expect.soft(failed.length, `${k.what}: logs "${READ_FAILED}"`).toBeGreaterThan(0);
        expect.soft(failed.join('\n'), `${k.what}: the log line names the company id`).toContain(k.c);
      } else {
        expect.soft(failed, `${k.what}: nothing logged as failed`).toEqual([]);
      }
      expect.soft(logs.join('\n'), `${k.what}: no company name in the log`).not.toMatch(NAMES);
    }
    // A read error: none, logged with the company id only, never thrown.
    const broken = runModule([{ fn: 'modulesOf', args: [C] }], { tables: world, env, fail: { service: 'dynamodb', ops: ['GetItem'], message: 'ProvisionedThroughputExceededException: Rate of requests exceeds the allowed throughput' } });
    expect.soft(broken.results[0]?.ok, `a GetItem error does not throw (${broken.results[0]?.error?.message})`).toBe(true);
    expect.soft(keysOf(broken.results[0]?.value), 'a GetItem error gives none (fail closed)').toEqual([]);
    const brokenLogs = logLines(broken.calls).filter((l) => l.includes(READ_FAILED));
    expect.soft(brokenLogs.length, `a GetItem error logs "${READ_FAILED}"`).toBeGreaterThan(0);
    expect.soft(brokenLogs.join('\n'), 'with the company id').toContain(C);
    expect.soft(logLines(broken.calls).join('\n'), 'and no company name').not.toMatch(NAMES);

    // The 60 second cache, per company, in one process.
    const cache = runModule([
      { fn: 'modulesOf', args: [A] }, // 0: reads
      { fn: 'modulesOf', args: [A] }, // 1: cached
      { clock: 59_000 }, // 2
      { fn: 'modulesOf', args: [A] }, // 3: 59 s after the read: still cached
      { clock: 2_000 }, // 4
      { fn: 'modulesOf', args: [A] }, // 5: 61 s after the read: reads again
      { fn: 'modulesOf', args: [C] }, // 6: another company: its own read
      { fn: 'modulesOf', args: [C] }, // 7: cached
    ], { tables: world, env });
    const getsIn = (n: number) => callsOfStep(cache.calls, n).filter((c: any) => c.service === 'dynamodb' && c.op === 'GetItem').length;
    expect.soft(getsIn(0), 'first call: one GetItem').toBe(1);
    expect.soft(getsIn(1), 'a second call straight after: no GetItem').toBe(0);
    expect.soft(keysOf(cache.results[1]?.value), 'and the same answer').toEqual(BOTH);
    expect.soft(getsIn(3), 'a call 59 seconds after the read: still no GetItem').toBe(0);
    expect.soft(getsIn(5), 'a call 61 seconds after the read: one GetItem').toBe(1);
    expect.soft(keysOf(cache.results[5]?.value), 'and the right answer').toEqual(BOTH);
    expect.soft(getsIn(6), 'another company is not served from A\'s cache: one GetItem').toBe(1);
    expect.soft(keysOf(cache.results[6]?.value), 'and gets its own answer').toEqual(['recruitment']);
    expect.soft(getsIn(7), 'that company\'s second call: cached').toBe(0);

    // requireModule: the company from requireTenant, null when the key is on, else 403 {"error":"Forbidden"} with CORS.
    const rm = runModule([
      { fn: 'requireModule', args: [eventOf(B), 'recruitment'] }, // 0
      { fn: 'requireModule', args: [eventOf(C), 'recruitment'] }, // 1
      { fn: 'requireModule', args: [eventOf(A), 'recruitment'] }, // 2
      { fn: 'requireModule', args: [eventOf(B), 'onboarding'] }, // 3
      { fn: 'requireModule', args: [eventOf(C), 'onboarding'] }, // 4
      { fn: 'requireModule', args: [eventOf(D), 'recruitment'] }, // 5
    ], { tables: world, env });
    const refusal = (n: number) => rm.results[n]?.value as any;
    for (const [n, what] of [[0, 'B, recruitment'], [4, 'C, onboarding'], [5, 'D (suspended), recruitment']] as const) {
      expect.soft(rm.results[n]?.ok, `requireModule ${what}: does not throw (${rm.results[n]?.error?.message})`).toBe(true);
      expect.soft(refusal(n)?.statusCode, `requireModule ${what}: 403`).toBe(403);
      expect.soft(JSON.parse(refusal(n)?.body ?? 'null'), `requireModule ${what}: {"error":"Forbidden"}`).toEqual(FORBIDDEN);
      expect.soft(header({ response: refusal(n) }, 'Access-Control-Allow-Origin'), `requireModule ${what}: the usual CORS header`).toBeDefined();
    }
    for (const [n, what] of [[1, 'C, recruitment'], [2, 'A (founding default), recruitment'], [3, 'B, onboarding']] as const) {
      expect.soft(rm.results[n]?.ok, `requireModule ${what}: does not throw (${rm.results[n]?.error?.message})`).toBe(true);
      expect.soft(rm.results[n]?.value, `requireModule ${what}: null (go on)`).toBeNull();
    }
    const noCompany = runModule([{ fn: 'requireModule', args: [eventOf(null), 'recruitment'] }], { tables: world, env });
    expect.soft((noCompany.results[0]?.value as any)?.statusCode, 'requireModule without a company on the token: 403').toBe(403);
    expect.soft(callLines(noCompany), 'and no read').toEqual([]);
    const unknown = runModule([{ fn: 'requireModule', args: [eventOf(C), 'payroll'] }], { tables: world, env });
    expect.soft(unknown.results[0]?.ok, 'requireModule with an unknown key throws').toBe(false);
    expect.soft(callLines(unknown), 'before any read').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 Recruitment is refused when off', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    expect(ROUTES.length, 'the rule 4 routes are listed').toBeGreaterThan(25);
    // TEN-05: lambda/shared/roles.mjs holds the roles; the new groups below are its eight.
    const rolesText = readFileSync(join(LAMBDA, 'shared', 'roles.mjs'), 'utf8');
    for (const g of NEW_GROUPS) expect.soft(rolesText, `roles.mjs names the group ${g}`).toContain(`'${g}'`);
    expect.soft(rolesText, 'roles.mjs exports requireRole').toMatch(/export function requireRole\(/);
    const roleJudged: string[] = [];
    let roleChecked = 0;
    for (const route of ROUTES) {
      const before = tables();
      // B: refused after the one modules read, nothing else read or written.
      const b = ask(route.handler, callerFor(route, 'B'), route.own, { tables: before });
      expect.soft(statusOf(b), `${route.name} as company B: 403 (got ${describe(b)})`).toBe(403);
      expect.soft(bodyOf(b), `${route.name} as company B: {"error":"Forbidden"}`).toEqual(FORBIDDEN);
      expect.soft(header(b, 'Access-Control-Allow-Origin'), `${route.name} as company B: the usual CORS header`).toBeDefined();
      expect.soft(callLines(b), `${route.name} as company B: no AWS call but the one modules read`).toEqual([`dynamodb GetItem ${TENANTS}`]);
      expect.soft(calls(b).every(isModulesRead), `${route.name} as company B: that read is B's Company row`).toBe(true);
      expect.soft(sent(b), `${route.name} as company B: the read names B`).toContain(`TENANT#${B}`);
      expect.soft(same(before, b.tables), `${route.name} as company B: no row changed`).toBe(true);
      // TEN-05: a person of B in the new groups only gets no further (a role refusal first, or the module refusal).
      if (route.who !== 'agent') {
        const nb = ask(route.handler, 'rolesB', route.own, { tables: before });
        expect.soft([401, 403].includes(statusOf(nb) ?? 0), `${route.name} as B in TEN-05's groups: refused (got ${describe(nb)})`).toBe(true);
        if (calls(nb).length) expect.soft(bodyOf(nb), `${route.name} as B in TEN-05's groups: past the role check, the module refusal`).toEqual(FORBIDDEN);
        expect.soft(callLines(nb).filter((l) => l !== `dynamodb GetItem ${TENANTS}`), `${route.name} as B in TEN-05's groups: no AWS call but at most the modules read`).toEqual([]);
        if (calls(nb).length) expect.soft(sent(nb), `${route.name} as B in TEN-05's groups: the read names B`).toContain(`TENANT#${B}`);
        expect.soft(same(before, nb.tables), `${route.name} as B in TEN-05's groups: no row changed`).toBe(true);
      }
      // C and A pass through to the handler; the modules read comes first.
      const c = ask(route.handler, callerFor(route, 'C'), route.own);
      expect.soft(`${statusOf(c)} ${JSON.stringify(bodyOf(c))}`, `${route.name} as company C: not the module refusal (got ${describe(c)})`).not.toBe(`403 ${JSON.stringify(FORBIDDEN)}`);
      expect.soft(calls(c).some((x) => !isModulesRead(x)), `${route.name} as company C: the handler goes on to its own work (got ${callLines(c).join(', ')})`).toBe(true);
      expect.soft(isModulesRead(calls(c)[0]), `${route.name} as company C: the first AWS call is the modules read (got ${callLines(c)[0]})`).toBe(true);
      const a = ask(route.handler, callerFor(route, 'A'), route.own);
      // Child lock rec-05.1 (REC-05 rule 17): the old offer writes pass the same checks, then answer 410 OLD_ROUTE.
      if (isOldOfferWrite(route.name)) expect.soft([statusOf(a), bodyOf(a)], `${route.name} as founding company A: past the checks, 410 OLD_ROUTE (got ${describe(a)})`).toEqual([410, OLD_ROUTE]);
      else expect.soft([200, 201].includes(statusOf(a) ?? 0), `${route.name} as founding company A: works as today (got ${describe(a)})`).toBe(true);
      expect.soft(isModulesRead(calls(a)[0]), `${route.name} as company A: the first AWS call is the modules read (got ${callLines(a)[0]})`).toBe(true);
      // Order: tenant before module (no company: no read at all), role before module.
      const none = ask(route.handler, route.who === 'agent' ? 'public' : 'noTenant', route.own);
      if (route.who !== 'agent') {
        expect.soft(statusOf(none), `${route.name} without a company: 403 (got ${describe(none)})`).toBe(403);
        expect.soft(callLines(none), `${route.name} without a company: no AWS call (the company check comes before the module)`).toEqual([]);
        const noRoleA = ask(route.handler, 'noRoleA', route.own);
        // A wrong-role answer that makes no AWS call but (at most) a modules read is a role check: it must come first.
        if ([401, 403].includes(statusOf(noRoleA) ?? 0) && calls(noRoleA).every(isModulesRead)) {
          roleChecked++;
          roleJudged.push(route.name);
          expect.soft(callLines(noRoleA), `${route.name}: a wrong-role caller of A makes no modules read (role before module)`).toEqual([]);
          const noRoleB = ask(route.handler, 'noRoleB', route.own);
          expect.soft(`${statusOf(noRoleB)} ${JSON.stringify(bodyOf(noRoleB))}`, `${route.name}: a wrong-role caller of B gets the role answer`).toBe(`${statusOf(noRoleA)} ${JSON.stringify(bodyOf(noRoleA))}`);
          expect.soft(callLines(noRoleB), `${route.name}: a wrong-role caller of B makes no modules read (role before module)`).toEqual([]);
        }
      }
    }
    expect(roleChecked, 'the role order was judged on routes that have a role check').toBeGreaterThan(0);
    // TEN-05 order (CORS, role, company, module): the routes with a role check today are judged, the admin-only config writes included.
    expect.soft(roleJudged, 'the role order is judged on every route with a role check').toEqual(ROLE_CHECKED);

    // The Recruitment tools of the TalentFlow chat (decision D-3): refused for B inside resolveToolCall.
    const RESOLVER = join(LAMBDA, 'talentFlowAiChat', 'tool-resolver.mjs');
    for (const tool of TOOLS) {
      const ctx = (c: string) => ({ staffId: 'STAFF-sub-staff', tenantId: c });
      const b = runModule([{ fn: 'resolveToolCall', args: [tool.name, tool.args, ctx(B)] }], { tables: tables(), env: settings(), module: RESOLVER });
      expect.soft(b.importError, `tool-resolver.mjs imports (${b.importError?.message})`).toBeUndefined();
      expect.soft(calls(b).filter((x) => !isModulesRead(x)).map((x) => `${x.op} ${x.table}`), `tool ${tool.name} for company B: no AWS call but the modules read`).toEqual([]);
      expect.soft(calls(b).filter(isModulesRead).length, `tool ${tool.name} for company B: the modules are read`).toBeGreaterThan(0);
      const out = JSON.stringify(b.results[0]?.value ?? b.results[0]?.error ?? null);
      expect.soft(out, `tool ${tool.name} for company B: no Recruitment data and no pending action`).not.toMatch(/John|Jane|Bongi|weights of|PENDING_APPROVAL|actionId/);
      const c = runModule([{ fn: 'resolveToolCall', args: [tool.name, tool.args, ctx(C)] }], { tables: tables(), env: settings(), module: RESOLVER });
      expect.soft(calls(c).some((x) => !isModulesRead(x)), `tool ${tool.name} for company C: the tool runs (got ${callLines(c).join(', ')})`).toBe(true);
    }
    // Ask Batsi itself stays open (rule 4: not gated). The test login is a robot, so the chat answers "AI skipped" and calls no AI.
    const chatB = ask('talentFlowAiChat', 'staffB', { method: 'POST', body: { message: 'How many candidates are in screening?' } });
    expect.soft(statusOf(chatB), `the TalentFlow chat itself, for company B: not refused (got ${describe(chatB)})`).toBe(200);
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 Nothing can choose the module', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const forged = (a: Ask): Ask => ({
      ...a,
      query: { ...(a.query ?? {}), modules: 'recruitment', module: 'recruitment', tenantId: C, tenant_id: C },
      body: a.body && typeof a.body === 'object' ? { ...(a.body as object), modules: BOTH, recruitment: true, ...forgeCompany(C) } : { modules: BOTH, ...forgeCompany(C) },
      headers: { ...(a.headers ?? {}), 'x-modules': 'onboarding,recruitment', modules: 'recruitment', 'x-tenant-id': C },
      path: { ...(a.path ?? {}), modules: 'recruitment', tenantId: C },
      claims: { modules: '["onboarding","recruitment"]', 'custom:modules': 'onboarding,recruitment', 'custom:tenant_id': C, recruitment: 'true' },
    });
    for (const route of ROUTES) {
      const r = ask(route.handler, callerFor(route, 'B'), forged(route.own));
      expect.soft(statusOf(r), `${route.name}: B naming recruitment and C everywhere still gets 403 (got ${describe(r)})`).toBe(403);
      expect.soft(bodyOf(r), `${route.name}: {"error":"Forbidden"}`).toEqual(FORBIDDEN);
      expect.soft(callLines(r), `${route.name}: only the modules read`).toEqual([`dynamodb GetItem ${TENANTS}`]);
      expect.soft(sent(r), `${route.name}: the read is B's Company row, never C's`).not.toContain(C);
    }
    // The helper itself, given everything a request can carry.
    const rm = runModule([{ fn: 'requireModule', args: [eventOf(B, { query: { modules: 'recruitment', tenantId: C }, body: { modules: BOTH, tenantId: C }, headers: { 'x-modules': 'recruitment', 'x-tenant-id': C }, path: { modules: 'recruitment' }, claims: { modules: '["recruitment"]', 'custom:modules': 'recruitment' } }), 'recruitment'] }], { tables: tables(), env: { TENANTS_TABLE: TENANTS } });
    expect.soft((rm.results[0]?.value as any)?.statusCode, 'requireModule for B with every forged name: 403').toBe(403);
    // Text: the helper never reads claims, nor anything the caller sends.
    const file = join(LAMBDA, 'shared', 'modules.mjs');
    expect(existsSync(file), 'lambda/shared/modules.mjs exists').toBe(true);
    const code = stripJs(readFileSync(file, 'utf8'));
    expect.soft(code.match(/claims/g) ?? [], 'modules.mjs reads no claims (the token is never a source of modules)').toEqual([]);
    expect.soft(code.match(/\b(queryStringParameters|pathParameters|cookies|multiValueHeaders)\b|\.\s*headers\b|\.\s*body\b/g) ?? [], 'modules.mjs reads nothing the caller sends').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Public and event paths', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const vote = { rating: 'YES', scores: { technical: 4, communication: 4, culturalFit: 4, problemSolving: 4 } };
    const voteBy = (token: string, t: Tables = tables(), forge: Record<string, string> = {}) =>
      ask('submitVoteByToken', 'public', { method: 'POST', path: { token }, body: { ...vote, ...forge }, headers: forge['tenantId'] ? { 'x-tenant-id': forge['tenantId'] } : {} }, { tables: t });
    // Today's answer for an expired link of B (its ttl in the past): the answer B must get.
    const expiredWorld = tables();
    expiredWorld[TABLE.state] = expiredWorld[TABLE.state]!.map((r) => (plain(r)['PK'] === `SCORING_LINK#${ID.voteTokenB}` ? { ...r, ttl: { N: '1000' } } : r));
    const expired = voteBy(ID.voteTokenB, expiredWorld);
    expect([403, 410].includes(statusOf(expired) ?? 0), `control: an expired link is refused as today (got ${describe(expired)})`).toBe(true);
    const before = tables();
    const b = voteBy(ID.voteTokenB, before);
    expect.soft(`${statusOf(b)} ${JSON.stringify(bodyOf(b))}`, 'a token stored under B answers exactly as an expired link').toBe(`${statusOf(expired)} ${JSON.stringify(bodyOf(expired))}`);
    expect.soft(same(before, b.tables), 'and records nothing').toBe(true);
    expect.soft(notReads(b).map((x) => `${x.service} ${x.op}`), 'and sends nothing on').toEqual([]);
    expect.soft(calls(b).some(isModulesRead), 'the token\'s company\'s modules are read').toBe(true);
    expect.soft(sent(b), 'the company read is the token\'s (B)').toContain(`TENANT#${B}`);
    // The body (and a header) naming C in every spelling changes nothing: the company is the stored link's.
    const forgedWorld = tables();
    const bForged = voteBy(ID.voteTokenB, forgedWorld, forgeCompany(C));
    expect.soft(`${statusOf(bForged)} ${JSON.stringify(bodyOf(bForged))}`, 'a token stored under B, with C named in the body as tenant_id, tenantId, company...: still the expired-link answer').toBe(`${statusOf(expired)} ${JSON.stringify(bodyOf(expired))}`);
    expect.soft(same(forgedWorld, bForged.tables), 'and records nothing').toBe(true);
    expect.soft(notReads(bForged).map((x) => `${x.service} ${x.op}`), 'and sends nothing on').toEqual([]);
    expect.soft(sent(bForged), 'and reads B\'s Company row, never C\'s').not.toContain(`TENANT#${C}`);
    for (const [who, token, cand, own] of [['C', ID.voteTokenC, ID.c1, C], ['A', ID.voteTokenA, ID.a1, A]] as const) {
      for (const [how, forge] of [['', {}], [' with B (Recruitment off) named in the body', forgeCompany(B)]] as const) {
        const t = tables();
        const r = voteBy(token, t, forge);
        expect.soft(statusOf(r), `a token stored under ${who}${how} works as today (got ${describe(r)})`).toBe(200);
        const voteRow = changed(t, r.tables).find((x) => String(x.row['SK']).startsWith('VOTE#'));
        expect.soft(voteRow?.row['PK'], `the vote of ${who}${how} is recorded on its candidate`).toBe(`CANDIDATE#${cand}`);
        expect.soft(voteRow?.row['tenant_id'], `the vote of ${who}${how} carries the link's company`).toBe(own);
        expect.soft(sent(r), `the link of ${who}${how} never reads B's Company row`).not.toContain(`TENANT#${B}`);
      }
    }

    // Event and job handlers: a record of B is skipped and logged, never thrown; C runs as today. Each record also names the
    // other company in every spelling but tenant_id (tenantId, company, companyId, ...): only tenant_id counts (TEN-03).
    const JOBS: { name: string; run: (c: 'B' | 'C') => Run; wrote: (r: Run, t: Tables) => boolean }[] = [
      {
        name: 'evaluateIntelligenceRules (rule evaluation)',
        run: (c) => runEvent('evaluateIntelligenceRules', stream({ ...sagaImage(c === 'B' ? ID.b1 : ID.c1), ...avOf(forgeCompany(c === 'B' ? C : B, false)) })),
        wrote: (r, t) => changed(t, r.tables).some((x) => String(x.row['PK']).includes('#SNAP')),
      },
      {
        name: 'sendTalentFlowNotification (notification sender)',
        run: (c) => runEvent('sendTalentFlowNotification', { Records: [{ messageId: 'm-1', body: JSON.stringify({ type: 'INTERVIEW_SCHEDULED', recipientEmail: `hm.${c.toLowerCase()}@example.test`, recipientId: c === 'B' ? SUB.hmB : SUB.hmC, candidateId: c === 'B' ? ID.b1 : ID.c1, ...forgeCompany(c === 'B' ? C : B, false), tenant_id: c === 'B' ? B : C }) }] }),
        wrote: (r) => (r.calls as any[]).some((x) => x.service === 'postmark'),
      },
      {
        name: 'orchestrateTalentFlowWorkflow (orchestration)',
        run: (c) => {
          const t = tables();
          t[TABLE.state] = t[TABLE.state]!.map((r) => (plain(r)['SK'] === 'SAGA' ? Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'configVersion')) : r));
          return runEvent('orchestrateTalentFlowWorkflow', ev({ candidateId: c === 'B' ? ID.b1 : ID.c2, ...forgeCompany(c === 'B' ? C : B, false), tenant_id: c === 'B' ? B : C, positionLevel: 'MID' }), { tables: t });
        },
        wrote: (r) => calls(r).some((x) => /PutItem|UpdateItem|StartExecution|PutEvents/.test(x.op ?? '')),
      },
    ];
    for (const j of JOBS) {
      const c = j.run('C');
      expect.soft(c.error, `${j.name}: control, a record of C runs (${c.error?.message})`).toBeUndefined();
      expect.soft(j.wrote(c, tables()), `${j.name}: control, a record of C does its work`).toBe(true);
      const b = j.run('B');
      expect.soft(b.error, `${j.name}: a record of B does not throw (${b.error?.message})`).toBeUndefined();
      expect.soft(callLines(b).filter((l) => l !== `dynamodb GetItem ${TENANTS}`), `${j.name}: a record of B is skipped (no call but the modules read)`).toEqual([]);
      expect.soft(calls(b).some(isModulesRead), `${j.name}: B's modules are read`).toBe(true);
      const lines = logLines(b.calls);
      const skipped = lines.filter((l) => l.includes(MODULE_OFF));
      expect.soft(skipped.length, `${j.name}: logs "${MODULE_OFF}"`).toBeGreaterThan(0);
      expect.soft(skipped.join('\n'), `${j.name}: with the company id`).toContain(B);
      expect.soft(lines.join('\n'), `${j.name}: no name or email in the log`).not.toMatch(PEOPLE);
      expect.soft(lines.join('\n'), `${j.name}: no company name in the log`).not.toMatch(NAMES);
    }
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 The route', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect(existsSync(join(LAMBDA, 'getCompanyModules')), 'lambda/getCompanyModules exists').toBe(true);
    const get = (caller: Caller, a: Ask = {}, opts: { fail?: any } = {}) => ask('getCompanyModules', caller, { rawPath: '/v1/company/modules', ...a }, opts);
    const CASES: { caller: Caller; c: string; want: string[]; what: string; claims?: Record<string, unknown> }[] = [
      { caller: 'staffA', c: A, want: BOTH, what: 'a caller of A (founding, no attribute)' },
      { caller: 'staffB', c: B, want: ['onboarding'], what: 'a caller of B' },
      { caller: 'staffC', c: C, want: ['recruitment'], what: 'a caller of C' },
      { caller: 'guestA', c: A, want: BOTH, what: 'a guest of A (no role needed)' },
      { caller: 'noRoleA', c: A, want: BOTH, what: 'a caller of A in no role group (robots only)' },
      { caller: 'noRoleA', c: A, want: BOTH, what: 'a caller of A with no groups claim at all', claims: { 'cognito:groups': undefined } },
      { caller: 'guestB', c: B, want: ['onboarding'], what: 'a guest of B' },
      { caller: 'staffD', c: D, want: [], what: 'a caller of D (suspended)' },
      { caller: 'staffX', c: X, want: [], what: 'a caller of a company with no row' },
    ];
    for (const k of CASES) {
      const r = get(k.caller, k.claims ? { claims: k.claims } : {});
      expect.soft(statusOf(r), `${k.what}: 200 (got ${describe(r)})`).toBe(200);
      expect.soft(bodyOf(r), `${k.what}: { "modules": ${JSON.stringify(k.want)} }, sorted, and nothing else`).toEqual({ modules: k.want });
      expect.soft(callLines(r), `${k.what}: one GetItem on the tenants table`).toEqual([`dynamodb GetItem ${TENANTS}`]);
      expect.soft(sent(r), `${k.what}: of its own Company row`).toContain(`TENANT#${k.c}`);
      expect.soft(header(r, 'Cache-Control'), `${k.what}: Cache-Control private, no-store`).toBe('private, no-store');
      expect.soft(header(r, 'Access-Control-Allow-Origin'), `${k.what}: the usual CORS header`).toBeDefined();
      expect.soft(JSON.stringify(bodyOf(r)), `${k.what}: no company name, plan or status`).not.toMatch(new RegExp(`${NAMES.source}|ACTIVE|SUSPENDED|founding|plan`));
    }
    const failing = get('staffC', {}, { fail: { service: 'dynamodb', ops: ['GetItem'], message: 'InternalServerError: DynamoDB is unavailable' } });
    expect.soft(statusOf(failing), `a read error: 200, never a 500 (got ${describe(failing)})`).toBe(200);
    expect.soft(bodyOf(failing), 'a read error: { "modules": [] }').toEqual({ modules: [] });
    expect.soft(logLines(failing.calls).some((l) => l.includes(READ_FAILED) && l.includes(C)), `a read error: logs "${READ_FAILED}" with the company id`).toBe(true);
    const none = get('noTenant');
    expect.soft(statusOf(none), `no company on the token: 403 (got ${describe(none)})`).toBe(403);
    expect.soft(bodyOf(none), 'no company on the token: {"error":"Forbidden"}').toEqual(FORBIDDEN);
    expect.soft(header(none, 'Access-Control-Allow-Origin'), 'no company on the token: the usual CORS header').toBeDefined();
    expect.soft(callLines(none), 'no company on the token: no AWS call').toEqual([]);
    // The request cannot choose: B naming recruitment and C everywhere, with a forged modules claim, still gets B's.
    const forged = get('staffB', { query: { modules: 'recruitment', tenantId: C }, headers: { 'x-modules': 'recruitment', 'x-tenant-id': C }, body: { modules: BOTH, ...forgeCompany(C) }, claims: { modules: '["onboarding","recruitment"]', 'custom:modules': 'onboarding,recruitment' } });
    expect.soft(bodyOf(forged), 'B naming recruitment, C and a forged modules claim: still { "modules": ["onboarding"] }').toEqual({ modules: ['onboarding'] });
    expect.soft(sent(forged), 'and the read is B\'s, never C\'s').not.toContain(C);
    for (const [c, want] of [[F, ['recruitment']], [G, ['onboarding']]] as const) {
      const r = ask('getCompanyModules', 'staffX', { rawPath: '/v1/company/modules', claims: { tenant_id: c } });
      expect.soft(bodyOf(r), `company ${c.slice(0, 5)}…${c.slice(-1)}: ${JSON.stringify(want)}`).toEqual({ modules: want });
    }
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 The script', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const SCRIPT = join(REPO, 'scripts', 'tenancy', 'set-modules.mjs');
    for (const f of ['set-modules.mjs', join('lib', 'set-modules.mjs'), join('module-seeds', 'onboarding.mjs'), join('module-seeds', 'recruitment.mjs')]) {
      expect(existsSync(join(REPO, 'scripts', 'tenancy', f)), `scripts/tenancy/${f} exists`).toBe(true);
    }
    const company = () => [...companyRows(), av({ pk: `USER#${SUB.hmB}`, sk: `TENANT#${B}`, tenant_id: B })];
    const world0 = (): Tables => ({ [TENANTS]: company(), [TENANTS_PROD]: company(), [TABLE.config]: [] });
    const run = (args: string[], t: Tables = world0(), sts: Sts = DEV_STS, script = SCRIPT) => runScript(script, args, { tables: t, sts });
    const onB = ['--env', 'dev', '--tenant', B, '--on', 'recruitment', '--reason', 'MOD-01 AC-6'];
    const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;
    const audits = (t: Tables, c: string, table = TENANTS) => rowsOf(t, table).filter((r) => r['pk'] === `TENANT#${c}` && String(r['sk']).startsWith('MODULES#'));
    const list = (v: unknown) => (Array.isArray(v) ? [...v].map(String).sort() : typeof v === 'string' ? (() => { try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String).sort() : v; } catch { return v; } })() : v);
    const others = (t: Tables, c: string) => JSON.stringify(sortKeys(Object.fromEntries(Object.entries(t).filter(([k]) => k !== TABLE.config).map(([k, rows]) => [k, rows.filter((r) => !(plain(r)['pk'] === `TENANT#${c}` && (plain(r)['sk'] === 'PROFILE' || String(plain(r)['sk']).startsWith('MODULES#') || /^DEPARTMENTS(#|$)/.test(String(plain(r)['sk'])))))]))));
    // child lock rec-14.1, REC-14: switching Recruitment on also gives the company its department list (sk DEPARTMENTS), judged in rec-14.spec.ts AC-4.
    const clean = (what: string, r: { stdout: string; stderr: string }) => {
      expect.soft(out(r), `${what}: the output names no company and no person`).not.toMatch(NAMES);
      expect.soft(out(r), `${what}: and no address`).not.toMatch(/@/);
    };

    // Dry run: the plan, nothing written.
    const dry = run(onB);
    expect(dry.code, `the dry run exits 0 (${out(dry).slice(-400)})`).toBe(0);
    expect.soft(dry.writes.map((w: any) => `${w.op} ${w.table}`), 'the dry run writes nothing').toEqual([]);
    expect.soft(out(dry), 'the dry run prints the plan (it names the module)').toContain('recruitment');
    clean('the dry run', dry);

    // Apply: seed first, then the key, then one audit row.
    const applied = run([...onB, '--apply']);
    expect(applied.code, `--apply exits 0 (${out(applied).slice(-400)})`).toBe(0);
    expect.soft(profileOf(applied.tables, B)?.['modules'], 'B now has onboarding and recruitment').toEqual(BOTH);
    expect.soft((applied.tables[TENANTS] ?? []).find((r) => plain(r)['pk'] === `TENANT#${B}` && plain(r)['sk'] === 'PROFILE')?.['modules'] && 'SS' in (applied.tables[TENANTS]!.find((r) => plain(r)['pk'] === `TENANT#${B}` && plain(r)['sk'] === 'PROFILE')!['modules'] as object), 'stored as a string set').toBe(true);
    const rows = audits(applied.tables, B);
    expect.soft(rows.length, 'one audit row for the change').toBe(1);
    const audit = rows[0] ?? {};
    expect.soft(String(audit['sk']), 'the audit row is sk MODULES#<iso time>#<ulid>').toMatch(/^MODULES#\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z#[0-9A-Z]{26}$/);
    expect.soft(list(audit['from']), 'from: what B had').toEqual(['onboarding']);
    expect.soft(list(audit['to']), 'to: what B has now').toEqual(BOTH);
    expect.soft(audit['reason'], 'reason: as given').toBe('MOD-01 AC-6');
    expect.soft(audit['by'], 'by: the AWS caller ARN from STS').toBe(DEV_STS.Arn);
    expect.soft(audit['env'], 'env: dev').toBe('dev');
    expect.soft(others(applied.tables, B), 'nothing else in the company list changed').toBe(others(world0(), B));
    expect.soft(applied.writes.filter((w: any) => /Delete/.test(w.op) || JSON.stringify(w.input ?? {}).includes('DeleteRequest') || JSON.stringify(w.input ?? {}).includes('"Delete"')).length, 'no delete').toBe(0);
    const seedAt = (applied.calls as any[]).findIndex((c) => c.service === 'log' && STANDARD_PACK_LINE.test(String(c.message)));
    // rec-12.1: the pack now writes (the config table) before the key is set, so the flip is the LAST write, and the seed's line comes before it.
    const firstWrite = (applied.calls as any[]).findLastIndex((c) => c.service === 'dynamodb' && /PutItem|UpdateItem|TransactWriteItems|BatchWriteItem/.test(c.op));
    expect.soft(seedAt, 'the Recruitment seed runs (it prints how many settings it wrote)').toBeGreaterThanOrEqual(0);
    expect.soft(seedAt >= 0 && firstWrite >= 0 && seedAt < firstWrite, 'the seed runs before the key is set (seed before flip)').toBe(true);
    clean('--apply', applied);

    // A second apply changes nothing and writes no row.
    const again = run([...onB, '--apply'], applied.tables);
    expect.soft(again.code, `a second --apply exits 0 (${out(again).slice(-300)})`).toBe(0);
    expect.soft(again.writes.map((w: any) => `${w.op} ${w.table}`), 'a second --apply writes nothing (no audit row)').toEqual([]);

    // A failing seed leaves modules untouched and writes no audit row (a copy of the scripts with a broken seed).
    for (const [what, seed] of [
      ['a seed that fails as it loads', `throw new Error('MOD-01 planted: the seed failed');\n`],
      ['a seed that fails when run', `const fail = async () => { throw new Error('MOD-01 planted: the seed failed'); };\nexport default fail;\nexport const seed = fail;\nexport const run = fail;\nexport const apply = fail;\nexport const seedModule = fail;\n`],
    ] as const) {
      const copy = scriptsCopy();
      writeFileSync(join(copy, 'scripts', 'tenancy', 'module-seeds', 'recruitment.mjs'), seed);
      const broken = run([...onB, '--apply'], world0(), DEV_STS, join(copy, 'scripts', 'tenancy', 'set-modules.mjs'));
      expect.soft(broken.code, `${what}: the script exits non-zero`).not.toBe(0);
      expect.soft(profileOf(broken.tables, B)?.['modules'], `${what}: B keeps onboarding only`).toEqual(['onboarding']);
      expect.soft(audits(broken.tables, B), `${what}: no audit row`).toEqual([]);
      expect.soft(broken.writes.map((w: any) => `${w.op} ${w.table}`), `${what}: nothing written at all`).toEqual([]);
      rmSync(copy, { recursive: true, force: true });
    }

    // --off removes the key and deletes nothing.
    const off = run(['--env', 'dev', '--tenant', B, '--off', 'recruitment', '--reason', 'MOD-01 AC-6 off', '--apply'], applied.tables);
    expect.soft(off.code, `--off exits 0 (${out(off).slice(-300)})`).toBe(0);
    expect.soft(profileOf(off.tables, B)?.['modules'], '--off: B has onboarding only again').toEqual(['onboarding']);
    expect.soft(audits(off.tables, B).length, '--off: one more audit row').toBe(2);
    expect.soft(audits(off.tables, B).find((r) => r['sk'] === audit['sk']), '--off: the first audit row is left as it was').toEqual(audit);
    expect.soft((off.tables[TENANTS] ?? []).length, '--off: no row deleted (one row more than before)').toBe((applied.tables[TENANTS] ?? []).length + 1);
    // --off on the founding company, which has no attribute: it ends with exactly what is left on.
    const offA = run(['--env', 'dev', '--tenant', A, '--off', 'recruitment', '--reason', 'MOD-01 AC-6 founding', '--apply']);
    expect.soft(offA.code, `--off on founding A exits 0 (${out(offA).slice(-300)})`).toBe(0);
    expect.soft(profileOf(offA.tables, A)?.['modules'], '--off recruitment on founding A (no attribute): A keeps onboarding only').toEqual(['onboarding']);
    expect.soft(list(audits(offA.tables, A)[0]?.['from']), 'and the audit row\'s from is what A had by default').toEqual(BOTH);

    // Refusals: nothing written.
    for (const [what, args] of [
      ['an unknown key', ['--env', 'dev', '--tenant', B, '--on', 'payroll', '--reason', 'r', '--apply']],
      ['a malformed company id', ['--env', 'dev', '--tenant', 'ten_short', '--on', 'recruitment', '--reason', 'r', '--apply']],
      ['DEFAULT as a company', ['--env', 'dev', '--tenant', 'DEFAULT', '--on', 'recruitment', '--reason', 'r', '--apply']],
      ['an unknown company', ['--env', 'dev', '--tenant', X, '--on', 'recruitment', '--reason', 'r', '--apply']],
      ['no company', ['--env', 'dev', '--on', 'recruitment', '--reason', 'r', '--apply']],
    ] as const) {
      const r = run([...args]);
      expect.soft(r.code, `${what}: refused (non-zero exit)`).not.toBe(0);
      expect.soft(r.writes.map((w: any) => `${w.op} ${w.table}`), `${what}: nothing written`).toEqual([]);
    }

    // Prod: with the Standard pack available (REC-12), Recruitment can be turned on; the pack is written, then the key.
    const prodRec = run(['--env', 'prod', '--tenant', B, '--on', 'recruitment', '--reason', 'r', '--apply'], world0(), PROD_STS);
    expect.soft(prodRec.code, `prod --apply turning Recruitment on runs now the Standard pack exists (${out(prodRec).slice(-300)})`).toBe(0);
    expect.soft(out(prodRec), 'and no longer says "not available yet"').not.toContain(NOT_AVAILABLE_LINE);
    expect.soft(profileOf(prodRec.tables, B, TENANTS_PROD)?.['modules'], 'prod B has onboarding and recruitment').toEqual(BOTH);
    const prodOnb = run(['--env', 'prod', '--tenant', C, '--on', 'onboarding', '--reason', 'r', '--apply'], world0(), PROD_STS);
    expect.soft(prodOnb.code, `control: prod --apply turning Onboarding on for C runs (${out(prodOnb).slice(-300)})`).toBe(0);
    expect.soft(profileOf(prodOnb.tables, C, TENANTS_PROD)?.['modules'], 'on the prod company list').toEqual(BOTH);
    expect.soft(profileOf(prodOnb.tables, C)?.['modules'], 'and not on the dev one').toEqual(['recruitment']);
    expect.soft(audits(prodOnb.tables, C, TENANTS_PROD)[0]?.['env'], 'its audit row says env prod').toBe('prod');

    // --check reports a mismatch.
    const checkBefore = run([...onB, '--check']);
    expect.soft(checkBefore.code, '--check before the change: exits 1 (B lacks recruitment)').toBe(1);
    expect.soft(checkBefore.writes, '--check writes nothing').toEqual([]);
    const checkAfter = run([...onB, '--check'], applied.tables);
    expect.soft(checkAfter.code, `--check after the change: exits 0 (${out(checkAfter).slice(-300)})`).toBe(0);
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 No other way to write modules', async ({}, testInfo) => {
    once(testInfo.project.name);
    const WRITE = /\b(PutItem|UpdateItem|TransactWriteItems|BatchWriteItem|Put|Update|TransactWrite|BatchWrite)Command\b|\b(PutItem|UpdateItem|TransactWriteItems|BatchWriteItem|put_item|update_item|batch_write_item|transact_write_items|batch_writer)\b/;
    // ONB-21 (re-lock mod-01.4): sendDocumentReminders names the modules attribute to READ it and PutItem-writes its own claim rows in another table; it never writes a modules attribute (onb-21.spec.ts AC-7).
    const ALLOWED = ['scripts/tenancy/lib/set-modules.mjs', 'scripts/ci/seed-dev.py', 'lambda/sendDocumentReminders/index.mjs', 'lambda/adminSetAskBatsi/index.mjs',
      // Dev E2E (re-lock mod-01.11): the company walk needs Ask Batsi on for its two dev companies, and set-modules.mjs has no ask_batsi seed. This script only ADDS the key ask_batsi to a company row that exists, and refuses to run outside pepla-dev.
      'scripts/ci/dev-ask-batsi-on.py'];
    // CHAT-02 (re-lock mod-01.5): the Ask Batsi switch has its own admin route; chat-02.spec.ts AC-22 pins what it writes.
    const writers: string[] = [];
    for (const f of [...sources(LAMBDA), ...sources(join(REPO, 'scripts'))]) {
      const rel = relative(REPO, f);
      const text = (f.endsWith('.py') ? stripPy(readFileSync(f, 'utf8')) : stripJs(readFileSync(f, 'utf8'))).replace(/modules\.mjs|set-modules|module-seeds|sys\.modules/g, '');
      if (/\bmodules\b/.test(text) && WRITE.test(text)) writers.push(rel);
    }
    expect.soft(writers.filter((w) => !ALLOWED.includes(w)), 'only the script\'s library (and the dev seed) write a "modules" attribute').toEqual([]);
    expect(writers, 'the script\'s library is the writer (scripts/tenancy/lib/set-modules.mjs)').toContain('scripts/tenancy/lib/set-modules.mjs');
    for (const f of [join(LAMBDA, 'shared', 'modules.mjs'), ...sources(join(LAMBDA, 'getCompanyModules'))]) {
      if (!existsSync(f)) continue;
      expect.soft(stripJs(readFileSync(f, 'utf8')).match(WRITE) ?? [], `${relative(REPO, f)} writes nothing`).toEqual([]);
    }
    // The user admin routes ignore a body field named modules (mass assignment).
    const t = tables();
    const create = ask('adminCreateUser', 'staffB', { method: 'POST', body: { email: 'new.person@example.test', givenName: 'New', familyName: 'Person', roles: ['HM'], modules: BOTH, tenant_id: B, recruitment: true } }, { tables: t });
    expect.soft([200, 201].includes(statusOf(create) ?? 0), `control: adminCreateUser works for B's admin (got ${describe(create)})`).toBe(true);
    const update = ask('adminUpdateUser', 'staffB', { method: 'PUT', path: { userId: 'hm.b@example.test' }, body: { roles: ['HM'], modules: BOTH, tenant_id: B } }, { tables: t });
    // TEN-05's body ({ role, permissions }) with modules in it.
    const create5 = ask('adminCreateUser', 'staffB', { method: 'POST', body: { email: 'new.person5@example.test', givenName: 'New', familyName: 'Person', role: 'manager', permissions: ['perm-recruitment'], modules: BOTH, tenant_id: B, recruitment: true } }, { tables: t });
    expect.soft([200, 201].includes(statusOf(create5) ?? 0), `control: adminCreateUser with TEN-05's body works for B's admin (got ${describe(create5)})`).toBe(true);
    const update5 = ask('adminUpdateUser', 'staffB', { method: 'PUT', path: { userId: 'hm.b@example.test' }, body: { role: 'hr_staff', permissions: ['perm-recruitment'], modules: BOTH, tenant_id: B } }, { tables: t });
    for (const [what, r] of [['adminCreateUser', create], ['adminUpdateUser', update], ['adminCreateUser (TEN-05 body)', create5], ['adminUpdateUser (TEN-05 body)', update5]] as const) {
      expect.soft(profileOf(r.tables, B), `${what} with modules in the body: B's Company row is unchanged`).toEqual(profileOf(t, B));
      expect.soft(changed(t, r.tables).filter((x) => 'modules' in x.row).map((x) => x.table), `${what}: no row written with a modules attribute`).toEqual([]);
      expect.soft(JSON.stringify(calls(r).filter((x) => x.service === 'cognito' || x.service === 'cognito-idp')), `${what}: no modules attribute in Cognito`).not.toMatch(/modules/);
    }
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Terraform and roles hold exactly this', async ({}, testInfo) => {
    once(testInfo.project.name);
    // The new route, on the employees API (D-1), behind its Cognito JWT authorizer.
    const fns = lambdaNamed('getCompanyModules');
    expect(fns.length, 'one aws_lambda_function named getCompanyModules').toBe(1);
    const fn = fns[0]!;
    expect(fn.stack, 'it is in infra/ (the Naleko stack)').toBe('infra');
    const fnRef = `aws_lambda_function.${fn.block.labels[1]}`;
    const routes = resourcesOf('infra', 'aws_apigatewayv2_route').filter((b) => attributes(b.body).get('route_key') === '"GET/v1/company/modules"'); // attribute text has no whitespace
    expect(routes.length, 'one route GET /v1/company/modules').toBe(1);
    const route = attributes(routes[0]!.body);
    expect(route.get('api_id'), 'on the employees API (the one MOD-02 calls through employeesApiUrl)').toBe('aws_apigatewayv2_api.employees_api.id');
    expect(route.get('authorization_type'), 'JWT').toBe('"JWT"');
    expect(route.get('authorizer_id'), 'the employees API\'s Cognito authorizer').toBe('aws_apigatewayv2_authorizer.employees_api_cognito.id');
    const integ = /^"integrations\/\$\{aws_apigatewayv2_integration\.([\w-]+)\.id\}"$/.exec(route.get('target') ?? '')?.[1];
    const integration = resourcesOf('infra', 'aws_apigatewayv2_integration').find((b) => b.labels[1] === integ);
    expect(integration, 'the route targets an integration').toBeTruthy();
    const ia = attributes(integration!.body);
    expect(ia.get('api_id'), 'the integration is on the employees API').toBe('aws_apigatewayv2_api.employees_api.id');
    expect(ia.get('integration_uri'), 'and invokes getCompanyModules').toBe(`${fnRef}.invoke_arn`);
    expect(ia.get('payload_format_version'), 'payload 2.0').toBe('"2.0"');
    const perms = resourcesOf('infra', 'aws_lambda_permission').filter((b) => (attributes(b.body).get('function_name') ?? '').startsWith(`${fnRef}.`));
    expect(perms.length, 'one aws_lambda_permission for it').toBe(1);
    const perm = attributes(perms[0]!.body);
    expect(perm.get('principal'), 'API Gateway may invoke it').toBe('"apigateway.amazonaws.com"');
    expect(perm.get('source_arn') ?? '', 'only from the employees API').toContain('aws_apigatewayv2_api.employees_api.execution_arn');
    // CORS: the app sends GET with an Authorization header from its own origins (LESSONS NH-187).
    const api = resourcesOf('infra', 'aws_apigatewayv2_api').find((b) => b.labels[1] === 'employees_api')!;
    const cors = squash(api.body);
    expect(cors, 'employees API CORS allows the authorization header').toMatch(/allow_headers=\[[^\]]*"authorization"/);
    expect(cors, 'and GET').toMatch(/allow_methods=\[[^\]]*"GET"/);
    expect(cors, 'from the app\'s origins').toContain('allow_origins=local.api_allowed_origins');

    // The function: Node 22, the tenants table named by TENANTS_TABLE (D-4), no AI.
    const fa = attributes(fn.block.body);
    expect(fa.get('runtime'), 'nodejs22.x').toBe('"nodejs22.x"');
    expect(settingsOf(fn.block).get('TENANTS_TABLE'), 'TENANTS_TABLE = the tenants table').toBe('aws_dynamodb_table.tenants.name');
    expect(squash(fn.block.body), 'no AI setting').not.toMatch(/bedrock|anthropic|openai|MODEL/i);
    // Its role: logs, X-Ray, GetItem on the tenants table. Nothing else; KMS through the key policy only.
    const role = roleResourceOf(fn.block)!;
    expect(role, 'it runs as its own aws_iam_role').toBeTruthy();
    const all = policyLines();
    const newPairs = Object.values(all).filter((p) => p.stack === 'infra' && p.role === role).flatMap((p) => p.pairs ?? [`unreadable ${p.squash}`]);
    expect(newPairs.length, 'the role has a policy').toBeGreaterThan(0);
    for (const p of newPairs) {
      const [effect, action, res, cond] = [p.split(' ')[0], p.split(' ')[1]!, p.split(' ')[2]!, p.split(' ').slice(3).join(' ')];
      const ok = effect === 'Allow' && cond === 'null' && (
        (/^logs:(CreateLogGroup|CreateLogStream|PutLogEvents)$/.test(action) && res.includes('log-group:/aws/lambda/getCompanyModules'))
        || (/^xray:(PutTraceSegments|PutTelemetryRecords)$/.test(action) && res === '*')
        || (action === 'dynamodb:GetItem' && TENANTS_RESOURCE.test(res)));
      expect.soft(ok, `getCompanyModules role: "${p}" is only logs, X-Ray or GetItem on the tenants table`).toBe(true);
    }
    expect(newPairs.some((p) => / dynamodb:GetItem /.test(p)), 'the role may GetItem the tenants table').toBe(true);
    expect.soft(resourcesOf('infra', 'aws_iam_role_policy_attachment').filter((b) => (attributes(b.body).get('role') ?? '').startsWith(`aws_iam_role.${role}.`)).map((b) => attributes(b.body).get('policy_arn')), 'no managed policy on it').toEqual([]);
    expect.soft(kmsList('dynamodb_read_role_arns'), 'kms_pii dynamodb_read_role_arns names its role').toContain(`aws_iam_role.${role}.arn`);
    expect.soft(kmsList('allowed_role_arns'), 'and allowed_role_arns does not').not.toContain(`aws_iam_role.${role}.`);

    // Every gated Lambda: TENANTS_TABLE set, GetItem on the tenants table added, KMS read through the key policy.
    const read = squash(kmsList('dynamodb_read_role_arns'));
    const encrypt = squash(kmsList('allowed_role_arns'));
    expect(ROUTES.some((x) => x.handler === 'talentFlowApproveAction' && x.name.includes('/reject')), 'the reject route is on the rule 4 list').toBe(true);
    for (const x of ROUTES) expect.soft(GATED_LAMBDAS, `${x.name}: its Lambda is on the gated list`).toContain(x.handler);
    for (const name of GATED_LAMBDAS) {
      const found = lambdaNamed(name);
      expect.soft(found.length, `${name}: one aws_lambda_function in infra/ or talent-flow-infra/`).toBe(1);
      if (found.length !== 1) continue;
      const { stack, block } = found[0]!;
      const r = roleResourceOf(block);
      const info = r ? roleInfo(stack, r) : undefined;
      expect.soft(!!info, `${name}: its role is an aws_iam_role of its stack`).toBe(true);
      if (!r || !info) continue;
      const tableSetting = settingsOf(block).get('TENANTS_TABLE') ?? '';
      expect.soft(stack === 'infra' ? tableSetting === 'aws_dynamodb_table.tenants.name' : ['local.tf_tenants_table', '"naleko-people-${var.environment}-tenants"'].includes(tableSetting), `${name}: TENANTS_TABLE names the tenants table (got ${tableSetting || 'nothing'})`).toBe(true);
      const mine = Object.values(all).filter((p) => (p.stack === stack && p.role === r) || valueOf(p.stack, p.role) === info.name);
      const getItem = mine.flatMap((p) => p.pairs ?? []).filter((p) => /^Allow dynamodb:GetItem /.test(p) && TENANTS_RESOURCE.test(p.split(' ')[2]!) && p.endsWith(' null'));
      expect.soft(getItem.length, `${name}: its role may GetItem the tenants table`).toBeGreaterThan(0);
      const arn = stack === 'infra' ? `aws_iam_role.${r}.arn` : `"arn:aws:iam::\${var.aws_account_id}:role${info.path}${info.name}"`;
      expect.soft(read.includes(arn), `${name}: kms_pii dynamodb_read_role_arns names its role (${arn}; the role's path is part of its ARN)`).toBe(true);
      // Read through DynamoDB only: a gated role never gets the key's encrypt and data-key rights (allowed_role_arns).
      const spellings = stack === 'infra' ? [`aws_iam_role.${r}.`] : [`role${info.path}${info.name}"`, `role/${info.name}"`, `aws_iam_role.${r}.`];
      expect.soft(spellings.filter((x) => encrypt.includes(x)), `${name}: its role is not in kms_pii allowed_role_arns (encrypt rights)`).toEqual([]);
    }

    // Add only: against develop 6122df1 (TEN-05 merged), nothing is taken away and every new grant is GetItem on the tenants table.
    const baseline = JSON.parse(readFileSync(join(__dirname, 'support', 'mod-01', 'iam-6122df1', 'policies.json'), 'utf8')) as Record<string, { role: string; pairs?: string[]; squash?: string }>;
    const ONB22_POLICIES = new Set(['infra/create_proposal', 'infra/approve_agent_action_onb22', 'infra/summarise_verification_employees', 'infra/naleko_mcp_server_agent_key']);
    const gatedRoles = new Set<string>();
    for (const name of GATED_LAMBDAS) for (const { stack, block } of lambdaNamed(name)) { const r = roleResourceOf(block); const info = r ? roleInfo(stack, r) : undefined; if (r) gatedRoles.add(`${stack}:${r}`); if (info) gatedRoles.add(`name:${info.name}`); }
    // TEN-04.2 (re-locked by acceptance-lock/ten-03.3): more table-level grants, one (role, action, table) each (support/ten-04.2/grants.ts); ten-03.spec.ts AC-10 pins exactly these.
    const ten042 = (p: string, stack: string, role: string) => isCardGrant(p, stack, role);
    const isGated = (key: string, role: string) => { const stack = key.split('/')[0] as Stack; return gatedRoles.has(`${stack}:${role}`) || gatedRoles.has(`name:${valueOf(stack, role)}`); };
    for (const [key, was] of Object.entries(baseline)) {
      const cur = all[key];
      expect.soft(!!cur, `role policy ${key} is still there`).toBe(true);
      if (!cur) continue;
      if (was.squash !== undefined) { expect.soft(cur.squash, `role policy ${key}: unchanged`).toBe(was.squash); continue; }
      const lost = (was.pairs ?? []).filter((p) => !(cur.pairs ?? []).includes(p));
      expect.soft(lost, `role policy ${key}: nothing it had is taken away`).toEqual([]);
      for (const p of (cur.pairs ?? []).filter((x) => !(was.pairs ?? []).includes(x))) {
        // CHAT-02 (re-lock mod-01.N): the two chat Lambdas keep and read the person's chats and read the company switch; chat-02.spec.ts AC-31 pins it.
        if (/naleko_ai_chat|ai_chat/.test(key) && /^Allow dynamodb:(GetItem|Query|PutItem|UpdateItem) (aws_dynamodb_table\.ask_batsi_chats\.arn|aws_dynamodb_table\.tenants\.arn|\$?\{?arn:aws:dynamodb:[^ ]*table\/ask-batsi-chats\}?|arn:aws:dynamodb:[^ ]*table\/ask-batsi-chats) null$/.test(p)) continue;
        // TEN-06 (re-lock mod-01.1): the sign-in trigger moves a TalentFlow person in; ten-06.spec.ts AC-7 pins exactly this.
        if (/cognito_post_auth/.test(key) && /^Allow (dynamodb:(PutItem|DeleteItem) \$?\{?aws_dynamodb_table\.tenants\.arn\}? null|cognito-idp:AdminAddUserToGroup \$?\{?aws_cognito_user_pool\.naleko_dev\.arn\}? null)$/.test(p)) continue;
        if (ten042(p, cur.stack, cur.role)) continue;
        // REC-15 (child lock rec-04.3): getCandidates reads the company's stage hours for the list's clock (rec-15.spec.ts AC-17 pins it).
        if (/get_candidates$|getCandidates$/.test(key) && /^Allow dynamodb:Query arn:aws:dynamodb:af-south-1:[^:\s]+:table\/\$\{local\.tf_table_config\}\/index\/GSI1-active-configs null$/.test(p)) continue;
        // ONB-11 (re-lock mod-01.13): createEmployee links the new person's sign-in to their employees row (one UpdateItem; onb-11.spec.ts AC-11 needs it).
        { const [e, a, r, ...c] = p.split(' '); if (e === 'Allow' && ownerLinkGrant(a!, r!, cur.role, c.join(' '))) continue; }
        // REC-07 (child lock rec-07.1): scheduleInterview reads the role's criteria, submitVote finds an interview by id (support/rec-07.1/grants.ts).
        if (isRec07Grant(p, key) || isRec15bGrant(p, key) || isRec15cGrant(p, key) || isRec15dGrant(p, key) || isInt01Grant(p, key)) continue; // child locks rec-15c.1, rec-15d.1 and int-01.1
        // REC-05 (child lock rec-05.1): monitorTalentFlowSLAs reads the company's modules before an offer expires (support/rec-05.1/grants.ts).
        if (isRec05Grant(p, key)) continue;
        if (isRec062Grant(p, key)) continue; // child lock rec-06.2.1: resendInvite may start the onboarding workflow, pinned in rec-06.2.spec.ts AC-8.
        expect.soft(/^Allow dynamodb:GetItem /.test(p) && TENANTS_RESOURCE.test(p.split(' ')[2]!) && p.endsWith(' null') && isGated(key, cur.role), `role policy ${key}: new grant "${p}" is only GetItem on the tenants table, on a gated Lambda's role`).toBe(true);
      }
    }
    for (const [key, cur] of Object.entries(all)) {
      if (baseline[key]) continue;
      if (cur.stack === 'infra' && cur.role === role) continue; // getCompanyModules' own, judged above
      if (isRec09Policy(key, cur.pairs)) continue; // REC-09 (child lock rec-09.1): REC-09's four policies, each exactly its pinned lines (support/rec-09/policy-lines.json), judged in rec-09.spec.ts AC-10.
      if (/send_document_reminders/.test(key) || /send_document_reminders/.test(cur.role)) continue; // ONB-21 (re-lock mod-01.4): its own role, locked in onb-21.spec.ts AC-8.
      // Ask Batsi dev Marketplace grant (re-lock mod-01.9): judged before the ask_batsi skip below, and it must be exactly this.
      if (key === MARKETPLACE_DEV_KEY || cur.role === 'naleko_ai_chat') { expect.soft(marketplaceDev(key, cur.role, cur.pairs), `${key}: only on the chat role, dev only, exactly the two Marketplace actions on *`).toBe(true); continue; }
      if (/ask_batsi|stored_chats/.test(key) || /ask_batsi/.test(cur.role)) continue; // CHAT-02 (re-lock mod-01.N): their own roles, judged in chat-02.spec.ts AC-31.
      if (/reveal_document_field/.test(key) || /reveal_document_field/.test(cur.role)) continue; // ONB-14 (re-lock mod-01.N): its own role, locked in onb-14.spec.ts AC-9 (HR only, no tenants table, no KMS list).
      if (/user_migration/.test(key) || /user_migration/.test(cur.role)) continue; // TEN-06 (re-lock mod-01.1): its own role, locked in ten-06.spec.ts AC-7.
      // ONB-22.1 (re-lock mod-01.6): the agent proposal and approval rights are new role policies of their own (a new role, and second policies on three roles ten-02 pins); onb-22.spec.ts AC-8 pins exactly these.
      if (ONB22_POLICIES.has(key)) continue;
      if (/record_not_hired|recordNotHired/.test(key) || /record_not_hired|recordNotHired/.test(cur.role)) continue; // REC-02 (re-lock rec-02.1): its own role, judged in rec-02.spec.ts AC-11.
      if (/manage_roles|manageRoles/.test(key) || /manage_roles|manageRoles/.test(cur.role)) continue; // REC-04 (re-lock rec-04.1): its own role, judged in rec-04.spec.ts AC-8.
      if (/leaver_chats|deleteLeaverChats/.test(key) || /leaver_chats|deleteLeaverChats/.test(cur.role)) continue; // CHAT-15 (re-lock mod-01.16): its own role, judged in chat-15.spec.ts AC-12.
      if (/manage_departments|manageDepartments/.test(key) || /manage_departments|manageDepartments/.test(cur.role)) continue; // REC-14 (child lock rec-14.1): company-wide, no module gate; its own role, judged in rec-14.spec.ts AC-3.
      if (isRec16Role(key, cur.role)) continue; // REC-16 (child lock rec-16.1): its own role, judged in rec-16.spec.ts AC-10.
      if (isRec05Role(key, cur.role)) { expect.soft((cur.pairs ?? []).filter((p) => !isRec05Grant(p, key)), `${key}: only the lines REC-05 allows`).toEqual([]); continue; } // REC-05 (child lock rec-05.1): its own role, judged in rec-05.spec.ts AC-10.
      if ((cur.pairs ?? []).length > 0 && (cur.pairs ?? []).every((p) => ten042(p, cur.stack, cur.role))) continue; // TEN-04.2: one of the three table Queries
      expect.soft(isGated(key, cur.role), `new role policy ${key} belongs to a gated Lambda's role`).toBe(true);
      for (const p of cur.pairs ?? [`unreadable ${cur.squash}`]) {
        if (ten042(p, cur.stack, cur.role)) continue;
        expect.soft(/^Allow dynamodb:GetItem /.test(p) && TENANTS_RESOURCE.test(p.split(' ')[2]!) && p.endsWith(' null'), `new role policy ${key}: "${p}" is only GetItem on the tenants table`).toBe(true);
      }
    }
    // No wildcard action in anything new; no table data in Terraform.
    for (const [key, cur] of Object.entries(all)) {
      const had = new Set(baseline[key]?.pairs ?? []);
      expect.soft((cur.pairs ?? []).filter((p) => !had.has(p) && /\*/.test(p.split(' ')[1]!)), `role policy ${key}: no wildcard action`).toEqual([]);
    }
    for (const stack of ['infra', 'talent-flow-infra'] as const) {
      expect.soft(stripTf(readTf(stack)).match(/resource\s+"aws_dynamodb_table_item"/g) ?? [], `${stack}/: no aws_dynamodb_table_item (Terraform never writes table data)`).toEqual([]);
    }

    // Build, deploy, alarms, log groups and dashboards.
    const dir = join(LAMBDA, 'getCompanyModules');
    expect.soft(existsSync(join(dir, 'index.mjs')), 'lambda/getCompanyModules/index.mjs exists (build-lambdas.py builds and deploy-lambdas.sh deploys every folder with one)').toBe(true);
    for (const file of ['alarms.tf', 'dashboards.tf']) expect.soft(lambdaNamesIn(file), `${file} lambda_names lists getCompanyModules`).toContain('"getCompanyModules"');
    const cw = stripTf(readFileSync(join(REPO, 'infra', 'cloudwatch.tf'), 'utf8'));
    expect.soft(/lambda_log_groups\s*=\s*toset\(\[([\s\S]*?)\]\)/.exec(cw)?.[1] ?? '', 'cloudwatch.tf lambda_log_groups lists /aws/lambda/getCompanyModules').toContain('"/aws/lambda/getCompanyModules"');
    for (const f of [...sources(dir), join(LAMBDA, 'shared', 'modules.mjs')].filter(existsSync)) {
      expect.soft(stripJs(readFileSync(f, 'utf8')), `${relative(REPO, f)}: no AI`).not.toMatch(/bedrock|anthropic|openai|guardAi/i);
    }

    // The dev rows come from the seed, never Terraform: founding gets both, company B onboarding only, every run.
    const founding = /^\s*founding_tenant_id\s*=\s*"(ten_[0-9a-z]{26})"/m.exec(readFileSync(join(REPO, 'infra', 'env', 'dev.tfvars'), 'utf8'))?.[1];
    const second = /^SECOND_TENANT_ID\s*=\s*"(ten_[0-9a-z]{26})"/m.exec(readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8'))?.[1];
    expect(founding && second, 'the dev founding company (dev.tfvars) and company B (seed-dev.py SECOND_TENANT_ID) are named').toBeTruthy();
    const profile = (c: string, extra: Record<string, unknown> = {}) => ({ pk: { S: `TENANT#${c}` }, sk: { S: 'PROFILE' }, tenant_id: { S: c }, name: { S: 'Seeded' }, status: { S: 'ACTIVE' }, ...extra });
    for (const [what, start] of [
      ['an empty company list', []],
      ['today\'s dev rows (no modules yet)', [profile(founding!, { founding: { BOOL: true } }), profile(second!)]],
      ['company B left with Recruitment on', [profile(founding!, { founding: { BOOL: true }, modules: { SS: ['onboarding'] } }), profile(second!, { modules: { SS: ['onboarding', 'recruitment'] } })]],
    ] as const) {
      const seeded = runSeed({ [TENANTS]: [...start] as Row[] });
      expect.soft(seeded.code, `seed-dev.py on ${what}: runs (${seeded.stderr.slice(-300)})`).toBe(0);
      const rowOf = (c: string) => (seeded.tables[TENANTS] ?? []).find((r: any) => r.pk?.S === `TENANT#${c}` && r.sk?.S === 'PROFILE') as any;
      expect.soft(rowOf(founding!)?.modules, `seed-dev.py on ${what}: the founding company has {onboarding, recruitment} as a string set`).toEqual({ SS: BOTH });
      expect.soft(rowOf(second!)?.modules, `seed-dev.py on ${what}: company B has {onboarding} as a string set`).toEqual({ SS: ['onboarding'] });
    }
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 The CI list', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(3 * 60_000);
    const TEST = join(LAMBDA, 'shared', 'modules.test.mjs');
    expect(existsSync(TEST), 'lambda/shared/modules.test.mjs exists').toBe(true);
    const pkg = JSON.parse(readFileSync(join(LAMBDA, 'shared', 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    expect.soft(pkg.scripts?.['test'] ?? '', 'npm test in lambda/shared runs it (the Lambda unit tests job)').toContain('modules.test.mjs');
    const text = readFileSync(TEST, 'utf8');
    const lists = text + readdirSync(join(LAMBDA, 'shared')).filter((f) => f.endsWith('.json') && text.includes(f)).map((f) => readFileSync(join(LAMBDA, 'shared', f), 'utf8')).join('\n');
    for (const name of GATED_ROUTE_LAMBDAS) expect.soft(lists, `the rule 4 list in the CI test names ${name}`).toMatch(new RegExp(`['"\`]${name}['"\`]`));

    const copy = mkdtempSync(join(tmpdir(), 'mod-01-ci-'));
    const lambda = join(copy, 'lambda');
    cpSync(LAMBDA, lambda, { recursive: true, filter: (src) => !/[\\/](node_modules|coverage|dist)([\\/]|$)/.test(relative(LAMBDA, src)) && !/\.zip$/.test(src) });
    const nodeTest = () => {
      const r = spawnSync(process.execPath, ['--test', 'modules.test.mjs'], { cwd: join(lambda, 'shared'), encoding: 'utf8', timeout: 120_000, env: { PATH: process.env['PATH'] ?? '', CI: 'true' } });
      return { status: r.status, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
    };
    try {
      const base = nodeTest();
      expect(base.status, `node --test modules.test.mjs passes on the repo as it is:\n${base.output.slice(-2000)}`).toBe(0);
      const handler = existsSync(join(lambda, 'getCandidate', 'index.js')) ? join(lambda, 'getCandidate', 'index.js') : join(lambda, 'getCandidate', 'index.mjs');
      const original = readFileSync(handler, 'utf8');
      for (const [what, plant] of [
        ['getCandidate without the requireModule call', original.replace(/requireModule/g, 'requireNothing')],
        ['getCandidate without the modules.mjs import', original.replace(/modules\.mjs/g, 'tenant.mjs')],
      ] as const) {
        writeFileSync(handler, plant);
        const caught = nodeTest();
        expect.soft(caught.status, `${what}: the CI test fails`).not.toBe(0);
        expect.soft(caught.output, `${what}: and names the folder`).toContain('getCandidate');
        writeFileSync(handler, original);
      }
      expect(nodeTest().status, 'put back, it passes again').toBe(0);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------- AC-10

  test('AC-10 Today\'s users unaffected, a switched-off company refused @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-2, AC-5 and AC-6.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(6 * 60_000);
    const env = (k: string) => process.env[k] ?? '';
    const hr = { email: env('E2E_HR_EMAIL'), password: env('E2E_HR_PASSWORD') };
    const hrB = { email: env('E2E_HR_B_EMAIL') || env('E2E_B_HR_EMAIL'), password: env('E2E_HR_B_PASSWORD') || env('E2E_B_HR_PASSWORD') };
    expect(hr.email, 'the HR test login of the founding company is set (E2E_HR_EMAIL)').toBeTruthy();
    expect(hrB.email, 'the HR test login of company B is set (E2E_HR_B_EMAIL, from load-e2e-logins.py)').toBeTruthy();
    const { api, clientId, region } = devEnv();
    const oldEnv = join(REPO, 'hr-portal', 'src', 'environments', 'environment.ts');
    const tfApi = (/talentFlow\s*:\s*\{[^}]*?apiUrl\s*:\s*['"`]([^'"`]+)['"`]/s.exec(existsSync(oldEnv) ? readFileSync(oldEnv, 'utf8') : '')?.[1] ?? '').replace(/\/+$/, '').replace(/\/v1$/, ''); // the dev E2E writes talentFlow.apiUrl with a trailing /v1; the routes below add it
    expect(tfApi, 'the TalentFlow API address is written for pepla-dev (hr-portal environment.ts, talentFlow.apiUrl)').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const signIn = async (login: { email: string; password: string }) => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: login.email, PASSWORD: login.password } }),
      });
      expect(r.status(), 'signs in at Cognito').toBe(200);
      return ((await r.json()) as any).AuthenticationResult.IdToken as string;
    };
    const claimsOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    const modules = async (token: string) => {
      const r = await page.request.get(`${api}/v1/company/modules`, { headers: { Authorization: `Bearer ${token}` } });
      return { status: r.status(), body: r.status() === 200 ? ((await r.json()) as { modules?: string[] }) : null };
    };
    const candidates = async (token: string) => page.request.get(`${tfApi}/v1/candidates`, { headers: { Authorization: `Bearer ${token}` } });

    // Today's users: the founding company has both, and its candidates answer as before.
    const tokenA = await signIn(hr);
    const mA = await modules(tokenA);
    expect(mA.status, 'founding HR: GET /v1/company/modules answers 200').toBe(200);
    expect(mA.body, 'founding HR: onboarding and recruitment').toEqual({ modules: BOTH });
    expect((await candidates(tokenA)).status(), 'founding HR: GET /v1/candidates still answers 200').toBe(200);

    // Company B (onboarding only): refused, then let in by the script, with the same sign-in.
    const tokenB = await signIn(hrB);
    const companyB = String(claimsOf(tokenB)['tenant_id'] ?? '');
    expect(companyB, 'company B\'s login carries its company').toMatch(/^ten_[0-9a-z]{26}$/);
    const mB = await modules(tokenB);
    expect(mB.body, 'company B: onboarding only').toEqual({ modules: ['onboarding'] });
    const refused = await candidates(tokenB);
    expect(refused.status(), 'company B: GET /v1/candidates answers 403').toBe(403);
    expect(await refused.json(), 'with {"error":"Forbidden"}').toEqual(FORBIDDEN);
    const script = (args: string[]) => spawnSync(process.execPath, [join(REPO, 'scripts', 'tenancy', 'set-modules.mjs'), '--env', 'dev', '--tenant', companyB, ...args], { cwd: REPO, encoding: 'utf8', timeout: 120_000, env: process.env });
    try {
      const on = script(['--on', 'recruitment', '--reason', 'MOD-01 AC-10 pepla-dev check', '--apply']);
      expect(on.status, `set-modules --apply turns Recruitment on for B (${(on.stdout + on.stderr).slice(-300)})`).toBe(0);
      // The Lambdas cache a company's modules for up to 60 seconds.
      await expect.poll(async () => (await candidates(tokenB)).status(), { message: 'company B, same sign-in: GET /v1/candidates answers 200 within the cache time', timeout: 120_000, intervals: [5_000] }).toBe(200);
      await expect.poll(async () => (await modules(tokenB)).body, { message: 'company B now has both', timeout: 120_000, intervals: [5_000] }).toEqual({ modules: BOTH });
    } finally {
      const off = script(['--off', 'recruitment', '--reason', 'MOD-01 AC-10 put back', '--apply']);
      expect(off.status, `set-modules --apply puts B back to onboarding only (${(off.stdout + off.stderr).slice(-300)})`).toBe(0);
    }
  });
});

// ---------------------------------------------------------------- helpers

/** A company named in every spelling a request or record might use; with tenant_id unless asked not to. */
function forgeCompany(c: string, withTenantId = true): Record<string, string> {
  return { ...(withTenantId ? { tenant_id: c } : {}), tenantId: c, company: c, companyId: c, company_id: c, tenant: c, companyTenantId: c };
}
/** Plain string fields as DynamoDB stream attributes. */
function avOf(o: Record<string, string>): Record<string, { S: string }> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { S: v }]));
}
/** Every source file under a folder (not tests, not node_modules). */
function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (['node_modules', 'coverage', 'dist', '__tests__', 'tests', 'test'].includes(e) || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(js|mjs|cjs|py)$/.test(e) && !/\.(test|spec)\.|^test_/.test(e)) out.push(p);
  }
  return out;
}
/** JavaScript with comments blanked out; strings kept. */
function stripJs(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const two = src.slice(i, i + 2);
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (two === '//') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else { out += c; i++; }
  }
  return out;
}
/** Python with # comments and docstrings blanked out. */
function stripPy(src: string): string {
  return src.replace(/("""|''')[\s\S]*?\1/g, '').replace(/(^|\s)#.*$/gm, '$1');
}
/** Terraform with # and // comments out. */
function stripTf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(#|\/\/).*$/gm, '').replace(/\s+#.*$/gm, '');
}
/** A copy of scripts/tenancy and lambda/shared at the same relative places, so a seed can be swapped. */
function scriptsCopy(): string {
  const root = mkdtempSync(join(tmpdir(), 'mod-01-scripts-'));
  cpSync(join(REPO, 'scripts', 'tenancy'), join(root, 'scripts', 'tenancy'), { recursive: true });
  cpSync(join(LAMBDA, 'shared'), join(root, 'lambda', 'shared'), { recursive: true, filter: (s) => !/node_modules|coverage/.test(s) });
  return root;
}
/** Runs scripts/ci/seed-dev.py against a fake boto3 (support/mod-01/seed-run.py). */
function runSeed(t: Tables): { code: number; tables: Tables; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mod-01-seed-'));
  writeFileSync(join(dir, 'world.json'), JSON.stringify({ tables: t }));
  const r = spawnSync('python3', ['-I', join(__dirname, 'support', 'mod-01', 'seed-run.py'), join(REPO, 'scripts', 'ci', 'seed-dev.py'), join(dir, 'world.json'), join(dir, 'after.json')], { encoding: 'utf8', timeout: 60_000 });
  const after = existsSync(join(dir, 'after.json')) ? JSON.parse(readFileSync(join(dir, 'after.json'), 'utf8')) : { code: 1, tables: {} };
  return { code: r.status === 0 ? after.code : (r.status ?? 1), tables: after.tables, stderr: `${r.stderr ?? ''}` };
}
void [NAME, ID, E, F, G];
