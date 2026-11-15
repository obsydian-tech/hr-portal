/**
 * The four onboarding steps (ONB-09). The API answers a code; the screens show the words.
 * Pure functions, no AWS call.
 */
import { allRequiredIn, verifiedReady } from './required-documents.mjs';

export const STEPS = Object.freeze(['INVITED', 'DOCUMENTS', 'IN_REVIEW', 'VERIFIED']);

/** The step the documents say once a person has signed in: never Invited. */
export function stepFromDocuments(docs, required) {
  if (verifiedReady(docs, required)) return 'VERIFIED';
  if (allRequiredIn(docs, required)) return 'IN_REVIEW';
  return 'DOCUMENTS';
}

/** Rows written before this card have no step: answer from the old stage with the table HR already sees. */
const STEP_OF_STAGE = Object.freeze({
  INVITED: 'INVITED',
  ACTIVE: 'DOCUMENTS',
  DOCUMENTS_SUBMITTED: 'IN_REVIEW',
  VERIFIED: 'VERIFIED',
  TRAINING: 'VERIFIED',
  ONBOARDED: 'VERIFIED',
});

/** The stored step when it is one of the four, else the step the old stage gives, else null. */
export function stepOf(employee) {
  const stored = employee?.step;
  if (STEPS.includes(stored)) return stored;
  const fromStage = Object.hasOwn(STEP_OF_STAGE, employee?.stage) ? STEP_OF_STAGE[employee.stage] : undefined;
  return fromStage ?? null;
}

/** The steps before this one, for the forward-only write condition. */
export function stepsBefore(step) {
  const at = STEPS.indexOf(step);
  return at < 0 ? [] : STEPS.slice(0, at);
}
