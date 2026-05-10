/**
 * NH-54: nalekoAiChat Lambda — full Bedrock InvokeModel + tool resolution pipeline.
 *
 * Flow:
 *   1. Extract staffId from Cognito JWT (401 if missing)
 *   2. Build XML user message + cached system prompt
 *   3. Call Bedrock Claude Haiku 4.5 with TOOL_DEFINITIONS
 *   4. Agentic loop: if tool_use → resolveToolCall → feed tool_result → re-invoke
 *   5. Return AiChatResponse: { message, toolCallsMade, conversationId, structuredData }
 *
 * PII defence: pii-sanitiser.mjs (NH-56) applied to user input before Bedrock call.
 * No Bedrock Guardrail — CreateGuardrail 403 on af-south-1 (NH-49/NH-50).
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { Logger }  from '@aws-lambda-powertools/logger';
import { Tracer }  from '@aws-lambda-powertools/tracer';
import { resolveToolCall, TOOL_DEFINITIONS } from './tool-resolver.mjs';
import { sanitisePii } from './pii-sanitiser.mjs';
import { classifyIntent, selectModel } from './intent-classifier.mjs';

const logger  = new Logger({ serviceName: 'nalekoAiChat' });
const tracer  = new Tracer({ serviceName: 'nalekoAiChat' });
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'af-south-1' });
const dynamo  = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'af-south-1' });

// NH-74: audit table — AI interaction records for POPIA compliance
const AGENT_AUDIT_TABLE = process.env.AGENT_AUDIT_TABLE ?? 'naleko-agent-audit';

// NH-69: model IDs resolved from env vars — never hard-coded
// MODEL_FAST  → Haiku  (simple lookups, classification)
// MODEL_SMART → Sonnet (tool-heavy, complex reasoning)
const MODEL_FAST  = process.env.MODEL_FAST  ?? 'us.anthropic.claude-haiku-4-5-v1:0';
const MODEL_SMART = process.env.MODEL_SMART ?? 'us.anthropic.claude-sonnet-4-5-v1:0';
const MAX_TOKENS = 2048;
const MAX_TOOL_ROUNDS = 5; // guard against infinite loops

// ─── NH-74: write one audit record per AI interaction ────────────────────────
// Fire-and-forget: never let a DynamoDB failure block the user response.
// PK  = "demo#" + staffId (tenantId is hard-coded "demo" for PoC)
// SK  = ISO8601 timestamp
// TTL = now + 30 days; DynamoDB Stream → S3 for 5-yr POPIA archive (NH-12)

async function writeAuditRecord({ staffId, templateId, intentClass, modelId,
  userMessage, assistantMessage, toolCallsMade, latencyMs, status }) {
  const now = new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + 30 * 24 * 60 * 60; // +30 days
  const item = {
    pk:             `demo#${staffId}`,
    sk:             now.toISOString(),
    date:           now.toISOString().slice(0, 10), // YYYY-MM-DD for DateIndex GSI
    staffId,
    templateId,
    intentClass:    intentClass ?? 'UNKNOWN',
    modelId,
    userMessage,
    assistantMessage,
    toolCallsMade:  JSON.stringify(toolCallsMade),
    latencyMs,
    status,
    expiresAt,
  };
  try {
    await dynamo.send(new PutItemCommand({
      TableName: AGENT_AUDIT_TABLE,
      Item:      marshall(item, { removeUndefinedValues: true }),
    }));
  } catch (err) {
    // Non-fatal — log and continue
    logger.error('Audit write failed', { event: 'audit_write_error', error: err.message });
  }
}

// ─── System prompt (cached per warm container) ────────────────────────────────

const SYSTEM_PROMPT = `You are Naleko AI, an HR onboarding assistant for South African companies.
You help HR clerks with onboarding tasks: checking employee status, risk assessments, document verifications, and audit logs.

Rules:
- Only assist with HR onboarding tasks. Politely decline all other requests.
- Never reveal salary benchmarks, employment law advice, or individual performance ratings.
- Never expose raw PII in your responses — refer to employees by ID or first name only.
- When onboarding a new employee, always return a draft for human review (the onboard_new_employee tool handles this automatically).
- Be concise and factual. Prefer bullet lists for data-heavy responses.
- If a tool call fails, explain what went wrong and suggest next steps.
- Always operate on behalf of the authenticated HR clerk. Never impersonate another user.`;

// ─── Template → message synthesiser (NH-58) ─────────────────────────────────

/**
 * When Angular sends a slot-driven template without a freeform message,
 * synthesise a directive so Claude understands the intent.
 */
