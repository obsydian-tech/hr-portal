/**
 * AI-002 / NH-128: talentFlowAiChat Lambda — Bedrock InvokeModel + tool resolution pipeline.
 *
 * Flow:
 *   1. Extract staffId from Cognito JWT (401 if missing)
 *   2. Hourly rate limit check (429 if exceeded)
 *   3. Classify intent → select model (Haiku vs Sonnet)
 *   4. Prompt cache lookup (SIMPLE intents only)
 *   5. Build XML user message + run agentic loop
 *   6. Sanitise PII from Claude's final response
 *   7. Write audit record (fire-and-forget)
 *   8. Return AiChatResponse: { message, toolCallsMade, conversationId, structuredData }
 *
 * PII defence: pii-sanitiser.mjs applied to user input + tool responses + Claude output.
 * No Powertools — console.log(JSON.stringify({...})) throughout.
 * No SecretsManager — tool-resolver queries DynamoDB directly.
 */

import { BedrockRuntimeClient, InvokeModelCommand }           from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient, PutItemCommand, UpdateItemCommand }   from '@aws-sdk/client-dynamodb';
import { createHash }                                          from 'node:crypto';
import { marshall }                                            from '@aws-sdk/util-dynamodb';
import { resolveToolCall, TOOL_DEFINITIONS }                   from './tool-resolver.mjs';
import { sanitisePii }                                         from './pii-sanitiser.mjs';
import { classifyIntent, selectModel }                         from './intent-classifier.mjs';
import { buildCacheKey, getCached, setCached }                 from './cache.mjs';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'af-south-1' });
const dynamo  = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'af-south-1' });

// Env vars (all resolved from process.env — no hard-coded values)
const AGENT_AUDIT_TABLE_NAME = process.env.AGENT_AUDIT_TABLE_NAME ?? 'talent-flow-agent-audit';
const RATE_LIMIT_TABLE_NAME  = process.env.RATE_LIMIT_TABLE_NAME  ?? 'talent-flow-ai-rate-limit';

// Model IDs resolved from env (set by Terraform)
const MODEL_SMART = process.env.BEDROCK_MODEL_SMART ?? '';
const MODEL_FAST  = process.env.BEDROCK_MODEL_FAST  ?? MODEL_SMART;

const MAX_TOKENS      = 2048;
const MAX_TOOL_ROUNDS = 5;

// Token budget / context guards
const MAX_TOOL_RESPONSE_CHARS = 8000;    // ≈ 2 000 tokens
const MAX_CONTEXT_CHARS       = 180_000; // ≈ 45 000 tokens

// History summarisation: every N user turns using MODEL_FAST
const SUMMARISE_EVERY_N_TURNS = 8;

// Per-staff-id hourly rate limit
const RATE_LIMIT_RPH = parseInt(process.env.RATE_LIMIT_RPH ?? '50', 10);

// ─── Rate limiting ────────────────────────────────────────────────────────────

function hashStaffId(staffId) {
  return createHash('sha256').update(staffId).digest('hex').slice(0, 16);
}

async function checkRateLimit(staffId) {
  const now         = Date.now();
  const windowStart = Math.floor(now / 3_600_000) * 3600;
  const expiresAt   = windowStart + 3600;
  const pk          = `rateLimit#${staffId}#${windowStart}`;

  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: RATE_LIMIT_TABLE_NAME,
      Key: { pk: { S: pk } },
      UpdateExpression:
        'ADD requestCount :one SET expiresAt = if_not_exists(expiresAt, :exp)',
      ConditionExpression:
        'attribute_not_exists(requestCount) OR requestCount < :limit',
      ExpressionAttributeValues: {
        ':one':   { N: '1' },
        ':limit': { N: String(RATE_LIMIT_RPH) },
        ':exp':   { N: String(expiresAt) },
      },
    }));
    return null; // allowed
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      const retryAfter = expiresAt - Math.floor(now / 1000);
      console.log(JSON.stringify({
        event:           'rate_limited',
        session_id_hash: hashStaffId(staffId),
        retryAfter,
      }));
      return retryAfter;
    }
    // Fail open so legit users aren't blocked by IAM / network errors
    console.error(JSON.stringify({ event: 'rate_limit_check_failed', err: err.message }));
    return null;
  }
}

