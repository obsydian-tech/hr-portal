import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO } from './support/rec-14/lambda-harness';
import { cases, type Case } from './support/int-03/cases';
import { ERR_MARK, bodyOf, describe, effectsOf, formsOf, leaks, linesOf, normal, runsOf, statusOf } from './support/int-03/world';
import { int01Actual, int01Expected } from './support/int-01.1/int03'; // child lock int-01.1

/**
 * INT-03 · Stop logging raw guest tokens (Jira NH-267, amber). Spec: /mnt/project-files/specs/interview-journey/cards/INT-03.md, read
 * from develop 7048cb9 with the round 1 and round 2 spec check fixes. Notes and pinned choices: cards/int-03.md. Review page:
 * /mnt/project-files/specs/interview-journey/cards/INT-03-tests-for-review.md (the bar).
 *
 * AC-1 reads the two Lambda folders as JavaScript (TypeScript's parser) and looks inside every console call. AC-2 and AC-3 run the real
 * handlers once per path in a fresh Node process against REC-14's fake AWS, which records every console line (support/int-03).
 * Nothing calls AWS or any AI. Nothing here has a screen width: each test runs once, at 1280. AC-4 runs on pepla-dev only, after merge.
 *
 * Expected red before merge: AC-1, AC-2 and the AC-4 seed text check. AC-3 is green on develop 7048cb9 by construction (its expected
 * values were recorded there) and must stay green.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const FOLDERS = [join(REPO, 'lambda', 'generateScoringLink'), join(REPO, 'lambda', 'submitVoteByToken')];

// ---------------------------------------------------------------- AC-1: the text check

/** Names that hold a token or its hash (AC-1). */
const BAD_NAMES = new Set(['token', 'raw', 'hash', 'tokenHash']);
/** The dotted text of a property chain (`a?.b['c']` is `a.b.c`), or '' when it is not one. */
function chainOf(n: ts.Node): string {
  if (ts.isIdentifier(n)) return n.text;
  if (n.kind === ts.SyntaxKind.ThisKeyword) return 'this';
  if (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n)) return chainOf(n.expression);
  if (ts.isPropertyAccessExpression(n)) { const l = chainOf(n.expression); return l ? `${l}.${n.name.text}` : `?.${n.name.text}`; }
  if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) { const l = chainOf(n.expression); return l ? `${l}.${n.argumentExpression.text}` : `?.${n.argumentExpression.text}`; }
  return '';
}
/** Why a property chain inside a console call is refused, or ''. */
function badChain(chain: string): string {
  const last = chain.split('.').pop() ?? '';
  if (['token', 'tokenHash', 'token_hash'].includes(last) && chain.includes('.')) return 'a token field';
  if (/^event\.(body|rawPath|pathParameters)(\.|$)/.test(chain)) return 'the request path, path parameters or body';
  if (last === 'message' && chain.includes('.')) return 'an error message (error names only)';
  return '';
}
/** Every refused use inside console calls of one file's source: "line: what (why)". */
function consoleFindings(source: string, fileName: string): { calls: number; findings: string[] } {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const findings: string[] = [];
  let calls = 0;
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const isConsoleCall = (n: ts.Node): n is ts.CallExpression => {
    if (!ts.isCallExpression(n)) return false;
    const callee = n.expression;
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) return chainOf(callee.expression) === 'console' || chainOf(callee.expression) === 'globalThis.console';
    return false;
  };
  const inspect = (n: ts.Node) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isName = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isMethodDeclaration(p) && p.name === n);
      if (!isName && BAD_NAMES.has(n.text)) findings.push(`${lineOf(n)}: ${n.text} (a token or its hash)`);
    }
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      const chain = chainOf(n);
      const why = chain ? badChain(chain) : '';
      if (why) findings.push(`${lineOf(n)}: ${chain} (${why})`);
    }
    ts.forEachChild(n, inspect);
  };
  const walk = (n: ts.Node) => {
    if (isConsoleCall(n)) { calls++; for (const a of n.arguments) inspect(a); }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return { calls, findings: [...new Set(findings)] };
}
/** The code files of a Lambda folder (tests and packages left out). */
function codeFiles(dir: string): string[] {
  const out: string[] = [];
  const go = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) go(p);
      else if (/\.(c|m)?js$/.test(e.name) && !/\.test\.(c|m)?js$/.test(e.name)) out.push(p);
    }
  };
  go(dir);
  return out.sort();
}

