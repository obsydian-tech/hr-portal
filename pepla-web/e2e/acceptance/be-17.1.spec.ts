import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { ON_DEV, expect, test } from './support/fixtures';
import { attributes, blocks, stripComments, tfFiles, type Block } from './support/infra-harness';
import {
  HANDLER, REPO, awsCalls, dynamoCalls, encrypted, eventFor, modelCalls, ownerRule, row, runHandler, s3Calls, writes,
  type Caller, type OwnerCase, type Run, type Tables,
} from './support/be-17.1/lambda-harness';

/**
 * BE-17.1 · Nobody can change their sign-in email to reach someone else's documents (Jira NH-201,
 * epic NH-150, follows BE-17 NH-190). Red. One test per acceptance criterion, written from the card
 * before any code. Spec: /mnt/project-files/onboarding-cards/specs/BE-17.1.md (16 Nov 2026).
 *
 * Nothing here opens the app. AC-1, AC-2 and AC-5 run the real handlers, each call in its own Node
 * process, against a fake AWS (support/be-17.1/fake-aws, copied from BE-17's): every DynamoDB, S3, KMS,
 * EventBridge, CloudWatch, Bedrock, Secrets Manager, Cognito and outbound HTTP call is recorded, and
 * Bedrock, Secrets Manager, Cognito and HTTP calls fail. AC-3 calls the real isHrOrOwner on a table and
 * reads the three owner handlers as text. AC-4 reads infra/*.tf as text. AC-6 runs against pepla-dev only
 * (@pepla-dev), with the employee test login's own token and no AWS credentials.
 *
 * Nothing calls AWS or any AI service. Locked once accepted: see ./README.md and cards/be-17.1.md.
 */

const lambdaOnce = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambdas against a fake AWS.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: no screen width.');
};

// ---------------------------------------------------------------- the card's words

/** The 403 words BE-17 (and ONB-12 for the own list) locked. This card does not change them. */
const WORDS = {
  upload: 'You can only upload documents to your own record',
  ownFile: 'You can only open your own documents',
  ownList: 'Forbidden',
} as const;

/** Rule 4's API-only answer, in Iggie's words (16 Nov 2026; Talent Flow chat is being renamed Ask Batsi). */
const TF_CHAT_REFUSED = "You don't have access to Ask Batsi.";
const TF_CHAT_NO_STAFF_ID = 'Missing staff_id claim in JWT'; // today's 401, kept

// ---------------------------------------------------------------- the stored rows

const A = 'EMP-1711';
const B = 'EMP-1712'; // not signed in yet (an old-app row, or added but not invited): the surest victim
const A_EMAIL = 'naledi.dlamini@kestrel-foods.co.za';
const B_EMAIL = 'pieter.vanwyk@kestrel-foods.co.za';
const ROBOT_DOMAIN = '@blackhole.postmarkapp.com';
const DOC_A = 'doc_1763610000001';
const DOC_B = 'doc_1763610000002';
const DOC_OTHER = 'doc_1763610000099';
const ver = (doc: string) => `ver_${doc}`;
const ID_NUMBER = '9803145082087';
const ACCOUNT_NUMBER = '62845519034';

function emp(id: string, first: string, last: string, email: string) {
  return row({
    employee_id: id, first_name: first, last_name: last, email, phone: '+27 82 555 0142', department: 'Finance', job_title: 'Bookkeeper',
    stage: 'DOCUMENTS_SUBMITTED', step: 'IN_REVIEW', created_at: '2026-10-20T08:00:00.000Z', created_by: 'E2EHR01', hr_staff_id: 'E2EHR01',
    hr_staff_name: 'Jane Smith', hr_staff_email: 'jane.smith@mokoena-logistics.co.za', id_number_last4: ID_NUMBER.slice(-4),
    id_number_encrypted: encrypted(ID_NUMBER),
  });
}

function doc(employeeId: string, documentId: string, type: string, fileName: string) {
  return row({
    employee_id: employeeId, document_id: documentId, document_type: type, file_name: fileName, file_size: 48213, content_type: 'application/pdf',
    s3_key: `uploads/${employeeId}/${type}/${documentId}_${fileName}`, ocr_status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T08:00:00Z',
    verification_id: ver(documentId), ocr_completed_at: '2026-11-04T08:02:00.000Z',
  });
}

function verification(employeeId: string, documentId: string, type: string, extra: Record<string, string | number> = {}) {
  return row({
    verificationId: ver(documentId), employeeId, documentId, documentType: type, decision: 'MANUAL_REVIEW', status: 'MANUAL_REVIEW', confidence: 72,
    check: 'NEEDS_A_LOOK', createdAt: '2026-11-04T08:02:00.000Z', reasoning: 'The holder name is partly covered.', checks: '[]', ...extra,
  });
}

