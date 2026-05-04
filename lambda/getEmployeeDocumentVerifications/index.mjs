import { DynamoDBClient, QueryCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { KMSClient, DecryptCommand } from "@aws-sdk/client-kms";
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const dynamodb = new DynamoDBClient();
const kms = new KMSClient();

const logger = new Logger({ serviceName: 'getEmployeeDocumentVerifications' });
const tracer = new Tracer({ serviceName: 'getEmployeeDocumentVerifications' });

/**
 * KMS decrypt — returns plain-text string.
 * Handles legacy records that still store idNumber in plain (pre-NH-11).
 * Returns null if ciphertext is missing, sentinel, or decryption fails.
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
    logger.warn('KMS decrypt failed — returning null', { error: err.message });
    return null;
  }
}

const handlerFn = async (event) => {
  logger.info('Handler invoked', { path: event.path, employeeId: event.pathParameters?.employee_id });
  tracer.putAnnotation('operation', 'getEmployeeDocumentVerifications');

  try {
    const employeeId = event.pathParameters?.employee_id;

    if (!employeeId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'employee_id is required' })
      };
    }

    // 1. Get employee details
    const empResult = await dynamodb.send(new QueryCommand({
      TableName: 'employees',
      KeyConditionExpression: 'employee_id = :id',
      ExpressionAttributeValues: {
        ':id': { S: employeeId }
      }
    }));

    if (!empResult.Items || empResult.Items.length === 0) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Employee not found' })
      };
    }

    const employee = unmarshall(empResult.Items[0]);

    // 2. Get employee's documents
    const docsResult = await dynamodb.send(new QueryCommand({
      TableName: 'documents',
      KeyConditionExpression: 'employee_id = :id',
      ExpressionAttributeValues: {
        ':id': { S: employeeId }
      }
    }));

    const documents = docsResult.Items ? docsResult.Items.map(item => unmarshall(item)) : [];

    // 3. Get verifications for each document
    const enrichedDocs = await Promise.all(documents.map(async (doc) => {
      if (!doc.verification_id) {
        return {
          ...doc,
          verification: null,
          can_reupload: true
        };
      }

      try {
        const verResult = await dynamodb.send(new QueryCommand({
          TableName: 'document-verification',
          KeyConditionExpression: 'verificationId = :id',
          ExpressionAttributeValues: {
            ':id': { S: doc.verification_id }
          }
        }));

        const verification = verResult.Items && verResult.Items.length > 0 
          ? unmarshall(verResult.Items[0]) 
          : null;

        // NH-11: decrypt id_number for HR review.
        // New records store idNumber_encrypted (ciphertext) + idNumber_last4.
        // Legacy records (pre-NH-11) may still have idNumber in plain.
        let decryptedIdNumber = null;
        if (verification) {
          if (verification.idNumber_encrypted) {
            decryptedIdNumber = await kmsDecrypt(verification.idNumber_encrypted);
          } else if (verification.idNumber) {
            // Legacy pre-NH-11 record — return as-is
            decryptedIdNumber = verification.idNumber;
          }
        }

        return {
          ...doc,
          verification: verification ? {
            verification_id: verification.verificationId,
            confidence: verification.confidence,
            decision: verification.decision,
            reasoning: verification.reasoning,
            id_number: decryptedIdNumber,
            id_number_last4: verification.idNumber_last4 || null,
            name: verification.name,
            surname: verification.surname,
            date_of_birth: verification.dateOfBirth,
            gender: verification.gender,
            citizenship: verification.citizenship
          } : null,
          can_reupload: ['MANUAL_REVIEW', 'FAILED', 'PENDING'].includes(doc.ocr_status)
        };
      } catch (err) {
        logger.error('Failed to get verification', { error: err });
        return { ...doc, verification: null, can_reupload: true };
      }
    }));

    // 4. Calculate summary
    const summary = {
      total_documents: documents.length,
      passed: enrichedDocs.filter(d => d.ocr_status === 'PASSED').length,
      manual_review: enrichedDocs.filter(d => d.ocr_status === 'MANUAL_REVIEW').length,
      failed: enrichedDocs.filter(d => d.ocr_status === 'FAILED').length
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        employee: {
          employee_id: employee.employee_id,
          first_name: employee.first_name,
          last_name: employee.last_name,
          email: employee.email,
          phone: employee.phone || '',
          stage: employee.stage,
          department: employee.department || '',
          planned_start_date: employee.planned_start_date || '',
          hr_staff_id: employee.hr_staff_id || employee.created_by || '',
          hr_staff_name: employee.hr_staff_name || '',
          hr_staff_email: employee.hr_staff_email || '',
        },
        documents: enrichedDocs.map(doc => ({
          document_id: doc.document_id,
          document_type: doc.document_type,
          file_name: doc.file_name,
          uploaded_at: doc.uploaded_at,
          ocr_status: doc.ocr_status,
          ocr_completed_at: doc.ocr_completed_at,
          verification: doc.verification,
          can_reupload: doc.can_reupload
        })),
        summary
      })
    };

  } catch (error) {
    logger.error('Handler error', { error });
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

export const handler = tracer.captureLambdaHandler(handlerFn);