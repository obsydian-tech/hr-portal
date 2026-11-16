import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { INFRA, blocks, tfFiles } from '../infra-harness';

/**
 * ONB-24 AC-11: runs the real cognitoEmailSender and cognitoPostConfirmation handlers, each in a fresh Node
 * process (a cold Lambda), against the fake AWS in ./fake-aws: the AWS Encryption SDK with a KMS keyring,
 * SSM (the Postmark token), DynamoDB (the dev sink), Cognito (AdminUserGlobalSignOut), CloudWatch and
 * Powertools, and a fake Postmark (the `postmark` package or a fetch to api.postmarkapp.com). Everything the
 * handler prints is kept as a log line. Nothing reaches AWS, Postmark or any AI service.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
const FAKE_AWS = join(__dirname, 'fake-aws');
export const SENDER = join(REPO, 'lambda', 'cognitoEmailSender', 'index.mjs');
export const POST_CONFIRMATION = join(REPO, 'lambda', 'cognitoPostConfirmation', 'index.mjs');

export const POOL_ID = 'af-south-1_Onb24Fake';
export const PII_KEY_ARN = 'arn:aws:kms:af-south-1:000000000000:key/onb-24-pii-key';
const TOKEN = 'onb24-fake-postmark-token-7f3a';
const SENDER_EMAIL = 'sender@naleko.test';
export const SINK = 'naleko-people-dev-reset-test-sink';

const SUBJECT = 'Your Naleko People code';
const body = (code: string) => `Your code to reset your Naleko People password is ${code}. It works for 1 hour. If you did not ask for this, ignore this email. Your password has not changed.`;

type Call =
  | { service: 'log'; level: string; message: string; msg?: string; logger?: boolean }
  | { service: 'postmark'; op: string; message: any; token: string | null }
  | { service: 'kms'; op: string; keys?: string[]; discovery?: boolean; context?: Record<string, string> }
  | { service: 'ssm'; op: string; name: string }
  | { service: 'dynamodb'; op: string; table: string; item?: Record<string, unknown> }
  | { service: 'cognito'; op: string; input: any }
  | { service: 'metric'; op: string; name: string }
  | { service: 'network'; op: string; url: string };

type Run = { response: any; error?: { name: string; message: string }; calls: Call[] };

function run(handler: string, event: unknown, opts: { env?: Record<string, string>; fail?: { postmark?: boolean; signOut?: boolean } } = {}): Run {
  expect(existsSync(handler), `${handler.slice(REPO.length + 1)} exists`).toBe(true);
  const dir = mkdtempSync(join(tmpdir(), 'onb-24-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify({ fail: opts.fail ?? {}, tables: {} }));
  writeFileSync(eventFile, JSON.stringify(event));
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env['PATH'] ?? '',
      ONB24_WORLD: worldFile,
      ONB24_PII_KEY_ARN: PII_KEY_ARN,
      ONB24_POSTMARK_TOKEN: TOKEN,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'onb24-fake',
      AWS_SECRET_ACCESS_KEY: 'onb24-fake',
      ENVIRONMENT: 'dev',
      COGNITO_POOL_ID: POOL_ID,
      // The PII key, under every name the sender may read it by (the AWS example uses KEY_ID and KEY_ARN).
      KMS_KEY_ARN: PII_KEY_ARN,
      KMS_KEY_ID: PII_KEY_ARN,
      KEY_ARN: PII_KEY_ARN,
      KEY_ID: PII_KEY_ARN,
      POSTMARK_API_TOKEN: TOKEN,
      POSTMARK_TOKEN_PARAMETER: '/naleko/postmark/api_token',
      POSTMARK_SENDER_EMAIL: SENDER_EMAIL,
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
      POWERTOOLS_METRICS_NAMESPACE: 'Naleko',
      ...opts.env,
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@ONB24@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  return JSON.parse(line.slice('@@ONB24@@'.length)) as Run;
}

/** The code as Cognito hands it over: an AWS Encryption SDK message for this pool (the fake's format). */
function encrypted(code: string): string {
  return Buffer.from('ONB24-ESDK:' + JSON.stringify({ context: { 'userpool-id': POOL_ID }, plain: code }), 'utf8').toString('base64');
}

const SUB = '3f1c2a9e-0b7d-4e55-9c1a-2b6d8e0f4a11';

function senderEvent(source: string, email: string, code: string): unknown {
  return {
    version: '1',
    triggerSource: source,
    region: 'af-south-1',
    userPoolId: POOL_ID,
    userName: SUB,
    callerContext: { awsSdkVersion: 'aws-sdk-unknown-unknown', clientId: 'onb24fakeclient' },
    request: {
      type: 'customEmailSenderRequestV1',
      code: encrypted(code),
      clientMetadata: {},
      userAttributes: { sub: SUB, email, email_verified: 'true', given_name: 'Jane', family_name: 'Smith', 'cognito:user_status': 'CONFIRMED' },
    },
    response: {},
  };
}

