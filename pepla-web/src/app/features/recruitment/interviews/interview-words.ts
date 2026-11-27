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
  /** INT-UI-02: the Schedule and Reschedule drawer (approved 25 Nov, W-N lines under rule 7a). */
  drawer: {
    type: 'Interview type', dateTime: 'Date and time', date: 'Date', time: 'Time', length: 'Length', where: 'Where', inPerson: 'In person', online: 'Online',
    place: 'Place', link: 'Video link', panel: 'Panel', guest: 'Add a guest by email', note: 'Note for the candidate', reason: 'Reason for the change',
    cancel: 'Cancel', sast: 'Times are in South African time (SAST).',
    guestHelp: 'They get an email with a link to give feedback once. It works from the start of the interview until 7 days after.',
    bookedServer: 'This interview type is already booked. Choose another type.',
    hasFeedback: 'Someone has already given feedback, so this interview can\'t be changed.',
    future: 'Choose a time in the future.', badLink: 'Enter a link that starts with https://',
    w5Line: 'Everyone invited gets an email with the new details and an updated calendar invite.',
    choicesFailed: 'Interview choices could not be loaded.', noPeople: 'No people to choose yet.',
    typeEmpty: 'Choose an interview type', dateEmpty: 'Choose a date', timeEmpty: 'Choose a time', lengthEmpty: 'Choose a length',
    whereEmpty: 'Choose in person or online', placeEmpty: 'Enter the place', panelEmpty: 'Choose at least one person',
    emailWrong: 'Enter an email address, like name@company.co.za', saveFail: 'Your change could not be saved. Try again.',
  } as Record<string, string | null>,
};
export const typeWords = (key: string | null | undefined): string | null => {
  if (typeof key !== 'string' || !key.trim()) return null;
  const known = INTERVIEW_WORDS.types[key];
  if (known) return known;
  const s = key.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** INT-UI-02 lines with a part filled in. */
export const DRAWER_LINES = {
  /** W-N10. */
  panelMax: (n: number) => (n === 1 ? 'Choose up to 1 person' : `Choose up to ${n} people`),
  /** W-9a help. */
  booked: (words: string[]) => `${words.join(', ')}: already booked or done.`,
  /** W-3, "the guest" only when a guest address is typed. */
  invite: (first: string, guest: boolean) => (guest ? `The panel, the guest and ${first} each get an email with a calendar invite.` : `The panel and ${first} each get an email with a calendar invite.`),
  /** W-5 title (S-5: lower-cased inside the sentence). */
  rescheduleTitle: (type: string) => `Reschedule the ${type.toLowerCase()} interview`,
  /** W-N12. */
  closedButton: (type: string) => `Schedule an interview, ${type}`,
  /** W-17. */
  length: (m: number) => { const h = Math.floor(m / 60), r = m % 60; if (!h) return `${r} minutes`; const hs = `${h} hour${h > 1 ? 's' : ''}`; return r ? `${hs} ${r} minutes` : hs; },
};
