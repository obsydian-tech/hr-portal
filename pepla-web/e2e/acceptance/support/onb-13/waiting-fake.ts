import type { BrowserContext, Route } from '@playwright/test';

/**
 * A stand-in for GET <documentUploadApiUrl>/v1/verifications, for the no-backend run of ONB-13.
 *
 * With `?waiting=true` it answers as the card says the Lambda will: `items` in the order given here
 * (the Lambda's order, oldest first, which the Lambda tests hold it to), `count` and `counts` worked
 * out from them. Without `waiting=true` it answers today's list (`items` of verification records,
 * no `counts`), so a page that leaves the flag off shows nothing it should.
 *
 * `/v1/verifications/<id>` and anything under it answer 404 and are recorded, so a page that calls
 * them is seen. Every call needs `Authorization: Bearer <JWT>`, as the API's Cognito authorizer
 * does, or it gets 401. Nothing here calls AWS or any AI service.
 */

export type Check = 'READING' | 'MATCHES' | 'NEEDS_A_LOOK' | 'DOESNT_MATCH';
export const CHECKS: Check[] = ['READING', 'MATCHES', 'NEEDS_A_LOOK', 'DOESNT_MATCH'];

/** One item of the waiting list, as the card's answer gives it. */
export type WaitingItem = {
  document_id: string;
  employee_id: string;
  employee_name: string;
  document_type: 'NATIONAL_ID' | 'BANK_CONFIRMATION' | 'MATRIC_CERTIFICATE' | 'TERTIARY_QUALIFICATION';
  check: Check;
  arrived_at: string | null;
};

export type ApiCall = { method: string; url: URL; authorization: string | null };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;

/** /v1/verifications or anything under it, on any host that is not the app. */
export const isVerificationsApi = (url: URL, appOrigin: string): boolean => /^\/v1\/verifications(\/|$)/.test(url.pathname) && url.origin !== appOrigin;

/** The card's answer for these items. */
export function waitingAnswer(items: WaitingItem[]): { items: WaitingItem[]; count: number; counts: Record<Check, number> } {
  const counts = Object.fromEntries(CHECKS.map((c) => [c, items.filter((i) => i.check === c).length])) as Record<Check, number>;
  return { items, count: items.length, counts };
}

export class WaitingFake {
  readonly calls: ApiCall[] = [];
  /** The waiting documents, in the order the Lambda answers them. */
  items: WaitingItem[] = [];
  /** 'ok' answers; 'error' answers 500; 'offline' fails as if the network were down; 'hold' waits for release(). */
  mode: 'ok' | 'error' | 'offline' | 'hold' = 'ok';
  private held: Array<() => void> = [];

  constructor(private readonly appOrigin: string) {}

  /** GET calls, in order. */
  gets(): ApiCall[] {
    return this.calls.filter((c) => c.method === 'GET');
  }

  release(): void {
    if (this.mode === 'hold') this.mode = 'ok';
    for (const go of this.held.splice(0)) go();
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => isVerificationsApi(url, this.appOrigin), (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    this.calls.push({ method: request.method(), url, authorization: request.headers()['authorization'] ?? null });

    if (this.mode === 'hold') await new Promise<void>((go) => this.held.push(go));
    if (this.mode === 'offline') return route.abort('internetdisconnected');
    if (this.mode === 'error') return json(route, 500, { error: 'Internal server error: ProvisionedThroughputExceededException' });

    if (request.method() !== 'GET' || url.pathname !== '/v1/verifications') return json(route, 404, { message: 'Not Found' });
    if (!JWT.test(request.headers()['authorization'] ?? '')) return json(route, 401, { message: 'Unauthorized' });

    if (url.searchParams.get('waiting') === 'true') return json(route, 200, waitingAnswer(this.items));
    // Today's answer: verification records, decided ones too, no counts.
    return json(route, 200, {
      items: this.items.map((i, n) => ({
        verification_id: `ver_${n}`,
        employee_id: i.employee_id,
        employee_name: i.employee_name,
        document_type: i.document_type,
        document_id: i.document_id,
        confidence: 80,
        decision: 'MANUAL_REVIEW',
        created_at: i.arrived_at,
      })),
      count: this.items.length,
    });
  }
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
