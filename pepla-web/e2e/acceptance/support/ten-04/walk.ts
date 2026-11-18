import { ROWS, A_BODY, TENANT_A_QUERY, type Kind, type Row } from './rows';
import type { ApiName } from './tf';

/**
 * TEN-04 AC-7: the company B walk (spec rule 3), written once and run two ways.
 *  - on pepla-dev, over HTTP, with the seeded logins of company A and company B (the @pepla-dev test);
 *  - in the no-backend run, against a small model of the API (model.ts) that follows the file's own x-tenant and x-roles,
 *    to show the walk passes a correct API, fails each planted leak, and fails for a route that has no row.
 * The walk never decides by itself what a route should answer: it reads x-tenant and x-roles from the file, then asks
 * "does company B's caller see or change anything of company A's?". Expected answers (pinned from TEN-02, TEN-03, TEN-05):
 *   - B's caller has a role the route accepts: another company's id answers 404 {"error":"Not found"}; a list holds none of A's rows.
 *   - no B login has a role the route accepts: 403 {"error":"Forbidden"} and nothing else.
 */

export type LoginName = 'hrA' | 'tfA' | 'itA' | 'empA' | 'hrB' | 'tfB' | 'itB';
/** Who each seeded login is (pinned: the seed makes them in these groups, all also in e2e-robots). */
export const LOGIN_ROLES: Record<LoginName, string[]> = {
  hrA: ['hr_staff', 'perm-recruitment'],
  tfA: ['admin', 'manager', 'perm-recruitment', 'perm-it', 'perm-approve-offers'],
  itA: ['perm-it'],
  empA: ['employee'],
  hrB: ['hr_staff', 'perm-recruitment'],
  tfB: ['admin', 'manager', 'perm-recruitment', 'perm-it', 'perm-approve-offers'],
  itB: ['perm-it'],
};
/** Env names of the dev logins: E2E_<X>_EMAIL and E2E_<X>_PASSWORD. TF, TF_B and IT_B are new with TEN-04 (the walk needs the seed to add them); victim is a company A user nobody signs in as but the walk reads its id. */
export const LOGIN_ENV: Record<LoginName | 'victim', string> = { hrA: 'E2E_HR', tfA: 'E2E_TF', itA: 'E2E_IT', empA: 'E2E_EMP', hrB: 'E2E_HR_B', tfB: 'E2E_TF_B', itB: 'E2E_IT_B', victim: 'E2E_VICTIM' };
export const A_LOGINS: LoginName[] = ['hrA', 'itA', 'tfA', 'empA'];
export const B_LOGINS: LoginName[] = ['hrB', 'itB', 'tfB'];
/** Order matters: the least powerful login that holds a role the route accepts is used. */
export const pickLogin = (roles: string[], logins: LoginName[]): LoginName | undefined =>
  roles.length === 0 ? logins[logins.length - 1] : logins.find((l) => LOGIN_ROLES[l].some((r) => roles.includes(r)));

export type OpInfo = { key: string; method: string; path: string; tenant: unknown; roles: unknown; api: ApiName };
export type Req = { login: LoginName | 'anon' | 'agent'; op: string; api: ApiName; method: string; path: string; query: Record<string, string>; body?: unknown };
export type Res = { status: number; body: unknown };
export type Send = (req: Req) => Promise<Res>;
export type World = { ids: Record<Kind, string>; tenantA: string; markers: string[]; bMarkers: string[] };

const NOT_FOUND = { error: 'Not found' };
const FORBIDDEN = { error: 'Forbidden' };
const ECHO_VALUES = (row: Row) => Object.values(row.query ?? {}).filter((v) => v !== TENANT_A_QUERY);
/** ten-04.1: every string the caller typed in the body (except company A's id), so an answer that repeats them is not counted as data. */
const typedStrings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => typedStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach((x) => typedStrings(x, out));
  return out;
};
/** ten-04.1: the answer as text, without the keys a row names as changing by themselves. */
const plainText = (b: unknown, volatile: string[] = []) => {
  const strip = (v: unknown): unknown => Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !volatile.includes(k)).map(([k, x]) => [k, strip(x)])) : v;
  return text(strip(b));
};

const fill = (path: string, ids: Record<string, Kind> | undefined, w: World, made = 'ten04-made-up-token') =>
  path.replace(/\{([^}]+)\}/g, (_m, name: string) => encodeURIComponent(ids?.[name] ? w.ids[ids[name]!] : made));
