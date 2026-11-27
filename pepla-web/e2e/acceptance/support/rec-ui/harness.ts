import type { BrowserContext, Page, Route } from '@playwright/test';
import { icons as LUCIDE } from 'lucide';
import type { CognitoFake, FakeAccount } from '../cognito-fake';
import { EmployeesFake } from '../employees-fake';
import { FAKE, ON_DEV, expect, test as base, type SignInPage } from '../fixtures';
import { ModulesFake, isModulesCall, type Company } from '../mod-02/modules-fake';
import { answerSchema, checker, operation, readDoc, type Doc } from '../rec-14/schema';

/**
 * The shared harness of the Recruitment screen cards (REC-UI-01 to REC-UI-06; Jira NH-227, epic NH-223).
 * Spec: onboarding-cards/specs/REC-UI-00.md (rules) and REC-UI-01.md (this card owns the file).
 * Later cards import it and never edit it; a change is a child lock on REC-UI-01 (rec-ui-01.N).
 *
 * What it holds:
 *   - the people of every card: a Recruiter, a second Recruiter, HR without the tick, the tick without HR, a hiring
 *     manager, an Admin, an Employee, in companies A (onboarding + recruitment), B (onboarding) and C (nothing);
 *   - the fake API of this card, generated from the contract table of REC-UI-01.md (D-API-1): roles, candidates,
 *     the stage move, Not hired (and confirm / cancel), old-system rows, hiring managers and the company settings.
 *     It answers any host whose path matches; it needs a sign-in token; it records every call it gets;
 *   - small helpers: sign in as a person, the console-error watcher, the "no company id" text check.
 *
 * Child lock rec-ui-01.3 (REC-UI-02, decision D-T-A12): `GET /v1/candidates` answers exactly what the real list sends
 * (REC-15 step A, api/openapi.yaml CandidateList and CandidateRow), checked against the file like the rule 14 routes:
 * no interviews_done, interviews_required, offer_state or pending on a row; the server's order, page (`limit`, `nextToken`)
 * and its 400 INVALID_FIELD refusals (a search of only spaces or over 100 characters among them). Not hired answers
 * as the real REC-02 does: `{ candidateId, pending: true, awaiting: { kind, personId? } }`, with no name in it.
 * A failure a test sets up with `refuse()` stands for a gateway or network failure and is not checked against the file.
 *
 * Child lock rec-ui-01.6 (REC-UI-01.6, NH-291 rule 1, D-RUI-01.6a and g): every row also carries `not_hired_pending`, as the real list
 * sends it: null when nothing waits, else `{ awaiting: { kind: 'HIRING_MANAGER', personId } }` or `{ awaiting: { kind: 'HR' } }`, and
 * nothing more (never who recorded it, the reason, when, the note or a name). A waiting HIRING_MANAGER decision with no person id is
 * sent as kind HR, as the real list does. So after a reload, or for another person, the board knows a decision is waiting.
 *
 * REC-14 rule 17 (child lock rec-ui-01.2): the fake cannot drift from api/openapi.yaml.
 *   - every request to a method and path the file does not have, or without a `required` query parameter, is refused
 *     and written to `contractErrors` (so today's `GET /v1/config` with no `configType` fails here as it fails for real);
 *   - every answer on a rule 14 route (CONTRACT_ROUTES) and the body of `POST /v1/roles` are checked against the file;
 *   - the choices of the Open a role page are one `GET /v1/roles/options` answer (`world.options`), checked at load;
 *   - a test ends red when `contractErrors` is not empty (the fixture checks it after the test).
 *
 * Nothing here calls Bedrock or any paid AI. Nothing here knows a screen: screens are found by their words.
 */

// ---------------------------------------------------------------- the people

export type Co = Company;
export const PASSWORD = 'winter-protea-2026';
const SUNBIRD = 'sunbird-bakery.co.za';

export type Who = FakeAccount & {
  password: string;
  company: Co;
  /** Where the app sends this person after sign-in today; null when sign-in is refused (ONB-23: not hr_staff or employee). */
  lands: '/hr' | '/start' | '/admin/ask-batsi' | null;
  /** The person's own name as the board and the "must confirm" line write it. */
  full: string;
};
const person = (email: string, given: string, family: string, groups: string[], company: Co, lands: Who['lands']): Who => ({
  email: `${email}@${SUNBIRD}`, givenName: given, familyName: family, groups, password: PASSWORD, company, lands, full: `${given} ${family}`,
});

export const WHO = {
  /** A Recruiter: hr_staff AND the Recruitment tick (C-1). The one the happy paths use. */
  recruiterA: person('thandi.dube', 'Thandi', 'Dube', ['hr_staff', 'perm-recruitment'], 'A', '/hr'),
  /** A second Recruiter of A: the person who confirms a Not hired that someone else recorded. */
  recruiter2A: person('naledi.zungu', 'Naledi', 'Zungu', ['hr_staff', 'perm-recruitment'], 'A', '/hr'),
  recruiterB: person('sipho.zulu', 'Sipho', 'Zulu', ['hr_staff', 'perm-recruitment'], 'B', '/hr'),
  recruiterC: person('lerato.molefe', 'Lerato', 'Molefe', ['hr_staff', 'perm-recruitment'], 'C', '/hr'),
  /** HR without the tick (Jane Smith of the other cards, company A). */
  hrNoTickA: { ...FAKE.hr, password: PASSWORD, company: 'A' as Co, lands: '/hr' as const, full: 'Jane Smith' },
  /** The tick without HR: an employee who holds perm-recruitment. */
  tickOnlyA: person('kabelo.nkosi', 'Kabelo', 'Nkosi', ['employee', 'perm-recruitment'], 'A', '/start'),
  /** A hiring manager (group manager). Today ONB-23 refuses this group at sign-in; see cards/rec-ui-01.md. */
  managerA: person('refilwe.sithole', 'Refilwe', 'Sithole', ['manager', 'perm-recruitment'], 'A', null),
  adminA: person('anele.khoza', 'Anele', 'Khoza', ['admin'], 'A', '/admin/ask-batsi'),
  employeeA: { ...FAKE.employee, password: PASSWORD, company: 'A' as Co, lands: '/start' as const, full: 'John Doe' },
} satisfies Record<string, Who>;

