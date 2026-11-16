import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { DocumentsFake, storedEmployee, type FakePerson } from './support/documents-fake';
import { EmployeesFake, apiPerson, type ApiPerson } from './support/employees-fake';
import { HR_HOME, ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { blocks, tfFiles } from './support/infra-harness';
import { decide as iamDecide, type Policy, type Statement } from './support/ops-05/iam-eval';
import { policyOf, resourcesNamed, squash, table as tableArn } from './support/onb-15/tf-policy';
import {
  FIVE, LIST, OCR, PERSON, POST_AUTH, REPO, REVIEW, aiReached, dynamoCalls, listEvent, personEvent, personOf, plain, postAuthEvent,
  published, reviewEvent, row, runHandler, s3Event, valuesWritten, writesTo, type Caller, type Run, type Tables, type World,
} from './support/onb-09/lambda-harness';

/**
 * ONB-09 · Four steps everywhere (Jira NH-166, epic NH-150).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-09.md (14 Nov 2026)
 *
 * Lambda tests (AC-1 to AC-6, AC-9, AC-10) run once, in desktop-1280: the real cognitoPostAuth,
 * processDocumentOCR, reviewDocumentVerification, getEmployees and getEmployeeDocumentVerifications handlers,
 * each in a fresh Node process, against support/onb-09/fake-aws (DynamoDB honours ConditionExpression and pages
 * its Query and Scan answers; the email index can be behind its table; chosen calls can fail; EventBridge,
 * S3, Step Functions and Postmark record what they are asked; Textract and Bedrock are recording fakes and
 * every test person but one is a test login, so the AI guard skips them). Nothing reaches AWS or any AI service.
 * Screen tests (AC-7, AC-8) run with no backend: the browser answers the employees list with
 * support/employees-fake.ts and one person with support/documents-fake.ts, both now answering `step`.
 * AC-11 runs on pepla-dev (desktop, once) and only reads.
 *
 * These files are locked once accepted: see ./README.md and cards/onb-09.md.
 */

const STEP_CODES = ['INVITED', 'DOCUMENTS', 'IN_REVIEW', 'VERIFIED'] as const;
type Code = (typeof STEP_CODES)[number];
const WORD: Record<Code, string> = { INVITED: 'Invited', DOCUMENTS: 'Documents', IN_REVIEW: 'In review', VERIFIED: 'Verified' };
const WORDS = Object.values(WORD);
/** The six stages stored today. */
const STORED_STAGES = ['INVITED', 'ACTIVE', 'DOCUMENTS_SUBMITTED', 'VERIFIED', 'TRAINING', 'ONBOARDED'];

const ID = 'NATIONAL_ID';
const BANK = 'BANK_CONFIRMATION';
const MATRIC = 'MATRIC_CERTIFICATE';
const TERTIARY = 'TERTIARY_QUALIFICATION';

const HR: Caller = { kind: 'jwt', email: 'thandi.demo-hr@kestrel-foods.co.za', groups: ['hr_staff'], givenName: 'Thandi', familyName: 'Demo-HR' };
/** Test logins (the AI guard skips their documents): the ONB-09 people. */
const ROBOT = '@blackhole.postmarkapp.com';
const E = 'EMP-0900001';
const E_EMAIL = `lindiwe.zulu${ROBOT}`;
const SELF: Caller = { kind: 'jwt', email: E_EMAIL, groups: ['employee'], givenName: 'Lindiwe', familyName: 'Zulu' };
/** Not a test login: Textract (a recording fake) is reached, and made to fail, for the unreadable-file path. */
const R = 'EMP-0900002';
const R_EMAIL = 'sizwe.ndaba@kestrel-foods.co.za';
const GHOST = 'EMP-0900099';

function lambdaOnce(testInfo: TestInfo): void {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambdas against a fake AWS.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Runs the Lambdas once: they have no screen width.');
}
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs made-up people.');

// ---------------------------------------------------------------- the fake tables

type Doc = { n: number; type: string; status: string; hr?: boolean; at?: string | null; emp?: string };
/** A document id as generateDocumentUploadUrl makes it (doc_<ms>), later for a larger n. */
const msOf = (n: number) => 1763100000000 + n * 60_000;
const docId = (n: number) => `doc_${msOf(n)}`;
const d = (type: string, status: string, n: number, opts: { hr?: boolean; at?: string | null } = {}): Doc => ({ n, type, status, ...opts });
/** Read and waiting for HR. */
const waiting = (type: string, n: number) => d(type, 'MANUAL_REVIEW', n);
/** Accepted by HR. */
const accepted = (type: string, n: number) => d(type, 'PASSED', n, { hr: true });
/** HR asked for a new one. */
const sentBack = (type: string, n: number) => d(type, 'FAILED', n, { hr: true });
/** An upload link made, no file read yet (as generateDocumentUploadUrl writes it). */
const pending = (type: string, n: number) => d(type, 'PENDING', n);

const keyOf = (emp: string, doc: Doc) => `uploads/${emp}/${doc.type}/${docId(doc.n)}_${doc.type.toLowerCase()}.pdf`;

function docRow(emp: string, doc: Doc) {
  const read = doc.status !== 'PENDING';
  return row({
    employee_id: emp,
    document_id: docId(doc.n),
    document_type: doc.type,
    file_name: `${doc.type.toLowerCase()}.pdf`,
    s3_key: keyOf(emp, doc),
    upload_timestamp: doc.at === null ? undefined : doc.at ?? new Date(msOf(doc.n)).toISOString(),
    ocr_status: doc.status,
    ocr_completed_at: read ? new Date(msOf(doc.n) + 30_000).toISOString() : undefined,
    hr_reviewed_at: doc.hr ? '2026-11-13T09:00:00.000Z' : undefined,
    hr_reviewed_by: doc.hr ? 'jane.smith@kestrel-foods.co.za' : undefined,
    hr_reviewed_by_name: doc.hr ? 'Jane Smith' : undefined,
    hr_decision_notes: doc.hr && doc.status === 'FAILED' ? 'The letter is older than three months.' : undefined,
  });
}

type Person = { id: string; email: string; stage?: string | null; step?: string | null; first?: string; last?: string };

function personRow(p: Person) {
  return row({
    employee_id: p.id,
    first_name: p.first ?? 'Lindiwe',
    last_name: p.last ?? 'Zulu',
    email: p.email,
    stage: p.stage === null ? undefined : p.stage ?? undefined,
    step: p.step === null ? undefined : p.step ?? undefined,
    department: 'Finance',
    job_title: 'Bookkeeper',
    created_at: '2026-11-01T08:00:00.000Z',
    created_by: 'sub-hr',
    hr_staff_email: 'jane.smith@kestrel-foods.co.za',
  });
}

/** One person (E, a test login) with these documents. */
function worldOf(stage: string, step: string | null, docs: Doc[], extra: Partial<World> = {}): World {
  return {
    tables: {
      employees: [personRow({ id: E, email: E_EMAIL, stage, step })],
      documents: docs.map((x) => docRow(x.emp ?? E, x)),
      'document-verification': [],
      'talent-flow-users': [],
    },
    ...extra,
  };
}

const PDF_B64 = Buffer.from('%PDF-1.4\n% ONB-09 made-up file\n%%EOF\n').toString('base64');

/** processDocumentOCR on the upload of `doc` (its row is added as the upload link wrote it, PENDING, unless there). */
function read(world: World, doc: Doc, emp = E): Run {
  const w = structuredClone(world);
  const id = docId(doc.n);
  if (!w.tables.documents.some((r) => (r['employee_id'] as { S: string }).S === emp && (r['document_id'] as { S: string }).S === id)) {
    w.tables.documents.push(docRow(emp, pending(doc.type, doc.n)));
  }
  w.s3 = { ...(w.s3 ?? {}), [`document-ocr-verification-uploads-onb09/${keyOf(emp, doc)}`]: PDF_B64 };
  const run = runHandler(OCR, w, s3Event(keyOf(emp, doc)));
  return run;
}

/** A read that must finish as today: no throw, 200, the document waiting for HR. */
function readOk(world: World, doc: Doc, what: string, emp = E): Run {
  const run = read(world, doc, emp);
  expect(run.error, `${what}: processDocumentOCR finishes without throwing (${run.error?.message ?? ''})`).toBeUndefined();
  expect(run.response?.statusCode, `${what}: processDocumentOCR answers 200`).toBe(200);
  const stored = plain(run.world.tables.documents.find((r) => (r['employee_id'] as { S: string }).S === emp && (r['document_id'] as { S: string }).S === docId(doc.n)));
  expect(stored?.['ocr_status'], `${what}: the document waits for HR (MANUAL_REVIEW)`).toBe('MANUAL_REVIEW');
  return run;
}

/** HR decides document n of `emp`. */
function decide(world: World, n: number, decision: 'PASSED' | 'FAILED', what: string, emp = E, caller: Caller = HR): Run {
  const run = runHandler(REVIEW, world, reviewEvent(docId(n), emp, decision, caller));
  expect(run.error, `${what}: the decision finishes without throwing`).toBeUndefined();
  expect(run.status, `${what}: 200 (${run.raw.slice(0, 200)})`).toBe(200);
  return run;
}

const who = (w: World, id = E) => personOf(w, id);
const stepOf = (w: World, id = E) => personOf(w, id)?.['step'];
const stageOf = (w: World, id = E) => personOf(w, id)?.['stage'];
const empWrites = (run: Run) => writesTo(run, 'employees');

/** Every Query on documents in the run read consistently. */
function expectConsistentDocumentReads(run: Run, what: string): void {
  const queries = dynamoCalls(run).filter((c) => c.op === 'Query' && c.table === 'documents');
  expect(queries.length, `${what}: the person's documents are read (Query on documents)`).toBeGreaterThan(0);
  for (const q of queries) expect(q.input.ConsistentRead, `${what}: the Query on documents reads consistently`).toBe(true);
}

/** The step the API answers for a person, through both readers. */
function answeredStep(world: World, id: string, caller: Caller = HR): { list: unknown; listHas: boolean; listStage: unknown; one: unknown; oneHas: boolean; oneStage: unknown } {
  const items = listAll(world, caller).items;
  const item = items.find((i) => i['employee_id'] === id) ?? {};
  const one = runHandler(PERSON, world, personEvent(id, caller));
  expect(one.error, 'getEmployeeDocumentVerifications finishes without throwing').toBeUndefined();
  expect(one.status, `getEmployeeDocumentVerifications answers 200 (${one.raw.slice(0, 200)})`).toBe(200);
  const emp = (one.body?.employee ?? {}) as Record<string, unknown>;
  return { list: item['step'], listHas: 'step' in item, listStage: item['stage'], one: emp['step'], oneHas: 'step' in emp, oneStage: emp['stage'] };
}

/** Every page of GET /v1/employees, following lastKey. */
function listAll(world: World, caller: Caller, query: Record<string, string> = {}): { items: Array<Record<string, unknown>>; pages: number } {
  const items: Array<Record<string, unknown>> = [];
  let key: string | undefined;
  let pages = 0;
  do {
    const run = runHandler(LIST, world, listEvent(caller, { ...query, ...(key ? { lastKey: key } : {}) }));
    expect(run.error, 'getEmployees finishes without throwing').toBeUndefined();
    expect(run.status, `getEmployees answers 200 (${run.raw.slice(0, 200)})`).toBe(200);
    items.push(...((run.body?.items ?? []) as Array<Record<string, unknown>>));
    key = run.body?.lastKey;
    pages++;
  } while (key && pages < 20);
  return { items, pages };
}

// ---------------------------------------------------------------- source files

function filesUnder(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p, exts));
    else if (exts.test(name)) out.push(p);
  }
  return out;
}

