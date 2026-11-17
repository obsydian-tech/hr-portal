import type { BrowserContext, Route } from '@playwright/test';

/**
 * A stand-in for the modules route, for the no-backend acceptance run (MOD-02).
 *
 * It answers GET <naleko api>/v1/company/modules in the browser the way MOD-01's table says
 * ("API contract", D-API-1; the fake is generated from that table):
 *
 *   200 { "modules": [...] }       sorted keys, [] when none, nothing else in the body
 *   403 { "error": "Forbidden" }   a token with no company
 *   401 { "message": "Unauthorized" }   the API authorizer, when there is no valid sign-in
 *   headers: CORS as the other fakes, and Cache-Control: private, no-store
 *
 * Three companies and a failing answer, as the card names them: A (onboarding, recruitment), B (onboarding),
 * C (none). Who is in which company is told with `assign(email, company)`; the call tells people apart by
 * the `sub` in the token it carries (a person nobody assigned is in company A).
 *
 * The host does not matter (the card does not name the environment key): any call whose path ends in
 * /v1/company/modules is answered. Every call is recorded, with its sign-in token. Nothing here calls AWS or any AI service.
 */

export type Company = 'A' | 'B' | 'C';

/** What each company's call answers (MOD-01's "Fake answers the app tests use"). */
export const COMPANY_MODULES: Record<Company, string[]> = {
  A: ['onboarding', 'recruitment'],
  B: ['onboarding'],
  C: [],
};

/**
 * ok          the table's answer for the caller's company
 * forbidden   403 { "error": "Forbidden" }
 * unauthorised  401 from the authorizer
 * offline     the network is down
 * not-json    200 with a body that is not JSON
 * wrong-shape 200 { "modules": "recruitment" } (a string, not a list)
 * missing-key 200 {} (no "modules")
 * hold        waits for release(), then answers as `ok`
 */
export type ModulesMode = 'ok' | 'forbidden' | 'unauthorised' | 'offline' | 'not-json' | 'wrong-shape' | 'missing-key' | 'hold';

/** The failing answers the card names: a 403, a network error and a malformed body (three kinds of malformed). */
export const FAILING_MODES: ModulesMode[] = ['forbidden', 'unauthorised', 'offline', 'not-json', 'wrong-shape', 'missing-key'];

export type ModulesCall = { method: string; url: URL; authorization: string | null; sub: string | null; company: Company | null };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;

export const isModulesCall = (url: URL): boolean => /\/v1\/company\/modules$/.test(url.pathname);

export class ModulesFake {
  readonly calls: ModulesCall[] = [];
  /** How many calls have been answered (or failed) by now; a call being held is not counted. */
  answered = 0;
  mode: ModulesMode = 'ok';
  /** What each company answers; a test changes one to show a switch made by Naleko. */
  answers: Record<Company, string[]> = { A: [...COMPANY_MODULES.A], B: [...COMPANY_MODULES.B], C: [...COMPANY_MODULES.C] };
  private readonly companies = new Map<string, Company>();
  private held: Array<() => void> = [];

  constructor(private readonly subOf: (email: string) => string | undefined) {}

  /** This person (by email) belongs to this company. */
  assign(email: string, company: Company): void {
    this.companies.set(email.toLowerCase(), company);
  }

  /** The calls that carried a sign-in token. */
  signedCalls(): ModulesCall[] {
    return this.calls.filter((c) => c.method === 'GET' && c.authorization !== null);
  }

  /** Lets every held call answer. */
  release(): void {
    if (this.mode === 'hold') this.mode = 'ok';
    for (const go of this.held.splice(0)) go();
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => isModulesCall(url), (route) => this.handle(route));
  }

  private companyOfSub(sub: string | null): Company {
    if (sub) for (const [email, company] of this.companies) if (this.subOf(email) === sub) return company;
    return 'A';
  }

  private async handle(route: Route): Promise<void> {
    try {
      await this.answer(route);
    } finally {
      this.answered++;
    }
  }

  private async answer(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const authorization = request.headers()['authorization'] ?? null;
    const sub = authorization ? subOfBearer(authorization) : null;
    const company = sub ? this.companyOfSub(sub) : null;
    this.calls.push({ method: request.method(), url, authorization, sub, company });

    if (this.mode === 'hold') await new Promise<void>((go) => this.held.push(go));
    if (this.mode === 'offline') return route.abort('internetdisconnected');
    if (!authorization || !JWT.test(authorization)) return reply(route, 401, { message: 'Unauthorized' });
    if (request.method() !== 'GET') return reply(route, 404, { message: 'Not Found' });
    switch (this.mode) {
      case 'forbidden': return reply(route, 403, { error: 'Forbidden' });
      case 'unauthorised': return reply(route, 401, { message: 'Unauthorized' });
      case 'not-json': return route.fulfill({ status: 200, headers: { ...CORS, 'cache-control': 'private, no-store', 'content-type': 'text/html' }, body: '<!doctype html><title>Naleko</title>' });
      case 'wrong-shape': return reply(route, 200, { modules: 'recruitment' });
      case 'missing-key': return reply(route, 200, {});
      default: return reply(route, 200, { modules: [...this.answers[company ?? 'A']].sort() });
    }
  }
}

function reply(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: { ...CORS, 'cache-control': 'private, no-store', 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

function subOfBearer(authorization: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(authorization.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