/** Values that must never travel in a request: each company's own identifier (tenancy: the company is the token's). */
export const COMPANY_ID: Record<Co, string> = { A: 'tnt-a-4c1e9b27', B: 'tnt-b-9d27f0c3', C: 'tnt-c-61b0a8e5' };

// ---------------------------------------------------------------- the data

export const STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'] as const;
export type Stage = (typeof STAGES)[number] | 'NOT_HIRED';
export const STAGE_WORDS: Record<(typeof STAGES)[number], string> = { APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview', OFFER: 'Offer', HIRED: 'Hired' };
export type Sla = 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE';

/** The eight approved reasons, in the approved order: [code, words]. */
export const REASONS: ReadonlyArray<[string, string]> = [
  ['NOT_RIGHT_SKILLS', 'Not the right skills'], ['NOT_RIGHT_EXPERIENCE', 'Not the right experience'], ['CHOSE_ANOTHER', 'Chose another candidate'],
  ['WITHDREW', 'Candidate withdrew'], ['SALARY_MISMATCH', 'Salary did not match'], ['DID_NOT_ATTEND', 'Did not attend'], ['ROLE_CLOSED', 'Role closed'], ['OTHER', 'Other'],
];

type Pending = { by: string; reason: string; awaiting: { kind: 'HIRING_MANAGER' | 'HR'; personId?: string; name?: string } };
/**
 * A candidate as the fake server stores it. interviews_done, interviews_required and offer_state stay on the server side
 * (the move rules use them); the list never sends them (CandidateRow). `role_id` '' is a candidate with no role yet,
 * whose company is then `company`. `due_at` and `sla_status` are what the server's stage clock gives at `now`.
 */
export type Cand = {
  id: string; name: string; stage: Stage; source?: string; level: string; role_id: string; email: string;
  stage_entered_at: string; due_at: string | null; sla_status: Sla; interviews_done?: number; interviews_required?: number; offer_state?: string;
  mine?: boolean; not_hired_reason?: string; pending?: Pending; old_system?: boolean; applied_at?: string; company?: Co; role_title?: string;
};
export type Role = {
  role_id: string; job_title: string; department: string; department_id?: string; level: string; hiring_manager_id: string; hiring_manager_name: string;
  opened_at: string; status: 'OPEN' | 'CLOSED'; criteria: string[]; panel_size: number; company: Co;
};
export type Manager = { id: string; name: string };

/** The one answer of `GET /v1/roles/options` (api/openapi.yaml `RoleOptions`, REC-14 rule 10). */
export type Options = {
  departments: Array<{ id: string; name: string }>;
  levels: Array<{ key: string; label: string; order: number }>;
  criteria: Array<{ key: string; label: string }>;
  panel_size_by_level: Record<string, number>;
  screening: boolean;
  hiring_managers: Manager[];
};

/** A department id as the server makes it: dep_ and 26 characters of Crockford base 32 (`Department.id` pattern). */
export const depId = (n: number): string => `dep_01JDC${String(n).padStart(21, '0')}`;
/** The REC-12 defaults the server falls back on (lambda/shared/recruitment-settings.mjs DEFAULTS). */
export const DEFAULT_LEVELS = [{ key: 'JUNIOR', label: 'Junior', order: 1 }, { key: 'MID', label: 'Mid', order: 2 }, { key: 'SENIOR', label: 'Senior', order: 3 }];
export const DEFAULT_CRITERIA = [{ key: 'technical', label: 'Technical' }, { key: 'communication', label: 'Communication' }, { key: 'culturalFit', label: 'Cultural fit' }, { key: 'problemSolving', label: 'Problem solving' }];
export const DEFAULT_PANEL = { JUNIOR: 2, MID: 3, SENIOR: 4 };
/** Company A's departments (the Q-1 four and Fleet), by name, as the options answer lists them. */
export const DEPT = {
  engineering: { id: depId(1), name: 'Engineering' }, finance: { id: depId(2), name: 'Finance' }, fleet: { id: depId(3), name: 'Fleet' },
  operations: { id: depId(4), name: 'Operations' }, people: { id: depId(5), name: 'People' },
  dispatchB: { id: depId(11), name: 'Dispatch' }, storesB: { id: depId(12), name: 'Stores' }, bakeryC: { id: depId(21), name: 'Bakery' },
};

const DAY = 86_400_000;
export const iso = (ms: number) => new Date(ms).toISOString();

export type World = { now: number; roles: Role[]; cands: Cand[]; options: Record<Co, Options> };

/** The kit's data (recruitment.html at the pinned design system ref), with times counted from `now`. Company A has three roles. */
export function seed(now: number): World {
  const opts = (departments: Options['departments'], hiring_managers: Manager[]): Options => ({
    departments, levels: DEFAULT_LEVELS.map((l) => ({ ...l })), criteria: DEFAULT_CRITERIA.map((c) => ({ ...c })), panel_size_by_level: { ...DEFAULT_PANEL }, screening: true,
    hiring_managers: [...hiring_managers].sort((x, y) => x.name.toLowerCase().localeCompare(y.name.toLowerCase())),
  });
  const role = (company: Co, id: string, title: string, dept: string, level: string, hm: Manager, opened: string): Role => ({
    role_id: id, job_title: title, department: dept, level, hiring_manager_id: hm.id, hiring_manager_name: hm.name, opened_at: opened, status: 'OPEN',
    criteria: DEFAULT_CRITERIA.map((x) => x.key), panel_size: 3, company,
  });
  const managers: Record<Co, Manager[]> = {
    A: [{ id: 'hm-sipho', name: 'Sipho Ndlovu' }, { id: 'hm-farai', name: 'Farai Chikwanha' }, { id: 'hm-precious', name: 'Precious Mwale' }],
    B: [{ id: 'hm-b-lindiwe', name: 'Lindiwe Peters' }],
    C: [{ id: 'hm-c-themba', name: 'Themba Radebe' }],
  };
  const [sipho, farai, precious] = managers.A as [Manager, Manager, Manager];
  const roles: Role[] = [
    role('A', 'role-fleet', 'Fleet controller', 'Operations', 'MID', sipho, '2026-10-12T08:00:00.000Z'),
    role('A', 'role-warehouse', 'Warehouse supervisor', 'Operations', 'SENIOR', farai, '2026-10-20T08:00:00.000Z'),
    role('A', 'role-accountant', 'Senior accountant', 'Finance', 'SENIOR', precious, '2026-10-28T08:00:00.000Z'),
    role('B', 'role-b-dispatch', 'Dispatch lead', 'Operations', 'MID', managers.B[0]!, '2026-10-14T08:00:00.000Z'),
    role('C', 'role-c-baker', 'Head baker', 'Operations', 'MID', managers.C[0]!, '2026-10-16T08:00:00.000Z'),
  ];
  const c = (id: string, name: string, stage: Stage, role_id: string, extra: Partial<Cand> = {}): Cand => ({
    id, name, stage, role_id, level: 'MID', email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.org`,
    stage_entered_at: iso(now - DAY), due_at: iso(now + 4 * DAY), sla_status: 'ON_TRACK', ...extra,
  });
  const cands: Cand[] = [
    // The six of the kit's board for Fleet controller (company A).
    // rec-ui-01.3: the list comes in the server's order (most urgent first), so the due dates keep the kit's order on the board.
    c('cand-amahle', 'Amahle Dlamini', 'APPLIED', 'role-fleet', { source: 'Referral', mine: true, due_at: iso(now + 3 * DAY) }),
    c('cand-tariro', 'Tariro Moyo', 'SCREENING', 'role-fleet', { mine: true, due_at: iso(now + 3.5 * DAY) }),
    c('cand-ayanda', 'Ayanda Mkhize', 'SCREENING', 'role-fleet', { stage_entered_at: iso(now - 2 * DAY) }),
    // rec-ui-01.3 (REC-UI-02 lock check B4): a real row past Applied applied before it entered its stage; two rows show it.
    c('cand-bongani', 'Bongani Mthembu', 'INTERVIEW', 'role-fleet', { interviews_done: 2, interviews_required: 3, sla_status: 'OVERDUE', due_at: iso(now - 2 * DAY), mine: true, applied_at: '2026-11-04T08:00:00.000Z' }),
    c('cand-tendai', 'Tendai Ncube', 'INTERVIEW', 'role-fleet', { interviews_done: 1, interviews_required: 2, sla_status: 'DUE_SOON', due_at: iso(now + 3 * 3_600_000) }),
    c('cand-kagiso', 'Kagiso Molefe', 'OFFER', 'role-fleet', { offer_state: 'SENT', applied_at: '2026-10-28T08:00:00.000Z' }),
    // Not hired, and old-system rows (company A).
    c('cand-nomvula', 'Nomvula Zulu', 'NOT_HIRED', 'role-fleet', { not_hired_reason: 'NOT_RIGHT_SKILLS' }),
    c('cand-farai-m', 'Farai Moyo', 'NOT_HIRED', 'role-fleet', { not_hired_reason: 'WITHDREW' }),
    c('cand-os-1', 'Mpho Sithole', 'NOT_HIRED', 'role-warehouse', { old_system: true, applied_at: '2026-10-12T08:00:00.000Z' }),
    // Warehouse supervisor: four open candidates; Senior accountant: three (one due soon).
    c('cand-w1', 'Lwazi Buthelezi', 'APPLIED', 'role-warehouse'), c('cand-w2', 'Zanele Pillay', 'SCREENING', 'role-warehouse'),
    c('cand-w3', 'Pule Maseko', 'INTERVIEW', 'role-warehouse', { interviews_done: 1, interviews_required: 2 }), c('cand-w4', 'Dineo Kruger', 'OFFER', 'role-warehouse', { offer_state: 'DRAFT' }),
    c('cand-s1', 'Karabo Jacobs', 'APPLIED', 'role-accountant'), c('cand-s2', 'Ntombi Dlamini', 'SCREENING', 'role-accountant'),
    c('cand-s3', 'Vusi Naidoo', 'INTERVIEW', 'role-accountant', { interviews_done: 0, interviews_required: 2, sla_status: 'DUE_SOON', due_at: iso(now + DAY) }),
    // Another company's people: nobody of A may ever read them.
    c('cand-b1', 'Hlengiwe Sibiya', 'APPLIED', 'role-b-dispatch'), c('cand-b2', 'Mandla Cele', 'INTERVIEW', 'role-b-dispatch', { interviews_done: 1, interviews_required: 2 }),
    c('cand-c1', 'Palesa Mofokeng', 'APPLIED', 'role-c-baker'),
  ];
  const options: Record<Co, Options> = {
    A: opts([DEPT.engineering, DEPT.finance, DEPT.fleet, DEPT.operations, DEPT.people], managers.A),
    B: opts([DEPT.dispatchB, DEPT.storesB], managers.B),
    C: opts([DEPT.bakeryC], managers.C),
  };
  // Fake answers are built from a fixture that is itself checked against the file (rule 17).
  for (const [co, o] of Object.entries(options)) {
    const problems = contract().check(contract().schemas('RoleOptions'), o);
    if (problems.length) throw new Error(`harness: the options fixture of company ${co} does not match api/openapi.yaml RoleOptions: ${problems.join('; ')}`);
  }
  return { now, roles, cands, options };
}

// ---------------------------------------------------------------- the contract (REC-14 rule 17)

/** The routes of REC-14 rule 14: every answer the fake gives on them is checked against api/openapi.yaml. */
export const CONTRACT_ROUTES = ['GET /v1/roles/options', 'GET /v1/company/departments', 'POST /v1/admin/company/departments', 'PATCH /v1/admin/company/departments/{id}', 'POST /v1/roles', 'GET /v1/candidates'];

type Contract = { doc: Doc; check: (schema: unknown, value: unknown) => string[]; schemas: (name: string) => unknown };
let CONTRACT: Contract | null = null;
/** api/openapi.yaml, read once per worker. */
export function contract(): Contract {
  if (!CONTRACT) {
    const doc = readDoc();
    const c = checker(doc);
    CONTRACT = { doc, check: (schema, value) => c.check(schema, value), schemas: (name) => ({ $ref: `#/components/schemas/${name}` }) };
  }
  return CONTRACT;
}

/** The file's route key ("GET /v1/roles/{id}") for a request, or null when the file has no such method and path. */
export function routeOf(method: string, pathname: string): string | null {
  const path = pathname.slice(Math.max(0, pathname.indexOf('/v1/')));
  const paths = Object.keys(contract().doc.paths ?? {});
  const fits = (t: string) => new RegExp(`^${t.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path);
  // A written path ("/v1/roles/options") wins over a template ("/v1/roles/{id}"), as API Gateway does.
  const has = (t: string) => !!operation(contract().doc, `${method} ${t}`);
  const match = paths.find((t) => !t.includes('{') && t === path && has(t)) ?? paths.find((t) => t.includes('{') && fits(t) && has(t));
  return match ? `${method} ${match}` : null;
}

/** What is wrong with a request in the file's eyes: no such route, or a `required` query parameter missing. Empty when it is fine. */
export function requestProblems(method: string, pathname: string, query: Record<string, string>): string[] {
  const route = routeOf(method, pathname);
  if (!route) return [`${method} ${pathname}: api/openapi.yaml has no such route`];
  const params = (operation(contract().doc, route)?.parameters ?? []) as Array<{ name: string; in: string; required?: boolean }>;
  return params.filter((p) => p.in === 'query' && p.required && !(p.name in query)).map((p) => `${route}: the required query parameter ${p.name} is missing`);
}

/** What is wrong with an answer on a rule 14 route (empty when it passes, or when the route is not one of them). */
export function answerProblems(route: string, status: number, body: unknown): string[] {
  if (!CONTRACT_ROUTES.includes(route)) return [];
  const schema = answerSchema(contract().doc, route, status);
  if (!schema) return [`${route} ${status}: api/openapi.yaml describes no such answer`];
  return contract().check(schema, body).map((p) => `${route} ${status}: ${p}`);
}

/** What is wrong with the body of `POST /v1/roles` (the request side of rule 14). */
export function roleBodyProblems(body: unknown): string[] {
  const schema = operation(contract().doc, 'POST /v1/roles')?.requestBody?.content?.['application/json']?.schema;
  return contract().check(schema, body).map((p) => `POST /v1/roles body: ${p}`);
}

/** An empty company: no roles at all (the empty state of the Roles page). */
export function withoutRoles(w: World, co: Co): void {
  w.roles = w.roles.filter((r) => r.company !== co);
  w.cands = w.cands.filter((c) => w.roles.some((r) => r.role_id === c.role_id));
}

// ---------------------------------------------------------------- the fake API

export type Call = {
  seq: number; method: string; path: string; query: Record<string, string>; idempotencyKey: string | null; body: unknown;
  authorization: string | null; email: string | null; company: Co | null; raw: string; status: number;
};

/** How a request is answered instead of the table's answer (a failure test sets one). */
export type Refusal = { method: string; path: RegExp; status?: number; body?: unknown; abort?: boolean; once?: boolean; hold?: boolean; skipTimes?: number };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
const ROUTES = /\/v1\/(roles|candidates|hiring-managers|config|company\/departments|admin\/company\/departments)(\/|$)/;
export const isHireCall = (url: URL): boolean => ROUTES.test(url.pathname);

export class HireFake {
  readonly calls: Call[] = [];
  /** Requests and answers that break api/openapi.yaml (rule 17). The fixture fails the test when this is not empty. */
  readonly contractErrors: string[] = [];
  world: World;
  /** A test shows that the tab numbers come from the answer, not from the cards the page holds. */
  countsOverride: Partial<Record<'all' | 'mine' | 'overdue' | 'due_soon' | 'not_hired', number>> | null = null;
  private readonly emails = new Map<string, Who>();
  private readonly refusals: Refusal[] = [];
  private readonly held: Array<() => void> = [];
  private readonly keyed = new Map<string, { status: number; body: unknown }>();
  private seq = 0;
  private nextRole = 1;

  constructor(private readonly subOf: (email: string) => string | undefined, now: number) {
    this.world = seed(now);
  }

  assign(who: Who): void {
    this.emails.set(who.email.toLowerCase(), who);
  }

  /** Answers the next matching calls with this instead (once by default). */
  refuse(r: Refusal): void {
    this.refusals.push({ once: true, ...r });
  }

  /** Lifts every refusal still waiting (a test that refused with `once: false` lets the server answer again). */
  lift(): void {
    this.refusals.length = 0;
  }

  /** Lets every held call answer. */
  release(): void {
    for (const go of this.held.splice(0)) go();
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => isHireCall(url), (route) => this.handle(route));
  }

  /** The calls to one route (method and path pattern), in order. */
  to(method: string, path: RegExp): Call[] {
    return this.calls.filter((c) => c.method === method && path.test(c.path));
  }

  /** Calls that reached a Recruitment route at all (for the people who must make none). */
  get recruitmentCalls(): Call[] {
    return this.calls.filter((c) => c.method !== 'OPTIONS');
  }

  private who(sub: string | null): Who | null {
    if (!sub) return null;
    for (const [email, who] of this.emails) if (this.subOf(email) === sub) return who;
    return null;
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const authorization = request.headers()['authorization'] ?? null;
    const who = authorization && JWT.test(authorization) ? this.who(subOfBearer(authorization)) : null;
    const raw = `${request.method()} ${url.pathname}${url.search}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ''}`;
    let body: unknown = null;
    try { body = request.postData() ? JSON.parse(request.postData()!) : null; } catch { body = request.postData(); }
    const call: Call = {
      seq: ++this.seq, method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), idempotencyKey: request.headers()['idempotency-key'] ?? null,
      body, authorization, email: who?.email ?? null, company: who?.company ?? null, raw, status: 0,
    };
    this.calls.push(call);

    const refusal = this.refusals.find((r) => r.method === call.method && r.path.test(call.path) && !(r.skipTimes && r.skipTimes-- > 0));
    if (refusal) {
      if (refusal.once) this.refusals.splice(this.refusals.indexOf(refusal), 1);
      if (refusal.hold) await new Promise<void>((go) => this.held.push(go));
      if (refusal.abort) { call.status = -1; return route.abort('internetdisconnected'); }
      if (!refusal.hold || refusal.status) return this.send(route, call, refusal.status ?? 500, refusal.body ?? { error: 'Internal Server Error' }, false);
    }
    if (!authorization || !JWT.test(authorization)) return this.send(route, call, 401, { message: 'Unauthorized' });
    if (!who) return this.send(route, call, 403, { error: 'Forbidden' });
    const wrong = requestProblems(call.method, call.path, call.query);
    if (wrong.length) {
      this.contractErrors.push(...wrong);
      return this.send(route, call, wrong[0]!.includes('no such route') ? 404 : 400, wrong[0]!.includes('no such route') ? { message: 'Not Found' } : { error: 'Bad request' });
    }
    const [status, answer] = this.route(call, who);
    return this.send(route, call, status, answer);
  }

  private send(route: Route, call: Call, status: number, body: unknown, checked = true): Promise<void> {
    call.status = status;
    const key = routeOf(call.method, call.path);
    if (key && checked) this.contractErrors.push(...answerProblems(key, status, body));
    return route.fulfill({ status, headers: { ...CORS, 'cache-control': 'private, no-store', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  // ---- the contract table of REC-UI-01.md, one branch per row
  private route(call: Call, who: Who): [number, unknown] {
    const recruiter = who.groups.includes('hr_staff') && who.groups.includes('perm-recruitment');
    const w = this.world;
    const mine = (r: Role) => r.company === who.company;
    const forbidden: [number, unknown] = [403, { error: 'Forbidden', code: 'FORBIDDEN' }];
    const notFound: [number, unknown] = [404, { error: 'Not found', code: 'NOT_FOUND' }];
    const { method, path, query } = call;
    let m: RegExpExecArray | null;

    // Before /v1/roles/{id}: a written path wins over a template.
    if (path.endsWith('/v1/roles/options') && method === 'GET') {
      if (!recruiter) return [403, { error: 'Forbidden' }];
      return [200, w.options[who.company]];
    }
    if (path.endsWith('/v1/roles') && method === 'GET') {
      if (!recruiter) return forbidden;
      return [200, { roles: w.roles.filter((r) => mine(r) && r.status === (query['status'] ?? 'OPEN')).map((r) => this.roleRow(r)) }];
    }
    if (path.endsWith('/v1/roles') && method === 'POST') {
      if (!recruiter) return forbidden;
      if (!call.idempotencyKey) return [400, { error: 'Bad request', code: 'IDEMPOTENCY_KEY_REQUIRED' }];
      // A re-sent key returns the first answer and never writes again; another caller's key is a different key.
      const memo = `${who.company}|${who.email}|POST roles|${call.idempotencyKey}`;
      const seen = this.keyed.get(memo);
      if (seen) return [seen.status, seen.body];
      this.contractErrors.push(...roleBodyProblems(call.body));
      const b = (call.body ?? {}) as Record<string, unknown>;
      const o = w.options[who.company];
      const bad = (code: string, field?: string): [number, unknown] => [400, { error: 'Bad request', code, ...(field ? { field } : {}) }];
      // The server's checks (REC-14 rule 11, REC-04): what the options answer offers is what is accepted, nothing else.
      if (typeof b['job_title'] !== 'string' || !b['job_title'].trim()) return bad('INVALID_FIELD', 'job_title');
      const dep = o.departments.find((d) => d.id === b['department_id']);
      if (!dep) return bad('INVALID_DEPARTMENT');
      const level = o.levels.find((l) => l.key === b['level']);
      if (!level) return bad('INVALID_FIELD', 'level');
      const hm = o.hiring_managers.find((x) => x.id === b['hiring_manager_id']);
      if (!hm) return bad('INVALID_HIRING_MANAGER');
      const crit = Array.isArray(b['criteria']) ? (b['criteria'] as unknown[]).map((c) => {
        const d = o.criteria.find((x) => x.key === c);
        return d ? { ...d } : { key: String(c).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: String(c).trim() };
      }) : o.criteria.map((x) => ({ ...x }));
      const panel = typeof b['panel_size'] === 'number' ? b['panel_size'] : o.panel_size_by_level[level.key] ?? 3;
      const role: Role = {
        role_id: `role-new-${this.nextRole++}`, job_title: b['job_title'].trim(), department: dep.name, department_id: dep.id, level: level.key,
        hiring_manager_id: hm.id, hiring_manager_name: hm.name, opened_at: iso(w.now), status: 'OPEN',
        criteria: crit.map((x) => x.key), panel_size: panel, company: who.company,
      };
      w.roles.push(role);
      // The answer is the real one's shape (api/openapi.yaml Role), not the list row this fake uses elsewhere.
      const answer = {
        role_id: role.role_id, job_title: role.job_title, department_id: dep.id, department: dep.name, level: role.level, hiring_manager_id: hm.id,
        criteria: crit, panel_size: panel, status: 'OPEN', opened_at: role.opened_at, opened_by: this.subOf(who.email) ?? 'unknown', legacy: false,
        candidate_count: 0, overdue_count: 0, due_soon_count: 0,
      };
      this.keyed.set(memo, { status: 201, body: answer });
      return [201, answer];
    }
    if ((m = /\/v1\/roles\/([^/]+)$/.exec(path)) && method === 'GET') {
      if (!recruiter) return forbidden;
      const r = w.roles.find((x) => x.role_id === decodeURIComponent(m![1]!));
      if (!r || !mine(r)) return notFound;
      return [200, { ...this.roleRow(r), criteria: r.criteria, panel_size: r.panel_size }];
    }
    if ((m = /\/v1\/roles\/([^/]+)\/close$/.exec(path)) && method === 'POST') {
      if (!recruiter) return forbidden;
      const r = w.roles.find((x) => x.role_id === decodeURIComponent(m![1]!));
      if (!r || !mine(r)) return notFound;
      const open = w.cands.filter((c) => c.role_id === r.role_id && STAGES.includes(c.stage as never) && c.stage !== 'HIRED').length;
      if (open > 0) return [409, { error: 'Open candidates', code: 'OPEN_CANDIDATES', open_candidates: open }];
      r.status = 'CLOSED';
      return [200, { ...this.roleRow(r), criteria: r.criteria, panel_size: r.panel_size }];
    }
    if (path.endsWith('/v1/candidates/old-system') && method === 'GET') {
      if (!recruiter) return forbidden;
      return [200, { candidates: w.cands.filter((c) => c.old_system && this.roleCompany(c.role_id) === who.company).map((c) => ({ candidate_id: c.id, name: c.name, role_id: c.role_id, role_title: this.title(c.role_id), rejected_at: c.applied_at })) }];
    }
    if (path.endsWith('/v1/candidates') && method === 'GET') {
      // REC-15 step A (lambda/shared/recruitment-actions/candidate-list.mjs): one list for one role or all roles.
      if (!recruiter) return [403, { error: 'Forbidden' }];
      const bad = (field: string): [number, unknown] => [400, { error: 'Bad request', code: 'INVALID_FIELD', field }];
      if (query['stage'] !== undefined && !['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'NOT_HIRED'].includes(query['stage'])) return bad('stage');
      if (query['sla_status'] !== undefined && !['ON_TRACK', 'DUE_SOON', 'OVERDUE'].includes(query['sla_status'])) return bad('sla_status');
      if (query['mine'] !== undefined && query['mine'] !== 'true') return bad('mine');
      if (query['limit'] !== undefined && !(/^\d+$/.test(query['limit']) && Number(query['limit']) >= 1 && Number(query['limit']) <= 100)) return bad('limit');
      let search: string | null = null;
      if (query['search'] !== undefined) {
        search = query['search'].trim().toLowerCase();
        if (!search || search.length > 100) return bad('search');
      }
      let after: Pos | null = null;
      if (query['nextToken'] !== undefined) {
        after = readToken(query['nextToken']);
        if (!after) return bad('nextToken');
      }
      const limit = query['limit'] ? Number(query['limit']) : 100;
      const roleId = query['role_id'];
      const inCompany = w.cands.filter((c) => this.companyOf(c) === who.company && !c.old_system);
      const rows = roleId ? inCompany.filter((c) => c.role_id === roleId) : inCompany;
      const live = rows.filter((c) => c.stage !== 'NOT_HIRED');
      const counts = {
        all: live.length, mine: live.filter((c) => c.mine).length, overdue: live.filter((c) => this.slaOf(c) === 'OVERDUE').length,
        due_soon: live.filter((c) => this.slaOf(c) === 'DUE_SOON').length, not_hired: rows.length - live.length,
      };
      const shown = { ...counts, ...(this.countsOverride ?? {}) };
      let list = query['stage'] === 'NOT_HIRED' ? rows.filter((c) => c.stage === 'NOT_HIRED') : live;
      if (query['stage'] && query['stage'] !== 'NOT_HIRED') list = list.filter((c) => c.stage === query['stage']);
      if (query['sla_status']) list = list.filter((c) => this.slaOf(c) === query['sla_status']);
      if (query['mine'] === 'true') list = list.filter((c) => c.mine);
      if (search) { const q = search; list = list.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || (this.candRow(c).role_title ?? '').toLowerCase().includes(q)); }
      list = [...list].sort((a, b) => cmpPos(posOf(a), posOf(b)));
      if (after) { const from = after; list = list.filter((c) => cmpPos(posOf(c), from) > 0); }
      const page = list.slice(0, limit);
      const body: { candidates: unknown[]; counts: typeof shown; nextToken?: string } = { candidates: page.map((c) => this.candRow(c)), counts: shown };
      if (list.length > limit) body.nextToken = writeToken(posOf(page[page.length - 1]!));
      return [200, body];
    }
    if ((m = /\/v1\/candidates\/([^/]+)\/stage$/.exec(path)) && method === 'PUT') {
      if (!recruiter) return forbidden;
      const c = this.cand(m[1]!, who);
      if (!c) return notFound;
      if (!call.idempotencyKey) return [400, { error: 'Idempotency-Key required', code: 'IDEMPOTENCY_KEY_REQUIRED' }];
      const memo = `${who.company}|${who.email}|PUT stage ${c.id}|${call.idempotencyKey}`;
      const seen = this.keyed.get(memo);
      if (seen) return [seen.status, seen.body];
      const b = (call.body ?? {}) as { to?: string; reason?: string };
      const reply = (status: number, body: unknown): [number, unknown] => { this.keyed.set(memo, { status, body }); return [status, body]; };
      if (!b.reason || !b.reason.trim()) return reply(400, { error: 'Reason required', code: 'REASON_REQUIRED' });
      if (c.stage === 'NOT_HIRED' || c.stage === 'HIRED') return reply(409, { error: 'Not open', code: 'NOT_OPEN' });
      if (b.to === 'HIRED' || b.to === 'NOT_HIRED') return reply(400, { error: 'Use the action', code: 'USE_ACTION' });
      if (!b.to || !STAGES.includes(b.to as never) || b.to === c.stage) return reply(400, { error: 'Not the next stage', code: 'NOT_NEXT_STAGE' });
      if (c.stage === 'INTERVIEW' && b.to === 'OFFER' && (c.interviews_done ?? 0) < (c.interviews_required ?? 0)) return reply(409, { error: 'Interviews incomplete', code: 'INTERVIEWS_INCOMPLETE' });
      if (c.offer_state === 'SENT' && b.to !== 'OFFER') return reply(409, { error: 'Offer live', code: 'OFFER_LIVE' });
      c.stage = b.to as Stage;
      c.stage_entered_at = iso(w.now);
      return reply(200, this.candRow(c));
    }
    if ((m = /\/v1\/candidates\/([^/]+)\/not-hired(\/confirm|\/cancel)?$/.exec(path)) && method === 'POST') {
      if (!recruiter) return forbidden;
      const c = this.cand(m[1]!, who);
      if (!c) return notFound;
      const b = (call.body ?? {}) as { reason?: string; note?: string };
      // The answers of lambda/shared/recruitment-actions/record-not-hired.mjs (REC-02): an id and a state, never a name.
      if (m[2] === '/confirm') {
        if (!c.pending) return [409, { error: 'Conflict', code: 'NOTHING_PENDING' }];
        if (c.pending.by === who.email) return [409, { error: 'Same person', code: 'SAME_PERSON' }];
        c.stage = 'NOT_HIRED'; c.not_hired_reason = c.pending.reason; c.stage_entered_at = iso(w.now); delete c.pending;
        return [200, { candidateId: c.id, stage: 'NOT_HIRED' }];
      }
      if (m[2] === '/cancel') {
        if (!c.pending) return [409, { error: 'Conflict', code: 'NOTHING_PENDING' }];
        delete c.pending;
        return [200, { candidateId: c.id, pending: false }];
      }
      if (!b.reason) return [400, { error: 'Reason required', code: 'REASON_REQUIRED' }];
      if (!REASONS.some(([code]) => code === b.reason)) return [400, { error: 'Invalid reason', code: 'INVALID_REASON' }];
      if (c.stage === 'NOT_HIRED' || c.stage === 'HIRED') return [409, { error: 'Not open', code: 'NOT_OPEN' }];
      if (c.offer_state === 'SENT') return [409, { error: 'Offer live', code: 'OFFER_LIVE' }];
      if (this.secondConfirmation.has(c.id) || this.secondConfirmationByHr.has(c.id)) {
        const hm = w.roles.find((r) => r.role_id === c.role_id)!;
        const awaiting = this.secondConfirmationByHr.has(c.id) ? { kind: 'HR' as const } : { kind: 'HIRING_MANAGER' as const, personId: hm.hiring_manager_id };
        c.pending = { by: who.email, reason: b.reason, awaiting };
        return [200, { candidateId: c.id, pending: true, awaiting }];
      }
      c.stage = 'NOT_HIRED'; c.not_hired_reason = b.reason; c.stage_entered_at = iso(w.now);
      return [200, { candidateId: c.id, stage: 'NOT_HIRED' }];
    }
    if (path.endsWith('/v1/company/departments') && method === 'GET') {
      if (!who.groups.some((g) => ['hr_staff', 'admin'].includes(g))) return [403, { error: 'Forbidden' }];
      return [200, { version: 1, departments: w.options[who.company].departments.map((d) => ({ ...d, status: 'ACTIVE' })) }];
    }
    // The old routes keep their real answers (getHiringManagers, manageTalentFlowConfig); the new page calls neither.
    if (path.endsWith('/v1/hiring-managers') && method === 'GET') {
      if (!recruiter) return forbidden;
      return [200, { hiringManagers: w.options[who.company].hiring_managers.map((x) => ({ sub: x.id, email: `${x.id}@example.org`, givenName: x.name.split(' ')[0], familyName: x.name.split(' ').slice(1).join(' '), name: x.name })) }];
    }
    if (path.endsWith('/v1/config') && method === 'GET') {
      if (!recruiter) return forbidden;
      return [200, { data: {} }];
    }
    return [404, { message: 'Not Found' }];
  }

  /** Candidates whose Not hired needs a second confirmation by the role's hiring manager (the answer says `pending`). */
  readonly secondConfirmation = new Set<string>();
  /** Candidates whose Not hired needs a second confirmation by any other HR person: the answer names nobody (`awaiting.kind` HR). */
  readonly secondConfirmationByHr = new Set<string>();

  private roleCompany(roleId: string): Co | null { return this.world.roles.find((r) => r.role_id === roleId)?.company ?? null; }
  /** A candidate's company: its role's, or its own when no role is attached yet. */
  private companyOf(c: Cand): Co | null { return this.roleCompany(c.role_id) ?? c.company ?? null; }
  /** The stage clock gives Hired and Not hired no status (REC-15 rule 1). */
  private slaOf(c: Cand): Sla | null { return c.stage === 'HIRED' || c.stage === 'NOT_HIRED' ? null : c.sla_status; }
  private title(roleId: string): string { return this.world.roles.find((r) => r.role_id === roleId)?.job_title ?? ''; }
  private cand(id: string, who: Who): Cand | null {
    const c = this.world.cands.find((x) => x.id === decodeURIComponent(id));
    return c && this.companyOf(c) === who.company ? c : null;
  }
  private roleRow(r: Role) {
    const open = this.world.cands.filter((c) => c.role_id === r.role_id && c.stage !== 'NOT_HIRED' && !c.old_system);
    return {
      role_id: r.role_id, job_title: r.job_title, department: r.department, level: r.level, hiring_manager_id: r.hiring_manager_id, hiring_manager_name: r.hiring_manager_name,
      candidate_count: open.length, overdue_count: open.filter((c) => c.sla_status === 'OVERDUE').length, due_soon_count: open.filter((c) => c.sla_status === 'DUE_SOON').length,
      opened_at: r.opened_at, status: r.status,
    };
  }
  /** One row exactly as api/openapi.yaml CandidateRow has it (REC-15 rule 4): no other key, no email, phone or ID number. */
  candRow(c: Cand): { id: string; name: string; stage: Stage; stage_entered_at: string; due_at: string | null; sla_status: Sla | null; role_id: string | null; role_title: string | null; level: string | null; source?: string; applied_at: string | null; hiring_manager_id: string | null; mine: boolean; not_hired_pending: NotHiredPending | null } {
    const open = this.slaOf(c) !== null;
    const role = this.world.roles.find((r) => r.role_id === c.role_id);
    return {
      id: c.id, name: c.name, stage: c.stage, stage_entered_at: c.stage_entered_at, due_at: open ? c.due_at : null, sla_status: this.slaOf(c),
      role_id: c.role_id || null, role_title: role?.job_title ?? c.role_title ?? null, level: c.level || null, ...(c.source ? { source: c.source } : {}),
      applied_at: c.applied_at ?? c.stage_entered_at, hiring_manager_id: role?.hiring_manager_id ?? null, mine: !!c.mine,
      not_hired_pending: pendingOf(c.pending), // child lock rec-ui-01.6
    };
  }
}

/** Child lock rec-ui-01.6: what the real list sends of a waiting decision (REC-UI-01.6 rule 1): who it waits on, nothing else. */
export type NotHiredPending = { awaiting: { kind: 'HIRING_MANAGER'; personId: string } | { kind: 'HR' } };
function pendingOf(p: Pending | undefined): NotHiredPending | null {
  if (!p) return null;
  const a = p.awaiting;
  return a?.kind === 'HIRING_MANAGER' && typeof a.personId === 'string' && a.personId ? { awaiting: { kind: 'HIRING_MANAGER', personId: a.personId } } : { awaiting: { kind: 'HR' } };
}

// The list's place of a row (REC-15 rule 9): open with a due date by due date, then open without one, then Hired and
// Not hired newest first; ties by id. The page token holds that place and nothing else (no company, no table key).
type Pos = { g: number; s: number; i: string };
function posOf(c: Cand): Pos {
  const open = c.stage !== 'HIRED' && c.stage !== 'NOT_HIRED';
  if (open && c.due_at) return { g: 0, s: Date.parse(c.due_at), i: c.id };
  if (open) return { g: 1, s: 0, i: c.id };
  return { g: 2, s: -Date.parse(c.stage_entered_at), i: c.id };
}
function cmpPos(a: Pos, b: Pos): number { return a.g - b.g || a.s - b.s || (a.i < b.i ? -1 : a.i > b.i ? 1 : 0); }
function writeToken(p: Pos): string { return Buffer.from(JSON.stringify({ v: 1, ...p })).toString('base64url'); }
function readToken(t: string): Pos | null {
  try {
    const o = JSON.parse(Buffer.from(t, 'base64url').toString('utf8'));
    return o && o.v === 1 && [0, 1, 2].includes(o.g) && Number.isFinite(o.s) && typeof o.i === 'string' && o.i ? { g: o.g, s: o.s, i: o.i } : null;
  } catch {
    return null;
  }
}

function subOfBearer(authorization: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(authorization.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- fixtures

type Fixtures = { modules: ModulesFake | null; list: EmployeesFake | null; hire: HireFake | null; now: number };

/** Every test's page time is fixed, so "Overdue by 2 days" and "Due today" are the same on every run. */
const NOW = Date.UTC(2026, 10, 19, 8, 0, 0); // 19 Nov 2026 10:00 in Johannesburg

export const test = base.extend<Fixtures>({
  now: [async ({}, use) => use(NOW), { option: false }],
  // HR home reads the employees list; answering it keeps every page quiet. Add-only.
  list: [
    async ({ context, baseURL }, use) => {
      if (ON_DEV) return use(null);
      const fake = new EmployeesFake(new URL(baseURL!).origin);
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
  modules: [
    async ({ context, cognito }, use) => {
      if (ON_DEV) return use(null);
      const fake = new ModulesFake((email) => cognito!.subOf(email));
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
  hire: [
    async ({ context, cognito, page }, use) => {
      if (ON_DEV) return use(null);
      await page.clock.setFixedTime(NOW);
      const fake = new HireFake((email) => cognito!.subOf(email), NOW);
      await fake.install(context);
      await use(fake);
      expect(fake.contractErrors, 'every request and fake answer matches api/openapi.yaml (REC-14 rule 17)').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

// ---------------------------------------------------------------- signing in

/** Adds the person to the fake Cognito, the fake modules answer and the fake API, once, and signs them in. */
export async function signInAs(signIn: SignInPage, cognito: CognitoFake | null, modules: ModulesFake | null, hire: HireFake | null, who: Who): Promise<void> {
  if (cognito && cognito.subOf(who.email) === undefined) cognito.addAccount(who);
  modules?.assign(who.email, who.company);
  hire?.assign(who);
  await signIn.open();
  await signIn.signInAs(who);
}

/** Signs in and waits for the first page the app sends that person to. */
export async function enter(page: Page, signIn: SignInPage, cognito: CognitoFake | null, modules: ModulesFake | null, hire: HireFake | null, who: Who): Promise<void> {
  await signInAs(signIn, cognito, modules, hire, who);
  expect(who.lands, `${who.full} can sign in`).not.toBeNull();
  await expect(page).toHaveURL(who.lands!);
  await expect(page.locator('main h1').first()).toBeVisible();
}

// ---------------------------------------------------------------- small helpers

/** Console errors and uncaught errors the app causes (the fakes' own failing answers and the fonts are not the app). */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = m.location().url;
    if (isModulesCall(new URL(where || 'http://x/')) || isHireCall(new URL(where || 'http://x/'))) return;
    if (/fonts\.(googleapis|gstatic)\.com/.test(where)) return;
    if (/Failed to load resource/.test(m.text())) return; // the fake's refusals
    errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** The page has had time to make the calls it makes on load (a slow font host does not hold the test). */
export async function quiet(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

/** The expected markup of a Lucide icon, to compare with what a sidebar item draws (the app draws it from the same nodes). */
export async function drawsIcon(link: import('@playwright/test').Locator, name: string): Promise<boolean> {
  const pascal = name.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join('').replace(/(\D)(\d)/, '$1$2');
  const node = (LUCIDE as Record<string, Array<[string, Record<string, string>]>>)[pascal];
  if (!node) throw new Error(`harness: no Lucide icon "${name}"`);
  return link.locator('svg').first().evaluate((svg, nodes) => {
    const expected = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [tag, attrs] of nodes as Array<[string, Record<string, string>]>) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, String(v));
      expected.appendChild(el);
    }
    return svg.innerHTML === expected.innerHTML;
  }, node);
}

/** A company id, or the word "company" or "tenant" as a key, anywhere in a request the app made (url, query, headers except the token, body). */
export function companyIdIn(call: Call): string[] {
  const found: string[] = [];
  const body = JSON.stringify(call.body ?? {});
  const withoutToken = call.raw.replace(/"authorization":"[^"]*"/i, '"authorization":"<token>"');
  for (const id of Object.values(COMPANY_ID)) if (withoutToken.includes(id)) found.push(`the company id ${id}`);
  if (/"(company|company_id|companyId|tenant|tenant_id|tenantId|organisation|organization)"\s*:/i.test(body)) found.push('a company key in the body');
  if (/[?&](company|company_id|companyId|tenant|tenant_id|tenantId)=/i.test(call.path + '?' + new URLSearchParams(call.query).toString().replace(/^/, '&'))) found.push('a company key in the query');
  if (/"(x-company[\w-]*|x-tenant[\w-]*|company[\w-]*|tenant[\w-]*)":/i.test(withoutToken.split('\n')[1] ?? '')) found.push('a company header');
  return found;
}