// ─── Audit record ─────────────────────────────────────────────────────────────

async function writeAuditRecord({
  staffId, templateId, intentClass, modelId,
  promptSummary, responseSummary, toolCallsMade, latencyMs, status,
  inputTokens, outputTokens, cacheHit,
  conversationId, guardrailAction, bedrockRequestId, employeesAccessed,
  toolOutputsRaw,
}) {
  const now       = new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + 90 * 24 * 60 * 60; // +90 days (POPIA)
  const truncate  = (s, n = 200) => (typeof s === 'string' ? s.slice(0, n) : s);

  const item = {
    pk:                  `talentflow#${staffId}`,
    sk:                  now.toISOString(),
    date:                now.toISOString().slice(0, 10),
    actor_type:          'AI_AGENT',
    staffId,
    templateId,
    intentClass:         intentClass ?? 'UNKNOWN',
    modelId,
    conversation_id:     conversationId,
    bedrock_request_id:  bedrockRequestId,
    guardrail_action:    guardrailAction ?? 'NONE',
    employees_accessed:  JSON.stringify(employeesAccessed ?? []),
    promptSummary:       truncate(promptSummary),
    responseSummary:     truncate(responseSummary),
    toolCallsMade:       JSON.stringify(toolCallsMade),
    tool_outputs_raw:    toolOutputsRaw ? JSON.stringify(toolOutputsRaw) : '{}',
    latencyMs,
    inputTokens,
    outputTokens,
    cacheHit:            cacheHit ?? false,
    status,
    expiresAt,
  };
  try {
    await dynamo.send(new PutItemCommand({
      TableName: AGENT_AUDIT_TABLE_NAME,
      Item:      marshall(item, { removeUndefinedValues: true }),
    }));
  } catch (err) {
    console.error(JSON.stringify({ event: 'audit_write_error', error: err.message }));
  }
}

// ─── Tool-response truncator ──────────────────────────────────────────────────

