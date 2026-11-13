import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ON_DEV } from './support/fixtures';
import { REPO, jobs, steps, workflowWithoutComments } from './support/ops-02-workflows';
import {
  APP_TESTS,
  DEPLOY,
  allBlocks,
  byHandRun,
  canCancel,
  concurrencyOf,
  deployCall,
  levels,
  mondayRun,
  prRun,
  pushRun,
  seedingJob,
  workflow,
  type Run,
} from './support/ops-06-concurrency';

/**
 * OPS-06 · After-merge test run can't be bumped from the queue (Jira NH-158).
 * Spec: /mnt/project-files/onboarding-cards/specs/OPS-06.md
 *
 * The card changes how GitHub queues the pepla-dev test runs, so these tests read
 * the workflow files. For sample runs (merges into develop, Deploy Lambdas'
 * after-deploy call, PR pushes, the Monday run, a by-hand run) they work out the
 * concurrency groups each run lands in, with expressions evaluated, and apply
 * GitHub's queue rules (support/ops-06-concurrency.ts) to answer "can this later
 * run cancel that earlier one?".
 *
 * What a file cannot show is proved on real runs, as the card's table says:
 * throwaway draft PRs D and E for AC-1, AC-2 and AC-3 before merge, GitHub
 * accepting the `queue` key (a validation error shows on the run page), and the
 * first merges after OPS-06 for AC-1 and AC-4.
 *
 * AC-1 to AC-5 fail on today's develop. AC-6 holds today; its test keeps it true.
 *
 * They run once, in the desktop-1280 project (no page is opened), in the
 * no-backend run only. Nothing here calls GitHub, AWS or any AI service.
 *
 * These files are locked once accepted: see ./README.md.
 */

const LOCK = 'pepla-dev-e2e';
const DEV_ROLE = 'arn:aws:iam::424556617428:role/pepla-github-deploy-dev';

const M1 = '1'.repeat(40);
const M2 = '2'.repeat(40);

/** Sample runs, in the order they join the queue. */
function busyAfternoon() {
  const pushM1 = pushRun('after-merge push run of merge 1', M1);
  const callM1 = deployCall("Deploy Lambdas' test job for merge 1", M1);
  const prD1 = prRun('draft PR D, first push', 401, 'ops/ops-06-try-d', 'd1'.repeat(20));
  const prE1 = prRun('draft PR E, first push', 402, 'ops/ops-06-try-e', 'e1'.repeat(20));
  const prOps = prRun('the OPS-06 PR', 400, 'ops/ops-06-dev-queue', 'f1'.repeat(20));
  const monday = mondayRun('Monday run');
  const byHand = byHandRun('by-hand run');
  const prD2 = prRun('draft PR D, second push', 401, 'ops/ops-06-try-d', 'd2'.repeat(20));
  const pushM2 = pushRun('after-merge push run of merge 2', M2);
  const callM2 = deployCall("Deploy Lambdas' test job for merge 2", M2);
  return { pushM1, callM1, prD1, prE1, prOps, monday, byHand, prD2, pushM2, callM2 };
}

function sameRunFamily(a: Run, b: Run): boolean {
  return a.kind === 'pr' && b.kind === 'pr' && a.pr === b.pr;
}

function describeCancel(earlier: Run, later: Run, all: Run[]): string | null {
  const c = canCancel(earlier, later, all);
  return c ? `${later.label} ${c.how} ${earlier.label} (group "${c.group}" in ${c.where})` : null;
}

