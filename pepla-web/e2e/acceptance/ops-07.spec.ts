import { expect, test } from '@playwright/test';
import { ON_DEV } from './support/fixtures';
import {
  DEPLOY,
  TF,
  allJobs,
  baseline,
  baselineJobs,
  baselineText,
  current,
  currentText,
  deploysOrSignsIn,
  job,
  newJobs,
  runs,
  simulate,
  story,
  terraformCall,
  type Scenario,
  type Sim,
} from './support/ops-07-runs';

/**
 * OPS-07 · Code-only merges still deploy and test on pepla-dev (Jira NH-160).
 * Spec: /mnt/project-files/onboarding-cards/specs/OPS-07.md
 *
 * The card changes when jobs of "Deploy Lambdas" (deploy-lambdas.yml) and the
 * Terraform workflow it calls (terraform-apply.yml) run, so these tests read the
 * two workflow files and play sample merges through them with GitHub's rules
 * (support/ops-07-runs.ts): which jobs run, which are skipped, which wait for an
 * approval, and how the run ends. A job added by the card is not taken on
 * trust: its steps are executed, so its own logic decides how it ends.
 *
 * The model was checked against run 43500695798 (#312, 13 Nov): with today's
 * files, a Lambda-only merge skips every Terraform job, the call, the deploy and
 * the tests. AC-1 asserts that reading before it asserts the fix.
 *
 * AC-1 and AC-2 fail on develop at d2ee800. AC-3 to AC-7 hold today; their tests
 * keep them true. The OPS-02, OPS-05 and OPS-06 checks must keep passing.
 *
 * What a file cannot show is checked on real runs after the merge, as the card's
 * table says: the OPS-07 merge itself (Terraform plus code), then the next
 * Lambda-only merge.
 *
 * They run once, in the desktop-1280 project (no page is opened), in the
 * no-backend run only. Nothing here calls GitHub, AWS or any AI service.
 *
 * These files are locked once accepted: see ./README.md.
 */

const DEV_DEPLOY_ROLE = 'arn:aws:iam::424556617428:role/pepla-github-deploy-dev';

const codeOnly: Scenario = { label: 'Lambda-only merge into develop', branch: 'develop', infra: 'false', lambda: 'true' };

function explain(sim: Sim): string {
  return `\n--- how the sample run went ---\n${story(sim)}`;
}

/** The whole Deploy Lambdas run, as a person sees it on the Actions page. */
function runEnd(sim: Sim): string {
  const all = Object.values(sim.jobs).map((j) => j.result);
  if (all.includes('failure')) return 'failure';
  if (all.includes('cancelled')) return 'cancelled';
  return 'success';
}

