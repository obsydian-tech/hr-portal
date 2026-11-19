import { join } from 'node:path';
import { A, B, PEOPLE, baseTables, eventOf, plain, settings, type Who } from '../chat-02/world';
import { LAMBDA, httpEvent, runHandler, type FetchScript, type ModelScript, type Row, type Run, type Tables } from './harness';

/**
 * CHAT-05: the people, documents, tables and calls of the card's acceptance criteria. Written from
 * /mnt/project-files/ask-batsi-chat/CHAT-05-answer-shape.md (18 Nov 2026, after the independent check). Everything is made up.
 *
 *   Company A  the founding company: nalekoAiChat serves it today (AGENT_TENANT_ID), Ask Batsi is switched on for it (CHAT-02's switch).
 *   Company B  another company. The chat Lambda still answers it 403 (CHAT-04 changes that); the route answers it its own rows only.
 *
 * Two Lambdas: the chat (lambda/nalekoAiChat) builds the check rows from what the Agent API answers, and the route behind the
 * Agent API's verifications (lambda/getDocumentVerifications) answers one person's documents with their check.
 */
export { A, B, PEOPLE, plain, type Who };

export const CHAT = join(LAMBDA, 'nalekoAiChat', 'index.mjs');
export const ROUTE = join(LAMBDA, 'getDocumentVerifications', 'index.mjs');
export const KEY = 'agent-key-chat05-fake';
export const SECRET = 'naleko/agent/api-key';
export const PENDING = 'naleko-pending-actions';

// ---------------------------------------------------------------- the screen's words (Q-6, ONB-15)

export const WORDS = {
  ID: 'ID document',
  BANK: 'Bank letter',
  MATRIC: 'Matric certificate',
  TERTIARY: 'Tertiary qualifications',
  MATCHES: 'Matches',
  LOOK: 'Needs a look',
  DIFFERS: "Doesn't match",
  READING: 'Being checked',
  MISSING: 'Missing',
} as const;
export const LABELS: string[] = [WORDS.ID, WORDS.BANK, WORDS.MATRIC, WORDS.TERTIARY];
export const RESULTS: string[] = [WORDS.MATCHES, WORDS.LOOK, WORDS.DIFFERS, WORDS.READING, WORDS.MISSING];

// ---------------------------------------------------------------- people and documents the chat is told about

export const NOMSA = 'EMP-0000101';
export const SIPHO = 'EMP-0000102';
/** A 13-digit ID number: it must reach no answer. */
export const ID_NUMBER = '9803145800083';

export type Check = 'MATCHES' | 'NEEDS_A_LOOK' | 'DOESNT_MATCH' | 'READING';
export type Doc = { document_id: string; document_type: string; check: Check; arrived_at: string | null };
export const doc = (document_id: string, document_type: string, check: Check, arrived_at: string | null = '2026-11-10T08:00:00.000Z'): Doc => ({ document_id, document_type, check, arrived_at });
export const ID = 'NATIONAL_ID';
export const BANK = 'BANK_CONFIRMATION';
export const MATRIC = 'MATRIC_CERTIFICATE';
export const TERTIARY = 'TERTIARY_QUALIFICATION';

/** What the route answers for one person: the verification rows as today (with their numbers) plus `documents`. */
export function personAnswer(employeeId: string, documents: Doc[], extra: Record<string, unknown> = {}) {
  const items = documents.map((d, i) => ({
    verification_id: `ver-${employeeId}-${i}`, employee_id: employeeId, employee_name: 'Nomsa Dlamini', document_type: d.document_type, document_id: d.document_id,
    confidence: 97, decision: 'PASS', created_at: d.arrived_at ?? '2026-11-10T08:00:00.000Z',
  }));
  return { items, count: items.length, documents, ...extra };
}

export const SENTENCE = 'Nomsa has her documents in.';
/** The model asks for one person's verifications, then answers. */
export const lookUp = (...employeeIds: string[]): ModelScript => ({
  intent: 'TOOL_REQUIRED',
  answers: [...employeeIds.map((id) => ({ tool: { name: 'list_verifications', input: { employee_id: id } } })), { text: SENTENCE }],
});
export const callTool = (name: string, input: Record<string, unknown> = {}): ModelScript => ({ intent: 'TOOL_REQUIRED', answers: [{ tool: { name, input } }, { text: SENTENCE }] });
export const justAnswer = (text = SENTENCE): ModelScript => ({ intent: 'TOOL_REQUIRED', answers: [{ text }] });

