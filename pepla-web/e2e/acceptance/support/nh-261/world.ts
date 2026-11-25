import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAMBDA, jwtAuthorizer, row, runHandler, type Call, type Run, type Tables } from '../rec-14/lambda-harness';

/**
 * NH-261: the world the lookup tests run in. The real handler (lambda/lookupEmployeeEmail/index.mjs) runs in a fresh Node
 * process per call against REC-14's fake AWS (support/rec-14, read only, not changed). Company A has a legacy-id employee
 * and a UUID employee, company B one legacy-id employee; each carries an email marker that must never come back.
 * Nothing here reaches AWS or any AI.
 */

export const HANDLER = join(LAMBDA, 'lookupEmployeeEmail', 'index.mjs');
export const LAMBDA_DIR = join(LAMBDA, 'lookupEmployeeEmail');
export const ROUTE = 'GET /v1/employees/lookup';
export const PATH = '/v1/employees/lookup';

export const A = 'nh261-tenant-a';
export const B = 'nh261-tenant-b';
export const A_LEGACY = 'EMP-0000001';
export const B_LEGACY = 'EMP-0000002';
export const A_UUID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
export const UNKNOWN_UUID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
export const MARKERS = ['nh261-a-1@example.com', 'nh261-a-2@example.com', 'nh261-b-1@example.com'];
export const BOOM = 'nh261-planted-boom';
/** Values the AC-3 (d) call sends in headers and body; none may reach a log line. */
export const HEADER_VALUES = { 'x-tenant-id': A, 'x-company-id': A, 'x-nh261-probe': 'nh261-header-probe-value', 'user-agent': 'nh261-agent-probe' };
export const SOURCE_IP = '198.51.100.61';

/** The fixed answer of rule 1, byte for byte. */
export const FIXED_BODY = '{"error":"Not found"}';

export const TABLES: Tables = {
  employees: [
    row({ employee_id: A_LEGACY, email: MARKERS[0], tenant_id: A, first_name: 'Nh261', last_name: 'Alpha' }),
    row({ employee_id: A_UUID, email: MARKERS[1], tenant_id: A, first_name: 'Nh261', last_name: 'Beta' }),
    row({ employee_id: B_LEGACY, email: MARKERS[2], tenant_id: B, first_name: 'Nh261', last_name: 'Gamma' }),
  ],
};
/** A build may read the table name from its settings; both names point at the seeded table. */
export const ENV = { EMPLOYEES_TABLE: 'employees', EMPLOYEES_TABLE_NAME: 'employees', TABLE_NAME: 'employees' };

