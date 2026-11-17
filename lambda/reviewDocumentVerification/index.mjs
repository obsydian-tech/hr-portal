import { DynamoDBClient, UpdateItemCommand, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { requireTenant, ownsItem, notFound, tenantFilter } from '../shared/tenant.mjs';
import { findDocument } from '../shared/company-rows.mjs';
import { withIdempotency } from '../shared/idempotency.mjs';
import { groupsOf, hrDecisionOf } from '../shared/document-check.mjs';
import { isIdToken } from '../shared/hr-group.mjs';
import { requiredFor, requiredMissing } from '../shared/required-documents.mjs';
import { stepFromDocuments } from '../shared/onboarding-step.mjs';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

// BE-15: a setting that names one environment has no fallback value. A missing
// one stops the Lambda when it starts, with one clear line in the log.
function requireSetting(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing setting ${name}`);
    throw new Error(`Missing setting ${name}`);
  }
  return value;
}

const ENVIRONMENT = requireSetting('ENVIRONMENT');

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
    logger.warn('EventBridge publish failed', { detailType, errorName: err?.name ?? 'Error' });
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

/** TEN-02: an update only ever touches a row of the caller's company (the legacy form while the legacy rule is on). */
function onlyOurs(params, tenantId, existing) {
  const t = tenantFilter(tenantId);
  return {
    ...params,
    ConditionExpression: existing ? `(${existing}) AND ${t.FilterExpression}` : t.FilterExpression,
    ExpressionAttributeNames: { ...(params.ExpressionAttributeNames ?? {}), ...t.ExpressionAttributeNames },
    ExpressionAttributeValues: { ...(params.ExpressionAttributeValues ?? {}), ':tenant_id': { S: tenantId } },
  };
}

const handlerFn = async (event, tenantId) => {
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
      if (!ownsItem(getResult.Item, tenantId)) {
        return { ...notFound(), headers: CORS_HEADERS };
      }
      docRecord = getResult.Item;
    } else {
      // TEN-02: the company's documents only.
      docRecord = await findDocument(documentId, tenantId);
      if (!docRecord) {
        return { ...notFound(), headers: CORS_HEADERS };
      }
    }

    const employeeId = docRecord.employee_id.S;
    const verificationId = docRecord.verification_id?.S;

    // 2. Decide, with one conditional write: a document is decided once, and never while Batsi is still
    //    reading it. Two HR users, or two tabs, cannot both win. ONB-15.
    const now = new Date().toISOString();
    try {
      await dynamo.send(new UpdateItemCommand(onlyOurs({
        TableName: DOCUMENTS_TABLE,
        Key: {
          employee_id: { S: employeeId },
          document_id: { S: documentId },
        },
        UpdateExpression: 'SET ocr_status = :status, hr_reviewed_at = :now, hr_reviewed_by = :by, hr_reviewed_by_name = :byName, hr_decision_notes = :notes, can_reupload = :reupload',
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
      }, tenantId, 'attribute_not_exists(hr_reviewed_at) AND NOT ocr_status IN (:pending, :processing)')));
    } catch (err) {
      if (err?.name === 'ConditionalCheckFailedException') {
        // TEN-02: a document that is no longer this company's answers as unknown.
        const now2 = await dynamo.send(new GetItemCommand({ TableName: 'documents', Key: { employee_id: { S: employeeId }, document_id: { S: documentId } }, ProjectionExpression: 'tenant_id' }));
        if (!ownsItem(now2.Item, tenantId)) return notFound();
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
      tenant_id: tenantId,
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
      try {
        await dynamo.send(new UpdateItemCommand(onlyOurs(updateVerParams, tenantId)));
      } catch (verErr) {
        if (verErr?.name !== 'ConditionalCheckFailedException') throw verErr;
        logger.warn('Verification of another company left alone', { verificationId });
      }
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
        // Read the decision just written, not an older copy of the row.
        ConsistentRead: true,
        ...(docsKey ? { ExclusiveStartKey: docsKey } : {}),
      }));
      allDocs.push(...(page.Items || []));
      docsKey = page.LastEvaluatedKey;
    } while (docsKey);

    const plainDocs = allDocs.filter((item) => ownsItem(item, tenantId)).map((item) => ({
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
        await dynamo.send(new UpdateItemCommand(onlyOurs({
          TableName: EMPLOYEES_TABLE,
          Key: { employee_id: { S: employeeId } },
          UpdateExpression: 'SET stage = :stage, verified_at = :now, step = :stepVerified',
          ExpressionAttributeValues: {
            ':stage':   { S: 'VERIFIED' },
            ':now':     { S: new Date().toISOString() },
            ':stepVerified': { S: 'VERIFIED' },
            ':ds':      { S: 'DOCUMENTS_SUBMITTED' },
            ':active':  { S: 'ACTIVE' },
            ':invited': { S: 'INVITED' },
          },
        }, tenantId, 'stage = :ds OR stage = :active OR stage = :invited')));
        stageUpdated = true;
        logger.info('Employee stage updated to VERIFIED', { employeeId });

        // Publish stage change and onboarding completed events (NH-14)
        await publishEvent('employee.stage_changed', {
          employee_id: employeeId,
          from_stage: 'DOCUMENTS_SUBMITTED',
          to_stage: 'VERIFIED',
          tenant_id: tenantId,
        });
        await publishEvent('onboarding.completed', { employee_id: employeeId, tenant_id: tenantId });

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
                Dimensions: [{ Name: 'Environment', Value: ENVIRONMENT }],
              }],
            }));
            logger.info('Published TimeToComplete metric', { employeeId, durationMinutes });
          }
        } catch (metricErr) {
          // Non-fatal — metric failure must not block the review response
          logger.warn('Failed to publish TimeToComplete metric', { employeeId, errorName: metricErr?.name ?? 'Error' });
        }
      } catch (stageErr) {
        logger.error('Failed to update employee stage', { employeeId, errorName: stageErr?.name ?? 'Error' });
        // Non-fatal — the document review itself succeeded
      }
    }
    else {
      // ONB-09: not Verified yet. Keep the step right: In review while every required document is in,
      // Documents when one was sent back. The stage is not touched here. A Verified person stays Verified.
      try {
        await dynamo.send(new UpdateItemCommand(onlyOurs({
          TableName: EMPLOYEES_TABLE,
          Key: { employee_id: { S: employeeId } },
          UpdateExpression: 'SET step = :step',
          ExpressionAttributeValues: {
            ':step': { S: stepFromDocuments(plainDocs, required) },
            ':verified': { S: 'VERIFIED' },
          },
        }, tenantId, 'attribute_exists(employee_id) AND stage <> :verified AND (attribute_not_exists(step) OR step <> :verified)')));
      } catch (stepErr) {
        if (stepErr?.name !== 'ConditionalCheckFailedException') {
          logger.warn('Failed to update employee step', { employeeId, errorName: stepErr?.name ?? 'Error' });
        }
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
    logger.error('Handler error', { errorName: err?.name ?? 'Error' });
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
  if (!claims || !isIdToken(claims) || !groupsOf(claims).includes('hr_staff')) {
    return respond(403, { error: 'Only HR can decide on a document' });
  }
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return { ...refusal, headers: CORS_HEADERS };
  const key = event.headers?.['idempotency-key'];
  return withIdempotency(key, () => handlerFn(event, tenantId), tenantId);
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}
