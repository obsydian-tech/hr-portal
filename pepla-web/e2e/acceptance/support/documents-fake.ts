import type { BrowserContext, Route } from '@playwright/test';

/**
 * A stand-in for one route of the document upload API,
 * GET <documentUploadApiUrl>/v1/employees/<id>/verifications, for the
 * no-backend acceptance run (ONB-12 and later cards that read one person).
 *
 * People and documents are given here the way they are STORED (employees,
 * documents and document-verification tables). The fake answers the way
 * lambda/getEmployeeDocumentVerifications answers once ONB-12 is built: the
 * fields of today, plus `job_title`, and `check`, `hr_decision` and
 * `hr_decided_at` worked out by the card's two tables (checkOf, decisionOf
 * below). The Lambda's own tests (onb-12.spec.ts AC-11) hold the Lambda to
 * the same two functions, so the page and the Lambda read one answer.
 *
 * Every call needs `Authorization: Bearer <JWT>`, as the API's Cognito
 * authorizer does, or it gets 401. Every call is recorded in `calls`.
 * Nothing here calls AWS or any AI service.
 */

export const DOCUMENT_TYPES = ['NATIONAL_ID', 'BANK_CONFIRMATION', 'MATRIC_CERTIFICATE', 'TERTIARY_QUALIFICATION'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** The names the page shows for each type, in the card's order (kit "Employee detail"). */
export const TYPE_NAME: Record<DocumentType, string> = {
  NATIONAL_ID: 'National ID',
  BANK_CONFIRMATION: 'Bank confirmation',
  MATRIC_CERTIFICATE: 'Matric certificate',
  TERTIARY_QUALIFICATION: 'Tertiary qualification',
};

/** An employees-table row, as stored. */
export type StoredEmployee = {
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  department: string;
  job_title: string;
  stage: string;
  planned_start_date: string;
  hr_staff_id: string;
  hr_staff_name: string;
  hr_staff_email: string;
};

/** A document-verification row, as stored (the parts this card reads). */
export type StoredVerification = {
  confidence: number;
  decision?: string;
  /** The full ID number. Stored encrypted; the Lambda decrypts it for HR. */
  idNumber?: string;
  name?: string;
  surname?: string;
};

/** A documents-table row, as stored, with its verification when OCR has finished. */
export type StoredDocument = {
  document_id: string;
  document_type: DocumentType;
  file_name: string;
  uploaded_at: string;
  ocr_status: 'PENDING' | 'PROCESSING' | 'PASSED' | 'MANUAL_REVIEW' | 'FAILED';
  ocr_completed_at?: string;
  hr_reviewed_at?: string;
  hr_decision_notes?: string;
  verification?: StoredVerification;
  /** Only for "Doesn't match", which nothing stores until ONB-07: the check the API answers with. */
  futureCheck?: 'DOESNT_MATCH';
};

export type Check = 'READING' | 'MATCHES' | 'NEEDS_A_LOOK' | 'DOESNT_MATCH';
export type HrDecision = 'ACCEPTED' | 'NEW_ONE_ASKED' | null;

/** The card's first table: the check, from what is stored. Undefined for a row the table does not cover. */
export function checkOf(d: StoredDocument): Check | undefined {
  if (d.futureCheck) return d.futureCheck;
  if (d.verification) return d.verification.confidence >= 90 ? 'MATCHES' : 'NEEDS_A_LOOK';
  if (d.ocr_status === 'PENDING' || d.ocr_status === 'PROCESSING') return 'READING';
  if (d.ocr_status === 'FAILED') return 'NEEDS_A_LOOK';
  return undefined;
}

/** The card's second table: HR's decision, told apart only by hr_reviewed_at. */
export function decisionOf(d: StoredDocument): HrDecision | undefined {
  if (!d.hr_reviewed_at) return null;
  if (d.ocr_status === 'PASSED') return 'ACCEPTED';
  if (d.ocr_status === 'FAILED') return 'NEW_ONE_ASKED';
  return undefined;
}

/** The words the page shows. */
export const CHECK_WORD: Record<Check, string> = {
  READING: 'Being checked',
  MATCHES: 'Matches',
  NEEDS_A_LOOK: 'Needs a look',
  DOESNT_MATCH: "Doesn't match",
};
export const DECISION_WORD = { ACCEPTED: 'Accepted', NEW_ONE_ASKED: 'New one asked for', none: 'Not decided' } as const;

export type FakePerson = { employee: StoredEmployee; documents: StoredDocument[] };
export type ApiCall = { method: string; url: URL; authorization: string | null };

let serial = 0;

/** A made-up person with every field the employees table holds. */
export function storedEmployee(p: Partial<StoredEmployee> & Pick<StoredEmployee, 'first_name' | 'last_name'>): StoredEmployee {
  serial++;
  const slug = `${p.first_name}.${p.last_name}`.toLowerCase().replace(/[^a-z.]/g, '');
  return {
    employee_id: `EMP-12${String(serial).padStart(5, '0')}`,
    email: `${slug}@kestrel-foods.co.za`,
    phone: '+27 82 555 0142',
    department: 'Operations',
    job_title: 'Clerk',
    stage: 'ACTIVE',
    planned_start_date: '2026-12-01',
    hr_staff_id: 'hr-0001',
    hr_staff_name: 'Jane Smith',
    hr_staff_email: 'jane.smith@mokoena-logistics.co.za',
    ...p,
  };
}

let docSerial = 0;
/** A made-up document. */
export function storedDocument(p: Partial<StoredDocument> & Pick<StoredDocument, 'document_type' | 'ocr_status' | 'uploaded_at'>): StoredDocument {
  docSerial++;
  return {
    document_id: `doc-${String(docSerial).padStart(4, '0')}`,
    file_name: `${p.document_type.toLowerCase().replace(/_/g, '-')}-${docSerial}.pdf`,
    ...p,
  };
}

/** What the Lambda answers for one person, once ONB-12 is built. */
export function answerFor(person: FakePerson): unknown {
  const e = person.employee;
  const documents = person.documents.map((d, i) => {
    const check = checkOf(d);
    const decision = decisionOf(d);
    if (check === undefined || decision === undefined) throw new Error(`${d.document_id}: the card's tables do not cover this document`);
    const v = d.verification;
    return {
      document_id: d.document_id,
      document_type: d.document_type,
      file_name: d.file_name,
      uploaded_at: d.uploaded_at,
      ocr_status: d.ocr_status,
      ocr_completed_at: d.ocr_completed_at ?? (v ? d.uploaded_at : undefined),
      verification: v
        ? {
            verification_id: `ver-${d.document_id}`,
            confidence: v.confidence,
            decision: v.decision ?? (v.confidence >= 90 ? 'AUTO_APPROVE' : 'MANUAL_REVIEW'),
            reasoning: 'Sample data.',
            id_number: v.idNumber ?? null,
            id_number_last4: v.idNumber ? v.idNumber.slice(-4) : null,
            name: v.name ?? e.first_name,
            surname: v.surname ?? e.last_name,
            date_of_birth: null,
            gender: null,
            citizenship: null,
          }
        : null,
      can_reupload: ['MANUAL_REVIEW', 'FAILED', 'PENDING'].includes(d.ocr_status),
      check,
      hr_decision: decision,
      hr_decided_at: d.hr_reviewed_at ?? null,
      _order: i,
    };
  });
  const count = (s: string) => person.documents.filter((d) => d.ocr_status === s).length;
  return {
    employee: {
      employee_id: e.employee_id,
      first_name: e.first_name,
      last_name: e.last_name,
      email: e.email,
      phone: e.phone,
      stage: e.stage,
      department: e.department,
      job_title: e.job_title,
      planned_start_date: e.planned_start_date,
      hr_staff_id: e.hr_staff_id,
      hr_staff_name: e.hr_staff_name,
      hr_staff_email: e.hr_staff_email,
    },
    documents: documents.map(({ _order, ...d }) => d),
    summary: {
      total_documents: person.documents.length,
      passed: count('PASSED'),
      manual_review: count('MANUAL_REVIEW'),
      failed: count('FAILED'),
      pending: count('PENDING'),
      processing: count('PROCESSING'),
    },
  };
}

const ROUTE = /^\/v1\/employees\/([^/]+)\/verifications$/;
/** GET <document upload API>/v1/employees/<id>/verifications on any host that is not the app. */
export const isPersonApi = (url: URL, appOrigin: string): boolean => ROUTE.test(url.pathname) && url.origin !== appOrigin;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
};
const JWT = /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/;

