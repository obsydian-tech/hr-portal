import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO } from './support/rec-14/lambda-harness';
import { policyLines } from './support/rec-02/iam';
import { ask } from './support/rec-04/world';
import {
  A, B, C, DRAFT, EXPIRY, EXPIRY_DAY, H, K, NOW, OFFER, P, R, REC_U, SUB, TABLE, TENANTS, X, CAND_EMAIL,
  W, token, av, bodyOf, describe as say, interviewRowPlain, seedRow, candidateRowForD, draftRows, drafts, evaluate, firings, flagsFor, idsOf, interviewRow, invoke, linkRow, liveLock, logsOf, monitor, notifRows, offerRowOf, plain,
  pool, postmarkOf, queued, recipients, rowsOf, send, stateRow, statusOf, stream, tiles, voteRow, withNewVersion, withRows, withSetting, world,
  type Run, type Tables,
} from './support/rec-09/world';

/**
 * REC-09 (NH-243) Rules reach real people, interviewers are reminded from a template, HR gets drafts. Amber. Spec:
 * /mnt/project-files/onboarding-cards/specs/REC-09.md (patched 28 Nov: RULE-DROP-001 is gone, RULE-QUIET-001 and RULE-QUIETSTRONG-001 come in
 * REC-17). Notes and the pinned choices: cards/rec-09.md. Review page: onboarding-cards/rec-09/REC-09-tests-for-review.md.
 *
 * Lambda tests: the real evaluateIntelligenceRules, getIntelligenceTiles, monitorTalentFlowSLAs, sendTalentFlowNotification and manageDrafts
 * (and lambda/shared/recipients.mjs) run in a fresh Node process each call, against REC-14's fake AWS (DynamoDB, Cognito, SQS, Postmark; the
 * fakes are unchanged), over INT-01's world (companies A and B with the real Standard pack) plus this card's people and candidates
 * (support/rec-09/world.ts), at REC-15's fixed clock (2026-11-23 12:00 UTC unless a test moves it). Nothing calls AWS or any AI. Nothing here
 * has a screen width: each test runs once, at 1280. AC-10's dev part runs on pepla-dev only.
 *
 * Pinned by the test writer where the spec leaves a choice (each is in cards/rec-09.md):
 *  - D-T-9.1  The nine rules of the pack and their titles: SLA-002 "Waiting too long in {stage}", SLA-001 "Over time in {stage}", FEEDBACK-001
 *             "Feedback overdue from {name}", MISSED-001 "Missed interview", PANEL-001 "Panel split on {name}", STRONGNO-001 "Strong no from
 *             {name}: read before deciding", DECISION-001 "Decision needed on {name}", APPROVAL-001 "Offer approval waiting", OFFER-001 "Offer
 *             expires {day}". {stage} is Applied, Screening, Interview or Offer; {name} is the candidate's name, except FEEDBACK-001 (the first
 *             panel member who owes feedback) and STRONGNO-001 (the person who voted Strong no); {day} is the weekday of the offer's expiry.
 *  - D-T-9.2  A flag is an in-app row in the notifications table: PK USER#<sub>, SK NOTIF#<time>#<rule>#<candidate>, type FLAG, title, candidateId,
 *             ruleId, settingsVersion, severity, tenant_id, read false. Cooldown is per person, rule and candidate, in hours (action.cooldown).
 *  - D-T-9.3  The event row of rule 5 is in the events table (EVENTS_TABLE_NAME): PK TENANT#<company>, SK INTEL#<time>#<id>, with the fields of
 *             the spec (rule_id, rule_version, candidate_id, signals_seen, severity, recipients_count, at) and tenant_id.
 *  - D-T-9.4  The tile's `why` is { rule_id, signals_seen, rule_version }. A tile carries no risk score.
 *  - D-T-9.5  Where the missed interview is kept: the job sets interviewMissedAt on the candidate's row (signal INTERVIEW_MISSED). The job also
 *             copies an offer's expiry (a SENT offer inside offerExpiryWarningDays, default 3) and its waiting-for-approval time onto the
 *             candidate's row, so the engine judges them.
 *  - D-T-9.6  The reminder is queued as { type INTERVIEWER_REMINDER, tenant_id, recipientId, recipientEmail, candidateId, interviewId, subject,
 *             body } with the template filled ({candidate} first and last name, {role} the role's title, {date} and {due} as "22 Nov 2026" in
 *             South African time, {link} FRONTEND_URL/hire/feedback/<interview id>). The sender mails it as plain words (HTML escaped).
 *             One guard row per member, interview and day (notifications table, PK INTERVIEWER_REMINDER#...). A guest is not a panel member and
 *             REC-07 keeps only a hash of a guest link, so a guest is never emailed; the person who owes feedback is flagged to HR instead.
 *  - D-T-9.7  A draft is a row in the state table: PK CANDIDATE#<id>, SK DRAFT#<id>, status DRAFT, SENT or DISMISSED, kind, body, to_email,
 *             candidate_name, tenant_id; the routes answer { id, candidateId, candidateName, toEmail, kind, body, status, createdAt }. A send
 *             queues { type DRAFT_EMAIL, tenant_id, recipientEmail, candidateId, subject, body } and marks the draft SENT in one conditional write.
 *  - D-T-9.8  An unlocked candidate reads the active settings; a candidate locked to an older version (settingVersions) reads that version.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const FORBIDDEN = { error: 'Forbidden' };
const NOT_FOUND = { error: 'Not found' };
/** What a caller who wants to act for company `c` would put in headers and query. Each call below sends the OTHER company's. */
const forged = (c: string) => ({
  headers: { 'x-tenant-id': c, 'X-Tenant-Id': c, 'x-company-id': c, 'tenant-id': c, tenant_id: c },
  query: { tenant_id: c, tenantId: c, company_id: c, companyId: c },
});
const FORGED_A = forged(A); // sent by company B's people
const FORGED_B = forged(B); // sent by company A's people
const read = (...p: string[]) => readFileSync(join(REPO, ...p), 'utf8');
/** The people a set of notification rows belong to, sorted. */
const who = (rows: Record<string, any>[]) => rows.map((n) => String(n['PK']).replace(/^USER#/, '')).sort();
const sorted = (...s: string[]) => [...s].sort();
const RECRUITERS_A = sorted(SUB.recA, REC_U, X.rec2);
/** The saga row of a candidate in a world, as plain values. */
const sagaOf = (t: Tables, id: string) => rowsOf(t, TABLE.state).find((r) => r['PK'] === `CANDIDATE#${id}` && r['SK'] === 'SAGA')!;
const sagaRow = (t: Tables, id: string) => (t[TABLE.state] ?? []).find((r) => r['PK']?.['S'] === `CANDIDATE#${id}` && r['SK']?.['S'] === 'SAGA')!;
const withSaga = (t: Tables, id: string, change: Record<string, any>): Tables => {
  const out = structuredClone(t);
  out[TABLE.state] = (out[TABLE.state] ?? []).map((r) => {
    if (r['PK']?.['S'] !== `CANDIDATE#${id}` || r['SK']?.['S'] !== 'SAGA') return r;
    const m: Record<string, any> = { ...plain(r), ...change };
    for (const [k, v] of Object.entries(change)) if (v === undefined) delete m[k];
    return av(m);
  });
  return out;
};
/** A candidate's interview with votes, as rows. */
const iv = (id: string, cand: string, o: { at: string; type?: string; status?: string; panel?: string[]; company?: string; sequence?: number | null }) =>
  interviewRow({ id, cand, at: o.at, ...(o.type ? { type: o.type } : {}), ...(o.status ? { status: o.status } : {}), ...(o.panel ? { panel: o.panel } : {}), ...(o.company ? { company: o.company } : {}), ...(o.sequence !== undefined ? { sequence: o.sequence } : {}) });
/** The company's rule set replaced (a new active version); answers the world and the version. */
const withRules = (t: Tables, company: string, rules: unknown[]) => withNewVersion(t, company, 'INTELLIGENCE_RULES', () => ({ rules }));
const ALWAYS = [{ signal: 'CANDIDATE_STAGE', operator: 'equals', value: 'APPLIED' }];
const noteRule = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id, enabled: true, severity: 'MEDIUM', targetRoles: ['HR_RECRUITMENT'], conditions: ALWAYS, action: { type: 'NOTIFY', cooldown: 24 }, ...over });

const TITLES: Record<string, string> = {
  'RULE-SLA-002': 'Waiting too long in Interview', 'RULE-SLA-001': 'Over time in Interview', 'RULE-FEEDBACK-001': 'Feedback overdue from Thandi Mokoena', 'RULE-MISSED-001': 'Missed interview',
  'RULE-PANEL-001': 'Panel split on Ivy Interview', 'RULE-STRONGNO-001': 'Strong no from Sizwe: read before deciding', 'RULE-DECISION-001': 'Decision needed on Ivy Interview',
  'RULE-APPROVAL-001': 'Offer approval waiting', 'RULE-OFFER-001': `Offer expires ${EXPIRY_DAY}`,
};
const NINE = Object.keys(TITLES);

