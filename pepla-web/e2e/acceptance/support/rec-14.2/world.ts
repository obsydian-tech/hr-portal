import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { httpEvent, runHandler, runModule, type Failure, type HelperRun, type PoolUser, type Run, type Step, type Tables } from '../rec-14/lambda-harness';
import { A, B, D, SUB, TABLE, TENANTS, authorizerOf, av, fileOf, plain, rowsOf, settings, type Caller } from '../rec-04/world';
import { P, ROLES_TABLE, pool as pool4, roleRow, world as world4 } from '../rec-04/roles';
import { DEP, LIST_A, LIST_B, VERSION, listRow, type Dep } from '../rec-14/world';

/**
 * REC-14 step B: the world of the options route and the role rule (Part 2 of the spec, AC-5 and AC-6). Nothing here is application code.
 *
 * It is REC-04's world (companies A and B hold the real Standard pack, roles and candidates; D has Recruitment off) with REC-14's lists
 * added to the company list table (A: seven departments, one archived, one in lower case; B: three, one archived), more people in the
 * sign-in pool, and a runner that can also set the sign-in pool's users and a Cognito failure for one run (world-patch.mjs).
 *
 * People of A who are hiring managers (the picker's rule, spec rule 12): a CONFIRMED, enabled member of a hiring manager group
 * (manager, perm-recruitment, naleko-talentflow-hiringmanager, or the HM_GROUP_NAME setting, here HiringManager) with a Member row for A.
 */
export { A, B, D, SUB, TABLE, TENANTS, P, ROLES_TABLE, DEP, LIST_A, LIST_B, VERSION, listRow, roleRow, plain, rowsOf, av };
export type { Dep, PoolUser, Run, Tables, Failure };

export const ROUTE = { options: 'GET /v1/roles/options', list: 'GET /v1/roles', one: 'GET /v1/roles/{id}', open: 'POST /v1/roles' } as const;
export type RouteKey = (typeof ROUTE)[keyof typeof ROUTE];
export const SHARED = join(__dirname, '..', '..', '..', '..', '..', 'lambda', 'shared');
export const HIRING_MANAGERS_FILE = join(SHARED, 'hiring-managers.mjs');
export const HM_GROUPS = ['manager', 'perm-recruitment', 'naleko-talentflow-hiringmanager', 'HiringManager'];

/** More people of the pool (the REC-04 pool is kept as it is). */
export const X = {
  adaeze: 'sub-adaeze-a', zodwa: 'sub-zodwa-a', thabo: 'sub-thabo-a', disabled: 'sub-hm-disabled-a', hrOnly: 'sub-hronly-a',
  twoB: 'sub-hm-two-b', empB: 'sub-emp-b',
};
const user = (sub: string, groups: string[], given: string, family: string, status = 'CONFIRMED', enabled = true): PoolUser => ({
  username: sub, sub, status, enabled, attributes: { sub, email: `${sub}@example.test`, given_name: given, family_name: family }, groups,
});
export function pool(): PoolUser[] {
  return [
    ...pool4(),
    user(X.adaeze, ['manager', 'perm-recruitment'], 'adaeze', 'Zulu'), // two groups: listed once; a lower-case first letter
    user(X.zodwa, ['HiringManager'], 'Zodwa', 'Mokoena'), // the HM_GROUP_NAME group
    user(X.thabo, ['naleko-talentflow-hiringmanager'], 'Thabo', 'Nkosi'), // the old TalentFlow group
    user(X.disabled, ['manager'], 'Dina', 'Disabled', 'CONFIRMED', false), // CONFIRMED but disabled: cannot sign in
    user(X.hrOnly, ['hr_staff'], 'Hilda', 'Roux'), // in the company, in no hiring manager group
    user(X.twoB, ['manager'], 'Bontle', 'Sithole'), // company B
    user(X.empB, ['employee'], 'Emma', 'Bhengu'), // company B, not a hiring manager
  ];
}

