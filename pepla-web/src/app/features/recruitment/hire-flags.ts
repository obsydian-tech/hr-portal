/**
 * "Add candidate" has nothing behind it until REC-UI-02 (the drawer) is merged. The board does not show a button with no place to go:
 * REC-UI-02 turns this on in the same change that adds the drawer (D-RUI-01.1).
 */
export const ADD_CANDIDATE_READY = true;

/**
 * The candidate record shows Overview and Notes (REC-UI-02 steps 3 and 4). The card that builds another tab turns its flag on in its
 * own change (Interviews: INT-UI-01, Offer: the offer id on the record).
 */
export const INTERVIEWS_TAB_READY: boolean = false;
export const NOTES_TAB_READY: boolean = true;
export const OFFER_TAB_READY: boolean = false;
