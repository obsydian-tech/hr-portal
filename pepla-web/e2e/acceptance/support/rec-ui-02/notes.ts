import type { BrowserContext, Locator, Page, Route } from '@playwright/test';
import { ON_DEV } from '../fixtures';
import type { ModulesFake } from '../mod-02/modules-fake';
import { WHO, contract, expect, iso, requestProblems, type Call, type Cand, type Co, type HireFake, type Who } from '../rec-ui/harness';
import { main, test as base, type RecordFake } from './record';

/**
 * REC-UI-02 step 4 · The candidate's Notes tab (history) (Jira NH-280, epic NH-223, lock acceptance-lock/rec-ui-02.4, a child of
 * rec-ui-02.3): the words, the fake of `GET /v1/candidates/{id}/events` and the page helpers of rec-ui-02-notes.spec.ts.
 * Spec: onboarding-cards/specs/REC-UI-02-notes-tab.md (R-1 to R-5, AC-N1 to AC-N11), its check REC-UI-02-notes-tab-spec-check.md
 * (rounds 1 and 2, M-1 to M-6, S-1 to S-6, G-1 and G-2), decisions D-RUI-02.22 to .30.
 *
 * Neither the harness (support/rec-ui/harness.ts) nor the record fake answers the history. This file adds its own route on the same
 * browser context for that one route. The answer is built over api/openapi.yaml `CandidateEvents` (REC-15 step D, develop 31d048f;
 * REC-15 rule 31): `rowOf` fills the file's own property list and refuses a field the file does not have, and every answer is
 * checked against the file before it is sent. A test ends red when `contractErrors` is not empty.
 *
 * The fake answers as lambda/getCandidateEvents/index.js does at 31d048f:
 *   - no or a bad sign-in token is 401; a caller without the Recruiter groups, or whose company has Recruitment off, is 403;
 *   - another company's candidate, or none, is 404 `{ error: 'Not found' }` (`candidateIsOurs`), never a 403;
 *   - a `nextToken` the fake did not hand out, exactly, is 400 `{ message: 'Invalid nextToken' }` (the tokens hold `+`, `/` and `=`);
 *   - the rows come oldest first; stage-history rows (`source` talent-flow.stage-history) come on page one only, joined in time order;
 *   - every row carries `at`, `kind` and `by_name`, and marker values in every field R-5 says is never drawn.
 * A Move or Not hired the page saves through the harness adds the rows the server writes for it (a stage-history row and the bus
 * copy, D-RUI-02.23), so a history read after the save has the new line.
 * Nothing here calls Bedrock or any paid AI.
 */

