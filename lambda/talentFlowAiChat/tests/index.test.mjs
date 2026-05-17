/**
 * AI-002 / NH-128: talentFlowAiChat unit tests
 * ESM — Lesson 12 pattern (jest.unstable_mockModule, mockReset)
 *
 * Scenarios:
 *   1. Missing staffId JWT claim → 401
 *   2. Rate limit exceeded → 429
 *   3. SIMPLE intent, cache hit → 200 COMPLETE (no Bedrock call)
 *   4. SIMPLE intent, Bedrock end_turn → 200 COMPLETE
 *   5. Write tool intercepted → 200 PENDING_APPROVAL
 *   6. get_config read tool → DynamoDB GetItem on config table
 *   7. Bedrock ThrottlingException → retry → 502 after exhaustion
 *   8. Audit write failure → non-fatal, 200 returned
 */

import { jest, describe, test, expect, beforeAll, beforeEach } from '@jest/globals';

// ─── Shared mock functions ────────────────────────────────────────────────────

const mockDbSend      = jest.fn();
const mockBedrockSend = jest.fn();

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient:     jest.fn(() => ({ send: mockDbSend })),
  GetItemCommand:     jest.fn((args) => ({ _type: 'Get',    ...args })),
  PutItemCommand:     jest.fn((args) => ({ _type: 'Put',    ...args })),
  QueryCommand:       jest.fn((args) => ({ _type: 'Query',  ...args })),
  UpdateItemCommand:  jest.fn((args) => ({ _type: 'Update', ...args })),
}));

jest.unstable_mockModule('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(() => ({ send: mockBedrockSend })),
  InvokeModelCommand:   jest.fn((args) => ({ _type: 'InvokeModel', ...args })),
}));

// Identity marshalling so tests use plain objects
jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall:   jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj),
}));

// ─── Dynamic import (after all mocks declared) ───────────────────────────────

let handler;

beforeAll(async () => {
  ({ handler } = await import('../index.mjs'));
});

