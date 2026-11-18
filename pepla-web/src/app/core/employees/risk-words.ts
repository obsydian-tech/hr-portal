/**
 * ONB-11: every word HR reads in the risk block, in this one file.
 *
 * APPROVED by Iggie on 18 Nov 2026 ("all recommended"): the heading, the four result words and the "no check yet"
 * line are exactly these. Change them only when he gives other words (child lock onb-11.1 pins them in AC-8).
 * The reason is the model's own sentence, or one of the two guard sentences, shown as written (Q2).
 */
export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';

export const RISK_HEADING = 'Risk check';
export const RISK_NONE = 'Not assessed';

export const RISK_WORD: Record<RiskBand, { text: string; tone: 'success' | 'warning' | 'danger' | 'information' }> = {
  LOW: { text: 'Batsi rated the risk low', tone: 'success' },
  MEDIUM: { text: 'Batsi rated the risk medium', tone: 'warning' },
  HIGH: { text: 'Batsi rated the risk high', tone: 'danger' },
  UNKNOWN: { text: 'Batsi could not check the risk', tone: 'information' },
};
