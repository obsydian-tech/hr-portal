import {
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { guardAi, isRobotCaller, isRobotEmail, markRobot } from '../shared/ai-guard.mjs';
import { hrOrAgent } from '../shared/hr-group.mjs';
import { requireTenant, ownsItem, notFound, tenantFilter, legacyCompany } from '../shared/tenant.mjs';
import { requiredFor } from '../shared/required-documents.mjs';
import { isFlowEvent, summaryOf, buildPrompt } from '../shared/risk-summary.mjs';

const dynamo = new DynamoDBClient({});
const bedrock = guardAi(new BedrockRuntimeClient({ region: 'af-south-1' }), 'bedrock');

const VERIFICATIONS_TABLE = process.env.VERIFICATIONS_TABLE;
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'global.anthropic.claude-haiku-4-5-20251001-v1:0';

const UNPARSEABLE = 'Model returned unparseable response';
const errName = (err) => err?.name ?? 'Error';

/** A failure the flow throws, so Step Functions' Retry and Catch work. Named, with fixed text: never AWS message text (BE-18). */
class FlowFailure extends Error {
  constructor(name) { super('Risk check failed'); this.name = name; }
}

/**
 * Two ways in:
 * - the web route POST /v1/employees/{id}/assess-risk (HR or the Agent API), unchanged for callers;
 * - the flow entry, called by Step Functions with { source, employeeId } and no requestContext (ONB-11).
 * The Agent API and nalekoAiChat keep calling the web route. Uses Bedrock (Claude Haiku). No personal data is sent.
 */
export const handler = async (event) => {
  if (isFlowEvent(event)) return flowEntry(event.employeeId);
  return webEntry(event);
};

// ---------------------------------------------------------------- the web entry (POST /v1/employees/{id}/assess-risk)
// BE-17: the group check is the first thing in the handler, before any read.

async function webEntry(event) {
  const refused = hrOrAgent(event, 'Only HR can check documents');
  if (refused) return refused;
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;
  const employeeId = event.pathParameters?.id;

  if (!employeeId) {
    return response(400, { message: 'Missing employee id in path' });
  }

  // AI cost guardrail: robots (test logins) and test employees never reach the AI.
  // TEN-02: the employee must be the caller's company's before anything else is read, and before the AI guard.
  let emp;
  try {
    emp = await dynamo.send(new GetItemCommand({
      TableName: EMPLOYEES_TABLE,
      Key: { employee_id: { S: employeeId } },
      ProjectionExpression: 'email, tenant_id',
    }));
  } catch (err) {
    console.warn({ message: 'Employee lookup failed', employeeId, errorName: errName(err) });
    return response(500, { message: 'Failed to retrieve verifications' });
  }
  if (!ownsItem(emp.Item, tenantId)) return notFound();
  const robot = isRobotCaller(event.requestContext?.authorizer?.jwt?.claims) || isRobotEmail(emp.Item.email?.S);
  markRobot(robot);

  let verifications = [];
  try {
    verifications = await readVerifications(employeeId, tenantId);
  } catch (err) {
    console.error({ message: 'DynamoDB query failed', employeeId, errorName: errName(err) });
    return response(500, { message: 'Failed to retrieve verifications' });
  }

  if (verifications.length === 0) {
    return response(404, { message: 'No verifications found for employee', employeeId });
  }

  const { risk, reason } = await classify(verifications);
  const riskAssessedAt = new Date().toISOString();

  try {
    await writeResult(employeeId, tenantId, risk, reason, riskAssessedAt, 'HR');
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') return notFound();
    console.error({ message: 'DynamoDB update failed', employeeId, errorName: errName(err) });
    return response(500, { message: 'Risk classified but failed to persist result' });
  }

  console.log({ message: 'Risk classification complete', employeeId, risk, riskAssessedAt });
  return response(200, { employeeId, risk, reason });
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
// ---------------------------------------------------------------- shared steps

/** Every page of the person's verification rows that belong to this company. Throws on a failed read. */
async function readVerifications(employeeId, tenantId) {
  const items = [];
  let startKey;
  do {
    const page = await dynamo.send(new QueryCommand({
      TableName: VERIFICATIONS_TABLE,
      IndexName: 'employeeId-index',
      KeyConditionExpression: 'employeeId = :eid',
      ExpressionAttributeValues: { ':eid': { S: employeeId } },
      ...(startKey ? { ExclusiveStartKey: startKey } : {}),
    }));
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items.filter((item) => ownsItem(item, tenantId));
}

const plainRow = (item) => ({
  documentType: item.documentType?.S,
  decision: item.decision?.S,
  check: item.check?.S,
  confidence: item.confidence?.N !== undefined ? Number(item.confidence.N) : undefined,
  hasExtractedData: !!(item.extractedData?.S || item.extractedData?.M),
  createdAt: item.createdAt?.S,
  verificationId: item.verificationId?.S,
});

/** Ask the model. Never throws: a blocked, failing or unreadable model gives UNKNOWN with the reason (stored). */
async function classify(verifications) {
  let risk = 'UNKNOWN';
  let reason = UNPARSEABLE;
  try {
    const prompt = buildPrompt(summaryOf(verifications.map(plainRow), requiredFor(null)));
    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });
    const bedrockRes = await bedrock.send(new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    }));
    const parsed = JSON.parse(new TextDecoder().decode(bedrockRes.body));
    let content = parsed?.content?.[0]?.text ?? '';
    // Never log the model's text (BE-18); a length is enough to debug.
    console.info({ message: 'Bedrock answered', length: typeof content === 'string' ? content.length : 0 });
    content = String(content).replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const classification = JSON.parse(jsonMatch[0]);
      if (['LOW', 'MEDIUM', 'HIGH'].includes(classification.risk)) {
        risk = classification.risk;
        if (typeof classification.reason === 'string' && classification.reason.trim() !== '') reason = classification.reason;
      }
    }
  } catch (err) {
    console.error({ message: 'Bedrock invocation failed', errorName: errName(err) });
    if (err.aiBlocked) reason = err.label;
  }
  return { risk, reason };
}

