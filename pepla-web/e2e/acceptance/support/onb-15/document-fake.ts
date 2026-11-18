import type { BrowserContext, Route } from '@playwright/test';

/**
 * A stand-in for the three document upload API routes behind HR's document page (ONB-15), for the
 * no-backend acceptance run:
 *
 *   GET   <documentUploadApiUrl>/v1/verifications/<id>          (?employee_id= allowed)
 *   PATCH <documentUploadApiUrl>/v1/verifications/<id>/review
 *   GET   <documentUploadApiUrl>/v1/documents/<id>/url
 *
 * Documents are given the way they are STORED (the document row, its verification row and the
 * employee). The fake answers the way the card's "The GET answer" says the Lambda answers: today's
 * fields plus `employee`, `check`, `hr_decision`, `hr_decided_at`, `hr_decided_by_name`,
 * `hr_decision_reason` and `comparisons`, worked out with the card's tables (the functions below).
 * The Lambda tests in onb-15.spec.ts hold the real Lambda to the same tables.
 *
 * A decision is made the way the card's "Deciding" says: once, never while the document is being
 * read, with the name from the caller's ID token (given and family name, else the email) and the
 * fake's own clock (`now`), so the page can only show the time it was given.
 *
 * Every call needs `Authorization: Bearer <JWT>`, as the API's Cognito authorizer does, or it gets
 * 401. Every call is recorded in `calls`. The file link points at FILE_ORIGIN, which the fake also
 * answers with a small PDF.
 * ONB-14: the GET answer carries no full ID number or account number: `extracted_data` holds `id_number_last4`,
 * `account_number_last4`, `id_number_available` and `account_number_available`. The full number comes only from `reveal`,
 * the fake of POST <documentUploadApiUrl>/v1/verifications/<document id>/reveal (support/onb-14/reveal-fake.ts).
 * Nothing here calls AWS or any AI service.
 */

import { RevealFake } from '../onb-14/reveal-fake';

export type DocumentType = 'NATIONAL_ID' | 'BANK_CONFIRMATION' | 'MATRIC_CERTIFICATE' | 'TERTIARY_QUALIFICATION';
export type Check = 'READING' | 'MATCHES' | 'NEEDS_A_LOOK' | 'DOESNT_MATCH';
export type ComparedField = 'SURNAME' | 'ID_NUMBER' | 'ACCOUNT_HOLDER';
export type Compared = 'AGREES' | 'DIFFERS' | 'NOT_READ' | 'NOT_ON_RECORD';
export type Comparison = { field: ComparedField; result: Compared };

export const TYPE_NAME: Record<DocumentType, string> = {
  NATIONAL_ID: 'National ID',
  BANK_CONFIRMATION: 'Bank confirmation',
  MATRIC_CERTIFICATE: 'Matric certificate',
  TERTIARY_QUALIFICATION: 'Tertiary qualification',
};

/** What the model read, as the verification row stores it (plain values; the ID number already decrypted). */
export type Read = {
  id_number?: string | null;
  name?: string | null;
  surname?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  citizenship?: string | null;
  account_holder?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  branch_code?: string | null;
  account_type?: string | null;
};

export type FakeDocument = {
  document_id: string;
  employee: { employee_id: string; first_name: string; last_name: string; id_number_last4?: string };
  document_type: DocumentType;
  file_name: string;
  /** Rows written since ONB-13 have uploaded_at; older ones only upload_timestamp. */
  uploaded_at?: string;
  upload_timestamp?: string;
  ocr_status: 'PENDING' | 'PROCESSING' | 'PASSED' | 'MANUAL_REVIEW' | 'FAILED';
  ocr_completed_at?: string;
  hr_reviewed_at?: string;
  hr_reviewed_by?: string;
  hr_reviewed_by_name?: string;
  hr_decision_notes?: string;
  verification?: { confidence: number; check?: string; read: Read; reasoning?: string; checks?: unknown } | null;
  /** Given outright for a page test that needs one exact comparison; otherwise worked out by comparisonsOf. */
  comparisons?: Comparison[];
};

// ---------------------------------------------------------------- the card's tables

const STORED_CHECKS = ['MATCHES', 'NEEDS_A_LOOK', 'DOESNT_MATCH'];

/** ONB-07's checkOf: the stored check, else 90% or more, else reading or needs a look. */
export function checkOf(d: FakeDocument): Check {
  const v = d.verification;
  if (v) {
    if (v.check && STORED_CHECKS.includes(v.check)) return v.check as Check;
    return v.confidence >= 90 ? 'MATCHES' : 'NEEDS_A_LOOK';
  }
  if (d.ocr_status === 'PENDING' || d.ocr_status === 'PROCESSING') return 'READING';
  return 'NEEDS_A_LOOK';
}

