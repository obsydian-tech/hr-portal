import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page, Request, Route } from '@playwright/test';
import { answerSchema, checker, readDoc, type Doc } from '../rec-14/schema';

/**
 * REC-UI-03 step 1: the two public routes of the guest scoring page, answered in the browser the way REC-07's
 * `lambda/submitVoteByToken/rec07.mjs` answers them (PR 501), and nothing else.
 *
 *   GET  /v1/scoring-links/{token}   200 { candidate_first, candidate_last, role_title, interview_type, interview_at, criteria, expires_at }
 *   POST /v1/scoring-links/{token}   { scores: { <key>: 1..5 }, rating, comment? } -> 200 { saved: true }; 400 INVALID_SCORES or INVALID_FIELD
 *   either, for an expired, used, unknown or malformed token: 410 { "error": "Scoring link has expired" } (one answer for all four)
 *
 * Like the real one it checks the token's form (20 to 128 of A-Z a-z 0-9 _ -), checks the body as `checkBody` does, marks a link
 * used on the first good POST, and answers CORS as the real gateway does (talent-flow-infra/talent-flow-apigateway.tf
 * cors_configuration: no credentials, headers authorization, content-type, idempotency-key). Every 200 GET answer is checked
 * against api/openapi.yaml (additionalProperties false), so a fake answer cannot carry a field the real one does not,
 * except where a test says `loose` on purpose (AC-5: what the page does with a field it was never meant to get).
 *
 * It answers only the TalentFlow API host named in src/environments/environment.ts (`talentFlowApiUrl`). A scoring call to any
 * other host is recorded in `strayHosts` and refused. It records every call, the page's address at the moment of the call,
 * and every header the browser sent.
 */

export const EXPIRED_BODY = JSON.stringify({ error: 'Scoring link has expired' });
const TOKEN_FORM = /^[A-Za-z0-9_-]{20,128}$/;
const RATINGS = ['STRONG_NO', 'NO', 'YES', 'STRONG_YES'] as const;
export type Rating = (typeof RATINGS)[number];

export type GuestAnswer = {
  candidate_first: string;
  candidate_last: string;
  role_title: string | null;
  interview_type: string;
  interview_at: string;
  criteria: Array<{ key: string; label: string }>;
  expires_at: string;
};

export type LinkState = 'ok' | 'used' | 'expired';
type Link = { answer: GuestAnswer & Record<string, unknown>; state: LinkState; loose: boolean };

export type Call = {
  method: string;
  url: string;
  path: string;
  /** The token as the path carried it, decoded. */
  token: string;
  headers: Record<string, string>;
  raw: string | null;
  body: any;
  /** The address of the page that sent it, read when the call reached the fake (before it is answered). */
  pageUrl: string;
  status: number;
};

export type Scripted = { status: number; body?: unknown } | 'abort';

/** The TalentFlow API origin the app is built with (the no-backend placeholder, or pepla-dev's in CI). */
export function talentFlowOrigin(): string {
  const env = readFileSync(join(__dirname, '..', '..', '..', '..', 'src', 'environments', 'environment.ts'), 'utf8');
  const url = /talentFlowApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(env)?.[1] ?? '';
  return new URL(url).origin;
}

let doc: Doc | null = null;
const docOnce = () => (doc ??= readDoc());

export class GuestFake {
  readonly calls: Call[] = [];
  readonly preflights: Array<{ path: string; method: string; headers: string; origin: string }> = [];
  readonly strayHosts: string[] = [];
  /** Answers that failed the openapi check (a test ends red when this is not empty). */
  readonly contractErrors: string[] = [];
  private readonly links = new Map<string, Link>();
  private readonly nextGets: Scripted[] = [];
  private readonly nextPosts: Scripted[] = [];
  private holdPosts = false;
  private readonly held: Array<() => void> = [];
  readonly apiOrigin = talentFlowOrigin();

  constructor(readonly appOrigin: string) {}

  /** A link that opens `answer`. */
  add(token: string, answer: GuestAnswer, state: LinkState = 'ok'): string {
    this.links.set(token, { answer: { ...answer }, state, loose: false });
    return token;
  }

