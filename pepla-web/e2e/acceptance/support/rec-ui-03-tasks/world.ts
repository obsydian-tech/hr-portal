import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, runHandler } from '../rec-14/lambda-harness';
import { AGENT_SECRET, fileOf, settings } from '../rec-04/world';
import { CLOCK } from '../rec-15/world';
import {
  A, B, HANDLER, IDEM_TABLE, K as K01, NOW, P, SUB, TABLE, apiEvent, av, call, plain, pool, rowsOf, world as world01,
  type Caller, type O, type Req, type Row, type Run, type Tables,
} from '../int-01/world';

/**
 * REC-UI-03 server, the list of feedback a person owes (NH-293, G-10b). Test support only, no application code.
 *
 * The world is INT-01's (support/int-01/world.ts, unchanged): REC-15 step D's companies A and B with the real Standard pack, the people
 * p1, p2, p3 of company A and pB of company B with Member rows and names in the fake sign-in pool, INT-01's candidates (book, fresh,
 * screening, notHired, bee) and the fixed clock NOW. The routes run in a fresh Node process each call against REC-14's fake AWS
 * (support/rec-14/fake-aws, unchanged), through INT-01's call() (so INT-01's race preload and INT-01.F's hooks work here too).
 *
 * This file adds:
 *   - the new route GET /v1/feedback-due on submitVote (registered in INT-01's HANDLER list for this process only);
 *   - dueRow(): a feedback-due row in the shape of rule 1 (for forged, stale or "booked before" rows a test lays down itself);
 *   - readers of the feedback-due rows of a table;
 *   - runBackfill(): the real scripts/tenancy/backfill-feedback-due.py against an in-memory DynamoDB (./fake-boto3, copied from REC-06.2's).
 */
export { A, B, NOW, P, SUB, TABLE, av, plain, rowsOf };
export type { Caller, O, Req, Row, Run, Tables };

export const ROUTE_DUE = 'GET /v1/feedback-due';
HANDLER[ROUTE_DUE] = 'submitVote';

/** INT-01's candidates, plus this card's own (added by the tests that need them). */
export const K = {
  ...K01,
  /** A second company A candidate on another role level (its own saga, so a test can lock it to other settings). */
  other: 'CAND-01RUI03TOTHERAAAAAAAAA1',
  /** A company A interview row whose candidate has no SAGA row (AC-6 "a missing candidate"). */
  ghost: 'CAND-01RUI03TGHOSTAAAAAAAAA1',
};

/** The fields rule 1 lets a feedback-due row carry (PK and SK besides). */
export const ROW_FIELDS = ['PK', 'SK', 'candidate_id', 'done_reason', 'interview_id', 'person_id', 'state', 'tenant_id', 'updated_at'];
/** Attribute names a feedback-due row must never carry (each is a key of an index of the state table). */
export const INDEX_NAMES = ['interviewId', 'candidateId', 'role_id', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK'];

export const duePk = (company: string, person: string) => `FEEDBACK_DUE#${company}#${person}`;
export const dueSk = (cand: string, iv: string) => `CANDIDATE#${cand}#INTERVIEW#${iv}`;

/** A feedback-due row as rule 1 shapes it. */
export function dueRow(company: string, person: string, cand: string, iv: string, state: 'OPEN' | 'DONE' = 'OPEN', extra: Record<string, unknown> = {}): Row {
  return av({
    PK: duePk(company, person), SK: dueSk(cand, iv), tenant_id: company, person_id: person, interview_id: iv, candidate_id: cand, state,
    updated_at: '2026-11-20T08:00:00.000Z', ...(state === 'DONE' ? { done_reason: 'VOTED' } : {}), ...extra,
  } as any);
}
/** Every feedback-due row of the state table (plain values). */
export const dueRows = (t: Tables) => rowsOf(t, TABLE.state).filter((r) => String(r['PK'] ?? '').startsWith('FEEDBACK_DUE#'));
/** One feedback-due row, or undefined. */
export const dueOf = (t: Tables, company: string, person: string, cand: string, iv: string) =>
  dueRows(t).find((r) => r['PK'] === duePk(company, person) && r['SK'] === dueSk(cand, iv));
/** The feedback-due rows pointing at one interview, by person: { [person]: 'OPEN' | 'DONE/<reason>' }. */
export function dueStates(t: Tables, iv: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of dueRows(t).filter((x) => String(x['SK']).endsWith(`#INTERVIEW#${iv}`))) {
    out[String(r['person_id'] ?? String(r['PK']).split('#').pop())] = r['state'] === 'DONE' ? `DONE/${r['done_reason']}` : String(r['state']);
  }
  return out;
}

/**
 * The list route. `extra` may name headers, a query string or a body (all must be ignored) and claims (the sign-in's).
 * With `o.queryPageSize`, the fake DynamoDB answers each Query that many key matches a page with a LastEvaluatedKey (the filter runs
 * after the page is cut, as in DynamoDB), so a read that stops after one page, or lets finished rows use up the limit, is seen. The run
 * then goes straight to REC-14's runHandler with the same settings INT-01's call() uses (no race preload: the list never needs one).
 */
