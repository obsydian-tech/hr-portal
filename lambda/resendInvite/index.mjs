import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import postmark from 'postmark';
import { hrOnly, json } from '../shared/hr-group.mjs';
import { requireTenant, ownsRow, notFound } from '../shared/tenant.mjs';
import { issueInvite } from '../shared/invite.mjs';
import { inviteEmail } from '../shared/invite-email.mjs';
import { isRobotCaller, isRobotEmail } from '../shared/ai-guard.mjs';

const logger = new Logger({ serviceName: 'resendInvite' });
const ddb = new DynamoDBClient();
let mail;

/** POST /v1/employees/{id}/invite  HR only, no body. */
export const handler = async (event) => {
  const refused = hrOnly(event, 'Only HR can send a new link');
  if (refused) return refused;
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;
  const claims = event.requestContext.authorizer.jwt.claims;
  const id = String(event.pathParameters?.id ?? '');
  let item;
  try {
    item = (await ddb.send(new GetItemCommand({ TableName: 'employees', Key: { employee_id: { S: id } } }))).Item;
  } catch (e) {
    logger.error('Invite failed', { employeeId: id, error: e?.name ?? 'Error' });
    return json(502, { status: 'failed' });
  }
  if (!item || !ownsRow({ tenant_id: item.tenant_id?.S }, tenantId)) return notFound();
  if (item.stage?.S !== 'INVITED') return json(409, { status: 'not-invited' });
  const employee = Object.fromEntries(Object.entries(item).map(([k, v]) => [k, v.S ?? v.N ?? null]));
  const sentBy = claims['custom:staff_id'] || claims.sub || 'unknown';
  let invite;
  try {
    invite = await issueInvite({ employee, hrPartner: null, sentBy, tenantId });
  } catch (e) {
    logger.error('Invite failed', { employeeId: id, error: e?.name ?? 'Error' });
    return json(e?.name === 'InviteRefused' ? 409 : 502, { status: e?.name === 'InviteRefused' ? 'refused' : 'failed' });
  }
  const sentAt = invite.sentAt;
  const hrName = employee.hr_staff_name || [claims.given_name, claims.family_name].filter(Boolean).join(' ') || claims.email || '';
  let sent = false;
  let skipped;
  if (isRobotEmail(employee.email) || isRobotCaller(claims)) skipped = 'test';
  else {
    try {
      mail ??= new postmark.ServerClient(process.env.POSTMARK_API_TOKEN);
      const m = inviteEmail({ company: process.env.COMPANY_NAME, firstName: employee.first_name, hrName, link: invite.link, sentAt, expiresAt: invite.expiresAt });
      await mail.sendEmail({ From: process.env.POSTMARK_SENDER_EMAIL, To: employee.email, Subject: m.subject, HtmlBody: m.html, TextBody: m.text, MessageStream: 'outbound' });
      sent = true;
    } catch (e) {
      logger.error('Invite failed', { employeeId: id, step: 'email', error: e?.name ?? 'Error' });
    }
  }
  const showLink = process.env.INVITE_TEST_LINK === 'true' && isRobotEmail(employee.email) && isRobotCaller(claims);
  return json(200, {
    status: 'ok', sentAt, expiresAt: invite.expiresAt, sentTo: employee.email,
    email: { sent, ...(skipped ? { skipped } : {}) },
    ...(showLink ? { invite: { link: invite.link } } : {}),
  });
};
