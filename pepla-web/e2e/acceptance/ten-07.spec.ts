import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { expect, test, type TestInfo } from '@playwright/test';
import { ON_DEV } from './support/fixtures';
import { INFRA, REPO, attributes, blocks, stripComments, tfFiles, type Block } from './support/infra-harness';
import { policyOf, squash } from './support/onb-15/tf-policy';
import type { Statement } from './support/ops-05/iam-eval';

/**
 * TEN-07 · Config check gets its own role, then the old all-access role goes (Jira NH-199).
 * Spec: onboarding-cards/specs/TEN-07.md (16 Nov 2026). Part A only: AC-1 to AC-3.
 * AC-4 is prod evidence recorded on the card after the release; AC-5 (the old role is gone) is
 * Part B's PR and gets its own lock, acceptance-lock/ten-07.1.
 *
 * This card is infra, so nothing here opens a browser. AC-1 and AC-2 read the Terraform files as text
 * (no Terraform, no AWS). AC-3 runs the real lambda/configRegionCheck/index.mjs in a fresh Node process
 * against a fake AWS (support/ten-07/fake-aws: a recording AWS Config client and nothing else).
 * Nothing calls AWS or any AI service.
 *
 * They run once, in the desktop-1280 project, in the no-backend run.
 * These files are locked once accepted: see ./README.md and ./cards/ten-07.md.
 */

const MODULE = join(INFRA, 'modules', 'config');
const CONFIG_TF = join(INFRA, 'config.tf');
const TALENT_FLOW = join(REPO, 'talent-flow-infra');
const HANDLER = join(REPO, 'lambda', 'configRegionCheck', 'index.mjs');
const FAKE_AWS = join(__dirname, 'support', 'ten-07', 'fake-aws');
/** infra/modules/config/main.tf and infra/config.tf as they were on develop at 9057160, before this card. */
const BASELINE_MAIN = join(__dirname, 'support', 'ten-07', 'config-main.9057160.tf.txt');
const BASELINE_CONFIG = join(__dirname, 'support', 'ten-07', 'config.9057160.tf.txt');

const OLD_ROLE_NAME = 'doc-verification-lambda-role';
const ROLE_NAME = 'naleko-configRegionCheck-role';
const FN = 'configRegionCheck';
/** Part A step 2: the whole policy, action by action. */
const ALLOWED_ACTIONS = ['config:PutEvaluations', 'logs:CreateLogStream', 'logs:PutLogEvents', 'xray:PutTraceSegments', 'xray:PutTelemetryRecords'];
const STAR_OK = new Set(['config:PutEvaluations', 'xray:PutTraceSegments', 'xray:PutTelemetryRecords']);

const textOnce = (testInfo: TestInfo) => {
  test.skip(ON_DEV, 'No-backend run only: it reads the repository and runs the handler against a fake AWS.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'No browser: runs once.');
};

/** Every .tf file under a folder, sub-folders included (modules), skipping .terraform. */
function tfTree(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '.terraform' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tfTree(p));
    else if (name.endsWith('.tf')) out.push(p);
  }
  return out;
}

const resources = (files: string[], type?: string) => blocks(files, 'resource').filter((b) => !type || b.labels[0] === type);
const attr = (b: Block, name: string) => attributes(b.body).get(name);
const rel = (p: string) => relative(REPO, p);
const readText = (p: string) => readFileSync(p, 'utf8');
const where = (b: Block) => `${rel(b.file)}: ${b.labels.join('.')}`;

/** The comments in a block's own text (everything stripComments blanked out). */
function commentsOf(b: Block): string {
  const original = b.source.slice(b.start, b.start + b.raw.length);
  let out = '';
  for (let i = 0; i < original.length; i++) if (b.raw[i] !== original[i]) out += original[i];
  return out;
}

type Row = { effect: string; action: string; resource: string; notAction: boolean; notResource: boolean; condition: boolean };
function rows(statements: Statement | Statement[]): Row[] {
  return (Array.isArray(statements) ? statements : [statements]).flatMap((st) => {
    const actions = ([] as string[]).concat((st.Action ?? st.NotAction ?? []) as string | string[]);
    const resourcesOf = ([] as string[]).concat((st.Resource ?? st.NotResource ?? []) as string | string[]);
    return actions.flatMap((action) =>
      resourcesOf.map((resource) => ({
        effect: st.Effect,
        action,
        resource,
        notAction: st.NotAction !== undefined,
        notResource: st.NotResource !== undefined,
        condition: st.Condition !== undefined,
      })),
    );
  });
}

