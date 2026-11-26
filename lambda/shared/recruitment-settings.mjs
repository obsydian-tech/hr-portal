// REC-12: the shape, defaults and validator of every Recruitment setting, the one reader (getRecruitmentSettings) that gives
// a candidate the versions it is locked to, and the template renderer. Pure data in, plain objects out; no company ever
// comes from a request here, only from the caller's own sign-in (TEN-03).
import { STAGE_CODES, normaliseStage } from './recruitment-stages.mjs';

export const TYPES = ['STAGE_CONFIG', 'SENIORITY_PROFILES', 'INTERVIEW_TYPES', 'PANEL_CONFIG', 'SCORING_WEIGHTS', 'REJECTION_RULES', 'APPROVAL_RULES', 'SLA_THRESHOLDS', 'SENTIMENT_SCALE', 'EMAIL_TEMPLATES', 'INTELLIGENCE_RULES', 'RETENTION'];
export const LOCK_TYPES = TYPES.filter((t) => t !== 'RETENTION');
export const REASONS = ['NOT_RIGHT_SKILLS', 'NOT_RIGHT_EXPERIENCE', 'CHOSE_ANOTHER', 'WITHDREW', 'SALARY_MISMATCH', 'DID_NOT_ATTEND', 'ROLE_CLOSED', 'OTHER'];
export const PLACEHOLDERS = ['company', 'role', 'candidate', 'first_name', 'date', 'due', 'link', 'expires', 'start_date'];

export const TEMPLATE_TEXTS = {
  interviewer_reminder: { subject: 'Your feedback on {candidate} is due', body: 'You interviewed {candidate} for {role} on {date}. Your feedback is due {due}. Open: {link}' },
  candidate_notice: { subject: 'Your application at {company}', body: '{company} has added your details to apply for {role}. We keep your name, contact details, CV and interview notes to run this application. If you are not hired, they are removed after 6 months. To see, correct or remove your details, reply to this email.' },
  candidate_check_in: { body: 'Hi {first_name}, checking in on your application for {role} at {company}. Is there anything you need from us before the next step?' },
  offer_follow_up: { body: 'Hi {first_name}, a reminder that your offer for {role} expires on {date}. Let me know if you have any questions.' },
};

const LEVELS = ['JUNIOR', 'MID', 'SENIOR'];
// Hours a candidate may sit in each open stage (the longest of the old stages that now make up each one).
const [S_FIRST, S_SECOND, S_THIRD, S_FOURTH] = STAGE_CODES;
const LEGACY_SLA = { [S_FIRST]: 24, [S_SECOND]: 48, [S_THIRD]: 96, [S_FOURTH]: 72 };
const byLevel = (v) => Object.fromEntries(LEVELS.map((l) => [l, v]));
export const DEFAULTS = {
  STAGE_CONFIG: { screening: true },
  SENIORITY_PROFILES: { levels: LEVELS.map((key, i) => ({ key, label: key[0] + key.slice(1).toLowerCase(), order: i + 1 })) },
  INTERVIEW_TYPES: {
    types: [['PHONE_SCREEN', 'Phone Screen'], ['TECHNICAL', 'Technical'], ['BEHAVIORAL', 'Behavioral'], ['CULTURE_FIT', 'Culture Fit'], ['FINAL', 'Final']].map(([key, label]) => ({ key, label, optional: false })),
    requiredByLevel: { JUNIOR: ['PHONE_SCREEN'], MID: ['PHONE_SCREEN', 'TECHNICAL'], SENIOR: ['PHONE_SCREEN', 'TECHNICAL', 'BEHAVIORAL'] },
  },
  PANEL_CONFIG: { panelSize: { JUNIOR: 2, MID: 3, SENIOR: 4 }, guestAllowed: true, hrMayEnterForMember: true },
  SCORING_WEIGHTS: { scale: { min: 1, max: 5 }, defaultCriteria: [{ key: 'technical', label: 'Technical' }, { key: 'communication', label: 'Communication' }, { key: 'culturalFit', label: 'Cultural fit' }, { key: 'problemSolving', label: 'Problem solving' }], weights: null },
  REJECTION_RULES: { decider: byLevel('HR_OR_HM'), reasons: REASONS, secondConfirmation: byLevel(false), reviewVoteLevel: 'STRONG_NO', reviewBelowScore: null },
  APPROVAL_RULES: { mode: 'ONE_APPROVER' },
  // The stage-name limits are today's (lambda/shared/config-reader.js): monitorTalentFlowSLAs still reads them by those names until
  // REC-03 moves it to the shared stage file, so the Standard pack keeps them next to the new keys.
  SLA_THRESHOLDS: { ...LEGACY_SLA, stageLimitHours: byLevel(72), riskPoints: [50, 75, 100], engagementLimitDays: 7, feedbackDueHours: 48, interviewMissedAfterHours: 24, offerExpiryWarningDays: 3 },
  SENTIMENT_SCALE: { moods: [['VERY_INTERESTED', 'Very interested', false], ['INTERESTED', 'Interested', false], ['NEUTRAL', 'Neutral', false], ['HESITANT', 'Hesitant', true], ['DISENGAGED', 'Disengaged', true]].map(([key, label, atRisk]) => ({ key, label, atRisk })) },
  EMAIL_TEMPLATES: TEMPLATE_TEXTS,
  INTELLIGENCE_RULES: { rules: [] },
  RETENTION: { notHiredMonths: 6 },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const only = (o, keys) => isObj(o) && Object.keys(o).every((k) => keys.includes(k));
const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x));
const sameKeys = (o, keys) => isObj(o) && sameSet(Object.keys(o), keys);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const placeholdersOk = (s) => typeof s === 'string' && [...s.matchAll(/\{([^{}]*)\}/g)].every((m) => PLACEHOLDERS.includes(m[1]));

