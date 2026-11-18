import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { devEnv } from './support/ten-02/dev';
import { LAMBDA, REPO, httpEvent, runModule } from './support/rec-01/lambda-harness';
import { policyLines, lambdaNamed, roleResourceOf, roleInfo, valueOf, TENANTS_RESOURCE, type Stack } from './support/rec-01/iam';
import { A, B, D, ID, SUB, TABLE, TENANTS, ask, authorizerOf, bodyOf, calls, describe, findRow, rowsOf, runEvent, statusOf, tables, writes, type Caller } from './support/rec-01/world';
import { ADMINS, C, MANAGERS, NOT_RECRUITERS, RECRUITERS, RECRUITER_FORMS } from './support/rec-01/callers';
import { LIST_LAMBDAS, ROUTES, type Route } from './support/rec-01/routes';
import { isCardGrant } from './support/ten-04.2/grants';

/**
 * REC-01 · Recruitment role checks: every action says who may do it (Jira NH-235, epic NH-234). Red.
 * One test per acceptance criterion, written from the card before any code. Spec: /mnt/project-files/onboarding-cards/specs/REC-01.md
 * (17 Nov 2026), read with REC-00.md. Notes for the lock check: REC-01-tests-for-review.md.
 *
 * The Lambda tests run the real handlers and the new shared file, each call in its own fresh Node process, against a fake
 * AWS (support/rec-01/fake-aws, copied from MOD-01's with no code changed). Companies: A (founding), B (Recruitment on),
 * D (Recruitment off). Callers: support/rec-01/callers.ts. Bedrock and any other AI client fail; outbound HTTP is refused.
 * AC-7 and AC-8 read code and Terraform as text and run the CI test on a copy. AC-9 runs on pepla-dev only.
 *
 * Pinned by the verifier where the card leaves a gap (each is in cards/rec-01.md and REC-01-tests-for-review.md):
 *  - D-REC-1.3 The old TalentFlow HR names (naleko-talentflow-hr, HRDirector, custom:roles "TA") pass the Recruiter check until
 *    TEN-06 moves those people, because TEN-05's locked OLD_GROUPS gives them the Recruitment tick and no hr_staff (mapping them
 *    to hr_staff would open the Onboarding HR routes to them, which BE-17.1 pins shut). The bridge reads TEN-05's own table, so
 *    recruitment-access.mjs names no group.
 *  - D-REC-1.4 A route that opens one candidate (read candidate, history, interviews, offer) answers 404 to everyone who is not a
 *    Recruiter, that candidate's hiring manager or (not the offer) a panel member of its interviews: it cannot tell "not yours"
 *    from "does not exist". A panel member can be any role, so these routes cannot answer 403 before the row is read.
 *  - D-REC-1.5 The tile acknowledge, snooze and dismiss routes are Recruiter only (the card names acknowledge and snooze; dismiss
 *    is the same family). Reading one offer is the Recruiter and the hiring manager (salary removed).
 *  - D-REC-1.6 submitVote by a person needs the person to be on the interview's panel; the interviewId must be in the body and
 *    belong to the candidate. The VoteSubmitted event (no sign-in) is not a person and keeps naming its voter.
 *  - canDecide's arguments are not in the card (REC-02 and REC-03 apply it): AC-1 only checks that it is exported as a function.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const FORBIDDEN = { error: 'Forbidden' };
const NOT_FOUND = { error: 'Not found' };

/** A caller's authorizer as an HTTP API event, for the helper tests. */
const eventOf = (c: Caller, extra: Record<string, unknown> = {}) => httpEvent({ authorizer: authorizerOf(c, extra) });
const ids = (r: { response: any }) => ((bodyOf(r as any)?.candidates ?? []) as any[]).map((x) => x.candidateId ?? x.id).sort();
const keysDeep = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysDeep(x, out); }
  return out;
};
const routeOf = (handler: string, name?: RegExp) => ROUTES.find((r) => r.handler === handler && (!name || name.test(r.name)))!;
const run = (r: Route, c: Caller, over: Partial<Route['own']> = {}, opts: Parameters<typeof ask>[3] = {}) => ask(r.handler, c, { ...r.own, ...over }, opts);
const votesOf = (t: ReturnType<typeof tables>) => rowsOf(t, TABLE.state).filter((r) => String(r['SK']).startsWith('VOTE#'));

