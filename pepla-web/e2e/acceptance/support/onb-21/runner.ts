import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ONB-21: runs the real lambda/sendDocumentReminders, each run in its own fresh Node process (a cold Lambda), against a
 * fake AWS (./fake-aws, copied from TEN-02's with code added): DynamoDB over rows as DynamoDB stores them (with a company
 * list, the people, their documents and the claims table), a recording Postmark that can fail per address, Powertools and
 * every console line recorded as a log line, a fixed clock and a Lambda context with the time left. Any other AWS service
 * and any AI client fails the import; outbound HTTP is refused. Nothing reaches AWS, Postmark or any AI service.
 */
export const REPO = join(__dirname, '..', '..', '..', '..', '..');
export const LAMBDA = join(REPO, 'lambda');
export const HANDLER = join(LAMBDA, 'sendDocumentReminders', 'index.mjs');
const FAKE_AWS = join(__dirname, 'fake-aws');

/** A row as DynamoDB stores it: attribute name -> AttributeValue. */
export type Row = Record<string, Record<string, unknown>>;
export type Tables = Record<string, Row[]>;
export type Email = {
  From?: string;
  To: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  TrackOpens?: boolean;
  TrackLinks?: string;
  MessageStream?: string;
  [k: string]: unknown;
};
export type Call =
  | { service: 'dynamodb'; op: string; table?: string; input: any }
  | { service: 'postmark'; op: string; message?: Email; failed?: string; tokenGiven?: boolean }
  | { service: 'log'; level: string; message: string; extra?: unknown }
  | { service: string; op: string };
export type Err = { name: string; message: string; stack: string };
export type PostmarkKind = 'inactive' | 'invalid' | 'token' | 'server' | 'rate' | 'timeout' | 'network';
export type Run = {
  /** The first run's error (a run that threw), if any. */
  error?: Err;
  errors: (Err | null)[];
  responses: unknown[];
  calls: Call[];
  tables: Tables;
  /** Every message Postmark was given and accepted, in order. */
  sent: Email[];
  /** Every message Postmark was given and refused, in order, with how. */
  refused: { message: Email; kind: string }[];
};

/** What a stored-row test gives: plain values. */
export function row(values: Record<string, string | number | boolean | undefined | null>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    out[k] = v === null ? { NULL: true } : typeof v === 'number' ? { N: String(v) } : typeof v === 'boolean' ? { BOOL: v } : { S: v };
  }
  return out;
}

/** Plain values of a stored row. */
export function plain(r: Row | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r ?? {})) out[k] = 'S' in v ? v['S'] : 'N' in v ? Number(v['N']) : 'BOOL' in v ? v['BOOL'] : 'SS' in v ? v['SS'] : v;
  return out;
}

/** The settings Terraform gives the function (values made up). A test changes or removes one by name. */
export const LOGIN_URL = 'https://people.naleko.example/sign-in';
export const SENDER = 'no-reply@naleko.example';
export const LEGACY_NONE = 'ten_zzzzzzzzzzzzzzzzzzzzzzzzzz';
export const SETTINGS: Record<string, string> = {
  EMPLOYEES_TABLE: 'employees',
  DOCUMENTS_TABLE: 'documents',
  TENANTS_TABLE: 'naleko-people-dev-tenants',
  REMINDERS_TABLE: 'naleko-people-dev-reminders',
  POSTMARK_API_TOKEN: 'onb21-fake-postmark-token',
  POSTMARK_SENDER_EMAIL: SENDER,
  LOGIN_URL,
  // A company that is in no test world, so no test reads the old way unless it sets this itself.
  LEGACY_TENANT_ID: LEGACY_NONE,
  MAX_REMINDERS_PER_RUN: '500',
  ENVIRONMENT: 'dev',
};
export const REMINDERS = SETTINGS['REMINDERS_TABLE']!;
export const TENANTS = SETTINGS['TENANTS_TABLE']!;

/** The scheduled event EventBridge gives a Lambda. */
export const scheduledEvent = (extra: Record<string, unknown> = {}) => ({
  version: '0',
  id: 'onb21-rule-run',
  'detail-type': 'Scheduled Event',
  source: 'aws.events',
  account: '000000000000',
  time: '2026-11-22T06:00:00Z',
  region: 'af-south-1',
  resources: ['arn:aws:events:af-south-1:000000000000:rule/send-document-reminders'],
  detail: {},
  ...extra,
});

