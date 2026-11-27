import type { BrowserContext, Locator, Page, Route } from '@playwright/test';
import { ON_DEV } from '../fixtures';
import type { ModulesFake } from '../mod-02/modules-fake';
import { WHO, contract, requestProblems, type Call, type Cand, type Co, type HireFake, type Who } from '../rec-ui/harness';
import type { RecordFake } from '../rec-ui-02/record';
import { CHOSEN, NEVER_DAY_AT, chosenOf } from './interviews';
import { expect, main, test as base } from '../rec-ui-03/capture';

/**
 * INT-UI-05 · Panel summary (Jira NH-274, epic NH-223, amber; lock acceptance-lock/int-ui-05 on the child lock
 * acceptance-lock/int-ui-01.4): the words, the fake of `GET /v1/candidates/{id}/scores` and the page helpers of int-ui-05.spec.ts.
 * Spec: specs/interview-journey/cards/INT-UI-05.md, section "Changes after spec check round 1 (27 Nov)" (it wins over the text above
 * it): M-1, M-2, S-1 to S-5, final AC-1 to AC-10, decisions INT-UI-05-D1 to D12. Where the spec is silent, cards/int-ui-05.md says what
 * these tests take (T-P1 up).
 *
 * No older fake answers the scores read: in the older locked tests it falls to the HireFake (`isHireCall` matches `/v1/candidates/`),
 * whose default is 404. This file adds its own route on the same browser context, registered after the HireFake, the interviews fake,
 * the INT-UI-02/03 fakes and the REC-UI-03.2 vote fake (the fixture below depends on them), so it answers the scores read first.
 *
 * The fake answers as lambda/submitVote/rec07.mjs `sheet()` does on develop c541943, for the callers these tests use:
 *   - no or a bad sign-in token 401; a caller the fake does not know 403; Recruitment off 403 `{ error: 'Forbidden' }`;
 *   - another company's candidate, or none, 404 `{ error: 'Not found' }` (`ownsRow`, before anything is read); a caller who is not a
 *     Recruiter is 404 here (`relationOf` gives nothing to someone on no panel of the candidate);
 *   - a Recruiter gets 200 `{ candidate_id, final_score, interviews: [...] }` with the entries the test gave (`set`), in that order.
 * An entry carries everything the server sends: `interview_type`, `scheduled_at`, `pending_count`, `consensus` and `votes[]` with voter
 * ids, comments, `entered_by` and the legacy shape (`legacy: true`, `scale` 0 to 10, `rating` null or set), so a page that draws any of
 * them fails. `refuse()` stands for a network failure, a gateway error, a hold or a scripted answer (the own-only shape, 403, 404).
 * Every 200, 403 and 404 answer is checked against api/openapi.yaml. Nothing here calls Bedrock or any paid AI.
 */

