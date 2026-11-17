import { join } from 'node:path';
import { LAMBDA, PoolUser, Row, Tables, httpEvent, jwtAuthorizer, row, runHandler } from './lambda-harness';

/**
 * TEN-02: two companies and their rows, as the spec's acceptance criteria seed them.
 *   A: also the legacy company (LEGACY_TENANT_ID = A while the legacy rule is on).
 *   B: a second company.
 * Seeded: two employees of A with documents, verifications and invites; one employee of B with the same; and one
 * legacy row of each kind with no tenant_id. All names and addresses are made up.
 */
export const A = 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa';
export const B = 'ten_bbbbbbbbbbbbbbbbbbbbbbbbbb';
export const TENANTS = 'naleko-people-dev-tenants';
export const POOL = 'af-south-1_Ten02Fake';
export const AGENT_SECRET = 'naleko/agent/api-key';

export const EMP = {
  a1: 'emp-a-0001-john-doe',
  a2: 'emp-a-0002-jane-smith',
  b1: 'emp-b-0001-bea-ndlovu',
  legacy: 'emp-l-0001-lee-mokoena',
};
export const DOC = { a1: 'doc-a-0001', b1: 'doc-b-0001', legacy: 'doc-l-0001' };
export const VER = { a1: 'ver-a-0001', b1: 'ver-b-0001', legacy: 'ver-l-0001' };
export const MAIL = {
  hrA: 'thandi.hr@company-a.example',
  hrB: 'bongani.hr@company-b.example',
  a1: 'john.doe@company-a.example',
  a2: 'jane.smith@company-a.example',
  b1: 'bea.ndlovu@company-b.example',
  legacy: 'lee.mokoena@company-a.example',
};
export const SUB = { hrA: 'sub-hr-a', hrB: 'sub-hr-b', a1: 'sub-emp-a1', b1: 'sub-emp-b1', legacy: 'sub-emp-legacy' };
export const STAFF = { hrA: 'HRA001', hrB: 'HRB001' };

const t = (tenant: string | undefined) => (tenant ? { tenant_id: tenant } : {});

function employee(id: string, first: string, last: string, email: string, tenant: string | undefined, sub: string | undefined, staff: string): Row {
  return row({
    employee_id: id, first_name: first, last_name: last, email, phone: '000 000 0000', department: 'Operations', position: 'Junior baker',
    stage: 'ACTIVE', step: 'DOCUMENTS', created_by: staff, hr_staff_id: staff, created_at: '2026-11-10T08:00:00.000Z', ...(sub ? { user_sub: sub } : {}), ...t(tenant),
  });
}
function document(emp: string, doc: string, ver: string, tenant: string | undefined): Row {
  return row({
    employee_id: emp, document_id: doc, document_type: 'BANK_CONFIRMATION', s3_key: `uploads/${emp}/${doc}.pdf`, s3_bucket: 'ten02-uploads',
    ocr_status: 'MANUAL_REVIEW', verification_id: ver, upload_timestamp: '2026-11-11T08:00:00.000Z', file_name: 'bank.pdf', ...t(tenant),
  });
}
function verification(ver: string, emp: string, doc: string, tenant: string | undefined): Row {
  return row({
    verificationId: ver, employeeId: emp, documentId: doc, documentType: 'BANK_CONFIRMATION', decision: 'MANUAL_REVIEW', confidence: 61,
    createdAt: '2026-11-11T08:05:00.000Z', reasoning: 'Name on the letter differs slightly.', ...t(tenant),
  });
}
function invite(hash: string, emp: string, tenant: string | undefined): Row {
  return row({ token_hash: hash, employee_id: emp, created_at: '2026-11-10T08:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z', sent_by: 'HR', ...t(tenant) });
}

