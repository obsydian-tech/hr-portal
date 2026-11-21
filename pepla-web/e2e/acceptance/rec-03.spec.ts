import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { LAMBDA, REPO, runModule, type Tables } from './support/rec-03/lambda-harness';
import { STACKS, filesOf, lambdaNamed, policyLines, resourcesOf, roleResourceOf, type Stack } from './support/rec-03/iam';
import { blocks, attributes } from './support/infra-harness';
import { A, B, ID, SUB, TABLE, ask, av, bodyOf, describe, isModulesRead, plain, rowsOf, runEvent, statusOf } from './support/rec-03/world';
import { C } from './support/rec-03/callers';
import {
  CORE, HANDLER, LIVE, LIVE_OFFER, M, MAP, MIGRATE, NAMES, OLD_NAMES, ROLE_ID, ROUTE, SIX, STAGES_FILE,
  anyWrite, awsOf, byLevel, call, candidate, changedRows, eventsOf, hist, history, iv, logsOf, migrate, move, newHistory, normalise,
  read, recruitmentCode, sagaOf, update, withDecider, withRequired, withScreening, world,
} from './support/rec-03/move';

/**
 * REC-03 · Six stages, a reason on every move, and the old rows moved over (Jira NH-237, epic NH-234). Amber.
 * One test per acceptance criterion, written from the card before any code. Spec: /mnt/project-files/onboarding-cards/specs/REC-03.md,
 * read with REC-00.md. Notes: cards/rec-03.md and onboarding-cards/specs/REC-03-tests-for-review.md (the bar: "What these tests must catch").
 *
 * The Lambda tests run the real handlers, the real shared files and the real migration script, each call in a fresh Node process, against a
 * fake AWS (support/rec-03/fake-aws, REC-02's copy, unchanged). Companies A and B both hold the Standard pack (written by the real pack
 * script); the card's rows are in support/rec-03/move.ts. AC-1, AC-6 and AC-10 also read code and Terraform as text. AC-11 runs on
 * pepla-dev only (@pepla-dev). Nothing calls AWS or any AI.
 *
 * Pinned by the verifier where the card is silent (each is in cards/rec-03.md for the BA to confirm, D-T-1 to D-T-16):
 *  - D-T-1 Moves stay on PUT /v1/candidates/{id}/stage (advanceCandidateStage); its core is moveCandidate in
 *    lambda/shared/recruitment-actions/move-candidate.mjs (REC-00 rule 4).
 *  - D-T-2 normaliseStage lives in lambda/shared/recruitment-stages.mjs next to STAGE_CODES. It takes a stage or a candidate row
 *    ({ currentStage, status }) and gives one of the six codes. It also maps the three older names today's code still holds
 *    (PHONE_SCREENING to SCREENING, TECHNICAL_INTERVIEW and PANEL_INTERVIEW to INTERVIEW), as REC-02 does. The file exports no list or
 *    map that holds an old name.
 *  - D-T-3 The one-list text check covers every Lambda of the TalentFlow stack (its own folder), the Recruitment shared files
 *    (recruitment-*.mjs, recruitment-actions/, config-reader.js, tf-*.js) and the Standard pack seed. Comments, tests, packages and the
 *    one-off scripts at the top of lambda/ are left out. Old names may stay only in recruitment-stages.mjs and the migration script.
 *  - D-T-4 The body is { to, reason }. A `to` that is not one of the six codes (an old name, lower case, unknown, missing) is 400 (code not
 *    pinned). A reason that is missing, not text, only spaces, or over 1000 characters is 400 REASON_REQUIRED.
 *  - D-T-5 With Screening off the list is Applied, Interview, Offer: Applied moves to Interview, Interview moves back to Applied, and a move
 *    to Screening is 400.
 *  - D-T-6 A move to the stage the candidate is in, and two steps back, are 400 (code not pinned).
 *  - D-T-7 A manager who is not the candidate's hiring manager gets 403 or 404 (not pinned); nothing is written.
 *  - D-T-8 The history row stays where today's is (state table, SK STAGE#...). Its fields may carry the card's names (from, to, by, at) or
 *    today's (fromStage, toStage, actor, timestamp); `reason`, `by_kind` = PERSON and tenant_id are on it. The reason text is stored on
 *    that row only: not on the candidate's row, not in any event, not in the logs.
 *  - D-T-9 getCandidateEvents lists each move with its from and to (under from/to or fromStage/toStage, at the top or in `detail`) and who
 *    moved (by or actor), oldest first. A Recruiter and the hiring manager see the reason; a panel member sees the move without it (the
 *    REC-02 review: free text must not reach panel members or Ask Batsi).
 *  - D-T-10 One CandidateMoved per move. Another event (today's StageAdvanced) may still be sent, but none is EvaluationCompleted and none
 *    carries the reason.
 *  - D-T-11 "createOffer has no event entry point" is judged in createOffer: an EvaluationCompleted event writes, starts and sends
 *    nothing. The Terraform rule that still points the event at createOffer may stay: removing it is a delete, which waits for Iggie.
 *  - D-T-12 The level is today's positionLevel. It is locked (409 LEVEL_LOCKED) in Interview, Offer and Hired (stored old names count
 *    through normaliseStage), and in Applied or Screening once any interview row exists. Other fields stay editable.
 *  - D-T-13 The migration script follows scripts/tenancy/move-default.mjs: --env dev|prod, --tenant, dry run by default, --apply,
 *    --check; the account is checked against --env before anything is read; a prod --apply also needs --prod-account 937137806477. It
 *    reads every page. "The old rejection time" is evaluationCompletedAt (the time today's code stored with REJECTED). The row keeps
 *    status; only currentStage (and updatedAt) of its old fields change. The history row carries reason_code STAGE_LIST_CHANGE and no
 *    reason text.
 *  - D-T-14 The dry run prints the number of rows it would move.
 *  - D-T-15 CandidateMoved's role_id is the candidate's role_id (null when it has none), as REC-02's event does.
 *  - D-T-16 Batsi's pipeline overview filters and counts by the six codes: a stored old name is read through normaliseStage, and the
 *    tool's own description names no old stage and no REJECTED.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const FORBIDDEN = { error: 'Forbidden' };
const NOT_FOUND = { error: 'Not found' };
const conflict = (code: string) => ({ error: 'Conflict', code });
const bad = (code: string) => ({ error: 'Bad request', code });
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const answer = (r: any) => [statusOf(r), bodyOf(r)];
const REASON = 'Spoke to her on 3 May about the night shift';
const REASON2 = 'Second look: the bakery manager wants to meet again';

// ---------------------------------------------------------------- small helpers

/** JavaScript with comments blanked out; strings kept (as rec-02.spec.ts). */
function stripJs(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const two = src.slice(i, i + 2);
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (two === '//') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else { out += c; i++; }
  }
  return out;
}
const code = (path: string) => (existsSync(path) ? stripJs(readFileSync(path, 'utf8')) : '');
/** The code files of a Lambda's own folder (tests and packages left out). */
const folderFiles = (name: string) => (existsSync(join(LAMBDA, name)) ? readdirSync(join(LAMBDA, name)).filter((f) => /\.(m?js|cjs)$/.test(f) && !/\.test\./.test(f)).map((f) => join(LAMBDA, name, f)) : []);
/** The old names a piece of code uses (whole names only: EVALUATION_FAILED is not EVALUATION). */
const oldNamesIn = (src: string) => OLD_NAMES.filter((n) => new RegExp(`(?<![A-Za-z0-9_])${n}(?![A-Za-z0-9_])`).test(src));

/** Every row of the world whose stored stage is a closed or old one, normalised as the card's table says. */
const expectedStage = (r: Record<string, any>) => (['REJECTED', 'EVALUATION_FAILED'].includes(r['status']) ? 'NOT_HIRED' : SIX.includes(r['currentStage']) ? r['currentStage'] : MAP[r['currentStage']]);
const sagas = (t: Tables, company: string) => rowsOf(t, TABLE.state).filter((r) => r['SK'] === 'SAGA' && r['tenant_id'] === company);

