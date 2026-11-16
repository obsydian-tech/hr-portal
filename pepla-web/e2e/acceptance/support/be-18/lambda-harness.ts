import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * BE-18: copied from ../be-17.1/lambda-harness.ts (BE-17.1 lock), with code added only: a caller's
 * `token_use` claim can be set or left out (`tokenUse`); ONB-05's start page and consent, ONB-04's invite
 * routes, the email check and the post sign-in trigger are named; `fnRule` calls any export of a real file
 * on a table of cases; `cognitoEvent` builds a post sign-in trigger event; `runScript` runs a script's
 * exported main(args) against the fake tables; `stale` makes reads that are not consistent miss.
 *
 * BE-17.1: copied from ../be-17/lambda-harness.ts (BE-17 lock), with code added only: a caller's
 * `email_verified` claim can be set (`emailVerified`), the own-list and Talent Flow chat handlers are
 * named, and `ownerRule` runs the real isHrOrOwner on a table of cases.
 *
 * Runs the real BE-17 Lambdas, each call in its own fresh Node process (a cold Lambda), against a fake
 * AWS (./fake-aws, copied from ONB-15's with code added only): DynamoDB with writes, condition
 * expressions and the three indexes the routes query, KMS, the S3 URL signer, EventBridge, CloudWatch
 * and Powertools. Bedrock, Secrets Manager, Cognito and outbound HTTP are recorded and refused, so a
 * model call, a secret read or an Agent API call shows up in `calls` and fails the handler.
 *
 * The tables are given row by row, as DynamoDB stores them. Nothing reaches AWS. Needs nothing installed.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
export const LAMBDA = join(REPO, 'lambda');
const FAKE_AWS = join(__dirname, 'fake-aws');

/** The ten handlers this card is about, by route. */
export const HANDLER = {
  summary: join(LAMBDA, 'summariseVerification', 'index.mjs'),
  external: join(LAMBDA, 'triggerExternalVerification', 'index.mjs'),
  uploadUrl: join(LAMBDA, 'generateDocumentUploadUrl', 'index.mjs'),
  assessRisk: join(LAMBDA, 'classifyOnboardingRisk', 'index.mjs'),
  byEmail: join(LAMBDA, 'getEmployeeByEmail', 'index.mjs'),
  employees: join(LAMBDA, 'getEmployees', 'index.mjs'),
  aiChat: join(LAMBDA, 'nalekoAiChat', 'index.mjs'),
  pending: join(LAMBDA, 'talentFlowApproveAction', 'index.mjs'),
  fileUrl: join(LAMBDA, 'getDocumentPresignedUrl', 'index.mjs'),
  getOne: join(LAMBDA, 'getSingleDocumentVerification', 'index.mjs'),
  // BE-17.1: the own list (ONB-12) and Talent Flow chat (F-2).
  ownList: join(LAMBDA, 'getEmployeeDocumentVerifications', 'index.mjs'),
  tfChat: join(LAMBDA, 'talentFlowAiChat', 'index.mjs'),
  // BE-18: the start page and consent (ONB-05), the invite routes (ONB-04), the email check (ONB-03) and
  // the post sign-in trigger.
  myStart: join(LAMBDA, 'getMyStart', 'index.mjs'),
  consent: join(LAMBDA, 'recordConsent', 'index.mjs'),
  inviteLookup: join(LAMBDA, 'lookupInvite', 'index.mjs'),
  inviteRedeem: join(LAMBDA, 'redeemInvite', 'index.mjs'),
  emailCheck: join(LAMBDA, 'checkEmployeeEmail', 'index.mjs'),
  postAuth: join(LAMBDA, 'cognitoPostAuth', 'index.mjs'),
} as const;
/** BE-17.1: the shared owner rule. */
export const HR_GROUP_FILE = join(LAMBDA, 'shared', 'hr-group.mjs');
export type RouteName = keyof typeof HANDLER;

/** A row as DynamoDB stores it: attribute name -> AttributeValue. */
export type Row = Record<string, Record<string, unknown>>;
export type Tables = Record<string, Row[]>;

export type Call =
  | { service: 'dynamodb'; op: string; table?: string; input: any }
  | { service: 's3'; op: string; key?: string; bucket?: string; expiresIn?: number }
  | { service: 'events'; op: 'PutEvents'; bus?: string; source: string; detailType: string; detail: any }
  | { service: 'kms' | 'cloudwatch' | 'bedrock' | 'secretsmanager' | 'cognito' | 'http'; op: string }
  | { service: 'log'; level: string; message: string; extra?: unknown };

export type Run = {
  status: number;
  headers: Record<string, string>;
  body: any;
  raw: string;
  error?: { name: string; message: string; stack: string };
  calls: Call[];
  tables: Tables;
};

/**
 * Who calls. `jwt`: a signed-in person, with the ID token claims the JWT authorizer hands over.
 * `agent`: the Agent API's key authorizer (`authorizer.lambda.actor` AGENT, no JWT). `none`: no authorizer.
 */
export type Caller =
  | {
      kind: 'jwt'; email: string; groups: string[]; sub?: string; staffId?: string; givenName?: string; familyName?: string;
      /** BE-17.1: the `email_verified` claim. Left out: "true", as before. null: no such claim. */
      emailVerified?: string | boolean | null;
      /** BE-18: the `token_use` claim. Left out: "id", as before. null: no such claim. */
      tokenUse?: string | null;
    }
  | { kind: 'agent' }
  | { kind: 'actor'; actor: string }
  | { kind: 'none' };

/** What a stored-row test gives: plain values. */
export function row(values: Record<string, string | number | boolean | undefined | null>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    out[k] = v === null ? { NULL: true } : typeof v === 'number' ? { N: String(v) } : typeof v === 'boolean' ? { BOOL: v } : { S: v };
  }
  return out;
}