/** ctx = { levels: [keys], typeKeys: [keys] } of the company's active SENIORITY_PROFILES and INTERVIEW_TYPES. */
export function validate(type, d, ctx = {}) {
  const levels = ctx.levels ?? LEVELS;
  switch (type) {
    case 'STAGE_CONFIG': return only(d, ['screening']) && typeof d.screening === 'boolean';
    case 'SENIORITY_PROFILES':
      return only(d, ['levels']) && Array.isArray(d.levels) && d.levels.length >= 1 && d.levels.length <= 8
        && d.levels.every((l) => sameKeys(l, ['key', 'label', 'order']) && /^[A-Z_]{2,20}$/.test(l.key) && typeof l.label === 'string' && num(l.order))
        && new Set(d.levels.map((l) => l.key)).size === d.levels.length;
    case 'INTERVIEW_TYPES': {
      if (!sameKeys(d, ['types', 'requiredByLevel']) || !Array.isArray(d.types) || !sameKeys(d.requiredByLevel, levels)) return false;
      const keys = d.types.map((t) => t?.key);
      const lengthOk = (t) => t.default_length_minutes === undefined || (Number.isInteger(t.default_length_minutes) && t.default_length_minutes >= 15 && t.default_length_minutes <= 240 && t.default_length_minutes % 15 === 0);
      return d.types.every((t) => (sameKeys(t, ['key', 'label', 'optional']) || sameKeys(t, ['key', 'label', 'optional', 'default_length_minutes'])) && lengthOk(t) && typeof t.key === 'string' && typeof t.label === 'string' && typeof t.optional === 'boolean')
        && levels.every((l) => Array.isArray(d.requiredByLevel[l]) && d.requiredByLevel[l].every((k) => keys.includes(k)));
    }
    case 'PANEL_CONFIG':
      return only(d, ['panelSize', 'guestAllowed', 'hrMayEnterForMember', 'interview_emails', 'candidate_interview_emails'])
        && (d.interview_emails === undefined || d.interview_emails === 'ON' || d.interview_emails === 'OFF')
        && (d.candidate_interview_emails === undefined || d.candidate_interview_emails === 'OFF')
        && (d.panelSize === undefined || (sameKeys(d.panelSize, levels) && levels.every((l) => Number.isInteger(d.panelSize[l]) && d.panelSize[l] >= 1 && d.panelSize[l] <= 20)))
        && (d.guestAllowed === undefined || typeof d.guestAllowed === 'boolean')
        && (d.hrMayEnterForMember === undefined || typeof d.hrMayEnterForMember === 'boolean');
    case 'SCORING_WEIGHTS':
      return only(d, ['scale', 'defaultCriteria', 'weights']) && d.weights === null && sameKeys(d.scale, ['min', 'max']) && d.scale.min === 1 && d.scale.max === 5
        && Array.isArray(d.defaultCriteria) && d.defaultCriteria.every((c) => sameKeys(c, ['key', 'label']));
    case 'REJECTION_RULES':
      return sameKeys(d, ['decider', 'reasons', 'secondConfirmation', 'reviewVoteLevel', 'reviewBelowScore'])
        && sameKeys(d.decider, levels) && levels.every((l) => ['HR_ONLY', 'HR_OR_HM'].includes(d.decider[l]))
        && sameKeys(d.secondConfirmation, levels) && levels.every((l) => typeof d.secondConfirmation[l] === 'boolean')
        && JSON.stringify(d.reasons) === JSON.stringify(REASONS)
        && (d.reviewVoteLevel === null || d.reviewVoteLevel === 'STRONG_NO')
        && (d.reviewBelowScore === null || (num(d.reviewBelowScore) && d.reviewBelowScore >= 1 && d.reviewBelowScore <= 5));
    case 'APPROVAL_RULES': return sameKeys(d, ['mode']) && d.mode === 'ONE_APPROVER';
    case 'SLA_THRESHOLDS':
      // A company's saved limits may still hold the stage names it was saved with: any name the stage file knows is allowed, so a
      // save of those limits is not refused. Each is a number of hours.
      return isObj(d) && Object.keys(d).every((k) => Object.keys(DEFAULTS.SLA_THRESHOLDS).includes(k) || normaliseStage(k) !== undefined)
        && [...Object.keys(d).filter((k) => normaliseStage(k) !== undefined), 'feedbackDueHours', 'interviewMissedAfterHours', 'offerExpiryWarningDays', 'engagementLimitDays'].every((k) => d[k] === undefined || (num(d[k]) && d[k] >= 0))
        && (d.stageLimitHours === undefined || (sameKeys(d.stageLimitHours, levels) && levels.every((l) => num(d.stageLimitHours[l]) && d.stageLimitHours[l] >= 0)))
        && (d.riskPoints === undefined || (Array.isArray(d.riskPoints) && d.riskPoints.length === 3 && d.riskPoints.every((n) => num(n) && n > 0 && n <= 100) && d.riskPoints[0] < d.riskPoints[1] && d.riskPoints[1] < d.riskPoints[2]));
    case 'SENTIMENT_SCALE':
      return sameKeys(d, ['moods']) && Array.isArray(d.moods) && d.moods.length >= 2 && d.moods.length <= 7
        && d.moods.every((m) => sameKeys(m, ['key', 'label', 'atRisk']) && typeof m.key === 'string' && typeof m.label === 'string' && typeof m.atRisk === 'boolean');
    case 'EMAIL_TEMPLATES':
      return isObj(d) && Object.entries(d).every(([k, t]) => ['interviewer_reminder', 'candidate_notice', 'candidate_check_in', 'offer_follow_up', 'offer_letter'].includes(k)
        && only(t, ['subject', 'body']) && placeholdersOk(t.body) && (t.subject === undefined || placeholdersOk(t.subject)));
    case 'INTELLIGENCE_RULES': return only(d, ['rules']) && Array.isArray(d.rules);
    case 'RETENTION': return sameKeys(d, ['notHiredMonths']) && Number.isInteger(d.notHiredMonths) && d.notHiredMonths >= 1 && d.notHiredMonths <= 60;
    default: return true;
  }
}
export const isCovered = (type) => TYPES.includes(type);

