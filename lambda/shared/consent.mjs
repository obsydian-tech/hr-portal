/**
 * ONB-05: reading and writing a person's acceptance of the privacy notice, for getMyStart and recordConsent.
 * ONB-06 calls hasCurrentConsent(employeeId) to refuse an upload before consent.
 *
 * employee_consents holds one add-only row per person and notice version: employee_id, notice_version,
 * accepted_at, cognito_sub, notice_sha256, source. No email, name or ID number is stored in it.
 */
import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { CURRENT_NOTICE_VERSION } from './privacy-notice.mjs';

const EMPLOYEES = process.env.EMPLOYEES_TABLE || 'employees';
const CONSENTS = process.env.EMPLOYEE_CONSENTS_TABLE || process.env.CONSENTS_TABLE || 'employee_consents';

const ddb = new DynamoDBClient();

export const NEW_EMPLOYEES_ONLY = 'This page is for new employees';
export const NOT_FOUND = "We can't find your record. Ask your HR team.";

/**
 * True only when Cognito says the token's email is verified (the claim is the string "true" or the boolean true).
 * The person is found by that email, so an address someone has typed in but not proven is never looked up.
 */
export function emailIsVerified(claims) {
  const v = claims?.email_verified;
  return v === true || v === 'true';
}

/**
 * The caller's employee row, found by the token's email on email-index (trimmed, lower case).
 * Returns { row } for exactly one match, or { count } (0, or 2 or more) when there is no single record.
 */
export async function findEmployee(email) {
  const mine = String(email ?? '').trim().toLowerCase();
  if (!mine) return { count: 0 };
  const out = await ddb.send(new QueryCommand({
    TableName: EMPLOYEES,
    IndexName: 'email-index',
    KeyConditionExpression: '#e = :e',
    ExpressionAttributeNames: { '#e': 'email' },
    ExpressionAttributeValues: { ':e': { S: mine } },
    Limit: 2,
  }));
  const items = out.Items ?? [];
  return items.length === 1 ? { row: items[0] } : { count: items.length };
}

/** The stored acceptance of one notice version, or null. */
export async function readConsent(employeeId, version) {
  const out = await ddb.send(new GetItemCommand({
    TableName: CONSENTS,
    Key: { employee_id: { S: employeeId }, notice_version: { S: version } },
  }));
  return out.Item ? { version, acceptedAt: out.Item.accepted_at?.S ?? '' } : null;
}

/**
 * Adds the acceptance. A row that already exists is never changed: the put is conditional, and the
 * first time is returned. Returns { created: true | false, acceptedAt }.
 */
export async function addConsent({ employeeId, version, acceptedAt, sub, hash }) {
  try {
    await ddb.send(new PutItemCommand({
      TableName: CONSENTS,
      Item: {
        employee_id: { S: employeeId },
        notice_version: { S: version },
        accepted_at: { S: acceptedAt },
        cognito_sub: { S: sub },
        notice_sha256: { S: hash },
        source: { S: 'web' },
      },
      ConditionExpression: 'attribute_not_exists(employee_id) AND attribute_not_exists(notice_version)',
    }));
    return { created: true, acceptedAt };
  } catch (e) {
    if (e?.name !== 'ConditionalCheckFailedException') throw e;
    const first = await readConsent(employeeId, version);
    if (!first) throw e;
    return { created: false, acceptedAt: first.acceptedAt };
  }
}

/** True when this person has accepted the current notice version (an older version's row does not count). */
export async function hasCurrentConsent(employeeId) {
  if (!employeeId) return false;
  return (await readConsent(String(employeeId), CURRENT_NOTICE_VERSION)) !== null;
}