// ---------------------------------------------------------------- AC-2 and AC-3 helpers

const EXPECTED_FILE = join(__dirname, 'support', 'int-03', 'expected-7048cb9.json');
const RECORDING = process.env['INT03_RECORD_EXPECTED'] === '1';
const sameAs = (c: Case) => normal({ status: statusOf(c.run), body: bodyOf(c.run), threw: c.run.error?.name ?? null, ...effectsOf(c.before, c.run) }, c.names);

function judgeLogs(group: Case['group']) {
  const list = cases().filter((c) => c.group === group);
  expect(list.length, `the ${group} paths ran`).toBeGreaterThan(0);
  for (const c of list) {
    const lines = linesOf(c.run);
    if (c.planted !== undefined) expect.soft(c.planted, `${c.id} ${c.label}: the failure was planted on the call the path makes`).toBeGreaterThan(0);
    if (c.cardStatus !== undefined) expect.soft(statusOf(c.run), `${c.id} ${c.label}: the card's answer (${describe(c.run)})`).toBe(c.cardStatus);
    expect.soft(c.secrets.length, `${c.id} ${c.label}: the run knows its token`).toBeGreaterThan(0);
    expect.soft(leaks(c.run, c.secrets.flatMap(formsOf)), `${c.id} ${c.label}: no log line holds a token, its SHA-256 (hex or base64url), or any 12-character run of them`).toEqual([]);
    expect.soft(lines.filter((l) => l.includes(ERR_MARK)).map((l) => l.slice(0, 200)), `${c.id} ${c.label}: no log line holds an error's message (rule 2, error names only)`).toEqual([]);
    if (c.names3) {
      const { cand, iv } = c.names3;
      expect.soft(lines.some((l) => l.includes(cand) && l.includes(iv)), `${c.id} ${c.label}: rule 3, a line names the candidate (${cand}) and the interview (${iv}) instead of the token. Lines: ${JSON.stringify(lines).slice(0, 600)}`).toBe(true);
    }
  }
}

