import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { ON_DEV, expect, test, type Login, type SignInPage } from './support/fixtures';
import { attributes, blocks, stripComments, tfFiles } from './support/infra-harness';
import { row, type Row } from './support/onb-13/lambda-harness';
import {
  EMAIL, ENV, OCR, REPO, REVIEW, aiAttempts, bodyOf, busEvent, emailRoutes, emails, listRun, openapiChecks, personRun, plain,
  published, reviewEvent, routedToEmail, runHandler, s3Event, source, type Email, type Run, type Tables, type World,
} from './support/onb-07/lambda-harness';

/**
 * ONB-07 · Batsi checks, HR decides (Jira NH-163, epic NH-150). Red card.
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-07.md (14 Nov 2026)
 *
 * AC-1 to AC-7 and AC-9 run the real Lambdas (processDocumentOCR, sendNotificationEmail,
 * reviewDocumentVerification and ONB-12/13's two list Lambdas), each in its own fresh Node process,
 * against a fake AWS (support/onb-07/fake-aws): DynamoDB with writes and conditions, S3, EventBridge,
 * Step Functions, KMS, Postmark, and fake Textract and Bedrock that record every attempt, even one the
 * AI guard refuses. Nothing reaches AWS, Postmark or any AI service. They run once, in desktop-1280.
 * AC-8 runs on pepla-dev (and has a no-backend half on the fake AWS).
 *
 * These files are locked once the lock check accepts them: see ./README.md and cards/onb-07.md.
 */

const CHECKS = ['MATCHES', 'NEEDS_A_LOOK', 'DOESNT_MATCH'] as const;
type Check = (typeof CHECKS)[number];
const CHECK_WORD: Record<Check, string> = { MATCHES: 'Matches', NEEDS_A_LOOK: 'Needs a look', DOESNT_MATCH: "Doesn't match" };
type DocType = 'NATIONAL_ID' | 'BANK_CONFIRMATION' | 'MATRIC_CERTIFICATE' | 'TERTIARY_QUALIFICATION';
const TYPE_NAME: Record<DocType, string> = {
  NATIONAL_ID: 'National ID',
  BANK_CONFIRMATION: 'Bank confirmation',
  MATRIC_CERTIFICATE: 'Matric certificate',
  TERTIARY_QUALIFICATION: 'Tertiary qualification',
};
const BUCKET = ENV.UPLOAD_BUCKET;
/** A one-page PDF: the file the employee uploads. */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

const lambdaOnce = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambdas against a fake AWS.');
  test.skip(projectName !== 'desktop-1280', 'Runs the Lambdas once: they have no screen width.');
};

// ---------------------------------------------------------------- made-up people (no real data)

type Person = { employee_id: string; first_name: string; last_name: string; email: string; stage: string; hr_staff_email?: string; id_number_last4?: string; sfn_task_token?: string };
const NALEDI: Person = {
  employee_id: 'EMP-0701', first_name: 'Naledi', last_name: 'Dlamini', email: 'naledi.dlamini@kestrel-foods.co.za',
  stage: 'INVITED', hr_staff_email: 'jane.smith@mokoena-logistics.co.za', id_number_last4: '0086',
};
/** HR partner field present but empty: HR_EMAIL gets the email. */
const PIETER: Person = {
  employee_id: 'EMP-0702', first_name: 'Pieter', last_name: 'van Wyk', email: 'pieter.vanwyk@kestrel-foods.co.za',
  stage: 'ACTIVE', hr_staff_email: '', id_number_last4: '5083',
};
/** No HR partner field and no ID number on the record. */
const THANDEKA: Person = {
  employee_id: 'EMP-0703', first_name: 'Thandeka', last_name: 'Nkosi-Dlamini', email: 'thandeka.nkosi@kestrel-foods.co.za', stage: 'INVITED',
};
const ELISE: Person = { employee_id: 'EMP-0704', first_name: 'Elise', last_name: 'Dupré', email: 'elise.dupre@kestrel-foods.co.za', stage: 'INVITED', hr_staff_email: 'jane.smith@mokoena-logistics.co.za' };
const RUI: Person = { employee_id: 'EMP-0705', first_name: 'Rui', last_name: "D'Almeida", email: 'rui.dalmeida@kestrel-foods.co.za', stage: 'INVITED', hr_staff_email: 'jane.smith@mokoena-logistics.co.za' };
/** The employee test login (scripts/ci/seed-dev.py): a robot, so no paid AI, and its HR partner gets no email. */
const ROBOT: Person = {
  employee_id: 'E2E-EMP-0001', first_name: 'Sipho', last_name: 'Demo-Starter', email: 'pepla-e2e-employee@blackhole.postmarkapp.com',
  stage: 'INVITED', hr_staff_email: 'jane.smith@mokoena-logistics.co.za',
};

const ID_NUMBER = '9001010800086'; // last 4 "0086", as on Naledi's record
const OTHER_ID_NUMBER = '9001010800183';
const DOB = '1990-01-01';
const ACCOUNT = '62812345678';
const BRANCH = '250655';

const personRow = (p: Person): Row => row({ ...p, created_at: '2026-11-01T08:00:00.000Z' } as Record<string, string>);

let serial = 0;
type Doc = { id: string; ts: string; type: DocType; key: string; person: Person };
function newDoc(person: Person, type: DocType): Doc {
  const ts = String(1763100000000 + ++serial * 1000);
  return { id: `doc_${ts}`, ts, type, person, key: `uploads/${person.employee_id}/${type}/doc_${ts}_${type.toLowerCase().replace(/_/g, '-')}.pdf` };
}

/** The world as generateDocumentUploadUrl leaves it: the employee, a PENDING document row, the file in S3. */
function worldFor(doc: Doc, read: { model?: unknown; textract?: World['textract'] } = {}, extraPeople: Person[] = []): World {
  return {
    tables: {
      employees: [doc.person, ...extraPeople].map(personRow),
      documents: [
        {
          employee_id: { S: doc.person.employee_id },
          document_id: { S: doc.id },
          document_type: { S: doc.type },
          s3_key: { S: doc.key },
          file_name: { S: doc.key.split('/').pop()!.split('_').slice(2).join('_') },
          upload_timestamp: { S: '2026-11-14T07:59:00.000Z' },
          ocr_status: { S: 'PENDING' },
          verification_id: { NULL: true },
        },
      ],
      'document-verification': [],
    },
    s3: { [`${BUCKET}/${doc.key}`]: PDF.toString('base64') },
    textract: read.textract ?? { lines: ['REPUBLIC OF SOUTH AFRICA', 'Made-up document for a test'] },
    model: read.model ?? {},
  };
}