export function hrDecisionOf(d: FakeDocument): 'ACCEPTED' | 'NEW_ONE_ASKED' | null {
  if (!d.hr_reviewed_at) return null;
  if (d.ocr_status === 'PASSED') return 'ACCEPTED';
  if (d.ocr_status === 'FAILED') return 'NEW_ONE_ASKED';
  return null;
}

export const normaliseName = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const notRead = (v: unknown) => v === null || v === undefined || String(v).trim() === '' || String(v).trim().toUpperCase() === 'NOT_FOUND';

/** The card's comparison table (comparisonsOf). */
export function comparisonsOf(d: FakeDocument): Comparison[] {
  const read: Read = d.verification?.read ?? {};
  const last = d.employee.last_name;
  const last4 = d.employee.id_number_last4;
  const one = (field: ComparedField, value: unknown, onRecord: unknown, agrees: () => boolean): Comparison => ({
    field,
    result: !d.verification || notRead(value) ? 'NOT_READ' : !onRecord ? 'NOT_ON_RECORD' : agrees() ? 'AGREES' : 'DIFFERS',
  });
  if (d.document_type === 'NATIONAL_ID') {
    return [
      one('SURNAME', read.surname, last, () => normaliseName(read.surname) === normaliseName(last)),
      one('ID_NUMBER', read.id_number, last4, () => String(read.id_number).replace(/\D/g, '').endsWith(String(last4))),
    ];
  }
  if (d.document_type === 'BANK_CONFIRMATION') {
    return [one('ACCOUNT_HOLDER', read.account_holder, last, () => normaliseName(read.account_holder).includes(normaliseName(last)))];
  }
  return [];
}

/** The card's page words for each comparison. */
export const COMPARISON_WORDS: Record<ComparedField, Record<Compared, string>> = {
  SURNAME: {
    AGREES: 'Surname matches the record',
    DIFFERS: 'Surname is different from the record',
    NOT_READ: 'Surname could not be read',
    NOT_ON_RECORD: 'No surname on the record to compare',
  },
  ID_NUMBER: {
    AGREES: 'ID number ends in the same 4 digits as the record',
    DIFFERS: 'ID number ends in different digits from the record',
    NOT_READ: 'ID number could not be read',
    NOT_ON_RECORD: 'No ID number on the record to compare',
  },
  ACCOUNT_HOLDER: {
    AGREES: 'Account holder includes the surname on the record',
    DIFFERS: 'Account holder does not include the surname on the record',
    NOT_READ: 'Account holder could not be read',
    NOT_ON_RECORD: 'No surname on the record to compare',
  },
};

/** The GET answer for one stored document, as the card says the Lambda answers. */
export function answerFor(d: FakeDocument): Record<string, unknown> {
  const v = d.verification;
  const r = v?.read ?? {};
  const decision = hrDecisionOf(d);
  const idLast4 = r.id_number ? String(r.id_number).replace(/\D/g, '').slice(-4) : null;
  const shownable = (v: unknown) => !notRead(v);
  return {
    document: {
      document_id: d.document_id,
      employee_id: d.employee.employee_id,
      document_type: d.document_type,
      file_name: d.file_name,
      s3_key: `uploads/${d.employee.employee_id}/${d.document_type}/${d.document_id}_${d.file_name}`,
      uploaded_at: d.uploaded_at ?? d.upload_timestamp ?? null,
      ocr_status: d.ocr_status,
      ocr_completed_at: d.ocr_completed_at ?? null,
    },
    verification: v
      ? {
          verification_id: `ver_${d.document_id}`,
          confidence: v.confidence,
          decision: 'MANUAL_REVIEW',
          reasoning: v.reasoning ?? 'Sample data.',
          extracted_data: {
            id_number_last4: idLast4,
            account_number_last4: shownable(r.account_number) ? String(r.account_number).slice(-4) : null,
            id_number_available: shownable(r.id_number),
            account_number_available: shownable(r.account_number),
            name: r.name ?? null,
            surname: r.surname ?? null,
            date_of_birth: r.date_of_birth ?? null,
            gender: r.gender ?? null,
            citizenship: r.citizenship ?? null,
            account_holder: r.account_holder ?? null,
            bank_name: r.bank_name ?? null,
            branch_code: r.branch_code ?? null,
            account_type: r.account_type ?? null,
          },
          checks: v.checks ?? {},
          created_at: d.ocr_completed_at ?? null,
        }
      : null,
    can_reupload: ['MANUAL_REVIEW', 'FAILED', 'PENDING'].includes(d.ocr_status),
    employee: { employee_id: d.employee.employee_id, first_name: d.employee.first_name, last_name: d.employee.last_name },
    check: checkOf(d),
    hr_decision: decision,
    hr_decided_at: d.hr_reviewed_at ?? null,
    hr_decided_by_name: d.hr_reviewed_by_name ?? null,
    hr_decision_reason: decision === 'NEW_ONE_ASKED' && (d.hr_decision_notes ?? '').trim() ? d.hr_decision_notes!.trim() : null,
    comparisons: d.comparisons ?? comparisonsOf(d),
  };
}

