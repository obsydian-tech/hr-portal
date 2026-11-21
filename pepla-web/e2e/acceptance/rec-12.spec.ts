import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { devEnv } from './support/ten-02/dev';
import { LAMBDA, REPO, STAGES_FILE, runModule, runPack, runScript, type Sts, type Tables } from './support/rec-12/lambda-harness';
import { lambdaNamed, policyLines, readTf, roleResourceOf } from './support/rec-12/iam';
import { A, B, ID, SUB, TABLE, TENANTS, ask, av, bodyOf, calls, companyRows, describe, interview, plain, rowsOf, saga, statusOf, tables, writes } from './support/rec-12/world';
import { C } from './support/rec-12/callers';
import {
  AT_RISK_MOODS, CONFIG, CRITERIA_KEYS, INTERVIEW_TYPE_KEYS, LEVELS, LOCKED_TYPES, MOOD_KEYS, PLACEHOLDERS, REASONS, REQUIRED_BY_LEVEL, STAGE_CODES, TEMPLATE_TEXTS, TYPES,
  activeRow, configRows, defaultOf, newRows, otherRows, type SettingType,
} from './support/rec-12/standard';
import { packTables } from './support/rec-12/world';

/**
 * REC-12 · Settings that are only names become real settings, with a Standard pack (Jira NH-246, epic NH-234). Amber.
 * One test per acceptance criterion, written from the card before any code. Spec: /mnt/project-files/onboarding-cards/specs/REC-12.md,
 * read with REC-00.md. Notes: cards/rec-12.md and onboarding-cards/specs/REC-12-tests-for-review.md (the bar: "What these tests must catch").
 *
 * The Lambda tests run the real handlers and the real shared files, each call in a fresh Node process, against a fake AWS
 * (support/rec-12/fake-aws, MOD-01's copy with code added only: a failure that hits only the nth call, and the tables after a helper run).
 * Company A holds the Standard pack (written by the real pack script, support/rec-12/world.ts packTables); company B has no settings.
 * The pack tests run scripts/tenancy/module-seeds/recruitment.mjs and scripts/tenancy/set-modules.mjs against the same fake.
 * AC-8 reads code and Terraform as text. AC-9 runs on pepla-dev only (@pepla-dev). Nothing here calls AWS or any AI: Bedrock is refused.
 *
 * Pinned by the verifier where the card is silent (each is in cards/rec-12.md for the BA to confirm, D-T-1 to D-T-9):
 *  - D-T-1 A candidate's lock is `settingVersions`, a map of type to version number on the candidate's row; getCandidate returns it (AC-9 needs to see it).
 *  - D-T-2 The pack and the lock hold twelve types; WORKFLOW_TEMPLATES stays a name and is written nowhere.
 *  - D-T-3 RETENTION is judged either way on a candidate's row (the card says it is read at Not hired time).
 *  - D-T-4 The render function is renderTemplate(template, values) in lambda/shared/recruitment-settings.mjs, answering { subject?, body }.
 *  - D-T-5 The gate that reads INTERVIEW_TYPES is the one today's code has (leaving INTERVIEWING for EVALUATION); REC-03 moves it with its own lock.
 *  - D-T-6 {first_name} (underscore) in the stored check-in and follow-up texts: the card's placeholder spelling for the approved "{first name}".
 *  - D-T-7 The Standard pack switches Screening on, and its starting interview lists are the Interview Requirements page's own (support/rec-12/standard.ts).
 *  - D-T-8 The text check on old defaults covers every config-reader.js copy and the two handlers that held fixed lists; the stored-config reads in
 *    submitVote, submitVoteByToken and completeEvaluation are REC-02's (it replaces them with REJECTION_RULES).
 *  - D-T-10 A version that is no longer active is kept for good: no expiry time on it (today's save sets a 365-day expiry on the old version; a candidate locked to it would lose it).
 *  - D-T-9 The audit row of a save is any new row holding type, from_version, to_version, by and at; its table is the builder's.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const INVALID = { error: 'Bad request', code: 'INVALID_SETTING' };
const STALE = { error: 'Conflict', code: 'STALE_VERSION' };
const FORBIDDEN = { error: 'Forbidden' };
const STANDARD_PACK_LINE = 'Recruitment Standard pack: not available yet (REC-12)';
const DEV_STS: Sts = { Account: '424556617428', Arn: 'arn:aws:sts::424556617428:assumed-role/pepla-dev-operator/rec12-ac7', UserId: 'AROAREC12DEV:rec12-ac7' };
const PROD_STS: Sts = { Account: '937137806477', Arn: 'arn:aws:sts::937137806477:assumed-role/naleko-prod-operator/rec12-ac7', UserId: 'AROAREC12PROD:rec12-ac7' };
const TENANTS_PROD = 'naleko-people-prod-tenants';
const STATE_WRITE = /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems/;

// ---------------------------------------------------------------- small helpers

const clone = <T>(v: T): T => structuredClone(v);
/** Every value stored under `key`, anywhere in `v`. */
const deepFind = (v: unknown, key: string, out: unknown[] = []): unknown[] => {
  if (Array.isArray(v)) v.forEach((x) => deepFind(x, key, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === key) out.push(x); deepFind(x, key, out); }
  return out;
};
/** Sets `key` everywhere it is already in `v` (so a test does not guess where the pack keeps it). Returns how many it set. */
const setDeep = (v: any, key: string, value: unknown): number => {
  let n = 0;
  if (Array.isArray(v)) v.forEach((x) => { n += setDeep(x, key, value); });
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) { if (k === key) { v[k] = value; n++; } else n += setDeep(v[k], key, value); }
  return n;
};
const manage = (caller: any, method: string, a: { body?: unknown; query?: Record<string, string>; claims?: Record<string, unknown> }, t: Tables, opts: { fail?: any } = {}) =>
  ask('manageTalentFlowConfig', caller, { method, ...a }, { tables: t, ...opts });
const save = (type: string, data: unknown, t: Tables, extra: Record<string, unknown> = {}, caller: any = C.adminOnly) => manage(caller, 'PUT', { body: { configType: type, data, ...extra } }, t);
const create = (type: string, data: unknown, t: Tables, caller: any = C.adminB) => manage(caller, 'POST', { body: { configType: type, data } }, t);
const readActive = (type: string, t: Tables, caller: any = C.recruiter) => manage(caller, 'GET', { query: { configType: type, active: 'true' } }, t);
const noChange = (r: { tables: Tables }, t: Tables) => JSON.stringify(r.tables) === JSON.stringify(t);
const stateWrites = (r: { calls: any[] }) => calls(r).filter((c) => c.service === 'dynamodb' && STATE_WRITE.test(c.op) && c.table === TABLE.state);
const sagaOf = (t: Tables, id: string) => rowsOf(t, TABLE.state).find((r) => r['PK'] === `CANDIDATE#${id}` && r['SK'] === 'SAGA');
/** A version number as the lock may store it (7, "7" or "v7"). */
const num = (v: unknown) => Number(String(v).replace(/^v/, ''));
const newCandidate = (key: string, level = 'MID') => ({ idempotencyKey: key, firstName: 'Lerato', lastName: 'Mokoena', email: 'lerato@example.test', positionTitle: 'Baker', positionLevel: level });
const make = (t: Tables, key: string, caller: any = C.recruiter, level = 'MID') => ask('createCandidate', caller, { method: 'POST', body: newCandidate(key, level) }, { tables: t });
const candidateIdOf = (r: any): string => bodyOf(r)?.candidateId;
const settingsRun = (steps: any[], t: Tables, opts: { fail?: any } = {}) =>
  runModule(steps, { tables: t, env: { STATE_TABLE_NAME: TABLE.state, CONFIG_TABLE_NAME: TABLE.config, TENANTS_TABLE: TENANTS }, ...opts });
const stripJs = (src: string): string => {
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
};
const code = (path: string) => stripJs(readFileSync(path, 'utf8'));
/** Company A and B both with the pack (B's own values are set by the test that needs them). */
let both: Tables | undefined;
const bothPacked = (): Tables => {
  if (!both) {
    const r = runPack(B, 'dev', { tables: packTables() });
    if (r.code !== 0) throw new Error(`the Standard pack did not run for company B (exit ${r.code}): ${(r.stdout + r.stderr).slice(-600)}`);
    both = r.tables;
  }
  return clone(both);
};
/** The world for a company with no settings. */
const noSettings = (): Tables => tables();

