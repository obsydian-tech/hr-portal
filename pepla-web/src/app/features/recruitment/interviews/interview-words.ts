/** INT-UI-01: the one table of interview words (M-5). The hygiene job's check fails on a row with null or empty words. */
export const INTERVIEW_WORDS = {
  status: { COMPLETED: 'Done', CANCELLED: 'Cancelled', DID_NOT_HAPPEN: 'Did not happen' } as Record<string, string | null>,
  types: { PHONE_SCREEN: 'Phone screen', TECHNICAL: 'Technical', BEHAVIORAL: 'Behavioral', CULTURE_FIT: 'Culture fit', FINAL: 'Final' } as Record<string, string | null>,
  reasons: {
    CANCELLED: { CANDIDATE_ASKED: 'Candidate asked', PANEL_NOT_AVAILABLE: 'Panel not available', CANDIDATE_WITHDREW: 'Candidate withdrew', OTHER: 'Other' },
    DID_NOT_HAPPEN: { CANDIDATE_DID_NOT_COME: 'Candidate did not come', INTERVIEWER_DID_NOT_COME: 'Interviewer did not come', OTHER: 'Other' },
    COMPLETED: { FEEDBACK_GIVEN_ANOTHER_WAY: 'Feedback was given another way', PANEL_MEMBER_CANNOT_GIVE_FEEDBACK: 'Someone on the panel cannot give feedback', OTHER: 'Other' },
  } as Record<string, Record<string, string | null>>,
  ratings: { STRONG_YES: 'Strong yes', YES: 'Yes', NO: 'No', STRONG_NO: 'Strong no' } as Record<string, string | null>,
  lines: {
    noFeedback: 'No feedback', guest: 'Guest', noteLabel: 'Note for the candidate', inPerson: 'In person', online: 'Online',
    failed: 'Interviews could not be loaded.', tryAgain: 'Try again', empty: 'No interviews yet.',
  } as Record<string, string | null>,
  /** Controls of later cards (not drawn while their flags are off). */
  controls: {
    schedule: 'Schedule an interview', reschedule: 'Reschedule', cancel: 'Cancel interview', didNotHappen: 'Did not happen', markDone: 'Mark as done', capture: 'Capture feedback',
  } as Record<string, string | null>,
};
export const typeWords = (key: string | null | undefined): string | null => {
  if (typeof key !== 'string' || !key.trim()) return null;
  const known = INTERVIEW_WORDS.types[key];
  if (known) return known;
  const s = key.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