beforeEach(() => {
  mockDbSend.mockReset();
  mockBedrockSend.mockReset();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent({ staffId = 'STAFF-001', body = {}, noStaffId = false } = {}) {
  return {
    requestContext: {
      authorizer: {
        jwt: {
          claims: noStaffId ? {} : { 'custom:staff_id': staffId },
        },
      },
    },
    body: JSON.stringify(body),
  };
}

/** Encode a Bedrock response body as Uint8Array. */
function bedrockBody(payload) {
  return new TextEncoder().encode(JSON.stringify(payload));
}

/** A minimal Bedrock end_turn response with a text block. */
function endTurnResponse(text = 'Pipeline looks healthy.') {
  return {
    body: bedrockBody({
      content:    [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage:       { input_tokens: 100, output_tokens: 20 },
    }),
    $metadata: { requestId: 'req-123' },
  };
}

/** A Bedrock tool_use response calling a read tool. */
function toolUseResponse(toolName, toolInput) {
  return {
    body: bedrockBody({
      content: [
        { type: 'text',     text: 'Let me check...' },
        { type: 'tool_use', id: 'tu-1', name: toolName, input: toolInput },
      ],
      stop_reason: 'tool_use',
      usage:       { input_tokens: 150, output_tokens: 30 },
    }),
    $metadata: { requestId: 'req-456' },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('talentFlowAiChat', () => {

  test('1. Missing staffId JWT claim → 401', async () => {
    const res = await handler(makeEvent({ noStaffId: true }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/staff_id/i);
  });

  test('2. Rate limit exceeded → 429', async () => {
    // DynamoDB UpdateItem (rate limit check) throws ConditionalCheckFailedException
    mockDbSend.mockRejectedValueOnce(
      Object.assign(new Error('limit'), { name: 'ConditionalCheckFailedException' })
    );

    const res = await handler(makeEvent({
      body: { message: 'hello', templateId: 'freeform' },
    }));
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body)).toMatchObject({ error: expect.stringMatching(/rate limit/i) });
  });

  test('3. SIMPLE intent + cache hit → 200 COMPLETE (no Bedrock call)', async () => {
    // Rate limit passes
    mockDbSend.mockResolvedValueOnce({});  // UpdateItem (rate limit)

    // intent-classifier fast-path: templateId=candidate_status → SIMPLE (no Bedrock)
    // cache hit: getCached resolves with cached response
    mockDbSend.mockResolvedValueOnce({
      Item: { cacheKey: 'k', cachedResponse: 'Candidate is in INTERVIEW stage.', expiresAt: 9999999999 },
    });

    const res = await handler(makeEvent({
      body: { message: '', templateId: 'candidate_status', slots: { candidateId: 'CAND-001' } },
    }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('COMPLETE');
    expect(body.cacheHit).toBe(true);
    expect(mockBedrockSend).not.toHaveBeenCalled();
  });

  test('4. SIMPLE intent, Bedrock end_turn → 200 COMPLETE', async () => {
    // Rate limit passes
    mockDbSend.mockResolvedValueOnce({});   // UpdateItem (rate limit)
    // Cache miss (GetItem returns no Item)
    mockDbSend.mockResolvedValueOnce({});   // getCached → cache miss
    // Bedrock classifier: templateId=pipeline_overview → fast-path SIMPLE, no Bedrock call
    // Bedrock main invocation → end_turn
    mockBedrockSend.mockResolvedValueOnce(endTurnResponse('Pipeline: 5 candidates in INTERVIEW.'));
    // Audit write
    mockDbSend.mockResolvedValueOnce({});   // PutItem for audit
    // Cache set
    mockDbSend.mockResolvedValueOnce({});   // PutItem for cache

    const res = await handler(makeEvent({
      body: { message: '', templateId: 'pipeline_overview' },
    }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('COMPLETE');
    expect(body.message).toContain('Pipeline');
    expect(body.toolCallsMade).toHaveLength(0);
  });

  test('5. Write tool intercepted → 200 PENDING_APPROVAL', async () => {
    // Rate limit passes
    mockDbSend.mockResolvedValueOnce({});   // UpdateItem (rate limit)
    // Cache miss
    mockDbSend.mockResolvedValueOnce({});

    // intent-classifier templateId=freeform → Bedrock classifier call
    mockBedrockSend.mockResolvedValueOnce({
      body: bedrockBody({ content: [{ type: 'text', text: 'TOOL_REQUIRED' }], usage: {} }),
      $metadata: {},
    });

    // Main Bedrock call → tool_use: schedule_interview
    mockBedrockSend.mockResolvedValueOnce(toolUseResponse('schedule_interview', {
      candidateId:      'CAND-002',
      proposedDateTime: '2026-06-01T10:00:00Z',
      interviewType:    'TECHNICAL',
    }));

    // PendingApproval DynamoDB write
    mockDbSend.mockResolvedValueOnce({});   // PutItem for pending-actions
    // Bedrock synthesis call after tool result is fed back
    mockBedrockSend.mockResolvedValueOnce(endTurnResponse('Your interview scheduling request is pending approval.'));
    // Audit write
    mockDbSend.mockResolvedValueOnce({});

    const res = await handler(makeEvent({
      body: { message: 'schedule a technical interview for CAND-002', templateId: 'freeform' },
    }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('PENDING_APPROVAL');
    expect(body.pendingAction).toBeDefined();
    expect(body.pendingAction.actionId).toBeDefined();
  });

  test('6. get_config read tool → DynamoDB QueryCommand on config table', async () => {
    // Rate limit passes
    mockDbSend.mockResolvedValueOnce({});   // UpdateItem
    // Cache miss
    mockDbSend.mockResolvedValueOnce({});

    // Classifier → fast-path TOOL_REQUIRED (config_recommendation template)
    // No classifier Bedrock call needed — fast-path

    // Main Bedrock call → tool_use: get_config
    mockBedrockSend.mockResolvedValueOnce(toolUseResponse('get_config', {
      configType: 'SCORING_WEIGHTS',
    }));

    // DynamoDB Query for config GSI1
    mockDbSend.mockResolvedValueOnce({
      Items: [{ PK: 'TENANT#DEFAULT', SK: 'CONFIG#SCORING_WEIGHTS#v3', values: { technical: 0.5 } }],
    });

    // Bedrock synthesis → end_turn
    mockBedrockSend.mockResolvedValueOnce(endTurnResponse('Current scoring weights: technical 50%.'));

    // Audit write
    mockDbSend.mockResolvedValueOnce({});

    const res = await handler(makeEvent({
      body: { message: '', templateId: 'config_recommendation', slots: { configType: 'SCORING_WEIGHTS' } },
    }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('COMPLETE');
    expect(body.toolCallsMade).toHaveLength(1);
    expect(body.toolCallsMade[0].tool).toBe('get_config');

    // Verify a QueryCommand was sent to DynamoDB (the config GSI lookup)
    const queryCalls = mockDbSend.mock.calls.filter(([cmd]) => cmd._type === 'Query');
    expect(queryCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('7. Bedrock ThrottlingException exhausted → 502', async () => {
    // Rate limit passes
    mockDbSend.mockResolvedValueOnce({});
    // Cache miss
    mockDbSend.mockResolvedValueOnce({});

    // All Bedrock calls throw ThrottlingException (exhausts retries)
    const throttleErr = Object.assign(new Error('throttled'), { name: 'ThrottlingException' });
    mockBedrockSend.mockRejectedValue(throttleErr);

    const res = await handler(makeEvent({
      body: { message: 'pipeline overview please', templateId: 'pipeline_overview' },
    }));
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/AI service error/i);
  }, 30_000); // allow for backoff delays in test

  test('8. Audit write failure → non-fatal, 200 still returned', async () => {
    // Rate limit passes
    mockDbSend.mockResolvedValueOnce({});
    // Cache miss
    mockDbSend.mockResolvedValueOnce({});
    // Bedrock end_turn
    mockBedrockSend.mockResolvedValueOnce(endTurnResponse('All SLAs on track.'));
    // Audit PutItem fails
    mockDbSend.mockRejectedValueOnce(new Error('DynamoDB connection timeout'));

    const res = await handler(makeEvent({
      body: { message: '', templateId: 'sla_status', slots: { workflowId: 'WF-001' } },
    }));
    // Response should still be 200 — audit failure is non-fatal
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('COMPLETE');
  });
});