function postConfirmationEvent(source: string, email: string): Record<string, unknown> {
  return {
    version: '1',
    triggerSource: source,
    region: 'af-south-1',
    userPoolId: POOL_ID,
    userName: SUB,
    callerContext: { awsSdkVersion: 'aws-sdk-unknown-unknown', clientId: 'onb24fakeclient' },
    request: { userAttributes: { sub: SUB, email, email_verified: 'true', 'cognito:user_status': 'CONFIRMED' } },
    response: {},
  };
}

const logs = (r: Run) => r.calls.filter((c): c is Extract<Call, { service: 'log' }> => c.service === 'log').map((c) => c.message);
const sends = (r: Run) => r.calls.filter((c): c is Extract<Call, { service: 'postmark' }> => c.service === 'postmark');
const sinkWrites = (r: Run) => r.calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb' && c.op === 'PutItem');
const metrics = (r: Run) => r.calls.filter((c): c is Extract<Call, { service: 'metric' }> => c.service === 'metric').map((c) => c.name);
/** Metrics the handler printed in CloudWatch embedded metric format. */
const emfMetrics = (r: Run) =>
  logs(r).flatMap((l) => {
    const names: string[] = [];
    for (const piece of l.split('\n')) {
      try {
        const o = JSON.parse(piece) as { _aws?: { CloudWatchMetrics?: Array<{ Metrics?: Array<{ Name?: string }> }> } };
        for (const d of o._aws?.CloudWatchMetrics ?? []) for (const m of d.Metrics ?? []) if (m.Name) names.push(m.Name);
      } catch {
        /* not JSON */
      }
    }
    return names;
  });
/**
 * The run counted metric `name`: through Powertools Metrics, CloudWatch PutMetricData, the embedded metric
 * format, or a log line that the Terraform log metric filter for `name` on this Lambda's log group matches
 * (the ONB-04 InviteFailed way).
 */
function counted(r: Run, name: string, lambda: string): boolean {
  if ([...metrics(r), ...emfMetrics(r)].includes(name)) return true;
  return metricFilters(name, lambda).some((pattern) => r.calls.some((c) => c.service === 'log' && filterMatches(pattern, c)));
}

