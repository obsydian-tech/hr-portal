import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { INFRA, attributes, blocks, stripComments, tfFiles } from './support/infra-harness';
import {
  AGENT_AUTHORIZER, LAMBDA, PRE_TOKEN, REPO, TENANTS_TABLE, TENANT_HELPER, awsCalls, httpEvent, jwtAuthorizer, logLines, preTokenEvent, row, runHandler,
  runHelper, type HelperRun, type Row, type Run, type Step, type StepResult,
} from './support/ten-01/lambda-harness';
import {
  all, common, expectOnly, inside, lambdaNamed, nested, resources, roleOf, settingsOf, squash, tfvar, without,
} from './support/ten-01/tf';
import { IMPORTS_HELPER, ciCopy, listProblems, npmTest, plant, readList, scan, sourceFiles, stripJs, unplant } from './support/ten-01/retrofit';

/**
 * TEN-01 · Every request knows its company: the company list, the company in the sign-in, one shared check
 * (Jira NH-193, epic NH-192 Tenancy). Red. One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/TEN-01.md (16 Nov 2026).
 *
 * Nothing here opens the app. AC-2, AC-3, AC-4 and AC-5 run the real code (lambda/tenantPreToken,
 * lambda/shared/tenant.mjs, lambda/agentAuthorizer), each call in its own Node process, against a fake AWS
 * (support/ten-01/fake-aws, copied from BE-17's with code added only): every DynamoDB and Secrets Manager call
 * and every log line is recorded; any AI client fails. AC-6 runs lambda/shared's own `npm test` on a copy of
 * lambda/ with planted folders. AC-1 and AC-7 read Terraform as text. AC-8 runs on pepla-dev only.
 *
 * Company ids: A is the legacy (first) company in these tests, B another company. Nothing calls AWS or any AI.
 * Locked once accepted: see cards/ten-01.md.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};

const HERE = join(__dirname, 'support', 'ten-01');
const PATTERN = '^ten_[0-9a-z]{26}$';
const IS_ID = new RegExp(PATTERN);
const A = 'ten_01jd3k9q7w2x5v8b4n6m0h1caa';
const B = 'ten_01jd3k9q7w2x5v8b4n6m0h1cbb';
const MALFORMED = [
  'ten_01JD3K9Q7W2X5V8B4N6M0H1CAA', // upper case
  'ten_01jd3k9q7w2x5v8b4n6m0h1ca', // 25
  'ten_01jd3k9q7w2x5v8b4n6m0h1caaa', // 27
  'ten-01jd3k9q7w2x5v8b4n6m0h1caa',
  ` ${A}`,
  `${A}\n`,
  'DEFAULT',
  '',
];
const FORBIDDEN = { error: 'Forbidden' };
const NOT_FOUND = { error: 'Not found' };

// ---------------------------------------------------------------- Terraform: the company list and its settings

const VARIABLES = () => blocks(all(), 'variable');
const tenantsTable = () => {
  const found = resources('aws_dynamodb_table').filter((b) => attributes(b.body).get('name') === '"naleko-people-${var.environment}-tenants"');
  expect(found, 'one aws_dynamodb_table named "naleko-people-${var.environment}-tenants"').toHaveLength(1);
  return found[0]!;
};
const tenantsRef = () => `aws_dynamodb_table.${tenantsTable().labels[1]}`;

/** tenantPreToken's settings from Terraform: the tenants table setting points at this fake's table; literal strings kept. */
function preTokenEnv(): Record<string, string> {
  const settings = settingsOf(lambdaNamed('tenantPreToken'));
  const ref = tenantsRef();
  const env: Record<string, string> = {};
  let table = '';
  for (const [k, v] of settings) {
    if (v === `${ref}.name` || v === `${ref}.id`) {
      env[k] = TENANTS_TABLE;
      table = k;
    } else if (/^"[^"$]*"$/.test(v)) env[k] = v.slice(1, -1);
  }
  expect(table, `tenantPreToken has a setting that names the tenants table (${ref}.name)`).not.toBe('');
  expect(settings.get('LEGACY_TENANT_ID'), 'tenantPreToken: LEGACY_TENANT_ID = var.founding_tenant_id').toBe('var.founding_tenant_id');
  return env;
}

// ---------------------------------------------------------------- AC-2 the pre-token trigger

const SUB = '7c1e9a52-3b4d-4f6a-8e21-0d9b5c3a7f10';
const OTHER_SUB = '0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d';
const EMAIL = 'thandeka.mokoena@kestrel-foods.co.za';
const HR_GROUPS = ['hr_staff', 'naleko-onboarding-hr'];

const member = (sub: string, tenantId: string): Row => row({ pk: `USER#${sub}`, sk: `TENANT#${tenantId}`, tenant_id: tenantId, created_at: '2026-11-16T08:00:00.000Z' });
const company = (tenantId: string, name: string): Row =>
  row({ pk: `TENANT#${tenantId}`, sk: 'PROFILE', tenant_id: tenantId, name, status: 'ACTIVE', country: 'ZA', created_at: '2026-11-16T08:00:00.000Z' });
/** Rows every case starts from: both companies, someone else's membership, and a non-membership row under the person. */
const NOISE: Row[] = [
  company(A, 'Founding client'),
  company(B, 'Kestrel Foods'),
  member(OTHER_SUB, B),
  row({ pk: `USER#${SUB}`, sk: 'PREFS', tenant_id: B, theme: 'light' }),
];

function preToken(opts: { members?: Row[]; legacy?: string | null; fail?: boolean; trigger?: string; groups?: string[]; attacker?: boolean }) {
  const event = preTokenEvent({
    sub: SUB,
    email: EMAIL,
    groups: opts.groups ?? HR_GROUPS,
    trigger: opts.trigger,
    ...(opts.attacker ? { extraAttributes: { 'custom:tenant_id': B, 'custom:tenantId': B, tenant_id: B }, clientMetadata: { tenant_id: B, tenantId: B } } : {}),
  });
  const env: Record<string, string | undefined> = { ...preTokenEnv() };
  delete env['LEGACY_TENANT_ID'];
  if (opts.legacy !== null && opts.legacy !== undefined) env['LEGACY_TENANT_ID'] = opts.legacy;
  const run = runHandler(PRE_TOKEN, event, {
    tables: { [TENANTS_TABLE]: [...NOISE, ...(opts.members ?? [])] },
    env,
    ...(opts.fail ? { fail: { service: 'dynamodb' as const, message: 'ProvisionedThroughputExceededException: Rate of requests exceeds the allowed throughput' } } : {}),
  });
  return { event, run };
}

const SECTIONS = ['idTokenGeneration', 'accessTokenGeneration'] as const;