const sub = (v: unknown, w: World): unknown => {
  if (v === A_BODY) return w.tenantA;
  if (Array.isArray(v)) return v.map((x) => sub(x, w));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, sub(x, w)]));
  return v;
};
const subQuery = (q: Record<string, string> | undefined, w: World) => Object.fromEntries(Object.entries(q ?? {}).map(([k, v]) => [k, v === TENANT_A_QUERY ? w.tenantA : v]));
const text = (b: unknown) => (typeof b === 'string' ? b : JSON.stringify(b ?? null));
const holds = (b: unknown, markers: string[], echo: string[] = []) => {
  let t = text(b);
  for (const e of echo) t = t.split(e).join('');
  return markers.filter((m) => t.includes(m));
};

export type Problem = string;
export type Walked = { problems: Problem[]; sent: number; created: number };

/** Runs the walk over every operation of the file. `ops` is the file's operations (key, x-tenant, x-roles) joined with their API from Terraform. */
export async function walk(ops: OpInfo[], send: Send, w: World): Promise<Walked> {
  const problems: Problem[] = [];
  let sent = 0;
  const call = async (r: Req) => { sent++; return send(r); };
  const byKey = new Map(ops.map((o) => [o.key, o]));
  const opOf = (key: string) => byKey.get(key);
  const rolesOf = (o: OpInfo): string[] => (Array.isArray(o.roles) ? (o.roles as string[]) : []);
  const reqFor = (o: OpInfo, login: Req['login'], row: Row, over: Partial<Req> = {}): Req => ({
    login, op: o.key, api: o.api, method: o.method, path: fill(o.path, row.ids, w), query: subQuery(row.query, w), body: sub(row.body, w), ...over,
  });
  /** A reads a route back. Answers null when A cannot (the problem is recorded by the caller). */
  const readBack = async (row: Row, why: string): Promise<string | null> => {
    const r = row.read!;
    const ro = opOf(r.op);
    if (!ro) { problems.push(`${why}: the read-back route ${r.op} is not in the file`); return null; }
    const login = pickLogin(rolesOf(ro), A_LOGINS);
    if (!login) { problems.push(`${why}: no login of company A may call ${r.op}`); return null; }
    const res = await call({ login, op: ro.key, api: ro.api, method: 'GET', path: fill(ro.path, r.ids, w), query: r.query ?? {} });
    if (res.status !== 200) { problems.push(`${why}: company A reading ${r.op} got ${res.status}, not 200`); return null; }
    return text(res.body);
  };

  // Every operation needs a row, and says where its company comes from.
  for (const o of ops) {
    if (!ROWS[o.key]) problems.push(`${o.key}: no walk row (every operation in the file needs one)`);
    if (!['token', 'agent', 'stored-record', 'none'].includes(String(o.tenant))) problems.push(`${o.key}: x-tenant is ${JSON.stringify(o.tenant)}, not token, agent, stored-record or none`);
  }

  // Lists first, then record routes, then writes that create, so a creation never moves a list under a comparison.
  const order = (k: Row['kind']) => ({ none: 0, stored: 1, agent: 2, list: 3, byId: 4, covered: 5, create: 6 }[k]);
  const todo = ops.filter((o) => ROWS[o.key]).sort((a, b) => order(ROWS[a.key]!.kind) - order(ROWS[b.key]!.kind));
  for (const o of todo) {
    const row = ROWS[o.key]!;
    const tenant = String(o.tenant);
    const label = o.key;
    if (row.kind === 'none') {
      if (tenant !== 'none') problems.push(`${label}: served to anyone, so x-tenant must be none (it is ${tenant})`);
      const r = await call(reqFor(o, 'anon', row));
      if (r.status !== 200) problems.push(`${label}: answered ${r.status}, not 200`);
      for (const m of holds(r.body, w.markers)) problems.push(`${label}: the answer holds ${m} of company A`);
      continue;
    }
    if (row.kind === 'stored') {
      if (tenant !== 'stored-record') problems.push(`${label}: the company is the stored record's, so x-tenant must be stored-record (it is ${tenant})`);
      const one = await call(reqFor(o, 'anon', row));
      const two = await call(reqFor(o, 'anon', row, { path: fill(o.path, row.ids, w, 'ten04-made-up-other') }));
      if (row.refusal) {
        // ten-04.1: this route answers a fixed body for every made-up token (ONB-04 AC-9), so it is judged on that exact answer.
        if (one.status !== row.refusal.status || text(one.body) !== text(row.refusal.body)) problems.push(`${label}: a made-up token did not get the fixed refusal ${row.refusal.status} ${text(row.refusal.body)} (it got ${one.status} ${text(one.body)})`);
      } else if (one.status < 400 || one.status >= 500) problems.push(`${label}: a made-up token answered ${one.status}, not a refusal`);
      if (one.status !== two.status || text(one.body) !== text(two.body)) problems.push(`${label}: two made-up tokens did not get the same answer`);
      for (const m of holds(one.body, w.markers)) problems.push(`${label}: a made-up token's answer holds ${m} of company A`);
      continue;
    }
    if (row.kind === 'agent') {
      if (tenant !== 'agent') problems.push(`${label}: x-tenant must be agent (it is ${tenant})`);
      const r = await call(reqFor(o, 'agent', row));
      if (r.status !== 200) problems.push(`${label}: the agent key answered ${r.status}, not 200`);
      for (const m of holds(r.body, w.bMarkers)) problems.push(`${label}: the agent key's answer holds ${m} of company B`);
      continue;
    }
    if (row.kind === 'covered') {
      if (tenant !== 'agent') problems.push(`${label}: x-tenant must be agent (it is ${tenant})`);
      continue;
    }
    if (tenant !== 'token') { problems.push(`${label}: x-tenant must be token (it is ${tenant})`); continue; }
    const roles = rolesOf(o);
    const bLogin = pickLogin(roles, B_LOGINS);
    const hasRole = bLogin !== undefined && (roles.length === 0 || LOGIN_ROLES[bLogin].some((r) => roles.includes(r)));
    const as = (bLogin ?? 'hrB') as LoginName;
    const echo = row.echo ? [...ECHO_VALUES(row), ...typedStrings(row.body).filter((x) => x !== A_BODY)] : [];
    const forbiddenBody = row.forbiddenBody ?? FORBIDDEN;
    const notFoundBody = row.notFoundBody ?? NOT_FOUND;

    if (row.kind === 'list') {
      const plain = await call(reqFor(o, as, row, { query: Object.fromEntries(Object.entries(row.query ?? {}).filter(([, v]) => v !== TENANT_A_QUERY)) }));
      if (!hasRole) {
        if (plain.status !== 403) problems.push(`${label}: no login of company B has a role it accepts (${roles.join(', ')}), so it must answer 403; it answered ${plain.status}`);
        else if (text(plain.body) !== text(forbiddenBody)) problems.push(`${label}: the 403 body is not ${text(forbiddenBody)}`);
      } else {
        if (plain.status !== 200) problems.push(`${label}: company B's list answered ${plain.status}, not 200`);
        for (const m of holds(plain.body, w.markers, echo)) problems.push(`${label}: company B's list holds ${m} of company A`);
        const named = await call(reqFor(o, as, row, { query: { ...subQuery(row.query, w), tenantId: w.tenantA, tenant_id: w.tenantA, company: w.tenantA } }));
        if (named.status !== plain.status || plainText(named.body, row.volatile) !== plainText(plain.body, row.volatile)) problems.push(`${label}: naming company A in the query (tenantId, tenant_id, company) changed the answer`);
      }
      continue;
    }

    if (row.kind === 'byId') {
      const isWrite = o.method !== 'GET';
      const before = isWrite && row.read ? await readBack(row, `${label} (before)`) : null;
      if (isWrite && !row.read) problems.push(`${label}: a write needs a read-back route in its row`);
      const r = await call(reqFor(o, as, row));
      if (!hasRole) {
        if (r.status !== 403) problems.push(`${label}: no login of company B has a role it accepts (${roles.join(', ')}), so it must answer 403; it answered ${r.status}`);
        else if (text(r.body) !== text(forbiddenBody)) problems.push(`${label}: the 403 body is not ${text(forbiddenBody)}`);
      } else {
        if (r.status !== 404) problems.push(`${label}: company A's id, asked by company B, answered ${r.status}, not 404`);
        else if (text(r.body) !== text(notFoundBody)) problems.push(`${label}: the 404 body is not ${text(notFoundBody)}`);
      }
      for (const m of holds(r.body, w.markers)) problems.push(`${label}: the answer to company B holds ${m} of company A`);
      if (isWrite && row.read && before !== null) {
        const after = await readBack(row, `${label} (after)`);
        if (after !== null && after !== before) problems.push(`${label}: after company B's write, company A's row (${row.read.op}) is not as it was`);
      }
      continue;
    }

    if (row.kind === 'create') {
      const before = row.read ? await readBack(row, `${label} (before)`) : null;
      const r = await call(reqFor(o, as, row));
      if (!hasRole && r.status !== 403) problems.push(`${label}: no login of company B has a role it accepts (${roles.join(', ')}), so it must answer 403; it answered ${r.status}`);
      for (const m of holds(r.body, w.markers, echo)) problems.push(`${label}: the answer to company B holds ${m} of company A`);
      if (row.read && before !== null) {
        const after = await readBack(row, `${label} (after)`);
        if (after !== null && after !== before) problems.push(`${label}: after company B's create naming company A, company A's ${row.read.op} is not as it was`);
      }
    }
  }
  return { problems, sent, created: 0 };
}
