import { join } from 'node:path';
import { A, B, PEOPLE, baseTables, eventOf, plain, settings, type Person, type Who } from '../chat-02/world';
import { LAMBDA, httpEvent, runHandler, type Fetch, type FetchRule, type ModelScript, type Run, type Tables } from './harness';

/**
 * CHAT-09: the people, rows, Agent API answers and runs of the card's acceptance criteria. Written from
 * /mnt/project-files/ask-batsi-chat/CHAT-09-person-page-facts.md (19 Nov 2026, after the independent check). Everything is made up;
 * the people are the dev example of Iggie's screenshots (Pieter van Wyk) and the Today list around him.
 *
 *   Company A  the founding company: nalekoAiChat serves it (AGENT_TENANT_ID), Ask Batsi is switched on for it (CHAT-02's switch).
 *   Company B  another company: the chat answers it 403 (until CHAT-04); the routes answer it 404 for A's people.
 *
 * Today is Thursday 19 Nov 2026 in South Africa (NOW, 10:00 SAST). The week of today runs Mon 16 Nov to Sun 22 Nov.
 */
export { A, B, PEOPLE, baseTables, plain, type Person, type Who };

export const CHAT = join(LAMBDA, 'nalekoAiChat', 'index.mjs');
export const GET_EMPLOYEE = join(LAMBDA, 'getEmployee', 'index.mjs');
export const DOCS_ROUTE = join(LAMBDA, 'getDocumentVerifications', 'index.mjs');
export const KEY = 'agent-key-chat09-fake';
export const SECRET = 'naleko/agent/api-key';
export const RATE = 'NalekoAiRateLimit';
export const AUDIT = 'naleko-agent-audit';
export const CHATS = 'ask-batsi-chats';

/** 10:00 on Thursday 19 Nov 2026 in South Africa. */
export const NOW = '2026-11-19T08:00:00.000Z';
export const TODAY = '2026-11-19';
export const TODAY_WRITTEN = 'Thursday 19 Nov 2026';

// ---------------------------------------------------------------- words the model may be given (the spec's lists)

export const STEP_WORD = { INVITED: 'Invited', DOCUMENTS: 'Documents', IN_REVIEW: 'In review', VERIFIED: 'Verified' } as const;
export const DOC_WORD = { NATIONAL_ID: 'ID document', BANK_CONFIRMATION: 'Bank letter', MATRIC_CERTIFICATE: 'Matric certificate', TERTIARY_QUALIFICATION: 'Tertiary qualifications' } as const;
export const CHECK_WORD = { MATCHES: 'Matches', NEEDS_A_LOOK: 'Needs a look', DOESNT_MATCH: "Doesn't match", READING: 'Being checked', MISSING: 'Missing' } as const;
export const DECISION_WORD = { ACCEPTED: 'Accepted', NEW_ONE_ASKED: 'New one asked for', NONE: 'Not decided' } as const;
export const RISK = { NONE: 'Not assessed', LOW: 'Batsi rated the risk low', MEDIUM: 'Batsi rated the risk medium', HIGH: 'Batsi rated the risk high', UNKNOWN: 'Batsi could not check the risk' } as const;
export const START_NOT_SET = 'Start date not set';
export const DOCS_UNREAD = 'Documents could not be read';

/** The four fixed sentences ("Words" in the spec). */
export const SAY = {
  NOTHING_TO_CHECK: "None of this person's documents has been checked yet, so there is nothing to assess.",
  NOT_FOUND: 'I could not find that person in this company.',
  NOT_ALLOWED: 'I could not get this information just now.',
  UNAVAILABLE: 'I could not get this information just now. Try again in a minute.',
} as const;

/** Exactly the keys the model gets for one person ("What gets built" 2); documents_unknown only when the documents call failed. */
export const FACT_KEYS = ['name', 'email', 'department', 'job_title', 'hr_partner', 'step', 'start', 'start_written', 'due', 'due_written', 'risk', 'documents', 'ready_to_start', 'because', 'days_until_start', 'documents_overdue'];
export const DOC_ROW_KEYS = ['document', 'required', 'check', 'hr_decision', 'uploaded_written', 'decided_written'];
/** Exactly the keys of one person in a list ("What gets built" 3). */
export const LIST_PERSON_KEYS = ['name', 'department', 'job_title', 'step', 'start', 'start_written', 'due', 'due_written', 'documents_overdue', 'hr_partner', 'employee_id'];
export const LIST_KEYS = ['today', 'complete', 'total_matching', 'counts_by_step', 'overdue_count', 'shown', 'people'];

