import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { INFRA, REPO, attributes, blocks, stripComments, tfFiles, type Block } from '../infra-harness';
import { policyOf, type TfResource } from '../onb-15/tf-policy';

/**
 * ONB-24 AC-13: infra/*.tf read as text (there is no Terraform here; the PR's required Terraform check runs
 * the real plan). "Updated in place" is checked against develop at f56421a: the pool's block is unchanged
 * apart from lambda_config, and every key policy statement there is still there word for word.
 */

const HERE = __dirname;
const POOL_BASELINE = join(HERE, 'cognito.f56421a.tf.txt');
const KMS_BASELINE = join(HERE, 'kms-module.f56421a.tf.txt');
const KMS_MODULE = join(INFRA, 'modules', 'kms');
const ALARMS_MODULE = join(INFRA, 'modules', 'alarms');
const SENDER_FN = 'cognitoEmailSender';
const POST_FN = 'cognitoPostConfirmation';
const SINK_NAMES = ['"naleko-people-dev-reset-test-sink"', '"naleko-people-${var.environment}-reset-test-sink"'];

const squash = (s: string) => stripComments(s).replace(/\s+/g, '');
const all = () => tfFiles();
const resources = (type: string, files = all()) => blocks(files, 'resource').filter((b) => b.labels[0] === type);

/** Index just after the brace that closes the one at `open` (strings skipped). */
function closeBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
    } else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('unbalanced braces');
}

/** Nested blocks `kind {` and `dynamic "kind" {` directly inside `body` (any depth when deep). Returns raw text. */
function nested(body: string, kind: string): string[] {
  const src = stripComments(body);
  const out: string[] = [];
  const re = new RegExp(`(?:^|\\n)[ \\t]*(?:${kind}|dynamic[ \\t]+"${kind}")[ \\t]*\\{`, 'g');
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const open = m.index + m[0].length - 1;
    const end = closeBrace(src, open);
    out.push(src.slice(m.index, end).trim());
    re.lastIndex = end;
  }
  return out;
}

/** The body with every nested `kind` block taken out. */
function without(body: string, kind: string): string {
  let src = stripComments(body);
  for (const b of nested(src, kind)) src = src.replace(b, '');
  return src;
}

/** The aws_lambda_function whose function_name is `fn`. */
function lambdaNamed(fn: string): Block {
  const found = resources('aws_lambda_function').filter((b) => attributes(b.body).get('function_name') === `"${fn}"`);
  expect(found.length, `one aws_lambda_function named "${fn}"`).toBe(1);
  return found[0]!;
}

function roleOf(fn: Block): string {
  const role = attributes(fn.body).get('role') ?? '';
  const m = /^aws_iam_role\.([\w-]+)\.arn$/.exec(role);
  expect(m, `${fn.labels[1]}: role = aws_iam_role.<name>.arn (got ${role})`).toBeTruthy();
  return m![1]!;
}

type Stmt = { Effect?: string; Action?: string | string[]; Resource?: string | string[]; Condition?: unknown; [k: string]: unknown };
const list = (v: unknown): string[] => (v === undefined ? [] : Array.isArray(v) ? (v as string[]) : [v as string]);

/** Every statement the role's inline policies grant, and the managed policies attached to it. */
function grants(role: string): { statements: Stmt[]; managed: string[] } {
  const statements: Stmt[] = [];
  const policies = resources('aws_iam_role_policy').filter((b) => new RegExp(`^aws_iam_role\\.${role}\\.(name|id)$`).test(attributes(b.body).get('role') ?? ''));
  expect(policies.length, `aws_iam_role.${role} has an inline policy`).toBeGreaterThanOrEqual(1);
  for (const b of policies) {
    const r: TfResource = { type: 'aws_iam_role_policy', name: b.labels[1]!, raw: b.raw, body: b.body, attrs: attributes(b.body) };
    const doc = policyOf(r) as unknown as { Statement: Stmt | Stmt[] };
    statements.push(...(Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement]));
  }
  const managed = resources('aws_iam_role_policy_attachment')
    .filter((b) => new RegExp(`^aws_iam_role\\.${role}\\.(name|id)$`).test(attributes(b.body).get('role') ?? ''))
    .map((b) => attributes(b.body).get('policy_arn') ?? '');
  return { statements, managed };
}

