/**
 * Child lock int-01.1 (INT-01, NH-269): the two lines INT-01 adds, on scheduleInterview's role policy, for its own request-key store
 * (spec M-5, R-22): GetItem and PutItem on the request-key table, table only (no index, no `*`). The locked IAM checks of mod-01 AC-8,
 * rec-01 AC-8, rec-02 AC-11, rec-04 AC-8, rec-07 AC-9, rec-15 AC-17, rec-15b AC-17, rec-15c AC-17, rec-15d AC-17 and ten-03 AC-10
 * allow exactly these lines and nothing broader; int-01.spec.ts AC-16 pins them against support/int-01/iam-bd6d02c/policies.json.
 *
 * A line is "Allow <action> <resource> <condition>" as policyLines() in support/rec-04 writes it; a key is "<stack>/<policy label>".
 */
const TF_KEYS = String.raw`arn:aws:dynamodb:af-south-1:[^:\s]+:table\/(\$\{local\.tf_table_idempotency\}|talent-flow-idempotency-keys)`;
const GRANTS: Record<string, RegExp[]> = {
  'talent-flow-infra/schedule_interview': [
    new RegExp(String.raw`^Allow dynamodb:GetItem ${TF_KEYS} null$`),
    new RegExp(String.raw`^Allow dynamodb:PutItem ${TF_KEYS} null$`),
  ],
};
/** The two lines, by policy key. */
export const INT01_GRANTS = GRANTS;
/** True when `line` is one of INT-01's grants on the role policy `key` ("<stack>/<policy label>"). */
export const isInt01Grant = (line: string, key: string): boolean => (GRANTS[key] ?? []).some((g) => g.test(line));
