import type { BrowserContext, Route } from '@playwright/test';

/**
 * ONB-06: a stand-in, for the no-backend run, for
 *   GET  <employeesApiUrl>/v1/me/documents             the person's own list (getMyDocuments),
 *   POST <employeesApiUrl>/v1/me/documents/upload-url  a link to put one file straight into S3 (createMyUploadLink),
 *   PUT  the link it hands back (S3 itself),
 * answering in the browser as the ONB-06 spec (NH-175, "What gets built" 1 and 2) fixes them.
 *
 * It is on for every no-backend test (support/fixtures.ts), so a signed-in employee's page whose call is not
 * what the test is about finds it answered: by default a list of the four types, none uploaded.
 *
 * The list is whatever the test puts in `answer`, handed over UNCHANGED (every field it holds, including fields
 * a later card adds, such as ONB-20's `returnedAt`, `returnedBy` and `reason` on a sent-back file). The fake
 * never drops, renames or adds a field of its own. The one thing it does by itself, when `autoRecord` is on
 * (the default), is what the real server does after a file lands in S3: the file is in the list the next time
 * the page asks, as "With HR". Turn it off to prove the page shows "With HR" from the 2xx alone.
 *
 * - Every API call needs `Authorization: Bearer <JWT>` (the API's Cognito authorizer), or it gets 401; a token
 *   not in the group `employee` gets 403 { error: "This page is for new employees" }.
 * - API CORS allows only `authorization` and `content-type`, as the real employees API does (LESSONS, NH-187).
 * - S3's CORS allows only `content-type` on a PUT and no credentials, as the dev bucket's rule would: a PUT that
 *   carries the sign-in token (an `Authorization` header) or asks for cookies is refused by the browser.
 * - The link binds the file's type and size. S3 refuses a PUT whose Content-Type is not the one in the link
 *   (the one the link answer lists) or whose body is not exactly `fileSize` bytes: 403 SignatureDoesNotMatch.
 * Every call (method, path, body, headers, the page's address) and every preflight is recorded.
 */

export const DOC_TYPES = ['NATIONAL_ID', 'BANK_CONFIRMATION', 'MATRIC_CERTIFICATE', 'TERTIARY_QUALIFICATION'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export type DocState = 'NOT_UPLOADED' | 'WITH_HR' | 'SENT_BACK' | 'ACCEPTED';
export type FileAnswer = { fileName: string; uploadedAt: string; state: DocState } & Record<string, unknown>;
export type TypeAnswer = { type: DocType; required: boolean; state: DocState; files: FileAnswer[] } & Record<string, unknown>;
export type ListAnswer = { documents: TypeAnswer[] };

export const NOT_EMPLOYEE = 'This page is for new employees';
export const NOT_FOUND = "We can't find your record. Ask your HR team.";
export const CONSENT_FIRST = 'Accept the privacy notice first.';
export const MISSING = 'Missing required fields: documentType, fileName';
export const LIMIT_BYTES = 10 * 1024 * 1024;
export const DEV_EMPLOYEE_ID = 'emp-fake-0001';

export type Canned = { status: number; body?: unknown } | 'offline';
export type ApiCall = { method: 'GET' | 'POST'; path: string; body: unknown; rawBody: string | null; headers: Record<string, string>; pageUrl: string };
export type PutCall = { url: string; headers: Record<string, string>; size: number; body: Buffer; pageUrl: string };
export type Issued = { url: string; documentId: string; type: string; fileName: string; contentType: string; fileSize: number };

const API_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const S3_CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'PUT', 'access-control-allow-headers': 'content-type', 'access-control-expose-headers': 'ETag' };
const JWT = /^Bearer (eyJ[\w-]+)\.(eyJ[\w-]+)\.[\w-]*$/;
const S3_URL = /^https:\/\/[^/]+\.s3\.[a-z0-9-]+\.amazonaws\.com\//;
const SAFE = (name: string) => (name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100) || 'file');

export const isDocumentsApi = (url: URL, appOrigin: string) => url.origin !== appOrigin && /\/v1\/me\/documents(\/upload-url)?$/.test(url.pathname);

