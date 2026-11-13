import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ON_DEV } from './support/fixtures';
import {
  INFRA,
  attributes,
  blocks,
  onPath,
  readIfExists,
  runStepWithPlan,
  runWithFakeAws,
  tfFiles,
  withLeadingLines,
  workflowStep,
  type AwsCall,
  type Block,
  type FakeAws,
} from './support/infra-harness';

/**
 * BE-16 · Sign-in groups set up by Terraform (Jira NH-151).
 * Spec: https://obsydian.atlassian.net/browse/NH-151 (approved 13 Nov 12:55).
 * One test per acceptance criterion, written from the card before any code.
 *
 * This card is infra, so nothing here opens a browser. The tests read the
 * Terraform files, run the real scripts/ci/seed-dev.py against a fake AWS
 * (support/be-16/fake-aws), and run the real plan-summary and drift-list
 * steps of the workflows with a stub `terraform` and made-up plans.
 * Nothing calls AWS, Terraform's registry, or any AI service.
 *
 * What only real AWS can show is read by the verifier on the second pass, not
 * here: the prod plan summary on the PR (AC-2), the first OPS-05 pepla-dev
 * plan and apply (AC-3), and the merge run on pepla-dev (AC-4). Each test below
 * checks the part of its criterion that the code alone decides.
 *
 * They run once, in the desktop-1280 project, in the no-backend run.
 * These files are locked once accepted: see ./README.md.
 */

const COGNITO_TF = join(INFRA, 'cognito.tf');
const POOL_REF = 'aws_cognito_user_pool.naleko_dev.id';
const GROUPS = [
  { resource: 'hr_staff', name: 'hr_staff' },
  { resource: 'employee', name: 'employee' },
] as const;
const ROBOTS = { resource: 'e2e_robots', name: 'e2e-robots' } as const;
const DEV_ONLY = new Set(['var.environment=="prod"?0:1', 'var.environment!="prod"?1:0']);
const SEED_TEXT = 'Seeded for pepla-dev';

const groupResources = (files: string[]) => blocks(files, 'resource').filter((b) => b.labels[0] === 'aws_cognito_user_group');
const resourceNamed = (files: string[], label: string) => groupResources(files).filter((b) => b.labels[1] === label);
const imports = () => blocks(tfFiles(), 'import').map((b) => ({ block: b, attrs: attributes(b.body) }));
const importsTo = (pattern: RegExp) => imports().filter((i) => pattern.test(i.attrs.get('to') ?? ''));

/** An import id that is "<the Naleko pool id>/<group>", however it is spelled. */
function idIsPoolSlash(id: string | undefined, group: string): boolean {
  if (!id || !id.includes(POOL_REF)) return false;
  const interpolated = id === `"\${${POOL_REF}}/${group}"`;
  const formatted = id === `format("%s/${group}",${POOL_REF})`;
  const joined = id === `join("/",[${POOL_REF},"${group}"])`;
  return interpolated || formatted || joined;
}

/** `for_each` (or `count`) on an import that leaves prod out and keeps every other environment. */
function devOnlyCondition(attrs: Map<string, string>): boolean {
  const fe = attrs.get('for_each') ?? '';
  return /var\.environment(==|!=)"prod"/.test(fe) && /toset\(\[\]\)|\[\]|\{\}/.test(fe);
}

// ---------------------------------------------------------------- the seed against a fake AWS

const NALEKO = 'naleko-dev-user-pool';
const TALENT = 'talent-flow-user-pool';
const NALEKO_ID = 'af-south-1_FakeNaleko7Q';
const TALENT_ID = 'af-south-1_FakeTalent3K';
const DEV_ACCOUNT = '424556617428';
const PASSWORD = 'Pp1!NeverPrintThis9x';
const MODULE_GROUPS = ['naleko-onboarding-hr', 'naleko-talentflow-hr', 'naleko-it-provisioning'];
const TALENT_GROUPS = ['TalentFlowAdmin', 'HiringManager', 'PanelMember', 'ComplianceOfficer', 'ITAdmin', 'FinanceLead', 'HRDirector', 'e2e-robots'];

/** pepla-dev as it is once Terraform owns the groups. */
function devAws(nalekoGroups: string[]): FakeAws {
  return {
    account: DEV_ACCOUNT,
    password: PASSWORD,
    pools: {
      [NALEKO]: { id: NALEKO_ID, groups: nalekoGroups },
      [TALENT]: { id: TALENT_ID, groups: TALENT_GROUPS },
    },
  };
}

const SEED = join('scripts', 'ci', 'seed-dev.py');
const ok = (c: AwsCall) => c.error === null;
const addedTo = (calls: AwsCall[], pool: string, user: RegExp) =>
  calls
    .filter((c) => c.op === 'AdminAddUserToGroup' && ok(c) && c.params['UserPoolId'] === pool && user.test(String(c.params['Username'])))
    .map((c) => String(c.params['GroupName']));
