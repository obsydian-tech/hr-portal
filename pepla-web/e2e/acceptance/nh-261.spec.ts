import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO } from './support/rec-14/lambda-harness';
import type { Run } from './support/rec-14/lambda-harness';
import {
  A, A_LEGACY, A_UUID, B, B_LEGACY, BOOM, FIXED_BODY, HEADER_VALUES, LAMBDA_DIR, MARKERS, PATH, SOURCE_IP, UNKNOWN_UUID,
  answerText, describe, headerOf, hrOf, logCalls, logText, lookupEvent, outsideCalls, rawBodyOf, run, runBoom, safeLog, statusOf,
} from './support/nh-261/world';

/**
 * NH-261 step A · The public employee lookup gives nobody an email (red). Spec:
 * /mnt/project-files/onboarding-cards/specs/NH-261-employee-lookup.md (rules 1 to 8, AC-1 to AC-9), decisions D-261.1 and D-261.2.
 * Notes: cards/nh-261.md. Review page: onboarding-cards/specs/NH-261-tests-for-review.md (the bar).
 *
 * The Lambda tests run the real handler (lambda/lookupEmployeeEmail/index.mjs) in a fresh Node process per call, against
 * REC-14's fake AWS (support/rec-14, read only), with company A's two employees and company B's one seeded in `employees`.
 * The fake records every AWS call, every outbound HTTP call and every log line. AC-5 runs the handler through
 * support/nh-261/boom-run.mjs, which throws a planted error from inside. Nothing calls AWS or any AI. Nothing here has a
 * screen width: each no-backend test runs once, at 1280. AC-9 runs on pepla-dev only, after merge.
 *
 * No failure message prints an answer body that holds an email or an `@`, or a log line with an email in it (describe() and
 * safeLog() blank them), and no test prints a token.
 *
 * Pinned by the verifier where the spec is silent (in cards/nh-261.md for the BA to confirm):
 *  - D-T-1 An OPTIONS call to the Lambda gets rule 1's 404 too. Rule 6 allows "the same 404 or API Gateway's own preflight
 *    answer"; the Lambda cannot give the second, so at the Lambda it is the 404.
 *  - D-T-2 "Content-Type: application/json" means the header value starts with application/json (any case of the name).
 *  - D-T-3 Rule 4's "one info line per call with a fixed message": at most one log line per ordinary call, and every such
 *    line, extra fields included, is the same text on every call. No line at all is fine.
 *  - D-T-4 AC-5's planted throws: (a) every read of the event throws; (b) every Powertools logger and tracer call except
 *    error() throws, and so do console.log/info/warn/debug. A handler that throws out of either is a fail (the Lambda would
 *    answer API Gateway's 500, not rule 1's 404). Neither throw may show in the answer or in a log line.
 *  - D-T-5 Rule 8's header comment: the Lambda's source names NH-261 and "step B". Checked in AC-4's text check.
 *  - D-T-6 AC-8's "git diff touches only lambda/lookupEmployeeEmail/" is judged by the build review on the PR, not here: a
 *    locked test cannot find the lock commit in every CI checkout. What can be checked from the tree is checked here.
 *  - D-T-7 AC-9 calls with the seeded dev employee id (E2E-EMP-0001, scripts/ci/seed-dev.py), EMP-0000001 and a made-up UUID.
 *    Whether those exist on dev does not matter: the answer must be the same. CloudWatch is not read by this test (see
 *    cards/nh-261.md, a post-merge look with the look-only dev login).
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};

// ---------------------------------------------------------------- the calls

/** AC-1: every query shape the spec names, plus an OPTIONS call (D-T-1). */
const AC1_CASES: [string, () => any][] = [
  ["A's legacy id EMP-0000001", () => lookupEvent({ query: { employeeId: A_LEGACY } })],
  ["A's legacy id in lower case", () => lookupEvent({ query: { employeeId: A_LEGACY.toLowerCase() } })],
  ["A's UUID employee", () => lookupEvent({ query: { employeeId: A_UUID } })],
  ["B's legacy id EMP-0000002", () => lookupEvent({ query: { employeeId: B_LEGACY } })],
  ['an unknown legacy id', () => lookupEvent({ query: { employeeId: 'EMP-9999999' } })],
  ['an unknown UUID', () => lookupEvent({ query: { employeeId: UNKNOWN_UUID } })],
  ['abc', () => lookupEvent({ query: { employeeId: 'abc' } })],
  ['EMP-1', () => lookupEvent({ query: { employeeId: 'EMP-1' } })],
  ['an empty value', () => lookupEvent({ query: { employeeId: '' }, rawQuery: 'employeeId=' })],
  ['no employeeId at all (another parameter only)', () => lookupEvent({ query: { page: '1' } })],
  ['no query string at all', () => lookupEvent({ query: null })],
  ['a 5,000-character value', () => lookupEvent({ query: { employeeId: 'EMP-' + '7'.repeat(4996) } })],
  ["A's legacy id with tenantId naming company A", () => lookupEvent({ query: { employeeId: A_LEGACY, tenantId: A } })],
  ["OPTIONS for A's legacy id (D-T-1)", () => lookupEvent({ query: { employeeId: A_LEGACY }, method: 'OPTIONS', headers: { origin: 'https://nh261-elsewhere.test', 'access-control-request-method': 'GET' } })],
];

