import { DynamoDBClient, ScanCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { requireHr, groupsOf } from '../shared/document-check.mjs';
import { isHrOrOwner, isIdToken } from '../shared/hr-group.mjs';

const dynamodb = new DynamoDBClient({ region: "af-south-1" });
const s3 = new S3Client({ region: "af-south-1" });

const logger = new Logger({ serviceName: 'getDocumentPresignedUrl' });
const tracer = new Tracer({ serviceName: 'getDocumentPresignedUrl' });

const BUCKET = process.env.UPLOAD_BUCKET ?? "document-ocr-verification-uploads";
const DOCUMENTS_TABLE = "documents";
const URL_EXPIRY_SECONDS = 900; // 15 minutes

const handlerFn = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // BE-17: no claims, no call. HR as before; anyone else only for their own document.
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return requireHr(event, headers);
  const isHr = isIdToken(claims) && groupsOf(claims).includes('hr_staff');
  const notYours = { statusCode: 403, headers, body: JSON.stringify({ error: "You can only open your own documents" }) };

  try {
    // API GW route is GET /v1/documents/{id}/url — passes pathParameters.id
    const documentId = event.pathParameters?.id || event.pathParameters?.document_id;
    tracer.putAnnotation('operation', 'getDocumentPresignedUrl');
    if (documentId) tracer.putAnnotation('documentId', documentId);
    if (!documentId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "document_id is required" }) };
    }

    // Look up the document record to get s3_key. A Scan returns one page at a time, so follow every page
    // and stop at the first match.
    let docItem;
    let startKey;
    do {
      const scanResult = await dynamodb.send(new ScanCommand({
        TableName: DOCUMENTS_TABLE,
        FilterExpression: "document_id = :docId",
        ExpressionAttributeValues: { ":docId": { S: documentId } },
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }));
      docItem = scanResult.Items?.[0];
      startKey = docItem ? undefined : scanResult.LastEvaluatedKey;
    } while (startKey);
    if (!docItem) {
      return isHr ? { statusCode: 404, headers, body: JSON.stringify({ error: "Document not found" }) } : notYours;
    }
    if (!isHr) {
      const emp = await dynamodb.send(new GetItemCommand({
        TableName: "employees",
        Key: { employee_id: { S: docItem.employee_id?.S ?? "" } },
        ProjectionExpression: "email",
      }));
      if (!emp.Item || !isHrOrOwner(claims, { email: emp.Item.email?.S ?? "" })) return notYours;
    }

    const s3Key = docItem.s3_key?.S;
    const fileName = docItem.file_name?.S || "document";
    if (!s3Key) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Document has no S3 key" }) };
    }

    // Determine content type from file extension
    const ext = fileName.split(".").pop()?.toLowerCase();
    const contentTypeMap = {
      pdf: "application/pdf",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
    };
    const contentType = contentTypeMap[ext] || "application/octet-stream";

    // Generate pre-signed URL
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      ResponseContentType: contentType,
      ResponseContentDisposition: contentDisposition(fileName),
    });

    const url = await getSignedUrl(s3, command, { expiresIn: URL_EXPIRY_SECONDS });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        url,
        file_name: fileName,
        content_type: contentType,
        expires_in: URL_EXPIRY_SECONDS,
      }),
    };
  } catch (error) {
    logger.error('Error generating pre-signed URL', { errorName: error?.name ?? 'Error' });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to generate document preview URL" }),
    };
  }
};

function contentDisposition(name) {
  let encoded;
  try {
    encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  } catch {
    name = 'document';
    encoded = 'document';
  }
  const ascii = [...name].map((c) => (/^[\x20-\x7E]$/.test(c) && c !== '"' && c !== '\\' ? c : '_')).join('');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export const handler = handlerFn;