// ---------------------------------------------------------------- the words (W-N1 to W-N7, D-RUI-02.22 and .26; kit words)
export const NW = {
  notes: 'Notes',
  overview: 'Overview',
  /** W-N6. */
  empty: 'No history yet.',
  /** W-N7 with "Try again" (the step 3 pattern, D-RUI-02.15). */
  failed: 'The history could not be loaded.',
  tryAgain: 'Try again',
  today: 'Today',
  /** The kit's hidden change words: `change.label` "Stage changed", then "from" and "to". */
  changeLabel: 'Stage changed from',
  changeTo: 'to',
  /** Step 3's not-found line. */
  notFound: 'This candidate could not be found.',
} as const;
/** The kit's aria-label of the timeline. */
export const historyFor = (name: string) => `History for ${name}`;
export const STAGE_NAME: Record<string, string> = { APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview', OFFER: 'Offer', HIRED: 'Hired', NOT_HIRED: 'Not hired' };
/** W-N2: "{by_name} moved {first} to {Stage}"; the name is the bold part. With no name: "{first} moved to {Stage}". */
export const movedLine = (first: string, to: string, by?: string | null) => (by ? `${by} moved ${first} to ${STAGE_NAME[to]}` : `${first} moved to ${STAGE_NAME[to]}`);
/** W-N3. */
export const listLine = (first: string, to: string) => `${first} moved to ${STAGE_NAME[to]} when the stage list changed`;
/** W-N4 summary (same shape as W-N2, to Not hired); its detail is `reasonLine`. */
export const notHiredLine = (first: string, by?: string | null) => movedLine(first, 'NOT_HIRED', by);
export const reasonLine = (label: string) => `Reason: ${label}`;
/** W-N5. */
export const addedLine = (first: string) => `${first} added as a candidate`;

// ---------------------------------------------------------------- time (R-4, SAST)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SAST = 2 * 3_600_000;
/** "3 Nov 2026" in South African time. */
export const sastDay = (at: string): string => {
  const d = new Date(Date.parse(at) + SAST);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
/** "3 Nov 2026, 15:05" in South African time (the `title`, and the time on older days). */
export const sastExact = (at: string): string => {
  const d = new Date(Date.parse(at) + SAST);
  return `${sastDay(at)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- what a row carries that is never drawn (R-5)
export const MARK = {
  by: 'MARK-by-sign-in-id', actor: 'MARK-actor-sign-in-id', byKind: 'MARK-by-kind', tenant: 'MARK-tenant-id', reason: 'MARK-free-text-reason',
  detailNote: 'MARK-detail-note', detailEmail: 'mark.detail@example.org', detailKey: 'MARKDETAILKEY', eventId: 'MARK-event-id',
  unknownCode: 'MARK_UNKNOWN_REASON_CODE',
} as const;

// ---------------------------------------------------------------- the rows

export const SOURCE = { stage: 'talent-flow.stage-history', workflow: 'talent-flow.workflow', interviews: 'talent-flow.interviews' } as const;

/** One history row as a test writes it; `rowOf` fills the rest from the file. */
export type Row = {
  kind: string; source?: string; at: string | null; by_name?: string | null; from?: string | null; to?: string | null;
  reason_code?: string | null; reason?: string | null; detail?: Record<string, unknown>; eventId?: string;
};

/** A stage move written by a person (W-N2; a Reopen is a move from Not hired). */
export const moved = (at: string | null, from: string | null, to: string | null, by_name: string | null): Row => ({ kind: 'CandidateMoved', source: SOURCE.stage, at, from, to, by_name });
/** A move written by the stage move script (W-N3). */
export const listChange = (at: string, from: string, to: string): Row => ({ kind: 'CandidateMoved', source: SOURCE.stage, at, from, to, by_name: null, reason_code: 'STAGE_LIST_CHANGE' });
/** A Not hired (W-N4). */
export const notHired = (at: string, from: string, reason_code: string | null, by_name: string | null): Row => ({ kind: 'CandidateMoved', source: SOURCE.stage, at, from, to: 'NOT_HIRED', reason_code, by_name });
/** The candidate was added (W-N5). Real adds name the person who added; the words have no name, so these rows carry none (T-N2). */
export const added = (at: string): Row => ({ kind: 'CandidateCreated', source: SOURCE.workflow, at, by_name: null, detail: { email: MARK.detailEmail } });
/** A row that is never drawn: any other kind or source. */
export const other = (at: string, kind: string, source: string, extra: Partial<Row> = {}): Row => ({ kind, source, at, by_name: 'Thandi Dube', ...extra });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
const isEventsPath = (pathname: string): RegExpExecArray | null => /\/v1\/candidates\/([^/]+)\/events$/.exec(pathname);
/** A page token the way the server makes them (base64): this one always holds `+`, `/` and `=` (S-1). */
const tokenOf = (id: string, page: number) => `eyJQSyI6+${Buffer.from(`${id}#${page}`).toString('base64url')}/c2s=`;

export type EventsRefusal = { status?: number; body?: unknown; abort?: boolean; hold?: boolean; once?: boolean; id?: string; page?: number };

/** A Move or Not hired saved through the harness: the history rows the server writes for it once the save answered 200. */
type Saved = { id: string; from: string; index: number; kind: 'move' | 'notHired' };

export class EventsFake {
  readonly calls: Call[] = [];
  /** The full address of every history request, in order (AC-N8b replays one with another candidate's id). */
  readonly urls: string[] = [];
  readonly contractErrors: string[] = [];
  /** Per candidate: the rows of the events table, page by page (oldest first across pages), and the stage-history rows (page one). */
  private readonly tables = new Map<string, { pages: Row[][]; stage: Row[] }>();
  /** Candidates whose history keeps sending a `nextToken` forever. */
  readonly endless = new Set<string>();
  private readonly emails = new Map<string, Who>();
  private readonly refusals: EventsRefusal[] = [];
  private readonly held: Array<() => void> = [];
  private readonly saved: Saved[] = [];
  private seq = 0;

  constructor(private readonly hire: HireFake, private readonly record: RecordFake, private readonly subOf: (email: string) => string | undefined, private readonly modulesOf: (co: Co) => string[]) {}

  assign(who: Who): void { this.emails.set(who.email.toLowerCase(), who); }
  /** One candidate's history: stage-history rows and other rows on one page, as the server would join them. */
  set(id: string, rows: Row[]): void {
    this.tables.set(id, { stage: rows.filter((r) => r.source === SOURCE.stage), pages: [rows.filter((r) => r.source !== SOURCE.stage)] });
  }
  /** One candidate's history over several pages: `pages` are the events table's pages, `stage` the stage-history rows (page one only). */
  setPages(id: string, stage: Row[], pages: Row[][]): void { this.tables.set(id, { stage, pages }); }
  refuse(r: EventsRefusal): void { this.refusals.push({ once: true, ...r }); }
  lift(): void { this.refusals.length = 0; }
  release(): void { for (const go of this.held.splice(0)) go(); }
  get heldCount(): number { return this.held.length; }

  get requests(): Call[] { return this.calls.filter((c) => c.method !== 'OPTIONS'); }
  reads(id?: string): Call[] { return this.requests.filter((c) => c.method === 'GET' && (!id || c.path.endsWith(`/v1/candidates/${id}/events`))); }

  async install(context: BrowserContext): Promise<void> {
    // A Move or Not hired: note the stage before the save, then let the harness answer it (registered after it, so this runs first).
    await context.route((url) => /\/v1\/candidates\/[^/]+\/(stage|not-hired)$/.test(url.pathname), (route) => {
      const r = route.request();
      if (r.method() === 'PUT' || r.method() === 'POST') {
        const m = /\/v1\/candidates\/([^/]+)\/(stage|not-hired)$/.exec(new URL(r.url()).pathname)!;
        const id = decodeURIComponent(m[1]!);
        const c = this.hire.world.cands.find((x) => x.id === id);
        if (c) this.saved.push({ id, from: c.stage, index: this.hire.calls.length, kind: m[2] === 'stage' ? 'move' : 'notHired' });
      }
      return route.fallback();
    });
    await context.route((url) => !!isEventsPath(url.pathname), (route) => this.handle(route));
  }

  /** The rows the server wrote for the saves the harness answered with 200 (a stage-history row and its bus copy each). */
  private savedRows(id: string): { stage: Row[]; events: Row[] } {
    const stage: Row[] = [], events: Row[] = [];
    for (const s of this.saved.filter((x) => x.id === id)) {
      const call = this.hire.calls[s.index];
      if (!call || call.status !== 200 || !call.path.endsWith(`/${id}/${s.kind === 'move' ? 'stage' : 'not-hired'}`)) continue;
      const who = [...this.emails.values()].find((w) => w.email === call.email);
      const at = iso(this.hire.world.now - 60_000 + s.index);
      const body = (call.body ?? {}) as { to?: string; reason?: string };
      if (s.kind === 'move') {
        stage.push(moved(at, s.from, body.to ?? null, who?.full ?? null));
        events.push(other(at, 'CandidateMoved', SOURCE.workflow, { from: s.from, to: body.to ?? null, by_name: who?.full ?? null }));
      } else {
        stage.push(notHired(at, s.from, body.reason ?? null, who?.full ?? null));
        events.push(other(at, 'CandidateNotHired', SOURCE.workflow, { from: s.from, to: 'NOT_HIRED', reason_code: body.reason ?? null, by_name: who?.full ?? null }));
      }
    }
    return { stage, events };
  }

  /** One row of the answer, built over the file's own property list. */
  rowOf(candidateId: string, r: Row, n: number): Record<string, unknown> {
    const values: Record<string, unknown> = {
      eventId: r.eventId ?? `${MARK.eventId}-${n}`, eventType: r.kind, kind: r.kind, source: r.source, candidateId, tenant_id: MARK.tenant,
      actor: MARK.actor, timestamp: r.at, at: r.at, by_name: r.by_name ?? null,
      detail: r.detail ?? { note: MARK.detailNote, [MARK.detailKey]: MARK.detailNote },
      from: r.from, to: r.to, by: MARK.by, by_kind: MARK.byKind, reason_code: r.reason_code, reason: r.reason === undefined ? MARK.reason : r.reason,
    };
    const props = ((contract().doc.components?.schemas?.['CandidateEvents'] as { properties?: { events?: { items?: { properties?: Record<string, unknown> } } } })?.properties?.events?.items?.properties ?? {}) as Record<string, unknown>;
    const unknown = Object.keys(values).filter((k) => !(k in props));
    if (unknown.length) throw new Error(`events fake: api/openapi.yaml CandidateEvents has no ${unknown.join(', ')}`);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(props)) if (values[k] !== undefined) out[k] = values[k];
    return out;
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
    if (request.method() !== 'GET') return route.fallback();
    const authorization = request.headers()['authorization'] ?? null;
    const who = authorization && JWT.test(authorization) ? this.who(subOfBearer(authorization)) : null;
    const raw = `${request.method()} ${url.pathname}${url.search}\n${JSON.stringify(request.headers())}\n`;
    const call: Call = {
      seq: ++this.seq, method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), idempotencyKey: request.headers()['idempotency-key'] ?? null,
      body: null, authorization, email: who?.email ?? null, company: who?.company ?? null, raw, status: 0,
    };
    this.calls.push(call);
    this.urls.push(request.url());
    const id = decodeURIComponent(isEventsPath(url.pathname)![1]!);
    const token = url.searchParams.get('nextToken');
    const pageNo = token === null ? 1 : this.pageOfToken(id, token);
    const refusal = this.refusals.find((r) => (!r.id || r.id === id) && (!r.page || r.page === pageNo));
    if (refusal) {
      if (refusal.once) this.refusals.splice(this.refusals.indexOf(refusal), 1);
      if (refusal.hold) await new Promise<void>((go) => this.held.push(go));
      if (refusal.abort) { call.status = -1; return route.abort('internetdisconnected'); }
      if (!refusal.hold || refusal.status) return this.send(route, call, refusal.status ?? 500, refusal.body ?? { message: 'Failed to retrieve candidate events' });
    }
    if (!authorization || !JWT.test(authorization)) return this.send(route, call, 401, { message: 'Unauthorized' }, false);
    if (!who) return this.send(route, call, 403, { error: 'Forbidden' });
    const wrong = requestProblems(call.method, call.path, call.query);
    if (wrong.length) { this.contractErrors.push(...wrong); return this.send(route, call, 404, { message: 'Not Found' }, false); }
    const recruiter = who.groups.includes('hr_staff') && who.groups.includes('perm-recruitment');
    if (!recruiter || !this.modulesOf(who.company).includes('recruitment')) return this.send(route, call, 403, { error: 'Forbidden' });
    const c: Cand | undefined = this.hire.world.cands.find((x) => x.id === id);
    // Another company's candidate, or none: 404 (candidateIsOurs), before any row is read.
    if (!c || this.record.companyOf(c) !== who.company) return this.send(route, call, 404, { error: 'Not found' });
    if (token !== null && pageNo === 0) return this.send(route, call, 400, { message: 'Invalid nextToken' });
    const t = this.tables.get(id) ?? { stage: [], pages: [[]] };
    const live = this.savedRows(id);
    const pages = t.pages.length ? t.pages : [[]];
    const endless = this.endless.has(id);
    let rows = [...(pages[pageNo - 1] ?? [])];
    if (pageNo === 1) rows = rows.concat(t.stage, live.stage, live.events);
    // Oldest first, as the server sorts (a row with no time sorts first, as String('') does there).
    rows.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
    const more = endless || pageNo < pages.length;
    const events = rows.map((r, i) => this.rowOf(id, r, pageNo * 1000 + i));
    return this.send(route, call, 200, { events, total: events.length, ...(more ? { nextToken: tokenOf(id, pageNo + 1) } : {}) });
  }

  /** The page a token stands for (2 up), or 0 when the fake never handed it out (it must come back exactly, S-1). */
  private pageOfToken(id: string, token: string): number {
    for (let p = 2; p <= 50; p++) if (tokenOf(id, p) === token) return p;
    return 0;
  }

  private send(route: Route, call: Call, status: number, body: unknown, checked = true): Promise<void> {
    call.status = status;
    if (checked) {
      const schema = contract().doc.paths?.['/v1/candidates/{id}/events']?.get?.responses?.[String(status)]?.content?.['application/json']?.schema;
      if (!schema) this.contractErrors.push(`GET /v1/candidates/{id}/events ${status}: api/openapi.yaml describes no such answer`);
      else this.contractErrors.push(...contract().check(schema, body).map((p) => `GET /v1/candidates/{id}/events ${status}: ${p}`));
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
type Fx = { events: EventsFake | null };
export const test = base.extend<Fx>({
  events: [
    async ({ context, cognito, modules, hire, record }, use) => {
      if (ON_DEV) return use(null);
      const m = modules as ModulesFake;
      const fake = new EventsFake(hire!, record!, (email) => cognito!.subOf(email), (co) => m.answers[co]);
      for (const who of Object.values(WHO)) fake.assign(who);
      // Registered after the harness and the record fake, so this one answers the history first.
      await fake.install(context);
      await use(fake);
      expect(fake.contractErrors, 'every history request and answer matches api/openapi.yaml (REC-15 rule 31)').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

// ---------------------------------------------------------------- page helpers

export const tab = (page: Page, name: string): Locator => main(page).getByRole('tab', { name, exact: true });
/** Chooses Notes. */
export async function chooseNotes(page: Page): Promise<void> {
  await tab(page, NW.notes).click();
  await expect(tab(page, NW.notes)).toHaveAttribute('aria-selected', 'true');
}
export async function chooseOverview(page: Page): Promise<void> {
  await tab(page, NW.overview).click();
  await expect(tab(page, NW.overview)).toHaveAttribute('aria-selected', 'true');
}
/** The region the Notes tab labels (R-1: one region labelled by the Notes tab). */
export async function notesRegion(page: Page): Promise<Locator> {
  const id = await tab(page, NW.notes).getAttribute('id');
  expect(id, 'the Notes tab has an id a region can point at').toBeTruthy();
  return main(page).locator(`[aria-labelledby~="${id}"]`);
}
export const timeline = (page: Page): Locator => main(page).locator('ol.pp-timeline');
export const eventsOf = (page: Page): Locator => main(page).locator('.pp-timeline__event');

export type Line = { summary: string; bold: string | null; change: { from: string; to: string; hidden: string } | null; detail: string | null; time: string; datetime: string | null; title: string | null; marker: { avatar: string | null; icon: boolean } };
/** One history line as a person reads it: the summary, its bold name, the from-to change (with its hidden words) or the detail line, the time, and the marker. */
export async function readLines(page: Page): Promise<Line[]> {
  return eventsOf(page).evaluateAll((lis) => lis.map((li) => {
    const t = (n: Element | null | undefined, dropHidden = true) => {
      if (!n) return '';
      const c = n.cloneNode(true) as HTMLElement;
      if (dropHidden) c.querySelectorAll('.pp-visually-hidden').forEach((x) => x.remove());
      return (c.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();
    };
    const summary = li.querySelector('.pp-timeline__summary');
    const details = [...li.querySelectorAll('.pp-timeline__detail')];
    const changeEl = details.find((d) => d.querySelector('del, ins'));
    const detailEl = details.find((d) => !d.querySelector('del, ins'));
    const time = li.querySelector('time');
    const avatar = li.querySelector('.pp-timeline__marker .pp-avatar');
    return {
      summary: t(summary), bold: summary?.querySelector('strong') ? t(summary.querySelector('strong')) : null,
      change: changeEl ? { from: t(changeEl.querySelector('del')), to: t(changeEl.querySelector('ins')), hidden: [...changeEl.querySelectorAll('.pp-visually-hidden')].map((h) => t(h, false)).join(' ') } : null,
      detail: detailEl ? t(detailEl) : null,
      time: t(time), datetime: time?.getAttribute('datetime') ?? null, title: time?.getAttribute('title') ?? null,
      marker: { avatar: avatar ? t(avatar) : null, icon: !!li.querySelector('.pp-timeline__marker .pp-timeline__icon') },
    };
  }));
}
/** The day headings and each day's lines (summaries), in page order; lines before the first heading or after a heading-less part go under ''. */
export async function readDays(page: Page): Promise<Array<{ day: string; lines: string[] }>> {
  return timeline(page).first().evaluate((ol) => {
    const out: Array<{ day: string; lines: string[] }> = [];
    const t = (n: Element | null) => {
      if (!n) return '';
      const c = n.cloneNode(true) as HTMLElement;
      c.querySelectorAll('.pp-visually-hidden').forEach((x) => x.remove());
      return (c.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();
    };
    for (const li of [...ol.children]) {
      if (li.classList.contains('pp-timeline__day')) out.push({ day: t(li), lines: [] });
      else if (li.classList.contains('pp-timeline__event')) {
        if (!out.length) out.push({ day: '', lines: [] });
        out.at(-1)!.lines.push(t(li.querySelector('.pp-timeline__summary')));
      }
    }
    return out;
  });
}

/** Another record reached inside the app with no page load (the pattern of step 3 AC-R10 and rec-ui-04.spec.ts). */
export const inApp = (page: Page, id: string) => page.evaluate((x) => { history.pushState({}, '', `/hire/candidates/${x}`); dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, id);
