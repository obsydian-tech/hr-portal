import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ON_DEV } from './support/fixtures';
import {
  ACCEPTANCE,
  BASELINE_README,
  BASELINE_WORKFLOW,
  CARDS,
  EXTRA_CARDS,
  LOCKS_TODAY,
  LOCK_WORKFLOW,
  Sandbox,
  TABLE_CARDS,
  cells,
  checkoutStep,
  cleanUp,
  fold,
  lockJob,
  locksLine,
  parseWorkflow,
  type CheckResult,
} from './support/ops-08/lock-check';

/**
 * OPS-08 · One test notes file per card (Jira NH-161).
 * Spec: /mnt/project-files/onboarding-cards/specs/OPS-08.md
 *
 * The card moves each card's notes out of README.md into cards/<card>.md and
 * changes the "Acceptance tests locked" rule (.github/workflows/acceptance-lock.yml):
 * a card file belongs to its own card's locks, and a merge is judged file by file
 * instead of on the whole folder.
 *
 * AC-1 and AC-2 read the files. AC-3, AC-4 and AC-5 take the lock step's script
 * out of the workflow and run it, with bash, against throwaway git repos that
 * have a local bare "origin" holding lock branches and tags
 * (support/ops-08/lock-check.ts). README.b9dda84.txt and acceptance-lock.b9dda84.yml
 * in support/ops-08/ are develop at b9dda84, the day the card was written.
 *
 * AC-1 to AC-4 fail on today's develop. AC-5, AC-6 and AC-7 hold today; their
 * tests keep them true. The AC-6 diff of the PR (no locked test changed) is read
 * on review, since a test cannot see the PR.
 *
 * They run once, in the desktop-1280 project (no page is opened), in the
 * no-backend run only. Only git, bash and python3 are started. Nothing here
 * calls GitHub, AWS or any AI service.
 *
 * These files are locked once accepted: see ./README.md.
 */

const A = 'pepla-web/e2e/acceptance';
const WF = '.github/workflows/acceptance-lock.yml';

/** A small develop: three cards with notes files, two test files, a support file and app code. */
const README_LINES = Array.from({ length: 12 }, (_, i) => `How the folder works, line ${i + 1}.`);
const DEVELOP: Record<string, string> = {
  [`${A}/README.md`]: `# Acceptance tests\n\n${README_LINES.join('\n')}\n`,
  [`${A}/onb-01.spec.ts`]: '// ONB-01 tests\n',
  [`${A}/help-01.spec.ts`]: '// HELP-01 and HELP-01.3 tests\n',
  [`${A}/support/fixtures.ts`]: '// shared fixtures\n',
  [`${A}/cards/onb-01.md`]: '# ONB-01\n\nLocks: acceptance-lock/onb-01\n',
  [`${A}/cards/help-01.md`]: '# HELP-01\n\nLocks: acceptance-lock/help-01\n',
  [`${A}/cards/help-01.3.md`]: '# HELP-01.3\n\nLocks: acceptance-lock/help-01.3\n',
  [`${A}/cards/ops-02.md`]: '# OPS-02\n\nLocks: acceptance-lock/ops-02\n',
  'pepla-web/src/main.ts': 'export const app = 1;\n',
};

function card(name: string, locks: string[]): Record<string, string> {
  return {
    [`${A}/${name}.spec.ts`]: `// ${name} tests\n`,
    [`${A}/cards/${name}.md`]: `# ${name.toUpperCase()}\n\nLocks: ${locks.map((l) => `acceptance-lock/${l}`).join(', ')}\n`,
  };
}

function passes(r: CheckResult, what: string): void {
  expect(r.code, `${what}: the lock check should pass. Its output:\n${r.out}`).toBe(0);
}

function fails(r: CheckResult, what: string, ...named: string[]): void {
  expect(r.code, `${what}: the lock check should fail. Its output:\n${r.out}`).not.toBe(0);
  for (const n of named) expect(r.out, `${what}: the error should name ${n}. Its output:\n${r.out}`).toContain(n);
}