/** AC-3: the same request for A's EMP-0000001 from four callers. */
const AC3_CASES: [string, () => any][] = [
  ['(a) no sign-in', () => lookupEvent({ query: { employeeId: A_LEGACY } })],
  ["(b) company B's HR person", () => lookupEvent({ query: { employeeId: A_LEGACY }, authorizer: hrOf(B, 'hr-b') })],
  ["(c) company A's HR person", () => lookupEvent({ query: { employeeId: A_LEGACY }, authorizer: hrOf(A, 'hr-a') })],
  ['(d) headers and a body naming company A', () => lookupEvent({ query: { employeeId: A_LEGACY }, headers: { ...HEADER_VALUES }, body: { tenantId: A, companyId: A, tenant_id: A } })],
];

let ac1: [string, Run][] | undefined;
let ac3: [string, Run][] | undefined;
let boom: [string, Run][] | undefined;
const ac1Runs = () => (ac1 ??= AC1_CASES.map(([l, e]) => [l, run(e())] as [string, Run]));
const ac3Runs = () => (ac3 ??= AC3_CASES.map(([l, e]) => [l, run(e())] as [string, Run]));
const boomRuns = () => (boom ??= [['every read of the event throws', runBoom('event')], ['the logger and tracer throw', runBoom('powertools')]] as [string, Run][]);

/** Rule 1's answer: 404, JSON, exactly {"error":"Not found"}, and the handler did not throw. */
function isFixed(label: string, r: Run) {
  expect.soft(r.error?.name, `${label}: the handler answers and does not throw`).toBeUndefined();
  expect.soft(statusOf(r), `${label}: 404 (${describe(r)})`).toBe(404);
  expect.soft(String(headerOf(r, 'content-type') ?? ''), `${label}: Content-Type is application/json`).toMatch(/^application\/json\b/i);
  expect.soft(rawBodyOf(r) === FIXED_BODY, `${label}: the body is exactly ${FIXED_BODY} (${describe(r)})`).toBe(true);
}