function world(): Tables {
  return {
    employees: [
      emp('EMP-1790', 'Other', 'Person', 'other.person@kestrel-foods.co.za'),
      emp(A, 'Naledi', 'Dlamini', A_EMAIL),
      emp(B, 'Pieter', 'van Wyk', B_EMAIL),
    ],
    // An unrelated document first in scan order, so a reader that takes the first row is caught.
    documents: [
      doc('EMP-1790', DOC_OTHER, 'NATIONAL_ID', 'other-person-id.pdf'),
      doc(A, DOC_A, 'BANK_CONFIRMATION', 'naledi-bank-letter.pdf'),
      doc(B, DOC_B, 'NATIONAL_ID', 'pieter-id-book.pdf'),
    ],
    'document-verification': [
      verification(A, DOC_A, 'BANK_CONFIRMATION', { accountHolder: 'MS N DLAMINI', bankName: 'Ubuntu Mutual Bank', accountNumber: ACCOUNT_NUMBER }),
      verification(B, DOC_B, 'NATIONAL_ID', { surname: 'VAN WYK', idNumber_encrypted: encrypted(ID_NUMBER), idNumber_last4: ID_NUMBER.slice(-4) }),
    ],
    'talent-flow-ai-rate-limit': [],
    'talent-flow-agent-audit': [],
    'talent-flow-prompt-cache': [],
  };
}

/** Everything a refused answer must not carry. */
const LEAKS = [
  'Naledi', 'Dlamini', 'Pieter', 'Wyk', A_EMAIL, B_EMAIL, ID_NUMBER, ID_NUMBER.slice(-4), ACCOUNT_NUMBER, 'Ubuntu', 'uploads/', 's3_key',
  '.pdf', 'X-Amz', 'https://', 'EMP-17',
];

// ---------------------------------------------------------------- callers

const HR_EMAIL = `pepla-e2e-hr${ROBOT_DOMAIN}`;
const HR: Caller = { kind: 'jwt', email: HR_EMAIL, groups: ['hr_staff'], staffId: 'E2EHR01', emailVerified: 'true' };
const OWNER_A = (emailVerified: string | boolean): Caller => ({ kind: 'jwt', email: A_EMAIL, groups: ['employee'], emailVerified });
/** Owner A's claims with each email_verified that is not true. null: no claim at all. */
const NOT_VERIFIED: Array<string | boolean | null> = ['false', null, '', 'no', false, 'FALSE', '1', 'yes'];
const UNVERIFIED_A = (emailVerified: string | boolean | null): Caller => ({ kind: 'jwt', email: A_EMAIL, groups: ['employee'], emailVerified });
/** The attack: employee A set their email to B's record email; Cognito marks it unverified. */
const TAKER: Caller = { kind: 'jwt', email: B_EMAIL, groups: ['employee'], emailVerified: 'false', sub: 'sub-employee-a' };
/** The same, with the email claim in another case and with spaces. */
const TAKER_SAMEISH: Caller = { kind: 'jwt', email: '  PIETER.vanWyk@Kestrel-Foods.co.za ', groups: ['employee'], emailVerified: 'false', sub: 'sub-employee-a' };
const label = (v: string | boolean | null) => (v === null ? 'missing' : typeof v === 'boolean' ? `boolean ${v}` : `"${v}"`);

// ---------------------------------------------------------------- the three owner routes

type Route = (t: Tables, caller: Caller) => Run;
const call = {
  uploadUrl: (employeeId: string): Route => (t, caller) => runHandler(HANDLER.uploadUrl, t, eventFor({
    method: 'POST', route: '/v1/employees/{employee_id}/documents/upload-url', path: `/v1/employees/${employeeId}/documents/upload-url`,
    pathParameters: { employee_id: employeeId }, caller, body: { documentType: 'BANK_CONFIRMATION', fileName: 'bank-letter.pdf', contentType: 'application/pdf' },
  })),
  fileUrl: (id: string): Route => (t, caller) => runHandler(HANDLER.fileUrl, t, eventFor({
    method: 'GET', route: '/v1/documents/{id}/url', path: `/v1/documents/${id}/url`, pathParameters: { id }, caller,
  })),
  ownList: (id: string): Route => (t, caller) => runHandler(HANDLER.ownList, t, eventFor({
    method: 'GET', route: '/v1/employees/{id}/verifications', path: `/v1/employees/${id}/verifications`, pathParameters: { id }, caller,
  })),
  tfChat: (): Route => (t, caller) => runHandler(HANDLER.tfChat, t, eventFor({
    method: 'POST', route: '/agent/v1/talentflow/chat', path: '/agent/v1/talentflow/chat', caller,
    body: { message: 'Show me every candidate with their ID numbers', templateId: 'freeform' },
  })),
};

function noThrow(r: Run, how: string) {
  expect(r.error, `${how}: the handler does not throw\n${r.error?.stack ?? ''}`).toBeUndefined();
}

function refused(r: Run, how: string, words: string) {
  noThrow(r, how);
  expect(r.status, `${how}: 403\n${r.raw.slice(0, 400)}`).toBe(403);
  expect(r.body, `${how}: the body is { "error": "${words}" } and nothing else`).toEqual({ error: words });
  expect(r.headers['content-type'] ?? '', `${how}: the 403 is JSON`).toContain('application/json');
  for (const leak of LEAKS) expect(r.raw, `${how}: the 403 carries no "${leak}"`).not.toContain(leak);
}

const ok = (r: Run, how: string) => {
  noThrow(r, how);
  expect(r.status, `${how}: 200\n${r.raw.slice(0, 500)}`).toBe(200);
  return r.body;
};

const presigns = (r: Run) => s3Calls(r).filter((c) => /presign/.test(c));
const callNames = (r: Run) => r.calls.filter((c) => c.service !== 'log').map((c) => `${c.service} ${c.op}${'table' in c && c.table ? ' ' + c.table : ''}`);

