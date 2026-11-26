/**
 * "Add candidate" has nothing behind it until REC-UI-02 (the drawer) is merged. The board does not show a button with no place to go:
 * REC-UI-02 turns this on in the same change that adds the drawer (D-RUI-01.1).
 */
export const ADD_CANDIDATE_READY = true;

/**
 * The candidate record shows its Overview only (REC-UI-02 step 3). The card that builds a tab turns its flag on in its own change
 * (Interviews: INT-UI-01, Notes: REC-15 step D and its words, Offer: the offer id on the record).
 */
export const INTERVIEWS_TAB_READY: boolean = false;
export const NOTES_TAB_READY: boolean = false;
export const OFFER_TAB_READY: boolean = false;
