/**
 * ONB-14: POST /v1/verifications/{id}/reveal  body { field: "id_number" | "account_number", employee_id }
 * HR only. Reads the one full number, publishes document.field_shown, and answers only when the bus took the entry.
 */
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { requireTenant, ownsItem, notFound } from '../shared/tenant.mjs';
import { groupsOf } from '../shared/document-check.mjs';
import { isIdToken } from '../shared/hr-group.mjs';

const dynamodb = new DynamoDBClient();
const kms = new KMSClient();
// A hung bus gives a 500 after about 3 seconds, not a long wait with the number in memory.
const bus = new EventBridgeClient({ region: 'af-south-1', maxAttempts: 3, requestHandler: new NodeHttpHandler({ requestTimeout: 3000, connectionTimeout: 3000 }) });

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const FIELD_TYPE = { id_number: 'NATIONAL_ID', account_number: 'BANK_CONFIRMATION' };
const missing = (v) => v === undefined || v === null || String(v).trim() === '' || ['NOT_FOUND', 'KMS_UNAVAILABLE'].includes(String(v).trim());

async function decrypt(ciphertext) {
  try {
    const out = await kms.send(new DecryptCommand({ KeyId: process.env.KMS_KEY_ARN, CiphertextBlob: Buffer.from(ciphertext, 'base64') }));
    return Buffer.from(out.Plaintext).toString('utf8');
  } catch (err) {
    console.warn('KMS decrypt failed', err?.name);
    return null;
  }
}

export const handler = async (event) => {
  if (event?.requestContext?.http?.method === 'OPTIONS') return json(204, {});
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  if (!claims || !isIdToken(claims) || !groupsOf(claims).includes('hr_staff')) return json(403, { error: 'Only HR can show a number' });
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;

  let input;
  try {
    input = JSON.parse(event.body ?? '');
  } catch {
    return json(400, { error: 'Body must be valid JSON' });
  }
  const field = input?.field;
  if (field !== 'id_number' && field !== 'account_number') return json(400, { error: 'Unknown field' });
  const employeeId = input?.employee_id;
  if (typeof employeeId !== 'string' || employeeId === '') return json(400, { error: 'employee_id is required' });
  const documentId = event.pathParameters?.id;
  if (!documentId) return json(400, { error: 'document_id is required' });

  try {
    const got = await dynamodb.send(new GetItemCommand({ TableName: 'documents', Key: { employee_id: { S: employeeId }, document_id: { S: documentId } } }));
    if (!ownsItem(got.Item, tenantId)) return notFound();
    const document = unmarshall(got.Item);
    if (document.document_type !== FIELD_TYPE[field] || !document.verification_id) return notFound();
    const ver = await dynamodb.send(new GetItemCommand({ TableName: 'document-verification', Key: { verificationId: { S: document.verification_id } } }));
    if (!ownsItem(ver.Item, tenantId)) return notFound();
    const row = unmarshall(ver.Item);
    if (row.employeeId !== undefined && row.employeeId !== document.employee_id) return notFound();

    let value = null;
    if (field === 'id_number') {
      if (row.idNumber_encrypted && !missing(row.idNumber_encrypted)) value = await decrypt(row.idNumber_encrypted);
      else if (!row.idNumber_encrypted && !missing(row.idNumber)) value = String(row.idNumber);
    } else if (!missing(row.accountNumber)) {
      value = String(row.accountNumber);
    }
    if (missing(value)) return notFound();

    // Recorded before shown: the bus takes the entry, then the number leaves.
    if (!process.env.EVENT_BUS_NAME) throw new Error('EVENT_BUS_NAME is not set');
    const name = [claims.given_name, claims.family_name].filter(Boolean).join(' ').trim() || claims.email;
    const sent = await bus.send(new PutEventsCommand({
      Entries: [{
        EventBusName: process.env.EVENT_BUS_NAME,
        Source: 'naleko.onboarding',
        DetailType: 'document.field_shown',
        Detail: JSON.stringify({
          document_id: document.document_id,
          employee_id: document.employee_id,
          document_type: document.document_type,
          field,
          shown_by: claims.email,
          shown_by_sub: claims.sub,
          shown_by_name: name,
          shown_at: new Date().toISOString(),
          actor: 'HUMAN',
          tenant_id: tenantId,
        }),
      }],
    }));
    if (sent.FailedEntryCount > 0 || sent.Entries?.[0]?.ErrorCode) throw new Error('The audit bus did not take the entry');
    return json(200, { value });
  } catch (err) {
    console.error('Show failed', err?.name);
    return json(500, { error: 'Internal server error' });
  }
};