/** An HTTP API (payload 2.0) event for the lookup route, as API Gateway hands it over. */
export function lookupEvent(opts: { query?: Record<string, string> | null; rawQuery?: string; method?: string; headers?: Record<string, string>; authorizer?: unknown; body?: unknown } = {}): any {
  const query = opts.query === null ? undefined : opts.query;
  const raw = opts.rawQuery ?? (query ? new URLSearchParams(query).toString() : '');
  const method = opts.method ?? 'GET';
  return {
    version: '2.0',
    routeKey: ROUTE,
    rawPath: PATH,
    rawQueryString: raw,
    headers: { accept: 'application/json', ...(opts.headers ?? {}) },
    ...(query ? { queryStringParameters: query } : {}),
    requestContext: {
      http: { method, path: PATH, protocol: 'HTTP/1.1', sourceIp: SOURCE_IP, userAgent: opts.headers?.['user-agent'] ?? 'nh-261-acceptance' },
      routeKey: ROUTE,
      stage: '$default',
      ...(opts.authorizer === undefined ? {} : { authorizer: opts.authorizer }),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    isBase64Encoded: false,
  };
}

/** The HR person of a company, as the JWT authorizer would pass them (the route has none today; a build must not care). */
export const hrOf = (tenant: string, who: string) => jwtAuthorizer({ sub: `nh261-${who}-sub`, email: `${who}@nh261-hr.test`, tenant_id: tenant, 'custom:tenant_id': tenant, 'cognito:groups': '[hr_staff]' });

export const run = (event: unknown): Run => runHandler(HANDLER, event, { tables: TABLES, env: ENV });

/** AC-5: runs the handler with the planted error thrown from inside (support/nh-261/boom-run.mjs). */
export function runBoom(mode: 'event' | 'powertools'): Run {
  const fake = join(__dirname, '..', 'rec-14', 'fake-aws');
  const dir = mkdtempSync(join(tmpdir(), 'nh-261-'));
  const worldFile = join(dir, 'world.json');
  writeFileSync(worldFile, JSON.stringify({ indexes: {}, tables: structuredClone(TABLES), secrets: {}, pageSize: 4, cognito: { users: [] } }));
  const out = execFileSync(process.execPath, ['--no-warnings', '--require', join(fake, 'cjs-hook.cjs'), '--import', join(fake, 'register.mjs'), '--import', join(__dirname, 'boom-register.mjs'), join(__dirname, 'boom-run.mjs'), HANDLER], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    env: { PATH: process.env['PATH'] ?? '', TEN03_WORLD: worldFile, AWS_REGION: 'af-south-1', AWS_ACCESS_KEY_ID: 'nh261-fake', AWS_SECRET_ACCESS_KEY: 'nh261-fake', POWERTOOLS_DEV: 'false', POWERTOOLS_TRACE_ENABLED: 'false', NH261_BOOM: mode, ...ENV },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@TEN03@@'));
  if (!line) throw new Error('the boom run printed no result');
  return JSON.parse(line.slice('@@TEN03@@'.length));
}

// ---------------------------------------------------------------- reading a run

export const statusOf = (r: Run): unknown => r.response?.statusCode;
export const rawBodyOf = (r: Run): unknown => r.response?.body;
/** Header value by name, any case. */
export function headerOf(r: Run, name: string): unknown {
  const h = (r.response?.headers ?? {}) as Record<string, unknown>;
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : h[k];
}
/** Everything a caller could see: status, headers, multi-value headers, cookies and body, as one text. */
export const answerText = (r: Run): string => JSON.stringify(r.response ?? null) + (r.error ? ' THREW' : '');
/** Every call that is not a log line (AWS, HTTP, anything the fake recorded). */
export const outsideCalls = (r: Run): string[] =>
  (r.calls as any[]).filter((c) => c.service !== 'log').map((c) => `${c.service} ${c.op ?? ''}${c.table ? ' ' + c.table : ''}`);
export const logCalls = (r: Run): Extract<Call, { service: 'log' }>[] => (r.calls as any[]).filter((c) => c.service === 'log');
/** A log line as text, extra fields included. */
export const logText = (c: { message: string; extra?: unknown; level: string }) => `${c.level} ${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`;
/**
 * A short, safe description of a run for a failure message: status, header names, body length and whether it held a
 * marker. Never the body itself, so a failing test does not print an employee email.
 */
export function describe(r: Run): string {
  const body = typeof rawBodyOf(r) === 'string' ? (rawBodyOf(r) as string) : JSON.stringify(rawBodyOf(r) ?? null);
  const marker = MARKERS.some((m) => answerText(r).includes(m));
  const bodyShown = marker || body.includes('@') ? `<${body.length} chars, holds an email>` : body.slice(0, 80);
  return `status ${String(statusOf(r))}, headers [${Object.keys(r.response?.headers ?? {}).join(', ')}], body ${bodyShown}${r.error ? `, threw ${r.error.name}` : ''}`;
}
/** A log line for a failure message with every email marker and the planted text blanked. */
export const safeLog = (s: string) => MARKERS.reduce((t, m) => t.split(m).join('<email marker>'), s).replace(/[^\s"'@]+@[^\s"']+/g, '<email>');
