import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { devEnv } from './support/ten-02/dev';
import { REPO, SCRIPT, drop, hasId, planter, plantRoot, readSpec, runScript, type Op, type Result } from './support/ten-04/files';
import { handlerSource, terraformRoutes, type ApiName, type TfRoute } from './support/ten-04/tf';
import { ROWS, type Kind, type Row } from './support/ten-04/rows';
import { LOGIN_ENV, SELF_CHANGING, firstDifference, walk, type LoginName, type OpInfo, type Req, type Res, type World } from './support/ten-04/walk';
import { makeModel, type Leak } from './support/ten-04/model';

/**
 * TEN-04 · Every route described, and a company B walk that proves nothing of company A leaks (Jira NH-196, epic NH-192).
 * Red. One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/TEN-04.md (16 Nov 2026). Notes: TEN-04-tests-for-review.md.
 *
 * Nothing here calls AWS or any AI in the no-backend run. The script test (AC-1 to AC-4) runs the builder's
 * scripts/ci/routes-match-openapi.mjs against planted copies of Terraform, api/openapi.yaml and the Lambda sources.
 * AC-5 and AC-6 read the file. AC-7 runs the walk (support/ten-04/walk.ts) against a model of the API with each planted
 * leak, then on pepla-dev against the real stack.
 *
 * Pinned by the verifier (reasons in the notes):
 *  - P1 The script: `node scripts/ci/routes-match-openapi.mjs [--root <dir>]`. It reads <root>/infra and <root>/talent-flow-infra
 *    (.tf), <root>/api/openapi.yaml, <root>/lambda/shared/tenant-retrofit.json and <root>/lambda/<name>/. Exit 0 = passed.
 *    Every problem line names the route key as Terraform has it ("GET /v1/me") or, for a Lambda, its folder name.
 *  - P2 A route's handler is found through its integration: integration_uri aws_lambda_function.<L>.invoke_arn (or data.),
 *    function_name a string or local.<name>, folder lambda/<function_name>/ (support/ten-04/tf.ts reads it the same way).
 *  - P3 A route key in the file is the Terraform key, parameter names included.
 *  - P4 Vocabulary. security: [{CognitoJWT: []}] for a JWT route, [{AgentKey: []}] for a CUSTOM (agent key) route, [] for a route with
 *    no authorization. x-tenant: token (JWT), agent (agent key), stored-record or none (public). x-roles: a list of the TEN-05 role
 *    and tick names that may call it (any one of them); [] = any signed-in person, the agent key, or a public route.
 *  - P5 Servers: an operation names its API with servers (on the operation or its path); every API uses one address, the four differ.
 *  - P6 The public routes found in Terraform today are seven, not the spec's six: GET /v1/employees/lookup (lookupEmployeeEmail) is the
 *    seventh. It stays, as TEN-08 says, with x-tenant stored-record. The list in the script may be seven (or six, if that route is retired).
 *  - P7 A new route added after this lock gets its walk row in scripts/tenancy/ten-04-rows.json (same shape as support/ten-04/rows.ts),
 *    so a later card never re-locks this file.
 * Locked once accepted: see cards/ten-04.md.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it reads files and runs a script against copies.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const FROZEN = Object.keys(ROWS);
const SEVEN = ['GET /agent/agent-tools.json', 'GET /docs', 'GET /openapi.yaml', 'GET /v1/employees/lookup', 'POST /v1/invites/lookup', 'POST /v1/invites/redeem', 'POST /v1/scoring/{token}/votes'];
const SIX_OF_THE_SPEC = SEVEN.filter((k) => k !== 'GET /v1/employees/lookup');
const VOCAB_ROLES = ['admin', 'hr_staff', 'manager', 'employee', 'guest', 'perm-recruitment', 'perm-it', 'perm-approve-offers'];
const SECURITY: Record<string, unknown> = { jwt: [{ CognitoJWT: [] }], 'agent-key': [{ AgentKey: [] }], none: [] };
const TENANT_OF: Record<string, string[]> = { jwt: ['token'], 'agent-key': ['agent'], none: ['stored-record', 'none'] };
const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'ten-04', 'dev-ids.json'), 'utf8')) as Record<string, string> & { names: string[] };
const canon = (n: unknown): unknown => (Array.isArray(n) ? n.map(canon) : n && typeof n === 'object' ? Object.fromEntries(Object.keys(n).sort().map((k) => [k, canon((n as Record<string, unknown>)[k])])) : n);
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const routes = (): TfRoute[] => terraformRoutes(REPO);
const extraRows = (): Record<string, Row> => {
  const f = join(REPO, 'scripts', 'tenancy', 'ten-04-rows.json');
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Record<string, Row>) : {};
};
const failsNaming = (r: Result, ...names: (string | RegExp)[]) => {
  expect.soft(r.code, `the script fails (exit code ${r.code}; output: ${r.out.slice(0, 300)})`).not.toBe(0);
  expect.soft(r.code, 'the script ran (it exists)').not.toBeNull();
  for (const n of names) expect.soft(r.out, `the output names ${n}`).toMatch(n instanceof RegExp ? n : new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
};
/** Runs the script on a planted copy and removes the copy. */
const planted = (mutate: (root: string) => void): Result => {
  const root = plantRoot();
  try { mutate(root); return runScript(root); } finally { drop(root); }
};
const opsOf = (spec: ReturnType<typeof readSpec>, tf: TfRoute[]): OpInfo[] => {
  const api = new Map(tf.map((r) => [r.key, r.api]));
  return spec.ops.map((o) => ({ key: o.key, method: o.method, path: o.path, tenant: o.tenant, roles: o.roles, api: (api.get(o.key) ?? 'employees') as ApiName }));
};

