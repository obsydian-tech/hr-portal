import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { isIdToken, json } from '../shared/hr-group.mjs';
import { groupsOf } from '../shared/document-check.mjs';
import { NEW_EMPLOYEES_ONLY, NOT_FOUND, emailIsVerified, findEmployee } from '../shared/consent.mjs';
import { requireTenant, ownsRow, tenantFilter } from '../shared/tenant.mjs';
import { requiredFor } from '../shared/required-documents.mjs';
import { DOCUMENT_TYPES } from '../shared/upload-link.mjs';

const logger = new Logger({ serviceName: 'getMyDocuments' });
const ddb = new DynamoDBClient();
const DOCUMENTS = process.env.DOCUMENTS_TABLE || 'documents';

/** Only these attributes of a documents row are read. Nothing about the check, the key or the verification. */
const READ = 'document_id, document_type, ocr_status, ocr_started_at, ocr_completed_at, hr_reviewed_at, hr_reviewed_by_name, hr_decision_notes, upload_timestamp, file_name';

/** A row counts when a file arrived: it is not PENDING, or the reader has started or finished on it. */
const counts = (r) => r.ocr_status !== 'PENDING' || !!r.ocr_started_at || !!r.ocr_completed_at;

/** What one stored row means for the person. */
function stateOf(r) {
  if (r.ocr_status === 'PASSED' && r.hr_reviewed_at) return 'ACCEPTED';
  if (r.ocr_status === 'FAILED') return 'SENT_BACK';
  return 'WITH_HR';
}

/** When the row was uploaded, in ms: its upload_timestamp, else the number in doc_<ms>. */
function uploadedMs(r) {
  const raw = r.upload_timestamp;
  if (raw !== undefined && raw !== '') {
    const ms = /^\d+$/.test(String(raw)) ? Number(raw) : Date.parse(String(raw));
    if (Number.isFinite(ms)) return ms;
  }
  const fromId = Number(String(r.document_id ?? '').replace(/^doc_/, ''));
  return Number.isFinite(fromId) ? fromId : 0;
}

/** Newest first; the same time goes to the larger document id. */
const newestFirst = (a, b) => {
  const d = uploadedMs(b) - uploadedMs(a);
  if (d !== 0) return d;
  return String(a.document_id ?? '') < String(b.document_id ?? '') ? 1 : -1;
};

const uploadedAt = (r) => {
  const ms = uploadedMs(r);
  return ms > 0 ? new Date(ms).toISOString() : '';
};

/** ONB-20: a trimmed value, or null when it is empty. */
const orNull = (v) => {
  const t = String(v ?? '').trim();
  return t ? t : null;
};

/** The person sees HR's name, never an email: a stored name that is an email address is not given. */
const nameOrNull = (v) => {
  const t = orNull(v);
  return t && !t.includes('@') ? t : null;
};

/** One file of the answer. Only a sent-back file carries when it came back, who sent it back and why. */
function fileOf(r) {
  const state = stateOf(r);
  const file = { fileName: r.file_name, uploadedAt: uploadedAt(r), state };
  if (state !== 'SENT_BACK') return file;
  return { ...file, returnedAt: orNull(r.hr_reviewed_at), returnedBy: nameOrNull(r.hr_reviewed_by_name), reason: orNull(r.hr_decision_notes) };
}

/** Every row of one employee in the caller's company, every page. */
async function readRows(employeeId, tenantId) {
  const t = tenantFilter(tenantId);
  const rows = [];
  let start;
  do {
    const out = await ddb.send(new QueryCommand({
      TableName: DOCUMENTS,
      KeyConditionExpression: '#emp = :emp',
      FilterExpression: t.FilterExpression,
      ProjectionExpression: READ,
      ExpressionAttributeNames: { '#emp': 'employee_id', ...t.ExpressionAttributeNames },
      ExpressionAttributeValues: { ':emp': { S: employeeId }, ':tenant_id': { S: tenantId } },
      ExclusiveStartKey: start,
    }));
    for (const item of out.Items ?? []) {
      rows.push({
        document_id: item.document_id?.S ?? '',
        document_type: item.document_type?.S ?? '',
        ocr_status: item.ocr_status?.S ?? '',
        ocr_started_at: item.ocr_started_at?.S ?? '',
        ocr_completed_at: item.ocr_completed_at?.S ?? '',
        hr_reviewed_at: item.hr_reviewed_at?.S ?? '',
        hr_reviewed_by_name: item.hr_reviewed_by_name?.S ?? '',
        hr_decision_notes: item.hr_decision_notes?.S ?? '',
        upload_timestamp: item.upload_timestamp?.S ?? '',
        file_name: item.file_name?.S ?? '',
      });
    }
    start = out.LastEvaluatedKey;
  } while (start);
  return rows;
}

/**
 * GET /v1/me/documents (Cognito JWT). The new employee's own four documents and the state of each.
 * Nothing but the type, whether it is required, its state and each file's name, time and state.
 * ONB-20: a SENT_BACK file also carries returnedAt, returnedBy (HR's name, never the email) and reason.
 */
export const handler = async (event) => {
  // The group comes first: nothing is read for anyone who is not an employee.
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  if (!claims || !isIdToken(claims) || !groupsOf(claims).includes('employee')) return json(403, { error: NEW_EMPLOYEES_ONLY });
  // The record is found by the token's email, so the email must be a verified one.
  if (!emailIsVerified(claims)) {
    logger.warn('The sign-in email is not verified', { sub: claims.sub });
    return json(403, { error: NEW_EMPLOYEES_ONLY });
  }
  // The company comes from the token only.
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;

  try {
    const found = await findEmployee(claims.email, tenantId);
    if (!found.row) {
      logger.warn('No single employee record for this sign-in', { sub: claims.sub, records: found.count });
      return json(404, { error: NOT_FOUND });
    }
    const e = found.row;
    if (!ownsRow({ tenant_id: e.tenant_id?.S }, tenantId)) return json(404, { error: NOT_FOUND });

    const rows = (await readRows(e.employee_id.S, tenantId)).filter(counts);
    const required = requiredFor(tenantId);
    const documents = DOCUMENT_TYPES.map((type) => {
      const mine = rows.filter((r) => r.document_type === type).sort(newestFirst);
      return {
        type,
        required: required.includes(type),
        state: mine.length ? stateOf(mine[0]) : 'NOT_UPLOADED',
        files: mine.map(fileOf),
      };
    });
    return json(200, { documents });
  } catch (error) {
    logger.error('Could not load the documents', { sub: claims.sub, errorName: error?.name ?? 'Error' });
    return json(500, { error: 'Something went wrong' });
  }
};
