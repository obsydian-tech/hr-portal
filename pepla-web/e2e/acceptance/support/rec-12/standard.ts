import { A, TABLE, packTables, plain, rowsOf } from './world';
import type { Tables } from './lambda-harness';

/**
 * REC-12: what the Standard pack must hold, and small readers of the settings rows. Nothing here is application code: it is the
 * card's own words (REC-12.md rules 2 and 6, REC-00.md, WORDING-PROPOSED.md groups C, D and G) as plain values.
 */

/** The twelve types the pack writes and a candidate is locked to (WORKFLOW_TEMPLATES stays a name: rule 2, decision D-T-2). */
export const TYPES = [
  'STAGE_CONFIG', 'SENIORITY_PROFILES', 'INTERVIEW_TYPES', 'PANEL_CONFIG', 'SCORING_WEIGHTS', 'REJECTION_RULES', 'APPROVAL_RULES',
  'SLA_THRESHOLDS', 'SENTIMENT_SCALE', 'EMAIL_TEMPLATES', 'INTELLIGENCE_RULES', 'RETENTION',
] as const;
export type SettingType = (typeof TYPES)[number];
/** The types a candidate's row records (RETENTION is read at Not hired time, so the card leaves its lock open: decision D-T-3). */
export const LOCKED_TYPES = TYPES.filter((t) => t !== 'RETENTION');

/** Today's three levels (the position levels createCandidate accepts). */
export const LEVELS = ['JUNIOR', 'MID', 'SENIOR'] as const;

/**
 * Today's code values the pack copies (W-R1): the five interview types and the five moods; the required interview types per level
 * are the Interview Requirements page's own starting values (admin-panel-rules.component.ts, DEFAULT_INTERVIEW_REQS). Step 0 of the
 * card (what dev and prod hold today) may change the three lists: they live here and nowhere else.
 */
export const INTERVIEW_TYPE_KEYS = ['PHONE_SCREEN', 'TECHNICAL', 'BEHAVIORAL', 'CULTURE_FIT', 'FINAL'];
export const REQUIRED_BY_LEVEL: Record<string, string[]> = {
  JUNIOR: ['PHONE_SCREEN'],
  MID: ['PHONE_SCREEN', 'TECHNICAL'],
  SENIOR: ['PHONE_SCREEN', 'TECHNICAL', 'BEHAVIORAL'],
};
export const MOOD_KEYS = ['VERY_INTERESTED', 'INTERESTED', 'NEUTRAL', 'HESITANT', 'DISENGAGED'];
export const AT_RISK_MOODS = ['HESITANT', 'DISENGAGED'];
/** Today's four scoring criteria (technical, communication, cultural fit, problem solving). */
export const CRITERIA_KEYS = ['technical', 'communication', 'culturalFit', 'problemSolving'];

/** The approved eight Not hired reasons (D-REC-12.2). */
export const REASONS = ['NOT_RIGHT_SKILLS', 'NOT_RIGHT_EXPERIENCE', 'CHOSE_ANOTHER', 'WITHDREW', 'SALARY_MISMATCH', 'DID_NOT_ATTEND', 'ROLE_CLOSED', 'OTHER'];

/** The six stage codes in order (REC-00 rule 6). */
export const STAGE_CODES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'NOT_HIRED'];

/** The placeholders a template may hold (rule 2). */
export const PLACEHOLDERS = ['company', 'role', 'candidate', 'first_name', 'date', 'due', 'link', 'expires', 'start_date'];

/**
 * The approved starting texts, word for word (WORDING-PROPOSED.md groups C, D, G). The only change is the placeholder spelling the
 * card fixes: "{first name}" is written {first_name} (decision D-T-6). Check-in and follow-up have no approved subject, so none is stored.
 */
export const TEMPLATE_TEXTS: Record<string, { subject?: string; body: string }> = {
  interviewer_reminder: {
    subject: 'Your feedback on {candidate} is due',
    body: 'You interviewed {candidate} for {role} on {date}. Your feedback is due {due}. Open: {link}',
  },
  candidate_notice: {
    subject: 'Your application at {company}',
    body: '{company} has added your details to apply for {role}. We keep your name, contact details, CV and interview notes to run this application. If you are not hired, they are removed after 6 months. To see, correct or remove your details, reply to this email.',
  },
  candidate_check_in: {
    body: 'Hi {first_name}, checking in on your application for {role} at {company}. Is there anything you need from us before the next step?',
  },
  offer_follow_up: {
    body: 'Hi {first_name}, a reminder that your offer for {role} expires on {date}. Let me know if you have any questions.',
  },
};

// ---------------------------------------------------------------- readers of the config table

export const CONFIG = TABLE.config;
export const configRows = (t: Tables, tenant: string, type: string) =>
  rowsOf(t, CONFIG).filter((r) => r['PK'] === `TENANT#${tenant}` && String(r['SK']).startsWith(`CONFIG#${type}#v`)).sort((a, b) => a['version'] - b['version']);
/** The active row of a type (the one that is in the active index). */
export const activeRow = (t: Tables, tenant: string, type: string) => configRows(t, tenant, type).find((r) => r['GSI1PK'] === `TENANT#${tenant}#ACTIVE`);
/** The data of company A's active version after the real pack ran. */
export const defaultOf = (type: SettingType): any => structuredClone(activeRow(packTables(), A, type)?.['data']);
/** Every row of the config table of a company that is not a settings version (an audit row, a completion marker). */
export const otherRows = (t: Tables, tenant: string) =>
  rowsOf(t, CONFIG).filter((r) => r['tenant_id'] === tenant && !/^CONFIG#[A-Z_]+#v\d+$/.test(String(r['SK'])));
/** Every row of every table the world holds that is not in `before`, by table, as plain values. */
export function newRows(before: Tables, after: Tables): { table: string; row: Record<string, any> }[] {
  const out: { table: string; row: Record<string, any> }[] = [];
  for (const [table, rows] of Object.entries(after)) {
    const seen = new Set((before[table] ?? []).map((r) => JSON.stringify(r)));
    for (const r of rows) if (!seen.has(JSON.stringify(r))) out.push({ table, row: plain(r) });
  }
  return out;
}
