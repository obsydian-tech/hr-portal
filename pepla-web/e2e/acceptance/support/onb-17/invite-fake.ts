import type { BrowserContext, Page, Route } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import type { CognitoFake, FakeAccount } from '../cognito-fake';

/**
 * ONB-17: the two public invite routes ONB-04 builds, as its spec fixes them, answered in the browser
 * for the no-backend run.
 *
 *   POST <employeesApiUrl>/v1/invites/lookup   { token }
 *        200 { status: 'ok', company, firstName, email, startDate?, hrPartnerName }
 *        200 { status: 'expired' | 'used', company, hrPartnerName }
 *        200 { status: 'invalid' }
 *        400 for a missing or non-JSON body
 *   POST <employeesApiUrl>/v1/invites/redeem   { token, password }
 *        204 done (the Cognito fake is told the person's password is set)
 *        400 { error: 'Check the password', fields: { password: [rule names] } }
 *        410 { status: 'expired' | 'used' | 'invalid' }
 *        502 { error: 'Could not set the password. Try again.' }
 *
 * Rule names: minLength (fewer than 12), maxLength (more than 256), lower, upper, number, symbol
 * (only the broken ones). A good redeem uses the link up. A refused password does not, except that
 * five refused passwords on one link close it: the fifth is still a 400 with the rules, and from then
 * on lookup says 'expired' (with company and hrPartnerName) and redeem says 410 'expired'.
 * Both routes sit behind API Gateway throttling: over the limit the gateway itself answers 429
 * { message: 'Too Many Requests' } (see TOO_MANY). Contract as the ONB-04 verifier locks it (16 Nov 2026).
 *
 * Every call is recorded: its body, all its headers, and the page's address at the moment the call
 * reached the network. Preflights are recorded apart. Nothing here calls AWS or any AI service.
 */

export type Lookup =
  | { status: 'ok'; company: string; firstName: string; email: string; startDate?: string; hrPartnerName: string }
  | { status: 'expired' | 'used'; company: string; hrPartnerName: string }
  | { status: 'invalid' };

export type Invite = {
  company: string;
  hrPartnerName: string;
  /** The person the link is for. They join the Cognito fake in the first-password state. */
  person: FakeAccount;
  startDate?: string;
  state: 'ok' | 'expired' | 'used';
  /** Refused passwords so far (ONB-04: five close the link). */
  refused?: number;
};

/** What API Gateway answers over the throttling limit (not our JSON shape). */
export const TOO_MANY: Scripted = { status: 429, body: { message: 'Too Many Requests' } };
/** Refused passwords that close a link (ONB-04). */
export const MAX_REFUSED = 5;

export type InviteCall = {
  route: 'lookup' | 'redeem';
  url: string;
  raw: string | null;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
  /** The page's address when the call went out. */
  pageUrl: string;
  status: number | 'offline';
};

export type Scripted = { status: number; body?: unknown } | 'offline';

export const RULES = ['minLength', 'maxLength', 'upper', 'lower', 'number', 'symbol'] as const;
export type Rule = (typeof RULES)[number];

/** The pool's rules, as ONB-04's redeemInvite checks them. */
export function brokenRules(password: string): Rule[] {
  const out: Rule[] = [];
  if (password.length < 12) out.push('minLength');
  if (password.length > 256) out.push('maxLength');
  if (!/[A-Z]/.test(password)) out.push('upper');
  if (!/[a-z]/.test(password)) out.push('lower');
  if (!/[0-9]/.test(password)) out.push('number');
  if (!/[^A-Za-z0-9]/.test(password)) out.push('symbol');
  return out;
}