/** The members of the old app's OnboardingStage union. */
function oldAppStages(): string[] {
  const src = readFileSync(join(REPO, 'hr-portal', 'src', 'app', 'shared', 'models', 'employee.model.ts'), 'utf8');
  const m = /export\s+type\s+OnboardingStage\s*=([^;]*);/.exec(src);
  expect(m, 'hr-portal employee.model.ts declares OnboardingStage').toBeTruthy();
  return [...m![1]!.replace(/\/\/[^\n]*/g, '').matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]!);
}

/** Every stage scripts/ci/seed-dev.py writes: the demo people's and the test employee's (python3 ast). */
function seedStages(): string[] {
  const script = `
import ast, json, sys
tree = ast.parse(open(sys.argv[1], encoding="utf-8").read())
out = []
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "DEMO_PEOPLE" for t in node.targets):
        for elt in node.value.elts:
            out.append(elt.elts[4].value)
    if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "employee_item":
        args = list(node.args)
        for kw in node.keywords:
            if kw.arg == "stage":
                args.append(kw.value)
        if len(args) >= 7 and isinstance(args[6], ast.Constant):
            out.append(args[6].value)
print(json.dumps(out))`;
  return JSON.parse(execFileSync('python3', ['-c', script, join(REPO, 'scripts', 'ci', 'seed-dev.py')], { encoding: 'utf8' }));
}

/** What api/openapi.yaml says about one field of one answer (python3 + PyYAML). */
function openapiField(path: string, method: string, status: string, field: string): { found: boolean; type?: unknown; enum?: string[] | null; nullable?: boolean; description?: string } {
  const out = execFileSync('python3', [join(__dirname, 'support', 'onb-09', 'openapi_field.py'), join(REPO, 'api', 'openapi.yaml'), path, method, status, field], { encoding: 'utf8' });
  return JSON.parse(out);
}

// ---------------------------------------------------------------- the pages

type Fixtures = { list: EmployeesFake | null; docs: DocumentsFake | null };

const test = base.extend<Fixtures>({
  list: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new EmployeesFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
  docs: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new DocumentsFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
});

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const personPath = (id: string) => `/hr/employees/${encodeURIComponent(id)}`;

function homeTable(page: Page): Locator {
  return page.getByRole('table', { name: 'New employees', exact: true });
}
function personRows(page: Page): Locator {
  return homeTable(page).locator('tbody tr').filter({ has: page.locator('a[href*="/hr/employees/"]') });
}
function statValue(page: Page, label: string): Locator {
  const l = page.locator('.pp-stat__label').filter({ hasText: new RegExp(`^\\s*${esc(label)}\\s*$`) });
  return page.locator('.pp-stat').filter({ has: l }).locator('.pp-stat__value');
}
const header = (page: Page) => page.locator('.pp-person-header');

/** Each person row's name and Step cell (the column after the name), as ONB-02 reads them. */
async function stepCells(page: Page): Promise<Record<string, string>> {
  const rows = await personRows(page).evaluateAll((trs) =>
    trs.map((tr) => {
      const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
      const a = tr.querySelector('a[href*="/hr/employees/"]') as HTMLAnchorElement;
      const cells = [...tr.querySelectorAll('td')].map((td) => clean((td as HTMLElement).innerText));
      return [clean(a.innerText), cells[1] ?? ''] as const;
    }),
  );
  return Object.fromEntries(rows);
}

async function openHome(page: Page, signIn: SignInPage, hr: Login): Promise<void> {
  await signIn.open();
  await signIn.signInAs(hr);
  await expect(page).toHaveURL(HR_HOME);
}

async function openPerson(page: Page, signIn: SignInPage, hr: Login, p: FakePerson, first: boolean): Promise<void> {
  await page.goto(personPath(p.employee.employee_id));
  if (first) {
    await expect(signIn.email).toBeVisible();
    await signIn.signInAs(hr);
  }
  await expect(page).toHaveURL(new RegExp(`${esc(personPath(p.employee.employee_id))}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${p.employee.first_name} ${p.employee.last_name}`, { timeout: 20_000 });
}

/** The step words shown in the header's pp-lozenges. */
async function headerSteps(page: Page): Promise<string[]> {
  return header(page).locator('pp-lozenge').evaluateAll((ls, words) =>
    ls.filter((l) => (l as HTMLElement).offsetParent !== null).map((l) => (l as HTMLElement).innerText.replace(/\s+/g, ' ').trim()).filter((t) => words.includes(t)), WORDS);
}

async function noSidewaysScroll(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    for (const el of document.querySelectorAll('main *')) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()}.${el.className} ${el.scrollWidth} > ${el.clientWidth}`);
    }
    return out;
  });
}

/**
 * Every heading, count, step lozenge, link and button in main that a person can see: inside the screen's width,
 * below the top bar when the page is at the top, and reached by a tap at its centre once scrolled into view.
 * (ONB-08 AC-7's check, with the counts added.)
 */
async function hiddenOrCovered(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    const bar = document.querySelector('.pp-top-navigation, [role="banner"]');
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const els = [...document.querySelectorAll('main :is(h1,h2,h3,h4,h5,h6,[role="heading"],a[href],button,pp-lozenge,.pp-stat)')].filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null;
    });
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${(el as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
    window.scrollTo(0, 0);
    document.querySelector('main')?.scrollTo?.(0, 0);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.top < barBottom - 1) out.push(`${name(el)} starts under the top bar (${Math.round(r.top)} < ${Math.round(barBottom)})`);
      if (r.left < -1 || r.right > window.innerWidth + 1) out.push(`${name(el)} is outside the screen's width`);
    }
    for (const el of els) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2)), r.top + r.height / 2);
      if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) out.push(`${name(el)} is covered by ${hit ? hit.tagName.toLowerCase() + '.' + hit.className : 'nothing'}`);
    }
    window.scrollTo(0, 0);
    return out;
  });
}