export function due(who: Caller, t: Tables, extra: { headers?: Record<string, string>; query?: Record<string, string>; body?: unknown; claims?: Record<string, unknown> } = {}, o: O & { queryPageSize?: number } = {}): Run {
  const q: Req = { route: ROUTE_DUE, who, path: {}, ...extra } as Req;
  if (!o.queryPageSize) return call(q, t, o);
  return runHandler(fileOf(HANDLER[ROUTE_DUE]!), apiEvent(q), {
    tables: t, secrets: { [AGENT_SECRET]: { AWSCURRENT: 'int01-agent-key' } }, cognito: { users: pool() }, queryPageSize: o.queryPageSize,
    env: {
      ...settings({ ROLES_TABLE_NAME: 'talent-flow-roles', IDEMPOTENCY_TABLE: IDEM_TABLE, TOKEN_TTL_DAYS: '7' }),
      NODE_OPTIONS: `--import=${pathToFileURL(CLOCK).href}`, REC15_NOW: o.now ?? NOW, ...(o.env ?? {}),
    },
    ...(o.fail ? { fail: o.fail } : {}),
  });
}
/** The partition keys (`FEEDBACK_DUE#…`) every list Query of a run asked for, in order. */
export function listPks(r: Run): string[] {
  const out: string[] = [];
  for (const c of r.calls as any[]) {
    if (c.service !== 'dynamodb' || c.op !== 'Query') continue;
    for (const v of Object.values(c.input?.ExpressionAttributeValues ?? {}) as any[]) if (typeof v?.S === 'string' && v.S.startsWith('FEEDBACK_DUE#')) out.push(v.S);
  }
  return out;
}

/** The DynamoDB write calls of a run that touch a feedback-due row, as [op, item kind ('Put' | 'Update' | ...), the item's input]. */
export function dueWrites(r: { calls: any[] }): { op: string; kind: string; input: any; call: any }[] {
  const out: { op: string; kind: string; input: any; call: any }[] = [];
  const isDue = (x: any) => JSON.stringify(x?.Item?.PK ?? x?.Key?.PK ?? '').includes('FEEDBACK_DUE#');
  for (const c of r.calls as any[]) {
    if (c.service !== 'dynamodb') continue;
    if (c.op === 'TransactWriteItems') {
      for (const it of c.input?.TransactItems ?? []) { const kind = Object.keys(it)[0]!; if (isDue(it[kind])) out.push({ op: c.op, kind, input: it[kind], call: c }); }
    } else if (c.op === 'BatchWriteItem') {
      for (const reqs of Object.values(c.input?.RequestItems ?? {}) as any[]) for (const q of reqs) { const x = q.PutRequest?.Item ? { Item: q.PutRequest.Item } : { Key: q.DeleteRequest?.Key }; if (isDue(x)) out.push({ op: c.op, kind: q.PutRequest ? 'Put' : 'Delete', input: x, call: c }); }
    } else if (/^(PutItem|UpdateItem|DeleteItem)$/.test(c.op) && isDue(c.input)) out.push({ op: c.op, kind: c.op.replace('Item', ''), input: c.input, call: c });
  }
  return out;
}
/** The attribute names an update expression names (its #aliases resolved; :values and keywords left out). */
export function namesIn(expr: string, names: Record<string, string> = {}): string[] {
  const resolved = String(expr ?? '').replace(/#[A-Za-z0-9_]+/g, (m) => ` ${names[m] ?? m} `);
  const words = [...resolved.matchAll(/(?<![:\w])[A-Za-z_][A-Za-z0-9_]*/g)].map((m) => m[0]);
  return [...new Set(words.filter((w) => !/^(SET|REMOVE|ADD|DELETE|if_not_exists|list_append)$/i.test(w)))];
}

// ---------------------------------------------------------------- the backfill script against an in-memory DynamoDB

export const BACKFILL = join(REPO, 'scripts', 'tenancy', 'backfill-feedback-due.py');
export type PyCall = { op: string; params: Record<string, any>; error: string | null };
export type PyRun = { code: number; stdout: string; stderr: string; tables: Tables; calls: PyCall[] };

/** Runs the real backfill script once with `args`, over `tables` (AttributeValue form), with writes allowed (put_item honours its condition). */
export function runBackfill(tables: Tables, args: string[], o: { pageSize?: number } = {}): PyRun {
  const dir = mkdtempSync(join(tmpdir(), 'rui03t-py-'));
  const worldFile = join(dir, 'world.json');
  writeFileSync(worldFile, JSON.stringify({ tables, allowWrites: true, pageSize: o.pageSize ?? 3 }));
  const outFile = join(dir, 'out.json');
  let code = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('python3', ['-I', join(__dirname, 'fake-boto3', 'run-script.py'), BACKFILL, ...args], {
      cwd: dir, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env['PATH'] ?? '', HOME: dir, RUI03T_WORLD: worldFile, RUI03T_OUT: outFile, AWS_REGION: 'af-south-1', AWS_DEFAULT_REGION: 'af-south-1',
        AWS_ACCESS_KEY_ID: 'rui03t-fake', AWS_SECRET_ACCESS_KEY: 'rui03t-fake', AWS_EC2_METADATA_DISABLED: 'true', PYTHONDONTWRITEBYTECODE: '1',
      },
    });
  } catch (e: any) {
    code = typeof e.status === 'number' ? e.status : 1;
    stdout = String(e.stdout ?? '');
    stderr = String(e.stderr ?? e.message ?? '');
  }
  let after: { tables: Tables; calls: PyCall[] } = { tables, calls: [] };
  try { after = JSON.parse(readFileSync(outFile, 'utf8')); } catch { /* the runner wrote nothing */ }
  return { code, stdout, stderr, tables: after.tables, calls: after.calls };
}

/** The ids file of the pepla-dev seed (AC-13, AC-14). */
export type DevIds = { candidate: string; interview: string; firstName: string; lastName: string };
export const DEV_IDS_FILE = join(__dirname, 'dev-ids.json');
export const devIdsAll = () => JSON.parse(readFileSync(DEV_IDS_FILE, 'utf8')) as { 'desktop-1280': DevIds; 'phone-390': DevIds; future: DevIds };

/** INT-01's world (each call its own copy). */
export const world = () => world01();
