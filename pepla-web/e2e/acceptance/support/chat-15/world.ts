import { runJob, awsCalls, logLines, type Call, type Opts, type PoolUser, type Row, type Run, type Tables } from './lambda-harness';

/**
 * CHAT-15: the companies, people and tables of the card's acceptance criteria. Written from
 * /mnt/project-files/ask-batsi-chat/CHAT-15-delete-leavers-chats.md and the decisions P-1 to P-14 in cards/chat-15.md.
 *
 *   A  the founding company (LEGACY_TENANT_ID is A in every run unless a test says otherwise).
 *   B  a second company. People of B are leavers or colleagues too: a company-B caller of every rule.
 *
 * People are made up and numbered. Person n has the sign-in id `sub(n)` (36 characters, as Cognito makes it), the staff id `staff(n)`
 * (under 20), the address `email(n)` and the name `Given<n> Family<n>`. Person n of company A and person n of company B are the
 * SAME staff id and the same sub: the company in the chat key is what keeps their chats apart (a "twin").
 */
export const A = 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa';
export const B = 'ten_bbbbbbbbbbbbbbbbbbbbbbbbbb';
export const USERS = 'talent-flow-users';
export const CHATS = 'ask-batsi-chats';
export const AUDIT = 'naleko-agent-audit';
export const TENANTS = 'naleko-people-dev-tenants';
export const POOL_ID = 'af-south-1_Chat15Fake';
export const MINUTE = 60_000;

export const SETTINGS: Record<string, string> = { USERS_TABLE_NAME: USERS, COGNITO_POOL_ID: POOL_ID, CHATS_TABLE: CHATS, AGENT_AUDIT_TABLE: AUDIT, LEGACY_TENANT_ID: A };

export const sub = (n: number) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const staff = (n: number) => `STF${n}`;
export const email = (n: number) => `leaver${n}@example.test`;
export const given = (n: number) => `Given${n}`;
export const family = (n: number) => `Family${n}`;
export const ADMIN_SUB = 'a1b2c3d4-0000-4000-8000-0000000000ad';
export const pk = (company: string, person: string) => `T#${company}#S#${person}`;
const chatId = (n: number) => `01JCHAT15${String(n).padStart(17, '0')}`;

type Plain = string | number | boolean | null | undefined | Plain[] | { [k: string]: Plain };
export function av(values: Record<string, Plain>): Row {
  const one = (v: Plain): Record<string, unknown> =>
    v === null ? { NULL: true }
      : typeof v === 'string' ? { S: v }
        : typeof v === 'number' ? { N: String(v) }
          : typeof v === 'boolean' ? { BOOL: v }
            : Array.isArray(v) ? { L: v.map(one) }
              : { M: Object.fromEntries(Object.entries(v as Record<string, Plain>).filter(([, x]) => x !== undefined).map(([k, x]) => [k, one(x)])) };
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined) out[k] = one(v);
  return out;
}
export function plain(r: Row | undefined): Record<string, any> {
  const one = (a: any): any => (a === undefined ? undefined : 'S' in a ? a.S : 'N' in a ? Number(a.N) : 'BOOL' in a ? a.BOOL : 'NULL' in a ? null : 'SS' in a ? [...a.SS] : 'L' in a ? a.L.map(one) : 'M' in a ? Object.fromEntries(Object.entries(a.M).map(([k, v]) => [k, one(v)])) : a);
  return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, one(v)]));
}

export const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString();

// ---------------------------------------------------------------- people

export type Person = {
  n: number;
  /** The company on the stored row (`tenant_id`). null = a row with no tenant_id at all (a founding-company row from before tenancy). Default A. */
  company?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
  /** Minutes since the admin pressed Deactivate. Default 70. null = the row has no deactivatedAt. */
  minutes?: number | null;
  /** `updatedAt` on the row, minutes ago (it moves whenever the row is touched). Default: the same as `minutes`. */
  updated?: number;
  /** Already cleared by an earlier run. */
  cleared?: boolean;
  /** Does the sign-in pool know them? Default yes. */
  inPool?: boolean;
  /** Is the sign-in still enabled in the pool? Default false (a leaver is disabled). */
  enabled?: boolean;
  /** Does the pool hold a staff id for them? Default yes (staff(n)). false = none. A string = that staff id (a twin of another person). */
  staffId?: boolean | string;
};

