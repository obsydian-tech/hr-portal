/**
 * Child lock rec-15b.1 (REC-15 step B, NH-266): the one read grant step B adds to an existing TalentFlow Lambda role. The locked IAM
 * checks of mod-01 AC-8, rec-01 AC-8, rec-04 AC-8, rec-07 AC-9, rec-15 AC-17 and ten-03 AC-10 allow exactly this line and nothing broader;
 * rec-15b.spec.ts AC-17 pins it (only GetItem, only on the roles table, only for createCandidate, no wildcard, no new role).
 *
 * - createCandidate GetItems the role row on the roles table: the role decides the title, level, department, hiring manager and criteria
 *   of a new candidate (REC-15 rule 20).
 *
 * A line is "Allow <action> <resource> <condition>" as policyLines() in support/rec-14 writes it.
 */
const ROLES = String.raw`(talent-flow-roles|\$\{local\.tf_table_roles\})`;
const GRANTS: { key: RegExp; line: RegExp }[] = [
  { key: /^talent-flow-infra\/create_candidate$/, line: new RegExp(String.raw`^Allow dynamodb:GetItem (aws_dynamodb_table\.talent_flow_roles\.arn|arn:aws:dynamodb:af-south-1:[^:\s]+:table\/${ROLES}) null$`) },
];
/** True when `line` is step B's grant on the role policy `key` ("<stack>/<policy or role label>"). */
export const isRec15bGrant = (line: string, key: string): boolean => GRANTS.some((g) => g.key.test(key) && g.line.test(line));