const writeResult = (employeeId, tenantId, risk, reason, riskAssessedAt, source) => dynamo.send(new UpdateItemCommand({
  TableName: EMPLOYEES_TABLE,
  Key: { employee_id: { S: employeeId } },
  UpdateExpression: 'SET riskBand = :band, riskReason = :reason, riskAssessedAt = :assessedAt, riskSource = :source',
  ConditionExpression: tenantFilter(tenantId).FilterExpression,
  ExpressionAttributeNames: { '#tenant_id': 'tenant_id' },
  ExpressionAttributeValues: {
    ':band': { S: risk },
    ':reason': { S: reason },
    ':assessedAt': { S: riskAssessedAt },
    ':source': { S: source },
    ':tenant_id': { S: tenantId },
  },
}));

// ---------------------------------------------------------------- the flow entry

async function flowEntry(employeeId) {
  let emp;
  try {
    emp = await dynamo.send(new GetItemCommand({
      TableName: EMPLOYEES_TABLE,
      Key: { employee_id: { S: employeeId } },
      ProjectionExpression: 'email, tenant_id, riskBand, riskReason, riskAssessedAt, riskSource',
    }));
  } catch (err) {
    console.warn({ message: 'Employee lookup failed', employeeId, errorName: errName(err) });
    throw new FlowFailure('EmployeeLookupFailed');
  }
  const item = emp?.Item;
  if (!item) throw new FlowFailure('EmployeeNotFound');
  // The flow has no caller: the company is the one on the person's own row (or the founding company while the legacy
  // rule is on). It is never taken from the event.
  const tenantId = item.tenant_id?.S ?? legacyCompany();
  if (!tenantId) throw new FlowFailure('CompanyMissing');
  if (!ownsItem(item, tenantId)) throw new FlowFailure('EmployeeNotOwned');

  // Once: a repeat (a Step Functions retry) answers what is stored and pays for nothing. HR's own result does not count.
  if (item.riskSource?.S === 'FLOW' && item.riskAssessedAt?.S && item.riskBand?.S) {
    return { employeeId, tenantId, riskBand: item.riskBand.S, riskReason: item.riskReason?.S ?? '', riskAssessedAt: item.riskAssessedAt.S };
  }

  // No caller claim to fall back on, so a row with no email counts as a test person (ONB-11 security review, F-3).
  const email = item.email?.S;
  markRobot(!email || isRobotEmail(email));

  let verifications;
  try {
    verifications = await readVerifications(employeeId, tenantId);
  } catch (err) {
    console.error({ message: 'DynamoDB query failed', employeeId, errorName: errName(err) });
    throw new FlowFailure('VerificationsReadFailed');
  }

  const { risk, reason } = await classify(verifications);
  const riskAssessedAt = new Date().toISOString();
  try {
    await writeResult(employeeId, tenantId, risk, reason, riskAssessedAt, 'FLOW');
  } catch (err) {
    console.error({ message: 'DynamoDB update failed', employeeId, errorName: errName(err) });
    throw new FlowFailure(err?.name === 'ConditionalCheckFailedException' ? 'EmployeeNotOwned' : 'RiskWriteFailed');
  }
  console.log({ message: 'Risk classification complete', employeeId, risk, riskAssessedAt });
  return { employeeId, tenantId, riskBand: risk, riskReason: reason, riskAssessedAt };
}

