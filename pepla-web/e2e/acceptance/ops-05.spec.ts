import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { ON_DEV } from './support/fixtures';
import { GATE, SECRET, SECRET2, gate, line, lines, plan } from './support/ops-05/gate';
import {
  REPO,
  attributes,
  blocks,
  blocksIn,
  lifecycleOf,
  readText,
  rel,
  resolveString,
  resources,
  stringLocals,
  stripComments,
  tfFiles,
  tfFilesDeep,
  type Block,
} from './support/ops-05/hcl';
import { decide, unknownOperators, type Decision, type Policy, type Request } from './support/ops-05/iam-eval';
import {
  allNeeds,
  commandLines,
  loadWorkflow,
  loadWorkflows,
  prPaths,
  pushBranches,
  pushPaths,
  rolesAssumed,
  sameEnv,
  type Job,
  type Workflow,
} from './support/ops-05/workflows';

/**
 * OPS-05 · Terraform applies itself, prod on Approve (child of NH-150).
 * Spec: /mnt/project-files/onboarding-cards/specs/OPS-05.md, approved by Iggie
 * 13 Nov 13:10. One test per acceptance criterion, written from the spec
 * before any code, by the verifier.
 *
 * Infra card: no browser. The tests read the workflow files and the Terraform
 * as text, evaluate the apply roles' policy text with a small IAM evaluator
 * (support/ops-05/iam-eval.ts), and run the apply guard on made-up plans.
 * Nothing calls AWS, GitHub, Terraform's registry or any AI service.
 *
 * What only a live run can show (the first pepla-dev apply, the first release,
 * the GitHub environment settings, AWS's own policy simulator) is read by the
 * verifier on the second pass, listed in the PR. Each test below checks the
 * part of its criterion that the code alone decides.
 *
 * Names the builder must use, so the checks can find things. Everything else
 * (workflow file names, job ids, step layout) is the builder's choice:
 *   - scripts/ci/tf-gate.py: the apply guard; its command line is described in
 *     support/ops-05/gate.ts.
 *   - scripts/ci/check-prevent-destroy.py: the CI check for prevent_destroy;
 *     run with no arguments from anywhere, it checks the infra/ and
 *     talent-flow-infra/ folders next to its own scripts/ folder.
 *   - bootstrap/modules/tf-apply-policy/policy.json.tftpl: the one shared
 *     apply policy, a JSON template whose only variables are ${account_id},
 *     ${state_bucket} and ${region} (IAM's own ${...} written as $${...}).
 *   - The two apply roles are `resource "aws_iam_role"` blocks with a literal
 *     name in bootstrap/dev and bootstrap/prod (not inside the module).
 *
 * They run once, in the desktop-1280 project, in the no-backend run.
 * These files are locked once accepted: see ./README.md.
 */

// ---------------------------------------------------------------- facts from the spec

const DEV = '424556617428';
const PROD = '937137806477';
const REGION = 'af-south-1';
const STATE = { [DEV]: `pepla-tfstate-dev-${DEV}`, [PROD]: 'naleko-tfstate-af-south-1' } as Record<string, string>;
const STATE_KEYS = ['naleko/onboarding/terraform.tfstate', 'talent-flow/mvp1/terraform.tfstate'];
const ROLE_DEV = `arn:aws:iam::${DEV}:role/pepla-github-tf-apply-dev`;
const ROLE_PROD = `arn:aws:iam::${PROD}:role/pepla-github-tf-apply-prod`;
const PLAN_ROLE = `arn:aws:iam::${PROD}:role/naleko-github-plan-readonly`;
const CODE_ROLE = `arn:aws:iam::${PROD}:role/pepla-github-deploy-code-prod`;
const DEV_CODE_ROLE = `arn:aws:iam::${DEV}:role/pepla-github-deploy-dev`;
const CI_ROLE_NAMES = [
  'pepla-github-tf-apply-dev',
  'pepla-github-tf-apply-prod',
  'naleko-github-plan-readonly',
  'pepla-github-deploy-code-prod',
  'pepla-github-deploy-dev',
  'OrganizationAccountAccessRole',
];
const SUBJECT_FORMS = ['repo:obsydian-tech/hr-portal', 'repo:obsydian-tech@183697107/hr-portal@1188146294'];

const INFRA = join(REPO, 'infra');
const TALENT = join(REPO, 'talent-flow-infra');
const BOOT_DEV = join(REPO, 'bootstrap', 'dev');
const BOOT_PROD = join(REPO, 'bootstrap', 'prod');
const POLICY_TPL = join(REPO, 'bootstrap', 'modules', 'tf-apply-policy', 'policy.json.tftpl');
const PD_CHECK = join(REPO, 'scripts', 'ci', 'check-prevent-destroy.py');

/** The protected list, per root. */
const PROTECTED: Record<string, string[]> = {
  infra: [
    'aws_cognito_user_pool.naleko_dev',
    ...[
      'employees',
      'documents',
      'document_verification',
      'external_verification_requests',
      'onboarding_events',
      'agent_audit',
      'pending_actions',
      'idempotency_keys',
      'prompt_cache',
      'naleko_ai_rate_limit',
      'it_tasks',
      'provisioning_bundles',
      'talent_flow_events',
    ].map((t) => `aws_dynamodb_table.${t}`),
    'aws_s3_bucket.document_uploads',
    'aws_s3_bucket.audit_archive',
    'module.config[0].aws_s3_bucket.config_logs',
    'module.kms_pii.aws_kms_key.this',
    'aws_secretsmanager_secret.agent_api_key',
  ],
  'talent-flow-infra': [
    'aws_cognito_user_pool.talent_flow',
    ...[
      'talent_flow_state',
      'talent_flow_config',
      'talent_flow_agent_audit',
      'talent_flow_prompt_cache',
      'talent_flow_pending_actions',
      'talent_flow_ai_rate_limit',
      'talent_flow_idempotency_keys',
      'talent_flow_users',
      'talent_flow_notifications',
      'intelligence_dismissals',
      'intelligence_events',
    ].map((t) => `aws_dynamodb_table.${t}`),
    'aws_s3_bucket.talent_flow_audit_archive',
    'aws_kms_key.talent_flow_state',
    'aws_kms_key.talent_flow_agent_audit',
    'aws_secretsmanager_secret.agent_api_key',
  ],
};

// ---------------------------------------------------------------- workflows

const APPLY = /\bterraform\b[^\n]*\bapply\b/;
const runsApply = (j: Job) => j.steps.some((s) => commandLines(s.run, APPLY).length > 0);
const firstStep = (j: Job, re: RegExp) => j.steps.findIndex((s) => re.test(s.run) || re.test(s.uses));
const firstApply = (j: Job) => j.steps.findIndex((s) => commandLines(s.run, APPLY).length > 0);

type Found = { w: Workflow; j: Job };
const allJobs = (): Found[] => loadWorkflows().flatMap((w) => w.jobs.map((j) => ({ w, j })));
const jobsIn = (env: string) => allJobs().filter((f) => sameEnv(f.j.environment, env));