export function userRow(p: Person): Row {
  const status = p.status ?? 'INACTIVE';
  const minutes = p.minutes === undefined ? 70 : p.minutes;
  const company = p.company === undefined ? A : p.company;
  return av({
    PK: `USER#${sub(p.n)}`, SK: 'PROFILE', userId: sub(p.n), email: email(p.n), givenName: given(p.n), familyName: family(p.n), fullName: `${given(p.n)} ${family(p.n)}`,
    roles: ['HM'], activeRole: 'HM', status, createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: ago(p.updated ?? minutes ?? 600),
    ...(company === null ? {} : { tenant_id: company }),
    ...(status === 'INACTIVE' && minutes !== null ? { deactivatedAt: ago(minutes), deactivatedBy: ADMIN_SUB } : {}),
    ...(status === 'ACTIVE' && minutes !== null && p.minutes !== undefined ? { deactivatedAt: ago(minutes) } : {}),
    ...(p.cleared ? { chats_deleted_at: ago(20) } : {}),
  });
}
export function poolUser(p: Person): PoolUser {
  return {
    username: email(p.n), sub: sub(p.n), status: 'CONFIRMED', enabled: p.enabled ?? false,
    attributes: { email: email(p.n), ...(p.staffId === false ? {} : { 'custom:staff_id': typeof p.staffId === 'string' ? p.staffId : staff(p.n) }) }, groups: ['hr_staff'],
  };
}

// ---------------------------------------------------------------- chats

export type ChatSpec = { n: number; messages?: number; tag?: string };
/** `n` chats of one person: a header and `messages` messages each (a chat of 6 messages is 7 rows, more than the fake's page of 4). */
export function chatRows(company: string, person: string, count: number, o: { messages?: number; tag?: string; first?: number } = {}): Row[] {
  const out: Row[] = [];
  const tag = o.tag ?? person;
  for (let i = 0; i < count; i++) {
    const id = chatId((o.first ?? 1) + i + [...person].reduce((s, c) => s + c.charCodeAt(0), 0) * 1000 + (company === B ? 500_000 : 0));
    out.push(av({
      pk: pk(company, person), sk: `CHAT#${id}`, chat_id: id, title: `TITLE-MARK-${tag}-${i}`, created: ago(500), updated: ago(400), message_count: o.messages ?? 2,
      tenant_id: company, staff_id: person,
    }));
    for (let m = 1; m <= (o.messages ?? 2); m++) {
      out.push(av({
        pk: pk(company, person), sk: `MSG#${id}#${String(m).padStart(4, '0')}`, role: m % 2 ? 'person' : 'batsi', text: `TEXT-MARK-${tag}-${i}-${m}`, at: ago(399 - m),
        tenant_id: company, chat_id: id,
      }));
    }
  }
  return out;
}
/** How many rows chatRows(company, person, count, { messages }) makes. */
export const rowCount = (count: number, messages = 2) => count * (1 + messages);

// ---------------------------------------------------------------- tables

/** Rows no run of the job may change: other tables, other companies, other people. */
export function others(): Tables {
  return {
    [TENANTS]: [
      av({ pk: `TENANT#${A}`, sk: 'PROFILE', tenant_id: A, name: 'Mokoena Bakeries', status: 'ACTIVE', modules: ['onboarding', 'recruitment', 'ask_batsi'] }),
      av({ pk: `TENANT#${B}`, sk: 'PROFILE', tenant_id: B, name: 'Bontle Logistics', status: 'ACTIVE', modules: ['onboarding', 'ask_batsi'] }),
    ],
    employees: [av({ employee_id: 'emp-1', tenant_id: A, email: 'worker1@example.test', first_name: 'Work', last_name: 'One' })],
    'talent-flow-agent-audit': [av({ pk: `T#${A}#S#${staff(90)}`, sk: ago(3000), action: 'CHAT', tenant_id: A })],
    'naleko-pending-actions': [av({ actionId: 'act-1', tenant_id: A, status: 'PENDING', expiresAt: Math.floor(Date.now() / 1000) + 3600 })],
    'naleko-prompt-cache': [av({ cacheKey: 'cache-1', tenant_id: A, answer: 'CACHED-ANSWER-MARK' })],
    'talent-flow-state': [av({ PK: 'CANDIDATE#1', SK: 'PROFILE', tenant_id: A, fullName: 'Cand One' })],
  };
}

/**
 * The tables of a run. `people` get a row in talent-flow-users; `chats` are stored as given. Colleagues who must stay untouched are
 * ACTIVE people (staff ids 90 and up), one in each company.
 */
