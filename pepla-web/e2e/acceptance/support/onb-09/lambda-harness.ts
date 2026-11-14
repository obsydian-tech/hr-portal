import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eventFor, plain, row, type Caller, type Row } from '../onb-15/lambda-harness';

/**
 * Runs the real ONB-09 Lambdas, each in its own fresh Node process (a cold Lambda), against a fake AWS
 * (./fake-aws, copied from ONB-07's): DynamoDB with writes and condition expressions honoured, the two
 * secondary indexes cognitoPostAuth reads, Query in pages, S3 with the uploaded files, EventBridge, Step
 * Functions, KMS, CloudWatch, Postmark, and recording fakes for Textract and Bedrock. The world (tables,
 * files, what Textract reads) is given as data; after each run the tables are taken back with the
 * handler's writes, so the next run starts where the last one stopped.
 *
 * Every call is recorded. Nothing reaches AWS, Postmark or any AI service. Needs nothing installed.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
const LAMBDA = join(REPO, 'lambda');
export const POST_AUTH = join(LAMBDA, 'cognitoPostAuth', 'index.mjs');
export const OCR = join(LAMBDA, 'processDocumentOCR', 'index.mjs');
export const REVIEW = join(LAMBDA, 'reviewDocumentVerification', 'index.mjs');
export const LIST = join(LAMBDA, 'getEmployees', 'index.mjs');
export const PERSON = join(LAMBDA, 'getEmployeeDocumentVerifications', 'index.mjs');
/** The five Lambdas this card changes. */
export const FIVE = { cognitoPostAuth: POST_AUTH, processDocumentOCR: OCR, reviewDocumentVerification: REVIEW, getEmployees: LIST, getEmployeeDocumentVerifications: PERSON };
const FAKE_AWS = join(__dirname, 'fake-aws');

export { eventFor, plain, row, type Caller, type Row };
export type Tables = { employees: Row[]; documents: Row[]; 'document-verification': Row[]; 'talent-flow-users'?: Row[] };
export type Failure = { op: string; table: string; mentions?: string };
export type World = {
  tables: Tables;
  /** "bucket/key" -> the file, base64. */
  s3?: Record<string, string>;
  /** What Textract reads: lines of text, or the name of the error it throws for an unreadable file. */
  textract?: { lines?: string[]; error?: string };
  /** What the model answers. */
  model?: unknown;
  /** Rows per Scan or Query page. */
  pageSize?: number;
  /** "table/index" -> the rows that index sees (an index can be behind its table). */
  index?: Record<string, Row[]>;
  /** DynamoDB calls that fail with a 500. */
  fail?: Failure[];
};

export type Call =
  | { service: 'dynamodb'; op: string; table?: string; input: any }
  | { service: 'textract' | 'bedrock'; op: string; reached: boolean; input: any }
  | { service: 's3'; op: string; key: string }
  | { service: 'events'; op: 'PutEvents'; bus?: string; source: string; detailType: string; detail: any }
  | { service: 'postmark'; op: string; message: unknown }
  | { service: 'sfn' | 'cloudwatch' | 'kms'; op: string }
  | { service: 'log'; level: string; message: string; extra?: unknown };

export type Run = {
  /** What the handler returned. */
  response: any;
  /** response.statusCode, when there is one. */
  status: number;
  /** The response body, parsed when it is JSON text. */
  body: any;
  raw: string;
  error?: { name: string; message: string; stack: string };
  calls: Call[];
  /** The world after the run (tables with the handler's writes). */
  world: World;
};

export const ENV = {
  EVENT_BUS_NAME: 'naleko-onboarding',
  HR_EMAIL: 'people-team@kestrel-foods.co.za',
  UPLOAD_BUCKET: 'document-ocr-verification-uploads-onb09',
  ENVIRONMENT: 'dev',
};

/** Calls `handler` once with `event` in a fresh process against `world`. */
export function runHandler(handler: string, world: World, event: unknown, env: Record<string, string> = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'onb-09-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify({ pageSize: 4, ...structuredClone(world) }));
  writeFileSync(eventFile, JSON.stringify(event));
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env['PATH'] ?? '',
      ONB09_WORLD: worldFile,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'onb09-fake',
      AWS_SECRET_ACCESS_KEY: 'onb09-fake',
      KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/onb-09-fake',
      KMS_KEY_ID: 'arn:aws:kms:af-south-1:000000000000:key/onb-09-fake',
      EMPLOYEES_TABLE: 'employees',
      DOCUMENTS_TABLE: 'documents',
      VERIFICATION_TABLE: 'document-verification',
      VERIFICATIONS_TABLE: 'document-verification',
      TALENT_FLOW_USERS_TABLE: 'talent-flow-users',
      POSTMARK_API_TOKEN: 'onb09-fake-postmark-token',
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
      ...ENV,
      ...env,
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@ONB09@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  const result = JSON.parse(line.slice('@@ONB09@@'.length)) as { response?: any; error?: Run['error']; calls: Call[]; tables: Tables };
  const r = result.response;
  const rawBody = r && typeof r === 'object' && 'body' in r ? r.body : undefined;
  const raw = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody ?? null);
  let body: unknown = rawBody ?? null;
  if (typeof rawBody === 'string') {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = rawBody;
    }
  }
  return { response: r, status: Number(r?.statusCode), body, raw, error: result.error, calls: result.calls, world: { ...world, tables: result.tables } };
}