test.describe('REC-09 rules reach people, reminders, drafts', () => {
  // ---------------------------------------------------------------- AC-1

  test('AC-1 Rules come from data: the hard-coded rule map is gone, a tile exists only for a rule the locked version holds, RULE-EVAL-001 fires for nobody, a rule for TA, HM or IT is refused on save', async ({}, testInfo) => {
    once(testInfo.project.name);
    const tilesSrc = read('lambda', 'getIntelligenceTiles', 'index.js');
    const engineSrc = read('lambda', 'evaluateIntelligenceRules', 'index.js');
    expect.soft(tilesSrc, 'the tiles file has no RULE_CONFIG map').not.toMatch(/\bRULE_CONFIG\b/);
    expect.soft(tilesSrc, 'and no role gate by TA, HM or IT').not.toMatch(/isRuleVisibleToRole/);
    expect.soft(tilesSrc.match(/['"`]RULE-[A-Z]+-\d+['"`]/g) ?? [], 'the tiles file names no rule id in code').toEqual([]);
    expect.soft(engineSrc, 'the engine no longer reads the rules from the old config reader').not.toMatch(/loadIntelligenceConfig\(tenantId\)\s*;/);
    // The pack holds the nine rules and none of the retired ones.
    const t = world();
    const ruleIds = (rowsOf(t, TABLE.config).find((r) => r['PK'] === `TENANT#${A}` && String(r['SK']).startsWith('CONFIG#INTELLIGENCE_RULES#') && r['isActive'] === true)?.['data']?.rules ?? []).map((r: any) => r.id).sort();
    expect(ruleIds, 'the Standard pack holds the nine rules of this card').toEqual([...NINE].sort());
    // A tile exists only for a rule of the candidate's locked version.
    const only = withRules(t, A, [noteRule('RULE-SLA-002', { conditions: [{ signal: 'SLA_STATUS', operator: 'equals', value: 'AT_RISK' }] })]);
    const ran = evaluate(t, [K.late]);
    expect(ran.error, say(ran)).toBeUndefined();
    const v1 = tiles(C.recruiter, ran.tables);
    expect.soft(bodyOf(v1).tiles.map((x: any) => x.ruleId), 'the pack version: the Over time tile').toEqual(['RULE-SLA-001']);
    const world2 = { ...ran.tables, [TABLE.config]: only.t[TABLE.config]! };
    const unlocked = tiles(C.recruiter, world2);
    expect.soft(bodyOf(unlocked).tiles, 'an unlocked candidate reads the new version, which has no rule for BREACHED: no tile').toEqual([]);
    const lockedWorld = withSaga(world2, K.late, { settingVersions: { INTELLIGENCE_RULES: 1 } });
    expect.soft(bodyOf(tiles(C.recruiter, lockedWorld)).tiles.map((x: any) => x.ruleId), 'a candidate locked to version 1 still reads version 1').toEqual(['RULE-SLA-001']);
    // RULE-EVAL-001 (and the rules 28 Nov removed) fire for nobody, wherever they appear.
    const retired = ['RULE-EVAL-001', 'RULE-DROP-001', 'RULE-COOLING-001', 'RULE-HIPO-001', 'RULE-FASTTRACK-001', 'RULE-RISK-001'];
    const withRetired = withRules(t, A, retired.map((id) => noteRule(id)));
    const gone = evaluate(withRetired.t, [K.late]);
    expect.soft(notifRows(gone.tables), 'a retired rule id sends no flag').toEqual([]);
    expect.soft(firings(gone.tables), 'and writes no event row').toEqual([]);
    expect.soft(bodyOf(tiles(C.recruiter, { ...gone.tables })).tiles, 'and makes no tile').toEqual([]);
    // A rule for TA, HM or IT is refused on save (an Admin saves).
    const saved = (rule: unknown, caller: any = C.adminOnly) => ask('manageTalentFlowConfig', caller, { method: 'PUT', body: { configType: 'INTELLIGENCE_RULES', data: { rules: [rule] } } }, { tables: world() });
    for (const target of ['TA', 'HM', 'IT', 'HR', '']) {
      const r = saved(noteRule('RULE-X-001', { targetRoles: [target] }));
      expect.soft([statusOf(r), bodyOf(r)], `a rule for "${target}" is refused on save`).toEqual([400, { error: 'Bad request', code: 'INVALID_SETTING' }]);
    }
    const mixed = saved(noteRule('RULE-X-001', { targetRoles: ['HR_RECRUITMENT', 'TA'] }));
    expect.soft(statusOf(mixed), 'one bad target among good ones is refused').toBe(400);
    const good = saved(noteRule('RULE-X-001', { targetRoles: ['HR_RECRUITMENT', 'HIRING_MANAGER', 'PANEL_MEMBER', 'DECIDER', 'APPROVER'] }));
    expect.soft(statusOf(good), `all five internal names are accepted (${say(good)})`).toBe(200);
    // B's admin saves to B only; A is untouched.
    const forB = ask('manageTalentFlowConfig', C.adminB, { method: 'PUT', body: { configType: 'INTELLIGENCE_RULES', data: { rules: [noteRule('RULE-B-001')] } }, headers: FORGED_A.headers, query: FORGED_A.query }, { tables: world() });
    expect.soft(statusOf(forB), 'B\'s admin saves for B').toBe(200);
    expect.soft(rowsOf(forB.tables, TABLE.config).filter((r) => r['tenant_id'] === A && String(r['SK']).startsWith('CONFIG#INTELLIGENCE_RULES#')).map((r) => r['SK']), 'and A\'s settings are not touched').toEqual(['CONFIG#INTELLIGENCE_RULES#v1']);
    // The tiles read B's own rules for B's candidate, never A's.
    const lateB = evaluate(world(), [K.lateB]);
    expect.soft(bodyOf(tiles(C.recruiterB, lateB.tables)).tiles.map((x: any) => [x.entityId, x.priority]), 'B\'s Recruiter sees B\'s overdue candidate, at B\'s own severity (LOW; A\'s rule says HIGH)').toEqual([[K.lateB, 'LOW']]);
    expect.soft(bodyOf(tiles(C.recruiterB, lateB.tables, FORGED_A)).tiles.map((x: any) => [x.entityId, x.priority]), 'B\'s Recruiter forging A\'s company: the same, B\'s').toEqual([[K.lateB, 'LOW']]);
    expect.soft(bodyOf(tiles(C.recruiter, lateB.tables, FORGED_B)).tiles, 'A\'s Recruiter forging B\'s company: still none of B\'s').toEqual([]);
    expect.soft(bodyOf(tiles(C.recruiter, lateB.tables)).tiles, 'A\'s Recruiter sees none of B\'s').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 Recipients: for each target the right people of A and none of B; the drafter is not an approver; with no match nothing is written and one "No recipient" line with ids only; no system address and no DEFAULT', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const cand = (id: string) => sagaOf(t, id);
    const ids = (target: string, context: unknown, company = A, tw = t) => idsOf(recipients(company, target, context, tw));
    expect(ids('HR_RECRUITMENT', {}), 'HR_RECRUITMENT: the Recruiters of A (hr_staff with perm-recruitment, confirmed, enabled, a Member of A only)').toEqual(RECRUITERS_A);
    expect.soft(ids('HR_RECRUITMENT', {}, B), 'B\'s Recruiters are B\'s own').toEqual([SUB.recB]);
    // The role's hiring manager; else the candidate's own.
    expect.soft(ids('HIRING_MANAGER', { candidate: cand(K.late) }), 'a Fleet candidate: the Fleet role\'s hiring manager').toEqual([SUB.hmA]);
    expect.soft(ids('HIRING_MANAGER', { candidate: cand(K.lateHm2) }), 'a Warehouse candidate: that role\'s hiring manager').toEqual([SUB.hm2A]);
    const noRole = withSaga(t, K.late, { role_id: undefined, hiringManagerId: SUB.hm2A });
    expect.soft(ids('HIRING_MANAGER', { candidate: sagaOf(noRole, K.late) }, A, noRole), 'no role: the candidate\'s hiringManagerId').toEqual([SUB.hm2A]);
    const offMgr = withSaga(t, K.late, { role_id: undefined, hiringManagerId: X.hmOff });
    expect.soft(ids('HIRING_MANAGER', { candidate: sagaOf(offMgr, K.late) }, A, offMgr), 'a disabled hiring manager gets nothing').toEqual([]);
    const strangerMgr = withSaga(t, K.late, { role_id: undefined, hiringManagerId: SUB.hmB });
    expect.soft(ids('HIRING_MANAGER', { candidate: sagaOf(strangerMgr, K.late) }, A, strangerMgr), 'a hiring manager who belongs to B is never a recipient of A').toEqual([]);
    expect.soft(ids('HIRING_MANAGER', { candidate: cand(K.lateB) }, B), 'B\'s own candidate: B\'s hiring manager').toEqual([SUB.hmB]);
    expect.soft(ids('HIRING_MANAGER', { candidate: cand(K.lateB) }, A), 'B\'s candidate asked in A\'s name: nobody').toEqual([]);
    // The panel members who have not voted.
    const panel = interviewRowPlain(t, 'iv-09-panel', K.iv, [P.p1, P.p2, P.p3, SUB.hmB, X.recOff]);
    const votes = [{ interviewId: 'iv-09-panel', voterId: P.p1 }];
    expect.soft(ids('PANEL_MEMBER', { candidate: cand(K.iv), interview: panel, votes }), 'PANEL_MEMBER: members who have not voted; a person of B and a disabled one are left out').toEqual(sorted(P.p2, P.p3));
    expect.soft(ids('PANEL_MEMBER', { candidate: cand(K.iv), interview: panel, votes: [] }), 'with no votes: every member of A on the panel').toEqual(sorted(P.p1, P.p2, P.p3));
    // The deciders.
    const level = (v: string) => ({ decider: { JUNIOR: v, MID: v, SENIOR: v } });
    const dec = (v: string) => ids('DECIDER', { candidate: cand(K.late), rejectionRules: level(v) });
    expect.soft(dec('HR_OR_HM'), 'DECIDER under HR_OR_HM: the Recruiters and the hiring manager').toEqual(sorted(...RECRUITERS_A, SUB.hmA));
    expect.soft(dec('HR_ONLY'), 'DECIDER under HR_ONLY: the Recruiters only').toEqual(RECRUITERS_A);
    // The approvers, never the drafter.
    const offer = (drafted: string) => ({ drafted_by: drafted, tenant_id: A });
    expect.soft(ids('APPROVER', { candidate: cand(K.late), offer: offer(X.ap1) }), 'APPROVER: people with perm-approve-offers, never the drafter').toEqual([X.ap2]);
    expect.soft(ids('APPROVER', { candidate: cand(K.late), offer: offer(SUB.recA) }), 'another drafter: both approvers').toEqual(sorted(X.ap1, X.ap2));
    expect.soft(ids('APPROVER', { candidate: cand(K.late) }, B), 'B\'s approver is B\'s own').toEqual([X.apB]);
    expect.soft(ids('APPROVER', { candidate: cand(K.late), offer: offer(X.ap1) }, B), 'B is not given A\'s drafter\'s exclusion or A\'s people').toEqual([X.apB]);
    // An unknown target gives nobody.
    expect.soft(ids('TA', {}), 'a target that is not one of the five gives nobody').toEqual([]);
    expect.soft(ids('HR_RECRUITMENT', {}, 'ten_zzzzzzzzzzzzzzzzzzzzzzzzzz'), 'a company with no people gives nobody').toEqual([]);

    // No match: nothing written, one line with ids only.
    const nobody = pool().filter((u) => !(u.groups.includes('perm-recruitment')));
    const soft = evaluate(t, [K.soon], { pool: nobody });
    expect.soft(notifRows(soft.tables), 'no Recruiter: no flag row').toEqual([]);
    expect.soft(firings(soft.tables), 'and no event row').toEqual([]);
    const lines = logsOf(soft).filter((l) => /No recipient/.test(l));
    expect.soft(lines.length, 'one "No recipient" line').toBe(1);
    expect.soft(lines[0], 'it names the rule and the company').toMatch(new RegExp(`RULE-SLA-002[\\s\\S]*${A}|${A}[\\s\\S]*RULE-SLA-002`));
    expect.soft(lines.join('\n'), 'and no name, address or candidate').not.toMatch(/@|Soon|Person|CAND-/);

    // No system address and no DEFAULT in any of the files.
    const files = ['lambda/evaluateIntelligenceRules/index.js', 'lambda/getIntelligenceTiles/index.js', 'lambda/monitorTalentFlowSLAs/index.js', 'lambda/sendTalentFlowNotification/index.js', 'lambda/shared/recipients.mjs', 'lambda/manageDrafts/index.mjs'];
    for (const f of files) {
      expect.soft(existsSync(join(REPO, f)), `${f} exists`).toBe(true);
      const src = existsSync(join(REPO, f)) ? read(...f.split('/')) : '';
      expect.soft(src, `${f} has no system@talentflow.internal`).not.toMatch(/system@talentflow\.internal/);
      expect.soft(src, `${f} has no DEFAULT company`).not.toMatch(/['"`]DEFAULT['"`]/);
    }
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 Titles: each rule\'s flag carries the approved title, placeholders filled, in the app and on the tile; no flag email is queued', async ({}, testInfo) => {
    once(testInfo.project.name);
    const AT = 'iv-09-titles';
    const interviewing = [{ signal: 'CANDIDATE_STAGE', operator: 'equals', value: 'INTERVIEW' }];
    let { t } = withRules(world(), A, NINE.map((id) => noteRule(id, { conditions: interviewing })));
    t = withRows(t, [iv(AT, K.iv, { at: H(-30), panel: [P.p1, P.p2, P.p3] }), voteRow(K.iv, AT, P.p2, { rating: 'STRONG_NO' })]);
    t = withSaga(t, K.iv, { expiryDate: EXPIRY });
    const r = evaluate(t, [K.iv]);
    expect(r.error, say(r)).toBeUndefined();
    const mine = notifRows(r.tables).filter((n) => n['PK'] === `USER#${REC_U}`);
    expect(Object.fromEntries(mine.map((n) => [n['ruleId'], n['title']])), 'the Recruiter\'s flag for each rule has the approved title').toEqual(TITLES);
    for (const n of mine) {
      expect.soft([n['type'], n['candidateId'], n['tenant_id'], n['read'], n['settingsVersion']], `${n['ruleId']}: a flag row for this candidate, unread, with the settings version`).toEqual(['FLAG', K.iv, A, false, 2]);
      expect.soft(typeof n['severity'], `${n['ruleId']}: has a severity`).toBe('string');
    }
    expect.soft(notifRows(r.tables).filter((n) => n['tenant_id'] !== A), 'every row carries A\'s company').toEqual([]);
    // Flags are not emailed: nothing queued, nothing sent, no Lambda called.
    expect.soft(queued(r), 'no message is queued').toEqual([]);
    expect.soft(postmarkOf(r), 'no email is sent').toEqual([]);
    expect.soft(r.calls.filter((c: any) => c.service === 'lambda' || c.service === 'sqs'), 'no Lambda is invoked and no queue is used').toEqual([]);
    // The tile says the same words.
    const tl = bodyOf(tiles(C.recruiter, r.tables)).tiles as any[];
    expect.soft(Object.fromEntries(tl.map((x) => [x.ruleId, x.title])), 'the tiles carry the same titles').toEqual(TITLES);
    // A disabled rule makes no flag; a rule that names its own words is still given the approved title.
    const off = withRules(world(), A, [noteRule('RULE-SLA-001', { enabled: false, conditions: interviewing }), noteRule('RULE-SLA-002', { name: 'Anything the admin typed', conditions: interviewing })]);
    const r2 = evaluate(off.t, [K.iv]);
    expect.soft(notifRows(r2.tables).filter((n) => n['PK'] === `USER#${REC_U}`).map((n) => [n['ruleId'], n['title']]), 'a disabled rule sends nothing; the other keeps the approved title').toEqual([['RULE-SLA-002', 'Waiting too long in Interview']]);
    // B's Recruiters get B's flags only, with B's candidate\'s name.
    const lateB = evaluate(world(), [K.lateB]);
    expect.soft(who(notifRows(lateB.tables)), 'B\'s flags go to B\'s people only').toEqual(sorted(SUB.recB, SUB.hmB));
    expect.soft(notifRows(lateB.tables).every((n) => n['tenant_id'] === B), 'and carry B\'s company').toBe(true);
    expect.soft(notifRows(lateB.tables).map((n) => n['severity']), 'at B\'s own severity for RULE-SLA-001 (LOW; A\'s rule says HIGH)').toEqual(['LOW', 'LOW']);
    expect.soft(flagsFor(evaluate(world(), [K.late]).tables, 'RULE-SLA-001').map((n) => n['severity']).filter((v, i, a) => a.indexOf(v) === i), 'and A\'s own stays HIGH').toEqual(['HIGH']);
    // A new rule version for A changes nothing for B: A switches RULE-SLA-001 off, B's candidate is still flagged by B's rule.
    const aOff = withNewVersion(world(), A, 'INTELLIGENCE_RULES', (d: any) => ({ ...d, rules: d.rules.map((r: any) => (r.id === 'RULE-SLA-001' ? { ...r, enabled: false } : r)) })).t;
    expect.soft(notifRows(evaluate(aOff, [K.lateB]).tables).length, 'A saves a new version with Over time off: B\'s candidate is still flagged by B\'s rules').toBeGreaterThan(0);
    expect.soft(flagsFor(evaluate(aOff, [K.late]).tables, 'RULE-SLA-001'), 'and A\'s own candidate is not').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Why: every firing writes the event row of rule 5 with the settings version, no names or addresses; the tile carries why; time-based numbers are fresh, not saved', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const r = evaluate(t, [K.late]);
    const rows = firings(r.tables);
    expect(rows.map((x) => x['rule_id']), 'one event row for the one rule that fired').toEqual(['RULE-SLA-001']);
    const row = rows[0]!;
    expect.soft(Object.keys(row).sort(), 'the row holds the fields of rule 5 and its keys, nothing else').toEqual(['GSI1PK', 'GSI1SK', 'PK', 'SK', 'at', 'candidate_id', 'expiresAt', 'recipients_count', 'rule_id', 'rule_version', 'severity', 'signals_seen', 'SK', 'tenant_id'].filter((k, i, a) => a.indexOf(k) === i).sort());
    expect.soft([row['tenant_id'], row['candidate_id'], row['rule_version'], row['severity'], row['at'], row['signals_seen']], 'company, candidate, version, severity, time and what it saw').toEqual([A, K.late, 1, 'HIGH', NOW, [{ signal: 'SLA_STATUS', value: 'BREACHED' }]]);
    expect.soft(row['recipients_count'], 'recipients_count is the number of people told').toBe(notifRows(r.tables).length);
    expect.soft(String(row['PK']), 'the row is kept under the company').toBe(`TENANT#${A}`);
    const text = JSON.stringify(row);
    expect.soft(text, 'no name, address or phone in the row').not.toMatch(/Lerato|Late|@|candidate\.test|\+27|CAND-.*@/);
    expect.soft(text, 'none of the recipients\' ids either').not.toMatch(new RegExp([SUB.recA, SUB.hmA, REC_U].join('|')));
    // The settings version of the candidate: a locked one keeps its version; an unlocked one reads the active.
    const v2 = withRules(t, A, [noteRule('RULE-SLA-001', { conditions: [{ signal: 'SLA_STATUS', operator: 'equals', value: 'BREACHED' }] })]);
    const lockedV1 = withSaga(v2.t, K.late, { settingVersions: { INTELLIGENCE_RULES: 1 } });
    expect.soft(firings(evaluate(lockedV1, [K.late]).tables).map((x) => x['rule_version']), 'a candidate locked to version 1 fires with version 1').toEqual([1]);
    expect.soft(firings(evaluate(v2.t, [K.late]).tables).map((x) => x['rule_version']), 'an unlocked one fires with the active version 2').toEqual([2]);
    expect.soft(notifRows(evaluate(v2.t, [K.late]).tables).map((x) => x['settingsVersion']).filter((v, i, a) => a.indexOf(v) === i), 'and the flag rows say the same').toEqual([2]);
    // Company B\'s firing is B\'s.
    const b = evaluate(t, [K.lateB]);
    expect.soft(firings(b.tables).map((x) => [x['tenant_id'], x['PK']]), 'B\'s firing is stamped and kept under B').toEqual([[B, `TENANT#${B}`]]);
    // The tile carries why.
    const tl = bodyOf(tiles(C.recruiter, r.tables)).tiles as any[];
    expect.soft(tl.map((x) => x.why), 'the tile has why: rule, what it saw, version').toEqual([{ rule_id: 'RULE-SLA-001', signals_seen: [{ signal: 'SLA_STATUS', value: 'BREACHED' }], rule_version: 1 }]);
    expect.soft(JSON.stringify(tl.map((x) => x.signals)), 'no tile shows a risk score').not.toMatch(/Risk/);
    // Fresh numbers: a candidate that was on track when saved is over time when read two days later.
    const fine = evaluate(t, [K.fine]);
    expect.soft(bodyOf(tiles(C.recruiter, fine.tables)).tiles, 'on track now: no tile').toEqual([]);
    const later = tiles(C.recruiter, fine.tables, { now: '2026-11-25T12:00:00.000Z' });
    expect.soft((bodyOf(later).tiles as any[]).map((x) => [x.entityId, x.ruleId, x.title]), 'read 48 hours later the same saved row gives the Over time tile (worked out from the clock, not from the snapshot)').toEqual([[K.fine, 'RULE-SLA-001', 'Over time in Applied']]);
    // A hiring manager sees only the tiles of their own candidates; B sees none of A\'s.
    const both = evaluate(world(), [K.late, K.lateHm2]);
    expect.soft((bodyOf(tiles(C.hmC1, both.tables)).tiles as any[]).map((x) => x.entityId), 'hmA: only hmA\'s candidate').toEqual([K.late]);
    expect.soft((bodyOf(tiles(C.recruiter, both.tables)).tiles as any[]).map((x) => x.entityId).sort(), 'the Recruiter: both').toEqual([K.late, K.lateHm2].sort());
    expect.soft(bodyOf(tiles(C.recruiterB, both.tables, FORGED_A)).tiles, 'B\'s Recruiter, with A\'s company forged in headers and query: none of A\'s').toEqual([]);
    const bothCompanies = evaluate(evaluate(world(), [K.late, K.lateHm2]).tables, [K.lateB]);
    expect.soft((bodyOf(tiles(C.recruiterB, bothCompanies.tables, FORGED_A)).tiles as any[]).map((x) => x.entityId), 'B\'s Recruiter forging A: B\'s own tile only').toEqual([K.lateB]);
    expect.soft((bodyOf(tiles(C.recruiter, bothCompanies.tables, FORGED_B)).tiles as any[]).map((x) => x.entityId).sort(), 'A\'s Recruiter forging B: A\'s own tiles only, none of B\'s').toEqual([K.late, K.lateHm2].sort());
    expect.soft((bodyOf(tiles(C.recruiter, bothCompanies.tables, FORGED_B)).tiles as any[]).some((x) => x.entityId === K.lateB), 'and not B\'s overdue candidate').toBe(false);
    expect.soft(statusOf(tiles(C.employee, both.tables)), 'an employee: 403').toBe(403);
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 New signals: a missed interview marks the candidate and flags HR; a rescheduled, cancelled or scored one does not; a Strong no flags the deciders and changes nothing on the candidate; Decision needed fires when every required interview and vote is in', async ({}, testInfo) => {
    once(testInfo.project.name);
    const base = world();
    const mk = (rows: any[], extra: Record<string, any> = {}) => withSaga(withRows(base, rows), K.iv, extra);
    const marker = (r: Run) => sagaOf(r.tables, K.iv)['interviewMissedAt'];
    // 25 hours past, nobody scored: missed.
    const missed = monitor(mk([iv('iv-m1', K.iv, { at: H(-25) })]));
    expect.soft(missed.error, say(missed)).toBeUndefined();
    expect.soft(marker(missed), 'a 25 hour old interview with no vote marks the candidate').toBe(NOW);
    expect.soft(sagaOf(missed.tables, K.iv)['interviewMissedId'], 'with the interview\'s id').toBe('iv-m1');
    const flagged = evaluate(missed.tables, [K.iv]);
    expect.soft(who(flagsFor(flagged.tables, 'RULE-MISSED-001', K.iv)), 'RULE-MISSED-001 flags the Recruiters of A').toEqual(RECRUITERS_A);
    expect.soft(flagsFor(flagged.tables, 'RULE-MISSED-001').map((n) => n['title']).filter((v, i, a) => a.indexOf(v) === i), 'with the approved title').toEqual(['Missed interview']);
    const again = monitor(missed.tables, '2026-11-23T13:00:00.000Z');
    expect.soft(marker(again), 'the next hour the marker is not moved').toBe(NOW);
    // The same hour, the other cases: none marks anything.
    const cases: [string, any[]][] = [
      ['23 hours past (not yet 24)', [iv('iv-m2', K.iv, { at: H(-23) })]],
      ['a cancelled interview', [iv('iv-m3', K.iv, { at: H(-30), status: 'CANCELLED' })]],
      ['a rescheduled one (the old slot cancelled, a new one ahead)', [iv('iv-m4', K.iv, { at: H(-30), status: 'CANCELLED' }), iv('iv-m5', K.iv, { at: H(48) })]],
      ['one member scored', [iv('iv-m6', K.iv, { at: H(-30) }), voteRow(K.iv, 'iv-m6', P.p1)]],
      ['a completed interview', [iv('iv-m7', K.iv, { at: H(-30), status: 'COMPLETED' })]],
    ];
    for (const [what, rows] of cases) expect.soft(marker(monitor(mk(rows))), `${what}: not marked`).toBeUndefined();
    const hired = monitor(withSaga(withRows(base, [iv('iv-m8', K.hired, { at: H(-30) })]), K.hired, {}));
    expect.soft(sagaOf(hired.tables, K.hired)['interviewMissedAt'], 'a Hired candidate is not marked').toBeUndefined();
    // Another company\'s missed interview marks B\'s candidate and flags B\'s people only.
    const bMissed = monitor(withRows(base, [iv('iv-mb', K.ivB, { at: H(-25), company: B, panel: [P.pB] })]));
    expect.soft([sagaOf(bMissed.tables, K.ivB)['interviewMissedAt'], sagaOf(bMissed.tables, K.iv)['interviewMissedAt']], 'B\'s candidate is marked, A\'s is not').toEqual([NOW, undefined]);
    expect.soft(who(flagsFor(evaluate(bMissed.tables, [K.ivB]).tables, 'RULE-MISSED-001')), 'and only B\'s Recruiter is told').toEqual([SUB.recB]);
    // The company\'s own limit: 12 hours makes a 13 hour old interview missed.
    const own = withSetting(mk([iv('iv-m9', K.iv, { at: H(-13) })]), A, 'SLA_THRESHOLDS', (d) => ({ ...d, interviewMissedAfterHours: 12 }));
    expect.soft(marker(monitor(own)), 'SLA_THRESHOLDS.interviewMissedAfterHours is the company\'s own limit').toBe(NOW);
    // Each company's own limit: A's 12 hours does not make B's 13 hour old interview missed (B keeps 24), and B's 12 does not touch A's.
    const twoCos = (aHours?: number, bHours?: number) => {
      let t = withRows(base, [iv('iv-m9', K.iv, { at: H(-13) }), iv('iv-m9b', K.ivB, { at: H(-13), company: B, panel: [P.pB] })]);
      if (aHours) t = withSetting(t, A, 'SLA_THRESHOLDS', (d) => ({ ...d, interviewMissedAfterHours: aHours }));
      if (bHours) t = withSetting(t, B, 'SLA_THRESHOLDS', (d) => ({ ...d, interviewMissedAfterHours: bHours }));
      const r = monitor(t);
      return [sagaOf(r.tables, K.iv)['interviewMissedAt'], sagaOf(r.tables, K.ivB)['interviewMissedAt']];
    };
    expect.soft(twoCos(12, undefined), 'A at 12 hours: A\'s 13 hour old interview is missed, B\'s (24 hours) is not').toEqual([NOW, undefined]);
    expect.soft(twoCos(undefined, 12), 'B at 12 hours: B\'s is missed, A\'s (24 hours) is not').toEqual([undefined, NOW]);

    // A Strong no: the deciders are told; the candidate is not changed.
    const strong = withSaga(base, K.strong, { strong_no_count: 1, score_under_review_level: 'STRONG_NO' });
    const sBefore = sagaOf(strong, K.strong);
    const sr = evaluate(strong, [K.strong]);
    expect.soft(who(flagsFor(sr.tables, 'RULE-STRONGNO-001', K.strong)), 'RULE-STRONGNO-001 goes to the Recruiters and the hiring manager (HR_OR_HM)').toEqual(sorted(...RECRUITERS_A, SUB.hmA));
    expect.soft(sagaOf(sr.tables, K.strong), 'the candidate row is exactly as it was: no stage, status or score changed').toEqual(sBefore);
    expect.soft(flagsFor(evaluate(base, [K.strong]).tables, 'RULE-STRONGNO-001'), 'no Strong no, no flag').toEqual([]);
    const hrOnly = withSetting(strong, A, 'REJECTION_RULES', (d) => ({ ...d, decider: { JUNIOR: 'HR_ONLY', MID: 'HR_ONLY', SENIOR: 'HR_ONLY' } }));
    expect.soft(who(flagsFor(evaluate(hrOnly, [K.strong]).tables, 'RULE-STRONGNO-001')), 'under HR_ONLY the hiring manager is not told').toEqual(RECRUITERS_A);

    // Decision needed: PHONE_SCREEN and TECHNICAL (MID) completed, every member scored.
    const done = (id: string, type: string) => iv(id, K.ready, { at: H(-30), type, status: 'COMPLETED', panel: [P.p1, P.p2] });
    const scored = (id: string) => [voteRow(K.ready, id, P.p1), voteRow(K.ready, id, P.p2)];
    const allIn = withRows(base, [done('iv-d1', 'PHONE_SCREEN'), done('iv-d2', 'TECHNICAL'), ...scored('iv-d1'), ...scored('iv-d2')]);
    expect.soft(who(flagsFor(evaluate(allIn, [K.ready]).tables, 'RULE-DECISION-001', K.ready)), 'all required interviews done and every vote in: the deciders are told').toEqual(sorted(...RECRUITERS_A, SUB.hmA));
    expect.soft(flagsFor(evaluate(allIn, [K.ready]).tables, 'RULE-DECISION-001').map((n) => n['title'])[0], 'with the approved title').toBe('Decision needed on Ready Decision');
    const oneMissing = withRows(base, [done('iv-d1', 'PHONE_SCREEN'), done('iv-d2', 'TECHNICAL'), ...scored('iv-d1'), voteRow(K.ready, 'iv-d2', P.p1)]);
    expect.soft(flagsFor(evaluate(oneMissing, [K.ready]).tables, 'RULE-DECISION-001'), 'a vote still missing: no flag').toEqual([]);
    const noTech = withRows(base, [done('iv-d1', 'PHONE_SCREEN'), ...scored('iv-d1')]);
    expect.soft(flagsFor(evaluate(noTech, [K.ready]).tables, 'RULE-DECISION-001'), 'a required interview not held: no flag').toEqual([]);
    const notDone = withRows(base, [done('iv-d1', 'PHONE_SCREEN'), iv('iv-d2', K.ready, { at: H(5), type: 'TECHNICAL', panel: [P.p1, P.p2] }), ...scored('iv-d1')]);
    expect.soft(flagsFor(evaluate(notDone, [K.ready]).tables, 'RULE-DECISION-001'), 'a required interview still ahead: no flag').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-6

  const dmy = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)).replace('Sept', 'Sep');
  const reminders = (r: { calls: any[] }) => queued(r).filter((m: any) => m?.type === 'INTERVIEWER_REMINDER' && (Object.values(K) as string[]).includes(m.candidateId));
  const NEXT_DAY = '2026-11-24T12:00:00.000Z';

  test('AC-6 Reminders: one email per member who has not scored, the template filled and escaped; none for one who scored; none twice in a day; nothing for a guest or for another company\'s person; none for a Hired or Not hired candidate', async ({}, testInfo) => {
    once(testInfo.project.name);
    const base = world();
    const IV = 'iv-r1';
    const due = withRows(base, [iv(IV, K.iv, { at: H(-30), panel: [P.p1, P.p2, P.p3] }), voteRow(K.iv, IV, P.p1)]);
    const r = monitor(due);
    expect(r.error, say(r)).toBeUndefined();
    const sent = reminders(r);
    const want = (to: string, id: string) => ({
      type: 'INTERVIEWER_REMINDER', tenant_id: A, recipientId: id, recipientEmail: to, candidateId: K.iv, interviewId: IV,
      subject: 'Your feedback on Ivy Interview is due',
      body: `You interviewed Ivy Interview for Fleet controller on ${dmy(H(-30))}. Your feedback is due ${dmy(H(-6))}. Open: https://rec01.example/hire/feedback/${IV}`,
    });
    expect(sent.sort((a: any, b: any) => a.recipientId.localeCompare(b.recipientId)), 'one reminder each for Sizwe and Ndlovu, who have not scored; none for Thandi, who has').toEqual(
      [want('sizwe@mokoena.test', P.p2), want('ndlovu@mokoena.test', P.p3)].sort((a, b) => a.recipientId.localeCompare(b.recipientId)));
    expect.soft(postmarkOf(r), 'the monitor queues the mail; it does not send it').toEqual([]);
    // Not yet due: nothing. Moved past due: as above.
    expect.soft(reminders(monitor(withRows(base, [iv('iv-r0', K.iv, { at: H(-20), panel: [P.p2] })]))), 'feedback not yet due (20 of 24 hours): no reminder').toEqual([]);
    // Once a day.
    expect.soft(reminders(monitor(r.tables, '2026-11-23T15:00:00.000Z')), 'three hours later, the same day: none again').toEqual([]);
    expect.soft(reminders(monitor(r.tables, NEXT_DAY)).map((m: any) => m.recipientId).sort(), 'the next day: one more each, still not scored').toEqual(sorted(P.p2, P.p3));
    const voted = withRows(r.tables, [voteRow(K.iv, IV, P.p2)]);
    expect.soft(reminders(monitor(voted, NEXT_DAY)).map((m: any) => m.recipientId), 'the next day, Sizwe has scored: only Ndlovu').toEqual([P.p3]);
    // Escaped and one line.
    const odd = withSaga(due, K.iv, { firstName: 'Ivy\r\nBcc: x@y.test', lastName: "<b>O'Neil & Sons</b>" });
    const oddSent = reminders(monitor(odd))[0];
    expect.soft(oddSent.subject, 'the subject is one line').not.toMatch(/[\r\n]/);
    expect.soft(oddSent.body, 'markup, quotes and ampersands in a name are escaped in the words').toContain("&lt;b&gt;O&#39;Neil &amp; Sons&lt;/b&gt;");
    expect.soft(oddSent.body, 'and no raw tag is left').not.toMatch(/<b>/);
    // People who must not be mailed: a person of B on the panel, a disabled one, one with no address.
    const mixed = withRows(base, [iv('iv-r2', K.iv, { at: H(-30), panel: [P.pB, X.recOff, X.recNoRow, P.p2] })]);
    expect.soft(reminders(monitor(mixed)).map((m: any) => m.recipientId), 'only the member of A with an address is mailed').toEqual([P.p2]);
    // Hired and Not hired candidates get none; a cancelled interview gets none.
    for (const [what, cand] of [['Hired', K.hired], ['Not hired', K.notHired]] as const) {
      expect.soft(reminders(monitor(withRows(base, [iv(`iv-${what}`, cand, { at: H(-30), panel: [P.p2] })]))), `a ${what} candidate: no reminder`).toEqual([]);
    }
    expect.soft(reminders(monitor(withRows(base, [iv('iv-r3', K.iv, { at: H(-30), status: 'CANCELLED', panel: [P.p2] })]))), 'a cancelled interview: no reminder').toEqual([]);
    // A guest whose link has expired is not mailed; the person who owes feedback is flagged to HR instead.
    const GUEST = token(91);
    const guest = withRows(base, [iv('iv-r4', K.iv, { at: H(-300), panel: [P.p2] }), linkRow(GUEST, K.iv, 'iv-r4', H(-300), { expires: H(-130) })]);
    const gm = monitor(guest);
    expect.soft(JSON.stringify(queued(gm)), 'the guest\'s address gets nothing').not.toContain('outside.test');
    expect.soft(who(flagsFor(evaluate(gm.tables, [K.iv]).tables, 'RULE-FEEDBACK-001', K.iv)), 'HR is flagged (RULE-FEEDBACK-001) for the feedback still owed').toEqual(RECRUITERS_A);
    // Company B\'s interview: B\'s own panel member only, stamped B.
    const bDue = withRows(base, [iv('iv-rb', K.ivB, { at: H(-60), company: B, panel: [P.pB, P.p2] })]);
    const bm = reminders(monitor(bDue));
    expect.soft(bm.map((m: any) => [m.tenant_id, m.recipientId]), 'B\'s interview: B\'s member only, never a person of A').toEqual([[B, P.pB]]);
    // The sender: the override address in dev; the person\'s own address when none is set (prod).
    const dev = send(sent, base);
    expect.soft(postmarkOf(dev).map((c: any) => [c.op, c.message.To, c.message.Subject]), 'dev: every reminder goes to the override address').toEqual(sent.map(() => ['sendEmail', 'zz.override@rec09.example', 'Your feedback on Ivy Interview is due']));
    expect.soft(postmarkOf(dev)[0].message.HtmlBody, 'the mail carries the filled words').toContain('You interviewed Ivy Interview for Fleet controller');
    const prod = send(sent, base, { env: { MVP1_RECIPIENT_OVERRIDE: undefined } });
    expect.soft(postmarkOf(prod).map((c: any) => c.message.To).sort(), 'prod, no override: each goes to the member\'s own address').toEqual(['ndlovu@mokoena.test', 'sizwe@mokoena.test']);
    const html = send([{ ...sent[0], body: 'x <script>alert(1)</script> & y' }], base);
    expect.soft(postmarkOf(html)[0].message.HtmlBody, 'the sender escapes the words again').not.toContain('<script>');
  });

  // ---------------------------------------------------------------- AC-7

  /** The world with a SENT offer for Amahle Zulu that expires in two days, run through the hourly job and the engine: one draft is made. */
  function withDraft() {
    const t = withRows(world(), [offerRowOf(OFFER.main, K.offer), liveLock(A, K.offer, OFFER.main)]);
    const m = monitor(t);
    const e = evaluate(m.tables, [K.offer]);
    return { m, e, t: e.tables };
  }
  const DEV_TEXT = `Hi Amahle, a reminder that your offer for Fleet controller expires on ${dmy('2026-11-25T12:00:00Z')}. Let me know if you have any questions.`;

  test('AC-7 Drafts: an offer close to expiry makes one draft from the template; a Recruiter edits it, sends it once, or dismisses it; an employee and a manager are refused; B\'s Recruiter gets 404; nothing sends by itself', async ({}, testInfo) => {
    once(testInfo.project.name);
    const { m, e, t } = withDraft();
    expect(e.error, say(e)).toBeUndefined();
    expect(who(flagsFor(t, 'RULE-OFFER-001', K.offer)), 'the Recruiters are told').toEqual(RECRUITERS_A);
    expect.soft(flagsFor(t, 'RULE-OFFER-001')[0]!['title'], 'with the approved title').toBe(`Offer expires ${EXPIRY_DAY}`);
    const made = draftRows(t);
    expect.soft(made.length, 'one draft').toBe(1);
    const d = made[0]!;
    expect.soft([d['status'], d['kind'], d['tenant_id'], d['candidate_id'], d['to_email'], d['body']], 'a draft of offer_follow_up for A, to the candidate\'s address, from the template').toEqual(['DRAFT', 'offer_follow_up', A, K.offer, CAND_EMAIL, DEV_TEXT]);
    const id = String(d['SK']).replace('DRAFT#', '');
    expect.soft(draftRows(evaluate(t, [K.offer], { now: '2026-11-24T14:00:00.000Z' }).tables).length, 'a second firing a day later makes no second open draft').toBe(1);
    expect.soft([...queued(m), ...queued(e)].filter((q: any) => q?.type === 'DRAFT_EMAIL'), 'nothing is sent by itself').toEqual([]);
    expect.soft(draftRows(evaluate(world(), [K.noEmail]).tables), 'a candidate with no address gets no draft').toEqual([]);
    // List.
    const list = drafts(DRAFT.list, W.recU, {}, t);
    expect.soft([statusOf(list), bodyOf(list).drafts.map((x: any) => [x.id, x.candidateId, x.candidateName, x.toEmail, x.kind, x.body, x.status])], 'GET /v1/drafts: the open draft').toEqual([200, [[id, K.offer, 'Amahle Zulu', CAND_EMAIL, 'offer_follow_up', DEV_TEXT, 'DRAFT']]]);
    // Roles and companies, before any AWS call.
    for (const [what, caller] of [['an employee', C.employee], ['a hiring manager', C.hmC1], ['an approver', C.approver], ['someone with no groups', C.noGroups]] as const) {
      for (const route of Object.values(DRAFT)) {
        const r = drafts(route, caller, { id, body: { body: 'x' } }, t);
        expect.soft([statusOf(r), bodyOf(r)], `${what}: ${route} is 403`).toEqual([403, FORBIDDEN]);
        expect.soft(r.calls.filter((c: any) => c.service === 'dynamodb'), `${what}: ${route}: no row is read`).toEqual([]);
      }
    }
    const bList = drafts(DRAFT.list, C.recruiterB, {}, t);
    expect.soft(bodyOf(bList).drafts, 'B\'s Recruiter lists none of A\'s').toEqual([]);
    expect.soft(bodyOf(drafts(DRAFT.list, C.recruiterB, { headers: FORGED_A.headers, query: FORGED_A.query }, t)).drafts, 'B\'s Recruiter naming A in headers and query: still none of A\'s').toEqual([]);
    for (const route of [DRAFT.edit, DRAFT.send, DRAFT.dismiss]) {
      for (const [what, extra] of [['plainly', {}], ['naming A in headers and query', { ...FORGED_A }]] as const) {
        const r = drafts(route, C.recruiterB, { id, body: { body: 'Hi' }, headers: { 'Idempotency-Key': 'b-1', ...(extra as any).headers }, query: (extra as any).query }, t);
        expect.soft([statusOf(r), bodyOf(r)], `B's Recruiter ${what}: ${route} on A's draft is 404`).toEqual([404, NOT_FOUND]);
        expect.soft(JSON.stringify(r.tables), 'and nothing changed').toBe(JSON.stringify(t));
      }
    }
    const unknown = drafts(DRAFT.send, W.recU, { id: 'drf_nothere', headers: { 'Idempotency-Key': 'u-1' } }, t);
    expect.soft([statusOf(unknown), bodyOf(unknown)], 'a draft that does not exist is 404').toEqual([404, NOT_FOUND]);
    // Edit.
    for (const bad of ['', '   ', 'x'.repeat(5001), 7, null, undefined]) {
      const r = drafts(DRAFT.edit, W.recU, { id, body: { body: bad } }, t);
      expect.soft(statusOf(r), `edit with ${JSON.stringify(bad)?.slice(0, 20) ?? 'nothing'}: 400`).toBe(400);
    }
    const edited = drafts(DRAFT.edit, W.recU, { id, body: { body: 'Hi Amahle, <b>new</b> words & more.' } }, t);
    expect.soft([statusOf(edited), bodyOf(edited).body], 'an edit keeps plain text as typed').toEqual([200, 'Hi Amahle, <b>new</b> words & more.']);
    expect.soft(draftRows(edited.tables)[0]!['body'], 'and is stored').toBe('Hi Amahle, <b>new</b> words & more.');
    expect.soft(statusOf(drafts(DRAFT.edit, W.recU, { id, body: { body: 'x'.repeat(5000) } }, t)), '5000 characters is allowed').toBe(200);
    // Send: one email, the sender recorded, never twice.
    const s1 = drafts(DRAFT.send, W.recU, { id, headers: { 'Idempotency-Key': 'send-1' } }, edited.tables);
    expect.soft([statusOf(s1), bodyOf(s1).status], 'send: 200 SENT').toEqual([200, 'SENT']);
    const mails = queued(s1).filter((q: any) => q?.type === 'DRAFT_EMAIL');
    expect.soft(mails.map((q: any) => [q.tenant_id, q.recipientEmail, q.candidateId, q.body]), 'exactly one email is queued, to the candidate\'s address, with the edited words').toEqual([[A, CAND_EMAIL, K.offer, 'Hi Amahle, <b>new</b> words & more.']]);
    const row = draftRows(s1.tables)[0]!;
    expect.soft([row['status'], row['sent_by'], row['sent_at']], 'the row records who sent it and when').toEqual(['SENT', REC_U, NOW]);
    const same = drafts(DRAFT.send, W.recU, { id, headers: { 'Idempotency-Key': 'send-1' } }, s1.tables);
    expect.soft([statusOf(same), queued(same).length], 'the same key again: the same answer, nothing more queued').toEqual([200, 0]);
    const second = drafts(DRAFT.send, W.recU, { id, headers: { 'Idempotency-Key': 'send-2' } }, s1.tables);
    expect.soft([statusOf(second), bodyOf(second), queued(second).length], 'a second send with a new key is refused, nothing queued').toEqual([409, { error: 'Conflict', code: 'NOT_OPEN' }, 0]);
    expect.soft(statusOf(drafts(DRAFT.edit, W.recU, { id, body: { body: 'late' } }, s1.tables)), 'a sent draft cannot be edited').toBe(409);
    expect.soft(statusOf(drafts(DRAFT.dismiss, W.recU, { id }, s1.tables)), 'or dismissed').toBe(409);
    expect.soft(bodyOf(drafts(DRAFT.list, W.recU, {}, s1.tables)).drafts, 'and is no longer listed as open').toEqual([]);
    // The sender mails it as the person\'s words, escaped, to the override in dev.
    const out = send(mails, t);
    expect.soft(postmarkOf(out).map((c: any) => [c.message.To, c.message.HtmlBody.includes('&lt;b&gt;new&lt;/b&gt;')]), 'the sender writes the words escaped, to the override address in dev').toEqual([['zz.override@rec09.example', true]]);
    // Dismiss.
    const dis = drafts(DRAFT.dismiss, W.recU, { id }, t);
    expect.soft([statusOf(dis), bodyOf(dis).status, queued(dis).length], 'dismiss: 200 DISMISSED, nothing sent').toEqual([200, 'DISMISSED', 0]);
    expect.soft(statusOf(drafts(DRAFT.send, W.recU, { id, headers: { 'Idempotency-Key': 'send-3' } }, dis.tables)), 'a dismissed draft cannot be sent').toBe(409);
    expect.soft(bodyOf(drafts(DRAFT.list, W.recU, {}, dis.tables)).drafts, 'and is not listed').toEqual([]);
    // Company B\'s offer makes B\'s draft only.
    const bT = withRows(world(), [offerRowOf(OFFER.b, K.offerB, { company: B, drafter: X.apB }), liveLock(B, K.offerB, OFFER.b)]);
    const bE = evaluate(monitor(bT).tables, [K.offerB]);
    expect.soft(draftRows(bE.tables).map((x) => x['tenant_id']), 'B\'s offer makes a draft of B').toEqual([B]);
    expect.soft(bodyOf(drafts(DRAFT.list, W.recU, {}, bE.tables)).drafts, 'A\'s Recruiter does not see it').toEqual([]);
    expect.soft(bodyOf(drafts(DRAFT.list, C.recruiterB, {}, bE.tables)).drafts.length, 'B\'s Recruiter does').toBe(1);
    // A's Recruiter naming B in headers and query cannot see or act on B's draft.
    const bId = String(draftRows(bE.tables)[0]!['SK']).replace('DRAFT#', '');
    expect.soft(bodyOf(drafts(DRAFT.list, W.recU, { headers: FORGED_B.headers, query: FORGED_B.query }, bE.tables)).drafts, 'A\'s Recruiter naming B: none of B\'s drafts').toEqual([]);
    for (const route of [DRAFT.edit, DRAFT.send, DRAFT.dismiss]) {
      const r = drafts(route, W.recU, { id: bId, body: { body: 'Hi' }, headers: { 'Idempotency-Key': 'a-forge', ...FORGED_B.headers }, query: FORGED_B.query }, bE.tables);
      expect.soft([statusOf(r), bodyOf(r), JSON.stringify(r.tables) === JSON.stringify(bE.tables), queued(r).length], `A's Recruiter naming B: ${route} on B's draft is 404, nothing changed or queued`).toEqual([404, NOT_FOUND, true, 0]);
    }
    // A request key belongs to the company and the person who made it: B's Recruiter sending with A's key gets no answer of A's.
    const bKey = drafts(DRAFT.send, C.recruiterB, { id, headers: { 'Idempotency-Key': 'send-1' } }, s1.tables);
    expect.soft([statusOf(bKey), bodyOf(bKey), queued(bKey).length], 'B\'s Recruiter re-sending A\'s key "send-1" on A\'s draft: 404 Not found, nothing of A\'s, nothing queued').toEqual([404, NOT_FOUND, 0]);
    expect.soft(JSON.stringify(bodyOf(bKey)), 'the body has nothing of A\'s (not the candidate, address or words)').not.toMatch(/Amahle|amahle|candidate\.test|Hi Amahle/);
    const bKeyUnknown = drafts(DRAFT.send, C.recruiterB, { id: 'drf_nothere', headers: { 'Idempotency-Key': 'send-1' } }, s1.tables);
    expect.soft([statusOf(bKeyUnknown), bodyOf(bKeyUnknown)], 'and on an id that does not exist: 404 as well').toEqual([404, NOT_FOUND]);
    // The same company, another person, the same key: also not A's saved answer.
    const otherPerson = drafts(DRAFT.send, C.recruiter, { id, headers: { 'Idempotency-Key': 'send-1' } }, s1.tables);
    expect.soft(JSON.stringify(bodyOf(otherPerson)).includes('Amahle') && statusOf(otherPerson) === 200, 'another Recruiter of A with the same key is not handed the first person\'s saved answer').toBe(false);
  });

  // ---------------------------------------------------------------- AC-8

  const SERVICES = ['evaluateIntelligenceRules/index.js', 'getIntelligenceTiles/index.js', 'monitorTalentFlowSLAs/index.js', 'sendTalentFlowNotification/index.js', 'manageDrafts/index.mjs'];
  const SHARED = ['recipients.mjs', 'flag-titles.mjs', 'flag-people.mjs', 'intelligence-rules.mjs'];
  const MODEL = /bedrock|anthropic|openai|invokemodel|converse(stream)?command|textract|comprehend|sagemaker|rekognition|nalekoai|talentflowaichat/i;

  test('AC-8 No paid model: no model client in any file of this card, Bedrock is refused, and every run made no model call', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const f of SERVICES) {
      expect.soft(existsSync(join(REPO, 'lambda', f)), `lambda/${f} exists`).toBe(true);
      const src = existsSync(join(REPO, 'lambda', f)) ? read('lambda', ...f.split('/')) : '';
      expect.soft(src.match(MODEL) ?? [], `lambda/${f} names no model client`).toEqual([]);
    }
    for (const f of SHARED) {
      expect.soft(existsSync(join(REPO, 'lambda', 'shared', f)), `lambda/shared/${f} exists`).toBe(true);
      const src = existsSync(join(REPO, 'lambda', 'shared', f)) ? read('lambda', 'shared', f) : '';
      expect.soft(src.match(MODEL) ?? [], `lambda/shared/${f} names no model client`).toEqual([]);
    }
    const tf = ['talent-flow-manage-drafts.tf', 'talent-flow-rec09-grants.tf'].map((f) => read('talent-flow-infra', f)).join('\n');
    expect.soft(tf.match(/bedrock/i) ?? [], 'no Terraform of this card grants Bedrock').toEqual([]);
    // Every run of a whole round (rules, tiles, hourly job, drafts, sender) calls no model and no outside web address.
    const { m, e, t } = withDraft();
    const runs: Run[] = [m, e, tiles(C.recruiter, t), drafts(DRAFT.list, W.recU, {}, t), send([{ type: 'DRAFT_EMAIL', tenant_id: A, recipientEmail: CAND_EMAIL, body: 'x', subject: 's' }], t)];
    for (const r of runs) {
      expect.soft(r.error, say(r)).toBeUndefined();
      expect.soft(r.calls.filter((c: any) => /bedrock|http|textract|comprehend/i.test(String(c.service))), 'no model or web call').toEqual([]);
      expect.soft(logsOf(r).filter((l) => /import.*(bedrock|anthropic)/i.test(l)), 'no model client was loaded').toEqual([]);
    }
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 Module and cooldown: a company with Recruitment off is skipped with one line; a rule inside its cooldown does not fire again, and fires again after it', async ({}, testInfo) => {
    once(testInfo.project.name);
    const D = 'ten_dddddddddddddddddddddddddd';
    const base = withRows(world(), [seedRow('CAND-09REC09DOFFAAAAAAAAAA1', 'Dube', 'Late', 'APPLIED', 30, { company: D, role: R.b, hm: SUB.hmB, sla: 'BREACHED' }),
      iv('iv-d-off', 'CAND-09REC09DOFFAAAAAAAAAA1', { at: H(-30), company: D, panel: [P.p2] })]);
    const off = evaluate(base, ['CAND-09REC09DOFFAAAAAAAAAA1']);
    expect.soft([notifRows(off.tables), firings(off.tables), draftRows(off.tables)], 'the engine: nothing is written for a company with Recruitment off').toEqual([[], [], []]);
    const skip = logsOf(off).filter((l) => /Module off, skipped/.test(l));
    expect.soft(skip.length, 'one "Module off, skipped" line').toBe(1);
    expect.soft(skip[0], 'with the company id and no names').toMatch(new RegExp(D));
    expect.soft(skip[0], 'and no name or address').not.toMatch(/Dube|@/);
    const mon = monitor(base);
    expect.soft(sagaOf(mon.tables, 'CAND-09REC09DOFFAAAAAAAAAA1')['interviewMissedAt'], 'the hourly job marks nothing for it').toBeUndefined();
    expect.soft(reminders(mon).filter((m: any) => m.tenant_id === D), 'and queues no reminder for it').toEqual([]);
    expect.soft(logsOf(mon).filter((l) => /Module off, skipped/.test(l)).length, 'and says so').toBeGreaterThan(0);
    expect.soft(sagaOf(mon.tables, K.late)['slaStatus'], 'the other companies are judged as usual').toBeDefined();
    // Cooldown: 24 hours for Over time; 72 for Strong no.
    const first = evaluate(world(), [K.late]);
    const n1 = notifRows(first.tables).length;
    expect(n1, 'the first firing tells people').toBeGreaterThan(0);
    const soon = evaluate(first.tables, [K.late], { now: '2026-11-23T13:00:00.000Z' });
    expect.soft(notifRows(soon.tables).length, 'an hour later: no repeat').toBe(n1);
    expect.soft(firings(soon.tables).length, 'and no second event row').toBe(1);
    expect.soft(logsOf(soon).filter((l) => /within cooldown/i.test(l)).length, 'it says why').toBeGreaterThan(0);
    const day = evaluate(first.tables, [K.late], { now: '2026-11-24T13:00:00.000Z' });
    expect.soft(notifRows(day.tables).length, 'after 25 hours: told again').toBe(n1 * 2);
    const strong = withSaga(world(), K.strong, { strong_no_count: 1 });
    const s1 = evaluate(strong, [K.strong]);
    const sn = notifRows(s1.tables).length;
    expect.soft(notifRows(evaluate(s1.tables, [K.strong], { now: '2026-11-24T13:00:00.000Z' }).tables).length, 'Strong no after 25 hours: not again (72)').toBe(sn);
    expect.soft(notifRows(evaluate(s1.tables, [K.strong], { now: '2026-11-26T13:00:00.000Z' }).tables).length, 'after 73 hours: again').toBe(sn * 2);
    // Another rule or another candidate is not held back by this one.
    const both = evaluate(first.tables, [K.lateHm2], { now: '2026-11-23T13:00:00.000Z' });
    expect.soft(who(notifRows(both.tables).filter((n) => n['candidateId'] === K.lateHm2)), 'another candidate: told at once, the Recruiters of A and that candidate\'s hiring manager').toEqual(sorted(...RECRUITERS_A, SUB.hm2A));
    // B\'s own firing of the same rule is not held back by A\'s cooldown.
    const bFire = evaluate(first.tables, [K.lateB], { now: '2026-11-23T13:00:00.000Z' });
    expect.soft(who(notifRows(bFire.tables).filter((n) => n['candidateId'] === K.lateB)), 'B\'s people are told').toEqual(sorted(SUB.recB, SUB.hmB));
  });

  // ---------------------------------------------------------------- AC-10

  test('AC-10 pepla-dev: the seed puts the overdue candidate, the missed interview, the Strong no and the offer back each run (text check), and Terraform grants only what the card needs', async ({}, testInfo) => {
    once(testInfo.project.name);
    const ids = JSON.parse(read('pepla-web', 'e2e', 'acceptance', 'support', 'rec-09', 'dev-ids.json')) as Record<string, string>;
    expect.soft(Object.keys(ids).sort(), 'dev-ids.json names the seeded candidates').toEqual(['draftOffer', 'missed', 'overdue', 'strongNo'].sort().concat([]).sort());
    expect.soft(Object.values(ids).every((v) => /^CAND-REC09DEV[0-9A-Z]{14,}$/.test(v)), 'each is a made-up candidate id').toBe(true);
    const src = read('scripts', 'ci', 'seed-dev.py');
    const start = src.indexOf('def seed_rec09(');
    expect(start, 'seed-dev.py has seed_rec09').toBeGreaterThan(-1);
    const end = src.indexOf('\ndef ', start + 10);
    const fn = src.slice(start, end === -1 ? undefined : end);
    expect.soft(src.slice(src.indexOf('def main(')), 'main() calls seed_rec09').toMatch(/seed_rec09\(\s*ddb\s*,/);
    expect.soft(fn, 'it reads support/rec-09/dev-ids.json').toMatch(/rec-09[\s\S]*dev-ids\.json/);
    expect.soft(fn, 'the overdue candidate entered Applied long ago').toMatch(/stageEnteredAt/);
    expect.soft(fn, 'it writes an interview 26 hours past with no vote').toMatch(/INTERVIEW#/);
    expect.soft(fn, 'it sets a Strong no on one candidate').toMatch(/strong_no_count/);
    expect.soft(fn, 'it writes an offer close to expiry').toMatch(/expiry_date/);
    expect.soft(fn, 'the overdue candidate is written as BREACHED, with the time it breached, so the engine fires on the write').toMatch(/slaStatus["']\]?\s*=\s*\{"S": "BREACHED"\}[\s\S]*slaBreachedAt/);
    expect.soft(fn, 'it removes the HR login\'s earlier flag rows for these candidates, by a query on that person\'s key, so a green is today\'s firing').toMatch(/talent-flow-notifications[\s\S]*USER#\{hr_sub\}[\s\S]*NOTIF#[\s\S]*delete_item/);
    expect.soft(src.slice(src.indexOf('def main(')), 'main() passes the HR login\'s sub').toMatch(/seed_rec09\(\s*ddb\s*,[^\n]*"hr"/);
    expect.soft(fn, 'it clears what the last run made (flags, drafts, guard rows) so the check can run again').toMatch(/delete_item/);
    expect.soft(fn.includes('scan(') || fn.includes('Scan'), 'it scans nothing (the ids are known)').toBe(false);
    // Terraform: own role, no wildcard action, only the X-Ray statement may name every resource, four JWT routes.
    const drafts = read('talent-flow-infra', 'talent-flow-manage-drafts.tf');
    const grants = read('talent-flow-infra', 'talent-flow-rec09-grants.tf');
    for (const [name, text] of [['talent-flow-manage-drafts.tf', drafts], ['talent-flow-rec09-grants.tf', grants]] as const) {
      const actions = [...text.matchAll(/Action\s*=\s*(\[[^\]]*\]|"[^"]*")/g)].map((m) => m[1]!);
      expect.soft(actions.length, `${name} lists actions`).toBeGreaterThan(0);
      expect.soft(actions.filter((a) => /\*/.test(a)), `${name}: no wildcard action`).toEqual([]);
      const stars = text.split(/\bSid\s*=\s*/).slice(1).filter((st) => /^[^]*?Resource\s*=\s*"\*"/.test(st.split(/\bSid\s*=\s*/)[0]!.split('\n}')[0]!.slice(0, 600).split(/\n\s*\},?\s*\n/)[0]!)).map((st) => /^"([^"]+)"/.exec(st)?.[1]);
      expect.soft(stars.filter((s) => s !== 'XRay'), `${name}: only the X-Ray statement names every resource`).toEqual([]);
    }
    // Rule 11, exactly: the four policies REC-09 adds are written out in full (the IAM reader must be able to read every line: no locals, no
    // concat) and hold these lines and no others (support/rec-09/policy-lines.json, in the reader's "Allow <action> <resource> <condition>" form).
    const pinned = JSON.parse(read('pepla-web', 'e2e', 'acceptance', 'support', 'rec-09', 'policy-lines.json')) as Record<string, string[]>;
    const all = policyLines() as Record<string, { role: string; pairs?: string[]; squash?: string }>;
    for (const [key, role, owner] of [['manage_drafts', 'manage_drafts', 'manage_drafts'], ['evaluate_intelligence_rules_rec09', 'evaluate_intelligence_rules', 'evaluate_intelligence_rules'],
      ['monitor_slas_rec09', 'monitor_slas', 'monitor_slas'], ['get_intelligence_tiles_rec09', 'get_intelligence_tiles', 'get_intelligence_tiles']] as const) {
      const got = all[`talent-flow-infra/${key}`];
      expect.soft(got, `talent-flow-infra/${key} is a policy of talent-flow-infra`).toBeDefined();
      expect.soft(got?.role, `${key}: on the ${role} role`).toBe(role);
      expect.soft(got?.squash, `${key}: written out in full, readable line by line (no locals, no concat)`).toBeUndefined();
      expect.soft([...(got?.pairs ?? [])].sort(), `${key}: exactly the pinned lines, no other action, table, key or queue`).toEqual([...pinned[owner]!].sort());
    }
    expect.soft(drafts, 'the drafts Lambda has its own role').toMatch(/resource "aws_iam_role" "manage_drafts"/);
    for (const route of ['GET /v1/drafts', 'PATCH /v1/drafts/{id}', 'POST /v1/drafts/{id}/send', 'POST /v1/drafts/{id}/dismiss']) {
      const block = new RegExp(`route_key\\s*=\\s*"${route.replace(/[{}/]/g, '\\$&')}"[\\s\\S]*?\\n\\}`).exec(drafts)?.[0] ?? '';
      expect.soft(block, `${route} is a route`).not.toBe('');
      expect.soft(block, `${route} is behind the JWT authorizer`).toMatch(/authorization_type\s*=\s*"JWT"/);
    }
    expect.soft(drafts, 'the drafts Lambda writes no drafts without the state table only').not.toMatch(/dynamodb:DeleteItem/);
    const openapi = read('api', 'openapi.yaml');
    for (const path of ['/v1/drafts:', '/v1/drafts/{id}:', '/v1/drafts/{id}/send:', '/v1/drafts/{id}/dismiss:']) expect.soft(openapi, `openapi describes ${path}`).toContain(`  ${path}`);
    expect.soft(grants, 'the monitor may queue reminders and write guard rows').toMatch(/sqs:SendMessage/);
    expect.soft(grants, 'the engine and tiles name people through the pool, one pool').toMatch(/cognito-idp:ListUsersInGroup/);
  });

  test('AC-10 The test logins on pepla-dev: the founding Recruiter has the Over time flag for the seeded overdue candidate with the approved title and a why showing the rule and version; B\'s login has none of A\'s @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1 to AC-9.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(6 * 60_000);
    const envOf = (k: string) => process.env[k] ?? '';
    const login = (p: string) => ({ email: envOf(`${p}_EMAIL`), password: envOf(`${p}_PASSWORD`) });
    const logins = { hr: login('E2E_HR'), companyB: login('E2E_HR_B') };
    for (const [who2, l] of Object.entries(logins)) expect(l.email && l.password, `the ${who2} test login is set`).toBeTruthy();
    const { devEnv } = await import('./support/ten-02/dev');
    const { region, clientId } = devEnv();
    const appEnv = readFileSync(join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts'), 'utf8');
    const tfApi = (/talentFlowApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(appEnv)?.[1] ?? '').replace(/\/+$/, '').replace(/\/v1$/, '');
    expect(tfApi, 'pepla-web\'s talentFlowApiUrl points at pepla-dev\'s TalentFlow API').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const signIn = async (l: { email: string; password: string }) => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: l.email, PASSWORD: l.password } }),
      });
      expect(r.status(), 'signs in at Cognito').toBe(200);
      return ((await r.json()) as any).AuthenticationResult.IdToken as string;
    };
    const get = async (token: string, path: string) => page.request.fetch(`${tfApi}${path}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    const ids = JSON.parse(read('pepla-web', 'e2e', 'acceptance', 'support', 'rec-09', 'dev-ids.json')) as Record<string, string>;
    const [hr, companyB] = await Promise.all([signIn(logins.hr), signIn(logins.companyB)]);
    // The seed writes the candidate; the stream job flags it within a minute or two.
    let mine: any[] = [];
    for (let i = 0; i < 24 && mine.length === 0; i++) {
      const n = await get(hr, '/v1/notifications?limit=100');
      expect(n.status(), 'GET /v1/notifications').toBe(200);
      mine = ((await n.json()) as any).notifications.filter((x: any) => x.candidateId === ids['overdue'] && x.ruleId === 'RULE-SLA-001');
      if (mine.length === 0) await page.waitForTimeout(10_000);
    }
    expect(mine.length, 'the Recruiter has the Over time flag for the seeded overdue candidate').toBeGreaterThan(0);
    expect.soft(mine[0].title, 'with the approved title').toBe('Over time in Applied');
    expect.soft(typeof mine[0].settingsVersion, 'and the settings version').toBe('number');
    const tl = await get(hr, '/v1/intelligence/tiles');
    expect(tl.status(), 'GET /v1/intelligence/tiles').toBe(200);
    const tile = ((await tl.json()) as any).tiles.find((x: any) => x.entityId === ids['overdue'] && x.ruleId === 'RULE-SLA-001');
    expect.soft(tile?.why?.rule_id, 'the tile\'s why names the rule').toBe('RULE-SLA-001');
    expect.soft(typeof tile?.why?.rule_version, 'and the settings version').toBe('number');
    const bn = await get(companyB, '/v1/notifications?limit=100');
    expect(bn.status(), 'B: GET /v1/notifications').toBe(200);
    expect.soft(((await bn.json()) as any).notifications.filter((x: any) => Object.values(ids).includes(x.candidateId)), 'B\'s login has none of A\'s flags').toEqual([]);
    const bt = await get(companyB, '/v1/intelligence/tiles');
    expect.soft(((await bt.json()) as any).tiles.filter((x: any) => Object.values(ids).includes(x.entityId)), 'and none of A\'s tiles').toEqual([]);
    const drafts2 = await get(hr, '/v1/drafts');
    expect.soft(drafts2.status(), 'the Recruiter reads the drafts').toBe(200);
    const bd = await get(companyB, '/v1/drafts');
    expect.soft(((await bd.json()) as any).drafts.filter((x: any) => Object.values(ids).includes(x.candidateId)), 'B\'s login sees none of A\'s drafts').toEqual([]);
  });
});
