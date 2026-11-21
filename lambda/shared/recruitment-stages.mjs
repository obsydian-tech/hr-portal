/**
 * REC-03: the one list of candidate stages. Six codes, in order. Every writer writes one of these.
 *
 * Rows stored before the stage move (scripts/recruitment/migrate-stages.mjs) may still hold an old name. This file is the only
 * place in the Recruitment code that knows those names; every reader goes through normaliseStage.
 */
export const STAGE_CODES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'NOT_HIRED'];

// What each old stage name becomes. Not exported: callers ask normaliseStage, they never hold the old names themselves.
const BECOMES = new Map([
  ['APPLICATION_REVIEW', 'APPLIED'],
  ['PHONE_SCREENING', 'SCREENING'],
  ['TECHNICAL_INTERVIEW', 'INTERVIEW'],
  ['PANEL_INTERVIEW', 'INTERVIEW'],
  ['INTERVIEWING', 'INTERVIEW'],
  ['EVALUATION', 'INTERVIEW'],
  ['BACKGROUND_CHECK', 'OFFER'],
  ['OFFER_PREPARATION', 'OFFER'],
  ['OFFER_APPROVAL', 'OFFER'],
  ['OFFER_DELIVERY', 'OFFER'],
  ['CONTRACT_SIGNING', 'HIRED'],
  ['PRE_BOARDING', 'HIRED'],
  ['ONBOARDING', 'HIRED'],
]);

// The old system recorded a rejection as a status next to whatever stage the candidate was in.
const OLD_OUTCOMES = new Set(['REJECTED', 'EVALUATION_FAILED']);

/**
 * One of STAGE_CODES for a stage name, or for a candidate row ({ currentStage, status }). A row that carries an old outcome is Not
 * hired whatever its stage says. Anything that is not a stage at all gives undefined.
 */
export function normaliseStage(value) {
  if (value !== null && typeof value === 'object') {
    if (OLD_OUTCOMES.has(value.status)) return 'NOT_HIRED';
    return normaliseStage(value.currentStage);
  }
  if (STAGE_CODES.includes(value)) return value;
  return BECOMES.get(value);
}

/** The open stages in the order a candidate walks them. Screening is a company setting; with it off the list is one shorter. */
export const openStages = (screeningOn) => (screeningOn === false ? ['APPLIED', 'INTERVIEW', 'OFFER'] : ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER']);