test.describe('REC-12 · Settings that are only names become real settings, with a Standard pack', () => {
  // ---------------------------------------------------------------- control

  test('Control: an empty company reads as empty and an admin can save a setting no card owns, so the fixtures are good requests', async ({}, testInfo) => {
    once(testInfo.project.name);
    const empty = readActive('SCORING_WEIGHTS', noSettings());
    expect.soft(statusOf(empty), `a recruiter reads an empty company (${describe(empty)})`).toBe(200);
    expect.soft(bodyOf(empty)?.data, 'with an empty data object').toEqual({});
    const queues = save('IT_QUEUES', { queues: [{ id: 'q1' }] }, noSettings());
    expect.soft(statusOf(queues), `an admin saves IT_QUEUES, which no REC-12 shape covers (${describe(queues)})`).toBe(200);
  });

  // ---------------------------------------------------------------- AC-1

  test('AC-1 Shapes: the defaults pass, a valid change saves a new version, every invalid case is 400 INVALID_SETTING with no write', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    const base = packTables();
    const D = (t: SettingType) => defaultOf(t);
    const mod = <T>(t: SettingType, f: (d: any) => void): T => { const d = D(t); f(d); return d; };

    // Every default passes its own validator (a save of the default is a new version, version 2).
    for (const type of TYPES) {
      const r = save(type, D(type), base);
      expect.soft(statusOf(r), `the pack's default ${type} saves unchanged (${describe(r)})`).toBe(200);
      expect.soft(bodyOf(r)?.version, `${type}: as version 2`).toBe(2);
    }

    // A valid change saves as a new version.
    const validChanges: [SettingType, any][] = [
      ['STAGE_CONFIG', { screening: false }],
      ['SENIORITY_PROFILES', mod('SENIORITY_PROFILES', (d) => { d.levels[0].label = 'Entry'; })],
      ['INTERVIEW_TYPES', mod('INTERVIEW_TYPES', (d) => { d.types.push({ key: 'GROUP', label: 'Group', optional: true }); d.requiredByLevel.JUNIOR = ['PHONE_SCREEN', 'GROUP']; })],
      ['SCORING_WEIGHTS', mod('SCORING_WEIGHTS', (d) => { d.defaultCriteria.push({ key: 'teamwork', label: 'Teamwork' }); })],
      ['REJECTION_RULES', mod('REJECTION_RULES', (d) => { d.decider.JUNIOR = 'HR_ONLY'; d.secondConfirmation.SENIOR = true; d.reviewBelowScore = 3; d.reviewVoteLevel = null; })],
      ['APPROVAL_RULES', { mode: 'ONE_APPROVER' }],
      ['SLA_THRESHOLDS', mod('SLA_THRESHOLDS', (d) => { setDeep(d, 'feedbackDueHours', 48); setDeep(d, 'interviewMissedAfterHours', 36); })],
      ['SENTIMENT_SCALE', mod('SENTIMENT_SCALE', (d) => { d.moods = d.moods.slice(0, 2); })],
      ['SENTIMENT_SCALE', mod('SENTIMENT_SCALE', (d) => { while (d.moods.length < 7) d.moods.push({ key: `EXTRA_${d.moods.length}`, label: 'Extra', atRisk: false }); })],
      ['EMAIL_TEMPLATES', mod('EMAIL_TEMPLATES', (d) => { d.candidate_check_in.body = 'Hi {first_name}, how is {role} going? {company}, {date}, {due}, {link}, {expires}, {start_date}, {candidate}'; d.offer_letter = { body: 'Dear {first_name}, your start date is {start_date}.' }; })],
      ['RETENTION', { notHiredMonths: 1 }],
      ['RETENTION', { notHiredMonths: 60 }],
      ['RETENTION', { notHiredMonths: 12 }],
    ];
    for (const [type, data] of validChanges) {
      const r = save(type, data, base);
      expect.soft(statusOf(r), `a valid ${type} change saves (${describe(r)})`).toBe(200);
      expect.soft(bodyOf(r)?.version, `${type}: as version 2`).toBe(2);
      const row = activeRow(r.tables, A, type);
      expect.soft(row?.['data'], `${type}: the active version holds the change`).toEqual(data);
    }

    // Every invalid case: 400 { error: "Bad request", code: "INVALID_SETTING" } and nothing written.
    const invalid: [string, SettingType, any][] = [
      ['an unknown key (STAGE_CONFIG)', 'STAGE_CONFIG', { screening: true, extra: 1 }],
      ['Screening as text', 'STAGE_CONFIG', { screening: 'yes' }],
      ['another stage switched off (interview)', 'STAGE_CONFIG', { screening: true, interview: false }],
      ['another stage switched off (offer only)', 'STAGE_CONFIG', { offer: false }],
      ['no levels', 'SENIORITY_PROFILES', { levels: [] }],
      ['nine levels', 'SENIORITY_PROFILES', { levels: Array.from({ length: 9 }, (_x, i) => ({ key: `LEVEL_${String.fromCharCode(65 + i)}`, label: `L${i}`, order: i + 1 })) }],
      ['a lower-case level key', 'SENIORITY_PROFILES', mod('SENIORITY_PROFILES', (d) => { d.levels[0].key = 'junior'; })],
      ['a one-letter level key', 'SENIORITY_PROFILES', mod('SENIORITY_PROFILES', (d) => { d.levels[0].key = 'J'; })],
      ['a level key of 21 letters', 'SENIORITY_PROFILES', mod('SENIORITY_PROFILES', (d) => { d.levels[0].key = 'A'.repeat(21); })],
      ['a level key with a digit', 'SENIORITY_PROFILES', mod('SENIORITY_PROFILES', (d) => { d.levels[0].key = 'LEVEL1'; })],
      ['two levels with one key', 'SENIORITY_PROFILES', mod('SENIORITY_PROFILES', (d) => { d.levels[1].key = d.levels[0].key; })],
      ['an unknown key on a level', 'SENIORITY_PROFILES', mod('SENIORITY_PROFILES', (d) => { d.levels[0].extra = 1; })],
      ['an unknown key (SENIORITY_PROFILES)', 'SENIORITY_PROFILES', mod('SENIORITY_PROFILES', (d) => { d.extra = 1; })],
      ['required interviews for a level that does not exist', 'INTERVIEW_TYPES', mod('INTERVIEW_TYPES', (d) => { d.requiredByLevel.LEAD = ['PHONE_SCREEN']; })],
      ['required interviews that miss a level', 'INTERVIEW_TYPES', mod('INTERVIEW_TYPES', (d) => { delete d.requiredByLevel.SENIOR; })],
      ['a required interview type that is not a type', 'INTERVIEW_TYPES', mod('INTERVIEW_TYPES', (d) => { d.requiredByLevel.MID = ['NOPE']; })],
      ['an unknown key (INTERVIEW_TYPES)', 'INTERVIEW_TYPES', mod('INTERVIEW_TYPES', (d) => { d.extra = 1; })],
      ['an unknown key (PANEL_CONFIG)', 'PANEL_CONFIG', mod('PANEL_CONFIG', (d) => { d.unexpectedKey = 1; })],
      ['weights set (SCORING_WEIGHTS)', 'SCORING_WEIGHTS', mod('SCORING_WEIGHTS', (d) => { d.weights = { technical: 40, communication: 20, culturalFit: 20, problemSolving: 20 }; })],
      ['an unknown key (SCORING_WEIGHTS)', 'SCORING_WEIGHTS', mod('SCORING_WEIGHTS', (d) => { d.extra = 1; })],
      ['a ninth Not hired reason', 'REJECTION_RULES', mod('REJECTION_RULES', (d) => { d.reasons.push('BETTER_OFFER'); })],
      ['only seven reasons', 'REJECTION_RULES', mod('REJECTION_RULES', (d) => { d.reasons = d.reasons.slice(0, 7); })],
      ['a reason with other words', 'REJECTION_RULES', mod('REJECTION_RULES', (d) => { d.reasons[0] = 'NOT_A_FIT'; })],
      ['deciders that miss a level', 'REJECTION_RULES', mod('REJECTION_RULES', (d) => { delete d.decider.SENIOR; })],
      ['deciders for a level that does not exist', 'REJECTION_RULES', mod('REJECTION_RULES', (d) => { d.decider.LEAD = 'HR_ONLY'; })],
      ['a decider that is neither value', 'REJECTION_RULES', mod('REJECTION_RULES', (d) => { d.decider.MID = 'ANYONE'; })],
      ['second confirmations that miss a level', 'REJECTION_RULES', mod('REJECTION_RULES', (d) => { delete d.secondConfirmation.MID; })],
      ['a second confirmation as text', 'REJECTION_RULES', mod('REJECTION_RULES', (d) => { d.secondConfirmation.MID = 'yes'; })],
      ['a review vote level that is not STRONG_NO', 'REJECTION_RULES', mod('REJECTION_RULES', (d) => { d.reviewVoteLevel = 'YES'; })],
      ['a review score of 0', 'REJECTION_RULES', mod('REJECTION_RULES', (d) => { d.reviewBelowScore = 0; })],
      ['a review score of 6', 'REJECTION_RULES', mod('REJECTION_RULES', (d) => { d.reviewBelowScore = 6; })],
      ['a review score as text', 'REJECTION_RULES', mod('REJECTION_RULES', (d) => { d.reviewBelowScore = '3'; })],
      ['the removed minimumPassScore', 'REJECTION_RULES', mod('REJECTION_RULES', (d) => { d.minimumPassScore = 6; })],
      ['the removed strongNoVeto', 'REJECTION_RULES', mod('REJECTION_RULES', (d) => { d.strongNoVeto = true; })],
      ['an approval chain mode', 'APPROVAL_RULES', { mode: 'CHAIN' }],
      ['two approvers', 'APPROVAL_RULES', { mode: 'TWO_APPROVERS' }],
      ['no mode', 'APPROVAL_RULES', {}],
      ['the old chain shape saved again', 'APPROVAL_RULES', { mode: 'ONE_APPROVER', chain: [{ role: 'HiringManager' }] }],
      ['an unknown key (SLA_THRESHOLDS)', 'SLA_THRESHOLDS', mod('SLA_THRESHOLDS', (d) => { d.unexpectedKey = 1; })],
      ['a negative missed-interview time', 'SLA_THRESHOLDS', mod('SLA_THRESHOLDS', (d) => { setDeep(d, 'interviewMissedAfterHours', -1); })],
      ['a missed-interview time as text', 'SLA_THRESHOLDS', mod('SLA_THRESHOLDS', (d) => { setDeep(d, 'interviewMissedAfterHours', '24'); })],
      ['a feedback time of -5', 'SLA_THRESHOLDS', mod('SLA_THRESHOLDS', (d) => { setDeep(d, 'feedbackDueHours', -5); })],
      ['a negative offer warning', 'SLA_THRESHOLDS', mod('SLA_THRESHOLDS', (d) => { setDeep(d, 'offerExpiryWarningDays', -1); })],
      ['one mood', 'SENTIMENT_SCALE', mod('SENTIMENT_SCALE', (d) => { d.moods = d.moods.slice(0, 1); })],
      ['eight moods', 'SENTIMENT_SCALE', mod('SENTIMENT_SCALE', (d) => { while (d.moods.length < 8) d.moods.push({ key: `EXTRA_${d.moods.length}`, label: 'Extra', atRisk: false }); })],
      ['an unknown key on a mood', 'SENTIMENT_SCALE', mod('SENTIMENT_SCALE', (d) => { d.moods[0].extra = 1; })],
      ['an at-risk flag as text', 'SENTIMENT_SCALE', mod('SENTIMENT_SCALE', (d) => { d.moods[0].atRisk = 'yes'; })],
      ['an unknown placeholder {salary}', 'EMAIL_TEMPLATES', mod('EMAIL_TEMPLATES', (d) => { d.candidate_check_in.body = 'Your salary is {salary}'; })],
      ['a placeholder with a space', 'EMAIL_TEMPLATES', mod('EMAIL_TEMPLATES', (d) => { d.candidate_check_in.body = 'Hi {first name}'; })],
      ['a placeholder in capitals', 'EMAIL_TEMPLATES', mod('EMAIL_TEMPLATES', (d) => { d.candidate_check_in.body = 'Hi {COMPANY}'; })],
      ['an unknown placeholder in a subject', 'EMAIL_TEMPLATES', mod('EMAIL_TEMPLATES', (d) => { d.interviewer_reminder.subject = 'About {salary}'; })],
      ['an unknown template key', 'EMAIL_TEMPLATES', mod('EMAIL_TEMPLATES', (d) => { d.welcome_note = { body: 'Hello' }; })],
      ['a template with no body', 'EMAIL_TEMPLATES', mod('EMAIL_TEMPLATES', (d) => { delete d.candidate_check_in.body; })],
      ['a template body that is a number', 'EMAIL_TEMPLATES', mod('EMAIL_TEMPLATES', (d) => { d.candidate_check_in.body = 7; })],
      ['an unknown key (INTELLIGENCE_RULES)', 'INTELLIGENCE_RULES', mod('INTELLIGENCE_RULES', (d) => { d.unexpectedKey = 1; })],
      ['retention 0', 'RETENTION', { notHiredMonths: 0 }],
      ['retention 61', 'RETENTION', { notHiredMonths: 61 }],
      ['retention -1', 'RETENTION', { notHiredMonths: -1 }],
      ['retention 6.5', 'RETENTION', { notHiredMonths: 6.5 }],
      ['retention as text', 'RETENTION', { notHiredMonths: '6' }],
      ['retention empty', 'RETENTION', { notHiredMonths: null }],
      ['an unknown key (RETENTION)', 'RETENTION', { notHiredMonths: 6, extra: 1 }],
    ];
    for (const [what, type, data] of invalid) {
      const r = save(type, data, base);
      expect.soft(statusOf(r), `${what}: 400 (${describe(r)})`).toBe(400);
      expect.soft(bodyOf(r), `${what}: exactly { "error": "Bad request", "code": "INVALID_SETTING" }`).toEqual(INVALID);
      expect.soft(noChange(r, base), `${what}: nothing is written`).toBe(true);
    }

    // The levels are the company's own: the per-level settings follow the active SENIORITY_PROFILES, whatever they are.
    const two = save('SENIORITY_PROFILES', { levels: [{ key: 'JUNIOR', label: 'Junior', order: 1 }, { key: 'SENIOR', label: 'Senior', order: 2 }] }, base);
    expect(statusOf(two), `two levels save (${describe(two)})`).toBe(200);
    const stale = save('REJECTION_RULES', D('REJECTION_RULES'), two.tables);
    expect.soft(statusOf(stale), 'with two levels active, deciders for three are refused').toBe(400);
    expect.soft(bodyOf(stale), 'with the same answer').toEqual(INVALID);
    const fits = mod<any>('REJECTION_RULES', (d) => { delete d.decider.MID; delete d.secondConfirmation.MID; });
    expect.soft(statusOf(save('REJECTION_RULES', fits, two.tables)), 'deciders for exactly the two active levels are saved').toBe(200);
    const lead = save('SENIORITY_PROFILES', { levels: [{ key: 'LEAD', label: 'Lead', order: 1 }] }, base);
    const onlyLead = mod<any>('REJECTION_RULES', (d) => { d.decider = { LEAD: 'HR_ONLY' }; d.secondConfirmation = { LEAD: false }; });
    expect.soft(statusOf(save('REJECTION_RULES', onlyLead, lead.tables)), 'a level the pack never had (LEAD) is accepted once it is active').toBe(200);

    // Creating the first version (POST) is checked the same way, on a company with no settings.
    const fresh = noSettings();
    for (const [what, type, data, want] of [
      ['a valid RETENTION', 'RETENTION', { notHiredMonths: 6 }, 201],
      ['a valid STAGE_CONFIG', 'STAGE_CONFIG', { screening: true }, 201],
      ['a valid APPROVAL_RULES', 'APPROVAL_RULES', { mode: 'ONE_APPROVER' }, 201],
      ['retention 0', 'RETENTION', { notHiredMonths: 0 }, 400],
      ['an unknown key', 'STAGE_CONFIG', { screening: true, extra: 1 }, 400],
      ['a chain mode', 'APPROVAL_RULES', { mode: 'CHAIN' }, 400],
    ] as const) {
      const r = create(type, data, fresh);
      expect.soft(statusOf(r), `first version, ${what}: ${want} (${describe(r)})`).toBe(want);
      if (want === 400) {
        expect.soft(bodyOf(r), `first version, ${what}: INVALID_SETTING`).toEqual(INVALID);
        expect.soft(noChange(r, fresh), `first version, ${what}: nothing is written`).toBe(true);
      }
    }
    // A type no REC-12 shape covers is not held to one (the other settings pages keep saving).
    expect.soft(statusOf(save('IT_QUEUES', { anything: [1, 2, 3] }, base)), 'IT_QUEUES still saves any data').toBe(200);
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 Versions: two saves make versions 2 and 3, a locked candidate still reads its own, a stale expected_version is 409, one audit row per save', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const base = packTables();
    const one = defaultOf('SLA_THRESHOLDS');
    expect(setDeep(clone(one), 'feedbackDueHours', 1), 'the pack\'s SLA_THRESHOLDS holds feedbackDueHours').toBeGreaterThan(0);
    const changeA = clone(one); setDeep(changeA, 'feedbackDueHours', 11);
    const changeB = clone(one); setDeep(changeB, 'feedbackDueHours', 22);

    const s1 = save('SLA_THRESHOLDS', changeA, base);
    expect.soft([statusOf(s1), bodyOf(s1)?.version], `the first save makes version 2 (${describe(s1)})`).toEqual([200, 2]);
    const s2 = save('SLA_THRESHOLDS', changeB, s1.tables);
    expect.soft([statusOf(s2), bodyOf(s2)?.version], `the second save makes version 3 (${describe(s2)})`).toEqual([200, 3]);
    const rows = configRows(s2.tables, A, 'SLA_THRESHOLDS');
    expect.soft(rows.map((r) => r['version']), 'all three versions are kept (nothing deleted)').toEqual([1, 2, 3]);
    expect.soft(rows.map((r) => r['GSI1PK'] !== undefined), 'only version 3 is in the active index').toEqual([false, false, true]);
    expect.soft(rows.map((r) => r['isActive']), 'only version 3 is marked active').toEqual([false, false, true]);
    expect.soft(rows.filter((r) => Object.keys(r).some((k) => /^(expiresAt|ttl|expires_at|expiry)$/i.test(k))).length, 'no version carries an expiry time (a candidate locked to an old version must always find it: D-T-10)').toBe(0);
    expect.soft(rows[0]?.['data'], 'version 1 is untouched').toEqual(one);
    expect.soft(rows[1]?.['data'], 'version 2 holds the first change, untouched by the second save').toEqual(changeA);
    expect.soft(rows[2]?.['data'], 'version 3 holds the second change').toEqual(changeB);
    expect.soft(rows.every((r) => r['tenant_id'] === A), 'every version is stamped with company A').toBe(true);
    const list = manage(C.recruiter, 'GET', { query: { configType: 'SLA_THRESHOLDS' } }, s2.tables);
    expect.soft(bodyOf(list)?.items?.length, 'the history read lists three versions').toBe(3);

    // A candidate locked to version 2 still reads version 2; the company reads version 3.
    const locked = (versions: Record<string, number>) => ({ PK: 'CANDIDATE#CAND-REC12-LOCK', SK: 'SAGA', tenant_id: A, candidateId: 'CAND-REC12-LOCK', positionLevel: 'MID', currentStage: 'APPLICATION_REVIEW', settingVersions: { ...Object.fromEntries(LOCKED_TYPES.map((t) => [t, 1])), ...versions } });
    const read = settingsRun([{ get: 'getRecruitmentSettings' }, { fn: 'getRecruitmentSettings', args: [A, locked({ SLA_THRESHOLDS: 2 })] }, { fn: 'getRecruitmentSettings', args: [A] }], s2.tables);
    expect(read.importError, `lambda/shared/recruitment-settings.mjs imports (${read.importError?.message ?? 'it does not exist yet'})`).toBeUndefined();
    expect.soft(read.results[1]?.ok, `getRecruitmentSettings(tenantId, candidate) runs (${read.results[1]?.error?.message ?? ''})`).toBe(true);
    expect.soft(deepFind(read.results[1]?.value, 'feedbackDueHours'), 'a candidate locked to 2 reads version 2').toEqual([11]);
    expect.soft(deepFind(read.results[2]?.value, 'feedbackDueHours'), 'with no candidate the active version (3) is read').toEqual([22]);
    expect.soft(JSON.stringify(read.results[1]?.value ?? '').includes('ONE_APPROVER'), 'and the other types come back with it').toBe(true);

    // Stale or wrong expected_version: 409 STALE_VERSION and no write at all.
    for (const [what, v] of [['version 1 (stale)', 1], ['version 2 (stale)', 2], ['version 4 (not yet made)', 4], ['version 0', 0]] as const) {
      const r = save('SLA_THRESHOLDS', changeA, s2.tables, { expected_version: v });
      expect.soft([statusOf(r), bodyOf(r)], `expected_version ${what} while 3 is active: 409 STALE_VERSION`).toEqual([409, STALE]);
      expect.soft(noChange(r, s2.tables), `expected_version ${what}: nothing is written, no audit row`).toBe(true);
    }
    const right = save('SLA_THRESHOLDS', changeA, s2.tables, { expected_version: 3 });
    expect.soft([statusOf(right), bodyOf(right)?.version], `the current expected_version saves version 4 (${describe(right)})`).toEqual([200, 4]);
    const none = save('SLA_THRESHOLDS', changeB, s2.tables);
    expect.soft(statusOf(none), 'a save with no expected_version still saves (the settings pages do not send one)').toBe(200);

    // One audit row per save: { type, from_version, to_version, by, at }. The person is the caller's, never the body's.
    const audit = (before: Tables, after: Tables) => newRows(before, after).filter((x) => 'from_version' in x.row && 'to_version' in x.row);
    const a1 = audit(base, s1.tables);
    expect.soft(a1.length, 'the first save writes one audit row').toBe(1);
    const row = a1[0]?.row ?? {};
    expect.soft([row['type'], row['from_version'], row['to_version']], 'type, from_version and to_version').toEqual(['SLA_THRESHOLDS', 1, 2]);
    expect.soft(row['by'], 'by is the caller\'s person id').toBe('sub-admin-a');
    expect.soft(Number.isNaN(Date.parse(String(row['at']))), 'at is a time').toBe(false);
    expect.soft(row['tenant_id'], 'the audit row is stamped with company A').toBe(A);
    expect.soft(JSON.stringify(row).includes('@'), 'the audit row holds no email address').toBe(false);
    expect.soft(audit(s1.tables, s2.tables).length, 'the second save writes one more').toBe(1);
    expect.soft(audit(s1.tables, s2.tables)[0]?.row['to_version'], 'naming version 3').toBe(3);
    const spoof = save('SLA_THRESHOLDS', changeA, base, { by: 'someone-else', createdBy: 'someone-else', approvedBy: 'someone-else', tenantId: B, tenant_id: B });
    expect.soft(audit(base, spoof.tables)[0]?.row['by'], 'a "by" in the body is ignored').toBe('sub-admin-a');
    expect.soft(rowsOf(spoof.tables, CONFIG).filter((r) => r['tenant_id'] === B).length, 'and so is a company in the body (nothing is written for B)').toBe(0);
    // Refused saves leave no audit row.
    for (const [what, r] of [
      ['an invalid save', save('RETENTION', { notHiredMonths: 0 }, base)],
      ['a save by a recruiter', save('RETENTION', { notHiredMonths: 9 }, base, {}, C.recruiter)],
    ] as const) expect.soft(audit(base, r.tables).length, `${what}: no audit row`).toBe(0);
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 Locked per candidate: a new candidate holds every type\'s version, an old one locks on first read, and the lock never moves', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const base = packTables();
    const made = make(base, 'idem-rec12-lock-0001');
    expect(statusOf(made), `a recruiter creates a candidate (${describe(made)})`).toBe(201);
    const id = candidateIdOf(made);
    const lockOf = (t: Tables, cid: string) => sagaOf(t, cid)?.['settingVersions'] as Record<string, unknown> | undefined;
    const l1 = lockOf(made.tables, id);
    expect.soft(l1 && typeof l1 === 'object', 'the new candidate\'s row holds settingVersions').toBe(true);
    for (const type of LOCKED_TYPES) expect.soft(num(l1?.[type]), `a new candidate is locked to ${type} version 1`).toBe(1);
    expect.soft(Object.keys(l1 ?? {}).filter((k) => !(TYPES as readonly string[]).includes(k)), 'and to no type that is not a setting').toEqual([]);
    expect.soft(l1?.['INTELLIGENCE_RULES'] !== undefined, 'INTELLIGENCE_RULES is locked too (it had no lock before this card)').toBe(true);

    // A new version is made; the next candidate is locked to it and the first one is not moved.
    const changed = defaultOf('SLA_THRESHOLDS'); setDeep(changed, 'feedbackDueHours', 77);
    const moved = save('SLA_THRESHOLDS', changed, made.tables);
    expect(statusOf(moved)).toBe(200);
    const second = make(moved.tables, 'idem-rec12-lock-0002');
    const l2 = lockOf(second.tables, candidateIdOf(second));
    expect.soft(statusOf(second), `a second candidate is created (${describe(second)})`).toBe(201);
    expect.soft(num(l2?.['SLA_THRESHOLDS']), 'a candidate created after the save is locked to version 2').toBe(2);
    expect.soft(num(l2?.['REJECTION_RULES']), 'and to version 1 of a type that did not change').toBe(1);
    expect.soft(num(lockOf(second.tables, id)?.['SLA_THRESHOLDS']), 'the first candidate is still locked to version 1').toBe(1);
    // The candidate can be read with its lock by a recruiter (AC-9 reads it on dev).
    const seen = ask('getCandidate', C.recruiter, { path: { id } }, { tables: second.tables });
    expect.soft(statusOf(seen), `a recruiter reads the candidate (${describe(seen)})`).toBe(200);
    expect.soft(num(bodyOf(seen)?.settingVersions?.SLA_THRESHOLDS ?? bodyOf(seen)?.candidate?.settingVersions?.SLA_THRESHOLDS), 'the answer shows the candidate\'s lock (settingVersions)').toBe(1);

    // A company with no settings can still create a candidate, and its row holds none of company A's versions.
    const none = make(noSettings(), 'idem-rec12-lock-0003', C.recruiterB);
    expect.soft(statusOf(none), `a candidate of a company with no settings is created (${describe(none)})`).toBe(201);
    const lb = lockOf(none.tables, candidateIdOf(none));
    expect.soft(Object.values(lb ?? {}).length, 'with nothing to lock to').toBe(0);

    // An old candidate (no lock) locks on the first read, with a conditional write that can only happen once.
    const oldRow = () => plain(sagaOf(base, ID.c2) ? (base[TABLE.state] ?? []).find((r) => (r['PK'] as any)?.S === `CANDIDATE#${ID.c2}` && (r['SK'] as any)?.S === 'SAGA') : undefined);
    const old = oldRow();
    expect(old['settingVersions'], 'the old candidate has no lock to start with').toBeUndefined();
    const first = settingsRun([{ fn: 'getRecruitmentSettings', args: [A, old] }], base);
    expect.soft(first.results[0]?.ok, `the first read runs (${first.results[0]?.error?.message ?? first.importError?.message ?? ''})`).toBe(true);
    const lockedNow = lockOf(first.tables, ID.c2);
    for (const type of LOCKED_TYPES) expect.soft(num(lockedNow?.[type]), `the first read locks ${type} at its active version (1)`).toBe(1);
    const lockWrites = (first.calls as any[]).filter((c) => c.service === 'dynamodb' && /UpdateItem|PutItem|TransactWriteItems/.test(c.op) && c.table === TABLE.state);
    const versionWrites = lockWrites.filter((c) => /"N":"1"|"N":1/.test(JSON.stringify(c.input?.ExpressionAttributeValues ?? c.input?.Item ?? '')));
    expect.soft(versionWrites.length > 0 && versionWrites.every((c) => JSON.stringify(c.input).includes('attribute_not_exists')), 'a lock is written with a condition that fails if it is already there (write once)').toBe(true);
    // The company then moves on; the same (lock-less) candidate object read again still gets version 1, and the row stays at 1.
    const nextWorld = save('SLA_THRESHOLDS', changed, first.tables);
    const again = settingsRun([{ fn: 'getRecruitmentSettings', args: [A, old] }, { fn: 'getRecruitmentSettings', args: [A, plain((nextWorld.tables[TABLE.state] ?? []).find((r) => (r['PK'] as any)?.S === `CANDIDATE#${ID.c2}` && (r['SK'] as any)?.S === 'SAGA'))] }, { fn: 'getRecruitmentSettings', args: [A] }], nextWorld.tables);
    expect.soft(again.results.map((x) => x?.ok), `all three later reads run, none crashes (${again.results.map((x) => x?.error?.message ?? '').join(' ')})`).toEqual([true, true, true]);
    expect.soft(deepFind(again.results[0]?.value, 'feedbackDueHours'), 'a second read after a new version still gives the first lock (a stale copy of the row)').not.toContain(77);
    expect.soft(deepFind(again.results[1]?.value, 'feedbackDueHours'), 'and so does a read of the row as stored').not.toContain(77);
    expect.soft(deepFind(again.results[2]?.value, 'feedbackDueHours'), 'while the company itself reads version 2').toEqual([77]);
    expect.soft(num(lockOf(again.tables, ID.c2)?.['SLA_THRESHOLDS']), 'the old candidate\'s row never moves').toBe(1);
    // A candidate part-locked (one type) keeps that lock and gets the others at the active versions.
    const partWorld = clone(nextWorld.tables);
    const partRow = (partWorld[TABLE.state] ?? []).find((r) => (r['PK'] as any)?.S === `CANDIDATE#${ID.c1}` && (r['SK'] as any)?.S === 'SAGA')!;
    (partRow as any).settingVersions = { M: { SLA_THRESHOLDS: { N: '1' } } };
    const part = plain(partRow);
    const partial = settingsRun([{ fn: 'getRecruitmentSettings', args: [A, part] }], partWorld);
    const lp = lockOf(partial.tables, ID.c1);
    expect.soft([num(lp?.['SLA_THRESHOLDS']), num(lp?.['RETENTION'] ?? 1), num(lp?.['REJECTION_RULES'])], `a part-locked candidate keeps its one lock and gets the rest (${partial.results[0]?.ok ? JSON.stringify(lp) : partial.results[0]?.error?.message})`).toEqual([1, 1, 1]);
    expect.soft(partial.results[0]?.ok, `the part-locked read runs (${partial.results[0]?.error?.message ?? ''})`).toBe(true);
    expect.soft(deepFind(partial.results[0]?.value, 'feedbackDueHours'), 'its lock is read, not the active version').not.toContain(77);
    // Company B, with its own pack, never writes its versions onto a candidate of company A.
    const twoPacks = bothPacked();
    const foreign = settingsRun([{ fn: 'getRecruitmentSettings', args: [B, old] }], twoPacks);
    const lf = lockOf(foreign.tables, ID.c2);
    expect.soft(lf === undefined || Object.keys(lf).length === 0, 'getRecruitmentSettings(B, a candidate of A) writes no lock on that row').toBe(true);
    // A read for a company with no settings locks nothing and does not fail.
    const nothing = settingsRun([{ fn: 'getRecruitmentSettings', args: [B, plain((noSettings()[TABLE.state] ?? []).find((r) => (r['PK'] as any)?.S === `CANDIDATE#${ID.cb1}` && (r['SK'] as any)?.S === 'SAGA'))] }], noSettings());
    expect.soft(nothing.results[0]?.ok, 'a read for a company with no settings does not fail').toBe(true);
    expect.soft(Object.keys(lockOf(nothing.tables, ID.cb1) ?? {}).length, 'and locks nothing').toBe(0);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Read, not ignored: the Interview-to-Offer gate reads INTERVIEW_TYPES, captureSentiment reads SENTIMENT_SCALE, no old fixed list is left', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const base = packTables();
    const iv = (id: string, type: string, status: string) =>
      av({ PK: `CANDIDATE#${id}`, SK: `INTERVIEW#iv-${type}`, interviewId: `iv-${type}`, candidateId: id, tenant_id: A, tenantId: A, interviewType: type, status, scheduledAt: '2026-12-01T09:00:00.000Z', createdAt: '2026-11-10T08:00:00.000Z' });
    const world = (id: string, level: string, done: string[], pending: string[] = [], over: Tables = base): Tables => {
      const t = clone(over);
      t[TABLE.state]!.push(saga(id, 'Pia', 'Alpha', A, SUB.hmA, { positionLevel: level, currentStage: 'INTERVIEWING' }), ...done.map((x) => iv(id, x, 'COMPLETED')), ...pending.map((x) => iv(id, x, 'SCHEDULED')));
      return t;
    };
    const move = (t: Tables, id: string) => ask('advanceCandidateStage', C.recruiter, { method: 'PUT', path: { id }, body: { newStage: 'EVALUATION' } }, { tables: t });
    const stageOf = (r: { tables: Tables }, id: string) => sagaOf(r.tables, id)?.['currentStage'];

    // Per level, as the company's INTERVIEW_TYPES says.
    const cases: [string, string, string[], string[], number][] = [
      ['MID with the phone screen done and the technical interview not', 'MID', ['PHONE_SCREEN'], ['TECHNICAL'], 409],
      ['MID with both required types done', 'MID', ['PHONE_SCREEN', 'TECHNICAL'], [], 200],
      ['JUNIOR needs only the phone screen', 'JUNIOR', ['PHONE_SCREEN'], ['TECHNICAL'], 200],
      ['JUNIOR with no interview done', 'JUNIOR', [], ['PHONE_SCREEN'], 409],
      ['SENIOR with the behavioural interview missing', 'SENIOR', ['PHONE_SCREEN', 'TECHNICAL'], [], 409],
      ['SENIOR with all three done', 'SENIOR', ['PHONE_SCREEN', 'TECHNICAL', 'BEHAVIORAL'], [], 200],
    ];
    for (const [what, level, done, pending, want] of cases) {
      const id = `CAND-REC12-GATE-${level}-${done.length}${pending.length}`;
      const t = world(id, level, done, pending);
      const r = move(t, id);
      expect.soft(statusOf(r), `${what}: ${want} (${describe(r)})`).toBe(want);
      if (want === 409) {
        expect.soft(stageOf(r, id), `${what}: the candidate stays where it is`).toBe('INTERVIEWING');
        expect.soft(stateWrites(r).filter((c) => /SAGA/.test(JSON.stringify(c.input?.Key ?? '')) && /currentStage/.test(JSON.stringify(c.input))).length, `${what}: the stage is not written`).toBe(0);
      } else expect.soft(stageOf(r, id), `${what}: the candidate moves on`).toBe('EVALUATION');
    }
    // The company's own list decides: this one also wants FINAL for MID.
    const fin = clone(defaultOf('INTERVIEW_TYPES')); fin.requiredByLevel.MID = [...fin.requiredByLevel.MID, 'FINAL'];
    const stricter = save('INTERVIEW_TYPES', fin, base);
    expect(statusOf(stricter), `the company saves a stricter list (${describe(stricter)})`).toBe(200);
    const idF = 'CAND-REC12-GATE-FINAL';
    const needFinal = move(world(idF, 'MID', ['PHONE_SCREEN', 'TECHNICAL'], [], stricter.tables), idF);
    expect.soft(statusOf(needFinal), `MID is refused until FINAL is done, because the company says so (${describe(needFinal)})`).toBe(409);
    const idG = 'CAND-REC12-GATE-FINAL2';
    expect.soft(statusOf(move(world(idG, 'MID', ['PHONE_SCREEN', 'TECHNICAL', 'FINAL'], [], stricter.tables), idG)), 'and moves once FINAL is done').toBe(200);
    // Company A's list never decides for company B's candidate (B's caller, B's candidate, B has its own list).
    const twoPacks = bothPacked();
    const strictB = clone(defaultOf('INTERVIEW_TYPES')); strictB.requiredByLevel.MID = ['PHONE_SCREEN'];
    const bSaved = save('INTERVIEW_TYPES', strictB, twoPacks, {}, C.adminB);
    expect.soft(statusOf(bSaved), `company B saves a lighter list (${describe(bSaved)})`).toBe(200);
    const idB = 'CAND-REC12-GATE-B';
    const tB = clone(bSaved.tables);
    tB[TABLE.state]!.push(saga(idB, 'Bea', 'Bravo', B, SUB.hmB, { positionLevel: 'MID', currentStage: 'INTERVIEWING' }), iv(idB, 'PHONE_SCREEN', 'COMPLETED'));
    (tB[TABLE.state]![tB[TABLE.state]!.length - 1] as any).tenant_id = { S: B };
    tB[TABLE.state]!.splice(tB[TABLE.state]!.length - 2, 2,
      saga(idB, 'Bea', 'Bravo', B, SUB.hmB, { positionLevel: 'MID', currentStage: 'INTERVIEWING' }),
      av({ PK: `CANDIDATE#${idB}`, SK: 'INTERVIEW#iv-PHONE_SCREEN', interviewId: 'iv-PHONE_SCREEN', candidateId: idB, tenant_id: B, tenantId: B, interviewType: 'PHONE_SCREEN', status: 'COMPLETED', scheduledAt: '2026-12-01T09:00:00.000Z', createdAt: '2026-11-10T08:00:00.000Z' }));
    const lightB = ask('advanceCandidateStage', C.recruiterB, { method: 'PUT', path: { id: idB }, body: { newStage: 'EVALUATION' } }, { tables: tB });
    expect.soft(statusOf(lightB), `company B's own lighter list lets its MID candidate move (${describe(lightB)})`).toBe(200);

    // The moods are the company's own.
    const sentiment = (t: Tables, mood: unknown, id = ID.c1, caller: any = C.recruiter) => ask('captureSentiment', caller, { method: 'POST', path: { id }, body: { interviewSentiment: mood } }, { tables: t });
    for (const m of MOOD_KEYS) expect.soft(statusOf(sentiment(base, m)), `today's mood ${m} is accepted from the pack`).toBe(200);
    const scale = { moods: [{ key: 'KEEN', label: 'Keen', atRisk: false }, { key: 'COOL', label: 'Cool', atRisk: false }, { key: 'GONE', label: 'Gone', atRisk: true }] };
    const swapped = save('SENTIMENT_SCALE', scale, base);
    expect(statusOf(swapped), `the company saves its own three moods (${describe(swapped)})`).toBe(200);
    const kept = sentiment(swapped.tables, 'KEEN');
    expect.soft(statusOf(kept), `the company's own mood KEEN is accepted (${describe(kept)})`).toBe(200);
    expect.soft(sagaOf(kept.tables, ID.c1)?.['interviewSentiment'], 'and stored').toBe('KEEN');
    for (const [what, m] of [['a mood the company dropped', 'INTERESTED'], ['a lower-case mood', 'keen'], ['an empty mood', ''], ['a mood with a space', 'GONE '], ['a name every object has', 'constructor'], ['a number', 7]] as const) {
      const r = sentiment(swapped.tables, m);
      expect.soft(statusOf(r), `${what} is refused (${describe(r)})`).toBe(400);
      expect.soft(stateWrites(r).filter((c) => /interviewSentiment/.test(JSON.stringify(c.input))).length, `${what}: the mood is not written`).toBe(0);
    }

    // Text checks: the fixed lists and the old defaults are gone from the code.
    const sentimentCode = code(join(LAMBDA, 'captureSentiment', 'index.js'));
    for (const m of MOOD_KEYS) expect.soft(sentimentCode.includes(m), `captureSentiment/index.js no longer holds the mood ${m}`).toBe(false);
    const advanceCode = code(join(LAMBDA, 'advanceCandidateStage', 'index.js'));
    expect.soft(advanceCode.includes('interviewRequirements'), 'advanceCandidateStage/index.js no longer reads PANEL_CONFIG interviewRequirements').toBe(false);
    expect.soft(/recruitment-settings/.test(advanceCode), 'advanceCandidateStage reads the settings through recruitment-settings.mjs').toBe(true);
    expect.soft(/recruitment-settings/.test(sentimentCode), 'captureSentiment reads the settings through recruitment-settings.mjs').toBe(true);
    const readers = readdirSync(LAMBDA, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => (['config-reader.js', join('shared', 'config-reader.js')].map((f) => join(LAMBDA, d.name, f)))).concat(join(LAMBDA, 'shared', 'config-reader.js')).filter((f) => existsSync(f));
    expect.soft(readers.length, 'the config-reader.js copies are found').toBeGreaterThan(3);
    for (const f of readers) for (const old of ['minimumPassScore', 'strongNoVeto', 'votesRequired']) expect.soft(code(f).includes(old), `${f.slice(LAMBDA.length + 1)} holds no default ${old}`).toBe(false);
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 Templates: values are escaped, an unknown placeholder cannot be saved, a missing value renders empty', async ({}, testInfo) => {
    once(testInfo.project.name);
    const body = 'Hi {first_name}, {company} wants you for {role}. Due {due}.';
    const values = [
      { first_name: '<b>"Tom" & \'Jo\'</b>', company: 'Bake & Co', role: 'Baker' },
      { first_name: '{link}', company: 'X', role: 'Y', link: 'https://x.example/a' },
      { first_name: 'cost $$5 and $1', company: 'X', role: 'Y' },
      { first_name: null, company: undefined, role: 'Y', due: null },
      {},
      { company: 'C', role: 'R', candidate: 'N', first_name: 'F', date: 'D', due: 'U', link: 'L', expires: 'E', start_date: 'S' },
    ];
    const out = runModule([{ get: 'renderTemplate' }, ...values.map((v) => ({ fn: 'renderTemplate', args: [{ subject: 'About {candidate} at {company}', body }, v] }))].concat([
      { fn: 'renderTemplate', args: [{ body: PLACEHOLDERS.map((p) => `{${p}}`).join('|') + '|{company}'}, values[5]] } as any,
    ]), { tables: tables() });
    expect(out.importError, `recruitment-settings.mjs imports (${out.importError?.message ?? 'it does not exist yet'})`).toBeUndefined();
    expect.soft(out.exports, 'recruitment-settings.mjs exports renderTemplate').toContain('renderTemplate');
    const rendered = out.results.slice(1).map((r) => (r.ok ? (r.value as { subject?: string; body: string }) : undefined));
    const first = rendered[0]?.body ?? '';
    expect.soft(first.includes('<'), 'a "<" in a value never reaches the text').toBe(false);
    expect.soft(first.includes('"'), 'a double quote in a value never reaches the text').toBe(false);
    expect.soft(first.includes("'"), 'a single quote in a value never reaches the text').toBe(false);
    expect.soft(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(first), 'every "&" in a value is written as an entity').toBe(false);
    expect.soft(first.includes('Tom') && first.includes('Bake') && first.includes('Co'), 'the words of the values are still there').toBe(true);
    expect.soft(first.startsWith('Hi ') && first.includes(' wants you for Baker. Due .'), 'the template\'s own words are kept, and a missing {due} is empty').toBe(true);
    expect.soft(rendered[1]?.body, 'a value that looks like a placeholder is not filled in a second time').toContain('Hi {link},');
    expect.soft(rendered[2]?.body, 'dollar signs in a value come out as written ($$ and $1)').toContain('cost $$5 and $1');
    for (const [i, what] of [[3, 'null and undefined values'], [4, 'no values at all']] as const) {
      const text = `${rendered[i]?.subject ?? ''} ${rendered[i]?.body ?? ''}`;
      expect.soft(/undefined|null|NaN|\{[a-z_]+\}/.test(text), `${what}: no "undefined", "null" or leftover braces in the text`).toBe(false);
    }
    expect.soft(rendered[4]?.body, 'with no values every placeholder is empty').toBe('Hi ,  wants you for . Due .');
    expect.soft(rendered[4]?.subject, 'a subject is rendered the same way').toBe('About  at ');
    expect.soft(rendered[5]?.subject, 'a subject fills its placeholders').toBe('About N at C');
    expect.soft(rendered[6]?.body, 'all nine placeholders fill, and a repeated one fills each time').toBe('C|R|N|F|D|U|L|E|S|C');
    // Saving: an unknown placeholder cannot be saved (more cases in AC-1); the stored text is not changed by a refused save.
    const base = packTables();
    const bad = save('EMAIL_TEMPLATES', { ...defaultOf('EMAIL_TEMPLATES'), candidate_notice: { subject: 'Hi', body: 'Hello {first name}' } }, base);
    expect.soft([statusOf(bad), bodyOf(bad)], 'an unknown placeholder cannot be saved').toEqual([400, INVALID]);
    expect.soft(noChange(bad, base), 'and nothing is written').toBe(true);
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 No DEFAULT: company B reads only its own settings, and a company with none gets an empty read, not company A\'s', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const twoPacks = bothPacked();
    // Each company's own value.
    const a = save('RETENTION', { notHiredMonths: 17 }, twoPacks);
    const b = save('RETENTION', { notHiredMonths: 3 }, a.tables, {}, C.adminB);
    expect.soft([statusOf(a), statusOf(b)], 'each company saves its own retention').toEqual([200, 200]);
    expect.soft(bodyOf(readActive('RETENTION', b.tables, C.recruiterB))?.data, 'B reads 3').toEqual({ notHiredMonths: 3 });
    expect.soft(bodyOf(readActive('RETENTION', b.tables, C.recruiter))?.data, 'A reads 17').toEqual({ notHiredMonths: 17 });
    expect.soft(configRows(b.tables, B, 'RETENTION').map((r) => r['data']), 'B\'s versions are B\'s only').toEqual([{ notHiredMonths: 6 }, { notHiredMonths: 3 }]);
    expect.soft(configRows(b.tables, A, 'RETENTION').map((r) => r['data']), 'and A\'s are A\'s only').toEqual([{ notHiredMonths: 6 }, { notHiredMonths: 17 }]);
    // A company with no settings.
    const one = packTables();
    const bRead = readActive('RETENTION', one, C.recruiterB);
    expect.soft([statusOf(bRead), bodyOf(bRead)?.version ?? null, bodyOf(bRead)?.data], 'B with no settings reads an empty answer (200, no version, no data), not A\'s').toEqual([200, null, {}]);
    expect.soft(JSON.stringify(bodyOf(readActive('SENTIMENT_SCALE', one, C.recruiterB))).includes('INTERESTED'), 'and no mood scale of A\'s').toBe(false);
    const history = manage(C.recruiterB, 'GET', { query: { configType: 'RETENTION' } }, one);
    expect.soft(bodyOf(history)?.items ?? [], 'B\'s history read lists none of A\'s versions').toEqual([]);
    const viaBody = save('RETENTION', { notHiredMonths: 9 }, one, { tenantId: A, tenant_id: A }, C.adminB);
    expect.soft(configRows(viaBody.tables, A, 'RETENTION').length, 'B\'s admin naming A in the body writes nothing for A').toBe(1);
    expect.soft(configRows(viaBody.tables, B, 'RETENTION').length, 'the save lands under B').toBe(1);
    const empty = settingsRun([{ fn: 'getRecruitmentSettings', args: [B] }], one);
    const keys = ['notHiredMonths', 'screening', 'mode', 'levels', 'reasons', 'moods', 'requiredByLevel', 'defaultCriteria', 'rules'];
    expect.soft(keys.flatMap((k) => deepFind(empty.results[0]?.value, k)), 'getRecruitmentSettings for a company with none returns none of the pack\'s values (no defaults)').toEqual([]);
    // No run of any reader ever asks for a DEFAULT company.
    const runs = [
      readActive('RETENTION', one, C.recruiterB), bRead, history,
      make(one, 'idem-rec12-default-1', C.recruiterB), make(one, 'idem-rec12-default-2'),
      ask('captureSentiment', C.recruiterB, { method: 'POST', path: { id: ID.cb1 }, body: { interviewSentiment: 'INTERESTED' } }, { tables: one }),
      ask('advanceCandidateStage', C.recruiterB, { method: 'PUT', path: { id: ID.cb1 }, body: { newStage: 'INTERVIEWING' } }, { tables: one }),
    ];
    for (const r of runs) expect.soft(JSON.stringify(calls(r)).includes('DEFAULT'), 'no call names a DEFAULT company').toBe(false);
    for (const f of [join(LAMBDA, 'shared', 'recruitment-settings.mjs'), join(LAMBDA, 'shared', 'config-reader.js')]) {
      expect.soft(existsSync(f) && /['"`]DEFAULT['"`]/.test(code(f)), `${f.slice(LAMBDA.length + 1)} names no DEFAULT company`).toBe(false);
    }
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 The Standard pack: every type at version 1, the approved texts exactly, nothing overwritten, a failure leaves a state a re-run finishes', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(8 * 60_000);
    const start = noSettings();
    const r = runPack(B, 'dev', { tables: start });
    expect(r.code, `the pack runs for B (${(r.stdout + r.stderr).slice(-400)})`).toBe(0);
    const rowsFor = (t: Tables, type: string) => configRows(t, B, type);
    const data = (type: SettingType) => activeRow(r.tables, B, type)?.['data'] as any;
    for (const type of TYPES) {
      const rows = rowsFor(r.tables, type);
      expect.soft(rows.map((x) => x['version']), `${type}: version 1 and only version 1`).toEqual([1]);
      expect.soft([rows[0]?.['isActive'], rows[0]?.['GSI1PK'], rows[0]?.['GSI1SK'], rows[0]?.['tenant_id']], `${type}: active, in the active index, stamped with B`).toEqual([true, `TENANT#${B}#ACTIVE`, `CONFIG#${type}`, B]);
    }
    const types = [...new Set(rowsOf(r.tables, CONFIG).filter((x) => x['tenant_id'] === B).map((x) => x['configType']).filter(Boolean))].sort();
    expect.soft(types, 'exactly the twelve types are written (no WORKFLOW_TEMPLATES, no offer_letter type)').toEqual([...TYPES].sort());
    expect.soft(rowsOf(r.tables, CONFIG).filter((x) => x['tenant_id'] !== B).length, 'nothing is written for another company').toBe(0);
    expect.soft(data('STAGE_CONFIG'), 'STAGE_CONFIG: Screening on').toEqual({ screening: true });
    const levels = data('SENIORITY_PROFILES')?.levels ?? [];
    expect.soft(levels.map((l: any) => l.key), 'SENIORITY_PROFILES: today\'s three levels').toEqual([...LEVELS]);
    expect.soft(levels.every((l: any, i: number) => typeof l.label === 'string' && l.label && typeof l.order === 'number' && (i === 0 || l.order > levels[i - 1].order) && Object.keys(l).sort().join() === 'key,label,order'), 'each level has a key, a label and a rising order').toBe(true);
    const it = data('INTERVIEW_TYPES');
    expect.soft((it?.types ?? []).map((x: any) => x.key).sort(), 'INTERVIEW_TYPES: today\'s five types').toEqual([...INTERVIEW_TYPE_KEYS].sort());
    expect.soft((it?.types ?? []).every((x: any) => typeof x.label === 'string' && x.label && typeof x.optional === 'boolean'), 'each type has a label and an optional flag').toBe(true);
    expect.soft(Object.fromEntries(Object.entries(it?.requiredByLevel ?? {}).map(([k, v]) => [k, [...(v as string[])].sort()])), 'INTERVIEW_TYPES: today\'s required lists, copied exactly').toEqual(Object.fromEntries(Object.entries(REQUIRED_BY_LEVEL).map(([k, v]) => [k, [...v].sort()])));
    const sw = data('SCORING_WEIGHTS');
    expect.soft([sw?.scale, sw?.weights], 'SCORING_WEIGHTS: scale 1 to 5, weights null').toEqual([{ min: 1, max: 5 }, null]);
    expect.soft((sw?.defaultCriteria ?? []).map((x: any) => x.key), 'SCORING_WEIGHTS: today\'s four criteria').toEqual(CRITERIA_KEYS);
    expect.soft((sw?.defaultCriteria ?? []).every((x: any) => typeof x.label === 'string' && x.label), 'each with its label').toBe(true);
    expect.soft(data('REJECTION_RULES'), 'REJECTION_RULES: the card\'s defaults, nothing else').toEqual({
      decider: Object.fromEntries(LEVELS.map((l) => [l, 'HR_OR_HM'])), reasons: REASONS, secondConfirmation: Object.fromEntries(LEVELS.map((l) => [l, false])), reviewVoteLevel: 'STRONG_NO', reviewBelowScore: null,
    });
    expect.soft(data('APPROVAL_RULES'), 'APPROVAL_RULES: one approver').toEqual({ mode: 'ONE_APPROVER' });
    const sla = data('SLA_THRESHOLDS');
    expect.soft(deepFind(sla, 'interviewMissedAfterHours'), 'SLA_THRESHOLDS: interviewMissedAfterHours is 24').toEqual([24]);
    expect.soft(['feedbackDueHours', 'offerExpiryWarningDays'].map((k) => deepFind(sla, k).every((v) => typeof v === 'number' && v > 0) && deepFind(sla, k).length === 1), 'feedbackDueHours and offerExpiryWarningDays are set').toEqual([true, true]);
    const moods = data('SENTIMENT_SCALE')?.moods ?? [];
    expect.soft(moods.map((m: any) => m.key), 'SENTIMENT_SCALE: today\'s five moods').toEqual(MOOD_KEYS);
    expect.soft(moods.filter((m: any) => m.atRisk === true).map((m: any) => m.key), 'at risk exactly for the two the notification rule watches').toEqual(AT_RISK_MOODS);
    expect.soft(moods.every((m: any) => typeof m.atRisk === 'boolean' && typeof m.label === 'string' && m.label), 'each mood has a label').toBe(true);
    const templates = data('EMAIL_TEMPLATES');
    expect.soft(templates, 'EMAIL_TEMPLATES: the approved texts of groups C, D and G, word for word, and no offer_letter').toEqual(TEMPLATE_TEXTS);
    expect.soft(Array.isArray(data('INTELLIGENCE_RULES')?.rules), 'INTELLIGENCE_RULES: version 1 holds a rules list (REC-09 fills it)').toBe(true);
    expect.soft(data('PANEL_CONFIG') && typeof data('PANEL_CONFIG') === 'object', 'PANEL_CONFIG: version 1 is there').toBe(true);
    expect.soft(data('RETENTION'), 'RETENTION: 6 months').toEqual({ notHiredMonths: 6 });
    const everything = JSON.stringify(rowsOf(r.tables, CONFIG).filter((x) => x['tenant_id'] === B).map((x) => x['data']));
    for (const gone of ['minimumPassScore', 'strongNoVeto', 'DEFAULT', 'undefined']) expect.soft(everything.includes(gone), `no pack value holds "${gone}"`).toBe(false);

    // How it writes: only through transactions of at most 25, each put conditional, never a delete.
    const conf = (r.calls as any[]).filter((c) => c.service === 'dynamodb' && STATE_WRITE.test(c.op) && c.table !== TENANTS && !/tenants$/.test(String(c.table ?? '')));
    const txs = (r.calls as any[]).filter((c) => c.service === 'dynamodb' && c.op === 'TransactWriteItems');
    expect.soft(conf.every((c) => c.op === 'TransactWriteItems'), 'every write goes through TransactWriteItems (all or none)').toBe(true);
    expect.soft(txs.every((c) => c.input.TransactItems.length <= 25), 'with at most 25 items in one transaction').toBe(true);
    const items = txs.flatMap((c) => c.input.TransactItems as any[]);
    expect.soft(items.length > 0 && items.every((i) => i.Put && String(i.Put.ConditionExpression ?? '').includes('attribute_not_exists')), 'every item is a Put that fails if the row exists (never overwrites)').toBe(true);
    expect.soft(JSON.stringify(r.calls).includes('"Delete"') || JSON.stringify(r.calls).includes('DeleteItem'), 'nothing is deleted').toBe(false);
    expect.soft(otherRows(r.tables, B).length, 'a completion marker row is written, for company B').toBe(1);
    const said = r.stdout + r.stderr;
    expect.soft(said.includes('@') || said.includes(STANDARD_PACK_LINE) || /Bontle|Mokoena|Dube/.test(said), 'the output holds no address, no company name and no "not available yet" line').toBe(false);

    // A second run changes nothing.
    const second = runPack(B, 'dev', { tables: r.tables });
    expect.soft(second.code, 'a second apply exits 0').toBe(0);
    expect.soft(second.writes.length, 'and writes nothing').toBe(0);
    expect.soft(JSON.stringify(second.tables) === JSON.stringify(r.tables), 'and changes nothing').toBe(true);

    // A company that has a setting keeps it, version and all (a custom SLA_THRESHOLDS at version 3, a RETENTION of 12).
    const custom = (type: string, version: number, active: boolean, d: unknown) => av({ PK: `TENANT#${B}`, SK: `CONFIG#${type}#v${version}`, ...(active ? { GSI1PK: `TENANT#${B}#ACTIVE`, GSI1SK: `CONFIG#${type}` } : {}), tenant_id: B, tenantId: B, configType: type, version, isActive: active, data: d as any, createdAt: '2026-01-01T00:00:00.000Z' });
    const had = noSettings();
    had[CONFIG]!.push(custom('SLA_THRESHOLDS', 1, false, { x: 1 }), custom('SLA_THRESHOLDS', 2, false, { x: 2 }), custom('SLA_THRESHOLDS', 3, true, { feedbackDueHours: 99, own: 'kept' }), custom('RETENTION', 1, true, { notHiredMonths: 12 }));
    const kept = runPack(B, 'dev', { tables: had });
    expect.soft(kept.code, 'a company with settings of its own: the pack runs').toBe(0);
    expect.soft(configRows(kept.tables, B, 'SLA_THRESHOLDS').map((x) => [x['version'], x['data']]), 'its three SLA_THRESHOLDS versions are as they were (no version 4, no new version 1)').toEqual([[1, { x: 1 }], [2, { x: 2 }], [3, { feedbackDueHours: 99, own: 'kept' }]]);
    expect.soft(configRows(kept.tables, B, 'RETENTION').map((x) => x['data']), 'its RETENTION of 12 is kept').toEqual([{ notHiredMonths: 12 }]);
    expect.soft(configRows(kept.tables, B, 'REJECTION_RULES').length, 'and what it lacked is written').toBe(1);
    expect.soft(TYPES.every((t) => configRows(kept.tables, B, t).length >= 1), 'every type is there at the end').toBe(true);

    // A failure at any transaction leaves a state a re-run finishes; nothing is doubled.
    let batches = 0;
    for (let k = 1; k <= 6; k++) {
      const failed = runPack(B, 'dev', { tables: noSettings(), fail: { service: 'dynamodb', ops: ['TransactWriteItems'], message: 'InternalServerError: DynamoDB is unavailable', nth: k } });
      if (failed.code === 0) { batches = k - 1; break; }
      if (k === 1) {
        expect.soft(rowsOf(failed.tables, CONFIG).filter((x) => x['tenant_id'] === B).length, 'a failure of the first transaction leaves nothing half-written').toBe(0);
        expect.soft(otherRows(failed.tables, B).length, 'and no completion marker').toBe(0);
      }
      const finished = runPack(B, 'dev', { tables: failed.tables });
      expect.soft(finished.code, `failure at transaction ${k}: the re-run exits 0 (${(finished.stdout + finished.stderr).slice(-200)})`).toBe(0);
      expect.soft(TYPES.map((t) => configRows(finished.tables, B, t).map((x) => x['version'])), `failure at transaction ${k}: after the re-run every type has exactly version 1`).toEqual(TYPES.map(() => [1]));
      for (const t of TYPES) {
        const before = configRows(failed.tables, B, t)[0];
        if (before) expect.soft(configRows(finished.tables, B, t)[0], `failure at transaction ${k}: ${t}, written before the failure, is not rewritten`).toEqual(before);
      }
      expect.soft(otherRows(finished.tables, B).length, `failure at transaction ${k}: one completion marker after the re-run`).toBe(1);
    }
    expect.soft(batches, 'the pack makes at least one and fewer than six transactions').toBeGreaterThanOrEqual(1);
    const unreadable = runPack(B, 'dev', { tables: noSettings(), fail: { service: 'dynamodb', ops: ['Query', 'GetItem'], message: 'InternalServerError: DynamoDB is unavailable' } });
    expect.soft(unreadable.code, 'when the existing settings cannot be read the pack stops with a failure').not.toBe(0);
    expect.soft(rowsOf(unreadable.tables, CONFIG).length, 'and writes nothing (it never guesses what is missing)').toBe(0);

    // Through MOD-01's script: the line is gone, prod is allowed, a failing pack stops the switch-on.
    // B starts with Onboarding only, so Recruitment is switched on by this run.
    const company = () => [...companyRows().filter((x) => (x['pk'] as any)?.S !== `TENANT#${B}` || (x['sk'] as any)?.S !== 'PROFILE'), av({ pk: `TENANT#${B}`, sk: 'PROFILE', tenant_id: B, name: 'Company B', status: 'ACTIVE', country: 'ZA', created_at: '2026-11-16T00:00:00Z', modules: new Set(['onboarding']) }), av({ pk: `USER#${SUB.hmB}`, sk: `TENANT#${B}`, tenant_id: B })];
    const world = (): Tables => ({ ...noSettings(), [TENANTS]: company(), [TENANTS_PROD]: company() });
    const script = join(REPO, 'scripts', 'tenancy', 'set-modules.mjs');
    const onB = ['--tenant', B, '--on', 'recruitment', '--reason', 'REC-12 AC-7', '--apply'];
    const dev = runScript(script, ['--env', 'dev', ...onB], { tables: world(), sts: DEV_STS });
    expect.soft(dev.code, `set-modules --apply turns Recruitment on for B and runs the pack (${(dev.stdout + dev.stderr).slice(-300)})`).toBe(0);
    expect.soft((dev.stdout + dev.stderr).includes(STANDARD_PACK_LINE) || /not available yet/.test(dev.stdout + dev.stderr), 'it no longer prints the "not available yet" line').toBe(false);
    expect.soft(TYPES.every((t) => configRows(dev.tables, B, t).length === 1), 'B now holds every type at version 1').toBe(true);
    const prod = runScript(script, ['--env', 'prod', ...onB], { tables: world(), sts: PROD_STS });
    expect.soft(prod.code, `prod is allowed to switch Recruitment on now (${(prod.stdout + prod.stderr).slice(-300)})`).toBe(0);
    expect.soft(TYPES.every((t) => configRows(prod.tables, B, t).length === 1), 'and the pack is written there').toBe(true);
    const stopped = runScript(script, ['--env', 'dev', ...onB], { tables: world(), sts: DEV_STS, fail: { service: 'dynamodb', ops: ['TransactWriteItems'], message: 'InternalServerError: DynamoDB is unavailable', nth: 1 } });
    expect.soft(stopped.code, 'a pack that fails stops the switch-on').not.toBe(0);
    const prof = rowsOf(stopped.tables, TENANTS).find((x) => x['pk'] === `TENANT#${B}` && x['sk'] === 'PROFILE');
    expect.soft(JSON.stringify(prof?.['modules']), 'B keeps its modules').toBe(JSON.stringify(['onboarding']));
    expect.soft(rowsOf(stopped.tables, TENANTS).filter((x) => String(x['sk']).startsWith('MODULES#')).length, 'and no audit row is written').toBe(0);

    // Dev company data comes from the same pack, never from Terraform.
    const seedDev = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    expect.soft(/module-seeds|set-modules|recruitment\.mjs/.test(seedDev), 'seed-dev.py calls the pack (module-seeds/recruitment.mjs) for company A').toBe(true);
    expect.soft(seedDev.includes('Your feedback on'), 'and holds no copy of the pack\'s texts').toBe(false);
    const tf = readTf('infra') + '\n' + readTf('talent-flow-infra');
    expect.soft(/aws_dynamodb_table_item/.test(tf), 'no Terraform file writes a table row').toBe(false);
    expect.soft(/CONFIG#[A-Z_]+#v1/.test(tf), 'no Terraform file holds a settings row').toBe(false);
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Roles and text checks: Admin only saves, a Recruiter reads, an Employee is refused; the roles hold exactly the grants the new reads and writes need', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const base = packTables();
    const valid = { notHiredMonths: 9 };
    // Who may read (Recruiter or Admin) and who may save (Admin).
    for (const [c, read, write] of [
      [C.recruiter, 200, 403], [C.adminOnly, 200, 200], [C.adminHr, 200, 200], [C.employee, 403, 403], [C.guest, 403, 403], [C.hrNoTick, 403, 403], [C.noGroups, 403, 403], [C.itOnly, 403, 403], [C.hmC1, 403, 403], [C.taClaim, 403, 403],
    ] as const) {
      const rd = readActive('RETENTION', base, c);
      expect.soft(statusOf(rd), `${c.name} reads: ${read} (${describe(rd)})`).toBe(read);
      if (read === 403) expect.soft(bodyOf(rd), `${c.name} reads: { "error": "Forbidden" }`).toEqual(FORBIDDEN);
      const wr = save('RETENTION', valid, base, {}, c);
      expect.soft(statusOf(wr), `${c.name} saves: ${write} (${describe(wr)})`).toBe(write);
      if (write === 403) {
        expect.soft(bodyOf(wr), `${c.name} saves: { "error": "Forbidden" }`).toEqual(FORBIDDEN);
        expect.soft(noChange(wr, base), `${c.name} saves: nothing is written`).toBe(true);
      }
    }
    // The role answer comes before the check of the data: a recruiter sending rubbish learns nothing about the shape.
    const rubbish = save('RETENTION', { notHiredMonths: 0 }, base, {}, C.recruiter);
    expect.soft([statusOf(rubbish), bodyOf(rubbish)], 'a recruiter saving invalid data gets 403, not 400').toEqual([403, FORBIDDEN]);
    const rubbishCreate = create('RETENTION', { notHiredMonths: 0 }, noSettings(), C.employee);
    expect.soft(statusOf(rubbishCreate), 'an employee creating invalid data gets 403, not 400').toBe(403);
    // The other company's admin saves under their own company only; a Recruiter of B cannot save either.
    expect.soft(statusOf(save('RETENTION', valid, bothPacked(), {}, C.recruiterB)), 'a recruiter of B cannot save').toBe(403);
    expect.soft(configRows(save('RETENTION', valid, bothPacked(), {}, C.adminB).tables, A, 'RETENTION').length, 'B\'s admin saving leaves A\'s versions alone').toBe(1);

    // Rule 1: the shared stage file, and that the settings file uses it.
    expect.soft(existsSync(STAGES_FILE), 'lambda/shared/recruitment-stages.mjs exists').toBe(true);
    const stages = runModule([], { module: STAGES_FILE, tables: tables() });
    expect.soft(stages.importError, `recruitment-stages.mjs imports (${stages.importError?.message ?? ''})`).toBeUndefined();
    const exported = stages.exports.length ? runModule(stages.exports.map((n) => ({ get: n })), { module: STAGES_FILE, tables: tables() }).results.map((x) => x.value) : [];
    const holdsSix = exported.some((v) => Array.isArray(v) ? JSON.stringify(v) === JSON.stringify(STAGE_CODES) : v && typeof v === 'object' && JSON.stringify(Object.values(v)) === JSON.stringify(STAGE_CODES));
    expect.soft(holdsSix, 'it exports the six stage codes, in order: APPLIED, SCREENING, INTERVIEW, OFFER, HIRED, NOT_HIRED').toBe(true);
    const settingsFile = join(LAMBDA, 'shared', 'recruitment-settings.mjs');
    expect.soft(existsSync(settingsFile) && /recruitment-stages/.test(code(settingsFile)), 'recruitment-settings.mjs imports the stage file (the five stages that are always on come from it)').toBe(true);
    expect.soft(existsSync(settingsFile) && /\b(APPLIED|NOT_HIRED)\b/.test(code(settingsFile).replace(/^.*recruitment-stages.*$/gm, '')), 'and does not spell the stage codes again').toBe(false);

    // Roles (Terraform read as text): the settings API writes, the readers read, nothing is wider than that.
    const grants = policyLines();
    const grantsOf = (fn: string) => lambdaNamed(fn).flatMap(({ stack, block }) => {
      const role = roleResourceOf(block);
      return Object.values(grants).filter((g) => g.stack === stack && g.role === role).flatMap((g) => g.pairs ?? [g.squash ?? '']);
    });
    const onConfig = (pairs: string[]) => pairs.filter((p) => /tf_table_config|talent_flow_config|talent-flow-config/.test(p));
    const actions = (pairs: string[]) => pairs.map((p) => p.split(' ')[1] ?? '');
    const manageGrants = grantsOf('manageTalentFlowConfig');
    expect.soft(manageGrants.length, 'manageTalentFlowConfig has a role policy in Terraform').toBeGreaterThan(0);
    const manageActions = new Set(actions(onConfig(manageGrants).filter((p) => p.startsWith('Allow'))));
    expect.soft([...manageActions].filter((x) => !['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem'].includes(x)), 'on the config table it holds nothing beyond GetItem, Query, PutItem, UpdateItem').toEqual([]);
    expect.soft(['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'].filter((x) => !manageActions.has(x)), 'and it holds PutItem (versions and the audit row), UpdateItem (the old version) and Query').toEqual([]);
    expect.soft(manageGrants.filter((p) => /dynamodb:\*|dynamodb:Delete|dynamodb:Scan/.test(p) || (/dynamodb:/.test(p) && / \*( |$)/.test(p.replace(/^(\S+) (\S+) /, '$1 $2 ') ) && /^Allow dynamodb:\S+ \*/.test(p))), 'no wildcard action and no delete or scan on any table').toEqual([]);
    const importers = readdirSync(LAMBDA, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).filter((name) => ['index.js', 'index.mjs'].some((f) => { const p = join(LAMBDA, name, f); return existsSync(p) && /recruitment-settings/.test(code(p)); }));
    const readers = [...new Set(['createCandidate', 'captureSentiment', 'advanceCandidateStage', ...importers])];
    for (const name of ['createCandidate', 'captureSentiment', 'advanceCandidateStage']) expect.soft(importers.includes(name), `${name} reads settings through recruitment-settings.mjs`).toBe(true);
    for (const name of readers) {
      const pairs = grantsOf(name);
      const cfg = actions(onConfig(pairs).filter((p) => p.startsWith('Allow')));
      expect.soft(['dynamodb:GetItem', 'dynamodb:Query'].filter((x) => !cfg.includes(x)), `${name}: its role may GetItem and Query the config table`).toEqual([]);
      expect.soft(onConfig(pairs).some((p) => /index\/(\*|GSI1-active-configs)/.test(p) && /Query/.test(p)), `${name}: and Query its active index`).toBe(true);
      expect.soft(pairs.some((p) => (p.startsWith('Allow kms:Decrypt') || (p.startsWith('Allow local.tf_kms_actions') && /tf_kms_actions\s*=\s*\[[^\]]*"kms:Decrypt"/.test(readTf('talent-flow-infra')))) && /talent_flow_state/.test(p)), `${name}: and decrypt with the key the config table is encrypted with (talent_flow_state)`).toBe(true);
      expect.soft(pairs.filter((p) => /^Allow dynamodb:\* |^Allow \* /.test(p)), `${name}: no wildcard action`).toEqual([]);
      // The state table: what the code does to the candidate's row, the role may do (captureSentiment read the row with no grant before this card).
      const onState = actions(pairs.filter((p) => p.startsWith('Allow') && /tf_table_state\b|aws_dynamodb_table\.talent_flow_state\.arn/.test(p)));
      const needState: Record<string, string[]> = { createCandidate: ['dynamodb:PutItem'], captureSentiment: ['dynamodb:GetItem', 'dynamodb:UpdateItem'], advanceCandidateStage: ['dynamodb:GetItem', 'dynamodb:UpdateItem'] };
      expect.soft((needState[name] ?? []).filter((x) => !onState.includes(x)), `${name}: its role holds what the code does on the candidate's row (the state table)`).toEqual([]);
      const env = lambdaNamed(name).map(({ block }) => block.body.replace(/\s+/g, ''));
      expect.soft(env.length > 0 && env.every((b) => /CONFIG_TABLE_NAME=/.test(b)), `${name}: CONFIG_TABLE_NAME is one of its settings (it reads the config table)`).toBe(true);
    }
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 The test logins on pepla-dev: an Admin saves a Time limits change, a candidate made before keeps version 1, a Recruiter is refused, company B has the pack @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1 to AC-8.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(8 * 60_000);
    const env = (k: string) => process.env[k] ?? '';
    const login = (p: string) => ({ email: env(`${p}_EMAIL`), password: env(`${p}_PASSWORD`) });
    const logins = { admin: login('E2E_TF'), recruiter: login('E2E_HR'), companyB: login('E2E_HR_B') };
    for (const [who, l] of Object.entries(logins)) expect(l.email && l.password, `the ${who} test login is set (E2E_${who === 'admin' ? 'TF' : who === 'recruiter' ? 'HR' : 'HR_B'}_EMAIL and _PASSWORD)`).toBeTruthy();
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
    const call = async (token: string, method: string, path: string, body?: unknown) =>
      page.request.fetch(`${tfApi}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { data: JSON.stringify(body) }) });
    const active = async (token: string, type: string) => { const r = await call(token, 'GET', `/v1/config?configType=${type}&active=true`); expect(r.status(), `GET ${type} answers 200`).toBe(200); return (await r.json()) as { version: number | null; data: any }; };

    const adminToken = await signIn(logins.admin);
    const recruiterToken = await signIn(logins.recruiter);
    // A candidate made before the save: locked to the versions that are active now.
    const made = await call(recruiterToken, 'POST', '/v1/candidates', newCandidate(`rec12-${Date.now()}`, 'SENIOR'));
    expect(made.status(), 'a recruiter creates a candidate (this reads the settings through the real role and key)').toBe(201);
    const candidateId = ((await made.json()) as any).candidateId as string;
    const lockOf = async () => { const r = await call(recruiterToken, 'GET', `/v1/candidates/${candidateId}`); expect(r.status(), 'the recruiter reads the candidate').toBe(200); const b = (await r.json()) as any; return (b.settingVersions ?? b.candidate?.settingVersions) as Record<string, unknown>; };
    const before = await active(adminToken, 'SLA_THRESHOLDS');
    expect(before.version, 'company A has Time limits (the Standard pack from the dev seed)').not.toBeNull();
    expect((await lockOf())?.['SLA_THRESHOLDS'], 'the new candidate is locked to the Time limits version that was active').toBe(before.version);
    // The Admin changes Time limits; the version moves by one; the candidate does not.
    const changed = JSON.parse(JSON.stringify(before.data));
    const feed = deepFind(changed, 'feedbackDueHours')[0];
    expect(typeof feed === 'number', 'Time limits hold feedbackDueHours').toBe(true);
    setDeep(changed, 'feedbackDueHours', (feed as number) === 31 ? 32 : 31);
    const saved = await call(adminToken, 'PUT', '/v1/config/SLA_THRESHOLDS', { configType: 'SLA_THRESHOLDS', data: changed, expected_version: before.version });
    expect(saved.status(), `the Admin saves a Time limits change (${await saved.text()})`).toBe(200);
    // The active version is read through an index that can lag a moment behind the save.
    await expect.poll(async () => (await active(adminToken, 'SLA_THRESHOLDS')).version, { message: 'the Admin reads the next version', timeout: 30_000, intervals: [1_000, 2_000, 3_000] }).toBe((before.version as number) + 1);
    const after = await active(adminToken, 'SLA_THRESHOLDS');
    expect(after.version, 'the Admin reads the next version').toBe((before.version as number) + 1);
    expect(deepFind(after.data, 'feedbackDueHours'), 'holding the change').toEqual(deepFind(changed, 'feedbackDueHours'));
    expect((await lockOf())?.['SLA_THRESHOLDS'], 'the candidate made before the save keeps the version it had').toBe(before.version);
    const stale = await call(adminToken, 'PUT', '/v1/config/SLA_THRESHOLDS', { configType: 'SLA_THRESHOLDS', data: changed, expected_version: before.version });
    expect([stale.status(), await stale.json()], 'a save with the old expected_version is 409 STALE_VERSION').toEqual([409, STALE]);
    const bad = await call(adminToken, 'PUT', '/v1/config/RETENTION', { configType: 'RETENTION', data: { notHiredMonths: 0 } });
    expect([bad.status(), await bad.json()], 'an invalid save is 400 INVALID_SETTING').toEqual([400, INVALID]);
    // The Recruiter reads and is refused a save.
    expect((await active(recruiterToken, 'SLA_THRESHOLDS')).version, 'the Recruiter reads Time limits').toBe(after.version);
    const refused = await call(recruiterToken, 'PUT', '/v1/config/SLA_THRESHOLDS', { configType: 'SLA_THRESHOLDS', data: changed });
    expect([refused.status(), await refused.json()], 'the Recruiter\'s save is 403').toEqual([403, FORBIDDEN]);
    // The other readers work with the real roles and the key: a sentiment, and the gate leaving the interview stage.
    const sentiment = await call(recruiterToken, 'POST', `/v1/candidates/${candidateId}/sentiment`, { interviewSentiment: 'INTERESTED' });
    expect(sentiment.status(), 'captureSentiment reads SENTIMENT_SCALE on dev').toBe(200);
    const toInterview = await call(recruiterToken, 'PUT', `/v1/candidates/${candidateId}/stage`, { newStage: 'INTERVIEWING' });
    expect(toInterview.status(), 'the candidate moves to the interview stage').toBe(200);
    const gate = await call(recruiterToken, 'PUT', `/v1/candidates/${candidateId}/stage`, { newStage: 'EVALUATION' });
    expect(gate.status(), 'the gate reads INTERVIEW_TYPES on dev and refuses a SENIOR candidate with no interview done (409, not 500)').toBe(409);
    // Company B starts with Onboarding only (MOD-01 AC-10 expects that). Switch Recruitment on for it with the MOD-01 script, which also
    // writes the Standard pack, wait out the 60 second module cache, read RETENTION, and always put B back.
    const bToken = await signIn(logins.companyB);
    const companyB = String(JSON.parse(Buffer.from(bToken.split('.')[1]!, 'base64url').toString('utf8'))['tenant_id'] ?? '');
    expect(companyB, 'company B\'s login carries its company').toMatch(/^ten_[0-9a-z]{26}$/);
    const script = (args: string[]) => spawnSync(process.execPath, [join(REPO, 'scripts', 'tenancy', 'set-modules.mjs'), '--env', 'dev', '--tenant', companyB, ...args], { cwd: REPO, encoding: 'utf8', timeout: 120_000, env: process.env });
    try {
      const on = script(['--on', 'recruitment', '--reason', 'REC-12 AC-9 pepla-dev check', '--apply']);
      expect(on.status, `set-modules --apply turns Recruitment on for B (${(on.stdout + on.stderr).slice(-300)})`).toBe(0);
      await expect.poll(async () => (await call(bToken, 'GET', '/v1/config?configType=RETENTION&active=true')).status(), { message: 'company B reads its settings within the module cache time', timeout: 120_000, intervals: [5_000] }).toBe(200);
      const b = (await (await call(bToken, 'GET', '/v1/config?configType=RETENTION&active=true')).json()) as { version: number | null; data: any };
      expect([b.version, b.data], 'company B received the Standard pack: RETENTION version 1, 6 months').toEqual([1, { notHiredMonths: 6 }]);
    } finally {
      const off = script(['--off', 'recruitment', '--reason', 'REC-12 AC-9 put back', '--apply']);
      expect(off.status, `set-modules --apply puts B back to onboarding only (${(off.stdout + off.stderr).slice(-300)})`).toBe(0);
    }
  });
});