/**
 * HR home's made-up people: where the stage and the step disagree, the step must win.
 * `step: undefined` leaves the field out of the answer.
 */
function homePeople(): Array<{ p: ApiPerson; want: string }> {
  return [
    { p: apiPerson({ first_name: 'Thandeka', last_name: 'Mthembu', stage: 'VERIFIED', step: 'DOCUMENTS', planned_start_date: '2026-12-01' }), want: 'Documents' },
    { p: apiPerson({ first_name: 'Busisiwe', last_name: 'Ngcobo', stage: 'INVITED', step: 'IN_REVIEW', planned_start_date: '2026-12-02' }), want: 'In review' },
    { p: apiPerson({ first_name: 'Kabelo', last_name: 'Mokoena', stage: 'ACTIVE', step: 'INVITED', planned_start_date: '2026-12-03' }), want: 'Invited' },
    { p: apiPerson({ first_name: 'Refilwe', last_name: 'Dube', stage: 'INVITED', step: 'VERIFIED', planned_start_date: '2026-12-04' }), want: 'Verified' },
    { p: apiPerson({ first_name: 'Mandla', last_name: 'Sithole', stage: 'DOCUMENTS_SUBMITTED', step: 'IN_REVIEW', planned_start_date: '2026-12-05' }), want: 'In review' },
    { p: apiPerson({ first_name: 'Nomvula', last_name: 'Khoza', stage: 'DOCUMENTS_SUBMITTED', step: undefined, planned_start_date: '2026-12-06' }), want: 'Not set' },
    { p: apiPerson({ first_name: 'Lwazi', last_name: 'Zungu', stage: 'VERIFIED', step: null, planned_start_date: '2026-12-07' }), want: 'Not set' },
    { p: apiPerson({ first_name: 'Ayanda', last_name: 'Cele', stage: 'ACTIVE', step: 'TRAINING', planned_start_date: '2026-12-08' }), want: 'Not set' },
  ];
}

/** Employee-page people: the header lozenge must follow `step`. */
function pagePeople(): Array<{ p: FakePerson; want: string | null; what: string }> {
  const one = (first: string, stage: string, step: string | null | undefined, want: string | null, what: string) => ({
    p: { employee: { ...storedEmployee({ first_name: first, last_name: 'Mahlangu', stage }), step }, documents: [] } as FakePerson,
    want,
    what,
  });
  return [
    one('Thandeka', 'VERIFIED', 'DOCUMENTS', 'Documents', 'stage VERIFIED, step DOCUMENTS'),
    one('Busisiwe', 'INVITED', 'IN_REVIEW', 'In review', 'stage INVITED, step IN_REVIEW'),
    one('Kabelo', 'DOCUMENTS_SUBMITTED', 'INVITED', 'Invited', 'stage DOCUMENTS_SUBMITTED, step INVITED'),
    one('Refilwe', 'ACTIVE', 'VERIFIED', 'Verified', 'stage ACTIVE, step VERIFIED'),
    one('Nomvula', 'VERIFIED', undefined, null, 'stage VERIFIED, no step in the answer'),
    one('Lwazi', 'DOCUMENTS_SUBMITTED', null, null, 'stage DOCUMENTS_SUBMITTED, step null'),
    one('Ayanda', 'ACTIVE', 'ONBOARDED', null, 'stage ACTIVE, an unknown step'),
  ];
}

// ---------------------------------------------------------------- pepla-dev helpers

/** An API address the app was built with (CI writes it into environment.ts). */
function devApi(name: 'employeesApiUrl' | 'documentUploadApiUrl'): string {
  const file = join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts');
  const m = new RegExp(`${name}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`).exec(existsSync(file) ? readFileSync(file, 'utf8') : '');
  expect(m, `pepla-web/src/environments/environment.ts has ${name}`).toBeTruthy();
  expect(m![1], `${name} points at pepla-dev, not the placeholder`).not.toMatch(/\.invalid\b/);
  return m![1]!.replace(/\/+$/, '');
}

/** Signs in through the app and keeps the ID token Cognito hands back. */
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

// ---------------------------------------------------------------- tests