/** The full check of one good move: rule 2 and rule 4, D-T-8, D-T-10 and D-T-15. */
function judgeMove(label: string, before: Tables, r: any, o: { id: string; from: string; to: string; reason: string; by: string; company?: string; roleId?: string | null }) {
  const company = o.company ?? A;
  expect.soft(statusOf(r), `${label}: 200 (${describe(r)})`).toBe(200);
  const s = sagaOf(r.tables, o.id) ?? {};
  expect.soft(s['currentStage'], `${label}: the stage is now ${o.to}`).toBe(o.to);
  expect.soft(JSON.stringify(s), `${label}: the reason is not stored on the candidate's row (D-T-8)`).not.toContain(o.reason);
  const h = newHistory(before, r.tables, o.id);
  expect.soft(h.length, `${label}: one new history row`).toBe(1);
  const f = hist(h[0] ?? {});
  expect.soft([f.from, f.to, f.by], `${label}: the history row says from, to and who (the sign-in's person id)`).toEqual([o.from, o.to, o.by]);
  expect.soft(String(f.at ?? ''), `${label}: and when`).toMatch(ISO);
  expect.soft([h[0]?.['reason'], h[0]?.['by_kind'], h[0]?.['tenant_id']], `${label}: the history row holds the reason, by_kind PERSON and the company`).toEqual([o.reason, 'PERSON', company]);
  const moved = eventsOf(r).filter((e) => e.detailType === 'CandidateMoved');
  expect.soft(moved.length, `${label}: one CandidateMoved event`).toBe(1);
  const d = moved[0]?.detail ?? {};
  expect.soft(Object.keys(d).sort(), `${label}: CandidateMoved carries exactly tenant_id, candidate_id, role_id, from, to, by, at`).toEqual(['at', 'by', 'candidate_id', 'from', 'role_id', 'tenant_id', 'to']);
  expect.soft([d['tenant_id'], d['candidate_id'], d['role_id'], d['from'], d['to'], d['by']], `${label}: CandidateMoved's values`).toEqual([company, o.id, o.roleId === undefined ? ROLE_ID : o.roleId, o.from, o.to, o.by]);
  expect.soft(String(d['at'] ?? ''), `${label}: CandidateMoved's at is a time`).toMatch(ISO);
  expect.soft(eventsOf(r).filter((e) => e.detailType === 'EvaluationCompleted').length, `${label}: no EvaluationCompleted is published (rule 3)`).toBe(0);
  expect.soft(JSON.stringify(eventsOf(r)), `${label}: no event carries the reason`).not.toContain(o.reason);
  expect.soft(logsOf(r).join('\n'), `${label}: the logs do not carry the reason`).not.toContain(o.reason);
  const others = changedRows(before, r.tables).filter((x) => x['PK'] !== `CANDIDATE#${o.id}`);
  expect.soft(others.map((x) => `${x['PK']} ${x['SK']}`), `${label}: no other candidate's rows change`).toEqual([]);
  // The reason lives on the one history row only (D-T-8): of this candidate's rows only SAGA and that row change, no other table changes,
  // and no other write (any table, queue, mail, function or state machine) carries the reason.
  const own = changedRows(before, r.tables).filter((x) => x['PK'] === `CANDIDATE#${o.id}`);
  expect.soft(own.filter((x) => x['SK'] !== 'SAGA' && !String(x['SK']).startsWith('STAGE#')).map((x) => x['SK']), `${label}: only the candidate's row and its history row change`).toEqual([]);
  expect.soft(own.filter((x) => !String(x['SK']).startsWith('STAGE#') && JSON.stringify(x).includes(o.reason)).length, `${label}: no changed row but the history row holds the reason`).toBe(0);
  for (const tb of [...new Set([...Object.keys(before), ...Object.keys(r.tables)])].filter((x) => x !== TABLE.state)) {
    expect.soft(JSON.stringify(r.tables[tb] ?? []), `${label}: ${tb} does not change`).toBe(JSON.stringify(before[tb] ?? []));
  }
  expect.soft(anyWrite(r).filter((c: any) => c.service !== 'dynamodb' && JSON.stringify(c).includes(o.reason)).map((c: any) => `${c.service} ${c.op}`), `${label}: no message, mail, function or state machine call carries the reason`).toEqual([]);
}
/** The check of one refused move: the answer, nothing written, the candidate unchanged. */
function refused(label: string, before: Tables, r: any, id: string, want: [number, unknown] | [number]) {
  if (want.length === 2) expect.soft(answer(r), `${label}: ${want[0]} ${JSON.stringify(want[1])} (${describe(r)})`).toEqual(want);
  else expect.soft(statusOf(r), `${label}: ${want[0]} (${describe(r)})`).toBe(want[0]);
  expect.soft(anyWrite(r).map((c: any) => `${c.service} ${c.op} ${c.table ?? ''}`), `${label}: nothing is written or sent`).toEqual([]);
  expect.soft(sagaOf(r.tables, id)?.['currentStage'], `${label}: the candidate stays where it was`).toBe(sagaOf(before, id)?.['currentStage']);
  expect.soft(newHistory(before, r.tables, id).length, `${label}: no history row`).toBe(0);
}
/** The moves getCandidateEvents lists (D-T-9), in its order: { from, to, by, text }. */
function movesIn(body: any): { from: string; to: string; by: unknown; text: string }[] {
  const list: any[] = Array.isArray(body?.events) ? body.events : Array.isArray(body) ? body : [];
  const out: { from: string; to: string; by: unknown; text: string }[] = [];
  for (const e of list) {
    const o = { ...(e && typeof e.detail === 'object' ? e.detail : {}), ...e };
    const from = o.from ?? o.fromStage ?? o.previousStage;
    const to = o.to ?? o.toStage ?? o.newStage;
    if (SIX.includes(from) && SIX.includes(to)) out.push({ from, to, by: o.by ?? o.actor ?? o.detail?.by, text: JSON.stringify(e) });
  }
  return out;
}

// ---------------------------------------------------------------- tests

