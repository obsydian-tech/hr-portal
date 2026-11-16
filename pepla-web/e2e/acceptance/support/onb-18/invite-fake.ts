import type { BrowserContext, Route } from '@playwright/test';

/**
 * ONB-18: a stand-in for the card's two routes on the employees API, for the no-backend run:
 *   GET  <employeesApiUrl>/v1/employees/<id>/invite   -> { status, sentAt?, expiresAt?, sentTo? }
 *   POST <employeesApiUrl>/v1/employees/<id>/invite   -> the answer the test sets in `next` (200 by default)
 * answered the way lambda/getInvite and lambda/resendInvite answer once ONB-18 is built (spec "What gets built" 3
 * and 4). Every call needs `Authorization: Bearer <JWT>`, as the API's Cognito authorizer does, or it gets 401.
 * Every call (OPTIONS included) is recorded in `calls`. A person the test did not add answers 404.
 *
 * Only `/v1/employees/<id>/invite` is matched, so the employees list fake (support/employees-fake.ts) and the
 * document fake keep their own routes. Nothing here calls AWS or any AI service.
 */

export type InviteState =
  | { status: 'ok' | 'expired' | 'used'; sentAt: string; expiresAt: string; sentTo: string }
  | { status: 'none' };

export type ResendAnswer =
  | { kind: 'ok'; sentAt: string; expiresAt: string; sentTo: string; email: { sent: boolean; skipped?: string } }
  | { kind: 'refused' }
  | { kind: 'not-invited' }
  | { kind: 'failed' }
  | { kind: 'offline' };

export type InviteCall = { method: string; id: string; authorization: string | null; body: string | null };

const ROUTE = /^\/v1\/employees\/([^/]+)\/invite$/;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;

/** The invite route of any person, on any host that is not the app. */
export const isInviteRoute = (url: URL, appOrigin: string): boolean => ROUTE.test(url.pathname) && url.origin !== appOrigin;

export class InviteFake {
  readonly calls: InviteCall[] = [];
  readonly states = new Map<string, InviteState>();
  /** GET answers: 'ok' answers the state; 'error' answers 500; 'offline' drops the connection. */
  getMode: 'ok' | 'error' | 'offline' = 'ok';
  /** The answers the next POSTs get, in order; once empty, a plain 200 with a fresh link. */
  readonly next: ResendAnswer[] = [];
  /** While true, a POST waits for release() before it is answered. */
  hold = false;
  private held: Array<() => void> = [];

  constructor(private readonly appOrigin: string) {}

  set(id: string, state: InviteState): void {
    this.states.set(id, state);
  }

  gets(id?: string): InviteCall[] {
    return this.calls.filter((c) => c.method === 'GET' && (id === undefined || c.id === id));
  }

  posts(id?: string): InviteCall[] {
    return this.calls.filter((c) => c.method === 'POST' && (id === undefined || c.id === id));
  }

  release(): void {
    this.hold = false;
    for (const go of this.held.splice(0)) go();
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => isInviteRoute(url, this.appOrigin), (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const id = decodeURIComponent(ROUTE.exec(url.pathname)![1]!);
    this.calls.push({ method: request.method(), id, authorization: request.headers()['authorization'] ?? null, body: request.postData() });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (!JWT.test(request.headers()['authorization'] ?? '')) return json(route, 401, { message: 'Unauthorized' });

    if (request.method() === 'GET') {
      if (this.getMode === 'offline') return route.abort('internetdisconnected');
      if (this.getMode === 'error') return json(route, 500, { error: 'Internal server error' });
      const state = this.states.get(id);
      if (!state) return json(route, 404, { error: 'Not found' });
      return json(route, 200, state);
    }
    if (request.method() === 'POST') {
      if (this.hold) await new Promise<void>((go) => this.held.push(go));
      if (!this.states.has(id)) return json(route, 404, { error: 'Not found' });
      const a = this.next.shift() ?? fresh(this.states.get(id)!);
      if (a.kind === 'offline') return route.abort('internetdisconnected');
      if (a.kind === 'refused') return json(route, 409, { status: 'refused' });
      if (a.kind === 'not-invited') return json(route, 409, { status: 'not-invited' });
      if (a.kind === 'failed') return json(route, 502, { status: 'failed' });
      this.states.set(id, { status: 'ok', sentAt: a.sentAt, expiresAt: a.expiresAt, sentTo: a.sentTo });
      return json(route, 200, { status: 'ok', sentAt: a.sentAt, expiresAt: a.expiresAt, sentTo: a.sentTo, email: a.email });
    }
    return json(route, 404, { message: 'Not Found' });
  }
}

/** A plain successful resend: sent now (14 Nov 2026, 09:05 in South Africa), expires 7 days on. */
function fresh(s: InviteState): ResendAnswer {
  const sentTo = 'sentTo' in s ? s.sentTo : '';
  return { kind: 'ok', sentAt: '2026-11-14T07:05:00.000Z', expiresAt: '2026-11-21T07:05:00.000Z', sentTo, email: { sent: true } };
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