// The AWS packages load on the first read or write, so the shapes, defaults, validator and renderer above work (and are tested)
// with no AWS package installed, as in the CI job of a Lambda that only checks a save.
let aws;
async function load() {
  if (!aws) {
    const [db, util] = await Promise.all([import('@aws-sdk/client-dynamodb'), import('@aws-sdk/util-dynamodb')]);
    aws = { ...db, ...util, client: new db.DynamoDBClient({}) };
  }
  return aws;
}
const CONFIG = () => process.env.CONFIG_TABLE_NAME ?? 'talent-flow-config';
const STATE = () => process.env.STATE_TABLE_NAME ?? 'talent-flow-state';

async function activeItems(tenantId) {
  const { client, QueryCommand, GetItemCommand, UpdateItemCommand, marshall, unmarshall } = await load();
  const out = {};
  const answers = await Promise.all(TYPES.map((type) => client.send(new QueryCommand({
    TableName: CONFIG(), IndexName: 'GSI1-active-configs', KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
    ExpressionAttributeValues: marshall({ ':pk': `TENANT#${tenantId}#ACTIVE`, ':sk': `CONFIG#${type}` }), Limit: 1,
  }))));
  TYPES.forEach((type, n) => {
    const item = answers[n].Items?.[0];
    if (item) { const i = unmarshall(item); out[type] = { version: i.version, data: i.data }; }
  });
  return out;
}
async function versionItem(tenantId, type, version) {
  const { client, QueryCommand, GetItemCommand, UpdateItemCommand, marshall, unmarshall } = await load();
  const r = await client.send(new GetItemCommand({ TableName: CONFIG(), Key: marshall({ PK: `TENANT#${tenantId}`, SK: `CONFIG#${type}#v${version}` }) }));
  return r.Item ? { version, data: unmarshall(r.Item).data } : undefined;
}

