import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, type Login, type SignInPage } from '../fixtures';
import { apiEvent, type Caller } from '../onb-03/lambda-harness';
import {
  CREATE, ENV, INVITE, LOOKUP, REDEEM, REPO, T0, createEvent, publicEvent, row, type Answer, type Call, type Run, type World,
} from '../onb-04/lambda-harness';

/**
 * ONB-18: the ONB-04 / ONB-04.2 Lambda harness (../onb-04.2/lambda-harness.ts, ONB-04.2 lock), run against this
 * card's copy of the fake AWS (./fake-aws). The copy only adds world.postmarkFail: every Postmark send throws, as the
 * client does when the server refuses or cannot be reached. A pool user's `enabled: false` is Cognito's Enabled
 * (the fake already answers it).
 *
 * Adds the card's two routes on the employees API, each run as the real handler in a fresh Node process:
 *   - lambda/getInvite     GET  /v1/employees/{id}/invite  (JWT, HR only)
 *   - lambda/resendInvite  POST /v1/employees/{id}/invite  (JWT, HR only, no body)
 * and lambda/shared/invite-email.mjs inviteEmail({ company, firstName, hrName, link, sentAt, expiresAt }).
 * Nothing reaches AWS, Postmark or any AI service.
 */
export * from '../onb-04.2/lambda-harness';

const FAKE_AWS = join(__dirname, 'fake-aws');
const LAMBDA = join(REPO, 'lambda');
export const GET_INVITE = join(LAMBDA, 'getInvite', 'index.mjs');
export const RESEND = join(LAMBDA, 'resendInvite', 'index.mjs');
export const INVITE_EMAIL = join(LAMBDA, 'shared', 'invite-email.mjs');

/** The world this card runs on: ONB-04's, plus a switch that makes Postmark fail. */
export type World18 = World & { postmarkFail?: boolean };

function answerOf(r: any, error?: Answer['error']): Answer {
  const rawBody = r && typeof r === 'object' && 'body' in r ? r.body : undefined;
  const raw = typeof rawBody === 'string' ? rawBody : rawBody === undefined || rawBody === null ? '' : JSON.stringify(rawBody);
  let parsed: unknown = rawBody ?? null;
  if (typeof rawBody === 'string') {
    try {
      parsed = rawBody === '' ? null : JSON.parse(rawBody);
    } catch {
      parsed = rawBody;
    }
  }
  return { response: r, status: Number(r?.statusCode), body: parsed, raw, ...(error ? { error } : {}) };
}

type Opts = { now?: string; env?: Record<string, string>; concurrent?: boolean; call?: string };

/** Runs `file` once per event (or all at once with `concurrent`) in one fresh process against `world`. */
export function runModule(file: string, world: World18, events: unknown[], opts: Opts = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'onb-18-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify({ pageSize: 4, ...structuredClone(world) }));
  writeFileSync(eventFile, JSON.stringify({ events, concurrent: !!opts.concurrent, ...(opts.call ? { call: opts.call } : {}) }));
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    ONB04_WORLD: worldFile,
    ONB04_NOW: opts.now ?? T0,
    TZ: 'UTC',
    AWS_REGION: 'af-south-1',
    AWS_ACCESS_KEY_ID: 'onb18-fake',
    AWS_SECRET_ACCESS_KEY: 'onb18-fake',
    KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/onb-18-fake',
    EMPLOYEES_TABLE: 'employees',
    POSTMARK_API_TOKEN: 'onb18-fake-postmark-token',
    POWERTOOLS_DEV: 'false',
    POWERTOOLS_TRACE_ENABLED: 'false',
    ...ENV,
    ...(opts.env ?? {}),
  };
  for (const [k, v] of Object.entries(env)) if (v === '') delete env[k];
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), file, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  const lines = out.split('\n');
  const line = lines.find((l) => l.startsWith('@@ONB04@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  const result = JSON.parse(line.slice('@@ONB04@@'.length)) as {
    responses: any[]; errors: Array<Answer['error'] | null>; loadError?: Answer['error']; calls: Call[]; tables: World['tables']; cognito: World['cognito'];
  };
  if (result.loadError) {
    const e = new Error(`${file} could not be loaded: ${result.loadError.message}`);
    e.stack = result.loadError.stack;
    throw e;
  }
  const all = events.map((_e, i) => answerOf(result.responses[i], result.errors[i] ?? undefined));
  return {
    ...all[0]!,
    all,
    calls: result.calls,
    world: { ...world, tables: result.tables as World['tables'], cognito: result.cognito },
    output: lines.filter((l) => !l.startsWith('@@ONB04@@')).join('\n'),
  };
}

