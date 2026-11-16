import type { BrowserContext, Route } from '@playwright/test';
import { NOTICE_2026_11_1, VERSION, filled, type Notice } from './notice';

/**
 * ONB-05: a stand-in for GET <employeesApiUrl>/v1/me and POST <employeesApiUrl>/v1/me/consent, for the no-backend
 * run, answering in the browser exactly as the ONB-05 spec (NH-174, "What gets built" 3 and 4) fixes them.
 *
 * It is on for every test (support/fixtures.ts), so every page an employee opens finds its answer: a signed-in
 * employee gets their own start page with the current notice and no consent yet. Tests change `people`, the
 * notices, the current version, or queue answers in `nextGets` / `nextPosts`.
 *
 * - Every call needs `Authorization: Bearer <JWT>` (the API's Cognito authorizer), or it gets 401.
 * - A token not in the group `employee` gets 403 { error: "This page is for new employees" }.
 * - The person is found by the token's email (trimmed, lower case) in `people`; else 404.
 * - CORS allows only `authorization` and `content-type`, as the real employees API does: a new request header is
 *   refused at the preflight, as on pepla-dev (LESSONS, NH-187).
 * Every call (method, path, body, headers, the page's address) and every preflight is recorded.
 */

export const ME_COMPANY = 'Mokoena Logistics';
export const NOT_EMPLOYEE = 'This page is for new employees';
export const NOT_FOUND = "We can't find your record. Ask your HR team.";
export const CHANGED = 'The notice has changed. Read it again.';
export const BAD_BODY = 'Send the notice version';

export type Person = { firstName: string; company?: string; department?: string; startDate?: string; consents: Record<string, string> };
export type Canned = { status: number; body?: unknown } | 'offline';
export type MeCall = { method: 'GET' | 'POST'; path: string; body: unknown; rawBody: string | null; headers: Record<string, string>; pageUrl: string; email: string };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const JWT = /^Bearer (eyJ[\w-]+)\.(eyJ[\w-]+)\.[\w-]*$/;

export const isMeApi = (url: URL, appOrigin: string) => url.origin !== appOrigin && /\/v1\/me(\/consent)?$/.test(url.pathname);

export class MeFake {
  /** Notices by version, `{company}` not filled in. */
  readonly notices: Record<string, Notice> = { [VERSION]: NOTICE_2026_11_1 };
  current = VERSION;
  /** People by email (lower case). Anyone in `employee` who is not here gets `defaultPerson` the first time. */
  readonly people = new Map<string, Person>();
  /** When false, an employee who is not in `people` gets 404. */
  addUnknown = true;
  readonly calls: MeCall[] = [];
  readonly preflights: Array<{ path: string; requestHeaders: string }> = [];
  readonly nextGets: Canned[] = [];
  readonly nextPosts: Canned[] = [];
  holdGets = false;
  holdPosts = false;
  /** The server's clock for a new acceptance. */
  now = '2026-11-16T06:42:00.000Z';
  private held: Array<() => void> = [];

  constructor(private readonly appOrigin: string) {}

  defaultPerson(firstName: string): Person {
    return { firstName, company: ME_COMPANY, department: 'Operations', startDate: '2026-12-01', consents: {} };
  }

  person(email: string): Person | undefined {
    return this.people.get(email.trim().toLowerCase());
  }

  gets(): MeCall[] {
    return this.calls.filter((c) => c.method === 'GET');
  }
  posts(): MeCall[] {
    return this.calls.filter((c) => c.method === 'POST');
  }

  release(): void {
    this.holdGets = false;
    this.holdPosts = false;
    for (const go of this.held.splice(0)) go();
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => isMeApi(url, this.appOrigin), (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      this.preflights.push({ path: url.pathname, requestHeaders: request.headers()['access-control-request-headers'] ?? '' });
      return route.fulfill({ status: 204, headers: CORS });
    }
    const method = request.method() as 'GET' | 'POST';
    const posting = url.pathname.endsWith('/consent');
    if ((posting && method !== 'POST') || (!posting && method !== 'GET')) return this.json(route, 404, { message: 'Not Found' });

    const headers = await request.allHeaders();
    let pageUrl = '';
    try {
      pageUrl = request.frame().url();
    } catch {
      /* no frame */
    }
    const rawBody = request.postData();
    let body: unknown = null;
    try {
      body = rawBody === null ? null : JSON.parse(rawBody);
    } catch {
      body = rawBody;
    }
    const auth = JWT.exec(headers['authorization'] ?? '');
    const claims = auth ? (JSON.parse(Buffer.from(auth[2]!, 'base64url').toString('utf8')) as Record<string, unknown>) : null;
    const email = String(claims?.['email'] ?? '').trim().toLowerCase();
    this.calls.push({ method, path: url.pathname, body, rawBody, headers, pageUrl, email });

    if (method === 'GET' ? this.holdGets : this.holdPosts) await new Promise<void>((go) => this.held.push(go));
    const canned = (method === 'GET' ? this.nextGets : this.nextPosts).shift();
    if (canned === 'offline') return route.abort('connectionrefused');
    if (canned) return this.json(route, canned.status, canned.body ?? {});

    if (!claims) return this.json(route, 401, { message: 'Unauthorized' });
    const groups = Array.isArray(claims['cognito:groups']) ? (claims['cognito:groups'] as string[]) : [];
    if (!groups.includes('employee')) return this.json(route, 403, { error: NOT_EMPLOYEE });
    let who = this.person(email);
    if (!who && this.addUnknown) {
      who = this.defaultPerson(String(claims['given_name'] ?? ''));
      this.people.set(email, who);
    }
    if (!who) return this.json(route, 404, { error: NOT_FOUND });

    if (method === 'GET') return this.json(route, 200, this.answer(who));
    const version = body && typeof body === 'object' ? (body as Record<string, unknown>)['version'] : undefined;
    if (typeof version !== 'string' || !version) return this.json(route, 400, { error: BAD_BODY });
    if (version !== this.current) return this.json(route, 409, { error: CHANGED, version: this.current });
    const before = who.consents[version];
    if (before) return this.json(route, 200, { version, acceptedAt: before });
    who.consents[version] = this.now;
    return this.json(route, 201, { version, acceptedAt: this.now });
  }

  /** GET /v1/me's 200, as the spec lists it: nothing else from the employee row. */
  answer(who: Person): Record<string, unknown> {
    const company = who.company ?? ME_COMPANY;
    const n = filled(this.notices[this.current]!, company);
    const accepted = who.consents[this.current];
    return {
      firstName: who.firstName,
      company,
      ...(who.department ? { department: who.department } : {}),
      ...(who.startDate ? { startDate: who.startDate } : {}),
      notice: { version: this.current, ...n },
      consent: accepted ? { version: this.current, acceptedAt: accepted } : null,
    };
  }

  private json(route: Route, status: number, body: unknown): Promise<void> {
    return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
}