export const member = (sub: string, c: string) => av({ pk: `USER#${sub}`, sk: `TENANT#${c}`, tenant_id: c });
/** REC-04's world with the departments of A and B and the extra members. */
export function baseWorld(): Tables {
  const t = noList(noList(world4(), A), B); // rec-04.2 already adds these two lists to REC-04's world; start from none so there is one row each
  t[TENANTS] = [
    ...(t[TENANTS] ?? []),
    listRow(A, VERSION.A, LIST_A), listRow(B, VERSION.B, LIST_B),
    ...[X.adaeze, X.zodwa, X.thabo, X.disabled, X.hrOnly].map((s) => member(s, A)), member(X.twoB, B), member(X.empB, B),
  ];
  return t;
}

const without = (t: Tables, table: string, keep: (r: Record<string, any>) => boolean): Tables => {
  const out = structuredClone(t);
  out[table] = (out[table] ?? []).filter((r) => keep(plain(r)));
  return out;
};
/** The same world with company `c`'s department list row removed (a company with no list). */
export const noList = (t: Tables, c: string) => without(t, TENANTS, (r) => !(r['pk'] === `TENANT#${c}` && r['sk'] === 'DEPARTMENTS'));
/** The same world with company `c`'s department list replaced. */
export function withList(t: Tables, c: string, version: number, deps: Dep[]): Tables {
  const out = noList(t, c);
  out[TENANTS] = [...(out[TENANTS] ?? []), listRow(c, version, deps)];
  return out;
}
/** The same world with none of company `c`'s Recruitment settings (the REC-12 defaults apply). */
export const noSettings = (t: Tables, c: string) => without(t, TABLE.config, (r) => r['PK'] !== `TENANT#${c}`);
/** The same world with company `c`'s active settings of the given types replaced by this data. */
export function withSettings(t: Tables, c: string, data: Record<string, unknown>): Tables {
  const out = structuredClone(t);
  out[TABLE.config] = (out[TABLE.config] ?? []).map((r) => {
    const p = plain(r);
    if (p['PK'] !== `TENANT#${c}` || p['isActive'] === false || !(p['configType'] in data)) return r;
    return { ...r, data: av({ data: data[p['configType']] as any })['data']! };
  });
  return out;
}
/** A company's active setting of one type, plain (the data), from a world. */
export const settingOf = (t: Tables, c: string, type: string) =>
  rowsOf(t, TABLE.config).find((r) => r['PK'] === `TENANT#${c}` && r['configType'] === type && r['isActive'] !== false)?.['data'];

// ---------------------------------------------------------------- what an answer must hold

const byNameLower = (a: { name: string }, b: { name: string }) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
/** The company's active departments as the options answer lists them: { id, name }, sorted by name ignoring case. */
export const activeNames = (deps: Dep[]) => deps.filter((d) => d.status === 'ACTIVE').map((d) => ({ id: d.id, name: d.name })).sort(byNameLower);

/**
 * The hiring managers of a company by the picker's rule, worked out here from the pool and the Member rows: [{ id, name }] sorted by name
 * ignoring case. `groups` are the hiring manager groups (the HM_GROUP_NAME setting is one of them).
 */
export function expectedManagers(users: PoolUser[], t: Tables, company: string, groups: string[] = HM_GROUPS): { id: string; name: string }[] {
  const members = rowsOf(t, TENANTS).filter((r) => typeof r['pk'] === 'string' && r['pk'].startsWith('USER#') && String(r['sk']).startsWith('TENANT#'));
  const mine = new Set(members.filter((m) => m['sk'] === `TENANT#${company}`).map((m) => String(m['pk']).slice('USER#'.length)));
  return users
    .filter((u) => u.groups.some((g) => groups.includes(g)) && (u.status ?? 'CONFIRMED') === 'CONFIRMED' && u.enabled !== false && mine.has(u.sub))
    .map((u) => ({ id: u.sub, name: [u.attributes['given_name'], u.attributes['family_name']].filter(Boolean).join(' ') || String(u.attributes['email']) }))
    .sort(byNameLower);
}

