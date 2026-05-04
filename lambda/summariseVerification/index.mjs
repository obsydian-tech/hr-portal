import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const dynamo  = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'af-south-1' });
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'af-south-1' });

const logger = new Logger({ serviceName: 'summariseVerification' });
const tracer  = new Tracer({ serviceName: 'summariseVerification' });

const VERIFICATIONS_TABLE = process.env.VERIFICATIONS_TABLE ?? 'document-verification';
const MODEL_ID            = process.env.BEDROCK_MODEL_ID    ?? 'anthropic.claude-3-haiku-20240307-v1:0';
const MAX_OCR_CHARS       = 2000;

// PII field names we explicitly exclude from the prompt — never sent to Bedrock
const PII_FIELDS = new Set(['idNumber', 'id_number', 'passportNumber', 'taxNumber', 'dateOfBirth']);

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
    logger.error('DynamoDB GetItem failed', { error: err.message, verificationId });
    return respond(500, { error: 'Failed to retrieve verification record' });
  }

  if (!item) {
    return respond(404, { error: `Verification ${verificationId} not found` });
  }

  // ── 2. Build prompt — no raw PII fields sent to Bedrock ───────────────────
  const documentType       = item.documentType?.S        ?? 'Unknown';
  const verificationStatus = item.status?.S              ?? 'Unknown';
  const ocrConfidence      = item.ocrConfidence?.N       ?? 'N/A';
  const reviewNotes        = item.reviewNotes?.S         ?? '';

  // Truncate OCR text; strip any accidental PII field labels
  const rawOcr = item.ocrText?.S ?? '';
  const ocrSnippet = rawOcr
    .replace(/\b(\d{13})\b/g, '[ID_REDACTED]')        // SA 13-digit ID numbers
    .replace(/\b([A-Z]{2}\d{6,9})\b/g, '[PASS_REDACTED]') // passport-like patterns
    .slice(0, MAX_OCR_CHARS);

  const prompt = `Summarise this document verification in 3 sentences for an HR manager.
Be professional and factual. Do not invent information not present in the data below.

Document type:         ${documentType}
Verification status:   ${verificationStatus}
OCR confidence score:  ${ocrConfidence}%
Review notes:          ${reviewNotes || 'None'}
OCR text excerpt:
${ocrSnippet}`;

  // ── 3. Invoke Bedrock ──────────────────────────────────────────────────────
  let summary;
  try {
    summary = await invokeBedrock(prompt, 200);
    logger.info('Bedrock summary generated', { verificationId, length: summary.length });
    tracer.putAnnotation('bedrockSuccess', true);
  } catch (err) {
    logger.error('Bedrock invocation failed', { error: err.message, verificationId });
    tracer.putAnnotation('bedrockSuccess', false);
    return respond(502, { error: 'AI summary service unavailable — try again shortly' });
  }

  return respond(200, {
    verificationId,
    summary,
    generatedAt: new Date().toISOString(),
  });
};

export const handler = tracer.captureAsyncFunc('Handler', handlerFn);