function cardFile(name: string): string {
  const path = join(CARDS, `${name}.md`);
  expect(existsSync(path), `pepla-web/e2e/acceptance/cards/${name}.md should exist`).toBe(true);
  return readFileSync(path, 'utf8');
}

/** Card-specific text at b9dda84 that must leave the README and land, word for word, in its card's file. */
const MOVED: Array<{ card: string; text: string }> = [
  {
    card: 'help-01',
    text: '`help-01.spec.ts` checks a journey (`e2e/journeys/*.e2e.ts`) rather than a page.',
  },
  {
    card: 'help-02',
    text:
      '`help-02.spec.ts` adds a `watcher` to the recorder (`support/help-02.ts`): it sees the scroll position, ' +
      'a shown masked value, the full made-up ID number in the page text, and every email and phone number the page shows.',
  },
  {
    card: 'ops-02',
    text:
      '`ops-02.spec.ts` checks `.github/workflows/` rather than a page. `support/ops-02-workflows.ts` reads the workflows ' +
      "with python3 and PyYAML, applies GitHub's path filter rules to sample file lists, and runs the real \"post results\" " +
      'step of `app-e2e-dev.yml` on the sample results in `support/ops-02/` with a fake GitHub API. These tests run once ' +
      '(in `desktop-1280`), open no page and call nothing outside the machine.',
  },
  {
    card: 'be-16',
    text:
      '`be-16.spec.ts` checks an infra card, so it opens no browser and runs once (in `desktop-1280`). ' +
      '`support/infra-harness.ts` reads the Terraform files as text, runs a `scripts/ci` script against a fake AWS ' +
      '(`support/be-16/fake-aws`, a stand-in `boto3` that records every call and never reaches AWS), and runs one step ' +
      'of a workflow with a stub `terraform` and made-up plans. What only real AWS can show (the prod plan on the PR, ' +
      'the pepla-dev apply) is read by the verifier on the second pass. Needs `python3`, `jq` and `bash`.',
  },
  {
    card: 'onb-12',
    text:
      '`onb-12.spec.ts` AC-5 and AC-11 run the real `lambda/getEmployeeDocumentVerifications` handler in its own Node ' +
      'process against a fake AWS (`support/onb-12/fake-aws`): every AWS SDK and Powertools import is answered by a fake, ' +
      'the tables come from made-up people, and every DynamoDB and KMS call is recorded. Nothing is installed in the Lambda ' +
      'folder and nothing reaches AWS; importing an AI client fails the run. They run once (in `desktop-1280`). ' +
      '`support/onb-12/openapi_route.py` reads `api/openapi.yaml` (python3 and PyYAML).',
  },
];

