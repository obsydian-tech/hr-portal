/**
 * TEN-04.2 (child lock ten-03.3 / ten-05.4): the table-level DynamoDB grants this card and PR 407 (dev read grants, already applied on dev) add to
 * existing Lambda roles. The locked IAM checks of ten-03 AC-10, mod-01 AC-8, rec-01 AC-8 and ten-02 AC-13 allow exactly these (stack, role, action, table)
 * and nothing broader: a table ARN only (no index, no wildcard), Allow, no condition, no Scan.
 *
 * TEN-04.2: createProvisioningBundle Queries the state table (the candidate's company check); getPanelMembers and getHiringManagers Query the tenants
 * table (Member rows). PR 407: getCandidateEvents, acknowledgeTile, snoozeTile Query the state table; captureSentiment GetItems it; markNotificationRead
 * GetItems the notifications table.
 */
const arn = (table: string, label: string) => new RegExp(`^(aws_dynamodb_table\\.${label}\\.arn|arn:aws:dynamodb:[^:]+:[^:]+:table\\/${table})$`);
export const STATE_ARN = new RegExp(`^(aws_dynamodb_table\\.talent_flow_state\\.arn|arn:aws:dynamodb:[^:]+:[^:]+:table\\/(talent-flow-state|\\$\\{local\\.tf_state_table\\}))$`);
export const NOTIFICATIONS_ARN = arn('talent-flow-notifications', 'talent_flow_notifications');
export const TENANTS_ARN = /^(aws_dynamodb_table\.tenants\.arn|arn:aws:dynamodb:[^:]+:[^:]+:table\/(\$\{local\.tf_tenants_table\}|naleko-people-\$\{var\.environment\}-tenants))$/;

export const GRANTS: { role: string; action: string; resource: RegExp }[] = [
  { role: 'infra/create_provisioning_bundle', action: 'dynamodb:Query', resource: STATE_ARN },
  { role: 'talent-flow-infra/get_panel_members', action: 'dynamodb:Query', resource: TENANTS_ARN },
  { role: 'infra/get_hiring_managers', action: 'dynamodb:Query', resource: TENANTS_ARN },
  { role: 'infra/get_candidate_events', action: 'dynamodb:Query', resource: STATE_ARN },
  { role: 'talent-flow-infra/acknowledge_tile', action: 'dynamodb:Query', resource: STATE_ARN },
  { role: 'talent-flow-infra/snooze_tile', action: 'dynamodb:Query', resource: STATE_ARN },
  { role: 'talent-flow-infra/capture_sentiment', action: 'dynamodb:GetItem', resource: STATE_ARN },
  { role: 'talent-flow-infra/mark_notif_read', action: 'dynamodb:GetItem', resource: NOTIFICATIONS_ARN },
];

/** True when `pair` ("Allow <action> <resource> <condition>") on role `stack/role` is one of the grants above. */
export function isCardGrant(pair: string, stack: string, role: string): boolean {
  const [effect, action, res, ...cond] = pair.split(' ');
  return effect === 'Allow' && cond.join(' ') === 'null' && GRANTS.some((g) => g.role === `${stack}/${role}` && g.action === action && g.resource.test(res ?? ''));
}
