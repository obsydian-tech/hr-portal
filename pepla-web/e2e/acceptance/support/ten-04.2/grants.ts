/**
 * TEN-04.2 (child lock ten-03.3 / ten-05.4): the table-level DynamoDB grants this card and PR 407 (dev read grants, already applied on dev) add to
 * existing Lambda roles. The locked IAM checks of ten-03 AC-10, mod-01 AC-8, rec-01 AC-8 and ten-02 AC-13 allow exactly these (stack, role, action, table)
 * and nothing broader: a table ARN only (no index, no wildcard), Allow, no condition, no Scan.
 *
 * TEN-04.2: createProvisioningBundle Queries the state table (the candidate's company check); getPanelMembers and getHiringManagers Query the tenants
 * table (Member rows). PR 407: getCandidateEvents, acknowledgeTile, snoozeTile Query the state table; captureSentiment GetItems it; markNotificationRead
 * GetItems the notifications table.
 * Child lock ten-03.17: getCandidate Queries the state table for the candidate's interviews (lambda/getCandidate/index.js, the interviews lookup); its role had GetItem only; talent-flow-iam.tf names the table local.tf_table_state, so the table pattern accepts that name too. talentFlowAiChat Queries the config table's one active-configs index (lambda/talentFlowAiChat/tool-resolver.mjs), so that single index is allowed for the ai_chat role and nothing broader.
 */
const arn = (table: string, label: string) => new RegExp(`^(aws_dynamodb_table\\.${label}\\.arn|arn:aws:dynamodb:[^:]+:[^:]+:table\\/${table})$`);
export const STATE_ARN = new RegExp(`^(aws_dynamodb_table\\.talent_flow_state\\.arn|arn:aws:dynamodb:[^:]+:[^:]+:table\\/(talent-flow-state|\\$\\{local\\.(tf_state_table|tf_table_state)\\}))$`);
export const NOTIFICATIONS_ARN = arn('talent-flow-notifications', 'talent_flow_notifications');
export const CONFIG_ACTIVE_INDEX_ARN = /^arn:aws:dynamodb:[^:]+:[^:]+:table\/(talent-flow-config|\$\{local\.tf_table_config\})\/index\/GSI1-active-configs$/;
export const CONFIG_TABLE_ARN = /^arn:aws:dynamodb:[^:]+:[^:]+:table\/(talent-flow-config|\$\{local\.tf_table_config\})$/;
export const TENANTS_ARN = /^(aws_dynamodb_table\.tenants\.arn|arn:aws:dynamodb:[^:]+:[^:]+:table\/(\$\{local\.tf_tenants_table\}|naleko-people-\$\{var\.environment\}-tenants))$/;

export const GRANTS: { role: string; action: string; resource: RegExp }[] = [
  { role: 'infra/create_provisioning_bundle', action: 'dynamodb:Query', resource: STATE_ARN },
  { role: 'talent-flow-infra/get_panel_members', action: 'dynamodb:Query', resource: TENANTS_ARN },
  { role: 'infra/get_hiring_managers', action: 'dynamodb:Query', resource: TENANTS_ARN },
  { role: 'infra/get_candidate_events', action: 'dynamodb:Query', resource: STATE_ARN },
  { role: 'talent-flow-infra/acknowledge_tile', action: 'dynamodb:Query', resource: STATE_ARN },
  { role: 'talent-flow-infra/snooze_tile', action: 'dynamodb:Query', resource: STATE_ARN },
  { role: 'talent-flow-infra/get_candidate', action: 'dynamodb:Query', resource: STATE_ARN },
  { role: 'talent-flow-infra/ai_chat', action: 'dynamodb:Query', resource: CONFIG_ACTIVE_INDEX_ARN },
  { role: 'talent-flow-infra/capture_sentiment', action: 'dynamodb:GetItem', resource: STATE_ARN },
  // Child lock rec-12.1 (REC-12): the settings readers. createCandidate and captureSentiment lock a candidate to the active version of every
  // setting (Query on the active-configs index, GetItem of a version row); scheduleInterview's Query on that index was missing.
  { role: 'talent-flow-infra/create_candidate', action: 'dynamodb:Query', resource: CONFIG_ACTIVE_INDEX_ARN },
  { role: 'talent-flow-infra/create_candidate', action: 'dynamodb:GetItem', resource: CONFIG_TABLE_ARN },
  { role: 'talent-flow-infra/capture_sentiment', action: 'dynamodb:Query', resource: CONFIG_ACTIVE_INDEX_ARN },
  { role: 'talent-flow-infra/capture_sentiment', action: 'dynamodb:GetItem', resource: CONFIG_TABLE_ARN },
  { role: 'talent-flow-infra/schedule_interview', action: 'dynamodb:Query', resource: CONFIG_ACTIVE_INDEX_ARN },
  { role: 'talent-flow-infra/mark_notif_read', action: 'dynamodb:GetItem', resource: NOTIFICATIONS_ARN },
];

/** True when `pair` ("Allow <action> <resource> <condition>") on role `stack/role` is one of the grants above. */
export function isCardGrant(pair: string, stack: string, role: string): boolean {
  const [effect, action, res, ...cond] = pair.split(' ');
  return effect === 'Allow' && cond.join(' ') === 'null' && GRANTS.some((g) => g.role === `${stack}/${role}` && g.action === action && g.resource.test(res ?? ''));
}
