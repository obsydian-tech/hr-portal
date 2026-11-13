import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ON_DEV } from './support/fixtures';
import {
  REPO,
  commentStep,
  jobs,
  runResultComment,
  sampleTests,
  starts,
  steps,
  table,
  workflow,
  workflowWithoutComments,
  type Comment,
  type Event,
} from './support/ops-02-workflows';

/**
 * OPS-02 · Dev test run starts after app-only merges (Jira NH-152).
 * Spec: /mnt/project-files/onboarding-cards/specs/OPS-02.md
 * (https://claude.ai/artifact/RcgsQNdSreMKuSwNJp76BZ).
 *
 * The card changes GitHub workflows, so these tests check the workflow files
 * themselves, written from the card before the change:
 *   - which changes start which workflow, using GitHub's path filter rules
 *     (support/ops-02-workflows.ts, starts());
 *   - the PR comment, by running the real "post results" github-script step of
 *     app-e2e-dev.yml on sample Playwright results (support/ops-02/*.json) with
 *     a fake GitHub API (runResultComment()). The comment must come from that
 *     step, the two results files and the step's env;
 *   - the shape of the deploy-then-test chain and the AI guardrails.
 *
 * What a file cannot show is proved on real runs, as the card's table says:
 * throwaway draft PRs A, B and C for AC-3, the OPS-02 PR's own comment for
 * AC-2, a by-hand Deploy Lambdas run and the first slice merge for AC-4.
 *
 * AC-1 and AC-5 already hold on today's develop; their tests keep them true.
 * AC-2, AC-3 and AC-4 fail until the card is built.
 *
 * They run once, in the desktop-1280 project (no page is opened), in the
 * no-backend run only. Nothing here calls GitHub, AWS or any AI service.
 *
 * These files are locked once accepted: see ./README.md.
 */

const APP_TESTS = 'app-e2e-dev.yml';
const DEPLOY = 'deploy-lambdas.yml';
const RETAKE = 'help-retake.yml';
const CI = 'ci.yml';

const DEV_ROLE = 'arn:aws:iam::424556617428:role/pepla-github-deploy-dev';
const PROD_ROLE = 'arn:aws:iam::937137806477:role/pepla-github-deploy-code-prod';

const APP_FILE = 'pepla-web/src/app/app.ts';
const DOCS_ONLY: Record<string, string[]> = {
  'a README inside the new app (draft PR A)': ['pepla-web/README.md'],
  'one help picture (draft PR B)': ['pepla-web/help/media/sign-in/01-sign-in-page-desktop.png'],
  'a help video': ['pepla-web/help/media/sign-in/hr-signs-in-phone.webm'],
  'the root README': ['README.md'],
  'a page under docs/': ['docs/onboarding/flow.md'],
  'a picture under docs/': ['docs/images/flow.png'],
  'a README inside lambda/': ['lambda/README.md'],
  'a README inside the current app': ['hr-portal/src/README.md'],
  'several docs together': ['pepla-web/README.md', 'docs/a.md', 'pepla-web/help/media/sign-in/02-filled-in-phone.png', 'CHANGELOG.md'],
};

