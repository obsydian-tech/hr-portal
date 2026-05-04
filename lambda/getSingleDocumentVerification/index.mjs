import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const dynamodb = new DynamoDBClient();

export const handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const documentId = event.pathParameters?.id || event.pathParameters?.document_id;

    if (!documentId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'document_id is required' })
      };
    }

    // 1. Find document in documents table
    const docResult = await dynamodb.send(new ScanCommand({
      TableName: 'documents',
      FilterExpression: 'document_id = :id',
      ExpressionAttributeValues: {
        ':id': { S: documentId }
      }
    }));

    if (!docResult.Items || docResult.Items.length === 0) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Document not found' })
      };
    }

    const document = unmarshall(docResult.Items[0]);

    // 2. Get verification record
    let verification = null;
    if (document.verification_id) {
      const verResult = await dynamodb.send(new ScanCommand({
        TableName: 'document-verification',
        FilterExpression: 'verificationId = :id',
        ExpressionAttributeValues: {
          ':id': { S: document.verification_id }
        }
      }));

      if (verResult.Items && verResult.Items.length > 0) {
        const verData = unmarshall(verResult.Items[0]);
        
        // Parse checks JSON if it's a string
        let checks = {};
        try {
          checks = typeof verData.checks === 'string' 
            ? JSON.parse(verData.checks) 
            : verData.checks;
        } catch (e) {
          console.error('Failed to parse checks:', e);
        }

        verification = {
          verification_id: verData.verificationId,
          confidence: verData.confidence,
          decision: verData.decision,
          reasoning: verData.reasoning,
          extracted_data: {
            id_number: verData.idNumber,
            name: verData.name,
            surname: verData.surname,
            date_of_birth: verData.dateOfBirth,
            gender: verData.gender,
            citizenship: verData.citizenship
          },
          checks: checks,
          created_at: verData.createdAt
        };
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        document: {
          document_id: document.document_id,
          employee_id: document.employee_id,
          document_type: document.document_type,
          file_name: document.file_name,
          s3_key: document.s3_key,
          uploaded_at: document.uploaded_at,
          ocr_status: document.ocr_status,
          ocr_completed_at: document.ocr_completed_at
        },
        verification: verification,
        can_reupload: ['MANUAL_REVIEW', 'FAILED', 'PENDING'].includes(document.ocr_status)
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};