test.describe('INT-03 Stop logging raw guest tokens', () => {
  // ---------------------------------------------------------------- AC-1

  test('AC-1 Text check: no console call in either folder uses a token, a token field, raw, hash, tokenHash, the request body, path or path parameters, or err.message', async ({}, testInfo) => {
    once(testInfo.project.name);
    // The checker itself: what it must refuse and what it must let through (AC-1's own examples).
    const probe = (src: string) => consoleFindings(src, 'probe.js').findings.length;
    const refused = [
      'console.info("x", { token });', 'console.info("x", { t: token });', 'console.warn(`link ${token}`);', 'console.info("x", { token: rec.token });',
      'console.info("x", tokenRecord.token);', 'console.info("x", tokenRecord["token"]);', 'console.info("x", { raw });', 'console.info("x", hash.slice(0, 8));',
      'console.info("x", { tokenHash });', 'console.info("x", event.body);', 'console.info("x", event.rawPath);', 'console.info("x", event.pathParameters?.token);',
      'console.error("x", { error: err.message });', 'console.error(`x ${err?.message}`);', 'console["log"]("x", token);', 'console.info("x", o.link.token_hash);',
    ];
    for (const src of refused) expect.soft(probe(src), `the check refuses: ${src}`).toBeGreaterThan(0);
    const allowed = [
      "console.warn('Token carries no company');", 'console.info("Token vote submitted", { candidateId, interviewId });', 'console.error("x", { error: err.name });',
      'console.info("token", { candidateId });', 'console.info("x", { token: "[hidden]" });', 'const token = 1; foo(token);',
    ];
    for (const src of allowed) expect.soft(probe(src), `the check lets through: ${src}`).toBe(0);

    const files = FOLDERS.flatMap(codeFiles);
    for (const must of ['generateScoringLink/index.js', 'submitVoteByToken/index.js', 'submitVoteByToken/rec07.mjs']) {
      expect(files.some((f) => f.endsWith(must)), `${must} is read`).toBe(true);
    }
    let total = 0;
    for (const f of files) {
      const { calls, findings } = consoleFindings(readFileSync(f, 'utf8'), f);
      total += calls;
      expect.soft(findings, `${f.slice(REPO.length + 1)}: console calls use nothing that holds a token, and log error names only`).toEqual([]);
    }
    expect(total, 'the console calls were found (the file was read as code)').toBeGreaterThan(10);
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 Running check, old generate path: link made, existing link returned, each write fails, the candidate read fails: no log line holds the token, its hash or any 12-character run', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    judgeLogs('old-generate');
  });

  test('AC-2 Running check, REC-07 paths: the hashed link made; rec07.mjs read and vote, ok, expired and read failure: no log line holds the token, its hash or any 12-character run', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    judgeLogs('rec07');
  });

  test('AC-2 Running check, old vote path: not found, read fails, expired, already used, vote saved, mark-used fails, publish fails: no log line holds the token, its hash or any 12-character run', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    judgeLogs('old-vote');
  });

  test('AC-2 Running check, company B and refusals: B\'s Recruiter on A\'s candidate (404), A\'s link on B\'s candidate (403), a link with no company (403), Recruitment off (410): no log line holds the token', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    judgeLogs('company-b');
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 Same behaviour: each AC-2 run gives the status, answer and rows (and events) develop 7048cb9 gave; company B named in the body, headers or query changes nothing', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    const all = cases();
    if (RECORDING) {
      writeFileSync(EXPECTED_FILE, JSON.stringify(Object.fromEntries(all.map((c) => [c.id, sameAs(c)])), null, 1) + '\n');
      throw new Error(`recorded ${all.length} runs into ${EXPECTED_FILE}; recording never passes`);
    }
    expect(existsSync(EXPECTED_FILE), 'develop 7048cb9\'s values are kept beside the tests').toBe(true);
    const expected = JSON.parse(readFileSync(EXPECTED_FILE, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(expected).sort(), 'every run has a value recorded on develop 7048cb9').toEqual(all.map((c) => c.id).sort());
    // int01Actual / int01Expected: child lock int-01.1 (INT-01's `open` on the guest read and its one-vote guard row; nothing else moves).
    for (const c of all) expect.soft(int01Actual(c.id, sameAs(c)), `${c.id} ${c.label}: the same status, answer, rows and events as develop 7048cb9`).toEqual(int01Expected(c.id, expected[c.id]));
    // Company B named in the body, headers and query: the same as the plain run.
    const byId = Object.fromEntries(all.map((c) => [c.id, c]));
    const strip = (c: Case) => normal({ status: statusOf(c.run), body: bodyOf(c.run), ...effectsOf(c.before, c.run) }, c.names.map(([s]) => [s, 'TOKEN'] as [string, string]));
    expect.soft(strip(byId['F1']!), 'old path link made: company B in the body, headers and query changes nothing').toEqual(strip(byId['G1']!));
    expect.soft(strip(byId['F2']!), 'old vote saved: company B in the body, headers and query changes nothing').toEqual(strip(byId['V5']!));
  });

  test('AC-3 The existing tests stay as they are: generateScoringLink/settings.test.js is develop 7048cb9\'s, word for word', async ({}, testInfo) => {
    once(testInfo.project.name);
    // rec-07.spec.ts and rec-12.spec.ts are locked: the "Acceptance tests locked" check refuses a change, and this suite runs them.
    const sha = createHash('sha256').update(readFileSync(join(REPO, 'lambda', 'generateScoringLink', 'settings.test.js'))).digest('hex');
    expect(sha, 'settings.test.js is unchanged (lambda-tests.yml runs it)').toBe('1d4162b7772490071a875268cec0ac746f6a04c5cae6e641bbc7218f126a8d72');
  });

  // ---------------------------------------------------------------- AC-4 (pepla-dev, judged after merge)

  test('AC-4 pepla-dev: seed-dev.py puts the INT-03 rows back each run, and reset-dev-rec04.py leaves them alone (text check)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const src = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    const start = src.indexOf('def seed_int03(');
    expect(start, 'seed-dev.py has seed_int03').toBeGreaterThan(-1);
    const rest = src.slice(start + 1);
    const fn = rest.slice(0, rest.search(/\ndef |\nif __name__/) + 1 || undefined);
    expect.soft(src.slice(src.indexOf('def main(')), 'main() calls seed_int03').toMatch(/seed_int03\(\s*ddb\s*,/);
    expect.soft(fn, 'seed_int03 reads the ids the dev test uses (support/int-03/dev-ids.json)').toContain('int-03');
    expect.soft(fn, 'the candidate carries the active SCORING_WEIGHTS version (the old vote path refuses one with none)').toMatch(/active_config_version\(\s*ddb\s*,[^)]*SCORING_WEIGHTS/);
    expect.soft(fn, 'the interview needs 99 votes, so one vote never reaches a quorum').toMatch(/votesRequired[^\n]{0,40}\b99\b/);
    expect.soft(fn, 'the votes the last run left are deleted').toMatch(/VOTE#[\s\S]*delete_item|delete_item[\s\S]*VOTE#/);
    expect.soft(fn, 'the link rows are written unused').toMatch(/used/);
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'int-03', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const reset = readFileSync(join(REPO, 'scripts', 'ci', 'reset-dev-rec04.py'), 'utf8');
    expect.soft(reset.includes(ids['candidate']!) || reset.includes('int-03'), 'reset-dev-rec04.py (run before the main run) does not name the INT-03 candidate').toBe(false);
  });

  test('AC-4 One old-path vote on pepla-dev: the submitVoteByToken log group shows the vote\'s success line and no line holds the token, its hash or any 12-character run @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-2.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width (a second vote would be "already used").');
    test.setTimeout(8 * 60_000);
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'int-03', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const token = ids['token']!;
    const appEnv = readFileSync(join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts'), 'utf8');
    const tfApi = (/talentFlowApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(appEnv)?.[1] ?? '').replace(/\/+$/, '').replace(/\/v1$/, '');
    expect(tfApi, 'pepla-web\'s talentFlowApiUrl points at pepla-dev\'s TalentFlow API').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const region = /execute-api\.([a-z0-9-]+)\.amazonaws\.com/.exec(tfApi)?.[1] ?? 'af-south-1';

    const from = Date.now() - 60_000;
    const res = await page.request.fetch(`${tfApi}/v1/scoring/${encodeURIComponent(token)}/votes`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ scores: { technical: 7, communication: 8, culturalFit: 6, problemSolving: 9 }, rating: 'YES' }),
    });
    expect(res.status(), `the seeded old-path link takes one vote (${res.status()} ${(await res.text()).slice(0, 200)})`).toBe(200);

    // The logs arrive late: wait for this vote's own success line (at most 5 minutes; no line means the check fails, never passes).
    const group = '/aws/lambda/submitVoteByToken';
    const read = (extra: string[]) => {
      const out: { message: string; timestamp: number }[] = [];
      let next: string | undefined;
      do {
        const raw = execFileSync('aws', ['logs', 'filter-log-events', '--region', region, '--log-group-name', group, '--start-time', String(from), ...extra, ...(next ? ['--next-token', next] : []), '--output', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const page1 = JSON.parse(raw) as { events?: { message: string; timestamp: number }[]; nextToken?: string };
        out.push(...(page1.events ?? []));
        next = page1.nextToken;
      } while (next);
      return out;
    };
    const until = Date.now() + 5 * 60_000;
    let success: { message: string; timestamp: number } | undefined;
    while (!success && Date.now() < until) {
      success = read(['--filter-pattern', '"Token vote submitted successfully"']).find((e) => e.message.includes(ids['candidate']!));
      if (!success) await new Promise((r) => setTimeout(r, 15_000));
    }
    expect(success, 'the vote\'s "Token vote submitted successfully" line reached the log group within 5 minutes').toBeTruthy();
    const lines = read([]).map((e) => e.message);
    expect(lines.length, 'the window holds the vote\'s lines').toBeGreaterThan(0);
    const pieces = runsOf(formsOf(token));
    const found = lines.filter((l) => pieces.some((p) => l.includes(p))).map((l) => l.slice(0, 200));
    expect(found, 'no line of the log group in that window holds the token, its SHA-256 (hex or base64url) or any 12-character run of them').toEqual([]);
  });
});