// ---------------------------------------------------------------- the words (W-8, S-7, kit words, W-N1, W-N2; all approved or rule 7a)
export const SW = {
  /** W-8. */
  heading: 'Panel scores',
  /** S-7, final (INT-UI-05-D1). */
  split: 'Split panel',
  outOf: 'out of 5',
  /** Kit and design system list name. */
  criteria: 'Scores by criterion',
  /** W-N1 (rule 7a). */
  failed: 'Panel scores could not be loaded.',
  /** W-N2 (rule 7a). */
  loading: 'Loading the panel scores',
  tryAgain: 'Try again',
} as const;
export const RATING_ORDER: Array<[string, string]> = [['STRONG_YES', 'Strong yes'], ['YES', 'Yes'], ['NO', 'No'], ['STRONG_NO', 'Strong no']];
/** One decimal always (INT-UI-05-D9): 3 is "3.0". */
export const one = (n: number): string => n.toFixed(1);
/** The decisions line of rule 2 for these ratings (new rated votes only), or null when there is none. */
export function decisionsLine(ratings: Array<string | null>): string | null {
  const parts = RATING_ORDER.map(([code, words]) => [ratings.filter((r) => r === code).length, words] as const).filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}`);
  return parts.length ? parts.join(' · ') : null;
}

// ---------------------------------------------------------------- what an answer carries that is never drawn
export const NEVER_S = {
  voter: 'MARK-scores-voter', comment: 'MARK scores comment', enteredBy: 'MARK-entered-by', finalScore: 1.7, pending: 6, consensus: 0.83,
} as const;

// ---------------------------------------------------------------- the answer

export type Vote = { rating: string | null; scores?: Record<string, number>; legacy?: boolean; on_behalf?: boolean };
export type Crit = { key: string; label: string; mean: number | null };
/** One full entry as `sheet()` sends it to a Recruiter. `split`, `overall` and `vote_count` are taken as given (AC-3 sends them wrong). */
export type Entry = {
  interview_id: string; criteria: Crit[]; overall: number | null; split: boolean; votes: Vote[];
  vote_count?: number; pending_count?: number; consensus?: number | null; interview_type?: string | null; scheduled_at?: string | null;
};
export const newVote = (rating: string, scores: Record<string, number> = {}): Vote => ({ rating, scores });
export const legacyVote = (rating: string | null, scores: Record<string, number> = { technical: 8 }): Vote => ({ rating, scores, legacy: true });

/** A full entry with the given numbers; `vote_count` is the number of new votes unless given. */
export const entry = (interview_id: string, criteria: Array<[string, string, number | null]>, overall: number | null, split: boolean, votes: Vote[], extra: Partial<Entry> = {}): Entry => ({
  interview_id, criteria: criteria.map(([key, label, mean]) => ({ key, label, mean })), overall, split, votes, ...extra,
});

function voteOut(v: Vote, n: number): Record<string, unknown> {
  return v.legacy
    ? { voter_id: `${NEVER_S.voter}-${n}`, scores: v.scores ?? {}, rating: v.rating ?? null, comment: `${NEVER_S.comment} ${n}`, legacy: true, scale: { min: 0, max: 10 }, submitted_at: NEVER_DAY_AT }
    : { voter_id: `${NEVER_S.voter}-${n}`, scores: v.scores ?? {}, rating: v.rating, comment: `${NEVER_S.comment} ${n}`, on_behalf: v.on_behalf === true, entered_by: v.on_behalf ? NEVER_S.enteredBy : null, submitted_at: NEVER_DAY_AT };
}
/** The entry on the wire (fact 3). */
export function entryOut(e: Entry): Record<string, unknown> {
  return {
    interview_id: e.interview_id, interview_type: e.interview_type ?? 'TECHNICAL', scheduled_at: e.scheduled_at ?? NEVER_DAY_AT,
    criteria: e.criteria.map((c) => ({ ...c })), overall: e.overall, vote_count: e.vote_count ?? e.votes.filter((v) => !v.legacy).length,
    pending_count: e.pending_count ?? NEVER_S.pending, split: e.split, consensus: e.consensus === undefined ? NEVER_S.consensus : e.consensus,
    votes: e.votes.map((v, i) => voteOut(v, i)),
  };
}
/** The own-only shape a panel member gets (fact 2): criteria without means, own votes only, no numbers. */
export const ownOnly = (candidateId: string, ids: string[]) => ({
  candidate_id: candidateId,
  interviews: ids.map((id) => ({ interview_id: id, criteria: [{ key: 'technical', label: 'Own-only technical' }], votes: [voteOut(newVote('YES', { technical: 4 }), 0)] })),
});

export type ScoresRefusal = { status?: number; body?: unknown; abort?: boolean; hold?: boolean; once?: boolean };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;
export const scoresPath = (pathname: string): RegExpExecArray | null => /\/v1\/candidates\/([^/]+)\/scores$/.exec(pathname);

export class ScoresFake {
  readonly calls: Call[] = [];
  readonly contractErrors: string[] = [];
  private readonly entries = new Map<string, Entry[]>();
  private readonly emails = new Map<string, Who>();
  private readonly refusals: ScoresRefusal[] = [];
  private readonly held: Array<() => void> = [];
  private seq = 0;

  constructor(private readonly hire: HireFake, private readonly record: RecordFake, private readonly subOf: (email: string) => string | undefined, private readonly modulesOf: (co: Co) => string[]) {}

  assign(who: Who): void { this.emails.set(who.email.toLowerCase(), who); }
  /** One candidate's entries, in the server's order. */
  set(candidateId: string, entries: Entry[]): void { this.entries.set(candidateId, entries); }
  refuse(r: ScoresRefusal): void { this.refusals.push({ once: true, ...r }); }
  lift(): void { this.refusals.length = 0; }
  release(): void { for (const go of this.held.splice(0)) go(); }
  get heldCount(): number { return this.held.length; }
  /** Every scores request (not the preflight), for one candidate when given. */
  reads(candidateId?: string): Call[] { return this.calls.filter((c) => c.method !== 'OPTIONS' && (!candidateId || c.path.endsWith(`/v1/candidates/${candidateId}/scores`))); }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => !!scoresPath(url.pathname), (route) => this.handle(route));
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
    const call: Call = {
      seq: ++this.seq, method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), idempotencyKey: request.headers()['idempotency-key'] ?? null,
      body: request.postData() ?? null, authorization, email: who?.email ?? null, company: who?.company ?? null, raw, status: 0,
    };
    this.calls.push(call);
    if (request.method() !== 'GET') return this.send(route, call, 404, { message: 'Not Found' }, false);
    const refusal = this.refusals.shift();
    if (refusal && !refusal.once) this.refusals.unshift(refusal);
    if (refusal?.hold) await new Promise<void>((go) => this.held.push(go));
    if (refusal?.abort) { call.status = -1; return route.abort('internetdisconnected'); }
    if (refusal?.status) return this.send(route, call, refusal.status, refusal.body ?? { error: 'Internal error' }, [200, 403, 404].includes(refusal.status));
    if (!authorization || !JWT.test(authorization)) return this.send(route, call, 401, { message: 'Unauthorized' }, false);
    if (!who) return this.send(route, call, 403, { error: 'Forbidden' });
    const wrong = requestProblems(call.method, call.path, call.query);
    if (wrong.length) { this.contractErrors.push(...wrong); return this.send(route, call, 404, { message: 'Not Found' }, false); }
    if (!this.modulesOf(who.company).includes('recruitment')) return this.send(route, call, 403, { error: 'Forbidden' });
    const id = decodeURIComponent(scoresPath(url.pathname)![1]!);
    const c: Cand | undefined = this.hire.world.cands.find((x) => x.id === id);
    if (!c || this.record.companyOf(c) !== who.company) return this.send(route, call, 404, { error: 'Not found' });
    const recruiter = who.groups.includes('hr_staff') && who.groups.includes('perm-recruitment');
    if (!recruiter) return this.send(route, call, 404, { error: 'Not found' });
    return this.send(route, call, 200, { candidate_id: id, final_score: NEVER_S.finalScore, interviews: (this.entries.get(id) ?? []).map(entryOut) });
  }

  private send(route: Route, call: Call, status: number, body: unknown, checked = true): Promise<void> {
    call.status = status;
    if (checked) {
      const schema = contract().doc.paths?.['/v1/candidates/{id}/scores']?.get?.responses?.[String(status)]?.content?.['application/json']?.schema;
      if (!schema) this.contractErrors.push(`GET /v1/candidates/{id}/scores ${status}: api/openapi.yaml describes no such answer`);
      else this.contractErrors.push(...contract().check(schema, body).map((p) => `GET /v1/candidates/{id}/scores ${status}: ${p}`));
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
type Fx = { scores: ScoresFake | null };
export const test = base.extend<Fx>({
  scores: [
    async ({ context, cognito, modules, hire, record, voter }, use) => {
      if (ON_DEV) return use(null);
      void voter; // registered after every older fake of the tab, so this route answers the scores read first
      const m = modules as ModulesFake;
      const fake = new ScoresFake(hire!, record!, (email) => cognito!.subOf(email), (co) => m.answers[co]);
      for (const who of Object.values(WHO)) fake.assign(who);
      await fake.install(context);
      await use(fake);
      expect(fake.contractErrors, 'every scores request and answer matches api/openapi.yaml').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect, main };

// ---------------------------------------------------------------- page helpers

/** T-P2: the block is the group named "Panel scores" (rule 7), inside the chosen interview. */
export const blockOf = (page: Page): Locator => main(page).getByRole('group', { name: SW.heading, exact: true });
/** T-P3: the loading state is a status region in the chosen interview whose text is W-N2. */
export const loadingOf = (page: Page): Locator => chosenOf(page).getByRole('status').filter({ hasText: SW.loading });
/** T-P4: the failure state is the danger section message with W-N1, holding "Try again". */
export const failureOf = (page: Page): Locator => chosenOf(page).locator('.pp-section-message--danger').filter({ hasText: SW.failed });
export const tryAgainOf = (page: Page): Locator => failureOf(page).getByRole('button', { name: SW.tryAgain, exact: true });
/** Any sign of a block, its loading or its failure anywhere in main. */
export async function noSummary(page: Page, where: string): Promise<void> {
  await expect(blockOf(page), `${where}: no "Panel scores" block`).toHaveCount(0);
  await expect(main(page).getByText(SW.heading, { exact: true }), `${where}: no "Panel scores" anywhere`).toHaveCount(0);
  await expect(main(page).getByText(SW.failed, { exact: true }), `${where}: no scores error`).toHaveCount(0);
  await expect(main(page).getByText(SW.loading, { exact: true }), `${where}: no scores skeleton`).toHaveCount(0);
  await expect(main(page).getByText(SW.split, { exact: true }), `${where}: no "Split panel"`).toHaveCount(0);
}

export type BlockRead = {
  /** All the block's text as a person reads it (decorative and hidden parts dropped), words joined by single spaces. */
  text: string;
  /** Each row of the list named "Scores by criterion", as read. */
  rows: string[];
  /** The width of each row's `.pp-scorecard__fill`, in row order. */
  fills: number[];
  /** Elements with a `style` that sets more than custom properties (S-1). */
  styled: string[];
  /** Person markup or list items outside the criteria list (S-4). */
  foreign: string[];
  headings: Array<{ level: number; text: string }>;
  insideChosen: boolean;
  split: { text: string; warning: boolean; icon: boolean } | null;
};
export async function readBlock(page: Page): Promise<BlockRead> {
  const block = blockOf(page);
  await expect(block, 'one "Panel scores" block').toHaveCount(1);
  return block.evaluate((el, [chosenSel, splitWords]) => {
    const t = (n: Element) => {
      const c = n.cloneNode(true) as HTMLElement;
      c.querySelectorAll('[aria-hidden="true"], svg, .pp-visually-hidden').forEach((x) => x.remove());
      const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      const parts: string[] = [];
      while (w.nextNode()) parts.push(w.currentNode.nodeValue ?? '');
      return parts.join(' ').replace(/[\s  ]+/g, ' ').trim();
    };
    const list = [...el.querySelectorAll('ul, ol')].find((l) => l.getAttribute('aria-label') === 'Scores by criterion'
      || (l.getAttribute('aria-labelledby') ?? '').split(/\s+/).some((id) => (document.getElementById(id)?.textContent ?? '').trim() === 'Scores by criterion'));
    const items = list ? [...list.children].filter((x) => x.tagName === 'LI') : [];
    const lozenge = [...el.querySelectorAll('.pp-lozenge')].find((x) => t(x) === splitWords) ?? null;
    return {
      text: t(el),
      rows: items.map((li) => t(li)),
      fills: items.map((li) => li.querySelector('.pp-scorecard__fill')?.getBoundingClientRect().width ?? -1),
      styled: [...el.querySelectorAll('[style]')].filter((e) => !/^(--[\w-]+:[^;]*;?\s*)+$/.test((e.getAttribute('style') ?? '').trim())).map((e) => `${e.tagName.toLowerCase()} style="${e.getAttribute('style')}"`),
      foreign: [
        ...[...el.querySelectorAll('.pp-person, pp-person, .pp-avatar, pp-avatar, time, [ppDeadline], [ppdeadline]')].map((e) => `${e.tagName.toLowerCase()}.${e.className}`),
        ...[...el.querySelectorAll('li')].filter((li) => !items.includes(li)).map(() => 'an li outside the criteria list'),
      ],
      headings: [...el.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].map((h) => ({ level: Number(h.getAttribute('aria-level') ?? h.tagName.slice(1)), text: t(h) })),
      insideChosen: !!el.closest(chosenSel as string),
      split: lozenge ? { text: t(lozenge), warning: lozenge.classList.contains('pp-lozenge--warning'), icon: !!lozenge.querySelector('svg') } : null,
    };
  }, [`main ${CHOSEN}`, SW.split] as const);
}
/** What the block must read, in order: heading, "Split panel" when split, overall, "out of 5", the decisions line, then each row. */
export function blockText(s: { split: boolean; overall: string; decisions: string | null; rows: Array<[string, string]> }): string {
  return [SW.heading, s.split ? SW.split : null, s.overall, SW.outOf, s.decisions, ...s.rows.map(([l, n]) => `${l} ${n} ${SW.outOf}`)].filter(Boolean).join(' ');
}
export const rowText = (label: string, n: string): string => `${label} ${n} ${SW.outOf}`;

/** Every visible text line and accessible name inside an element (labels, buttons, headings, messages). */
export async function wordsIn(l: Locator): Promise<string[]> {
  return l.evaluate((root) => {
    const out = new Set<string>();
    const add = (t: string | null | undefined) => { const s = (t ?? '').replace(/[\s ]+/g, ' ').trim(); if (s) out.add(s); };
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode as Text;
      const el = n.parentElement;
      if (!el || el.closest('[aria-hidden="true"], svg, script, style')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      add(n.nodeValue);
    }
    for (const e of [root, ...root.querySelectorAll('*')]) {
      add(e.getAttribute('aria-label'));
      for (const id of (e.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)) add(document.getElementById(id)?.textContent);
      add(e.getAttribute('title'));
    }
    return [...out];
  });
}
