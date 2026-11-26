import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ENV, REPO, T0, type Answer, type Call, type Run, type World18,
} from '../onb-18/lambda-harness';
import { inviteEvent } from '../onb-18/lambda-harness';
import type { Caller } from '../onb-03/lambda-harness';

/**
 * REC-06.2: runs the real lambda/resendInvite in a fresh Node process (a cold Lambda) against this card's copy of the fake AWS
 * (./fake-aws, copied from ../onb-18/fake-aws; only client-sfn.mjs is changed). The fake Step Functions records every StartExecution
 * with its input and answers as `world.sfn.mode` says (ok, exists, denied, throttle, or hang: it never answers until the caller's abort
 * signal fires). The clock is fixed (Date.now() answers one moment); timers are real, so the 3-second limit really takes 3 seconds.
 * Nothing reaches AWS, Postmark or any AI service.
 */
export * from '../onb-18/lambda-harness';

const FAKE_AWS = join(__dirname, 'fake-aws');
export const RESEND_INVITE = join(REPO, 'lambda', 'resendInvite', 'index.mjs');

export type SfnMode = 'ok' | 'exists' | 'denied' | 'throttle' | 'hang';
export type World62 = World18 & { sfn?: { mode: SfnMode } };
export type Run62 = Run & {
  /** Real time the process took, in milliseconds. */
  ms: number;
  /** The process ended without printing a result (it was killed or it hung). */
  hung?: string;
};

export const STATE_MACHINE_ARN = 'arn:aws:states:af-south-1:000000000000:stateMachine:naleko-onboarding-flow-rec062';

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

export type ResendOpts = { now?: string; env?: Record<string, string | undefined>; timeoutMs?: number };

/** The settings resendInvite runs with: the ONB-18 set plus the state machine's ARN (a test may remove or change either). */
export const RESEND_ENV: Record<string, string> = { ...ENV, SFN_STATE_MACHINE_ARN: STATE_MACHINE_ARN, INVITE_TEST_LINK: 'true' };

/** Who calls: a signed-in person and the company their token carries (tenant_id claim). */
export type Who = { caller: Caller; tenant: string };

/** POST /v1/employees/{id}/invite as `who`, once, in a fresh process. */
export function resendOnce(world: World62, who: Who, id: string, opts: ResendOpts = {}): Run62 {
  const event = inviteEvent('POST', id, who.caller) as Record<string, any>;
  const claims = event['requestContext']?.authorizer?.jwt?.claims;
  if (claims) claims['tenant_id'] = who.tenant;
  const dir = mkdtempSync(join(tmpdir(), 'rec-06-2-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify({ pageSize: 4, ...structuredClone(world) }));
  writeFileSync(eventFile, JSON.stringify({ events: [event], concurrent: false }));
  const env: Record<string, string | undefined> = {
    PATH: process.env['PATH'],
    ONB04_WORLD: worldFile,
    ONB04_NOW: opts.now ?? T0,
    TZ: 'UTC',
    AWS_REGION: 'af-south-1',
    AWS_ACCESS_KEY_ID: 'rec062-fake',
    AWS_SECRET_ACCESS_KEY: 'rec062-fake',
    KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/rec-06-2-fake',
    EMPLOYEES_TABLE: 'employees',
    POSTMARK_API_TOKEN: 'rec062-fake-postmark-token',
    POWERTOOLS_DEV: 'false',
    POWERTOOLS_TRACE_ENABLED: 'false',
    ...RESEND_ENV,
    ...(opts.env ?? {}),
  };
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  const started = Date.now();
  let out = '';
  let hung: string | undefined;
  try {
    out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), RESEND_INVITE, eventFile], {
      cwd: dir, encoding: 'utf8', timeout: opts.timeoutMs ?? 30_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: clean,
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    out = String(err.stdout ?? '');
    hung = `the process ended without an answer: ${String(err.message ?? e).slice(0, 300)} ${String(err.stderr ?? '').slice(-300)}`;
  }
  const ms = Date.now() - started;
  const lines = out.split('\n');
  const line = lines.find((l) => l.startsWith('@@ONB04@@'));
  if (!line) {
    return { response: undefined, status: NaN, body: null, raw: '', all: [], calls: [], world: world as never, output: out, ms, hung: hung ?? 'the handler printed no result' } as Run62;
  }
  const result = JSON.parse(line.slice('@@ONB04@@'.length)) as {
    responses: any[]; errors: Array<Answer['error'] | null>; loadError?: Answer['error']; calls: Call[]; tables: World18['tables']; cognito: World18['cognito'];
  };
  if (result.loadError) {
    const e = new Error(`${RESEND_INVITE} could not be loaded: ${result.loadError.message}`);
    e.stack = result.loadError.stack;
    throw e;
  }
  const first = answerOf(result.responses[0], result.errors[0] ?? undefined);
  return {
    ...first,
    all: [first],
    calls: result.calls,
    world: { ...world, tables: result.tables, cognito: result.cognito },
    output: lines.filter((l) => !l.startsWith('@@ONB04@@')).join('\n'),
    ms,
  } as Run62;
}
