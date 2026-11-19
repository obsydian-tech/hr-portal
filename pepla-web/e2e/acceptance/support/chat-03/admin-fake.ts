import type { BrowserContext, Route } from '@playwright/test';

/**
 * A stand-in for the two company calls the Ask Batsi admin screen makes (CHAT-03), for the no-backend acceptance run.
 * Fake answers only: nothing here calls AWS, Bedrock or any paid AI service.
 *
 *   GET <api>/v1/company/modules               200 { "modules": [...] }, sorted keys, as MOD-01's table says (see
 *                                              support/mod-02/modules-fake.ts); 401 with no token
 *   PUT <api>/v1/admin/company/ask-batsi       CHAT-02 D-4 and AC-22: body { "enabled": boolean }, only an `admin` of the
 *                                              caller's own company, answer 200 { "enabled": boolean }, 400 for any other body
 *
 * The company is the caller's sign-in: the fake tells people apart by the `sub` in the token (assign(email, company)), exactly
 * the way the real routes read the company from the membership row. A body or a query that names a company is a 400 here and a
 * fault in the test: the card (C-2) sends no company at all.
 *
 * The CORS answer allows the headers `authorization` and `content-type` and nothing else, as the API does today, so a PUT that adds a
 * header the API does not allow (an Idempotency-Key, an X-Company) is stopped by the browser's preflight and the test fails.
 * Every call is recorded with its headers and its raw body.
 */

export type Company = 'A' | 'B';

/** What each company has switched on to begin with: A has onboarding and recruitment, B onboarding only. Neither has Ask Batsi. */
export const START: Record<Company, string[]> = { A: ['onboarding', 'recruitment'], B: ['onboarding'] };

/**
 * How the read (GET modules) answers:
 *  ok, server-error (500), forbidden (403), unauthorised (401), offline, not-json (200, a web page), wrong-shape (200, "modules" is a string),
 *  missing-key (200 {}), hold (waits for release(), then ok).
 */
export type ReadMode = 'ok' | 'server-error' | 'forbidden' | 'unauthorised' | 'offline' | 'not-json' | 'wrong-shape' | 'missing-key' | 'hold';
export const FAILING_READS: ReadMode[] = ['server-error', 'forbidden', 'unauthorised', 'offline', 'not-json', 'wrong-shape', 'missing-key'];

/** How the save (PUT) answers: ok, server-error (500), forbidden (403), not-found (404), offline, hold (waits for release(), then ok). */
export type WriteMode = 'ok' | 'server-error' | 'forbidden' | 'not-found' | 'offline' | 'hold';
export const FAILING_WRITES: WriteMode[] = ['server-error', 'forbidden', 'not-found', 'offline'];

/** Text the fake's failing answers carry. The page must show none of it (C-3, C-5). */
export const SERVER_WORDS = ['Internal Server Error', 'Forbidden', 'Company not found', 'stack trace at adminSetAskBatsi', 'Unauthorized'];

export type ApiCall = {
  method: string;
  url: URL;
  headers: Record<string, string>;
  /** The raw text of the body, or null when there was none. */
  rawBody: string | null;
  sub: string | null;
  groups: string[];
  company: Company | null;
};

export const MODULES_PATH = '/v1/company/modules';
export const SWITCH_PATH = '/v1/admin/company/ask-batsi';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, PUT, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;

export class AdminSwitchFake {
  readonly calls: ApiCall[] = [];
  readMode: ReadMode = 'ok';
  writeMode: WriteMode = 'ok';
  /** What each company has on. A test changes one to show a change made by someone else. */
  state: Record<Company, string[]> = { A: [...START.A], B: [...START.B] };
  private readonly companies = new Map<string, Company>();
  private heldReads: Array<() => void> = [];
  private heldWrites: Array<() => void> = [];
  /** The companies a successful PUT wrote, in order (a no-op PUT is still counted: the fake has no audit). */
  readonly wrote: Array<{ company: Company; enabled: boolean; by: string }> = [];

  constructor(private readonly appOrigin: string, private readonly subOf: (email: string) => string | undefined) {}

  assign(email: string, company: Company): void {
    this.companies.set(email.toLowerCase(), company);
  }

  reads(): ApiCall[] { return this.calls.filter((c) => c.method === 'GET'); }
  writes(): ApiCall[] { return this.calls.filter((c) => c.method === 'PUT'); }
  has(company: Company): boolean { return this.state[company].includes('ask_batsi'); }