test.describe('NH-261 step A · The public employee lookup gives nobody an email', () => {
  test.describe.configure({ timeout: 180_000 });

  test('AC-1 Every query gets the same fixed answer: 404, application/json, exactly {"error":"Not found"}', async ({}, testInfo) => {
    once(testInfo.project.name);
    const runs = ac1Runs();
    for (const [label, r] of runs) isFixed(label, r);
    const bodies = new Set(runs.map(([, r]) => String(rawBodyOf(r))));
    expect(bodies.size, 'every body is byte for byte the same').toBe(1);
    // Rule 1: one answer for everything, so the headers are the same on every call too (nothing echoes the request).
    const headers = new Set(runs.map(([, r]) => JSON.stringify(Object.entries(r.response?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]).sort())));
    expect(headers.size, 'every answer carries the same headers').toBe(1);
  });

  test('AC-2 No answer holds an email, an @ or the word email', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const [label, r] of [...ac1Runs(), ...ac3Runs()]) {
      const text = answerText(r);
      for (const m of MARKERS) expect.soft(text.includes(m), `${label}: the answer holds no employee email marker`).toBe(false);
      expect.soft(text.includes('@'), `${label}: the answer holds no @ (${describe(r)})`).toBe(false);
      expect.soft(/email/i.test(text), `${label}: the answer holds no word "email" (${describe(r)})`).toBe(false);
    }
  });

  test('AC-3 Company B, company A, no sign-in and a caller naming A in headers and body all get the same fixed answer for A\'s employee', async ({}, testInfo) => {
    once(testInfo.project.name);
    const runs = ac3Runs();
    const shape = (r: Run) => JSON.stringify([statusOf(r), String(headerOf(r, 'content-type') ?? ''), rawBodyOf(r)]);
    for (const [label, r] of runs) {
      isFixed(label, r);
      expect.soft(shape(r) === shape(runs[0]![1]), `${label}: the same answer as the caller with no sign-in (${describe(r)})`).toBe(true);
      for (const m of MARKERS) expect.soft(answerText(r).includes(m), `${label}: no email of any company`).toBe(false);
    }
  });

  test('AC-4 Nothing is read: no AWS or outside call on any request, and the source names no SDK, no employees table and no tenantOf', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const [label, r] of [...ac1Runs(), ...ac3Runs()]) {
      expect.soft(outsideCalls(r), `${label}: no AWS call and no outbound call`).toEqual([]);
    }
    const files = readdirSync(LAMBDA_DIR).filter((n) => n.endsWith('.mjs'));
    expect(files, 'lambda/lookupEmployeeEmail has its handler').toContain('index.mjs');
    let all = '';
    for (const f of files) {
      const src = readFileSync(join(LAMBDA_DIR, f), 'utf8');
      all += src;
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
      expect.soft(code.includes('@aws-sdk/'), `${f}: imports no @aws-sdk client`).toBe(false);
      expect.soft(code.includes('EMPLOYEES_TABLE'), `${f}: no EMPLOYEES_TABLE`).toBe(false);
      expect.soft(/['"`]employees['"`]/.test(code), `${f}: does not name the employees table`).toBe(false);
      expect.soft(code.includes('tenantOf'), `${f}: no tenantOf`).toBe(false);
      // Rule 4: nothing that adds a field to every real log line or trace, which the fake logger cannot see (lock check G-1).
      for (const word of ['appendKeys', 'PersistentKeys', 'PersistentLogAttributes', 'persistentKeys', 'persistentLogAttributes', 'logEvent', 'putMetadata']) {
        expect.soft(code.includes(word), `${f}: no ${word} (it would add to every log line)`).toBe(false);
      }
    }
    // Rule 8 (D-T-5): the header comment says why the route is kept and that step B removes it.
    expect.soft(all.includes('NH-261'), 'the source names NH-261 (rule 8 comment)').toBe(true);
    expect.soft(/step B/i.test(all), 'the source says step B removes the route (rule 8 comment)').toBe(true);
  });

  test('AC-5 A failure inside the handler still gets the fixed answer, and no answer ever holds error text', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const [label, r] of boomRuns()) isFixed(`planted throw, ${label}`, r);
    for (const [label, r] of [...ac1Runs(), ...ac3Runs(), ...boomRuns()]) {
      const text = answerText(r);
      for (const word of ['details', 'message', 'stack', 'Error', BOOM]) {
        expect.soft(text.includes(word), `${label}: the answer holds no "${word}" (${describe(r)})`).toBe(false);
      }
    }
  });

  test('AC-6 No log line holds an employee id, the query, a header, the caller\'s address, an email or the planted error text', async ({}, testInfo) => {
    once(testInfo.project.name);
    const forbidden = [
      A_LEGACY, B_LEGACY, A_UUID, UNKNOWN_UUID, 'EMP-9999999', 'EMP-1', 'EMP-7777', 'employeeId=', BOOM, SOURCE_IP,
      ...MARKERS, ...Object.values(HEADER_VALUES), 'nh261-elsewhere', 'nh261-hr.test', 'nh261-hr-a-sub', 'nh261-hr-b-sub', A, B,
    ].map((s) => s.toLowerCase());
    const ordinary = [...ac1Runs(), ...ac3Runs()];
    const seen = new Set<string>();
    for (const [label, r] of [...ordinary, ...boomRuns()]) {
      for (const c of logCalls(r)) {
        const line = logText(c as any).toLowerCase();
        for (const f of forbidden) expect.soft(line.includes(f), `${label}: a log line holds "${safeLog(f)}" (${safeLog(line).slice(0, 160)})`).toBe(false);
        expect.soft(/\bstack\b|\n\s+at |file:\/\//.test(line), `${label}: no stack in a log line`).toBe(false);
      }
    }
    // D-T-3: at most one line per ordinary call, the same fixed text every time.
    for (const [label, r] of ordinary) {
      const lines = logCalls(r).map((c) => logText(c as any));
      expect.soft(lines.length, `${label}: at most one log line`).toBeLessThanOrEqual(1);
      lines.forEach((l) => seen.add(l));
    }
    expect.soft(seen.size, 'every ordinary call logs the same fixed line, or none').toBeLessThanOrEqual(1);
    // AC-5's log line: if the handler logs the failure, it holds the error's name, not its message.
    for (const [label, r] of boomRuns()) {
      for (const c of logCalls(r)) {
        expect.soft(JSON.stringify((c as any).extra ?? null).includes('"message"'), `${label}: the failure line carries no error message field`).toBe(false);
      }
    }
  });

  test('AC-7 No answer carries Access-Control-Allow-Origin: *', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const [label, r] of [...ac1Runs(), ...ac3Runs(), ...boomRuns()]) {
      expect.soft(String(headerOf(r, 'access-control-allow-origin') ?? '').trim(), `${label}: no open CORS from the Lambda`).not.toBe('*');
      const multi = (r.response?.multiValueHeaders ?? {}) as Record<string, unknown[]>;
      const k = Object.keys(multi).find((x) => x.toLowerCase() === 'access-control-allow-origin');
      expect.soft(k ? (multi[k] ?? []).map(String) : [], `${label}: no open CORS in multiValueHeaders`).not.toContain('*');
    }
  });

  test('AC-8 Nothing else moved: the route, its OpenAPI entry and its public listing stay, no front end calls it, the tenancy and route checks pass', async ({}, testInfo) => {
    once(testInfo.project.name);
    const read = (...p: string[]) => readFileSync(join(REPO, ...p), 'utf8');
    const api = read('infra', 'apigateway.tf');
    expect.soft(api, 'infra keeps the route').toMatch(/route_key\s*=\s*"GET \/v1\/employees\/lookup"/);
    const tf = readdirSync(join(REPO, 'infra')).filter((n) => n.endsWith('.tf')).map((n) => read('infra', n)).join('\n');
    expect.soft(tf, 'infra keeps the Lambda').toMatch(/resource\s+"aws_lambda_function"\s+"lookup_employee_email"/);
    expect.soft(read('api', 'openapi.yaml'), 'api/openapi.yaml keeps the operation').toMatch(/^\s{2}\/v1\/employees\/lookup:\s*$/m);
    const routes = read('scripts', 'ci', 'routes-match-openapi.mjs');
    expect.soft(/PUBLIC\s*=\s*\[[^\]]*'GET \/v1\/employees\/lookup'/.test(routes), 'the route stays on the public list until step B').toBe(true);
    const retrofit = JSON.parse(read('lambda', 'shared', 'tenant-retrofit.json')) as string[];
    expect.soft(retrofit, 'tenant-retrofit.json does not gain the Lambda').not.toContain('lookupEmployeeEmail');
    const rm = spawnSync(process.execPath, [join(REPO, 'scripts', 'ci', 'routes-match-openapi.mjs')], { cwd: REPO, encoding: 'utf8', timeout: 60_000 });
    expect.soft(rm.status, `routes-match-openapi.mjs exits 0 (${(rm.stdout + rm.stderr).slice(-300)})`).toBe(0);
    const tt = spawnSync(process.execPath, ['--test', 'tenant.test.mjs'], { cwd: join(REPO, 'lambda', 'shared'), encoding: 'utf8', timeout: 120_000 });
    expect.soft(tt.status, `lambda/shared tenant.test.mjs passes (${(tt.stdout + tt.stderr).slice(-300)})`).toBe(0);
    // No front-end file calls the route (the generated API types may describe it).
    const callers: string[] = [];
    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (n === 'node_modules') continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|js|mjs|html)$/.test(n) && !n.endsWith('openapi.d.ts') && readFileSync(p, 'utf8').includes('employees/lookup')) callers.push(relative(REPO, p));
      }
    };
    walk(join(REPO, 'pepla-web', 'src'));
    walk(join(REPO, 'hr-portal', 'src'));
    expect.soft(callers, 'no front-end file calls /v1/employees/lookup').toEqual([]);
  });

  test('AC-9 On pepla-dev: the lookup answers the fixed 404 to a stranger, to company B\'s HR and to company A\'s HR, with no @ @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1 to AC-8.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    const env = (k: string) => process.env[k] ?? '';
    const logins = { hrA: { email: env('E2E_HR_EMAIL'), password: env('E2E_HR_PASSWORD') }, hrB: { email: env('E2E_HR_B_EMAIL'), password: env('E2E_HR_B_PASSWORD') } };
    for (const [who, l] of Object.entries(logins)) expect(Boolean(l.email && l.password), `the ${who} test login is set`).toBe(true);
    const { devEnv } = await import('./support/ten-02/dev');
    const { api, region, clientId } = devEnv();
    const signIn = async (l: { email: string; password: string }) => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: l.email, PASSWORD: l.password } }),
      });
      expect(r.status(), 'signs in at Cognito').toBe(200);
      return ((await r.json()) as any).AuthenticationResult.IdToken as string;
    };
    const [hrA, hrB] = await Promise.all([signIn(logins.hrA), signIn(logins.hrB)]);
    const ids = ['E2E-EMP-0001', A_LEGACY, UNKNOWN_UUID];
    const callers: [string, string | undefined][] = [['no sign-in', undefined], ["company B's HR", hrB], ["company A's HR", hrA]];
    for (const id of ids) {
      for (const [who, token] of callers) {
        const r = await page.request.get(`${api}${PATH}?employeeId=${encodeURIComponent(id)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const text = await r.text();
        const safe = text.includes('@') ? `<${text.length} chars, holds an @>` : text.slice(0, 80);
        expect.soft(r.status(), `${id}, ${who}: 404 (${safe})`).toBe(404);
        expect.soft(text === FIXED_BODY, `${id}, ${who}: body is exactly ${FIXED_BODY} (${safe})`).toBe(true);
        expect.soft(text.includes('@'), `${id}, ${who}: no @ in the answer`).toBe(false);
        expect.soft(r.headers()['access-control-allow-origin'] ?? '', `${id}, ${who}: no open CORS`).not.toBe('*');
      }
    }
  });
});
