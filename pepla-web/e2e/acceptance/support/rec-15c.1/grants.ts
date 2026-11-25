/**
 * Child lock rec-15c.1 (REC-15 step C, NH-278): the three read grants step C adds to getCandidate's existing role policy. The locked IAM
 * checks of mod-01 AC-8, rec-01 AC-8, rec-04 AC-8, rec-07 AC-9, rec-15 AC-17, rec-15b AC-17 and ten-03 AC-10 allow exactly these lines and
 * nothing broader; rec-15c.spec.ts AC-17 pins them (each once, only on aws_iam_role_policy.get_candidate, no wildcard, no new role).
 *
 * - GetItem on the roles table: the record shows the role's current title (REC-15 rule 5).
 * - GetItem on the config table and Query on its GSI1-active-configs index: the record reads the candidate's settings, read only, for
 *   next_step, the interview numbers and can_move / can_decide (rules 14 and 17, spec check C-2 and C-3).
 *
 * A line is "Allow <action> <resource> <condition>" as policyLines() in support/rec-04 writes it.
 */
const ROLES = String.raw`(talent-flow-roles|\$\{local\.tf_table_roles\})`;
const CONFIG = String.raw`(talent-flow-config|\$\{local\.tf_table_config\})`;
const arn = (table: string, tail = '') => String.raw`arn:aws:dynamodb:af-south-1:[^:\s]+:table\/${table}${tail}`;
const KEY = /^talent-flow-infra\/get_candidate$/;
const GRANTS: RegExp[] = [
  new RegExp(String.raw`^Allow dynamodb:GetItem (aws_dynamodb_table\.talent_flow_roles\.arn|${arn(ROLES)}) null$`),
  new RegExp(String.raw`^Allow dynamodb:GetItem (aws_dynamodb_table\.talent_flow_config\.arn|${arn(CONFIG)}) null$`),
  new RegExp(String.raw`^Allow dynamodb:Query (\$\{aws_dynamodb_table\.talent_flow_config\.arn\}\/index\/GSI1-active-configs|${arn(CONFIG, String.raw`\/index\/GSI1-active-configs`)}) null$`),
];
/** True when `line` is one of step C's grants on the role policy `key` ("<stack>/<policy or role label>"). */
export const isRec15cGrant = (line: string, key: string): boolean => KEY.test(key) && GRANTS.some((g) => g.test(line));
