import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const dynamodb = new DynamoDBClient({ region: "af-south-1" });
const s3 = new S3Client({ region: "af-south-1" });

const BUCKET = "document-ocr-verification-uploads";
const DOCUMENTS_TABLE = "documents";
const URL_EXPIRY_SECONDS = 900; // 15 minutes

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    const documentId = event.pathParameters?.document_id;
    if (!documentId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "document_id is required" }) };
    }

    // Look up the document record to get s3_key
    const scanResult = await dynamodb.send(new ScanCommand({
      TableName: DOCUMENTS_TABLE,
      FilterExpression: "document_id = :docId",
      ExpressionAttributeValues: { ":docId": { S: documentId } },
      Limit: 100,
    }));

    const docItem = scanResult.Items?.[0];
    if (!docItem) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Document not found" }) };
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
      ResponseContentDisposition: `inline; filename="${fileName}"`,
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
    console.error("Error generating pre-signed URL:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to generate document preview URL" }),
    };
  }
};
