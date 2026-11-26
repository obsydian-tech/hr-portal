'use strict';
// INT-04 (NH-277) rule 10: the send-only path for INTERVIEW_EMAIL messages. Claims a once-only guard row, sends one Postmark email
// (to the test address unless INTERVIEW_EMAIL_MODE is REAL), records the outcome. Logs only { outcome, email_id, template, error? }.
const { PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const TEMPLATES = ['E1', 'E2', 'E3', 'E4P', 'E4G', 'E4C', 'E5P', 'E5G', 'E5C', 'E6P', 'E6G'];
const ID = /^[A-Za-z0-9_-]{1,64}#\d{1,9}#(E1|E2|E3|E4P|E4G|E4C|E5P|E5G|E5C|E6P|E6G)#[A-Za-z0-9_-]{1,64}$/;
const log = (outcome, body, error) => console.info(JSON.stringify({ outcome, email_id: typeof body?.email_id === 'string' && ID.test(body.email_id) ? body.email_id : null, template: TEMPLATES.includes(body?.template) ? body.template : null, ...(error ? { error } : {}) }));

class SettingsBad extends Error { constructor() { super('SETTINGS_BAD'); this.name = 'SettingsBad'; } }
class SendFailed extends Error { constructor() { super('SEND_FAILED'); this.name = 'SendFailed'; } }

async function sendInterviewEmail(body, tenantId, deps) {
  const E = await import('../shared/interview-emails.mjs');
  const { isRobotEmail } = await import('../shared/ai-guard.mjs');
  const mode = process.env.INTERVIEW_EMAIL_MODE;
  const testTo = process.env.INTERVIEW_TEST_EMAIL;
  if (!['TEST_ADDRESS', 'REAL'].includes(mode) || !isRobotEmail(testTo) || !E.EMAIL_PATTERN.test(String(testTo).trim())) { log('SETTINGS_BAD', body); throw new SettingsBad(); }
  const t = body.template;
  const ok = typeof body.email_id === 'string' && ID.test(body.email_id) && E.TEMPLATE_KEYS.includes(t) && body.email_id.split('#')[2] === t
    && typeof body.recipientEmail === 'string' && E.EMAIL_PATTERN.test(body.recipientEmail)
    && typeof body.subject === 'string' && body.subject && !/[\u0000-\u001f\u007f]/.test(body.subject)
    && typeof body.text === 'string' && typeof body.html === 'string'
    && (E.CANDIDATE_TEMPLATES.includes(t) ? typeof body.reply_to === 'string' && E.EMAIL_PATTERN.test(body.reply_to) : body.reply_to === undefined)
    && body.attachment && typeof body.attachment.name === 'string' && typeof body.attachment.content_base64 === 'string'
    && typeof body.attachment.content_type === 'string' && body.attachment.content_type.startsWith('text/calendar');
  if (!ok) { log('BAD_MESSAGE', body); return; }
  const table = process.env.NOTIFICATIONS_TABLE_NAME;
  const key = { PK: `INTERVIEW_EMAIL#${body.email_id}`, SK: 'EMAIL' };
  const claimedAt = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 86400;
  const row = (status, extra = {}) => ({ ...key, status, tenant_id: tenantId, template: t, claimed_at: claimedAt, expiresAt, ...extra });
  const db = deps.db();
  const client = deps.postmark(); // a missing token throws here, before the claim, so the message is retried
  try {
    await db.send(new PutItemCommand({ TableName: table, Item: marshall(row('SENDING')), ConditionExpression: 'attribute_not_exists(PK) OR #s = :failed', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: marshall({ ':failed': 'FAILED' }) }));
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') { log('ALREADY_SENT', body); return; }
    throw err;
  }
  const recipient = mode === 'REAL' ? 'REAL' : 'TEST_ADDRESS';
  const to = mode === 'REAL' ? body.recipientEmail : String(testTo).trim();
  const mark = (status, extra) => db.send(new PutItemCommand({ TableName: table, Item: marshall(row(status, extra)), ConditionExpression: '#s = :sending', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: marshall({ ':sending': 'SENDING' }) }));
  let res;
  try {
    res = await client.sendEmail({
      From: process.env.POSTMARK_SENDER_EMAIL, To: to, Subject: body.subject, TextBody: body.text, HtmlBody: body.html,
      ...(body.reply_to ? { ReplyTo: body.reply_to } : {}),
      Attachments: [{ Name: body.attachment.name, Content: body.attachment.content_base64, ContentType: body.attachment.content_type }],
      MessageStream: 'outbound', TrackOpens: false, TrackLinks: 'None',
    });
  } catch (err) {
    const status = Number(err?.statusCode);
    if (Number.isInteger(status) && status >= 400 && status <= 499) {
      await mark('FAILED', { recipient });
      log('SEND_FAILED', body, err?.name ?? 'Error');
      throw new SendFailed();
    }
    log('SEND_UNKNOWN', body, err?.name ?? 'Error');
    return;
  }
  if (!res || typeof res.MessageID !== 'string' || !res.MessageID) { log('SEND_UNKNOWN', body, 'NoMessageId'); return; }
  await mark('SENT', { message_id: res.MessageID, recipient });
  log('SENT', body);
}

module.exports = { sendInterviewEmail };
