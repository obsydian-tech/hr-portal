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
import { guardAi, isRobotCaller, markRobot, aiSwitchedOff, AI_SKIPPED_LABEL, AI_OFF_LABEL } from '../shared/ai-guard.mjs';
import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { createHash } from 'node:crypto';
import { marshall } from '@aws-sdk/util-dynamodb';
import { Logger }  from '@aws-lambda-powertools/logger';
import { Tracer }  from '@aws-lambda-powertools/tracer';
import { resolveToolCall, TOOL_DEFINITIONS } from './tool-resolver.mjs';
import { sanitisePii } from './pii-sanitiser.mjs';
import { classifyIntent, selectModel } from './intent-classifier.mjs';
import { buildCacheKey, getCached, setCached } from './cache.mjs';
import { hrOnly } from '../shared/hr-group.mjs';
import { requireTenant } from '../shared/tenant.mjs';
import { checksOf } from './answer-shape.mjs';
import { agentGet } from './tool-resolver.mjs';
import { personFacts } from './person.mjs';
import { todayWritten } from '../shared/due-date.mjs';
import { requireModule } from '../shared/modules.mjs';
import { redactNumbers } from '../shared/pii-redact.mjs';
import { appendExchange, ChatNotFound, historyOf, getHeader, isChatId, redactToolOutputs } from '../shared/ask-batsi-chats.mjs';

// TEN-02: Batsi calls the Agent API with the server's key, which carries AGENT_TENANT_ID. Only that company may use it.
let TENANT = null;

const logger  = new Logger({ serviceName: 'nalekoAiChat' });
const tracer  = new Tracer({ serviceName: 'nalekoAiChat' });
const bedrock = guardAi(new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'af-south-1' }), 'bedrock');
const dynamo  = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'af-south-1' });

// NH-74: audit table — AI interaction records for POPIA compliance
const AGENT_AUDIT_TABLE = process.env.AGENT_AUDIT_TABLE ?? 'naleko-agent-audit';
// NH-76: PROMPT_CACHE_TABLE is read from process.env directly inside cache.mjs

// NH-69 / NH-81: model IDs resolved exclusively from env vars — zero hard-coded strings.
// MODEL_FAST  → Haiku  (simple lookups, classification)
// MODEL_SMART → Sonnet (tool-heavy, complex reasoning)
// MODEL_ALIASES → JSON map for future alias expansion, e.g. {"fast":"...","smart":"..."}
// Parse MODEL_ALIASES once at cold start; ignore malformed JSON gracefully.
const _MODEL_ALIASES = (() => {
  try { return JSON.parse(process.env.MODEL_ALIASES ?? '{}'); } catch { return {}; }
})();

// MODEL_SMART must be resolved before MODEL_FAST (FAST falls back to SMART)
const MODEL_SMART = process.env.MODEL_SMART ?? _MODEL_ALIASES['smart'] ?? '';
const MODEL_FAST  = process.env.MODEL_FAST  ?? _MODEL_ALIASES['fast']  ?? MODEL_SMART;

/**
 * NH-81: Resolve a model alias to its Bedrock model ID.
 * Looks up MODEL_ALIASES map first, then falls back to MODEL_SMART.
 * Caller logs {event: model_selected} — not logged here to avoid cold-start noise.
 *
 * @param {string} alias - e.g. 'fast', 'smart', or a full model ID passthrough
 * @returns {string} Bedrock model ID
 */
function resolveModel(alias) {
  return _MODEL_ALIASES[alias] ?? MODEL_SMART;
}
const MAX_TOKENS      = 2048;
const MAX_TOOL_ROUNDS = 5;     // guard against infinite loops

// NH-78: Token budget / context guards
// ~4 chars per token (conservative). 2000 token cap keeps tool results within
// a single Claude context slot; 180k chars ≈ 45k tokens – safe margin below
// Claude's 200k-token context window.
const MAX_TOOL_RESPONSE_CHARS = 8000;    // ≈ 2 000 tokens
const MAX_CONTEXT_CHARS       = 180_000; // ≈ 45 000 tokens

// NH-79: Summarise history every N user turns with MODEL_FAST (Haiku only).
// History is REPLACED (not appended) to keep context costs flat across long sessions.
const SUMMARISE_EVERY_N_TURNS = 8;