/** Each statement: allowed only if `ok` says so. Returns the actions granted. */
function expectOnly(role: string, what: string, ok: (action: string, resources: string[]) => string | null): string[] {
  const { statements, managed } = grants(role);
  expect(managed.filter((m) => !/AWSXRayDaemonWriteAccess"?$/.test(m)), `${what}: no managed policy beyond X-Ray`).toEqual([]);
  const actions: string[] = [];
  for (const s of statements) {
    expect(s.Effect, `${what}: Allow statements only`).toBe('Allow');
    expect(s['NotAction'] ?? s['NotResource'], `${what}: no NotAction or NotResource`).toBeUndefined();
    const res = list(s.Resource);
    for (const a of list(s.Action)) {
      const why = ok(a, res);
      expect(why, `${what}: ${a} on ${res.join(', ')} is not allowed`).toBeNull();
      actions.push(a);
    }
  }
  return actions;
}

const LOGS = new Set(['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents']);
const XRAY = new Set(['xray:PutTraceSegments', 'xray:PutTelemetryRecords']);
function common(fn: string, a: string, res: string[]): string | null | undefined {
  if (LOGS.has(a)) return res.every((r) => r.includes(`log-group:/aws/lambda/${fn}`)) ? null : 'logs only on its own log group';
  if (XRAY.has(a)) return null;
  if (res.includes('*')) return 'Resource "*" only for X-Ray';
  return undefined;
}

export const terraformChecks = {
  all(): void {
    const sender = lambdaNamed(SENDER_FN);
    const post = lambdaNamed(POST_FN);
    const senderRef = `aws_lambda_function.${sender.labels[1]}`;
    const postRef = `aws_lambda_function.${post.labels[1]}`;

    // ---- The pool: updated in place, only lambda_config changes.
    const pools = resources('aws_cognito_user_pool').filter((b) => b.labels[1] === 'naleko_dev');
    expect(pools.length, 'aws_cognito_user_pool.naleko_dev is still there, under the same name').toBe(1);
    const pool = pools[0]!;
    const base = blocks([POOL_BASELINE], 'resource').find((b) => b.labels[0] === 'aws_cognito_user_pool' && b.labels[1] === 'naleko_dev')!;
    expect(squash(without(pool.body, 'lambda_config')), 'the pool changes only in lambda_config (in place: name, schema, policy, email, lifecycle all as on develop)').toBe(
      squash(without(base.body, 'lambda_config')),
    );
    expect(pool.body, 'prevent_destroy stays').toMatch(/prevent_destroy\s*=\s*true/);
    expect(pool.body, 'email_configuration stays COGNITO_DEFAULT').toMatch(/email_sending_account\s*=\s*"COGNITO_DEFAULT"/);
    const moved = [...blocks(all(), 'moved'), ...blocks(all(), 'removed')].map((b) => squash(b.raw));
    expect(moved.filter((m) => m.includes('aws_cognito_user_pool.naleko_dev')), 'no moved or removed block for the pool').toEqual([]);

    const configs = nested(pool.body, 'lambda_config');
    expect(configs, 'one lambda_config').toHaveLength(1);
    const config = configs[0]!.replace(/^lambda_config\s*\{/, '').replace(/\}$/, '');
    const senders = nested(config, 'custom_email_sender');
    expect(senders, 'lambda_config has one custom_email_sender').toHaveLength(1);
    const s = attributes(senders[0]!.replace(/^custom_email_sender\s*\{/, '').replace(/\}$/, ''));
    expect(s.get('lambda_arn'), 'custom_email_sender runs cognitoEmailSender').toBe(`${senderRef}.arn`);
    expect(s.get('lambda_version')).toBe('"V1_0"');
    const top = attributes(without(config, 'custom_email_sender'));
    expect(top.get('kms_key_id'), 'the PII key encrypts the code').toBe('module.kms_pii.key_arn');
    expect(top.get('post_confirmation'), 'post_confirmation runs cognitoPostConfirmation').toBe(`${postRef}.arn`);
    expect(top.get('post_authentication'), 'post_authentication stays').toBe('aws_lambda_function.cognito_post_auth.arn');
    expect([...top.keys()].sort(), 'lambda_config has nothing else').toEqual(['kms_key_id', 'post_authentication', 'post_confirmation']);
    expect(nested(config, 'custom_sms_sender'), 'no SMS sender').toEqual([]);

    // The dev web client keeps PreventUserExistenceErrors on.
    const client = resources('aws_cognito_user_pool_client').find((b) => b.labels[1] === 'web');
    expect(client, 'aws_cognito_user_pool_client.web is still there').toBeTruthy();
    expect(attributes(client!.body).get('prevent_user_existence_errors'), 'the dev client keeps prevent_user_existence_errors = "ENABLED"').toBe('"ENABLED"');

    // ---- Lambda permissions, scoped to the pool.
    for (const [ref, fn] of [[senderRef, SENDER_FN], [postRef, POST_FN]] as const) {
      const perms = resources('aws_lambda_permission').filter((b) => (attributes(b.body).get('function_name') ?? '').startsWith(ref + '.'));
      expect(perms, `one aws_lambda_permission for ${fn}`).toHaveLength(1);
      const p = attributes(perms[0]!.body);
      expect(p.get('principal'), `${fn}: invoked by Cognito`).toBe('"cognito-idp.amazonaws.com"');
      expect(p.get('action')).toBe('"lambda:InvokeFunction"');
      expect(p.get('source_arn'), `${fn}: only by this pool`).toBe('aws_cognito_user_pool.naleko_dev.arn');
    }

    // ---- The sender's settings: the PII key, the Postmark sender, and the sink only outside prod.
    const env = nested(sender.body, 'environment')[0] ?? '';
    expect(env, 'cognitoEmailSender has POSTMARK_SENDER_EMAIL').toMatch(/POSTMARK_SENDER_EMAIL\s*=/);
    expect(env, 'cognitoEmailSender is given the PII key (module.kms_pii.key_arn)').toMatch(/=\s*module\.kms_pii\.key_arn\b/);
    expect(env, 'cognitoEmailSender has RESET_TEST_SINK_TABLE').toMatch(/RESET_TEST_SINK_TABLE/);
    expect(env, 'RESET_TEST_SINK_TABLE is set only when environment is not prod').toMatch(/var\.environment\s*(!=\s*"prod"|==\s*"dev")/);
    for (const fn of [sender, post]) {
      expect(stripComments(fn.body), `${attributes(fn.body).get('function_name')}: no AI setting`).not.toMatch(/bedrock|anthropic|openai/i);
    }

    const sinks = resources('aws_dynamodb_table').filter((b) => SINK_NAMES.includes(attributes(b.body).get('name') ?? ''));
    expect(sinks, 'one sink table, naleko-people-dev-reset-test-sink').toHaveLength(1);
    const sink = attributes(sinks[0]!.body);
    expect(sink.get('count'), 'the sink exists only when environment is not prod (never in a prod plan)').toMatch(/^var\.environment(!="prod"|=="dev")\?1:0$/);
    expect(sink.get('hash_key'), 'keyed by email').toBe('"email"');
    expect(sink.get('billing_mode')).toBe('"PAY_PER_REQUEST"');
    expect(squash(sinks[0]!.body), 'a ttl on expiresAt').toMatch(/ttl\{attribute_name="expiresAt"enabled=true\}|ttl\{enabled=trueattribute_name="expiresAt"\}/);
    const sinkRef = `aws_dynamodb_table.${sinks[0]!.labels[1]}`;
    expect(env, 'RESET_TEST_SINK_TABLE names the sink table').toContain(sinkRef);

    // ---- The roles: exactly item 10.
    const senderActions = expectOnly(roleOf(sender), 'cognitoEmailSender role', (a, res) => {
      const c = common(SENDER_FN, a, res);
      if (c !== undefined) return c;
      if (a === 'ssm:GetParameter') return res.every((r) => /parameter\/naleko\/postmark\/api_token$/.test(r) || /postmark_token\.arn$/.test(r)) ? null : 'SSM only on /naleko/postmark/api_token';
      if (a === 'dynamodb:PutItem') return res.every((r) => r.includes(sinkRef)) ? null : 'PutItem only on the sink table';
      return 'not in item 10';
    });
    expect(senderActions.filter((a) => a.startsWith('kms:')), 'the sender role holds no KMS right (the key policy gives Decrypt)').toEqual([]);
    expect(senderActions, 'the sender role can write the dev sink').toContain('dynamodb:PutItem');
    const sinkPolicies = resources('aws_iam_role_policy').filter((b) => b.body.includes(sinkRef));
    for (const b of sinkPolicies) expect(attributes(b.body).get('count') ?? '', `${b.labels[1]}: the sink grant exists only outside prod`).toMatch(/^var\.environment(!="prod"|=="dev")\?1:0$/);

    const postActions = expectOnly(roleOf(post), 'cognitoPostConfirmation role', (a, res) => {
      const c = common(POST_FN, a, res);
      if (c !== undefined) return c;
      if (a === 'cognito-idp:AdminUserGlobalSignOut') return res.every((r) => r === 'aws_cognito_user_pool.naleko_dev.arn') ? null : 'AdminUserGlobalSignOut only on the pool';
      return 'not in item 10';
    });
    expect(postActions, 'the post confirmation role can sign the person out').toContain('cognito-idp:AdminUserGlobalSignOut');

    // ---- The key policy: every statement on develop unchanged; new ones only of the allowed shapes.
    const kmsFiles = tfFiles(KMS_MODULE);
    const doc = blocks(kmsFiles, 'data').find((b) => b.labels[0] === 'aws_iam_policy_document' && b.labels[1] === 'key_policy');
    expect(doc, 'the key policy document is still data.aws_iam_policy_document.key_policy').toBeTruthy();
    const baseDoc = blocks([KMS_BASELINE], 'data').find((b) => b.labels[1] === 'key_policy')!;
    const before = nested(baseDoc.body, 'statement').map(squash);
    const now = nested(doc!.body, 'statement').map(squash);
    for (const st of before) expect(now, 'an existing key policy statement is unchanged').toContain(st);
    const added = now.filter((st) => !before.includes(st));
    expect(added.length, 'one or two new statements: the sender decrypt, and at most a Cognito encrypt').toBeGreaterThanOrEqual(1);
    expect(added.length, 'no third statement (no CreateGrant: RootFullAdmin already lets the deploy role make the grant)').toBeLessThanOrEqual(2);
    const inner = (st: string, kind: string) => [...st.matchAll(new RegExp(`(?:^|[^_a-z])${kind}\\{([^{}]*)\\}`, 'g'))].map((m) => m[1]!);
    let decrypt = 0;
    for (const st of added) {
      const actions = [...st.matchAll(/(?:^|[^_a-z])actions=\[([^\]]*)\]/g)].flatMap((m) => m[1]!.split(',').filter(Boolean));
      const shape = actions.join(',');
      expect(st, 'a new statement uses no not_actions, not_principals or not_resources').not.toMatch(/not_(actions|principals|resources)/);
      expect(st, 'a new statement allows').toMatch(/effect="Allow"/);
      const principals = inner(st, 'principals');
      const conditions = inner(st, 'condition');
      expect(principals.length, `a new statement names exactly one principal block (got ${st})`).toBe(1);
      if (st.includes('"cognito-idp.amazonaws.com"')) {
        expect(principals[0], 'Cognito encrypt: the principal is only the Cognito service').toBe('type="Service"identifiers=["cognito-idp.amazonaws.com"]');
        expect(shape, 'Cognito gets kms:Encrypt only').toBe('"kms:Encrypt"');
        expect(st, 'Cognito encrypt is scoped by aws:SourceArn').toContain('"aws:SourceArn"');
        expect(st, 'and by aws:SourceAccount').toContain('"aws:SourceAccount"');
        expect(st, 'with the pools from cognito_encrypt_pool_arns').toContain('var.cognito_encrypt_pool_arns');
        for (const c of conditions) expect(c, 'Cognito encrypt conditions are exact matches, never a wildcard').toMatch(/^test="(StringEquals|ArnEquals)"/);
        expect(st, 'no wildcard in the Cognito encrypt conditions').not.toMatch(/values=\[[^\]]*"\*"/);
      } else {
        expect(principals[0], `a new statement may only be the sender decrypt, for exactly var.cognito_sender_decrypt_role_arns (got ${st})`).toBe('type="AWS"identifiers=var.cognito_sender_decrypt_role_arns');
        expect(shape, 'the sender role gets kms:Decrypt only').toBe('"kms:Decrypt"');
        expect(conditions.length, 'the sender decrypt has exactly one condition: this pool\'s encryption context').toBe(1);
        const c = conditions[0]!;
        expect(c, 'the condition is StringEquals').toMatch(/(?:^|")?test="StringEquals"/);
        expect(c, 'on kms:EncryptionContext:userpool-id').toContain('variable="kms:EncryptionContext:userpool-id"');
        const values = /values=\[([^\]]*)\]/.exec(c)?.[1] ?? '';
        expect(values, 'the condition names this pool\'s id').not.toBe('');
        expect(values, 'the condition values hold no wildcard').not.toMatch(/\*|\?/);
        decrypt++;
      }
    }
    expect(decrypt, 'one statement lets the sender decrypt').toBe(1);
    const vars = blocks(kmsFiles, 'variable');
    for (const v of ['cognito_encrypt_pool_arns', 'cognito_sender_decrypt_role_arns']) {
      const found = vars.find((b) => b.labels[0] === v);
      expect(found, `modules/kms has variable ${v}`).toBeTruthy();
      expect(attributes(found!.body).get('default'), `${v} defaults to [] (add only)`).toBe('[]');
    }
    const kms = blocks(all(), 'module').find((b) => b.labels[0] === 'kms_pii')!;
    const k = attributes(kms.body);
    expect(k.get('cognito_sender_decrypt_role_arns'), 'the sender role is the only decrypt role').toBe(`[aws_iam_role.${roleOf(sender)}.arn]`);
    if (k.has('cognito_encrypt_pool_arns')) expect(k.get('cognito_encrypt_pool_arns'), 'the encrypt pools hold no wildcard').not.toMatch(/\*/);
    for (const [key, value] of k) {
      expect(value, `module.kms_pii ${key} names no wildcard`).not.toMatch(/"\*"/);
      expect(value, `module.kms_pii ${key} does not use the pool resource (the pool needs the key: a cycle)`).not.toMatch(/aws_cognito_user_pool\./);
    }
    const kv = (key: string) => k.get(key) ?? '';
    expect(kv('allowed_role_arns'), 'the sender role is not in allowed_role_arns').not.toContain(roleOf(sender));
    expect(kv('dynamodb_read_role_arns'), 'nor in dynamodb_read_role_arns').not.toContain(roleOf(sender));
    expect(kv('allowed_role_arns') + kv('dynamodb_read_role_arns'), 'the post confirmation role gets no key rights').not.toContain(roleOf(post));

    // ---- Build, deploy, alarms, CloudWatch and dashboards.
    for (const fn of [SENDER_FN, POST_FN]) {
      const dir = join(REPO, 'lambda', fn);
      expect(existsSync(join(dir, 'index.mjs')) || existsSync(join(dir, 'index.js')), `lambda/${fn} has index.mjs (build-lambdas.py builds it)`).toBe(true);
      expect(existsSync(join(dir, 'package.json')), `lambda/${fn} has package.json`).toBe(true);
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
      const code = readFileSync(join(dir, existsSync(join(dir, 'index.mjs')) ? 'index.mjs' : 'index.js'), 'utf8');
      for (const m of code.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"./][^'"]*)['"]/g)) {
        const name = m[1]!.startsWith('@') ? m[1]!.split('/').slice(0, 2).join('/') : m[1]!.split('/')[0]!;
        if (name.startsWith('node:') || name.startsWith('@aws-sdk/')) continue;
        expect(Object.keys(pkg.dependencies ?? {}), `lambda/${fn}: ${name} is in package.json dependencies, so the build bundles it`).toContain(name);
      }
      expect(readFileSync(join(INFRA, 'alarms.tf'), 'utf8'), `alarms.tf lists ${fn}`).toMatch(new RegExp(`"${fn}"`));
      expect(readFileSync(join(INFRA, 'dashboards.tf'), 'utf8'), `dashboards.tf lists ${fn}`).toMatch(new RegExp(`"${fn}"`));
      const cw = readFileSync(join(INFRA, 'cloudwatch.tf'), 'utf8');
      const groups = /(?:^|\s)lambda_log_groups\s*=\s*toset\(\[([\s\S]*?)\]\)/.exec(stripComments(cw));
      expect(groups?.[1] ?? '', `cloudwatch.tf lambda_log_groups lists /aws/lambda/${fn}`).toContain(`"/aws/lambda/${fn}"`);
    }
    const alarms = resources('aws_cloudwatch_metric_alarm', [...all(), ...tfFiles(ALARMS_MODULE)]);
    const alarmFor = (metric: string) => alarms.filter((b) => attributes(b.body).get('metric_name') === `"${metric}"` || nested(b.body, 'metric_query').some((q) => q.includes(`"${metric}"`)));
    for (const metric of ['ResetEmailFailed', 'ResetSignOutFailed']) {
      const a = alarmFor(metric);
      expect(a.length, `an alarm on ${metric}`).toBeGreaterThanOrEqual(1);
      expect(attributes(a[0]!.body).get('alarm_actions'), `${metric} goes to the ops SNS topic`).toMatch(/aws_sns_topic\.naleko_ops\.arn|var\.\w*sns\w*|ops/);
    }
    const high = alarms.filter((b) => /ResetEmailsHigh/.test(attributes(b.body).get('alarm_name') ?? ''));
    expect(high, 'a ResetEmailsHigh alarm').toHaveLength(1);
    const h = attributes(high[0]!.body);
    expect(h.get('threshold'), 'ResetEmailsHigh: more than 100').toBe('100');
    expect(h.get('comparison_operator')).toBe('"GreaterThanThreshold"');
    expect(h.get('period'), 'in an hour').toBe('3600');
    expect(h.get('alarm_actions'), 'ResetEmailsHigh goes to the ops SNS topic').toMatch(/aws_sns_topic\.naleko_ops\.arn|var\.\w*sns\w*|ops/);
    expect(squash(high[0]!.body), 'ResetEmailsHigh counts the sender\'s emails').toMatch(/cognitoEmailSender|ResetEmail/);

    // Nothing new calls Bedrock or a paid AI.
    for (const f of [...all(), ...kmsFiles]) {
      const text = stripComments(readFileSync(f, 'utf8'));
      for (const b of [SENDER_FN, POST_FN]) if (text.includes(b)) expect(text.match(/bedrock[^\n]*cognito(EmailSender|PostConfirmation)|cognito(EmailSender|PostConfirmation)[^\n]*bedrock/i), `${f}: no AI near the new Lambdas`).toBeNull();
    }
  },
};