/** A token as ONB-04 makes it: 32 random bytes, base64url, 43 characters. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

export class InviteFake {
  readonly calls: InviteCall[] = [];
  /** OPTIONS preflights: the headers the browser asked to send. */
  readonly preflights: Array<{ route: string; requestHeaders: string }> = [];
  readonly invites = new Map<string, Invite>();

  /** The next answers, in order, before the normal ones. */
  readonly nextLookups: Scripted[] = [];
  readonly nextRedeems: Scripted[] = [];
  /** While true, redeem calls wait until release(). */
  holdRedeem = false;
  /** While true, lookup calls wait until release(). */
  holdLookup = false;
  private held: Array<() => void> = [];

  constructor(
    private readonly appOrigin: string,
    private readonly cognito: CognitoFake | null,
  ) {}

  /** A new link for this person. Returns the token. */
  add(invite: Invite, token = newToken()): string {
    this.invites.set(token, invite);
    if (invite.state === 'ok') this.cognito?.addAccount({ ...invite.person, newPasswordRequired: true });
    return token;
  }

  lookups(): InviteCall[] {
    return this.calls.filter((c) => c.route === 'lookup');
  }

  redeems(): InviteCall[] {
    return this.calls.filter((c) => c.route === 'redeem');
  }

  release(): void {
    this.holdRedeem = false;
    this.holdLookup = false;
    for (const go of this.held.splice(0)) go();
  }

  /**
   * The page's own address at the moment it sent each invite call, read inside the page (an XHR
   * send or a fetch), for this page load. Shows whether the fragment was gone before the call.
   */
  async sentFrom(page: Page): Promise<Array<{ url: string; href: string }>> {
    return page.evaluate(() => (window as unknown as { __onb17Sends?: Array<{ url: string; href: string }> }).__onb17Sends ?? []);
  }

  async install(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
      const w = window as unknown as { __onb17Sends: Array<{ url: string; href: string }> };
      w.__onb17Sends = [];
      const note = (url: string) => {
        if (/\/v1\/invites\//.test(url)) w.__onb17Sends.push({ url, href: window.location.href });
      };
      const open = XMLHttpRequest.prototype.open;
      const send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __onb17Url?: string }, ...args: unknown[]) {
        this.__onb17Url = String(args[1]);
        return (open as (...a: unknown[]) => void).apply(this, args);
      } as typeof XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __onb17Url?: string }, body?: Document | XMLHttpRequestBodyInit | null) {
        note(this.__onb17Url ?? '');
        return send.call(this, body);
      };
      const fetch0 = window.fetch;
      window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        note(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        return fetch0.call(window, input, init);
      };
    });
    await context.route(
      (url) => url.origin !== this.appOrigin && /\/v1\/invites\/(lookup|redeem)$/.test(url.pathname),
      (route) => this.handle(route),
    );
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const which = url.pathname.endsWith('/lookup') ? 'lookup' : 'redeem';
    if (request.method() === 'OPTIONS') {
      this.preflights.push({ route: which, requestHeaders: request.headers()['access-control-request-headers'] ?? '' });
      return route.fulfill({ status: 204, headers: CORS });
    }
    let pageUrl = '';
    try {
      pageUrl = request.frame().url();
    } catch {
      pageUrl = '';
    }
    const raw = request.postData();
    let body: Record<string, unknown> | null = null;
    try {
      const parsed = raw === null ? null : JSON.parse(raw);
      body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      body = null;
    }
    const call: InviteCall = { route: which, url: url.href, raw, body, headers: await request.allHeaders(), pageUrl, status: 0 };
    this.calls.push(call);

    if (request.method() !== 'POST') return this.answer(route, call, { status: 404, body: { message: 'Not Found' } });
    if ((which === 'lookup' && this.holdLookup) || (which === 'redeem' && this.holdRedeem)) {
      await new Promise<void>((go) => this.held.push(go));
    }
    const scripted = (which === 'lookup' ? this.nextLookups : this.nextRedeems).shift();
    if (scripted) return this.answer(route, call, scripted);
    return this.answer(route, call, which === 'lookup' ? this.lookup(body) : this.redeem(body));
  }

  private lookup(body: Record<string, unknown> | null): Scripted {
    if (!body || typeof body['token'] !== 'string') return { status: 400, body: { error: 'The request body is missing or not valid' } };
    const invite = this.invites.get(body['token']);
    if (!invite) return { status: 200, body: { status: 'invalid' } };
    if (invite.state !== 'ok') return { status: 200, body: { status: invite.state, company: invite.company, hrPartnerName: invite.hrPartnerName } };
    const answer: Record<string, unknown> = {
      status: 'ok',
      company: invite.company,
      firstName: invite.person.givenName,
      email: invite.person.email,
      hrPartnerName: invite.hrPartnerName,
    };
    if (invite.startDate) answer['startDate'] = invite.startDate;
    return { status: 200, body: answer };
  }

  private redeem(body: Record<string, unknown> | null): Scripted {
    if (!body || typeof body['token'] !== 'string' || typeof body['password'] !== 'string') {
      return { status: 400, body: { error: 'The request body is missing or not valid' } };
    }
    const invite = this.invites.get(body['token']);
    if (!invite) return { status: 410, body: { status: 'invalid' } };
    if (invite.state !== 'ok') return { status: 410, body: { status: invite.state } };
    const broken = brokenRules(body['password']);
    if (broken.length) {
      invite.refused = (invite.refused ?? 0) + 1;
      if (invite.refused >= MAX_REFUSED) invite.state = 'expired';
      return { status: 400, body: { error: 'Check the password', fields: { password: broken } } };
    }
    invite.state = 'used';
    this.cognito?.setPassword(invite.person.email);
    return { status: 204 };
  }

  private async answer(route: Route, call: InviteCall, a: Scripted): Promise<void> {
    if (a === 'offline') {
      call.status = 'offline';
      return route.abort('internetdisconnected');
    }
    call.status = a.status;
    if (a.status === 204) return route.fulfill({ status: 204, headers: CORS, body: '' });
    return route.fulfill({ status: a.status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(a.body ?? {}) });
  }
}