test.describe('OPS-06 After-merge test run is never bumped from the pepla-dev queue', () => {
  test.beforeEach(({}, info) => {
    test.skip(ON_DEV, 'workflow checks run in the no-backend run only');
    test.skip(info.project.name !== 'desktop-1280', 'workflow checks run once, in desktop-1280');
  });

  test('AC-1 After-merge run is never bumped: no later run cancels it, and the after-deploy call cannot block itself', () => {
    const r = busyAfternoon();
    const all = Object.values(r);
    const afterMerge = [r.pushM1, r.callM1];
    const later = [r.prD1, r.prE1, r.prOps, r.monday, r.byHand, r.prD2];
    const problems: string[] = [];
    for (const x of afterMerge) for (const y of later) {
      const p = describeCancel(x, y, all);
      if (p) problems.push(p);
    }
    expect(problems, 'an after-merge run waiting for pepla-dev is cancelled by nothing that joins later').toEqual([]);

    // Deploy Lambdas calls app-e2e-dev.yml; the called workflow sees the caller's
    // github context. If a group the call needs is one the caller already holds,
    // the call waits for itself and the after-merge run never finishes.
    const deploy = workflow(DEPLOY);
    const caller = Object.entries(deploy.jobs ?? {}).find(([, j]: [string, any]) => /app-e2e-dev\.yml$/.test(String(j.uses ?? '')));
    expect(caller, 'Deploy Lambdas still calls app-e2e-dev.yml after the deploy').toBeTruthy();
    const held = [concurrencyOf(deploy.concurrency, r.callM1, DEPLOY), concurrencyOf((caller![1] as any).concurrency, r.callM1, 'caller job')]
      .filter((b) => b !== null)
      .map((b) => b!.group.toLowerCase());
    const app = workflow(APP_TESTS);
    const [, job] = seedingJob();
    const needed = [concurrencyOf(app.concurrency, r.callM1, APP_TESTS), concurrencyOf(job.concurrency, r.callM1, 'seeding job')]
      .filter((b) => b !== null)
      .map((b) => b!.group.toLowerCase());
    expect(needed.filter((g) => held.includes(g)), 'the called tests need no group that Deploy Lambdas already holds').toEqual([]);
    expect(new Set(needed).size, 'the called workflow and its job use different groups').toBe(needed.length);
  });

  test('AC-2 PR runs wait, not drop: a third PR joining cancels neither the running nor the waiting PR run', () => {
    const r = busyAfternoon();
    const all = Object.values(r);
    // D holds pepla-dev, E waits, then the OPS-06 PR joins. The Monday and
    // by-hand runs queue the same way.
    const order = [r.prD1, r.prE1, r.prOps, r.monday, r.byHand];
    const problems: string[] = [];
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
      const p = describeCancel(order[i], order[j], all);
      if (p) problems.push(p);
    }
    for (const y of [r.pushM1, r.callM1, r.pushM2, r.callM2]) for (const x of [r.prD1, r.prE1, r.prOps]) {
      const p = describeCancel(x, y, all);
      if (p) problems.push(p);
    }
    expect(problems, 'no run cancels a different PR’s run, or a Monday or by-hand run').toEqual([]);
  });

  test("AC-3 Stale commits of the same PR are dropped: a new push cancels that PR's older run, waiting or running, and nothing else", () => {
    const r = busyAfternoon();
    const all = Object.values(r);
    const c = canCancel(r.prD1, r.prD2, all);
    expect(c?.how, `${r.prD2.label} cancels ${r.prD1.label} whether it is waiting or already running`).toBe('cancels');

    const untouched = [r.pushM1, r.callM1, r.prE1, r.prOps, r.monday, r.byHand];
    const problems = untouched.map((x) => describeCancel(x, r.prD2, all)).filter((p) => p !== null);
    expect(problems, `${r.prD2.label} cancels no other PR's run and no develop, Monday or by-hand run`).toEqual([]);

    // A PR from another branch with the same number cannot exist, but two PRs
    // from branches with similar names must still be told apart.
    const twin = prRun('a PR whose branch name starts the same', 403, 'ops/ops-06-try-d-2', 'aa'.repeat(20));
    expect(describeCancel(r.prD1, twin, [...all, twin]), 'PRs are told apart by PR, not by a branch name prefix').toBeNull();
  });

  test('AC-4 Two merges, two runs: the second merge cancels none of the first merge’s runs', () => {
    const r = busyAfternoon();
    const all = Object.values(r);
    const first = [r.pushM1, r.callM1];
    const second = [r.pushM2, r.callM2];
    const problems: string[] = [];
    for (const x of first) for (const y of second) {
      const p = describeCancel(x, y, all);
      if (p) problems.push(p);
    }
    // Also within one merge: its push run and the Deploy Lambdas call.
    for (const [x, y] of [[r.pushM1, r.callM1], [r.pushM2, r.callM2]]) {
      const p = describeCancel(x, y, all);
      if (p) problems.push(p);
    }
    expect(problems, 'each merge commit keeps its own run').toEqual([]);
    for (const run of [...first, ...second]) {
      expect(sameRunFamily(run, r.pushM1), 'after-merge runs are never treated as one PR').toBe(false);
    }
  });

  test(`AC-5 Still one at a time: every "${LOCK}" group has queue: max and cancel-in-progress: false, and every run takes it`, () => {
    const r = busyAfternoon();
    const all = Object.values(r);

    const [key, job] = seedingJob();
    const raw = job.concurrency;
    expect(typeof raw === 'object' && raw !== null, `${APP_TESTS} job ${key} has a concurrency block`).toBe(true);
    expect(raw.group, `${APP_TESTS} job ${key}: the group name is "${LOCK}", written out (no expression)`).toBe(LOCK);
    expect(raw['cancel-in-progress'], `${APP_TESTS} job ${key}: cancel-in-progress: false`).toBe(false);
    expect(raw.queue, `${APP_TESTS} job ${key}: queue: max`).toBe('max');

    for (const run of all) {
      const groups = levels(run).map((b) => b.group.toLowerCase());
      expect(groups, `${run.label} takes the "${LOCK}" lock`).toContain(LOCK);
    }

    const problems: string[] = [];
    for (const block of allBlocks()) {
      if (block.raw !== null && typeof block.raw === 'object' && 'queue' in block.raw && !['single', 'max'].includes(String(block.raw.queue))) {
        problems.push(`${block.where}: queue is "${block.raw.queue}" (GitHub knows single and max)`);
      }
      for (const run of all) {
        let b;
        try {
          b = concurrencyOf(block.raw, run, block.where);
        } catch (e) {
          if (block.file === APP_TESTS || block.file === DEPLOY) throw e;
          continue; // other workflows may use contexts these sample runs do not fill
        }
        if (!b) continue;
        if (b.queue === 'max' && b.cancel) problems.push(`${block.where} (${run.label}): queue: max with cancel-in-progress true is a GitHub validation error`);
        if (b.group.toLowerCase() !== LOCK) continue;
        if (b.queue !== 'max') problems.push(`${block.where} (${run.label}): "${LOCK}" without queue: max`);
        if (b.cancel) problems.push(`${block.where} (${run.label}): "${LOCK}" with cancel-in-progress true`);
        if (block.raw['cancel-in-progress'] !== false) problems.push(`${block.where}: "${LOCK}" must say cancel-in-progress: false`);
      }
    }
    expect([...new Set(problems)], `every "${LOCK}" group is the same: queue: max, cancel-in-progress: false`).toEqual([]);

    const seeders = Object.entries(workflow(DEPLOY).jobs ?? {}).filter(([, j]: [string, any]) =>
      (j.steps ?? []).some((s: { run?: string }) => /seed-dev\.py|playwright test|e2e:acceptance/.test(s.run ?? '')),
    );
    expect(seeders.map(([k]) => k), 'Deploy Lambdas seeds and tests pepla-dev only through app-e2e-dev.yml').toEqual([]);
  });

  test('AC-6 Nothing reaches paid AI: no AI service, no new role, secret or outside URL; the AI guard still runs', () => {
    for (const file of [APP_TESTS, DEPLOY]) {
      const text = workflowWithoutComments(file);
      expect(text, `${file} names no AI service outside comments`).not.toMatch(/bedrock|textract|anthropic|openai|claude|gemini/i);
      expect(text, `${file} reads no secrets`).not.toMatch(/secrets\.|secrets:\s*inherit|"secrets":/);
      const urls = [...text.matchAll(/https?:\/\/[^\s"'\\)]+/g)].map((m) => m[0]);
      expect(urls.filter((u) => !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(u)), `${file} calls no outside URL`).toEqual([]);
      for (const { job, step } of steps(file)) {
        const role = step.with?.['role-to-assume'];
        if (role !== undefined) expect(role, `${file} ${job}: only the existing pepla-dev deploy role`).toBe(DEV_ROLE);
      }
    }
    for (const [key, j] of Object.entries(jobs(DEPLOY))) {
      if (/app-e2e-dev\.yml$/.test(String(j.uses ?? ''))) {
        expect(j.secrets, `${key} passes no secrets to the called tests`).toBeUndefined();
      }
    }

    const build = Object.values(jobs(DEPLOY)).find((j) => (j.steps ?? []).some((s: { run?: string }) => /build-lambdas\.py/.test(s.run ?? '')));
    expect(build, 'Deploy Lambdas still builds the bundles').toBeTruthy();
    const runs: string[] = (build.steps ?? []).map((s: { run?: string }) => s.run ?? '');
    const guard = runs.findIndex((x) => /check-ai-guard\.py/.test(x));
    expect(guard, 'check-ai-guard.py still runs in Deploy Lambdas').toBeGreaterThanOrEqual(0);
    expect(guard, 'before the build').toBeLessThan(runs.findIndex((x) => /build-lambdas\.py/.test(x)));

    expect(readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8'), 'test logins stay robots').toMatch(/ROBOT_GROUP\s*=\s*"e2e-robots"/);
    const currentBlock = join(REPO, 'hr-portal', 'e2e', 'fixtures', 'no-ai.ts');
    expect(existsSync(currentBlock) && /context\.route\(/.test(readFileSync(currentBlock, 'utf8')), 'the current app still blocks AI routes').toBe(true);
    const newBlock = readFileSync(join(REPO, 'pepla-web', 'e2e', 'acceptance', 'support', 'fixtures.ts'), 'utf8');
    expect(newBlock, 'the new app still blocks AI routes').toMatch(/context\.route\(\(url\) => AI_URLS/);
  });
});
