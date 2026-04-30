import { DynamoDBClient, ScanCommand, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';

const dynamo = new DynamoDBClient({ region: 'af-south-1' });

const logger = new Logger({ serviceName: 'reviewDocumentVerification' });

const DOCUMENTS_TABLE = 'documents';
const VERIFICATION_TABLE = 'document-verification';
const EMPLOYEES_TABLE = 'employees';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-staff-id',
  'Content-Type': 'application/json',
};

export const handler = async (event) => {
  logger.info('Handler invoked', { documentId: event.pathParameters?.document_id });

  const documentId = event.pathParameters?.document_id;
  if (!documentId) {
    return respond(400, { error: 'Missing document_id path parameter' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { decision, notes } = body;
  if (!decision || !['PASSED', 'FAILED'].includes(decision)) {
    return respond(400, { error: 'decision must be "PASSED" or "FAILED"' });
  }

  try {
    // 1. Find the document record by scanning (document_id is a sort key)
    const docScan = await dynamo.send(new ScanCommand({
      TableName: DOCUMENTS_TABLE,
      FilterExpression: 'document_id = :docId',
      ExpressionAttributeValues: { ':docId': { S: documentId } },
    }));

    if (!docScan.Items || docScan.Items.length === 0) {
      return respond(404, { error: 'Document not found' });
    }

    const docRecord = docScan.Items[0];
    const employeeId = docRecord.employee_id.S;
    const verificationId = docRecord.verification_id?.S;

    // 2. Update the documents table: ocr_status → PASSED/FAILED, can_reupload on FAILED
    const updateDocParams = {
      TableName: DOCUMENTS_TABLE,
      Key: {
        employee_id: { S: employeeId },
        document_id: { S: documentId },
      },
      UpdateExpression: 'SET ocr_status = :status, hr_reviewed_at = :now, hr_decision_notes = :notes, can_reupload = :reupload',
      ExpressionAttributeValues: {
        ':status': { S: decision },
        ':now': { S: new Date().toISOString() },
        ':notes': { S: notes || '' },
        ':reupload': { BOOL: decision === 'FAILED' },
      },
    };
    await dynamo.send(new UpdateItemCommand(updateDocParams));
    logger.info('Updated document', { documentId, decision });

    // 3. Update the document-verification table if a verification record exists
    if (verificationId) {
      const updateVerParams = {
        TableName: VERIFICATION_TABLE,
        Key: { verificationId: { S: verificationId } },
        UpdateExpression: 'SET decision = :decision, reviewedAt = :now, reviewNotes = :notes',
        ExpressionAttributeValues: {
          ':decision': { S: decision },
          ':now': { S: new Date().toISOString() },
          ':notes': { S: notes || '' },
        },
      };
      await dynamo.send(new UpdateItemCommand(updateVerParams));
      logger.info('Updated verification', { verificationId, decision });
    }

    // 4. Check if ALL documents for this employee are now PASSED
    //    If so, auto-progress the employee stage to VERIFIED
    const allDocs = await dynamo.send(new QueryCommand({
      TableName: DOCUMENTS_TABLE,
      KeyConditionExpression: 'employee_id = :empId',
      ExpressionAttributeValues: { ':empId': { S: employeeId } },
    }));

    const allPassed = allDocs.Items && allDocs.Items.length > 0 &&
      allDocs.Items.every((item) => item.ocr_status?.S === 'PASSED');

    let stageUpdated = false;
    if (allPassed) {
      // Update employee stage to VERIFIED
      // employees table has PK = employee_id (no sort key based on scan usage)
      try {
        await dynamo.send(new UpdateItemCommand({
          TableName: EMPLOYEES_TABLE,
          Key: { employee_id: { S: employeeId } },
          UpdateExpression: 'SET stage = :stage, verified_at = :now',
          ExpressionAttributeValues: {
            ':stage': { S: 'VERIFIED' },
            ':now': { S: new Date().toISOString() },
          },
        }));
        stageUpdated = true;
        logger.info('Employee stage updated to VERIFIED', { employeeId });
      } catch (stageErr) {
        logger.error('Failed to update employee stage', { employeeId, error: stageErr });
        // Non-fatal — the document review itself succeeded
      }
    }

    return respond(200, {
      message: `Document ${documentId} marked as ${decision}`,
      document_id: documentId,
      employee_id: employeeId,
      decision,
      can_reupload: decision === 'FAILED',
      all_documents_passed: allPassed,
      employee_stage_updated: stageUpdated,
    });

  } catch (err) {
    logger.error('Handler error', { error: err });
    return respond(500, { error: 'Internal server error', details: err.message });
  }
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}
