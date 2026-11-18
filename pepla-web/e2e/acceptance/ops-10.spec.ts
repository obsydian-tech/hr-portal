import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ON_DEV } from './support/fixtures';
import { WORKFLOWS, commentStep, jobs, runResultComment, starts, workflow } from './support/ops-02-workflows';

/**
 * OPS-10 · "App tests on dev" runs after the merge, not on every pull request.
 * Spec: /mnt/project-files/onboarding-cards/specs/OPS-10.md
 *
 * The card changes one GitHub workflow (app-e2e-dev.yml), so these tests read
 * the workflow files, the same way ops-02.spec.ts does (support/ops-02-workflows.ts).
 *
 *   AC-1  nothing starts it before merge (no pull_request trigger, no caller on a PR)
 *   AC-2  every after-merge start is unchanged (push to develop, Monday, by hand, after the deploy)
 *   AC-3  the after-merge result still reaches the merged PR, same names and same comment
 *   AC-4  it stays out of the required checks: no pull request workflow runs or waits for it
 *
 * OPS-02 AC-3 (ops-02.spec.ts) was re-locked as ops-02.4 for this card: its
 * pull_request lines for this workflow moved here as AC-1. Nothing else of
 * OPS-02, OPS-06, OPS-07 or OPS-08 changed.
 *
 * They run once, in the desktop-1280 project (no page is opened), in the
 * no-backend run only. Nothing here calls GitHub, AWS or any AI service.
 *
 * These files are locked once accepted: see ./README.md.
 */

const APP_TESTS = 'app-e2e-dev.yml';
const DEPLOY = 'deploy-lambdas.yml';

// app-e2e-dev.yml at develop 542797c: the after-merge starts this card must not touch.
const PUSH_PATHS = [
  'hr-portal/src/**',
  'hr-portal/angular.json',
  'hr-portal/package.json',
  'hr-portal/package-lock.json',
  'hr-portal/tsconfig*.json',
  'pepla-web/**',
  'scripts/ci/dev-frontend-env.sh',
  'scripts/ci/check-dev-signin.py',
  '.github/workflows/app-e2e-dev.yml',
  '!**/*.md',
  '!docs/**',
  '!pepla-web/help/media/**',
];
const MONDAY = '0 3 * * 1';
const WORKFLOW_NAME = 'App tests on dev';
const JOB_NAME = 'App E2E on pepla-dev';

const APP_FILE = 'pepla-web/src/app/app.ts';

/** Every workflow file with its parsed `on` block. */
function allWorkflows(): { file: string; wf: ReturnType<typeof workflow> }[] {
  return readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((file) => ({ file, wf: workflow(file) }));
}

/** Whether a workflow starts on a pull request event of any kind. */
function runsOnPullRequest(on: Record<string, unknown> | string | string[] | undefined): boolean {
  if (on == null) return false;
  if (typeof on === 'string') return /^pull_request/.test(on);
  if (Array.isArray(on)) return on.some((e) => /^pull_request/.test(e));
  return Object.keys(on).some((e) => /^pull_request/.test(e));
}