// ---------------------------------------------------------------- AC-1 to AC-4: the script and the file

test.describe('TEN-04 · every route is described, and a company B walk proves nothing leaks', () => {
  test('Control: Terraform is read the way the script will read it', async ({}, testInfo) => {
    once(testInfo.project.name);
    // Not an acceptance criterion: it keeps the planted tests honest. Every route resolves to a Lambda folder, so a planted
    // fault fails for its own reason and a missing folder is not the reason.
    const tf = routes();
    expect(tf.length, 'the four APIs have routes').toBeGreaterThanOrEqual(82);
    expect(new Set(tf.map((r) => r.key)).size, 'no route key twice').toBe(tf.length);
    for (const r of tf) {
      expect.soft(r.handler, `${r.key}: its integration names a Lambda`).toBeTruthy();
      expect.soft(r.handler && handlerSource(REPO, r.handler) !== null, `${r.key}: lambda/${r.handler}/ exists`).toBe(true);
    }
    for (const k of FROZEN) expect.soft(tf.some((r) => r.key === k), `${k} is in Terraform`).toBe(true);
    expect(tf.filter((r) => r.api === 'agent').length, 'the agent API has routes').toBeGreaterThan(10);
  });

  test('AC-1 Every route is described and CI keeps the file and Terraform in step', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect(existsSync(SCRIPT), 'scripts/ci/routes-match-openapi.mjs exists').toBe(true);
    // The file against Terraform, read here without the script.
    const tf = routes();
    const spec = readSpec();
    const want = new Set(tf.map((r) => r.key));
    const have = new Set(spec.ops.map((o) => o.key));
    expect.soft([...want].filter((k) => !have.has(k)), 'every Terraform route has an operation in api/openapi.yaml').toEqual([]);
    expect.soft([...have].filter((k) => !want.has(k)), 'every operation has a Terraform route').toEqual([]);
    // The script says so too.
    const real = runScript(REPO);
    expect.soft(real.code, `the script passes on the repo as it is (output: ${real.out.slice(0, 400)})`).toBe(0);
    // CI runs it in the openapi job.
    const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
    const job = /^  openapi:\n([\s\S]*?)(?=^  [a-z][a-z0-9_-]*:\n|$(?![\s\S]))/m.exec(ci)?.[1] ?? '';
    expect.soft(job, 'the openapi job of ci.yml runs scripts/ci/routes-match-openapi.mjs').toContain('scripts/ci/routes-match-openapi.mjs');
    expect.soft(job, 'the openapi job still lints the file with Redocly').toContain('@redocly/cli');
  });

  test('AC-1 A deleted operation fails the script, naming the route', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const key of ['GET /v1/employees', 'GET /v1/me', 'GET /v1/verifications/{id}', 'GET /agent/v1/audit-log', 'GET /v1/candidates/{id}', 'POST /v1/invites/lookup', 'PUT /v1/config/{id}']) {
      failsNaming(planted((root) => planter.deleteOp(root, key)), key);
    }
  });

  test('AC-1 A Terraform route with no operation fails the script, naming the route', async ({}, testInfo) => {
    once(testInfo.project.name);
    const jwt = '  authorization_type = "JWT"\n  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id';
    failsNaming(planted((root) => planter.addRoute(root, 'infra', 'GET /v1/ten04-planted', 'get_employees', jwt, 'aws_apigatewayv2_api.employees_api.id')), 'GET /v1/ten04-planted');
    const tfJwt = '  authorization_type = "JWT"\n  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id';
    failsNaming(planted((root) => planter.addRoute(root, 'talent-flow-infra', 'POST /v1/ten04-planted/{id}', 'get_candidates', tfJwt, 'aws_apigatewayv2_api.talent_flow_api.id')), 'POST /v1/ten04-planted/{id}');
  });

  test('AC-1 An operation with no Terraform route fails the script, naming the operation', async ({}, testInfo) => {
    once(testInfo.project.name);
    failsNaming(planted((root) => planter.addOp(root, 'GET /v1/ten04-nowhere', { security: [{ CognitoJWT: [] }], 'x-tenant': 'token', 'x-roles': [] })), 'GET /v1/ten04-nowhere');
  });

  test('AC-2 Every operation has security, x-tenant and x-roles, with the right words', async ({}, testInfo) => {
    once(testInfo.project.name);
    const tf = routes();
    const spec = readSpec();
    expect.soft(spec.schemes, 'the file has the AgentKey scheme next to CognitoJWT').toEqual(expect.arrayContaining(['CognitoJWT', 'AgentKey']));
    for (const r of tf) {
      const o = spec.byKey.get(r.key);
      if (!o) continue; // AC-1 says so
      expect.soft(o.security, `${r.key}: security is ${JSON.stringify(SECURITY[r.guard])} for a ${r.guard} route`).toEqual(SECURITY[r.guard]);
      expect.soft(TENANT_OF[r.guard], `${r.key}: x-tenant is ${JSON.stringify(o.tenant)}`).toContain(o.tenant);
      expect.soft(Array.isArray(o.roles) && (o.roles as unknown[]).every((x) => VOCAB_ROLES.includes(x as string)), `${r.key}: x-roles is a list of the TEN-05 names (got ${JSON.stringify(o.roles)})`).toBe(true);
      if (r.guard !== 'jwt') expect.soft(o.roles, `${r.key}: x-roles is [] (no sign-in role)`).toEqual([]);
      for (const code of r.guard === 'none' ? [] : ['403']) {
        expect.soft(JSON.stringify(o.responses?.[code] ?? null), `${r.key}: documents a ${code} answer {"error":"Forbidden"}`).toContain('Forbidden');
      }
      if (r.guard !== 'none' && hasId(r.path)) expect.soft(JSON.stringify(o.responses?.['404'] ?? null), `${r.key}: documents a 404 answer {"error":"Not found"}`).toContain('Not found');
    }
    // Docs say they are for anyone.
    for (const k of ['GET /docs', 'GET /openapi.yaml', 'GET /agent/agent-tools.json']) expect.soft(spec.byKey.get(k)?.tenant, `${k}: x-tenant none`).toBe('none');
    // Each API has one address and the four differ (P5).
    const addr = new Map<ApiName, Set<string>>();
    for (const r of tf) {
      const o = spec.byKey.get(r.key);
      if (!o) continue;
      const s = (o.servers as { url: string }[] | undefined)?.map((x) => x.url) ?? [];
      expect.soft(s.length, `${r.key}: names its API with servers (${s.length})`).toBe(1);
      (addr.get(r.api) ?? addr.set(r.api, new Set()).get(r.api)!).add(s[0] ?? '');
    }
    for (const [api, set] of addr) expect.soft(set.size, `every ${api} operation uses one address`).toBe(1);
    expect.soft(new Set([...addr.values()].map((s) => [...s][0])).size, 'the four APIs have four different addresses').toBe(4);
  });

  test('AC-2 A missing or wrong security, x-tenant or x-roles fails the script, naming the route', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const key of ['GET /v1/employees', 'GET /v1/me', 'GET /v1/candidates/{id}', 'GET /agent/v1/audit-log', 'POST /v1/invites/redeem']) {
      for (const name of ['security', 'x-tenant', 'x-roles']) failsNaming(planted((root) => planter.dropKey(root, key, name)), key);
    }
    failsNaming(planted((root) => planter.setKey(root, 'GET /v1/employees', 'x-tenant', 'everyone')), 'GET /v1/employees');
    failsNaming(planted((root) => planter.setKey(root, 'GET /v1/employees', 'x-roles', ['superuser'])), 'GET /v1/employees');
    failsNaming(planted((root) => planter.setKey(root, 'GET /v1/employees', 'x-roles', 'hr_staff')), 'GET /v1/employees');
    // The file must agree with Terraform about how a route is guarded.
    failsNaming(planted((root) => planter.setKey(root, 'GET /v1/employees', 'security', [])), 'GET /v1/employees');
    failsNaming(planted((root) => planter.setKey(root, 'POST /v1/invites/lookup', 'security', [{ CognitoJWT: [] }])), 'POST /v1/invites/lookup');
    failsNaming(planted((root) => planter.setKey(root, 'GET /agent/v1/audit-log', 'security', [{ CognitoJWT: [] }])), 'GET /agent/v1/audit-log');
    failsNaming(planted((root) => planter.setKey(root, 'GET /v1/employees', 'x-tenant', 'agent')), 'GET /v1/employees');
  });

  test('AC-3 Only the public routes of the list are public', async ({}, testInfo) => {
    once(testInfo.project.name);
    // Judged on the routes of this lock (FROZEN): a route added later is the script's list to judge, a change a reviewer sees (spec rule 2).
    const tf = routes().filter((r) => FROZEN.includes(r.key));
    const publicNow = tf.filter((r) => r.guard === 'none').map((r) => r.key).sort();
    for (const k of SIX_OF_THE_SPEC) expect.soft(publicNow, `${k} is public in Terraform`).toContain(k);
    expect.soft(publicNow.filter((k) => !SEVEN.includes(k)), 'no other route of this lock is public').toEqual([]);
    const spec = readSpec();
    for (const k of publicNow) expect.soft(spec.byKey.get(k)?.security, `${k}: security []`).toEqual([]);
    for (const o of spec.ops) if (FROZEN.includes(o.key) && same(o.security, [])) expect.soft(publicNow, `${o.key} has security [] so it is public in Terraform`).toContain(o.key);
  });

  test('AC-3 A public route that is not on the list fails the script', async ({}, testInfo) => {
    once(testInfo.project.name);
    const addPublic = (root: string, key: string, auth: string) => {
      planter.addRoute(root, 'infra', key, 'get_employees', auth, 'aws_apigatewayv2_api.employees_api.id');
      planter.addOp(root, key, { security: [], 'x-tenant': 'stored-record', 'x-roles': [], servers: [{ url: 'https://ndksa9ec0k.execute-api.af-south-1.amazonaws.com' }] });
    };
    failsNaming(planted((root) => addPublic(root, 'GET /v1/ten04-none', '  authorization_type = "NONE"')), 'GET /v1/ten04-none');
    failsNaming(planted((root) => addPublic(root, 'GET /v1/ten04-bare', '')), 'GET /v1/ten04-bare');
    // A listed route that moves is no longer listed.
    failsNaming(planted((root) => planter.renamePath(root, '/v1/invites/lookup', '/v1/invites/ten04-lookup')), '/v1/invites/ten04-lookup');
    failsNaming(planted((root) => planter.renamePath(root, '/docs', '/ten04-docs')), '/ten04-docs');
  });

  test('AC-4 Every token route uses the company helper, and the retrofit list is empty', async ({}, testInfo) => {
    once(testInfo.project.name);
    const retrofit = JSON.parse(readFileSync(join(REPO, 'lambda', 'shared', 'tenant-retrofit.json'), 'utf8')) as string[];
    expect.soft(retrofit, 'lambda/shared/tenant-retrofit.json is empty').toEqual([]);
    const spec = readSpec();
    for (const r of routes()) {
      if (spec.byKey.get(r.key)?.tenant !== 'token') continue;
      const src = r.handler ? handlerSource(REPO, r.handler) : null;
      expect.soft(src && /\brequireTenant\s*\(/.test(src), `${r.key}: lambda/${r.handler} calls requireTenant`).toBe(true);
    }
    expect.soft(spec.ops.filter((o) => o.tenant === 'token').length, 'the file has token routes').toBeGreaterThan(40);
  });

  test('AC-4 A token route whose handler skips requireTenant fails the script', async ({}, testInfo) => {
    once(testInfo.project.name);
    failsNaming(planted((root) => planter.stripRequireTenant(root, 'getEmployees')), /GET \/v1\/employees|getEmployees/);
    failsNaming(planted((root) => planter.stripRequireTenant(root, 'getCandidates')), /GET \/v1\/candidates|getCandidates/);
    failsNaming(planted((root) => planter.stripRequireTenant(root, 'getInvite')), /GET \/v1\/employees\/\{id\}\/invite|getInvite/);
    failsNaming(planted((root) => planter.commentOnlyRequireTenant(root, 'getHrPartners')), /GET \/v1\/hr-partners|getHrPartners/);
    failsNaming(planted((root) => planter.retrofit(root, ['getHrPartners'])), 'getHrPartners');
    // Only token routes are held to it: a handler behind agent-key routes alone is not (spec rule 2).
    const r = planted((root) => planter.stripRequireTenant(root, 'getBatchRiskReport'));
    expect.soft(r.code, `a handler behind an agent-key route alone may skip requireTenant (output: ${r.out.slice(0, 300)})`).toBe(0);
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 The earlier operations are unchanged and the file is still valid', async ({}, testInfo) => {
    once(testInfo.project.name);
    const baseline = JSON.parse(readFileSync(join(__dirname, 'support', 'ten-04', 'openapi.baseline.json'), 'utf8')) as Record<string, unknown>;
    const raw = JSON.parse(execFileSync('python3', ['-I', join(__dirname, 'support', 'ten-04', 'openapi_json.py'), join(REPO, 'api', 'openapi.yaml'), 'raw'], { encoding: 'utf8', maxBuffer: 64 << 20 })) as { paths: Record<string, Record<string, unknown>> };
    const strip = (n: unknown): unknown => (Array.isArray(n) ? n.map(strip) : n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).filter(([k]) => k !== 'example' && k !== 'examples').map(([k, v]) => [k, strip(v)])) : n);
    /** Everything the baseline says is still said: same keys, same values; new keys and new response codes are allowed. */
    const contains = (base: unknown, now: unknown, at: string, out: string[]) => {
      if (base && typeof base === 'object' && !Array.isArray(base)) {
        if (!now || typeof now !== 'object' || Array.isArray(now)) { out.push(at); return; }
        for (const [k, v] of Object.entries(base)) contains(v, (now as Record<string, unknown>)[k], `${at}.${k}`, out);
      } else if (!same(base, now)) out.push(at);
    };
    const changed: string[] = [];
    for (const [key, op] of Object.entries(baseline)) {
      const [m, p] = key.split(' ') as [string, string];
      contains(op, strip(raw.paths[p]?.[m.toLowerCase()]), key, changed);
    }
    // ONB-14 (re-lock ten-04.N): the GET answer of one verification no longer holds the two full numbers, and its description says so.
    const onb14 = new Set(['GET /v1/verifications/{id}.description', 'GET /v1/verifications/{id}.responses.200.content.application/json.schema.properties.verification.properties.extracted_data.properties.id_number', 'GET /v1/verifications/{id}.responses.200.content.application/json.schema.properties.verification.properties.extracted_data.properties.account_number']);
    expect.soft(changed.filter((c) => !onb14.has(c)), 'every earlier operation keeps its paths, fields and wording (add-only)').toEqual([]);
    expect.soft(Object.keys(baseline).length, 'the baseline holds the 23 operations on develop 6122df1').toBe(23);
  });

  test('AC-5 Redocly lint passes', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    let out = '';
    let code = 0;
    try { out = execFileSync('npx', ['--yes', '@redocly/cli', 'lint', join(REPO, 'api', 'openapi.yaml')], { encoding: 'utf8', timeout: 200_000, cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e: any) { code = e.status ?? 1; out = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
    expect(code, `npx @redocly/cli lint api/openapi.yaml (the command CI runs) exits 0:\n${out.slice(-600)}`).toBe(0);
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 No personal data in the file', async ({}, testInfo) => {
    once(testInfo.project.name);
    const text = readFileSync(join(REPO, 'api', 'openapi.yaml'), 'utf8');
    const emails = [...text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]);
    expect.soft(emails.filter((e) => !/@example\.com$/.test(e)), 'every email is at @example.com').toEqual([]);
    expect.soft([...text.matchAll(/(?<![0-9A-Za-z])\d{12}(?![0-9A-Za-z])/g)].map((m) => m[0]), 'no 12-digit AWS account id').toEqual([]);
    expect.soft([...text.matchAll(/ten_[0-9a-z]+/g)].map((m) => m[0]).filter((t) => t !== `ten_${'0'.repeat(26)}`), 'every ten_ id is made of zeros').toEqual([]);
    // "No example holds a real name" (spec rule 1): the names the repo uses for people, today's examples among them.
    const names = /\b(Dlamini|Sarah|Thabo|Mokoena|Naledi|Lerato|Pieter|Tendai|Chipo|Ayesha|Kagiso|Mwila|Nkosi|Thandi|Sipho|Zanele|Lindo|Nandi|Khumalo|Ndlovu)\b/g;
    expect.soft([...text.matchAll(names)].map((m) => m[0]), 'no example uses a real name (John Doe and Jane Smith only)').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-7 (no backend): the walk itself

  test('AC-7 Every route has a walk row, and a route without one fails the walk', async ({}, testInfo) => {
    once(testInfo.project.name);
    const extra = extraRows();
    const tf = routes();
    expect.soft(tf.filter((r) => !ROWS[r.key] && !extra[r.key]).map((r) => r.key), 'every Terraform route has a walk row (support/ten-04/rows.ts, or scripts/tenancy/ten-04-rows.json for a later route)').toEqual([]);
    const spec = readSpec();
    expect.soft(spec.ops.filter((o) => !ROWS[o.key] && !extra[o.key]).map((o) => o.key), 'every operation in the file has a walk row').toEqual([]);
    // A route of the file with no row fails the walk, naming it.
    const ops = opsOf(spec, tf).filter((o) => ROWS[o.key]);
    const world = modelWorld();
    ops.push({ key: 'GET /v1/ten04-without-a-row', method: 'GET', path: '/v1/ten04-without-a-row', tenant: 'token', roles: [], api: 'employees' });
    const { send } = makeModel(ops, world, 'none');
    const res = await walk(ops, send, world);
    expect.soft(res.problems.filter((p) => p.includes('GET /v1/ten04-without-a-row')), 'the walk names a route that has no row').toEqual(expect.arrayContaining([expect.stringContaining('no walk row')]));
  });

  test('AC-7 The walk passes an API that keeps the companies apart', async ({}, testInfo) => {
    once(testInfo.project.name);
    const spec = readSpec();
    const ops = opsOf(spec, routes()).filter((o) => ROWS[o.key]);
    expect.soft(ops.length, 'the file describes the routes the walk has rows for').toBe(FROZEN.length);
    const world = modelWorld();
    const { send } = makeModel(ops, world, 'none');
    const res = await walk(ops, send, world);
    expect.soft(res.problems, `the walk finds nothing wrong with a correct API (${res.sent} requests)`).toEqual([]);
    expect.soft(res.sent, 'the walk sent requests for the routes').toBeGreaterThan(150);
  });

  test('AC-7 The walk catches each way company B could reach company A', async ({}, testInfo) => {
    once(testInfo.project.name);
    const spec = readSpec();
    const ops = opsOf(spec, routes()).filter((o) => ROWS[o.key]);
    const cases: [Leak, RegExp][] = [
      ['id-200', /answered 200, not 404/],
      ['id-echo', /holds .* of company A/],
      ['list-all', /list holds .* of company A/],
      ['list-query', /naming company A in the query/],
      ['write-through', /company A's row .* is not as it was/],
      ['create-from-body', /naming company A, company A's .* is not as it was/],
      ['agent-all', /agent key's answer holds .* of company B/],
      ['role-open', /so it must answer 403/],
      ['stored-leak', /made-up token/],
      ['forbidden-body', /403 body is not/],
      ['notfound-body', /404 body is not/],
    ];
    for (const [leak, re] of cases) {
      const world = modelWorld();
      const { send } = makeModel(ops, world, leak);
      const res = await walk(ops, send, world);
      expect.soft(res.problems.some((p) => re.test(p)), `the walk catches "${leak}" (${res.problems.length} problems; first: ${res.problems[0] ?? 'none'})`).toBe(true);
    }
  });

  test('AC-7 A change the platform makes by itself is not counted, and a real change prints what changed', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect.soft(SELF_CHANGING, 'exactly the four keys the SLA monitor and the orchestrator write on company A\'s own candidates').toEqual(['slaStatus', 'slaBreachedAt', 'slaBreachedStage', 'configVersion']);
    const shown = firstDifference('{"a":1,"data":{"x":1}}', '{"a":1,"data":{"x":2}}');
    expect.soft(shown, 'the line says what it was').toContain('"x":1');
    expect.soft(shown, 'the line says what it is now').toContain('"x":2');
    // The walk on a small API of its own: company A's candidate list is read before and after company B's create.
    const ops = opsOf(readSpec(), routes()).filter((o) => o.key === 'POST /v1/candidates' || o.key === 'GET /v1/candidates');
    const walkWith = async (after: Record<string, unknown>) => {
      const world = modelWorld();
      let aReads = 0;
      const send = async (req: Req): Promise<Res> => {
        if (req.method === 'POST') return { status: 201, body: { candidateId: 'CAND-ten04-b' } };
        const isA = ['hrA', 'tfA', 'itA', 'empA'].includes(req.login);
        const row = { id: 'CAND-ten04-a', firstName: 'Kept', slaStatus: 'ON_TRACK', ...(isA && aReads++ > 0 ? after : {}) };
        return { status: 200, body: { candidates: [row], total: 1 } };
      };
      return (await walk(ops, send, world)).problems.filter((p) => /not as it was/.test(p));
    };
    for (const key of SELF_CHANGING) expect.soft(await walkWith({ [key]: 'changed-by-the-platform' }), `only ${key} changes on company A: not counted`).toEqual([]);
    const real = await walkWith({ firstName: 'Changed' });
    expect.soft(real.length, 'another field changes on company A: counted').toBe(1);
    expect.soft(real[0] ?? '', 'the line says what it was').toContain('"firstName":"Kept"');
    expect.soft(real[0] ?? '', 'the line says what it is now').toContain('"firstName":"Changed"');
  });

  test('AC-7 The walk needs the seed and the logins to exist', async ({}, testInfo) => {
    once(testInfo.project.name);
    const seed = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    for (const [kind, id] of Object.entries(ids)) {
      if (kind === 'names' || kind === '_note' || kind === 'employee' || kind === 'document') continue;
      expect.soft(seed, `seed-dev.py writes company A's ${kind} (${id})`).toContain(id);
    }
    for (const persona of ['tf', 'tf-b', 'it-b', 'victim']) expect.soft(seed, `seed-dev.py makes the ${persona} login`).toMatch(new RegExp(`['"]${persona}['"]\\s*:`));
    const logins = readFileSync(join(REPO, 'scripts', 'ci', 'load-e2e-logins.py'), 'utf8');
    for (const prefix of ['E2E_TF', 'E2E_TF_B', 'E2E_IT_B', 'E2E_VICTIM']) expect.soft(logins, `load-e2e-logins.py hands over ${prefix}`).toContain(`"${prefix}"`);
    // B's logins are robots (no AI service is called) and company B's own, and the walk's records carry the cleanup marker.
    expect.soft(seed, 'the new B logins join the e2e-robots group').toContain('ROBOT_GROUP');
    expect.soft(readFileSync(join(__dirname, 'support', 'ten-04', 'rows.ts'), 'utf8'), 'the walk marks what it creates with e2e.run-').toContain('e2e.run-ten04');
    // The routes the walk may call with AI behind them hold the AI guard (robots only).
    for (const fn of ['nalekoAiChat', 'talentFlowAiChat', 'summariseVerification', 'classifyOnboardingRisk']) expect.soft(handlerSource(REPO, fn) ?? '', `${fn} imports the AI guard`).toMatch(/ai-guard/);
  });

  // ---------------------------------------------------------------- AC-7 (pepla-dev): the real walk

  test('AC-7 The company B walk on pepla-dev @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers the walk in the AC-7 tests above.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(600_000); // rule 3: under 10 minutes
    const env = (k: string) => process.env[k] ?? '';
    const { api, docApi, clientId, region } = devEnv();
    const oldEnv = join(REPO, 'hr-portal', 'src', 'environments', 'environment.ts');
    const tfApi = env('E2E_TF_API_URL') || (/talentFlow\s*:\s*\{[^}]*?apiUrl\s*:\s*['"`]([^'"`]+)['"`]/s.exec(existsSync(oldEnv) ? readFileSync(oldEnv, 'utf8') : '')?.[1] ?? '');
    expect(tfApi, 'the TalentFlow API address is set (E2E_TF_API_URL, or hr-portal environment.ts talentFlow.apiUrl)').toMatch(/^https:\/\//);
    expect(env('E2E_AGENT_API_URL'), 'the agent API address is set (E2E_AGENT_API_URL, no path)').toMatch(/^https:\/\//);
    expect(env('E2E_AGENT_KEY'), 'the agent key is set (E2E_AGENT_KEY)').toBeTruthy();
    const base: Record<ApiName, string> = {
      employees: api, documents: docApi, agent: env('E2E_AGENT_API_URL').replace(/\/+$/, ''), talentflow: tfApi.replace(/\/+$/, '').replace(/\/v1$/, ''),
    };
    const tokens = new Map<string, string>();
    const signIn = async (who: LoginName | 'victim') => {
      const email = env(`${LOGIN_ENV[who]}_EMAIL`);
      const password = env(`${LOGIN_ENV[who]}_PASSWORD`);
      expect(email, `the seed made the ${who} login (${LOGIN_ENV[who]}_EMAIL)`).toBeTruthy();
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: email, PASSWORD: password } }),
      });
      expect(r.status(), `${who} signs in at Cognito`).toBe(200);
      const tok = ((await r.json()) as any).AuthenticationResult.IdToken as string;
      tokens.set(who, tok);
      return tok;
    };
    for (const who of ['hrA', 'tfA', 'itA', 'empA', 'hrB', 'tfB', 'itB', 'victim'] as const) await signIn(who);
    const sub = JSON.parse(Buffer.from(tokens.get('victim')!.split('.')[1]!, 'base64url').toString('utf8')).sub as string;
    const tenantA = (JSON.parse(Buffer.from(tokens.get('hrA')!.split('.')[1]!, 'base64url').toString('utf8')) as { tenant_id?: string }).tenant_id ?? '';
    expect(tenantA, 'company A\'s sign-in carries its company (tenant_id)').toMatch(/^ten_[0-9a-z]{26}$/);
    const world: World = {
      ids: { employee: ids['employee']!, document: ids['document']!, candidate: ids['candidate']!, interview: ids['interview']!, tile: ids['tile']!, config: ids['config']!, itTask: ids['itTask']!, bundle: ids['bundle']!, notification: ids['notification']!, action: ids['action']!, department: ids['department']!, user: sub } as Record<Kind, string>,
      tenantA, markers: [...Object.entries(ids).filter(([k]) => k !== 'names' && k !== '_note').map(([, v]) => v as string), ...ids.names, tenantA], bMarkers: ['Companyb', 'zanele.companyb', 'ten04-b-'],
    };
    const send = async (req: Req): Promise<Res> => {
      const qs = new URLSearchParams(req.query).toString();
      const url = `${base[req.api]}${req.path}${qs ? `?${qs}` : ''}`;
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (req.login === 'agent') headers['x-api-key'] = env('E2E_AGENT_KEY');
      else if (req.login !== 'anon') headers['authorization'] = `Bearer ${tokens.get(req.login)!}`;
      // ten-04.10: write routes that take a request key (INT-01 R-22) check it before the record, so every write carries a fresh one; B on A's id must still get 404.
      if (req.method === 'POST' || req.method === 'PATCH') headers['idempotency-key'] = randomUUID();
      const r = await page.request.fetch(url, { method: req.method, headers, data: req.body === undefined ? undefined : JSON.stringify(req.body), failOnStatusCode: false });
      const t = await r.text();
      let body: unknown = t;
      try { body = JSON.parse(t); } catch { /* not JSON: docs, manifest */ }
      return { status: r.status(), body };
    };
    const spec = readSpec();
    const ops = opsOf(spec, routes());
    const extra = extraRows();
    for (const k of Object.keys(extra)) ROWS[k] = extra[k]!;
    const res = await walk(ops, send, world);
    expect(res.problems, `the walk found no way for company B to reach company A (${res.sent} requests, ${ops.length} operations)`).toEqual([]);
    expect(ops.filter((o) => !ROWS[o.key]).map((o) => o.key), 'every operation was walked').toEqual([]);
  });
});

function modelWorld(): World {
  return {
    ids: { employee: ids['employee']!, document: ids['document']!, candidate: ids['candidate']!, interview: ids['interview']!, tile: ids['tile']!, config: ids['config']!, itTask: ids['itTask']!, bundle: ids['bundle']!, notification: ids['notification']!, action: ids['action']!, department: ids['department']!, user: 'sub-ten04-victim-a' } as Record<Kind, string>,
    tenantA: `ten_${'a'.repeat(26)}`,
    markers: [...Object.entries(ids).filter(([k]) => k !== 'names' && k !== '_note').map(([, v]) => v as string), ...ids.names, 'sub-ten04-victim-a', `ten_${'a'.repeat(26)}`],
    bMarkers: ['Zanele', 'zanele.companyb', 'ten04-b-'],
  };
}
void (null as unknown as Op);
