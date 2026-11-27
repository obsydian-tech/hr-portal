import type { BrowserContext, Locator, Page, Route } from '@playwright/test';
import { ON_DEV } from '../fixtures';
import type { ModulesFake } from '../mod-02/modules-fake';
import { COMPANY_ID, WHO, contract, requestProblems, routeOf, type Call, type Cand, type Co, type HireFake, type Who } from '../rec-ui/harness';
import type { RecordFake } from '../rec-ui-02/record';
import { canOf, expect, iv, main, person, test as base, typeWords, type Iv, type InterviewsFake, type Required as FeedbackCount } from './interviews';

/**
 * INT-UI-02 · Schedule and reschedule an interview (Jira NH-271, epic NH-223, amber; lock acceptance-lock/int-ui-02 on the child lock
 * acceptance-lock/int-ui-01.1, which sits on acceptance-lock/int-ui-01): the words, the fakes and the page helpers of int-ui-02.spec.ts.
 * Spec: specs/interview-journey/cards/INT-UI-02.md, section "Changes after spec check round 1 (26 Nov)" (it wins over the text above it):
 * M-1 to M-3, S-1 to S-6, final AC-1 to AC-11, decisions INT-UI-02-D1 to D20. Its check: INT-UI-02-spec-check.md (round 2 leftovers
 * L-1 to L-8). Where the spec is silent, cards/int-ui-02.md says what these tests take (T-S1 up).
 *
 * The harness answers `GET /v1/config` with `{ data: {} }` for every type and nothing answers the people read, the booking or the
 * reschedule. This file adds one route on the same browser context for those four (registered after the interviews fake, so it answers
 * first; it hands the interviews read back to that fake). It answers as the merged server does (develop 3c4d82e):
 *   - `GET /v1/config?configType=…&active=true` as lambda/manageTalentFlowConfig (handleGet): a Recruiter or an admin, the company of the
 *     sign-in, Recruitment on; the active row, or `{ configType, version: null, isActive: false, data: {} … }` when there is none;
 *   - `GET /v1/panel-members` as lambda/getPanelMembers: the caller's company only, `{ members, total, candidateId }`; with
 *     `?candidateId=` it adds each guest's scoring link token (fact 9), so a page that asks for it shows a token a test can see;
 *   - `POST /v1/candidates/{id}/interviews` and `PATCH …/{interviewId}` as lambda/scheduleInterview/int01.mjs (book, act) with
 *     request-key.mjs: facts 2 to 4 and S-1 in the server's order, the same 400/409 codes, the request key (same key and body: the
 *     first answer again; same key, other body after a 2xx: 409 KEY_REUSED; any refusal releases the key), the company from the
 *     sign-in (another company's candidate or interview is 404 before the key is kept);
 *   - a booking or a reschedule changes the interviews the interviews fake sends next, so the tab's next read shows it.
 * Every answer on a route api/openapi.yaml describes is checked against it; a request to a route the file does not have is refused
 * and fails the test (`contractErrors`). A failure a test sets up with `refuse()` stands for a gateway or network failure.
 * Nothing here calls Bedrock or any paid AI.
 */