/** The patterns of every aws_cloudwatch_log_metric_filter in infra/ that makes metric `name` from /aws/lambda/<lambda>. */
function metricFilters(name: string, lambda: string): string[] {
  const out: string[] = [];
  for (const b of blocks(tfFiles(INFRA).concat(tfFiles(join(INFRA, 'modules', 'alarms'))), 'resource')) {
    if (b.labels[0] !== 'aws_cloudwatch_log_metric_filter') continue;
    if (!new RegExp(`metric_transformation\\s*\\{[^}]*\\bname\\s*=\\s*"${name}"`).test(b.body)) continue;
    if (!b.body.includes(`/aws/lambda/${lambda}`)) continue;
    const m = /\bpattern\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(b.body);
    if (m) out.push(m[1]!.replace(/\\"/g, '"'));
  }
  return out;
}

/** CloudWatch filter patterns: `{ $.message = "X" }` (JSON) or quoted / bare terms that must all appear. */
function filterMatches(pattern: string, line: { message: string; msg?: string; logger?: boolean }): boolean {
  const json = /^\{\s*\$\.(\w+)\s*=\s*"([^"]*)"\s*\}$/.exec(pattern.trim());
  if (json) {
    if (json[1] === 'message' && line.logger) return line.msg === json[2];
    try {
      return (JSON.parse(line.message) as Record<string, unknown>)[json[1]!] === json[2];
    } catch {
      return false;
    }
  }
  const terms = [...pattern.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
  return terms.length > 0 && terms.every((t) => line.message.includes(t));
}

/** The logs hold none of these. */
function expectClean(r: Run, what: string, secrets: string[]): void {
  const all = logs(r).join('\n');
  for (const s of secrets) expect(all, `${what}: the logs never hold "${s}"`).not.toContain(s);
  expect(r.calls.filter((c) => c.service === 'network'), `${what}: no network call except Postmark`).toEqual([]);
}

/** Exactly one email, from POSTMARK_SENDER_EMAIL to the person, with the card's words and the code. */
function expectOneEmail(r: Run, what: string, to: string, code: string): void {
  const s = sends(r);
  expect(s, `${what}: one Postmark email`).toHaveLength(1);
  const m = s[0]!.message as Record<string, string | undefined>;
  expect(s[0]!.token ?? TOKEN, `${what}: sent with the Postmark token`).toBe(TOKEN);
  expect(m['To'], `${what}: to the person's email attribute`).toBe(to);
  expect(m['From'], `${what}: from POSTMARK_SENDER_EMAIL`).toMatch(new RegExp(`(^|<)${SENDER_EMAIL.replace(/[.]/g, '\\.')}>?$`));
  expect(m['Subject'], `${what}: the subject`).toBe(SUBJECT);
  expect((m['TextBody'] ?? '').replace(/\s+/g, ' '), `${what}: the plain text body`).toContain(body(code));
  const html = (m['HtmlBody'] ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  expect(html, `${what}: an HTML body with the code`).toContain(code);
  expect(html, `${what}: the HTML body says it works for 1 hour`).toContain('It works for 1 hour.');
  expect(m['Tag'], `${what}: tag password-reset`).toBe('password-reset');
  expect([undefined, 'outbound', 'password-reset'], `${what}: a transactional message stream`).toContain(m['MessageStream']);
}

/** The code was decrypted by the AWS Encryption SDK with a KMS keyring holding the PII key, for this pool. */
function expectDecryptedWithPiiKey(r: Run, what: string): void {
  const d = r.calls.filter((c): c is Extract<Call, { service: 'kms' }> => c.service === 'kms' && c.op === 'Decrypt');
  expect(d.length, `${what}: the code is decrypted through the Encryption SDK`).toBeGreaterThanOrEqual(1);
  expect(d[0]!.discovery, `${what}: a keyring naming the key, not a discovery keyring`).toBe(false);
  expect(d[0]!.keys, `${what}: the keyring holds the PII key`).toContain(PII_KEY_ARN);
  expect(d[0]!.context, `${what}: the pool's encryption context`).toEqual({ 'userpool-id': POOL_ID });
}

export const lambdaChecks = {
  emailSender(): void {
    const email = 'jane.smith@example.com';
    const code = '482913';
    const secrets = [code, email, TOKEN];

    // The forgot-password email.
    const plain = run(SENDER, senderEvent('CustomEmailSender_ForgotPassword', email, code));
    expect(plain.error, 'ForgotPassword: no error').toBeUndefined();
    expectDecryptedWithPiiKey(plain, 'ForgotPassword');
    expectOneEmail(plain, 'ForgotPassword', email, code);
    expect(sinkWrites(plain), 'ForgotPassword with no sink setting: nothing written').toEqual([]);
    expectClean(plain, 'ForgotPassword', secrets);
    const said = logs(plain).join('\n');
    expect(said, 'ForgotPassword: the log names the trigger source').toContain('CustomEmailSender_ForgotPassword');
    expect(said, 'ForgotPassword: the log names the user by sub').toContain(SUB);
    for (const c of plain.calls.filter((c) => c.service === 'ssm')) expect((c as { name: string }).name, 'SSM: only the Postmark token').toBe('/naleko/postmark/api_token');

    // pepla-dev: a blackhole address with the sink set also writes { email, code, expiresAt } for 15 minutes.
    const blackhole = 'e2e.run-1-ac11@blackhole.postmarkapp.com';
    const before = Math.floor(Date.now() / 1000);
    const dev = run(SENDER, senderEvent('CustomEmailSender_ForgotPassword', blackhole, code), { env: { RESET_TEST_SINK_TABLE: SINK } });
    const after = Math.floor(Date.now() / 1000);
    expect(dev.error, 'dev sink: no error').toBeUndefined();
    expectOneEmail(dev, 'dev sink', blackhole, code);
    const w = sinkWrites(dev);
    expect(w, 'dev sink: one row').toHaveLength(1);
    expect(w[0]!.table, 'dev sink: in RESET_TEST_SINK_TABLE').toBe(SINK);
    const row = w[0]!.item!;
    expect(Object.keys(row).sort(), 'dev sink: the row is { email, code, expiresAt }').toEqual(['code', 'email', 'expiresAt']);
    expect(row['email']).toBe(blackhole);
    expect(row['code']).toBe(code);
    expect(Number(row['expiresAt']), 'dev sink: expires 15 minutes after the write (epoch seconds)').toBeGreaterThanOrEqual(before + 900);
    expect(Number(row['expiresAt'])).toBeLessThanOrEqual(after + 900);
    expectClean(dev, 'dev sink', [code, blackhole, TOKEN]);

    // The sink set but a real address, or a blackhole address with no sink: nothing written.
    const realAddress = run(SENDER, senderEvent('CustomEmailSender_ForgotPassword', email, code), { env: { RESET_TEST_SINK_TABLE: SINK } });
    expect(realAddress.error).toBeUndefined();
    expect(sinkWrites(realAddress), 'sink set, an ordinary address: nothing written').toEqual([]);
    expectOneEmail(realAddress, 'sink set, an ordinary address', email, code);
    const tricky = run(SENDER, senderEvent('CustomEmailSender_ForgotPassword', 'jane@blackhole.postmarkapp.com.example.com', code), { env: { RESET_TEST_SINK_TABLE: SINK } });
    expect(sinkWrites(tricky), 'sink set, an address that only contains the blackhole domain: nothing written').toEqual([]);
    const noSink = run(SENDER, senderEvent('CustomEmailSender_ForgotPassword', blackhole, code));
    expect(noSink.error).toBeUndefined();
    expect(sinkWrites(noSink), 'a blackhole address with the sink unset: nothing written').toEqual([]);

    // Any other trigger source: nothing sent, nothing written, the source logged.
    for (const source of ['CustomEmailSender_SignUp', 'CustomEmailSender_ResendCode', 'CustomEmailSender_UpdateUserAttribute', 'CustomEmailSender_VerifyUserAttribute', 'CustomEmailSender_AdminCreateUser', 'CustomEmailSender_AccountTakeOverNotification', 'CustomEmailSender_Authentication']) {
      const other = run(SENDER, senderEvent(source, email, code), { env: { RESET_TEST_SINK_TABLE: SINK } });
      expect(other.error, `${source}: no error`).toBeUndefined();
      expect(sends(other), `${source}: nothing sent`).toEqual([]);
      expect(sinkWrites(other), `${source}: nothing written`).toEqual([]);
      expect(logs(other).join('\n'), `${source}: the source is logged`).toContain(source);
      expectClean(other, source, secrets);
    }

    // Postmark fails: counted as ResetEmailFailed, and the handler throws so Cognito returns an error.
    const failed = run(SENDER, senderEvent('CustomEmailSender_ForgotPassword', email, code), { fail: { postmark: true } });
    expect(failed.error, 'a Postmark failure throws').toBeDefined();
    expect(counted(failed, 'ResetEmailFailed', 'cognitoEmailSender'), 'a Postmark failure counts ResetEmailFailed').toBe(true);
    expect(counted(plain, 'ResetEmailFailed', 'cognitoEmailSender'), 'a good send counts no ResetEmailFailed').toBe(false);
    expectClean(failed, 'a Postmark failure', secrets);
    expect(failed.error!.message, 'the error Cognito sees holds no code or address').not.toContain(code);
    expect(failed.error!.message).not.toContain(email);
  },

  postConfirmation(): void {
    const email = 'jane.smith@example.com';

    const reset = postConfirmationEvent('PostConfirmation_ConfirmForgotPassword', email);
    const r = run(POST_CONFIRMATION, reset);
    expect(r.error, 'ConfirmForgotPassword: no error').toBeUndefined();
    const signOuts = r.calls.filter((c): c is Extract<Call, { service: 'cognito' }> => c.service === 'cognito');
    expect(signOuts.map((c) => c.op), 'ConfirmForgotPassword: one AdminUserGlobalSignOut and nothing else').toEqual(['AdminUserGlobalSignOut']);
    expect(signOuts[0]!.input, 'for this user in this pool').toEqual({ UserPoolId: POOL_ID, Username: SUB });
    expect(r.response, 'the event goes back to Cognito').toEqual(reset);
    expect(logs(r).join('\n'), 'ConfirmForgotPassword: no email address in the logs').not.toContain(email);
    expect(r.calls.filter((c) => c.service === 'network')).toEqual([]);

    const signUp = postConfirmationEvent('PostConfirmation_ConfirmSignUp', email);
    const s = run(POST_CONFIRMATION, signUp);
    expect(s.error, 'ConfirmSignUp: no error').toBeUndefined();
    expect(s.calls.filter((c) => c.service === 'cognito' || c.service === 'dynamodb' || c.service === 'postmark'), 'ConfirmSignUp: calls nothing').toEqual([]);
    expect(s.response, 'ConfirmSignUp: the event goes back').toEqual(signUp);

    const failed = run(POST_CONFIRMATION, reset, { fail: { signOut: true } });
    expect(failed.error, 'a sign-out failure never throws: the password is already changed').toBeUndefined();
    expect(failed.response, 'a sign-out failure still returns the event').toEqual(reset);
    expect(counted(failed, 'ResetSignOutFailed', 'cognitoPostConfirmation'), 'a sign-out failure counts ResetSignOutFailed').toBe(true);
    expect(counted(r, 'ResetSignOutFailed', 'cognitoPostConfirmation'), 'a good sign-out counts no ResetSignOutFailed').toBe(false);
    expect(logs(failed).join('\n'), 'a sign-out failure is logged with the sub').toContain(SUB);
    expect(logs(failed).join('\n'), 'and without the email').not.toContain(email);
  },
};