test.describe('OPS-08 One test notes file per card', () => {
  test.beforeEach(({}, info) => {
    test.skip(ON_DEV, 'lock rule checks run in the no-backend run only');
    test.skip(info.project.name !== 'desktop-1280', 'lock rule checks run once, in desktop-1280');
  });
  test.afterEach(() => cleanUp());

  test('AC-1 A notes file per card: cards/<card>.md holds its row, its moved paragraphs and a Locks: line', () => {
    const before = readFileSync(BASELINE_README, 'utf8');
    const rows = before.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*(Card|---)/.test(l));
    expect(rows, 'README at b9dda84 has 12 card rows').toHaveLength(TABLE_CARDS.length);

    // Each table card's file holds its row's cells as they are today.
    TABLE_CARDS.forEach((name, i) => {
      const text = fold(cardFile(name));
      for (const cell of cells(rows[i])) {
        expect(text, `cards/${name}.md should hold "${cell}" from its README row`).toContain(fold(cell));
      }
    });
    for (const name of EXTRA_CARDS) cardFile(name);
    expect(fold(cardFile('ops-08')), 'cards/ops-08.md names its Jira card').toContain('NH-161');

    // Card-specific paragraphs move word for word to their card's file, and to no other.
    const all = [...TABLE_CARDS, ...EXTRA_CARDS];
    for (const { card: owner, text } of MOVED) {
      expect(fold(cardFile(owner)), `cards/${owner}.md should hold, word for word: ${text}`).toContain(fold(text));
      for (const other of all.filter((c) => c !== owner)) {
        expect(fold(cardFile(other)), `cards/${other}.md should not hold ${owner}'s paragraph`).not.toContain(fold(text));
      }
    }

    // Locks: line on every file, naming only real lock branches, each today's lock in exactly one file.
    const named: Record<string, string[]> = {};
    for (const name of all) {
      const locks = locksLine(cardFile(name));
      expect(locks, `cards/${name}.md should have a "Locks:" line`).not.toBeNull();
      expect(locks!.length, `the Locks: line of cards/${name}.md should name at least one acceptance-lock/ branch`).toBeGreaterThan(0);
      for (const lock of locks!) {
        (named[lock] ??= []).push(name);
        if (lock in LOCKS_TODAY) {
          const owners = LOCKS_TODAY[lock];
          expect(owners, `acceptance-lock/${lock} owns no card, so cards/${name}.md should not name it`).not.toBeNull();
          expect(owners, `acceptance-lock/${lock} is not a lock of ${name}`).toContain(name);
        } else {
          // A lock made after 14 Nov: it can only be this card's own (<card> or <card>.<n>).
          const own = lock === name || (new RegExp(`^${name.replace(/\./g, '\\.')}\\.\\d+$`).test(lock) && !all.includes(lock as never));
          expect(own, `cards/${name}.md names acceptance-lock/${lock}, which is not a lock branch of ${name}`).toBe(true);
        }
      }
    }
    for (const [lock, owners] of Object.entries(LOCKS_TODAY)) {
      if (owners === null) continue;
      expect(named[lock] ?? [], `acceptance-lock/${lock} should be named in exactly one card file`).toHaveLength(1);
    }
    // Where a card has a lock of its own name, its file names it.
    for (const name of all) {
      if (name in LOCKS_TODAY) expect(named[name] ?? [], `cards/${name}.md should name acceptance-lock/${name}`).toContain(name);
    }

    // No README text is lost: every line taken out of the README is in a card file or the new README.
    const after = readFileSync(join(ACCEPTANCE, 'README.md'), 'utf8');
    const afterLines = new Set(after.split('\n').map((l) => l.trim()));
    const homes = [{ where: 'README.md', text: fold(after) }, ...all.map((c) => ({ where: `cards/${c}.md`, text: fold(cardFile(c)) }))];
    const removed = before
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !afterLines.has(l) && !/^\|/.test(l) && !/^```/.test(l) && !/^#+\s/.test(l));
    // A line can hold the end of one sentence and the start of the next, which may go to different places.
    const pieces = removed.flatMap((l) => l.split(/(?<=[.:;])\s+/)).filter((p) => p.length >= 12);
    for (const piece of pieces) {
      const found = homes.filter((h) => h.text.includes(fold(piece))).map((h) => h.where);
      expect(found.length, `README text "${piece}" should be kept in the README or moved to a card file`).toBeGreaterThan(0);
      if (piece.length >= 40) {
        // Short pieces ("They run once (in `desktop-1280`).") are said of several cards; longer ones belong to one.
        expect(found.filter((w) => w.startsWith('cards/')).length, `README text "${piece}" should be in one card file, not several`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('AC-2 README says how the folder works only: no card table, no card paragraph, the cards/<card>.md rule', () => {
    const readme = readFileSync(join(ACCEPTANCE, 'README.md'), 'utf8');
    const text = fold(readme);

    expect(readme, 'README.md should have no card table').not.toMatch(/^\s*\|\s*Card\s*\|/m);
    expect(readme, 'README.md should name no Jira card').not.toMatch(/\bNH-\d+/);
    const specs = readme.match(/\b[a-z][a-z0-9-]*(?:\.\d+)?\.spec\.ts\b/g) ?? [];
    expect(specs, "README.md should name no one card's test file (that goes in the card's file)").toEqual([]);
    for (const { card: owner, text: para } of MOVED) {
      expect(text, `README.md should no longer hold ${owner}'s paragraph`).not.toContain(fold(para));
    }

    // Kept: Locked, Running, the shared harness and fakes.
    expect(readme, 'README.md keeps its "Locked" section').toMatch(/^##\s+Locked\b/m);
    expect(readme, 'README.md keeps its "Running" section').toMatch(/^##\s+Running\b/m);
    for (const shared of ['support/cognito-fake.ts', 'support/employees-fake.ts', 'support/documents-fake.ts', 'support/journey-harness.ts', 'support/fixtures.ts']) {
      expect(text, `README.md keeps the text about ${shared}`).toContain(shared);
    }
    expect(text, 'README.md keeps the rebase warning').toContain(fold('Builders: bring `develop` in with a merge, not a rebase.'));

    // The new rule.
    expect(text, 'README.md says a new card adds cards/<card>.md').toContain('cards/<card>.md');
    const sentences = text.split(/(?<=[.!?])\s+/);
    const rule = sentences.find((s) => s.includes('cards/<card>.md') && /\block\b/i.test(s));
    expect(rule, 'README.md says the card file is added in the lock commit (one sentence with cards/<card>.md and "lock")').toBeTruthy();
    const never = sentences.find((s) => /\b(never|not|n't)\b/i.test(s) && /README/.test(s) && /another card/i.test(s));
    expect(never, "README.md says a card never edits the README or another card's file").toBeTruthy();
  });

  test("AC-3 A card's file belongs to that card's locks; another lock changing it fails, naming the file and the lock", () => {
    const cases: Array<{ what: string; lock: string; files: Record<string, string | null>; ok: boolean; named?: string[] }> = [
      { what: 'a new card adds its own file in its lock commit', lock: 'onb-13', files: card('onb-13', ['onb-13']), ok: true },
      {
        what: 'a re-lock of ONB-01 changes cards/onb-01.md',
        lock: 'onb-01.5',
        files: { [`${A}/onb-01.spec.ts`]: '// ONB-01 tests, changed\n', [`${A}/cards/onb-01.md`]: '# ONB-01\n\nLocks: acceptance-lock/onb-01, acceptance-lock/onb-01.5\n' },
        ok: true,
      },
      {
        what: "OPS-02's re-lock changes ONB-01's card file",
        lock: 'ops-02.4',
        files: { [`${A}/cards/onb-01.md`]: '# ONB-01\n\nLocks: acceptance-lock/onb-01\n\nEdited by another card.\n' },
        ok: false,
        named: ['cards/onb-01.md', 'ops-02.4'],
      },
      {
        what: "a new card's lock commit also deletes OPS-02's card file",
        lock: 'onb-13',
        files: { ...card('onb-13', ['onb-13']), [`${A}/cards/ops-02.md`]: null },
        ok: false,
        named: ['cards/ops-02.md', 'onb-13'],
      },
      {
        what: "a new card's lock commit also adds a file for another card",
        lock: 'onb-13',
        files: { ...card('onb-13', ['onb-13']), [`${A}/cards/onb-14.md`]: '# ONB-14\n' },
        ok: false,
        named: ['cards/onb-14.md', 'onb-13'],
      },
      {
        what: 'lock help-01.3 (the HELP-01.3 card) changes cards/help-01.3.md',
        lock: 'help-01.3',
        files: { [`${A}/cards/help-01.3.md`]: '# HELP-01.3\n\nLocks: acceptance-lock/help-01.3\n\nMore notes.\n' },
        ok: true,
      },
      {
        what: 'lock help-01.3 (a card, not re-lock 3 of HELP-01) changes cards/help-01.md',
        lock: 'help-01.3',
        files: { [`${A}/cards/help-01.md`]: '# HELP-01\n\nLocks: acceptance-lock/help-01\n\nMore notes.\n' },
        ok: false,
        named: ['cards/help-01.md', 'help-01.3'],
      },
      {
        what: "HELP-01's re-lock changes the HELP-01.3 card's file (a longer name is another card, not part of HELP-01)",
        lock: 'help-01.5',
        files: { [`${A}/cards/help-01.3.md`]: '# HELP-01.3\n\nLocks: acceptance-lock/help-01.3\n\nEdited by HELP-01.\n' },
        ok: false,
        named: ['cards/help-01.3.md', 'help-01.5'],
      },
      {
        what: 'lock help-01.4 (re-lock 4 of HELP-01, there is no HELP-01.4 card) changes cards/help-01.md',
        lock: 'help-01.4',
        files: { [`${A}/cards/help-01.md`]: '# HELP-01\n\nLocks: acceptance-lock/help-01, acceptance-lock/help-01.4\n' },
        ok: true,
      },
      {
        what: 'a lock-check lock changes the workflow and the README',
        lock: 'lock-check.3',
        files: { [WF]: null, [`${A}/README.md`]: `# Acceptance tests\n\n${README_LINES.join('\n')}\nOne more line.\n` },
        ok: true,
      },
      {
        what: "a lock-check lock changes ONB-01's card file",
        lock: 'lock-check.3',
        files: { [`${A}/cards/onb-01.md`]: '# ONB-01\n\nLocks: acceptance-lock/onb-01\n\nEdited by the lock check.\n' },
        ok: false,
        named: ['cards/onb-01.md', 'lock-check.3'],
      },
    ];

    for (const c of cases) {
      const box = new Sandbox(DEVELOP);
      box.branch('pr', 'develop');
      const files = { ...c.files };
      if (WF in files) {
        // The lock-check case edits the workflow: append a comment to the workflow as it is.
        files[WF] = `${readFileSync(join(box.work, WF), 'utf8')}# a comment added by the lock check\n`;
      }
      box.commit(`test: ${c.what}`, files);
      box.lock(c.lock);
      // The builder's commit on top touches only the app.
      box.commit('feat: the builder builds', { 'pepla-web/src/main.ts': 'export const app = 2;\n' });
      const r = box.check('pr');
      if (c.ok) passes(r, c.what);
      else fails(r, c.what, ...(c.named ?? []));
    }
  });

  test('AC-4 Merges are judged file by file: bringing in other cards passes, a file matching neither side fails', () => {
    /** develop gains card ONB-14 (its tests and its card file) and an app change, after the PR branch started. */
    function developMoves(box: Sandbox, extra: Record<string, string | null> = {}): void {
      box.branch('develop');
      box.commit('test(onb-14): ONB-14 tests', { ...card('onb-14', ['onb-14']), ...extra });
      box.lock('onb-14');
      box.commit('feat(onb-14): build', { 'pepla-web/src/main.ts': 'export const app = "develop";\n' });
      box.pushDevelop();
    }
    /** The PR branch: card ONB-13's locked tests and card file, then the builder's app change. */
    function prStarts(box: Sandbox, extra: Record<string, string | null> = {}): void {
      box.branch('pr', 'develop');
      box.commit('test(onb-13): ONB-13 tests', { ...card('onb-13', ['onb-13']), ...extra });
      box.lock('onb-13');
      box.commit('feat(onb-13): build', { 'pepla-web/src/main.ts': 'export const app = "pr";\n' });
    }
    const resolved = { 'pepla-web/src/main.ts': 'export const app = "both";\n' };

    {
      const what = "merging develop in, where develop added ONB-14's tests and card file (app conflict resolved by hand)";
      const box = new Sandbox(DEVELOP);
      prStarts(box);
      developMoves(box);
      box.branch('pr');
      box.merge('develop', resolved);
      passes(box.check('pr'), what);
    }
    {
      const what = "merging develop in, where develop's locked commit deleted a test file and changed ONB-01's card file";
      const box = new Sandbox(DEVELOP);
      prStarts(box);
      box.branch('develop');
      box.commit('test(onb-01): re-lock', { [`${A}/onb-01.spec.ts`]: null, [`${A}/cards/onb-01.md`]: '# ONB-01\n\nLocks: acceptance-lock/onb-01, acceptance-lock/onb-01.5\n' });
      box.lock('onb-01.5');
      box.pushDevelop();
      box.branch('pr');
      box.merge('develop');
      passes(box.check('pr'), what);
    }
    {
      const what = 'a merge that mixes the README: both sides changed different lines and git combined them';
      const box = new Sandbox(DEVELOP);
      const top = README_LINES.map((l, i) => (i === 0 ? 'Changed on the PR branch.' : l));
      const bottom = README_LINES.map((l, i) => (i === README_LINES.length - 1 ? 'Changed on develop.' : l));
      prStarts(box, { [`${A}/README.md`]: `# Acceptance tests\n\n${top.join('\n')}\n` });
      developMoves(box, { [`${A}/README.md`]: `# Acceptance tests\n\n${bottom.join('\n')}\n` });
      box.branch('pr');
      box.merge('develop', resolved);
      fails(box.check('pr'), what, `${A}/README.md`);
    }
    {
      const what = 'a merge that writes a locked test file matching neither side';
      const box = new Sandbox(DEVELOP);
      prStarts(box);
      developMoves(box);
      box.branch('pr');
      box.merge('develop', { ...resolved, [`${A}/onb-01.spec.ts`]: '// ONB-01 tests, quietly weakened in a merge\n' });
      fails(box.check('pr'), what, `${A}/onb-01.spec.ts`);
    }
    {
      const what = 'a merge that adds a locked file neither side has';
      const box = new Sandbox(DEVELOP);
      prStarts(box);
      developMoves(box);
      box.branch('pr');
      box.merge('develop', { ...resolved, [`${A}/cards/onb-15.md`]: '# ONB-15\n' });
      fails(box.check('pr'), what, `${A}/cards/onb-15.md`);
    }
    {
      const what = 'a merge that deletes a locked test file both sides still have';
      const box = new Sandbox(DEVELOP);
      prStarts(box);
      developMoves(box);
      box.branch('pr');
      box.merge('develop', { ...resolved, [`${A}/help-01.spec.ts`]: null });
      fails(box.check('pr'), what, `${A}/help-01.spec.ts`);
    }
    {
      const what = 'a merge that changes the lock workflow to match neither side';
      const box = new Sandbox(DEVELOP);
      prStarts(box);
      developMoves(box);
      box.branch('pr');
      box.merge('develop', { ...resolved, [WF]: `${readFileSync(join(box.work, WF), 'utf8')}# switched off in a merge\n` });
      fails(box.check('pr'), what, WF);
    }
  });

  test('AC-5 Everything else in the rule stays: unlocked commits fail, tags count, pull_request_target, read-only checkout', () => {
    // Static: trigger, permissions and checkout are as on develop at b9dda84.
    const before = parseWorkflow(BASELINE_WORKFLOW);
    const now = parseWorkflow(LOCK_WORKFLOW);
    expect(now.on, 'the lock check still runs on pull_request_target into develop and main, and on nothing else').toEqual(before.on);
    expect(now.permissions, 'workflow permissions stay contents: read').toEqual(before.permissions);
    const { job } = lockJob(now);
    const { job: oldJob } = lockJob(before);
    expect(job.permissions ?? null, 'the job adds no permissions of its own').toEqual(oldJob.permissions ?? null);
    const co = checkoutStep(job);
    const oldCo = checkoutStep(oldJob);
    expect(co.with?.ref, 'the job checks out the PR head commit').toEqual(oldCo.with?.ref);
    expect(co.with?.['persist-credentials'], 'the checkout keeps persist-credentials: false').toBe(false);
    expect(co.with?.['fetch-depth'], 'the checkout keeps the whole history').toEqual(oldCo.with?.['fetch-depth']);
    for (const step of job.steps) {
      if (step.uses) expect(step.uses, 'the job uses no action other than checkout').toMatch(/^actions\/checkout@/);
      if (typeof step.run === 'string') {
        expect(step.run, 'the job never runs code from the PR (no npm, node, make, or script files from the checkout)').not.toMatch(
          /\b(npm|npx|yarn|pnpm|node|make|tsx)\b\s|(^|[\s;&|(])(\.\/|source\s|\.\s+\S)|\b(bash|sh|python3?)\s+(?!-)[\w./-]+\.(sh|py)\b/m,
        );
      }
    }

    // Run: the rule still holds for commits without a lock.
    {
      const box = new Sandbox(DEVELOP);
      box.branch('pr', 'develop');
      box.commit('feat(onb-13): builder edits a test file', { [`${A}/onb-01.spec.ts`]: '// weakened\n' });
      fails(box.check('pr'), 'a commit with no lock that changes a test file', 'builder edits a test file');
    }
    {
      const box = new Sandbox(DEVELOP);
      box.branch('pr', 'develop');
      box.commit('feat(onb-13): builder adds its own card file', { [`${A}/cards/onb-13.md`]: '# ONB-13\n' });
      fails(box.check('pr'), 'a commit with no lock that adds a card file', 'builder adds its own card file');
    }
    {
      const box = new Sandbox(DEVELOP);
      box.branch('pr', 'develop');
      box.commit('ci: builder edits the lock check', { [WF]: `${readFileSync(join(box.work, WF), 'utf8')}# off\n` });
      fails(box.check('pr'), 'a commit with no lock that changes the lock workflow', 'builder edits the lock check');
    }
    {
      const box = new Sandbox(DEVELOP);
      box.branch('pr', 'develop');
      box.commit('test(onb-13): ONB-13 tests', card('onb-13', ['onb-13']));
      box.tag('onb-13');
      box.commit('feat(onb-13): build', { 'pepla-web/src/main.ts': 'export const app = 3;\n' });
      passes(box.check('pr'), 'tests accepted with a tag acceptance/onb-13 instead of a lock branch');
    }
    {
      const box = new Sandbox(DEVELOP);
      box.branch('pr', 'develop');
      box.commit('feat: app only', { 'pepla-web/src/main.ts': 'export const app = 4;\n' });
      passes(box.check('pr'), 'a PR that does not touch the folder');
    }
  });

  test('AC-6 No locked test changes: every test file stays, and only *.spec.ts files are run', () => {
    const config = readFileSync(join(ACCEPTANCE, 'playwright.config.ts'), 'utf8');
    expect(config, "the acceptance run still picks *.spec.ts only, so cards/*.md is never run").toMatch(/testMatch:\s*'\*\.spec\.ts'/);
    expect(config, 'the acceptance run still starts in this folder').toMatch(/testDir:\s*'\.'/);
    const was = ['be-16', 'help-01', 'help-02', 'onb-01', 'onb-02', 'onb-12', 'ops-02', 'ops-05', 'ops-06', 'ops-07'];
    const now = readdirSync(ACCEPTANCE).filter((f) => f.endsWith('.spec.ts'));
    for (const name of was) expect(now, `${name}.spec.ts is still there`).toContain(`${name}.spec.ts`);
  });

  test('AC-7 Nothing reaches AWS or paid AI: the workflow gains no secret, environment, id-token or AWS step', () => {
    const wf = parseWorkflow(LOCK_WORKFLOW);
    const { job } = lockJob(wf);
    const json = JSON.stringify(wf);
    expect(json, 'the lock workflow reads no secret').not.toMatch(/secrets\./);
    expect(json, 'the lock workflow asks for no id-token').not.toMatch(/id-token/);
    expect(json, 'the lock workflow has no AWS step').not.toMatch(/aws-actions|role-to-assume|aws\s+(sts|s3|secretsmanager)/i);
    expect(json, 'the lock workflow calls no AI service').not.toMatch(/bedrock|anthropic|openai/i);
    expect(wf.environment, 'the workflow has no environment').toBeUndefined();
    expect(job.environment, 'the job has no environment').toBeUndefined();
    expect(Object.keys(wf.permissions ?? {}), 'the workflow asks for contents only').toEqual(['contents']);
  });
});
