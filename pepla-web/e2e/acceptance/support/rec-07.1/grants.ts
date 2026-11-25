/**
 * Child lock rec-07.1 (REC-07, NH-241): the two read grants REC-07 adds to existing TalentFlow Lambda roles. The locked IAM checks of
 * mod-01 AC-8, rec-01 AC-8, rec-04 AC-8, rec-15 AC-17 and ten-03 AC-10 allow exactly these two lines and nothing broader; rec-07.spec.ts
 * AC-9 pins them (only GetItem or Query, only on the state or roles table, only for REC-07's handlers, no wildcard, no new role).
 *
 * - scheduleInterview GetItems the role row on the roles table, to copy the role's criteria onto the interview (REC-07 rule 1).
 * - submitVote Queries the state table's new interview-id-index, to find an interview by its own id (POST /v1/interviews/{id}/votes).
 *
 * A line is "Allow <action> <resource> <condition>" as policyLines() in support/rec-14 writes it.
 */
const STATE = String.raw`(talent-flow-state|\$\{local\.(tf_state_table|tf_table_state)\})`;
const ROLES = String.raw`(talent-flow-roles|\$\{local\.tf_table_roles\})`;
const GRANTS: { key: RegExp; line: RegExp }[] = [
  { key: /^talent-flow-infra\/schedule_interview$/, line: new RegExp(String.raw`^Allow dynamodb:GetItem (aws_dynamodb_table\.talent_flow_roles\.arn|arn:aws:dynamodb:af-south-1:[^:\s]+:table\/${ROLES}) null$`) },
  { key: /^talent-flow-infra\/submit_vote$/, line: new RegExp(String.raw`^Allow dynamodb:Query arn:aws:dynamodb:af-south-1:[^:\s]+:table\/${STATE}\/index\/interview-id-index null$`) },
];
/** True when `line` is one of REC-07's two grants on the role policy `key` ("<stack>/<policy or role label>"). */
export const isRec07Grant = (line: string, key: string): boolean => GRANTS.some((g) => g.key.test(key) && g.line.test(line));