/** The trigger answered the event, untouched but for the company claim (or no claim when `tenantId` is null). */
function expectClaim(what: string, event: any, run: Run, tenantId: string | null): void {
  expect(run.error, `${what}: the trigger never throws (${run.error?.message})`).toBeUndefined();
  const out = run.response;
  expect(out, `${what}: the trigger returns the event`).toBeTruthy();
  for (const k of ['version', 'triggerSource', 'region', 'userPoolId', 'userName', 'callerContext', 'request'] as const) {
    expect(out[k], `${what}: event.${k} is handed back unchanged (groups and attributes untouched)`).toEqual(event[k]);
  }
  const details = out.response?.claimsAndScopeOverrideDetails ?? null;
  if (details) {
    expect(Object.keys(details).filter((k) => !SECTIONS.includes(k as never) && details[k] != null), `${what}: no group override and nothing else in the answer`).toEqual([]);
    for (const s of SECTIONS) {
      const sec = details[s];
      if (!sec) continue;
      expect(sec.claimsToSuppress ?? [], `${what}: ${s} suppresses no claim`).toEqual([]);
      expect(sec.scopesToAdd ?? [], `${what}: ${s} adds no scope`).toEqual([]);
      expect(sec.scopesToSuppress ?? [], `${what}: ${s} suppresses no scope`).toEqual([]);
      expect(Object.keys(sec).filter((k) => !['claimsToAddOrOverride', 'claimsToSuppress', 'scopesToAdd', 'scopesToSuppress'].includes(k)), `${what}: ${s} holds nothing else`).toEqual([]);
    }
  }
  for (const s of SECTIONS) {
    const claims = details?.[s]?.claimsToAddOrOverride ?? {};
    if (tenantId) expect(claims, `${what}: the ${s === 'idTokenGeneration' ? 'ID' : 'access'} token gets tenant_id ${tenantId} and no other claim`).toEqual({ tenant_id: tenantId });
    else expect(claims, `${what}: no claim is added to the ${s === 'idTokenGeneration' ? 'ID' : 'access'} token`).toEqual({});
  }
}

/** The only AWS call: one Query on the tenants table (never a Scan, a GetItem or an index). */
function expectOneQuery(what: string, run: Run): void {
  expect(awsCalls(run.calls), `${what}: the only AWS call is one Query on the tenants table`).toEqual([`dynamodb Query ${TENANTS_TABLE}`]);
  const q = run.calls.find((c) => c.service === 'dynamodb') as { input: any };
  expect(q.input.IndexName, `${what}: on the table, not an index`).toBeUndefined();
}

function expectSkipLogged(what: string, run: Run, reason: string): void {
  const lines = logLines(run.calls);
  const skipped = lines.filter((l) => l.includes('Tenant claim skipped'));
  expect(skipped.length, `${what}: logs "Tenant claim skipped" (log lines: ${JSON.stringify(lines)})`).toBeGreaterThanOrEqual(1);
  expect(skipped.some((l) => l.includes(SUB) && new RegExp(`\\b${reason}\\b`).test(l)), `${what}: with the sub and the reason "${reason}"`).toBe(true);
}

function expectNoEmailLogged(what: string, run: Run): void {
  for (const l of logLines(run.calls)) {
    expect(l, `${what}: no log line holds the email`).not.toContain(EMAIL);
    expect(l, `${what}: nor its name part`).not.toContain(EMAIL.split('@')[0]);
  }
}

// ---------------------------------------------------------------- AC-3 / AC-4 the helper

function helper(steps: Step[], env: Record<string, string | undefined> = {}): HelperRun {
  const r = runHelper(steps, env);
  expect(r.importError, `lambda/shared/tenant.mjs loads (${r.importError?.message})`).toBeUndefined();
  expect(awsCalls(r.calls), 'the helper makes no AWS or network call').toEqual([]);
  return r;
}