// NH-80: Per-staff-id hourly rate limit (default 50 req/h). Atomic conditional
// UpdateItem ensures concurrent Lambdas cannot race past the cap.
const RATE_LIMIT_RPH = parseInt(process.env.RATE_LIMIT_RPH ?? '50', 10);

// ─── NH-80: hourly rate limiting ────────────────────────────────────────────
// pk  = "rateLimit#{staffId}#{windowStart}" — one DDB item per staff per hour.
// TTL (expiresAt) auto-expires old windows. Fails open on non-conditional errors.
function hashStaffId(staffId) {
  return createHash('sha256').update(staffId).digest('hex').slice(0, 16);
}

async function checkRateLimit(staffId) {
  const now         = Date.now();
  const windowStart = Math.floor(now / 3_600_000) * 3600; // unix seconds
  const expiresAt   = windowStart + 3600;
  const pk          = `rateLimit#${staffId}#${windowStart}`;

  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: process.env.RATE_LIMIT_TABLE,
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
      logger.warn('Rate limit exceeded', {
        event:           'rate_limited',
        session_id_hash: hashStaffId(staffId),
        retryAfter,
      });
      return retryAfter;
    }
    // Any other error (network, IAM) — fail open so legit users aren't blocked
    logger.error('Rate limit check failed — failing open', { error: err?.name ?? 'Error' });
    return null;
  }
}

// ─── NH-74: write one audit record per AI interaction ────────────────────────
// Fire-and-forget: never let a DynamoDB failure block the user response.
// PK  = "demo#" + staffId (tenantId is hard-coded "demo" for PoC)
// SK  = ISO8601 timestamp
// TTL = now + 30 days; DynamoDB Stream → S3 for 5-yr POPIA archive (NH-12)

async function writeAuditRecord({ staffId, templateId, intentClass, modelId,
  promptSummary, responseSummary, toolCallsMade, latencyMs, status,
  inputTokens, outputTokens, cacheHit,
  conversationId, guardrailAction, bedrockRequestId, employeesAccessed,
  toolOutputsRaw }) { // NH-58
  const now = new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + 90 * 24 * 60 * 60; // +90 days (POPIA)
  // NH-57: truncate free-text fields to keep item well under 400KB DynamoDB limit
  const truncate = (s, n = 200) => (typeof s === 'string' ? s.slice(0, n) : s);
  const item = {
    pk:                  `demo#${staffId}`,
    sk:                  now.toISOString(),
    date:                now.toISOString().slice(0, 10), // YYYY-MM-DD for DateIndex GSI
    // NH-57: required audit schema fields
    actor_type:          'AI_AGENT',
    staffId,
    templateId,
    intentClass:         intentClass ?? 'UNKNOWN',
    modelId,
    conversation_id:     conversationId,
    bedrock_request_id:  bedrockRequestId,
    guardrail_action:    guardrailAction ?? 'NONE',
    // CHAT-02: no ID, phone or bank number is kept, however it is spaced (the shared PII-01 redactor).
    employees_accessed:  JSON.stringify((employeesAccessed ?? []).map((e) => redactNumbers(String(e)))),
    // Content fields (truncated — full content stored in S3 archive)
    promptSummary:       truncate(redactNumbers(promptSummary)),
    responseSummary:     truncate(redactNumbers(responseSummary)),
    toolCallsMade:       JSON.stringify(toolCallsMade),
    // NH-58: per-tool raw output for POPIA hallucination defence (truncated to 2KB per entry at capture time)
    tool_outputs_raw:    toolOutputsRaw ? JSON.stringify(redactToolOutputs(toolOutputsRaw)) : '{}',
    // Performance + cost fields
    latencyMs,
    inputTokens,
    outputTokens,
    cacheHit:            cacheHit ?? false,
    status,
    expiresAt,
    tenant_id:           TENANT ?? undefined,
  };
  try {
    await dynamo.send(new PutItemCommand({
      TableName: AGENT_AUDIT_TABLE,
      Item:      marshall(item, { removeUndefinedValues: true }),
    }));
  } catch (err) {
    // Non-fatal — log and continue
    logger.error('Audit write failed', { event: 'audit_write_error', error: err?.name ?? 'Error' });
  }
}

