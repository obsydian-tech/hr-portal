import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const s3 = new S3Client({ region: "af-south-1" });
const dynamodb = new DynamoDBClient({ region: "af-south-1" });

const logger = new Logger({ serviceName: 'generateDocumentUploadUrl' });
const tracer = new Tracer({ serviceName: 'generateDocumentUploadUrl' });

const BUCKET_NAME = "document-ocr-verification-uploads";
const DOCUMENTS_TABLE = "documents";
const EMPLOYEES_TABLE = "employees";
const URL_EXPIRY_SECONDS = 900; // 15 minutes

const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/jpg",
];

const handlerFn = async (event) => {
  logger.info('Handler invoked', {
    employeeId: event.pathParameters?.employee_id,
    httpMethod: event.requestContext?.http?.method,
  });
  tracer.putAnnotation('operation', 'generateDocumentUploadUrl');

  try {
    const employeeId = event.pathParameters?.employee_id;
    if (!employeeId) {
      return errorResponse(400, "Missing path parameter: employee_id");
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const { documentType, fileName, contentType } = body;

    if (!documentType || !fileName) {
      return errorResponse(400, "Missing required fields: documentType, fileName");
    }

    const resolvedContentType = contentType || deriveContentType(fileName);
    if (!ALLOWED_CONTENT_TYPES.includes(resolvedContentType)) {
      return errorResponse(400, `Unsupported content type: ${resolvedContentType}. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`);
    }

    // Validate employee exists
    const employeeExists = await checkEmployeeExists(employeeId);
    if (!employeeExists) {
      return errorResponse(404, `Employee ${employeeId} not found`);
    }

    // Generate document ID and S3 key
    const documentId = `doc_${Date.now()}`;
    const timestamp = new Date().toISOString();
    const s3Key = `uploads/${employeeId}/${documentType}/${documentId}_${fileName}`;

    // Write document record to DynamoDB as PENDING (before upload)
    await dynamodb.send(new PutItemCommand({
      TableName: DOCUMENTS_TABLE,
      Item: {
        employee_id:      { S: employeeId },
        document_id:      { S: documentId },
        document_type:    { S: documentType },
        s3_key:           { S: s3Key },
        file_name:        { S: fileName },
        upload_timestamp: { S: timestamp },
        ocr_status:       { S: "PENDING" },
        verification_id:  { NULL: true },
      },
    }));

    logger.info('Document record created', { documentId, s3Key });

    // Generate presigned PUT URL
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: resolvedContentType,
    });

    const url = await getSignedUrl(s3, command, { expiresIn: URL_EXPIRY_SECONDS });

    logger.info('Presigned PUT URL generated', { documentId, expiresIn: URL_EXPIRY_SECONDS });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        url,
        document_id: documentId,
        s3_key:      s3Key,
        expires_in:  URL_EXPIRY_SECONDS,
      }),
    };

  } catch (err) {
    logger.error('Unexpected error', { errorMessage: err.message, errorName: err.name });
    return errorResponse(500, err.message || "Internal server error");
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function checkEmployeeExists(employeeId) {
  try {
    const result = await dynamodb.send(new GetItemCommand({
      TableName: EMPLOYEES_TABLE,
      Key: { employee_id: { S: employeeId } },
    }));
    return !!result.Item;
  } catch (err) {
    logger.warn('Employee lookup failed', { employeeId, errorMessage: err.message });
    return false;
  }
}

function deriveContentType(fileName) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const map = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
  return map[ext] || 'application/octet-stream';
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
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify({ error: message }),
  };
}

export const handler = tracer.captureAsyncFunction ? tracer.captureAsyncFunction(handlerFn) : handlerFn;
