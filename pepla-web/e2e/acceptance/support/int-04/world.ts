import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLOCK, candidateRow } from '../rec-15/world';
import { runHandler, type PoolUser } from '../rec-14/lambda-harness';
import { AGENT_SECRET, fileOf as handlerFile, settings } from '../rec-04/world';
import {
  A, B, H, K, NEVER, NOW, P, SUB, TABLE, TENANTS, MANY, W, av, plain, rowsOf, withRows, withSetting, world as world01, pool as pool01, apiEvent, newKey, ROUTE, RACE_FILE, HANDLER,
  type Caller, type Run, type Tables,
} from '../int-01/world';

/**
 * INT-04 (NH-277): the world of the interview emails. Nothing here is application code.
 *
 * It is INT-01's world (companies A and B with the real Standard pack, REC-04's roles, REC-15 step D's people p1, p2, p3 of A and pB of B,
 * A's PANEL_CONFIG with interview_emails 'ON', B's left as the pack wrote it, a fixed clock NOW) with this card's candidates and settings.
 *
 * People (from INT-01's pool, unchanged): the booker is the Recruiter `sub-rec-a` (given name Pat, family name sub-rec-a, email
 * sub-rec-a@example.test, Member row A). p1: given name "  Thandi " (trimmed: Thandi), family Mokoena, thandi.m@mokoena.test. p2: given
 * name Sizwe, no family name, sizwe@mokoena.test. p3: no given name (greeting "Hi."), family Ndlovu, ndlovu@mokoena.test. pB: company B.
 * `two`: Member rows in A and B (companyOfSignIn gives no company). MANY: 51 people of A (many<i>@mokoena.test, given name Many).
 *
 * Every producer run gets FRONTEND_URL = FRONT and INTERVIEW_ORGANISER_EMAIL = ORGANISER unless a test leaves one out; every sender run
 * gets INTERVIEW_EMAIL_MODE = TEST_ADDRESS, INTERVIEW_TEST_EMAIL = TEST_TO and MVP1_RECIPIENT_OVERRIDE = OVERRIDE unless a test changes
 * them. ./hooks.mjs is preloaded on every run (it records each SQS message's whole input and, when asked, makes Postmark answer with an
 * error or the pool answer slowly).
 */
export { A, B, H, NOW, P, SUB, TABLE, TENANTS, MANY, W, av, plain, rowsOf, withRows, withSetting, ROUTE };
export type { Caller, Run, Tables };

export const FRONT = 'https://int04.example';
export const ORGANISER = 'interviews.organiser@int04.example';
export const TEST_TO = 'interviews@blackhole.postmarkapp.com';
export const OVERRIDE = 'zz.override.inbox@int04.example';
export const SENDER = 'noreply@rec01.example';
export const HOOKS = join(__dirname, 'hooks.mjs');

/** This card's candidates. `book` and `two` are company A in Interview; `bee` is company B. */
export const K4 = {
  book: 'CAND-04INT04BOOKAAAAAAAAAAA1', two: 'CAND-04INT04TWOAAAAAAAAAAAA1', noRole: 'CAND-04INT04NOROLEAAAAAAAAA1', noName: 'CAND-04INT04NONAMEAAAAAAAAA1',
  noFirst: 'CAND-04INT04NOFIRSTAAAAAAAA1', bee: 'CAND-04INT04BEEBBBBBBBBBBBB1',
};
export const CAND = { first: 'Amahle', last: 'Zulu', email: 'amahle.zulu@candidate.test', role: 'Fleet controller' };
export const COMPANY_A = 'Mokoena Bakeries';
export const BOOKER = { sub: SUB.recA, email: 'sub-rec-a@example.test', first: 'Pat', last: 'sub-rec-a' };
export const PEOPLE = {
  p1: { email: 'thandi.m@mokoena.test', first: 'Thandi', last: 'Mokoena' },
  p2: { email: 'sizwe@mokoena.test', first: 'Sizwe', last: '' },
  p3: { email: 'ndlovu@mokoena.test', first: '', last: 'Ndlovu' },
};
/** Values no log line may hold. */
export const SECRET = {
  place: 'zz-int04-place Boardroom 3', place2: 'zz-int04-place2 Room 7', link: 'https://meet.example.test/zz-int04-room', link2: 'https://meet.example.test/zz-int04-room-two',
  note: 'zz-int04-candidate-note', reason: 'zz-int04-reason-note', other: 'zz-int04-other-reason', guest: 'zz.int04.guest@outside.test', guest2: 'zz.int04.second@outside.test',
};

