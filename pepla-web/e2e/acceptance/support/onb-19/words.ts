/**
 * ONB-19: every word the page shows, in ONE place. All of them are the spec's (/mnt/project-files/onboarding-cards/specs/ONB-19.md,
 * "Words"): the kit's own words, the answers Iggie approved on 16 Nov (Q1, Q3) or words already approved on ONB-05 and ONB-06.
 * No word here is new, so no answer is owed; a words-only change after a later answer touches this file only.
 */
import type { StepCode } from './step-me';

export const TITLE = 'My onboarding · Naleko People';
export const NAV_LABEL = 'My onboarding';
export const HEADING = 'Getting started';
export const BAR_LABEL = 'Onboarding progress';
export const CARD = 'Your steps to Day 1';

/** The four steps, in order, with the words each is called. */
export const STEP_LABELS = ['Invited', 'Documents', 'In review', 'Verified'] as const;
export const WORD_OF: Record<StepCode, string> = { INVITED: 'Invited', DOCUMENTS: 'Documents', IN_REVIEW: 'In review', VERIFIED: 'Verified' };

/** n = the step the person is on (1 to 4), d = how many are done, and what each of the four is (the spec's table). */
export type Mark = 'done' | 'current' | 'not started';
export const TABLE: Record<StepCode, { n: number; d: number; marks: [Mark, Mark, Mark, Mark] }> = {
  INVITED: { n: 1, d: 0, marks: ['current', 'not started', 'not started', 'not started'] },
  DOCUMENTS: { n: 2, d: 1, marks: ['done', 'current', 'not started', 'not started'] },
  IN_REVIEW: { n: 3, d: 2, marks: ['done', 'done', 'current', 'not started'] },
  VERIFIED: { n: 4, d: 4, marks: ['done', 'done', 'done', 'done'] },
};

/** "Step 3 of 4: In review. 2 of 4 steps done." */
export const describe = (step: StepCode) => `Step ${TABLE[step].n} of 4: ${WORD_OF[step]}. ${TABLE[step].d} of 4 steps done.`;
export const doneText = (step: StepCode) => `${TABLE[step].d} of 4 steps done`;

/** The words under a step in the tracker. Steps that have none say nothing. */
export const META = {
  documentsDone: 'Your ID and bank letter are in.',
  inReviewCurrent: 'Now. Batsi has read your documents. HR decides each one.',
  verifiedNotStarted: 'When HR has accepted your ID and bank letter.',
};

/** What is left (Q3), and the kit's In review message, and Q1. */
export const LEFT = {
  both: 'Upload your ID and your bank letter.',
  id: 'Upload your ID.',
  bank: 'Upload your bank letter.',
  consent: 'Accept the privacy notice first.',
  goToday: 'Go to Today',
  checkingTitle: 'Your documents are being checked',
  checkingBody: 'Batsi has read your ID and bank letter. HR decides each document. Nothing to do now: we tell you when all are verified.',
  verified: 'HR has everything it needs.',
  needsNewCopy: 'Needs a new copy',
};
export const UPLOAD_ID = 'Upload ID';
export const UPLOAD_BANK = 'Upload bank letter';

/** Reused, already approved (ONB-05). */
export const NOT_FOUND = "We can't find your record. Ask your HR team.";
export const OFFLINE = "We can't reach Naleko People. Check your connection and try again.";
export const TRY_AGAIN = 'Try again';

/** Today's tracker (ONB-05) and the line it keeps saying until the documents are in. */
export const TODAY_TRACKER = 'Getting started, 2 steps';
export const TODAY_DOCS_META = 'Upload your ID and your bank letter.';