/** The seeded world. `legacyRows` false leaves out the rows without tenant_id. */
export function tables(opts: { legacyRows?: boolean } = {}): Tables {
  const legacy = opts.legacyRows !== false;
  return {
    employees: [
      employee(EMP.a1, 'John', 'Doe', MAIL.a1, A, SUB.a1, STAFF.hrA),
      employee(EMP.a2, 'Jane', 'Smith', MAIL.a2, A, undefined, STAFF.hrA),
      employee(EMP.b1, 'Bea', 'Ndlovu', MAIL.b1, B, SUB.b1, STAFF.hrB),
      ...(legacy ? [employee(EMP.legacy, 'Lee', 'Mokoena', MAIL.legacy, undefined, undefined, STAFF.hrA)] : []),
    ],
    documents: [
      document(EMP.a1, DOC.a1, VER.a1, A),
      document(EMP.b1, DOC.b1, VER.b1, B),
      ...(legacy ? [document(EMP.legacy, DOC.legacy, VER.legacy, undefined)] : []),
    ],
    'document-verification': [
      verification(VER.a1, EMP.a1, DOC.a1, A),
      verification(VER.b1, EMP.b1, DOC.b1, B),
      ...(legacy ? [verification(VER.legacy, EMP.legacy, DOC.legacy, undefined)] : []),
    ],
    employee_invites: [
      invite('hash-a1', EMP.a1, A),
      invite('hash-b1', EMP.b1, B),
      ...(legacy ? [invite('hash-legacy', EMP.legacy, undefined)] : []),
    ],
    'external-verification-requests': [],
    'naleko-agent-audit': [],
    'naleko-pending-actions': [
      row({ actionId: 'act-a-0001', toolName: 'resend_invite', toolArgs: '{}', staffId: STAFF.hrA, status: 'PENDING_APPROVAL', createdAt: '2026-11-12T08:00:00.000Z', tenant_id: A }),
      row({ actionId: 'act-b-0001', toolName: 'resend_invite', toolArgs: '{}', staffId: STAFF.hrB, status: 'PENDING_APPROVAL', createdAt: '2026-11-12T08:00:00.000Z', tenant_id: B }),
    ],
    'onboarding-events': [],
    employee_consents: [],
    NalekoAiRateLimit: [],
    'naleko-prompt-cache': [],
    'talent-flow-users': [],
    'naleko-idempotency-keys': [],
    [TENANTS]: [
      row({ pk: `TENANT#${A}`, sk: 'PROFILE', tenant_id: A, name: 'Company A', status: 'ACTIVE' }),
      row({ pk: `TENANT#${B}`, sk: 'PROFILE', tenant_id: B, name: 'Company B', status: 'ACTIVE' }),
      row({ pk: `USER#${SUB.hrA}`, sk: `TENANT#${A}`, tenant_id: A }),
      row({ pk: `USER#${SUB.hrB}`, sk: `TENANT#${B}`, tenant_id: B }),
      row({ pk: `USER#${SUB.a1}`, sk: `TENANT#${A}`, tenant_id: A }),
      row({ pk: `USER#${SUB.b1}`, sk: `TENANT#${B}`, tenant_id: B }),
    ],
  };
}

/** The pool: both HR people, the employees with a sign-in. hrA has no Member row in some tests (legacy). */
export function pool(): { users: PoolUser[] } {
  const u = (name: string, sub: string, groups: string[], extra: Record<string, string> = {}): PoolUser => ({
    username: name, sub, status: 'CONFIRMED', attributes: { email: name, email_verified: 'true', ...extra }, groups,
  });
  return {
    users: [
      u(MAIL.hrA, SUB.hrA, ['hr_staff', 'e2e-robots'], { 'custom:staff_id': STAFF.hrA }),
      u(MAIL.hrB, SUB.hrB, ['hr_staff', 'e2e-robots'], { 'custom:staff_id': STAFF.hrB }),
      u(MAIL.a1, SUB.a1, ['employee']),
      u(MAIL.b1, SUB.b1, ['employee']),
      u(MAIL.legacy, SUB.legacy, ['employee']),
    ],
  };
}

export type Caller = 'hrA' | 'hrB' | 'empA' | 'empB' | 'agentA' | 'noTenant' | 'noTenantEmp';

/** The authorizer a caller arrives with. HR of A and B, the employee of A (John Doe), the agent key of A. */
export function authorizerOf(caller: Caller): unknown {
  const hr = (sub: string, email: string, staff: string, tenant: string) =>
    jwtAuthorizer({ sub, email, email_verified: 'true', 'cognito:groups': '[hr_staff e2e-robots]', 'custom:staff_id': staff, tenant_id: tenant });
  if (caller === 'hrA') return hr(SUB.hrA, MAIL.hrA, STAFF.hrA, A);
  if (caller === 'hrB') return hr(SUB.hrB, MAIL.hrB, STAFF.hrB, B);
  if (caller === 'empA') return jwtAuthorizer({ sub: SUB.a1, email: MAIL.a1, email_verified: 'true', 'cognito:groups': '[employee]', 'custom:employee_id': EMP.a1, tenant_id: A });
  if (caller === 'empB') return jwtAuthorizer({ sub: SUB.b1, email: MAIL.b1, email_verified: 'true', 'cognito:groups': '[employee]', 'custom:employee_id': EMP.b1, tenant_id: B });
  if (caller === 'agentA') return { lambda: { actor: 'AGENT', tenant_id: A } };
  if (caller === 'noTenantEmp') return jwtAuthorizer({ sub: SUB.a1, email: MAIL.a1, email_verified: 'true', 'cognito:groups': '[employee]', 'custom:employee_id': EMP.a1 });
  return jwtAuthorizer({ sub: SUB.hrA, email: MAIL.hrA, email_verified: 'true', 'cognito:groups': '[hr_staff e2e-robots]', 'custom:staff_id': STAFF.hrA });
}