export function world(people: Person[], chats: Row[] = [], extra: { users?: Row[]; audit?: Row[] } = {}): Tables {
  return {
    ...others(),
    [USERS]: [...people.map(userRow), userRow({ n: 91, status: 'ACTIVE', minutes: null }), userRow({ n: 92, status: 'ACTIVE', minutes: null, company: B }), ...(extra.users ?? [])],
    [CHATS]: [...chats],
    [AUDIT]: [av({ pk: pk(A, staff(91)), sk: ago(5000), action: 'CHAT_DELETED', conversation_id: chatId(1), tenant_id: A }), ...(extra.audit ?? [])],
  };
}
/** The people of a world in the sign-in pool, with the colleagues too. */
export const pool = (people: Person[]): PoolUser[] => [...people.filter((p) => p.inPool !== false).map(poolUser), poolUser({ n: 91, enabled: true }), poolUser({ n: 92, enabled: true })];

/** Runs the job with the world's settings. */
export function go(people: Person[], chats: Row[], o: Partial<Opts> & { extra?: { users?: Row[]; audit?: Row[] }; tables?: Tables } = {}): Run & { before: Tables } {
  const tables = o.tables ?? world(people, chats, o.extra);
  const run = runJob({ tables, users: o.users ?? pool(people), env: { ...SETTINGS, ...(o.env ?? {}) }, ...(o.event !== undefined ? { event: o.event } : {}), ...(o.fail ? { fail: o.fail } : {}), ...(o.failUsers ? { failUsers: o.failUsers } : {}), ...(o.failUsersMessage ? { failUsersMessage: o.failUsersMessage } : {}), ...(o.stuck ? { stuck: o.stuck } : {}), ...(o.silentKeep ? { silentKeep: o.silentKeep } : {}), ...(o.remaining ? { remaining: o.remaining } : {}), ...(o.pageSize ? { pageSize: o.pageSize } : {}) });
  return { ...run, before: tables };
}
/** The next run, from the tables the last one left and the pool as it was. */
export const again = (last: Run, people: Person[], o: Partial<Opts> = {}): Run & { before: Tables } => go(people, [], { ...o, tables: last.tables, users: last.cognito?.users ?? pool(people) });

// ---------------------------------------------------------------- reading the result

export const rowsOf = (t: Tables, table: string): Row[] => t[table] ?? [];
export const sorted = (rows: Row[]) => rows.map(plain).sort((x, y) => JSON.stringify([x['pk'] ?? x['PK'], x['sk'] ?? x['SK']]).localeCompare(JSON.stringify([y['pk'] ?? y['PK'], y['sk'] ?? y['SK']])));
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** The chat rows under one partition. */
export const chatsOf = (t: Tables, company: string, person: string) => rowsOf(t, CHATS).filter((r) => (r['pk'] as any)?.S === pk(company, person));
export const userOf = (t: Tables, n: number) => plain(rowsOf(t, USERS).find((r) => (r['PK'] as any)?.S === `USER#${sub(n)}`));
export const isCleared = (t: Tables, n: number) => userOf(t, n)['chats_deleted_at'] !== undefined;
export const auditRows = (t: Tables) => rowsOf(t, AUDIT).map(plain).filter((r) => r['action'] === 'LEAVER_CHATS_DELETED');
/** Every table but the named ones, as plain sorted rows. */
export function exceptTables(t: Tables, ...names: string[]) {
  return Object.fromEntries(Object.entries(t).filter(([k]) => !names.includes(k)).map(([k, v]) => [k, sorted(v)]));
}

const WRITES = /^(PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems)$/;
export const writesOf = (calls: Call[]) => calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb' && WRITES.test(c.op));
export const cognitoCalls = (calls: Call[]) => calls.filter((c) => c.service === 'cognito') as Extract<Call, { service: 'cognito' }>[];
export const chatQueries = (calls: Call[]) => calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb' && c.table === CHATS && c.op === 'Query');
/** The partition key a chats-table Query asked for. */
export const queriedPk = (c: Extract<Call, { service: 'dynamodb' }>) => c.input?.ExpressionAttributeValues?.[':pk']?.S ?? c.input?.ExpressionAttributeValues?.[':p']?.S ?? JSON.stringify(c.input?.ExpressionAttributeValues ?? {});
/** The partition keys a BatchWriteItem touches, and what it does to them. */
export function batchKeys(c: Extract<Call, { service: 'dynamodb' }>): { table: string; kind: string; pk?: string }[] {
  return Object.entries(c.input?.RequestItems ?? {}).flatMap(([table, reqs]) => (reqs as any[]).map((r) => ({ table, kind: r.PutRequest ? 'Put' : r.DeleteRequest ? 'Delete' : '?', pk: r.PutRequest?.Item?.pk?.S ?? r.DeleteRequest?.Key?.pk?.S })));
}
export { awsCalls, logLines };