/** A `jsonencode({...})` held by another attribute name (assume_role_policy), read as a policy. */
function policyAt(b: Block, name: string) {
  const body = stripComments(b.body).replace(new RegExp(`(^|\\s)${name}(\\s*=\\s*jsonencode)`), '$1policy$2');
  return policyOf({ type: b.labels[0]!, name: b.labels[1]!, raw: b.raw, body, attrs: attributes(body) });
}

/** A log resource that is configRegionCheck's own group (or its streams), with no wildcard region or account. */
function ownLogGroup(resource: string, logGroups: Block[]): boolean {
  const literal = /^arn:aws:logs:([^:*]+):([^:*]+):log-group:\/aws\/lambda\/configRegionCheck(:\*|:log-stream:\*)?$/;
  if (literal.test(resource)) return true;
  // or "${aws_cloudwatch_log_group.<name>.arn}:*" for a group named /aws/lambda/configRegionCheck
  const ref = /^\$\{aws_cloudwatch_log_group\.(\w+)\.arn\}(:\*|:log-stream:\*)?$/.exec(resource);
  if (!ref) return false;
  const group = logGroups.find((g) => g.labels[1] === ref[1]);
  return !!group && attr(group, 'name') === '"/aws/lambda/configRegionCheck"';
}

// ---------------------------------------------------------------- AC-3: the real handler against a fake AWS

type Call = { service: string; op: string; input?: any; region?: string | null };
type Run = { response?: unknown; error?: { name: string; message: string }; calls: Call[] };

function configEvent(item: { awsRegion: string; resourceType: string; resourceId: string }, token: string) {
  return {
    version: '1.0',
    invokingEvent: JSON.stringify({
      configurationItem: {
        configurationItemCaptureTime: '2026-11-16T08:00:00.000Z',
        configurationItemStatus: 'OK',
        awsAccountId: '000000000000',
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        awsRegion: item.awsRegion,
        configuration: {},
      },
      notificationCreationTime: '2026-11-16T08:00:01.000Z',
      messageType: 'ConfigurationItemChangeNotification',
      recordVersion: '1.3',
    }),
    ruleParameters: '{}',
    resultToken: token,
    eventLeftScope: false,
    executionRoleArn: 'arn:aws:iam::000000000000:role/naleko-config-role',
    configRuleArn: 'arn:aws:config:af-south-1:000000000000:config-rule/config-rule-ten07',
    configRuleName: 'naleko-af-south-1-region-enforcement',
    configRuleId: 'config-rule-ten07',
    accountId: '000000000000',
  };
}

/** The real handler, once, in a fresh Node process, with the Lambda's own settings from Terraform. */
function runHandler(event: unknown): Run {
  const dir = mkdtempSync(join(tmpdir(), 'ten-07-lambda-'));
  const eventFile = join(dir, 'event.json');
  writeFileSync(eventFile, JSON.stringify(event));
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), HANDLER, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      PATH: process.env['PATH'] ?? '',
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'ten07-fake',
      AWS_SECRET_ACCESS_KEY: 'ten07-fake',
      AWS_EC2_METADATA_DISABLED: 'true',
      // as infra/modules/config/main.tf sets them
      ALLOWED_REGION: 'af-south-1',
      EXEMPT_RESOURCE_TYPES: 'AWS::Textract::*',
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@TEN07@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  return JSON.parse(line.slice('@@TEN07@@'.length)) as Run;
}

// ---------------------------------------------------------------- the tests

