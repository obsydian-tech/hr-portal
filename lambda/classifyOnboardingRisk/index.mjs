import {
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const dynamo = new DynamoDBClient({});
const bedrock = new BedrockRuntimeClient({ region: 'af-south-1' });

const VERIFICATIONS_TABLE = process.env.VERIFICATIONS_TABLE;
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'global.anthropic.claude-haiku-4-5-20251001-v1:0';

/**
 * POST /v1/employees/{id}/assess-risk
 * Classifies the onboarding risk for an employee as LOW, MEDIUM, or HIGH
 * based on their document verification results.
 *
 * NH-41 — Uses Bedrock (Claude 3 Haiku). No PII is sent to the model.
 */
export const handler = async (event) => {
  const employeeId = event.pathParameters?.id;

  if (!employeeId) {
    return response(400, { message: 'Missing employee id in path' });
  }

  // 1. Query document-verification table via employeeId-index GSI
  let verifications = [];
  try {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: VERIFICATIONS_TABLE,
        IndexName: 'employeeId-index',
        KeyConditionExpression: 'employeeId = :eid',
        ExpressionAttributeValues: { ':eid': { S: employeeId } },
      })
    );
    verifications = result.Items ?? [];
  } catch (err) {
    console.error({ message: 'DynamoDB query failed', employeeId, error: err.message });
    return response(500, { message: 'Failed to retrieve verifications' });
  }

  if (verifications.length === 0) {
    return response(404, { message: 'No verifications found for employee', employeeId });
  }

  // 2. Build safe summary — NO PII. Only document type, decision, confidence.
  const safeSummary = verifications.map((item) => ({
    documentType: item.documentType?.S ?? 'UNKNOWN',
    decision: item.decision?.S ?? 'PENDING',
    ocrConfidence: item.confidence?.N ? parseFloat(item.confidence.N) : null,
    hasExtractedData: !!(item.extractedData?.S || item.extractedData?.M),
  }));

  // 3. Invoke Bedrock for risk classification
  let risk = 'UNKNOWN';
  let reason = 'Model returned unparseable response';

  try {
    const prompt = [
      'You are an HR onboarding risk classifier.',
      'Classify the overall onboarding risk for this employee as LOW, MEDIUM, or HIGH based solely on their document verification results.',
      'LOW means all documents passed with high confidence.',
      'MEDIUM means some documents are in manual review or have low confidence.',
      'HIGH means documents have failed or are missing.',
      'Respond ONLY with valid JSON: {"risk":"LOW","reason":"one sentence explanation"}',
      '',
      `Verifications: ${JSON.stringify(safeSummary)}`,
    ].join('\n');

    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });

    const bedrockRes = await bedrock.send(
      new InvokeModelCommand({
        modelId: BEDROCK_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body,
      })
    );

    const rawText = new TextDecoder().decode(bedrockRes.body);
    const parsed = JSON.parse(rawText);
    const content = parsed?.content?.[0]?.text ?? '';

    // Extract JSON from the model's text response
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const classification = JSON.parse(jsonMatch[0]);
      if (['LOW', 'MEDIUM', 'HIGH'].includes(classification.risk)) {
        risk = classification.risk;
        reason = classification.reason ?? reason;
      }
    }
  } catch (err) {
    console.error({ message: 'Bedrock invocation failed', employeeId, error: err.message });
    // Continue with UNKNOWN — do not block the response
  }

  const riskAssessedAt = new Date().toISOString();

  // 4. Persist riskBand, riskReason, riskAssessedAt to employees table
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: EMPLOYEES_TABLE,
        Key: { employee_id: { S: employeeId } },
        UpdateExpression:
          'SET riskBand = :band, riskReason = :reason, riskAssessedAt = :assessedAt',
        ExpressionAttributeValues: {
          ':band': { S: risk },
          ':reason': { S: reason },
          ':assessedAt': { S: riskAssessedAt },
        },
      })
    );
  } catch (err) {
    console.error({ message: 'DynamoDB update failed', employeeId, error: err.message });
    return response(500, { message: 'Risk classified but failed to persist result' });
  }

  console.log({ message: 'Risk classification complete', employeeId, risk, riskAssessedAt });

  // 5. Return result
  return response(200, { employeeId, risk, reason });
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