test.describe('ONB-09 Four steps everywhere', () => {
  test('AC-1 The API answers a step for every employee: stored when there is one, else from the stage', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    // [first name, stored stage (null = no attribute), stored step (null = no attribute), the step answered]
    const cases: Array<[string, string | null, string | null, Code | null]> = [
      ['Amahle', 'INVITED', null, 'INVITED'],
      ['Bongani', 'ACTIVE', null, 'DOCUMENTS'],
      ['Chipo', 'DOCUMENTS_SUBMITTED', null, 'IN_REVIEW'],
      ['Dineo', 'VERIFIED', null, 'VERIFIED'],
      ['Elias', 'TRAINING', null, 'VERIFIED'],
      ['Farai', 'ONBOARDED', null, 'VERIFIED'],
      ['Gugu', 'ARCHIVED', null, null],
      ['Hlengiwe', '', null, null],
      ['Itumeleng', null, null, null],
      // A stored step is answered as stored, even when the stage says something else.
      ['Jabu', 'VERIFIED', 'DOCUMENTS', 'DOCUMENTS'],
      ['Karabo', 'INVITED', 'IN_REVIEW', 'IN_REVIEW'],
      ['Lebo', 'DOCUMENTS_SUBMITTED', 'VERIFIED', 'VERIFIED'],
      ['Mpho', 'TRAINING', 'INVITED', 'INVITED'],
      // A stored value that is not one of the four steps is not answered: the stage decides.
      ['Nandi', 'ACTIVE', 'ONBOARDED', 'DOCUMENTS'],
      ['Oupa', 'TRAINING', 'TRAINING', 'VERIFIED'],
      ['Palesa', 'ARCHIVED', 'Documents', null],
    ];
    const people: Person[] = cases.map(([first, stage, step], i) => ({ id: `EMP-09100${String(i).padStart(2, '0')}`, email: `${first.toLowerCase()}.nkosi${ROBOT}`, first, last: 'Nkosi', stage, step }));
    const world: World = { tables: { employees: people.map(personRow), documents: [], 'document-verification': [], 'talent-flow-users': [] } };

    // GET /v1/employees, every page.
    const { items, pages } = listAll(world, HR);
    expect(pages, 'the list comes in more than one page (four people a page)').toBeGreaterThan(1);
    expect(items.length, 'every person is answered once').toBe(people.length);
    for (const [i, [first, stage, step, want]] of cases.entries()) {
      const what = `GET /v1/employees, ${first} (stage ${stage === null ? 'missing' : JSON.stringify(stage)}, stored step ${step ?? 'none'})`;
      const item = items.find((x) => x['employee_id'] === people[i]!.id);
      expect(item, `${what} is answered`).toBeTruthy();
      expect('step' in item!, `${what}: the answer has a step field`).toBe(true);
      expect(item!['step'], `${what}: step ${want}`).toBe(want);
      expect(item!['stage'], `${what}: stage unchanged`).toBe(stage === null ? undefined : stage);
    }
    for (const it of items) expect([...STEP_CODES, null], `${String(it['first_name'])}: step is one of the four codes or null`).toContain(it['step']);

    // The ?stage= filter is as it was.
    const active = listAll(world, HR, { stage: 'ACTIVE' }).items;
    expect(active.map((x) => x['first_name']).sort(), '?stage=ACTIVE still filters on the stored stage').toEqual(['Bongani', 'Nandi']);

    // GET /v1/employees/{id}/verifications, to HR and to the person.
    for (const [i, [first, stage, step, want]] of cases.entries()) {
      const p = people[i]!;
      for (const [who, caller] of [['HR', HR], ['the person', { kind: 'jwt', email: p.email, groups: ['employee'], givenName: first, familyName: 'Nkosi' } as Caller]] as const) {
        const run = runHandler(PERSON, world, personEvent(p.id, caller));
        const what = `GET /v1/employees/{id}/verifications to ${who}, ${first} (stage ${stage === null ? 'missing' : JSON.stringify(stage)}, stored step ${step ?? 'none'})`;
        expect(run.error, `${what}: no throw`).toBeUndefined();
        expect(run.status, `${what}: 200 (${run.raw.slice(0, 160)})`).toBe(200);
        const emp = (run.body?.employee ?? {}) as Record<string, unknown>;
        expect('step' in emp, `${what}: employee has a step field`).toBe(true);
        expect(emp['step'], `${what}: employee.step ${want}`).toBe(want);
        expect(emp['stage'], `${what}: employee.stage unchanged`).toBe(stage === null ? undefined : stage);
      }
    }
  });

  test('AC-2 First sign-in moves Invited to Documents; nothing else a sign-in does writes a step', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const signInRun = (world: World, email = E_EMAIL) => {
      const event = postAuthEvent(email);
      const run = runHandler(POST_AUTH, world, event);
      expect(run.error, `sign-in of ${email}: no throw`).toBeUndefined();
      expect(run.response, `sign-in of ${email}: the event goes back to Cognito unchanged`).toEqual(event);
      return run;
    };

    for (const stored of ['INVITED', null] as const) {
      const what = `an INVITED person with ${stored ? 'step INVITED stored' : 'no stored step'}`;
      const first = signInRun(worldOf('INVITED', stored, []));
      const w = empWrites(first);
      expect(w.length, `${what}: one write to the person`).toBe(1);
      expect(w[0]!.op, `${what}: an UpdateItem`).toBe('UpdateItem');
      const p = who(first.world, E)!;
      expect(p['stage'], `${what}: stage ACTIVE`).toBe('ACTIVE');
      expect(String(p['activated_at'] ?? ''), `${what}: activated_at set`).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(p['step'], `${what}: step DOCUMENTS`).toBe('DOCUMENTS');

      const again = signInRun(first.world);
      expect(empWrites(again), `${what}, second sign-in: nothing written to the person`).toEqual([]);
      expect(who(again.world, E), `${what}, second sign-in: the person is unchanged`).toEqual(p);
    }

    for (const [stage, step] of [['ACTIVE', 'DOCUMENTS'], ['ACTIVE', null], ['DOCUMENTS_SUBMITTED', 'IN_REVIEW'], ['DOCUMENTS_SUBMITTED', null], ['VERIFIED', 'VERIFIED'], ['VERIFIED', null], ['TRAINING', null]] as const) {
      const world = worldOf(stage, step, []);
      const run = signInRun(world);
      expect(empWrites(run), `a person at ${stage} (step ${step ?? 'none'}) signs in: nothing written to the person`).toEqual([]);
      expect(who(run.world, E), `a person at ${stage}: unchanged`).toEqual(who(world, E));
    }

    // An email with no employee row creates no row.
    const none = signInRun(worldOf('INVITED', 'INVITED', []), `nobody${ROBOT}`);
    expect(none.world.tables.employees.length, 'a sign-in with no employee row: still one row').toBe(1);
    expect(empWrites(none).filter((w) => w.op === 'PutItem' || w.op === 'Put'), 'and no PutItem on employees').toEqual([]);

    // The email index can be behind the table: it still says INVITED, the row has moved on, or is gone.
    const moved = worldOf('ACTIVE', 'DOCUMENTS', []);
    moved.index = { 'employees/email-index': [personRow({ id: E, email: E_EMAIL, stage: 'INVITED', step: 'INVITED' })] };
    const late = signInRun(moved);
    expect(who(late.world, E), 'index says INVITED, the row is ACTIVE: the row is unchanged (the write keeps its condition stage = INVITED)').toEqual(who(moved, E));
    const gone: World = { ...worldOf('INVITED', 'INVITED', []), index: { 'employees/email-index': [personRow({ id: GHOST, email: `ghost${ROBOT}`, stage: 'INVITED', step: 'INVITED' })] } };
    const ghost = signInRun(gone, `ghost${ROBOT}`);
    expect(who(ghost.world, GHOST), 'index has a person whose row is gone: no row is created').toBeUndefined();
    expect(ghost.world.tables.employees.length, 'still one row').toBe(1);
  });

  test('AC-3 In review starts when every required document is in, not on the first one; a read never moves the step back', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    // In turn, either order: the first required document gives Documents (stage moves as today), the second In review.
    for (const [a, b] of [[ID, BANK], [BANK, ID]] as const) {
      const what = `${a} read, then ${b}`;
      const one = readOk(worldOf('ACTIVE', 'DOCUMENTS', []), d(a, 'x', 1), `${what}, first`);
      expect(stepOf(one.world), `${what}: after the first, step DOCUMENTS`).toBe('DOCUMENTS');
      expect(stageOf(one.world), `${what}: after the first, stage DOCUMENTS_SUBMITTED as today`).toBe('DOCUMENTS_SUBMITTED');
      expectConsistentDocumentReads(one, `${what}, first`);
      const two = readOk(one.world, d(b, 'x', 2), `${what}, second`);
      expect(stepOf(two.world), `${what}: after the second, step IN_REVIEW`).toBe('IN_REVIEW');
      expect(stageOf(two.world), `${what}: after the second, stage DOCUMENTS_SUBMITTED`).toBe('DOCUMENTS_SUBMITTED');
    }
    // From Invited (never signed in): the first read gives Documents.
    const fromInvited = readOk(worldOf('INVITED', 'INVITED', []), d(ID, 'x', 1), 'an INVITED person uploads the ID');
    expect(stepOf(fromInvited.world), 'an INVITED person uploads the ID: step DOCUMENTS').toBe('DOCUMENTS');

    // Optional documents alone stay Documents.
    const m = readOk(worldOf('ACTIVE', 'DOCUMENTS', []), d(MATRIC, 'x', 1), 'a matric alone');
    expect(stepOf(m.world), 'a matric alone: DOCUMENTS').toBe('DOCUMENTS');
    const mt = readOk(m.world, d(TERTIARY, 'x', 2), 'matric and tertiary');
    expect(stepOf(mt.world), 'matric and tertiary: DOCUMENTS').toBe('DOCUMENTS');

    // A new bank copy read after HR sent the old one back.
    const back = readOk(worldOf('DOCUMENTS_SUBMITTED', 'DOCUMENTS', [accepted(ID, 1), sentBack(BANK, 2)]), d(BANK, 'x', 3), 'a new bank copy after a send-back');
    expect(stepOf(back.world), 'a new bank copy after a send-back: IN_REVIEW').toBe('IN_REVIEW');

    // A PENDING bank row (an upload link never used) does not count.
    const link = readOk(worldOf('ACTIVE', 'DOCUMENTS', [pending(BANK, 5)]), d(ID, 'x', 6), 'the ID with only an unused bank upload link');
    expect(stepOf(link.world), 'the ID with only an unused bank upload link: DOCUMENTS').toBe('DOCUMENTS');

    // The card's "in" table for one required type, read through the Lambda: the other required type is read last.
    const H = '2026-11-12T10:00:00.000Z';
    const table: Array<[string, (x: string) => Doc[], boolean]> = [
      ['no row', () => [], false],
      ['only PENDING', (x) => [pending(x, 10)], false],
      ['MANUAL_REVIEW', (x) => [waiting(x, 10)], true],
      ['PROCESSING', (x) => [d(x, 'PROCESSING', 10)], true],
      ['PASSED + hr_reviewed_at', (x) => [accepted(x, 10)], true],
      ['PASSED with no hr_reviewed_at (old auto-pass)', (x) => [d(x, 'PASSED', 10)], true],
      ['FAILED (sent back)', (x) => [sentBack(x, 10)], false],
      ['FAILED, not decided (could not be read, old row)', (x) => [d(x, 'FAILED', 10)], false],
      ['FAILED, then MANUAL_REVIEW (a new copy)', (x) => [sentBack(x, 10), waiting(x, 11)], true],
      ['PASSED + hr_reviewed_at, then FAILED', (x) => [accepted(x, 10), sentBack(x, 11)], false],
      ['MANUAL_REVIEW, then PENDING', (x) => [waiting(x, 10), pending(x, 11)], true],
      ['sent back with the later upload_timestamp but the smaller id', (x) => [waiting(x, 11), { ...sentBack(x, 10), at: '2026-11-20T08:00:00.000Z' }], false],
      ['waiting with the later upload_timestamp but the smaller id', (x) => [sentBack(x, 11), { ...waiting(x, 10), at: '2026-11-20T08:00:00.000Z' }], true],
      ['rows stored newest first: waiting, then an older one sent back', (x) => [waiting(x, 11), sentBack(x, 10)], true],
      ['rows stored newest first: sent back, then an older one waiting', (x) => [sentBack(x, 11), waiting(x, 10)], false],
      ['no timestamps: sent back, then a later doc_<ms> waiting', (x) => [{ ...sentBack(x, 10), at: null }, { ...waiting(x, 11), at: null }], true],
      ['same time: the larger id sent back', (x) => [{ ...waiting(x, 10), at: H }, { ...sentBack(x, 11), at: H }], false],
    ];
    for (const type of [ID, BANK]) {
      const other = type === ID ? BANK : ID;
      for (const [what, rows, isIn] of table) {
        const label = `${type}: ${what}; then the ${other} is read`;
        const run = readOk(worldOf('DOCUMENTS_SUBMITTED', 'DOCUMENTS', rows(type)), d(other, 'x', 30), label);
        expect(stepOf(run.world), `${label}: ${isIn ? 'IN_REVIEW' : 'DOCUMENTS'}`).toBe(isIn ? 'IN_REVIEW' : 'DOCUMENTS');
      }
    }

    // Every page of the person's documents is read: the bank letter is on the third page.
    const many = [waiting(MATRIC, 1), sentBack(MATRIC, 2), waiting(TERTIARY, 3), pending(TERTIARY, 4), waiting(MATRIC, 5), sentBack(TERTIARY, 6), waiting(MATRIC, 7), d(TERTIARY, 'PROCESSING', 8), waiting(BANK, 9)];
    const paged = readOk(worldOf('DOCUMENTS_SUBMITTED', 'DOCUMENTS', many), d(ID, 'x', 20), 'nine documents, the bank letter last');
    expect(stepOf(paged.world), 'nine documents, the bank letter on the last page: IN_REVIEW').toBe('IN_REVIEW');
    expectConsistentDocumentReads(paged, 'nine documents');

    // The unreadable-file path counts the same as a read (Textract, a recording fake, refuses the file).
    const unreadable = (world: World, doc: Doc, what: string) => {
      const run = read({ ...world, textract: { error: 'UnsupportedDocumentException' } }, doc, R);
      const stored = plain(run.world.tables.documents.find((r) => (r['document_id'] as { S: string }).S === docId(doc.n)));
      expect(stored?.['ocr_status'], `${what}: the file waits for HR (MANUAL_REVIEW)`).toBe('MANUAL_REVIEW');
      expect(aiReached(run).filter((s) => s === 'bedrock'), `${what}: Bedrock is never reached`).toEqual([]);
      expect(published(run, 'document.waiting').length, `${what}: HR is told once`).toBe(1);
      return run;
    };
    const rWorld = (stage: string, step: string | null, docs: Doc[]): World => ({
      tables: { employees: [personRow({ id: R, email: R_EMAIL, stage, step, first: 'Sizwe', last: 'Ndaba' })], documents: docs.map((x) => docRow(R, x)), 'document-verification': [], 'talent-flow-users': [] },
    });
    const u1 = unreadable(rWorld('ACTIVE', 'DOCUMENTS', [waiting(ID, 1)]), d(BANK, 'x', 2), 'an unreadable bank letter with the ID in');
    expect(stepOf(u1.world, R), 'an unreadable bank letter with the ID in: IN_REVIEW').toBe('IN_REVIEW');
    const u2 = unreadable(rWorld('ACTIVE', 'DOCUMENTS', []), d(ID, 'x', 1), 'an unreadable ID alone');
    expect(stepOf(u2.world, R), 'an unreadable ID alone: DOCUMENTS').toBe('DOCUMENTS');

    // A read never moves the step back.
    const ahead = readOk(worldOf('DOCUMENTS_SUBMITTED', 'IN_REVIEW', [waiting(ID, 1), waiting(BANK, 2)]), d(MATRIC, 'x', 3), 'In review, a matric is read');
    expect(stepOf(ahead.world), 'In review, a matric is read: still IN_REVIEW').toBe('IN_REVIEW');
    // The ID read at the same moment as the bank letter: its Query runs before the bank row is written.
    const race = readOk(worldOf('DOCUMENTS_SUBMITTED', 'IN_REVIEW', []), d(ID, 'x', 1), 'the ID read while the bank row is not there yet');
    expect(stepOf(race.world), 'the ID read while the bank row is not written yet, step already IN_REVIEW: still IN_REVIEW').toBe('IN_REVIEW');

    // A Verified person stays Verified (stored step, and a row from before this card with no step).
    const v = readOk(worldOf('VERIFIED', 'VERIFIED', [accepted(ID, 1), accepted(BANK, 2)]), d(BANK, 'x', 3), 'Verified, a newer bank letter is read');
    expect(stepOf(v.world), 'Verified, a newer bank letter: step VERIFIED').toBe('VERIFIED');
    expect(stageOf(v.world), 'and stage VERIFIED').toBe('VERIFIED');
    const vOld = readOk(worldOf('VERIFIED', null, [accepted(ID, 1), accepted(BANK, 2)]), d(BANK, 'x', 3), 'Verified with no stored step, a newer bank letter is read');
    expect(stepOf(vOld.world), 'Verified with no stored step: no step written (it answers VERIFIED from the stage)').toBeUndefined();

    // A row from before this card (no stored step) gets the step its documents say.
    const legacy = readOk(worldOf('DOCUMENTS_SUBMITTED', null, [waiting(ID, 1)]), d(MATRIC, 'x', 2), 'DOCUMENTS_SUBMITTED with no step, ID only, a matric is read');
    expect(stepOf(legacy.world), 'DOCUMENTS_SUBMITTED with no stored step and only an ID: DOCUMENTS at the next read').toBe('DOCUMENTS');

    // An S3 event for a person with no row creates no row.
    const noRow: World = { tables: { employees: [personRow({ id: E, email: E_EMAIL, stage: 'ACTIVE', step: 'DOCUMENTS' })], documents: [docRow(GHOST, waiting(ID, 1))], 'document-verification': [], 'talent-flow-users': [] } };
    const ghost = readOk(noRow, d(BANK, 'x', 2), 'a person with no employee row', GHOST);
    expect(who(ghost.world, GHOST), 'a document of a person with no row: no employee row is created').toBeUndefined();
    expect(ghost.world.tables.employees.length, 'still one employee row').toBe(1);

    // A repeat S3 event writes no step.
    const first = readOk(worldOf('ACTIVE', 'DOCUMENTS', [waiting(ID, 1)]), d(BANK, 'x', 2), 'the bank letter');
    const repeat = runHandler(OCR, first.world, s3Event(keyOf(E, d(BANK, 'x', 2))));
    expect(repeat.error, 'a repeat S3 event: no throw').toBeUndefined();
    expect(empWrites(repeat), 'a repeat S3 event: nothing written to the person').toEqual([]);

    // When the step work fails, the read result, the events and HR's email stand.
    for (const fail of [[{ op: 'UpdateItem', table: 'employees', mentions: 'step' }], [{ op: 'Query', table: 'documents' }]] as const) {
      const what = fail[0].op === 'Query' ? 'the documents Query fails' : 'the step write fails';
      const run = readOk({ ...worldOf('ACTIVE', 'DOCUMENTS', [waiting(ID, 1)]), fail: [...fail] }, d(BANK, 'x', 2), what);
      expect(run.response?.body?.ocrStatus, `${what}: the answer still says MANUAL_REVIEW`).toBe('MANUAL_REVIEW');
      expect(stageOf(run.world), `${what}: the stage still moves as today`).toBe('DOCUMENTS_SUBMITTED');
      for (const t of ['document.uploaded', 'ocr.completed', 'document.waiting']) expect(published(run, t).length, `${what}: ${t} published once`).toBe(1);
    }
  });

  test('AC-4 HR\'s decisions keep the step right; only a required send-back moves it back', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    // In review; HR accepts the ID (bank waiting), then the bank letter.
    const w0 = worldOf('DOCUMENTS_SUBMITTED', 'IN_REVIEW', [waiting(ID, 1), waiting(BANK, 2)]);
    const one = decide(w0, 1, 'PASSED', 'accept the ID, the bank waits');
    expect(stepOf(one.world), 'accept the ID while the bank waits: IN_REVIEW').toBe('IN_REVIEW');
    expect(stageOf(one.world), 'and stage DOCUMENTS_SUBMITTED').toBe('DOCUMENTS_SUBMITTED');
    expect(empWrites(one).length <= 1, 'at most one write to the person').toBe(true);
    const two = decide(one.world, 2, 'PASSED', 'accept the bank letter, the last required');
    const ew = empWrites(two);
    expect(ew.length, 'the last acceptance: one write to the person').toBe(1);
    expect(ew[0]!.op, 'an UpdateItem').toBe('UpdateItem');
    const p = who(two.world)!;
    expect(p['stage'], 'stage VERIFIED').toBe('VERIFIED');
    expect(String(p['verified_at'] ?? ''), 'verified_at set').toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(p['step'], 'step VERIFIED').toBe('VERIFIED');
    expect(published(two, 'employee.stage_changed').length, 'employee.stage_changed once').toBe(1);
    expect(published(two, 'onboarding.completed').length, 'onboarding.completed once').toBe(1);
    expect(two.body?.employee_stage_updated, 'employee_stage_updated true').toBe(true);

    // Sending back the newest bank letter: In review to Documents; the stage stays.
    const back = decide(worldOf('DOCUMENTS_SUBMITTED', 'IN_REVIEW', [accepted(ID, 1), waiting(BANK, 2)]), 2, 'FAILED', 'send back the bank letter');
    expect(stepOf(back.world), 'send back the newest bank letter: DOCUMENTS').toBe('DOCUMENTS');
    expect(stageOf(back.world), 'stage stays DOCUMENTS_SUBMITTED').toBe('DOCUMENTS_SUBMITTED');
    expect(empWrites(back).length <= 1, 'at most one write to the person').toBe(true);
    expect(published(back, 'employee.stage_changed').length + published(back, 'onboarding.completed').length, 'nothing published').toBe(0);
    // Same for the ID.
    const backId = decide(worldOf('DOCUMENTS_SUBMITTED', 'IN_REVIEW', [waiting(ID, 1), waiting(BANK, 2)]), 1, 'FAILED', 'send back the ID');
    expect(stepOf(backId.world), 'send back the ID: DOCUMENTS').toBe('DOCUMENTS');

    // A matric, accepted or sent back, leaves the step where it was.
    for (const [step, docs] of [['IN_REVIEW', [waiting(ID, 1), waiting(BANK, 2), waiting(MATRIC, 3)]], ['DOCUMENTS', [waiting(ID, 1), waiting(MATRIC, 3)]]] as const) {
      for (const decision of ['PASSED', 'FAILED'] as const) {
        const run = decide(worldOf('DOCUMENTS_SUBMITTED', step, [...docs]), 3, decision, `${step}: a matric ${decision}`);
        expect(stepOf(run.world), `${step}, a matric ${decision === 'PASSED' ? 'accepted' : 'sent back'}: the step stays ${step}`).toBe(step);
        expect(stageOf(run.world), `${step}, a matric decided: stage stays`).toBe('DOCUMENTS_SUBMITTED');
      }
    }

    // A person with no stored step gets the step their documents say at the next decision.
    const legacy = decide(worldOf('DOCUMENTS_SUBMITTED', null, [waiting(ID, 1)]), 1, 'PASSED', 'no stored step, ID only, HR accepts it');
    expect(stepOf(legacy.world), 'DOCUMENTS_SUBMITTED, no stored step, ID only: DOCUMENTS').toBe('DOCUMENTS');
    const legacy2 = decide(worldOf('DOCUMENTS_SUBMITTED', null, [waiting(ID, 1), waiting(BANK, 2), waiting(MATRIC, 3)]), 3, 'PASSED', 'no stored step, both in, a matric accepted');
    expect(stepOf(legacy2.world), 'no stored step, ID and bank in, a matric accepted: IN_REVIEW').toBe('IN_REVIEW');

    // Any decision on a Verified person leaves the step Verified.
    for (const [n, decision, what] of [[3, 'PASSED', 'a newer bank letter accepted'], [3, 'FAILED', 'a newer bank letter sent back'], [4, 'PASSED', 'a matric accepted'], [4, 'FAILED', 'a matric sent back']] as const) {
      const docs = [accepted(ID, 1), accepted(BANK, 2), waiting(BANK, 3), waiting(MATRIC, 4)];
      const v = decide(worldOf('VERIFIED', 'VERIFIED', docs), n, decision, `Verified, ${what}`);
      expect(stepOf(v.world), `Verified, ${what}: step VERIFIED`).toBe('VERIFIED');
      expect(stageOf(v.world), `Verified, ${what}: stage VERIFIED`).toBe('VERIFIED');
      expect(published(v, 'onboarding.completed').length, `Verified, ${what}: nothing published again`).toBe(0);
      const vOld = decide(worldOf('VERIFIED', null, docs), n, decision, `Verified with no stored step, ${what}`);
      expect([undefined, 'VERIFIED'], `Verified with no stored step, ${what}: no step other than VERIFIED is written`).toContain(stepOf(vOld.world));
    }

    // 403 and 409 write nothing to the person.
    const w403 = worldOf('DOCUMENTS_SUBMITTED', 'IN_REVIEW', [accepted(ID, 1), waiting(BANK, 2)]);
    const refused = runHandler(REVIEW, w403, reviewEvent(docId(2), E, 'FAILED', SELF));
    expect(refused.status, 'the person deciding their own document: 403').toBe(403);
    expect(empWrites(refused), '403: nothing written to the person').toEqual([]);
    expect(who(refused.world), '403: the person unchanged').toEqual(who(w403));
    const w409 = worldOf('DOCUMENTS_SUBMITTED', 'IN_REVIEW', [waiting(ID, 1), sentBack(BANK, 2)]);
    const twice = runHandler(REVIEW, w409, reviewEvent(docId(2), E, 'PASSED', HR));
    expect(twice.status, 'a document already decided: 409').toBe(409);
    expect(empWrites(twice), '409: nothing written to the person').toEqual([]);
    expect(who(twice.world), '409: the person unchanged').toEqual(who(w409));

    // A decision for a person with no employee row creates no row.
    const ghostWorld: World = { tables: { employees: [personRow({ id: E, email: E_EMAIL, stage: 'ACTIVE', step: 'DOCUMENTS' })], documents: [docRow(GHOST, waiting(ID, 1)), docRow(GHOST, waiting(BANK, 2))], 'document-verification': [], 'talent-flow-users': [] } };
    const g1 = decide(ghostWorld, 1, 'PASSED', 'no employee row, accept the ID', GHOST);
    expect(who(g1.world, GHOST), 'no employee row, ID accepted: no row created').toBeUndefined();
    const g2 = decide(g1.world, 2, 'PASSED', 'no employee row, accept the bank letter', GHOST);
    expect(who(g2.world, GHOST), 'no employee row, both accepted: no row created').toBeUndefined();
  });

  test('AC-5 Training and Onboarded appear nowhere in the new app or the steps', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    // The new app.
    const src = join(REPO, 'pepla-web', 'src');
    const found: string[] = [];
    for (const f of filesUnder(src, /\.(ts|html|scss|css|json)$/)) {
      const text = readFileSync(f, 'utf8');
      for (const word of ['TRAINING', 'ONBOARDED', 'DOCUMENTS_SUBMITTED', 'stepOfStage']) if (text.includes(word)) found.push(`${relative(REPO, f)}: ${word}`);
      // The landing page's approved kit copy ("Onboarded, leave approved, certificate expiring.") lives under app/ds/site/ and is the one place "Onboarded" may appear.
      const landingCopy = relative(src, f).split(sep).join('/').startsWith('app/ds/site/');
      for (const word of ['Training', 'Onboarded']) if (!(landingCopy && word === 'Onboarded') && new RegExp(`\\b${word}\\b`).test(text)) found.push(`${relative(REPO, f)}: "${word}"`);
    }
    expect(found, 'pepla-web/src holds none of TRAINING, ONBOARDED, DOCUMENTS_SUBMITTED, stepOfStage, "Training", "Onboarded"').toEqual([]);
    const reads: string[] = [];
    for (const dir of [join(src, 'app', 'core', 'employees'), join(src, 'app', 'features', 'hr')]) {
      for (const f of filesUnder(dir, /\.(ts|html)$/).filter((x) => !x.endsWith('.spec.ts'))) {
        const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/<!--[\s\S]*?-->/g, '');
        for (const m of code.matchAll(/\.stage\b|\bstage\??\s*:|\[\s*['"]stage['"]\s*\]|['"]stage['"]/g)) reads.push(`${relative(REPO, f)}: ${m[0]}`);
      }
    }
    expect(reads, 'core/employees and features/hr never read stage').toEqual([]);

    // The three writing Lambdas name neither.
    for (const h of [POST_AUTH, OCR, REVIEW]) {
      const text = readFileSync(h, 'utf8');
      expect(/TRAINING|ONBOARDED/.test(text), `${relative(REPO, h)} names neither TRAINING nor ONBOARDED`).toBe(false);
    }

    // People at TRAINING and ONBOARDED through each Lambda: no stage or step is written as either, no step answered as either.
    for (const stage of ['TRAINING', 'ONBOARDED']) {
      let w = worldOf(stage, null, [waiting(ID, 1), waiting(BANK, 2)]);
      const runs: Run[] = [];
      runs.push(runHandler(POST_AUTH, w, postAuthEvent(E_EMAIL)));
      w = runs.at(-1)!.world;
      runs.push(read(w, d(MATRIC, 'x', 3)));
      w = runs.at(-1)!.world;
      runs.push(runHandler(REVIEW, w, reviewEvent(docId(1), E, 'PASSED', HR)));
      w = runs.at(-1)!.world;
      runs.push(runHandler(REVIEW, w, reviewEvent(docId(2), E, 'FAILED', HR)));
      w = runs.at(-1)!.world;
      for (const r of runs) {
        expect(r.error, `${stage}: each run finishes`).toBeUndefined();
        expect(valuesWritten(r).filter((v) => v === 'TRAINING' || v === 'ONBOARDED'), `${stage}: nothing written as TRAINING or ONBOARDED`).toEqual([]);
      }
      expect(stepOf(w) ?? null, `${stage}: no stored step is TRAINING or ONBOARDED`).not.toMatch(/^(TRAINING|ONBOARDED)$/);
      const a = answeredStep(w, E);
      for (const v of [a.list, a.one]) expect(STEP_CODES as readonly unknown[], `${stage}: the answered step is one of the four`).toContain(v);
    }
  });

  test('AC-6 The old stage stays next to the step, and the old app still makes sense', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const oldStages = oldAppStages();
    expect([...oldStages].sort(), 'OnboardingStage still lists the six stored stages').toEqual([...STORED_STAGES].sort());
    const seen = new Set<string>();
    const note = (w: World) => {
      for (const r of w.tables.employees) {
        const s = plain(r)?.['stage'];
        if (typeof s === 'string') seen.add(s);
      }
    };

    // Sign-in: INVITED to ACTIVE, with activated_at; nothing else.
    const s1 = runHandler(POST_AUTH, worldOf('INVITED', 'INVITED', []), postAuthEvent(E_EMAIL));
    expect(stageOf(s1.world), 'sign-in: INVITED becomes ACTIVE').toBe('ACTIVE');
    note(s1.world);
    for (const stage of ['ACTIVE', 'DOCUMENTS_SUBMITTED', 'VERIFIED', 'TRAINING', 'ONBOARDED']) {
      const r = runHandler(POST_AUTH, worldOf(stage, null, []), postAuthEvent(E_EMAIL));
      expect(stageOf(r.world), `sign-in at ${stage}: stage unchanged`).toBe(stage);
    }

    // A read: INVITED or ACTIVE become DOCUMENTS_SUBMITTED on the first document read, whatever its type, with documents_started_at.
    for (const stage of ['INVITED', 'ACTIVE']) {
      for (const type of [MATRIC, ID]) {
        const r = readOk(worldOf(stage, null, []), d(type, 'x', 1), `${stage}, the first read (${type})`);
        expect(stageOf(r.world), `${stage}, first read of a ${type}: DOCUMENTS_SUBMITTED`).toBe('DOCUMENTS_SUBMITTED');
        expect(String(who(r.world)?.['documents_started_at'] ?? ''), `${stage}, first read: documents_started_at set`).toMatch(/^\d{4}-\d\d-\d\dT/);
        note(r.world);
      }
    }
    for (const stage of ['DOCUMENTS_SUBMITTED', 'VERIFIED', 'TRAINING', 'ONBOARDED']) {
      const r = readOk(worldOf(stage, null, [waiting(ID, 1)]), d(BANK, 'x', 2), `${stage}, a read`);
      expect(stageOf(r.world), `${stage}, a read: stage unchanged`).toBe(stage);
    }
    // The unreadable-file path never moves the stage, as today.
    const u = read({ tables: { employees: [personRow({ id: R, email: R_EMAIL, stage: 'INVITED', step: 'INVITED' })], documents: [], 'document-verification': [], 'talent-flow-users': [] }, textract: { error: 'UnsupportedDocumentException' } }, d(ID, 'x', 1), R);
    expect(stageOf(u.world, R), 'an unreadable file: the stage stays INVITED, as today').toBe('INVITED');

    // A decision: VERIFIED only when the last required document is accepted; otherwise the stage is not written.
    const dec1 = decide(worldOf('DOCUMENTS_SUBMITTED', 'IN_REVIEW', [waiting(ID, 1), waiting(BANK, 2)]), 1, 'PASSED', 'the ID accepted');
    expect(stageOf(dec1.world), 'the ID accepted: DOCUMENTS_SUBMITTED').toBe('DOCUMENTS_SUBMITTED');
    for (const w of empWrites(dec1)) expect(JSON.stringify(w.input), 'no stage written when not Verified').not.toMatch(/"stage"|\bstage\b\s*=/);
    const dec2 = decide(dec1.world, 2, 'PASSED', 'the bank accepted');
    expect(stageOf(dec2.world), 'both accepted: VERIFIED').toBe('VERIFIED');
    note(dec2.world);

    // Both answers still carry the stage.
    const a = answeredStep(dec1.world, E);
    expect(a.listStage, 'GET /v1/employees still answers stage').toBe('DOCUMENTS_SUBMITTED');
    expect(a.oneStage, 'GET /v1/employees/{id}/verifications still answers employee.stage').toBe('DOCUMENTS_SUBMITTED');

    // Every stage the Lambdas wrote here and every seeded stage is one the old app knows.
    for (const s of seen) expect(oldStages, `the Lambdas write stage ${s}, which the old app knows`).toContain(s);
    const seeded = seedStages();
    expect(seeded.length, 'the seed writes stages (eight demo people and the test employee)').toBeGreaterThanOrEqual(9);
    for (const s of seeded) expect(oldStages, `seed-dev.py writes stage ${s}, which the old app knows`).toContain(s);
  });

  test('AC-7 HR home and the employee page show the step from the API, not their own mapping', async ({ page, signIn, hr, list, docs }) => {
    noBackendOnly();
    const people = homePeople();
    list!.people = people.map((x) => x.p);
    await openHome(page, signIn, hr);
    await expect(personRows(page)).toHaveCount(people.length, { timeout: 20_000 });
    const want: Record<string, number> = { Invited: 0, Documents: 0, 'In review': 0, Verified: 0 };
    for (const x of people) if (x.want !== 'Not set') want[x.want]!++;
    for (const label of WORDS) await expect(statValue(page, label), `HR home: the "${label}" count follows step`).toHaveText(String(want[label]));
    const cells = await stepCells(page);
    for (const x of people) {
      const name = `${x.p.first_name} ${x.p.last_name}`;
      expect(cells[name], `HR home: ${name} (stage ${x.p.stage}, step ${x.p.step === undefined ? 'left out' : JSON.stringify(x.p.step)}) shows ${x.want}`).toBe(x.want);
    }
    const homeAxe = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.impact}: ${v.id} ${v.help}`);
    expect(homeAxe, 'axe on HR home').toEqual([]);

    const ppl = pagePeople();
    docs!.add(...ppl.map((x) => x.p));
    for (const [i, x] of ppl.entries()) {
      await openPerson(page, signIn, hr, x.p, false);
      void i;
      const shown = await headerSteps(page);
      expect(shown, `employee page, ${x.what}: the header lozenge ${x.want ? `reads ${x.want}` : 'shows no step'}`).toEqual(x.want ? [x.want] : []);
      if (x.want) await expect(header(page).locator('pp-lozenge', { hasText: new RegExp(`^\\s*${esc(x.want)}\\s*$`) }), `${x.what}: the step is a visible lozenge`).toBeVisible();
      for (const other of WORDS.filter((w) => w !== x.want)) await expect(header(page).getByText(other, { exact: true }), `${x.what}: not ${other}`).toHaveCount(0);
    }
    const pageAxe = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.impact}: ${v.id} ${v.help}`);
    expect(pageAxe, 'axe on the employee page').toEqual([]);
  });

  test('AC-8 Phone: every heading, count, step lozenge and button is visible, clear of the top bar, and nothing scrolls sideways', async ({ page, signIn, hr, list, docs }, testInfo) => {
    noBackendOnly();
    test.skip(testInfo.project.name !== 'phone-390', 'The phone criterion: 390 wide.');
    const people = homePeople();
    people[0]!.p.first_name = 'Nokuthula-Precious';
    people[0]!.p.last_name = 'Mahlangu-Vilakazi';
    list!.people = people.map((x) => x.p);
    await openHome(page, signIn, hr);
    await expect(personRows(page)).toHaveCount(people.length, { timeout: 20_000 });
    for (const label of WORDS) await expect(statValue(page, label), `HR home at 390: the "${label}" count is visible`).toBeVisible();
    expect(await noSidewaysScroll(page), 'HR home at 390: nothing scrolls sideways').toEqual([]);
    expect(await hiddenOrCovered(page), 'HR home at 390: every heading, count, link and button is visible and not under the top bar').toEqual([]);

    const p: FakePerson = { employee: { ...storedEmployee({ first_name: 'Nokuthula-Precious', last_name: 'Mahlangu-Vilakazi', job_title: 'Senior Payroll and Benefits Administrator', stage: 'VERIFIED' }), step: 'IN_REVIEW' }, documents: [] };
    docs!.add(p);
    await openPerson(page, signIn, hr, p, false);
    const lozenge = header(page).locator('pp-lozenge', { hasText: /^\s*In review\s*$/ });
    await expect(lozenge, 'employee page at 390: the step lozenge is visible').toBeVisible();
    const box = (await lozenge.boundingBox())!;
    expect(box.x >= 0 && box.x + box.width <= 391, 'the step lozenge is inside the 390 width').toBe(true);
    expect(await noSidewaysScroll(page), 'employee page at 390: nothing scrolls sideways').toEqual([]);
    expect(await hiddenOrCovered(page), 'employee page at 390: every heading, lozenge, link and button is visible and not under the top bar').toEqual([]);
  });

  test('AC-9 The API spec gives step on both answers and lists the six stored stages', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    for (const [route, field] of [['/v1/employees', 'items[].step'], ['/v1/employees/{id}/verifications', 'employee.step']] as const) {
      const f = openapiField(route, 'get', '200', field);
      expect(f.found, `GET ${route} 200 lists ${field}`).toBe(true);
      expect(f.type === 'string' || (Array.isArray(f.type) && (f.type as unknown[]).includes('string')), `${field} is a string`).toBe(true);
      expect([...(f.enum ?? [])].sort(), `${field} lists exactly the four codes`).toEqual([...STEP_CODES].sort());
      expect(f.nullable, `${field} may be null`).toBe(true);
      for (const code of STEP_CODES) expect(f.description ?? '', `${field}'s description gives the meaning of ${code}`).toContain(code);
    }
    for (const [route, field] of [['/v1/employees', 'items[].stage'], ['/v1/employees/{id}/verifications', 'employee.stage']] as const) {
      const s = openapiField(route, 'get', '200', field);
      expect(s.found, `GET ${route} 200 still lists ${field}`).toBe(true);
      expect([...(s.enum ?? [])].sort(), `${field} lists the six stored stages`).toEqual([...STORED_STAGES].sort());
      expect(s.description ?? '', `${field} says it is kept for the old app`).toMatch(/old app/i);
      expect(s.description ?? '', `${field} says until OPS-04`).toMatch(/OPS-04/);
    }
  });

  test('AC-10 Only the OCR role gains a permission: Query on the documents table', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const BASE = join(__dirname, 'support', 'onb-09', 'iam.five-roles.3076735.tf.txt');
    const before = (type: string, name: string) => {
      const b = blocks([BASE], 'resource').filter((x) => x.labels[0] === type && x.labels[1] === name);
      expect(b.length, `baseline has ${type}.${name}`).toBe(1);
      return b[0]!;
    };
    const roles = ['cognito_post_auth', 'process_document_ocr', 'review_document_verification', 'get_employees', 'get_employee_document_verifications'];
    for (const name of roles) {
      for (const type of ['aws_iam_role', 'aws_iam_role_policy']) {
        const now = resourcesNamed(type, name);
        expect(now.length, `${type}.${name} is declared once`).toBe(1);
        if (type === 'aws_iam_role' || name !== 'process_document_ocr') {
          expect(squash(now[0]!.raw), `${type}.${name} is unchanged`).toBe(squash(before(type, name).raw));
        }
      }
    }

    // The OCR role: everything it had, plus Query on table/documents, and nothing else new.
    const now = resourcesNamed('aws_iam_role_policy', 'process_document_ocr')[0]!;
    const old = before('aws_iam_role_policy', 'process_document_ocr');
    const oldAttrs = new Map([...old.body.matchAll(/^\s*(name|role)\s*=\s*(.+)$/gm)].map((m) => [m[1]!, m[2]!.trim()]));
    for (const attr of ['name', 'role']) expect(now.attrs.get(attr), `the OCR policy's ${attr} is unchanged (no replacement)`).toBe(oldAttrs.get(attr));
    const pNow = policyOf(now);
    const pOld = policyOf({ ...now, raw: old.raw, body: old.body });
    const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
    const stmts = (p: Policy): Statement[] => list(p.Statement as never) as unknown as Statement[];
    const oldActions = new Set(stmts(pOld).flatMap((s) => list(s.Action)));
    const oldResources = new Set(stmts(pOld).flatMap((s) => list(s.Resource)));
    const actions = new Set([...oldActions, 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:BatchWriteItem', 'dynamodb:TransactWriteItems', 'dynamodb:PartiQLSelect', 's3:PutObject', 's3:DeleteObject', 'kms:Encrypt']);
    const tables = ['documents', 'employees', 'document-verification', 'talent-flow-users'];
    const resources = new Set([...oldResources, ...tables.map(tableArn), ...tables.map((t) => `${tableArn(t)}/index/email-index`), `${tableArn('documents')}/index/anything`, `${tableArn('documents')}/stream/2026`, '*']);
    const gained: string[] = [];
    const lost: string[] = [];
    for (const action of actions) {
      for (const resource of resources) {
        const a = iamDecide(pNow, { action, resource }) === 'allowed';
        const b = iamDecide(pOld, { action, resource }) === 'allowed';
        if (a && !b) gained.push(`${action} on ${resource}`);
        if (b && !a) lost.push(`${action} on ${resource}`);
      }
    }
    expect(lost, 'the OCR role keeps every permission it had').toEqual([]);
    expect(gained, 'the OCR role gains exactly Query on table/documents').toEqual([`dynamodb:Query on ${tableArn('documents')}`]);
    expect(stmts(pNow).some((s) => s.Effect === 'Allow' && list(s.Action).some((a) => a === '*' || a === 'dynamodb:*' || a === 'dynamodb:Q*')), 'no wildcard action').toBe(false);

    // No other policy or attachment reaches the five roles.
    const extra: string[] = [];
    for (const type of ['aws_iam_role_policy', 'aws_iam_role_policy_attachment', 'aws_iam_policy_attachment']) {
      for (const b of blocks(tfFiles(), 'resource').filter((x) => x.labels[0] === type)) {
        for (const name of roles) {
          if (new RegExp(`aws_iam_role\\.${name}\\b`).test(b.body) && !(type === 'aws_iam_role_policy' && b.labels[1] === name)) extra.push(`${type}.${b.labels[1]} -> ${name}`);
        }
      }
    }
    expect(extra, 'no other policy or attachment is added to the five roles').toEqual([]);
  });

  test('AC-11 pepla-dev: every seeded person returns a step @pepla-dev', async ({ page, signIn, hr }, testInfo) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only: AC-1 holds the Lambdas to this in the no-backend run.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once: it only reads.');
    test.setTimeout(180_000);
    const employeesApi = devApi('employeesApiUrl');
    const documentsApi = devApi('documentUploadApiUrl');
    const token = await signInForToken(page, signIn, hr);
    const auth = { Authorization: `Bearer ${token}` };

    const people: Array<Record<string, unknown>> = [];
    let key: string | undefined;
    for (let n = 0; n < 50; n++) {
      const r = await page.request.get(`${employeesApi}/v1/employees${key ? `?lastKey=${encodeURIComponent(key)}` : ''}`, { headers: auth });
      expect(r.status(), `GET /v1/employees answers HR (${r.status()})`).toBe(200);
      const body = (await r.json()) as { items?: Array<Record<string, unknown>>; lastKey?: string };
      people.push(...(body.items ?? []));
      key = body.lastKey;
      if (!key) break;
    }
    const find = (first: string, last: string) => {
      const p = people.find((x) => x['first_name'] === first && x['last_name'] === last);
      expect(p, `${first} ${last} is on the list`).toBeTruthy();
      return p!;
    };
    const seeded: Array<[string, string, string, Code]> = [
      ['Lerato', 'Mokoena', 'INVITED', 'INVITED'],
      ['Mwila', 'Phiri', 'INVITED', 'INVITED'],
      ['Pieter', 'van Wyk', 'ACTIVE', 'DOCUMENTS'],
      ['Kagiso', 'Nkosi', 'ACTIVE', 'DOCUMENTS'],
      ['Naledi', 'Dlamini', 'DOCUMENTS_SUBMITTED', 'IN_REVIEW'],
      ['Tendai', 'Moyo', 'VERIFIED', 'VERIFIED'],
      ['Chipo', 'Banda', 'TRAINING', 'VERIFIED'],
      ['Ayesha', 'Patel', 'ONBOARDED', 'VERIFIED'],
    ];
    for (const [first, last, stage, step] of seeded) {
      const p = find(first, last);
      expect(p['step'], `${first} ${last}: step ${step}`).toBe(step);
      expect(p['stage'], `${first} ${last}: stage ${stage}, as seeded`).toBe(stage);
    }
    const sipho = find('Sipho', 'Demo-Starter');
    expect(STEP_CODES as readonly unknown[], 'Sipho Demo-Starter: one of the four steps').toContain(sipho['step']);
    for (const p of people) expect(['TRAINING', 'ONBOARDED'], `${String(p['first_name'])} ${String(p['last_name'])}: step is not TRAINING or ONBOARDED`).not.toContain(p['step']);

    const naledi = find('Naledi', 'Dlamini');
    const r = await page.request.get(`${documentsApi}/v1/employees/${encodeURIComponent(String(naledi['employee_id']))}/verifications`, { headers: auth });
    expect(r.status(), `Naledi's documents route answers HR (${r.status()})`).toBe(200);
    const body = (await r.json()) as { employee?: { step?: unknown; stage?: unknown } };
    expect(body.employee?.step, "Naledi's employee.step: IN_REVIEW").toBe('IN_REVIEW');
    expect(body.employee?.stage, "Naledi's employee.stage: DOCUMENTS_SUBMITTED").toBe('DOCUMENTS_SUBMITTED');
  });
});