// ─── NH-78: Tool-response truncator ─────────────────────────────────────────

/**
 * Truncate a serialised tool response to MAX_TOOL_RESPONSE_CHARS.
 * Appends an informative [TRUNCATED] marker so Claude knows data was cut.
 * @param {string} content - already-JSON-serialised tool result
 * @returns {string} safe-length content
 */
function truncateToolResponse(content) {
  if (content.length <= MAX_TOOL_RESPONSE_CHARS) return content;
  const omitted = content.length - MAX_TOOL_RESPONSE_CHARS;
  logger.warn(JSON.stringify({
    event:    'tool_response_truncated',
    original_chars: content.length,
    kept_chars:     MAX_TOOL_RESPONSE_CHARS,
    omitted_chars:  omitted,
  }));
  return content.slice(0, MAX_TOOL_RESPONSE_CHARS) + ` [TRUNCATED: ${omitted} chars omitted]`;
}

// ─── System prompt (cached per warm container) ────────────────────────────────

const SYSTEM_PROMPT = `You are Batsi, an HR onboarding assistant for South African companies.
You help HR clerks with onboarding tasks: checking employee status, risk assessments, document verifications, and audit logs.

Rules:
- Only assist with HR onboarding tasks. Politely decline all other requests.
- Never reveal salary benchmarks, employment law advice, or individual performance ratings.
- You may show what the HR person sees on the person page: name, email, job title, department, start date, step and HR partner. Never show ID numbers, phone numbers or bank account numbers.
- When onboarding a new employee, always return a draft for human review (the onboard_new_employee tool handles this automatically).
- Be concise and factual. Prefer bullet lists for data-heavy responses.
- When you looked up one person's documents, the screen shows each check as a row, so answer in one short sentence and do not list the checks again.
- If a lookup fails, say so in plain words and use its say sentence when it gives one. Never show tool names, record ids or error codes.
- Today's date is given in <today>. Use it for words like today, Monday, this week and soonest. A week runs from Monday to Sunday.
- When the question is about the person in <employee_in_focus> (he, she, they or this person), call get_employee with that id first.
- A person is ready to start only when get_employee says ready_to_start yes. Otherwise say no and give its reasons.
- Use the step words Invited, Documents, In review and Verified. Never use stage words such as ACTIVE.
- The start date is the start field. Never give the date a person was added as their start date.
- If a lookup has no answer for something, say plainly that you could not find it. Do not guess and do not send HR to another system.
- Write dates as the lookups write them, for example 10 Nov 2026.
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

  return `<today>${todayWritten()}</today>
<context>
  <staff_id>${staffId}</staff_id>
  <current_view>${screenContext?.view ?? 'unknown'}</current_view>
  <employee_in_focus>${screenContext?.employeeId ?? 'none'}</employee_in_focus>
</context>
<task>
  <template_id>${templateId ?? 'freeform'}</template_id>
