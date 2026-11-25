/** REC-05 rule 1: the offer states, and an old state code read as a new one. */
export const STATES = ['DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'];
export function mapState(code) {
  if (STATES.includes(code)) return code;
  if (code === 'OFFER_CREATED' || code === 'IN_APPROVAL') return 'DRAFT';
  if (code === 'OFFER_SENT') return 'SENT';
  return 'WITHDRAWN';
}