function truncateToolResponse(content) {
  if (content.length <= MAX_TOOL_RESPONSE_CHARS) return content;
  const omitted = content.length - MAX_TOOL_RESPONSE_CHARS;
  console.warn(JSON.stringify({
    event:          'tool_response_truncated',
    original_chars: content.length,
    kept_chars:     MAX_TOOL_RESPONSE_CHARS,
    omitted_chars:  omitted,
  }));
  return content.slice(0, MAX_TOOL_RESPONSE_CHARS) + ` [TRUNCATED: ${omitted} chars omitted]`;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are TalentFlow AI, an HR recruitment pipeline assistant for South African companies.
You help HR professionals with recruitment tasks: checking candidate status, pipeline overviews, vote summaries, SLA monitoring, and workflow audits.

Rules:
- Only assist with HR recruitment and talent pipeline tasks. Politely decline all other requests.
- Never reveal individual salary benchmarks, employment law advice, or individual performance ratings.
- Never expose raw PII in your responses — refer to candidates by ID or first name only.
- When scheduling interviews or making config changes, always route through the approval workflow (the relevant tool handles this automatically).
- Be concise and factual. Prefer bullet lists for data-heavy responses.
- If a tool call fails, explain what went wrong and suggest next steps.
- Always operate on behalf of the authenticated HR staff member. Never impersonate another user.`;

// ─── Template → message synthesiser ──────────────────────────────────────────

function synthesiseMessage(templateId, slots) {
  const slotSummary = Object.entries(slots ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  const base = {
    candidate_status:      `Show me the current status for candidate ${slots?.candidateId ?? ''}.`,
    pipeline_overview:     `Give me a pipeline overview${slots?.stage ? ` for the ${slots.stage} stage` : ''}.`,
    vote_summary:          `Summarise reviewer votes for candidate ${slots?.candidateId ?? ''}.`,
    sla_status:            `Show the SLA status for workflow ${slots?.workflowId ?? ''}.`,
    evaluation_risk:       `Assess evaluation risk for candidate ${slots?.candidateId ?? ''}.`,
    sla_prediction:        `Predict SLA risk for workflow ${slots?.workflowId ?? ''}.`,
    config_recommendation: `Recommend config changes for ${slots?.configType ?? 'scoring weights'}.`,
  };
  return base[templateId] ?? `Execute the ${templateId} task. ${slotSummary}`.trim();
}

// ─── XML prompt builder ───────────────────────────────────────────────────────

function buildUserMessage(templateId, slots, screenContext, staffId, userMessage) {
  const slotsXml = Object.entries(slots ?? {})
    .map(([k, v]) => `  <${k}>${v}</${k}>`)
    .join('\n');

  return `<context>
  <staff_id>${staffId}</staff_id>
  <current_view>${screenContext?.view ?? 'unknown'}</current_view>
  <candidate_in_focus>${screenContext?.candidateId ?? 'none'}</candidate_in_focus>
</context>
<task>
  <template_id>${templateId ?? 'freeform'}</template_id>
</task>
${slotsXml ? `<slots>\n${slotsXml}\n</slots>\n` : ''}<message>${userMessage}</message>`;
}

// ─── History summariser ───────────────────────────────────────────────────────

async function maybeSummariseHistory(messages) {
  const userTurns = messages.filter(m => m.role === 'user').length;
  if (userTurns === 0 || userTurns % SUMMARISE_EVERY_N_TURNS !== 0) return messages;

  try {
    const historyText = messages
      .map(m => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n\n');

    const summaryPayload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens:        300,
      messages: [{
        role: 'user',
        content:
          'Summarise the following TalentFlow HR recruitment assistant conversation concisely. ' +
          'Preserve: key candidate IDs mentioned, actions taken, pending approvals, and any SLA flags. ' +
          'Output plain text only — no markdown headers.\n\n' + historyText,
      }],
    };

    const cmd = new InvokeModelCommand({
      modelId:     MODEL_FAST,
      contentType: 'application/json',
      accept:      'application/json',
      body:        JSON.stringify(summaryPayload),
    });

    const res     = await invokeBedrockWithRetry(cmd);
    const parsed  = JSON.parse(new TextDecoder().decode(res.body));
    const summary = parsed.content?.find(b => b.type === 'text')?.text ?? '';

    if (!summary) throw new Error('empty summary from Bedrock');

    console.log(JSON.stringify({
      event:            'history_summarised',
      turns_summarised: userTurns,
      model_id:         MODEL_FAST,
      summary_chars:    summary.length,
    }));

    return [
      { role: 'user',      content: `[Conversation summary — ${userTurns} turns]: ${summary}` },
      { role: 'assistant', content: 'Understood. I have the context from the prior conversation.' },
    ];
  } catch (err) {
    console.warn(JSON.stringify({ event: 'history_summarise_failed', error: err.message }));
    return messages;
  }
}

// ─── Bedrock helpers ──────────────────────────────────────────────────────────

async function invokeBedrockWithRetry(cmd, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await bedrock.send(cmd);
    } catch (err) {
      if (err.name === 'ThrottlingException' && attempt < maxRetries) {
        const base  = Math.min(1000 * Math.pow(2, attempt), 10000);
        const delay = Math.floor(Math.random() * base);
        console.warn(JSON.stringify({ event: 'bedrock_throttle_retry', attempt, delay_ms: delay }));
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

async function invokeClaude(messages, modelId) {
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens:        MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools:    TOOL_DEFINITIONS,
    messages,
  };

  const cmd = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept:      'application/json',
    body:        JSON.stringify(payload),
  });

  const res    = await invokeBedrockWithRetry(cmd);
  const text   = new TextDecoder().decode(res.body);
  const parsed = JSON.parse(text);
  parsed._bedrockRequestId = res.$metadata?.requestId ?? null;
  return parsed;
}

// ─── Agentic loop ─────────────────────────────────────────────────────────────

async function runAgenticLoop(messages, context, modelId) {
  const toolCallsMade  = [];
  let   structuredData = {};
  let   round          = 0;

  let totalInputTokens     = 0;
  let totalOutputTokens    = 0;
  let cacheHit             = false;
  let lastBedrockRequestId = null;
  const employeesAccessed  = new Set();
  const toolOutputsRaw     = {};

  while (round < MAX_TOOL_ROUNDS) {
    round++;

    // Context window guard
    const totalChars = messages.reduce((acc, m) => acc + JSON.stringify(m).length, 0);
    if (totalChars > MAX_CONTEXT_CHARS && messages.length > 11) {
      const trimmed = messages.length - 11;
      messages.splice(1, trimmed);
      console.warn(JSON.stringify({
        event:            'context_trimmed',
        messages_removed: trimmed,
        chars_before:     totalChars,
      }));
    }

    const response = await invokeClaude(messages, modelId);
    lastBedrockRequestId = response._bedrockRequestId ?? lastBedrockRequestId;

    const usage = response.usage ?? {};
    totalInputTokens  += usage.input_tokens  ?? 0;
    totalOutputTokens += usage.output_tokens ?? 0;
    if ((usage.cache_read_input_tokens ?? 0) > 0) cacheHit = true;

    console.log(JSON.stringify({
      event:             'bedrock_invocation',
      round,
      model_id:          modelId,
      input_tokens:      usage.input_tokens              ?? 0,
      output_tokens:     usage.output_tokens             ?? 0,
      cache_read_tokens: usage.cache_read_input_tokens   ?? 0,
      cache_hit:         (usage.cache_read_input_tokens  ?? 0) > 0,
      stop_reason:       response.stop_reason,
    }));

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text');
      return { finalText: textBlock?.text ?? '', toolCallsMade, structuredData,
               totalInputTokens, totalOutputTokens, cacheHit,
               lastBedrockRequestId, employeesAccessed: [...employeesAccessed],
               toolOutputsRaw };
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks     = response.content.filter(b => b.type === 'tool_use');
      const toolResultContent = [];

      for (const block of toolUseBlocks) {
        const { id: toolUseId, name: toolName, input: toolArgs } = block;
        console.log(JSON.stringify({ event: 'tool_call', toolName, toolArgs }));

        const _candidateId = toolArgs?.candidateId ?? toolArgs?.id ?? null;
        if (_candidateId) employeesAccessed.add(_candidateId);

        let result;
        let isError           = false;
        const _toolCalledAt   = new Date().toISOString();
        const _toolStart      = Date.now();

        try {
          result = await resolveToolCall(toolName, toolArgs, context);

          if (toolName === 'get_candidate')        structuredData.candidate       = result;
          if (toolName === 'get_pipeline_overview') structuredData.pipeline       = result;
          if (toolName === 'get_vote_summary')     structuredData.voteSummary     = result;
          if (toolName === 'get_sla_status')       structuredData.slaStatus       = result;
          if (toolName === 'get_config')           structuredData.config          = result;
        } catch (err) {
          console.warn(JSON.stringify({ event: 'tool_call_failed', toolName, error: err.message }));
          result  = { error: err.message };
          isError = true;
        }

        toolCallsMade.push({ toolName, toolArgs, result, isError });

        const _toolLatency    = Date.now() - _toolStart;
        const _rawResponseStr = JSON.stringify(result ?? {});
        const _truncated      = _rawResponseStr.length > 2048;
        const _toolKey        = `${toolName}#${Object.keys(toolOutputsRaw).filter(k => k.startsWith(toolName)).length}`;
        toolOutputsRaw[_toolKey] = {
          called_at:  _toolCalledAt,
          request:    toolArgs,
          response:   _truncated ? { _truncated: true, preview: _rawResponseStr.slice(0, 2048) } : (result ?? {}),
          truncated:  _truncated,
          http_status: isError ? 500 : 200,
          latency_ms:  _toolLatency,
        };

        // Pre-LLM PII sanitisation on tool response
        const rawContent = JSON.stringify(result);
        const { sanitised: sanitisedContent, matchedPatterns } = sanitisePii(rawContent);
        if (matchedPatterns.length > 0) {
          console.warn(JSON.stringify({
            event:              'pii_sanitised_tool_response',
            tool_name:          toolName,
            replacements_count: matchedPatterns.length,
            patterns_fired:     matchedPatterns,
          }));
        }

        const truncatedContent = truncateToolResponse(sanitisedContent);

        toolResultContent.push({
          type:         'tool_result',
          tool_use_id:  toolUseId,
          ...(isError ? { is_error: true } : {}),
          content:      truncatedContent,
        });
      }

      messages.push({ role: 'user', content: toolResultContent });
      continue;
    }

    // Unexpected stop reason
    console.warn(JSON.stringify({ event: 'unexpected_stop_reason', stop_reason: response.stop_reason }));
    const textBlock = response.content?.find(b => b.type === 'text');
    return { finalText: textBlock?.text ?? '', toolCallsMade, structuredData,
             totalInputTokens, totalOutputTokens, cacheHit,
             lastBedrockRequestId, employeesAccessed: [...employeesAccessed],
             toolOutputsRaw };
  }

  console.warn(JSON.stringify({ event: 'max_tool_rounds_reached', rounds: round }));
  return {
    finalText: 'I was unable to complete the request within the allowed number of steps. Please try again with a more specific question.',
    totalInputTokens, totalOutputTokens, cacheHit,
    toolCallsMade, structuredData,
    lastBedrockRequestId,
    employeesAccessed: [...employeesAccessed],
    toolOutputsRaw,
  };
}

