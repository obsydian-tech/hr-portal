import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attributes, blocks, tfFiles } from '../infra-harness';
import { eventFor, type Caller, type Row } from '../onb-13/lambda-harness';

/**
 * Runs the real ONB-07 Lambdas, each in its own fresh Node process (a cold Lambda), against a fake AWS
 * (./fake-aws): DynamoDB with writes and conditions, S3 with the uploaded files, EventBridge, Step
 * Functions, KMS, CloudWatch, Postmark, and recording fakes for Textract and Bedrock. The world (tables,
 * files, what Textract reads, what the model answers) is given as data; after each run the tables are
 * taken back with the handler's writes, so the next run starts where the last one stopped.
 *
 * Every call is recorded. A Textract or Bedrock ATTEMPT is recorded even when the AI guard refuses it.
 * Nothing reaches AWS, Postmark, or any AI service. Needs nothing installed.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
const LAMBDA = join(REPO, 'lambda');
export const OCR = join(LAMBDA, 'processDocumentOCR', 'index.mjs');
export const EMAIL = join(LAMBDA, 'sendNotificationEmail', 'index.mjs');
export const REVIEW = join(LAMBDA, 'reviewDocumentVerification', 'index.mjs');
export const LIST = join(LAMBDA, 'getDocumentVerifications', 'index.mjs');
export const PERSON = join(LAMBDA, 'getEmployeeDocumentVerifications', 'index.mjs');
const FAKE_AWS = join(__dirname, 'fake-aws');

export type { Row, Caller };
export type Tables = { employees: Row[]; documents: Row[]; 'document-verification': Row[] };
export type World = {
  tables: Tables;
  /** "bucket/key" -> the file, base64. */
  s3?: Record<string, string>;
  /** What Textract reads: lines of text, or the name of the error it throws for an unreadable file. */
  textract?: { lines?: string[]; error?: string };
  /** What the model answers (sent back as JSON text). */
  model?: unknown;
  pageSize?: number;
};

export type Call =
  | { service: 'dynamodb'; op: string; table?: string; input: any }
  | { service: 'textract' | 'bedrock'; op: string; reached: boolean; input: any }
  | { service: 's3'; op: string; key: string }
  | { service: 'events'; op: 'PutEvents'; bus?: string; source: string; detailType: string; detail: any }
  | { service: 'postmark'; op: string; message: Email }
  | { service: 'sfn' | 'cloudwatch' | 'kms'; op: string }
  | { service: 'log'; level: string; message: string; extra?: unknown };

export type Email = { From?: string; To: string; Cc?: string; Bcc?: string; Subject?: string; TextBody?: string; HtmlBody?: string; [k: string]: unknown };

export type Run = {
  response: any;
  error?: { name: string; message: string; stack: string };
  calls: Call[];
  /** The world after the run (tables with the handler's writes). */
  world: World;
};

/** Environment every handler gets, as Terraform sets it (values made up). */
export const ENV = {
  EVENT_BUS_NAME: 'naleko-onboarding',
  HR_EMAIL: 'people-team@kestrel-foods.co.za',
  LOGIN_URL: 'https://people.naleko.example/sign-in',
  POSTMARK_SENDER_EMAIL: 'no-reply@naleko.example',
  UPLOAD_BUCKET: 'document-ocr-verification-uploads-onb07',
};

/** Calls `handler` once with `event` in a fresh process against `world`. */
export function runHandler(handler: string, world: World, event: unknown, env: Record<string, string> = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'onb-07-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify({ pageSize: 4, ...world }));
  writeFileSync(eventFile, JSON.stringify(event));
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env['PATH'] ?? '',
      ONB07_WORLD: worldFile,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'onb07-fake',
      AWS_SECRET_ACCESS_KEY: 'onb07-fake',
      KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/onb-07-fake',
      EMPLOYEES_TABLE: 'employees',
      DOCUMENTS_TABLE: 'documents',
      VERIFICATION_TABLE: 'document-verification',
      VERIFICATIONS_TABLE: 'document-verification',
      POSTMARK_API_TOKEN: 'onb07-fake-postmark-token',
      ENVIRONMENT: 'dev',
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
      ...ENV,
      ...env,
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@ONB07@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  const result = JSON.parse(line.slice('@@ONB07@@'.length)) as { response?: any; error?: Run['error']; calls: Call[]; tables: Tables };
  return { response: result.response, error: result.error, calls: result.calls, world: { ...world, tables: result.tables } };
}

// ---------------------------------------------------------------- events

/** The S3 ObjectCreated:Put event the upload bucket sends processDocumentOCR (key URL-encoded, as S3 does). */
export function s3Event(bucket: string, key: string, size = 1024): unknown {
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
        object: { key: encodeURIComponent(key).replace(/%2F/g, '/').replace(/%20/g, '+'), size, eTag: 'onb07' },
      },
    }],
  };
}

/** An EventBridge event as a rule hands it to its Lambda target. */
export function busEvent(detailType: string, detail: unknown, source = 'naleko.onboarding'): unknown {
  return {
    version: '0',
    id: `onb07-${detailType}-${Math.random().toString(36).slice(2)}`,
    'detail-type': detailType,
    source,
    account: '000000000000',
    time: '2026-11-14T08:00:00Z',
    region: 'af-south-1',
    resources: [],
    detail,
  };
}