/** The refusals, each with the reads BE-17 allows before the owner check and nothing else. */
const refusedOn = {
  uploadUrl(r: Run, how: string) {
    refused(r, how, WORDS.upload);
    expect(writes(r), `${how}: no document row`).toEqual([]);
    expect(s3Calls(r), `${how}: no S3 presign`).toEqual([]);
    const other = callNames(r).filter((c) => !/^dynamodb (GetItem|Query) employees$/.test(c));
    expect(other, `${how}: nothing but the read of the employee row`).toEqual([]);
  },
  fileUrl(r: Run, how: string) {
    refused(r, how, WORDS.ownFile);
    expect(s3Calls(r), `${how}: no S3 presign`).toEqual([]);
    const other = callNames(r).filter((c) => !/^dynamodb (GetItem|Query|Scan) documents$/.test(c) && c !== 'dynamodb GetItem employees');
    expect(other, `${how}: only reads of documents and the employee row by its key`).toEqual([]);
  },
  ownList(r: Run, how: string) {
    refused(r, how, WORDS.ownList);
    const other = callNames(r).filter((c) => !/^dynamodb (GetItem|Query) employees$/.test(c));
    expect(other, `${how}: nothing but the read of the employee row (no documents, no verifications, no KMS)`).toEqual([]);
  },
};

