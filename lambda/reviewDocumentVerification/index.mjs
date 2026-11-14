import { DynamoDBClient, ScanCommand, UpdateItemCommand, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { withIdempotency } from '../shared/idempotency.mjs';
import { groupsOf, hrDecisionOf } from '../shared/document-check.mjs';
import { requiredFor, requiredMissing } from '../shared/required-documents.mjs';
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
  // API GW route is PATCH /v1/verifications/{id}/review — passes pathParameters.id
  const documentId = event.pathParameters?.id || event.pathParameters?.document_id;
  logger.info('Handler invoked', { documentId });
  tracer.putAnnotation('operation', 'reviewDocumentVerification');

  if (!documentId) {
    return respond(400, { error: 'Missing document_id path parameter' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { decision, employee_id: bodyEmployeeId } = body ?? {};
  if (!decision || !['PASSED', 'FAILED'].includes(decision)) {
    return respond(400, { error: 'decision must be "PASSED" or "FAILED"' });
  }
  // ONB-15: the reason is trimmed, and at most 500 characters. The page asks for one; the server does not
  // yet (the old app's reject sends none). Nothing is written on a 400.
  const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
  if (notes.length > 500) {
    return respond(400, { error: 'The reason is too long' });
  }

  // Who decides, from the ID token: the email, and the given and family name (else the email).
  const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
  const decidedBy = String(claims.email ?? '');
  const decidedByName = `${claims.given_name ?? ''} ${claims.family_name ?? ''}`.trim() || decidedBy;

  try {
    // 1. Fetch the document record.
    // NH-101: prefer GetItem (O(1)) when the caller supplies employee_id in the
    // request body. Fall back to a Scan (all pages) only when employee_id is absent
    // (e.g., older clients) so backward-compatibility is preserved during rollout.
    let docRecord;
    if (bodyEmployeeId) {
      const getResult = await dynamo.send(new GetItemCommand({
        TableName: DOCUMENTS_TABLE,
        Key: {
          employee_id: { S: bodyEmployeeId },
          document_id: { S: documentId },
        },
      }));
      if (!getResult.Item) {
        return respond(404, { error: 'Document not found' });
      }
      docRecord = getResult.Item;
    } else {
      // Fallback: Scan (O(n) — avoid at scale). A Scan returns one page at a time, so follow every page.
      let startKey;
      do {
        const docScan = await dynamo.send(new ScanCommand({
          TableName: DOCUMENTS_TABLE,
          FilterExpression: 'document_id = :docId',
          ExpressionAttributeValues: { ':docId': { S: documentId } },
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        }));
        if (docScan.Items && docScan.Items.length > 0) {
          docRecord = docScan.Items[0];
          break;
        }
        startKey = docScan.LastEvaluatedKey;
      } while (startKey);
      if (!docRecord) {
        return respond(404, { error: 'Document not found' });
      }
    }

    const employeeId = docRecord.employee_id.S;
    const verificationId = docRecord.verification_id?.S;

    // 2. Decide, with one conditional write: a document is decided once, and never while Batsi is still
    //    reading it. Two HR users, or two tabs, cannot both win. ONB-15.
    const now = new Date().toISOString();
    try {
      await dynamo.send(new UpdateItemCommand({
        TableName: DOCUMENTS_TABLE,
        Key: {
          employee_id: { S: employeeId },
          document_id: { S: documentId },
        },
        UpdateExpression: 'SET ocr_status = :status, hr_reviewed_at = :now, hr_reviewed_by = :by, hr_reviewed_by_name = :byName, hr_decision_notes = :notes, can_reupload = :reupload',
        ConditionExpression: 'attribute_not_exists(hr_reviewed_at) AND NOT ocr_status IN (:pending, :processing)',
        ExpressionAttributeValues: {
          ':status': { S: decision },
          ':now': { S: now },
          ':by': { S: decidedBy },
          ':byName': { S: decidedByName },
          ':notes': { S: notes },
          ':reupload': { BOOL: decision === 'FAILED' },
          ':pending': { S: 'PENDING' },
          ':processing': { S: 'PROCESSING' },
        },
      }));
    } catch (err) {
      if (err?.name === 'ConditionalCheckFailedException') {
        return respond(409, { error: 'This document was already decided or is still being read' });
      }
      throw err;
    }
    logger.info('Updated document', { documentId, decision });

    // 2b. Publish document.reviewed event (NH-14). The audit log stores it, so it holds who and when.
    await publishEvent('document.reviewed', {
      document_id: documentId,
      employee_id: employeeId,
      decision,
      notes,
      decided_by: decidedBy,
      decided_by_name: decidedByName,
      decided_at: now,
      actor: 'HUMAN',
    });

    // 3. Update the document-verification table if a verification record exists
    if (verificationId) {
      const updateVerParams = {
        TableName: VERIFICATION_TABLE,
        Key: { verificationId: { S: verificationId } },
        UpdateExpression: 'SET decision = :decision, reviewedAt = :now, reviewNotes = :notes',
        ExpressionAttributeValues: {
          ':decision': { S: decision },
          ':now': { S: now },
          ':notes': { S: notes },
        },
      };
      await dynamo.send(new UpdateItemCommand(updateVerParams));
      logger.info('Updated verification', { verificationId, decision });
    }

    // 4. ONB-08: Verified when HR has accepted every required document (the newest read copy of each).
    //    Optional documents never decide it. Follow every page of the Query.
    const allDocs = [];
    let docsKey;
    do {
      const page = await dynamo.send(new QueryCommand({
        TableName: DOCUMENTS_TABLE,
        KeyConditionExpression: 'employee_id = :empId',
        ExpressionAttributeValues: { ':empId': { S: employeeId } },
        ...(docsKey ? { ExclusiveStartKey: docsKey } : {}),
      }));
      allDocs.push(...(page.Items || []));
      docsKey = page.LastEvaluatedKey;
    } while (docsKey);

    const plainDocs = allDocs.map((item) => ({
      document_id: item.document_id?.S,
      document_type: item.document_type?.S,
      ocr_status: item.ocr_status?.S,
      hr_reviewed_at: item.hr_reviewed_at?.S,
      upload_timestamp: item.upload_timestamp?.N ?? item.upload_timestamp?.S,
    }));
    const required = requiredFor(null);
    const missing = requiredMissing(plainDocs, required);
    const allPassed = missing.length === 0;

    let stageUpdated = false;
    if (allPassed) {
      // Update employee stage to VERIFIED
      // ConditionExpression guards against setting VERIFIED if stage somehow
      // never reached DOCUMENTS_SUBMITTED (NH-80 — enforce correct sequence).
      try {
        await dynamo.send(new UpdateItemCommand({
          TableName: EMPLOYEES_TABLE,
          Key: { employee_id: { S: employeeId } },
          UpdateExpression: 'SET stage = :stage, verified_at = :now',
          ConditionExpression: 'stage = :ds OR stage = :active OR stage = :invited',
          ExpressionAttributeValues: {
            ':stage':   { S: 'VERIFIED' },
            ':now':     { S: new Date().toISOString() },
            ':ds':      { S: 'DOCUMENTS_SUBMITTED' },
            ':active':  { S: 'ACTIVE' },
            ':invited': { S: 'INVITED' },
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
      required_documents: required,
      required_missing: missing,
      employee_stage_updated: stageUpdated,
      hr_decision: hrDecisionOf({ ocr_status: decision, hr_reviewed_at: now }),
      hr_decided_at: now,
      hr_decided_by_name: decidedByName,
      hr_decision_reason: decision === 'FAILED' && notes ? notes : null,
    });

  } catch (err) {
    logger.error('Handler error', { error: err });
    return respond(500, { error: 'Internal server error' });
  }
};

// NH-44: Wrap handler with idempotency protection.
// Clients send `Idempotency-Key: <uuid-v4>` header on PATCH /v1/verifications/{id}/review.
// A repeated call with the same key within 24h returns the cached response
// without re-applying a review decision or re-firing EventBridge events.
export const handler = async (event) => {
  // ONB-07 security review: only HR decides. This route shares its authorizer with employee uploads,
  // so the group is checked here, before any read or write (and before the idempotency cache).
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims || !groupsOf(claims).includes('hr_staff')) {
    return respond(403, { error: 'Only HR can decide on a document' });
  }
  const key = event.headers?.['idempotency-key'];
  return withIdempotency(key, () => handlerFn(event));
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}
