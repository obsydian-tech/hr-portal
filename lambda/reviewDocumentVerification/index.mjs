import { DynamoDBClient, ScanCommand, UpdateItemCommand, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const dynamo = new DynamoDBClient({ region: 'af-south-1' });
const cloudwatch = new CloudWatchClient({ region: 'af-south-1' });
const eb = new EventBridgeClient({ region: 'af-south-1' });

const logger = new Logger({ serviceName: 'reviewDocumentVerification' });
const tracer = new Tracer({ serviceName: 'reviewDocumentVerification' });

async function publishEvent(detailType, detail) {
  if (!process.env.EVENT_BUS_NAME) return;
  try {
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: process.env.EVENT_BUS_NAME,
        Source: 'naleko.onboarding',
        DetailType: detailType,
        Detail: JSON.stringify(detail),
      }],
    }));
  } catch (err) {
    logger.warn('EventBridge publish failed', { detailType, error: err.message });
  }
}

const DOCUMENTS_TABLE = 'documents';
const VERIFICATION_TABLE = 'document-verification';
const EMPLOYEES_TABLE = 'employees';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

const handlerFn = async (event) => {
  logger.info('Handler invoked', { documentId: event.pathParameters?.document_id });
  tracer.putAnnotation('operation', 'reviewDocumentVerification');

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

    // 2b. Publish document.reviewed event (NH-14)
    await publishEvent('document.reviewed', {
      document_id: documentId,
      employee_id: employeeId,
      decision,
      notes: notes || '',
    });

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

        // Publish stage change and onboarding completed events (NH-14)
        await publishEvent('employee.stage_changed', {
          employee_id: employeeId,
          from_stage: 'DOCUMENTS_SUBMITTED',
          to_stage: 'VERIFIED',
        });
        await publishEvent('onboarding.completed', { employee_id: employeeId });

        // Publish TimeToComplete custom metric (NH-34)
        try {
          // Fetch employee record to get created_at timestamp
          const empRecord = await dynamo.send(new GetItemCommand({
            TableName: EMPLOYEES_TABLE,
            Key: { employee_id: { S: employeeId } },
            ProjectionExpression: 'created_at',
          }));
          const createdAt = empRecord.Item?.created_at?.S;
          if (createdAt) {
            const durationMinutes = (Date.now() - new Date(createdAt).getTime()) / 60000;
            await cloudwatch.send(new PutMetricDataCommand({
              Namespace: 'Naleko/Onboarding',
              MetricData: [{
                MetricName: 'TimeToComplete',
                Value: durationMinutes,
                Unit: 'None',
                Dimensions: [{ Name: 'Environment', Value: process.env.ENVIRONMENT || 'prod' }],
              }],
            }));
            logger.info('Published TimeToComplete metric', { employeeId, durationMinutes });
          }
        } catch (metricErr) {
          // Non-fatal — metric failure must not block the review response
          logger.warn('Failed to publish TimeToComplete metric', { employeeId, error: metricErr });
        }
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

export const handler = handlerFn;

function respond(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}