const createGroupOn = (calls: AwsCall[], pool: string) => calls.filter((c) => c.op === 'CreateGroup' && c.params['UserPoolId'] === pool);

// ---------------------------------------------------------------- made-up Terraform plans (JSON, as `terraform show -json` prints)

const SECRET_VALUE = 'SENTINEL-value-never-printed';
const change = (address: string, actions: string[], importing?: string) => ({
  address,
  mode: 'managed',
  type: address.split('.')[0],
  name: address.split('.')[1]?.replace(/\[.*$/, ''),
  change: {
    actions,
    before: { description: SECRET_VALUE },
    after: { description: SECRET_VALUE },
    ...(importing ? { importing: { id: importing } } : {}),
  },
});
const plan = (...resource_changes: unknown[]) => ({ format_version: '1.2', resource_changes });
const IMPORT_ID = `${NALEKO_ID}/hr_staff`;

/** A plan whose only changes are two imports, next to an unchanged resource and a data read. */
const IMPORT_ONLY = plan(
  change('aws_cognito_user_group.hr_staff', ['no-op'], IMPORT_ID),
  change('aws_cognito_user_group.employee', ['no-op'], `${NALEKO_ID}/employee`),
  change('aws_cognito_user_pool.naleko_dev', ['no-op']),
  change('data.aws_caller_identity.current', ['read']),
);
/** Import with an update, next to ordinary create, delete and no-op lines. */
const MIXED = plan(
  change('aws_cognito_user_group.e2e_robots[0]', ['update'], `${NALEKO_ID}/e2e-robots`),
  change('aws_s3_bucket.example', ['create']),
  change('aws_sqs_queue.example', ['delete']),
  change('aws_cognito_user_pool.naleko_dev', ['no-op']),
);
/** Nothing to do at all. */
const NOTHING = plan(change('aws_cognito_user_pool.naleko_dev', ['no-op']), change('data.aws_caller_identity.current', ['read']));

const line = (action: string, address: string) =>
  new RegExp(`^${action.replace(/\+/g, '\\+')}[\\t ]+${address.replace(/[.[\]]/g, '\\$&')}[\\t ]*$`, 'm');

// ----------------------------------------------------------------

test.describe('BE-16 Sign-in groups set up by Terraform', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(ON_DEV, 'No-backend run only: these read code and run scripts against fakes.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'No browser: runs once.');
  });

  test('AC-1 Terraform defines hr_staff and employee in every environment and e2e-robots in pepla-dev only', () => {
    expect(existsSync(COGNITO_TF), 'infra/cognito.tf').toBe(true);
    const inCognito = [COGNITO_TF];

    for (const g of GROUPS) {
      const found = resourceNamed(inCognito, g.resource);
      expect(found, `infra/cognito.tf defines resource "aws_cognito_user_group" "${g.resource}" once`).toHaveLength(1);
      const a = attributes(found[0].body);
      expect(a.get('name'), `${g.resource}: name`).toBe(`"${g.name}"`);
      expect(a.get('user_pool_id'), `${g.resource}: on the Naleko pool`).toBe(POOL_REF);
      expect(a.has('count'), `${g.resource}: no count (same in dev and prod)`).toBe(false);
      expect(a.has('for_each'), `${g.resource}: no for_each (same in dev and prod)`).toBe(false);
    }

    const robots = resourceNamed(inCognito, ROBOTS.resource);
    expect(robots, `infra/cognito.tf defines resource "aws_cognito_user_group" "${ROBOTS.resource}" once`).toHaveLength(1);
    const r = attributes(robots[0].body);
    expect(r.get('name'), 'e2e_robots: name').toBe(`"${ROBOTS.name}"`);
    expect(r.get('user_pool_id'), 'e2e_robots: on the Naleko pool').toBe(POOL_REF);
    expect(DEV_ONLY.has(r.get('count') ?? ''), `e2e_robots: count is 0 in prod and 1 elsewhere (got ${r.get('count')})`).toBe(true);
    expect(withLeadingLines(robots[0], 12), 'e2e_robots: a comment points at lambda/shared/ai-guard.mjs').toContain(
      'lambda/shared/ai-guard.mjs',
    );

    // No second definition of the same Cognito group anywhere in infra/.
    for (const name of [...GROUPS.map((g) => g.name), ROBOTS.name]) {
      const same = groupResources(tfFiles()).filter((b) => attributes(b.body).get('name') === `"${name}"`);
      expect(same.map((b: Block) => `${b.file}: ${b.labels[1]}`), `exactly one Terraform group named ${name}`).toHaveLength(1);
    }

    // `terraform validate` needs providers from the registry: the required "Terraform" check runs it.
    // fmt needs nothing, so it runs here whenever terraform is installed.
    if (onPath('terraform')) {
      const files = ['cognito.tf', 'cognito-group-imports.tf'].filter((f) => existsSync(join(INFRA, f)));
      const fmt = spawnSync('terraform', ['fmt', '-check', '-diff', ...files], { cwd: INFRA, encoding: 'utf8' });
      expect(fmt.status, `terraform fmt -check ${files.join(' ')}\n${fmt.stdout}${fmt.stderr}`).toBe(0);
    } else {
      test.info().annotations.push({ type: 'note', description: 'terraform not installed here: fmt and validate are the required "Terraform" check.' });
    }
  });

  test('AC-2 prod adopts hr_staff and employee as they are: import blocks for every environment, prod descriptions', () => {
    for (const g of GROUPS) {
      const found = importsTo(new RegExp(`^aws_cognito_user_group\\.${g.resource}$`));
      expect(found, `one import block to aws_cognito_user_group.${g.resource}`).toHaveLength(1);
      const a = found[0].attrs;
      expect(a.has('for_each') || a.has('count'), `${g.resource} import runs in prod and pepla-dev (no for_each)`).toBe(false);
      expect(idIsPoolSlash(a.get('id'), g.name), `${g.resource} import id is "<Naleko pool id>/${g.name}" (got ${a.get('id')})`).toBe(true);

      // Prod's text, so prod plans import with no update (the prod plan itself is read on the PR).
      const res = resourceNamed([COGNITO_TF], g.resource);
      expect(res, `aws_cognito_user_group.${g.resource} exists`).toHaveLength(1);
      const description = attributes(res[0].body).get('description') ?? '';
      expect(description, `${g.resource} has a description`).toMatch(/^"[^"]+"$/);
      expect(description, `${g.resource} description is prod's, not the dev seed's`).not.toContain(SEED_TEXT.replace(/\s+/g, ''));
    }

    const file = join(INFRA, 'cognito-group-imports.tf');
    expect(existsSync(file), 'infra/cognito-group-imports.tf').toBe(true);
    const header = readFileSync(file, 'utf8').split('\n').slice(0, 25).join('\n');
    expect(header, 'header says the file is deleted once the applies have run').toMatch(/delete/i);
  });

  test('AC-3 pepla-dev adopts e2e-robots too: its import runs everywhere but prod', () => {
    const found = importsTo(/^aws_cognito_user_group\.e2e_robots\[(0|each\.(key|value))\]$/);
    expect(found, 'one import block to aws_cognito_user_group.e2e_robots[0]').toHaveLength(1);
    const a = found[0].attrs;
    expect(devOnlyCondition(a), `e2e_robots import has a for_each that is empty in prod (got ${a.get('for_each')})`).toBe(true);
    expect(idIsPoolSlash(a.get('id'), ROBOTS.name), `e2e_robots import id is "<Naleko pool id>/e2e-robots" (got ${a.get('id')})`).toBe(
      true,
    );
    // hr_staff and employee import in dev as well: AC-2 checks they carry no for_each.
  });

  test('AC-4 the seed uses the groups Terraform made and never creates one on the Naleko pool', () => {
    const run = runWithFakeAws(SEED, devAws(['hr_staff', 'employee', 'e2e-robots', ...MODULE_GROUPS]));
    expect(run.status, `seed exits 0\n${run.output}`).toBe(0);
    expect(run.output, 'no stack trace').not.toContain('Traceback');

    expect(createGroupOn(run.calls, NALEKO_ID).map((c) => c.params['GroupName']), 'no CreateGroup on the Naleko pool').toEqual([]);

    const hr = addedTo(run.calls, NALEKO_ID, /^pepla-e2e-hr@/);
    const emp = addedTo(run.calls, NALEKO_ID, /^pepla-e2e-employee@/);
    expect(hr, 'HR test login is put in hr_staff').toContain('hr_staff');
    expect(emp, 'employee test login is put in employee').toContain('employee');
    expect(hr, 'HR test login is put in e2e-robots').toContain('e2e-robots');
    expect(emp, 'employee test login is put in e2e-robots').toContain('e2e-robots');

    // Every test login, in both pools, stays in e2e-robots (the AI guardrail).
    const users = new Map<string, Set<string>>();
    for (const c of run.calls.filter((c) => c.op === 'AdminAddUserToGroup' && ok(c))) {
      const key = `${c.params['UserPoolId']} ${c.params['Username']}`;
      users.set(key, (users.get(key) ?? new Set()).add(String(c.params['GroupName'])));
    }
    expect(users.size, 'test logins were put in groups').toBeGreaterThan(2);
    for (const [user, groups] of users) expect([...groups], `${user} is in e2e-robots`).toContain('e2e-robots');

    // The TalentFlow pool keeps its current handling (out of scope), so it is not checked here.
  });

  test('AC-5 a missing employee group stops the seed with one line that names it and Terraform, and leaks nothing', () => {
    const run = runWithFakeAws(SEED, devAws(['hr_staff', 'e2e-robots', ...MODULE_GROUPS]));
    expect(run.status, `seed exits non-zero\n${run.output}`).not.toBe(0);
    expect(run.status, 'seed was not killed by the timeout').not.toBeNull();

    const lines = run.output.split('\n').filter((l) => l.trim());
    const says = lines.filter((l) => /\bemployee\b/.test(l) && /terraform/i.test(l));
    expect(says, `one line names the employee group and Terraform\n${run.output}`).toHaveLength(1);

    expect(run.output, 'no stack trace').not.toContain('Traceback');
    expect(run.output, 'no stack frame').not.toMatch(/^\s*File "/m);
    for (const secret of [DEV_ACCOUNT, NALEKO_ID, TALENT_ID, PASSWORD, 'arn:aws']) {
      expect(run.output, `prints nothing about the account (${secret === PASSWORD ? 'password' : secret})`).not.toContain(secret);
    }

    expect(createGroupOn(run.calls, NALEKO_ID).map((c) => c.params['GroupName']), 'does not create the group itself').toEqual([]);
  });

  test('AC-6 an import shows as import in the PR plan summary and the drift list, never as "No changes."', () => {
    const summaryStep = workflowStep('terraform-plan.yml', 'terraform show -json');
    const driftStep = workflowStep('drift-check.yml', 'terraform show -json');

    // PR plan summary
    const only = runStepWithPlan(summaryStep, IMPORT_ONLY);
    expect(only.status, `summary step runs\n${only.stderr}`).toBe(0);
    expect(only.summary, 'import-only plan is not "No changes."').not.toContain('No changes.');
    expect(only.summary).toMatch(line('import', 'aws_cognito_user_group.hr_staff'));
    expect(only.summary).toMatch(line('import', 'aws_cognito_user_group.employee'));
    expect(only.summary, 'unchanged resources stay hidden').not.toContain('aws_cognito_user_pool.naleko_dev');
    expect(only.summary, 'data reads stay hidden').not.toContain('data.aws_caller_identity');

    const mixed = runStepWithPlan(summaryStep, MIXED);
    expect(mixed.status, `summary step runs\n${mixed.stderr}`).toBe(0);
    expect(mixed.summary).toMatch(line('import+update', 'aws_cognito_user_group.e2e_robots[0]'));
    expect(mixed.summary, 'creates still listed').toMatch(line('create', 'aws_s3_bucket.example'));
    expect(mixed.summary, 'deletes still listed').toMatch(line('delete', 'aws_sqs_queue.example'));
    expect(mixed.summary).not.toContain('aws_cognito_user_pool.naleko_dev');

    const none = runStepWithPlan(summaryStep, NOTHING);
    expect(none.status).toBe(0);
    expect(none.summary, 'a plan with nothing to do still says "No changes."').toContain('No changes.');

    // Nightly drift list
    const drift = (p: unknown) => {
      const r = runStepWithPlan(driftStep, p);
      expect(r.status, `drift step runs\n${r.stderr}`).toBe(0);
      return { ...r, list: readIfExists(join(r.runnerTemp, 'drift.txt')) };
    };
    const d1 = drift(IMPORT_ONLY);
    expect(d1.list).toMatch(line('import', 'aws_cognito_user_group.hr_staff'));
    expect(d1.list).toMatch(line('import', 'aws_cognito_user_group.employee'));
    expect(d1.list).not.toContain('aws_cognito_user_pool.naleko_dev');
    const d2 = drift(MIXED);
    expect(d2.list).toMatch(line('import+update', 'aws_cognito_user_group.e2e_robots[0]'));
    expect(d2.list).toMatch(line('create', 'aws_s3_bucket.example'));
    expect(d2.list).toMatch(line('delete', 'aws_sqs_queue.example'));
    expect(drift(NOTHING).list.trim(), 'nothing to do lists nothing').toBe('');

    // Addresses and actions only: the repo's logs are public.
    for (const r of [only, mixed, d1, d2]) {
      const printed = `${r.stdout}${r.stderr}${r.summary}${'list' in r ? r.list : ''}`;
      expect(printed, 'no values printed').not.toContain(SECRET_VALUE);
      expect(printed, 'no import ids printed').not.toContain(NALEKO_ID);
    }
  });
});
