/**
 * NH-69: Intent Classifier — Haiku-powered pre-flight classifier.
 *
 * Classifies each user request into one of three intent classes before
 * the main agentic loop runs. The class drives model selection:
 *
 *   SIMPLE       → MODEL_FAST (Haiku)   single-tool read, status check, lookup
 *   TOOL_REQUIRED → MODEL_SMART (Sonnet) multi-tool, complex reasoning, write ops
 *   UNKNOWN      → MODEL_SMART (Sonnet)  fallback — safe default
 *
 * The classifier always runs on MODEL_FAST regardless of the outcome so the
 * classification cost is always <$0.001 per request.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'af-south-1' });

// Always classify with Haiku — cost: ~200 input tokens + ~5 output tokens per call
const CLASSIFIER_MODEL = process.env.MODEL_FAST ?? 'us.anthropic.claude-haiku-4-5-v1:0';

const CLASSIFIER_SYSTEM = `You are an intent classifier for an HR onboarding assistant. 
Classify the user request into exactly one category. Reply with ONLY the category name — no explanation.

Categories:
SIMPLE         - Single read operation: look up one employee, check status, get one document, list verifications for one person
TOOL_REQUIRED  - Needs multiple tools, write operations, risk assessment, onboarding, cross-entity queries, or complex reasoning`;

/**
 * Classify the effective user message using Haiku.
 *
 * @param {string} message - the effective message (synthesised or raw)
 * @param {string} templateId - e.g. "risk_assessment", "freeform"
 * @returns {Promise<'SIMPLE'|'TOOL_REQUIRED'|'UNKNOWN'>}
 */
export async function classifyIntent(message, templateId) {
  // Fast-path: template-based classification — no LLM call needed
  const SIMPLE_TEMPLATES = new Set([
    'document_verification_summary',
    'audit_log',
    'verifications_by_status',
  ]);
  const COMPLEX_TEMPLATES = new Set([
    'high_risk_employees',
    'risk_assessment',
    'onboard_employee',
    'employees_by_department',
  ]);

  if (templateId && templateId !== 'freeform' && templateId !== 'follow_up') {
    if (SIMPLE_TEMPLATES.has(templateId))  return 'SIMPLE';
    if (COMPLEX_TEMPLATES.has(templateId)) return 'TOOL_REQUIRED';
  }

  // Freeform / follow_up: call Haiku for classification
  const prompt = `HR assistant request: "${message.slice(0, 400)}"`;

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

    // Normalise — accept partial matches for robustness
    let intentClass = 'UNKNOWN';
    if (raw.startsWith('SIMPLE'))        intentClass = 'SIMPLE';
    else if (raw.startsWith('TOOL'))     intentClass = 'TOOL_REQUIRED';

    return { intentClass, classifierTokens: tokens };
  } catch (err) {
    // Classification failure is non-fatal — fall back to UNKNOWN → MODEL_SMART
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
    return process.env.MODEL_FAST ?? 'us.anthropic.claude-haiku-4-5-v1:0';
  }
  // TOOL_REQUIRED and UNKNOWN both use the smart model
  return process.env.MODEL_SMART ?? 'us.anthropic.claude-sonnet-4-5-v1:0';
}
