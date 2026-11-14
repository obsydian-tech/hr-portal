import { DynamoDBClient, ScanCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { groupsOf, checkOf } from '../shared/document-check.mjs';

const dynamodb = new DynamoDBClient();

const logger = new Logger({ serviceName: 'getDocumentVerifications' });
const tracer = new Tracer({ serviceName: 'getDocumentVerifications' });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};

const json = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

/**
 * Who is asking. The Agent API's key authorizer puts { actor: 'AGENT' } in the Lambda authorizer
 * context (ONB-22 sets its rules, so it keeps today's answer). A signed-in person must be in the
 * hr_staff group, by exact name. Anything else is refused before any table is read.
 */
function callerOf(event) {
  const auth = event.requestContext?.authorizer;
  if (auth?.lambda?.actor === 'AGENT') return 'AGENT';
  if (auth?.jwt?.claims && groupsOf(auth.jwt.claims).includes('hr_staff')) return 'HR';
  return null;
}

/** Every page of a scan (a DynamoDB scan stops at 1 MB). */
async function scanAll(TableName) {
  const rows = [];
  let ExclusiveStartKey;
  do {
    const page = await dynamodb.send(new ScanCommand({ TableName, ExclusiveStartKey }));
    for (const item of page.Items ?? []) rows.push(unmarshall(item));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

const CHECKS = ['READING', 'MATCHES', 'NEEDS_A_LOOK', 'DOESNT_MATCH'];

/** ONB-13: the documents still waiting for an HR decision, oldest first, six fields each. */
async function waitingDocuments() {
  const waiting = (await scanAll('documents')).filter((doc) => !doc.hr_reviewed_at);

  const employeeIds = [...new Set(waiting.map((doc) => doc.employee_id))];
  const names = new Map();
  await Promise.all(employeeIds.map(async (id) => {
    const res = await dynamodb.send(new QueryCommand({
      TableName: 'employees',
      KeyConditionExpression: 'employee_id = :id',
      ExpressionAttributeValues: { ':id': { S: id } }
    }));
    const employee = res.Items?.[0] ? unmarshall(res.Items[0]) : null;
    names.set(id, employee ? `${employee.first_name} ${employee.last_name}`.trim() : 'Unknown');
  }));

  const items = await Promise.all(waiting.map(async (doc) => {
    let verification = null;
    if (doc.verification_id) {
      const res = await dynamodb.send(new QueryCommand({
        TableName: 'document-verification',
        KeyConditionExpression: 'verificationId = :id',
        ExpressionAttributeValues: { ':id': { S: doc.verification_id } }
      }));
      verification = res.Items?.[0] ? unmarshall(res.Items[0]) : null;
    }
    return {
      document_id: doc.document_id,
      employee_id: doc.employee_id,
      employee_name: names.get(doc.employee_id),
      document_type: doc.document_type,
      check: checkOf(doc, verification),
      arrived_at: doc.upload_timestamp ?? doc.uploaded_at ?? null
    };
  }));

  // Oldest first, no date last, then document_id.
  items.sort((a, b) => {
    if (a.arrived_at !== b.arrived_at) {
      if (a.arrived_at === null) return 1;
      if (b.arrived_at === null) return -1;
      return Date.parse(a.arrived_at) - Date.parse(b.arrived_at) || (a.arrived_at < b.arrived_at ? -1 : 1);
    }
    return a.document_id < b.document_id ? -1 : a.document_id > b.document_id ? 1 : 0;
  });

  const counts = Object.fromEntries(CHECKS.map((c) => [c, items.filter((i) => i.check === c).length]));
  return { items, count: items.length, counts };
}

const handlerFn = async (event) => {
  logger.info('Handler invoked', { path: event.path, httpMethod: event.requestContext?.http?.method });
  tracer.putAnnotation('operation', 'getDocumentVerifications');

  const caller = callerOf(event);
  if (!caller) {
    logger.warn('Refused: caller is not HR staff');
    return json(403, { error: 'Forbidden' });
  }

  try {
    const queryParams = event.queryStringParameters || {};
    const status = queryParams.status;
    const decision = queryParams.decision;
    const employeeId = queryParams.employee_id;
    const limit = parseInt(queryParams.limit || '50');

    if (caller === 'HR' && queryParams.waiting === 'true') {
      return json(200, await waitingDocuments());
    }

    logger.info('Query params', { status, decision, employeeId, limit, caller });

    // For prototype: simple scan (not optimized for production)
    const scanParams = {
      TableName: 'document-verification',
      Limit: limit
    };

    const result = await dynamodb.send(new ScanCommand(scanParams));
    let items = result.Items.map(item => unmarshall(item));

    // Apply filters
    if (status) {
      // Get document IDs with matching status from documents table
      const docsResult = await dynamodb.send(new ScanCommand({
        TableName: 'documents',
        FilterExpression: 'ocr_status = :status',
        ExpressionAttributeValues: {
          ':status': { S: status }
        }
      }));
      
      const matchingDocIds = docsResult.Items.map(item => unmarshall(item).document_id);
      items = items.filter(item => matchingDocIds.includes(item.documentId));
    }

    if (decision) {
      items = items.filter(item => item.decision === decision);
    }

    if (employeeId) {
      items = items.filter(item => item.employeeId === employeeId);
    }

    // Enrich with employee names and HR staff info (join with employees table)
    const enrichedItems = await Promise.all(items.map(async (item) => {
      try {
        const empResult = await dynamodb.send(new QueryCommand({
          TableName: 'employees',
          KeyConditionExpression: 'employee_id = :id',
          ExpressionAttributeValues: {
            ':id': { S: item.employeeId }
          }
        }));

        if (empResult.Items && empResult.Items.length > 0) {
          const employee = unmarshall(empResult.Items[0]);
          return {
            ...item,
            employee_name: `${employee.first_name} ${employee.last_name}`,
            employee_hr_staff_id: employee.hr_staff_id || employee.created_by || '',
          };
        }
        return { ...item, employee_hr_staff_id: '' };
      } catch (err) {
        logger.error('Failed to get employee', { error: err });
        return { ...item, employee_hr_staff_id: '' };
      }
    }));

    // Only HR staff and the Agent API reach this point, and both see everyone.
    const filteredItems = enrichedItems;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: JSON.stringify({
        items: filteredItems.map(item => ({
          verification_id: item.verificationId,
          employee_id: item.employeeId,
          employee_name: item.employee_name || 'Unknown',
          document_type: item.documentType,
          document_id: item.documentId,
          confidence: item.confidence,
          decision: item.decision,
          created_at: item.createdAt
        })),
        count: filteredItems.length
      })
    };

  } catch (error) {
    logger.error('Handler error', { error });
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};

export const handler = handlerFn;