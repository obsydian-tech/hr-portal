/** REC-UI-04: offer words and formats. */
export interface OfferRow { offer_id: string; candidate_id: string; candidate_name: string | null; role_title: string | null; state: string; expires_at: string | null; approver_name?: string; }
export interface OfferHist { from: string | null; to: string; by_name: string | null; at: string; note?: string; kind?: string }
export interface Offer {
  offer_id: string; candidate_id: string; candidate_name: string | null; role_title: string | null; department: string | null; state: string; version: number;
  start_date: string | null; expiry_date: string | null; benefits: string | null; currency: string | null; salary: number | null; salary_hidden: boolean;
  created_at: string | null; drafted_by_name: string | null; submitted_at: string | null; sent_at: string | null; answered_at: string | null;
  approval: { approver_name: string | null; at: string } | null; history: OfferHist[]; drafted_by_me: boolean; can_reveal_salary: boolean;
}
export const OFFER_WORD: Record<string, string> = {
  DRAFT: 'Draft', WAITING_APPROVAL: 'Waiting for approval', APPROVED: 'Approved', SENT: 'Sent', ACCEPTED: 'Accepted', DECLINED: 'Declined', EXPIRED: 'Expired', WITHDRAWN: 'Withdrawn',
};
export const OFFER_TONE: Record<string, string> = { WAITING_APPROVAL: 'warning', APPROVED: 'success', SENT: 'information', ACCEPTED: 'success', DECLINED: 'danger', EXPIRED: 'danger' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "1 Dec 2026", in Johannesburg. */
export function dayOf(v: string): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00+02:00` : v);
  const j = new Date(d.getTime() + 2 * 3600_000);
  return `${j.getUTCDate()} ${MONTHS[j.getUTCMonth()]} ${j.getUTCFullYear()}`;
}
/** Today in Johannesburg, YYYY-MM-DD. */
export const todayIso = (): string => new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
/** 650000 → "650 000.00". */
export function money(n: number): string {
  const [whole, cents] = n.toFixed(2).split('.');
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${cents}`;
}