/** The Agent API: a rule per person (matched by the query text), then the plain list. */
export function agentApi(rules: { person?: string; url?: string; status?: number; json?: unknown }[]): FetchScript {
  return {
    keys: [KEY],
    rules: rules.map((r) => ({ method: 'GET', url: r.person ? `employee_id=${r.person}` : (r.url ?? '/agent/v1/'), status: r.status ?? 200, json: r.json })),
  };
}

// ---------------------------------------------------------------- running the chat

export type Out = { run: Run; status: number | undefined; json: any; text: string };
export type AskOpts = { tables?: Tables; env?: Record<string, string | undefined>; bedrock?: ModelScript; fetch?: FetchScript; who?: Who; body?: Record<string, unknown> };

const outOf = (run: Run): Out => {
  const text = typeof run.response?.body === 'string' ? run.response.body : '';
  let json: any;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { run, status: run.response?.statusCode, json, text };
};

/** A question from an HR person to Batsi (the real chat Lambda, with its settings), answered by the script and the fake Agent API. */
export function ask(question: string, o: AskOpts = {}): Out {
  const run = runHandler(CHAT, eventOf(o.who ?? 'a1', 'POST /agent/v1/ai-chat', { body: { message: question, templateId: 'freeform', ...(o.body ?? {}) } }), {
    tables: o.tables ?? baseTables('on'),
    env: settings('nalekoAiChat', o.env),
    bedrock: o.bedrock,
    fetch: o.fetch,
    secrets: { [SECRET]: { AWSCURRENT: KEY } },
  });
  return outOf(run);
}

/** The one-person question: Batsi looks the person up, the Agent API answers with their documents. */
export function askAbout(employeeId: string, documents: Doc[], o: AskOpts & { answer?: Record<string, unknown> } = {}): Out {
  return ask("Is Nomsa's paperwork complete?", { bedrock: lookUp(employeeId), fetch: agentApi([{ person: employeeId, json: o.answer ?? personAnswer(employeeId, documents) }]), ...o });
}