// ---------------------------------------------------------------- events

/** The S3 ObjectCreated:Put event the upload bucket sends processDocumentOCR (key URL-encoded, as S3 does). */
export function s3Event(key: string, bucket = ENV.UPLOAD_BUCKET): unknown {
  return {
    Records: [{
      eventVersion: '2.1',
      eventSource: 'aws:s3',
      awsRegion: 'af-south-1',
      eventTime: '2026-11-14T08:00:00.000Z',
      eventName: 'ObjectCreated:Put',
      s3: {
        s3SchemaVersion: '1.0',
        bucket: { name: bucket, arn: `arn:aws:s3:::${bucket}` },
        object: { key: encodeURIComponent(key).replace(/%2F/g, '/').replace(/%20/g, '+'), size: 1024, eTag: 'onb09' },
      },
    }],
  };
}

/** The Cognito PostAuthentication trigger event, as the Naleko user pool sends it (username = email). */
export function postAuthEvent(email: string): Record<string, unknown> {
  return {
    version: '1',
    region: 'af-south-1',
    userPoolId: 'af-south-1_Onb09Fake',
    userName: email,
    callerContext: { awsSdkVersion: 'aws-sdk-unknown-unknown', clientId: 'onb09fakeclient' },
    triggerSource: 'PostAuthentication_Authentication',
    request: { userAttributes: { sub: 'sub-' + email.replace(/[^a-z]/gi, ''), email_verified: 'true', email }, newDeviceUsed: false },
    response: {},
  };
}

/** GET /v1/employees (with the query) through the real getEmployees. */
export function listEvent(caller: Caller, query: Record<string, string> = {}): unknown {
  return eventFor({ method: 'GET', route: '/v1/employees', path: '/v1/employees', id: '', caller, query });
}

/** GET /v1/employees/{id}/verifications through the real getEmployeeDocumentVerifications. */
export function personEvent(id: string, caller: Caller): unknown {
  return eventFor({ method: 'GET', route: '/v1/employees/{id}/verifications', path: `/v1/employees/${encodeURIComponent(id)}/verifications`, id, caller });
}

/** PATCH /v1/verifications/{id}/review, with the employee_id as the page sends it. */
export function reviewEvent(documentId: string, employeeId: string, decision: 'PASSED' | 'FAILED', caller: Caller): unknown {
  return eventFor({
    method: 'PATCH', route: '/v1/verifications/{id}/review', path: `/v1/verifications/${documentId}/review`, id: documentId, caller,
    body: { decision, employee_id: employeeId, ...(decision === 'FAILED' ? { notes: 'Please send a clearer copy.' } : {}) },
  });
}

// ---------------------------------------------------------------- what a run did

export const WRITE_OPS = ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'];

export function dynamoCalls(run: Run): Array<Extract<Call, { service: 'dynamodb' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb');
}

/** Every write the run asked for on a table (succeeded or refused by its condition), TransactWriteItems unpacked. */
export function writesTo(run: Run, tableName: string): Array<{ op: string; input: any }> {
  const out: Array<{ op: string; input: any }> = [];
  for (const c of dynamoCalls(run)) {
    if (!WRITE_OPS.includes(c.op)) continue;
    if (c.op === 'TransactWriteItems') {
      for (const t of c.input.TransactItems ?? []) {
        const [kind, i] = Object.entries(t)[0] as [string, any];
        if (i.TableName === tableName && kind !== 'ConditionCheck') out.push({ op: kind, input: i });
      }
    } else if (c.op === 'BatchWriteItem') {
      for (const r of c.input.RequestItems?.[tableName] ?? []) out.push({ op: r.PutRequest ? 'Put' : 'Delete', input: r });
    } else if (c.table === tableName) out.push({ op: c.op, input: c.input });
  }
  return out;
}

/** Every attribute value an employees write would store (SET values), as plain text. */
export function valuesWritten(run: Run): string[] {
  const out: string[] = [];
  for (const w of writesTo(run, 'employees')) {
    const vals = w.input.ExpressionAttributeValues ?? {};
    for (const v of Object.values(vals) as Array<Record<string, unknown>>) if (v && typeof v === 'object' && 'S' in v) out.push(String(v['S']));
    for (const v of Object.values(w.input.Item ?? {}) as Array<Record<string, unknown>>) if (v && typeof v === 'object' && 'S' in v) out.push(String(v['S']));
  }
  return out;
}

export function published(run: Run, detailType?: string): Array<Extract<Call, { service: 'events' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'events' }> => c.service === 'events' && (!detailType || c.detailType === detailType));
}

export function aiReached(run: Run): string[] {
  return run.calls.filter((c): c is Extract<Call, { service: 'textract' | 'bedrock' }> => (c.service === 'textract' || c.service === 'bedrock') && c.reached).map((c) => c.service);
}

/** The stored employees row, plain. */
export function personOf(world: World, id: string): Record<string, unknown> | undefined {
  return plain(world.tables.employees.find((r) => (r['employee_id'] as { S?: string })?.S === id));
}