test.describe('OPS-10 App tests on dev run after the merge only', () => {
  test.beforeEach(({}, info) => {
    test.skip(ON_DEV, 'workflow checks run in the no-backend run only');
    test.skip(info.project.name !== 'desktop-1280', 'workflow checks run once, in desktop-1280');
  });

  test('AC-1 Nothing starts it before merge: no pull request trigger, and no changed file on a PR starts it', () => {
    const on = workflow(APP_TESTS).on ?? {};
    expect(Object.keys(on).filter((e) => /^pull_request/.test(e)), `${APP_TESTS} listens to no pull_request event (pull_request, pull_request_target, pull_request_review ...)`).toEqual([]);
    for (const [what, files] of Object.entries({
      'a change in the new app': [APP_FILE],
      'a change in the current app': ['hr-portal/src/app/app.ts'],
      'the new app entry point with a doc beside it': ['pepla-web/README.md', 'pepla-web/src/main.ts'],
      'this workflow file itself': ['.github/workflows/app-e2e-dev.yml'],
    })) {
      expect(() => starts(APP_TESTS, 'pull_request', files), `${what}: a PR cannot start "${WORKFLOW_NAME}"`).toThrow(/no pull_request trigger/);
    }
  });

  test('AC-2 Every after-merge start is unchanged: push to develop with the same files, Monday, by hand, after the deploy', () => {
    const on = workflow(APP_TESTS).on ?? {};

    expect(on.push?.branches, 'a push to develop, and only develop').toEqual(['develop']);
    expect(on.push?.paths, 'with the same file filter as before').toEqual(PUSH_PATHS);
    for (const [what, files] of Object.entries({
      'an app change': [APP_FILE],
      'the new app entry point with a doc beside it': ['pepla-web/README.md', 'pepla-web/src/main.ts'],
      'a current app change': ['hr-portal/src/app/app.ts'],
      'two app files': ['pepla-web/src/app/onboarding/invite-list.ts', 'pepla-web/src/styles.css'],
      'this workflow file': ['.github/workflows/app-e2e-dev.yml'],
    })) {
      expect(starts(APP_TESTS, 'push', files), `${what} merged into develop starts the run`).toBe(true);
    }
    for (const [what, files] of Object.entries({
      'a README in the new app': ['pepla-web/README.md'],
      'a help picture': ['pepla-web/help/media/sign-in/01-sign-in-page-desktop.png'],
      'a page under docs/': ['docs/onboarding/flow.md'],
    })) {
      expect(starts(APP_TESTS, 'push', files), `${what} merged into develop starts nothing`).toBe(false);
    }

    expect(on.schedule, 'the Monday 05:00 SAST full run stays').toEqual([{ cron: MONDAY }]);
    expect(on, 'a run by hand stays').toHaveProperty('workflow_dispatch');
    const call = on.workflow_call;
    expect(call, 'Deploy Lambdas can still call it').toBeTruthy();
    expect(Object.keys(call?.inputs ?? {}).sort(), 'with its two inputs').toEqual(['full', 'on_web_address']);

    const callers = Object.entries(jobs(DEPLOY)).filter(([, j]) => /^\.\/\.github\/workflows\/app-e2e-dev\.yml$/.test(String(j.uses ?? '')));
    expect(callers.length, 'Deploy Lambdas calls it once, after the deploy').toBe(1);
  });

  test('AC-3 The after-merge result still reaches the merged PR: same names, same step, same comment', () => {
    const wf = workflow(APP_TESTS);
    expect(wf.name, 'the workflow keeps its name').toBe(WORKFLOW_NAME);
    expect(Object.values(jobs(APP_TESTS)).map((j) => j.name), 'its jobs keep their names, so the check keeps reporting under the same name').toContain(JOB_NAME);

    const { step } = commentStep();
    expect(String(step.if ?? ''), 'the comment step still runs after a push (and still when the tests failed)').toMatch(/always\(\)/);
    expect(String(step.if ?? ''), 'for push events').toMatch(/event_name\s*==\s*'push'/);

    const comment = runResultComment({ event: 'push', files: [APP_FILE], newApp: 'success', newAppResults: true });
    expect(comment.body, 'the comment says it is the after-merge run').toMatch(/after merge into develop/i);
    expect(comment.body, 'and carries its own marker, so a re-run updates it').toContain('<!-- app-e2e-dev:push -->');
    expect(comment.body, 'and has the table of results').toMatch(/\| Journey \| Test \| Size \| Result \| Time \|/);
    const failed = runResultComment({ event: 'push', files: [APP_FILE], newApp: 'failure', newAppResults: true });
    expect(failed.body, 'a failed after-merge run still says so on the PR').toMatch(/tests failed/);
  });

  test('AC-4 It stays out of the required checks: no pull request workflow runs it, calls it or waits for it', () => {
    const offenders: string[] = [];
    for (const { file, wf } of allWorkflows()) {
      if (file === APP_TESTS) continue;
      const touches = JSON.stringify(wf.jobs ?? {});
      const callsIt = Object.values(wf.jobs ?? {}).some((j: { uses?: string }) => /app-e2e-dev\.ya?ml/.test(String(j.uses ?? '')));
      const namesIt = touches.includes(JOB_NAME) || touches.includes(WORKFLOW_NAME);
      if (runsOnPullRequest(wf.on) && (callsIt || namesIt)) offenders.push(file);
    }
    expect(offenders, 'a workflow that starts on a pull request must not call "App tests on dev" or wait for its jobs').toEqual([]);

    const deploy = workflow(DEPLOY).on ?? {};
    expect(runsOnPullRequest(deploy), 'Deploy Lambdas (the only caller) does not start on a pull request').toBe(false);

    // The job that runs the tests is not made a pull request check by a pull_request-only condition either.
    const e2e = Object.values(jobs(APP_TESTS)).find((j) => j.name === JOB_NAME);
    expect(e2e, `the "${JOB_NAME}" job exists`).toBeTruthy();
    expect(e2e.environment, 'it keeps the dev environment (the AWS sign-in is the dev role, as in OPS-02)').toBe('dev');
  });
});