export const checksOf = (o: Out): { label: string; result: string }[] | undefined => o.json?.structuredData?.checks;
export const modelCalls = (run: Run) => (run.calls as any[]).filter((c) => c.service === 'bedrock');
export const answerCalls = (run: Run) => modelCalls(run).filter((c) => c.kind === 'answer');
export const httpCalls = (run: Run) => (run.calls as any[]).filter((c) => c.service === 'http');
export const dynamo = (run: Run, table?: string) => (run.calls as any[]).filter((c) => c.service === 'dynamodb' && (!table || c.table === table));
export const writes = (run: Run, table?: string) => dynamo(run, table).filter((c) => /^(PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems)$/.test(c.op));
export const logsOf = (run: Run) => (run.calls as any[]).filter((c) => c.service === 'log').map((c) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`).join('\n');
export const tablesOf = (run: Run, name: string) => (run.tables[name] ?? []).map(plain);

// ---------------------------------------------------------------- the route: stored rows

export const av = (values: Record<string, string | number | boolean | undefined>): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'number' ? { N: String(v) } : typeof v === 'boolean' ? { BOOL: v } : { S: v };
  }
  return out;
};

export type Who2 = 'agentA' | 'agentB' | 'hrA' | 'hrB';
type Forged = { query?: Record<string, string>; headers?: Record<string, string>; path?: Record<string, string>; body?: unknown };
const COMPANY = { agentA: A, agentB: B, hrA: A, hrB: B } as const;

/** The route as the Agent API (the authorizer's company and actor) or a signed-in HR person calls it. */
export function routeEvent(who: Who2, query: Record<string, string> = {}, forged: Forged = {}) {
  const q = { ...query, ...(forged.query ?? {}) };
  if (who === 'agentA' || who === 'agentB') {
    return httpEvent({ route: 'GET /agent/v1/verifications', query: q, headers: forged.headers, path: forged.path, body: forged.body, authorizer: { lambda: { actor: 'AGENT', tenant_id: COMPANY[who] } } });
  }
  return eventOf(who === 'hrA' ? 'a1' : 'b1', 'GET /v1/verifications', { query: q, headers: forged.headers, path: forged.path, body: forged.body });
}

export function route(who: Who2, tables: Tables, query: Record<string, string> = {}, o: { env?: Record<string, string | undefined>; forged?: Forged; fail?: { message: string; ops?: string[] } } = {}): Out {
  const run = runHandler(ROUTE, routeEvent(who, query, o.forged), {
    tables,
    env: o.env,
    ...(o.fail ? { fail: { service: 'dynamodb', ops: o.fail.ops, message: o.fail.message } } : {}),
  });
  return outOf(run);
}

const stamp = (c: string | undefined | null) => (c ? { tenant_id: c } : {});

export const T = { id: 'EMP-ROUTE-0001', first: 'Nomsa', last: 'Dlamini' };

/** A verification row as the Lambdas store it. */
export const verification = (id: string, employeeId: string, documentId: string, type: string, c: string | null, v: { confidence?: number; check?: string } = {}) =>
  av({ verificationId: id, employeeId, documentId, documentType: type, confidence: v.confidence ?? 80, decision: 'PASS', createdAt: '2026-11-10T08:00:00.000Z', ...(v.check ? { check: v.check } : {}), ...stamp(c) });

/** A document row as the Lambdas store it, with a file key and a file name that must never reach an answer. */
export const documentRow = (employeeId: string, documentId: string, type: string, status: string, c: string | null, d: { verification?: string; at?: string; reviewed?: string } = {}) =>
  av({ employee_id: employeeId, document_id: documentId, document_type: type, ocr_status: status, ...(d.verification ? { verification_id: d.verification } : {}), ...(d.at ? { upload_timestamp: d.at } : {}), ...(d.reviewed ? { hr_reviewed_at: d.reviewed } : {}), s3_key: `uploads/${employeeId}/${documentId}-SECRET-FILE.pdf`, file_name: `SECRET-${documentId}.pdf`, ...stamp(c) });

export const employeeRow = (id: string, first: string, last: string, c: string | null) => av({ employee_id: id, first_name: first, last_name: last, created_by: 'STAFF-A1', ...stamp(c) });

/**
 * The company's tables. `legacy` rows carry no company (written before TEN-02: only the founding company's, read with a Scan).
 * Other people's rows come first, so the rows of the person asked about sit after the first page (the fake pages four rows at a time).
 *
 * The person (T) has: an ID uploaded twice (old one 97, new one stored MATCHES with confidence 40), a bank letter twice (old one at exactly
 * 90, new one at 85, both with no stored check), a matric certificate still being read (no verification row), a tertiary qualification
 * HR accepted (no verification row) and a tertiary upload link with no file (PENDING).
 */
export function routeTables(o: { legacy?: boolean; twinInB?: boolean } = {}): Tables {
  const mine = o.legacy ? null : A;
  const rows = (c: string | null): { ver: Row[]; docs: Row[]; emp: Row[] } => {
    const ver: Row[] = [];
    const docs: Row[] = [];
    const emp: Row[] = [];
    // Other people first (company A), then company B's rows, then T.
    for (let i = 1; i <= 6; i++) {
      const id = `EMP-OTHER-000${i}`;
      emp.push(employeeRow(id, `Other${i}`, `Person${i}`, c));
      docs.push(documentRow(id, `doc-other-${i}`, ID, 'COMPLETED', c, { verification: `ver-other-${i}`, at: `2026-11-0${i}T08:00:00.000Z` }));
      ver.push(verification(`ver-other-${i}`, id, `doc-other-${i}`, ID, c, { confidence: 99 }));
    }
    return { ver, docs, emp };
  };
  const a = rows(mine);
  const ver: Row[] = [...a.ver];
  const docs: Row[] = [...a.docs];
  const emp: Row[] = [...a.emp];
  // Company B's rows sit between (in the legacy Scan they are read and filtered out).
  for (let i = 1; i <= 5; i++) {
    const id = `EMP-B-000${i}`;
    emp.push(employeeRow(id, `Bee${i}`, `Ngcobo${i}`, B));
    docs.push(documentRow(id, `doc-b-${i}`, ID, 'COMPLETED', B, { verification: `ver-b-${i}`, at: `2026-11-0${i}T09:00:00.000Z` }));
    ver.push(verification(`ver-b-${i}`, id, `doc-b-${i}`, ID, B, { confidence: 99 }));
  }
  const t = T.id;
  emp.push(employeeRow(t, T.first, T.last, mine));
  ver.push(
    verification('ver-t-id-old', t, 'doc-t-id-old', ID, mine, { confidence: 97 }),
    verification('ver-t-id-new', t, 'doc-t-id-new', ID, mine, { confidence: 40, check: 'MATCHES' }),
    verification('ver-t-bank-old', t, 'doc-t-bank-old', BANK, mine, { confidence: 90 }),
    verification('ver-t-bank-new', t, 'doc-t-bank-new', BANK, mine, { confidence: 85 }),
  );
  docs.push(
    documentRow(t, 'doc-t-id-old', ID, 'COMPLETED', mine, { verification: 'ver-t-id-old', at: '2026-11-01T08:00:00.000Z' }),
    documentRow(t, 'doc-t-id-new', ID, 'COMPLETED', mine, { verification: 'ver-t-id-new', at: '2026-11-05T08:00:00.000Z' }),
    documentRow(t, 'doc-t-bank-old', BANK, 'COMPLETED', mine, { verification: 'ver-t-bank-old', at: '2026-11-02T08:00:00.000Z' }),
    documentRow(t, 'doc-t-bank-new', BANK, 'COMPLETED', mine, { verification: 'ver-t-bank-new', at: '2026-11-06T08:00:00.000Z' }),
    documentRow(t, 'doc-t-matric', MATRIC, 'PROCESSING', mine, { at: '2026-11-07T08:00:00.000Z' }),
    documentRow(t, 'doc-t-tertiary', TERTIARY, 'PASSED', mine, { at: '2026-11-08T08:00:00.000Z', reviewed: '2026-11-09T08:00:00.000Z' }),
    documentRow(t, 'doc-t-link-only', TERTIARY, 'PENDING', mine, { at: '2026-11-09T08:00:00.000Z' }),
  );
  if (o.twinInB) {
    // Company B holds a row that names T's id (it is B's row, never A's): A must never see it.
    ver.push(verification('ver-b-twin', t, 'doc-b-twin', ID, B, { confidence: 99, check: 'DOESNT_MATCH' }));
    docs.push(documentRow(t, 'doc-b-twin', ID, 'COMPLETED', B, { verification: 'ver-b-twin', at: '2026-11-20T08:00:00.000Z' }));
  }
  return { employees: emp, documents: docs, 'document-verification': ver };
}

/** The legacy company's rows are unstamped and read with a Scan; this is the setting that turns that on. */
export const LEGACY_ENV = { LEGACY_TENANT_ID: A };

/** What a person's documents should answer, sorted by document_id. */
export const EXPECTED_DOCUMENTS: Doc[] = [
  doc('doc-t-bank-new', BANK, 'NEEDS_A_LOOK', '2026-11-06T08:00:00.000Z'),
  doc('doc-t-bank-old', BANK, 'MATCHES', '2026-11-02T08:00:00.000Z'),
  doc('doc-t-id-new', ID, 'MATCHES', '2026-11-05T08:00:00.000Z'),
  doc('doc-t-id-old', ID, 'MATCHES', '2026-11-01T08:00:00.000Z'),
  doc('doc-t-matric', MATRIC, 'READING', '2026-11-07T08:00:00.000Z'),
  doc('doc-t-tertiary', TERTIARY, 'NEEDS_A_LOOK', '2026-11-08T08:00:00.000Z'),
];
export const EXPECTED_VERIFICATION_IDS = ['ver-t-bank-new', 'ver-t-bank-old', 'ver-t-id-new', 'ver-t-id-old'];

/** Every call a run made to DynamoDB that the route's role could not make (Terraform: infra/iam_per_lambda.tf, getDocumentVerifications). */
export function deniedCalls(run: Run): string[] {
  const out: string[] = [];
  for (const c of dynamo(run)) {
    const where = `${c.op} ${c.table}${c.input?.IndexName ? ` index ${c.input.IndexName}` : ''}`;
    if (!['Query', 'Scan'].includes(c.op)) out.push(where);
    else if (!['document-verification', 'documents', 'employees'].includes(c.table)) out.push(where);
    else if (c.input?.IndexName && !(c.input.IndexName === 'tenant-index' && ['document-verification', 'documents'].includes(c.table))) out.push(where);
  }
  return out;
}
