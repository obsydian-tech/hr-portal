import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { httpEvent, runHandler, type Row, type Run, type Tables } from '../rec-14/lambda-harness';
import { A, B, D, authorizerOf, av, fileOf, plain, settings, type Caller } from '../rec-02/world';
import { C, K, NOW, DAY, TABLE, world as rec07World } from '../rec-07/world';

/**
 * INT-03 · Stop logging raw guest tokens (NH-267, amber). Spec: /mnt/project-files/specs/interview-journey/cards/INT-03.md.
 *
 * Every run here is one call of the real handler (lambda/generateScoringLink, lambda/submitVoteByToken, its rec07.mjs) in a fresh
 * Node process against REC-14's fake AWS (support/rec-14/fake-aws, unchanged), which records every console.log, info, warn, error,
 * debug and trace line. The world is REC-07's (support/rec-07/world.ts, unchanged) plus the link rows of this card, at REC-07's fixed
 * time (NOW). Nothing here calls AWS or any AI. All names are made up.
 *
 * A failure is planted on one AWS call, found by what the call is (its key), not by its place in the order, so a build that reads in
 * another order still gets the same failure. Every planted error carries the word INT03-ERRMSG in its message, and the token where the
 * token is known before the run: a line that logs err.message (rule 2) shows it.
 */
export { A, B, D, C, K, NOW, TABLE, plain };
export type { Run, Tables };

export const ERR_MARK = 'INT03-ERRMSG';
const CLOCK = join(__dirname, '..', 'rec-15', 'clock.mjs');
/** Test support (updated-new.mjs): the fake DynamoDB also answers ReturnValues UPDATED_NEW, so the old vote path can reach its quorum. */
const UPDATED_NEW = join(__dirname, 'updated-new.mjs');
const env = () => settings({ ROLES_TABLE_NAME: TABLE.roles, NODE_OPTIONS: `--import=${pathToFileURL(CLOCK).href} --import=${pathToFileURL(UPDATED_NEW).href}`, REC15_NOW: NOW, TOKEN_TTL_DAYS: '7' });
const nowSec = Date.parse(NOW) / 1000;

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');
export const sha256B64u = (s: string) => createHash('sha256').update(s).digest('base64url');

/** The tokens of this card's own rows. Old-path tokens are UUIDs, as randomUUID() makes them; REC-07 tokens are 32 random bytes in base64url. */
export const TOK = {
  existing: '6f1c2a9e-4b7d-4e3a-9c51-2d8f0b7a3e64',
  used: 'b84e0d27-91f3-4c6a-8e25-73a9c1f0d4b8',
  notFound: 'e2d95b14-3a7c-4f08-b6d1-c0587e9a2f3d',
  noCompany: '3c7a1e90-5d2b-4b8f-a4e6-91d0f72c8b35',
  moduleOff: '9a0f6c3d-e15b-47a2-8d94-b2c7e0516f8a',
  guest: 'k3Vq9ZtR2mXw7LpB0sYc5HdN8aFj4UeG1oQi6TrWvKz',
  guestExpired: 'Wd8Hn2Qs6YxT0bLc4Rf9Gv1Mk5Pz7Ja3Ue8Io2Sy6Nq',
} as const;
export const PM_EXISTING = 'pm-int03-existing';

/** An old-path link row as generateScoringLink writes it on develop 7048cb9 (both the token-indexed and the candidate-indexed copy). */
function oldLink(token: string, opts: { pk?: string; sk?: string; cand?: string; iv?: string; tenant?: string | null; used?: boolean; ttl?: number; pm?: string } = {}): Row {
  const ttl = opts.ttl ?? nowSec + 3 * 86400;
  const company = opts.tenant === null ? {} : { tenant_id: opts.tenant ?? A, tenantId: opts.tenant ?? A };
  return av({
    PK: opts.pk ?? `SCORING_LINK#${token}`, SK: opts.sk ?? 'META', token, candidateId: opts.cand ?? K.v, ...company,
    panelMemberId: opts.pm ?? 'pm-int03-guest', panelMemberEmail: 'naledi.guest@example.test', panelMemberName: 'Naledi Guest', panelMemberRole: 'Area manager',
    interviewId: opts.iv ?? K.i1, createdBy: 'sub-rec-a', createdAt: '2026-11-20T08:00:00.000Z', expiresAt: new Date(ttl * 1000).toISOString(), ttl, used: opts.used ?? false,
  });
}
/** A REC-07 link row (hashed key), as generateScoringLink's REC-07 path writes it. */
function hashedLink(raw: string, expiresAt: string): Row {
  const h = sha256Hex(raw);
  return av({
    PK: `SCORING_LINK#${h}`, SK: 'META', token_hash: h, tenant_id: A, interview_id: K.i1, candidate_id: K.v, guest_email: 'naledi.guest@example.test',
    expires_at: expiresAt, used_at: null, created_by: 'sub-rec-a', created_at: '2026-11-20T08:00:00.000Z', ttl: Math.floor(Date.parse(expiresAt) / 1000),
  });
}