/** One type's entry, as the server answers it. */
export function entry(type: DocType, state: DocState = 'NOT_UPLOADED', files: Array<Partial<FileAnswer> & { fileName: string }> = []): TypeAnswer {
  const required = type === 'NATIONAL_ID' || type === 'BANK_CONFIRMATION';
  const made = files.map((f, i) => ({ uploadedAt: `2026-11-${String(10 - i).padStart(2, '0')}T08:15:00.000Z`, state: state === 'NOT_UPLOADED' ? 'WITH_HR' : state, ...f })) as FileAnswer[];
  return { type, required, state, files: state === 'NOT_UPLOADED' ? [] : made };
}

const DEFAULT_FILE: Record<DocType, string> = {
  NATIONAL_ID: 'id-book.pdf',
  BANK_CONFIRMATION: 'bank-letter.pdf',
  MATRIC_CERTIFICATE: 'matric.pdf',
  TERTIARY_QUALIFICATION: 'bsc-computer-science.pdf',
};

/** The four types in the spec's order. A state alone gets one default file; `files` gives them exactly. */
export function listOf(states: Partial<Record<DocType, DocState | { state: DocState; files: Array<Partial<FileAnswer> & { fileName: string }> }>> = {}): ListAnswer {
  return {
    documents: DOC_TYPES.map((type) => {
      const s = states[type] ?? 'NOT_UPLOADED';
      if (typeof s === 'string') return entry(type, s, s === 'NOT_UPLOADED' ? [] : [{ fileName: DEFAULT_FILE[type] }]);
      return entry(type, s.state, s.files);
    }),
  };
}

export class MyDocumentsFake {
  /** What GET /v1/me/documents answers, unchanged. */
  answer: ListAnswer = listOf();
  readonly calls: ApiCall[] = [];
  readonly puts: PutCall[] = [];
  readonly issued: Issued[] = [];
  readonly preflights: Array<{ kind: 'api' | 's3'; path: string; requestHeaders: string }> = [];
  readonly nextGets: Canned[] = [];
  readonly nextLinks: Canned[] = [];
  readonly nextPuts: Array<{ status: number; body?: string } | 'offline'> = [];
  holdLinks = false;
  holdPuts = false;
  /** After a file lands in S3 the next list holds it as "With HR" (what the real server does). */
  autoRecord = true;
  /** The server's clock for a new file. */
  now = '2026-11-17T07:30:00.000Z';
  private held: Array<() => void> = [];
  private seq = 0;

  constructor(private readonly appOrigin: string) {}