test.describe('REC-03 · Six stages, a reason on every move, and the old rows moved over', () => {
  test('Control: the world is good: the candidates read, B cannot read A, the move route runs and the pack is there', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const own = ask('getCandidate', C.recruiter, { path: { id: M.applied } }, { tables: t });
    expect.soft(statusOf(own), `A's Recruiter reads A's candidate (${describe(own)})`).toBe(200);
    const other = ask('getCandidate', C.recruiterB, { path: { id: M.applied } }, { tables: t });
    expect.soft(statusOf(other), 'B\'s Recruiter gets 404 for A\'s candidate').toBe(404);
    const r = move(C.recruiter, M.applied, { to: 'SCREENING', reason: REASON }, t);
    expect.soft(r.error, `the move route runs without throwing (${describe(r)})`).toBeUndefined();
    expect.soft(rowsOf(t, TABLE.config).some((x) => x['PK'] === `TENANT#${A}` && String(x['SK']).startsWith('CONFIG#STAGE_CONFIG#v1')), 'company A has STAGE_CONFIG from the Standard pack').toBe(true);
    expect.soft(rowsOf(t, TABLE.config).some((x) => x['PK'] === `TENANT#${B}` && String(x['SK']).startsWith('CONFIG#INTERVIEW_TYPES#v1')), 'company B has INTERVIEW_TYPES from the Standard pack').toBe(true);
  });

  // ---------------------------------------------------------------- AC-1

  test('AC-1 One list: old stage names only in normaliseStage and the migration script; the shared file maps every old name; Batsi filters by the six', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(3 * 60_000);
    // The text check can fail: a planted old name is found, a comment is not, a longer name is not.
    expect(oldNamesIn(stripJs("const s = 'INTERVIEWING';")), 'the check finds a planted old name').toEqual(['INTERVIEWING']);
    expect(oldNamesIn(stripJs('// INTERVIEWING was the old name\nconst s = 1;')), 'a comment is not code').toEqual([]);
    expect(oldNamesIn("status === 'EVALUATION_FAILED'"), 'EVALUATION_FAILED is not EVALUATION').toEqual([]);
    // What the check reads (D-T-3): every Recruitment Lambda's folder, the Recruitment shared files and the pack seed.
    const files = recruitmentCode();
    const rel = files.map((f) => f.slice(REPO.length + 1));
    expect.soft(files.length, 'the check reads the Recruitment code (more than 40 files)').toBeGreaterThan(40);
    for (const must of ['lambda/advanceCandidateStage/index.js', 'lambda/updateCandidate/index.js', 'lambda/talentFlowAiChat/tool-resolver.mjs', 'lambda/getIntelligenceTiles/index.js', 'lambda/shared/config-reader.js', 'scripts/tenancy/module-seeds/recruitment.mjs']) {
      expect.soft(rel, `the check reads ${must}`).toContain(must);
    }
    const hits = files.filter((f) => f !== STAGES_FILE).map((f) => ({ file: f.slice(REPO.length + 1), names: oldNamesIn(code(f)) })).filter((h) => h.names.length);
    expect.soft(hits, 'no Recruitment code outside lambda/shared/recruitment-stages.mjs (and the migration script) names an old stage (rule 1)').toEqual([]);

    // The shared file: STAGE_CODES, and normaliseStage for every old name, every code and a row (D-T-2).
    const values: unknown[] = [
      ...OLD_NAMES, ...SIX,
      { currentStage: 'INTERVIEWING', status: 'ACTIVE' }, { currentStage: 'EVALUATION', status: 'REJECTED' }, { currentStage: 'APPLICATION_REVIEW', status: 'EVALUATION_FAILED' },
      { currentStage: 'OFFER_DELIVERY' }, { currentStage: 'APPLIED', status: 'ACTIVE' }, { currentStage: 'NOT_HIRED', status: 'REJECTED' },
    ];
    const want = [...OLD_NAMES.map((n) => MAP[n]), ...SIX, 'INTERVIEW', 'NOT_HIRED', 'NOT_HIRED', 'OFFER', 'APPLIED', 'NOT_HIRED'];
    const n = normalise(values);
    expect(n.importError, `recruitment-stages.mjs loads (${n.importError?.message})`).toBeUndefined();
    expect.soft(n.exports, 'recruitment-stages.mjs exports normaliseStage and STAGE_CODES').toEqual(expect.arrayContaining(['normaliseStage', 'STAGE_CODES']));
    values.forEach((v, i) => expect.soft(n.results[i]?.value, `normaliseStage(${JSON.stringify(v)})`).toBe(want[i]));
    const ex = runModule(n.exports.map((e) => ({ get: e })), { module: STAGES_FILE });
    expect.soft(ex.results.find((_x, i) => n.exports[i] === 'STAGE_CODES')?.value, 'STAGE_CODES is the six codes in order').toEqual(SIX);
    n.exports.forEach((e, i) => {
      if (e === 'normaliseStage') return;
      expect.soft(oldNamesIn(JSON.stringify(ex.results[i]?.value ?? null)), `recruitment-stages.mjs export ${e} holds no old name (only normaliseStage knows them)`).toEqual([]);
    });
    // Handlers, tools and filters import the one list.
    for (const [what, src] of [
      ['advanceCandidateStage (or its core)', folderFiles(HANDLER).map(code).join('\n') + code(CORE)],
      ['updateCandidate', folderFiles('updateCandidate').map(code).join('\n')],
      ['tool-resolver.mjs', code(join(LAMBDA, 'talentFlowAiChat', 'tool-resolver.mjs'))],
    ] as const) expect.soft(src, `${what} imports lambda/shared/recruitment-stages.mjs`).toMatch(/recruitment-stages\.mjs/);

    // Batsi's pipeline overview (D-T-16): filters and counts by the six codes, old names read as new, company A only.
    const t = world();
    const TOOLS = join(LAMBDA, 'talentFlowAiChat', 'tool-resolver.mjs');
    const ask1 = (args: Record<string, unknown>, company = A) => runModule([{ fn: 'resolveToolCall', args: ['get_pipeline_overview', args, { tenantId: company, userId: SUB.recA }] }], { module: TOOLS, tables: t, env: { STATE_TABLE_NAME: TABLE.state, CONFIG_TABLE_NAME: TABLE.config, TENANTS_TABLE: 'naleko-people-dev-tenants' } });
    const aRows = sagas(t, A);
    const all = ask1({});
    const overview = all.results[0]?.value ?? {};
    expect.soft(all.results[0]?.ok, `the overview answers (${JSON.stringify(all.results[0]?.error ?? '')})`).toBe(true);
    expect.soft(Object.keys(overview.stageSummary ?? {}).filter((k) => !SIX.includes(k)), 'the stage counts use only the six codes').toEqual([]);
    expect.soft((overview.candidates ?? []).map((c: any) => c.currentStage).filter((s: string) => !SIX.includes(s)), 'every candidate it hands back is in one of the six').toEqual([]);
    expect.soft((overview.candidates ?? []).filter((c: any) => c.tenant_id !== A).map((c: any) => c.candidateId), 'only company A\'s candidates').toEqual([]);
    for (const stage of ['INTERVIEW', 'OFFER', 'NOT_HIRED', 'APPLIED']) {
      const one = ask1({ stage }).results[0]?.value ?? {};
      const want2 = aRows.filter((r) => expectedStage(r) === stage).map((r) => r['candidateId']).sort();
      expect.soft((one.candidates ?? []).map((c: any) => c.candidateId).sort(), `the filter ${stage} finds the candidates in ${stage}, stored old names included`).toEqual(want2);
      expect.soft(want2.length, `the world holds candidates in ${stage}`).toBeGreaterThan(0);
    }
    const b = ask1({ stage: 'INTERVIEW' }, B).results[0]?.value ?? {};
    expect.soft((b.candidates ?? []).map((c: any) => c.candidateId), 'company B\'s overview holds only B\'s candidate').toEqual([M.b]);
    const defs = runModule([{ get: 'TOOL_DEFINITIONS' }], { module: TOOLS, tables: t }).results[0]?.value ?? [];
    const def = JSON.stringify((defs as any[]).find((d) => d.name === 'get_pipeline_overview') ?? {});
    expect.soft(def, 'the tool is defined').toContain('get_pipeline_overview');
    expect.soft([...oldNamesIn(def), ...(/(?<![A-Z_])REJECTED(?![A-Z_])/.test(def) ? ['REJECTED'] : [])], 'its description names no old stage and no REJECTED').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 Forward moves: one step at a time with a reason; a skip is NOT_NEXT_STAGE; no reason is REASON_REQUIRED; with Screening off Applied goes to Interview', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const t = world();
    // Each forward step, by a Recruiter, from the six codes and from stored old names (the new code is written).
    for (const [id, from, to] of [
      [M.applied, 'APPLIED', 'SCREENING'], [M.screening, 'SCREENING', 'INTERVIEW'], [M.interview, 'INTERVIEW', 'OFFER'],
      [M.oldApp, 'APPLIED', 'SCREENING'], [M.oldInt, 'INTERVIEW', 'OFFER'], [M.oldEval, 'INTERVIEW', 'OFFER'],
    ] as const) {
      judgeMove(`${sagaOf(t, id)?.['currentStage']} to ${to}`, t, move(C.recruiter, id, { to, reason: REASON }, t), { id, from, to, reason: REASON, by: SUB.recA });
    }
    // One candidate all the way: each move starts from the stage the last one wrote.
    const r1 = move(C.recruiter, M.applied, { to: 'SCREENING', reason: REASON }, t);
    const r2 = move(C.recruiter2, M.applied, { to: 'INTERVIEW', reason: REASON2 }, r1.tables);
    judgeMove('Applied, Screening, then Interview', r1.tables, r2, { id: M.applied, from: 'SCREENING', to: 'INTERVIEW', reason: REASON2, by: 'sub-rec2-a' });
    // Skips (D-REC-3.2).
    for (const [id, to] of [[M.applied, 'INTERVIEW'], [M.applied, 'OFFER'], [M.screening, 'OFFER'], [M.oldApp, 'INTERVIEW']] as const) {
      refused(`a skip from ${sagaOf(t, id)?.['currentStage']} to ${to}`, t, move(C.recruiter, id, { to, reason: REASON }, t), id, [400, bad('NOT_NEXT_STAGE')]);
    }
    // The reason (rule 2, D-T-4).
    for (const [what, body] of [
      ['no reason', { to: 'SCREENING' }], ['an empty reason', { to: 'SCREENING', reason: '' }], ['a reason of spaces', { to: 'SCREENING', reason: '   ' }],
      ['a reason of 1001 characters', { to: 'SCREENING', reason: 'x'.repeat(1001) }], ['a reason that is a number', { to: 'SCREENING', reason: 42 }], ['a reason that is null', { to: 'SCREENING', reason: null }],
    ] as const) refused(what, t, move(C.recruiter, M.applied, body, t), M.applied, [400, bad('REASON_REQUIRED')]);
    const long = 'y'.repeat(1000);
    judgeMove('a reason of exactly 1000 characters', t, move(C.recruiter, M.applied, { to: 'SCREENING', reason: long }, t), { id: M.applied, from: 'APPLIED', to: 'SCREENING', reason: long, by: SUB.recA });
    // `to` must be one of the six codes (D-T-4); today's body ({ newStage }) is not a move; the same stage is not a move (D-T-6).
    for (const [what, body] of [
      ['an old name', { to: 'PHONE_SCREENING', reason: REASON }], ['lower case', { to: 'screening', reason: REASON }], ['an unknown code', { to: 'NOPE', reason: REASON }],
      ['no to', { reason: REASON }], ['today\'s body', { newStage: 'SCREENING', reason: REASON }], ['the same stage', { to: 'APPLIED', reason: REASON }],
    ] as const) refused(`to: ${what}`, t, move(C.recruiter, M.applied, body, t), M.applied, [400]);
    // Screening off (STAGE_CONFIG screening false): Applied moves to Interview; Screening is not a stage (D-T-5).
    const off = withScreening(world(), false);
    judgeMove('Screening off: Applied to Interview', off, move(C.recruiter, M.applied, { to: 'INTERVIEW', reason: REASON }, off), { id: M.applied, from: 'APPLIED', to: 'INTERVIEW', reason: REASON, by: SUB.recA });
    judgeMove('Screening off: a stored APPLICATION_REVIEW to Interview', off, move(C.recruiter, M.oldApp, { to: 'INTERVIEW', reason: REASON }, off), { id: M.oldApp, from: 'APPLIED', to: 'INTERVIEW', reason: REASON, by: SUB.recA });
    refused('Screening off: Applied to Screening', off, move(C.recruiter, M.applied, { to: 'SCREENING', reason: REASON }, off), M.applied, [400]);
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 Move back: one step back with a reason for a Recruiter; two steps is refused; back out of Offer with a live offer is OFFER_LIVE', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const t = world();
    for (const [id, from, to] of [
      [M.screening, 'SCREENING', 'APPLIED'], [M.interview, 'INTERVIEW', 'SCREENING'], [M.offer, 'OFFER', 'INTERVIEW'],
      [M.offerDraft, 'OFFER', 'INTERVIEW'], [M.oldOffer, 'OFFER', 'INTERVIEW'], [M.oldInt, 'INTERVIEW', 'SCREENING'],
    ] as const) {
      judgeMove(`back from ${sagaOf(t, id)?.['currentStage']} to ${to}`, t, move(C.recruiter, id, { to, reason: REASON }, t), { id, from, to, reason: REASON, by: SUB.recA });
    }
    refused('back without a reason', t, move(C.recruiter, M.screening, { to: 'APPLIED' }, t), M.screening, [400, bad('REASON_REQUIRED')]);
    // Two steps or more (D-T-6).
    for (const [id, to] of [[M.interview, 'APPLIED'], [M.offer, 'SCREENING'], [M.offer, 'APPLIED'], [M.oldOffer, 'SCREENING']] as const) {
      refused(`two steps back, ${sagaOf(t, id)?.['currentStage']} to ${to}`, t, move(C.recruiter, id, { to, reason: REASON }, t), id, [400]);
    }
    // A live offer holds the candidate in Offer.
    for (const s of LIVE_OFFER) refused(`back out of Offer with an offer ${s}`, t, move(C.recruiter, LIVE[s]!, { to: 'INTERVIEW', reason: REASON }, t), LIVE[s]!, [409, conflict('OFFER_LIVE')]);
    // Before the migration, a candidate may still be stored under an old offer name (prod looks like this): its live offer still blocks the move back.
    refused('back out of a stored OFFER_APPROVAL with an offer WAITING_APPROVAL', t, move(C.recruiter, M.oldOfferLive, { to: 'INTERVIEW', reason: REASON }, t), M.oldOfferLive, [409, conflict('OFFER_LIVE')]);
    // Only a Recruiter moves back: the hiring manager may not, even under HR_OR_HM.
    for (const [id, to] of [[M.offer, 'INTERVIEW'], [M.screening, 'APPLIED'], [M.interview, 'SCREENING']] as const) {
      refused(`the hiring manager moves back to ${to}`, t, move(C.hmC1, id, { to, reason: REASON }, t), id, [403, FORBIDDEN]);
    }
    // Screening off: one step back from Interview is Applied; Screening is not a stage (D-T-5).
    const off = withScreening(world(), false);
    judgeMove('Screening off: back from Interview to Applied', off, move(C.recruiter, M.interview, { to: 'APPLIED', reason: REASON }, off), { id: M.interview, from: 'INTERVIEW', to: 'APPLIED', reason: REASON, by: SUB.recA });
    refused('Screening off: back from Interview to Screening', off, move(C.recruiter, M.interview, { to: 'SCREENING', reason: REASON }, off), M.interview, [400]);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Closed stages: a move to Hired or Not hired is USE_ACTION; a Hired or Not hired candidate cannot be moved (NOT_OPEN)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    for (const [id, to] of [[M.offer, 'HIRED'], [M.interview, 'NOT_HIRED'], [M.applied, 'NOT_HIRED'], [M.oldOffer, 'HIRED']] as const) {
      refused(`${sagaOf(t, id)?.['currentStage']} to ${to}`, t, move(C.recruiter, id, { to, reason: REASON }, t), id, [400, bad('USE_ACTION')]);
    }
    for (const [id, to] of [
      [M.hired, 'OFFER'], [M.notHired, 'APPLIED'], [M.notHired, 'SCREENING'], [M.oldHired, 'OFFER'], [M.oldRejected, 'OFFER'], [M.oldRejected, 'SCREENING'],
    ] as const) {
      const s = sagaOf(t, id) ?? {};
      refused(`a candidate in ${s['currentStage']}${s['status'] === 'ACTIVE' ? '' : ` (${s['status']})`} to ${to}`, t, move(C.recruiter, id, { to, reason: REASON }, t), id, [409, conflict('NOT_OPEN')]);
    }
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 The gate: Interview to Offer needs the level\'s required interviews done; the hiring manager passes under HR_OR_HM and not under HR_ONLY; a panel member is refused', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const t = world();
    const toOffer = (who: any, id: string, w: Tables = t, opts = {}) => move(who, id, { to: 'OFFER', reason: REASON }, w, {}, opts);
    // The required list of the candidate's level, from the company's INTERVIEW_TYPES (MID: PHONE_SCREEN and TECHNICAL; JUNIOR:
    // PHONE_SCREEN; SENIOR: also BEHAVIORAL). Only COMPLETED interviews of the candidate's own company count.
    for (const [id, what] of [[M.pending, 'MID, TECHNICAL still scheduled'], [M.cancelled, 'MID, TECHNICAL cancelled'], [M.senior, 'SENIOR, no BEHAVIORAL'], [M.foreignIv, 'MID, the TECHNICAL row is another company\'s']] as const) {
      refused(`Interview to Offer, ${what}`, t, toOffer(C.recruiter, id), id, [409, conflict('INTERVIEWS_INCOMPLETE')]);
    }
    judgeMove('JUNIOR with PHONE_SCREEN done', t, toOffer(C.recruiter, M.junior), { id: M.junior, from: 'INTERVIEW', to: 'OFFER', reason: REASON, by: SUB.recA });
    judgeMove('MID with both done, by a second Recruiter', t, toOffer(C.recruiter2, M.interview), { id: M.interview, from: 'INTERVIEW', to: 'OFFER', reason: REASON, by: 'sub-rec2-a' });
    judgeMove('the required interviews on a second page', t, toOffer(C.recruiter, M.paged, t, { queryPageSize: 2 }), { id: M.paged, from: 'INTERVIEW', to: 'OFFER', reason: REASON, by: SUB.recA });
    // The list is the company's setting, not a fixed one.
    const lighter = withRequired(world(), { MID: ['PHONE_SCREEN'] });
    judgeMove('MID needs only PHONE_SCREEN in this company', lighter, toOffer(C.recruiter, M.pending, lighter), { id: M.pending, from: 'INTERVIEW', to: 'OFFER', reason: REASON, by: SUB.recA });
    const heavier = withRequired(world(), { MID: ['PHONE_SCREEN', 'TECHNICAL', 'CULTURE_FIT'] });
    refused('MID also needs CULTURE_FIT in this company', heavier, toOffer(C.recruiter, M.interview, heavier), M.interview, [409, conflict('INTERVIEWS_INCOMPLETE')]);

    // Who may make this move (canDecide): the hiring manager of the candidate under HR_OR_HM (the Standard pack's value).
    judgeMove('the hiring manager under HR_OR_HM', t, toOffer(C.hmC1, M.interview), { id: M.interview, from: 'INTERVIEW', to: 'OFFER', reason: REASON, by: SUB.hmA });
    refused('the hiring manager under HR_OR_HM, interviews not done', t, toOffer(C.hmC1, M.pending), M.pending, [409, conflict('INTERVIEWS_INCOMPLETE')]);
    const hrOnly = withDecider(world(), byLevel('HR_OR_HM', { MID: 'HR_ONLY' }));
    refused('the hiring manager under HR_ONLY', hrOnly, toOffer(C.hmC1, M.interview, hrOnly), M.interview, [403, FORBIDDEN]);
    judgeMove('a Recruiter under HR_ONLY', hrOnly, toOffer(C.recruiter, M.interview, hrOnly), { id: M.interview, from: 'INTERVIEW', to: 'OFFER', reason: REASON, by: SUB.recA });
    // The decider is read for the candidate's own level.
    const juniorOnly = withDecider(world(), byLevel('HR_OR_HM', { JUNIOR: 'HR_ONLY' }));
    refused('the hiring manager, JUNIOR under HR_ONLY', juniorOnly, toOffer(C.hmC1, M.junior, juniorOnly), M.junior, [403, FORBIDDEN]);
    judgeMove('the hiring manager, MID under HR_OR_HM in the same company', juniorOnly, toOffer(C.hmC1, M.interview, juniorOnly), { id: M.interview, from: 'INTERVIEW', to: 'OFFER', reason: REASON, by: SUB.hmA });
    // Everyone else is refused and nothing is written.
    for (const who of [C.panelA, C.employee, C.approver, C.adminOnly, C.guest, C.taClaim]) refused(`${who.name}`, t, toOffer(who, M.interview), M.interview, [403, FORBIDDEN]);
    const other = toOffer(C.hmOther, M.interview);
    expect.soft([403, 404], `a manager of another role is refused (D-T-7; ${describe(other)})`).toContain(statusOf(other));
    refused('a manager of another role', t, other, M.interview, [statusOf(other) ?? 0]);
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 No hidden trigger: no move publishes EvaluationCompleted, and an EvaluationCompleted event makes no offer', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    // Today's trigger was a move from EVALUATION: that move now publishes only CandidateMoved (judgeMove checks no EvaluationCompleted).
    judgeMove('a stored EVALUATION to Offer', t, move(C.recruiter, M.oldEval, { to: 'OFFER', reason: REASON }, t), { id: M.oldEval, from: 'INTERVIEW', to: 'OFFER', reason: REASON, by: SUB.recA });
    const mover = folderFiles(HANDLER).map(code).join('\n') + code(CORE);
    expect.soft(mover, 'advanceCandidateStage and its core never name EvaluationCompleted').not.toMatch(/EvaluationCompleted/);
    // createOffer has no event entry point (D-T-11): the event that used to make an offer writes, starts and sends nothing.
    for (const outcome of ['PASSED', undefined]) {
      const ev = { version: '0', id: 'ev-rec03', source: 'talent-flow.workflow', 'detail-type': 'EvaluationCompleted', detail: { candidateId: M.interview, tenant_id: A, tenantId: A, ...(outcome ? { outcome } : {}), configVersion: '1' } };
      const r = runEvent('createOffer', ev, { tables: t });
      expect.soft(anyWrite(r).map((c: any) => `${c.service} ${c.op} ${c.table ?? ''}`), `createOffer given EvaluationCompleted (${outcome ?? 'no outcome'}): nothing is written, started or sent`).toEqual([]);
      expect.soft(rowsOf(r.tables, TABLE.state).filter((x) => x['PK'] === `CANDIDATE#${M.interview}` && x['SK'] === 'OFFER').length, 'and no offer row exists').toBe(0);
    }
    expect.soft(folderFiles('createOffer').map(code).join('\n'), 'createOffer no longer names EvaluationCompleted').not.toMatch(/EvaluationCompleted/);
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 History and event: one history row per move with the caller\'s id, one CandidateMoved without the reason, getCandidateEvents in order', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(3 * 60_000);
    const t = world();
    // A body that names someone else, or another company, changes nothing about who moved (REC-00 rule 5).
    const intruder = { to: 'SCREENING', reason: REASON, by: 'sub-intruder', actor: 'sub-intruder', callerId: 'sub-intruder', userId: 'sub-intruder', decidedBy: 'sub-intruder', updatedBy: 'sub-intruder', by_kind: 'AGENT', tenantId: B, tenant_id: B };
    judgeMove('a body naming another person and company', t, move(C.recruiter, M.applied, intruder, t), { id: M.applied, from: 'APPLIED', to: 'SCREENING', reason: REASON, by: SUB.recA });
    // TEN-06's user_id claim is the person id when the sign-in carries one.
    judgeMove('a sign-in with user_id', t, move(C.recruiter, M.applied, { to: 'SCREENING', reason: REASON }, t, { claims: { user_id: 'tf-user-0042' } }), { id: M.applied, from: 'APPLIED', to: 'SCREENING', reason: REASON, by: 'tf-user-0042' });
    // The role id is the candidate's own; none when it has none (D-T-15).
    const noRole = structuredClone(t);
    noRole[TABLE.state] = noRole[TABLE.state]!.map((r) => (plain(r)['PK'] === `CANDIDATE#${M.screening}` && plain(r)['SK'] === 'SAGA' ? av({ ...plain(r), role_id: undefined }) : r));
    judgeMove('a candidate with no role id', noRole, move(C.recruiter, M.screening, { to: 'INTERVIEW', reason: REASON }, noRole), { id: M.screening, from: 'SCREENING', to: 'INTERVIEW', reason: REASON, by: SUB.recA, roleId: null });

    // getCandidateEvents: back then forward, by two people; the history lists both, oldest first, with who moved (D-T-9).
    const r1 = move(C.recruiter, M.interview, { to: 'SCREENING', reason: REASON }, t);
    const r2 = move(C.recruiter2, M.interview, { to: 'INTERVIEW', reason: REASON2 }, r1.tables);
    expect.soft([statusOf(r1), statusOf(r2)], `both moves are made (${describe(r1)} / ${describe(r2)})`).toEqual([200, 200]);
    const w = r2.tables;
    for (const [who, sees] of [[C.recruiter, true], [C.hmC1, true], [C.panelA, false]] as const) {
      const h = history(who, M.interview, w);
      expect.soft(statusOf(h), `${who.name} reads the history (${describe(h)})`).toBe(200);
      const moves = movesIn(bodyOf(h));
      const back = moves.findIndex((m) => m.from === 'INTERVIEW' && m.to === 'SCREENING');
      const fwd = moves.findIndex((m) => m.from === 'SCREENING' && m.to === 'INTERVIEW');
      expect.soft(back >= 0 && fwd >= 0, `${who.name}: both moves are listed (got ${JSON.stringify(moves).slice(0, 300)})`).toBe(true);
      expect.soft(back < fwd, `${who.name}: oldest first`).toBe(true);
      expect.soft([moves[back]?.by, moves[fwd]?.by], `${who.name}: each says who moved`).toEqual([SUB.recA, 'sub-rec2-a']);
      const text = JSON.stringify(bodyOf(h));
      if (sees) expect.soft(text.includes(REASON) && text.includes(REASON2), `${who.name}: the reasons are shown`).toBe(true);
      else expect.soft(text.includes(REASON) || text.includes(REASON2), `${who.name}: a panel member sees the moves without the reasons`).toBe(false);
    }
    const hb = history(C.recruiterB, M.interview, w);
    expect.soft(answer(hb), 'B\'s Recruiter: 404 for A\'s history').toEqual([404, NOT_FOUND]);
    // Ask Batsi never gets the reason (the REC-02 review): the candidate and the overview tools.
    const TOOLS = join(LAMBDA, 'talentFlowAiChat', 'tool-resolver.mjs');
    const env = { STATE_TABLE_NAME: TABLE.state, CONFIG_TABLE_NAME: TABLE.config, TENANTS_TABLE: 'naleko-people-dev-tenants' };
    const tools = runModule([
      { fn: 'resolveToolCall', args: ['get_candidate', { candidateId: M.interview }, { tenantId: A, userId: SUB.recA }] },
      { fn: 'resolveToolCall', args: ['get_pipeline_overview', {}, { tenantId: A, userId: SUB.recA }] },
    ], { module: TOOLS, tables: w, env });
    expect.soft(tools.results.map((x) => x.ok), 'both tools answer').toEqual([true, true]);
    expect.soft(JSON.stringify(tools.results).includes(REASON) || JSON.stringify(tools.results).includes(REASON2), 'no Batsi tool hands back a move\'s reason').toBe(false);
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Level lock: a level change is LEVEL_LOCKED in Interview and later and once there is an interview; allowed in Applied and Screening', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    for (const id of [M.interview, M.offer, M.hired, M.oldInt, M.oldEval, M.oldOffer, M.appliedIv]) {
      const r = update(C.recruiter, id, { positionLevel: 'SENIOR' }, t);
      const s = sagaOf(t, id) ?? {};
      expect.soft(answer(r), `a level change in ${s['currentStage']}${id === M.appliedIv ? ' with an interview' : ''}: 409 LEVEL_LOCKED (${describe(r)})`).toEqual([409, conflict('LEVEL_LOCKED')]);
      expect.soft(sagaOf(r.tables, id)?.['positionLevel'], 'the level stays MID').toBe('MID');
      expect.soft(anyWrite(r).length, 'nothing is written or sent').toBe(0);
    }
    for (const id of [M.applied, M.screening, M.oldApp]) {
      const r = update(C.recruiter, id, { positionLevel: 'SENIOR' }, t);
      expect.soft(statusOf(r), `a level change in ${sagaOf(t, id)?.['currentStage']} with no interview: 200 (${describe(r)})`).toBe(200);
      expect.soft(sagaOf(r.tables, id)?.['positionLevel'], 'the level is now SENIOR').toBe('SENIOR');
    }
    const other = update(C.recruiter, M.interview, { department: 'Night bakery' }, t);
    expect.soft(statusOf(other), `another field in Interview still changes (${describe(other)})`).toBe(200);
    expect.soft(sagaOf(other.tables, M.interview)?.['department'], 'the department is stored').toBe('Night bakery');
    expect.soft(sagaOf(other.tables, M.interview)?.['positionLevel'], 'and the level is untouched').toBe('MID');
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 Migration: dry run writes nothing, --apply maps as the table, old-system rows marked, a second apply changes nothing, other companies untouched, --check, normaliseStage agrees', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    // The fixture: every old name, REJECTED and EVALUATION_FAILED rows, rows already on the new codes, and company B's old rows.
    const t0 = world();
    const extra = [
      candidate('CAND-03MIG0000000000000PS1', { stage: 'PHONE_SCREENING', unlocked: true }),
      candidate('CAND-03MIG0000000000000TI1', { stage: 'TECHNICAL_INTERVIEW', unlocked: true }),
      candidate('CAND-03MIG0000000000000PI1', { stage: 'PANEL_INTERVIEW', unlocked: true }),
      ...['BACKGROUND_CHECK', 'OFFER_PREPARATION', 'OFFER_DELIVERY', 'PRE_BOARDING', 'ONBOARDING'].map((s, i) => candidate(`CAND-03MIG00000000000000${i}${s.slice(0, 2)}`, { stage: s, unlocked: true })),
      candidate('CAND-03MIG00000000000REJEV', { stage: 'EVALUATION', extra: { status: 'REJECTED', evaluationResult: 'FAILED', evaluationCompletedAt: '2026-09-14T10:00:00.000Z' } }),
      candidate('CAND-03MIG00000000000REJAP', { stage: 'APPLICATION_REVIEW', extra: { status: 'REJECTED', evaluationCompletedAt: '2026-09-15T10:00:00.000Z' } }),
      // Round 2: rejected rows in an old Hired stage are Not hired, never legacy_hired (stage before Not hired is HIRED).
      candidate('CAND-03MIG00000000000REJON', { stage: 'ONBOARDING', extra: { status: 'REJECTED', evaluationCompletedAt: '2026-09-17T10:00:00.000Z' } }),
      candidate('CAND-03MIG00000000000EFCS1', { stage: 'CONTRACT_SIGNING', extra: { status: 'EVALUATION_FAILED' } }),
      candidate('CAND-03MIG00000000000EVFIN', { stage: 'INTERVIEWING', extra: { status: 'EVALUATION_FAILED', votingResult: 'STRONG_NO_VETO' } }),
      candidate('CAND-03MIG00000000000BOLD1', { stage: 'INTERVIEWING', company: B }),
      candidate('CAND-03MIG00000000000BREJ1', { stage: 'EVALUATION', company: B, extra: { status: 'REJECTED', evaluationCompletedAt: '2026-09-16T10:00:00.000Z' } }),
    ];
    t0[TABLE.state] = [...t0[TABLE.state]!, ...extra];
    const before = sagas(t0, A);
    const oldOnes = before.filter((r) => r['decided_by_kind'] !== 'OLD_SYSTEM' && (!SIX.includes(r['currentStage']) || ['REJECTED', 'EVALUATION_FAILED'].includes(r['status'])));
    const newOnes = before.filter((r) => !oldOnes.includes(r));
    expect(oldOnes.length, 'the fixture holds old rows of A (every old name, REJECTED, EVALUATION_FAILED)').toBeGreaterThan(15);
    for (const name of OLD_NAMES) expect.soft(oldOnes.some((r) => r['currentStage'] === name), `the fixture holds a row in ${name}`).toBe(true);
    const NAMES_OUT = Object.values(NAMES).flat().filter((x) => x !== 'Rec-Three');
    const privateOut = (r: { stdout: string; stderr: string }) => NAMES_OUT.filter((x) => (r.stdout + r.stderr).includes(x)).concat(/@example\.test/.test(r.stdout + r.stderr) ? ['an email'] : []);
    const base = ['--env', 'dev', '--tenant', A];

    // Dry run (the default): nothing written, the count printed (D-T-14).
    const dry = migrate(base, t0);
    expect.soft(dry.code, `the dry run exits 0 (${(dry.stdout + dry.stderr).slice(-400)})`).toBe(0);
    expect.soft(dry.writes.length, 'the dry run writes nothing').toBe(0);
    expect.soft(dry.stdout, `the dry run prints how many rows it would move (${oldOnes.length})`).toMatch(new RegExp(`(?<![0-9])${oldOnes.length}(?![0-9])`));
    expect.soft(privateOut(dry), 'the dry run prints counts and ids only (no names or emails)').toEqual([]);
    // --check before: exit 1, nothing written.
    const check0 = migrate([...base, '--check'], t0);
    expect.soft([check0.code, check0.writes.length], `--check before the move exits 1 and writes nothing (${(check0.stdout + check0.stderr).slice(-300)})`).toEqual([1, 0]);

    // --apply.
    const started = Date.now();
    const ap = migrate([...base, '--apply'], t0);
    const ended = Date.now();
    expect(ap.code, `--apply exits 0 (${(ap.stdout + ap.stderr).slice(-600)})`).toBe(0);
    expect.soft(privateOut(ap), '--apply prints counts and ids only').toEqual([]);
    for (const old of oldOnes) {
      const id = old['candidateId'];
      const now = sagaOf(ap.tables, id) ?? {};
      const rejected = ['REJECTED', 'EVALUATION_FAILED'].includes(old['status']);
      const mapped = SIX.includes(old['currentStage']) ? old['currentStage'] : MAP[old['currentStage']];
      const label = `${old['currentStage']}${rejected ? ` (${old['status']})` : ''}`;
      expect.soft(now['currentStage'], `${label}: the stage is ${rejected ? 'NOT_HIRED' : mapped}`).toBe(rejected ? 'NOT_HIRED' : mapped);
      expect.soft(now['legacy_stage'], `${label}: legacy_stage keeps the old stage`).toBe(old['currentStage']);
      if (mapped === 'HIRED' && !rejected) expect.soft(now['legacy_hired'], `${label}: legacy_hired is true (no employee record is made)`).toBe(true);
      else expect.soft(now['legacy_hired'], `${label}: not marked legacy_hired`).not.toBe(true);
      if (rejected) {
        expect.soft([now['decided_by_kind'], now['stage_before_not_hired'], now['reason_code']], `${label}: OLD_SYSTEM, the mapped stage before, no reason code`).toEqual(['OLD_SYSTEM', mapped, undefined]);
        if (old['evaluationCompletedAt']) expect.soft(now['not_hired_at'], `${label}: not_hired_at is the old rejection time`).toBe(old['evaluationCompletedAt']);
        else {
          const at = Date.parse(String(now['not_hired_at'] ?? ''));
          expect.soft(at >= started - 1000 && at <= ended + 1000, `${label}: with no stored time, not_hired_at is the run time (${now['not_hired_at']})`).toBe(true);
        }
      } else expect.soft([now['decided_by_kind'], now['not_hired_at']], `${label}: not marked Not hired`).toEqual([undefined, undefined]);
      const kept = Object.keys(old).filter((k) => !['currentStage', 'updatedAt'].includes(k) && JSON.stringify(now[k]) !== JSON.stringify(old[k]));
      expect.soft(kept, `${label}: no other stored field changes (D-T-13)`).toEqual([]);
      const h = newHistory(t0, ap.tables, id);
      expect.soft(h.length, `${label}: one history row`).toBe(1);
      const f = hist(h[0] ?? {});
      expect.soft([f.from, f.to, h[0]?.['reason_code'], h[0]?.['tenant_id'], h[0]?.['reason']], `${label}: history from the old stage to the new, STAGE_LIST_CHANGE, the company, no sentence`).toEqual([old['currentStage'], now['currentStage'], 'STAGE_LIST_CHANGE', A, undefined]);
    }
    // Rows already on the new codes, every other row of A (interviews, offers) and every row of B: untouched.
    const changed = changedRows(t0, ap.tables);
    const moved = new Set(oldOnes.map((r) => `CANDIDATE#${r['candidateId']}`));
    expect.soft(changed.filter((r) => !(moved.has(r['PK']) && (r['SK'] === 'SAGA' || String(r['SK']).startsWith('STAGE#')))).map((r) => `${r['PK']} ${r['SK']}`), 'only the moved candidates\' rows and their new history rows change').toEqual([]);
    expect.soft(newOnes.length, 'the fixture holds rows already on the new codes').toBeGreaterThan(5);
    expect.soft(JSON.stringify(sagas(ap.tables, B)), 'company B\'s rows are untouched').toBe(JSON.stringify(sagas(t0, B)));
    for (const tb of Object.keys(t0).filter((x) => x !== TABLE.state)) expect.soft(JSON.stringify(ap.tables[tb] ?? []), `${tb} is untouched`).toBe(JSON.stringify(t0[tb] ?? []));

    // Read before the move through normaliseStage, the answer is the same as after it.
    const n = normalise(oldOnes.map((r) => ({ ...r })));
    oldOnes.forEach((r, i) => expect.soft(n.results[i]?.value, `normaliseStage before the move agrees with the moved row (${r['currentStage']} ${r['status']})`).toBe(sagaOf(ap.tables, r['candidateId'])?.['currentStage']));

    // A second apply changes nothing; --check after exits 0.
    const again = migrate([...base, '--apply'], ap.tables);
    expect.soft([again.code, again.writes.length], 'a second --apply exits 0 and writes nothing').toEqual([0, 0]);
    expect.soft(JSON.stringify(again.tables[TABLE.state]), 'and the table is the same').toBe(JSON.stringify(ap.tables[TABLE.state]));
    const check1 = migrate([...base, '--check'], ap.tables);
    expect.soft(check1.code, `--check after the move exits 0 (${(check1.stdout + check1.stderr).slice(-300)})`).toBe(0);
    expect.soft(check1.writes.length, '--check writes nothing').toBe(0);

    // REC-02's old-system list shows the moved REJECTED and EVALUATION_FAILED rows.
    const list = call(ROUTE.oldSystem, C.recruiter, {}, ap.tables);
    const listed = ((bodyOf(list)?.candidates ?? bodyOf(list) ?? []) as any[]).map((c) => c.candidate_id);
    for (const r of oldOnes.filter((x) => ['REJECTED', 'EVALUATION_FAILED'].includes(x['status']))) expect.soft(listed, `REC-02's list shows ${r['candidateId']}`).toContain(r['candidateId']);

    // One company at a time: --tenant B moves B only.
    const onlyB = migrate(['--env', 'dev', '--tenant', B, '--apply'], t0);
    expect.soft(onlyB.code, '--tenant B exits 0').toBe(0);
    expect.soft(JSON.stringify(sagas(onlyB.tables, A)), '--tenant B leaves A untouched').toBe(JSON.stringify(sagas(t0, A)));
    expect.soft(sagaOf(onlyB.tables, 'CAND-03MIG00000000000BOLD1')?.['currentStage'], '--tenant B moves B\'s INTERVIEWING row').toBe('INTERVIEW');
    // Refusals: no company; the wrong account for --env; a prod apply without --prod-account (D-T-13). Nothing written.
    const PROD = { Account: '937137806477', Arn: 'arn:aws:sts::937137806477:assumed-role/ops/rec03' };
    for (const [what, args, sts, noRead] of [
      ['no --tenant', ['--env', 'dev', '--apply'], undefined, false],
      ['--env prod on the dev account', ['--env', 'prod', '--tenant', A, '--apply', '--prod-account', '937137806477'], undefined, true],
      ['--env dev on the prod account', [...base, '--apply'], PROD, true],
      ['a prod --apply without --prod-account', ['--env', 'prod', '--tenant', A, '--apply'], PROD, false],
    ] as const) {
      const r = migrate([...args], t0, sts ? { sts } : {});
      expect.soft(r.code, `${what}: refused (non-zero exit)`).not.toBe(0);
      expect.soft(r.writes.length, `${what}: nothing written`).toBe(0);
      if (noRead) expect.soft(r.calls.filter((c: any) => c.service === 'dynamodb').length, `${what}: nothing read either`).toBe(0);
    }
    expect.soft(existsSync(MIGRATE), 'scripts/recruitment/migrate-stages.mjs exists').toBe(true);
  });

  // ---------------------------------------------------------------- AC-10

  test('AC-10 Company B and roles: each route is 404 for another company\'s candidate, a wrong role is 403 before any AWS call, and advanceCandidateStage gains no grant', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const t = world();
    // Company B on A's candidate: 404 on every route the card changes, nothing written; the company is never read from a request.
    const cases: [string, string, unknown][] = [[ROUTE.move, M.interview, { to: 'OFFER', reason: REASON }], [ROUTE.update, M.applied, { positionLevel: 'SENIOR' }], [ROUTE.events, M.interview, undefined]];
    for (const [route, id, body] of cases) {
      for (const who of [C.recruiterB, C.managerB, C.adminB]) {
        const r = call(route, who, { id, body }, t);
        // A role that may not use the route at all is refused first (403): an Admin on a move or a level change, a manager on a level change.
        const roleFirst = route !== ROUTE.events && (who === C.adminB || (route === ROUTE.update && who === C.managerB));
        if (roleFirst) expect.soft(answer(r), `${route}, ${who.name}: 403`).toEqual([403, FORBIDDEN]);
        else expect.soft(answer(r), `${route}, ${who.name}: 404 for A's candidate`).toEqual([404, NOT_FOUND]);
        expect.soft(anyWrite(r).length, `${route}, ${who.name}: nothing written`).toBe(0);
        expect.soft(changedRows(t, r.tables).length, `${route}, ${who.name}: no row changes`).toBe(0);
      }
    }
    for (const [what, a] of [
      ['body tenantId A', { body: { to: 'OFFER', reason: REASON, tenantId: A, tenant_id: A } }], ['query tenantId A', { body: { to: 'OFFER', reason: REASON }, query: { tenantId: A, tenant_id: A } }],
      ['header x-tenant-id A', { body: { to: 'OFFER', reason: REASON }, headers: { 'x-tenant-id': A, 'x-tenant': A } }],
    ] as const) {
      const r = call(ROUTE.move, C.recruiterB, { id: M.interview, ...a }, t);
      refused(`B's Recruiter with ${what}`, t, r, M.interview, [404, NOT_FOUND]);
    }
    // B on its own candidates: the same rules, B's company on what it writes.
    judgeMove('B\'s Recruiter moves B\'s candidate', t, move(C.recruiterB, M.bApplied, { to: 'SCREENING', reason: REASON }, t), { id: M.bApplied, from: 'APPLIED', to: 'SCREENING', reason: REASON, by: SUB.recB, company: B });
    judgeMove('B\'s hiring manager moves B\'s candidate to Offer', t, move(C.managerB, M.b, { to: 'OFFER', reason: REASON }, t), { id: M.b, from: 'INTERVIEW', to: 'OFFER', reason: REASON, by: SUB.hmB, company: B });

    // Roles (REC-00 rule 1): only a Recruiter or a manager passes the role check of a move; everyone else 403 before any AWS call.
    for (const who of [C.employee, C.guest, C.panelA, C.approver, C.adminOnly, C.itOnly, C.noGroups, C.hrNoTick, C.tickNoHr, C.taClaim, C.taPanelMember, C.oldAdmin]) {
      const r = move(who, M.interview, { to: 'OFFER', reason: REASON }, t);
      expect.soft([...answer(r), awsOf(r).length], `move, ${who.name}: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }
    for (const who of [C.employee, C.hmC1]) {
      const r = update(who, M.applied, { positionLevel: 'SENIOR' }, t);
      expect.soft([...answer(r), awsOf(r).length], `level change, ${who.name}: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }
    const none = move(C.recruiterNoCompany, M.interview, { to: 'OFFER', reason: REASON }, t);
    expect.soft([...answer(none), awsOf(none).length], 'move, a Recruiter with no company: 403 before any AWS call').toEqual([403, FORBIDDEN, 0]);
    const d = move(C.recruiterD, M.interview, { to: 'OFFER', reason: REASON }, t);
    expect.soft(answer(d), 'move, a Recruiter of a company with Recruitment off: 403').toEqual([403, FORBIDDEN]);
    expect.soft(awsOf(d).filter((c: any) => !isModulesRead(c)).map((c: any) => `${c.service} ${c.op} ${c.table ?? ''}`), 'move, Recruitment off: only the module read happens').toEqual([]);
    // The hiring manager is a Recruiter for nothing but Interview to Offer.
    for (const [id, to] of [[M.applied, 'SCREENING'], [M.screening, 'INTERVIEW']] as const) refused(`the hiring manager, ${to}`, t, move(C.hmC1, id, { to, reason: REASON }, t), id, [403, FORBIDDEN]);
    // getCandidateEvents keeps REC-01's answer for someone with no relation to the candidate: 404.
    expect.soft(statusOf(history(C.employee, M.interview, t)), 'history, an employee on no panel: 404 (REC-01)').toBe(404);

    // The core (REC-00 rule 4) and the checks the handler runs.
    expect.soft(code(CORE), 'lambda/shared/recruitment-actions/move-candidate.mjs exports moveCandidate').toMatch(/export\s+(async\s+)?function\s+moveCandidate\b|export\s*\{[^}]*\bmoveCandidate\b/);
    const handler = folderFiles(HANDLER).map(code).join('\n');
    expect.soft(handler, 'advanceCandidateStage calls the core').toMatch(/recruitment-actions\/move-candidate\.mjs/);
    expect.soft(handler + code(CORE), 'canDecide decides Interview to Offer').toMatch(/canDecide\s*\(/);
    // No table rows from Terraform (LESSONS #362).
    for (const stack of STACKS) expect.soft(resourcesOf(stack, 'aws_dynamodb_table_item').length, `${stack}: no aws_dynamodb_table_item`).toBe(0);
    // IAM (rule 9): advanceCandidateStage's role gains nothing (against develop 5a6b4ef, REC-02 merged).
    const fn = lambdaNamed(HANDLER);
    expect(fn.length, 'one aws_lambda_function named advanceCandidateStage').toBe(1);
    const role = roleResourceOf(fn[0]!.block);
    const stack = fn[0]!.stack;
    const baseline = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-03', 'iam-5a6b4ef', 'policies.json'), 'utf8')) as Record<string, { role: string; stack: Stack; pairs?: string[]; squash?: string }>;
    const was = new Set(Object.values(baseline).filter((p) => p.stack === stack && p.role === role).flatMap((p) => p.pairs ?? [`unreadable ${p.squash}`]));
    const now = Object.values(policyLines()).filter((p) => p.stack === stack && p.role === role).flatMap((p) => p.pairs ?? [`unreadable ${p.squash}`]);
    expect.soft(was.size, 'the baseline holds advanceCandidateStage\'s grants').toBeGreaterThan(3);
    expect.soft(now.filter((l) => !was.has(l)), 'advanceCandidateStage\'s role gains no grant').toEqual([]);
    const attach = (b: ReturnType<typeof blocks>[number]) => b.labels[0] === 'aws_iam_role_policy_attachment' && (attributes(b.body).get('role') ?? '').includes(`aws_iam_role.${role}.`);
    expect.soft(blocks(filesOf(stack), 'resource').filter(attach).map((b) => b.labels[1]), 'and no managed policy is attached to it').toEqual([]);
    void ID;
  });

  // ---------------------------------------------------------------- AC-11

  test('AC-11 The test logins on pepla-dev: HR moves a new candidate to Screening and back with reasons, the history shows both, a skip is refused, the manager cannot move it, old rows read as new @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1 to AC-10.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(8 * 60_000);
    const env = (k: string) => process.env[k] ?? '';
    const login = (p: string) => ({ email: env(`${p}_EMAIL`), password: env(`${p}_PASSWORD`) });
    const logins = { admin: login('E2E_TF'), hr: login('E2E_HR'), manager: login('E2E_MANAGER'), companyB: login('E2E_HR_B') };
    for (const [who, l] of Object.entries(logins)) expect(l.email && l.password, `the ${who} test login is set`).toBeTruthy();
    const { devEnv } = await import('./support/ten-02/dev');
    const { region, clientId } = devEnv();
    const oldEnv = join(REPO, 'hr-portal', 'src', 'environments', 'environment.ts');
    const tfApi = (/talentFlow\s*:\s*\{[^}]*?apiUrl\s*:\s*['"`]([^'"`]+)['"`]/s.exec(existsSync(oldEnv) ? readFileSync(oldEnv, 'utf8') : '')?.[1] ?? '').replace(/\/+$/, '').replace(/\/v1$/, '');
    expect(tfApi, 'the TalentFlow API address is written for pepla-dev (hr-portal environment.ts, talentFlow.apiUrl)').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const signIn = async (l: { email: string; password: string }) => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: l.email, PASSWORD: l.password } }),
      });
      expect(r.status(), 'signs in at Cognito').toBe(200);
      return ((await r.json()) as any).AuthenticationResult.IdToken as string;
    };
    const personOf = (token: string) => { const c = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')); return String(c.user_id ?? c.sub); };
    const call2 = async (token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      page.request.fetch(`${tfApi}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { data: JSON.stringify(body) }) });
    const read2 = async (token: string, id: string) => { const r = await call2(token, 'GET', `/v1/candidates/${id}`); expect(r.status(), `the candidate ${id} is read`).toBe(200); const b = (await r.json()) as any; return (b.candidate ?? b) as Record<string, any>; };
    const [hr, manager, companyB, admin] = await Promise.all([signIn(logins.hr), signIn(logins.manager), signIn(logins.companyB), signIn(logins.admin)]);
    const hrId = personOf(hr);
    const managerId = personOf(manager);

    // Screening is on for the dev company (the seed sets it; set it back if a run left it off).
    const sc = await call2(admin, 'GET', '/v1/config?configType=STAGE_CONFIG&active=true');
    expect(sc.status(), 'the Admin reads STAGE_CONFIG').toBe(200);
    const active = (await sc.json()) as { version: number; data: any };
    if (active.data?.screening !== true) {
      const saved = await call2(admin, 'PUT', '/v1/config', { configType: 'STAGE_CONFIG', data: { ...active.data, screening: true }, expected_version: active.version });
      expect(saved.status(), `the Admin turns Screening on (${await saved.text()})`).toBe(200);
    }
    // HR adds a candidate: it starts in Applied (the new code).
    const made = await call2(hr, 'POST', '/v1/candidates', { idempotencyKey: `rec03-${Date.now()}`, firstName: 'Rec', lastName: 'Zero-Three', email: `rec03.${Date.now()}@example.com`, positionTitle: 'Demo role', positionLevel: 'MID', hiringManagerId: managerId });
    expect(made.status(), 'HR creates a candidate').toBe(201);
    const x = ((await made.json()) as any).candidateId as string;
    expect((await read2(hr, x))['currentStage'], 'a new candidate is in APPLIED').toBe('APPLIED');
    // The hiring-manager login cannot move an Applied candidate; a skip is refused; B gets 404.
    const byHm = await call2(manager, 'PUT', `/v1/candidates/${x}/stage`, { to: 'SCREENING', reason: 'REC-03 dev check: manager' });
    expect([byHm.status(), await byHm.json()], 'the hiring-manager login cannot move an Applied candidate').toEqual([403, FORBIDDEN]);
    const skip = await call2(hr, 'PUT', `/v1/candidates/${x}/stage`, { to: 'INTERVIEW', reason: 'REC-03 dev check: skip' });
    expect([skip.status(), await skip.json()], 'a skip from Applied to Interview is refused').toEqual([400, bad('NOT_NEXT_STAGE')]);
    const byB = await call2(companyB, 'PUT', `/v1/candidates/${x}/stage`, { to: 'SCREENING', reason: 'REC-03 dev check: B' });
    expect(byB.status(), 'the company B login gets 404').toBe(404);
    // HR moves it to Screening and back, each with a reason (an Idempotency-Key as the screens send it).
    const fwd = await call2(hr, 'PUT', `/v1/candidates/${x}/stage`, { to: 'SCREENING', reason: 'REC-03 dev check: forward' }, { 'Idempotency-Key': `rec03-fwd-${Date.now()}` });
    expect(fwd.status(), `HR moves the candidate to Screening (${await fwd.text()})`).toBe(200);
    expect((await read2(hr, x))['currentStage'], 'it is in SCREENING').toBe('SCREENING');
    const back = await call2(hr, 'PUT', `/v1/candidates/${x}/stage`, { to: 'APPLIED', reason: 'REC-03 dev check: back' }, { 'Idempotency-Key': `rec03-back-${Date.now()}` });
    expect(back.status(), `HR moves it back to Applied (${await back.text()})`).toBe(200);
    expect((await read2(hr, x))['currentStage'], 'it is in APPLIED again').toBe('APPLIED');
    // The history shows both moves, oldest first, with HR's id (a real read of the history on dev).
    const h = await call2(hr, 'GET', `/v1/candidates/${x}/events`);
    expect(h.status(), 'HR reads the history').toBe(200);
    const moves = movesIn(await h.json());
    const i1 = moves.findIndex((m) => m.from === 'APPLIED' && m.to === 'SCREENING');
    const i2 = moves.findIndex((m) => m.from === 'SCREENING' && m.to === 'APPLIED');
    expect(i1 >= 0 && i2 > i1, `the history lists the forward move, then the move back (${JSON.stringify(moves).slice(0, 300)})`).toBe(true);
    expect([moves[i1]?.by, moves[i2]?.by], 'each with HR\'s person id').toEqual([hrId, hrId]);
    // The level lock reads the interviews on dev (a new read for updateCandidate): the seeded Applied candidate with an interview.
    const lockedSeed = 'CAND-SEEDREC030000000000001';
    const lvl = await call2(hr, 'PATCH', `/v1/candidates/${lockedSeed}`, { positionLevel: 'SENIOR' });
    expect([lvl.status(), await lvl.json()], 'a level change on the seeded Applied candidate with an interview is LEVEL_LOCKED').toEqual([409, conflict('LEVEL_LOCKED')]);
    // After the script ran on the dev company (the seed runs it): the seeded old-stage row reads as its new stage, and the seeded old
    // REJECTED row is on REC-02's old-system list.
    const oldRow = await read2(hr, 'CAND-SEEDREC030000000000002');
    expect([oldRow['currentStage'], oldRow['legacy_stage']], 'the seeded INTERVIEWING row reads as INTERVIEW, the old name kept').toEqual(['INTERVIEW', 'INTERVIEWING']);
    const list = await call2(hr, 'GET', '/v1/candidates/old-system');
    expect(list.status(), 'HR reads the old-system list').toBe(200);
    const ids = (((await list.json()) as any).candidates ?? []).map((c: any) => c.candidate_id);
    expect(ids, 'the seeded old REJECTED row is listed by REC-02\'s list').toContain('CAND-SEEDREC030000000000003');
    void [A, B, SUB];
  });
});
