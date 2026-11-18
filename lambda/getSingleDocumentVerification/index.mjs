import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { requireTenant, ownsItem, notFound } from '../shared/tenant.mjs';
import { findDocument as findCompanyDocument } from '../shared/company-rows.mjs';
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { KMSClient, DecryptCommand } from "@aws-sdk/client-kms";
import { requireHr, checkOf, hrDecisionOf, comparisonsOf } from '../shared/document-check.mjs';

const dynamodb = new DynamoDBClient();
const kms = new KMSClient();

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

/**
 * KMS decrypt, returns plain text, or null when there is no ciphertext, it is a sentinel, or it fails.
 * Same rule as getEmployeeDocumentVerifications.
 */
async function kmsDecrypt(ciphertext) {
  if (!ciphertext || ciphertext === 'NOT_FOUND' || ciphertext === 'KMS_UNAVAILABLE') return null;
  try {
    const result = await kms.send(new DecryptCommand({
      KeyId: process.env.KMS_KEY_ARN,
      CiphertextBlob: Buffer.from(ciphertext, 'base64'),
    }));
    return Buffer.from(result.Plaintext).toString('utf8');
  } catch (err) {
    console.warn('KMS decrypt failed, returning null', err?.name);
    return null;
  }
}

const unusable = (v) => v === undefined || v === null || ['', 'NOT_FOUND', 'KMS_UNAVAILABLE'].includes(String(v).trim());
/** ONB-14: a number can be shown when the row holds one (ciphertext, or a plain one from before NH-11). */
const idAvailable = (row) => (row.idNumber_encrypted ? !unusable(row.idNumber_encrypted) : !unusable(row.idNumber));
const accountAvailable = (row) => !unusable(row.accountNumber);

/** The document row within the caller's company: one GetItem when the caller gave employee_id, else the company's rows. */
async function findDocument(documentId, employeeId, tenantId) {
  if (employeeId) {
    const got = await dynamodb.send(new GetItemCommand({
      TableName: 'documents',
      Key: { employee_id: { S: employeeId }, document_id: { S: documentId } },
    }));
    return ownsItem(got.Item, tenantId) ? unmarshall(got.Item) : null;
  }
  const item = await findCompanyDocument(documentId, tenantId);
  return item ? unmarshall(item) : null;
}

export const handler = async (event) => {
  // ONB-15: only HR, before any table, key or file is touched.
  const refused = requireHr(event);
  if (refused) return refused;
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;

  try {
    const documentId = event.pathParameters?.id || event.pathParameters?.document_id;
    if (!documentId) return json(400, { error: 'document_id is required' });
    const employeeIdParam = event.queryStringParameters?.employee_id || undefined;

    // 1. The document
    const document = await findDocument(documentId, employeeIdParam, tenantId);
    if (!document) return notFound();

    // 2. The verification row (its key is verificationId) and the employee
    const verData = document.verification_id
      ? await dynamodb.send(new GetItemCommand({
          TableName: 'document-verification',
          Key: { verificationId: { S: document.verification_id } },
        })).then((r) => (ownsItem(r.Item, tenantId) ? unmarshall(r.Item) : null))
      : null;

    const employee = document.employee_id
      ? await dynamodb.send(new GetItemCommand({
          TableName: 'employees',
          Key: { employee_id: { S: document.employee_id } },
          ProjectionExpression: 'employee_id, first_name, last_name, id_number_last4, tenant_id',
        })).then((r) => (ownsItem(r.Item, tenantId) ? unmarshall(r.Item) : null))
      : null;

    // 3. What the verification says. The ID number is encrypted since NH-11; old rows hold it plain.
    let verification = null;
    let idNumber = null;
    if (verData) {
      let checks = {};
      try {
        checks = typeof verData.checks === 'string' ? JSON.parse(verData.checks) : (verData.checks ?? {});
      } catch (e) {
        console.error('Failed to parse checks');
      }
      idNumber = verData.idNumber_encrypted ? await kmsDecrypt(verData.idNumber_encrypted) : (verData.idNumber ?? null);
      verification = {
        verification_id: verData.verificationId,
        confidence: verData.confidence,
        decision: verData.decision,
        reasoning: verData.reasoning,
        extracted_data: {
          // ONB-14: the full numbers leave this answer. They come only from POST /v1/verifications/{id}/reveal, which records the Show.
          id_number_last4: verData.idNumber_last4 ?? null,
          account_number_last4: accountAvailable(verData) ? String(verData.accountNumber).trim().slice(-4) : null,
          id_number_available: idAvailable(verData),
          account_number_available: accountAvailable(verData),
          name: verData.name,
          surname: verData.surname,
          date_of_birth: verData.dateOfBirth,
          gender: verData.gender,
          citizenship: verData.citizenship,
          account_holder: verData.accountHolder,
          bank_name: verData.bankName,
          branch_code: verData.branchCode,
          account_type: verData.accountType,
        },
        checks,
        created_at: verData.createdAt,
      };
    }

    const decision = hrDecisionOf(document);
    const notes = String(document.hr_decision_notes ?? '').trim();
    const comparisons = comparisonsOf(
      document.document_type,
      verData ? { idNumber, idLast4: verData.idNumber_last4, surname: verData.surname, accountHolder: verData.accountHolder } : null,
      { last_name: employee?.last_name, id_number_last4: employee?.id_number_last4 },
    );

    return json(200, {
      document: {
        document_id: document.document_id,
        employee_id: document.employee_id,
        document_type: document.document_type,
        file_name: document.file_name,
        s3_key: document.s3_key,
        uploaded_at: document.uploaded_at ?? document.upload_timestamp ?? null,
        ocr_status: document.ocr_status,
        ocr_completed_at: document.ocr_completed_at,
      },
      verification,
      can_reupload: ['MANUAL_REVIEW', 'FAILED', 'PENDING'].includes(document.ocr_status),
      employee: employee
        ? { employee_id: employee.employee_id, first_name: employee.first_name, last_name: employee.last_name }
        : null,
      check: checkOf(document, verData),
      hr_decision: decision,
      hr_decided_at: document.hr_reviewed_at || null,
      hr_decided_by_name: document.hr_reviewed_by_name || null,
      hr_decision_reason: decision === 'NEW_ONE_ASKED' && notes ? notes : null,
      comparisons,
    });
  } catch (error) {
    console.error('Error loading document', error?.name);
    return json(500, { error: 'Document could not be loaded' });
  }
};
