/**
 * Child lock rec-05.1 (REC-05, NH-239, spec rules 12 and 17): what REC-05 changes that older locked tests pinned.
 *
 * 1. The old offer write routes answer 410 { error: 'OLD_ROUTE' } after their existing role, company, module and row checks
 *    (rule 17). rec-01 (routes.ts, Control, AC-2), mod-01 AC-2 and ten-03 Control expected 2xx from them for their own company.
 *    The old read (getOffer) maps old state codes (rule 1) and shows no salary to anyone (rule 9), so rec-01 AC-3 changes too.
 * 2. One new Lambda with its own role, manageOffers (aws_iam_role.manage_offers in talent-flow-infra), and one new read for
 *    monitorTalentFlowSLAs: GetItem on the tenants table, to skip companies with Recruitment off when offers expire (rule 11).
 *    The locked IAM checks of mod-01 AC-8, rec-02 AC-11, rec-04 AC-8, rec-07 AC-9, rec-15 AC-17, rec-15b AC-17 and
 *    ten-03 AC-10 allow exactly these and nothing broader; rec-05.spec.ts AC-10 judges the new role line by line.
 * 3. chat-15 AC-12 counts the Terraform resources added since its baseline; manageOffers' own resources (all named
 *    manage_offers or manage_offers_<something>, in talent-flow-infra) are left out there, as REC-02, REC-04 and REC-14 were.
 *
 * A grant line is "Allow <action> <resource> <condition>" as policyLines() writes it; a key is "<stack>/<policy label>".
 */

/** The two old offer write routes rule 17 retires. */
export const OLD_OFFER_WRITES = ['POST /v1/candidates/{id}/offer', 'PUT /v1/candidates/{id}/offer'];
/** The answer they give now. */
export const OLD_ROUTE = { error: 'OLD_ROUTE' };
export const isOldOfferWrite = (routeName: string): boolean => OLD_OFFER_WRITES.includes(routeName);

/** The policy key of the new role. */
export const REC05_ROLE_KEY = 'talent-flow-infra/manage_offers';
/** True for manageOffers' own role policy (by key or by role label). */
export const isRec05Role = (key: string, role = ''): boolean => key === REC05_ROLE_KEY || role === 'manage_offers';

const TENANTS = String.raw`(aws_dynamodb_table\.tenants\.arn|arn:aws:dynamodb:af-south-1:[^:\s]+:table\/(\$\{local\.tf_tenants_table\}|naleko-people-\$\{var\.environment\}-tenants))`;
const MONITOR_READ = new RegExp(String.raw`^Allow dynamodb:GetItem ${TENANTS} null$`);
const ACTIONS = /^(dynamodb:(GetItem|Query|PutItem|UpdateItem|ConditionCheckItem)|s3:(PutObject|GetObject)|events:PutEvents|cognito-idp:ListUsersInGroup|kms:(Decrypt|DescribeKey|GenerateDataKey)|logs:(CreateLogGroup|CreateLogStream|PutLogEvents)|xray:(PutTraceSegments|PutTelemetryRecords))$/;

/** One line of manageOffers' role, held to the same shape rec-05.spec.ts AC-10 checks. */
const offersLine = (line: string): boolean => {
  const [effect, action, resource, ...rest] = line.split(' ');
  if (effect !== 'Allow' || rest.join(' ') !== 'null' || !ACTIONS.test(action ?? '')) return false;
  const res = resource ?? '';
  if (/^xray:/.test(action!)) return res === '*';
  if (/^logs:/.test(action!)) return /log-group:\/aws\/lambda\/manageOffers(:\*)?$/.test(res);
  if (/^s3:/.test(action!)) return /\/recruitment\/\*$/.test(res) && !/\*/.test(res.replace(/\/recruitment\/\*$/, ''));
  return !/\*/.test(res);
};

/**
 * True when `line` on policy `key` is one REC-05 adds: the tenants GetItem on monitorTalentFlowSLAs' policy, or a line of
 * manageOffers' own role that keeps to the card's actions with no wildcard (S3 only under recruitment/).
 */
export const isRec05Grant = (line: string, key: string): boolean =>
  (/^talent-flow-infra\/monitor_slas$/.test(key) && MONITOR_READ.test(line)) || (key === REC05_ROLE_KEY && offersLine(line));

/** True for a Terraform address ("<stack>/<type>.<label>") of manageOffers' own resources (chat-15 AC-12). */
export const isRec05Resource = (address: string): boolean =>
  /^talent-flow-infra\/aws_(lambda_function|iam_role|iam_role_policy|cloudwatch_log_group|apigatewayv2_integration|apigatewayv2_route|lambda_permission)\.manage_offers(_[a-z_]+)?$/.test(address);