  gets(): ApiCall[] {
    return this.calls.filter((c) => c.method === 'GET');
  }
  links(): ApiCall[] {
    return this.calls.filter((c) => c.method === 'POST');
  }
  release(): void {
    this.holdLinks = false;
    this.holdPuts = false;
    for (const go of this.held.splice(0)) go();
  }
  /** Every request this fake saw, as "METHOD path", S3 PUTs included. */
  seen(): string[] {
    return [...this.calls.map((c) => `${c.method} ${c.path}`), ...this.puts.map((p) => `PUT ${new URL(p.url).pathname}`)];
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => isDocumentsApi(url, this.appOrigin), (route) => this.api(route));
    await context.route((url) => S3_URL.test(url.href), (route) => this.s3(route));
  }

  // ------------------------------------------------------------ the API

  private async api(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      this.preflights.push({ kind: 'api', path: url.pathname, requestHeaders: request.headers()['access-control-request-headers'] ?? '' });
      return route.fulfill({ status: 204, headers: API_CORS });
    }
    const method = request.method() as 'GET' | 'POST';
    const posting = url.pathname.endsWith('/upload-url');
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
    this.calls.push({ method, path: url.pathname, body, rawBody, headers, pageUrl });

    if (posting ? this.holdLinks : false) await new Promise<void>((go) => this.held.push(go));
    const canned = (posting ? this.nextLinks : this.nextGets).shift();
    if (canned === 'offline') return route.abort('connectionrefused');
    if (canned) return this.json(route, canned.status, canned.body ?? {});

    const auth = JWT.exec(headers['authorization'] ?? '');
    if (!auth) return this.json(route, 401, { message: 'Unauthorized' });
    const claims = JSON.parse(Buffer.from(auth[2]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    const groups = Array.isArray(claims['cognito:groups']) ? (claims['cognito:groups'] as string[]) : [];
    if (!groups.includes('employee')) return this.json(route, 403, { error: NOT_EMPLOYEE });

    if (!posting) return this.json(route, 200, this.answer);

    const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    const { documentType, fileName, contentType, fileSize } = b;
    if (typeof documentType !== 'string' || typeof fileName !== 'string' || typeof contentType !== 'string' || typeof fileSize !== 'number') return this.json(route, 400, { error: MISSING });
    if (!(DOC_TYPES as readonly string[]).includes(documentType)) return this.json(route, 400, { error: `Unsupported document type. Allowed: ${DOC_TYPES.join(', ')}` });
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(contentType)) return this.json(route, 400, { error: 'Unsupported content type. Allowed: application/pdf, image/jpeg, image/png' });
    if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > LIMIT_BYTES) return this.json(route, 400, { error: 'The file must be from 1 byte to 10 MB' });
    const documentId = `doc_${Date.parse(this.now) + ++this.seq}`;
    const link = `https://onb06-uploads.s3.af-south-1.amazonaws.com/uploads/${DEV_EMPLOYEE_ID}/${documentType}/${documentId}_${SAFE(fileName)}?X-Amz-Signature=fake${this.seq}`;
    this.issued.push({ url: link, documentId, type: documentType, fileName, contentType, fileSize });
    return this.json(route, 200, { url: link, documentId, expiresIn: 900, headers: { 'Content-Type': contentType } });
  }

  // ------------------------------------------------------------ S3

  private async s3(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      const asked = (request.headers()['access-control-request-headers'] ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
      this.preflights.push({ kind: 's3', path: url.pathname, requestHeaders: asked.join(', ') });
      // A header the bucket's rule does not allow: the preflight is refused, with no CORS headers, and the browser drops the PUT.
      if (asked.some((h) => h !== 'content-type')) return route.fulfill({ status: 403, body: '<Error><Code>AccessForbidden</Code></Error>' });
      return route.fulfill({ status: 200, headers: S3_CORS });
    }
    if (request.method() !== 'PUT') return route.fulfill({ status: 405, headers: S3_CORS, body: '<Error><Code>MethodNotAllowed</Code></Error>' });
    const headers = await request.allHeaders();
    let pageUrl = '';
    try {
      pageUrl = request.frame().url();
    } catch {
      /* no frame */
    }
    const body = request.postDataBuffer() ?? Buffer.alloc(0);
    this.puts.push({ url: request.url(), headers, size: body.length, body, pageUrl });
    if (this.holdPuts) await new Promise<void>((go) => this.held.push(go));
    const canned = this.nextPuts.shift();
    if (canned === 'offline') return route.abort('connectionrefused');
    if (canned) return route.fulfill({ status: canned.status, headers: S3_CORS, body: canned.body ?? '<Error><Code>InternalError</Code></Error>' });

    const link = this.issued.find((i) => i.url === request.url());
    if (!link) return route.fulfill({ status: 403, headers: S3_CORS, body: '<Error><Code>SignatureDoesNotMatch</Code></Error>' });
    const type = (headers['content-type'] ?? '').split(';')[0]!.trim();
    if (type !== link.contentType || body.length !== link.fileSize) {
      return route.fulfill({ status: 403, headers: S3_CORS, body: '<Error><Code>SignatureDoesNotMatch</Code></Error>' });
    }
    if (this.autoRecord) this.record(link);
    return route.fulfill({ status: 200, headers: { ...S3_CORS, etag: '"onb06"' }, body: '' });
  }

  /** What the server does when the file arrives: the file is in the person's list as "With HR". */
  private record(link: Issued): void {
    const t = this.answer.documents.find((d) => d.type === link.type);
    if (!t) return;
    t.files.unshift({ fileName: link.fileName, uploadedAt: this.now, state: 'WITH_HR' });
    t.state = 'WITH_HR';
  }

  private json(route: Route, status: number, body: unknown): Promise<void> {
    return route.fulfill({ status, headers: { ...API_CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
}