// ---------------------------------------------------------------- the routes

export type ApiCall = {
  method: string;
  url: URL;
  authorization: string | null;
  idempotencyKey: string | null;
  body: any;
};

export const FILE_ORIGIN = 'https://document-files.onb15.example';
const ONE = /^\/v1\/verifications\/([^/]+)$/;
const DECIDE = /^\/v1\/verifications\/([^/]+)\/review$/;
const LINK = /^\/v1\/documents\/([^/]+)\/url$/;
export const isDocumentApi = (url: URL, appOrigin: string): boolean =>
  url.origin !== appOrigin && (ONE.test(url.pathname) || DECIDE.test(url.pathname) || LINK.test(url.pathname));

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, PATCH, OPTIONS',
};
const JWT = /^Bearer (eyJ[\w-]+)\.(eyJ[\w-]+)\.[\w-]*$/;

/** The words a server might send back that the page must never show. */
export const SERVER_TEXT = 'Internal server error: ProvisionedThroughputExceededException at reviewDocumentVerification (index.mjs:212)';

type Mode = 'ok' | 'error' | 'offline' | 'hold' | 'not-found' | 'forbidden';

export class DocumentFake {
  readonly calls: ApiCall[] = [];
  readonly documents = new Map<string, FakeDocument>();
  /** GET /v1/verifications/<id>. */
  getMode: Mode = 'ok';
  /** PATCH .../review. 'conflict': someone else decided first (409, and the document is then decided by `otherHr`). */
  decideMode: 'ok' | 'error' | 'offline' | 'hold' | 'conflict' = 'ok';
  /** GET /v1/documents/<id>/url. */
  linkMode: 'ok' | 'error' | 'offline' = 'ok';
  /** The server's clock for a decision. */
  now = '2026-11-14T08:30:00.000Z';
  /** Who decided first, for decideMode 'conflict'. */
  otherHr = { name: 'Sam Peters', at: '2026-11-14T07:15:00.000Z', decision: 'PASSED' as 'PASSED' | 'FAILED' };
  private held: Array<() => void> = [];
  /** ONB-14: POST /v1/verifications/<document id>/reveal, answered from the same documents. */
  readonly reveal: RevealFake;

  /** The full number the stored document holds for a field, and whose document it is (what the Lambda reads). */
  readonly revealLookup = (documentId: string, field: 'id_number' | 'account_number'): { value: string; employeeId: string } | undefined => {
    const d = this.documents.get(documentId);
    const read = d?.verification?.read;
    const value = field === 'id_number' && d?.document_type === 'NATIONAL_ID' ? read?.id_number : field === 'account_number' && d?.document_type === 'BANK_CONFIRMATION' ? read?.account_number : undefined;
    return d && value && !notRead(value) ? { value: String(value), employeeId: d.employee.employee_id } : undefined;
  };

  constructor(private readonly appOrigin: string) {
    this.reveal = new RevealFake(appOrigin, this.revealLookup);
  }

  add(...docs: FakeDocument[]): void {
    for (const d of docs) this.documents.set(d.document_id, structuredClone(d));
  }

  gets(id?: string): ApiCall[] {
    return this.calls.filter((c) => c.method === 'GET' && ONE.test(c.url.pathname) && (!id || decodeURIComponent(ONE.exec(c.url.pathname)![1]!) === id));
  }
  decisions(id?: string): ApiCall[] {
    return this.calls.filter((c) => c.method === 'PATCH' && DECIDE.test(c.url.pathname) && (!id || decodeURIComponent(DECIDE.exec(c.url.pathname)![1]!) === id));
  }
  links(id?: string): ApiCall[] {
    return this.calls.filter((c) => c.method === 'GET' && LINK.test(c.url.pathname) && (!id || decodeURIComponent(LINK.exec(c.url.pathname)![1]!) === id));
  }
  /** The link GET /v1/documents/<id>/url answers. */
  fileLink(id: string): string {
    return `${FILE_ORIGIN}/uploads/${encodeURIComponent(id)}.pdf?X-Amz-Expires=900&X-Amz-Signature=onb15fakesignature`;
  }

  release(): void {
    if (this.getMode === 'hold') this.getMode = 'ok';
    if (this.decideMode === 'hold') this.decideMode = 'ok';
    for (const go of this.held.splice(0)) go();
  }