function candidates() {
  const row = (id: string, first: string, last: string, title: string, company = A, extra: Record<string, any> = {}) =>
    candidateRow(id, { first, last, company, stage: 'INTERVIEW', role: company === A ? undefined : undefined, title, hm: company === A ? SUB.hmA : SUB.hmB, entered: 20, extra: { configVersion: '1', email: CAND.email, ...extra } });
  return [
    row(K4.book, CAND.first, CAND.last, CAND.role), row(K4.two, CAND.first, CAND.last, CAND.role), row(K4.noRole, CAND.first, CAND.last, ''),
    row(K4.noName, CAND.first, '', CAND.role), row(K4.noFirst, ' ', CAND.last, CAND.role),
    row(K4.bee, 'Bee', 'Bcompany', 'B role', B, { email: 'bee.candidate@candidate.test' }),
  ];
}

const uid = (n: number) => `e4e4${n.toString(16).padStart(4, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
/** People of company A added by this card: `noMail` has no email in the pool; `odd` has a name with a line break and markup in it. */
export const X = { noMail: uid(1), odd: uid(2) };
export const ODD_NAME = 'Lin\r\nBcc: zz.evil@int04.example <b>&"';
export function pool(): PoolUser[] {
  const u = (sub: string, attributes: Record<string, string>): PoolUser => ({ username: sub, sub, status: 'CONFIRMED', enabled: true, attributes: { sub, ...attributes }, groups: ['employee'] });
  return [...pool01(), u(X.noMail, { given_name: 'Nomail', family_name: 'Person' }), u(X.odd, { email: 'odd.person@mokoena.test', given_name: ODD_NAME, family_name: 'Odd' })];
}

let base: Tables | undefined;
/** INT-01's world with this card's candidates and people. Each call hands back its own copy. */
export function world(): Tables {
  if (!base) {
    const t = withRows(world01(), candidates());
    t[TENANTS] = [...(t[TENANTS] ?? []), ...Object.values(X).map((s) => av({ pk: `USER#${s}`, sk: `TENANT#${A}`, tenant_id: A, created_at: '2026-11-01T08:00:00.000Z' }))];
    base = t;
  }
  return structuredClone(base);
}
/** A's PANEL_CONFIG changed (undefined removes a key). */
export const withPanel = (t: Tables, change: Record<string, unknown>, company = A) => withSetting(t, company, 'PANEL_CONFIG', (d) => {
  const o: Record<string, unknown> = { ...d };
  for (const [k, v] of Object.entries(change)) if (v === undefined) delete o[k]; else o[k] = v;
  return o;
});
/** A's PROFILE name changed (undefined removes it). */
export function withCompanyName(t: Tables, name: string | undefined, company = A): Tables {
  const out = structuredClone(t);
  out[TENANTS] = (out[TENANTS] ?? []).map((r) => {
    const p = plain(r);
    if (p['pk'] !== `TENANT#${company}` || p['sk'] !== 'PROFILE') return r;
    const m = { ...p };
    if (name === undefined) delete m['name']; else m['name'] = name;
    return av(m);
  });
  return out;
}

const NODE_OPTIONS = [CLOCK, RACE_FILE, HOOKS].map((f) => `--import=${pathToFileURL(f).href}`).join(' ');
export type O4 = { now?: string; env?: Record<string, string | undefined>; key?: string; postmark?: string; slowMs?: number; fail?: any };
/** Runs one request in a fresh process at NOW (as INT-01's call(), with this card's pool and preload). */
function call(q: { route: string; who?: Caller; path: Record<string, string>; body?: unknown }, t: Tables, o: { now?: string; env: Record<string, string | undefined>; key?: string; fail?: any }): Run {
  const write = q.route === ROUTE.book || q.route === ROUTE.act;
  const event = apiEvent({ ...q, headers: write ? { 'Idempotency-Key': o.key ?? newKey() } : undefined });
  const env = { ...settings({ ROLES_TABLE_NAME: 'talent-flow-roles', IDEMPOTENCY_TABLE: TABLE.idempotency, TOKEN_TTL_DAYS: '7' }), REC15_NOW: o.now ?? NOW, ...o.env };
  return runHandler(handlerFile(HANDLER[q.route]!), event, { tables: t, secrets: { [AGENT_SECRET]: { AWSCURRENT: 'int01-agent-key' } }, cognito: { users: pool() }, env, ...(o.fail ? { fail: o.fail } : {}) });
}
/** Runs a handler with any event (no sign-in). */
export function invoke(handler: string, event: unknown, t: Tables, o: { env?: Record<string, string | undefined> } = {}): Run {
  const env = { ...settings({}), REC15_NOW: NOW, NODE_OPTIONS, ...(o.env ?? {}) };
  return runHandler(handlerFile(handler), event, { tables: t, secrets: {}, cognito: { users: pool() }, env });
}
/** The settings of a producer run: FRONTEND_URL and INTERVIEW_ORGANISER_EMAIL given unless `env` sets them (undefined leaves one out). */
function producerEnv(o: O4): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { FRONTEND_URL: FRONT, INTERVIEW_ORGANISER_EMAIL: ORGANISER, NODE_OPTIONS, ...(o.slowMs ? { INT04_SLOW_MS: String(o.slowMs) } : {}), ...(o.env ?? {}) };
  return env;
}
export const book = (who: Caller, cand: string, body: unknown, t: Tables, o: O4 = {}) => call({ route: ROUTE.book, who, path: { id: cand }, body }, t, { ...o, env: producerEnv(o) });
export const act = (who: Caller, cand: string, iv: string, body: unknown, t: Tables, o: O4 = {}) => call({ route: ROUTE.act, who, path: { id: cand, interviewId: iv }, body }, t, { ...o, env: producerEnv(o) });
export const guestRead = (raw: string, t: Tables, now?: string) => call({ route: ROUTE.guestRead, path: { token: raw } }, t, { env: { NODE_OPTIONS }, now });

