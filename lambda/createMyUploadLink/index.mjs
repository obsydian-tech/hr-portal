import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { isIdToken, json } from '../shared/hr-group.mjs';
import { groupsOf } from '../shared/document-check.mjs';
import { NEW_EMPLOYEES_ONLY, NOT_FOUND, emailIsVerified, findEmployee, hasCurrentConsent } from '../shared/consent.mjs';
import { requireTenant, ownsRow, stampTenant } from '../shared/tenant.mjs';
import { LINK_EXPIRES_IN, checkBody, parseBody, shownFileName, uploadKey } from '../shared/upload-link.mjs';

const logger = new Logger({ serviceName: 'createMyUploadLink' });

// A newer SDK adds a checksum of an empty body to a signed link by default, and S3 then refuses the real file.
// Only add one when S3 asks for it.
const s3 = new S3Client({ region: 'af-south-1', requestChecksumCalculation: 'WHEN_REQUIRED' });
const ddb = new DynamoDBClient();

const BUCKET = process.env.UPLOAD_BUCKET ?? 'document-ocr-verification-uploads';
const DOCUMENTS = process.env.DOCUMENTS_TABLE || 'documents';
const CONSENT_FIRST = 'Accept the privacy notice first.';

/**
 * POST /v1/me/documents/upload-url (Cognito JWT). A 15 minute link that lets the signed-in new employee put one
 * file into their own record. The link binds the file's type and size. The person comes only from the token.
 */
export const handler = async (event) => {
  // The group comes first: nothing is read or signed for anyone who is not an employee.
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

  // The body: words for every mistake, never a 500. An employee_id in it is never read.
  const parsed = parseBody(event);
  if (!parsed.ok) return json(400, { error: 'Missing required fields: documentType, fileName, contentType, fileSize' });
  const checked = checkBody(parsed.value);
  if (!checked.ok) return json(400, { error: checked.error });
  const { documentType, fileName, contentType, fileSize } = checked.value;

  try {
    const found = await findEmployee(claims.email, tenantId);
    if (!found.row) {
      logger.warn('No single employee record for this sign-in', { sub: claims.sub, records: found.count });
      return json(404, { error: NOT_FOUND });
    }
    const e = found.row;
    if (!ownsRow({ tenant_id: e.tenant_id?.S }, tenantId)) return json(404, { error: NOT_FOUND });
    const employeeId = e.employee_id.S;

    if (!(await hasCurrentConsent(employeeId))) {
      logger.warn('Upload refused: the privacy notice is not accepted', { sub: claims.sub });
      return json(403, { error: CONSENT_FIRST });
    }

    const documentId = `doc_${Date.now()}`;
    const key = uploadKey(employeeId, documentType, documentId, fileName);
    const row = stampTenant({
      employee_id: employeeId,
      document_id: documentId,
      document_type: documentType,
      s3_key: key,
      file_name: shownFileName(fileName),
      upload_timestamp: new Date().toISOString(),
      ocr_status: 'PENDING',
      verification_id: null,
    }, tenantId);
    // The row is written as the old route writes it, before the file arrives (processDocumentOCR finds it by key).
    await ddb.send(new PutItemCommand({
      TableName: DOCUMENTS,
      Item: Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? { NULL: true } : { S: v }])),
      ConditionExpression: 'attribute_not_exists(document_id)',
    }));

    // The signature binds the type and the size, so S3 refuses a body of another type or size.
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType, ContentLength: fileSize }), {
      expiresIn: LINK_EXPIRES_IN,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return json(200, { url, documentId, expiresIn: LINK_EXPIRES_IN, headers: { 'Content-Type': contentType } });
  } catch (error) {
    logger.error('Could not make the upload link', { sub: claims.sub, errorName: error?.name ?? 'Error' });
    return json(500, { error: 'Something went wrong' });
  }
};