  async install(context: BrowserContext): Promise<void> {
    // The file itself, served as a page: headless Chromium downloads a PDF instead of opening it, and the
    // tab would stay on about:blank.
    await context.route((url) => url.origin === FILE_ORIGIN, (route) =>
      route.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>Sample document</title><p>ONB-15 sample document. Sample data.</p>' }),
    );
    await context.route((url) => isDocumentApi(url, this.appOrigin), (route) => this.handle(route));
    await this.reveal.install(context);
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
    this.calls.push({ method: request.method(), url, authorization: headers['authorization'] ?? null, idempotencyKey: headers['idempotency-key'] ?? null, body });

    const auth = JWT.exec(headers['authorization'] ?? '');
    if (ONE.test(url.pathname) && request.method() === 'GET') {
      if (this.getMode === 'hold') await new Promise<void>((go) => this.held.push(go));
      if (this.getMode === 'offline') return route.abort('internetdisconnected');
      if (this.getMode === 'error') return json(route, 500, { error: SERVER_TEXT });
      if (!auth) return json(route, 401, { message: 'Unauthorized' });
      if (this.getMode === 'forbidden') return json(route, 403, { error: 'Only HR can open documents' });
      const d = this.documents.get(decodeURIComponent(ONE.exec(url.pathname)![1]!));
      if (this.getMode === 'not-found' || !d) return json(route, 404, { error: 'Document not found' });
      const employeeId = url.searchParams.get('employee_id');
      if (employeeId && employeeId !== d.employee.employee_id) return json(route, 404, { error: 'Document not found' });
      return json(route, 200, answerFor(d));
    }

    if (DECIDE.test(url.pathname) && request.method() === 'PATCH') {
      if (this.decideMode === 'hold') await new Promise<void>((go) => this.held.push(go));
      if (this.decideMode === 'offline') return route.abort('internetdisconnected');
      if (this.decideMode === 'error') return json(route, 500, { error: SERVER_TEXT });
      if (!auth) return json(route, 401, { message: 'Unauthorized' });
      const d = this.documents.get(decodeURIComponent(DECIDE.exec(url.pathname)![1]!));
      if (!d) return json(route, 404, { error: 'Document not found' });
      if (this.decideMode === 'conflict') {
        d.ocr_status = this.otherHr.decision;
        d.hr_reviewed_at = this.otherHr.at;
        d.hr_reviewed_by_name = this.otherHr.name;
        d.hr_decision_notes = '';
        return json(route, 409, { error: 'This document was already decided or is still being read' });
      }
      const decision = body?.decision;
      if (decision !== 'PASSED' && decision !== 'FAILED') return json(route, 400, { error: 'decision must be "PASSED" or "FAILED"' });
      const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
      if (notes.length > 500) return json(route, 400, { error: 'The reason is too long' });
      if (d.hr_reviewed_at || d.ocr_status === 'PENDING' || d.ocr_status === 'PROCESSING') {
        return json(route, 409, { error: 'This document was already decided or is still being read' });
      }
      const claims = JSON.parse(Buffer.from(auth[2]!, 'base64url').toString('utf8')) as Record<string, string>;
      const name = `${claims['given_name'] ?? ''} ${claims['family_name'] ?? ''}`.trim() || claims['email'] || '';
      d.ocr_status = decision;
      d.hr_reviewed_at = this.now;
      d.hr_reviewed_by = claims['email'];
      d.hr_reviewed_by_name = name;
      d.hr_decision_notes = notes;
      const a = answerFor(d);
      return json(route, 200, {
        message: `Document ${d.document_id} marked as ${decision}`,
        document_id: d.document_id,
        employee_id: d.employee.employee_id,
        decision,
        can_reupload: decision === 'FAILED',
        all_documents_passed: false,
        employee_stage_updated: false,
        hr_decision: a['hr_decision'],
        hr_decided_at: a['hr_decided_at'],
        hr_decided_by_name: a['hr_decided_by_name'],
        hr_decision_reason: a['hr_decision_reason'],
      });
    }

    if (LINK.test(url.pathname) && request.method() === 'GET') {
      if (this.linkMode === 'offline') return route.abort('internetdisconnected');
      if (this.linkMode === 'error') return json(route, 500, { error: SERVER_TEXT });
      if (!auth) return json(route, 401, { message: 'Unauthorized' });
      const id = decodeURIComponent(LINK.exec(url.pathname)![1]!);
      const d = this.documents.get(id);
      if (!d) return json(route, 404, { error: 'Document not found' });
      return json(route, 200, { url: this.fileLink(id), file_name: d.file_name, content_type: 'application/pdf', expires_in: 900 });
    }

    return json(route, 404, { message: 'Not Found' });
  }
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