/** Settings every run gets: the legacy rule (on by default, = A), the pool, the agent company, the tables. */
export function settings(opts: { legacy?: boolean; extra?: Record<string, string> } = {}): Record<string, string> {
  return {
    LEGACY_TENANT_ID: opts.legacy === false ? '' : A,
    AGENT_TENANT_ID: A,
    COGNITO_POOL_ID: POOL,
    TENANTS_TABLE: TENANTS,
    AGENT_API_BASE_URL: 'https://agent.ten02.example',
    UPLOAD_BUCKET: 'ten02-uploads',
    DOCUMENTS_BUCKET: 'ten02-uploads',
    S3_BUCKET: 'ten02-uploads',
    BUCKET_NAME: 'ten02-uploads',
    EVENT_BUS_NAME: 'ten02-bus',
    KMS_KEY_ID: 'alias/ten02',
    POSTMARK_SERVER_TOKEN: 'ten02-fake-token',
    POSTMARK_API_TOKEN: 'ten02-fake-token',
    KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/ten02',
    AUDIT_TABLE: 'onboarding-events',
    RATE_LIMIT_TABLE: 'NalekoAiRateLimit',
    POSTMARK_FROM: 'no-reply@ten02.example',
    APP_BASE_URL: 'https://app.ten02.example',
    APP_URL: 'https://app.ten02.example',
    LOGIN_URL: 'https://app.ten02.example/login',
    POSTMARK_SENDER_EMAIL: 'no-reply@ten02.example',
    COMPANY_NAME: 'Company A',
    ENVIRONMENT: 'dev',
    EMPLOYEES_TABLE: 'employees',
    DOCUMENTS_TABLE: 'documents',
    VERIFICATIONS_TABLE: 'document-verification',
    VERIFICATION_TABLE: 'document-verification',
    INVITES_TABLE: 'employee_invites',
    IDEMPOTENCY_TABLE: 'naleko-idempotency-keys',
    EXTERNAL_REQUESTS_TABLE: 'external-verification-requests',
    PENDING_ACTIONS_TABLE: 'naleko-pending-actions',
    AGENT_AUDIT_TABLE: 'naleko-agent-audit',
    ...(opts.extra ?? {}),
  };
}

export const handlerOf = (name: string) => join(LAMBDA, name, 'index.mjs');

export type Ask = { method?: string; path?: Record<string, string>; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> };

/** Runs one route as a caller against the seeded world (or the given one). */
export function ask(handler: string, caller: Caller, a: Ask = {}, opts: { tables?: Tables; legacy?: boolean; env?: Record<string, string>; cognito?: { users: PoolUser[] }; flipOnUpdate?: { table: string; set: Row } } = {}) {
  const event = httpEvent({ authorizer: authorizerOf(caller), path: a.path, query: a.query, body: a.body, headers: a.headers });
  if (a.method) event.requestContext.http.method = a.method;
  return runHandler(handlerOf(handler), event, {
    tables: opts.tables ?? tables(),
    cognito: opts.cognito ?? pool(),
    secrets: { [AGENT_SECRET]: { AWSCURRENT: 'ten02-agent-key' } },
    env: settings({ legacy: opts.legacy, extra: opts.env }),
    ...(opts.flipOnUpdate ? { flipOnUpdate: opts.flipOnUpdate } : {}),
  });
}

/** A response body, parsed. */
export const bodyOf = (r: { response: any }) => {
  try { return JSON.parse(r.response?.body ?? 'null'); } catch { return r.response?.body; }
};

/** Plain values of a stored row. */
export function plain(r: Row | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r ?? {})) out[k] = 'S' in v ? v['S'] : 'N' in v ? Number(v['N']) : 'BOOL' in v ? v['BOOL'] : v;
  return out;
}