let base: Tables | undefined;
/** REC-07's world plus this card's rows. Each call hands back its own copy. */
export function world(): Tables {
  if (!base) {
    const t = rec07World();
    t[TABLE.state] = [
      ...(t[TABLE.state] ?? []),
      oldLink(TOK.existing, { pm: PM_EXISTING }),
      oldLink(TOK.existing, { pk: `CANDIDATE#${K.v}`, sk: `SCORING_LINK#${TOK.existing}`, pm: PM_EXISTING }),
      oldLink(TOK.used, { used: true }),
      oldLink(TOK.noCompany, { tenant: null }),
      oldLink(TOK.moduleOff, { tenant: D }),
      hashedLink(TOK.guest, new Date(Date.parse(NOW) + 3 * DAY).toISOString()),
      hashedLink(TOK.guestExpired, new Date(Date.parse(NOW) - DAY).toISOString()),
    ];
    base = t;
  }
  return structuredClone(base);
}

// ---------------------------------------------------------------- calls

type Fail = { service: string; ops?: string[]; nth?: number; message: string; name?: string };
export type Ask = { method: string; route: string; path?: Record<string, string>; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> };
let forging = false;
/** Company B named in every header and query parameter a handler might wrongly read the company from (never from input). */
const FORGED_HEADERS: Record<string, string> = { 'x-tenant-id': B, 'X-Tenant-Id': B, 'x-company-id': B, 'tenant-id': B, tenant_id: B };
const FORGED_QUERY: Record<string, string> = { tenant_id: B, tenantId: B, company_id: B, companyId: B };
export function forged<T>(fn: () => T): T {
  forging = true;
  try { return fn(); } finally { forging = false; }
}

function eventOf(a0: Ask, caller: Caller | undefined) {
  const a = forging ? { ...a0, headers: { ...FORGED_HEADERS, ...(a0.headers ?? {}) }, query: { ...FORGED_QUERY, ...(a0.query ?? {}) } } : a0;
  const authorizer = caller ? authorizerOf(caller) : undefined;
  const event = httpEvent({ authorizer, path: a.path, query: a.query, body: a.body, headers: a.headers });
  const raw = a.route.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(a.path?.[k] ?? ''));
  event.routeKey = `${a.method} ${a.route}`;
  event.rawPath = raw;
  event.requestContext.routeKey = `${a.method} ${a.route}`;
  event.requestContext.http.method = a.method;
  event.requestContext.http.path = raw;
  if (!caller) delete event.requestContext.authorizer;
  return event;
}
function call(handler: string, caller: Caller | undefined, a: Ask, t: Tables, fail?: Fail): Run {
  return runHandler(fileOf(handler), eventOf(a, caller), { tables: t, env: env(), cognito: { users: [] }, ...(fail ? { fail: fail as any } : {}) });
}

/** The old-path body: a panel member; tenantId names company B (the company never comes from the body). */
export const OLD_BODY = { panelMemberId: 'pm-int03-new', panelMemberEmail: 'naledi.guest@example.test', panelMemberName: 'Naledi Guest', panelMemberRole: 'Area manager', interviewId: K.i1, tenantId: B };
export const REC07_BODY = { interview_id: K.i1, guest_email: 'naledi.guest@example.test', tenantId: B, tenant_id: B };
export const OLD_VOTE = { scores: { technical: 7, communication: 8, culturalFit: 6, problemSolving: 9 }, rating: 'YES', tenantId: B };
export const REC07_VOTE = { scores: { sales: 4, comms: 5, product: 3 }, rating: 'YES', comment: 'Clear on the product range.' };

export const oldGenerate = (who: Caller, cand: string, body: unknown, t: Tables, fail?: Fail) =>
  call('generateScoringLink', who, { method: 'POST', route: '/v1/candidates/{id}/scoring-links', path: { id: cand }, body }, t, fail);
/** The old vote route. The browser sends the scoring page's address (which holds the token) as the Referer. */
export const oldVote = (token: string, body: unknown, t: Tables, fail?: Fail) =>
  call('submitVoteByToken', undefined, { method: 'POST', route: '/v1/scoring/{token}/votes', path: { token }, body, headers: { referer: `https://int03.example/score?token=${token}` } }, t, fail);
export const linkRead = (token: string, t: Tables, fail?: Fail) =>
  call('submitVoteByToken', undefined, { method: 'GET', route: '/v1/scoring-links/{token}', path: { token }, headers: { referer: `https://int03.example/score#token=${token}` } }, t, fail);
export const linkVote = (token: string, body: unknown, t: Tables, fail?: Fail) =>
  call('submitVoteByToken', undefined, { method: 'POST', route: '/v1/scoring-links/{token}', path: { token }, body, headers: { referer: `https://int03.example/score#token=${token}` } }, t, fail);

