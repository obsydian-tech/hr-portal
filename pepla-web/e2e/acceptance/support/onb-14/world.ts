import { TENANT_A, TENANT_B, encrypted, row, type Caller, type Row, type Tables } from './lambda-harness';

/**
 * ONB-14: the stored tables the Lambda tests read, row by row as DynamoDB holds them, and the people who call.
 *
 * `world()` gives company A (TENANT_A) a person, Naledi, with a National ID, a bank letter, a legacy ID read before NH-11
 * (the plain `idNumber`), and every document whose number cannot be shown (a sentinel, an empty or NOT_FOUND account number,
 * no verification, a verification that belongs to someone else). Company B has its own person and document. With
 * `legacy: true` company A's rows carry no `tenant_id`, as every row in prod does today (they belong to the legacy company).
 *
 * The numbers are made up. Their last four digits appear nowhere else in these rows (ids, names, times), so a test can look
 * for "the last four" in an event without a false hit.
 */

export const E = 'EMP-1501';
export const E_OTHER = 'EMP-1599';
export const E_B = 'EMP-2001';
export const ID_NUMBER = '9803145800876';
export const ACCOUNT_NUMBER = '62845519023';
export const LEGACY_ID_NUMBER = '8001015009087';
export const B_ID_NUMBER = '9001015009085';
export const ID_LAST4 = ID_NUMBER.slice(-4);
export const ACCOUNT_LAST4 = ACCOUNT_NUMBER.slice(-4);
export const LEGACY_LAST4 = LEGACY_ID_NUMBER.slice(-4);
export const NALEDI_EMAIL = 'naledi.dlamini@kestrel-foods.co.za';

export const DOC = {
  id: 'doc_1763400000001',
  bank: 'doc_1763400000002',
  legacyId: 'doc_1763400000003',
  sentinelId: 'doc_1763400000004',
  emptyBank: 'doc_1763400000005',
  notFoundBank: 'doc_1763400000006',
  noVerification: 'doc_1763400000007',
  strangersVerification: 'doc_1763400000008',
  noNumberId: 'doc_1763400000009',
  matric: 'doc_1763400000010',
  otherCompanyVerification: 'doc_1763400000012',
  b: 'doc_1763400000011',
  missing: 'doc_1763499999999',
} as const;
export const VER = (docId: string) => `ver_${docId}`;

export type WorldOptions = { legacy?: boolean };

/** The tables. */
export function world(opts: WorldOptions = {}): Tables {
  const stamp = (t: string | undefined) => (opts.legacy ? undefined : t);
  const person = (id: string, first: string, last: string, tenant: string | undefined, extra: Record<string, string> = {}): Row =>
    row({
      employee_id: id, first_name: first, last_name: last, email: id === E ? NALEDI_EMAIL : `${first.toLowerCase()}.${last.toLowerCase()}@kestrel-foods.co.za`,
      stage: 'DOCUMENTS_SUBMITTED', department: 'Finance', job_title: 'Bookkeeper', id_number_last4: '0000', user_sub: `sub-${first.toLowerCase()}`,
      hr_staff_name: 'Jane Smith', hr_staff_email: 'jane.smith@mokoena-logistics.co.za', created_at: '2026-10-20T08:00:00.000Z', tenant_id: tenant, ...extra,
    });
  const doc = (employee: string, id: string, type: string, tenant: string | undefined, withVerification = true): Row =>
    row({
      employee_id: employee, document_id: id, document_type: type, file_name: `${type.toLowerCase()}.pdf`, s3_key: `uploads/${employee}/${id}.pdf`,
      ocr_status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T08:00:00Z', verification_id: withVerification ? VER(id) : undefined, tenant_id: tenant,
    });
  const ver = (employee: string, id: string, type: string, tenant: string | undefined, values: Record<string, string | number | undefined>): Row =>
    row({
      verificationId: VER(id), employeeId: employee, documentId: id, documentType: type, confidence: 92, decision: 'MANUAL_REVIEW', check: 'MATCHES',
      createdAt: '2026-11-04T08:02:00.000Z', reasoning: 'Sample reasoning.', checks: '{}', tenant_id: tenant, ...values,
    });
  const A = stamp(TENANT_A);
  const idValues = { name: 'NALEDI THANDO', surname: 'DLAMINI', idNumber_encrypted: encrypted(ID_NUMBER), idNumber_last4: ID_LAST4, dateOfBirth: '1998-03-14' };
  const bankValues = { accountHolder: 'MS N DLAMINI', bankName: 'Ubuntu Mutual Bank', accountNumber: ACCOUNT_NUMBER, branchCode: '250655', accountType: 'Cheque' };

  // Rows that come first in a scan, so a reader that takes the first row is caught.
  const stray = row({ employee_id: E_OTHER, document_id: 'doc_1760000000000', document_type: 'NATIONAL_ID', file_name: 'other.pdf', s3_key: 'uploads/other.pdf', ocr_status: 'MANUAL_REVIEW', tenant_id: A });

  return {
    employees: [person(E, 'Naledi', 'Dlamini', A), person(E_OTHER, 'Other', 'Person', A), person(E_B, 'Zanele', 'Companyb', TENANT_B)],
    documents: [
      stray,
      doc(E, DOC.id, 'NATIONAL_ID', A),
      doc(E, DOC.bank, 'BANK_CONFIRMATION', A),
      doc(E, DOC.legacyId, 'NATIONAL_ID', A),
      doc(E, DOC.sentinelId, 'NATIONAL_ID', A),
      doc(E, DOC.emptyBank, 'BANK_CONFIRMATION', A),
      doc(E, DOC.notFoundBank, 'BANK_CONFIRMATION', A),
      doc(E, DOC.noVerification, 'NATIONAL_ID', A, false),
      doc(E, DOC.strangersVerification, 'NATIONAL_ID', A),
      doc(E, DOC.noNumberId, 'NATIONAL_ID', A),
      doc(E, DOC.matric, 'MATRIC_CERTIFICATE', A),
      doc(E, DOC.otherCompanyVerification, 'NATIONAL_ID', A),
      doc(E_B, DOC.b, 'NATIONAL_ID', TENANT_B),
    ],
    'document-verification': [
      ver(E, DOC.id, 'NATIONAL_ID', A, idValues),
      ver(E, DOC.bank, 'BANK_CONFIRMATION', A, bankValues),
      // A row from before NH-11: the plain idNumber, no ciphertext.
      ver(E, DOC.legacyId, 'NATIONAL_ID', A, { name: 'NALEDI', surname: 'DLAMINI', idNumber: LEGACY_ID_NUMBER, idNumber_last4: undefined }),
      // processDocumentOCR when KMS was down: a sentinel and last four "XXXX".
      ver(E, DOC.sentinelId, 'NATIONAL_ID', A, { name: 'NALEDI', surname: 'DLAMINI', idNumber_encrypted: 'KMS_UNAVAILABLE', idNumber_last4: 'XXXX' }),
      ver(E, DOC.emptyBank, 'BANK_CONFIRMATION', A, { ...bankValues, accountNumber: '' }),
      ver(E, DOC.notFoundBank, 'BANK_CONFIRMATION', A, { ...bankValues, accountNumber: 'NOT_FOUND' }),
      // The verification row names another person: the document's own person is E.
      ver(E_OTHER, DOC.strangersVerification, 'NATIONAL_ID', A, idValues),
      ver(E, DOC.noNumberId, 'NATIONAL_ID', A, { name: 'NALEDI', surname: 'DLAMINI' }),
      ver(E, DOC.matric, 'MATRIC_CERTIFICATE', A, { confidence: 91 }),
      // The document is company A's; the verification row it points at is company B's.
      ver(E, DOC.otherCompanyVerification, 'NATIONAL_ID', TENANT_B, idValues),
      ver(E_B, DOC.b, 'NATIONAL_ID', TENANT_B, { name: 'ZANELE', surname: 'COMPANYB', idNumber_encrypted: encrypted(B_ID_NUMBER), idNumber_last4: B_ID_NUMBER.slice(-4) }),
    ],
    'onboarding-events': [],
    'naleko-idempotency': [],
  };
}