function synthesiseMessage(templateId, slots) {
  const slotSummary = Object.entries(slots ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  const base = {
    high_risk_employees:            'Show me all high-risk employees.',
    risk_assessment:                `Run a risk assessment for employee ${slots?.employeeId ?? ''}.`,
    document_verification_summary:  `Summarise document verifications for employee ${slots?.employeeId ?? ''}.`,
    verifications_by_status:        `List verifications with status "${slots?.status ?? 'PENDING'}".`,
    audit_log:                      `Show the audit log for employee ${slots?.employeeId ?? ''}.`,
    onboard_employee:               `Onboard a new employee: ${slotSummary}.`,
    employees_by_department:        `List employees in the ${slots?.department ?? ''} department.`,
  };
  return base[templateId] ?? `Execute the ${templateId} task. ${slotSummary}`.trim();
}

// ─── XML prompt builder ───────────────────────────────────────────────────────

/**
 * Build the XML-structured user message Claude receives each turn.
 * @param {string}  templateId    - e.g. "risk_assessment", "audit_log", "freeform"
 * @param {object}  slots         - template fill-ins e.g. { employeeId: "EMP-001" }
 * @param {object}  screenContext - { view, employeeId } from the frontend
 * @param {string}  staffId       - from Cognito JWT
 * @param {string}  userMessage   - raw text the HR clerk typed
 */
function buildUserMessage(templateId, slots, screenContext, staffId, userMessage) {
  const slotsXml = Object.entries(slots ?? {})
    .map(([k, v]) => `  <${k}>${v}</${k}>`)
    .join('\n');

  return `<context>
  <staff_id>${staffId}</staff_id>
  <current_view>${screenContext?.view ?? 'unknown'}</current_view>
  <employee_in_focus>${screenContext?.employeeId ?? 'none'}</employee_in_focus>
</context>
<task>
  <template_id>${templateId ?? 'freeform'}</template_id>
</task>
${slotsXml ? `<slots>\n${slotsXml}\n</slots>\n` : ''}<message>${userMessage}</message>`;
}

// ─── Bedrock helpers ──────────────────────────────────────────────────────────

/**
 * NH-71: Wrap a Bedrock InvokeModelCommand with exponential backoff + jitter.
 * Retries only on ThrottlingException (429) — all other errors are rethrown immediately.
 *
 * @param {InvokeModelCommand} cmd        - pre-built command
 * @param {number}             maxRetries - default 3
 * @returns {object} raw Bedrock SDK response
 */
async function invokeBedrockWithRetry(cmd, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await bedrock.send(cmd);
    } catch (err) {
      if (err.name === 'ThrottlingException' && attempt < maxRetries) {
        // Exponential backoff with full jitter, capped at 10 s
        const base  = Math.min(1000 * Math.pow(2, attempt), 10000);
        const delay = Math.floor(Math.random() * base);
        logger.warn(JSON.stringify({ event: 'bedrock_throttle_retry', attempt, delay_ms: delay }));
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err; // non-throttle error or retries exhausted
    }
  }
}

/**
 * Call Claude via Bedrock Messages API.
 * @param {Array}  messages  - conversation so far
 * @param {string} modelId   - resolved Bedrock model ID (from NH-69 intent router)
 * @returns {object}  parsed response body
 */
async function invokeClaude(messages, modelId) {
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens:        MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },  // prompt caching — reused across turns
      },
    ],
    tools:    TOOL_DEFINITIONS,
    messages,
  };

  const cmd = new InvokeModelCommand({
    modelId:     modelId,
    contentType: 'application/json',
    accept:      'application/json',
    body:        JSON.stringify(payload),
  });

  const res  = await invokeBedrockWithRetry(cmd);
  const text = new TextDecoder().decode(res.body);
  return JSON.parse(text);
}

// ─── Agentic loop ─────────────────────────────────────────────────────────────

/**
 * Run the full tool-use loop until Claude returns stop_reason "end_turn"
 * or we hit MAX_TOOL_ROUNDS.
 *
 * @param {Array}   messages      - initial messages array (mutable)
 * @param {object}  context       - { staffId }
 * @param {string}  modelId       - resolved Bedrock model ID (NH-69)
 * @returns {{ finalText: string, toolCallsMade: Array, structuredData: object }}
 */