test.describe('TEN-07 Config check gets its own role', () => {
  test.beforeEach(({}, testInfo) => textOnce(testInfo));

  // -------------------------------------------------------------- AC-1
  test('AC-1 The config check has exactly its own role: in the module, five actions, no lambda_role_arn variable', () => {
    const moduleFiles = tfFiles(MODULE);
    const allFiles = [...tfTree(INFRA), ...tfTree(TALENT_FLOW)];

    // the function's role is a role defined in the module
    const fns = resources(moduleFiles, 'aws_lambda_function').filter((b) => b.labels[1] === 'config_region_check');
    expect(fns, 'one aws_lambda_function.config_region_check in infra/modules/config').toHaveLength(1);
    const fn = fns[0]!;
    expect(attr(fn, 'function_name'), 'still named configRegionCheck').toBe(`"${FN}"`);
    const roleRef = /^aws_iam_role\.(\w+)\.arn$/.exec(attr(fn, 'role') ?? '');
    expect(roleRef, `config_region_check.role is aws_iam_role.<name>.arn, not "${attr(fn, 'role')}"`).toBeTruthy();
    const roleLabel = roleRef![1]!;
    const roles = resources(moduleFiles, 'aws_iam_role').filter((b) => b.labels[1] === roleLabel);
    expect(roles.map(where), `aws_iam_role.${roleLabel} is defined inside infra/modules/config`).toHaveLength(1);
    const role = roles[0]!;
    expect(roleLabel, 'not the Config service role').not.toBe('config_role');

    // its name, path and trust: Lambda only, as the roles in iam_per_lambda.tf
    expect(attr(role, 'name'), 'role name').toBe(`"${ROLE_NAME}"`);
    expect(attr(role, 'path'), 'role path').toBe('"/naleko/"');
    const trust = ([] as Statement[]).concat(policyAt(role, 'assume_role_policy').Statement);
    expect(trust.map((s) => `${s.Effect} ${([] as string[]).concat((s.Action ?? 'none') as string | string[]).join(',')}`), 'trust: one statement, Allow sts:AssumeRole').toEqual(['Allow sts:AssumeRole']);
    expect(trust.map((s) => JSON.stringify(s.Principal)), 'trust: lambda.amazonaws.com only').toEqual([JSON.stringify({ Service: 'lambda.amazonaws.com' })]);

    // nothing else lent to it: no managed policies, no inline_policy block, no attachments anywhere
    expect(attr(role, 'managed_policy_arns'), 'no managed_policy_arns on the role').toBeUndefined();
    expect(stripComments(role.body), 'no inline_policy block on the role').not.toMatch(/\binline_policy\s*\{/);
    const refersToRole = (b: Block) => new RegExp(`\\baws_iam_role\\.${roleLabel}\\.`).test(stripComments(b.body));
    const attachments = [
      ...resources(allFiles, 'aws_iam_role_policy_attachment'),
      ...resources(allFiles, 'aws_iam_policy_attachment'),
      ...resources(allFiles, 'aws_iam_role_policy_attachments_exclusive'),
    ].filter((b) => (b.file.startsWith(MODULE) && refersToRole(b)) || stripComments(b.body).includes(`"${ROLE_NAME}"`));
    expect(attachments.map(where), 'no policy attached to the role').toEqual([]);
    const byNameElsewhere = resources(allFiles, 'aws_iam_role_policy').filter((b) => stripComments(b.body).includes(`"${ROLE_NAME}"`));
    expect(byNameElsewhere.map(where), 'no other inline policy put on the role by its name').toEqual([]);
    // nothing outside the module can reach the role: no module output hands it out, no file outside the module names it
    const leaks = blocks(moduleFiles, 'output').filter((b) => new RegExp(`\\baws_iam_role\\.${roleLabel}\\b`).test(stripComments(b.body)));
    expect(leaks.map((b) => `${rel(b.file)}: output.${b.labels[0]}`), 'no module output exposes the role').toEqual([]);
    const outside = allFiles.filter((f) => !f.startsWith(MODULE + '/') && stripComments(readText(f)).includes(ROLE_NAME)).map(rel);
    expect(outside, `no file outside infra/modules/config names ${ROLE_NAME} (comments aside)`).toEqual([]);
    const sharing = resources(allFiles, 'aws_lambda_function').filter((b) => refersToRole(b));
    expect(sharing.map(where), 'the role is used by configRegionCheck only').toEqual([where(fn)]);

    // exactly one inline policy, holding exactly the five actions of Part A step 2
    const policies = resources(moduleFiles, 'aws_iam_role_policy').filter((b) => refersToRole(b));
    expect(policies.map(where), 'one aws_iam_role_policy on the role').toHaveLength(1);
    const policyBlock = policies[0]!;
    expect(['aws_iam_role.' + roleLabel + '.name', 'aws_iam_role.' + roleLabel + '.id'], 'the policy is on that role').toContain(attr(policyBlock, 'role'));
    const statements = rows(policyOf({ type: 'aws_iam_role_policy', name: policyBlock.labels[1]!, raw: policyBlock.raw, body: policyBlock.body, attrs: attributes(policyBlock.body) }).Statement);
    for (const r of statements) {
      expect(r.effect, `${r.action}: Allow`).toBe('Allow');
      expect(r.notAction || r.notResource, `${r.action}: no NotAction or NotResource`).toBe(false);
      expect(r.action, `no wildcard action (${r.action})`).not.toContain('*');
    }
    expect([...new Set(statements.map((r) => r.action))].sort(), 'exactly the five actions, nothing else (no DynamoDB, S3, Bedrock, Cognito, Textract, KMS or IAM)').toEqual([...ALLOWED_ACTIONS].sort());
    for (const r of statements.filter((s) => s.resource === '*')) {
      expect(STAR_OK.has(r.action), `Resource "*" only on config:PutEvaluations and the two X-Ray actions, not on ${r.action}`).toBe(true);
    }
    const logGroups = resources(allFiles, 'aws_cloudwatch_log_group');
    for (const r of statements.filter((s) => s.action.startsWith('logs:'))) {
      expect(ownLogGroup(r.resource, logGroups), `${r.action} only on the /aws/lambda/configRegionCheck log group, not "${r.resource}"`).toBe(true);
    }
    const comments = commentsOf(policyBlock);
    expect(comments, 'the policy carries a comment saying why config:PutEvaluations has Resource "*"').toMatch(/PutEvaluations|config/i);
    expect(comments, 'the comment names the resource-level reason').toMatch(/resource/i);

    // the module takes no role from outside, and config.tf passes none
    expect(blocks(moduleFiles, 'variable').map((b) => b.labels[0]), 'no lambda_role_arn variable in the module').not.toContain('lambda_role_arn');
    expect(moduleFiles.map((f) => stripComments(readText(f))).join('\n'), 'nothing in the module reads var.lambda_role_arn').not.toMatch(/\bvar\.lambda_role_arn\b/);
    const modules = blocks([CONFIG_TF], 'module').filter((b) => b.labels[0] === 'config');
    expect(modules, 'module "config" still in infra/config.tf').toHaveLength(1);
    expect(attr(modules[0]!, 'lambda_role_arn'), 'infra/config.tf passes no lambda_role_arn').toBeUndefined();

    // Part A step 3: nothing else in the Config set-up changes
    const before = blocks([BASELINE_MAIN], 'resource');
    const now = resources(moduleFiles);
    for (const b of before) {
      const found = now.filter((n) => n.labels[0] === b.labels[0] && n.labels[1] === b.labels[1]);
      expect(found, `${b.labels.join('.')} still there`).toHaveLength(1);
      const dropRole = (s: string) => s.replace(/^\s*role\s*=.*$/m, '');
      if (b.labels[0] === 'aws_lambda_function' && b.labels[1] === 'config_region_check') {
        expect(squash(dropRole(found[0]!.raw)), 'configRegionCheck: only the role line changes').toBe(squash(dropRole(b.raw)));
      } else {
        expect(squash(found[0]!.raw), `${b.labels.join('.')} unchanged`).toBe(squash(b.raw));
      }
    }
    const configBefore = attributes(blocks([BASELINE_CONFIG], 'module')[0]!.body);
    const configNow = attributes(modules[0]!.body);
    configBefore.delete('lambda_role_arn');
    expect(Object.fromEntries(configNow), 'module "config": every other argument as before (count stays prod-only)').toEqual(Object.fromEntries(configBefore));
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 Nothing in Terraform uses the old role: no local.lambda_role_arn, no doc-verification-lambda-role outside iam.tf', () => {
    const files = [...tfTree(INFRA), ...tfTree(TALENT_FLOW)];
    const IAM_TF = join(INFRA, 'iam.tf');
    const text = (f: string) => stripComments(readText(f));

    const localRefs = files.filter((f) => /\blocal\.lambda_role_arn\b/.test(text(f))).map(rel);
    expect(localRefs, 'no file refers to local.lambda_role_arn').toEqual([]);
    const localDefs = blocks(files, 'locals').filter((b) => attributes(b.body).has('lambda_role_arn')).map((b) => rel(b.file));
    expect(localDefs, 'the lambda_role_arn local is removed').toEqual([]);

    const roleRefs = files.filter((f) => f !== IAM_TF && /\baws_iam_role\.lambda_execution\b/.test(text(f))).map(rel);
    expect(roleRefs, 'no file but infra/iam.tf refers to aws_iam_role.lambda_execution').toEqual([]);

    const byName = files.filter((f) => f !== IAM_TF && text(f).includes(OLD_ROLE_NAME)).map(rel);
    expect(byName, `no file but infra/iam.tf names ${OLD_ROLE_NAME} (comments aside)`).toEqual([]);

    // Part A step 4: the old role and its inline policy stay until Part B (Iggie's yes); deleting them here would let the dev apply remove the role
    const iam = blocks([IAM_TF], 'resource');
    const oldRole = iam.filter((b) => b.labels[0] === 'aws_iam_role' && b.labels[1] === 'lambda_execution');
    expect(oldRole.length, 'infra/iam.tf still defines aws_iam_role.lambda_execution (Part B removes it, not Part A)').toBe(1);
    expect(attr(oldRole[0]!, 'name'), 'still named doc-verification-lambda-role').toBe(`"${OLD_ROLE_NAME}"`);
    expect(iam.filter((b) => b.labels[0] === 'aws_iam_role_policy' && b.labels[1] === 'lambda_cloudwatch_metrics').length, 'infra/iam.tf still defines aws_iam_role_policy.lambda_cloudwatch_metrics').toBe(1);

    // and no Lambda, state machine, event target or schedule takes it as its role, however written
    const ROLE_ATTRS = ['role', 'role_arn', 'execution_role_arn'];
    const users = resources(files)
      .filter((b) => /^aws_(lambda_function|sfn_state_machine|cloudwatch_event_target|scheduler_schedule|pipes_pipe)$/.test(b.labels[0]!))
      .filter((b) => {
        const body = stripComments(b.body);
        return ROLE_ATTRS.some((a) => new RegExp(`^\\s*${a}\\s*=.*(${OLD_ROLE_NAME}|aws_iam_role\\.lambda_execution|local\\.lambda_role_arn)`, 'm').test(body));
      })
      .map(where);
    expect(users, 'nothing runs as the old role').toEqual([]);
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 The check writes its verdict: one PutEvaluations per item (af-south-1 COMPLIANT, eu-west-1 NON_COMPLIANT, Textract COMPLIANT), no other AWS call', () => {
    const cases = [
      { item: { awsRegion: 'af-south-1', resourceType: 'AWS::S3::Bucket', resourceId: 'naleko-ten07-af' }, verdict: 'COMPLIANT' },
      { item: { awsRegion: 'eu-west-1', resourceType: 'AWS::DynamoDB::Table', resourceId: 'naleko-ten07-eu' }, verdict: 'NON_COMPLIANT' },
      { item: { awsRegion: 'eu-west-1', resourceType: 'AWS::Textract::Adapter', resourceId: 'naleko-ten07-textract' }, verdict: 'COMPLIANT' },
    ];
    for (const [i, c] of cases.entries()) {
      const what = `${c.item.resourceType} in ${c.item.awsRegion}`;
      const token = `ten07-result-token-${i}`;
      const run = runHandler(configEvent(c.item, token));
      expect(run.error, `${what}: the handler finishes without an error`).toBeUndefined();

      const sent = run.calls.filter((x) => x.op !== 'new client');
      expect(sent.map((x) => `${x.service} ${x.op}`), `${what}: one AWS call, PutEvaluations, nothing else`).toEqual(['config PutEvaluations']);
      const input = sent[0]!.input;
      expect(input.ResultToken, `${what}: hands back the rule's result token`).toBe(token);
      expect(input.Evaluations, `${what}: one evaluation`).toHaveLength(1);
      const e = input.Evaluations[0];
      expect(e.ComplianceType, `${what}: verdict`).toBe(c.verdict);
      expect(e.ComplianceResourceType, `${what}: resource type`).toBe(c.item.resourceType);
      expect(e.ComplianceResourceId, `${what}: resource id`).toBe(c.item.resourceId);
      expect(new Date(e.OrderingTimestamp).toISOString(), `${what}: ordered by the item's capture time`).toBe('2026-11-16T08:00:00.000Z');
    }
  });
});