export class DocumentsFake {
  readonly calls: ApiCall[] = [];
  readonly people = new Map<string, FakePerson>();
  /** 'ok' answers; 'error' answers 500; 'offline' fails as if the network were down; 'hold' waits for release(). */
  mode: 'ok' | 'error' | 'offline' | 'hold' = 'ok';
  private held: Array<() => void> = [];

  constructor(private readonly appOrigin: string) {}

  add(...people: FakePerson[]): void {
    for (const p of people) this.people.set(p.employee.employee_id, p);
  }

  gets(): ApiCall[] {
    return this.calls.filter((c) => c.method === 'GET');
  }

  release(): void {
    if (this.mode === 'hold') this.mode = 'ok';
    for (const go of this.held.splice(0)) go();
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route((url) => isPersonApi(url, this.appOrigin), (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    this.calls.push({ method: request.method(), url, authorization: request.headers()['authorization'] ?? null });

    if (this.mode === 'hold') await new Promise<void>((go) => this.held.push(go));
    if (this.mode === 'offline') return route.abort('internetdisconnected');
    if (this.mode === 'error') return json(route, 500, { error: 'Internal server error' });

    if (request.method() !== 'GET') return json(route, 404, { message: 'Not Found' });
    if (!JWT.test(request.headers()['authorization'] ?? '')) return json(route, 401, { message: 'Unauthorized' });

    const id = decodeURIComponent(ROUTE.exec(url.pathname)![1]!);
    const person = this.people.get(id);
    if (!person) return json(route, 404, { error: 'Employee not found' });
    return json(route, 200, answerFor(person));
  }
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