// ---------------------------------------------------------------- runners

/** The environment that makes the fake AWS take `patch` onto its world before the run (world-patch.mjs). */
export const patchEnv = (patch: Record<string, unknown>): Record<string, string> => ({
  NODE_OPTIONS: `--import=${pathToFileURL(join(__dirname, 'world-patch.mjs')).href}`,
  REC14_WORLD_PATCH: JSON.stringify(patch),
});

export type Ask = { id?: string; body?: unknown; headers?: Record<string, string>; query?: Record<string, string>; claims?: Record<string, unknown>; path?: Record<string, string> };
export type Opts = { pool?: PoolUser[]; env?: Record<string, string>; fail?: Failure; cognitoFail?: string[] };

/** Runs one route of a Lambda as `caller`, as API Gateway (HTTP API, payload 2.0) hands it over. */
export function runNamed(handler: string, route: string, caller: Caller, a: Ask, t: Tables, o: Opts = {}): Run {
  const [method, template] = route.split(' ') as [string, string];
  const path = a.id === undefined ? template : template.replace('{id}', a.id);
  const event = httpEvent({ authorizer: authorizerOf(caller, a.claims ?? {}), path: a.path ?? (a.id === undefined ? undefined : { id: a.id }), query: a.query, body: a.body, headers: a.headers });
  event.routeKey = route;
  event.rawPath = path;
  event.requestContext.routeKey = route;
  event.requestContext.http.method = method;
  event.requestContext.http.path = path;
  return runHandler(fileOf(handler), event, {
    tables: t, secrets: {}, env: { ...settings({ ROLES_TABLE_NAME: ROLES_TABLE, ...(o.env ?? {}) }), ...(o.cognitoFail ? patchEnv({ cognitoFail: o.cognitoFail }) : {}) },
    cognito: { users: o.pool ?? pool() }, ...(o.fail ? { fail: o.fail } : {}),
  });
}
/** Runs one route of manageRoles. */
export const run = (route: RouteKey, caller: Caller, a: Ask, t: Tables, o: Opts = {}): Run => runNamed('manageRoles', route, caller, a, t, o);
/** GET /v1/hiring-managers (getHiringManagers keeps its own answer shape). */
export const hiringManagersRoute = (who: Caller, t: Tables, o: Opts = {}) => runNamed('getHiringManagers', 'GET /v1/hiring-managers', who, {}, t, o);
let n = 0;
export const newKey = () => `rec14b-key-${process.pid}-${++n}-${Date.now()}`;
export const options = (who: Caller, t: Tables, a: Ask = {}, o: Opts = {}) => run(ROUTE.options, who, a, t, o);
export const roles = (who: Caller, t: Tables, query?: Record<string, string>, o: Opts = {}) => run(ROUTE.list, who, { query }, t, o);
export const role = (who: Caller, id: string, t: Tables, o: Opts = {}) => run(ROUTE.one, who, { id }, t, o);
export const open = (who: Caller, body: unknown, t: Tables, key: string | null = newKey(), o: Opts & { headers?: Record<string, string> } = {}) =>
  run(ROUTE.open, who, { body, headers: { ...(key === null ? {} : { 'idempotency-key': key }), ...(o.headers ?? {}) } }, t, o);

/**
 * Imports a shared module in a fresh process against the world, with the sign-in pool's users and the settings, and runs the steps.
 * (REC-04's world: the same settings as run().)
 */
export function helper(module: string, steps: Step[], t: Tables, o: Opts = {}): HelperRun {
  return runModule(steps, {
    tables: t, module, ...(o.fail ? { fail: o.fail } : {}),
    env: { ...settings({ ROLES_TABLE_NAME: ROLES_TABLE, ...(o.env ?? {}) }), ...patchEnv({ cognito: { users: o.pool ?? pool() }, ...(o.cognitoFail ? { cognitoFail: o.cognitoFail } : {}) }) },
  });
}