test.describe('OPS-07 Code-only merges still deploy and test on pepla-dev', () => {
  test.beforeEach(({}, info) => {
    test.skip(ON_DEV, 'workflow checks run in the no-backend run only');
    test.skip(info.project.name !== 'desktop-1280', 'workflow checks run once, in desktop-1280');
  });

  test('AC-1 Code-only merge deploys: infra=false, lambda=true and a good build reach "Deploy to pepla-dev"', () => {
    // The model reads today's problem the way run 43500695798 showed it.
    const before = simulate(codeOnly, 'baseline');
    expect(terraformCall(before).result, `at d2ee800 the Terraform call is skipped on a Lambda-only merge${explain(before)}`).toBe('skipped');
    expect(job(before, 'deploy-dev').result, 'at d2ee800 the deploy is skipped').toBe('skipped');

    const sim = simulate(codeOnly);
    const call = terraformCall(sim);
    expect(call.result, `the Terraform call ends success, not skipped, when nothing in Terraform changed${explain(sim)}`).toBe('success');
    expect(job(sim, 'build').result).toBe('success');
    const deploy = job(sim, 'deploy-dev');
    expect(deploy.result, `"Deploy to pepla-dev" runs${explain(sim)}`).toBe('success');

    // Out of scope: a code-only merge still skips the pepla-dev plan, as today.
    expect(job(sim, 'tf-dev').result, 'a code-only merge does not start a pepla-dev Terraform plan').toBe('skipped');
    const signedIn = allJobs(sim).filter((j) => j.file === TF && runs(j) && current(TF).jobs[j.id]?.environment);
    expect(signedIn.map((j) => j.id), 'no Terraform job with an environment runs on a code-only merge').toEqual([]);

    // It deploys the bundles this run built, with the dev deploy role.
    const wf = current(DEPLOY);
    const steps: any[] = wf.jobs['deploy-dev'].steps ?? [];
    const upload = (wf.jobs.build.steps ?? []).find((s: any) => /actions\/upload-artifact@/.test(s.uses ?? ''));
    const download = steps.find((s: any) => /actions\/download-artifact@/.test(s.uses ?? ''));
    expect(upload?.with?.name, 'the build uploads the bundles').toBeTruthy();
    expect(download?.with?.name, 'the deploy downloads the bundles this run built').toBe(upload?.with?.name);
    expect(steps.some((s: any) => s.with?.['role-to-assume'] === DEV_DEPLOY_ROLE), 'the deploy signs in with the pepla-dev deploy role').toBe(true);
    expect(steps.some((s: any) => /scripts\/ci\/deploy-lambdas\.sh\s+dist\/lambdas/.test(s.run ?? '')), 'the deploy runs deploy-lambdas.sh on the bundles').toBe(true);
  });

  test('AC-2 Code-only merge is tested: "E2E on pepla-dev" runs after the deploy and posts on the merged PR', () => {
    const sim = simulate(codeOnly);
    const e2e = job(sim, 'e2e-dev');
    expect(e2e.result, `"E2E on pepla-dev" runs on a Lambda-only merge${explain(sim)}`).toBe('success');
    expect(e2e.ancestors, 'the tests wait for the deploy').toContain('deploy-dev');
    const wf = current(DEPLOY).jobs['e2e-dev'];
    expect(String(wf.uses), 'the tests are the shared pepla-dev run (seed, journeys, comment on the merged PR)').toMatch(/^\.\/\.github\/workflows\/app-e2e-dev\.yml$/);
    expect(String(wf.with?.full), 'every journey runs, not only the changed ones').toBe('true');
    expect(wf.permissions?.['pull-requests'], 'the call may comment on the merged PR').toBe('write');
  });

  test('AC-3 A failed or refused dev apply still stops everything: no deploy, no tests, run not green', () => {
    const tfMerge = { branch: 'develop', infra: 'true', lambda: 'true' } as const;
    const cases: Scenario[] = [
      { ...tfMerge, label: 'pepla-dev plan or apply fails', results: { 'tf-dev': 'failure' } },
      {
        ...tfMerge,
        label: 'delete refused in dev-destroy',
        outputs: { 'tf-dev': { destroys: 'true', applied: 'false' } },
        results: { 'tf-dev-delete-gate': 'failure' },
      },
      {
        ...tfMerge,
        label: 'delete approved, apply after approval fails',
        outputs: { 'tf-dev': { destroys: 'true', applied: 'false' } },
        results: { 'tf-dev-after-approval': 'failure' },
      },
      { ...tfMerge, label: 'pepla-dev Terraform job cancelled', results: { 'tf-dev': 'cancelled' } },
      {
        ...tfMerge,
        label: 'apply after approval cancelled',
        outputs: { 'tf-dev': { destroys: 'true', applied: 'false' } },
        results: { 'tf-dev-after-approval': 'cancelled' },
      },
    ];
    const problems: string[] = [];
    for (const c of cases) {
      const sim = simulate(c);
      const call = terraformCall(sim).result;
      const cancelled = /cancelled/.test(c.label);
      const want = cancelled ? ['failure', 'cancelled'] : ['failure'];
      if (!want.includes(call)) problems.push(`${c.label}: the Terraform call ends ${call}, expected ${want.join(' or ')}${explain(sim)}`);
      for (const id of ['deploy-dev', 'e2e-dev']) {
        const r = job(sim, id).result;
        if (r !== 'skipped') problems.push(`${c.label}: ${id} is ${r}, expected skipped${explain(sim)}`);
      }
      for (const j of allJobs(sim)) {
        const def = (j.file === TF ? current(TF) : current(DEPLOY)).jobs[j.id];
        if (runs(j) && JSON.stringify(def ?? {}).includes('deploy-lambdas.sh') && j.id !== 'release') problems.push(`${c.label}: ${j.file} ${j.id} deploys Lambda code`);
      }
      const end = runEnd(sim);
      if (!(cancelled ? ['failure', 'cancelled'] : ['failure']).includes(end)) problems.push(`${c.label}: the run ends ${end}, expected red${explain(sim)}`);
    }
    expect(problems, 'a failed, refused or cancelled pepla-dev apply stops the deploy and the tests').toEqual([]);
  });

  test('AC-4 Deletes still wait: while the delete approval is pending, nothing deploys', () => {
    const deletes = { branch: 'develop', infra: 'true', lambda: 'true', outputs: { 'tf-dev': { destroys: 'true', applied: 'false' } } } as const;
    const deploysCode = (sim: Sim) =>
      allJobs(sim).filter((j) => {
        const def = (j.file === TF ? current(TF) : current(DEPLOY)).jobs[j.id] ?? {};
        const t = JSON.stringify(def);
        return (t.includes('deploy-lambdas.sh') || t.includes('pepla-github-deploy-dev')) && j.id !== 'release';
      });

    const problems: string[] = [];
    for (const [label, results] of [
      ['approval pending', { 'tf-dev-delete-gate': 'pending' }],
      ['approved, apply after approval still running', { 'tf-dev-after-approval': 'pending' }],
    ] as const) {
      const sim = simulate({ ...deletes, label, results: { ...results } });
      for (const j of deploysCode(sim)) {
        if (j.result !== 'waiting' && j.result !== 'skipped') problems.push(`${label}: ${j.file} ${j.id} is ${j.result} before the delete is approved and applied${explain(sim)}`);
      }
      if (job(sim, 'e2e-dev').result !== 'waiting' && job(sim, 'e2e-dev').result !== 'skipped') problems.push(`${label}: the tests start${explain(sim)}`);
    }
    expect(problems, 'nothing that deploys starts while a delete waits for Iggie').toEqual([]);

    // Once approved and applied, the deploy follows the apply.
    const done = simulate({ ...deletes, label: 'approved and applied' });
    expect(job(done, 'tf-dev-after-approval').result, `the apply after approval runs${explain(done)}`).toBe('success');
    expect(job(done, 'deploy-dev').result, `the deploy runs after the approved apply${explain(done)}`).toBe('success');
    expect(job(done, 'deploy-dev').ancestors, 'the deploy needs the Terraform call').toContain(terraformCall(done).id);
  });

  test('AC-5 Terraform-plus-code merges unchanged: apply, then deploy, then tests', () => {
    const sim = simulate({ label: 'Terraform plus code, clean apply', branch: 'develop', infra: 'true', lambda: 'true' });
    expect(job(sim, 'tf-dev').result, 'the pepla-dev plan and apply run').toBe('success');
    expect(terraformCall(sim).result, `the Terraform call succeeds${explain(sim)}`).toBe('success');
    const deploy = job(sim, 'deploy-dev');
    const e2e = job(sim, 'e2e-dev');
    expect(deploy.result, `the deploy runs${explain(sim)}`).toBe('success');
    expect(deploy.ancestors, 'the deploy waits for the Terraform call (apply first)').toContain(terraformCall(sim).id);
    expect(e2e.result, `the tests run${explain(sim)}`).toBe('success');
    expect(e2e.ancestors, 'the tests wait for the deploy').toContain('deploy-dev');

    // Every Terraform-plus-code merge ends the way it does at d2ee800, the kill
    // switch (plans only) included.
    const same: Scenario[] = [
      { label: 'clean apply', branch: 'develop', infra: 'true', lambda: 'true' },
      { label: 'Terraform only, clean apply', branch: 'develop', infra: 'true', lambda: 'false' },
      { label: 'plans only (TF_AUTO_APPLY off), no deletes', branch: 'develop', infra: 'true', lambda: 'true', vars: { TF_AUTO_APPLY: 'false' } },
      {
        label: 'plans only (TF_AUTO_APPLY off), plan has deletes',
        branch: 'develop', infra: 'true', lambda: 'true', vars: { TF_AUTO_APPLY: 'false' },
        outputs: { 'tf-dev': { destroys: 'true', applied: 'false' } },
      },
      { label: 'deletes approved and applied', branch: 'develop', infra: 'true', lambda: 'true', outputs: { 'tf-dev': { destroys: 'true', applied: 'false' } } },
    ];
    const problems: string[] = [];
    for (const c of same) {
      const was = simulate(c, 'baseline');
      const now = simulate(c);
      for (const id of ['tf-dev', 'tf-dev-delete-gate', 'tf-dev-after-approval', 'deploy-dev', 'e2e-dev']) {
        if (job(now, id).result !== job(was, id).result) problems.push(`${c.label}: ${id} is ${job(now, id).result}, at d2ee800 ${job(was, id).result}${explain(now)}`);
      }
      if (terraformCall(now).result !== terraformCall(was).result) problems.push(`${c.label}: the Terraform call ends ${terraformCall(now).result}, at d2ee800 ${terraformCall(was).result}${explain(now)}`);
    }
    expect(problems, 'merges that change Terraform behave as before').toEqual([]);
  });

  test('AC-6 Prod path unchanged: main jobs, environments, roles and the Approve stay as at d2ee800', () => {
    const was = baseline(TF).jobs;
    const now = current(TF).jobs;
    const mainJobs = Object.keys(was).filter((id) => /refs\/heads\/main|prod-plan|needs\.release/.test(JSON.stringify(was[id].if ?? '')) || /^prod-|^release$|^report-prod$/.test(id));
    expect(mainJobs.sort(), 'the main path at d2ee800').toEqual(['prod-delete-gate', 'prod-plan', 'release', 'report-prod']);
    const roles = (j: any) => (j?.steps ?? []).map((s: any) => s.with?.['role-to-assume']).filter(Boolean);
    const problems: string[] = [];
    for (const id of mainJobs) {
      if (!now[id]) { problems.push(`${id} is gone`); continue; }
      for (const key of ['if', 'environment', 'needs', 'permissions', 'concurrency']) {
        if (JSON.stringify(now[id][key] ?? null) !== JSON.stringify(was[id][key] ?? null)) problems.push(`${id}: ${key} changed`);
      }
      if (JSON.stringify(roles(now[id])) !== JSON.stringify(roles(was[id]))) problems.push(`${id}: AWS roles changed`);
      if (JSON.stringify(now[id].steps) !== JSON.stringify(was[id].steps)) problems.push(`${id}: steps changed`);
    }
    expect(problems, 'every main-path job is as it was').toEqual([]);

    // Sample releases end exactly as they do at d2ee800.
    const release = (o: Record<string, string>) => ({ 'prod-plan': { release: 'true', destroys: 'false', code: 'true', ...o } });
    const mains: Scenario[] = [
      { label: 'Lambda-only release', branch: 'main', infra: 'false', lambda: 'true', outputs: release({}) },
      { label: 'release with prod deletes', branch: 'main', infra: 'true', lambda: 'true', outputs: release({ destroys: 'true' }) },
      { label: 'nothing to release', branch: 'main', infra: 'false', lambda: 'false', outputs: release({ release: 'false', code: 'false' }) },
      { label: 'release apply fails', branch: 'main', infra: 'true', lambda: 'true', outputs: release({}), results: { release: 'failure' } },
      { label: 'Approve still pending', branch: 'main', infra: 'false', lambda: 'true', outputs: release({}), results: { release: 'pending' } },
      { label: 'prod deletes refused', branch: 'main', infra: 'true', lambda: 'true', outputs: release({ destroys: 'true' }), results: { 'prod-delete-gate': 'failure' } },
    ];
    for (const c of mains) {
      const a = simulate(c, 'baseline');
      const b = simulate(c);
      for (const j of allJobs(a)) {
        const r = job(b, j.id).result;
        if (r !== j.result) problems.push(`${c.label}: ${j.file} ${j.id} is ${r}, at d2ee800 ${j.result}${explain(b)}`);
      }
      if (terraformCall(b).result !== terraformCall(a).result) problems.push(`${c.label}: the Terraform call ends ${terraformCall(b).result}, at d2ee800 ${terraformCall(a).result}`);
      for (const j of allJobs(b).filter((x) => !baselineJobs(x.file).includes(x.id) && runs(x))) {
        const def = current(j.file).jobs[j.id];
        if (def.environment || deploysOrSignsIn(def)) problems.push(`${c.label}: new job ${j.file} ${j.id} runs on main with an environment or AWS sign-in`);
        if (j.result === 'failure') problems.push(`${c.label}: new job ${j.file} ${j.id} fails on main${explain(b)}`);
      }
    }
    const lambdaOnly = simulate(mains[0]);
    expect(job(lambdaOnly, 'release').result, 'a Lambda-only release still reaches the Approve').toBe('success');
    expect(now.release.environment, 'the release runs in Production (Iggie\'s Approve)').toBe('Production');
    expect(now['prod-delete-gate'].environment, 'prod deletes still need production-destroy').toBe('production-destroy');
    expect(problems, 'main runs end as before').toEqual([]);
  });

  test('AC-7 Nothing new reaches AWS or paid AI: new jobs sign in to nothing; the AI guard still runs', () => {
    const problems: string[] = [];
    for (const file of [TF, DEPLOY]) {
      for (const id of newJobs(file)) {
        const j = current(file).jobs[id];
        const text = JSON.stringify(j);
        if (j.environment) problems.push(`${file} ${id} has environment ${JSON.stringify(j.environment)}`);
        if (/id-token/.test(JSON.stringify(j.permissions ?? {}))) problems.push(`${file} ${id} asks for id-token`);
        if (/\bsecrets\./.test(text)) problems.push(`${file} ${id} reads a secret`);
        if (deploysOrSignsIn(j)) problems.push(`${file} ${id} signs in to AWS or deploys`);
        if (/\baws\s|boto|bedrock|textract|anthropic|openai|invoke-?model|\bclaude\b/i.test(text)) problems.push(`${file} ${id} has a step that names AWS or a model service`);
        if (typeof j.uses === 'string') problems.push(`${file} ${id} calls another workflow`);
        for (const s of j.steps ?? []) {
          if (typeof s.uses === 'string' && !/^actions\/checkout@/.test(s.uses)) problems.push(`${file} ${id} uses ${s.uses}`);
        }
      }
      const words = /bedrock|textract|anthropic/gi;
      const was = (baselineText(file).match(words) ?? []).length;
      const now = (currentText(file).match(words) ?? []).length;
      if (now > was) problems.push(`${file} now names bedrock, textract or anthropic ${now} times (${was} at d2ee800)`);
    }
    expect(problems, 'new jobs need nothing from AWS or any model').toEqual([]);

    const build: any[] = current(DEPLOY).jobs.build?.steps ?? [];
    const guard = build.findIndex((s) => /python3 scripts\/ci\/check-ai-guard\.py/.test(s.run ?? ''));
    const make = build.findIndex((s) => /scripts\/ci\/build-lambdas\.py/.test(s.run ?? ''));
    expect(guard, 'the build still runs check-ai-guard.py').toBeGreaterThanOrEqual(0);
    expect(guard, 'the AI guard runs before the bundles are built').toBeLessThan(make);
    expect(build[guard]?.if ?? '', 'the AI guard is not made conditional').toBe('');
    expect(build[guard]?.['continue-on-error'] ?? false, 'a failed AI guard fails the build').toBe(false);
  });
});
