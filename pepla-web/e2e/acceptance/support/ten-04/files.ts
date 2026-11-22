import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
export const SCRIPT = join(REPO, 'scripts', 'ci', 'routes-match-openapi.mjs');
const HERE = __dirname;

// ---------------------------------------------------------------- the file

export type Op = {
  key: string; method: string; path: string;
  security?: unknown; tenant?: unknown; roles?: unknown; servers?: unknown; responses?: Record<string, any>;
  raw: any;
};
export type Spec = { servers: { url: string }[]; schemes: string[]; ops: Op[]; byKey: Map<string, Op> };
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** api/openapi.yaml (or a copy of it), read with PyYAML, every local $ref resolved. */
export function readSpec(root = REPO): Spec {
  const out = execFileSync('python3', ['-I', join(HERE, 'openapi_json.py'), join(root, 'api', 'openapi.yaml')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const j = JSON.parse(out) as { servers: { url: string }[]; schemes: string[]; paths: Record<string, any> };
  const ops: Op[] = [];
  for (const [path, item] of Object.entries(j.paths)) {
    for (const m of METHODS) {
      const raw = item[m];
      if (!raw) continue;
      const servers = raw.servers ?? item.servers;
      ops.push({ key: `${m.toUpperCase()} ${path}`, method: m.toUpperCase(), path, security: raw.security, tenant: raw['x-tenant'], roles: raw['x-roles'], servers, responses: raw.responses, raw });
    }
  }
  return { servers: j.servers, schemes: j.schemes, ops, byKey: new Map(ops.map((o) => [o.key, o])) };
}
export const hasId = (path: string) => /\{[^}]+\}/.test(path);

// ---------------------------------------------------------------- a throwaway copy of the files the script reads

let base: string | null = null;
/** One copy of what the script reads (Terraform, the file, the Lambda sources, the retrofit list, the CI workflow); each plant copies it again. */
export function baseCopy(): string {
  if (base && existsSync(base)) return base;
  base = mkdtempSync(join(tmpdir(), 'ten-04-base-'));
  copyInto(REPO, base);
  return base;
}
function copyInto(from: string, to: string) {
  const keep = (src: string) => {
    const rel = src.slice(from.length + 1);
    if (rel === '') return true;
    if (/(^|\/)(node_modules|\.git|\.output|coverage)(\/|$)/.test(rel)) return false;
    const top = rel.split('/')[0]!;
    if (!['infra', 'talent-flow-infra', 'api', 'lambda', 'scripts', '.github'].includes(top)) return false;
    if (top === 'scripts' && !/^scripts(\/ci(\/routes-match-openapi\.mjs)?)?$/.test(rel)) return false;
    if (top === '.github' && !/^\.github(\/workflows(\/ci\.yml)?)?$/.test(rel)) return false;
    if (top === 'lambda' && /\.test\.[mc]?js$/.test(rel)) return false;
    return true;
  };
  cpSync(from, to, { recursive: true, filter: keep });
}
/** A fresh copy to plant a fault in. */
export function plantRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ten-04-plant-'));
  cpSync(baseCopy(), root, { recursive: true });
  return root;
}
export function drop(root: string) { try { rmSync(root, { recursive: true, force: true }); } catch { /* temp */ } }

export type Result = { code: number | null; out: string };
/** Runs the builder's script against a root: `node scripts/ci/routes-match-openapi.mjs --root <dir>` (pinned P1). Exit 0 means it passed. */
export function runScript(root: string): Result {
  if (!existsSync(SCRIPT)) return { code: null, out: 'scripts/ci/routes-match-openapi.mjs does not exist' };
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8', timeout: 60_000, cwd: root, env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '' } });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ---------------------------------------------------------------- planted faults

const plantPy = join(HERE, 'openapi_plant.py');
const py = (root: string, action: string, method: string, path: string, value?: unknown) => {
  const args = ['-I', plantPy, join(root, 'api', 'openapi.yaml'), action, method, path];
  if (value !== undefined) args.push(JSON.stringify(value));
  execFileSync('python3', args, { encoding: 'utf8' });
};
export const planter = {
  deleteOp: (root: string, key: string) => { const [m, p] = key.split(' ') as [string, string]; py(root, 'delete-op', m, p); },
  dropKey: (root: string, key: string, name: string) => { const [m, p] = key.split(' ') as [string, string]; py(root, 'drop-key', m, p, name); },
  setKey: (root: string, key: string, name: string, value: unknown) => { const [m, p] = key.split(' ') as [string, string]; py(root, 'set-key', m, p, [name, value]); },
  addOp: (root: string, key: string, fields: Record<string, unknown>) => { const [m, p] = key.split(' ') as [string, string]; py(root, 'add-op', m, p, fields); },
  /** A new Terraform route on an existing integration (so its handler resolves). `auth` is the lines of authorization the route carries ('' = none, like a public route). */
  addRoute: (root: string, dir: 'infra' | 'talent-flow-infra', key: string, integration: string, auth: string, apiId: string) => {
    const name = `ten04_plant_${key.replace(/[^A-Za-z0-9]+/g, '_')}`;
    writeFileSync(join(root, dir, 'zz-ten04-plant.tf'), `resource "aws_apigatewayv2_route" "${name}" {\n  api_id    = ${apiId}\n  route_key = "${key}"\n  target    = "integrations/\${aws_apigatewayv2_integration.${integration}.id}"\n${auth}\n}\n`, { flag: 'a' });
  },
  /** Every call and import of requireTenant in a handler folder is turned into something else. */
  stripRequireTenant: (root: string, fn: string) => {
    const dir = join(root, 'lambda', fn);
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p); continue; }
        if (/\.(js|mjs|cjs)$/.test(e) && !/\.test\./.test(e)) writeFileSync(p, readFileSync(p, 'utf8').replace(/requireTenant/g, 'requireNothing'));
      }
    };
    walk(dir);
  },
  /** The name stays in a comment only: nothing calls it. */
  commentOnlyRequireTenant: (root: string, fn: string) => {
    planter.stripRequireTenant(root, fn);
    const f = join(root, 'lambda', fn, existsSync(join(root, 'lambda', fn, 'index.mjs')) ? 'index.mjs' : 'index.js');
    writeFileSync(f, readFileSync(f, 'utf8') + '\n// requireTenant(event) is called here\n/* import { requireTenant } from "shared" */\n');
  },
  retrofit: (root: string, names: string[]) => writeFileSync(join(root, 'lambda', 'shared', 'tenant-retrofit.json'), JSON.stringify(names, null, 2) + '\n'),
  /** Renames a route's path in both Terraform (any file) and the file, so only the public list can object. */
  renamePath: (root: string, from: string, to: string) => {
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (e.endsWith('.tf')) { const s = readFileSync(p, 'utf8'); if (s.includes(from)) writeFileSync(p, s.split(from).join(to)); }
      }
    };
    walk(join(root, 'infra')); walk(join(root, 'talent-flow-infra'));
    const y = join(root, 'api', 'openapi.yaml');
    writeFileSync(y, readFileSync(y, 'utf8').split(from).join(to));
  },
};
export { basename, dirname, existsSync, mkdirSync, readFileSync };
