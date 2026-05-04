import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const s3 = new S3Client({ region: "af-south-1" });
const dynamodb = new DynamoDBClient({ region: "af-south-1" });

const logger = new Logger({ serviceName: 'uploadDocumentToS3' });
const tracer = new Tracer({ serviceName: 'uploadDocumentToS3' });

const BUCKET_NAME = "document-ocr-verification-uploads";
const DOCUMENTS_TABLE = "documents";
const EMPLOYEES_TABLE = "employees";

const handlerFn = async (event) => {
  logger.info('Handler invoked', { employeeId: event.pathParameters?.employee_id, httpMethod: event.httpMethod });
  tracer.putAnnotation('operation', 'uploadDocumentToS3');

  try {
    // 1. Parse request
    const body = JSON.parse(event.body);
    const employeeId = event.pathParameters?.employee_id;
    const { documentType, fileName, fileContent } = body;

    // 2. Validate required fields
    if (!employeeId || !documentType || !fileName || !fileContent) {
      return errorResponse(400, "Missing required fields: employee_id, documentType, fileName, fileContent");
    }

    // 3. Validate employee exists (optional but recommended)
    const employeeExists = await checkEmployeeExists(employeeId);
    if (!employeeExists) {
      return errorResponse(404, `Employee ${employeeId} not found`);
    }

    // 4. Generate document ID and timestamp
    const documentId = `doc_${Date.now()}`;
    const timestamp = new Date().toISOString();

    // 5. Create S3 key - UPDATED to include uploads/ folder
    const s3Key = `uploads/${employeeId}/${documentType}/${documentId}_${fileName}`;

    // 6. Upload to S3
    // const fileBuffer = Buffer.from(fileContent, 'base64');
    // await s3.send(new PutObjectCommand({
    //   Bucket: BUCKET_NAME,
    //   Key: s3Key,
    //   Body: fileBuffer,
    //   ContentType: body.contentType || 'application/pdf',
    // }));

    // console.log(`✅ Uploaded to S3: ${s3Key}`);

    // 6. Upload to S3
    try {
      const fileBuffer = Buffer.from(fileContent, 'base64');
      logger.info('Starting S3 upload', { bucket: BUCKET_NAME, key: s3Key, contentType: body.contentType || 'application/pdf', fileSize: fileBuffer.length });
      
      const uploadCommand = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: body.contentType || 'application/pdf',
      });
      
      const uploadResult = await s3.send(uploadCommand);
      logger.info('S3 upload successful', { key: s3Key });
      
    } catch (s3Error) {
      logger.error('S3 upload failed', { errorName: s3Error.name, errorMessage: s3Error.message });
      throw new Error(`S3 upload failed: ${s3Error.message}`);
    }

    // 7. Write to documents table
    await dynamodb.send(new PutItemCommand({
      TableName: DOCUMENTS_TABLE,
      Item: {
        employee_id: { S: employeeId },
        document_id: { S: documentId },
        document_type: { S: documentType },
        s3_key: { S: s3Key },
        file_name: { S: fileName },
        upload_timestamp: { S: timestamp },
        ocr_status: { S: "PENDING" },
        verification_id: { NULL: true },
      }
    }));

    logger.info('Saved to documents table', { documentId });

    // 8. Return success
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        // NH-12 deprecation notice: this endpoint will be removed in the next release.
        // Use POST /employees/{employee_id}/documents/upload-url instead.
        "Sunset": "Sat, 01 Aug 2026 00:00:00 GMT",
        "Deprecation": "true",
        "Link": '</employees/{employee_id}/documents/upload-url>; rel="successor-version"',
      },
      body: JSON.stringify({
        message: "Document uploaded successfully",
        document_id: documentId,
        employee_id: employeeId,
        s3_key: s3Key,
        ocr_status: "PENDING",
      })
    };

  } catch (error) {
    logger.error('Handler error', { error });
    return errorResponse(500, error.message);
  }
};

export const handler = handlerFn;

// Helper: Check if employee exists
async function checkEmployeeExists(employeeId) {
  try {
    const result = await dynamodb.send(new GetItemCommand({
      TableName: EMPLOYEES_TABLE,
      Key: { employee_id: { S: employeeId } }
    }));
    logger.debug('Employee lookup', { employeeId, found: !!result.Item });
    return !!result.Item;
  } catch (error) {
    logger.error('Error checking employee', { error });
    return false;
  }
}

// Helper: Error response
function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify({ error: message })
  };
}

// Helper: CORS headers
function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}