// ---------------------------------------------------------------- the routes (ONB-04's, on this fake)

export const create = (world: World18, caller: Caller, b?: unknown, opts: Opts = {}) => runModule(CREATE, world, [createEvent(caller, b)], opts);
export const lookup = (world: World18, token: unknown, opts: Opts = {}) => runModule(LOOKUP, world, [publicEvent('/v1/invites/lookup', token === undefined ? {} : { token })], opts);
export const redeem = (world: World18, token: unknown, password: unknown, opts: Opts = {}) =>
  runModule(REDEEM, world, [publicEvent('/v1/invites/redeem', { token, password })], opts);
export const issue = (world: World18, args: { employee: Record<string, unknown>; hrPartner: Record<string, unknown> | null; sentBy: string }, opts: Opts = {}) =>
  runModule(INVITE, world, [args], { ...opts, call: 'issueInvite' });

// ---------------------------------------------------------------- the card's two routes

/** An HTTP API event for GET or POST /v1/employees/{id}/invite, with the path parameter API Gateway hands over. */
export function inviteEvent(method: 'GET' | 'POST', id: string, caller: Caller, opts: { body?: unknown; query?: Record<string, string>; headers?: Record<string, string> } = {}): unknown {
  const path = `/v1/employees/${encodeURIComponent(id)}/invite`;
  const e = apiEvent({ method, route: path, caller, body: opts.body, query: opts.query, headers: opts.headers }) as Record<string, any>;
  const routeKey = `${method} /v1/employees/{id}/invite`;
  return { ...e, routeKey, rawPath: path, pathParameters: { id }, requestContext: { ...e['requestContext'], routeKey } };
}

export const getInvite = (world: World18, caller: Caller, id: string, opts: Opts & { body?: unknown; query?: Record<string, string>; headers?: Record<string, string> } = {}) =>
  runModule(GET_INVITE, world, [inviteEvent('GET', id, caller, opts)], opts);
export const resend = (world: World18, caller: Caller, id: string, opts: Opts & { body?: unknown; query?: Record<string, string>; headers?: Record<string, string> } = {}) =>
  runModule(RESEND, world, [inviteEvent('POST', id, caller, opts)], opts);

/** Calls inviteEmail(args) from lambda/shared/invite-email.mjs in a fresh process; the answer is in `response`. */
export const inviteEmail = (args: Record<string, unknown>) => runModule(INVITE_EMAIL, { tables: { employees: [], employee_invites: [] }, cognito: { users: [] } }, [args], { call: 'inviteEmail' });

/** An invite row as issueInvite stores it, for setting up a world by hand. */
export function inviteRow(over: { token_hash: string; employee_id: string; created_at: string; expires_at: string; sent_by?: string; replaced_at?: string; used_at?: string; failed_attempts?: number }) {
  const { failed_attempts, ...rest } = over;
  return row({ sent_by: 'E2EHR01', ttl: Math.floor(Date.parse(over.expires_at) / 1000) + 30 * 86_400, ...rest, ...(failed_attempts !== undefined ? { failed_attempts } : {}) });
}

// ---------------------------------------------------------------- pepla-dev

export function devEnv(): { api: string } {
  const file = join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts');
  const src = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const api = new RegExp(`employeesApiUrl\\s*:\\s*['"\`]([^'"\`]+)['"\`]`).exec(src)?.[1] ?? '';
  expect(api, 'employeesApiUrl points at pepla-dev, not the placeholder').not.toMatch(/\.invalid\b|^$/);
  return { api: api.replace(/\/+$/, '') };
}

/** Signs in through the page and hands back the ID token Cognito gave (ONB-04's pattern). */
export async function signInForToken(page: Page, signIn: SignInPage, login: Login): Promise<string> {
  let token = '';
  const listen = async (r: import('@playwright/test').Response) => {
    if (!/cognito-idp\.[a-z0-9-]+\.amazonaws\.com/.test(r.url()) || r.request().method() !== 'POST') return;
    try {
      const b = (await r.json()) as { AuthenticationResult?: { IdToken?: string } };
      if (b.AuthenticationResult?.IdToken) token = b.AuthenticationResult.IdToken;
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