// What the model reads. The model always says AUTO_APPROVE unless told otherwise: it must be ignored.
const idRead = (o: { surname?: string | null; idNumber?: string | null; confidence: number; decision?: string }) => ({
  idNumber: o.idNumber === undefined ? ID_NUMBER : o.idNumber,
  name: 'NALEDI',
  surname: o.surname === undefined ? 'DLAMINI' : o.surname,
  dateOfBirth: DOB,
  gender: 'Female',
  citizenship: 'SA Citizen',
  checks: { hasValidIdLength: true, dobMatchesId: true, genderCodeValid: true, citizenshipDigitValid: true, hasName: true, hasSurname: true },
  confidence: o.confidence,
  decision: o.decision ?? 'AUTO_APPROVE',
  reasoning: 'All checks pass.',
});
const bankRead = (holder: string | null, confidence: number, decision = 'AUTO_APPROVE') => ({
  accountHolder: holder,
  bankName: 'FNB',
  accountNumber: ACCOUNT,
  branchCode: BRANCH,
  accountType: 'Cheque',
  checks: { hasAccountHolder: true, hasBankName: true, hasAccountNumber: true, hasBranchCode: true, hasAccountType: true, isRecentLetter: true },
  confidence,
  decision,
  reasoning: 'A bank confirmation letter.',
});
const genericRead = (confidence: number, decision = 'AUTO_APPROVE') => ({
  documentTypeDetected: 'certificate',
  checks: { appearsLegitimate: true, isReadable: true },
  confidence,
  decision,
  reasoning: 'Looks like the document.',
});

/** processDocumentOCR on the S3 event of `doc`. */
function readDoc(world: World, doc: Doc, env: Record<string, string> = {}): Run {
  return runHandler(OCR, world, s3Event(BUCKET, doc.key), env);
}

const docRow = (w: World, doc: Doc) => plain(w.tables.documents.find((r) => (r['document_id'] as { S: string } | undefined)?.S === doc.id));
const verifications = (w: World) => w.tables['document-verification'].map((r) => plain(r)!);
const verificationOf = (w: World, doc: Doc) => {
  const vid = docRow(w, doc)?.['verification_id'];
  return typeof vid === 'string' ? verifications(w).find((v) => v['verificationId'] === vid) : undefined;
};
/** `document_id` in an event: today's events carry the id without "doc_"; either names the document. */
const sameDoc = (id: unknown, doc: Doc) => id === doc.id || id === doc.ts;