// ---------------------------------------------------------------- stored rows (DynamoDB attribute values)

type Plain = string | number | boolean | undefined | null;
export const av = (values: Record<string, Plain>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    out[k] = v === null ? { NULL: true } : typeof v === 'number' ? { N: String(v) } : typeof v === 'boolean' ? { BOOL: v } : { S: v };
  }
  return out;
};

/** Values that must never reach the model or the browser from the new code. */
export const SECRET_VALUES = { phone: '0821234567', last4: '0083', idNumber: '9803145800083', partnerEmail: 'thandi.partner@sunbird.example', encrypted: 'AQICAHgENCRYPTEDBLOB' };

export type EmpRow = {
  id: string; first: string; last: string; email?: string; department?: string; job_title?: string; stage?: string; step?: string;
  start?: string; partnerId?: string; partnerName?: string; createdAt?: string; createdBy?: string; c?: string | null;
  riskBand?: string; riskReason?: string; riskAt?: string;
};

/** An employee row as createEmployee and the risk check store it, with the private fields that must never reach an answer. */
export function employeeRow(e: EmpRow) {
  return av({
    employee_id: e.id, first_name: e.first, last_name: e.last, email: e.email ?? `${e.first.toLowerCase()}@sunbird.example`,
    department: e.department ?? 'Operations', job_title: e.job_title ?? '', stage: e.stage ?? 'INVITED', step: e.step,
    planned_start_date: e.start ?? '', hr_staff_id: e.partnerId ?? '', hr_staff_name: e.partnerName ?? '', hr_staff_email: SECRET_VALUES.partnerEmail,
    phone: SECRET_VALUES.phone, id_number_last4: SECRET_VALUES.last4, national_id_encrypted: SECRET_VALUES.encrypted,
    created_at: e.createdAt ?? '2026-11-01T09:00:00.000Z', created_by: e.createdBy ?? 'STAFF-A1', updated_at: '2026-11-02T09:00:00.000Z',
    riskBand: e.riskBand, riskReason: e.riskReason, riskAssessedAt: e.riskAt,
    ...(e.c === null ? {} : { tenant_id: e.c ?? A }),
  });
}

/** A document row as the upload and review Lambdas store it, with a file key, a file name and an ID number that must never reach an answer. */
export function documentRow(employeeId: string, documentId: string, type: string, status: string, d: { verification?: string; at?: string; reviewed?: string; c?: string } = {}) {
  return av({
    employee_id: employeeId, document_id: documentId, document_type: type, ocr_status: status, verification_id: d.verification,
    upload_timestamp: d.at, hr_reviewed_at: d.reviewed, s3_key: `uploads/${employeeId}/${documentId}-SECRET-FILE.pdf`, file_name: `SECRET-${documentId}.pdf`,
    extracted_id_number: SECRET_VALUES.idNumber, tenant_id: d.c ?? A,
  });
}

/** A verification row as the document reader stores it. */
export function verificationRow(id: string, employeeId: string, documentId: string, type: string, check: string | undefined, c = A) {
  return av({ verificationId: id, employeeId, documentId, documentType: type, confidence: 95, decision: 'PASS', check, createdAt: '2026-11-12T08:00:00.000Z', idNumber: SECRET_VALUES.idNumber, tenant_id: c });
}

export const PIETER = 'c91373d3-5b1a-53b4-a79e-1a4ff7190b7a';
/** Pieter van Wyk as on dev: old stage ACTIVE and no step, start 10 Nov 2026, no documents, no risk check. */
export const pieterRow = (over: Partial<EmpRow> = {}) => employeeRow({
  id: PIETER, first: 'Pieter', last: 'van Wyk', email: 'pieter.vanwyk@sunbird.example', department: 'Operations', job_title: 'Warehouse Lead',
  stage: 'ACTIVE', start: '2026-11-10', partnerId: 'STAFF-THANDI', partnerName: 'Thandi Demo-HR', ...over,
});

export type Docs = { documents?: Record<string, unknown>[]; verifications?: Record<string, unknown>[] };
/** The tables the two routes read: the people given, their documents and verifications, and a company B person with documents. */
export function tablesWith(people: Record<string, unknown>[], d: Docs = {}): Tables {
  const bee = employeeRow({ id: 'EMP-B-0001', first: 'Bee', last: 'Ngcobo', c: B, stage: 'DOCUMENTS_SUBMITTED' });
  return {
    ...baseTables('on'),
    employees: [bee, ...people],
    documents: [documentRow('EMP-B-0001', 'doc-b-1', 'NATIONAL_ID', 'PASSED', { c: B, at: '2026-11-10T08:00:00.000Z', reviewed: '2026-11-11T08:00:00.000Z' }), ...(d.documents ?? [])],
    'document-verification': [verificationRow('ver-b-1', 'EMP-B-0001', 'doc-b-1', 'NATIONAL_ID', 'MATCHES', B), ...(d.verifications ?? [])],
  } as Tables;
}