/** The 1-based place, among the DynamoDB calls of `op`, of the first call `pick` matches, or 0. */
export function placeOf(r: Run, op: string, pick: (input: any) => boolean): number {
  const list = r.calls.filter((c: any) => c.service === 'dynamodb' && c.op === op);
  const i = list.findIndex((c: any) => pick(c.input));
  return i + 1;
}
export const keyOf = (input: any) => {
  const k = input?.Key ?? input?.Item ?? {};
  return `${k.PK?.S ?? ''}|${k.SK?.S ?? ''}`;
};
/** A failure planted on the first `op` call `pick` matches in a plain run of `go`; the run is then made again with it. */
export function failOn(go: (fail?: Fail) => Run, op: string, pick: (input: any) => boolean, message: string): { run: Run; place: number } {
  const plainRun = go();
  const place = placeOf(plainRun, op, pick);
  if (!place) return { run: plainRun, place };
  return { run: go({ service: 'dynamodb', ops: [op], nth: place, message, name: 'InternalServerError' }), place };
}

// ---------------------------------------------------------------- reading a run

export const bodyOf = (r: { response: any }) => {
  try { return JSON.parse(r.response?.body ?? 'null'); } catch { return r.response?.body; }
};
export const statusOf = (r: Run) => r.response?.statusCode as number | undefined;
export const describe = (r: Run) => `${statusOf(r)} ${JSON.stringify(bodyOf(r)).slice(0, 200)}${r.error ? ` (threw ${r.error.name}: ${r.error.message.slice(0, 200)})` : ''}`;
/** Every captured console line of a run, with its arguments formatted the way node prints them. */
export const linesOf = (r: Run) => r.calls.filter((c: any) => c.service === 'log').map((c: any) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);

/** The old-path tokens a run wrote (the key of a SCORING_LINK row it put), found in the calls it made (failed ones included). */
export function tokensWritten(r: Run): string[] {
  const out = new Set<string>();
  for (const c of r.calls as any[]) {
    if (c.service !== 'dynamodb' || c.op !== 'PutItem') continue;
    const item = c.input?.Item ?? {};
    const tok = item.token?.S;
    if (typeof tok === 'string') out.add(tok);
    for (const k of [item.PK?.S, item.SK?.S]) { const m = /SCORING_LINK#(.+)$/.exec(String(k ?? '')); if (m && !item.token_hash) out.add(m[1]!); }
  }
  return [...out];
}
/** The REC-07 hashes a run wrote. */
export function hashesWritten(r: Run): string[] {
  const out = new Set<string>();
  for (const c of r.calls as any[]) if (c.service === 'dynamodb' && c.op === 'PutItem' && typeof c.input?.Item?.token_hash?.S === 'string') out.add(c.input.Item.token_hash.S);
  return [...out];
}

/** The secret texts of one token: the token, its SHA-256 in hex and in base64url. */
export const formsOf = (token: string) => [token, sha256Hex(token), sha256B64u(token)];
/** Every 12-character run of each text. */
export function runsOf(texts: string[], n = 12): string[] {
  const out = new Set<string>();
  for (const s of texts) for (let i = 0; i + n <= s.length; i++) out.add(s.slice(i, i + n));
  return [...out];
}
/** The lines of a run that hold any secret text, or any 12-character run of one, each shown with what it holds. */
export function leaks(r: Run, secrets: string[]): string[] {
  const pieces = runsOf(secrets.filter((s) => s.length >= 12));
  const whole = secrets.filter((s) => s.length > 0 && s.length < 12);
  const out: string[] = [];
  for (const line of linesOf(r)) {
    const hit = pieces.find((p) => line.includes(p)) ?? whole.find((w) => line.includes(w));
    if (hit) out.push(`${line.slice(0, 220)}  <- holds "${hit}"`);
  }
  return out;
}

// ---------------------------------------------------------------- what a run changed (AC-3)

/** Replaces each secret (and the first 16 characters of a hex hash, REC-07's guest voter id) with a name, so random tokens compare. */
export function normal(value: unknown, names: [string, string][]): unknown {
  let text = JSON.stringify(value ?? null);
  const all: [string, string][] = [];
  for (const [s, name] of names) {
    all.push([s, `<${name}>`]);
    const hx = sha256Hex(s);
    all.push([hx, `<${name}:hex>`], [sha256B64u(s), `<${name}:b64u>`], [hx.slice(0, 16), `<${name}:hex16>`]);
  }
  all.sort((a, b) => b[0].length - a[0].length);
  for (const [s, n] of all) text = text.split(s).join(n);
  return JSON.parse(text);
}
/** The rows a run added, changed or removed, in full (plain values), sorted; and the events it put. */
export function effectsOf(before: Tables, r: Run) {
  const rows: string[] = [];
  const after = r.tables ?? {};
  for (const [name, list] of Object.entries(after)) {
    const was = new Set((before[name] ?? []).map((x) => JSON.stringify(plain(x))));
    for (const x of list) { const p = JSON.stringify(plain(x)); if (!was.has(p)) rows.push(`+ ${name} ${p}`); }
  }
  for (const [name, list] of Object.entries(before)) {
    const now = new Set((after[name] ?? []).map((x) => JSON.stringify(plain(x))));
    for (const x of list) { const p = JSON.stringify(plain(x)); if (!now.has(p)) rows.push(`- ${name} ${p}`); }
  }
  const events = (r.calls as any[]).filter((c) => c.service === 'events').map((c) => ({ ...c }));
  return { rows: rows.sort(), events };
}