export function plain(r: Row | undefined): Record<string, unknown> | undefined {
  if (!r) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, a] of Object.entries(r)) out[k] = 'S' in a ? a['S'] : 'N' in a ? Number(a['N']) : 'BOOL' in a ? a['BOOL'] : 'NULL' in a ? null : a;
  return out;
}

/** KMS ciphertext as the fake KMS makes it ("kms:" + the plain text), base64. */
export const encrypted = (plainText: string) => Buffer.from(`kms:${plainText}`).toString('base64');

function token(claims: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'RS256', kid: 'be-17' })}.${b(claims)}.c2lnbmF0dXJl`;
}

/** An HTTP API (payload 2.0) event, as API Gateway hands it over. */
export function eventFor(opts: {
  method: 'GET' | 'POST' | 'PATCH';
  route: string;
  path: string;
  caller: Caller;
  pathParameters?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}): unknown {
  const { caller } = opts;
  const query = opts.query ?? {};
  const rawQueryString = new URLSearchParams(query).toString();
  let authorizer: unknown;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (caller.kind === 'jwt') {
    const claims: Record<string, unknown> = {
      sub: caller.sub ?? 'sub-' + (caller.email.toLowerCase().replace(/[^a-z]/g, '') || 'noemail'),
      email: caller.email,
      email_verified: caller.emailVerified === undefined ? 'true' : caller.emailVerified,
      token_use: caller.tokenUse === undefined ? 'id' : caller.tokenUse,
      iss: 'https://cognito-idp.af-south-1.amazonaws.com/af-south-1_Be17Fake',
    };
    if (caller.emailVerified === null) delete claims['email_verified']; // BE-17.1: no claim at all
    if (caller.tokenUse === null) delete claims['token_use']; // BE-18: no claim at all
    if (caller.staffId !== undefined) claims['custom:staff_id'] = caller.staffId;
    if (caller.givenName !== undefined) claims['given_name'] = caller.givenName;
    if (caller.familyName !== undefined) claims['family_name'] = caller.familyName;
    // API Gateway passes a list claim as one string: "[hr_staff naleko-onboarding-hr]"
    if (caller.groups.length) claims['cognito:groups'] = `[${caller.groups.join(' ')}]`;
    authorizer = { jwt: { claims, scopes: null } };
    headers['authorization'] = `Bearer ${token(claims)}`;
  } else if (caller.kind === 'agent') {
    authorizer = { lambda: { actor: 'AGENT' } };
    headers['x-api-key'] = 'be17-fake-agent-key';
  } else if (caller.kind === 'actor') {
    // A Lambda authorizer that names another actor (no JWT): not the Agent API, so not trusted.
    authorizer = { lambda: { actor: caller.actor } };
  }
  const routeKey = `${opts.method} ${opts.route}`;
  return {
    version: '2.0',
    routeKey,
    rawPath: opts.path,
    rawQueryString,
    headers,
    ...(rawQueryString ? { queryStringParameters: query } : {}),
    ...(opts.pathParameters ? { pathParameters: opts.pathParameters } : {}),
    requestContext: {
      http: { method: opts.method, path: opts.path, protocol: 'HTTP/1.1', sourceIp: '198.51.100.17', userAgent: 'be-17-acceptance' },
      routeKey,
      stage: '$default',
      ...(authorizer ? { authorizer } : {}),
    },
    ...(opts.body === undefined ? {} : { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) }),
    isBase64Encoded: false,
  };
}

/** Lambda settings, as Terraform gives them (made-up model ids; the fake refuses any model call). */
export const ENV: Record<string, string> = {
  EMPLOYEES_TABLE: 'employees',
  DOCUMENTS_TABLE: 'documents',
  VERIFICATION_TABLE: 'document-verification',
  VERIFICATIONS_TABLE: 'document-verification',
  PENDING_ACTIONS_TABLE_NAME: 'talent-flow-pending-actions',
  EVENTBRIDGE_BUS_NAME: 'talent-flow-bus',
  EVENT_BUS_NAME: 'naleko-onboarding',
  RATE_LIMIT_TABLE: 'NalekoAiRateLimit',
  AGENT_AUDIT_TABLE: 'naleko-agent-audit',
  PROMPT_CACHE_TABLE: 'naleko-prompt-cache',
  PENDING_ACTIONS_TABLE: 'naleko-pending-actions',
  AGENT_API_BASE_URL: 'https://agent-api.be17.invalid',
  AGENT_API_KEY_SECRET_NAME: 'be17/fake/agent-key',
  BEDROCK_MODEL_ID: 'be17-fake-model',
  MODEL_SMART: 'be17-fake-model',
  MODEL_FAST: 'be17-fake-model',
  UPLOAD_BUCKET: 'document-ocr-verification-uploads-be17',
  ENVIRONMENT: 'dev',
  KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/be-17-fake',
  KMS_KEY_ID: 'arn:aws:kms:af-south-1:000000000000:key/be-17-fake',
  // BE-18: what Terraform gives the start page, consent, invite and post sign-in Lambdas.
  COMPANY_NAME: 'Sunbird Bakery',
  EMPLOYEE_CONSENTS_TABLE: 'employee_consents',
  INVITES_TABLE: 'employee_invites',
  COGNITO_POOL_ID: 'af-south-1_Be18Fake',
  TALENT_FLOW_USERS_TABLE: 'talent-flow-users',
};

/** Makes every matching fake call throw an Error carrying `message` (after it is recorded). */
export type Failure = { service: 'dynamodb'; ops?: string[]; message: string; name?: string };

/** Calls `handler` once with `event` in a fresh process against `tables`. */
export function runHandler(handler: string, tables: Tables, event: unknown, opts: { env?: Record<string, string>; fail?: Failure; stale?: string[] } = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'be-17-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify({ tables: structuredClone(tables), pageSize: 4, ...(opts.fail ? { fail: opts.fail } : {}), ...(opts.stale ? { stale: opts.stale } : {}) }));
  writeFileSync(eventFile, JSON.stringify(event));
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env['PATH'] ?? '',
      BE17_WORLD: worldFile,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'be17-fake',
      AWS_SECRET_ACCESS_KEY: 'be17-fake',
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
      ...ENV,
      ...(opts.env ?? {}),
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@BE17@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  const result = JSON.parse(line.slice('@@BE17@@'.length)) as { response?: any; error?: Run['error']; calls: Call[]; tables: Tables };
  const raw = typeof result.response?.body === 'string' ? result.response.body : JSON.stringify(result.response?.body ?? null);
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(result.response?.headers ?? {})) headers[k.toLowerCase()] = String(v);
  return { status: Number(result.response?.statusCode), headers, body, raw, error: result.error, calls: result.calls, tables: result.tables };
}

// ---------------------------------------------------------------- what a run did

export const WRITE_OPS = ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'];
export const READ_OPS = ['GetItem', 'Query', 'Scan', 'BatchGetItem'];

export function dynamoCalls(run: Run): Array<Extract<Call, { service: 'dynamodb' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb');
}
export function writes(run: Run): string[] {
  return dynamoCalls(run).filter((c) => WRITE_OPS.includes(c.op)).map((c) => `${c.op} ${c.table}`);
}
/** Every call to an outside service (DynamoDB, S3, KMS, EventBridge, CloudWatch, Bedrock, Secrets Manager, Cognito, HTTP); log lines left out. */
export function awsCalls(run: Run): string[] {
  return run.calls.filter((c) => c.service !== 'log').map((c) => `${c.service} ${c.op}${'table' in c && c.table ? ' ' + c.table : ''}`);
}
export function s3Calls(run: Run): string[] {
  return run.calls.filter((c) => c.service === 's3').map((c) => `${c.service} ${c.op}`);
}
export function modelCalls(run: Run): string[] {
  return run.calls.filter((c) => c.service === 'bedrock' || c.service === 'http' || c.service === 'secretsmanager').map((c) => `${c.service} ${c.op}`);
}

/** What an OpenAPI file says about one route (python3 + PyYAML; ONB-15's reader). */
export function openapiRoute(file: string, path: string, method: string): { found: boolean; responses: string[] } {
  const out = execFileSync('python3', [join(__dirname, '..', 'onb-15', 'openapi_route.py'), file, path, method], { encoding: 'utf8' });
  return JSON.parse(out);
}

// ---------------------------------------------------------------- BE-17.1: the owner rule on its own

export type OwnerCase = { claims: Record<string, unknown> | null; employee: Record<string, unknown> | null };

/**
 * Calls the real isHrOrOwner(claims, employee) from lambda/shared/hr-group.mjs once per case, in one fresh
 * Node process with the fake AWS hooks (so an AWS import there cannot reach AWS). Returns what each call
 * returned, or `threw: <message>`.
 */
export function ownerRule(cases: OwnerCase[]): Array<boolean | string> {
  const dir = mkdtempSync(join(tmpdir(), 'be-17.1-owner-'));
  const casesFile = join(dir, 'cases.json');
  writeFileSync(casesFile, JSON.stringify(cases));
  writeFileSync(join(dir, 'world.json'), JSON.stringify({ tables: {} }));
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'owner-rule.mjs'), HR_GROUP_FILE, casesFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    env: { PATH: process.env['PATH'] ?? '', BE17_WORLD: join(dir, 'world.json'), AWS_REGION: 'af-south-1' },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@BE171@@'));
  if (!line) throw new Error(`the owner rule printed no result:\n${out.slice(-2000)}`);
  return JSON.parse(line.slice('@@BE171@@'.length));
}

// ---------------------------------------------------------------- BE-18

/**
 * Calls the real export `name` of `file` once per case (each case is the argument list), in one fresh
 * Node process with the fake AWS hooks. Returns what each call returned, `threw: <message>`, or
 * `missing: ...` when there is no such export.
 */
export function fnRule(file: string, name: string, cases: unknown[][]): unknown[] {
  const dir = mkdtempSync(join(tmpdir(), 'be-18-fn-'));
  const casesFile = join(dir, 'cases.json');
  writeFileSync(casesFile, JSON.stringify(cases));
  writeFileSync(join(dir, 'world.json'), JSON.stringify({ tables: {} }));
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'fn-rule.mjs'), file, name, casesFile], {
    cwd: dir, encoding: 'utf8', timeout: 30_000,
    env: { PATH: process.env['PATH'] ?? '', BE17_WORLD: join(dir, 'world.json'), AWS_REGION: 'af-south-1', ...ENV },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@BE18@@'));
  if (!line) throw new Error(`fn-rule printed no result:\n${out.slice(-2000)}`);
  return JSON.parse(line.slice('@@BE18@@'.length));
}

/** A Cognito PostAuthentication trigger event, as Cognito sends it for a pool with email as the username. */
export function cognitoEvent(email: string, sub = 'sub-post-auth'): unknown {
  return {
    version: '1',
    region: 'af-south-1',
    userPoolId: ENV['COGNITO_POOL_ID'],
    userName: sub,
    triggerSource: 'PostAuthentication_Authentication',
    callerContext: { awsSdkVersion: 'aws-sdk-unknown-unknown', clientId: 'be18fakeclient' },
    request: { userAttributes: { sub, email, email_verified: 'true', 'cognito:user_status': 'CONFIRMED' }, newDeviceUsed: false },
    response: {},
  };
}

export type ScriptRun = { result: any; error?: { name: string; message: string; stack: string }; calls: Call[]; tables: Tables; out: string };

/** Runs `main(args)` of a script once against `tables`, in a fresh process with the fake AWS. */
export function runScript(file: string, args: string[], tables: Tables, opts: { env?: Record<string, string> } = {}): ScriptRun {
  const dir = mkdtempSync(join(tmpdir(), 'be-18-script-'));
  const worldFile = join(dir, 'world.json');
  writeFileSync(worldFile, JSON.stringify({ tables: structuredClone(tables), pageSize: 4 }));
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'script-run.mjs'), file, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env['PATH'] ?? '', BE17_WORLD: worldFile, AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'be18-fake', AWS_SECRET_ACCESS_KEY: 'be18-fake', ...ENV, ...(opts.env ?? {}),
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@BE18@@'));
  if (!line) throw new Error(`the script printed no result:\n${out.slice(-2000)}`);
  return JSON.parse(line.slice('@@BE18@@'.length));
}

/** Every log line a run wrote, as one lower-case text (message and extra fields). */
export function logText(run: { calls: Call[] }): string {
  return run.calls
    .filter((c): c is Extract<Call, { service: 'log' }> => c.service === 'log')
    .map((l) => `${l.level} ${l.message} ${JSON.stringify(l.extra ?? '')}`)
    .join('\n')
    .toLowerCase();
}