// ─── Lambda handler ───────────────────────────────────────────────────────────

export const handler = async (event) => {
  const start = Date.now();

  // 1. Extract staffId from Cognito JWT
  const claims  = event.requestContext?.authorizer?.jwt?.claims ?? {};
  const staffId = claims['custom:staff_id'];
  if (!staffId) {
    console.warn(JSON.stringify({ event: 'missing_staff_id' }));
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing staff_id claim in JWT' }),
    };
  }

  // 2. Hourly rate limit check
  const retryAfter = await checkRateLimit(staffId);
  if (retryAfter !== null) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
      body: JSON.stringify({ error: 'Rate limit exceeded. Please try again later.', retryAfter }),
    };
  }

  // 3. Parse request body
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
    conversationHistory  = [],
    followUpText         = '',
  } = body;

  const effectiveMessage =
    (templateId === 'follow_up' ? followUpText : userMessage).trim()
    || synthesiseMessage(templateId, slots);

  console.log(JSON.stringify({ event: 'ai_chat_request', staffId, templateId, screenContext }));

  // 4. Build messages
  const userXml = buildUserMessage(templateId, slots, screenContext, staffId, effectiveMessage);
  const rawHistory = [...conversationHistory];
  const summarisedHistory = await maybeSummariseHistory(rawHistory);
  const messages = [
    ...summarisedHistory,
    { role: 'user', content: userXml },
  ];

  // 5. Classify intent → select model
  const { intentClass, classifierTokens, error: classifyError } =
    await classifyIntent(effectiveMessage, templateId);
  const selectedModelId = selectModel(intentClass);

  console.log(JSON.stringify({
    event:             'intent_classified',
    intent_class:      intentClass,
    model_id:          selectedModelId,
    template_id:       templateId,
    classifier_tokens: classifierTokens,
    ...(classifyError ? { classify_error: classifyError } : {}),
  }));

  // 6. Prompt cache lookup (SIMPLE only)
  let cacheHitResponse = null;
  const cacheKey = intentClass === 'SIMPLE'
    ? buildCacheKey(SYSTEM_PROMPT, effectiveMessage, selectedModelId)
    : null;

  if (cacheKey) {
    cacheHitResponse = await getCached(cacheKey);
    if (cacheHitResponse) {
      console.log(JSON.stringify({ event: 'prompt_cache', cache_hit: true, model_id: selectedModelId }));
      const pii = sanitisePii(cacheHitResponse);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:         pii.sanitised,
          toolCallsMade:   [],
          conversationId:  `${staffId}-${Date.now()}`,
          structuredData:  {},
          latencyMs:       Date.now() - start,
          guardrailAction: pii.fired ? 'MASKED' : 'NONE',
          status:          'COMPLETE',
          cacheHit:        true,
        }),
      };
    }
    console.log(JSON.stringify({ event: 'prompt_cache', cache_hit: false, model_id: selectedModelId }));
  }

  // 7. Agentic loop
  const context = { staffId };
  let loopResult;
  try {
    loopResult = await runAgenticLoop(messages, context, selectedModelId);
  } catch (err) {
    console.error(JSON.stringify({ event: 'bedrock_pipeline_error', error: err.message, stack: err.stack }));
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'AI service error', detail: err.message }),
    };
  }

  const latencyMs = Date.now() - start;
  console.log(JSON.stringify({
    event:         'ai_chat_complete',
    latencyMs,
    toolCallsMade: loopResult.toolCallsMade.length,
    intent_class:  intentClass,
    model_id:      selectedModelId,
    input_tokens:  loopResult.totalInputTokens  ?? 0,
    output_tokens: loopResult.totalOutputTokens ?? 0,
    cache_hit:     loopResult.cacheHit          ?? false,
  }));

  // 8. PII sanitisation on Claude's final narrative
  const pii = sanitisePii(loopResult.finalText);
  if (pii.fired) {
    console.warn(JSON.stringify({ event: 'pii_sanitised_response', matchedPatterns: pii.matchedPatterns }));
  }

  // Check if any write tool was intercepted (PENDING_APPROVAL)
  const pendingApprovalResult = loopResult.toolCallsMade.find(
    t => t.result?.status === 'PENDING_APPROVAL'
  );

  const response = {
    message:         pii.sanitised,
    toolCallsMade:   loopResult.toolCallsMade.map(t => ({ tool: t.toolName, isError: t.isError })),
    conversationId:  `${staffId}-${Date.now()}`,
    structuredData:  loopResult.structuredData,
    latencyMs,
    guardrailAction: pii.fired ? 'MASKED' : 'NONE',
    status:          pendingApprovalResult ? 'PENDING_APPROVAL' : 'COMPLETE',
    ...(pendingApprovalResult ? {
      pendingAction: {
        actionId:    pendingApprovalResult.result.actionId,
        type:        pendingApprovalResult.toolArgs?.toolName ?? pendingApprovalResult.toolName,
        message:     pendingApprovalResult.result.message,
      },
    } : {}),
  };

  // Cache SIMPLE responses on miss (no tool calls, not pending)
  if (cacheKey && response.status === 'COMPLETE' && loopResult.toolCallsMade.length === 0) {
    void setCached(cacheKey, loopResult.finalText);
  }

  // Fire-and-forget audit write
  void writeAuditRecord({
    staffId,
    templateId,
    intentClass,
    modelId:           selectedModelId,
    promptSummary:     effectiveMessage,
    responseSummary:   pii.sanitised,
    toolCallsMade:     response.toolCallsMade,
    latencyMs,
    status:            response.status,
    inputTokens:       loopResult.totalInputTokens    ?? 0,
    outputTokens:      loopResult.totalOutputTokens   ?? 0,
    cacheHit:          loopResult.cacheHit            ?? false,
    conversationId:    response.conversationId,
    guardrailAction:   response.guardrailAction,
    bedrockRequestId:  loopResult.lastBedrockRequestId,
    employeesAccessed: loopResult.employeesAccessed   ?? [],
    toolOutputsRaw:    loopResult.toolOutputsRaw      ?? {},
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response),
  };
};