function expectRefusal(what: string, r: StepResult): void {
  expect(r.ok, `${what}: requireTenant answers (${r.error?.message})`).toBe(true);
  expect(r.value?.tenantId ?? null, `${what}: no company`).toBeNull();
  const refusal = r.value?.refusal;
  expect(refusal?.statusCode, `${what}: refused with 403`).toBe(403);
  expect(JSON.parse(refusal?.body ?? 'null'), `${what}: the answer is exactly { "error": "Forbidden" }`).toEqual(FORBIDDEN);
  const headers = Object.fromEntries(Object.entries(refusal?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  expect(headers['access-control-allow-origin'], `${what}: with the usual CORS header`).toBe('*');
  expect(String(headers['content-type'] ?? ''), `${what}: as JSON`).toContain('application/json');
}

function expectAnswer(what: string, r: StepResult, statusCode: number, body: unknown): void {
  expect(r.ok, `${what}: answers (${r.error?.message})`).toBe(true);
  expect(r.value?.statusCode, `${what}: ${statusCode}`).toBe(statusCode);
  expect(JSON.parse(r.value?.body ?? 'null'), `${what}: body ${JSON.stringify(body)}`).toEqual(body);
  const headers = Object.fromEntries(Object.entries(r.value?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  expect(headers['access-control-allow-origin'], `${what}: with the usual CORS header`).toBe('*');
}

/** An event whose sign-in says `claim` (or carries no claim), while everything the caller can write says B. */
function poisoned(authorizer: unknown) {
  return httpEvent({
    authorizer,
    query: { tenantId: B, tenant_id: B },
    path: { tenantId: B, tenant_id: B },
    headers: { 'x-tenant-id': B, 'tenant-id': B, tenant_id: B, cookie: `tenant_id=${B}` },
    cookies: [`tenant_id=${B}`, `tenantId=${B}`],
    body: { tenant_id: B, tenantId: B },
  });
}

// ---------------------------------------------------------------- AC-5 the agent authorizer

const AGENT_KEY = 'ten01-agent-key-3f9c2a7e5b1d4c6a8e0f';
const SECRET_NAME = 'ten01/fake/agent-key';
function agentRun(opts: { key?: string; tenant?: string | null; xTenant?: string }) {
  const event = {
    version: '2.0',
    type: 'REQUEST',
    routeArn: 'arn:aws:execute-api:af-south-1:000000000000:ten01fake/$default/GET/agent/v1/employees',
    identitySource: [opts.key ?? AGENT_KEY],
    routeKey: 'GET /agent/v1/employees',
    rawPath: '/agent/v1/employees',
    rawQueryString: '',
    headers: { 'x-api-key': opts.key ?? AGENT_KEY, ...(opts.xTenant ? { 'x-tenant-id': opts.xTenant } : {}) },
    requestContext: { http: { method: 'GET', path: '/agent/v1/employees' }, routeKey: 'GET /agent/v1/employees', stage: '$default' },
  };
  const env: Record<string, string | undefined> = { AGENT_API_KEY_SECRET_NAME: SECRET_NAME };
  if (opts.tenant !== null && opts.tenant !== undefined) env['AGENT_TENANT_ID'] = opts.tenant;
  return runHandler(AGENT_AUTHORIZER, event, { secrets: { [SECRET_NAME]: { AWSCURRENT: AGENT_KEY } }, env });
}

// ---------------------------------------------------------------- AC-8 pepla-dev

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
const claimsOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
const groupsOf = (claims: Record<string, unknown>): string[] => {
  const g = claims['cognito:groups'];
  return Array.isArray(g) ? g.map(String) : typeof g === 'string' ? g.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean) : [];
};

// ---------------------------------------------------------------- tests

test.describe('TEN-01 Every request knows its company', () => {
  test('AC-1 The company list and the first company exist', async ({}, testInfo) => {
    once(testInfo.project.name);

    // The table, in infra/tenancy.tf.
    const tenancy = join(INFRA, 'tenancy.tf');
    expect(existsSync(tenancy), 'infra/tenancy.tf exists').toBe(true);
    const t = tenantsTable();
    expect(t.file, 'the tenants table is in infra/tenancy.tf').toBe(tenancy);
    const a = attributes(t.body);
    expect(a.get('hash_key'), 'keyed by pk').toBe('"pk"');
    expect(a.get('range_key'), 'and sk').toBe('"sk"');
    expect(a.get('billing_mode'), 'on demand').toBe('"PAY_PER_REQUEST"');
    expect(a.get('deletion_protection_enabled'), 'deletion protection on').toBe('true');
    const keys = nested(t.body, 'attribute').map((x) => attributes(inside(x)));
    expect(keys.map((k) => `${k.get('name')}:${k.get('type')}`).sort(), 'pk and sk are strings').toEqual(expect.arrayContaining(['"pk":"S"', '"sk":"S"']));
    const pitr = nested(t.body, 'point_in_time_recovery').map((x) => attributes(inside(x)).get('enabled'));
    expect(pitr, 'point-in-time recovery on').toEqual(['true']);
    const sse = nested(t.body, 'server_side_encryption').map((x) => attributes(inside(x)));
    expect(sse.length, 'server-side encryption is set').toBe(1);
    expect(sse[0]!.get('enabled'), 'server-side encryption on').toBe('true');
    expect(sse[0]!.get('kms_key_arn'), 'with the PII key').toBe('module.kms_pii.key_arn');
    const life = nested(t.body, 'lifecycle').map((x) => attributes(inside(x)).get('prevent_destroy'));
    expect(life, 'prevent_destroy = true').toEqual(['true']);

    // The variable and its two values.
    const v = VARIABLES().filter((b) => b.labels[0] === 'founding_tenant_id');
    expect(v, 'one variable "founding_tenant_id"').toHaveLength(1);
    const validations = nested(v[0]!.body, 'validation').map((x) => attributes(inside(x)).get('condition') ?? '');
    expect(validations.length, 'founding_tenant_id has a validation').toBeGreaterThanOrEqual(1);
    expect(validations.some((c) => c.includes(`"${PATTERN}"`) && c.includes('var.founding_tenant_id') && /regex\(|regexall\(/.test(c)), `the validation uses exactly the pattern ${PATTERN}`).toBe(true);
    const devValue = tfvar(join(INFRA, 'env', 'dev.tfvars'), 'founding_tenant_id');
    expect(devValue, 'infra/env/dev.tfvars sets founding_tenant_id').toBeTruthy();
    expect(devValue!, 'the dev value is a company id').toMatch(IS_ID);
    // Prod plans and applies run with no var file, so prod's value is the variable's default (or env/prod.tfvars, if one exists).
    const prodFile = join(INFRA, 'env', 'prod.tfvars');
    const prodDefault = /^"([^"]*)"$/.exec(attributes(v[0]!.body).get('default') ?? '')?.[1];
    const prodValue = existsSync(prodFile) ? (tfvar(prodFile, 'founding_tenant_id') ?? prodDefault) : prodDefault;
    expect(prodValue, 'prod has a founding_tenant_id (the variable default, as prod runs with no var file)').toBeTruthy();
    expect(prodValue!, 'the prod value is a company id').toMatch(IS_ID);
    if (existsSync(prodFile) && prodDefault) expect(prodValue, 'env/prod.tfvars and the default agree').toBe(prodDefault);
    expect(prodValue, 'dev and prod have different first companies').not.toBe(devValue);

    // The first company's row is data, not infrastructure (TEN-01.1): the OPS-05 apply role may not read or
    // write table data, so no Terraform resource writes it. In pepla-dev scripts/ci/seed-dev.py writes it,
    // once, with the id from infra/env/dev.tfvars.
    expect(resources('aws_dynamodb_table_item'), 'no aws_dynamodb_table_item anywhere in infra/').toHaveLength(0);
    const seed = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    expect(seed, 'seed-dev.py writes to the dev tenants table').toContain('"naleko-people-dev-tenants"');
    expect(seed, 'seed-dev.py reads founding_tenant_id from infra/env/dev.tfvars').toMatch(/"env"\s*\/\s*"dev\.tfvars"|env\/dev\.tfvars/);
    const row = seed.replace(/\s+/g, '');
    for (const want of ['"pk":{"S":f"TENANT#{tid}"}', '"sk":{"S":"PROFILE"}', '"tenant_id":{"S":tid}', '"name":{"S":"Foundingclient"}', '"status":{"S":"ACTIVE"}', '"country":{"S":"ZA"}', '"founding":{"BOOL":True}']) {
      expect(row, `seed-dev.py's first company row has ${want}`).toContain(want);
    }
    expect(row, 'and is written only when missing').toContain('ConditionExpression="attribute_not_exists(pk)"');
    const everything = all().map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
    expect(everything, 'no member row (USER#...) is written by Terraform').not.toMatch(/USER#/);
  });

  test('AC-2 The token carries the company', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect(existsSync(PRE_TOKEN), 'lambda/tenantPreToken/index.mjs exists').toBe(true);

    // (a) one Member row (B) wins over the legacy company, on sign-in and on refresh.
    for (const trigger of ['TokenGeneration_Authentication', 'TokenGeneration_RefreshTokens']) {
      const { event, run } = preToken({ members: [member(SUB, B)], legacy: A, trigger });
      const what = `(a) one Member row for B, legacy A, ${trigger}`;
      expectClaim(what, event, run, B);
      expectOneQuery(what, run);
      expect(logLines(run.calls).filter((l) => l.includes('Tenant claim skipped')), `${what}: nothing skipped`).toEqual([]);
      expectNoEmailLogged(what, run);
    }

    // (b) no Member row: the legacy company, whatever the person or the client sends; employees too.
    for (const groups of [HR_GROUPS, ['employee']]) {
      const { event, run } = preToken({ legacy: A, attacker: true, groups, trigger: 'TokenGeneration_RefreshTokens' });
      const what = `(b) no Member row, legacy A, ${groups.join(' ')}; attributes and client metadata say B`;
      expectClaim(what, event, run, A);
      expectOneQuery(what, run);
      expectNoEmailLogged(what, run);
    }

    // (c) no Member row and no legacy setting (absent, empty, or not a company id): no claim.
    for (const legacy of [null, '', 'DEFAULT', 'ten_01JD3K9Q7W2X5V8B4N6M0H1CAA']) {
      const { event, run } = preToken({ legacy });
      const what = `(c) no Member row, LEGACY_TENANT_ID ${legacy === null ? 'not set' : JSON.stringify(legacy)}`;
      expectClaim(what, event, run, null);
      expectOneQuery(what, run);
      expectSkipLogged(what, run, 'none');
      expectNoEmailLogged(what, run);
    }

    // (d) two Member rows: no claim, even with a legacy company.
    {
      const { event, run } = preToken({ members: [member(SUB, A), member(SUB, B)], legacy: A });
      const what = '(d) two Member rows';
      expectClaim(what, event, run, null);
      expectOneQuery(what, run);
      expectSkipLogged(what, run, 'several');
      expectNoEmailLogged(what, run);
    }

    // (e) a Member row with a malformed company id: no claim, even with a legacy company.
    for (const bad of ['ten_BAD', 'DEFAULT', 'ten_01jd3k9q7w2x5v8b4n6m0h1ca']) {
      const { event, run } = preToken({ members: [member(SUB, bad)], legacy: A });
      const what = `(e) a Member row with company id ${bad}`;
      expectClaim(what, event, run, null);
      expectOneQuery(what, run);
      expectSkipLogged(what, run, 'malformed');
      expectNoEmailLogged(what, run);
    }

    // (f) DynamoDB fails: the event comes back, with no claim, and nothing throws.
    {
      const { event, run } = preToken({ members: [member(SUB, B)], legacy: A, fail: true });
      const what = '(f) the Query throws';
      expectClaim(what, event, run, null);
      expectOneQuery(what, run);
      expectSkipLogged(what, run, 'error');
      expectNoEmailLogged(what, run);
    }
  });

  test('AC-3 The company comes only from the sign-in', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect(existsSync(TENANT_HELPER), 'lambda/shared/tenant.mjs exists').toBe(true);
    const code = stripJs(readFileSync(TENANT_HELPER, 'utf8'));
    expect(code, 'tenant.mjs imports no AWS package').not.toMatch(/['"]@aws-sdk\/|['"]aws-sdk['"]/);
    expect(code, 'and makes no network call').not.toMatch(/\bfetch\s*\(|['"](node:)?https?['"]/);

    const claimA = poisoned(jwtAuthorizer({ tenant_id: A }));
    const noClaim = poisoned(jwtAuthorizer({}));
    const editable = poisoned(jwtAuthorizer({ 'custom:tenant_id': A, 'custom:tenantId': A, tenantId: A }));
    const agentNone = poisoned({ lambda: { actor: 'AGENT' } });
    const agentA = poisoned({ lambda: { actor: 'AGENT', tenant_id: A } });
    const nothing = poisoned(undefined);
    const malformed = MALFORMED.map((m) => poisoned(jwtAuthorizer({ tenant_id: m })));
    const steps: Step[] = [];
    const add = (fn: string, ev: unknown) => steps.push({ fn, args: [ev] }) - 1;

    // The legacy company is set, so a helper that falls back to it would show here.
    const cases = {
      claimA: [add('tenantOf', claimA), add('requireTenant', claimA)],
      noClaim: [add('tenantOf', noClaim), add('requireTenant', noClaim)],
      editable: [add('tenantOf', editable), add('requireTenant', editable)],
      agentNone: [add('tenantOf', agentNone), add('requireTenant', agentNone)],
      agentA: [add('tenantOf', agentA), add('requireTenant', agentA)],
      nothing: [add('tenantOf', nothing), add('requireTenant', nothing)],
      malformed: malformed.map((ev) => [add('tenantOf', ev), add('requireTenant', ev)] as const),
    };
    const r = helper(steps, { LEGACY_TENANT_ID: A }).results;

    const of = (i: number) => {
      expect(r[i]!.ok, `tenantOf answers (${r[i]!.error?.message})`).toBe(true);
      return r[i]!.value;
    };
    expect(of(cases.claimA[0]), 'the claim says A, the query, path, headers, cookies and body say B: tenantOf is A').toBe(A);
    expect(r[cases.claimA[1]]!.value?.tenantId, 'requireTenant gives { tenantId: A }').toBe(A);
    expect(r[cases.claimA[1]]!.value?.refusal ?? null, 'and no refusal').toBeNull();

    expect(of(cases.noClaim[0]), 'no claim (B everywhere else, legacy A set): tenantOf is null').toBeNull();
    expectRefusal('no claim', r[cases.noClaim[1]]!);
    expect(of(cases.editable[0]), 'custom:tenant_id or tenantId claims are not the company: null').toBeNull();
    expectRefusal('only custom:tenant_id / tenantId claims', r[cases.editable[1]]!);
    expect(of(cases.agentNone[0]), 'an agent context without tenant_id: null').toBeNull();
    expectRefusal('agent without tenant_id', r[cases.agentNone[1]]!);
    expect(of(cases.nothing[0]), 'no authorizer at all: null').toBeNull();
    expectRefusal('no authorizer', r[cases.nothing[1]]!);
    cases.malformed.forEach(([t, q], i) => {
      expect(of(t), `a malformed claim ${JSON.stringify(MALFORMED[i])}: null`).toBeNull();
      expectRefusal(`malformed claim ${JSON.stringify(MALFORMED[i])}`, r[q]!);
    });
    expect(of(cases.agentA[0]), 'an agent context with tenant_id A: A').toBe(A);
    expect(r[cases.agentA[1]]!.value?.tenantId, 'requireTenant gives { tenantId: A } to the agent').toBe(A);
    expect(r[cases.agentA[1]]!.value?.refusal ?? null).toBeNull();
  });

  test('AC-4 Rows are stamped and checked', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect(existsSync(TENANT_HELPER), 'lambda/shared/tenant.mjs exists').toBe(true);

    // Rows as DynamoDB stores them, for the filters.
    const rows = [
      { employee_id: { S: 'E-A' }, stage: { S: 'INVITED' }, tenant_id: { S: A } },
      { employee_id: { S: 'E-B' }, stage: { S: 'INVITED' }, tenant_id: { S: B } },
      { employee_id: { S: 'E-OLD' }, stage: { S: 'INVITED' } },
      { employee_id: { S: 'E-B2' }, stage: { S: 'ACTIVE' }, tenant_id: { S: B } },
      { employee_id: { S: 'E-A2' }, stage: { S: 'ACTIVE' }, tenant_id: { S: A } },
    ];
    const ownFilter = { FilterExpression: '#stage = :s1 OR #stage = :s2', ExpressionAttributeNames: { '#stage': 'stage' }, ExpressionAttributeValues: { ':s1': 'INVITED', ':s2': 'ACTIVE' } };
    const stageFilter = { FilterExpression: '#stage = :stage', ExpressionAttributeNames: { '#stage': 'stage' }, ExpressionAttributeValues: { ':stage': 'INVITED' } };

    // With the legacy company A.
    const s: Step[] = [
      { get: 'TENANT_ID_PATTERN' },
      { fn: 'stampTenant', args: [{ employee_id: 'E-1', first_name: 'Jane' }, A] }, // 1
      { fn: 'stampTenant', args: [{ employee_id: 'E-2', tenant_id: A }, A] }, // 2
      { fn: 'stampTenant', args: [{ employee_id: 'E-3', tenant_id: B }, A] }, // 3
      { fn: 'ownsRow', args: [{ employee_id: 'E-A', tenant_id: A }, A] }, // 4
      { fn: 'ownsRow', args: [{ employee_id: 'E-B', tenant_id: B }, A] }, // 5
      { fn: 'ownsRow', args: [{ employee_id: 'E-OLD' }, A] }, // 6
      { fn: 'ownsRow', args: [{ employee_id: 'E-OLD' }, B] }, // 7
      { fn: 'ownsRow', args: [null, A] }, // 8
      { fn: 'ownsRow', args: [undefined, A] }, // 9
      { fn: 'tenantFilter', args: [B], rows } as Step, // 10
      { fn: 'tenantFilter', args: [A], rows } as Step, // 11
      { fn: 'andFilter', args: [ownFilter, { $step: 10 }], rows } as Step, // 12
      { fn: 'andFilter', args: [stageFilter, { $step: 11 }], rows } as Step, // 13
      { fn: 'tenantKey', args: [A, 'PERSON', 'x'] }, // 14
      { fn: 'tenantKey', args: ['ten_bad', 'PERSON', 'x'] }, // 15
      { fn: 'tenantKey', args: [A, ''] }, // 16
      { fn: 'tenantKey', args: [A, 'PERSON', ''] }, // 17
      { fn: 'notFound', args: [] }, // 18
      { fn: 'ownsRow', args: [{ employee_id: 'E-A', tenant_id: A }, B] }, // 19
      { fn: 'tenantKey', args: [B.toUpperCase(), 'PERSON'] }, // 20
    ];
    const run = helper(s, { LEGACY_TENANT_ID: A });
    const r = run.results;
    for (const name of ['TENANT_ID_PATTERN', 'tenantOf', 'requireTenant', 'stampTenant', 'ownsRow', 'tenantFilter', 'andFilter', 'tenantKey', 'notFound']) {
      expect(run.exports, `tenant.mjs exports ${name}`).toContain(name);
    }
    expect(r[0]!.type, 'TENANT_ID_PATTERN is a RegExp').toBe('regexp');
    expect(r[0]!.value?.regex, `TENANT_ID_PATTERN is /${PATTERN}/`).toBe(PATTERN);
    expect(r[0]!.value?.flags ?? '', 'with no flags').toBe('');

    expect(r[1]!.ok, `stampTenant stamps a new row (${r[1]!.error?.message})`).toBe(true);
    expect(r[1]!.value, 'stampTenant returns the row with tenant_id').toEqual({ employee_id: 'E-1', first_name: 'Jane', tenant_id: A });
    expect(r[1]!.args?.[0], 'and leaves the row it was given as it was (a copy)').toEqual({ employee_id: 'E-1', first_name: 'Jane' });
    expect(r[2]!.ok && r[2]!.value?.tenant_id, 'a row already of A stamped with A stays A').toBe(A);
    expect(r[3]!.ok, 'a row of B stamped with A throws').toBe(false);
    expect([r[3]!.error?.name, r[3]!.error?.ctor], 'with TenantMismatch').toContain('TenantMismatch');

    const owns = (i: number, want: boolean, what: string) => {
      expect(r[i]!.ok, `${what}: ownsRow answers (${r[i]!.error?.message})`).toBe(true);
      expect(r[i]!.value, what).toBe(want);
    };
    owns(4, true, "A's row, asked by A");
    owns(5, false, "B's row, asked by A");
    owns(19, false, "A's row, asked by B");
    owns(6, true, 'a row with no company, asked by A while LEGACY_TENANT_ID = A');
    owns(7, false, 'a row with no company, asked by B');
    owns(8, false, 'a missing row (null)');
    owns(9, false, 'a missing row (undefined)');

    const matched = (i: number, want: string[], what: string) => {
      expect(r[i]!.ok, `${what}: answers (${r[i]!.error?.message})`).toBe(true);
      const v = r[i]!.value;
      expect(Object.keys(v?.ExpressionAttributeNames ?? {}), `${what}: uses #tenant_id`).toContain('#tenant_id');
      expect(v?.ExpressionAttributeNames?.['#tenant_id'], `${what}: #tenant_id is tenant_id`).toBe('tenant_id');
      expect(Object.keys(v?.ExpressionAttributeValues ?? {}), `${what}: uses :tenant_id`).toContain(':tenant_id');
      for (const k of [...Object.keys(v?.ExpressionAttributeNames ?? {}), ...Object.keys(v?.ExpressionAttributeValues ?? {})]) {
        expect(String(v?.FilterExpression ?? ''), `${what}: ${k} is used in the expression (DynamoDB refuses unused names and values)`).toMatch(new RegExp(`${k}(?![\\w])`));
      }
      expect((r[i] as StepResult & { matched: number[] }).matched.map((n) => rows[n]!.employee_id.S), what).toEqual(want);
    };
    matched(10, ['E-B', 'E-B2'], 'tenantFilter(B) keeps only B\'s rows');
    matched(11, ['E-A', 'E-OLD', 'E-A2'], 'tenantFilter(A) with legacy A also keeps rows with no company');
    matched(12, ['E-B', 'E-B2'], 'andFilter keeps the caller\'s own filter (an OR) and adds the company with AND');
    matched(13, ['E-A', 'E-OLD'], 'andFilter of a stage filter and tenantFilter(A): A\'s and legacy INVITED rows only');
    expect(r[12]!.value?.ExpressionAttributeNames?.['#stage'], 'andFilter keeps the caller\'s names').toBe('stage');
    expect(Object.keys(r[12]!.value?.ExpressionAttributeValues ?? {}).sort(), 'and the caller\'s values').toEqual([':s1', ':s2', ':tenant_id']);

    expect(r[14]!.ok && r[14]!.value, 'tenantKey(A, "PERSON", "x")').toBe(`TENANT#${A}#PERSON#x`);
    expect(r[15]!.ok, 'tenantKey with an invalid id throws').toBe(false);
    expect(r[20]!.ok, 'tenantKey with an upper-case id throws').toBe(false);
    expect(r[16]!.ok, 'tenantKey with an empty part throws').toBe(false);
    expect(r[17]!.ok, 'tenantKey with an empty last part throws').toBe(false);
    expectAnswer('notFound()', r[18]!, 404, NOT_FOUND);

    // With the legacy rule off (unset, empty) or broken: rows with no company belong to nobody.
    for (const legacy of [undefined, '', 'ten_bad', 'DEFAULT']) {
      const steps: Step[] = [
        { fn: 'ownsRow', args: [{ employee_id: 'E-OLD' }, A] },
        { fn: 'ownsRow', args: [{ employee_id: 'E-OLD' }, legacy ?? ''] },
        { fn: 'ownsRow', args: [{ employee_id: 'E-A', tenant_id: A }, A] },
        { fn: 'tenantFilter', args: [A], rows } as Step,
        { fn: 'ownsRow', args: [{ employee_id: 'E-OLD', tenant_id: legacy ?? '' }, legacy ?? ''] },
        { fn: 'tenantFilter', args: [legacy ?? ''], rows } as Step,
      ];
      const off = helper(steps, legacy === undefined ? {} : { LEGACY_TENANT_ID: legacy }).results;
      const what = `LEGACY_TENANT_ID ${legacy === undefined ? 'not set' : JSON.stringify(legacy)}`;
      expect(off[0]!.ok && off[0]!.value, `${what}: a row with no company, asked by A, is not A's`).toBe(false);
      expect(off[1]!.ok && off[1]!.value, `${what}: nor anyone's who asks with the setting's own value`).toBe(false);
      expect(off[2]!.ok && off[2]!.value, `${what}: A's own row is still A's`).toBe(true);
      expect((off[3] as StepResult & { matched?: number[] }).matched?.map((n) => rows[n]!.employee_id.S), `${what}: tenantFilter(A) keeps only A's rows`).toEqual(['E-A', 'E-A2']);
      expect(off[4]!.ok && off[4]!.value, `${what}: a company id that is not valid owns nothing`).toBe(false);
      // tenantFilter asked with the setting's own value: never the rows with no company (it may also refuse the id).
      const own = off[5] as StepResult & { matched?: number[] };
      if (own.ok) expect(own.matched?.map((n) => rows[n]!.employee_id.S) ?? [], `${what}: tenantFilter(${JSON.stringify(legacy ?? '')}) keeps no row without a company`).not.toContain('E-OLD');
    }

    // The helper's header comment states the rule for every card after this one.
    const src = readFileSync(TENANT_HELPER, 'utf8');
    const header = /^\s*(\/\*[\s\S]*?\*\/|(?:\/\/[^\n]*\n\s*)+)/.exec(src)?.[1] ?? '';
    for (const word of ['requireTenant', 'stampTenant', 'ownsRow', 'tenantFilter', 'tenantKey', 'notFound']) {
      expect(header, `the header comment names ${word} (the rule for every card after this one)`).toContain(word);
    }
  });

  test('AC-5 Agent calls carry the company', async ({}, testInfo) => {
    once(testInfo.project.name);

    const ok = agentRun({ tenant: A, xTenant: B });
    expect(ok.error, `a valid key: the authorizer answers (${ok.error?.message})`).toBeUndefined();
    expect(ok.response, 'a valid key: authorized as the agent of company A (an x-tenant-id header is ignored)').toEqual({ isAuthorized: true, context: { actor: 'AGENT', tenant_id: A } });

    const wrong = agentRun({ tenant: A, key: 'ten01-not-the-key-0000000000000000' });
    expect(wrong.error, 'a wrong key: the authorizer answers').toBeUndefined();
    expect(wrong.response?.isAuthorized, 'a wrong key is refused as today').toBe(false);
    expect(JSON.stringify(wrong.response ?? {}), 'with no company').not.toContain(A);

    for (const tenant of [null, '', 'ten_SHORT', 'DEFAULT', A.toUpperCase()]) {
      const what = `AGENT_TENANT_ID ${tenant === null ? 'not set' : JSON.stringify(tenant)}`;
      const run = agentRun({ tenant });
      const lines = logLines(run.calls);
      expect(lines.some((l) => l.includes('Missing setting AGENT_TENANT_ID')), `${what}: logs "Missing setting AGENT_TENANT_ID" (log lines: ${JSON.stringify(lines)})`).toBe(true);
      expect(run.response?.isAuthorized === true, `${what}: a valid key is still refused`).toBe(false);
      expect(run.error !== undefined || run.response?.isAuthorized === false, `${what}: the Lambda stops at start or refuses`).toBe(true);
      expect(JSON.stringify(run.response ?? {}), `${what}: no company is handed on`).not.toMatch(/tenant_id/);
    }
  });

  test('AC-6 The list can only shrink', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(600_000);
    const listFile = join(LAMBDA, 'shared', 'tenant-retrofit.json');
    const testFile = join(LAMBDA, 'shared', 'tenant.test.mjs');
    expect(existsSync(testFile), 'lambda/shared/tenant.test.mjs exists').toBe(true);
    expect(existsSync(listFile), 'lambda/shared/tenant-retrofit.json exists').toBe(true);

    // The list against its locked copy: removals pass, additions fail.
    const locked = JSON.parse(readFileSync(join(HERE, 'tenant-retrofit.locked.json'), 'utf8')) as { develop: string[]; pending: string[] };
    const allowed = [...locked.develop, ...locked.pending];
    const names = readList(listFile);
    expect(listProblems(names, allowed), 'tenant-retrofit.json holds only names from the locked copy, once each').toEqual([]);
    expect(listProblems(names.slice(1), allowed), 'removing a name passes').toEqual([]);
    expect(listProblems([...names, 'zzTen01Planted'], allowed).length, 'adding a name fails').toBe(1);

    // This card's own reading of the repo: every Lambda that names the onboarding tables imports the helper or is on the list.
    const folders = scan(LAMBDA);
    const missing = folders.filter((f) => f.touches && !f.usesHelper && !names.includes(f.name)).map((f) => f.name);
    expect(missing, 'every Lambda that names an onboarding table imports shared/tenant.mjs or is on tenant-retrofit.json').toEqual([]);

    // No Lambda that imports the helper takes a company from the request (comments stripped).
    const helperCode = stripJs(readFileSync(join(LAMBDA, 'shared', 'tenant.mjs'), 'utf8'));
    expect(helperCode, 'tenant.mjs reads nothing the caller sends').not.toMatch(/\.\s*(queryStringParameters|pathParameters|cookies)\b|event\s*(\?\.|\.)\s*(body|headers)\b|\[\s*['"](queryStringParameters|pathParameters|body|headers|cookies)['"]\s*\]/);
    const REQ = String.raw`(?:event|evt|req|request)\s*(?:\?\.|\.)\s*`;
    const TID = String.raw`(?:tenantId|tenant_id|tenant-id|x-tenant-id)`;
    const fromRequest = [
      new RegExp(String.raw`${REQ}(?:queryStringParameters|pathParameters|headers|cookies)\s*(?:\?\.|\.)?\s*(?:\[\s*['"\x60])?${TID}\b`, 'i'),
      new RegExp(String.raw`JSON\.parse\s*\(\s*${REQ}body[^)]*\)\s*(?:\?\.|\.)\s*${TID}\b`),
      new RegExp(String.raw`\{[^}]*\b(?:tenantId|tenant_id)\b[^}]*\}\s*=\s*(?:JSON\.parse\s*\(\s*)?(?:${REQ}(?:body|queryStringParameters|pathParameters|headers)|(?:body|payload|input|params|query|qs)\b)`),
      new RegExp(String.raw`\b(?:body|payload|input|params|query|qs)\s*(?:\?\.|\.)\s*${TID}\b`),
    ];
    for (const f of folders.filter((x) => x.usesHelper)) {
      for (const file of sourceFiles(join(LAMBDA, f.name))) {
        const text = stripJs(readFileSync(file, 'utf8'));
        for (const re of fromRequest) expect(text.match(re)?.[0] ?? null, `lambda/${f.name}: no company read from the request`).toBeNull();
      }
    }

    // The CI test itself, run the way the "Lambda unit tests" job runs it, on a copy of lambda/.
    const lambda = ciCopy(LAMBDA);
    const base = npmTest(lambda);
    expect(base.status, `npm test in lambda/shared passes on the repo as it is:\n${base.output.slice(-3000)}`).toBe(0);

    const PLANT = 'zzTen01Planted';
    const plain = `export const handler = async () => {\n  const table = process.env.EMPLOYEES_TABLE;\n  return { statusCode: 200, body: JSON.stringify({ table }) };\n};\n`;
    const literal = `import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';\nconst db = new DynamoDBClient({});\nexport const handler = async (event) => db.send(new GetItemCommand({ TableName: "employees", Key: { employee_id: { S: event.id } } }));\n`;
    const withHelper = `import { requireTenant } from '../shared/tenant.mjs';\n${plain.replace('async () => {', 'async (event) => {\n  const { refusal } = requireTenant(event);\n  if (refusal) return refusal;')}`;
    try {
      plant(lambda, PLANT, { 'index.mjs': plain, 'package.json': '{ "name": "zz-ten01-planted", "private": true }\n' });
      const caught = npmTest(lambda);
      expect(caught.status, 'a new Lambda that reads EMPLOYEES_TABLE without the helper fails npm test').not.toBe(0);
      expect(caught.output, 'and the failure names the folder').toContain(PLANT);

      plant(lambda, PLANT, { 'index.mjs': literal, 'package.json': '{ "name": "zz-ten01-planted", "private": true }\n' });
      const caught2 = npmTest(lambda);
      expect(caught2.status, 'a new Lambda that names the "employees" table without the helper fails npm test').not.toBe(0);
      expect(caught2.output, 'and the failure names the folder').toContain(PLANT);

      plant(lambda, PLANT, { 'index.mjs': withHelper, 'package.json': '{ "name": "zz-ten01-planted", "private": true }\n' });
      const passes = npmTest(lambda);
      expect(passes.status, `the same Lambda importing ../shared/tenant.mjs passes:\n${passes.output.slice(-3000)}`).toBe(0);
    } finally {
      unplant(lambda, PLANT);
    }
    expect(IMPORTS_HELPER.test(withHelper), 'the planted import is one this card reads as using the helper').toBe(true);
  });

  test('AC-7 Terraform and roles hold exactly this', async ({}, testInfo) => {
    once(testInfo.project.name);
    const fn = lambdaNamed('tenantPreToken');
    const fnRef = `aws_lambda_function.${fn.labels[1]}`;

    // The pool: updated in place; only lambda_config changes.
    const pools = resources('aws_cognito_user_pool').filter((b) => b.labels[1] === 'naleko_dev');
    expect(pools, 'aws_cognito_user_pool.naleko_dev is still there, under the same name').toHaveLength(1);
    const pool = pools[0]!;
    const baseFile = join(HERE, 'cognito.71fe5b8.tf.txt');
    const base = blocks([baseFile], 'resource').find((b) => b.labels[0] === 'aws_cognito_user_pool' && b.labels[1] === 'naleko_dev')!;
    const poolRest = (body: string) => squash(without(body, 'lambda_config'));
    expect(poolRest(pool.body), 'the pool changes only in lambda_config (no schema, policy or name change; in place)').toBe(poolRest(base.body));
    expect(pool.body, 'prevent_destroy stays').toMatch(/prevent_destroy\s*=\s*true/);
    const moved = [...blocks(all(), 'moved'), ...blocks(all(), 'removed')].map((b) => squash(b.raw));
    expect(moved.filter((m) => m.includes('aws_cognito_user_pool.naleko_dev')), 'no moved or removed block for the pool').toEqual([]);

    const configs = nested(pool.body, 'lambda_config');
    expect(configs, 'one lambda_config').toHaveLength(1);
    const config = inside(configs[0]!);
    const pre = nested(config, 'pre_token_generation_config');
    expect(pre, 'lambda_config has one pre_token_generation_config block').toHaveLength(1);
    const p = attributes(inside(pre[0]!));
    expect(p.get('lambda_arn'), 'it runs tenantPreToken').toBe(`${fnRef}.arn`);
    expect(p.get('lambda_version'), 'version 2 (ID and access token)').toBe('"V2_0"');
    const top = attributes(without(without(config, 'pre_token_generation_config'), 'custom_email_sender'));
    expect(top.get('post_authentication'), 'post_authentication stays').toBe('aws_lambda_function.cognito_post_auth.arn');
    expect(top.has('pre_token_generation'), 'no old-style pre_token_generation attribute').toBe(false);
    // Every trigger already on the pool (ONB-24's post_confirmation, kms_key_id and custom_email_sender) stays as it is.
    const baseConfig = inside(nested(base.body, 'lambda_config')[0]!);
    const baseTop = attributes(without(baseConfig, 'custom_email_sender'));
    for (const [k, v] of baseTop) expect(top.get(k), `lambda_config keeps ${k}`).toBe(v);
    expect(nested(config, 'custom_email_sender').map((b) => squash(b)), 'lambda_config keeps custom_email_sender unchanged')
      .toEqual(nested(baseConfig, 'custom_email_sender').map((b) => squash(b)));

    // Both web clients (dev's web and prod's web_prod, BE-17.1) are unchanged.
    for (const name of ['web', 'web_prod']) {
      const c = resources('aws_cognito_user_pool_client').filter((b) => b.labels[1] === name);
      const baseC = blocks([baseFile], 'resource').find((b) => b.labels[0] === 'aws_cognito_user_pool_client' && b.labels[1] === name)!;
      expect(c, `aws_cognito_user_pool_client.${name} is still there`).toHaveLength(1);
      expect(squash(c[0]!.body), `the ${name} client is unchanged`).toBe(squash(baseC.body));
    }
    const client = resources('aws_cognito_user_pool_client').filter((b) => b.labels[1] === 'web');
    for (const k of ['write_attributes', 'read_attributes']) {
      expect(attributes(client[0]!.body).get(k) ?? '', `the dev web client's ${k} hold no custom attribute (the company is never one)`).not.toMatch(/custom:/);
    }

    // Cognito may call it, only from this pool.
    const perms = resources('aws_lambda_permission').filter((b) => (attributes(b.body).get('function_name') ?? '').startsWith(fnRef + '.'));
    expect(perms, 'one aws_lambda_permission for tenantPreToken').toHaveLength(1);
    const perm = attributes(perms[0]!.body);
    expect(perm.get('principal'), 'invoked by Cognito').toBe('"cognito-idp.amazonaws.com"');
    expect(perm.get('action')).toBe('"lambda:InvokeFunction"');
    expect(perm.get('source_arn'), 'only by this pool').toBe('aws_cognito_user_pool.naleko_dev.arn');

    // Its settings.
    const settings = settingsOf(fn);
    const tRef = tenantsRef();
    expect(settings.get('LEGACY_TENANT_ID'), 'LEGACY_TENANT_ID = var.founding_tenant_id').toBe('var.founding_tenant_id');
    expect([...settings.values()].filter((v) => v === `${tRef}.name` || v === `${tRef}.id`).length, 'a setting names the tenants table').toBe(1);
    expect(stripComments(fn.body), 'no AI setting').not.toMatch(/bedrock|anthropic|openai|MODEL/i);

    // Its role: logs, X-Ray and Query on the tenants table. Nothing else.
    const role = roleOf(fn);
    const actions = expectOnly(role, 'tenantPreToken role', (a, res) => {
      const c = common('tenantPreToken', a, res);
      if (c !== undefined) return c;
      if (a === 'dynamodb:Query') return res.length > 0 && res.every((r) => r === `${tRef}.arn` || /:table\/naleko-people-\$\{var\.environment\}-tenants$/.test(r)) ? null : 'Query only on the tenants table itself';
      return 'not logs, X-Ray or Query on the tenants table';
    });
    expect(actions, 'the role can Query the tenants table').toContain('dynamodb:Query');
    expect(actions.filter((a) => a.startsWith('kms:')), 'and holds no KMS right (the key policy gives Decrypt through DynamoDB)').toEqual([]);
    const kms = attributes(blocks(all(), 'module').find((b) => b.labels[0] === 'kms_pii')!.body);
    expect(kms.get('dynamodb_read_role_arns') ?? '', 'the role is in kms_pii dynamodb_read_role_arns').toContain(`aws_iam_role.${role}.arn`);
    expect(kms.get('allowed_role_arns') ?? '', 'and not in allowed_role_arns').not.toContain(`aws_iam_role.${role}.`);

    // agentAuthorizer: its role unchanged, its new setting from the first company.
    const authFn = lambdaNamed('agentAuthorizer');
    const authSettings = settingsOf(authFn);
    expect(authSettings.get('AGENT_TENANT_ID'), 'agentAuthorizer: AGENT_TENANT_ID = var.founding_tenant_id').toBe('var.founding_tenant_id');
    expect(authSettings.get('AGENT_API_KEY_SECRET_NAME'), 'and keeps its key setting').toBe('aws_secretsmanager_secret.agent_api_key.name');
    const iamBase = join(HERE, 'iam.agent-authorizer.71fe5b8.tf.txt');
    for (const type of ['aws_iam_role', 'aws_iam_role_policy']) {
      const was = blocks([iamBase], 'resource').find((b) => b.labels[0] === type && b.labels[1] === 'agent_api_authorizer')!;
      const now = resources(type).filter((b) => b.labels[1] === 'agent_api_authorizer');
      expect(now.map((b) => squash(b.body)), `${type}.agent_api_authorizer is unchanged`).toEqual([squash(was.body)]);
    }
    expect(roleOf(authFn), 'agentAuthorizer keeps its role').toBe('agent_api_authorizer');
    const authAttached = resources('aws_iam_role_policy').filter((b) => /^aws_iam_role\.agent_api_authorizer\.(name|id)$/.test(attributes(b.body).get('role') ?? ''));
    expect(authAttached.map((b) => b.labels[1]), 'agentAuthorizer gets no new policy').toEqual(['agent_api_authorizer']);
    expect(resources('aws_iam_role_policy_attachment').filter((b) => (attributes(b.body).get('role') ?? '').startsWith('aws_iam_role.agent_api_authorizer.')), 'nor a managed one').toEqual([]);

    // Build, deploy, alarms, log groups and dashboards.
    const dir = join(LAMBDA, 'tenantPreToken');
    expect(existsSync(join(dir, 'index.mjs')), 'lambda/tenantPreToken/index.mjs exists (build-lambdas.py builds and deploy-lambdas.sh deploys it)').toBe(true);
    expect(existsSync(join(dir, 'package.json')), 'lambda/tenantPreToken has package.json').toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    for (const file of sourceFiles(dir)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"./][^'"]*)['"]/g)) {
        const name = m[1]!.startsWith('@') ? m[1]!.split('/').slice(0, 2).join('/') : m[1]!.split('/')[0]!;
        if (name.startsWith('node:') || name.startsWith('@aws-sdk/')) continue;
        expect(Object.keys(pkg.dependencies ?? {}), `lambda/tenantPreToken: ${name} is in package.json dependencies, so the build bundles it`).toContain(name);
      }
    }
    for (const file of ['alarms.tf', 'dashboards.tf']) {
      const mod = blocks([join(INFRA, file)], 'module')[0]!;
      expect(attributes(mod.body).get('lambda_names') ?? '', `${file} lambda_names lists tenantPreToken (an alarm on its errors)`).toContain('"tenantPreToken"');
    }
    const cw = stripComments(readFileSync(join(INFRA, 'cloudwatch.tf'), 'utf8'));
    const groups = /(?:^|\s)lambda_log_groups\s*=\s*toset\(\[([\s\S]*?)\]\)/.exec(cw);
    expect(groups?.[1] ?? '', 'cloudwatch.tf lambda_log_groups lists /aws/lambda/tenantPreToken').toContain('"/aws/lambda/tenantPreToken"');

    // Nothing new calls AI.
    for (const file of [...sourceFiles(dir), join(LAMBDA, 'shared', 'tenant.mjs')]) {
      expect(stripJs(readFileSync(file, 'utf8')), `${file.slice(REPO.length + 1)}: no AI`).not.toMatch(/bedrock|anthropic|openai|guardAi/i);
    }
    expect(stripComments(readFileSync(join(INFRA, 'tenancy.tf'), 'utf8')), 'infra/tenancy.tf: no AI').not.toMatch(/bedrock|anthropic|openai/i);
  });

  test('AC-8 A real sign-in carries the first company @pepla-dev', async ({ page, hr, employee }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers the trigger in AC-2.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    const { api, clientId, region } = devEnv();
    const founding = tfvar(join(INFRA, 'env', 'dev.tfvars'), 'founding_tenant_id');
    expect(founding, 'infra/env/dev.tfvars sets founding_tenant_id').toMatch(IS_ID);

    // USER_PASSWORD_AUTH straight at Cognito: no browser session is kept, so the second sign-in starts clean.
    const signIn = async (login: { email: string; password: string }) => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: login.email, PASSWORD: login.password } }),
      });
      expect(r.status(), `${login.email.replace(/@.*/, '@…')} signs in at Cognito`).toBe(200);
      const body = (await r.json()) as { AuthenticationResult?: { IdToken?: string; AccessToken?: string }; ChallengeName?: string };
      expect(body.ChallengeName, 'with no challenge').toBeUndefined();
      return { id: body.AuthenticationResult?.IdToken ?? '', access: body.AuthenticationResult?.AccessToken ?? '' };
    };

    const hrTokens = await signIn(hr);
    const hrId = claimsOf(hrTokens.id);
    expect(hrId['tenant_id'], 'the HR login\'s ID token carries tenant_id = the dev first company').toBe(founding);
    expect(claimsOf(hrTokens.access)['tenant_id'], 'and so does its access token').toBe(founding);
    expect(groupsOf(hrId), 'HR keeps hr_staff in cognito:groups').toContain('hr_staff');

    const empTokens = await signIn(employee);
    const empId = claimsOf(empTokens.id);
    expect(empId['tenant_id'], 'the employee login\'s ID token carries tenant_id = the dev first company').toBe(founding);
    expect(claimsOf(empTokens.access)['tenant_id'], 'and so does its access token').toBe(founding);
    expect(groupsOf(empId), 'the employee keeps employee in cognito:groups').toContain('employee');
    expect(groupsOf(empId), 'and is not HR').not.toContain('hr_staff');

    const list = await page.request.get(`${api}/v1/employees?limit=1`, { headers: { Authorization: `Bearer ${hrTokens.id}` } });
    expect(list.status(), 'GET /v1/employees as HR still answers 200').toBe(200);
  });
});