  /** Lets every held read answer (in `ok`), and every held save. */
  release(): void {
    if (this.readMode === 'hold') this.readMode = 'ok';
    if (this.writeMode === 'hold') this.writeMode = 'ok';
    for (const go of [...this.heldReads.splice(0), ...this.heldWrites.splice(0)]) go();
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => url.origin !== this.appOrigin && (url.pathname.endsWith(MODULES_PATH) || url.pathname.endsWith(SWITCH_PATH)), (route) => this.handle(route));
  }

  private companyOfSub(sub: string | null): Company {
    if (sub) for (const [email, company] of this.companies) if (this.subOf(email) === sub) return company;
    return 'A';
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const headers = request.headers();
    const authorization = headers['authorization'] ?? null;
    const claims = authorization ? claimsOf(authorization) : null;
    const company = claims?.sub ? this.companyOfSub(claims.sub) : null;
    this.calls.push({ method: request.method(), url, headers, rawBody: request.postData() ?? null, sub: claims?.sub ?? null, groups: claims?.groups ?? [], company });
    if (!authorization || !JWT.test(authorization)) return reply(route, 401, { message: 'Unauthorized' });
    if (url.pathname.endsWith(MODULES_PATH)) return this.read(route, company ?? 'A');
    return this.write(route, request.method(), request.postData() ?? null, url, company ?? 'A', claims?.sub ?? '', claims?.groups ?? []);
  }

  private async read(route: Route, company: Company): Promise<void> {
    if (route.request().method() !== 'GET') return reply(route, 404, { message: 'Not Found' });
    if (this.readMode === 'hold') await new Promise<void>((go) => this.heldReads.push(go));
    switch (this.readMode) {
      case 'offline': return route.abort('internetdisconnected');
      case 'server-error': return reply(route, 500, { error: 'Internal Server Error' });
      case 'forbidden': return reply(route, 403, { error: 'Forbidden' });
      case 'unauthorised': return reply(route, 401, { message: 'Unauthorized' });
      case 'not-json': return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/html' }, body: '<!doctype html><title>Naleko</title>' });
      case 'wrong-shape': return reply(route, 200, { modules: 'ask_batsi' });
      case 'missing-key': return reply(route, 200, {});
      default: return reply(route, 200, { modules: [...this.state[company]].sort() });
    }
  }

  private async write(route: Route, method: string, rawBody: string | null, url: URL, company: Company, sub: string, groups: string[]): Promise<void> {
    if (method !== 'PUT') return reply(route, 404, { message: 'Not Found' });
    if (this.writeMode === 'hold') await new Promise<void>((go) => this.heldWrites.push(go));
    switch (this.writeMode) {
      case 'offline': return route.abort('internetdisconnected');
      case 'server-error': return reply(route, 500, { error: 'Internal Server Error', detail: 'stack trace at adminSetAskBatsi' });
      case 'forbidden': return reply(route, 403, { error: 'Forbidden' });
      case 'not-found': return reply(route, 404, { error: 'Company not found' });
      default: break;
    }
    // The route as CHAT-02 pins it: admin of the caller's own company only, a body that is exactly { enabled: boolean }.
    if (!groups.includes('admin')) return reply(route, 403, { error: 'Forbidden' });
    let body: unknown;
    try { body = rawBody === null ? undefined : JSON.parse(rawBody); } catch { body = undefined; }
    const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body as object) : [];
    const enabled = (body as { enabled?: unknown } | undefined)?.enabled;
    if (keys.length !== 1 || keys[0] !== 'enabled' || typeof enabled !== 'boolean' || url.search !== '') return reply(route, 400, { error: 'Bad Request' });
    const rest = this.state[company].filter((m) => m !== 'ask_batsi');
    this.state[company] = enabled ? [...rest, 'ask_batsi'] : rest;
    this.wrote.push({ company, enabled, by: sub });
    return reply(route, 200, { enabled });
  }
}

function reply(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: { ...CORS, 'cache-control': 'private, no-store', 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

function claimsOf(authorization: string): { sub: string | null; groups: string[] } | null {
  try {
    const payload = JSON.parse(Buffer.from(authorization.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return { sub: typeof payload.sub === 'string' ? payload.sub : null, groups: Array.isArray(payload['cognito:groups']) ? payload['cognito:groups'] : [] };
  } catch {
    return null;
  }
}