  /** A link whose GET answer carries fields the real one never sends (not checked against the file). */
  addLoose(token: string, answer: GuestAnswer & Record<string, unknown>): string {
    this.links.set(token, { answer: { ...answer }, state: 'ok', loose: true });
    return token;
  }

  stateOf(token: string): LinkState | undefined {
    return this.links.get(token)?.state;
  }

  /** The next GET (or POST) gets this answer instead of the link's own (a gateway error, a throttle, a dropped connection). */
  nextGet(s: Scripted): void { this.nextGets.push(s); }
  nextPost(s: Scripted): void { this.nextPosts.push(s); }

  /** Holds every POST until `release()`: shows what the page does while its submit is on the way. */
  hold(): void { this.holdPosts = true; }
  release(): void {
    this.holdPosts = false;
    for (const go of this.held.splice(0)) go();
  }

  gets(): Call[] { return this.calls.filter((c) => c.method === 'GET'); }
  posts(): Call[] { return this.calls.filter((c) => c.method === 'POST'); }

  /** The page's own address at the moment it sent each scoring call (read inside the page, at the fetch or XHR send), this load,
   * and the fetch cache mode it asked for ('xhr' for an XHR). Playwright's routing turns the browser's HTTP cache off, so a
   * cache mode is the only way a test here can see that the page asked the browser to keep or reuse an answer. */
  async sentFrom(page: Page): Promise<Array<{ url: string; href: string; cache: string }>> {
    return page.evaluate(() => (window as unknown as { __recUi03Sends?: Array<{ url: string; href: string; cache: string }> }).__recUi03Sends ?? []);
  }