// ---------------------------------------------------------------- the words (approved 25 Nov, reused, W-N1..W-N12, picker words)
export const SW = {
  schedule: 'Schedule an interview',
  reschedule: 'Reschedule',
  cancel: 'Cancel',
  /** The drawer's own close button (design system). */
  close: 'Close',
  type: 'Interview type',
  dateTime: 'Date and time',
  /** W-N11. */
  date: 'Date',
  time: 'Time',
  length: 'Length',
  where: 'Where',
  inPerson: 'In person',
  online: 'Online',
  place: 'Place',
  link: 'Video link',
  panel: 'Panel',
  guest: 'Add a guest by email',
  note: 'Note for the candidate',
  optional: '(optional)',
  /** W-4. */
  reason: 'Reason for the change',
  /** W-1. */
  sast: 'Times are in South African time (SAST).',
  /** W-2. */
  guestHelp: 'They get an email with a link to give feedback once. It works from the start of the interview until 7 days after.',
  /** W-9a, the server line. */
  bookedServer: 'This interview type is already booked. Choose another type.',
  /** W-9c. */
  hasFeedback: 'Someone has already given feedback, so this interview can\'t be changed.',
  /** W-10a. */
  future: 'Choose a time in the future.',
  /** W-10b. */
  badLink: 'Enter a link that starts with https://',
  /** The W-5 line. */
  w5Line: 'Everyone invited gets an email with the new details and an updated calendar invite.',
  /** W-N1. */
  choicesFailed: 'Interview choices could not be loaded.',
  tryAgain: 'Try again',
  /** W-N2. */
  noPeople: 'No people to choose yet.',
  /** W-N3 .. W-N9. */
  typeEmpty: 'Choose an interview type',
  dateEmpty: 'Choose a date',
  timeEmpty: 'Choose a time',
  lengthEmpty: 'Choose a length',
  whereEmpty: 'Choose in person or online',
  placeEmpty: 'Enter the place',
  panelEmpty: 'Choose at least one person',
  /** Add candidate's approved line, reused. */
  emailWrong: 'Enter an email address, like name@company.co.za',
  /** Approved. */
  saveFail: 'Your change could not be saved. Try again.',
  // The date picker's own words (M-2, D15): used as they are.
  pickerNotAllowed: 'Choose a date the calendar allows.',
  pickerFormat: 'Enter the date like this: 23 Nov 2026.',
  pickerButton: 'Choose date',
  today: 'Today',
} as const;
/** W-N10. */
export const panelMax = (n: number) => (n === 1 ? 'Choose up to 1 person' : `Choose up to ${n} people`);
/** W-9a help: the booked or done types' words, joined with ", " in settings order. */
export const bookedHelp = (words: string[]) => `${words.join(', ')}: already booked or done.`;
/** W-3, with "the guest" only when a guest address is typed. */
export const w3 = (first: string, withGuest: boolean) => (withGuest ? `The panel, the guest and ${first} each get an email with a calendar invite.` : `The panel and ${first} each get an email with a calendar invite.`);
/** W-5 title (S-5: the type words lower-cased inside the sentence). */
export const rescheduleTitle = (typeKey: string) => `Reschedule the ${(typeWords(typeKey) ?? '').toLowerCase()} interview`;
/** W-N12. */
export const closedButtonName = (typeKey: string) => `${SW.schedule}, ${typeWords(typeKey)}`;
/** The app's summary heading (add-candidate.drawer.ts line 75). */
export const summaryHeading = (n: number) => `Fix ${n} ${n === 1 ? 'thing' : 'things'} to continue`;
/** The picker's "{Month} has {n} days. Check the date, for example {n} {Mon} {year}." */
export const pickerDays = (month: string, days: number, year: number) => `${month} has ${days} days. Check the date, for example ${days} ${month.slice(0, 3)} ${year}.`;
/** W-17. */
export const lengthWords = (m: number): string => {
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} minutes`;
  const hours = `${h} hour${h > 1 ? 's' : ''}`;
  return r ? `${hours} ${r} minutes` : hours;
};
export const LENGTHS = Array.from({ length: 16 }, (_, i) => (i + 1) * 15);
export const LENGTH_WORDS = LENGTHS.map(lengthWords);
/** The 96 times, "00:00" to "23:45". */
export const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** A day button's name in the picker ("Monday 23 November 2026", L-1: ", today" on the browser's today). */
export const DAY_NAME = new RegExp(`^(${WEEKDAYS.join('|')}) \\d{1,2} (${MONTHS.join('|')}) \\d{4}(, today)?$`);

/**
 * Every string AC-9 allows in the drawer: the approved words, the W-N lines, the reused lines, the date picker's own words and
 * the multi-select's own words (T-S4). `typeLabels` are the type words the company's settings give; `people` the names read;
 * `extra` what the test typed and the record's own words ("{name} · {role}").
 */
export function allowedWords(o: { typeLabels: string[]; people: string[]; first: string; extra: string[] }): (s: string) => boolean {
  const fixed = new Set<string>([
    ...Object.values(SW), ...LENGTH_WORDS, ...TIMES, ...o.typeLabels, ...o.people, ...o.extra,
    w3(o.first, true), w3(o.first, false), ...o.typeLabels.map((t) => `${SW.schedule}, ${t}`),
    // The date picker's own words (M-2): the weekday letters and names; the multi-select's placeholder (T-S4).
    'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su', ...WEEKDAYS, 'Choose', '*',
  ]);
  const dynamic = [
    /^\d{1,2}$/, // a day number in the calendar
    new RegExp(`^(${MONTHS.join('|')}) \\d{4}$`), // the calendar title
    new RegExp(`^(Previous|Next) month, (${MONTHS.join('|')}) \\d{4}$`),
    DAY_NAME,
    /^\d{1,2}:\d{2}$/, // an off-grid time of an interview read (M-3)
    new RegExp(`^(${MONTHS.join('|')}) has \\d{2} days\\. Check the date, for example \\d{2} [A-Z][a-z]{2} \\d{4}\\.$`),
    /^Fix \d+ things? to continue$/,
    /^Choose up to \d+ (people|person)$/,
    /^\d+ people$/, // the multi-select's own summary, noun "people" (rule 4)
    /^.+: already booked or done\.$/,
    /^Reschedule the [a-z ]+ interview$/,
    /^\d{1,2} [A-Z][a-z]{2} \d{4}$/, // the picker's own text, "23 Nov 2026"
  ];
  const summaryLine = /^(Interview type|Date and time|Length|Where|Place|Video link|Panel|Add a guest by email|Note for the candidate|Reason for the change): (.+)$/;
  const ok = (s: string): boolean => fixed.has(s) || dynamic.some((r) => r.test(s)) || o.people.some((p) => s === p)
    || (s.includes(', ') && s.split(', ').every((p) => o.people.includes(p) || o.typeLabels.includes(p)));
  return (s: string) => {
    const t = s.replace(/[\s  ]+/g, ' ').trim();
    if (!t) return true;
    const m = summaryLine.exec(t);
    return ok(t) || (!!m && ok(m[2]!));
  };
}

// ---------------------------------------------------------------- the people and the settings

export type Person = { id: string; name: string; email: string };
const p = (id: string, name: string, email: string): Person => ({ id, name, email });
/** Company A's people as `GET /v1/panel-members` lists them (answer order). The last one has no name set, so the server sends the email (S-2). */
export const PEOPLE_A: Person[] = [
  p('sub-a-sipho', 'Sipho Ndlovu', 'sipho.ndlovu@sunbird-bakery.co.za'),
  p('sub-a-lerato', 'Lerato Mokoena', 'lerato.mokoena@sunbird-bakery.co.za'),
  p('sub-a-thabo', 'Thabo Khumalo', 'thabo.khumalo@sunbird-bakery.co.za'),
  p('sub-a-ayanda', 'Ayanda Mkhize', 'ayanda.mkhize@sunbird-bakery.co.za'),
  p('sub-a-zanele', 'zanele.nkosi@sunbird-bakery.co.za', 'zanele.nkosi@sunbird-bakery.co.za'),
];
export const PEOPLE_B: Person[] = [
  p('sub-b-lindiwe', 'Lindiwe Peters', 'lindiwe.peters@dispatch-b.co.za'),
  p('sub-b-bheki', 'Bheki Mthethwa', 'bheki.mthethwa@dispatch-b.co.za'),
];
/** A guest's scoring link token, as the people read sends it with `?candidateId=` (fact 9). It must never be asked for or shown. */
export const GUEST_TOKEN = 'MARKguestscoringtoken9f3c';

export type TypeSetting = { key: string; label: string; optional: boolean; default_length_minutes?: number };
export type PanelSetting = { panelSize?: Record<string, number>; guestAllowed?: boolean; hrMayEnterForMember?: boolean; interview_emails?: 'ON' | 'OFF'; candidate_interview_emails?: 'ON' | 'OFF' };
/** The server's five defaults (recruitment-settings.mjs DEFAULTS), with the server's own labels, which the page never shows (D4). */
export const DEFAULT_TYPES: TypeSetting[] = [
  { key: 'PHONE_SCREEN', label: 'Phone Screen', optional: false }, { key: 'TECHNICAL', label: 'Technical', optional: false },
  { key: 'BEHAVIORAL', label: 'Behavioral', optional: false }, { key: 'CULTURE_FIT', label: 'Culture Fit', optional: false }, { key: 'FINAL', label: 'Final', optional: false },
];
export const DEFAULT_KEYS = DEFAULT_TYPES.map((t) => t.key);

// ---------------------------------------------------------------- the fake

export type Kind = 'types' | 'panelConfig' | 'people' | 'book' | 'reschedule';
export type SchedRefusal = { kind: Kind; status?: number; body?: unknown; abort?: boolean; hold?: boolean; once?: boolean; /** Do the work, then drop the connection (S-1). */ thenAbort?: boolean };
export type SchedCall = Call & { kind: Kind };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
const isConfig = (p: string) => /\/v1\/config$/.test(p);
const isPeople = (p: string) => /\/v1\/panel-members$/.test(p);
const bookPath = (p: string) => /\/v1\/candidates\/([^/]+)\/interviews$/.exec(p);
const actPath = (p: string) => /\/v1\/candidates\/([^/]+)\/interviews\/([^/]+)$/.exec(p);
const isMine = (url: URL) => isConfig(url.pathname) || isPeople(url.pathname) || !!bookPath(url.pathname) || !!actPath(url.pathname);

const BOOK_KEYS = ['type', 'at', 'length_minutes', 'where', 'place', 'video_link', 'panel', 'guest_email', 'candidate_note'];
const ACT_KEYS = ['action', 'at', 'length_minutes', 'where', 'place', 'video_link', 'panel', 'guest_email', 'reason_note'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** interview-lifecycle.mjs timeOf: an ISO time with a zone. */
const timeOf = (v: unknown): number | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null);
const isLength = (v: unknown) => Number.isInteger(v) && (v as number) >= 15 && (v as number) <= 240 && (v as number) % 15 === 0;
const isPlace = (v: unknown) => typeof v === 'string' && v.trim().length >= 1 && v.length <= 200;
const isLink = (v: unknown) => { if (typeof v !== 'string' || !v.startsWith('https://') || /\s/.test(v) || v.length > 500) return false; try { new URL(v); return true; } catch { return false; } };

export class ScheduleFake {
  readonly calls: SchedCall[] = [];
  readonly contractErrors: string[] = [];
  /** The server's clock (the page clock of the harness unless a test moves both). */
  now: number;
  readonly types: Record<Co, TypeSetting[] | null> = { A: null, B: null, C: null };
  readonly panelConfig: Record<Co, PanelSetting | null> = { A: null, B: null, C: null };
  readonly people: Record<Co, Person[]> = { A: [...PEOPLE_A], B: [...PEOPLE_B], C: [] };
  /** Sign-ins that belong to the company but that the people read does not offer (someone who left the panel group). The server checks only the company (`panelOk` in int01.mjs), so these pass a booking or reschedule (rule 8, lock check M-3). */
  readonly unlisted: Record<Co, string[]> = { A: [], B: [], C: [] };
  private readonly lists = new Map<string, Iv[]>();
  private readonly emails = new Map<string, Who>();
  private readonly refusals: SchedRefusal[] = [];
  private readonly held: Array<() => void> = [];
  private readonly keys = new Map<string, { body: string; status: number; answer: unknown }>();
  private seq = 0;
  private booked = 0;

  constructor(private readonly hire: HireFake, private readonly record: RecordFake, private readonly interviews: InterviewsFake,
    private readonly subOf: (email: string) => string | undefined, private readonly modulesOf: (co: Co) => string[]) {
    this.now = hire.world.now;
  }

  assign(who: Who): void { this.emails.set(who.email.toLowerCase(), who); }
  /** One candidate's interviews for both fakes: the interviews read sends them, and a booking or reschedule changes them. */
  set(id: string, list: Iv[], required: FeedbackCount = { done: 0, total: 2 }): Iv[] { this.lists.set(id, list); this.interviews.set(id, list, required); return list; }
  listOf(id: string): Iv[] { return this.lists.get(id) ?? []; }
  refuse(r: SchedRefusal): void { this.refusals.push({ once: true, ...r }); }
  lift(): void { this.refusals.length = 0; }
  release(): void { for (const go of this.held.splice(0)) go(); }
  get heldCount(): number { return this.held.length; }

  get requests(): SchedCall[] { return this.calls.filter((c) => c.method !== 'OPTIONS'); }
  of(kind: Kind): SchedCall[] { return this.requests.filter((c) => c.kind === kind); }
  /** The bookings and reschedules sent (every write). */
  get writes(): SchedCall[] { return this.requests.filter((c) => c.kind === 'book' || c.kind === 'reschedule'); }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => isMine(url), (route) => this.handle(route));
  }

  private who(sub: string | null): Who | null {
    if (!sub) return null;
    for (const [email, who] of this.emails) if (this.subOf(email) === sub) return who;
    return null;
  }
  private companyOf(c: Cand): Co | null { return this.hire.world.roles.find((r) => r.role_id === c.role_id)?.company ?? c.company ?? null; }
  private levelOf(c: Cand): string | null { const x = this.record.extra.get(c.id); return x && 'level' in x ? x.level ?? null : c.level || null; }
  private sizeOf(c: Cand, co: Co): number { const l = this.levelOf(c); return (l && this.hire.world.options[co].panel_size_by_level[l]) || 3; }
  private typeKeys(co: Co): string[] { return (this.types[co] ?? DEFAULT_TYPES).map((t) => t.key); }
  private pc(co: Co): PanelSetting { return this.panelConfig[co] ?? {}; }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    // The interviews read is the interviews fake's.
    if (bookPath(url.pathname) && request.method() === 'GET') return route.fallback();
    const kind: Kind = isConfig(url.pathname) ? (url.searchParams.get('configType') === 'PANEL_CONFIG' ? 'panelConfig' : 'types') : isPeople(url.pathname) ? 'people' : bookPath(url.pathname) ? 'book' : 'reschedule';
    const authorization = request.headers()['authorization'] ?? null;
    const who = authorization && JWT.test(authorization) ? this.who(subOfBearer(authorization)) : null;
    const raw = `${request.method()} ${url.pathname}${url.search}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ''}`;
    let body: unknown = null;
    try { body = request.postData() ? JSON.parse(request.postData()!) : null; } catch { body = request.postData(); }
    const call: SchedCall = {
      kind, seq: ++this.seq, method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), idempotencyKey: request.headers()['idempotency-key'] ?? null,
      body, authorization, email: who?.email ?? null, company: who?.company ?? null, raw, status: 0,
    };
    this.calls.push(call);
    const refusal = this.refusals.find((r) => r.kind === kind);
    if (refusal) {
      if (refusal.once) this.refusals.splice(this.refusals.indexOf(refusal), 1);
      if (refusal.hold) await new Promise<void>((go) => this.held.push(go));
      if (refusal.abort) { call.status = -1; return route.abort('internetdisconnected'); }
      if (refusal.status) return this.send(route, call, refusal.status, refusal.body ?? { error: 'Internal error' }, false);
      if (refusal.thenAbort) {
        const [status, answer] = this.answer(call, who);
        call.status = status;
        void answer;
        return route.abort('internetdisconnected');
      }
    }
    const [status, answer] = this.answer(call, who);
    return this.send(route, call, status, answer);
  }

  private answer(call: SchedCall, who: Who | null): [number, unknown] {
    if (!call.authorization || !JWT.test(call.authorization)) return [401, { message: 'Unauthorized' }];
    if (!who) return [403, { error: 'Forbidden' }];
    const wrong = requestProblems(call.method, call.path, call.query);
    if (wrong.length) { this.contractErrors.push(...wrong); return [404, { message: 'Not Found' }]; }
    const co = who.company;
    const recruiter = who.groups.includes('hr_staff') && who.groups.includes('perm-recruitment');
    if (!this.modulesOf(co).includes('recruitment')) return [403, { error: 'Forbidden' }];
    if (call.kind === 'types' || call.kind === 'panelConfig') {
      if (!recruiter && !who.groups.includes('admin')) return [403, { error: 'Forbidden' }];
      const configType = call.query['configType']!;
      const data = configType === 'INTERVIEW_TYPES' ? this.types[co] : configType === 'PANEL_CONFIG' ? this.panelConfig[co] : null;
      if (!data || call.query['active'] !== 'true') return [200, { configType, version: null, isActive: false, data: {}, createdAt: null, updatedAt: null }];
      const at = new Date(this.hire.world.now - 5 * 86_400_000).toISOString();
      const d = configType === 'INTERVIEW_TYPES' ? { types: data, requiredByLevel: { JUNIOR: [], MID: [], SENIOR: [] } } : data;
      return [200, { PK: `TENANT#${COMPANY_ID[co]}`, SK: `CONFIG#${configType}#v3`, configType, version: 3, isActive: true, data: d, createdAt: at, updatedAt: at, tenant_id: COMPANY_ID[co] }];
    }
    if (call.kind === 'people') {
      const cid = call.query['candidateId'];
      const members = this.people[co].map((m) => ({
        id: m.id, name: m.name, email: m.email, role: 'System User', tenantId: COMPANY_ID[co], accessType: 'SYSTEM_ACCOUNT',
        ...(cid ? { scoringLinkToken: GUEST_TOKEN, scoringLinkUsed: false, scoringLinkExpiry: '2026-12-31T08:00:00.000Z' } : {}),
      }));
      return [200, { members, total: members.length, candidateId: cid ?? null }];
    }
    // ---- book and act (int01.mjs)
    const bad = (field: string): [number, unknown] => [400, { error: 'Bad request', code: 'INVALID_FIELD', field }];
    const conflict = (code: string): [number, unknown] => [409, { error: 'Conflict', code }];
    const notFound: [number, unknown] = [404, { error: 'Not found' }];
    if (!recruiter) return [403, { error: 'Forbidden' }];
    const key = call.idempotencyKey;
    if (!key || key.length > 200) return bad('Idempotency-Key');
    const b = call.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return bad('body');
    const m = call.kind === 'book' ? bookPath(call.path)! : actPath(call.path)!;
    const candId = decodeURIComponent(m[1]!);
    const c = this.hire.world.cands.find((x) => x.id === candId);
    // Another company's candidate: 404 before the key is kept.
    if (!c || this.companyOf(c) !== co) return notFound;
    const memo = `${COMPANY_ID[co]}|${call.method} ${call.kind}|${who.email}|${candId}|${call.kind === 'reschedule' ? m[2] : ''}|${key}`;
    const bodyText = JSON.stringify(b);
    const seen = this.keys.get(memo);
    if (seen) {
      if (seen.body === bodyText) return [seen.status, seen.answer];
      return conflict('KEY_REUSED');
    }
    const [status, answer] = call.kind === 'book' ? this.book(b as Record<string, unknown>, c, co, bad, conflict) : this.act(b as Record<string, unknown>, c, co, decodeURIComponent(m[2]!), bad, conflict, notFound);
    // A refusal releases the key (request-key.mjs finish); a 2xx is kept with its body.
    if (status >= 200 && status < 300) this.keys.set(memo, { body: bodyText, status, answer });
    return [status, answer];
  }

  private book(b: Record<string, unknown>, c: Cand, co: Co, bad: (f: string) => [number, unknown], conflict: (c: string) => [number, unknown]): [number, unknown] {
    const extra = Object.keys(b).find((k) => !BOOK_KEYS.includes(k));
    if (extra !== undefined) return bad(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(extra) ? extra : 'body');
    if (typeof b['type'] !== 'string' || !b['type']) return bad('type');
    const atMs = timeOf(b['at']);
    if (atMs === null) return bad('at');
    if (!isLength(b['length_minutes'])) return bad('length_minutes');
    if (!['IN_PERSON', 'ONLINE'].includes(b['where'] as string)) return bad('where');
    if (b['where'] === 'IN_PERSON') { if (!isPlace(b['place'])) return bad('place'); if (b['video_link'] !== undefined) return bad('video_link'); }
    else { if (!isLink(b['video_link'])) return bad('video_link'); if (b['place'] !== undefined) return bad('place'); }
    if (!Array.isArray(b['panel']) || b['panel'].length < 1) return bad('panel');
    if (b['guest_email'] !== undefined && !(typeof b['guest_email'] === 'string' && EMAIL.test(b['guest_email']) && b['guest_email'].length <= 254)) return bad('guest_email');
    if (b['candidate_note'] !== undefined && !(typeof b['candidate_note'] === 'string' && b['candidate_note'].length <= 1000)) return bad('candidate_note');
    if (c.stage !== 'INTERVIEW') return conflict('NOT_ALLOWED_NOW');
    if (!this.typeKeys(co).includes(b['type'])) return bad('type');
    if (!this.panelOk(b['panel'], co, this.sizeOf(c, co))) return bad('panel');
    if (b['guest_email'] !== undefined && this.pc(co).guestAllowed === false) return bad('guest_email');
    if (atMs <= this.now) return [400, { error: 'Bad request', code: 'AT_IN_PAST', field: 'at' }];
    if (b['guest_email'] !== undefined && this.pc(co).interview_emails !== 'ON') return conflict('GUEST_EMAIL_OFF');
    const list = this.lists.get(c.id) ?? this.set(c.id, []);
    if (list.some((x) => x.type === b['type'] && (x.status === 'SCHEDULED' || x.status === 'COMPLETED'))) return conflict('TYPE_ALREADY_BOOKED');
    const id = `iv-booked-${++this.booked}`;
    const people = this.people[co];
    list.push(iv(id, new Date(atMs).toISOString(), 'SCHEDULED', {
      type: b['type'], length_minutes: b['length_minutes'] as number, where: b['where'] as Iv['where'],
      place: b['where'] === 'IN_PERSON' ? (b['place'] as string) : null, video_link: b['where'] === 'ONLINE' ? (b['video_link'] as string) : null,
      sequence: 1, can: canOf({ reschedule: true, cancel: true }),
      panel: (b['panel'] as string[]).map((pid) => person(people.find((x) => x.id === pid)?.name ?? null, 'WAITING', { person_id: pid })),
      ...(b['candidate_note'] !== undefined ? { candidate_note: b['candidate_note'] as string } : {}),
    }));
    list.sort((x, y) => (x.at ?? '').localeCompare(y.at ?? ''));
    return [201, { interview_id: id, status: 'SCHEDULED', sequence: 1 }];
  }

  private act(b: Record<string, unknown>, c: Cand, co: Co, interviewId: string, bad: (f: string) => [number, unknown], conflict: (c: string) => [number, unknown], notFound: [number, unknown]): [number, unknown] {
    if (b['action'] !== 'reschedule') return bad('action');
    if (b['type'] !== undefined) return bad('type');
    const extra = Object.keys(b).find((k) => !ACT_KEYS.includes(k));
    if (extra !== undefined) return bad(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(extra) ? extra : 'body');
    if (b['at'] !== undefined && timeOf(b['at']) === null) return bad('at');
    if (b['length_minutes'] !== undefined && !isLength(b['length_minutes'])) return bad('length_minutes');
    if (b['where'] !== undefined && !['IN_PERSON', 'ONLINE'].includes(b['where'] as string)) return bad('where');
    if (b['place'] !== undefined && !isPlace(b['place'])) return bad('place');
    if (b['video_link'] !== undefined && !isLink(b['video_link'])) return bad('video_link');
    if (b['panel'] !== undefined && (!Array.isArray(b['panel']) || b['panel'].length < 1)) return bad('panel');
    if (b['guest_email'] !== undefined && b['guest_email'] !== null && !(typeof b['guest_email'] === 'string' && EMAIL.test(b['guest_email']))) return bad('guest_email');
    if (b['reason_note'] !== undefined && !(typeof b['reason_note'] === 'string' && b['reason_note'].trim().length >= 1 && b['reason_note'].length <= 500)) return bad('reason_note');
    const x = (this.lists.get(c.id) ?? []).find((i) => i.id === interviewId);
    if (!x) return notFound;
    const where = (b['where'] as string | undefined) ?? x.where;
    if (b['where'] === 'IN_PERSON') { if (b['place'] === undefined) return bad('place'); if (b['video_link'] !== undefined) return bad('video_link'); }
    if (b['where'] === 'ONLINE') { if (b['video_link'] === undefined) return bad('video_link'); if (b['place'] !== undefined) return bad('place'); }
    if (b['where'] === undefined) { if (b['place'] !== undefined && where !== 'IN_PERSON') return bad('place'); if (b['video_link'] !== undefined && where !== 'ONLINE') return bad('video_link'); }
    if (b['panel'] !== undefined && !this.panelOk(b['panel'], co, this.sizeOf(c, co))) return bad('panel');
    const ids = x.panel.filter((e) => e.kind === 'PERSON').map((e) => e.person_id);
    const atMs = b['at'] !== undefined ? timeOf(b['at'])! : Date.parse(x.at ?? '');
    const changes: string[] = [];
    if (b['at'] !== undefined && new Date(atMs).toISOString() !== (x.at ? new Date(Date.parse(x.at)).toISOString() : null)) changes.push('at');
    if (b['length_minutes'] !== undefined && b['length_minutes'] !== x.length_minutes) changes.push('length');
    if (b['where'] !== undefined && b['where'] !== x.where) changes.push('where');
    if (b['place'] !== undefined && b['place'] !== x.place) changes.push('place');
    if (b['video_link'] !== undefined && b['video_link'] !== x.video_link) changes.push('link');
    if (b['panel'] !== undefined && JSON.stringify(b['panel']) !== JSON.stringify(ids)) changes.push('panel');
    if (b['guest_email'] !== undefined) changes.push('guest');
    if (!changes.length) return bad('action');
    if (b['at'] !== undefined && atMs <= this.now) return [400, { error: 'Bad request', code: 'AT_IN_PAST', field: 'at' }];
    // refusalOf('reschedule'): booked, at Interview, nobody has given feedback.
    if (x.status !== 'SCHEDULED' || c.stage !== 'INTERVIEW') return conflict('NOT_ALLOWED_NOW');
    if (x.panel.some((e) => e.feedback === 'GIVEN')) return conflict('HAS_FEEDBACK');
    if (changes.includes('at')) x.at = new Date(atMs).toISOString();
    if (b['length_minutes'] !== undefined) x.length_minutes = b['length_minutes'] as number;
    x.where = where as Iv['where'];
    if (b['place'] !== undefined) x.place = b['place'] as string;
    if (b['video_link'] !== undefined) x.video_link = b['video_link'] as string;
    if (where === 'ONLINE' && b['place'] === undefined) x.place = null;
    if (where === 'IN_PERSON' && b['video_link'] === undefined) x.video_link = null;
    if (b['panel'] !== undefined) {
      const people = this.people[co];
      x.panel = [...(b['panel'] as string[]).map((pid) => person(people.find((q) => q.id === pid)?.name ?? null, 'WAITING', { person_id: pid })), ...x.panel.filter((e) => e.kind === 'GUEST')];
    }
    x.sequence = (x.sequence ?? 0) + 1;
    return [200, { interview_id: x.id, status: 'SCHEDULED', sequence: x.sequence }];
  }

  private panelOk(panel: unknown, co: Co, size: number): boolean {
    if (!Array.isArray(panel) || panel.length < 1 || panel.length > size || new Set(panel).size !== panel.length) return false;
    return panel.every((x) => typeof x === 'string' && (this.people[co].some((m) => m.id === x) || this.unlisted[co].includes(x)));
  }

  private send(route: Route, call: SchedCall, status: number, body: unknown, checked = true): Promise<void> {
    call.status = status;
    if (checked && (call.kind === 'book' || call.kind === 'reschedule') && status !== 401) {
      const key = routeOf(call.method, call.path);
      const template = key?.split(' ')[1] ?? '';
      const schema = contract().doc.paths?.[template]?.[call.method.toLowerCase() as 'post']?.responses?.[String(status)]?.content?.['application/json']?.schema;
      if (!schema) this.contractErrors.push(`${call.method} ${template} ${status}: api/openapi.yaml describes no such answer`);
      else this.contractErrors.push(...contract().check(schema, body).map((x) => `${call.method} ${template} ${status}: ${x}`));
    }
    return route.fulfill({ status, headers: { ...CORS, 'cache-control': 'private, no-store', 'content-type': 'application/json' }, body: JSON.stringify(body) });
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

// ---------------------------------------------------------------- the fixture
type Fx = { sched: ScheduleFake | null };
export const test = base.extend<Fx>({
  sched: [
    async ({ context, cognito, modules, hire, record, interviews }, use) => {
      if (ON_DEV) return use(null);
      const m = modules as ModulesFake;
      const fake = new ScheduleFake(hire!, record!, interviews!, (email) => cognito!.subOf(email), (co) => m.answers[co]);
      for (const who of Object.values(WHO)) fake.assign(who);
      // Registered after the interviews fake, so this one answers the booking, the reschedule, the settings and the people first.
      await fake.install(context);
      await use(fake);
      expect(fake.contractErrors, 'every booking, reschedule, settings and people request matches api/openapi.yaml').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect, main };

// ---------------------------------------------------------------- page helpers

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The drawer, by its title (it is an overlay, outside main). */
export const drawerOf = (page: Page, title: string = SW.schedule): Locator => page.getByRole('dialog', { name: title, exact: true });
/** Any open drawer, whatever its title. */
export const anyDrawer = (page: Page): Locator => page.locator('.pp-drawer[role="dialog"]');
/** The tab's "Schedule an interview" buttons (exact name; the closed-interview one has the type in its name, W-N12). */
export const scheduleButton = (page: Page): Locator => main(page).getByRole('button', { name: SW.schedule, exact: true });
export const rescheduleButton = (page: Page): Locator => main(page).getByRole('button', { name: SW.reschedule, exact: true });
/** A control in the drawer by its label ("(optional)" may follow). */
export const field = (d: Locator, label: string): Locator => d.getByLabel(new RegExp(`^${esc(label)}\\s*(\\(optional\\))?$`));
/** The pp-field box around a control: its label, the control, help and error. */
export const fieldBox = (d: Locator, label: string): Locator => d.locator('.pp-field').filter({ has: d.page().getByLabel(new RegExp(`^${esc(label)}\\s*(\\(optional\\))?$`)) }).last();
/** The "Date and time" group (role group, named by its legend or label). */
export const dateTimeGroup = (d: Locator): Locator => d.getByRole('group', { name: SW.dateTime, exact: true });
export const mainButton = (d: Locator, name: string = SW.schedule): Locator => d.locator('.pp-drawer__footer').getByRole('button', { name, exact: true });
export const cancelButton = (d: Locator): Locator => d.locator('.pp-drawer__footer').getByRole('button', { name: SW.cancel, exact: true });
export const radio = (d: Locator, name: string): Locator => d.getByRole('radio', { name, exact: true });
/** The error under a field (pp-field error line), or '' when there is none. */
export async function errorOf(box: Locator): Promise<string> {
  const e = box.locator('.pp-field__error');
  return (await e.count()) ? ((await e.first().innerText()).replace(/\s+/g, ' ').trim()) : '';
}
/** The error line(s) of the Date and time group: any pp-field error inside it. */
export async function dateTimeErrors(d: Locator): Promise<string[]> {
  return (await dateTimeGroup(d).locator('.pp-field__error').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
/** The error summary: its heading and its lines. */
export async function summaryOf(d: Locator): Promise<{ heading: string; lines: string[] } | null> {
  const s = d.locator('.pp-form-error-summary');
  if (!(await s.count())) return null;
  return {
    heading: (await s.locator('.pp-section-message__title').innerText()).trim(),
    lines: (await s.locator('[role="listitem"]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()),
  };
}
/** The options of a native select in the drawer (the placeholder, if any, left out: it has an empty value). */
export async function selectOptions(d: Locator, label: string): Promise<Array<{ text: string; disabled: boolean }>> {
  return field(d, label).evaluate((el) => [...(el as HTMLSelectElement).options].filter((o) => o.value !== '').map((o) => ({ text: (o.textContent ?? '').trim(), disabled: o.disabled })));
}
/** The chosen option's words of a native select ('' when nothing is chosen). */
export async function selected(d: Locator, label: string): Promise<string> {
  return field(d, label).evaluate((el) => { const s = el as HTMLSelectElement; return s.value === '' ? '' : (s.selectedOptions[0]?.textContent ?? '').trim(); });
}
export async function pick(d: Locator, label: string, option: string): Promise<void> {
  await field(d, label).selectOption({ label: option });
}
/** Types a date into the picker's own text field and leaves it (as a person does), so the picker reads it. */
export async function typeDate(d: Locator, text: string): Promise<void> {
  const f = field(d, SW.date);
  await f.fill(text);
  await f.blur();
}
/** Scrolls the drawer so the picker sits mid-screen before it opens, as a person would: the list opens under the field, and
 *  with the field at the bottom of an 800-high screen the later people were drawn off screen (a test that failed 2 runs in 6). */
async function roomBelow(box: Locator): Promise<void> {
  await box.evaluate((el) => el.scrollIntoView({ block: 'center' }));
}
/** Chooses people in the panel picker, in the order given, and closes it again with a click on the picker. */
export async function choosePeople(d: Locator, names: string[]): Promise<void> {
  const box = field(d, SW.panel);
  await roomBelow(box);
  await box.click();
  for (const n of names) await d.page().getByRole('listbox').getByRole('option', { name: n, exact: true }).click();
  await box.click();
  await expect(d.page().getByRole('listbox')).toHaveCount(0);
}
/** The people offered by the panel picker, in order, and which are chosen. */
export async function peopleOptions(d: Locator): Promise<Array<{ name: string; chosen: boolean }>> {
  const box = field(d, SW.panel);
  await roomBelow(box);
  await box.click();
  await d.page().getByRole('listbox').waitFor({ state: 'attached' });
  const out = await d.page().getByRole('listbox').getByRole('option').evaluateAll((os) => os.map((o) => ({ name: (o.textContent ?? '').replace(/\s+/g, ' ').trim(), chosen: o.getAttribute('aria-selected') === 'true' })));
  await box.click();
  await expect(d.page().getByRole('listbox')).toHaveCount(0);
  return out;
}

/** A booking as a person fills it; a key left out is not touched. */
export type Booking = { type?: string; date?: string; time?: string; length?: string; where?: 'In person' | 'Online'; place?: string; link?: string; people?: string[]; guest?: string; note?: string };
export async function fillBooking(d: Locator, b: Booking): Promise<void> {
  if (b.type !== undefined) await pick(d, SW.type, b.type);
  if (b.date !== undefined) await typeDate(d, b.date);
  if (b.time !== undefined) await pick(d, SW.time, b.time);
  if (b.length !== undefined) await pick(d, SW.length, b.length);
  if (b.where !== undefined) await radio(d, b.where).check();
  if (b.place !== undefined) await field(d, SW.place).fill(b.place);
  if (b.link !== undefined) await field(d, SW.link).fill(b.link);
  if (b.people !== undefined) await choosePeople(d, b.people);
  if (b.guest !== undefined) await field(d, SW.guest).fill(b.guest);
  if (b.note !== undefined) await field(d, SW.note).fill(b.note);
}
/** A good booking: Technical, 24 Nov 2026 10:00 (five days after the page clock), 1 hour, in person, Sipho. */
export const GOOD: Required<Pick<Booking, 'type' | 'date' | 'time' | 'length' | 'where' | 'place' | 'people'>> = {
  type: 'Technical', date: '24 Nov 2026', time: '10:00', length: '1 hour', where: 'In person', place: 'Durban depot, 14 Quay Road', people: ['Sipho Ndlovu'],
};
export const GOOD_AT = '2026-11-24T10:00:00+02:00';

/** Opens the Schedule drawer from the tab's button and waits until its fields (or W-N1) show. */
export async function openSchedule(page: Page, button: Locator = scheduleButton(page), title: string = SW.schedule): Promise<Locator> {
  await button.click();
  const d = drawerOf(page, title);
  await expect(d).toBeVisible();
  await expect(field(d, SW.type).or(d.getByText(SW.choicesFailed, { exact: true })).first()).toBeVisible();
  return d;
}
/** Opens the Reschedule drawer of the chosen interview. */
export async function openReschedule(page: Page, typeKey: string): Promise<Locator> {
  await rescheduleButton(page).click();
  const d = drawerOf(page, rescheduleTitle(typeKey));
  await expect(d).toBeVisible();
  await expect(field(d, SW.type).or(d.getByText(SW.choicesFailed, { exact: true })).first()).toBeVisible();
  return d;
}

/** Every visible text line and every accessible name in the drawer (labels, options, buttons, help, errors). */
export async function wordsIn(d: Locator): Promise<string[]> {
  return d.evaluate((root) => {
    const out: string[] = [];
    const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode as Text;
      const el = n.parentElement;
      if (!el || el.closest('select') || el.closest('[aria-hidden="true"]') || el.closest('svg') || !visible(el)) continue;
      const t = (n.nodeValue ?? '').replace(/[\s  ]+/g, ' ').trim();
      if (t) out.push(t);
    }
    for (const el of root.querySelectorAll('[aria-label], [title], [placeholder]')) for (const a of ['aria-label', 'title', 'placeholder']) { const v = el.getAttribute(a); if (v) out.push(v.trim()); }
    for (const s of root.querySelectorAll('select')) for (const o of (s as HTMLSelectElement).options) out.push((o.textContent ?? '').trim());
    for (const el of root.querySelectorAll('input, textarea')) { const v = (el as HTMLInputElement).value; if (v && (el as HTMLInputElement).readOnly) out.push(v.trim()); }
    return out;
  });
}

/** A booked interview the way the server sends it after INT-01: Technical, in person, Sipho on the panel, nobody has given feedback. */
export const bookedIv = (id: string, at: string, extra: Partial<Iv> = {}): Iv => iv(id, at, 'SCHEDULED', {
  type: 'TECHNICAL', sequence: 1, can: canOf({ reschedule: true, cancel: true }),
  panel: [person('Sipho Ndlovu', 'WAITING', { person_id: 'sub-a-sipho' })], ...extra,
});
