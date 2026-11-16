import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CREATE, ENV, INVITE, LOOKUP, REDEEM, T0, createEvent, publicEvent, type Answer, type Call, type Caller, type Run, type World,
} from '../onb-04/lambda-harness';

/**
 * ONB-04.2: the ONB-04 Lambda harness (../onb-04/lambda-harness.ts, ONB-04 lock), run against this card's copy of
 * the fake AWS (./fake-aws). The copy only adds Cognito's AdminListGroupsForUser, which answers the groups the fake
 * already keeps for each user. Everything else (the world, the clock, the recorded calls, the routes) is ONB-04's,
 * re-exported unchanged. Only runModule and the four route helpers are redefined, so that they use this fake.
 * Nothing reaches AWS, Postmark or any AI service.
 */
export * from '../onb-04/lambda-harness';

const FAKE_AWS = join(__dirname, 'fake-aws');

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
export function runModule(file: string, world: World, events: unknown[], opts: Opts = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'onb-04.2-lambda-'));
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
    AWS_ACCESS_KEY_ID: 'onb04-fake',
    AWS_SECRET_ACCESS_KEY: 'onb04-fake',
    KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/onb-04-fake',
    EMPLOYEES_TABLE: 'employees',
    POSTMARK_API_TOKEN: 'onb04-fake-postmark-token',
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

export const create = (world: World, caller: Caller, b?: unknown, opts: Opts = {}) => runModule(CREATE, world, [createEvent(caller, b)], opts);
export const lookup = (world: World, token: unknown, opts: Opts = {}) => runModule(LOOKUP, world, [publicEvent('/v1/invites/lookup', token === undefined ? {} : { token })], opts);
export const redeem = (world: World, token: unknown, password: unknown, opts: Opts = {}) =>
  runModule(REDEEM, world, [publicEvent('/v1/invites/redeem', { token, password })], opts);
/** issueInvite({ employee, hrPartner, sentBy }) as ONB-18 will call it. */
export const issue = (world: World, args: { employee: Record<string, unknown>; hrPartner: Record<string, unknown> | null; sentBy: string }, opts: Opts = {}) =>
  runModule(INVITE, world, [args], { ...opts, call: 'issueInvite' });

// ---------------------------------------------------------------- ONB-04.2 helpers

export type PoolUser = World['cognito']['users'][number];

/** The pool's user for an address (usernames are not case-sensitive), or undefined. */
export const userOf = (w: World, email: string): PoolUser | undefined => w.cognito.users.find((u) => u.username.toLowerCase() === email.toLowerCase());

/** A sign-in that already exists in the pool, with the status and groups a test gives it. */
export function existingUser(email: string, status: string, groups: string[], first = 'Ayanda', last = 'Zulu'): PoolUser {
  const address = email.toLowerCase();
  return {
    username: address,
    enabled: true,
    attributes: { email: address, email_verified: 'true', given_name: first, family_name: last, sub: `sub-${address}` },
    groups: [...groups],
    status,
    ...(status === 'CONFIRMED' ? { password: 'Someone-Elses-Pass1!' } : {}),
  };
}

/** A copy of the world with one pool user changed (or removed, with `null`). */
export function withUser(w: World, email: string, change: ((u: PoolUser) => void) | null): World {
  const copy = structuredClone(w);
  const i = copy.cognito.users.findIndex((u) => u.username.toLowerCase() === email.toLowerCase());
  if (i < 0) throw new Error(`no pool user ${email} to change`);
  if (change === null) copy.cognito.users.splice(i, 1);
  else change(copy.cognito.users[i]!);
  return copy;
}