// ---------------------------------------------------------------- who calls

export const HR_A: Caller = { kind: 'jwt', email: 'thandi.demo-hr@kestrel-foods.co.za', groups: ['hr_staff'], givenName: 'Thandi', familyName: 'Demo-HR', sub: 'sub-thandi-0001', tenantId: TENANT_A };
export const HR_A_NO_NAMES: Caller = { kind: 'jwt', email: 'people-team@kestrel-foods.co.za', groups: ['hr_staff'], sub: 'sub-people-0002', tenantId: TENANT_A };
export const HR_B: Caller = { kind: 'jwt', email: 'sizwe.hr@companyb.example', groups: ['hr_staff'], givenName: 'Sizwe', familyName: 'Mahlangu', sub: 'sub-sizwe-0003', tenantId: TENANT_B };
export const OWNER: Caller = { kind: 'jwt', email: NALEDI_EMAIL, groups: ['employee'], givenName: 'Naledi', familyName: 'Dlamini', sub: 'sub-naledi', tenantId: TENANT_A };

/** Everyone who is not HR of the company: each gets 403 before any table, key or bus call. */
export const NOT_HR: Array<[string, Caller]> = [
  ['a call with no claims at all', { kind: 'none' }],
  ['the Agent API actor', { kind: 'agent' }],
  ['an employee', { kind: 'jwt', email: 'john.doe@kestrel-foods.co.za', groups: ['employee'], givenName: 'John', familyName: 'Doe', sub: 'sub-john', tenantId: TENANT_A }],
  ['the person the document belongs to', OWNER],
  ['a token in hr_staff_readonly', { kind: 'jwt', email: 'audit@kestrel-foods.co.za', groups: ['employee', 'hr_staff_readonly'], tenantId: TENANT_A }],
  ['a group named not_hr_staff only', { kind: 'jwt', email: 'temp@kestrel-foods.co.za', groups: ['not_hr_staff'], tenantId: TENANT_A }],
  ['a group named naleko-onboarding-hr only', { kind: 'jwt', email: 'hrdirector@kestrel-foods.co.za', groups: ['naleko-onboarding-hr'], tenantId: TENANT_A }],
  ['a signed-in person in no group', { kind: 'jwt', email: 'visitor@kestrel-foods.co.za', groups: [], tenantId: TENANT_A }],
  ['an access token of an hr_staff person', { kind: 'jwt', email: HR_A.kind === 'jwt' ? HR_A.email : '', groups: ['hr_staff'], tokenUse: 'access', sub: 'sub-thandi-0001', tenantId: TENANT_A }],
];

/** What the browser sends for a Show. */
export const body = (field: string, employeeId: string = E, extra: Record<string, unknown> = {}) => ({ field, employee_id: employeeId, ...extra });
