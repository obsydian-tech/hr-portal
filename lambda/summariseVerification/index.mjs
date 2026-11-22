import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { guardAi, isRobotCaller, isRobotEmail, markRobot } from '../shared/ai-guard.mjs';
import { hrOrAgent } from '../shared/hr-group.mjs';
import { requireTenant, ownsItem, notFound } from '../shared/tenant.mjs';
import { redactNumbers, hasNumberRun } from '../shared/pii-redact.mjs';
import { DOCUMENT_TYPES } from '../shared/upload-link.mjs';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const dynamo  = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'af-south-1' });
const bedrock = guardAi(new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'af-south-1' }), 'bedrock');

const logger = new Logger({ serviceName: 'summariseVerification' });
const tracer  = new Tracer({ serviceName: 'summariseVerification' });

const VERIFICATIONS_TABLE = process.env.VERIFICATIONS_TABLE ?? 'document-verification';
const MODEL_ID            = process.env.BEDROCK_MODEL_ID    ?? 'anthropic.claude-3-haiku-20240307-v1:0';
const MAX_OCR_CHARS       = 2000;

// PII-01: these two types are mostly numbers, so no OCR text is sent for them at all.
const NO_TEXT_TYPES = new Set(['NATIONAL_ID', 'BANK_CONFIRMATION']);
const NO_TEXT_LINE  = 'Not included for this document type.';
const STATUSES      = ['PASSED', 'FAILED', 'MANUAL_REVIEW', 'PENDING'];

const REFUSED_BODY = { error: 'AI summary service unavailable — try again shortly' };

/** Only fixed words or a clamped number go in from the row; free text goes through the redactor. Throws on trouble. */
function buildPrompt(item) {
  const documentType       = DOCUMENT_TYPES.includes(item.documentType?.S) ? item.documentType.S : 'OTHER';
  const verificationStatus = STATUSES.includes(item.status?.S) ? item.status.S : 'PENDING';
  const confidence         = Number(item.ocrConfidence?.N);
  const ocrConfidence      = Number.isFinite(confidence) ? Math.round(Math.min(100, Math.max(0, confidence))) : 'N/A';
  const reviewNotes        = redactNumbers(item.reviewNotes?.S ?? '');

  // Redact first, then cut, so a cut cannot leave half a number.
  const ocrSnippet = NO_TEXT_TYPES.has(documentType)
    ? NO_TEXT_LINE
    : redactNumbers(item.ocrText?.S ?? '').slice(0, MAX_OCR_CHARS);

  const prompt = `Summarise this document verification in 3 sentences for an HR manager.
Be professional and factual. Do not invent information not present in the data below.

Document type:         ${documentType}
Verification status:   ${verificationStatus}
OCR confidence score:  ${ocrConfidence}%
Review notes:          ${reviewNotes || 'None'}
OCR text excerpt:
${ocrSnippet}`;

  // Last check on the whole finished prompt.
  if (hasNumberRun(prompt)) {
    const e = new Error('number left in prompt');
    e.name = 'PiiRefused';
    throw e;
  }
  return prompt;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

/**
 * Invoke Claude 3 Haiku via Bedrock.
 * Returns the model's plain-text response string.
 */
async function invokeBedrock(prompt, maxTokens = 200) {
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };

  const command = new InvokeModelCommand({
    modelId:     MODEL_ID,
    contentType: 'application/json',
    accept:      'application/json',
    body:        JSON.stringify(payload),
  });

  const response  = await bedrock.send(command);
  const parsed    = JSON.parse(Buffer.from(response.body).toString());
  return parsed.content[0].text.trim();
}

const handlerFn = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return respond(204, {});
  }
  const refused = hrOrAgent(event, 'Only HR can check documents');
  if (refused) return { ...refused, headers: CORS_HEADERS };
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return { ...refusal, headers: CORS_HEADERS };

  markRobot(isRobotCaller(event.requestContext?.authorizer?.jwt?.claims));
  logger.info('Handler invoked', { verificationId: event.pathParameters?.id });
  tracer.putAnnotation('operation', 'summariseVerification');

  const verificationId = event.pathParameters?.id;
  if (!verificationId) {
    return respond(400, { error: 'Missing path parameter: id' });
  }

  // ── 1. Fetch verification record ──────────────────────────────────────────
  let item;
  try {
    const { Item } = await dynamo.send(new GetItemCommand({
      TableName: VERIFICATIONS_TABLE,
      Key: { verificationId: { S: verificationId } },
    }));
    item = Item;
  } catch (err) {
    logger.error('DynamoDB GetItem failed', { errorName: err?.name ?? 'Error', verificationId });
    return respond(500, { error: 'Failed to retrieve verification record' });
  }

  if (!ownsItem(item, tenantId)) {
    return { ...notFound(), headers: CORS_HEADERS };
  }

  // ONB-22: the person the document is about decides, as in classifyOnboardingRisk: a test person, or one with no
  // email on record, never reaches the model, whoever asks (the agent has no claims to look at).
  try {
    const emp = await dynamo.send(new GetItemCommand({
      TableName: 'employees',
      Key: { employee_id: { S: item.employeeId?.S ?? '' } },
      ProjectionExpression: 'email, tenant_id',
    }));
    // An employee row that is there decides: no email on record, another company's row, or a test address fails closed. No row at all
    // (an orphan; the PII-01 acceptance rows have none) is left to the other guards.
    if (emp.Item) {
      const email = ownsItem(emp.Item, tenantId) ? emp.Item.email?.S : undefined;
      if (!email || isRobotEmail(email)) markRobot(true);
    }
  } catch (err) {
    logger.error('Employee lookup failed', { errorName: err?.name ?? 'Error', verificationId });
    markRobot(true);
  }

  // ── 2. Build prompt — fixed words, redacted free text, last check; any failure means no model call ─────
  let prompt;
  try {
    prompt = buildPrompt(item);
  } catch (err) {
    logger.error('Prompt refused', { errorName: err?.name ?? 'Error', verificationId });
    return respond(502, REFUSED_BODY);
  }

  // ── 3. Invoke Bedrock ──────────────────────────────────────────────────────
  let summary;
  try {
    summary = await invokeBedrock(prompt, 200);
    logger.info('Bedrock summary generated', { verificationId, length: summary.length });
    tracer.putAnnotation('bedrockSuccess', true);
  } catch (err) {
    if (err.aiBlocked) {
      return respond(200, { verificationId, summary: err.label, aiDisabled: true,
                            generatedAt: new Date().toISOString() });
    }
    logger.error('Bedrock invocation failed', { errorName: err?.name ?? 'Error', verificationId });
    tracer.putAnnotation('bedrockSuccess', false);
    return respond(502, REFUSED_BODY);
  }

  return respond(200, {
    verificationId,
    summary,
    generatedAt: new Date().toISOString(),
  });
};

export const handler = handlerFn;
