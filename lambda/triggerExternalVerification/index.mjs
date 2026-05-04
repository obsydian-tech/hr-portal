import { DynamoDBClient, GetItemCommand, ScanCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const dynamodb = new DynamoDBClient();

const logger = new Logger({ serviceName: 'triggerExternalVerification' });
const tracer = new Tracer({ serviceName: 'triggerExternalVerification' });

const DOCUMENTS_TABLE        = "documents";
const VERIFICATION_TABLE     = "document-verification";
const EXTERNAL_REQUESTS_TABLE = "external-verification-requests";

// Document types eligible for external verification
const EXTERNAL_VERIFIABLE = new Set(["NATIONAL_ID", "BANK_CONFIRMATION"]);

const PROVIDER_MAP = {
  NATIONAL_ID:        "VerifyNow (Identity)",
  BANK_CONFIRMATION:  "AVS (Bank Account)",
};

/**
 * triggerExternalVerification
 * ---------------------------
 * Route: POST /verifications/{id}/external  (document_upload_api)
 * Auth:  Cognito JWT required
 *
 * Body (optional): { documentType?: string, notes?: string }
 *
 * Stores an external-verification-requests record and returns a confirmation.
 * The actual external provider integration is out of scope for this release;
 * this endpoint closes the client-side mock and provides a real audit trail.
 */
const handlerFn = async (event) => {
  const documentId = event.pathParameters?.id;
  logger.info('Handler invoked', { documentId });
  tracer.putAnnotation('operation', 'triggerExternalVerification');
  if (documentId) tracer.putAnnotation('documentId', documentId);

  try {
    if (!documentId) {
      return errorResponse(400, "Missing path parameter: id");
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const notes = body.notes ?? '';

    // Resolve the document record (we need document_type + employee_id)
    const docRecord = await resolveDocument(documentId);
    if (!docRecord) {
      return errorResponse(404, `Document ${documentId} not found`);
    }

    const { documentType, employeeId } = docRecord;

    if (!EXTERNAL_VERIFIABLE.has(documentType)) {
      return {
        statusCode: 422,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: false,
          message: `External verification is only available for: ${[...EXTERNAL_VERIFIABLE].join(', ')}. ` +
                   `Document type '${documentType}' is not eligible.`,
        }),
      };
    }

    const provider = PROVIDER_MAP[documentType];
    const requestId = `ext_${Date.now()}`;
    const timestamp = new Date().toISOString();

    // Write audit record
    await dynamodb.send(new PutItemCommand({
      TableName: EXTERNAL_REQUESTS_TABLE,
      Item: {
        request_id:    { S: requestId },
        document_id:   { S: documentId },
        employee_id:   { S: employeeId },
        document_type: { S: documentType },
        provider:      { S: provider },
        status:        { S: "PENDING" },
        requested_at:  { S: timestamp },
        notes:         { S: notes },
      },
    }));

    logger.info('External verification request stored', { requestId, documentId, provider });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        message: `Verification request submitted for ${provider}. ` +
                 `Document ID: ${documentId}. Results typically available within 24 hours.`,
        request_id: requestId,
        provider,
        status: "PENDING",
      }),
    };

  } catch (err) {
    logger.error('Unexpected error', { errorMessage: err.message, errorName: err.name });
    return errorResponse(500, err.message || "Internal server error");
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a document record by document_id.
 * documents table has employee_id (PK) + document_id (SK), so we scan.
 */
async function resolveDocument(documentId) {
  try {
    const result = await dynamodb.send(new ScanCommand({
      TableName: DOCUMENTS_TABLE,
      FilterExpression: "document_id = :docId",
      ExpressionAttributeValues: { ":docId": { S: documentId } },
      ProjectionExpression: "document_id, employee_id, document_type",
      Limit: 10,
    }));
    const item = result.Items?.[0];
    if (!item) return null;
    return {
      documentType: item.document_type?.S,
      employeeId:   item.employee_id?.S,
    };
  } catch (err) {
    logger.error('resolveDocument error', { errorMessage: err.message });
    return null;
  }
}

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function errorResponse(statusCode, message) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify({ error: message }) };
}

export const handler = tracer.captureAsyncFunction ? tracer.captureAsyncFunction(handlerFn) : handlerFn;