test.describe('OPS-02 Dev test run starts after app-only merges', () => {
  test.beforeEach(({}, info) => {
    test.skip(ON_DEV, 'workflow checks run in the no-backend run only');
    test.skip(info.project.name !== 'desktop-1280', 'workflow checks run once, in desktop-1280');
  });

  test('AC-1 App-only merge starts the run: new app at desktop and phone, current app smoke checks, comment on the PR', () => {
    for (const files of [[APP_FILE], ['pepla-web/src/app/onboarding/invite-list.ts', 'pepla-web/src/styles.css']]) {
      expect(starts(APP_TESTS, 'push', files), `a merge of ${files.join(', ')} starts "App tests on dev"`).toBe(true);
    }

    const all = steps(APP_TESTS).map(({ step }) => step);
    const newApp = all.find((s) => /npm run e2e:acceptance/.test(s.run ?? ''));
    expect(newApp, 'a step runs the new app acceptance tests').toBeTruthy();
    expect(String(newApp?.env?.['ACCEPTANCE_TARGET'] ?? ''), 'against pepla-dev').toBe('pepla-dev');
    expect(String(newApp?.['working-directory'] ?? ''), 'in pepla-web').toMatch(/^pepla-web\/?$/);

    const config = readFileSync(join(REPO, 'pepla-web', 'e2e', 'acceptance', 'playwright.config.ts'), 'utf8');
    expect(config, 'the new app tests run at desktop 1280').toContain("name: 'desktop-1280'");
    expect(config, 'and at phone 390').toContain("name: 'phone-390'");

    const current = all.find((s) => /playwright test --config e2e\/playwright\.config\.ts/.test(s.run ?? ''));
    expect(current, 'a step runs the current app journeys').toBeTruthy();
    expect(all.some((s) => /pick-e2e-tests\.py/.test(s.run ?? '')), 'picked by pick-e2e-tests.py (smoke checks always)').toBe(true);

    const pick = readFileSync(join(REPO, 'scripts', 'ci', 'pick-e2e-tests.py'), 'utf8');
    expect(pick, 'the @smoke set always runs').toMatch(/tags\s*=\s*\{\s*"@smoke"\s*\}/);

    const { step } = commentStep();
    const when = String(step.if ?? '');
    expect(when, 'the comment step runs after merges too').not.toMatch(/event_name\s*==\s*'pull_request'\s*(\)|$)/);
    const comment = runResultComment({ event: 'push', files: [APP_FILE], newApp: 'success', newAppResults: true });
    expect(comment.body, 'the after-merge comment says it is after merge').toMatch(/after merge/i);
  });

  test('AC-2 The comment says what ran: both apps in "Ran", a Size column, no tag in test names, no doubled rows', () => {
    const newTests = sampleTests('new-app-results.json');
    const currentTests = sampleTests('current-app-results.json');
    const cards = [...new Set(newTests.map((t) => t.describe.split(' ')[0]))];
    expect(cards, 'the sample has two cards').toEqual(['ONB-01', 'ONB-02']);

    const runs: { name: string; event: Event; newApp: 'success' | 'failure' | 'skipped'; newAppResults: boolean }[] = [
      { name: 'before merge, new app ran', event: 'pull_request', newApp: 'success', newAppResults: true },
      { name: 'after merge, new app ran with a failure', event: 'push', newApp: 'failure', newAppResults: true },
      { name: 'before merge, new app skipped', event: 'pull_request', newApp: 'skipped', newAppResults: false },
      { name: 'after merge, new app set-up failed', event: 'push', newApp: 'failure', newAppResults: false },
    ];

    for (const run of runs) {
      const c: Comment = runResultComment({ ...run, files: [APP_FILE] });
      const lines = c.body.split('\n').map((l) => l.trim());
      const at = lines.indexOf('Ran:');
      expect(at, `${run.name}: a "Ran:" line`).toBeGreaterThanOrEqual(0);

      const current = lines.find((l) => l.startsWith('- Current app: '));
      expect(current, `${run.name}: the current app line`).toMatch(/^- Current app: .+, picked from the files this change touched\.$/);
      expect(current, `${run.name}: names the picked modules`).toContain('smoke checks');

      const newLine = lines.find((l) => l.startsWith('- New app: '));
      if (run.newAppResults) {
        const m = /^- New app: every test that needs pepla-dev \((.+)\), at desktop and phone\.$/.exec(newLine ?? '');
        expect(m, `${run.name}: the new app line, got "${newLine}"`).toBeTruthy();
        expect(new Set(m![1].split(/,\s*/)), `${run.name}: card ids from the top-level describes`).toEqual(new Set(cards));
      } else {
        expect(newLine, `${run.name}: says the new app did not run`).toBe('- New app: did not run.');
      }
      expect(lines.indexOf(current!), `${run.name}: Current app under Ran`).toBe(at + 1);
      expect(lines.indexOf(newLine!), `${run.name}: New app under it`).toBe(at + 2);
      expect(lines, `${run.name}: Full run every Monday.`).toContain('Full run every Monday.');

      const { header, rows } = table(c.body);
      const size = header.indexOf('Size');
      expect(size, `${run.name}: the table has a Size column, header ${JSON.stringify(header)}`).toBeGreaterThanOrEqual(0);
      for (const r of rows) {
        expect(['Desktop', 'Phone'], `${run.name}: Size of "${r.line}"`).toContain(r.cells[size]);
        expect(r.line, `${run.name}: no test name carries the tag`).not.toContain('@pepla-dev');
      }
      const seen = rows.map((r) => r.line);
      expect(seen.length, `${run.name}: no two rows are identical`).toBe(new Set(seen).size);

      const rowsFor = (title: string, sizeWord: string) =>
        rows.filter((r) => r.cells.includes(title) && r.cells[size] === sizeWord).length;
      for (const t of currentTests) {
        expect(rowsFor(t.title, 'Desktop'), `${run.name}: current app "${t.title}" once, Desktop`).toBe(1);
      }
      for (const t of newTests) {
        const title = t.title.replace(/\s*@pepla-dev\b/g, '').trim();
        const word = t.project === 'phone-390' ? 'Phone' : 'Desktop';
        expect(rowsFor(title, word), `${run.name}: new app "${title}" once, ${word}`).toBe(run.newAppResults ? 1 : 0);
      }
      expect(rows.length, `${run.name}: one row per test and size`).toBe(currentTests.length + (run.newAppResults ? newTests.length : 0));
    }
  });

  test('AC-3 Docs-only changes start nothing; one doc plus one app file still starts the run', () => {
    for (const [what, files] of Object.entries(DOCS_ONLY)) {
      for (const event of ['pull_request', 'push'] as const) {
        expect(starts(APP_TESTS, event, files), `${what}: no "App tests on dev" on ${event}`).toBe(false);
      }
      expect(starts(DEPLOY, 'push', files), `${what}: no "Deploy Lambdas"`).toBe(false);
      expect(starts(RETAKE, 'push', files), `${what}: no "Help pictures retake"`).toBe(false);
      for (const event of ['pull_request', 'push'] as const) {
        expect(starts(CI, event, files), `${what}: the required ci.yml checks still run on ${event}`).toBe(true);
      }
    }

    const mixed = ['pepla-web/README.md', 'pepla-web/src/main.ts'];
    for (const event of ['pull_request', 'push'] as const) {
      expect(starts(APP_TESTS, event, mixed), `one doc and one pepla-web/src file start "App tests on dev" on ${event}`).toBe(true);
    }
    expect(starts(DEPLOY, 'push', ['lambda/README.md', 'lambda/onboarding/index.mjs']), 'a doc and a Lambda file still deploy').toBe(true);
    expect(starts(APP_TESTS, 'pull_request', ['hr-portal/src/app/app.ts']), 'a current app change still starts it').toBe(true);

    const ciOn = workflow(CI).on;
    for (const event of ['pull_request', 'push'] as const) {
      expect(ciOn[event]?.branches ?? [], `ci.yml ${event} covers develop`).toContain('develop');
    }
  });

  test('AC-4 Backend and app together: deploy to pepla-dev first, then one test run that includes the new app', () => {
    const call = workflow(APP_TESTS).on?.workflow_call;
    expect(call, 'app-e2e-dev.yml can be called by another workflow (workflow_call)').toBeTruthy();
    expect(call?.inputs?.full, 'with a "full" input').toBeTruthy();

    for (const files of [['lambda/onboarding/index.mjs', APP_FILE], ['lambda/onboarding/index.mjs']]) {
      expect(starts(DEPLOY, 'push', files), `a merge of ${files.join(', ')} starts Deploy Lambdas`).toBe(true);
    }

    const all = jobs(DEPLOY);
    const deployDev = Object.entries(all).find(
      ([, j]) => (j.steps ?? []).some((s: { run?: string }) => /deploy-lambdas\.sh/.test(s.run ?? '')) && j.environment === 'dev',
    );
    expect(deployDev, 'Deploy Lambdas still has its pepla-dev deploy job').toBeTruthy();
    const [deployDevKey] = deployDev!;

    const callers = Object.entries(all).filter(([, j]) => /^\.\/\.github\/workflows\/app-e2e-dev\.yml$/.test(String(j.uses ?? '')));
    expect(callers.length, 'Deploy Lambdas calls app-e2e-dev.yml exactly once').toBe(1);
    const [, caller] = callers[0];
    const needs: string[] = [caller.needs ?? []].flat();
    expect(needs, 'the call waits for "Deploy to pepla-dev"').toContain(deployDevKey);
    expect(String(caller.if ?? ''), 'the call does not run when the deploy failed').not.toMatch(/always\(\)|failure\(\)|!cancelled\(\)/);
    expect(caller.permissions?.['id-token'], 'the called run gets id-token: write').toBe('write');
    expect(caller.permissions?.['pull-requests'], 'and pull-requests: write for the comment').toBe('write');

    const ownTests = Object.entries(all).filter(([key, j]) =>
      key !== callers[0][0] && (j.steps ?? []).some((s: { run?: string }) => /playwright test|e2e:acceptance|seed-dev\.py/.test(s.run ?? '')),
    );
    expect(ownTests.map(([k]) => k), 'no other Deploy Lambdas job runs its own pepla-dev tests').toEqual([]);
  });

  test('AC-5 Nothing reaches paid AI: no AI service, no new role or secret, the AI guard still runs', () => {
    for (const file of [APP_TESTS, DEPLOY, RETAKE]) {
      expect(workflowWithoutComments(file), `${file} names no AI service outside comments`).not.toMatch(
        /bedrock|textract|anthropic|openai|claude|gemini/i,
      );
      expect(workflowWithoutComments(file), `${file} reads no secrets`).not.toMatch(/secrets\.|secrets:\s*inherit|"secrets":/);
      for (const { job, step } of steps(file)) {
        const role = step.with?.['role-to-assume'];
        if (role === undefined) continue;
        expect([DEV_ROLE, PROD_ROLE], `${file} ${job}: only the existing deploy roles`).toContain(role);
        if (role === PROD_ROLE) {
          const j = jobs(file)[job];
          expect(file, 'the prod role only in Deploy Lambdas').toBe(DEPLOY);
          expect(j.environment, 'behind the production environment').toBe('production');
          expect(String(j.if ?? ''), 'from main only').toContain("refs/heads/main");
        }
      }
    }
    for (const [key, j] of Object.entries(jobs(DEPLOY))) {
      if (String(j.uses ?? '').length) {
        expect(j.secrets, `${key} passes no secrets to the called workflow`).toBeUndefined();
      }
    }

    const build = Object.values(jobs(DEPLOY)).find((j) => (j.steps ?? []).some((s: { run?: string }) => /build-lambdas\.py/.test(s.run ?? '')));
    expect(build, 'Deploy Lambdas still builds the bundles').toBeTruthy();
    const runs: string[] = (build.steps ?? []).map((s: { run?: string }) => s.run ?? '');
    const guard = runs.findIndex((r) => /check-ai-guard\.py/.test(r));
    expect(guard, 'check-ai-guard.py still runs in Deploy Lambdas').toBeGreaterThanOrEqual(0);
    expect(guard, 'before the build').toBeLessThan(runs.findIndex((r) => /build-lambdas\.py/.test(r)));

    expect(readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8'), 'test logins stay robots').toMatch(/ROBOT_GROUP\s*=\s*"e2e-robots"/);
    const currentBlock = join(REPO, 'hr-portal', 'e2e', 'fixtures', 'no-ai.ts');
    expect(existsSync(currentBlock) && /context\.route\(/.test(readFileSync(currentBlock, 'utf8')), 'the current app still blocks AI routes').toBe(true);
    const newBlock = readFileSync(join(REPO, 'pepla-web', 'e2e', 'acceptance', 'support', 'fixtures.ts'), 'utf8');
    expect(newBlock, 'the new app still blocks AI routes').toMatch(/context\.route\(\(url\) => AI_URLS/);
  });
});