/** The versions to lock a new candidate to: { TYPE: version } for each type the company has. */
export async function activeVersions(tenantId) {
  const items = await activeItems(tenantId);
  return Object.fromEntries(Object.entries(items).filter(([t]) => LOCK_TYPES.includes(t)).map(([t, i]) => [t, i.version]));
}
export async function activeSettings(tenantId) {
  const items = await activeItems(tenantId);
  return Object.fromEntries(Object.entries(items).map(([t, i]) => [t, i.data]));
}

/** With a candidate: the versions it is locked to (locking any that are missing, once). Without: the active versions. */
export async function getRecruitmentSettings(tenantId, candidate) {
  const { client, QueryCommand, GetItemCommand, UpdateItemCommand, marshall, unmarshall } = await load();
  const active = await activeItems(tenantId);
  if (!candidate || (candidate.tenant_id && candidate.tenant_id !== tenantId)) return Object.fromEntries(Object.entries(active).map(([t, i]) => [t, i.data]));
  const lock = { ...(candidate.settingVersions ?? {}) };
  const missing = LOCK_TYPES.filter((t) => lock[t] === undefined && active[t]);
  const key = marshall({ PK: candidate.PK, SK: candidate.SK });
  const reread = async () => {
    const row = await client.send(new GetItemCommand({ TableName: STATE(), Key: key, ConsistentRead: true }));
    return unmarshall(row.Item ?? {}).settingVersions ?? {};
  };
  if (missing.length && candidate.settingVersions === undefined) {
    // First lock of an older candidate: one write for every type, once. A loser of the race takes the winner's lock.
    try {
      await client.send(new UpdateItemCommand({
        TableName: STATE(), Key: key, UpdateExpression: 'SET settingVersions = :all',
        ConditionExpression: 'attribute_exists(PK) AND tenant_id = :tenant AND attribute_not_exists(settingVersions)',
        ExpressionAttributeValues: marshall({ ':tenant': tenantId, ':all': Object.fromEntries(missing.map((t) => [t, active[t].version])) }),
      }));
      for (const t of missing) lock[t] = active[t].version;
    } catch (e) {
      if (e.name !== 'ConditionalCheckFailedException') throw e;
      Object.assign(lock, await reread());
    }
  } else {
    // A candidate part-locked (a type added since): lock each missing type once, never moving one that is set.
    for (const t of missing) {
      try {
        await client.send(new UpdateItemCommand({
          TableName: STATE(), Key: key, UpdateExpression: 'SET settingVersions.#t = :v',
          ConditionExpression: 'tenant_id = :tenant AND attribute_exists(settingVersions) AND attribute_not_exists(settingVersions.#t)',
          ExpressionAttributeNames: { '#t': t }, ExpressionAttributeValues: marshall({ ':tenant': tenantId, ':v': active[t].version }),
        }));
        lock[t] = active[t].version;
      } catch (e) {
        if (e.name !== 'ConditionalCheckFailedException') throw e;
        lock[t] = (await reread())[t] ?? active[t].version;
      }
    }
  }
  const out = {};
  for (const t of Object.keys(active)) {
    if (lock[t] === undefined || lock[t] === active[t].version) { out[t] = active[t].data; continue; }
    out[t] = (await versionItem(tenantId, t, lock[t]))?.data ?? active[t].data;
  }
  return out;
}

/**
 * REC-15 step C (spec check C-2): the settings a candidate is held to, for a read. The same versions getRecruitmentSettings gives
 * (the lock where there is one, else the active version), but it never writes: an unlocked row stays unlocked. Also gives the active
 * data (the stage clock reads the active SLA_THRESHOLDS, as the list does).
 */
export async function settingsForRead(tenantId, candidate) {
  const active = await activeItems(tenantId);
  const lock = candidate?.settingVersions ?? {};
  const settings = {};
  for (const t of Object.keys(active)) {
    if (lock[t] === undefined || lock[t] === active[t].version) { settings[t] = active[t].data; continue; }
    settings[t] = (await versionItem(tenantId, t, lock[t]))?.data ?? active[t].data;
  }
  return { settings, active: Object.fromEntries(Object.entries(active).map(([t, i]) => [t, i.data])) };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fill = (text, values, escape) => String(text ?? '').replace(/\{([a-z_]+)\}/g, (_m, k) => { const v = values && Object.prototype.hasOwnProperty.call(values, k) ? values[k] : undefined; return v === undefined || v === null ? '' : escape ? esc(v) : String(v); });
export function renderTemplate(template, values = {}) {
  const out = { body: fill(template.body, values, true) };
  if (template.subject !== undefined) out.subject = fill(template.subject, values, false).replace(/[\r\n]+/g, ' ');
  return out;
}
export { STAGE_CODES };
