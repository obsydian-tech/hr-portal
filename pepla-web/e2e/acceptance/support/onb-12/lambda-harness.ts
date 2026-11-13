import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FakePerson, StoredDocument, StoredEmployee } from '../documents-fake';

/**
 * Runs the real lambda/getEmployeeDocumentVerifications handler, in its own
 * Node process, against a fake AWS (./fake-aws): every AWS SDK and Powertools
 * import is answered by a fake, the tables come from made-up people, and every
 * DynamoDB and KMS call is recorded. Nothing reaches AWS; an AI client import
 * fails the run. Needs nothing installed in the Lambda folder.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
export const HANDLER = join(REPO, 'lambda', 'getEmployeeDocumentVerifications', 'index.mjs');
const FAKE_AWS = join(__dirname, 'fake-aws');

export type Caller = { email: string; groups: string[]; sub?: string };
export type LambdaCall = { service: 'dynamodb' | 'kms'; op: string; table?: string };
export type LambdaRun = { status: number; body: any; raw: string; calls: LambdaCall[] };

const S = (v: string) => ({ S: v });

/** The tables as DynamoDB stores them. The ID number is stored encrypted, with its last four digits. */
export function tablesFor(people: FakePerson[]): Record<string, unknown[]> {
  const employees = people.map(({ employee: e }) => {
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e as StoredEmployee)) row[k] = S(String(v));
    row['created_at'] = S('2026-11-01T08:00:00.000Z');
    return row;
  });
  const documents: unknown[] = [];
  const verifications: unknown[] = [];
  for (const { employee, documents: docs } of people) {
    for (const d of docs as StoredDocument[]) {
      const row: Record<string, unknown> = {
        employee_id: S(employee.employee_id),
        document_id: S(d.document_id),
        document_type: S(d.document_type),
        file_name: S(d.file_name),
        uploaded_at: S(d.uploaded_at),
        ocr_status: S(d.ocr_status),
        s3_key: S(`uploads/${employee.employee_id}/${d.document_id}.pdf`),
      };
      if (d.ocr_completed_at) row['ocr_completed_at'] = S(d.ocr_completed_at);
      if (d.hr_reviewed_at) row['hr_reviewed_at'] = S(d.hr_reviewed_at);
      if (d.hr_decision_notes !== undefined) row['hr_decision_notes'] = S(d.hr_decision_notes);
      if (d.verification) {
        const vid = `ver-${d.document_id}`;
        row['verification_id'] = S(vid);
        row['ocr_completed_at'] ??= S(d.uploaded_at);
        const v = d.verification;
        const ver: Record<string, unknown> = {
          verificationId: S(vid),
          document_id: S(d.document_id),
          employee_id: S(employee.employee_id),
          confidence: { N: String(v.confidence) },
          decision: S(v.decision ?? (v.confidence >= 90 ? 'AUTO_APPROVE' : 'MANUAL_REVIEW')),
          reasoning: S('Sample data.'),
          name: S(v.name ?? employee.first_name),
          surname: S(v.surname ?? employee.last_name),
        };
        if (v.idNumber) {
          ver['idNumber_encrypted'] = S(Buffer.from(`kms:${v.idNumber}`).toString('base64'));
          ver['idNumber_last4'] = S(v.idNumber.slice(-4));
        }
        verifications.push(ver);
      }
      documents.push(row);
    }
  }
  return { employees, documents, 'document-verification': verifications };
}

/** A made-up, unsigned ID token carrying the claims (API Gateway has already checked the real one). */
function token(claims: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'RS256', kid: 'onb-12' })}.${b(claims)}.c2lnbmF0dXJl`;
}

/** An HTTP API (payload 2.0) event for GET /v1/employees/{id}/verifications, as the JWT authorizer passes it. */
export function eventFor(id: string, caller: Caller | null): unknown {
  const claims = caller
    ? {
        sub: caller.sub ?? 'sub-' + caller.email.toLowerCase().replace(/[^a-z]/g, ''),
        email: caller.email,
        email_verified: 'true',
        // API Gateway passes a list claim as one string: "[hr_staff naleko-onboarding-hr]"
        'cognito:groups': caller.groups.length ? `[${caller.groups.join(' ')}]` : undefined,
        token_use: 'id',
        iss: 'https://cognito-idp.af-south-1.amazonaws.com/af-south-1_Onb12Fake',
      }
    : undefined;
  if (claims && claims['cognito:groups'] === undefined) delete claims['cognito:groups'];
  const path = `/v1/employees/${encodeURIComponent(id)}/verifications`;
  return {
    version: '2.0',
    routeKey: 'GET /v1/employees/{id}/verifications',
    rawPath: path,
    rawQueryString: '',
    headers: { 'content-type': 'application/json', ...(claims ? { authorization: `Bearer ${token(claims)}` } : {}) },
    pathParameters: { id },
    requestContext: {
      http: { method: 'GET', path, protocol: 'HTTP/1.1', sourceIp: '198.51.100.7', userAgent: 'onb-12-acceptance' },
      routeKey: 'GET /v1/employees/{id}/verifications',
      stage: '$default',
      ...(claims ? { authorizer: { jwt: { claims, scopes: null } } } : {}),
    },
    isBase64Encoded: false,
  };
}

/** Calls the handler once for `caller` reading `id`, with the tables made from `people`. */
export function runLambda(people: FakePerson[], id: string, caller: Caller | null): LambdaRun {
  const dir = mkdtempSync(join(tmpdir(), 'onb-12-lambda-'));
  const world = join(dir, 'world.json');
  const event = join(dir, 'event.json');
  writeFileSync(world, JSON.stringify({ tables: tablesFor(people) }));
  writeFileSync(event, JSON.stringify(eventFor(id, caller)));
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), HANDLER, event], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      PATH: process.env['PATH'] ?? '',
      ONB12_WORLD: world,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'onb12-fake',
      AWS_SECRET_ACCESS_KEY: 'onb12-fake',
      KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/onb-12-fake',
      EMPLOYEES_TABLE: 'employees',
      DOCUMENTS_TABLE: 'documents',
      VERIFICATION_TABLE: 'document-verification',
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@ONB12@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  const result = JSON.parse(line.slice('@@ONB12@@'.length)) as { response?: any; calls?: LambdaCall[]; error?: string };
  if (result.error) throw new Error(`the handler threw:\n${result.error}`);
  const raw = typeof result.response?.body === 'string' ? result.response.body : JSON.stringify(result.response?.body ?? null);
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }
  return { status: Number(result.response?.statusCode), body, raw, calls: result.calls ?? [] };
}

/** Reads the route's 200 and 403 answers from api/openapi.yaml, $refs and allOf resolved (python3 + PyYAML). */
export function openapiRoute(): { responses: string[]; employee: string[]; document: Record<string, { enum?: unknown[]; nullable?: boolean; type?: unknown }> } {
  const out = execFileSync('python3', [join(__dirname, 'openapi_route.py'), join(REPO, 'api', 'openapi.yaml')], { encoding: 'utf8' });
  return JSON.parse(out);
}