/** The workflows that start `w`: itself if it has its own triggers, plus any that call it as a reusable workflow. */
function starters(w: Workflow): Workflow[] {
  const out: Workflow[] = Object.keys(w.on).some((k) => k !== 'workflow_call') ? [w] : [];
  for (const other of loadWorkflows()) {
    if (other.jobs.some((j) => j.uses.replace(/^\.\//, '').replace(/@.*$/, '') === `.github/workflows/${w.file}`)) out.push(...starters(other));
  }
  return out;
}

/** Job ids `j` waits for, plus, for a job that calls a reusable workflow, the jobs inside it. */
function waitsFor(w: Workflow, j: Job): { ids: Set<string>; called: Found[] } {
  const ids = allNeeds(w, j);
  const called: Found[] = [];
  for (const id of ids) {
    const needed = w.jobs.find((x) => x.id === id);
    const file = needed?.uses.match(/^\.\/\.github\/workflows\/([^@]+)/)?.[1];
    if (file && existsSync(join(REPO, '.github', 'workflows', file))) {
      const inner = loadWorkflow(file);
      called.push(...inner.jobs.map((x) => ({ w: inner, j: x })));
    }
  }
  return { ids, called };
}

/** Does `j` (in `w`) wait for some job that runs in environment `env`? */
function waitsForEnv(w: Workflow, j: Job, env: string): boolean {
  const { ids, called } = waitsFor(w, j);
  return w.jobs.some((x) => ids.has(x.id) && sameEnv(x.environment, env)) || called.some((c) => sameEnv(c.j.environment, env));
}

const where = (f: Found) => `${f.w.file} job "${f.j.id}"`;
const pathCovers = (paths: string[], want: string) =>
  paths.length === 0 || paths.some((p) => p === want || (p.endsWith('/**') && want.startsWith(p.slice(0, -2))) || (p.endsWith('**') && want.startsWith(p.slice(0, -2))));

// ---------------------------------------------------------------- the shared apply policy

function renderPolicy(account: string): Policy {
  const tpl = readFileSync(POLICY_TPL, 'utf8');
  expect(tpl, 'policy.json.tftpl uses no template directives (%{ ... })').not.toMatch(/(^|[^%])%\{/);
  const vars: Record<string, string> = { account_id: account, state_bucket: STATE[account], region: REGION };
  const out = tpl.replace(/(\$?)\$\{([^}]*)\}/g, (all, esc: string, name: string) => {
    if (esc) return `\${${name}}`;
    const v = vars[name.trim()];
    if (v === undefined) throw new Error(`policy.json.tftpl uses \${${name}}: only account_id, state_bucket and region are allowed`);
    return v;
  });
  return JSON.parse(out) as Policy;
}

const policies = () => [DEV, PROD].map((acct) => ({ acct, name: acct === DEV ? 'dev apply role' : 'prod apply role', policy: renderPolicy(acct) }));

function expectDecision(p: { name: string; policy: Policy }, r: Request, want: Decision | 'denied') {
  const got = decide(p.policy, r);
  const ctx = r.context ? ` ${JSON.stringify(r.context)}` : '';
  const ok = want === 'denied' ? got !== 'allowed' : got === want;
  expect.soft(ok, `${p.name}: ${r.action} on ${r.resource}${ctx} should be ${want}, is ${got}`).toBe(true);
}

// ---------------------------------------------------------------- Terraform helpers

/** The block an address like `module.kms_pii.aws_kms_key.this` or `aws_dynamodb_table.employees` points at, in a root. */
function findResource(rootDir: string, address: string): Block[] {
  const m = /^module\.([A-Za-z0-9_-]+)(?:\[[^\]]*\])?\.(.+)$/.exec(address);
  if (m) {
    const mod = blocks(tfFiles(rootDir), 'module').find((b) => b.labels[0] === m[1]);
    if (!mod) return [];
    const src = (attributes(mod.body).get('source') ?? '').replace(/^"|"$/g, '');
    return findResource(resolve(rootDir, src), m[2]);
  }
  const [type, name] = address.split('.');
  return resources(tfFiles(rootDir), type).filter((b) => b.labels[1] === name);
}

/** Literal role names of every aws_iam_role in a root and its modules (locals resolved). */
function roleNames(rootDir: string): { names: string[]; unresolved: string[] } {
  const files = tfFilesDeep(rootDir);
  const locals = stringLocals(files);
  const names: string[] = [];
  const unresolved: string[] = [];
  for (const b of resources(files, 'aws_iam_role')) {
    const a = attributes(b.body);
    const expr = a.get('name') ?? a.get('name_prefix');
    const v = expr === undefined ? undefined : resolveString(expr, (n) => locals.get(n));
    if (v === undefined) unresolved.push(`${rel(b.file)}: aws_iam_role.${b.labels[1]} name = ${expr ?? '(none)'}`);
    else names.push(v);
  }
  return { names, unresolved };
}

/** Every "repo:..." subject in a role's trust policy, with ${local.x} resolved. */
function trustSubjects(rootDir: string, roleName: string): { found: boolean; subjects: string[]; text: string } {
  const files = tfFiles(rootDir);
  const locals = stringLocals(files);
  const role = resources(files, 'aws_iam_role').find((b) => attributes(b.body).get('name') === `"${roleName}"`);
  if (!role) return { found: false, subjects: [], text: '' };
  const text = role.body;
  const strings = [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => resolveString(`"${m[1]}"`, (n) => locals.get(n)) ?? m[1])
    .filter((s) => s.startsWith('repo:'));
  return { found: true, subjects: [...new Set(strings)].sort(), text };
}

// ----------------------------------------------------------------

test.describe('OPS-05 Terraform applies itself, prod on Approve', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(ON_DEV, 'No-backend run only: these read code and run the guard on made-up plans.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'No browser: runs once.');
  });

  test('AC-1 a merge into develop plans and applies both roots to pepla-dev with the dev apply role, from the saved plan', () => {
    const dev = jobsIn('dev-apply');
    expect(dev.map(where), 'a job runs in GitHub environment dev-apply').not.toHaveLength(0);

    for (const f of dev) {
      const st = starters(f.w);
      const pushed = st.filter((s) => pushBranches(s).includes('develop'));
      expect(pushed.map((s) => s.file), `${where(f)} starts on a push to develop`).not.toHaveLength(0);
      for (const s of pushed) {
        for (const p of ['infra/main.tf', 'talent-flow-infra/main.tf', 'scripts/ci/tf-gate.py', `.github/workflows/${f.w.file}`]) {
          expect(pathCovers(pushPaths(s), p), `${s.file}: push paths cover ${p}`).toBe(true);
        }
      }
      expect(
        st.some((s) => 'workflow_dispatch' in s.on),
        `${where(f)} can also be started by hand (workflow_dispatch)`,
      ).toBe(true);
      // By hand it may only run from develop: the job, or a job it waits for, says so.
      const guards = [f.j.if, ...[...allNeeds(f.w, f.j)].map((id) => f.w.jobs.find((x) => x.id === id)?.if ?? '')].join('\n');
      expect(guards, `${where(f)} (or a job it waits for) runs only for refs/heads/develop`).toContain('refs/heads/develop');

      expect(rolesAssumed(f.w, f.j), `${where(f)} signs in only as pepla-github-tf-apply-dev`).toEqual([ROLE_DEV]);
      expect(f.j.text, `${where(f)} uses the dev backend`).toContain('env/dev.s3.tfbackend');
      expect(f.j.text, `${where(f)} uses the dev tfvars`).toContain('env/dev.tfvars');
      expect(f.j.text, `${where(f)} covers infra/`).toMatch(/(^|[^-\w])infra\b/m);
      expect(f.j.text, `${where(f)} covers talent-flow-infra/`).toContain('talent-flow-infra');
    }
    expect(dev.filter((f) => runsApply(f.j)).map(where), 'a dev-apply job runs terraform apply').not.toHaveLength(0);

    // Every apply anywhere applies a saved plan file, whole: no targets, no destroy, no auto-approve plan-and-apply.
    for (const f of allJobs()) {
      for (const s of f.j.steps) {
        expect(s.run, `${where(f)} never runs terraform destroy`).not.toMatch(/\bterraform\b[^\n]*\bdestroy\b/);
        for (const l of commandLines(s.run, APPLY)) {
          const args = l.slice(l.search(/\bapply\b/) + 'apply'.length).split(/[;&|>]/)[0].trim().split(/\s+/).filter(Boolean);
          expect(args.filter((a) => !a.startsWith('-')), `${where(f)}: "${l.trim()}" applies a saved plan file`).toHaveLength(1);
          for (const bad of ['-auto-approve', '-target', '-replace', '-destroy', '-refresh-only', '-var', '-var-file']) {
            expect(args.some((a) => a === bad || a.startsWith(`${bad}=`)), `${where(f)}: "${l.trim()}" has no ${bad}`).toBe(false);
          }
        }
      }
    }
  });

  test('AC-2 the dev Lambda deploy and the pepla-dev E2E wait for the dev apply and do not start after a failed one', () => {
    const found = allJobs().filter((f) => starters(f.w).some((s) => pushBranches(s).includes('develop')));
    const deploy = found.filter((f) => f.j.text.includes('deploy-lambdas.sh') && rolesAssumed(f.w, f.j).includes(DEV_CODE_ROLE));
    // The E2E that follows the Lambda deploy (app-e2e-dev.yml's web-app run is read on the second pass).
    const e2e = found.filter(
      (f) => f.j.text.includes('seed-dev.py') && rolesAssumed(f.w, f.j).includes(DEV_CODE_ROLE) && deploy.some((d) => d.w.file === f.w.file),
    );
    expect(deploy.map(where), 'the dev Lambda deploy job').not.toHaveLength(0);
    expect(e2e.map(where), 'the pepla-dev E2E job').not.toHaveLength(0);

    for (const f of [...deploy, ...e2e]) {
      expect(waitsForEnv(f.w, f.j, 'dev-apply'), `${where(f)} waits (needs:) for the dev-apply job`).toBe(true);
      // A job that overrides the default "skip when a needed job failed" must still check the result.
      if (/always\(\)|!\s*cancelled\(\)|failure\(\)/.test(f.j.if)) {
        expect(f.j.if, `${where(f)} overrides the skip, so it must check the apply's result`).toMatch(/needs\.[\w-]+\.result/);
      }
    }
  });

  test('AC-3 a release plans prod with the read-only role and the summary shows address, action, attribute names and warnings', () => {
    const plans = jobsIn('prod-plan');
    expect(plans.map(where), 'a job runs in GitHub environment prod-plan').not.toHaveLength(0);
    for (const f of plans) {
      expect(starters(f.w).some((s) => pushBranches(s).includes('main')), `${where(f)} starts on a push to main`).toBe(true);
      expect(rolesAssumed(f.w, f.j), `${where(f)} signs in only as the read-only plan role`).toEqual([PLAN_ROLE]);
      expect(f.j.text, `${where(f)} writes the guard's summary`).toMatch(/tf-gate\.py["']?\s+summary/);
      expect(f.j.text, `${where(f)} writes to the run summary`).toContain('GITHUB_STEP_SUMMARY');
      expect(f.j.text, `${where(f)} covers talent-flow-infra/`).toContain('talent-flow-infra');
    }

    // The summary itself, on a made-up plan with one of everything.
    const p = plan(
      {
        address: 'aws_lambda_function.get_employee',
        actions: ['update'],
        before: { timeout: 3, memory_size: 128, environment: [{ variables: { TOKEN: SECRET } }] },
        after: { timeout: 10, memory_size: 128, environment: [{ variables: { TOKEN: `${SECRET}-2` } }] },
      },
      {
        address: 'aws_dynamodb_table.employees',
        actions: ['update'],
        before: { billing_mode: 'PAY_PER_REQUEST', deletion_protection_enabled: false },
        after: { billing_mode: 'PAY_PER_REQUEST', deletion_protection_enabled: true },
      },
      { address: 'aws_iam_role.ops05_new', actions: ['create'], before: null, after: { name: SECRET2 } },
      { address: 'aws_cognito_user_group.hr_staff', actions: ['no-op'], importing: 'af-south-1_Fake/hr_staff' },
      { address: 'aws_cognito_user_group.employee', actions: ['update'], importing: 'af-south-1_Fake/employee', before: { description: 'a' }, after: { description: SECRET } },
      { address: 'aws_iam_role.github_plan_readonly[0]', actions: ['forget'], after: null },
      { address: 'aws_sqs_queue.old', actions: ['delete'], after: null },
      { address: 'aws_sqs_queue.swapped', actions: ['delete', 'create'] },
      { address: 'aws_s3_bucket.document_uploads', actions: ['no-op'] },
      { address: 'data.aws_caller_identity.current', actions: ['read'] },
    );
    const r = gate(['summary', 'infra', 'plan.json'], { 'plan.json': p });
    expect(r.status, `tf-gate.py summary exits 0\n${r.out}`).toBe(0);
    const md = r.stdout;
    expect(md, 'names the root').toContain('infra');
    const row = (address: string) => md.split('\n').filter((l) => l.includes(address)).join('\n');
    const rows: [string, string][] = [
      ['aws_lambda_function.get_employee', 'update'],
      ['aws_dynamodb_table.employees', 'update'],
      ['aws_iam_role.ops05_new', 'create'],
      ['aws_cognito_user_group.hr_staff', 'import'],
      ['aws_cognito_user_group.employee', 'import+update'],
      ['aws_iam_role.github_plan_readonly[0]', 'forget'],
      ['aws_sqs_queue.old', 'delete'],
      ['aws_sqs_queue.swapped', 'replace'],
    ];
    for (const [address, action] of rows) {
      expect(row(address), `a row for ${address}`).not.toBe('');
      expect(row(address), `${address} shows action ${action}`).toMatch(new RegExp(`(^|[^\\w+])${action.replace('+', '\\+')}([^\\w+]|$)`));
    }
    expect(row('aws_cognito_user_group.hr_staff'), 'a plain import is not shown as import+update').not.toContain('import+update');
    expect(row('aws_lambda_function.get_employee'), 'changed attribute names: timeout').toContain('timeout');
    expect(row('aws_lambda_function.get_employee'), 'changed attribute names: environment').toContain('environment');
    expect(row('aws_lambda_function.get_employee'), 'unchanged attributes are not listed').not.toContain('memory_size');
    expect(row('aws_dynamodb_table.employees'), 'changed attribute names').toContain('deletion_protection_enabled');
    expect(row('aws_dynamodb_table.employees'), 'unchanged attributes are not listed').not.toContain('billing_mode');
    expect(md, 'unchanged resources are not listed').not.toContain('aws_s3_bucket.document_uploads');
    expect(md, 'data reads are not listed').not.toContain('data.aws_caller_identity');
    for (const warning of ['IAM change', 'Lambda environment change', 'Protected resource change']) {
      expect(md, `warning line "${warning}"`).toContain(warning);
    }
    for (const v of [SECRET, SECRET2, 'PAY_PER_REQUEST', 'af-south-1_Fake']) expect(r.out, `no value printed (${v})`).not.toContain(v);

    // Warnings appear only when they apply.
    const quiet = gate(['summary', 'infra', 'plan.json'], {
      'plan.json': plan(
        { address: 'aws_lambda_function.get_employee', actions: ['update'], before: { timeout: 3, environment: [{ variables: { A: 'x' } }] }, after: { timeout: 10, environment: [{ variables: { A: 'x' } }] } },
        { address: 'aws_sqs_queue.example', actions: ['create'], before: null },
      ),
    });
    expect(quiet.status, quiet.out).toBe(0);
    for (const warning of ['IAM change', 'Lambda environment change', 'Protected resource change']) {
      expect(quiet.stdout, `no "${warning}" line when nothing of that kind changes`).not.toContain(warning);
    }
    const iamOnly = gate(['summary', 'talent-flow-infra', 'plan.json'], {
      'plan.json': plan({ address: 'aws_iam_role_policy.some_lambda', actions: ['update'], before: { policy: 'a' }, after: { policy: 'b' } }),
    });
    expect(iamOnly.stdout, 'any aws_iam_* change is an IAM change').toContain('IAM change');
    const envOnly = gate(['summary', 'infra', 'plan.json'], {
      'plan.json': plan({ address: 'aws_lambda_function.x', actions: ['update'], before: { environment: [{ variables: { A: SECRET } }] }, after: { environment: [] } }),
    });
    expect(envOnly.stdout, 'a Lambda environment change alone').toContain('Lambda environment change');

    // Every protected address, in its own root, raises the protected line.
    for (const [root, addresses] of Object.entries(PROTECTED)) {
      for (const address of addresses) {
        const g = gate(['summary', root, 'plan.json'], {
          'plan.json': plan({ address, actions: ['update'], before: { tags: { a: '1' } }, after: { tags: { a: '2' } } }),
        });
        expect.soft(g.stdout, `${root}: ${address} is protected`).toContain('Protected resource change');
      }
    }

    // On a PR, the plan workflow says when the PR changes the pipeline.
    const pr = loadWorkflow('terraform-plan.yml');
    expect(pr.text, 'terraform-plan.yml has the "This PR changes the apply pipeline" line').toContain('This PR changes the apply pipeline');
    for (const p2 of ['bootstrap/prod/main.tf', 'scripts/ci/tf-gate.py', ...new Set(jobsIn('dev-apply').concat(jobsIn('Production')).map((f) => `.github/workflows/${f.w.file}`))]) {
      expect(pathCovers(prPaths(pr), p2), `terraform-plan.yml runs on PRs that touch ${p2}`).toBe(true);
    }
  });

  test('AC-4 nothing changes in prod without one Approve in Production, which covers infra and Lambda code', () => {
    const prod = jobsIn('Production');
    expect(prod.map(where), 'exactly one job, in the whole repo, waits in Production (one Approve per release)').toHaveLength(1);
    const f = prod[0];
    expect(starters(f.w).some((s) => pushBranches(s).includes('main')), `${where(f)} starts on a push to main`).toBe(true);
    expect(waitsForEnv(f.w, f.j, 'prod-plan'), `${where(f)} waits for the prod-plan job`).toBe(true);
    expect(f.j.if, `${where(f)} is skipped when the plan job says there is nothing to release`).toMatch(/needs\.[\w-]+\.outputs\./);

    const roles = rolesAssumed(f.w, f.j);
    expect(roles, `${where(f)} signs in as the prod apply role`).toContain(ROLE_PROD);
    expect(roles, `${where(f)} signs in as the code-only role for Lambda code`).toContain(CODE_ROLE);
    expect(roles.filter((r) => r !== ROLE_PROD && r !== CODE_ROLE), `${where(f)} uses no other role`).toEqual([]);
    const apply = firstApply(f.j);
    const code = firstStep(f.j, /deploy-lambdas\.sh/);
    expect(apply, `${where(f)} runs terraform apply`).toBeGreaterThanOrEqual(0);
    expect(code, `${where(f)} deploys Lambda code`).toBeGreaterThanOrEqual(0);
    expect(apply, `${where(f)}: infra is applied before Lambda code is deployed`).toBeLessThan(code);
    const signIn = (arn: string) =>
      f.j.steps.findIndex((s) => s.uses.startsWith('aws-actions/configure-aws-credentials') && rolesAssumed(f.w, { ...f.j, steps: [s] }).includes(arn));
    expect(signIn(ROLE_PROD), 'signs in as the apply role before applying').toBeLessThan(apply);
    expect(signIn(CODE_ROLE), 'signs in as the code role after applying, before deploying code').toBeGreaterThan(apply);
    expect(signIn(CODE_ROLE)).toBeLessThan(code);

    // No other job anywhere uses the prod apply or code role, or applies outside dev-apply and Production.
    for (const g of allJobs()) {
      if (g.w.file === f.w.file && g.j.id === f.j.id) continue;
      const r = rolesAssumed(g.w, g.j);
      expect(r, `${where(g)} does not use the prod apply role`).not.toContain(ROLE_PROD);
      expect(r, `${where(g)} does not use the prod code role`).not.toContain(CODE_ROLE);
      if (runsApply(g.j)) expect(g.j.environment, `${where(g)} applies, so it must run in dev-apply`).toBe('dev-apply');
    }
  });

  test('AC-5 prod applies only what was approved: a re-plan that differs by any address or action applies nothing', () => {
    const approved = plan(
      { address: 'aws_lambda_function.a', actions: ['update'] },
      { address: 'aws_iam_role.b', actions: ['create'], before: null },
      { address: 'aws_cognito_user_group.c', actions: ['no-op'], importing: 'x/c' },
      { address: 'aws_sqs_queue.d', actions: ['delete'], after: null },
      { address: 'aws_s3_bucket.unchanged', actions: ['no-op'] },
    );
    const listed = gate(['list', 'plan.json'], { 'plan.json': approved });
    expect(listed.status, `tf-gate.py list exits 0\n${listed.out}`).toBe(0);
    expect(lines(listed.stdout), 'list prints "<action>\\t<address>" for changes only').toEqual(
      [line('update', 'aws_lambda_function.a'), line('create', 'aws_iam_role.b'), line('import', 'aws_cognito_user_group.c'), line('delete', 'aws_sqs_queue.d')].sort(),
    );

    const compare = (replan: unknown) => gate(['compare', 'approved.txt', 'plan.json'], { 'approved.txt': listed.stdout, 'plan.json': replan });
    const reordered = compare({ ...approved, resource_changes: [...approved.resource_changes].reverse() });
    expect(reordered.status, `same changes in another order: match\n${reordered.out}`).toBe(0);
    const noise = compare({
      ...approved,
      resource_changes: [...approved.resource_changes, ...plan({ address: 'data.aws_region.current', actions: ['read'] }, { address: 'aws_sqs_queue.e', actions: ['no-op'] }).resource_changes],
    });
    expect(noise.status, `extra no-ops and reads: still a match\n${noise.out}`).toBe(0);

    const added = compare({ ...approved, resource_changes: [...approved.resource_changes, ...plan({ address: 'aws_sqs_queue.sneaked_in', actions: ['create'], before: null }).resource_changes] });
    expect(added.status, 'an added change: no match').not.toBe(0);
    expect(added.out, 'names the added address').toContain('aws_sqs_queue.sneaked_in');

    const missing = compare({ ...approved, resource_changes: approved.resource_changes.filter((c) => c.address !== 'aws_iam_role.b') });
    expect(missing.status, 'a missing change: no match').not.toBe(0);
    expect(missing.out, 'names the missing address').toContain('aws_iam_role.b');

    const changed = compare({
      ...approved,
      resource_changes: approved.resource_changes.map((c) => (c.address === 'aws_lambda_function.a' ? { ...c, change: { ...c.change, actions: ['delete', 'create'] } } : c)),
    });
    expect(changed.status, 'same address, other action (update became replace): no match').not.toBe(0);
    expect(changed.out, 'names the changed address').toContain('aws_lambda_function.a');

    const empty = gate(['compare', 'approved.txt', 'plan.json'], { 'approved.txt': '', 'plan.json': approved });
    expect(empty.status, 'nothing approved but the plan changes things: no match').not.toBe(0);

    // The release job compares before it applies; so does any apply after a dev-destroy approval.
    const prod = jobsIn('Production');
    expect(prod.map(where)).toHaveLength(1);
    const cmp = firstStep(prod[0].j, /tf-gate\.py["']?\s+compare/);
    expect(cmp, `${where(prod[0])} runs tf-gate.py compare`).toBeGreaterThanOrEqual(0);
    expect(cmp, `${where(prod[0])} compares before applying`).toBeLessThan(firstApply(prod[0].j));
    for (const f of jobsIn('dev-apply').filter((x) => waitsForEnv(x.w, x.j, 'dev-destroy') && runsApply(x.j))) {
      const c = firstStep(f.j, /tf-gate\.py["']?\s+compare/);
      expect(c, `${where(f)} applies after a dev-destroy approval, so it compares first`).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(firstApply(f.j));
    }
  });

  test('AC-6 a delete or a replace, in either order, stops and waits in dev-destroy or production-destroy; nothing else stops', () => {
    const destroys = (...changes: Parameters<typeof plan>) => gate(['destroys', 'plan.json'], { 'plan.json': plan(...changes) });

    const stops: [string[], string][] = [
      [['delete'], 'delete'],
      [['delete', 'create'], 'replace'],
      [['create', 'delete'], 'replace'],
    ];
    for (const [actions, word] of stops) {
      const r = destroys({ address: 'aws_sqs_queue.q', actions });
      expect(r.status, `${JSON.stringify(actions)} stops (exit 3)\n${r.out}`).toBe(3);
      expect(lines(r.stdout), `${JSON.stringify(actions)} is listed as ${word}`).toEqual([line(word, 'aws_sqs_queue.q')]);
    }

    const passes: [string, Parameters<typeof plan>[0]][] = [
      ['import', { address: 'aws_cognito_user_group.g', actions: ['no-op'], importing: 'x/g' }],
      ['import+update', { address: 'aws_cognito_user_group.g', actions: ['update'], importing: 'x/g' }],
      ['forget', { address: 'aws_iam_role.github_plan_readonly[0]', actions: ['forget'], after: null }],
      ['create', { address: 'aws_sqs_queue.q', actions: ['create'], before: null }],
      ['update', { address: 'aws_sqs_queue.q', actions: ['update'] }],
      ['read', { address: 'data.aws_caller_identity.current', actions: ['read'] }],
      ['no-op', { address: 'aws_sqs_queue.q', actions: ['no-op'] }],
    ];
    for (const [what, c] of passes) {
      const r = destroys(c);
      expect(r.status, `${what} alone does not stop (exit 0)\n${r.out}`).toBe(0);
      expect(r.stdout.trim(), `${what} alone lists nothing`).toBe('');
    }
    const nothing = gate(['destroys', 'plan.json'], { 'plan.json': { format_version: '1.2' } });
    expect(nothing.status, `a plan with no resource_changes does not stop\n${nothing.out}`).toBe(0);

    const mixed = destroys(
      { address: 'aws_sqs_queue.gone', actions: ['delete'], after: null },
      { address: 'aws_lambda_function.swapped', actions: ['create', 'delete'] },
      { address: 'module.config[0].aws_s3_bucket.config_logs', actions: ['delete', 'create'] },
      { address: 'aws_sqs_queue.new', actions: ['create'], before: null },
      { address: 'aws_sqs_queue.changed', actions: ['update'] },
      { address: 'aws_cognito_user_group.g', actions: ['no-op'], importing: 'x/g' },
    );
    expect(mixed.status, mixed.out).toBe(3);
    expect(lines(mixed.stdout), 'only the deletes and replaces are listed').toEqual(
      [line('delete', 'aws_sqs_queue.gone'), line('replace', 'aws_lambda_function.swapped'), line('replace', 'module.config[0].aws_s3_bucket.config_logs')].sort(),
    );
    for (const v of [SECRET, 'x/g']) expect(mixed.out, 'no values printed').not.toContain(v);

    for (const bad of ['{not json', JSON.stringify({ resource_changes: [{ address: 'a.b', change: {} }] })]) {
      const r = gate(['destroys', 'plan.json'], { 'plan.json': bad });
      expect(r.status, `a plan the guard cannot read never counts as "nothing deleted"\n${r.out}`).not.toBe(0);
    }

    // The workflows use it: the unattended dev apply checks before applying, and both gates exist.
    const devApply = jobsIn('dev-apply').filter((f) => runsApply(f.j) && !waitsForEnv(f.w, f.j, 'dev-destroy'));
    expect(devApply.map(where), 'a dev-apply job applies without waiting for anyone').not.toHaveLength(0);
    for (const f of devApply) {
      const d = firstStep(f.j, /tf-gate\.py["']?\s+destroys/);
      expect(d, `${where(f)} runs tf-gate.py destroys`).toBeGreaterThanOrEqual(0);
      expect(d, `${where(f)} checks for deletes before applying`).toBeLessThan(firstApply(f.j));
    }
    const devGate = jobsIn('dev-destroy');
    expect(devGate.map(where), 'a job waits in dev-destroy').not.toHaveLength(0);
    expect(
      jobsIn('dev-apply').some((f) => runsApply(f.j) && waitsForEnv(f.w, f.j, 'dev-destroy')),
      'a dev-apply job applies after the dev-destroy approval',
    ).toBe(true);
    const prodGate = jobsIn('production-destroy');
    expect(prodGate.map(where), 'a job waits in production-destroy').not.toHaveLength(0);
    for (const f of jobsIn('Production')) expect(waitsForEnv(f.w, f.j, 'production-destroy'), `${where(f)} waits for production-destroy`).toBe(true);
    for (const f of [...devGate, ...prodGate]) {
      expect(rolesAssumed(f.w, f.j), `${where(f)} is an approval gate: it signs in to nothing`).toEqual([]);
      expect(runsApply(f.j), `${where(f)} does not apply`).toBe(false);
    }
  });

  test('AC-7 protected resources cannot be deleted: prevent_destroy, AWS deletion protection, a CI check and IAM denies', () => {
    const roots: Record<string, string> = { infra: INFRA, 'talent-flow-infra': TALENT };
    for (const [root, addresses] of Object.entries(PROTECTED)) {
      for (const address of addresses) {
        const found = findResource(roots[root], address);
        expect.soft(found.length, `${root}: ${address} is defined once`).toBe(1);
        if (found.length !== 1) continue;
        expect.soft(lifecycleOf(found[0])?.get('prevent_destroy'), `${root}: ${address} has lifecycle { prevent_destroy = true }`).toBe('true');
      }
    }
    for (const root of [INFRA, TALENT]) {
      const files = tfFilesDeep(root);
      for (const pool of resources(files, 'aws_cognito_user_pool')) {
        expect.soft(attributes(pool.body).get('deletion_protection'), `${rel(pool.file)}: ${pool.labels[1]} deletion_protection`).toBe('"ACTIVE"');
      }
      for (const t of resources(files, 'aws_dynamodb_table')) {
        expect.soft(attributes(t.body).get('deletion_protection_enabled'), `${rel(t.file)}: ${t.labels[1]} deletion_protection_enabled`).toBe('true');
      }
    }
    expect(resources(tfFilesDeep(INFRA), 'aws_dynamodb_table').length + resources(tfFilesDeep(TALENT), 'aws_dynamodb_table').length, 'all 24 tables').toBe(24);

    // The CI check: passes on the repo, fails when a protected kind lacks prevent_destroy, and runs in CI.
    expect(existsSync(PD_CHECK), rel(PD_CHECK)).toBe(true);
    const runCheck = (cwdRoot: string) =>
      spawnSync('python3', ['-I', '-B', join(cwdRoot, 'scripts', 'ci', 'check-prevent-destroy.py')], {
        cwd: cwdRoot,
        encoding: 'utf8',
        timeout: 60_000,
        env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', LANG: 'C.UTF-8' },
      });
    const ok = runCheck(REPO);
    expect(ok.status, `check-prevent-destroy.py passes on the repo\n${ok.stdout}${ok.stderr}`).toBe(0);
    const copy = () => {
      const dir = mkdtempSync(join(tmpdir(), 'ops05-pd-'));
      cpSync(PD_CHECK, join(dir, 'scripts', 'ci', 'check-prevent-destroy.py'), { recursive: true });
      for (const d of ['infra', 'talent-flow-infra']) {
        cpSync(join(REPO, d), join(dir, d), { recursive: true, filter: (src) => !src.includes(`${d}/.terraform`) });
      }
      return dir;
    };
    // A protected table loses its lifecycle block.
    {
      const dir = copy();
      const file = findResource(join(dir, 'infra'), 'aws_dynamodb_table.employees')[0]?.file;
      expect(file, 'employees table found in the copy').toBeTruthy();
      const src = readFileSync(file, 'utf8');
      const stripped = stripComments(src);
      const blk = blocksIn(stripped, 'resource').find((b) => b.labels[0] === 'aws_dynamodb_table' && b.labels[1] === 'employees')!;
      const start = stripped.indexOf(blk.raw);
      const cut = blk.raw.replace(/prevent_destroy\s*=\s*true/, 'prevent_destroy = false');
      writeFileSync(file, src.slice(0, start) + cut + src.slice(start + blk.raw.length));
      const r = runCheck(dir);
      expect(r.status, `prevent_destroy = false on employees fails the check\n${r.stdout}${r.stderr}`).not.toBe(0);
      expect(`${r.stdout}${r.stderr}`, 'and names it').toContain('employees');
    }
    // A new table, bucket, key or pool without one.
    for (const [type, extra] of [
      ['aws_dynamodb_table', 'hash_key = "id"'],
      ['aws_s3_bucket', 'bucket = "ops05-new"'],
      ['aws_kms_key', 'description = "ops05"'],
      ['aws_cognito_user_pool', 'name = "ops05"'],
    ]) {
      const dir = copy();
      writeFileSync(join(dir, 'talent-flow-infra', 'zz-ops05-new.tf'), `resource "${type}" "ops05_new_one" {\n  ${extra}\n}\n`);
      const r = runCheck(dir);
      expect.soft(r.status, `a new ${type} without prevent_destroy fails the check\n${r.stdout}${r.stderr}`).not.toBe(0);
      expect.soft(`${r.stdout}${r.stderr}`, `and names it (${type})`).toContain('ops05_new_one');
    }
    expect(loadWorkflows().some((w) => w.text.includes('check-prevent-destroy.py')), 'a workflow runs check-prevent-destroy.py').toBe(true);

    // IAM: both apply roles are denied the delete calls on the protected resources and the state buckets.
    for (const p of policies()) {
      const a = p.acct;
      const arn = (svc: string, res: string) => `arn:aws:${svc}:${REGION}:${a}:${res}`;
      expectDecision(p, { action: 'cognito-idp:DeleteUserPool', resource: arn('cognito-idp', 'userpool/af-south-1_Fake123') }, 'denied');
      for (const t of [...PROTECTED['infra'], ...PROTECTED['talent-flow-infra']].filter((x) => x.startsWith('aws_dynamodb_table.'))) {
        expectDecision(p, { action: 'dynamodb:DeleteTable', resource: arn('dynamodb', `table/${t.split('.')[1]}`) }, 'denied');
      }
      const buckets = [
        a === PROD ? 'document-ocr-verification-uploads' : `pepla-dev-document-uploads-${a}`,
        `naleko-audit-archive-${a}`,
        `naleko-config-logs-${a}`,
        `talent-flow-audit-archive-${a}`,
        STATE[a],
      ];
      for (const b of buckets) expectDecision(p, { action: 's3:DeleteBucket', resource: `arn:aws:s3:::${b}` }, 'denied');
      for (const action of ['s3:PutBucketPolicy', 's3:DeleteBucketPolicy', 's3:PutBucketVersioning']) {
        expectDecision(p, { action, resource: `arn:aws:s3:::${STATE[a]}` }, 'denied');
      }
      for (const key of STATE_KEYS) expectDecision(p, { action: 's3:DeleteObjectVersion', resource: `arn:aws:s3:::${STATE[a]}/${key}` }, 'denied');
      for (const action of ['kms:ScheduleKeyDeletion', 'kms:DisableKey']) {
        expectDecision(p, { action, resource: arn('kms', 'key/1234abcd-12ab-34cd-56ef-1234567890ab') }, 'denied');
      }
      for (const s of ['naleko/agent/api-key-AbCdEf', 'talent-flow/agent/api-key-AbCdEf']) {
        expectDecision(p, { action: 'secretsmanager:DeleteSecret', resource: arn('secretsmanager', `secret:${s}`) }, 'denied');
      }
    }
  });

  test('AC-8 least privilege: both apply roles share one policy that allows the stacks and denies everything else listed', () => {
    // One shared policy, used by both roles, nothing broader attached.
    expect(existsSync(POLICY_TPL), rel(POLICY_TPL)).toBe(true);
    const modFiles = tfFilesDeep(dirname(POLICY_TPL));
    expect(modFiles.map((f) => readFileSync(f, 'utf8')).join('\n'), 'the module renders policy.json.tftpl with templatefile()').toMatch(
      /templatefile\([^)]*policy\.json\.tftpl/,
    );
    for (const [dir, roleName] of [
      [BOOT_DEV, 'pepla-github-tf-apply-dev'],
      [BOOT_PROD, 'pepla-github-tf-apply-prod'],
    ] as const) {
      const files = tfFiles(dir);
      const mods = blocks(files, 'module').filter((m) => /modules\/tf-apply-policy"$/.test(attributes(m.body).get('source') ?? ''));
      expect(mods.length, `${rel(dir)} uses the shared module bootstrap/modules/tf-apply-policy`).toBeGreaterThan(0);
      const role = resources(files, 'aws_iam_role').filter((b) => attributes(b.body).get('name') === `"${roleName}"`);
      expect(role.length, `${rel(dir)} defines aws_iam_role "${roleName}"`).toBe(1);
      const ref = `aws_iam_role.${role[0]?.labels[1]}`;
      expect(attributes(role[0]?.body ?? '').has('managed_policy_arns'), `${roleName}: no managed_policy_arns`).toBe(false);
      const attached = resources(files, 'aws_iam_role_policy_attachment').filter((b) => b.body.includes(ref));
      for (const b of attached) {
        expect(attributes(b.body).get('policy_arn') ?? '', `${roleName}: only the shared policy is attached`).toMatch(/^module\./);
      }
      const inline = resources(files, 'aws_iam_role_policy').filter((b) => b.body.includes(ref));
      for (const b of inline) expect(b.body, `${roleName}: an inline policy may only add Deny statements`).not.toMatch(/Effect\s*=\s*"Allow"/);
    }

    const ps = policies();
    expect(unknownOperators(ps.map((p) => p.policy)), 'every condition in the policy is one the checks understand').toEqual([]);

    for (const p of ps) {
      const a = p.acct;
      const arn = (svc: string, res: string, region = REGION) => `arn:aws:${svc}:${region}:${a}:${res}`;
      const role = (n: string) => `arn:aws:iam::${a}:role/${n}`;
      const table = arn('dynamodb', 'table/employees');
      const fn = arn('lambda', 'function:getEmployee');
      const pool = arn('cognito-idp', 'userpool/af-south-1_Fake123');
      const docs = a === PROD ? 'document-ocr-verification-uploads' : `pepla-dev-document-uploads-${a}`;
      const workload = 'naleko-getEmployee-role';

      // --- what it must be able to do (so a deny-everything policy cannot pass)
      for (const key of STATE_KEYS) {
        for (const action of ['s3:GetObject', 's3:PutObject']) expectDecision(p, { action, resource: `arn:aws:s3:::${STATE[a]}/${key}` }, 'allowed');
        for (const action of ['s3:GetObject', 's3:PutObject', 's3:DeleteObject']) expectDecision(p, { action, resource: `arn:aws:s3:::${STATE[a]}/${key}.tflock` }, 'allowed');
      }
      expectDecision(p, { action: 's3:ListBucket', resource: `arn:aws:s3:::${STATE[a]}` }, 'allowed');
      for (const action of ['dynamodb:CreateTable', 'dynamodb:UpdateTable', 'dynamodb:DescribeTable', 'dynamodb:UpdateTimeToLive', 'dynamodb:TagResource']) {
        expectDecision(p, { action, resource: table }, 'allowed');
      }
      for (const action of ['lambda:CreateFunction', 'lambda:UpdateFunctionConfiguration', 'lambda:AddPermission', 'lambda:GetFunction']) {
        expectDecision(p, { action, resource: fn }, 'allowed');
      }
      for (const action of ['cognito-idp:UpdateUserPool', 'cognito-idp:CreateGroup', 'cognito-idp:DescribeUserPool']) expectDecision(p, { action, resource: pool }, 'allowed');
      expectDecision(p, { action: 's3:PutBucketVersioning', resource: `arn:aws:s3:::${docs}` }, 'allowed');
      expectDecision(p, { action: 'kms:Decrypt', resource: arn('kms', 'key/1234abcd-12ab-34cd-56ef-1234567890ab'), context: { 'kms:ViaService': `secretsmanager.${REGION}.amazonaws.com` } }, 'allowed');
      for (const action of ['secretsmanager:PutSecretValue', 'secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret']) {
        expectDecision(p, { action, resource: arn('secretsmanager', 'secret:naleko/agent/api-key-AbCdEf') }, 'allowed');
      }
      expectDecision(p, { action: 'ssm:GetParameter', resource: arn('ssm', 'parameter/naleko/postmark/api_token') }, 'allowed');
      expectDecision(p, { action: 'budgets:ModifyBudget', resource: `arn:aws:budgets::${a}:budget/pepla-ai-spend` }, 'allowed');
      expectDecision(p, { action: 'iam:CreatePolicyVersion', resource: `arn:aws:iam::${a}:policy/pepla-ai-brake` }, 'allowed');
      for (const action of ['iam:CreateRole', 'iam:PutRolePolicy', 'iam:UpdateAssumeRolePolicy', 'iam:DeleteRolePolicy', 'iam:TagRole', 'iam:DeleteRole']) {
        expectDecision(p, { action, resource: role(workload) }, 'allowed');
      }
      expectDecision(p, { action: 'iam:AttachRolePolicy', resource: role(workload), context: { 'iam:PolicyARN': 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' } }, 'allowed');
      expectDecision(p, { action: 'iam:PassRole', resource: role(workload), context: { 'iam:PassedToService': 'lambda.amazonaws.com' } }, 'allowed');
      expectDecision(p, { action: 'iam:GetRole', resource: role('pepla-github-tf-apply-prod') }, 'allowed');

      // Every workload role Terraform defines matches a name the role may manage.
      for (const root of [INFRA, TALENT]) {
        const { names, unresolved } = roleNames(root);
        expect(unresolved, `${rel(root)}: every aws_iam_role name can be read from the code`).toEqual([]);
        for (const n of names) {
          expect.soft(CI_ROLE_NAMES.includes(n) || n === 'talent-flow-role-github-deploy', `${rel(root)} no longer defines CI role ${n}`).toBe(false);
          expectDecision(p, { action: 'iam:CreateRole', resource: role(n) }, 'allowed');
          expectDecision(p, { action: 'iam:PutRolePolicy', resource: role(n) }, 'allowed');
        }
      }

      // --- what it must never do
      for (const action of ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:InvokeAgent']) {
        expectDecision(p, { action, resource: `arn:aws:bedrock:${REGION}::foundation-model/any`, context: { 'aws:RequestedRegion': REGION } }, 'explicit-deny');
        expectDecision(p, { action, resource: `arn:aws:bedrock:eu-west-1::foundation-model/any`, context: { 'aws:RequestedRegion': 'eu-west-1' } }, 'explicit-deny');
      }
      for (const action of ['textract:AnalyzeDocument', 'textract:DetectDocumentText', 'textract:StartDocumentAnalysis']) {
        expectDecision(p, { action, resource: '*' }, 'explicit-deny');
      }
      for (const action of ['lambda:InvokeFunction', 'lambda:InvokeFunctionUrl', 'lambda:UpdateFunctionCode']) expectDecision(p, { action, resource: fn }, 'denied');
      for (const action of ['GetItem', 'BatchGetItem', 'Query', 'Scan', 'PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'ExportTableToPointInTime']) {
        expectDecision(p, { action: `dynamodb:${action}`, resource: table }, 'denied');
      }
      for (const action of ['s3:GetObject', 's3:PutObject', 's3:DeleteObject']) {
        expectDecision(p, { action, resource: `arn:aws:s3:::${docs}/employees/123/id.pdf` }, 'denied');
        expectDecision(p, { action, resource: `arn:aws:s3:::naleko-audit-archive-${a}/2026/11/log.json` }, 'denied');
        // Bootstrap state lives in the prod state bucket: never the apply role's to touch.
        expectDecision(p, { action, resource: `arn:aws:s3:::${STATE[PROD]}/bootstrap/prod/terraform.tfstate` }, 'denied');
        expectDecision(p, { action, resource: `arn:aws:s3:::${STATE[PROD]}/bootstrap/pepla-dev/terraform.tfstate` }, 'denied');
      }
      for (const action of ['ListUsers', 'ListUsersInGroup', 'AdminCreateUser', 'AdminDeleteUser', 'AdminGetUser', 'AdminSetUserPassword', 'AdminAddUserToGroup']) {
        expectDecision(p, { action: `cognito-idp:${action}`, resource: pool }, 'denied');
      }
      for (const action of ['iam:CreateUser', 'iam:CreateAccessKey', 'iam:CreateLoginProfile', 'iam:CreateGroup', 'iam:CreateSAMLProvider', 'iam:CreateOpenIDConnectProvider']) {
        expectDecision(p, { action, resource: '*' }, 'explicit-deny');
        expectDecision(p, { action, resource: `arn:aws:iam::${a}:user/ops05` }, 'explicit-deny');
      }
      const protectedRoles = [...CI_ROLE_NAMES.map(role), `arn:aws:iam::${a}:role/aws-service-role/config.amazonaws.com/AWSServiceRoleForConfig`];
      for (const r of protectedRoles) {
        for (const action of ['iam:UpdateAssumeRolePolicy', 'iam:PutRolePolicy', 'iam:DeleteRolePolicy', 'iam:AttachRolePolicy', 'iam:DetachRolePolicy', 'iam:DeleteRole', 'iam:UpdateRole', 'iam:TagRole', 'iam:PutRolePermissionsBoundary', 'iam:DeleteRolePermissionsBoundary']) {
          expectDecision(p, { action, resource: r }, 'explicit-deny');
        }
        expectDecision(p, { action: 'iam:PassRole', resource: r, context: { 'iam:PassedToService': 'lambda.amazonaws.com' } }, 'denied');
      }
      const oidc = `arn:aws:iam::${a}:oidc-provider/token.actions.githubusercontent.com`;
      for (const action of ['iam:DeleteOpenIDConnectProvider', 'iam:UpdateOpenIDConnectProviderThumbprint', 'iam:AddClientIDToOpenIDConnectProvider']) {
        expectDecision(p, { action, resource: oidc }, 'explicit-deny');
      }
      for (const managed of ['AdministratorAccess', 'PowerUserAccess', 'IAMFullAccess', 'AWSOrganizationsFullAccess']) {
        expectDecision(p, { action: 'iam:AttachRolePolicy', resource: role(workload), context: { 'iam:PolicyARN': `arn:aws:iam::aws:policy/${managed}` } }, 'explicit-deny');
      }
      expectDecision(p, { action: 'iam:DetachRolePolicy', resource: role(workload), context: { 'iam:PolicyARN': `arn:aws:iam::${a}:policy/pepla-ai-brake` } }, 'explicit-deny');
      expectDecision(p, { action: 'iam:DeletePolicy', resource: `arn:aws:iam::${a}:policy/pepla-ai-brake` }, 'denied');
      expectDecision(p, { action: 'iam:PassRole', resource: role(workload), context: { 'iam:PassedToService': 'ec2.amazonaws.com' } }, 'denied');
      for (const action of ['budgets:ExecuteBudgetAction', 'budgets:DeleteBudgetAction']) {
        expectDecision(p, { action, resource: `arn:aws:budgets::${a}:budget/pepla-ai-spend/action/1234abcd-12ab-34cd-56ef-1234567890ab` }, 'denied');
      }
      expectDecision(p, { action: 'budgets:DeleteBudget', resource: `arn:aws:budgets::${a}:budget/pepla-ai-spend` }, 'denied');
      for (const action of ['organizations:ListAccounts', 'organizations:LeaveOrganization', 'account:CloseAccount', 'aws-portal:ModifyBilling', 'billing:UpdateBillingPreferences']) {
        expectDecision(p, { action, resource: '*' }, 'denied');
      }
      for (const [action, resource] of [
        ['states:StartExecution', arn('states', 'stateMachine:onboarding')],
        ['sqs:SendMessage', arn('sqs', 'queue')],
        ['sqs:ReceiveMessage', arn('sqs', 'queue')],
        ['sqs:PurgeQueue', arn('sqs', 'queue')],
        ['sns:Publish', arn('sns', 'topic')],
        ['logs:GetLogEvents', arn('logs', 'log-group:/aws/lambda/getEmployee:log-stream:x')],
        ['logs:FilterLogEvents', arn('logs', 'log-group:/aws/lambda/getEmployee')],
        ['logs:StartQuery', arn('logs', 'log-group:/aws/lambda/getEmployee')],
        ['athena:StartQueryExecution', arn('athena', 'workgroup/primary')],
        ['athena:GetQueryResults', arn('athena', 'workgroup/primary')],
        ['glue:StartCrawler', arn('glue', 'crawler/audit')],
        ['secretsmanager:GetSecretValue', arn('secretsmanager', 'secret:pepla-dev/e2e/hr-AbCdEf')],
        ['secretsmanager:PutSecretValue', arn('secretsmanager', 'secret:pepla-dev/e2e/hr-AbCdEf')],
        ['ssm:GetParameter', arn('ssm', 'parameter/ops05/not-read-by-terraform')],
        ['kms:Decrypt', arn('kms', 'key/1234abcd-12ab-34cd-56ef-1234567890ab')],
      ] as const) {
        expectDecision(p, { action, resource }, 'denied');
      }
      // Outside af-south-1 (IAM, STS and Budgets are global), and outside its own account.
      for (const [action, resource, region] of [
        ['lambda:CreateFunction', `arn:aws:lambda:eu-west-1:${a}:function:x`, 'eu-west-1'],
        ['dynamodb:CreateTable', `arn:aws:dynamodb:us-east-1:${a}:table/x`, 'us-east-1'],
        ['s3:CreateBucket', 'arn:aws:s3:::ops05-somewhere-else', 'us-east-1'],
        ['cognito-idp:CreateUserPool', `arn:aws:cognito-idp:eu-west-1:${a}:userpool/*`, 'eu-west-1'],
      ] as const) {
        expectDecision(p, { action, resource, context: { 'aws:RequestedRegion': region } }, 'denied');
      }
      const other = a === DEV ? PROD : DEV;
      expectDecision(p, { action: 'dynamodb:CreateTable', resource: `arn:aws:dynamodb:${REGION}:${other}:table/x` }, 'denied');
      expectDecision(p, { action: 'iam:CreateRole', resource: `arn:aws:iam::${other}:role/${workload}` }, 'denied');
      expectDecision(p, { action: 's3:PutObject', resource: `arn:aws:s3:::${STATE[other]}/${STATE_KEYS[0]}` }, 'denied');
    }
  });

  test('AC-9 only the right jobs can use the roles: trust names one GitHub environment, in both subject forms', () => {
    const want = (envs: string[]) => SUBJECT_FORMS.flatMap((f) => envs.map((e) => `${f}:environment:${e}`)).sort();
    const cases: { dir: string; role: string; required: string[]; allowed: string[] }[] = [
      { dir: BOOT_DEV, role: 'pepla-github-tf-apply-dev', required: want(['dev-apply']), allowed: want(['dev-apply']) },
      { dir: BOOT_PROD, role: 'pepla-github-tf-apply-prod', required: want(['Production']), allowed: want(['Production', 'production']) },
      {
        dir: BOOT_PROD,
        role: 'naleko-github-plan-readonly',
        required: [...want(['prod-plan', 'drift-check']), ...SUBJECT_FORMS.map((f) => `${f}:pull_request`)].sort(),
        allowed: [...want(['prod-plan', 'drift-check']), ...SUBJECT_FORMS.map((f) => `${f}:pull_request`)].sort(),
      },
      { dir: BOOT_PROD, role: 'pepla-github-deploy-code-prod', required: want(['Production']), allowed: want(['Production', 'production']) },
    ];
    for (const c of cases) {
      const t = trustSubjects(c.dir, c.role);
      expect.soft(t.found, `${rel(c.dir)} defines aws_iam_role "${c.role}"`).toBe(true);
      if (!t.found) continue;
      for (const s of c.required) expect.soft(t.subjects, `${c.role} trusts ${s}`).toContain(s);
      expect.soft(t.subjects.filter((s) => !c.allowed.includes(s)), `${c.role} trusts nothing else`).toEqual([]);
      expect.soft(t.subjects.filter((s) => /[*?]/.test(s)), `${c.role}: no wildcard subjects`).toEqual([]);
      expect.soft(t.text, `${c.role}: audience is sts.amazonaws.com`).toMatch(/"token\.actions\.githubusercontent\.com:aud"\s*=\s*"sts\.amazonaws\.com"/);
      expect.soft(t.text, `${c.role}: assumed through GitHub OIDC only`).toContain('sts:AssumeRoleWithWebIdentity');
      expect.soft(t.text, `${c.role}: no AWS principal can assume it`).not.toMatch(/\bAWS\s*=/);
    }
    // The jobs that use each role run in those environments only.
    for (const f of allJobs()) {
      const roles = rolesAssumed(f.w, f.j);
      if (roles.includes(ROLE_DEV)) expect.soft(f.j.environment, `${where(f)} uses the dev apply role`).toBe('dev-apply');
      if (roles.includes(ROLE_PROD)) expect.soft(sameEnv(f.j.environment, 'Production'), `${where(f)} uses the prod apply role`).toBe(true);
    }
  });

  test('AC-10 one apply at a time per environment: a concurrency group that never cancels a running apply', () => {
    const appliers = allJobs().filter((f) => runsApply(f.j));
    expect(appliers.map(where), 'jobs that apply').not.toHaveLength(0);
    const groups = new Map<string, Set<string>>();
    for (const f of appliers) {
      const c = f.j.concurrency ?? f.w.concurrency;
      expect(c?.group ?? '', `${where(f)} sits in a concurrency group`).not.toBe('');
      expect(c?.cancel.trim(), `${where(f)}: cancel-in-progress is false`).toBe('false');
      expect(f.w.concurrency?.cancel.trim() ?? 'false', `${f.w.file}: workflow concurrency never cancels`).toBe('false');
      expect(c?.group ?? '', `${where(f)}: one group per environment, not per run`).not.toMatch(/run_id|run_number|run_attempt|github\.sha|github\.event\.after/);
      const env = f.j.environment.toLowerCase();
      groups.set(env, (groups.get(env) ?? new Set()).add(c?.group ?? ''));
    }
    for (const [env, g] of groups) expect([...g], `every apply in ${env} shares one concurrency group`).toHaveLength(1);
    expect([...groups.keys()].sort(), 'applies run in dev-apply and Production only').toEqual(['dev-apply', 'production']);
  });

  test('AC-11 nothing secret in public logs: no plan files leave the runner, plan output never printed, files removed always', () => {
    const tfJobs = allJobs().filter((f) => /\bterraform\b/.test(f.j.text));
    expect(tfJobs.filter((f) => runsApply(f.j)).map(where), 'jobs that apply').not.toHaveLength(0);
    for (const f of allJobs()) {
      for (const s of f.j.steps) {
        if (/actions\/(upload-artifact|cache)/.test(s.uses)) {
          expect(s.with['path'] ?? '', `${where(f)}: "${s.name || s.uses}" uploads no plan, plan output or state`).not.toMatch(
            /\.tfplan|plan\.(bin|json|log|err|out|txt)|\.tfstate|plan-?\w*\.json|\bplan\b[^/\n]*$/m,
          );
        }
      }
    }
    for (const w of loadWorkflows()) {
      expect(w.text, `${w.file}: no TF_LOG (debug logs print values)`).not.toMatch(/\bTF_LOG\b/);
      expect(w.text, `${w.file}: the budget email never reaches a workflow`).not.toContain('budget_alert_email');
    }
    for (const f of tfJobs) {
      const runs = f.j.steps.map((s) => s.run).join('\n');
      for (const l of commandLines(runs, /\bterraform\b[^\n]*\b(plan|apply)\b/)) {
        if (/\bterraform\s+(fmt|validate|init|version)\b/.test(l)) continue;
        expect.soft(l, `${where(f)}: "${l.trim()}" keeps its output off the log (redirected to a file)`).toMatch(/>\s*\S/);
      }
      for (const l of commandLines(runs, /\bterraform\b[^\n]*\bshow\b/)) {
        expect.soft(l, `${where(f)}: "${l.trim()}" is JSON for the guard, never printed as is`).toMatch(/-json/);
        expect.soft(l, `${where(f)}: "${l.trim()}" goes to a file or a pipe`).toMatch(/[|>]/);
      }
      const outs = [...runs.matchAll(/-out[= ]["']?([^\s"';]+)/g)].map((m) => m[1].replace(/^.*\//, ''));
      if (outs.length) {
        const cleanup = f.j.steps.filter((s) => /^\s*always\(\)\s*$|\$\{\{\s*always\(\)\s*\}\}/.test(s.if) && /\brm\b/.test(s.run));
        expect.soft(cleanup.length, `${where(f)} has an if: always() step that removes the plan files`).toBeGreaterThan(0);
        const cleanupText = cleanup.map((s) => s.run).join('\n');
        for (const o of outs) {
          const base = o.replace(/\$\{\{[^}]*\}\}|\$\{?\w+\}?/g, '');
          expect.soft(cleanupText.includes(base) || cleanupText.includes('*'), `${where(f)}: the always() step removes ${o}`).toBe(true);
        }
      }
    }
    // The guard prints addresses, actions and attribute names, never a value, on any command.
    const p = plan(
      { address: 'aws_secretsmanager_secret_version.agent_api_key', actions: ['update'], before: { secret_string: SECRET }, after: { secret_string: `${SECRET}x` } },
      { address: 'aws_lambda_function.x', actions: ['delete', 'create'], before: { environment: [{ variables: { K: SECRET } }] }, after: { environment: [{ variables: { K: SECRET2 } }] } },
    );
    for (const args of [['list', 'plan.json'], ['destroys', 'plan.json'], ['summary', 'infra', 'plan.json']]) {
      const r = gate(args, { 'plan.json': p });
      expect(r.status, `tf-gate.py ${args[0]} ran\n${r.out}`).not.toBe(-1);
      for (const v of [SECRET, SECRET2]) expect(r.out, `tf-gate.py ${args[0]} prints no value`).not.toContain(v);
    }
  });

  test('AC-12 a failed apply opens or updates one issue per environment and the next success closes it', () => {
    const files = [...new Set([...jobsIn('dev-apply'), ...jobsIn('Production')].map((f) => f.w))];
    expect(files.map((w) => w.file), 'workflows that apply').not.toHaveLength(0);
    const text = files.map((w) => w.text).join('\n');
    for (const title of ['Terraform apply failed: dev', 'Terraform apply failed: prod']) expect(text, `issue title "${title}"`).toContain(title);
    expect(text, 'opens an issue').toMatch(/gh issue create|issues\.create|\/issues\b/);
    expect(text, 'adds to the open one instead of a second issue').toMatch(/gh issue (comment|edit)|createComment|issues\.update/);
    expect(text, 'closes it after a good apply').toMatch(/gh issue close|state:\s*['"]?closed/);
    expect(text, 'runs on failure').toMatch(/failure\(\)|\.result\s*==\s*'failure'/);
    expect(text, 'may write issues').toMatch(/issues:\s*write/);
    expect(text, 'no automatic retry').not.toMatch(/nick-fields\/retry|retry-on|max_attempts/);
  });

  test('AC-13 the kill switch: unless TF_AUTO_APPLY is exactly "true", nothing applies and the summary says so', () => {
    const appliers = allJobs().filter((f) => runsApply(f.j));
    expect(appliers.map(where), 'jobs that apply').not.toHaveLength(0);
    for (const f of appliers) {
      for (const s of f.j.steps.filter((x) => commandLines(x.run, APPLY).length)) {
        const ifs = `${f.j.if}\n${s.if}`;
        const viaIf = /vars\.TF_AUTO_APPLY\s*==\s*'true'/.test(ifs);
        const envName = Object.entries({ ...f.w.env, ...s.env }).find(([, v]) => /vars\.TF_AUTO_APPLY/.test(v))?.[0];
        const viaScript = !!envName && new RegExp(`"\\$\\{?${envName}\\}?"\\s*!?==?\\s*"?true"?`).test(s.run);
        expect(viaIf || viaScript, `${where(f)}: "${s.name || 'apply step'}" runs only when TF_AUTO_APPLY is exactly "true"`).toBe(true);
      }
      expect(`${f.w.text}`, `${f.w.file}: never treats anything but "true" as on`).not.toMatch(/TF_AUTO_APPLY\s*!=\s*'false'|TF_AUTO_APPLY\s*!=\s*''/);
    }
    for (const w of new Set(appliers.map((f) => f.w))) expect(w.text, `${w.file} says "Applies are switched off"`).toContain('Applies are switched off');
  });

  test('AC-14 no paid AI: the apply pipeline calls no model and the AI guard check still passes', () => {
    const r = spawnSync('python3', [join(REPO, 'scripts', 'ci', 'check-ai-guard.py')], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
    expect(r.status, `check-ai-guard.py passes\n${r.stdout}${r.stderr}`).toBe(0);

    const pipeline = [...new Set([...jobsIn('dev-apply'), ...jobsIn('Production'), ...jobsIn('prod-plan'), ...jobsIn('dev-destroy'), ...jobsIn('production-destroy')].map((f) => f.w))];
    expect(pipeline.map((w) => w.file), 'the apply pipeline exists').not.toHaveLength(0);
    for (const w of pipeline) {
      expect(w.text, `${w.file} calls no AI service or AI action`).not.toMatch(/bedrock|textract|anthropic|openai|claude|gemini|copilot|\bllm\b/i);
      expect(w.text, `${w.file} sets no AI_CALLS_ENABLED`).not.toContain('AI_CALLS_ENABLED');
    }
    for (const script of [GATE, PD_CHECK]) {
      const src = readText(script);
      expect(src, `${rel(script)} exists`).not.toBe('');
      expect(src, `${rel(script)} makes no network calls`).not.toMatch(/^\s*(import|from)\s+(urllib|http|requests|socket|boto3|botocore|anthropic|openai)\b/m);
    }
  });

  test('AC-15 the CI roles are owned in one place: bootstrap/prod adopts them, talent-flow-infra lets go, the old role goes', () => {
    const files = tfFiles(BOOT_PROD);
    expect(files.length, 'bootstrap/prod exists').toBeGreaterThan(0);
    const backend = files.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
    expect(backend, 'bootstrap/prod state: bucket naleko-tfstate-af-south-1').toMatch(/bucket\s*=\s*"naleko-tfstate-af-south-1"/);
    expect(backend, 'bootstrap/prod state: key bootstrap/prod/terraform.tfstate').toMatch(/key\s*=\s*"bootstrap\/prod\/terraform\.tfstate"/);

    const imports = blocks(files, 'import').map((b) => attributes(b.body));
    const importTo = (re: RegExp) => imports.filter((a) => re.test(a.get('to') ?? ''));
    expect(importTo(/^aws_iam_openid_connect_provider\./), 'imports the GitHub OIDC provider').toHaveLength(1);
    expect(
      importTo(/^aws_iam_openid_connect_provider\./)[0]?.get('id') ?? '',
      'by its ARN',
    ).toContain('oidc-provider/token.actions.githubusercontent.com');
    const roleImports = importTo(/^aws_iam_role\./).map((a) => a.get('id') ?? '');
    expect(roleImports, 'imports the plan role').toContain('"naleko-github-plan-readonly"');
    expect(roleImports, 'imports the code-deploy role').toContain('"pepla-github-deploy-code-prod"');
    expect(roleImports, 'does not import the old talent-flow deploy role').not.toContain('"talent-flow-role-github-deploy"');
    expect(importTo(/^aws_iam_role_policy\./).length, 'imports the two roles\' inline policies').toBeGreaterThanOrEqual(2);

    // talent-flow-infra lets go without destroying, and defines none of them any more.
    const tf = tfFiles(TALENT);
    const removed = blocks(tf, 'removed').map((b) => ({ from: attributes(b.body).get('from') ?? '', destroy: blocksIn(b.body, 'lifecycle').map((l) => attributes(l.body).get('destroy'))[0] }));
    for (const addr of [
      'aws_iam_openid_connect_provider.github',
      'aws_iam_role.github_plan_readonly',
      'aws_iam_role_policy.github_plan_readonly',
      'aws_iam_role_policy_attachment.github_plan_readonly_managed',
      'aws_iam_role.github_code_deploy',
      'aws_iam_role_policy.github_code_deploy',
    ]) {
      const r = removed.filter((x) => x.from === addr);
      expect.soft(r, `talent-flow-infra: removed { from = ${addr} } with lifecycle { destroy = false }`).toHaveLength(1);
      expect.soft(r[0]?.destroy, `${addr}: destroy = false`).toBe('false');
      const [type, name] = addr.split('.');
      expect.soft(resources(tf, type).filter((b) => b.labels[1] === name), `talent-flow-infra no longer defines ${addr}`).toHaveLength(0);
    }
    // The old role is deleted (Iggie, 13 Nov): gone from code, and not kept by a destroy = false.
    for (const name of ['talent_flow_github_deploy']) {
      expect(resources(tf, 'aws_iam_role').filter((b) => b.labels[1] === name), 'talent-flow-infra no longer defines the old deploy role').toHaveLength(0);
      expect(resources(tf, 'aws_iam_role_policy').filter((b) => b.labels[1] === name), 'nor its policy').toHaveLength(0);
      expect(removed.filter((x) => x.from.endsWith(`.${name}`) && x.destroy === 'false'), 'and does not keep it with destroy = false').toEqual([]);
    }
    const everywhere = [...tfFilesDeep(join(REPO, 'bootstrap')), ...tfFilesDeep(INFRA), ...tf].map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(everywhere, 'no Terraform defines talent-flow-role-github-deploy any more').not.toMatch(/name\s*=\s*"talent-flow-role-github-deploy"/);

    // The nightly drift check plans bootstrap/prod too.
    const drift = loadWorkflow('drift-check.yml');
    expect(drift.text, 'drift-check.yml plans bootstrap/prod').toMatch(/root:\s*bootstrap\/prod|bootstrap\/prod/);
  });
});
