/** REC-15 step D rule 25 (D-12): when a panel member's feedback is due. Pure; REC-07 and REC-09 reuse it. */
import { DEFAULTS } from './recruitment-settings.mjs';

export function feedbackDueAt(scheduledAt, slaThresholds) {
  const at = typeof scheduledAt === 'string' || typeof scheduledAt === 'number' ? Date.parse(scheduledAt) : NaN;
  if (!Number.isFinite(at)) return null;
  const own = slaThresholds?.feedbackDueHours;
  const hours = typeof own === 'number' && Number.isFinite(own) ? own : DEFAULTS.SLA_THRESHOLDS.feedbackDueHours;
  return new Date(at + hours * 3_600_000).toISOString();
}
