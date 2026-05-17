/**
 * AI-002 / NH-128: intent-classifier.mjs — Haiku-powered pre-flight classifier.
 *
 * Classifies each user request into one of three intent classes before
 * the main agentic loop runs. The class drives model selection:
 *
 *   SIMPLE        → BEDROCK_MODEL_FAST (Haiku)   single read, status check
 *   TOOL_REQUIRED → BEDROCK_MODEL_SMART (Sonnet)  multi-tool, complex reasoning, write ops
 *   UNKNOWN       → BEDROCK_MODEL_SMART (Sonnet)  fallback — safe default
 *
 * The classifier always runs on BEDROCK_MODEL_FAST regardless of the outcome so
 * the classification cost is always <$0.001 per request.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'af-south-1' });

// Always classify with Haiku — cost: ~200 input tokens + ~5 output tokens per call
const CLASSIFIER_MODEL = process.env.BEDROCK_MODEL_FAST;

const CLASSIFIER_SYSTEM = `You are an intent classifier for a TalentFlow HR recruitment assistant.
Classify the user request into exactly one category. Reply with ONLY the category name — no explanation.

Categories:
SIMPLE         - Single read operation: look up one candidate, check pipeline status, get vote summary, check SLA for one workflow
TOOL_REQUIRED  - Needs multiple tools, write operations, risk assessment, scheduling, cross-entity queries, or complex reasoning`;

/**
 * Classify the effective user message using Haiku.
 *
 * @param {string} message    - the effective message (synthesised or raw)
 * @param {string} templateId - e.g. "candidate_status", "freeform"
 * @returns {Promise<{ intentClass: 'SIMPLE'|'TOOL_REQUIRED'|'UNKNOWN', classifierTokens: object, error?: string }>}
 */
export async function classifyIntent(message, templateId) {
  // Fast-path: template-based classification — no LLM call needed
  const SIMPLE_TEMPLATES = new Set([
    'candidate_status',
    'pipeline_overview',
    'vote_summary',
    'sla_status',
  ]);
  const COMPLEX_TEMPLATES = new Set([
    'evaluation_risk',
    'sla_prediction',
    'config_recommendation',
  ]);

  if (templateId && templateId !== 'freeform' && templateId !== 'follow_up') {
    if (SIMPLE_TEMPLATES.has(templateId))  return { intentClass: 'SIMPLE',        classifierTokens: {} };
    if (COMPLEX_TEMPLATES.has(templateId)) return { intentClass: 'TOOL_REQUIRED', classifierTokens: {} };
  }

  // Freeform / follow_up: call Haiku for classification
  const prompt = `TalentFlow HR assistant request: "${message.slice(0, 400)}"`;

  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 10,
    system: CLASSIFIER_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  };

  try {
    const cmd = new InvokeModelCommand({
      modelId:     CLASSIFIER_MODEL,
      contentType: 'application/json',
      accept:      'application/json',
      body:        JSON.stringify(payload),
    });

    const res    = await bedrock.send(cmd);
    const body   = JSON.parse(new TextDecoder().decode(res.body));
    const raw    = body.content?.[0]?.text?.trim().toUpperCase() ?? '';
    const tokens = body.usage ?? {};

    let intentClass = 'UNKNOWN';
    if (raw.startsWith('SIMPLE'))    intentClass = 'SIMPLE';
    else if (raw.startsWith('TOOL')) intentClass = 'TOOL_REQUIRED';

    return { intentClass, classifierTokens: tokens };
  } catch (err) {
    // Classification failure is non-fatal — fall back to UNKNOWN → BEDROCK_MODEL_SMART
    return { intentClass: 'UNKNOWN', classifierTokens: {}, error: err.message };
  }
}

/**
 * Select the Bedrock model ID based on the intent class.
 *
 * @param {'SIMPLE'|'TOOL_REQUIRED'|'UNKNOWN'} intentClass
 * @returns {string} modelId
 */
export function selectModel(intentClass) {
  if (intentClass === 'SIMPLE') {
    return process.env.BEDROCK_MODEL_FAST;
  }
  // TOOL_REQUIRED and UNKNOWN both use the smart model
  return process.env.BEDROCK_MODEL_SMART;
}