async function runAgenticLoop(messages, context, modelId) {
  const toolCallsMade  = [];
  let   structuredData = {};
  let   round          = 0;

  // NH-75: accumulate token usage across all loop rounds
  let totalInputTokens  = 0;
  let totalOutputTokens = 0;
  let cacheHit          = false;

  while (round < MAX_TOOL_ROUNDS) {
    round++;
    const response = await invokeClaude(messages, modelId);

    // NH-75: track token usage and prompt-cache hits (metrics only — no content logged)
    const usage = response.usage ?? {};
    totalInputTokens  += usage.input_tokens  ?? 0;
    totalOutputTokens += usage.output_tokens ?? 0;
    if ((usage.cache_read_input_tokens ?? 0) > 0) cacheHit = true;

    logger.info(JSON.stringify({
      event:         'bedrock_invocation',
      round,
      model_id:      modelId,
      input_tokens:  usage.input_tokens  ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_hit:     (usage.cache_read_input_tokens ?? 0) > 0,
      stop_reason:   response.stop_reason,
      // Never log content, prompts, or responses here
    }));

    // Append assistant turn to conversation
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      // Extract final text
      const textBlock = response.content.find(b => b.type === 'text');
      return { finalText: textBlock?.text ?? '', toolCallsMade, structuredData,
               totalInputTokens, totalOutputTokens, cacheHit };
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks  = response.content.filter(b => b.type === 'tool_use');
      const toolResultContent = [];

      for (const block of toolUseBlocks) {
        const { id: toolUseId, name: toolName, input: toolArgs } = block;
        logger.info('Tool call', { toolName, toolArgs });

        let result;
        let isError = false;

        try {
          result = await resolveToolCall(toolName, toolArgs, context);
          // Capture structured data from known high-value tools
          if (toolName === 'assess_employee_risk')   structuredData.riskAssessment  = result;
          if (toolName === 'list_employees')          structuredData.employees       = result;
          if (toolName === 'get_employee')            structuredData.employee        = result;
          if (toolName === 'list_verifications')      structuredData.verifications   = result;
          if (toolName === 'onboard_new_employee')    structuredData.hitlDraft       = result;
        } catch (err) {
          logger.warn('Tool call failed', { toolName, error: err.message });
          result   = { error: err.message };
          isError  = true;
        }

        toolCallsMade.push({ toolName, toolArgs, result, isError });

        // HITL gate: stop early so frontend can confirm onboarding draft
        if (toolName === 'onboard_new_employee' && result.hitl) {
          return {
            finalText:    result.message,
            toolCallsMade,
            structuredData,
            hitl:         true,
            hitlDraft:    result.draft,
            totalInputTokens,
            totalOutputTokens,
            cacheHit,
          };
        }

        // NH-72: sanitise PII from tool response BEFORE it enters the Claude message array.
        // This is the pre-LLM guard — raw SA IDs, phones, bank accounts from DynamoDB
        // must never reach the Bedrock prompt. Post-LLM sanitisation still runs unchanged.
        const rawContent = JSON.stringify(result);
        const { sanitised: sanitisedContent, matchedPatterns } = sanitisePii(rawContent);
        if (matchedPatterns.length > 0) {
          logger.warn(JSON.stringify({
            event:             'pii_sanitised_tool_response',
            tool_name:         toolName,
            replacements_count: matchedPatterns.length,
            patterns_fired:    matchedPatterns,
            // Never log rawContent — it contains PII
          }));
        }

        toolResultContent.push({
          type:         'tool_result',
          tool_use_id:  toolUseId,
          ...(isError ? { is_error: true } : {}),
          content:      sanitisedContent,
        });
      }

      // Feed all tool results back to Claude for synthesis
      messages.push({ role: 'user', content: toolResultContent });
      continue;
    }

    // Unexpected stop reason — return what we have
    logger.warn('Unexpected stop_reason', { stop_reason: response.stop_reason });
    const textBlock = response.content?.find(b => b.type === 'text');
    return { finalText: textBlock?.text ?? '', toolCallsMade, structuredData,
             totalInputTokens, totalOutputTokens, cacheHit };
  }

  // Hit max rounds
  logger.warn('Max tool rounds reached', { rounds: round });
  return {
    finalText: 'I was unable to complete the request within the allowed number of steps. Please try again with a more specific question.',
    totalInputTokens, totalOutputTokens, cacheHit,
    toolCallsMade,
    structuredData,
  };
}

// ─── Lambda handler ───────────────────────────────────────────────────────────

