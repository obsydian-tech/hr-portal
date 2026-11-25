/**
 * REC-15 step C rule 14 and 17: what the record and the routes agree on. Pure functions, no AWS call.
 *  requiredInterviews  the interview rule moveCandidate applies on Interview to Offer, and the record's numbers.
 *  moveDeciderOf       who decides the Interview to Offer gate (moveCandidate's reading of REJECTION_RULES).
 *  decisionDeciderOf   who decides Not hired and reopen (recordNotHired's reading of REJECTION_RULES).
 */
import { DEFAULTS } from '../recruitment-settings.mjs';

/** { done, total, incomplete } for the candidate's level under these settings and these completed interview types. */
export function requiredInterviews(settings, row, completedTypes) {
  const required = settings?.INTERVIEW_TYPES?.requiredByLevel?.[row?.positionLevel] ?? [];
  const list = [...new Set(required)];
  const done = list.filter((type) => completedTypes.has(type)).length;
  return { done, total: list.length, incomplete: list.length > 0 && done < list.length };
}
export const moveDeciderOf = (settings, row) => settings?.REJECTION_RULES?.decider?.[row?.positionLevel] ?? 'HR_ONLY';
export const decisionDeciderOf = (settings, row) => (settings?.REJECTION_RULES ?? DEFAULTS.REJECTION_RULES).decider?.[row?.positionLevel] ?? 'HR_ONLY';
