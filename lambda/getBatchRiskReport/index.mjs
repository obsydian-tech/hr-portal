/**
 * NH-55: getBatchRiskReport Lambda
 *
 * GET /agent/v1/employees/risk-report
 *
 * Solves the N+1 problem for Template 1 ("Show me all HIGH risk employees").
 * Instead of Claude calling assess_employee_risk per employee (34+ Bedrock calls),
 * the AI calls ONE tool (get_high_risk_report) and this Lambda handles the batch.
 *
 * Algorithm:
 *   1. Scan all employees (filtered by created_by if not a manager/agent)
 *   2. For each employee, query document-verification records
 *   3. Run risk classification via Bedrock in parallel — max 5 concurrent calls
 *   4. Return { high, medium, low, no_data, generated_at }
 */

import { DynamoDBClient, ScanCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const dynamo  = new DynamoDBClient({});
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION_NAME ?? 'af-south-1' });

const logger = new Logger({ serviceName: 'getBatchRiskReport' });
const tracer = new Tracer({ serviceName: 'getBatchRiskReport' });

const VERIFICATIONS_TABLE = process.env.VERIFICATIONS_TABLE ?? 'document-verification';
const EMPLOYEES_TABLE     = process.env.EMPLOYEES_TABLE     ?? 'employees';
const BEDROCK_MODEL_ID    = process.env.BEDROCK_MODEL_ID    ?? 'anthropic.claude-haiku-4-5-20251001-v1:0';
const CONCURRENCY_LIMIT   = 5; // max parallel Bedrock calls — prevents TPS throttling

const CORS_HEADERS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,x-api-key',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function ok(body) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function err(statusCode, message) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify({ error: message }) };
}

/**
 * Run an array of async task-factory functions with a bounded concurrency pool.
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} limit
 * @returns {Promise<T[]>}
 */
async function pLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

/**
 * Classify risk for one employee given their verification records.
 * Replicates the logic from classifyOnboardingRisk Lambda (NH-41).
 *
 * @param {string} employeeId
 * @param {Array<object>} verificationItems  Raw DynamoDB items (marshalled)
 * @returns {Promise<{ employeeId: string, risk: string, reason: string }>}
 */
async function classifyRisk(employeeId, verificationItems) {
  if (!verificationItems.length) {
    return { employeeId, risk: 'NO_DATA', reason: 'No verification records found.' };
  }

  // Build safe summary — NO PII sent to model
  const safeSummary = verificationItems.map((item) => ({
    documentType:     item.documentType?.S  ?? 'UNKNOWN',
    decision:         item.decision?.S      ?? 'PENDING',
    ocrConfidence:    item.confidence?.N    ? parseFloat(item.confidence.N) : null,
    hasExtractedData: !!(item.extractedData?.S || item.extractedData?.M),
  }));

  const prompt = [
    'You are an HR onboarding risk classifier.',
    'Classify the overall onboarding risk as LOW, MEDIUM, or HIGH based solely on document verification results.',
    'LOW: all documents passed with high confidence.',
    'MEDIUM: some documents are in manual review or have low confidence.',
    'HIGH: documents have failed or are missing.',
    'Return ONLY valid JSON, no markdown: {"risk":"LOW","reason":"one sentence"}',
    '',
    `Verifications: ${JSON.stringify(safeSummary)}`,
  ].join('\n');

  const bedrockBody = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    const res = await bedrock.send(
      new InvokeModelCommand({
        modelId:     BEDROCK_MODEL_ID,
        contentType: 'application/json',
        accept:      'application/json',
        body:        bedrockBody,
      })
    );

    const raw     = new TextDecoder().decode(res.body);
    const parsed  = JSON.parse(raw);
    let content   = parsed?.content?.[0]?.text ?? '';
    content       = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

    // Extract first {...} JSON blob from response
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error(`Unparseable Bedrock response: ${content.slice(0, 200)}`);

    const classified = JSON.parse(jsonMatch[0]);
    const risk   = (['LOW', 'MEDIUM', 'HIGH'].includes(classified.risk)) ? classified.risk : 'UNKNOWN';
    const reason = typeof classified.reason === 'string' ? classified.reason : '';
    return { employeeId, risk, reason };
  } catch (e) {
    logger.warn('Bedrock classification failed for employee', { employeeId, error: e.message });
    return { employeeId, risk: 'UNKNOWN', reason: `Classification error: ${e.message}` };
  }
}