  async install(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
      const w = window as unknown as { __recUi03Sends: Array<{ url: string; href: string; cache: string }> };
      w.__recUi03Sends = [];
      const note = (url: string, cache: string) => { if (/\/v1\/scoring-links\//.test(url)) w.__recUi03Sends.push({ url, href: window.location.href, cache }); };
      const open = XMLHttpRequest.prototype.open;
      const send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __u?: string }, ...args: unknown[]) {
        this.__u = String(args[1]);
        return (open as (...a: unknown[]) => void).apply(this, args);
      } as typeof XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __u?: string }, body?: Document | XMLHttpRequestBodyInit | null) {
        note(this.__u ?? '', 'xhr');
        return send.call(this, body);
      };
      const fetch0 = window.fetch;
      window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        note(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init?.cache ?? (input instanceof Request ? input.cache : 'default'));
        return fetch0.call(window, input, init);
      };
    });
    await context.route((url) => url.origin !== this.appOrigin && /^\/v1\/scoring-links(\/|$)/.test(url.pathname), (route) => this.handle(route));
  }

  private cors(request: Request): Record<string, string> {
    // The real gateway names the asking origin when it is allowed, and never allows credentials.
    const origin = request.headers()['origin'] ?? this.appOrigin;
    return { 'access-control-allow-origin': origin, vary: 'Origin' };
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== this.apiOrigin) {
      this.strayHosts.push(`${request.method()} ${url.origin}`);
      return route.abort('blockedbyclient');
    }
    if (request.method() === 'OPTIONS') {
      this.preflights.push({
        path: url.pathname,
        method: request.headers()['access-control-request-method'] ?? '',
        headers: request.headers()['access-control-request-headers'] ?? '',
        origin: request.headers()['origin'] ?? '',
      });
      return route.fulfill({
        status: 204,
        headers: {
          ...this.cors(request),
          'access-control-allow-headers': 'authorization,content-type,idempotency-key',
          'access-control-allow-methods': 'DELETE,GET,OPTIONS,PATCH,POST,PUT',
          'access-control-max-age': '86400',
        },
      });
    }
    let pageUrl = '';
    try { pageUrl = request.frame().url(); } catch { pageUrl = ''; }
    const seg = url.pathname.slice('/v1/scoring-links/'.length);
    let token = seg;
    try { token = decodeURIComponent(seg); } catch { /* keeps the raw segment */ }
    const raw = request.postData();
    let body: any = null;
    try { body = raw === null ? null : JSON.parse(raw); } catch { body = undefined; }
    const call: Call = { method: request.method(), url: url.href, path: url.pathname, token, headers: await request.allHeaders(), raw, body, pageUrl, status: 0 };
    this.calls.push(call);

    if (call.method === 'POST' && this.holdPosts) await new Promise<void>((go) => this.held.push(go));
    const scripted = (call.method === 'GET' ? this.nextGets : call.method === 'POST' ? this.nextPosts : []).shift();
    if (scripted === 'abort') { call.status = -1; return route.abort('connectionreset'); }
    const out = scripted ?? this.answer(call, seg);
    call.status = out.status;
    return route.fulfill({
      status: out.status,
      headers: { ...this.cors(request), 'content-type': 'application/json' },
      body: typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? {}),
    });
  }

  private answer(call: Call, seg: string): { status: number; body: unknown } {
    const expired = { status: 410, body: EXPIRED_BODY };
    if (call.method !== 'GET' && call.method !== 'POST') return { status: 404, body: { message: 'Not Found' } };
    if (seg.includes('/') || !TOKEN_FORM.test(call.token)) return expired;
    const link = this.links.get(call.token);
    if (!link || link.state !== 'ok') return expired;
    if (call.method === 'GET') {
      if (!link.loose) {
        const problems = checker(docOnce()).check(answerSchema(docOnce(), 'GET /v1/scoring-links/{token}', 200), link.answer);
        for (const p of problems) this.contractErrors.push(`GET /v1/scoring-links/{token} 200: ${p}`);
      }
      return { status: 200, body: link.answer };
    }
    // POST: the body as checkBody judges it.
    const b = call.body;
    const keys = link.answer.criteria.map((c) => c.key);
    const s = b?.scores;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { status: 400, body: { error: 'Bad request', code: 'INVALID_SCORES' } };
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { status: 400, body: { error: 'Bad request', code: 'INVALID_SCORES' } };
    const got = Object.keys(s);
    if (got.length !== keys.length || !keys.every((k) => got.includes(k))) return { status: 400, body: { error: 'Bad request', code: 'INVALID_SCORES' } };
    if (!keys.every((k) => Number.isInteger(s[k]) && s[k] >= 1 && s[k] <= 5)) return { status: 400, body: { error: 'Bad request', code: 'INVALID_SCORES' } };
    if (!RATINGS.includes(b.rating)) return { status: 400, body: { error: 'Bad request', code: 'INVALID_FIELD', field: 'rating' } };
    if (b.comment !== undefined && (typeof b.comment !== 'string' || b.comment.length > 2000)) return { status: 400, body: { error: 'Bad request', code: 'INVALID_FIELD', field: 'comment' } };
    link.state = 'used';
    return { status: 200, body: { saved: true } };
  }
}

/**
 * Every request the browser made, every console line and page error, for one test. Installed before the first page load.
 */
export class Watch {
  readonly requests: Array<{ method: string; url: string; resourceType: string; headers: Record<string, string>; postData: string | null }> = [];
  readonly console: string[] = [];
  /** Uncaught errors in the page (an unhandled error is where a request URL, and so a token, most often leaks). */
  readonly pageErrors: string[] = [];
  private readonly pending: Promise<void>[] = [];

  track(page: Page): void {
    page.on('request', (r) => {
      const entry = { method: r.method(), url: r.url(), resourceType: r.resourceType(), headers: {} as Record<string, string>, postData: r.postData() };
      this.requests.push(entry);
      this.pending.push(r.allHeaders().then((h) => { entry.headers = h; }).catch(() => { entry.headers = r.headers(); }));
    });
    page.on('console', (m) => this.console.push(m.text()));
    page.on('pageerror', (e) => { const line = `${e.name}: ${e.message}\n${e.stack ?? ''}`; this.console.push(line); this.pageErrors.push(line); });
  }

  async settled(): Promise<void> {
    await Promise.all(this.pending);
  }
}