export type RunOpts = {
  tables: Tables;
  /** The clock, as an ISO time with its offset. */
  now: string;
  env?: Record<string, string>;
  /** Settings left out altogether. */
  unset?: string[];
  event?: unknown;
  postmark?: { byAddress?: Record<string, PostmarkKind>; all?: PostmarkKind };
  /** The time left (ms) after 0, 1, 2 ... emails were tried; the last value stays. */
  remaining?: number[];
  /** Start this many runs at the same moment against the same tables. */
  concurrent?: number;
  pageSize?: number;
  failFor?: { table: string; ops?: string[]; company?: string };
  handler?: string;
};

export function runReminders(opts: RunOpts): Run {
  const dir = mkdtempSync(join(tmpdir(), 'onb-21-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  const world = {
    tables: structuredClone(opts.tables),
    now: opts.now,
    pageSize: opts.pageSize ?? 50,
    ...(opts.postmark ? { postmark: opts.postmark } : {}),
    ...(opts.remaining ? { remaining: opts.remaining } : {}),
    ...(opts.concurrent ? { concurrent: opts.concurrent } : {}),
    ...(opts.failFor ? { failFor: opts.failFor } : {}),
  };
  writeFileSync(worldFile, JSON.stringify(world));
  writeFileSync(eventFile, JSON.stringify(opts.event ?? scheduledEvent()));
  const env: Record<string, string> = { ...SETTINGS, ...(opts.env ?? {}) };
  for (const k of opts.unset ?? []) delete env[k];
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), opts.handler ?? HANDLER, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env['PATH'] ?? '',
      ONB21_WORLD: worldFile,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'onb21-fake',
      AWS_SECRET_ACCESS_KEY: 'onb21-fake',
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
      ...env,
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@ONB21@@'));
  if (!line) throw new Error(`the run printed no result:\n${out.slice(-2000)}`);
  const r = JSON.parse(line.slice('@@ONB21@@'.length)) as { responses: unknown[]; errors: (Err | null)[]; calls: Call[]; tables: Tables };
  const mail = r.calls.filter((c): c is Extract<Call, { service: 'postmark' }> => c.service === 'postmark' && c.op === 'sendEmail' && !!(c as any).message);
  return {
    error: r.errors.find((e) => e) ?? undefined,
    errors: r.errors,
    responses: r.responses,
    calls: r.calls,
    tables: r.tables,
    sent: mail.filter((c) => !c.failed).map((c) => c.message!),
    refused: mail.filter((c) => c.failed).map((c) => ({ message: c.message!, kind: c.failed! })),
  };
}

// ---------------------------------------------------------------- reading a run

/** Log lines (Powertools and console.*), each as its message and its extra values as JSON. */
export const logLines = (run: Run): string[] =>
  run.calls.filter((c): c is Extract<Call, { service: 'log' }> => c.service === 'log').map((c) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);

/** Calls to DynamoDB, in order. */
export const dynamo = (run: Run) => run.calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb');

/** The claims table, as plain rows. */
export const claims = (tables: Tables) => (tables[REMINDERS] ?? []).map(plain);

/** An expression with its #names and :values put back in (strings quoted), white space squashed. */
export function expanded(input: any, ...keys: string[]): string {
  const names = input?.ExpressionAttributeNames ?? {};
  const values = input?.ExpressionAttributeValues ?? {};
  const put = (s: string) =>
    s
      .replace(/#[A-Za-z_]\w*/g, (m) => names[m] ?? m)
      .replace(/:[A-Za-z_]\w*/g, (m) => {
        const v = values[m];
        if (v === undefined) return m;
        const plainValue = typeof v === 'object' && v !== null ? (v.S ?? v.N ?? v.BOOL ?? JSON.stringify(v)) : v;
        return typeof plainValue === 'string' ? `'${plainValue}'` : String(plainValue);
      })
      .replace(/\s+/g, ' ')
      .trim();
  return keys.map((k) => put(String(input?.[k] ?? ''))).join(' | ');
}

/** The attribute names a ProjectionExpression names. */
export function projected(input: any): string[] {
  const names = input?.ExpressionAttributeNames ?? {};
  return String(input?.ProjectionExpression ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => (n.startsWith('#') ? (names[n] ?? n) : n));
}