</task>
${slotsXml ? `<slots>\n${slotsXml}\n</slots>\n` : ''}<message>${userMessage}</message>`;
}

// ─── NH-79: History summariser ─────────────────────────────────────────────

/**
 * Summarise a conversation history into a compact 2-message replacement.
 * Runs every SUMMARISE_EVERY_N_TURNS user turns using MODEL_FAST (Haiku).
 * Never uses MODEL_SMART — summarisation does not need full reasoning power.
 *
 * On any failure the function returns the original history unchanged (non-fatal).
 *
 * @param {Array}  messages   - current messages array (may include prior system messages)
 * @param {string} modelId    - IGNORED; always uses MODEL_FAST (Haiku) per spec
 * @returns {Array} replacement 2-message array, or original messages on failure
 */
async function maybeSummariseHistory(messages, modelId) {
  // Count user turns in this history
  const userTurns = messages.filter(m => m.role === 'user').length;

  // Summarise when userTurns is a multiple of SUMMARISE_EVERY_N_TURNS (and > 0)
  if (userTurns === 0 || userTurns % SUMMARISE_EVERY_N_TURNS !== 0) {
    return messages; // nothing to do
  }

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
          'Summarise the following HR assistant conversation concisely. ' +
          'Preserve: key employee IDs mentioned, actions taken, pending items, and any risk flags. ' +
          'Output plain text only — no markdown headers.\n\n' + historyText,
      }],
    };

    const cmd = new InvokeModelCommand({
      modelId:     MODEL_FAST, // always Haiku — spec requirement
      contentType: 'application/json',
      accept:      'application/json',
      body:        JSON.stringify(summaryPayload),
    });

    const res     = await invokeBedrockWithRetry(cmd);
    const parsed  = JSON.parse(new TextDecoder().decode(res.body));
    const summary = parsed.content?.find(b => b.type === 'text')?.text ?? '';

    if (!summary) throw new Error('empty summary from Bedrock');

    logger.info(JSON.stringify({
      event:            'history_summarised',
      turns_summarised: userTurns,
      model_id:         MODEL_FAST,
      summary_chars:    summary.length,
    }));

    // REPLACE history with a tight 2-message pair
    return [
      { role: 'user',      content: `[Conversation summary — ${userTurns} turns]: ${summary}` },
      { role: 'assistant', content: 'Understood. I have the context from the prior conversation.' },
    ];
  } catch (err) {
    // Non-fatal — fall back to full history silently
    logger.warn(JSON.stringify({ event: 'history_summarise_failed', error: err?.name ?? 'Error' }));
    return messages;
  }
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

  const res    = await invokeBedrockWithRetry(cmd);
  const text   = new TextDecoder().decode(res.body);
  const parsed = JSON.parse(text);
  // NH-57: expose Bedrock request ID for audit trail
  parsed._bedrockRequestId = res.$metadata?.requestId ?? null;
  return parsed;
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
const SAY = {
  NOTHING_TO_CHECK: "None of this person's documents has been checked yet, so there is nothing to assess.",
  NOT_FOUND: 'I could not find that person in this company.',
  NOT_ALLOWED: 'I could not get this information just now.',
  UNAVAILABLE: 'I could not get this information just now. Try again in a minute.',
};
/** CHAT-09: what a failed lookup means, in a fixed sentence. Never the error text. */
function failedLookup(err) {
  const outcome = err?.status === 404 && err?.apiText === 'No verifications found for employee' ? 'NOTHING_TO_CHECK'
    : err?.status === 404 ? 'NOT_FOUND'
    : err?.status === 401 || err?.status === 403 ? 'NOT_ALLOWED'
    : 'UNAVAILABLE';
  return { outcome, say: SAY[outcome] };
}

async function runAgenticLoop(messages, context, modelId) {
  const toolCallsMade  = [];
  let   structuredData = {};
  let   round          = 0;

  // NH-75: accumulate token usage across all loop rounds
  let totalInputTokens    = 0;
  let totalOutputTokens   = 0;
  let cacheHit            = false;
  // NH-57: audit trail fields
  let lastBedrockRequestId = null;
  const employeesAccessed  = new Set(); // employee IDs touched by tools
  // NH-58: per-tool output capture for POPIA hallucination defence
  const toolOutputsRaw     = {}; // { [toolName#n]: { called_at, request, response, http_status, latency_ms } }

  while (round < MAX_TOOL_ROUNDS) {
    round++;

    // NH-78: Context window guard — trim history before each Bedrock call.
    // Keep first message (system context / user XML template) + last 10 messages
    // so the conversation never blows past the 200k-token Claude context window.
    const totalChars = messages.reduce((acc, m) => acc + JSON.stringify(m).length, 0);
    if (totalChars > MAX_CONTEXT_CHARS && messages.length > 11) {
      const trimmed = messages.length - 11;
      messages.splice(1, trimmed); // keep [0] + last 10
      logger.warn(JSON.stringify({
        event:           'context_trimmed',
        messages_removed: trimmed,
        chars_before:     totalChars,
        chars_after:      messages.reduce((a, m) => a + JSON.stringify(m).length, 0),
      }));
    }

    const response = await invokeClaude(messages, modelId);
    lastBedrockRequestId = response._bedrockRequestId ?? lastBedrockRequestId; // NH-57

    // NH-75: track token usage and prompt-cache hits (metrics only — no content logged)
    const usage = response.usage ?? {};
    totalInputTokens  += usage.input_tokens  ?? 0;
    totalOutputTokens += usage.output_tokens ?? 0;
    if ((usage.cache_read_input_tokens ?? 0) > 0) cacheHit = true;

    logger.info(JSON.stringify({
      event:             'bedrock_invocation',
      round,
      model_id:          modelId,
      input_tokens:      usage.input_tokens              ?? 0,
      output_tokens:     usage.output_tokens             ?? 0,
      cache_read_tokens: usage.cache_read_input_tokens   ?? 0,
      cache_hit:         (usage.cache_read_input_tokens  ?? 0) > 0,
      stop_reason:       response.stop_reason,
      // Never log content, prompts, or responses here
    }));

    // Append assistant turn to conversation
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      // Extract final text
      const textBlock = response.content.find(b => b.type === 'text');
      return { finalText: textBlock?.text ?? '', toolCallsMade, structuredData,
               totalInputTokens, totalOutputTokens, cacheHit,
               lastBedrockRequestId, employeesAccessed: [...employeesAccessed],
               toolOutputsRaw }; // NH-58
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks  = response.content.filter(b => b.type === 'tool_use');
      const toolResultContent = [];

      for (const block of toolUseBlocks) {
        const { id: toolUseId, name: toolName, input: toolArgs } = block;
        logger.info('Tool call', { toolName });
        // NH-57: track employee IDs accessed for audit schema
        const _empId = toolArgs?.id ?? toolArgs?.employee_id ?? null;
        if (_empId) employeesAccessed.add(_empId);

        let result;
        let isError = false;
        // NH-58: capture timing + raw response for audit
        const _toolCalledAt = new Date().toISOString();
        const _toolStart    = Date.now();

        try {
          result = await resolveToolCall(toolName, toolArgs, context);
          // Capture structured data from known high-value tools
          if (toolName === 'assess_employee_risk')   structuredData.riskAssessment  = result;
          if (toolName === 'list_employees')          structuredData.employees       = result;
          if (toolName === 'get_employee')            structuredData.employee        = result;
          if (toolName === 'list_verifications')      structuredData.verifications   = result;
          if (toolName === 'onboard_new_employee')    structuredData.hitlDraft       = result;
          // CHAT-09: the model gets the person page's facts, not the raw record.
          if (toolName === 'get_employee') {
            result = await personFacts(result, (id) => agentGet(`/agent/v1/verifications?employee_id=${encodeURIComponent(id)}`));
          }
        } catch (err) {
          logger.warn('Tool call failed', { toolName, error: err?.name ?? 'Error' });
          result   = failedLookup(err);
          isError  = true;
        }

        toolCallsMade.push({ toolName, toolArgs, result, isError });

        // NH-58: record tool output entry (truncate response to 2KB per POPIA/DynamoDB limit)
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
            lastBedrockRequestId,
            employeesAccessed: [...employeesAccessed], // NH-57
            toolOutputsRaw,                            // NH-58
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

        // NH-78: truncate tool response before adding to context
        const truncatedContent = truncateToolResponse(sanitisedContent);

        toolResultContent.push({
          type:         'tool_result',
          tool_use_id:  toolUseId,
          ...(isError ? { is_error: true } : {}),
          content:      truncatedContent,
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
             totalInputTokens, totalOutputTokens, cacheHit,
             lastBedrockRequestId, employeesAccessed: [...employeesAccessed],
             toolOutputsRaw }; // NH-58
  }

  // Hit max rounds
  logger.warn('Max tool rounds reached', { rounds: round });
  return {
    finalText: 'I was unable to complete the request within the allowed number of steps. Please try again with a more specific question.',
    totalInputTokens, totalOutputTokens, cacheHit,
    toolCallsMade,
    structuredData,
    lastBedrockRequestId,                        // NH-57
    employeesAccessed: [...employeesAccessed],    // NH-57
    toolOutputsRaw,                              // NH-58
  };
}

// ─── Lambda handler ───────────────────────────────────────────────────────────

/** CHAT-02: a chat that could not be stored. Only the error name is logged, never the text. */
function storeFailure(err, headers) {
  if (err instanceof ChatNotFound) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
  }
  logger.error('Chat store error', { error: err?.name ?? 'Error' });
  return { statusCode: 500, headers, body: JSON.stringify({ error: 'Something went wrong' }) };
}

export const handler = async (event) => {
  const refused = hrOnly(event, 'Only HR can use Batsi chat');
  if (refused) return refused;
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;
  if (tenantId !== process.env.AGENT_TENANT_ID) {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) };
  }
  TENANT = tenantId;
  const start = Date.now();

  // ── 1. Extract staffId from Cognito JWT (NH-53) ──────────────────────────
  const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
  // Fall back to sub (Cognito UUID) if custom:staff_id is not yet provisioned.
  const staffId = claims['custom:staff_id'] || claims['sub'];
  if (!staffId) {
    logger.warn('Missing custom:staff_id and sub JWT claims — cannot identify caller');
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing staff_id claim in JWT' }),
    };
  }
  if (!claims['custom:staff_id']) {
    logger.warn(JSON.stringify({ event: 'staff_id_fallback_to_sub', sub: staffId }));
  }

  // AI cost guardrail: test logins (robots) never reach the AI; people do.
  const robot = isRobotCaller(claims);
  markRobot(robot);
  if (robot || aiSwitchedOff()) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:         robot ? AI_SKIPPED_LABEL : AI_OFF_LABEL,
        toolCallsMade:   [],
        conversationId:  `${staffId}-${Date.now()}`,
        structuredData:  {},
        latencyMs:       Date.now() - start,
        guardrailAction: 'AI_DISABLED',
        status:          'AI_DISABLED',
        cacheHit:        false,
      }),
    };
  }

  // CHAT-02: after the robot and AI-off answers, Ask Batsi is a per-company switch, OFF until an admin turns it on.
  const switchedOff = await requireModule(event, 'ask_batsi');
  if (switchedOff) return switchedOff;

  // ── 1b. NH-80: Hourly rate limit check ─────────────────────────────────
  const retryAfter = await checkRateLimit(staffId);
  if (retryAfter !== null) {
    return {
      statusCode: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After':  String(retryAfter),
      },
      body: JSON.stringify({
        error:      'Rate limit exceeded. Please try again later.',
        retryAfter,
      }),
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
    chatId: requestedChatId,     // CHAT-02: history comes from the stored chat, never from the caller
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

  // CHAT-02: a follow-up loads its own stored chat. A chat that is not this person's is a 404.
  const jsonHeaders = { 'Content-Type': 'application/json' };
  let chatId = null;
  let rawHistory = [];
  if (requestedChatId !== undefined && requestedChatId !== null) {
    if (!isChatId(requestedChatId)) {
      return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: 'Not found' }) };
    }
    try {
      const header = await getHeader(tenantId, staffId, requestedChatId);
      if (!header) {
        return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: 'Not found' }) };
      }
      chatId = requestedChatId;
      rawHistory = await historyOf(tenantId, staffId, chatId);
    } catch (err) {
      return storeFailure(err, jsonHeaders);
    }
  }

  // ── 3a. NH-79: Maybe summarise history (every 8 user turns, Haiku only) ──
  // Pass MODEL_FAST placeholder — maybeSummariseHistory always uses MODEL_FAST regardless.
  // Runs before we append the new user turn so the count reflects prior turns only.
  const summarisedHistory = await maybeSummariseHistory(rawHistory, MODEL_FAST);

  const messages = [
    ...summarisedHistory,
    { role: 'user', content: userXml },
  ];

  // ── 4. NH-69: Classify intent → select model ────────────────────────────
  const { intentClass, classifierTokens, error: classifyError } =
    await classifyIntent(effectiveMessage, templateId);
  const selectedModelId = selectModel(intentClass);

  logger.info('Intent classified', {
    event:        'model_selected',
    model_alias:  intentClass === 'SIMPLE' ? 'fast' : 'smart',
    event:             'intent_classified',
    intent_class:      intentClass,
    model_id:          selectedModelId,
    template_id:       templateId,
    classifier_tokens: classifierTokens,
    ...(classifyError ? { classify_error: classifyError } : {}),
  });

  // ── 5. NH-76: Prompt cache lookup — SIMPLE intent only ─────────────────
  // Only cache SIMPLE (no-tool) responses. Tool results are dynamic (employee
  // data changes) and must never be served stale.
  // cacheKey computed once — reused for lookup and store.
  let cacheHitResponse = null;
  // CHAT-02: only a chat's first question may use the cache, and the key carries the company.
  const cacheKey = intentClass === 'SIMPLE' && !chatId
    ? buildCacheKey(SYSTEM_PROMPT, effectiveMessage, selectedModelId, tenantId)
    : null;
  if (cacheKey) {
    cacheHitResponse = await getCached(cacheKey);
    if (cacheHitResponse) {
      logger.info(JSON.stringify({
        event:    'prompt_cache',
        cache_hit: true,
        cache_key_hash: cacheKey.slice(0, 8), // prefix only — never full hash in logs
        model_id: selectedModelId,
      }));
      const pii = sanitisePii(cacheHitResponse);
      let savedId;
      try {
        savedId = await appendExchange({
          tenantId, staffId, chatId,
          question: redactNumbers(effectiveMessage),
          answer:   redactNumbers(pii.sanitised),
        });
      } catch (err) {
        return storeFailure(err, jsonHeaders);
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:         pii.sanitised,
          toolCallsMade:   [],
          chatId:          savedId,
          conversationId:  savedId,
          structuredData:  {},
          latencyMs:       Date.now() - start,
          guardrailAction: pii.fired ? 'MASKED' : 'NONE',
          status:          'COMPLETE',
          cacheHit:        true,
        }),
      };
    }
    logger.info(JSON.stringify({ event: 'prompt_cache', cache_hit: false, model_id: selectedModelId }));
  }

  // ── 6. Agentic loop ───────────────────────────────────────────────────────
  const context = { staffId, tenantId, sub: claims['sub'], username: claims['cognito:username'], staffIdClaim: claims['custom:staff_id'] };
  let loopResult;
  try {
    loopResult = await runAgenticLoop(messages, context, selectedModelId);
  } catch (err) {
    logger.error('Bedrock pipeline error', { error: err?.name ?? 'Error' });
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'AI service error' }),
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

  // CHAT-05: the check rows, worked out from this turn's own tool results.
  const checks = checksOf(loopResult.toolCallsMade);

  // CHAT-02: store the exchange (masked) before answering.
  const toolNames = [...new Set(loopResult.toolCallsMade.map(t => t.toolName))];
  const proposalIds = loopResult.toolCallsMade
    .map(t => t.result?.actionId)
    .filter(id => typeof id === 'string');
  let savedChatId;
  try {
    savedChatId = await appendExchange({
      tenantId, staffId, chatId,
      question: redactNumbers(effectiveMessage),
      answer:   redactNumbers(pii.sanitised),
      tools:    toolNames,
      proposalIds,
    });
  } catch (err) {
    return storeFailure(err, jsonHeaders);
  }

  const response = {
    message:         pii.sanitised,
    toolCallsMade:   loopResult.toolCallsMade.map(t => ({ tool: t.toolName, isError: t.isError })),
    chatId:          savedChatId,
    conversationId:  savedChatId,
    structuredData:  checks ? { ...loopResult.structuredData, checks } : loopResult.structuredData,
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

  // NH-76: store SIMPLE intent responses in prompt cache on miss (1hr TTL).
  // Only cache if no tool calls were made — tool results may be stale.
  if (cacheKey && !loopResult.hitl && loopResult.toolCallsMade.length === 0) {
    void setCached(cacheKey, loopResult.finalText);
  }

  // NH-74/75: fire-and-forget audit write — must not block the user response
  // CloudWatch discipline: only metrics go to CW; content stays in DynamoDB/S3
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
    // NH-57: new audit schema fields
    conversationId:    response.conversationId,
    guardrailAction:   response.guardrailAction,
    bedrockRequestId:  loopResult.lastBedrockRequestId,
    employeesAccessed: loopResult.employeesAccessed   ?? [],
    toolOutputsRaw:    loopResult.toolOutputsRaw      ?? {}, // NH-58
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response),
  };
};

