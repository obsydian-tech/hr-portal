/**
 * Child lock ten-02.12 (REC-05 key follow-up, NH-239): the two TalentFlow roles that may join the PII key's lists.
 * Written exactly as infra/kms.tf names roles of the talent-flow-infra stack: a quoted ARN with the account variable and the
 * /talent-flow/ role path. rec-05-kms.spec.ts pins where each one goes and that each is there once; the older tests only make room.
 */
/** manageOffers: on allowed_role_arns (it signs uploads into the bucket this key encrypts) and on dynamodb_read_role_arns. */
export const MANAGE_OFFERS_ARN = '"arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-manageOffers"';
/** monitorTalentFlowSLAs (the hourly offer expiry): on dynamodb_read_role_arns only. */
export const MONITOR_SLAS_ARN = '"arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-monitorTalentFlowSLAs"';

/** Removes the first copy of `entry` from a list of entries; a second copy stays, so the caller's equality check still fails. */
export const withoutOnce = (entries: readonly string[], entry: string): string[] => {
  const i = entries.indexOf(entry);
  return i < 0 ? [...entries] : [...entries.slice(0, i), ...entries.slice(i + 1)];
};