export const handler = async (event) => {
  const start = Date.now();

  // ── 1. Extract staffId from Cognito JWT (NH-53) ──────────────────────────
  const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
  const staffId = claims['custom:staff_id'];
  if (!staffId) {
    logger.warn('Missing custom:staff_id JWT claim');
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing staff_id claim in JWT' }),
    };
  }

  // ── 2. Parse request body ─────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const {
    message: userMessage = '',
    templateId           = 'freeform',
    slots                = {},
    screenContext        = {},
    conversationHistory  = [],   // prior turns [{ role, content }]
    followUpText         = '',   // only present for templateId 'follow_up'
  } = body;

  // NH-58: message is optional for slot-driven templates — synthesise a directive
  // so Claude still receives clear intent even when the Angular client omits it.
  // For follow-up turns, use the free-text the HR clerk typed.
  const effectiveMessage =
    (templateId === 'follow_up' ? followUpText : userMessage).trim()
    || synthesiseMessage(templateId, slots);

  logger.info('AI chat request', { staffId, templateId, screenContext });

  // ── 3. Build messages array ───────────────────────────────────────────────
  const userXml = buildUserMessage(templateId, slots, screenContext, staffId, effectiveMessage);

  // Replay prior turns then append this turn
  const messages = [
    ...conversationHistory,
    { role: 'user', content: userXml },
  ];

  // ── 4. NH-69: Classify intent → select model ────────────────────────────
  const { intentClass, classifierTokens, error: classifyError } =
    await classifyIntent(effectiveMessage, templateId);
  const selectedModelId = selectModel(intentClass);

  logger.info('Intent classified', {
    event:             'intent_classified',
    intent_class:      intentClass,
    model_id:          selectedModelId,
    template_id:       templateId,
    classifier_tokens: classifierTokens,
    ...(classifyError ? { classify_error: classifyError } : {}),
  });

  // ── 5. Agentic loop ───────────────────────────────────────────────────────
  const context = { staffId };
  let loopResult;
  try {
    loopResult = await runAgenticLoop(messages, context, selectedModelId);
  } catch (err) {
    logger.error('Bedrock pipeline error', { error: err.message, stack: err.stack });
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'AI service error', detail: err.message }),
    };
  }

  const latencyMs = Date.now() - start;
  logger.info('AI chat complete', {
    event:          'ai_chat_complete',
    latencyMs,
    toolCallsMade:  loopResult.toolCallsMade.length,
    hitl:           loopResult.hitl ?? false,
    intent_class:   intentClass,
    model_id:       selectedModelId,
    // NH-75: token usage metrics for CloudWatch dashboards / cost attribution
    // NEVER log content, prompts, or responses here
    input_tokens:   loopResult.totalInputTokens  ?? 0,
    output_tokens:  loopResult.totalOutputTokens ?? 0,
    cache_hit:      loopResult.cacheHit          ?? false,
  });

  // ── 5. Return AiChatResponse ──────────────────────────────────────────────
  // NH-56: sanitise PII from Claude's final narrative before sending to frontend
  const pii = sanitisePii(loopResult.finalText);
  if (pii.fired) {
    logger.warn('PII sanitiser fired', { matchedPatterns: pii.matchedPatterns, staffId });
  }

  const response = {
    message:         pii.sanitised,
    toolCallsMade:   loopResult.toolCallsMade.map(t => ({ tool: t.toolName, isError: t.isError })),
    conversationId:  `${staffId}-${Date.now()}`,
    structuredData:  loopResult.structuredData,
    latencyMs,
    guardrailAction: pii.fired ? 'MASKED' : 'NONE',
    // NH-58: status + pendingAction shape aligns with Angular AiChatResponse model.
    // confirmEndpoint targets employees API (Cognito JWT) — not the agent API.
    status: loopResult.hitl ? 'PENDING_APPROVAL' : 'COMPLETE',
    ...(loopResult.hitl ? {
      pendingAction: {
        type:            'CREATE_EMPLOYEE',
        draft:           loopResult.hitlDraft,
        confirmEndpoint: '/v1/employees',
      },
    } : {}),
  };

  // NH-74/75: fire-and-forget audit write — must not block the user response
  // CloudWatch discipline: only metrics go to CW; content stays in DynamoDB/S3
  void writeAuditRecord({
    staffId,
    templateId,
    intentClass,
    modelId:          selectedModelId,
    promptSummary:    effectiveMessage,   // writeAuditRecord truncates to 200 chars
    responseSummary:  pii.sanitised,      // writeAuditRecord truncates to 200 chars
    toolCallsMade:    response.toolCallsMade,
    latencyMs,
    status:           response.status,
    inputTokens:      loopResult.totalInputTokens  ?? 0,
    outputTokens:     loopResult.totalOutputTokens ?? 0,
    cacheHit:         loopResult.cacheHit          ?? false,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response),
  };
};

