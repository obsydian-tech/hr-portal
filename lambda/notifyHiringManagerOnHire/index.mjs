/**
 * REC-16 (NH-283): one email to the hiring manager when an offer is accepted, in Iggie's approved words, asking them to set up the IT
 * provisioning bundle. Runs from the CandidateHired event (rule talent-flow-candidate-hired-notify-hm-it, no input transformer).
 * Spec: onboarding-cards/specs/REC-16.md rules 1 to 11.
 */
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import postmark from 'postmark';
import { ownsRow, stampTenant } from '../shared/tenant.mjs';
import { hiringManagerPeopleOf } from '../shared/hiring-managers.mjs';
import { isRobotEmail } from '../shared/ai-guard.mjs';

function requireSetting(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing setting ${name}`);
  }
  return value;
}

const MODE = requireSetting('HM_IT_EMAIL_MODE');
if (MODE !== 'TEST_ADDRESS' && MODE !== 'HIRING_MANAGER') throw new Error('Missing setting HM_IT_EMAIL_MODE (TEST_ADDRESS or HIRING_MANAGER)');
const TEST_EMAIL = requireSetting('HM_IT_TEST_EMAIL');
if (!isRobotEmail(TEST_EMAIL)) throw new Error('Missing setting HM_IT_TEST_EMAIL (a @blackhole.postmarkapp.com address)');
const TOKEN = requireSetting('POSTMARK_API_TOKEN');
const SENDER = requireSetting('POSTMARK_SENDER_EMAIL');
const STATE = requireSetting('STATE_TABLE');
requireSetting('TENANTS_TABLE');
requireSetting('HM_COGNITO_POOL_ID');

const db = new DynamoDBClient({});
const mail = new postmark.ServerClient(TOKEN);

const SUBJECT = (name) => `Action required: Set up IT provisioning for ${name}`;
const BODY = (name) => `The offer for ${name} has been accepted. Please create their IT provisioning bundle at your earliest convenience.`;
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const clean = (s) => (typeof s === 'string' ? s.replace(CONTROL, '').trim() : '');
const goodId = (v) => typeof v === 'string' && v.length > 0 && v.length < 200;
// eslint-disable-next-line no-control-regex
const HAS_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const goodEmail = (e) => typeof e === 'string' && e.length > 0 && (e.match(/@/g) ?? []).length === 1 && !/\s/.test(e) && !HAS_CONTROL.test(e);

function log(outcome, d, error) {
  console.log(JSON.stringify({ outcome, offer_id: goodId(d?.offer_id) ? d.offer_id : null, candidate_id: goodId(d?.candidate_id) ? d.candidate_id : null, ...(error ? { error } : {}) }));
}
const getRow = async (pk, sk) => {
  const out = await db.send(new GetItemCommand({ TableName: STATE, Key: marshall({ PK: pk, SK: sk }), ConsistentRead: true }));
  return out.Item ? unmarshall(out.Item) : undefined;
};
const answeredByPostmark = (e) => typeof e?.statusCode === 'number' && e.statusCode > 0;

export const handler = async (event) => {
  const d = event?.detail ?? {};
  if (event?.['detail-type'] !== 'CandidateHired' || event?.source !== 'talent-flow.workflow') return log('WRONG_EVENT', d);
  if (![d.tenant_id, d.offer_id, d.candidate_id, d.employee_id].every(goodId)) return log('BAD_EVENT', d);
  const tenant = d.tenant_id;

  const offer = await getRow(`OFFER#${d.offer_id}`, 'OFFER');
  if (!offer || !ownsRow(offer, tenant)) return log('OFFER_NOT_FOUND', d);
  if (offer.state !== 'ACCEPTED' || offer.candidate_id !== d.candidate_id || offer.employee_id !== d.employee_id) return log('OFFER_NOT_ACCEPTED', d);
  const cand = await getRow(`CANDIDATE#${d.candidate_id}`, 'SAGA');
  if (!cand || !ownsRow(cand, tenant)) return log('CANDIDATE_NOT_FOUND', d);
  const hmId = cand.hiringManagerId;
  if (typeof hmId !== 'string' || hmId.trim() === '') return log('NO_HIRING_MANAGER', d);
  const people = await hiringManagerPeopleOf(tenant);
  const hm = people.find((p) => p.sub === hmId);
  if (!hm) return log('HIRING_MANAGER_NOT_IN_COMPANY', d);
  if (!goodEmail(hm.email)) return log('HIRING_MANAGER_NO_EMAIL', d);
  const name = [clean(cand.firstName), clean(cand.lastName)].filter(Boolean).join(' ');
  if (!name) return log('NO_CANDIDATE_NAME', d);

  const key = { PK: `NOTICE#HM_IT#${d.offer_id}`, SK: 'NOTICE' };
  try {
    await db.send(new PutItemCommand({
      TableName: STATE,
      Item: marshall(stampTenant({ ...key, status: 'SENDING', claimed_at: new Date().toISOString(), offer_id: d.offer_id, candidate_id: d.candidate_id }, tenant)),
      ConditionExpression: 'attribute_not_exists(PK) OR #status = :failed',
      ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: marshall({ ':failed': 'FAILED' }),
    }));
  } catch (e) {
    if (e?.name === 'ConditionalCheckFailedException') return log('ALREADY_SENT', d);
    throw e;
  }

  const recipient = MODE === 'HIRING_MANAGER' ? 'HIRING_MANAGER' : 'TEST_ADDRESS';
  const body = BODY(name);
  let res;
  try {
    res = await mail.sendEmail({ From: SENDER, To: recipient === 'HIRING_MANAGER' ? hm.email : TEST_EMAIL, Subject: SUBJECT(name), TextBody: body, HtmlBody: `<p>${escapeHtml(body)}</p>`, MessageStream: 'outbound' });
  } catch (e) {
    if (answeredByPostmark(e)) {
      try {
        await db.send(new UpdateItemCommand({
          TableName: STATE, Key: marshall(key), UpdateExpression: 'SET #status = :failed, failed_at = :at, #error = :e',
          ConditionExpression: '#status = :sending AND tenant_id = :t', ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
          ExpressionAttributeValues: marshall({ ':failed': 'FAILED', ':at': new Date().toISOString(), ':e': e?.name ?? 'Error', ':sending': 'SENDING', ':t': tenant }),
        }));
      } catch { /* the claim stays; no second email */ }
      log('SEND_FAILED', d, e?.name ?? 'Error');
      throw new Error('SEND_FAILED');
    }
    return log('SEND_UNKNOWN', d, e?.name ?? 'Error');
  }
  if (!res?.MessageID) return log('SEND_UNKNOWN', d, 'NoMessageID');
  try {
    await db.send(new UpdateItemCommand({
      TableName: STATE, Key: marshall(key),
      UpdateExpression: 'SET #status = :sent, sent_at = :at, message_id = :m, recipient = :r, hm_sub = :hm',
      ConditionExpression: '#status = :sending AND tenant_id = :t', ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: marshall({ ':sent': 'SENT', ':at': new Date().toISOString(), ':m': res.MessageID, ':r': recipient, ':hm': hm.sub, ':sending': 'SENDING', ':t': tenant }),
    }));
  } catch (e) {
    return log('MARK_FAILED', d, e?.name ?? 'Error');
  }
  return log('SENT', d);
};