test.describe('REC-01 · Recruitment role checks: every action says who may do it', () => {
  // ---------------------------------------------------------------- control

  test('Control: the Recruiter gets every route\'s normal answer, so the fixtures are good requests', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    for (const r of ROUTES) {
      // The settings writes are admin only; the vote is the panel member's.
      const who = r.kind === 'vote' ? C.panel2A : r.write ? C.adminOnly : C.recruiter;
      const got = run(r, who);
      expect.soft(r.ok.includes(statusOf(got) ?? 0), `${r.name} as ${who.name}: ${r.ok.join(' or ')} (got ${describe(got)})`).toBe(true);
    }
  });

  // ---------------------------------------------------------------- AC-1

  test('AC-1 The helpers answer as rule 1 for every caller; near names and substrings fail; both claim forms are read', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const everyone: Caller[] = [
      ...RECRUITERS, ...NOT_RECRUITERS, C.recruiterB, C.managerB, C.recruiterD,
      { name: 'recruiter with an access token (not an ID token)', groups: ['hr_staff', 'perm-recruitment'], sub: SUB.recA, claims: { token_use: 'access' } },
      { name: 'groups claim of an unrelated shape', groups: '{hr_staff: perm-recruitment}', sub: SUB.recA },
    ];
    const noClaims = httpEvent({});
    const steps = [
      { get: 'requireRecruiter' }, { get: 'requireAdmin' }, { get: 'requireApprover' }, { get: 'hiringManagerOf' }, { get: 'panelMemberOf' }, { get: 'callerId' }, { get: 'canDecide' },
      ...everyone.flatMap((c) => [
        { fn: 'requireRecruiter', args: [eventOf(c)] }, { fn: 'requireAdmin', args: [eventOf(c)] }, { fn: 'requireApprover', args: [eventOf(c)] }, { fn: 'callerId', args: [eventOf(c)] },
      ]),
      { fn: 'requireRecruiter', args: [noClaims] }, { fn: 'requireAdmin', args: [noClaims] }, { fn: 'requireApprover', args: [noClaims] }, { fn: 'callerId', args: [noClaims] },
    ];
    const out = runModule(steps as any, { tables: tables(), env: { TENANTS_TABLE: TENANTS } });
    expect(out.importError, `lambda/shared/recruitment-access.mjs imports (${out.importError?.message ?? 'it does not exist yet'})`).toBeUndefined();
    for (const name of ['requireRecruiter', 'requireAdmin', 'requireApprover', 'hiringManagerOf', 'panelMemberOf', 'callerId', 'canDecide']) {
      expect.soft(out.exports, `recruitment-access.mjs exports ${name}`).toContain(name);
    }
    const r = out.results.slice(7);
    const answer = (i: number, c: Caller) => r.slice(i * 4, i * 4 + 4).map((x) => (x.ok ? (x.value ?? null) : { error: x.error?.message }));
    const refused = (v: any) => v && v.statusCode === 403 && JSON.parse(v.body ?? 'null')?.error === 'Forbidden';
    const adminNames = new Set(ADMINS.map((c) => c.name));
    everyone.forEach((c, i) => {
      const [rec, adm, app, id] = answer(i, c) as any[];
      const wantRecruiter = RECRUITERS.some((x) => x.name === c.name) || [C.recruiterB.name, C.recruiterD.name].includes(c.name);
      const wantAdmin = adminNames.has(c.name);
      const wantApprover = ['Approver (perm-approve-offers)', 'Old FinanceLead', C.taFinanceLead.name, 'Old TalentFlowAdmin', 'Old custom:isAdmin "true", no group'].includes(c.name);
      expect.soft(rec === null, `requireRecruiter(${c.name}): ${wantRecruiter ? 'null (passes)' : '403 Forbidden'} (got ${JSON.stringify(rec)?.slice(0, 120)})`).toBe(wantRecruiter);
      if (!wantRecruiter) expect.soft(refused(rec), `requireRecruiter(${c.name}): the answer is 403 {"error":"Forbidden"}`).toBe(true);
      expect.soft(adm === null, `requireAdmin(${c.name}): ${wantAdmin ? 'null' : '403'} (got ${JSON.stringify(adm)?.slice(0, 120)})`).toBe(wantAdmin);
      if (!wantAdmin) expect.soft(refused(adm), `requireAdmin(${c.name}): the answer is 403 {"error":"Forbidden"}`).toBe(true);
      expect.soft(app === null, `requireApprover(${c.name}): ${wantApprover ? 'null' : '403'} (got ${JSON.stringify(app)?.slice(0, 120)})`).toBe(wantApprover);
      expect.soft(id, `callerId(${c.name}): the sub claim`).toBe(c.sub);
    });
    // A recruiter with an access token or a made-up groups shape is nobody.
    const last = everyone.length;
    const [recN, admN, appN, idN] = answer(last, C.recruiter) as any[];
    expect.soft(refused(recN) && refused(admN) && refused(appN), 'no claims at all: every require* answers 403').toBe(true);
    expect.soft(!idN, 'no claims at all: callerId is empty').toBe(true);

    // callerId: the user_id claim when there is one, else sub; never a body, query, path or header value.
    const idRun = runModule([
      { fn: 'callerId', args: [httpEvent({ authorizer: authorizerOf({ name: 'x', groups: ['employee'], sub: 'sub-1' }, { user_id: 'old-talentflow-sub-9' }) })] },
      { fn: 'callerId', args: [httpEvent({ authorizer: authorizerOf({ name: 'x', groups: ['employee'], sub: 'sub-1' }) })] },
      { fn: 'callerId', args: [httpEvent({ body: { sub: 'body-sub', user_id: 'body-user', voterId: 'body-voter' }, headers: { 'x-user-id': 'header-user', sub: 'header-sub' }, query: { sub: 'query-sub', user_id: 'query-user' }, path: { sub: 'path-sub' } })] },
      { fn: 'callerId', args: [httpEvent({ body: { sub: 'body-sub', user_id: 'body-user' }, headers: { 'x-user-id': 'header-user' }, authorizer: authorizerOf({ name: 'x', groups: [], sub: 'sub-real' }) })] },
    ] as any, { tables: tables(), env: { TENANTS_TABLE: TENANTS } });
    expect.soft(idRun.results[0]?.value, 'callerId: the user_id claim (TEN-06) wins over sub').toBe('old-talentflow-sub-9');
    expect.soft(idRun.results[1]?.value, 'callerId: sub when there is no user_id').toBe('sub-1');
    expect.soft(idRun.results[2]?.value ?? null, 'callerId: a body, query, path or header value is not a person id').toBeNull();
    expect.soft(idRun.results[3]?.value, 'callerId: with a sign-in, a body or header value never replaces it').toBe('sub-real');

    // The relationship checks work on rows the handler has already loaded.
    const rel = runModule([
      { fn: 'hiringManagerOf', args: [{ hiringManagerId: 'p1' }, 'p1'] }, { fn: 'hiringManagerOf', args: [{ hiringManagerId: 'p1' }, 'p2'] },
      { fn: 'hiringManagerOf', args: [{}, 'p1'] }, { fn: 'hiringManagerOf', args: [{}, undefined] }, { fn: 'hiringManagerOf', args: [{ hiringManagerId: 'p1' }, undefined] },
      { fn: 'hiringManagerOf', args: [{ hiringManagerId: 'p1' }, ''] }, { fn: 'hiringManagerOf', args: [{ hiringManagerId: 'p1' }, 'P1'] }, { fn: 'hiringManagerOf', args: [undefined, 'p1'] },
      { fn: 'panelMemberOf', args: [{ panelMemberIds: ['p1', 'p2'] }, 'p2'] }, { fn: 'panelMemberOf', args: [{ panelMemberIds: ['p1', 'p2'] }, 'p3'] },
      { fn: 'panelMemberOf', args: [{ panelMemberIds: ['p10'] }, 'p1'] }, { fn: 'panelMemberOf', args: [{}, 'p1'] }, { fn: 'panelMemberOf', args: [{ panelMemberIds: 'p1' }, 'p1'] },
      { fn: 'panelMemberOf', args: [{ panelMemberIds: ['p1'] }, undefined] }, { fn: 'panelMemberOf', args: [{ adhocPanelMembers: [{ email: 'a@example.test' }] }, 'a@example.test'] },
      { fn: 'panelMemberOf', args: [undefined, 'p1'] },
    ] as any, { tables: tables(), env: { TENANTS_TABLE: TENANTS } });
    const want = [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false];
    const label = ['same id', 'other id', 'no manager on the row', 'no manager and no caller (undefined is not undefined)', 'a caller with no id', 'an empty caller id', 'a different case', 'no row',
      'on the panel', 'not on the panel', 'a longer id that starts the same', 'no panel on the row', 'a panel that is a string', 'a caller with no id', 'a guest by email only is not a person id', 'no row'];
    want.forEach((w, i) => expect.soft(rel.results[i]?.value === true, `${i < 8 ? 'hiringManagerOf' : 'panelMemberOf'}: ${label[i]} -> ${w}`).toBe(w));
  });

  // ---------------------------------------------------------------- AC-2

  /** Every caller of company A on one route: who passes, who is refused, and what the refusal looks like. */
  function judgeRoute(r: Route) {
    const wrong: string[] = [];
    const pass = (c: Caller) => run(r, c);
    const check = (c: Caller, want: 'pass' | 403 | 404) => {
      const got = pass(c);
      const s = statusOf(got);
      const tag = `${r.name} | ${c.name}`;
      if (want === 'pass') {
        if (!r.ok.includes(s ?? 0)) wrong.push(`${tag}: want ${r.ok.join('/')}, got ${describe(got)}`);
        return;
      }
      if (s !== want) { wrong.push(`${tag}: want ${want}, got ${describe(got)}`); return; }
      if (JSON.stringify(bodyOf(got)) !== JSON.stringify(want === 403 ? FORBIDDEN : NOT_FOUND)) wrong.push(`${tag}: the answer is ${JSON.stringify(want === 403 ? FORBIDDEN : NOT_FOUND)} (got ${JSON.stringify(bodyOf(got))})`);
      if (writes(got).length) wrong.push(`${tag}: a refusal writes nothing (${writes(got).map((x: any) => `${x.service} ${x.op}`).join(', ')})`);
      // A role refusal comes before any AWS call; a "not yours" answer reads only the rows it needs.
      if (want === 403 && r.kind !== 'vote' && calls(got).length) wrong.push(`${tag}: no AWS call before the role refusal (got ${calls(got).map((x: any) => `${x.service} ${x.op}`).join(', ')})`);
    };
    const everyoneElse = (except: Caller[]) => NOT_RECRUITERS.filter((c) => !except.includes(c));
    switch (r.kind) {
      case 'recruiter':
        RECRUITERS.forEach((c) => check(c, 'pass'));
        NOT_RECRUITERS.forEach((c) => check(c, 403));
        break;
      case 'list':
        RECRUITERS.forEach((c) => check(c, 'pass'));
        MANAGERS.forEach((c) => check(c, 'pass'));
        everyoneElse(MANAGERS).forEach((c) => check(c, 403));
        break;
      case 'relation':
        RECRUITERS.forEach((c) => check(c, 'pass'));
        [C.hmC1, C.oldHm].forEach((c) => check(c, 'pass'));
        (r.panel ? [C.panelA] : []).forEach((c) => check(c, 'pass'));
        everyoneElse([C.hmC1, C.oldHm, ...(r.panel ? [C.panelA] : [])]).forEach((c) => check(c, 404));
        break;
      case 'settings':
        if (r.write) {
          ADMINS.forEach((c) => check(c, 'pass'));
          [...RECRUITERS.filter((c) => !ADMINS.includes(c)), ...NOT_RECRUITERS.filter((c) => !ADMINS.includes(c))].forEach((c) => check(c, 403));
        } else {
          [...RECRUITERS, ...ADMINS].forEach((c) => check(c, 'pass'));
          NOT_RECRUITERS.filter((c) => !ADMINS.includes(c)).forEach((c) => check(c, 403));
        }
        break;
      case 'vote':
        check(C.panel2A, 'pass');
        [...RECRUITERS, ...NOT_RECRUITERS].filter((c) => c !== C.panel2A).forEach((c) => check(c, 403));
        break;
    }
    return wrong;
  }
  const group = (title: string, pick: (r: Route) => boolean) =>
    test(title, async ({}, testInfo) => {
      once(testInfo.project.name);
      test.setTimeout(900_000);
      const wrong = ROUTES.filter(pick).flatMap(judgeRoute);
      expect(wrong, 'allowed callers reach the handler; every other caller gets 403 {"error":"Forbidden"} (404 {"error":"Not found"} where the table says so), with no AWS call before a role refusal and no write on any refusal').toEqual([]);
    });
  group('AC-2 Every route, every caller: Recruiter-only actions', (r) => r.kind === 'recruiter');
  group('AC-2 Every route, every caller: lists and tiles', (r) => r.kind === 'list');
  group('AC-2 Every route, every caller: one candidate, its history, its interviews and its offer', (r) => r.kind === 'relation');
  group('AC-2 Every route, every caller: settings and the vote', (r) => r.kind === 'settings' || r.kind === 'vote');

  // ---------------------------------------------------------------- AC-3

  test('AC-3 A manager sees only their own: lists, one candidate, history, interviews, offer and tiles', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const list = routeOf('getCandidates');
    const wrong: string[] = [];
    const expectIds = (c: Caller, over: Partial<Route['own']>, want: string[], what: string) => {
      const r = run(list, c, over);
      const got = ids(r);
      if (statusOf(r) !== 200 || JSON.stringify(got) !== JSON.stringify([...want].sort())) wrong.push(`${what}: want ${JSON.stringify(want)}, got ${describe(r).slice(0, 200)}`);
    };
    expectIds(C.recruiter, {}, [ID.c1, ID.c2], 'the Recruiter lists every candidate of the company');
    expectIds(C.hmC1, {}, [ID.c1], 'the hiring manager of C1 lists C1 only');
    expectIds(C.hmOther, {}, [ID.c2], 'the manager of another role lists C2 only');
    expectIds(C.oldHm, {}, [ID.c1], 'old HiringManager group: C1 only');
    // The query cannot widen it: not the manager id of another, not a company, not a paging trick.
    expectIds(C.hmC1, { query: { hiringManagerId: SUB.hm2A } }, [ID.c1], 'a manager who asks for another manager\'s candidates still gets only their own');
    expectIds(C.hmC1, { query: { hiringManagerId: '' } }, [ID.c1], 'an empty hiringManagerId does not remove the limit');
    expectIds(C.hmC1, { query: { tenantId: B, tenant_id: B, company: B } }, [ID.c1], 'a company named in the query changes nothing');
    expectIds(C.hmC1, { query: { stage: 'INTERVIEWING', search: 'Sipho' } }, [], 'a search for another manager\'s candidate finds nothing');
    expectIds(C.recruiter, { query: { hiringManagerId: SUB.hm2A } }, [ID.c2], 'the Recruiter may still filter by hiring manager');

    // One candidate: opened by its manager, not by another; the refusal looks the same as a candidate that does not exist.
    const one = routeOf('getCandidate');
    const open = (c: Caller, id: string) => run(one, c, { path: { id } });
    const okOwn = open(C.hmC1, ID.c1);
    if (statusOf(okOwn) !== 200 || bodyOf(okOwn)?.candidateId !== ID.c1) wrong.push(`the hiring manager opens C1: ${describe(okOwn)}`);
    const otherC1 = open(C.hmOther, ID.c1);
    const ghost = open(C.hmOther, 'CAND-01REC01GHOSTGHOSTGHOST9');
    const sameAsGhost = (a: any, b: any) => statusOf(a) === statusOf(b) && JSON.stringify(bodyOf(a)) === JSON.stringify(bodyOf(b));
    if (statusOf(otherC1) !== 404 || JSON.stringify(bodyOf(otherC1)) !== JSON.stringify(NOT_FOUND)) wrong.push(`the manager of another role opens C1: want 404 Not found, got ${describe(otherC1)}`);
    if (!sameAsGhost(otherC1, ghost)) wrong.push(`C1 for the manager of another role answers like a candidate that does not exist (${describe(otherC1)} against ${describe(ghost)})`);
    const hmOnC2 = open(C.hmC1, ID.c2);
    if (!sameAsGhost(hmOnC2, open(C.hmC1, 'CAND-01REC01GHOSTGHOSTGHOST9'))) wrong.push(`C2 for the hiring manager of C1 answers like a candidate that does not exist (${describe(hmOnC2)})`);
    // The same on history, interviews and offer.
    for (const [h, name, own] of [['getCandidateEvents', undefined, ID.c1], ['scheduleInterview', /GET .*interviews$/, ID.c1], ['getOffer', undefined, ID.c1]] as const) {
      const rt = routeOf(h, name);
      const mine = run(rt, C.hmC1, { path: { id: own } });
      if (statusOf(mine) !== 200) wrong.push(`${rt.name}: the hiring manager of C1 opens C1 (got ${describe(mine)})`);
      const theirs = run(rt, C.hmOther, { path: { id: own } });
      const nothing = run(rt, C.hmOther, { path: { id: 'CAND-01REC01GHOSTGHOSTGHOST9' } });
      if (statusOf(theirs) !== 404 || !sameAsGhost(theirs, nothing)) wrong.push(`${rt.name}: C1 for the manager of another role answers like a candidate that does not exist (${describe(theirs)} against ${describe(nothing)})`);
    }

    // Hiding: a hiring manager keeps everything on their candidates except salary.
    const hmOne = bodyOf(okOwn);
    const recOne = bodyOf(open(C.recruiter, ID.c1));
    if (!('salary' in recOne) || !('offer' in recOne)) wrong.push('the Recruiter still sees salary and offer on C1 (the fixture holds both)');
    if (keysDeep(hmOne).some((k) => /salary/i.test(k))) wrong.push(`the hiring manager's candidate read has no salary field (got keys ${keysDeep(hmOne).filter((k) => /salary/i.test(k)).join(', ')})`);
    if (hmOne?.offer?.state !== 'OFFER_CREATED') wrong.push('the hiring manager keeps the rest of the offer fields on their candidate (offer.state)');
    for (const k of ['firstName', 'lastName', 'email', 'currentStage', 'hiringManagerId']) if (hmOne?.[k] !== recOne?.[k]) wrong.push(`the hiring manager keeps ${k}`);
    const hmOffer = run(routeOf('getOffer'), C.hmC1);
    if (keysDeep(bodyOf(hmOffer)).some((k) => /salary/i.test(k))) wrong.push('the hiring manager\'s offer has no salary field (baseSalary is salary)');
    if (bodyOf(hmOffer)?.state !== 'OFFER_CREATED' || bodyOf(hmOffer)?.currency !== 'ZAR') wrong.push('the hiring manager keeps the other offer fields (state, currency)');
    if (!keysDeep(bodyOf(run(routeOf('getOffer'), C.recruiter))).includes('baseSalary')) wrong.push('the Recruiter sees baseSalary');
    const hmEvents = run(routeOf('getCandidateEvents'), C.hmC1);
    if (/salary/i.test(JSON.stringify(bodyOf(hmEvents)))) wrong.push('the hiring manager\'s history has no salary');
    if (!/OFFER_CREATED/.test(JSON.stringify(bodyOf(hmEvents)))) wrong.push('the hiring manager keeps the offer events on their candidate');
    const hmIv = run(routeOf('scheduleInterview', /GET/), C.hmC1);
    const hmVotes = ((bodyOf(hmIv)?.interviews ?? []) as any[]).flatMap((i) => i.votes ?? []).map((v) => v.voterId).sort();
    if (JSON.stringify(hmVotes) !== JSON.stringify([SUB.panelA, SUB.panelX])) wrong.push(`the hiring manager sees every vote on their candidate's interview (got ${JSON.stringify(hmVotes)})`);

    // Tiles: the manager's tiles are their candidates' only.
    const tiles = routeOf('getIntelligenceTiles');
    const tilesOf = (c: Caller) => JSON.stringify(bodyOf(run(tiles, c)));
    if (!tilesOf(C.recruiter).includes(ID.c1) || !tilesOf(C.recruiter).includes(ID.c2)) wrong.push('the Recruiter\'s tiles name both candidates (the fixture holds a tile for each)');
    if (!tilesOf(C.hmC1).includes(ID.c1)) wrong.push('the hiring manager of C1 gets C1\'s tile');
    if (tilesOf(C.hmC1).includes(ID.c2)) wrong.push('the hiring manager of C1 gets no tile of C2');
    if (tilesOf(C.hmOther).includes(ID.c1)) wrong.push('the manager of another role gets no tile of C1');
    expect(wrong, 'a manager sees only the candidates they are hiring for, everywhere').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 A panel member sees only their own interviews, with offer fields and other members\' votes removed', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const wrong: string[] = [];
    const cand = routeOf('getCandidate');
    const mine = run(cand, C.panelA);
    const body = bodyOf(mine);
    if (statusOf(mine) !== 200 || body?.candidateId !== ID.c1) wrong.push(`a panel member of I1 opens C1: ${describe(mine)}`);
    if (keysDeep(body).some((k) => /offer|salary/i.test(k))) wrong.push(`the candidate has no offer or salary field for a panel member (got ${keysDeep(body).filter((k) => /offer|salary/i.test(k)).join(', ')})`);
    for (const k of ['firstName', 'lastName', 'positionTitle', 'currentStage']) if (body?.[k] !== bodyOf(run(cand, C.recruiter))?.[k]) wrong.push(`a panel member still sees ${k}`);
    // History: no offer events, no offer or salary fields.
    const ev = run(routeOf('getCandidateEvents'), C.panelA);
    if (statusOf(ev) !== 200) wrong.push(`a panel member of I1 opens C1's history: ${describe(ev)}`);
    if (/offer|salary/i.test(JSON.stringify(bodyOf(ev)))) wrong.push(`a panel member's history has no offer event and no offer or salary field (got ${JSON.stringify(bodyOf(ev)).slice(0, 200)})`);
    if (!/CandidateCreated/.test(JSON.stringify(bodyOf(ev)))) wrong.push('a panel member still sees the stage events of the history');
    // Interviews: only their own interview and only their own vote.
    const iv = run(routeOf('scheduleInterview', /GET/), C.panelA);
    const ivBody = bodyOf(iv);
    const voters = ((ivBody?.interviews ?? []) as any[]).flatMap((i) => (i.votes ?? []).map((v: any) => v.voterId));
    if (statusOf(iv) !== 200) wrong.push(`a panel member of I1 opens the interviews of C1: ${describe(iv)}`);
    if (JSON.stringify(voters) !== JSON.stringify([SUB.panelA])) wrong.push(`a panel member sees only their own vote on the interview (got voters ${JSON.stringify(voters)})`);
    if (JSON.stringify(ivBody).includes(SUB.panelX) && ((ivBody?.interviews ?? []) as any[]).some((i) => (i.votes ?? []).some((v: any) => v.voterId === SUB.panelX))) wrong.push('the other panel member\'s vote is not in the answer');
    // The other panel member sees theirs, not panelA's.
    const x = run(routeOf('scheduleInterview', /GET/), { ...C.panelA, name: 'Panel member X', sub: SUB.panelX });
    const xVoters = ((bodyOf(x)?.interviews ?? []) as any[]).flatMap((i) => (i.votes ?? []).map((v: any) => v.voterId));
    if (JSON.stringify(xVoters) !== JSON.stringify([SUB.panelX])) wrong.push(`the other panel member sees only their own vote (got ${JSON.stringify(xVoters)})`);
    // A panel member of no interview of C1 (a panel member of I2) gets 404 everywhere, like a candidate that does not exist.
    for (const rt of ROUTES.filter((r) => r.kind === 'relation')) {
      const got = run(rt, C.panel2A);
      const ghost = run(rt, C.panel2A, { path: { id: 'CAND-01REC01GHOSTGHOSTGHOST9' } });
      if (statusOf(got) !== 404 || JSON.stringify(bodyOf(got)) !== JSON.stringify(NOT_FOUND) || statusOf(ghost) !== 404) wrong.push(`${rt.name}: a panel member of no interview of C1 gets 404 Not found (got ${describe(got)})`);
    }
    // The offer is not theirs at all.
    const off = run(routeOf('getOffer'), C.panelA);
    if (statusOf(off) !== 404) wrong.push(`a panel member gets no offer (got ${describe(off)})`);
    // Panel members of the other company's interview do not open A's candidate; a panel member of A does not open B's.
    const cross = run(cand, C.panelB);
    if (statusOf(cross) !== 404) wrong.push(`a panel member of B opens A's candidate: want 404 (got ${describe(cross)})`);
    const crossA = run(cand, C.panelA, { path: { id: ID.cb1 } });
    if (statusOf(crossA) !== 404) wrong.push(`a panel member of A opens B's candidate: want 404 (got ${describe(crossA)})`);
    expect(wrong, 'a panel member reads only what the table gives them').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 The voter comes from the sign-in: a body voterId is not read; not on the panel is 403; the scoring link works as today', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const wrong: string[] = [];
    const vote = routeOf('submitVote');
    const before = tables();
    const base = votesOf(before).length;
    // A vote that names someone else as the voter is stored under the caller.
    const forged = run(vote, C.panel2A, { body: { ...(vote.own.body as object), voterId: SUB.recA, staffId: 'STAFF-x', createdBy: 'someone', tenantId: B } }, { tables: before });
    if (statusOf(forged) !== 200) wrong.push(`the panel member's vote is accepted: ${describe(forged)}`);
    const stored = votesOf(forged.tables).filter((r) => r['candidateId'] === ID.c2);
    if (stored.length !== 1 || stored[0]!['voterId'] !== SUB.panel2A || !String(stored[0]!['SK']).startsWith(`VOTE#${SUB.panel2A}#`)) wrong.push(`the vote is stored under the caller ${SUB.panel2A}, not the body's voterId (got ${JSON.stringify(stored.map((r) => [r['SK'], r['voterId']]))})`);
    if (stored[0] && stored[0]['tenant_id'] !== A) wrong.push('the vote carries the caller\'s company, not the body\'s');
    if (votesOf(forged.tables).length !== base + 1) wrong.push('exactly one vote was written');
    if (bodyOf(forged)?.voterId !== undefined && bodyOf(forged)?.voterId !== SUB.panel2A) wrong.push(`the answer names the caller as the voter (got ${bodyOf(forged)?.voterId})`);
    // The same vote with no voterId in the body works the same.
    const plainBody = { ...(vote.own.body as object) };
    const plain = run(vote, C.panel2A, { body: plainBody });
    if (statusOf(plain) !== 200) wrong.push(`a vote with no voterId in the body is accepted (got ${describe(plain)})`);
    // S-1: a PanelMember carrying the old pool's TA claim votes as themself and has no Recruiter rights.
    const taVote = run(vote, C.taPanelOn2, { body: { ...(vote.own.body as object), voterId: SUB.recA } });
    const taStored = votesOf(taVote.tables).filter((r) => r['candidateId'] === ID.c2);
    if (statusOf(taVote) !== 200 || taStored.length !== 1 || taStored[0]!['voterId'] !== SUB.panel2A) wrong.push(`a panel member with the TA claim votes as themself (got ${describe(taVote)}, stored ${JSON.stringify(taStored.map((r) => r['voterId']))})`);
    const taCreate = run(routeOf('createCandidate'), C.taPanelOn2);
    if (statusOf(taCreate) !== 403 || calls(taCreate).length) wrong.push(`a panel member with the TA claim cannot create a candidate: 403 with no AWS call (got ${describe(taCreate)})`);
    const taOther = run(vote, C.taPanelMember);
    if (statusOf(taOther) !== 403 || votesOf(taOther.tables).length !== base) wrong.push(`a TA-claim person on no panel cannot vote (got ${describe(taOther)})`);
    // Not on the panel: 403 and nothing written. This includes the Recruiter and a panel member of another interview.
    for (const c of [C.recruiter, C.panelA, C.hmC1, C.adminHr, C.employee, C.oldHr]) {
      const t = tables();
      const got = run(vote, c, { body: { ...plainBody, voterId: SUB.panel2A } }, { tables: t });
      if (statusOf(got) !== 403 || JSON.stringify(bodyOf(got)) !== JSON.stringify(FORBIDDEN)) wrong.push(`${c.name} votes on I2 (they are not on its panel, even when the body names a panel member): want 403 Forbidden, got ${describe(got)}`);
      if (votesOf(got.tables).length !== base) wrong.push(`${c.name}: a refused vote writes nothing`);
    }
    // The interview must be named and must be this candidate's.
    const noIv = run(vote, C.panel2A, { body: { ...plainBody, interviewId: undefined } });
    if (statusOf(noIv) !== 403) wrong.push(`a vote with no interviewId is refused 403 (got ${describe(noIv)})`);
    const wrongIv = run(vote, C.panelA, { path: { id: ID.c2 }, body: { ...plainBody, candidateId: ID.c2, interviewId: ID.i1 } });
    if (statusOf(wrongIv) !== 403) wrong.push(`a vote on C2 that names C1's interview I1 is refused 403 (got ${describe(wrongIv)})`);
    // Another company's panel member, and a company-B caller on A's interview.
    const b = run(vote, C.panelB, { body: plainBody });
    if (![403, 404].includes(statusOf(b) ?? 0) || votesOf(b.tables).length !== base) wrong.push(`a panel member of B votes on A's interview: refused, nothing written (got ${describe(b)})`);
    // A person with the right groups and no sign-in id is nobody.
    const noSub = run(vote, { ...C.panel2A, sub: undefined as any, claims: { sub: undefined } }, { body: plainBody });
    if (statusOf(noSub) !== 403) wrong.push(`a sign-in without a person id is refused 403 (got ${describe(noSub)})`);

    // The scoring link: unchanged, an unexpired token of A still works; the voter is the link's panel member, never the body's.
    const tok = (token: string, extra: Record<string, unknown> = {}) => runEvent('submitVoteByToken', {
      version: '2.0', routeKey: 'POST /v1/scoring/{token}/votes', rawPath: `/v1/scoring/${token}/votes`, pathParameters: { token }, headers: { 'content-type': 'application/json' },
      requestContext: { http: { method: 'POST', path: `/v1/scoring/${token}/votes` } },
      body: JSON.stringify({ rating: 'YES', scores: { technical: 4, communication: 4, culturalFit: 4, problemSolving: 4 }, ...extra }), isBase64Encoded: false,
    });
    const link = tok(ID.tokenA, { voterId: 'forged-voter', staffId: 'STAFF-x' });
    if (statusOf(link) !== 200) wrong.push(`the scoring link of A answers 200 (got ${describe(link)})`);
    if (votesOf(link.tables).length !== base + 1 || !votesOf(link.tables).some((r) => r['voterId'] === SUB.panel2A && r['candidateId'] === ID.c2)) wrong.push('the scoring link stores one vote under the link\'s panel member, as today');
    if (votesOf(link.tables).some((r) => r['voterId'] === 'forged-voter')) wrong.push('the scoring link does not read a voterId from the body');
    const old = tok(ID.tokenExpiredA);
    if (statusOf(old) === 200 || votesOf(old.tables).length !== base) wrong.push(`an expired scoring link is refused as today and writes nothing (got ${describe(old)})`);

    // The event (no sign-in) is the system, not a person: it keeps naming its voter, as TEN-03 AC-5 has it.
    const evt = runEvent('submitVote', { 'detail-type': 'VoteSubmitted', source: 'talentflow', detail: { tenant_id: A, candidateId: ID.c2, voterId: 'event-voter', interviewId: ID.i2, rating: 'YES', scores: { technical: 4, communication: 4, culturalFit: 4, problemSolving: 4 } } });
    if (!votesOf(evt.tables).some((r) => r['voterId'] === 'event-voter' && r['candidateId'] === ID.c2)) wrong.push(`the VoteSubmitted event still stores the vote under the voter it names (got ${describe(evt)})`);
    expect(wrong, 'the voter is the signed-in person on the panel').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 Company and module order: another company\'s row is 404 for everyone; the role answer comes before any module read', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(480_000);
    const wrong: string[] = [];
    // A Recruiter of B calling A's candidate gets 404, as a candidate that does not exist; and writes nothing.
    for (const r of ROUTES.filter((x) => x.own.path?.['id'] === ID.c1 || x.own.path?.['id'] === ID.c2)) {
      if (r.kind === 'vote') continue;
      for (const [c, want] of [[C.recruiterB, 404], [C.managerB, 404], [C.panelB, 404]] as [Caller, number][]) {
        if (c !== C.recruiterB && r.kind !== 'relation') continue;
        const before = tables();
        const got = run(r, c, {}, { tables: before });
        const ghost = run(r, c, { path: { ...r.own.path, id: 'CAND-01REC01GHOSTGHOSTGHOST9' } });
        // A Recruiter of B is allowed through the role check on a recruiter route, so the row decides: 404.
        const roleOk = r.kind === 'recruiter' || r.kind === 'relation' ? c === C.recruiterB : false;
        if (!roleOk) continue;
        if (statusOf(got) !== want || JSON.stringify(bodyOf(got)) !== JSON.stringify(NOT_FOUND)) wrong.push(`${r.name} | ${c.name} on A's candidate: want 404 Not found, got ${describe(got)}`);
        if (JSON.stringify(bodyOf(got)) !== JSON.stringify(bodyOf(ghost)) || statusOf(got) !== statusOf(ghost)) wrong.push(`${r.name} | ${c.name}: answers like a candidate that does not exist`);
        if (JSON.stringify(got.tables) !== JSON.stringify(before)) wrong.push(`${r.name} | ${c.name}: nothing changed`);
      }
    }
    // The Recruiter of B still works on B's own candidate (control), and lists only B's.
    const list = routeOf('getCandidates');
    const lb = run(list, C.recruiterB);
    if (statusOf(lb) !== 200 || JSON.stringify(ids(lb)) !== JSON.stringify([ID.cb1])) wrong.push(`the Recruiter of B lists only B's candidate (got ${describe(lb).slice(0, 160)})`);
    if (statusOf(run(routeOf('getCandidate'), C.recruiterB, { path: { id: ID.cb1 } })) !== 200) wrong.push('the Recruiter of B opens B\'s own candidate');
    // Role before module, company before module: a wrong-role caller of D (Recruitment off) gets the role answer with no AWS call;
    // the right role gets the module refusal after exactly one read.
    for (const r of ROUTES.filter((x) => x.kind !== 'relation' && x.kind !== 'vote')) {
      const emp = run(r, C.employeeD);
      if (statusOf(emp) !== 403 || JSON.stringify(bodyOf(emp)) !== JSON.stringify(FORBIDDEN) || calls(emp).length) wrong.push(`${r.name} | an employee of D: the role answer 403 with no AWS call (got ${describe(emp)}, calls ${calls(emp).length})`);
      const rec = run(r, C.recruiterD);
      const lines = calls(rec).map((c: any) => `${c.service} ${c.op} ${c.table ?? ''}`.trim());
      if (r.kind === 'settings' && r.write) continue;
      if (statusOf(rec) !== 403 || JSON.stringify(bodyOf(rec)) !== JSON.stringify(FORBIDDEN) || lines.length !== 1 || !/GetItem/.test(lines[0]!) || !lines[0]!.includes(TENANTS)) wrong.push(`${r.name} | a Recruiter of D: the module refusal after one read of the company list (got ${describe(rec)}, calls ${JSON.stringify(lines)})`);
    }
    // No company: the role passes or fails first, then the company check, with no AWS call at all.
    for (const r of ROUTES.filter((x) => x.kind !== 'relation' && x.kind !== 'vote')) {
      for (const c of [C.recruiterNoCompany, C.employeeNoCompany]) {
        const got = run(r, c);
        if (statusOf(got) !== 403 || JSON.stringify(bodyOf(got)) !== JSON.stringify(FORBIDDEN) || calls(got).length) wrong.push(`${r.name} | ${c.name}: 403 Forbidden with no AWS call (got ${describe(got)}, calls ${calls(got).length})`);
      }
    }
    // The company is not taken from the request: a Recruiter of B naming A anywhere still reaches only B.
    const named = run(list, C.recruiterB, { query: { tenantId: A, tenant_id: A, company: A }, headers: { 'x-tenant-id': A } });
    if (JSON.stringify(ids(named)) !== JSON.stringify([ID.cb1])) wrong.push(`a company named in the query or a header changes nothing (got ${JSON.stringify(ids(named))})`);
    expect(wrong, 'company and module order').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 Text checks: no group name in a Recruitment handler, no body voter, every Lambda on the list imports and calls the access file, a planted folder fails', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(6 * 60_000);
    const accessFile = join(LAMBDA, 'shared', 'recruitment-access.mjs');
    expect(existsSync(accessFile), 'lambda/shared/recruitment-access.mjs exists').toBe(true);
    const accessText = existsSync(accessFile) ? stripJs(readFileSync(accessFile, 'utf8')) : '';
    expect.soft(accessText, 'it imports roles.mjs (TEN-05\'s file is read, not edited)').toMatch(/from\s+['"]\.\/roles\.mjs['"]/);
    const exportsRun = runModule([], { tables: tables(), env: { TENANTS_TABLE: TENANTS } });
    const names = exportsRun.exports.filter((n) => typeof n === 'string');
    expect(names.length, 'it exports its functions').toBeGreaterThan(5);

    // TEN-05 AC-4 style: a group name as a whole quoted string, or a group claim read. Words in messages are fine.
    const NAMES = 'hr_staff|perm-recruitment|perm-it|perm-approve-offers|naleko-talentflow-[a-z]+|naleko-onboarding-hr|naleko-it-provisioning|TalentFlowAdmin|HRDirector|HiringManager|ITAdmin|ITSpecialist|FinanceLead|PanelMember|ComplianceOfficer';
    const nameRe = new RegExp(`['"\`](${NAMES})['"\`]`, 'g');
    const claimRe = /\[\s*(['"`])(cognito:groups|custom:isAdmin|custom:roles)\1\s*\]|(['"`])(cognito:groups|custom:isAdmin|custom:roles)\3\s*:/g;
    // createOffer's approval chain names the approver roles as data (who must approve), not as an access check; that data is exempt.
    const CHAIN_DATA = new Set(['HiringManager', 'FinanceLead', 'HRDirector']);
    const handlerOf = (name: string) => ['index.js', 'index.mjs'].map((f) => join(LAMBDA, name, f)).find(existsSync)!;
    for (const name of LIST_LAMBDAS) {
      const file = handlerOf(name);
      expect.soft(!!file, `${name} has a handler file`).toBe(true);
      if (!file) continue;
      const src = stripJs(readFileSync(file, 'utf8'));
      const hits = [...(src.match(nameRe) ?? []).filter((m) => !(name === 'createOffer' && CHAIN_DATA.has(m.slice(1, -1)))), ...(src.match(claimRe) ?? [])];
      expect.soft(hits, `${name}: no group name or group claim in the handler (roles come from lambda/shared)`).toEqual([]);
      // No body voterId, staffId or createdBy anywhere.
      expect.soft(src.match(/\b(body|detail|payload|input)\??\.(voterId|staffId|createdBy)\b|\b(body|detail|payload|input)\??\[\s*['"](voterId|staffId|createdBy)['"]\s*\]/g) ?? [], `${name}: no body.voterId, staffId or createdBy`).toEqual([]);
      expect.soft(src.match(/\{[^{}]*\b(voterId|staffId|createdBy)\b[^{}]*\}\s*=\s*(body|JSON\.parse\(\s*event\.body)/g) ?? [], `${name}: no voterId, staffId or createdBy taken out of the body`).toEqual([]);
      // It imports the access file and calls one of its functions.
      expect.soft(src, `${name}: imports lambda/shared/recruitment-access.mjs`).toMatch(/recruitment-access\.mjs/);
      const firstCall = src.search(new RegExp(`\\b(${names.join('|')})\\s*\\(`));
      expect.soft(firstCall, `${name}: calls a recruitment-access function (that it comes before any AWS call is proven by AC-2 and AC-6: no AWS call before a role refusal)`).toBeGreaterThanOrEqual(0);
    }

    // The CI test: lambda/shared/recruitment-access.test.mjs, in npm test, naming every Lambda on the list, failing on a planted folder.
    const TEST = join(LAMBDA, 'shared', 'recruitment-access.test.mjs');
    expect(existsSync(TEST), 'lambda/shared/recruitment-access.test.mjs exists').toBe(true);
    const pkg = JSON.parse(readFileSync(join(LAMBDA, 'shared', 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    expect.soft(pkg.scripts?.['test'] ?? '', 'npm test in lambda/shared runs it (the Lambda unit tests job)').toContain('recruitment-access.test.mjs');
    const text = readFileSync(TEST, 'utf8');
    const lists = text + readdirSync(join(LAMBDA, 'shared')).filter((f) => f.endsWith('.json') && text.includes(f)).map((f) => readFileSync(join(LAMBDA, 'shared', f), 'utf8')).join('\n');
    for (const name of LIST_LAMBDAS) expect.soft(lists, `the CI test's list names ${name}`).toMatch(new RegExp(`['"\`]${name}['"\`]`));

    const copy = mkdtempSync(join(tmpdir(), 'rec-01-ci-'));
    const lambda = join(copy, 'lambda');
    cpSync(LAMBDA, lambda, { recursive: true, filter: (src) => !/[\\/](node_modules|coverage|dist)([\\/]|$)/.test(relative(LAMBDA, src)) && !/\.zip$/.test(src) });
    const nodeTest = () => {
      const r = spawnSync(process.execPath, ['--test', 'recruitment-access.test.mjs'], { cwd: join(lambda, 'shared'), encoding: 'utf8', timeout: 120_000, env: { PATH: process.env['PATH'] ?? '', CI: 'true' } });
      return { status: r.status, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
    };
    try {
      const base = nodeTest();
      expect(base.status, `node --test recruitment-access.test.mjs passes on the repo as it is:\n${base.output.slice(-2000)}`).toBe(0);
      const exportRe = new RegExp(`\\b(${names.join('|')})\\b`, 'g');
      for (const folder of ['getCandidates', 'createCandidate', 'submitVote', 'getOffer']) {
        const handler = ['index.js', 'index.mjs'].map((f) => join(lambda, folder, f)).find(existsSync)!;
        const original = readFileSync(handler, 'utf8');
        for (const [what, plant] of [
          [`${folder} without any call to the access file`, original.replace(exportRe, (m) => `${m}Removed`)],
          [`${folder} without the recruitment-access.mjs import`, original.replace(/recruitment-access\.mjs/g, 'tenant.mjs')],
        ] as const) {
          expect.soft(plant === original, `${what}: the plant changes the file`).toBe(false);
          writeFileSync(handler, plant);
          const caught = nodeTest();
          expect.soft(caught.status, `${what}: the CI test fails`).not.toBe(0);
          expect.soft(caught.output, `${what}: and names the folder`).toContain(folder);
          writeFileSync(handler, original);
        }
      }
      // A new folder on the list that never calls the access file is caught too: the list in the test is the way in.
      expect(nodeTest().status, 'put back, it passes again').toBe(0);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Roles: no new IAM action on any Recruitment Lambda role', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const baseline = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-01', 'iam-08f2aa0', 'policies.json'), 'utf8')) as Record<string, { role: string; pairs?: string[]; squash?: string }>;
    const all = policyLines();
    const gatedRoles = new Set<string>();
    for (const name of LIST_LAMBDAS) for (const { stack, block } of lambdaNamed(name)) { const r = roleResourceOf(block); const info = r ? roleInfo(stack, r) : undefined; if (r) gatedRoles.add(`${stack}:${r}`); if (info) gatedRoles.add(`name:${info.name}`); }
    expect(gatedRoles.size, 'the Recruitment Lambdas are found in Terraform').toBeGreaterThan(5);
    const isGated = (key: string, role: string) => { const stack = key.split('/')[0] as Stack; return gatedRoles.has(`${stack}:${role}`) || gatedRoles.has(`name:${valueOf(stack, role)}`); };
    // Against develop 08f2aa0 (MOD-01 merged): nothing a Recruitment Lambda's role had is taken away, and it gets no new action.
    // The one allowed addition is the tenants-table GetItem TEN-03 and MOD-01 already give (Iggie's owed read grants).
    for (const [key, cur] of Object.entries(all)) {
      if (!isGated(key, cur.role)) continue;
      const was = baseline[key];
      // TEN-04.2 (re-locked by acceptance-lock/ten-03.3): PR 407's dev read grants (a table-level GetItem or Query on the state or notifications table) are applied on dev already.
      if (!was) { expect.soft((cur.pairs ?? []).length > 0 && (cur.pairs ?? []).every((p) => isCardGrant(p, cur.stack, cur.role)), `new role policy ${key} on a Recruitment Lambda's role: REC-01 adds no IAM`).toBe(true); continue; }
      if (was.squash !== undefined || cur.squash !== undefined) { expect.soft(cur.squash, `role policy ${key}: unchanged`).toBe(was.squash); continue; }
      const added = (cur.pairs ?? []).filter((p) => !(was.pairs ?? []).includes(p));
      for (const p of added) {
        if (isCardGrant(p, cur.stack, cur.role)) continue;
        expect.soft(/^Allow dynamodb:GetItem /.test(p) && TENANTS_RESOURCE.test(p.split(' ')[2]!) && p.endsWith(' null'), `role policy ${key}: new grant "${p}" is not allowed (only GetItem on the tenants table, which TEN-03 and MOD-01 own)`).toBe(true);
      }
      expect.soft((was.pairs ?? []).filter((p) => !(cur.pairs ?? []).includes(p)), `role policy ${key}: nothing it had is taken away`).toEqual([]);
    }
    for (const [key, cur] of Object.entries(all)) {
      const had = new Set(baseline[key]?.pairs ?? []);
      if (isGated(key, cur.role)) expect.soft((cur.pairs ?? []).filter((p) => !had.has(p) && /\*/.test(p.split(' ')[1]!)), `role policy ${key}: no wildcard action`).toEqual([]);
    }
    // No managed policy is attached to a Recruitment Lambda role either.
    const tf = ['infra', 'talent-flow-infra'].map((d) => readdirSync(join(REPO, d)).filter((f) => f.endsWith('.tf')).map((f) => readFileSync(join(REPO, d, f), 'utf8')).join('\n')).join('\n');
    void tf;
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 The test logins on pepla-dev: HR lists candidates, the manager only their one, the rest are refused @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-2 to AC-6.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(6 * 60_000);
    const env = (k: string) => process.env[k] ?? '';
    const login = (p: string) => ({ email: env(`${p}_EMAIL`), password: env(`${p}_PASSWORD`) });
    const logins = { hr: login('E2E_HR'), employee: login('E2E_EMP'), guest: login('E2E_GUEST'), manager: login('E2E_MANAGER'), hrNoTick: login('E2E_HR_NOTICK') };
    for (const [who, l] of Object.entries(logins)) expect(l.email && l.password, `the ${who} test login is set (E2E_${who === 'employee' ? 'EMP' : who === 'hrNoTick' ? 'HR_NOTICK' : who.toUpperCase()}_EMAIL and _PASSWORD, from load-e2e-logins.py)`).toBeTruthy();
    const { region, clientId } = devEnv();
    const oldEnv = join(REPO, 'hr-portal', 'src', 'environments', 'environment.ts');
    const tfApi = (/talentFlow\s*:\s*\{[^}]*?apiUrl\s*:\s*['"`]([^'"`]+)['"`]/s.exec(existsSync(oldEnv) ? readFileSync(oldEnv, 'utf8') : '')?.[1] ?? '').replace(/\/+$/, '').replace(/\/v1$/, ''); // the dev E2E writes talentFlow.apiUrl with a trailing /v1; the routes below add it
    expect(tfApi, 'the TalentFlow API address is written for pepla-dev (hr-portal environment.ts, talentFlow.apiUrl)').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const signIn = async (l: { email: string; password: string }) => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: l.email, PASSWORD: l.password } }),
      });
      expect(r.status(), 'signs in at Cognito').toBe(200);
      return ((await r.json()) as any).AuthenticationResult.IdToken as string;
    };
    const get = async (token: string, path: string) => page.request.get(`${tfApi}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const every = async (token: string) => {
      const out: string[] = [];
      let next = '';
      for (let i = 0; i < 20; i++) {
        const r = await get(token, `/v1/candidates${next ? `?nextToken=${encodeURIComponent(next)}` : ''}`);
        expect(r.status(), 'the list answers 200').toBe(200);
        const b = (await r.json()) as { candidates?: { candidateId?: string; id?: string }[]; nextToken?: string };
        out.push(...(b.candidates ?? []).map((c) => String(c.candidateId ?? c.id)));
        if (!b.nextToken) break;
        next = b.nextToken;
      }
      return out;
    };

    const hrToken = await signIn(logins.hr);
    const hrList = await every(hrToken);
    expect(hrList.length, 'the HR test login (HR with the tick) lists the company\'s candidates (the same count as before the merge: compare with the run before it)').toBeGreaterThan(1);
    testInfo.annotations.push({ type: 'hr-candidate-count', description: String(hrList.length) });
    for (const who of ['employee', 'guest', 'hrNoTick'] as const) {
      const r = await get(await signIn(logins[who]), '/v1/candidates');
      expect(r.status(), `${who}: GET /v1/candidates answers 403`).toBe(403);
      expect(await r.json(), `${who}: {"error":"Forbidden"}`).toEqual(FORBIDDEN);
    }
    const mgrToken = await signIn(logins.manager);
    const mine = await every(mgrToken);
    expect(mine.length, 'the manager test login lists exactly the one candidate they are hiring for').toBe(1);
    const other = hrList.find((id) => id !== mine[0]);
    expect(other, 'the company has another candidate').toBeTruthy();
    expect((await get(mgrToken, `/v1/candidates/${mine[0]}`)).status(), 'the manager opens their own candidate').toBe(200);
    const theirs = await get(mgrToken, `/v1/candidates/${other}`);
    expect(theirs.status(), 'the manager gets 404 for another candidate').toBe(404);
    expect(await theirs.json(), 'with {"error":"Not found"}').toEqual(NOT_FOUND);
  });
});

// ---------------------------------------------------------------- helpers

/** JavaScript with comments blanked out; strings kept. */
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
void [findRow, RECRUITER_FORMS, D];