/** The text of an email (its text body, or its HTML body without tags), lines trimmed, curly quotes made straight. */
function textOf(e: Email): string {
  const t = typeof e.TextBody === 'string' && e.TextBody.trim() ? e.TextBody : String(e.HtmlBody ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return t.replace(/[‘’]/g, "'").split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n');
}
const allText = (e: Email) => [e.Subject, e.TextBody, e.HtmlBody, e.To, e.Cc, e.Bcc].map((x) => String(x ?? '')).join('\n');

/** Delivers events to sendNotificationEmail, one fresh run each, and returns every email sent. */
function deliver(world: World, events: Array<{ detailType: string; detail: unknown; source?: string }>): Email[] {
  const sent: Email[] = [];
  for (const e of events) {
    const r = runHandler(EMAIL, world, busEvent(e.detailType, e.detail, e.source));
    expect(r.error, `sendNotificationEmail handles ${e.detailType} without throwing`).toBeUndefined();
    sent.push(...emails(r));
  }
  return sent;
}

// ---------------------------------------------------------------- pepla-dev helpers (as ONB-13)

function devDocumentApi(): string {
  const file = join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts');
  const m = /documentUploadApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(existsSync(file) ? readFileSync(file, 'utf8') : '');
  expect(m, 'pepla-web/src/environments/environment.ts has documentUploadApiUrl').toBeTruthy();
  expect(m![1], 'documentUploadApiUrl points at pepla-dev, not the placeholder').not.toMatch(/\.invalid\b/);
  return m![1]!.replace(/\/+$/, '');
}

async function signInForToken(page: Page, signIn: SignInPage, login: Login): Promise<string> {
  let token = '';
  const listen = async (r: import('@playwright/test').Response) => {
    if (!/cognito-idp\.[a-z0-9-]+\.amazonaws\.com/.test(r.url()) || r.request().method() !== 'POST') return;
    try {
      const body = (await r.json()) as { AuthenticationResult?: { IdToken?: string } };
      if (body.AuthenticationResult?.IdToken) token = body.AuthenticationResult.IdToken;
    } catch {
      /* not JSON */
    }
  };
  page.on('response', listen);
  await signIn.open();
  await signIn.signInAs(login);
  await expect.poll(() => token, { message: `Cognito hands ${login.email} an ID token`, timeout: 30_000 }).not.toBe('');
  page.off('response', listen);
  return token;
}

// ---------------------------------------------------------------- the tests

test.describe('ONB-07 Batsi checks, HR decides', () => {
  test('AC-1 Every read document waits for HR: MANUAL_REVIEW, no HR decision, listed as waiting, whatever Batsi found', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    test.setTimeout(240_000);
    const cases: Array<{ name: string; doc: Doc; read: Parameters<typeof worldFor>[1]; env?: Record<string, string>; check: Check; read_ok: boolean }> = [
      { name: 'an ID read at 99', doc: newDoc(NALEDI, 'NATIONAL_ID'), read: { model: idRead({ confidence: 99 }) }, check: 'MATCHES', read_ok: true },
      { name: 'an ID read at 90', doc: newDoc(NALEDI, 'NATIONAL_ID'), read: { model: idRead({ confidence: 90 }) }, check: 'MATCHES', read_ok: true },
      { name: 'an ID read at 89', doc: newDoc(NALEDI, 'NATIONAL_ID'), read: { model: idRead({ confidence: 89 }) }, check: 'NEEDS_A_LOOK', read_ok: true },
      { name: 'an ID read at 40', doc: newDoc(NALEDI, 'NATIONAL_ID'), read: { model: idRead({ confidence: 40 }) }, check: 'NEEDS_A_LOOK', read_ok: true },
      { name: 'a test employee\'s document (AI skipped)', doc: newDoc(ROBOT, 'NATIONAL_ID'), read: { model: idRead({ confidence: 99 }) }, check: 'NEEDS_A_LOOK', read_ok: false },
      { name: 'AI switched off', doc: newDoc(NALEDI, 'NATIONAL_ID'), read: { model: idRead({ confidence: 99 }) }, env: { AI_CALLS_ENABLED: 'false' }, check: 'NEEDS_A_LOOK', read_ok: false },
      { name: 'an unreadable file', doc: newDoc(NALEDI, 'BANK_CONFIRMATION'), read: { textract: { error: 'UnsupportedDocumentException' } }, check: 'NEEDS_A_LOOK', read_ok: false },
    ];
    for (const c of cases) {
      const run = readDoc(worldFor(c.doc, c.read), c.doc, c.env);
      if (c.name !== 'an unreadable file') expect(run.error, `${c.name}: processDocumentOCR finishes without throwing`).toBeUndefined();
      const w = run.world;
      const doc = docRow(w, c.doc)!;
      expect(doc['ocr_status'], `${c.name}: the document's ocr_status`).toBe('MANUAL_REVIEW');
      expect(doc['hr_reviewed_at'], `${c.name}: no hr_reviewed_at`).toBeUndefined();
      for (const v of verifications(w)) {
        expect(v['decision'], `${c.name}: the verification row's decision`).toBe('MANUAL_REVIEW');
        expect(v['check'], `${c.name}: the verification row's check`).toBe(c.check);
      }
      if (c.read_ok) expect(verificationOf(w, c.doc), `${c.name}: the document points at its verification row`).toBeTruthy();

      const list = bodyOf(listRun(w));
      const item = (list.items as any[]).find((i) => i.document_id === c.doc.id);
      expect(item, `${c.name}: GET /v1/verifications?waiting=true lists the document`).toBeTruthy();
      expect(item.check, `${c.name}: with the check`).toBe(c.check);
      const person = bodyOf(personRun(w, c.doc.person.employee_id));
      const d = (person.documents as any[]).find((x) => x.document_id === c.doc.id);
      expect(d, `${c.name}: the employee documents route lists it`).toBeTruthy();
      expect(d.hr_decision, `${c.name}: HR decision`).toBeNull();
      expect(d.ocr_status, `${c.name}: status`).toBe('MANUAL_REVIEW');
      expect(d.check, `${c.name}: check`).toBe(c.check);
    }
  });

  test('AC-2 The check follows the table, worked out from the record; matching never accepts; the model\'s decision is ignored', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    test.setTimeout(240_000);
    const cases: Array<[string, Doc, unknown, Check]> = [
      ['ID matching name and last 4 at 95', newDoc(NALEDI, 'NATIONAL_ID'), idRead({ confidence: 95 }), 'MATCHES'],
      ['ID matching at 99 (the model says AUTO_APPROVE)', newDoc(NALEDI, 'NATIONAL_ID'), idRead({ confidence: 99 }), 'MATCHES'],
      ['ID at 95 with a different surname', newDoc(NALEDI, 'NATIONAL_ID'), idRead({ surname: 'MOKOENA', confidence: 95 }), 'DOESNT_MATCH'],
      ['ID at 40 with a different surname', newDoc(NALEDI, 'NATIONAL_ID'), idRead({ surname: 'MOKOENA', confidence: 40 }), 'DOESNT_MATCH'],
      ['ID at 95 with different last 4', newDoc(NALEDI, 'NATIONAL_ID'), idRead({ idNumber: OTHER_ID_NUMBER, confidence: 95 }), 'DOESNT_MATCH'],
      ['ID at 95 with the surname not read (null)', newDoc(NALEDI, 'NATIONAL_ID'), idRead({ surname: null, confidence: 95 }), 'NEEDS_A_LOOK'],
      ['ID at 95 with the surname not read (NOT_FOUND)', newDoc(NALEDI, 'NATIONAL_ID'), idRead({ surname: 'NOT_FOUND', confidence: 95 }), 'NEEDS_A_LOOK'],
      ['ID at 95 with the surname not read (empty)', newDoc(NALEDI, 'NATIONAL_ID'), idRead({ surname: '', confidence: 95 }), 'NEEDS_A_LOOK'],
      ['ID at 95 with the ID number not read while the record has one', newDoc(NALEDI, 'NATIONAL_ID'), idRead({ idNumber: null, confidence: 95 }), 'NEEDS_A_LOOK'],
      ['ID at 89 with name and last 4 matching', newDoc(NALEDI, 'NATIONAL_ID'), idRead({ confidence: 89 }), 'NEEDS_A_LOOK'],
      ['ID at 95, record without ID number, surname "NKOSI DLAMINI" for Nkosi-Dlamini', newDoc(THANDEKA, 'NATIONAL_ID'), idRead({ surname: 'NKOSI DLAMINI', idNumber: OTHER_ID_NUMBER, confidence: 95 }), 'MATCHES'],
      ['ID at 95, "VAN WYK" for van Wyk, last 4 matching', newDoc(PIETER, 'NATIONAL_ID'), idRead({ surname: 'VAN WYK', idNumber: '8507125095083', confidence: 95 }), 'MATCHES'],
      ['ID at 95, "DUPRE" for Dupré (accents removed)', newDoc(ELISE, 'NATIONAL_ID'), idRead({ surname: 'DUPRE', confidence: 95 }), 'MATCHES'],
      ['ID at 95, "DALMEIDA" for D\'Almeida (apostrophe dropped)', newDoc(RUI, 'NATIONAL_ID'), idRead({ surname: 'DALMEIDA', confidence: 95 }), 'MATCHES'],
      ['ID at 95, the model says MANUAL_REVIEW', newDoc(NALEDI, 'NATIONAL_ID'), idRead({ confidence: 95, decision: 'MANUAL_REVIEW' }), 'MATCHES'],
      ['ID at 95, the model says DOESNT_MATCH', newDoc(NALEDI, 'NATIONAL_ID'), idRead({ confidence: 95, decision: 'DOESNT_MATCH' }), 'MATCHES'],
      ['bank letter at 92, holder "MR P VAN WYK" for Pieter van Wyk', newDoc(PIETER, 'BANK_CONFIRMATION'), bankRead('MR P VAN WYK', 92), 'MATCHES'],
      ['bank letter at 92 with another holder', newDoc(PIETER, 'BANK_CONFIRMATION'), bankRead('MS T MOYO', 92), 'DOESNT_MATCH'],
      ['bank letter at 60 with another holder', newDoc(PIETER, 'BANK_CONFIRMATION'), bankRead('MS T MOYO', 60), 'DOESNT_MATCH'],
      ['bank letter at 95, holder not read', newDoc(PIETER, 'BANK_CONFIRMATION'), bankRead('NOT_FOUND', 95), 'NEEDS_A_LOOK'],
      ['bank letter at 85, holder matching', newDoc(PIETER, 'BANK_CONFIRMATION'), bankRead('MR P VAN WYK', 85), 'NEEDS_A_LOOK'],
      ['matric at 91', newDoc(NALEDI, 'MATRIC_CERTIFICATE'), genericRead(91), 'MATCHES'],
      ['matric at 50', newDoc(NALEDI, 'MATRIC_CERTIFICATE'), genericRead(50), 'NEEDS_A_LOOK'],
      ['tertiary at 70', newDoc(NALEDI, 'TERTIARY_QUALIFICATION'), genericRead(70), 'NEEDS_A_LOOK'],
      ['tertiary at 90', newDoc(NALEDI, 'TERTIARY_QUALIFICATION'), genericRead(90, 'MANUAL_REVIEW'), 'MATCHES'],
    ];
    const prompts: Partial<Record<DocType, string[]>> = {};
    for (const [name, doc, model, check] of cases) {
      const run = readDoc(worldFor(doc, { model }), doc);
      expect(run.error, `${name}: processDocumentOCR finishes without throwing`).toBeUndefined();
      const v = verificationOf(run.world, doc);
      expect(v, `${name}: a verification row is written and the document points at it`).toBeTruthy();
      expect(v!['check'], `${name}: Batsi's check`).toBe(check);
      expect(v!['decision'], `${name}: the row's decision`).toBe('MANUAL_REVIEW');
      expect(JSON.stringify(run.world.tables['document-verification']), `${name}: no AUTO_APPROVE stored`).not.toContain('AUTO_APPROVE');
      expect(docRow(run.world, doc)!['ocr_status'], `${name}: the document waits (MANUAL_REVIEW)`).toBe('MANUAL_REVIEW');
      expect(docRow(run.world, doc)!['hr_reviewed_at'], `${name}: no HR decision`).toBeUndefined();
      for (const a of aiAttempts(run).filter((x) => x.service === 'bedrock')) (prompts[doc.type] ??= []).push(JSON.stringify(a.input));
    }
    for (const type of Object.keys(TYPE_NAME) as DocType[]) {
      expect(prompts[type]?.length ?? 0, `the model is asked to read a ${TYPE_NAME[type]}`).toBeGreaterThan(0);
      for (const p of prompts[type]!) expect(p, `the ${TYPE_NAME[type]} prompt asks for no AUTO_APPROVE`).not.toContain('AUTO_APPROVE');
    }
    expect(source(OCR), 'the word AUTO_APPROVE appears nowhere in processDocumentOCR').not.toContain('AUTO_APPROVE');
  });

  test('AC-3 No check, no Matches: a PASSED document without a verification needs a look; a stored check wins; old rows keep the confidence rule', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const E = NALEDI.employee_id;
    type Spec = { id: string; status: string; v?: { confidence: number; check?: string }; decided?: boolean; want: string };
    const specs: Spec[] = [
      { id: 'doc_1763000000001', status: 'PASSED', want: 'NEEDS_A_LOOK' },
      { id: 'doc_1763000000002', status: 'MANUAL_REVIEW', v: { confidence: 95, check: 'DOESNT_MATCH' }, want: 'DOESNT_MATCH' },
      { id: 'doc_1763000000003', status: 'MANUAL_REVIEW', v: { confidence: 93 }, want: 'MATCHES' },
      { id: 'doc_1763000000004', status: 'MANUAL_REVIEW', v: { confidence: 97, check: 'NEEDS_A_LOOK' }, want: 'NEEDS_A_LOOK' },
      { id: 'doc_1763000000005', status: 'MANUAL_REVIEW', v: { confidence: 30, check: 'MATCHES' }, want: 'MATCHES' },
      { id: 'doc_1763000000006', status: 'MANUAL_REVIEW', v: { confidence: 95, check: 'AUTO_APPROVE' }, want: 'MATCHES' },
      { id: 'doc_1763000000007', status: 'MANUAL_REVIEW', v: { confidence: 89 }, want: 'NEEDS_A_LOOK' },
      { id: 'doc_1763000000008', status: 'PENDING', want: 'READING' },
      { id: 'doc_1763000000009', status: 'PROCESSING', want: 'READING' },
      { id: 'doc_1763000000010', status: 'FAILED', want: 'NEEDS_A_LOOK' },
      { id: 'doc_1763000000011', status: 'MANUAL_REVIEW', want: 'NEEDS_A_LOOK' },
      { id: 'doc_1763000000012', status: 'PASSED', decided: true, want: 'NEEDS_A_LOOK' },
    ];
    const tables: Tables = { employees: [personRow(NALEDI)], documents: [], 'document-verification': [] };
    for (const s of specs) {
      const vid = s.v ? `ver_${s.id}` : undefined;
      tables.documents.push(row({
        employee_id: E, document_id: s.id, document_type: 'NATIONAL_ID', upload_timestamp: `2026-11-1${specs.indexOf(s) % 10}T08:00:00Z`,
        ocr_status: s.status, verification_id: vid, hr_reviewed_at: s.decided ? '2026-11-13T08:00:00Z' : undefined,
      }));
      if (s.v) tables['document-verification'].push(row({ verificationId: vid!, employeeId: E, documentId: s.id, documentType: 'NATIONAL_ID', confidence: s.v.confidence, decision: 'MANUAL_REVIEW', check: s.v.check, createdAt: '2026-11-10T08:00:00Z' }));
    }
    const world: World = { tables };
    const list = bodyOf(listRun(world));
    const person = bodyOf(personRun(world, E));
    for (const s of specs) {
      const p = (person.documents as any[]).find((d) => d.document_id === s.id);
      expect(p?.check, `${s.id} (${s.status}${s.v ? `, verification at ${s.v.confidence}${s.v.check ? ` with check ${s.v.check}` : ' without check'}` : ', no verification'}${s.decided ? ', HR accepted' : ''}): employee documents route`).toBe(s.want);
      if (s.decided) {
        expect((list.items as any[]).some((i) => i.document_id === s.id), `${s.id}: decided, so not waiting`).toBe(false);
        continue;
      }
      const i = (list.items as any[]).find((x) => x.document_id === s.id);
      expect(i?.check, `${s.id} (${s.status}): waiting list`).toBe(s.want);
    }
  });

  test('AC-4 No email to the employee before HR decides; the complete email only for a VERIFIED employee; HR\'s decisions still email the employee', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    test.setTimeout(240_000);
    const routes = emailRoutes();
    // A) Reading a document, at any result, emails nobody but the HR partner. Every event the read
    //    publishes goes to sendNotificationEmail as infra/eventbridge.tf routes it, plus document.waiting.
    const withToken: Person = { ...NALEDI, sfn_task_token: 'onb07-fake-task-token' };
    const reads: Array<[string, Doc, Parameters<typeof worldFor>[1], Record<string, string>?]> = [
      ['Matches', newDoc(withToken, 'NATIONAL_ID'), { model: idRead({ confidence: 99 }) }],
      ['Needs a look', newDoc(withToken, 'BANK_CONFIRMATION'), { model: bankRead('N DLAMINI', 70) }],
      ["Doesn't match", newDoc(withToken, 'NATIONAL_ID'), { model: idRead({ surname: 'MOKOENA', confidence: 97 }) }],
      ['an unreadable file', newDoc(withToken, 'MATRIC_CERTIFICATE'), { textract: { error: 'UnsupportedDocumentException' } }],
      ['AI switched off', newDoc(withToken, 'TERTIARY_QUALIFICATION'), {}, { AI_CALLS_ENABLED: 'false' }],
      ['a test employee', newDoc(ROBOT, 'NATIONAL_ID'), { model: idRead({ confidence: 99 }) }],
    ];
    for (const [name, doc, read, env] of reads) {
      const run = readDoc(worldFor(doc, read), doc, env);
      const direct = emails(run);
      expect(direct, `${name}: processDocumentOCR itself sends no email`).toEqual([]);
      const events = [...routedToEmail(run, routes), ...published(run, 'document.waiting').filter((e) => !routes.some((r) => r.detailTypes.includes('document.waiting')))];
      const sent = deliver(run.world, events);
      for (const e of sent) {
        expect(e.To, `${name}: an email after the read goes only to the HR partner`).toBe(doc.person.hr_staff_email);
        expect(allText(e), `${name}: it never goes to the employee`).not.toContain(doc.person.email);
      }
    }

    // B) onboarding.completed (Step Functions sends it after the first read) emails nobody unless VERIFIED.
    for (const stage of ['DOCUMENTS_SUBMITTED', 'INVITED', 'ACTIVE']) {
      const p: Person = { ...NALEDI, stage };
      const sent = deliver({ tables: { employees: [personRow(p)], documents: [], 'document-verification': [] } }, [{ detailType: 'onboarding.completed', detail: { employee_id: p.employee_id } }]);
      expect(sent, `onboarding.completed for a ${stage} employee sends nothing`).toEqual([]);
    }
    const verified: Person = { ...NALEDI, stage: 'VERIFIED' };
    const done = deliver({ tables: { employees: [personRow(verified)], documents: [], 'document-verification': [] } }, [{ detailType: 'onboarding.completed', detail: { employee_id: verified.employee_id } }]);
    expect(done.length, 'onboarding.completed for a VERIFIED employee sends one email').toBe(1);
    expect(done[0]!.To, 'to the employee').toBe(verified.email);

    // C) HR's Accept and Ask for a new one still email the employee.
    for (const decision of ['PASSED', 'FAILED'] as const) {
      const d = newDoc(NALEDI, 'BANK_CONFIRMATION');
      const w = worldFor(d);
      w.tables.documents[0]!['ocr_status'] = { S: decision };
      w.tables.documents[0]!['hr_reviewed_at'] = { S: '2026-11-14T09:00:00Z' };
      const sent = deliver(w, [{ detailType: 'document.reviewed', detail: { document_id: d.id, employee_id: NALEDI.employee_id, decision, notes: '' } }]);
      expect(sent.length, `document.reviewed ${decision} sends one email`).toBe(1);
      expect(sent[0]!.To, `document.reviewed ${decision} goes to the employee`).toBe(NALEDI.email);
    }
  });

  test('AC-5 HR is told once per document, whatever the check: one document.waiting event and one HR email, even when S3 sends the event twice', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    test.setTimeout(240_000);
    const cases: Array<{ name: string; doc: Doc; read: Parameters<typeof worldFor>[1]; check: Check; to: string | null; textract: number; bedrock: number }> = [
      { name: 'Matches', doc: newDoc(NALEDI, 'NATIONAL_ID'), read: { model: idRead({ confidence: 99 }) }, check: 'MATCHES', to: NALEDI.hr_staff_email!, textract: 1, bedrock: 1 },
      { name: 'Needs a look (HR partner field empty)', doc: newDoc(PIETER, 'BANK_CONFIRMATION'), read: { model: bankRead('MR P VAN WYK', 85) }, check: 'NEEDS_A_LOOK', to: ENV.HR_EMAIL, textract: 1, bedrock: 1 },
      { name: "Doesn't match (no HR partner field)", doc: newDoc(THANDEKA, 'NATIONAL_ID'), read: { model: idRead({ surname: 'MOKOENA', confidence: 96 }) }, check: 'DOESNT_MATCH', to: ENV.HR_EMAIL, textract: 1, bedrock: 1 },
      { name: 'an unreadable file', doc: newDoc(NALEDI, 'MATRIC_CERTIFICATE'), read: { textract: { error: 'UnsupportedDocumentException' } }, check: 'NEEDS_A_LOOK', to: NALEDI.hr_staff_email!, textract: 1, bedrock: 0 },
      { name: 'a test employee', doc: newDoc(ROBOT, 'BANK_CONFIRMATION'), read: { model: bankRead('MR S DEMO-STARTER', 99) }, check: 'NEEDS_A_LOOK', to: null, textract: 0, bedrock: 0 },
    ];
    for (const c of cases) {
      const first = readDoc(worldFor(c.doc, c.read), c.doc);
      const second = readDoc(first.world, c.doc); // S3 delivers the same event again
      const runs = [first, second];
      const count = (service: string) => runs.flatMap(aiAttempts).filter((a) => a.service === service).length;
      expect(count('textract'), `${c.name}: Textract is called ${c.textract ? 'once' : 'never'} over both events`).toBe(c.textract);
      expect(count('bedrock'), `${c.name}: Bedrock is called ${c.bedrock ? 'once' : 'never'} over both events`).toBe(c.bedrock);
      expect(runs.flatMap((r) => r.calls).filter((x) => x.service === 's3' && x.op === 'GetObject').length, `${c.name}: the file is read at most once`).toBeLessThanOrEqual(1);
      expect(second.error, `${c.name}: the repeat event finishes without throwing`).toBeUndefined();

      const waiting = runs.flatMap((r) => published(r, 'document.waiting'));
      expect(waiting.length, `${c.name}: exactly one document.waiting event over both deliveries`).toBe(1);
      const d = waiting[0]!.detail;
      expect(waiting[0]!.source, `${c.name}: from naleko.onboarding`).toBe('naleko.onboarding');
      expect(waiting[0]!.bus, `${c.name}: on the onboarding bus`).toBe(ENV.EVENT_BUS_NAME);
      expect(Object.keys(d).sort(), `${c.name}: the event carries only employee_id, document_id, document_type and check`).toEqual(['check', 'document_id', 'document_type', 'employee_id']);
      expect(d.employee_id, `${c.name}: event employee_id`).toBe(c.doc.person.employee_id);
      expect(sameDoc(d.document_id, c.doc), `${c.name}: event document_id names the document (got ${d.document_id})`).toBe(true);
      expect(d.document_type, `${c.name}: event document_type`).toBe(c.doc.type);
      expect(d.check, `${c.name}: event check`).toBe(c.check);
      expect(docRow(second.world, c.doc)!['hr_told_at'], `${c.name}: hr_told_at is set on the document`).toBeTruthy();

      // EventBridge hands each document.waiting event to sendNotificationEmail.
      const sent = deliver(second.world, waiting);
      if (c.to === null) {
        expect(sent, `${c.name}: no email for a test employee`).toEqual([]);
        continue;
      }
      expect(sent.length, `${c.name}: exactly one HR email`).toBe(1);
      const e = sent[0]!;
      const name = `${c.doc.person.first_name} ${c.doc.person.last_name}`;
      expect(e.To, `${c.name}: to the HR partner, else HR_EMAIL`).toBe(c.to);
      expect(String(e.Cc ?? '') + String(e.Bcc ?? ''), `${c.name}: nobody else copied`).toBe('');
      expect(e.Subject, `${c.name}: subject`).toBe(`Document to check: ${name}, ${TYPE_NAME[c.doc.type]}`);
      const text = textOf(e);
      for (const line of [
        `${name} uploaded a ${TYPE_NAME[c.doc.type]}.`,
        `Batsi's check: ${CHECK_WORD[c.check]}.`,
        'The document waits for an HR decision before it counts.',
        'Sign in to Naleko People to decide:',
      ]) expect(text, `${c.name}: the email says "${line}"`).toContain(line);
      expect(text, `${c.name}: the email links to sign in`).toContain(ENV.LOGIN_URL);
      expect(text.split('\n').filter(Boolean).pop(), `${c.name}: signed "Naleko People"`).toBe('Naleko People');
      // Document ids are made-up numbers: take them out before looking for leaked digits.
      const everything = allText(e).split(c.doc.id).join('').split(c.doc.ts).join('');
      for (const [what, leak] of [
        ['ID number', ID_NUMBER], ['other ID number', OTHER_ID_NUMBER], ['ID number last 4 from the record', '0086'],
        ['date of birth', DOB], ['date of birth digits', '900101'], ['account number', ACCOUNT], ['branch code', BRANCH],
        ['file address', 'uploads/'], ['file address', c.doc.key], ['file name', '.pdf'], ['bucket', BUCKET],
      ] as const) expect(everything, `${c.name}: the email holds no ${what}`).not.toContain(leak);
    }

    // An earlier delivery already told HR (hr_told_at is set) and then stopped before the read was saved:
    // S3 sends the event again. The file may be read again, but HR is not told again.
    const doc = newDoc(NALEDI, 'NATIONAL_ID');
    const w = worldFor(doc, { model: idRead({ confidence: 99 }) });
    w.tables.documents[0]!['hr_told_at'] = { S: '2026-11-14T08:00:05.000Z' };
    const again = readDoc(w, doc);
    expect(again.error, 'HR already told: the retry finishes without throwing').toBeUndefined();
    expect(published(again, 'document.waiting'), 'HR already told: no second document.waiting event').toEqual([]);
    expect(docRow(again.world, doc)!['hr_told_at'], 'HR already told: hr_told_at is kept').toBe('2026-11-14T08:00:05.000Z');
  });

  test('AC-6 Only HR acceptances count toward Verified: an auto-passed ID does not', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const E = NALEDI.employee_id;
    const p: Person = { ...NALEDI, stage: 'DOCUMENTS_SUBMITTED' };
    const world: World = {
      tables: {
        employees: [personRow(p)],
        documents: [
          // Passed by the old auto-pass: no person accepted it.
          row({ employee_id: E, document_id: 'doc_1763200000001', document_type: 'NATIONAL_ID', upload_timestamp: '2026-11-10T08:00:00Z', ocr_status: 'PASSED', verification_id: 'ver_onb07_id' }),
          row({ employee_id: E, document_id: 'doc_1763200000002', document_type: 'BANK_CONFIRMATION', upload_timestamp: '2026-11-10T09:00:00Z', ocr_status: 'MANUAL_REVIEW', verification_id: 'ver_onb07_bank' }),
        ],
        'document-verification': [
          row({ verificationId: 'ver_onb07_id', employeeId: E, documentId: 'doc_1763200000001', documentType: 'NATIONAL_ID', confidence: 96, decision: 'AUTO_APPROVE', createdAt: '2026-11-10T08:01:00Z' }),
          row({ verificationId: 'ver_onb07_bank', employeeId: E, documentId: 'doc_1763200000002', documentType: 'BANK_CONFIRMATION', confidence: 72, decision: 'MANUAL_REVIEW', createdAt: '2026-11-10T09:01:00Z' }),
        ],
      },
    };
    const stage = (w: World) => plain(w.tables.employees.find((r) => (r['employee_id'] as { S: string }).S === E))!['stage'];

    const bank = runHandler(REVIEW, world, reviewEvent('doc_1763200000002', E, 'PASSED'));
    expect(bank.error, 'HR accepts the bank letter').toBeUndefined();
    expect(bank.response?.statusCode, 'HR accepts the bank letter: 200').toBe(200);
    expect(stage(bank.world), 'with the ID only auto-passed, the employee is not VERIFIED').toBe('DOCUMENTS_SUBMITTED');
    expect(published(bank, 'onboarding.completed'), 'and onboarding.completed is not published').toEqual([]);

    const id = runHandler(REVIEW, bank.world, reviewEvent('doc_1763200000001', E, 'PASSED'));
    expect(id.response?.statusCode, 'HR accepts the ID: 200').toBe(200);
    expect(stage(id.world), 'when HR also accepts the ID, the employee becomes VERIFIED').toBe('VERIFIED');
    expect(published(id, 'onboarding.completed').length, 'and onboarding.completed is published once').toBe(1);
  });

  test('AC-7 Test logins never reach paid AI: no Textract or Bedrock attempt, with or without AI switched off; the AI cost guardrail check passes', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    for (const type of Object.keys(TYPE_NAME) as DocType[]) {
      for (const env of [{}, { AI_CALLS_ENABLED: 'false' }, { AI_CALLS_ENABLED: 'true' }]) {
        const doc = newDoc(ROBOT, type);
        const run = readDoc(worldFor(doc, { model: idRead({ confidence: 99 }) }), doc, env);
        const how = `a test employee's ${TYPE_NAME[type]}${'AI_CALLS_ENABLED' in env ? ` with AI_CALLS_ENABLED=${env.AI_CALLS_ENABLED}` : ''}`;
        expect(aiAttempts(run).map((a) => `${a.service} ${a.op}`), `${how}: no Textract or Bedrock attempt`).toEqual([]);
        expect(docRow(run.world, doc)!['ocr_status'], `${how}: still waits for HR`).toBe('MANUAL_REVIEW');
      }
    }
    const check = spawnSync('python3', [join(REPO, 'scripts', 'ci', 'check-ai-guard.py')], { cwd: REPO, encoding: 'utf8' });
    expect(check.status, `the "AI cost guardrail" check passes:\n${check.stdout}${check.stderr}`).toBe(0);
    expect(check.stdout).toContain('AI cost guardrail check passed');
    // No AI client in the Lambdas this card touches is made outside guardAi (the check above covers lambda/).
    for (const f of [OCR, EMAIL, REVIEW]) {
      const src = stripComments(source(f));
      for (const m of src.matchAll(/new\s+(\w*(?:Bedrock|Textract|Anthropic|OpenAI)\w*)\s*\(/g)) {
        expect(src.slice(Math.max(0, m.index! - 12), m.index).trimEnd().endsWith('guardAi('), `${f.slice(REPO.length + 1)}: ${m[1]} is wrapped in guardAi`).toBe(true);
      }
    }
  });

  test('AC-8 pepla-dev: the employee test login uploads a document; within 90 seconds HR sees it waiting with Needs a look and no decision @pepla-dev', async ({ page, signIn, hr, employee }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once: it uploads a document.');
    test.setTimeout(240_000);
    if (!ON_DEV) {
      // No-backend half: the same upload through the real Lambdas on the fake AWS.
      const doc = newDoc(ROBOT, 'BANK_CONFIRMATION');
      const run = readDoc(worldFor(doc), doc);
      expect(run.error, 'processDocumentOCR finishes').toBeUndefined();
      for (const v of verifications(run.world)) {
        expect(v['decision'], 'a verification row says MANUAL_REVIEW').toBe('MANUAL_REVIEW');
        expect(v['check'], 'and stores the check Needs a look').toBe('NEEDS_A_LOOK');
      }
      const item = (bodyOf(listRun(run.world)).items as any[]).find((i) => i.document_id === doc.id);
      expect(item?.check, 'the waiting list shows Needs a look').toBe('NEEDS_A_LOOK');
      const d = (bodyOf(personRun(run.world, ROBOT.employee_id)).documents as any[]).find((x) => x.document_id === doc.id);
      expect(d?.hr_decision, 'HR decision').toBeNull();
      expect(d?.ocr_status, 'status').not.toBe('PASSED');
      expect(published(run, 'document.waiting').length, 'HR is told (event)').toBe(1);
      return;
    }

    const api = devDocumentApi();
    const empToken = await signInForToken(page, signIn, employee);
    const claims = JSON.parse(Buffer.from(empToken.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    // The test login's own employee id: its token claim, else the seed's id (scripts/ci/seed-dev.py).
    const employeeId = String(claims['custom:employee_id'] ?? ROBOT.employee_id);
    const link = await page.request.post(`${api}/v1/employees/${encodeURIComponent(employeeId)}/documents/upload-url`, {
      headers: { Authorization: `Bearer ${empToken}`, 'Content-Type': 'application/json' },
      data: { documentType: 'BANK_CONFIRMATION', fileName: 'onb07-check.pdf', contentType: 'application/pdf' },
    });
    expect(link.status(), `the employee test login gets an upload link: ${await link.text()}`).toBe(200);
    const { url, document_id } = (await link.json()) as { url: string; document_id: string };
    const put = await page.request.put(url, { headers: { 'Content-Type': 'application/pdf' }, data: PDF });
    expect(put.ok(), `the test PDF uploads (${put.status()})`).toBe(true);

    await page.context().clearCookies();
    await page.goto('about:blank');
    const hrToken = await signInForToken(page, signIn, hr);
    const auth = { Authorization: `Bearer ${hrToken}` };
    let check = '';
    await expect
      .poll(
        async () => {
          const r = await page.request.get(`${api}/v1/verifications?waiting=true`, { headers: auth });
          if (r.status() !== 200) return `HTTP ${r.status()}`;
          const it = ((await r.json()) as { items?: Array<{ document_id: string; check: string }> }).items?.find((i) => i.document_id === document_id);
          check = it?.check ?? 'not listed';
          return check;
        },
        { message: 'within 90 seconds the waiting list shows the upload, read (not Being checked)', timeout: 90_000, intervals: [3_000] },
      )
      .not.toMatch(/^(READING|not listed|HTTP \d+)$/);
    expect(check, 'Batsi\'s check on a test login\'s upload').toBe('NEEDS_A_LOOK');
    const person = await page.request.get(`${api}/v1/employees/${encodeURIComponent(employeeId)}/verifications`, { headers: auth });
    expect(person.status(), 'the employee documents route answers HR').toBe(200);
    const d = ((await person.json()) as { documents: Array<{ document_id: string; hr_decision: unknown; ocr_status: string }> }).documents.find((x) => x.document_id === document_id);
    expect(d, 'the employee documents route lists the upload').toBeTruthy();
    expect(d!.hr_decision, 'with HR decision null').toBeNull();
    expect(d!.ocr_status, 'and a status that is not PASSED').not.toBe('PASSED');
  });

  test('AC-9 Terraform adds the document.waiting rule, its target and permission and changes nothing else in eventbridge.tf; the API spec keeps the four checks', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const files = tfFiles();
    const resources = blocks(files, 'resource');
    const named = (type: string) => resources.filter((b) => b.labels[0] === type);

    const rules = named('aws_cloudwatch_event_rule').filter((b) => attributes(b.body).get('name') === '"naleko-document-waiting-notify"');
    expect(rules.length, 'one rule named naleko-document-waiting-notify').toBe(1);
    const rule = rules[0]!;
    const ra = attributes(rule.body);
    expect(ra.get('event_bus_name'), 'on the onboarding bus').toBe('aws_cloudwatch_event_bus.naleko_onboarding.name');
    const pattern = ra.get('event_pattern') ?? '';
    expect(pattern, 'matching source naleko.onboarding').toMatch(/"?source"?=\["naleko\.onboarding"\]/);
    expect(pattern, 'and detail-type document.waiting only').toMatch(/"?detail-type"?=\["document\.waiting"\]/);
    if (ra.has('state')) expect(ra.get('state'), 'enabled').toBe('"ENABLED"');
    const ruleRef = `aws_cloudwatch_event_rule.${rule.labels[1]}`;

    const targets = named('aws_cloudwatch_event_target').filter((b) => attributes(b.body).get('rule') === `${ruleRef}.name`);
    expect(targets.length, 'one target on that rule').toBe(1);
    const ta = attributes(targets[0]!.body);
    expect(ta.get('arn'), 'the target is sendNotificationEmail').toBe('aws_lambda_function.send_notification_email.arn');
    expect(ta.get('event_bus_name'), 'on the onboarding bus').toBe('aws_cloudwatch_event_bus.naleko_onboarding.name');

    const perms = named('aws_lambda_permission').filter((b) => attributes(b.body).get('source_arn') === `${ruleRef}.arn`);
    expect(perms.length, 'one Lambda permission for that rule').toBe(1);
    const pa = attributes(perms[0]!.body);
    expect(pa.get('function_name'), 'for sendNotificationEmail').toBe('aws_lambda_function.send_notification_email.function_name');
    expect(pa.get('principal'), 'from EventBridge').toBe('"events.amazonaws.com"');
    expect(pa.get('action')).toBe('"lambda:InvokeFunction"');
    const sameFn = named('aws_lambda_permission').filter((b) => attributes(b.body).get('function_name') === 'aws_lambda_function.send_notification_email.function_name');
    const ids = sameFn.map((b) => attributes(b.body).get('statement_id'));
    expect(new Set(ids).size, 'its statement_id is not used by another permission on sendNotificationEmail').toBe(ids.length);

    // Nothing that was in eventbridge.tf changes or goes (so the plan destroys or replaces nothing there).
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const before = blocks([join(__dirname, 'support', 'onb-07', 'eventbridge.6b7f95b.tf.txt')], 'resource');
    for (const b of before) {
      const now = resources.filter((r) => r.labels[0] === b.labels[0] && r.labels[1] === b.labels[1]);
      expect(now.length, `${b.labels.join('.')} is still declared once`).toBe(1);
      expect(norm(now[0]!.body), `${b.labels.join('.')} is unchanged`).toBe(norm(b.body));
    }
    // ...and no moved or removed block takes one of them away.
    const leaving = [...blocks(files, 'moved'), ...blocks(files, 'removed')].map((b) => attributes(b.body).get('from') ?? '');
    for (const b of before) expect(leaving, `no moved or removed block names ${b.labels.join('.')}`).not.toContain(b.labels.join('.'));

    const enums = openapiChecks();
    expect(enums.length, 'api/openapi.yaml has check enums').toBeGreaterThan(0);
    for (const e of enums) expect([...e].sort(), 'each check enum lists the four checks').toEqual(['DOESNT_MATCH', 'MATCHES', 'NEEDS_A_LOOK', 'READING']);
  });
});
