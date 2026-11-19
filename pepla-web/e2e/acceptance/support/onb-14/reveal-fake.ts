import type { BrowserContext, Route } from '@playwright/test';

/**
 * ONB-14: a stand-in for one route of the document upload API,
 *
 *   POST <documentUploadApiUrl>/v1/verifications/<document id>/reveal      body { field, employee_id }
 *
 * for the no-backend acceptance run. It is installed by the two document fakes (documents-fake.ts, onb-15/document-fake.ts),
 * which hand it a `lookup`: the full number the stored document holds for a field, the way the Lambda reads it.
 * The route answers the way the card says the Lambda answers: 200 `{ value }` with the full number and nothing else; a
 * body that is not `{ field, employee_id }` of a real document of that person gets 404.
 *
 * It can be told to answer another way (`mode`): 'error' (500), 'forbidden' (403), 'not-found' (404), 'offline' (the network
 * is down), 'hold' (waits for release()), 'slow' (answers after `delayMs`). `override` answers that value in place of the stored
 * one, so a test can tell the number on the page came from this answer and from nowhere else.
 *
 * Every call is recorded in `calls`, with the headers the page sent. Nothing here calls AWS or any AI service.
 */

export type RevealField = 'id_number' | 'account_number';
export type RevealCall = {
  method: string;
  url: URL;
  documentId: string;
  authorization: string | null;
  idempotencyKey: string | null;
  headers: Record<string, string>;
  body: any;
};

const ROUTE = /^\/v1\/verifications\/([^/]+)\/reveal$/;
export const isRevealApi = (url: URL, appOrigin: string): boolean => url.origin !== appOrigin && ROUTE.test(url.pathname);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, PATCH, POST, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;

export type RevealMode = 'ok' | 'error' | 'forbidden' | 'not-found' | 'offline' | 'hold' | 'slow';

export class RevealFake {
  readonly calls: RevealCall[] = [];
  mode: RevealMode = 'ok';
  /** Milliseconds a 'slow' answer takes. */
  delayMs = 1500;
  /** Answers this value in place of the stored one (200 only). */
  override: string | undefined;
  /** For the next N calls answer `failWith` instead of `mode`, then go back to `mode`. */
  failNext = 0;
  failWith: RevealMode = 'error';
  private held: Array<() => void> = [];

  constructor(
    private readonly appOrigin: string,
    /** The full number stored for this document and field, and whose document it is; undefined when there is none. */
    private readonly lookup: (documentId: string, field: RevealField) => { value: string; employeeId: string } | undefined,
  ) {}

  /** The POSTs to the reveal route, for one document when given. */
  posts(documentId?: string): RevealCall[] {
    return this.calls.filter((c) => c.method === 'POST' && (!documentId || c.documentId === documentId));
  }
  forField(field: RevealField): RevealCall[] {
    return this.posts().filter((c) => c.body?.field === field);
  }

  release(): void {
    if (this.mode === 'hold') this.mode = 'ok';
    for (const go of this.held.splice(0)) go();
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => isRevealApi(url, this.appOrigin), (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    let body: any = null;
    try {
      body = request.postData() ? JSON.parse(request.postData()!) : null;
    } catch {
      body = request.postData();
    }
    const headers = request.headers();
    const documentId = decodeURIComponent(ROUTE.exec(url.pathname)![1]!);
    this.calls.push({ method: request.method(), url, documentId, authorization: headers['authorization'] ?? null, idempotencyKey: headers['idempotency-key'] ?? null, headers, body });

    let mode = this.mode;
    if (this.failNext > 0) {
      this.failNext--;
      mode = this.failWith;
    }
    if (mode === 'hold') await new Promise<void>((go) => this.held.push(go));
    if (mode === 'slow') await new Promise<void>((go) => setTimeout(go, this.delayMs));
    if (mode === 'offline') return route.abort('internetdisconnected');
    if (mode === 'error') return json(route, 500, { error: 'Internal server error' });
    if (request.method() !== 'POST') return json(route, 404, { message: 'Not Found' });
    if (!JWT.test(headers['authorization'] ?? '')) return json(route, 401, { message: 'Unauthorized' });
    if (mode === 'forbidden') return json(route, 403, { error: 'Only HR can show a number' });
    if (mode === 'not-found') return json(route, 404, { error: 'Not found' });

    const field = body?.field as RevealField | undefined;
    if (field !== 'id_number' && field !== 'account_number') return json(route, 400, { error: 'Unknown field' });
    if (typeof body?.employee_id !== 'string' || body.employee_id === '') return json(route, 400, { error: 'employee_id is required' });
    const found = this.lookup(documentId, field);
    if (!found || found.employeeId !== body.employee_id) return json(route, 404, { error: 'Not found' });
    return json(route, 200, { value: this.override ?? found.value });
  }
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) });
}