// ---------------------------------------------------------------- the routes behind the Agent API, run for real

const agentEvent = (route: string, c: string, a: { path?: Record<string, string>; query?: Record<string, string> } = {}) =>
  httpEvent({ route, path: a.path, query: a.query, authorizer: { lambda: { actor: 'AGENT', tenant_id: c } } });

export type Out = { run: Run; status: number | undefined; json: any; text: string };
const outOf = (run: Run): Out => {
  const text = typeof run.response?.body === 'string' ? run.response.body : '';
  let json: any;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { run, status: run.response?.statusCode, json, text };
};

/** GET /agent/v1/employees/{id} as the Agent API calls it for a company (the real getEmployee Lambda). */
export const employeeRoute = (tables: Tables, id: string, c = A): Out => outOf(runHandler(GET_EMPLOYEE, agentEvent('GET /agent/v1/employees/{id}', c, { path: { id } }), { tables, now: NOW }));

/** GET /agent/v1/verifications?employee_id= as the Agent API calls it (the real getDocumentVerifications Lambda). */
export const documentsRoute = (tables: Tables, id: string, c = A): Out => outOf(runHandler(DOCS_ROUTE, agentEvent('GET /agent/v1/verifications', c, { query: { employee_id: id } }), { tables, now: NOW }));

/** The Agent API rules for one person, answered by the real routes on these tables (the documents rule first: its URL is longer). */
export function personRules(tables: Tables, id: string): FetchRule[] {
  const docs = documentsRoute(tables, id);
  const emp = employeeRoute(tables, id);
  return [
    { method: 'GET', url: `/agent/v1/verifications?employee_id=${id}`, status: docs.status, json: docs.json },
    { method: 'GET', url: `/agent/v1/employees/${id}`, status: emp.status, json: emp.json },
  ];
}

export const agentApi = (rules: FetchRule[]): Fetch => ({ keys: [KEY], rules });

// ---------------------------------------------------------------- the people list the Agent API answers (getEmployees' item shape)

export type ListPerson = {
  id: string; first: string; last: string; department?: string; job_title?: string; step: string | null; start?: string;
  partnerId?: string; partnerName?: string; createdAt?: string; createdBy?: string;
};

const minus7 = (day: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
};

/** One item as GET /agent/v1/employees answers it today (getEmployees' formattedItems), private fields included. */
export function listItem(p: ListPerson) {
  return {
    employee_id: p.id, first_name: p.first, middle_name: '', last_name: p.last, email: `${p.first.toLowerCase()}@sunbird.example`,
    phone: SECRET_VALUES.phone, department: p.department ?? 'Operations', job_title: p.job_title ?? 'Clerk',
    stage: p.step === 'DOCUMENTS' ? 'ACTIVE' : p.step ?? 'ODD_STAGE', step: p.step, offer_accept_date: '2026-10-01',
    planned_start_date: p.start ?? '', documents_due: minus7(p.start ?? ''), created_at: p.createdAt ?? '2026-11-01T09:00:00.000Z',
    created_by: p.createdBy ?? 'STAFF-OTHER', hr_staff_id: p.partnerId ?? '', hr_staff_name: p.partnerName ?? '', hr_staff_email: SECRET_VALUES.partnerEmail,
    id_number_last4: SECRET_VALUES.last4,
  };
}

/**
 * The Today list of the screenshots (company A), with dates around today (Thu 19 Nov 2026). Overdue: step Invited or Documents and the
 * due date (start minus 7) before today. The asker (a1: sub `sub-a1`, staff id `STAFF-A1`, username `user-a1`) is HR partner of three
 * people by three different ids, and added two people.
 */
