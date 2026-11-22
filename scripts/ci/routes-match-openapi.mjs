#!/usr/bin/env node
// TEN-04: every route of Terraform is described in api/openapi.yaml, and the other way round.
// Per route: security agrees with how Terraform guards it, x-tenant and x-roles are present and in the vocabulary,
// the public routes are only the known seven, and every route that takes its company from the token has a handler
// that calls requireTenant. lambda/shared/tenant-retrofit.json must be empty.
// Run: node scripts/ci/routes-match-openapi.mjs [--root <dir>]   (needs python3 with PyYAML, as on the CI runner)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argRoot = process.argv.indexOf('--root');
const root = argRoot > 0 ? process.argv[argRoot + 1] : join(here, '..', '..');
const PUBLIC = ['GET /agent/agent-tools.json', 'GET /docs', 'GET /openapi.yaml', 'GET /v1/employees/lookup', 'POST /v1/invites/lookup', 'POST /v1/invites/redeem', 'POST /v1/scoring/{token}/votes'];
const ROLES = ['admin', 'hr_staff', 'manager', 'employee', 'guest', 'perm-recruitment', 'perm-it', 'perm-approve-offers'];
const problems = [];
const bad = (m) => problems.push(m);

const tfFiles = (d) => (existsSync(d) ? readdirSync(d).flatMap((e) => { const p = join(d, e); return statSync(p).isDirectory() ? tfFiles(p) : p.endsWith('.tf') ? [p] : []; }) : []);
const text = [...tfFiles(join(root, 'infra')), ...tfFiles(join(root, 'talent-flow-infra'))].map((f) => readFileSync(f, 'utf8').replace(/^\s*(#|\/\/).*$/gm, '')).join('\n');
const blocks = (re) => { const out = []; const r = new RegExp(re.source, 'g'); let m; while ((m = r.exec(text))) { let i = r.lastIndex; let d = 1; while (d && i < text.length) { const c = text[i++]; if (c === '{') d++; else if (c === '}') d--; } out.push([m[1], text.slice(r.lastIndex, i - 1)]); } return out; };
const locals = new Map([...text.matchAll(/^\s*([A-Za-z0-9_]+)\s*=\s*"([^"$]*)"\s*$/gm)].map((m) => [m[1], m[2]]));
const integ = new Map(blocks(/resource\s+"aws_apigatewayv2_integration"\s+"([^"]+)"\s*\{/).map(([n, b]) => { const u = /integration_uri\s*=\s*(data\.)?aws_lambda_function\.(\w+)\.invoke_arn/.exec(b); return [n, u ? [!!u[1], u[2]] : null]; }));
const fnName = ([isData, n]) => { const b = blocks(isData ? /data\s+"aws_lambda_function"\s+"([^"]+)"\s*\{/ : /resource\s+"aws_lambda_function"\s+"([^"]+)"\s*\{/).find(([x]) => x === n)?.[1] ?? ''; const e = /function_name\s*=\s*(.+)/.exec(b)?.[1]?.trim() ?? ''; const lit = /^"([^"$]*)"$/.exec(e); if (lit) return lit[1]; const l = /^local\.(\w+)$/.exec(e); return l ? locals.get(l[1]) ?? null : null; };
const routes = blocks(/resource\s+"aws_apigatewayv2_route"\s+"([^"]+)"\s*\{/).map(([, b]) => {
  const key = /route_key\s*=\s*"([^"]+)"/.exec(b)?.[1];
  const auth = /authorization_type\s*=\s*"([^"]+)"/.exec(b)?.[1];
  const target = /integrations\/\$\{aws_apigatewayv2_integration\.(\w+)\.id\}/.exec(b)?.[1];
  const ref = target ? integ.get(target) : null;
  return { key, guard: auth === 'JWT' ? 'jwt' : auth === 'CUSTOM' ? 'agent' : 'none', fn: ref ? fnName(ref) : null, api: /employees_api/.test(b) ? 'employees' : /document_upload_api/.test(b) ? 'documents' : /agent_api/.test(b) ? 'agent' : 'tf' };
}).filter((r) => r.key);

const spec = JSON.parse(execFileSync('python3', ['-c', 'import sys,json,yaml;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', join(root, 'api', 'openapi.yaml')], { encoding: 'utf8', maxBuffer: 1 << 28 }));
const ops = new Map();
for (const [p, item] of Object.entries(spec.paths ?? {})) for (const m of ['get', 'post', 'put', 'patch', 'delete']) if (item[m]) ops.set(`${m.toUpperCase()} ${p}`, { ...item[m], __servers: item[m].servers ?? item.servers });
const keys = new Set(routes.map((r) => r.key));
for (const r of routes) if (!ops.has(r.key)) bad(`${r.key}: Terraform route has no operation in api/openapi.yaml`);
for (const k of ops.keys()) if (!keys.has(k)) bad(`${k}: operation in api/openapi.yaml has no Terraform route`);
const SEC = { jwt: [{ CognitoJWT: [] }], agent: [{ AgentKey: [] }], none: [] };
const TEN = { jwt: ['token'], agent: ['agent'], none: ['stored-record', 'none'] };
for (const r of routes) {
  if (r.guard === 'none' && !PUBLIC.includes(r.key)) bad(`${r.key}: public route (no authorization) that is not on the public list`);
  const o = ops.get(r.key);
  if (!o) continue;
  for (const k of ['security', 'x-tenant', 'x-roles']) if (o[k] === undefined) bad(`${r.key}: operation has no ${k}`);
  if (o.security !== undefined && JSON.stringify(o.security) !== JSON.stringify(SEC[r.guard])) bad(`${r.key}: security ${JSON.stringify(o.security)} does not match how Terraform guards the route`);
  if (o['x-tenant'] !== undefined && !TEN[r.guard].includes(o['x-tenant'])) bad(`${r.key}: x-tenant ${JSON.stringify(o['x-tenant'])} does not fit a ${r.guard} route`);
  if (o['x-roles'] !== undefined && !(Array.isArray(o['x-roles']) && o['x-roles'].every((x) => ROLES.includes(x)))) bad(`${r.key}: x-roles must be a list of ${ROLES.join(', ')}`);
  if (o['x-tenant'] === 'token') {
    const dir = join(root, 'lambda', r.fn ?? '');
    let src = '';
    const walk = (d) => { for (const e of readdirSync(d)) { if (e === 'node_modules') continue; const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(m?js|cjs)$/.test(e) && !/\.test\./.test(e)) src += readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1') + '\n'; } };
    if (r.fn && existsSync(dir)) walk(dir);
    if (!/\brequireTenant\s*\(/.test(src)) bad(`${r.key}: lambda/${r.fn} does not call requireTenant`);
  }
}
const retro = JSON.parse(readFileSync(join(root, 'lambda', 'shared', 'tenant-retrofit.json'), 'utf8'));
for (const n of retro) bad(`${n}: still on lambda/shared/tenant-retrofit.json (it must be empty)`);
if (problems.length) { console.error(problems.join('\n')); console.error(`routes-match-openapi: ${problems.length} problem(s)`); process.exit(1); }
console.log(`routes-match-openapi: ${routes.length} routes, ${ops.size} operations, all described`);