/** PATCH /v1/verifications/{id}/review as HR's Accept (PASSED) or Ask for a new one (FAILED) sends it. */
export function reviewEvent(documentId: string, employeeId: string, decision: 'PASSED' | 'FAILED'): unknown {
  const e = eventFor({
    route: '/v1/verifications/{id}/review',
    path: `/v1/verifications/${documentId}/review`,
    pathParameters: { id: documentId },
    caller: { kind: 'jwt', email: 'jane.smith@mokoena-logistics.co.za', groups: ['hr_staff'] },
  }) as any;
  e.routeKey = 'PATCH /v1/verifications/{id}/review';
  e.requestContext.routeKey = e.routeKey;
  e.requestContext.http.method = 'PATCH';
  e.body = JSON.stringify({ decision, notes: '', employee_id: employeeId });
  return e;
}

/** GET /v1/verifications (with the query) as HR, through the real lambda/getDocumentVerifications. */
export function listRun(world: World, query: Record<string, string> = { waiting: 'true' }): Run {
  return runHandler(LIST, world, eventFor({ route: '/v1/verifications', query, caller: { kind: 'jwt', email: 'jane.smith@mokoena-logistics.co.za', groups: ['hr_staff'] } }));
}

/** GET /v1/employees/{id}/verifications as HR, through the real lambda/getEmployeeDocumentVerifications. */
export function personRun(world: World, id: string): Run {
  const path = `/v1/employees/${encodeURIComponent(id)}/verifications`;
  return runHandler(PERSON, world, eventFor({ route: '/v1/employees/{id}/verifications', path, pathParameters: { id }, caller: { kind: 'jwt', email: 'jane.smith@mokoena-logistics.co.za', groups: ['hr_staff'] } }));
}

export function bodyOf(run: Run): any {
  if (run.error) throw new Error(`the handler threw: ${run.error.stack}`);
  const b = run.response?.body;
  return typeof b === 'string' ? JSON.parse(b) : b;
}

// ---------------------------------------------------------------- what infra/ routes to sendNotificationEmail

export type Route = { rule: string; sources: string[]; detailTypes: string[] };

const listOf = (src: string, name: RegExp) => {
  const m = new RegExp(`${name.source}\\s*=\\s*\\[([^\\]]*)\\]`).exec(src);
  return m ? [...m[1]!.matchAll(/"([^"]*)"/g)].map((x) => x[1]!) : [];
};

/** Every EventBridge rule in infra/*.tf whose target is lambda send_notification_email, with its pattern. */
export function emailRoutes(): Route[] {
  const files = tfFiles();
  const rules = blocks(files, 'resource').filter((b) => b.labels[0] === 'aws_cloudwatch_event_rule');
  const targets = blocks(files, 'resource').filter((b) => b.labels[0] === 'aws_cloudwatch_event_target');
  const routes: Route[] = [];
  for (const t of targets) {
    const a = attributes(t.body);
    if (a.get('arn') !== 'aws_lambda_function.send_notification_email.arn') continue;
    const ref = /^aws_cloudwatch_event_rule\.([A-Za-z0-9_-]+)\.name$/.exec(a.get('rule') ?? '');
    const rule = ref && rules.find((r) => r.labels[1] === ref[1]);
    if (!rule) continue;
    routes.push({ rule: rule.labels[1]!, sources: listOf(rule.body, /"?source"?/), detailTypes: listOf(rule.body, /"?detail-type"?/) });
  }
  return routes;
}

/** The events of a run that a rule delivers to sendNotificationEmail. */
export function routedToEmail(run: Run, routes: Route[]): Array<{ detailType: string; detail: any; source: string }> {
  return run.calls
    .filter((c): c is Extract<Call, { service: 'events' }> => c.service === 'events')
    .filter((e) => routes.some((r) => r.sources.includes(e.source) && r.detailTypes.includes(e.detailType)))
    .map((e) => ({ detailType: e.detailType, detail: e.detail, source: e.source }));
}

export function emails(run: Run): Email[] {
  return run.calls.filter((c): c is Extract<Call, { service: 'postmark' }> => c.service === 'postmark').map((c) => c.message);
}
export function published(run: Run, detailType?: string): Array<{ detailType: string; detail: any; source: string; bus?: string }> {
  return run.calls
    .filter((c): c is Extract<Call, { service: 'events' }> => c.service === 'events')
    .filter((e) => !detailType || e.detailType === detailType);
}
export function aiAttempts(run: Run): Array<Extract<Call, { service: 'textract' | 'bedrock' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'textract' | 'bedrock' }> => c.service === 'textract' || c.service === 'bedrock');
}

// ---------------------------------------------------------------- rows

/** Plain values of a stored row. */
export function plain(r: Row | undefined): Record<string, unknown> | undefined {
  if (!r) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    const a = v as Record<string, unknown>;
    out[k] = 'S' in a ? a['S'] : 'N' in a ? Number(a['N']) : 'BOOL' in a ? a['BOOL'] : 'NULL' in a ? null : a;
  }
  return out;
}

/** The api/openapi.yaml `check` enums (python3 + PyYAML). */
export function openapiChecks(): string[][] {
  const out = execFileSync('python3', [join(__dirname, 'openapi_checks.py'), join(REPO, 'api', 'openapi.yaml')], { encoding: 'utf8' });
  return JSON.parse(out);
}

export function source(file: string): string {
  return readFileSync(file, 'utf8');
}