// ─── handler ─────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  logger.info('Handler invoked', { path: event.rawPath, method: event.requestContext?.http?.method });
  tracer.putAnnotation('operation', 'getBatchRiskReport');

  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const start = Date.now();

  try {
    // 1. Resolve caller — agent API key or JWT
    const lambdaActor  = event.requestContext?.authorizer?.lambda?.actor ?? '';
    const isAgent      = lambdaActor === 'AGENT';

    let createdByFilter;
    if (!isAgent) {
      const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
      createdByFilter = claims['custom:staff_id'] || claims['sub'];
      if (!createdByFilter) {
        return err(401, 'Unable to resolve staff identity from token');
      }
    }
    // Agent → no created_by filter (full access)

    // 2. Scan employees table
    const scanParams = {
      TableName: EMPLOYEES_TABLE,
      ProjectionExpression: 'employeeId, firstName, lastName, #dep, #st',
      ExpressionAttributeNames: { '#dep': 'department', '#st': 'onboardingStage' },
    };
    if (createdByFilter) {
      scanParams.FilterExpression    = 'created_by = :cb';
      scanParams.ExpressionAttributeValues = { ':cb': { S: createdByFilter } };
    }

    let employees = [];
    let lastKey;
    do {
      if (lastKey) scanParams.ExclusiveStartKey = lastKey;
      const scanRes = await dynamo.send(new ScanCommand(scanParams));
      employees    = employees.concat(scanRes.Items ?? []);
      lastKey      = scanRes.LastEvaluatedKey;
    } while (lastKey);

    logger.info('Employees fetched', { count: employees.length, isAgent, hasFilter: !!createdByFilter });

    if (!employees.length) {
      return ok({ high: [], medium: [], low: [], no_data: [], generated_at: new Date().toISOString(), latencyMs: Date.now() - start });
    }

    // 3. For each employee — fetch verifications then classify (pLimit concurrency)
    const tasks = employees.map((emp) => async () => {
      const empId = emp.employeeId?.S;
      if (!empId) return null;

      let verifications = [];
      try {
        const vRes = await dynamo.send(new QueryCommand({
          TableName:                 VERIFICATIONS_TABLE,
          IndexName:                 'employeeId-index',
          KeyConditionExpression:    'employeeId = :eid',
          ExpressionAttributeValues: { ':eid': { S: empId } },
        }));
        verifications = vRes.Items ?? [];
      } catch (e) {
        logger.warn('Failed to query verifications', { empId, error: e.message });
      }

      const result = await classifyRisk(empId, verifications);
      return {
        employeeId: empId,
        firstName:  emp.firstName?.S  ?? '',
        lastName:   emp.lastName?.S   ?? '',
        department: emp.department?.S ?? '',
        stage:      emp.onboardingStage?.S ?? '',
        risk:       result.risk,
        reason:     result.reason,
      };
    });

    const rawResults = await pLimit(tasks, CONCURRENCY_LIMIT);
    const results    = rawResults.filter(Boolean);

    // 4. Group by risk band
    const grouped = { high: [], medium: [], low: [], no_data: [] };
    for (const r of results) {
      const band = r.risk.toLowerCase();
      if (band === 'high')        grouped.high.push(r);
      else if (band === 'medium') grouped.medium.push(r);
      else if (band === 'low')    grouped.low.push(r);
      else                        grouped.no_data.push(r);
    }

    const latencyMs = Date.now() - start;
    logger.info('Batch risk report complete', {
      total: results.length,
      high: grouped.high.length,
      medium: grouped.medium.length,
      low: grouped.low.length,
      no_data: grouped.no_data.length,
      latencyMs,
    });

    return ok({ ...grouped, generated_at: new Date().toISOString(), latencyMs });
  } catch (e) {
    logger.error('Unhandled error', { error: e.message, stack: e.stack });
    return err(500, 'Internal server error');
  }
};