export const TODAY_PEOPLE: ListPerson[] = [
  { id: 'E01', first: 'Pieter', last: 'van Wyk', department: 'Operations', job_title: 'Warehouse Lead', step: 'DOCUMENTS', start: '2026-11-10', partnerId: 'STAFF-THANDI', partnerName: 'Thandi Demo-HR', createdAt: '2026-11-01T09:00:00.000Z' },
  { id: 'E02', first: 'Mobile', last: 'Test', department: 'Engineering', job_title: 'Developer', step: 'INVITED', start: '2026-11-19', createdAt: '2026-11-03T09:00:00.000Z' },
  { id: 'E03', first: 'Robot', last: 'TestEmployee', department: 'Engineering', step: 'INVITED', start: '2026-11-20', createdAt: '2026-11-04T09:00:00.000Z' },
  { id: 'E04', first: 'Test', last: 'EmailDev', department: 'Operations', job_title: 'Manager', step: 'IN_REVIEW', start: '2026-11-17', createdAt: '2026-11-02T09:00:00.000Z' },
  { id: 'E05', first: 'Ryan', last: 'Giggs', department: 'Engineering', job_title: 'Engineer', step: 'INVITED', start: '2026-12-01', createdAt: '2026-11-05T09:00:00.000Z' },
  { id: 'E06', first: 'Ayesha', last: 'Patel', department: 'Marketing', step: 'VERIFIED', start: '2026-12-01', createdAt: '2026-11-06T09:00:00.000Z' },
  { id: 'E07', first: 'Chipo', last: 'Banda', department: 'People', step: 'VERIFIED', start: '2026-12-01', createdAt: '2026-11-07T09:00:00.000Z' },
  { id: 'E08', first: 'Lindiwe', last: 'Khumalo', department: 'Finance', step: 'DOCUMENTS', start: '', partnerId: 'user-a1', partnerName: 'Iggie Asker', createdAt: '2026-11-08T09:00:00.000Z' },
  { id: 'E09', first: 'Sipho', last: 'Nkosi', department: 'Finance', step: 'VERIFIED', start: '', createdAt: '2026-11-09T09:00:00.000Z', createdBy: 'STAFF-A1' },
  { id: 'E10', first: 'Thabo', last: 'Mokoena', department: 'Operations', step: 'DOCUMENTS', start: '2026-11-23', partnerId: 'STAFF-A1', partnerName: 'Iggie Asker', createdAt: '2026-11-10T09:00:00.000Z', createdBy: 'STAFF-A1' },
  { id: 'E11', first: 'Naledi', last: 'Dube', department: ' operations ', step: 'IN_REVIEW', start: '2026-11-26', partnerId: 'sub-a1', partnerName: 'Iggie Asker', createdAt: '2026-11-11T09:00:00.000Z' },
  { id: 'E12', first: 'Zanele', last: 'Mthembu', department: 'People', step: null, start: '2026-11-25', createdAt: '2026-11-12T09:00:00.000Z' },
];

/** The list route's answers, `per` people a page, chained by lastKey (P2, P3, ...). Later pages' rules come first (first match wins). */
export function listRules(people: ListPerson[], per = 200): FetchRule[] {
  const pages: ListPerson[][] = [];
  for (let i = 0; i < people.length; i += per) pages.push(people.slice(i, i + per));
  if (pages.length === 0) pages.push([]);
  const rules: FetchRule[] = [];
  pages.forEach((page, i) => {
    const json = { items: page.map(listItem), count: page.length, ...(i < pages.length - 1 ? { lastKey: `P${i + 2}` } : {}), staff_id: 'agent' };
    rules.push({ method: 'GET', url: i === 0 ? '/agent/v1/employees?' : `lastKey=P${i + 1}`, status: 200, json });
  });
  // Page 1's rule matches every list URL, so it goes last.
  return [...rules.slice(1).reverse(), rules[0]!];
}

/** Many made-up people with a start date each (for paging and size). */
export function manyPeople(n: number, nameLength = 12): ListPerson[] {
  const out: ListPerson[] = [];
  for (let i = 0; i < n; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const pad = (s: string) => (s + 'x'.repeat(nameLength)).slice(0, nameLength);
    out.push({ id: `M${String(i).padStart(5, '0')}`, first: pad(`First${i}`), last: pad(`Last${i}`), department: pad('Department'), job_title: pad('Job title'), step: 'DOCUMENTS', start: `2026-12-${day}`, partnerName: pad('Partner') });
  }
  return out;
}

// ---------------------------------------------------------------- asking Batsi

export type AskOpts = {
  bedrock?: ModelScript; fetch?: Fetch; who?: Who | Person; claims?: Record<string, string>; focus?: string; now?: string;
  tables?: Tables; env?: Record<string, string | undefined>;
};

