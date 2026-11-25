/**
 * Child lock rec-15d.1 (REC-15 step D, NH-279): the four lines step D adds, two on each of two existing role policies, so the interviews
 * read and the history can show people's names (REC-15 rules 24 and 28, spec check D-9). The locked IAM checks of mod-01 AC-8, rec-01
 * AC-8, rec-02 AC-11, rec-04 AC-8, rec-07 AC-9, rec-15 AC-17, rec-15b AC-17, rec-15c AC-17, ten-02 AC-13 and ten-03 AC-10 allow exactly these lines
 * and nothing broader; rec-15d.spec.ts AC-17 pins them (each once, only on these two policies, no wildcard, no new role or policy).
 *
 * - aws_iam_role_policy.schedule_interview (talent-flow-infra): AdminGetUser on the Naleko pool; Query on the tenants table (Member rows).
 * - aws_iam_role_policy.get_candidate_events (infra): AdminGetUser on the Naleko pool; Query on the tenants table (Member rows).
 * Table only: no index, no `*`.
 *
 * A line is "Allow <action> <resource> <condition>" as policyLines() in support/rec-04 writes it; a key is "<stack>/<policy label>".
 */
const TF_POOL = String.raw`arn:aws:cognito-idp:af-south-1:[^:\s]+:userpool\/\$\{(local\.tf_naleko_pool_id|var\.naleko_pool_id)\}`;
const TF_TENANTS = String.raw`arn:aws:dynamodb:af-south-1:[^:\s]+:table\/(\$\{local\.tf_tenants_table\}|naleko-people-\$\{var\.environment\}-tenants)`;
const GRANTS: Record<string, RegExp[]> = {
  'talent-flow-infra/schedule_interview': [
    new RegExp(String.raw`^Allow cognito-idp:AdminGetUser ${TF_POOL} null$`),
    new RegExp(String.raw`^Allow dynamodb:Query ${TF_TENANTS} null$`),
  ],
  'infra/get_candidate_events': [
    new RegExp(String.raw`^Allow cognito-idp:AdminGetUser (aws_cognito_user_pool\.naleko_dev\.arn|arn:aws:cognito-idp:af-south-1:[^:\s]+:userpool\/\$\{aws_cognito_user_pool\.naleko_dev\.id\}) null$`),
    new RegExp(String.raw`^Allow dynamodb:Query aws_dynamodb_table\.tenants\.arn null$`),
  ],
};
/** The four lines, by policy key, for a test that needs them one by one. */
export const REC15D_GRANTS = GRANTS;
/** True when `line` is one of step D's grants on the role policy `key` ("<stack>/<policy label>"). */
export const isRec15dGrant = (line: string, key: string): boolean => (GRANTS[key] ?? []).some((g) => g.test(line));