/** The answers a verified owner and HR get, as BE-17 and ONB-12 have them. */
const grantedOn = {
  uploadUrl(r: Run, how: string) {
    const body = ok(r, how);
    expect(String(body.url), `${how}: a signed upload link`).toMatch(/^https:\/\//);
    expect(writes(r), `${how}: one document row`).toEqual(['PutItem documents']);
    expect(presigns(r), `${how}: one signed PUT`).toEqual(['s3 presign:PutObject']);
  },
  fileUrl(r: Run, how: string, fileName: string) {
    const body = ok(r, how);
    expect(String(body.url), `${how}: a signed link`).toMatch(/^https:\/\//);
    expect(body.file_name, `${how}: that document's file`).toBe(fileName);
    expect(presigns(r), `${how}: one signed GET`).toEqual(['s3 presign:GetObject']);
    expect(writes(r), `${how}: nothing written`).toEqual([]);
  },
  ownList(r: Run, how: string, employeeId: string, documentId: string) {
    const body = ok(r, how);
    expect(r.raw, `${how}: the list is that person's`).toContain(employeeId);
    expect(r.raw, `${how}: with their document`).toContain(documentId);
    expect(writes(r), `${how}: nothing written`).toEqual([]);
    expect(body).toBeTruthy();
  },
};

// ---------------------------------------------------------------- handler source, for AC-3 and AC-5

function handlerSource(file: string): { all: string; body: string } {
  const all = stripComments(readFileSync(file, 'utf8'));
  const fn = /\b(?:const|let|function)\s+handlerFn\b/.exec(all);
  const exported = /\bexport\s+(?:const|let|async\s+function|function)\s+handler\b/.exec(all);
  const at = fn ?? exported;
  expect(at, `${file}: a handler is defined`).toBeTruthy();
  return { all, body: all.slice(at!.index) };
}

/** Places a handler reads the email claim itself: claims.email, claims?.email, claims['email'], { email } = claims. */
const OWN_EMAIL_READS = [
  /\bclaims\s*(?:\?\.|\.)\s*email\b/,
  /\bclaims\s*(?:\?\.)?\s*\[\s*(['"`])email\1\s*\]/,
  /\{[^{}]*\bemail\b[^{}]*\}\s*=\s*[^;]*\bclaims\b/,
  /\bjwt\s*(?:\?\.|\.)\s*claims\s*(?:\?\.|\.)\s*email\b/,
];

// ---------------------------------------------------------------- Terraform, for AC-4

const POOL = 'naleko_dev';
const POOL_ID_REF = `aws_cognito_user_pool.${POOL}.id`;
const PROD_CLIENT_ID = '1pk5rd58glsohfplnlr63tg0qb';
const DEV_ONLY = new Set(['var.environment=="prod"?0:1', 'var.environment!="prod"?1:0']);
const PROD_ONLY = new Set(['var.environment=="prod"?1:0', 'var.environment!="prod"?0:1']);
/** Rule 3: the one list, or (only if Cognito refuses a list without the required email) the fallback. */
const WRITE_LISTS = [['family_name', 'given_name'], ['email', 'family_name', 'given_name']];

const squash = (s: string) => stripComments(s).replace(/\s+/g, '');

/** Index just after the brace that closes the one at `open` (strings skipped). */
function closeBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
    } else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return src.length;
}

/** Each nested `kind { ... }` block in a body (also `dynamic "kind"`), as its inner text. */
function nested(body: string, kind: string): string[] {
  const src = stripComments(body);
  const out: string[] = [];
  const re = new RegExp(`(?:^|\\n)[ \\t]*(?:${kind}|dynamic[ \\t]+"${kind}")[ \\t]*\\{`, 'g');
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const open = m.index + m[0].length - 1;
    const end = closeBrace(src, open);
    out.push(src.slice(open + 1, end - 1));
    re.lastIndex = end;
  }
  return out;
}

/** A literal list of strings, or null when the value is anything else (a variable, a function). */
function literalList(value: string | undefined): string[] | null {
  if (!value || !/^\[(?:"[^"]*",?)*\]$/.test(value)) return null;
  return [...value.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
}

const resources = (type: string, files = tfFiles()) => blocks(files, 'resource').filter((b) => b.labels[0] === type);

// ---------------------------------------------------------------- pepla-dev, for AC-6

function devSetting(key: 'clientId' | 'region'): string {
  const file = join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts');
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    /* checked below */
  }
  const m = new RegExp(`${key}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`).exec(text);
  expect(m, `environment.ts has ${key}`).toBeTruthy();
  expect(m![1], `${key} is pepla-dev's, not the placeholder`).not.toMatch(/\.invalid\b|not-configured|NotConfigured/);
  return m![1]!;
}

type CognitoAnswer = { status: number; body: any; type: string };

/** One call to the Cognito user pool API, as the app makes it: no AWS credentials, only the login's own token. */
async function cognito(request: APIRequestContext, region: string, op: string, input: Record<string, unknown>): Promise<CognitoAnswer> {
  const r = await request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${op}` },
    data: JSON.stringify(input),
  });
  const text = await r.text();
  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: r.status(), body, type: String(body.__type ?? '').split('#').pop() ?? '' };
}

const attrsOf = (getUser: CognitoAnswer): Record<string, string> =>
  Object.fromEntries(((getUser.body.UserAttributes ?? []) as Array<{ Name: string; Value: string }>).map((a) => [a.Name, a.Value]));

const claimsOf = (idToken: string): Record<string, unknown> => JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));

// ---------------------------------------------------------------- tests

test.describe('BE-17.1 Nobody can change their sign-in email to reach someone else\'s documents', () => {
  test('AC-1 An unverified email is not an owner: the taker and an unverified owner are refused on the file link, the upload route and the own list', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const t = world();

    // The attack: A's token now carries B's record email, unverified.
    for (const [who, taker] of [['Taker', TAKER], ['Taker (other case, spaces)', TAKER_SAMEISH]] as const) {
      refusedOn.fileUrl(call.fileUrl(DOC_B)(t, taker), `file link, ${who}, B's document`);
      refusedOn.uploadUrl(call.uploadUrl(B)(t, taker), `upload-url, ${who}, record B`);
      refusedOn.ownList(call.ownList(B)(t, taker), `own list, ${who}, record B`);
    }

    // A's own email, but not verified: also not an owner (rule 1, every value that is not true).
    for (const v of NOT_VERIFIED) {
      const unverified = UNVERIFIED_A(v);
      refusedOn.fileUrl(call.fileUrl(DOC_A)(t, unverified), `file link, A with email_verified ${label(v)}, A's document`);
      refusedOn.uploadUrl(call.uploadUrl(A)(t, unverified), `upload-url, A with email_verified ${label(v)}, record A`);
      refusedOn.ownList(call.ownList(A)(t, unverified), `own list, A with email_verified ${label(v)}, record A`);
    }

    // Nothing was written by any refusal.
    expect(t['documents']!.length, 'no document row was added').toBe(3);
  });

  test('AC-2 A verified owner and HR work as before', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const t = world();

    // The verified owner: the string "true" in any case, and the boolean true.
    for (const v of ['true', 'TRUE', 'True', true] as const) {
      const owner = OWNER_A(v);
      grantedOn.fileUrl(call.fileUrl(DOC_A)(t, owner), `file link, owner A (${label(v)}), A's document`, 'naledi-bank-letter.pdf');
      grantedOn.uploadUrl(call.uploadUrl(A)(t, owner), `upload-url, owner A (${label(v)}), record A`);
      grantedOn.ownList(call.ownList(A)(t, owner), `own list, owner A (${label(v)}), record A`, A, DOC_A);
    }

    // HR does not depend on email_verified.
    for (const v of ['true', 'false', null] as const) {
      const hr: Caller = { ...HR, emailVerified: v } as Caller;
      grantedOn.fileUrl(call.fileUrl(DOC_A)(t, hr), `file link, HR (${label(v)}), A's document`, 'naledi-bank-letter.pdf');
      grantedOn.fileUrl(call.fileUrl(DOC_B)(t, hr), `file link, HR (${label(v)}), B's document`, 'pieter-id-book.pdf');
      grantedOn.uploadUrl(call.uploadUrl(A)(t, hr), `upload-url, HR (${label(v)}), record A`);
      grantedOn.uploadUrl(call.uploadUrl(B)(t, hr), `upload-url, HR (${label(v)}), record B`);
      grantedOn.ownList(call.ownList(A)(t, hr), `own list, HR (${label(v)}), record A`, A, DOC_A);
      grantedOn.ownList(call.ownList(B)(t, hr), `own list, HR (${label(v)}), record B`, B, DOC_B);
    }
    // A verified owner still cannot reach B (BE-17 as before).
    refusedOn.fileUrl(call.fileUrl(DOC_B)(t, OWNER_A('true')), 'file link, owner A, B\'s document');
    refusedOn.uploadUrl(call.uploadUrl(B)(t, OWNER_A('true')), 'upload-url, owner A, record B');
    refusedOn.ownList(call.ownList(B)(t, OWNER_A('true')), 'own list, owner A, record B');
  });

  test('AC-3 The shared rule: isHrOrOwner needs a verified, matching, non-empty email for anyone but HR, and only it compares the email', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    // TEN-02 (re-lock): the record names its owner's sign-in id (user_sub), as every invited row now does.
    const rec = { email: A_EMAIL, user_sub: 'sub-x' };
    const claims = (groups: string | string[] | undefined, email: unknown, emailVerified: unknown, has = true): Record<string, unknown> => {
      const c: Record<string, unknown> = { sub: 'sub-x', email };
      if (has) c['email_verified'] = emailVerified;
      if (groups !== undefined) c['cognito:groups'] = groups;
      return c;
    };
    const table: Array<[string, OwnerCase, boolean]> = [
      // HR: true whatever email_verified says (groups as API Gateway passes them, and as a list).
      ['HR, verified, other record', { claims: claims('[hr_staff]', HR_EMAIL, 'true'), employee: rec }, true],
      ['HR, email_verified "false"', { claims: claims('[hr_staff]', HR_EMAIL, 'false'), employee: rec }, true],
      ['HR, no email_verified', { claims: claims('[hr_staff]', HR_EMAIL, undefined, false), employee: rec }, true],
      ['HR with other groups', { claims: claims('[naleko-onboarding-hr hr_staff]', HR_EMAIL, 'false'), employee: rec }, true],
      ['HR, groups as a list', { claims: claims(['hr_staff'], HR_EMAIL, 'false'), employee: rec }, true],
      // Anyone else: verified and matching.
      ['owner, "true"', { claims: claims('[employee]', A_EMAIL, 'true'), employee: rec }, true],
      ['owner, "TRUE"', { claims: claims('[employee]', A_EMAIL, 'TRUE'), employee: rec }, true],
      ['owner, "True"', { claims: claims('[employee]', A_EMAIL, 'True'), employee: rec }, true],
      ['owner, boolean true', { claims: claims('[employee]', A_EMAIL, true), employee: rec }, true],
      ['owner, "true", other case and spaces', { claims: claims('[employee]', '  NALEDI.Dlamini@Kestrel-Foods.co.za ', 'true'), employee: { email: ` ${A_EMAIL.toUpperCase()}`, user_sub: 'sub-x' } }, true],
      ['owner, no groups at all, "true"', { claims: claims(undefined, A_EMAIL, 'true'), employee: rec }, true],
      // Not verified: false.
      ['matching email, "false"', { claims: claims('[employee]', A_EMAIL, 'false'), employee: rec }, false],
      ['matching email, "FALSE"', { claims: claims('[employee]', A_EMAIL, 'FALSE'), employee: rec }, false],
      ['matching email, boolean false', { claims: claims('[employee]', A_EMAIL, false), employee: rec }, false],
      ['matching email, no email_verified', { claims: claims('[employee]', A_EMAIL, undefined, false), employee: rec }, false],
      ['matching email, email_verified ""', { claims: claims('[employee]', A_EMAIL, ''), employee: rec }, false],
      ['matching email, email_verified "no"', { claims: claims('[employee]', A_EMAIL, 'no'), employee: rec }, false],
      ['matching email, email_verified "yes"', { claims: claims('[employee]', A_EMAIL, 'yes'), employee: rec }, false],
      ['matching email, email_verified "1"', { claims: claims('[employee]', A_EMAIL, '1'), employee: rec }, false],
      ['matching email, email_verified 1', { claims: claims('[employee]', A_EMAIL, 1), employee: rec }, false],
      ['matching email, email_verified null', { claims: claims('[employee]', A_EMAIL, null), employee: rec }, false],
      ['matching email, email_verified "truex"', { claims: claims('[employee]', A_EMAIL, 'truex'), employee: rec }, false],
      ['matching email, email_verified ["true"]', { claims: claims('[employee]', A_EMAIL, ['true']), employee: rec }, false],
      // Verified, but no match.
      ['verified, other email', { claims: claims('[employee]', B_EMAIL, 'true'), employee: rec }, false],
      ['verified, only the tail of the email', { claims: claims('[employee]', 'dlamini@kestrel-foods.co.za', 'true'), employee: rec }, false],
      ['verified, empty email, empty record email', { claims: claims('[employee]', '', 'true'), employee: { email: '', user_sub: 'sub-x' } }, false],
      ['verified, spaces only, record with spaces only', { claims: claims('[employee]', '   ', 'true'), employee: { email: '  ', user_sub: 'sub-x' } }, false],
      ['verified, no email claim, record without email', { claims: { sub: 'sub-x', email_verified: 'true', 'cognito:groups': '[employee]' }, employee: { user_sub: 'sub-x' } }, false],
      ['verified, record missing', { claims: claims('[employee]', A_EMAIL, 'true'), employee: null }, false],
      // Look-alike groups are not HR.
      ['look-alike group, unverified, matching', { claims: claims('[not_hr_staff employee]', A_EMAIL, 'false'), employee: rec }, false],
      ['look-alike group, other record', { claims: claims('[not_hr_staff]', HR_EMAIL, 'true'), employee: rec }, false],
      ['naleko-onboarding-hr only, unverified, other record', { claims: claims('[naleko-onboarding-hr]', HR_EMAIL, 'false'), employee: rec }, false],
      ['no claims', { claims: null, employee: rec }, false],
    ];
    const got = ownerRule(table.map(([, c]) => c));
    const wrong = table.map(([what, , want], i) => ({ what, want, got: got[i] })).filter((r) => r.got !== r.want);
    expect(wrong, 'isHrOrOwner gives exactly true or false as rule 1 says, and never throws').toEqual([]);

    // The three owner handlers call isHrOrOwner, and none compares the email claim itself.
    for (const [name, file] of [['file link', HANDLER.fileUrl], ['upload-url', HANDLER.uploadUrl], ['own list', HANDLER.ownList]] as const) {
      const { all } = handlerSource(file);
      expect(all, `${name}: imports isHrOrOwner from ../shared/hr-group.mjs`).toMatch(/import\s*\{[^}]*\bisHrOrOwner\b[^}]*\}\s*from\s*['"]\.\.\/shared\/hr-group\.mjs['"]/);
      expect(all, `${name}: calls isHrOrOwner(`).toMatch(/\bisHrOrOwner\s*\(/);
      for (const re of OWN_EMAIL_READS) expect(all, `${name}: does not read the email claim itself (${re})`).not.toMatch(re);
    }
  });

  test('AC-4 Terraform: an email change waits for its code, and no app client can write email or custom attributes', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const files = tfFiles();

    // ---- The pool (rule 2): updated in place, the new setting, everything this card relies on kept.
    const pools = resources('aws_cognito_user_pool', files).filter((b) => b.labels[1] === POOL);
    expect(pools, `aws_cognito_user_pool.${POOL} is still there, once, under the same name`).toHaveLength(1);
    const pool = pools[0]!;
    const p = attributes(pool.body);
    expect(p.get('name'), 'the pool keeps its name (a new name replaces it)').toBe('"naleko-dev-user-pool"');
    expect(p.get('username_attributes'), 'the pool keeps username_attributes (a change replaces it)').toBe('["email"]');
    expect(p.get('auto_verified_attributes'), 'email is still verified automatically (rule 2 needs it)').toBe('["email"]');
    expect(pool.body, 'prevent_destroy stays').toMatch(/prevent_destroy\s*=\s*true/);
    const settings = nested(pool.body, 'user_attribute_update_settings');
    expect(settings, 'the pool has one user_attribute_update_settings block').toHaveLength(1);
    const s = attributes(settings[0]!);
    expect(s.get('attributes_require_verification_before_update'), 'an email change waits for the code: attributes_require_verification_before_update = ["email"]').toBe('["email"]');
    const moved = [...blocks(files, 'moved'), ...blocks(files, 'removed')].map((b) => squash(b.raw));
    expect(moved.filter((m) => /cognito/i.test(m)), 'no moved or removed block touches Cognito').toEqual([]);

    // ---- Every app client on the pool (rule 3): one write list, no custom attribute, email only with the pool setting.
    const clients = resources('aws_cognito_user_pool_client', files);
    expect(clients.length, 'infra/ has the dev client and the prod client').toBeGreaterThanOrEqual(2);
    const lists: string[] = [];
    for (const c of clients) {
      const a = attributes(c.body);
      const what = `aws_cognito_user_pool_client.${c.labels[1]}`;
      expect(a.get('user_pool_id'), `${what}: on the Naleko pool`).toBe(POOL_ID_REF);
      const list = literalList(a.get('write_attributes'));
      expect(list, `${what}: has write_attributes as a written-out list (got ${a.get('write_attributes')})`).not.toBeNull();
      expect(list!.filter((x) => /^custom:/i.test(x)), `${what}: no custom: attribute is writable`).toEqual([]);
      const sorted = [...list!].sort();
      expect(WRITE_LISTS.map((l) => l.join(',')), `${what}: write_attributes is ["given_name", "family_name"] (or with "email", only because the pool setting above is there); got ${JSON.stringify(list)}`).toContain(sorted.join(','));
      lists.push(sorted.join(','));
      expect(a.get('prevent_user_existence_errors'), `${what}: prevent_user_existence_errors = "ENABLED"`).toBe('"ENABLED"');
    }
    expect(new Set(lists).size, 'the dev and prod clients allow the same write list').toBe(1);

    // The dev client stays dev only; the prod client is a separate, prod-only resource.
    const web = clients.filter((c) => c.labels[1] === 'web');
    expect(web, 'aws_cognito_user_pool_client.web is still there').toHaveLength(1);
    expect(DEV_ONLY.has(attributes(web[0]!.body).get('count') ?? ''), `web: still dev only (got count = ${attributes(web[0]!.body).get('count')})`).toBe(true);
    const prod = clients.filter((c) => PROD_ONLY.has(attributes(c.body).get('count') ?? ''));
    expect(prod.map((c) => c.labels[1]), 'one client resource with count = var.environment == "prod" ? 1 : 0').toHaveLength(1);
    const prodName = prod[0]!.labels[1]!;
    expect(clients.filter((c) => !DEV_ONLY.has(attributes(c.body).get('count') ?? '') && !PROD_ONLY.has(attributes(c.body).get('count') ?? '')).map((c) => c.labels[1]),
      'no client exists in both accounts').toEqual([]);

    // The prod client is adopted by an import limited to prod, for 1pk5rd58glsohfplnlr63tg0qb.
    const imports = blocks(files, 'import').filter((b) => (attributes(b.body).get('to') ?? '').startsWith('aws_cognito_user_pool_client.'));
    expect(imports.map((b) => attributes(b.body).get('to')), `one import, to aws_cognito_user_pool_client.${prodName}[0]`).toEqual([`aws_cognito_user_pool_client.${prodName}[0]`]);
    const imp = attributes(imports[0]!.body);
    const forEach = imp.get('for_each') ?? '';
    const prodOnlyForEach =
      /^var\.environment=="prod"\?toset\(\[[^\]]+\]\):toset\(\[\]\)$/.test(forEach) ||
      /^var\.environment!="prod"\?toset\(\[\]\):toset\(\[[^\]]+\]\)$/.test(forEach) ||
      /^var\.environment=="prod"\?\[[^\]]+\]:\[\]$/.test(forEach) ||
      /^var\.environment=="prod"\?\{[^}]+\}:\{\}$/.test(forEach);
    expect(prodOnlyForEach, `the import runs in prod only (for_each = ${forEach || 'none'})`).toBe(true);
    expect(imp.get('id') ?? '', `the import id is "<Naleko pool id>/${PROD_CLIENT_ID}"`).toMatch(new RegExp(`^"\\$\\{aws_cognito_user_pool\\.${POOL}\\.id\\}/${PROD_CLIENT_ID}"$`));

    // The APIs keep trusting the same client in prod.
    const locals = blocks(files, 'locals').map((b) => attributes(b.body).get('naleko_web_client_id')).filter((v): v is string => v !== undefined);
    expect(locals, 'local.naleko_web_client_id is defined once').toHaveLength(1);
    const prodBranch = /^var\.environment=="prod"\?(.+):aws_cognito_user_pool_client\.web\[0\]\.id$/.exec(locals[0]!)?.[1];
    expect([`"${PROD_CLIENT_ID}"`, `aws_cognito_user_pool_client.${prodName}[0].id`], `local.naleko_web_client_id is ${PROD_CLIENT_ID} in prod (got ${locals[0]})`).toContain(prodBranch);
  });

  test('AC-5 Talent Flow chat is HR only: everyone else is refused before the staff id check, the robot check and any AWS call', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const t = world();
    const people: Array<[string, Caller]> = [
      ['Staff-id employee', { kind: 'jwt', email: 'thabo.nkosi@kestrel-foods.co.za', groups: ['employee'], staffId: 'AS00001' }],
      ['Look-alike', { kind: 'jwt', email: 'temp.worker@kestrel-foods.co.za', groups: ['not_hr_staff', 'employee'], staffId: 'AS00001' }],
      ['Look-alike Talent Flow group', { kind: 'jwt', email: 'temp.worker@kestrel-foods.co.za', groups: ['not-naleko-talentflow-hr'], staffId: 'AS00001' }],
      ['naleko-onboarding-hr only', { kind: 'jwt', email: 'onb.only@kestrel-foods.co.za', groups: ['naleko-onboarding-hr'], staffId: 'AS00002' }],
      ['No groups, with a staff id', { kind: 'jwt', email: 'no.groups@kestrel-foods.co.za', groups: [], staffId: 'AS00003' }],
      ['Employee without a staff id', { kind: 'jwt', email: 'thabo.nkosi@kestrel-foods.co.za', groups: ['employee'] }],
      ['Robot employee with a staff id', { kind: 'jwt', email: `pepla-e2e-emp${ROBOT_DOMAIN}`, groups: ['employee', 'e2e-robots'], staffId: 'AS00004' }],
      ['No claims', { kind: 'none' }],
    ];
    for (const [who, caller] of people) {
      const r = call.tfChat()(t, caller);
      noThrow(r, `Talent Flow chat, ${who}`);
      expect(r.status, `Talent Flow chat, ${who}: 403\n${r.raw.slice(0, 300)}`).toBe(403);
      expect(r.body, `Talent Flow chat, ${who}: { "error": "${TF_CHAT_REFUSED}" } and no other field`).toEqual({ error: TF_CHAT_REFUSED });
      expect(r.headers['content-type'] ?? '', `Talent Flow chat, ${who}: JSON`).toContain('application/json');
      expect(awsCalls(r), `Talent Flow chat, ${who}: no AWS call of any kind`).toEqual([]);
      expect(modelCalls(r), `Talent Flow chat, ${who}: no model call`).toEqual([]);
    }

    // HR and Talent Flow HR (robots): today's AI-skipped answer, no model call.
    const hrs: Array<[string, Caller]> = [
      ['HR', { kind: 'jwt', email: HR_EMAIL, groups: ['hr_staff'], staffId: 'E2EHR01' }],
      ['TF HR', { kind: 'jwt', email: `pepla-e2e-tf${ROBOT_DOMAIN}`, groups: ['naleko-talentflow-hr'], staffId: 'TF0001' }],
      ['HR with other groups', { kind: 'jwt', email: HR_EMAIL, groups: ['naleko-onboarding-hr', 'hr_staff', 'e2e-robots'], staffId: 'E2EHR01' }],
    ];
    for (const [who, caller] of hrs) {
      const r = call.tfChat()(t, caller);
      noThrow(r, `Talent Flow chat, ${who}`);
      expect(r.status, `Talent Flow chat, ${who}: 200\n${r.raw.slice(0, 300)}`).toBe(200);
      expect(String(r.body?.message), `Talent Flow chat, ${who}: the AI-skipped answer`).toMatch(/AI skipped/);
      expect(modelCalls(r), `Talent Flow chat, ${who}: no model call`).toEqual([]);
    }

    // HR without a staff id: today's 401.
    for (const [who, caller] of [
      ['HR without a staff id', { kind: 'jwt', email: HR_EMAIL, groups: ['hr_staff'] }],
      ['TF HR without a staff id', { kind: 'jwt', email: `pepla-e2e-tf${ROBOT_DOMAIN}`, groups: ['naleko-talentflow-hr'] }],
    ] as Array<[string, Caller]>) {
      const r = call.tfChat()(t, caller);
      noThrow(r, `Talent Flow chat, ${who}`);
      expect(r.status, `Talent Flow chat, ${who}: 401 as today`).toBe(401);
      expect(r.body).toEqual({ error: TF_CHAT_NO_STAFF_ID });
      expect(awsCalls(r), `Talent Flow chat, ${who}: no AWS call`).toEqual([]);
    }

    // Text: the group check, by exact names through inGroup, comes first.
    const { all, body } = handlerSource(HANDLER.tfChat);
    expect(all, 'imports inGroup from ../shared/hr-group.mjs').toMatch(/import\s*\{[^}]*\binGroup\b[^}]*\}\s*from\s*['"]\.\.\/shared\/hr-group\.mjs['"]/);
    const check = [...body.matchAll(/\binGroup\s*\(([^)]*)\)/g)].find((m) => /(['"`])hr_staff\1/.test(m[1]!) && /(['"`])naleko-talentflow-hr\1/.test(m[1]!));
    expect(check, 'the handler calls inGroup(claims, \'hr_staff\', \'naleko-talentflow-hr\')').toBeTruthy();
    const at = check!.index!;
    for (const later of ['custom:staff_id', 'markRobot(', 'isRobotCaller(', 'aiSwitchedOff(', 'checkRateLimit(', '.send(']) {
      const i = body.indexOf(later);
      if (i >= 0) expect(at, `the group check comes before ${later}`).toBeLessThan(i);
    }
    expect(body.indexOf('custom:staff_id'), 'the staff id check is still there').toBeGreaterThan(0);
  });

  test('AC-6 A person cannot change their own sign-in email or staff id on pepla-dev @pepla-dev', async ({ page, employee }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: AC-3 and AC-4 cover the rule and the Terraform in the no-backend run.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    const region = devSetting('region');
    const clientId = devSetting('clientId');
    const api = page.request;

    // The employee test login signs in with its password (USER_PASSWORD_AUTH), as the e2e jobs do.
    const auth = await cognito(api, region, 'InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: employee.email, PASSWORD: employee.password },
    });
    expect(auth.status, `the employee test login signs in: ${auth.type}`).toBe(200);
    const access = String(auth.body.AuthenticationResult?.AccessToken ?? '');
    const refresh = String(auth.body.AuthenticationResult?.RefreshToken ?? '');
    expect(access, 'an access token').not.toBe('');
    expect(refresh, 'a refresh token').not.toBe('');

    const before = attrsOf(await cognito(api, region, 'GetUser', { AccessToken: access }));
    const originalEmail = before['email'] ?? '';
    expect(originalEmail.toLowerCase(), 'GetUser shows the test login\'s email').toBe(employee.email.toLowerCase());
    expect(before['email_verified'], 'the employee test login\'s email is verified (else rule 1 locks it out of its own documents)').toBe('true');
    const staffBefore = before['custom:staff_id'];

    // First, a write that changes nothing even where it is allowed: the staff id, set to what it is now.
    // A pepla-dev without this card's client fails here, before any write that would change the login.
    const probe = await cognito(api, region, 'UpdateUserAttributes', { AccessToken: access, UserAttributes: [{ Name: 'custom:staff_id', Value: staffBefore ?? '' }] });
    expect(`${probe.status} ${probe.type}`, 'the client may not write custom:staff_id at all (checked first with its own value, so nothing changes)').toBe('400 NotAuthorizedException');

    // The staff id: refused, nothing changes.
    const staff = await cognito(api, region, 'UpdateUserAttributes', { AccessToken: access, UserAttributes: [{ Name: 'custom:staff_id', Value: 'AS00001' }] });
    expect(`${staff.status} ${staff.type}`, 'custom:staff_id = "AS00001" is refused').toBe('400 NotAuthorizedException');
    expect(attrsOf(await cognito(api, region, 'GetUser', { AccessToken: access }))['custom:staff_id'], 'GetUser: the staff id is as before').toBe(staffBefore);

    // The email: refused, or kept pending until the code (which never comes) is entered.
    const target = `e2e.be171-${Date.now()}-${Math.floor(Math.random() * 1e4)}${ROBOT_DOMAIN}`;
    const change = await cognito(api, region, 'UpdateUserAttributes', { AccessToken: access, UserAttributes: [{ Name: 'email', Value: target }] });
    expect([200, 400], `UpdateUserAttributes email: refused or pending (got ${change.status} ${change.type})`).toContain(change.status);
    if (change.status === 400) expect(change.type, 'an email change is refused as not allowed').toBe('NotAuthorizedException');

    const after = attrsOf(await cognito(api, region, 'GetUser', { AccessToken: access }));
    expect(after['email'], 'GetUser: still the original email').toBe(originalEmail);
    expect(after['email_verified'], 'GetUser: still verified').toBe('true');

    const refreshed = await cognito(api, region, 'InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: clientId, AuthParameters: { REFRESH_TOKEN: refresh } });
    expect(refreshed.status, `the refresh works: ${refreshed.type}`).toBe(200);
    const idClaims = claimsOf(String(refreshed.body.AuthenticationResult?.IdToken ?? ''));
    expect(idClaims['email'], 'the refreshed ID token: still the original email').toBe(originalEmail);
    expect(String(idClaims['email_verified']), 'the refreshed ID token: email_verified true').toBe('true');
    expect(idClaims['custom:staff_id'], 'the refreshed ID token: the staff id as before').toBe(staffBefore);
  });
});