/** Runs the sender once with these messages (one SQS record each, as the queue hands them over). */
export function send(bodies: unknown[], t: Tables, o: O4 = {}): Run {
  const env: Record<string, string | undefined> = {
    INTERVIEW_EMAIL_MODE: 'TEST_ADDRESS', INTERVIEW_TEST_EMAIL: TEST_TO, MVP1_RECIPIENT_OVERRIDE: OVERRIDE, NODE_OPTIONS,
    ...(o.postmark ? { INT04_POSTMARK: o.postmark } : { INT04_POSTMARK: 'ok' }), ...(o.env ?? {}),
  };
  const event = { Records: bodies.map((b, i) => ({ messageId: `int04-m-${i + 1}`, body: typeof b === 'string' ? b : JSON.stringify(b), attributes: { MessageGroupId: 'g' } })) };
  return invoke('sendTalentFlowNotification', event, t, { env });
}

// ---------------------------------------------------------------- reading a run

export const logsOf = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service === 'log').map((c: any) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);
/** The messages the run queued, parsed, with their SQS input. */
export function queued(r: { calls: any[] }): { body: any; input: any }[] {
  return r.calls.filter((c: any) => c.service === 'int04' && c.op === 'SendMessage').map((c: any) => {
    let body: any;
    try { body = JSON.parse(c.input?.MessageBody); } catch { body = c.input?.MessageBody; }
    return { body, input: c.input };
  });
}
export const bodies = (r: { calls: any[] }) => queued(r).map((q) => q.body);
export const emailsOf = (r: { calls: any[] }) => bodies(r).filter((b) => b?.type === 'INTERVIEW_EMAIL');
export const byTemplate = (r: { calls: any[] }, t: string) => emailsOf(r).filter((b) => b.template === t);
/** The producer's `interview_emails` log line(s), parsed. */
export function mailLogs(r: { calls: any[] }): any[] {
  const out: any[] = [];
  for (const l of logsOf(r)) {
    const i = l.indexOf('{');
    if (i < 0 || !l.includes('interview_emails')) continue;
    try { const j = JSON.parse(l.slice(i)); if (j?.event === 'interview_emails') out.push(j); } catch { /* not this line */ }
  }
  return out;
}
/** Skip codes across the run's interview_emails lines. */
export function skips(r: { calls: any[] }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of mailLogs(r)) for (const [k, v] of Object.entries(j.skipped ?? {})) out[k] = (out[k] ?? 0) + Number(v);
  return out;
}
export const postmarkOf = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service === 'postmark');
export const guardRows = (t: Tables) => rowsOf(t, TABLE.notifications).filter((x) => String(x['PK']).startsWith('INTERVIEW_EMAIL#'));
export const inAppRows = (t: Tables) => rowsOf(t, TABLE.notifications).filter((x) => String(x['PK']).startsWith('USER#'));
/** The decoded calendar file of a message. */
export const fileOf = (m: any) => Buffer.from(String(m?.attachment?.content_base64 ?? ''), 'base64').toString('utf8');
/** A calendar file's unfolded lines. */
export const icsLines = (ics: string) => ics.replace(/\r\n[ \t]/g, '').split(/\r\n/).filter(Boolean);
export const icsValue = (ics: string, name: string) => icsLines(ics).filter((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`)).map((l) => l.slice(l.indexOf(':', l.startsWith(`${name};`) ? l.indexOf('"', 0) >= 0 ? l.lastIndexOf('"') : 0 : 0) + 1));
/** The HTML read back as text (AC-3): tags removed, <br> a line break, each </p><p> a blank line, the five entities decoded. */
export function htmlAsText(html: string): string {
  return String(html).replace(/<\/p>\s*<p>/g, '\n\n').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
export { K, NEVER };
export const ivRow = (t: Tables, cand: string, iv: string) => rowsOf(t, TABLE.state).find((x) => x['PK'] === `CANDIDATE#${cand}` && x['SK'] === `INTERVIEW#${iv}`);
export const linkRows = (t: Tables, cand: string) => rowsOf(t, TABLE.state).filter((x) => String(x['PK']).startsWith('SCORING_LINK#') && x['candidate_id'] === cand);