/** A question from an HR person to Batsi (the real chat Lambda), answered by the script and the fake Agent API. */
export function ask(question: string, o: AskOpts = {}): Out {
  const body = { message: question, templateId: 'freeform', screenContext: o.focus ? { view: 'person', employeeId: o.focus } : { view: 'today' } };
  const run = runHandler(CHAT, eventOf(o.who ?? 'a1', 'POST /agent/v1/ai-chat', { body, claims: { 'cognito:username': 'user-a1', ...(o.claims ?? {}) } }), {
    tables: o.tables ?? baseTables('on'),
    env: settings('nalekoAiChat', o.env),
    bedrock: o.bedrock,
    fetch: o.fetch,
    now: o.now ?? NOW,
    secrets: { [SECRET]: { AWSCURRENT: KEY } },
  });
  return outOf(run);
}

export const SENTENCE = 'Here is what I found.';
/** The model calls these lookups in turn, then answers. */
export const calls = (...tools: { name: string; input?: Record<string, unknown> }[]): ModelScript => ({
  intent: 'TOOL_REQUIRED',
  answers: [...tools.map((t) => ({ tool: { name: t.name, input: t.input ?? {} } })), { text: SENTENCE }],
});
export const lookUpPerson = (id: string) => calls({ name: 'get_employee', input: { id } });
export const listPeople = (input: Record<string, unknown> = {}) => calls({ name: 'list_employees', input });

export const modelCalls = (run: Run) => (run.calls as any[]).filter((c) => c.service === 'bedrock');
export const answerCalls = (run: Run) => modelCalls(run).filter((c) => c.kind === 'answer');
export const httpCalls = (run: Run) => (run.calls as any[]).filter((c) => c.service === 'http');
export const dynamo = (run: Run, table?: string) => (run.calls as any[]).filter((c) => c.service === 'dynamodb' && (!table || c.table === table));
export const writes = (run: Run) => dynamo(run).filter((c) => /^(PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems)$/.test(c.op));

/** The user message of the first answer call: what the turn told the model (the XML context and the question). */
export function turnText(run: Run): string {
  const first = answerCalls(run)[0];
  const msgs = first?.body?.messages ?? [];
  const last = msgs[msgs.length - 1];
  return typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
}

/** The system prompt the model was given, as text. */
export function systemText(run: Run): string {
  const system = answerCalls(run)[0]?.body?.system;
  return Array.isArray(system) ? system.map((b: any) => b.text).join('\n') : String(system ?? '');
}

export type ToolContent = { tool: string; input: any; text: string; json: any; isError: boolean };
/** Every lookup result the model was given in this turn, in order: the tool's name and input, the content as text and parsed. */
export function toolContents(run: Run): ToolContent[] {
  const all = answerCalls(run);
  const last = all[all.length - 1];
  const msgs: any[] = last?.body?.messages ?? [];
  const uses = new Map<string, { name: string; input: any }>();
  const out: ToolContent[] = [];
  for (const m of msgs) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === 'tool_use') uses.set(b.id, { name: b.name, input: b.input });
      if (b.type === 'tool_result') {
        const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
        let json: any;
        try { json = JSON.parse(text); } catch { json = undefined; }
        const u = uses.get(b.tool_use_id);
        out.push({ tool: u?.name ?? '?', input: u?.input, text, json, isError: b.is_error === true });
      }
    }
  }
  return out;
}

/** The one content the model got for the named lookup (the last one, when it was called more than once). */
export function contentOf(run: Run, tool: string): ToolContent | undefined {
  return toolContents(run).filter((c) => c.tool === tool).pop();
}

/** Asks about one person: the model calls get_employee for them; the Agent API answers from the real routes on these tables. */
export function askPerson(id: string, tables: Tables, o: AskOpts & { extra?: FetchRule[] } = {}): { out: Out; facts: any; content: ToolContent | undefined } {
  const out = ask(o.focus ? 'Is he ready to start on Monday?' : 'Tell me about this person', { bedrock: lookUpPerson(id), fetch: agentApi([...(o.extra ?? []), ...personRules(tables, id)]), focus: id, ...o });
  const content = contentOf(out.run, 'get_employee');
  return { out, facts: content?.json, content };
}

/** Asks for a list: the model calls list_employees with this input; the Agent API answers these people. */
export function askList(input: Record<string, unknown>, people: ListPerson[] = TODAY_PEOPLE, o: AskOpts & { per?: number } = {}): { out: Out; list: any; content: ToolContent | undefined } {
  const out = ask('Who starts soonest?', { bedrock: listPeople(input), fetch: agentApi(listRules(people, o.per)), ...o });
  const content = contentOf(out.run, 'list_employees');
  return { out, list: content?.json, content };
}

export const WHAT = (o: Out) => (o.run.error ? `crashed: ${o.run.error.message.slice(0, 200)}` : `status ${o.status}: ${o.text.slice(0, 200)}`);
