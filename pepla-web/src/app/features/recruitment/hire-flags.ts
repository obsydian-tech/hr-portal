/**
 * "Add candidate" has nothing behind it until REC-UI-02 (the drawer) is merged. The board does not show a button with no place to go:
 * REC-UI-02 turns this on in the same change that adds the drawer (D-RUI-01.1).
 */
export const ADD_CANDIDATE_READY = true;

/**
 * The candidate record shows Overview, Interviews (INT-UI-01) and Notes (REC-UI-02 steps 3 and 4). The card that builds another tab turns its flag on in its
 * own change (Offer: the offer id on the record).
 */
export const INTERVIEWS_TAB_READY: boolean = true;
export const NOTES_TAB_READY: boolean = true;
export const OFFER_TAB_READY: boolean = false;

/** Schedule an interview and Reschedule: owner INT-UI-02. */
export const SCHEDULE_READY: boolean = true;
export const RESCHEDULE_READY: boolean = true;
/** Cancel interview, Did not happen and Mark as done: owner INT-UI-03. */
export const CLOSE_ACTIONS_READY: boolean = true;
/** Capture feedback: owner REC-UI-03's panel feedback slice and INT-UI-04. */
export const CAPTURE_FEEDBACK_READY: boolean = true;
