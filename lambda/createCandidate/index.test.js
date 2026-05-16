'use strict';

/**
 * lambda/createCandidate/index.test.js
 *
 * Unit tests covering the NH-118 Self-Verification Checklist:
 *   1. POST /candidates → 201 with candidateId
 *   2. DynamoDB talent-flow-state has SAGA record with configVersion=null
 *   3. EventBridge CandidateCreated event published with correct source
 *   4. Duplicate POST with same idempotencyKey → 200 with same candidateId
 *   5. Invalid body (missing required field) → 400
 * Plus: concurrent IN_PROGRESS → 409, EventBridge failure is non-fatal
 */

process.env.STATE_TABLE_NAME       = 'talent-flow-state';
process.env.IDEMPOTENCY_TABLE_NAME = 'talent-flow-idempotency-keys';
process.env.EVENTBRIDGE_BUS_NAME   = 'talent-flow-bus';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockDynamoSend = jest.fn();
const mockEbSend     = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient:        jest.fn(() => ({ send: mockDynamoSend })),
  GetItemCommand:        jest.fn(p => ({ _cmd: 'GetItem',    ...p })),
  PutItemCommand:        jest.fn(p => ({ _cmd: 'PutItem',    ...p })),
  UpdateItemCommand:     jest.fn(p => ({ _cmd: 'UpdateItem', ...p })),
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall:   jest.fn(obj  => obj),
  unmarshall: jest.fn(item => item),
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient:  jest.fn(() => ({ send: mockEbSend })),
  PutEventsCommand:   jest.fn(p => ({ _cmd: 'PutEvents', ...p })),
}));

// Deterministic ulid
jest.mock('ulid', () => ({ ulid: jest.fn(() => '01HTEST00000000000000000') }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides = {}) {
  return {
    httpMethod: 'POST',
    path: '/candidates',
    body: JSON.stringify({
      idempotencyKey: 'idem-key-001',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane.doe@example.com',
      positionTitle: 'Senior Engineer',
      positionLevel: 'SENIOR',
      tenantId: 'DEFAULT',
      ...overrides,
    }),
  };
}

function parseBody(response) {
  return JSON.parse(response.body);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createCandidate', () => {
  let handler;

  beforeEach(() => {
    mockDynamoSend.mockReset();
    mockEbSend.mockReset();
    jest.isolateModules(() => {
      ({ handler } = require('./index'));
    });
  });

  // ── Checklist item 1 + 2 + 3: successful creation ────────────────────────
  describe('successful creation', () => {
    beforeEach(() => {
      // GetItem: no existing idempotency record
      mockDynamoSend.mockResolvedValueOnce({ Item: null });
      // PutItem: idempotency IN_PROGRESS
      mockDynamoSend.mockResolvedValueOnce({});
      // PutItem: SAGA record
      mockDynamoSend.mockResolvedValueOnce({});
      // EventBridge
      mockEbSend.mockResolvedValueOnce({ FailedEntryCount: 0, Entries: [] });
      // UpdateItem: idempotency COMPLETED
      mockDynamoSend.mockResolvedValueOnce({});
    });

    test('returns 201 with candidateId', async () => {
      const response = await handler(makeEvent());
      expect(response.statusCode).toBe(201);
      expect(parseBody(response).candidateId).toBe('CAND-01HTEST00000000000000000');
    });

    test('SAGA record written with configVersion=null and SK=SAGA', async () => {
      await handler(makeEvent());
      // Third DynamoDB call (index 2) is the SAGA PutItem
      const sagaPutCall = mockDynamoSend.mock.calls[2][0];
      expect(sagaPutCall.Item.SK).toBe('SAGA');
      expect(sagaPutCall.Item.configVersion).toBeNull();
      expect(sagaPutCall.Item.PK).toBe('CANDIDATE#CAND-01HTEST00000000000000000');
    });

    test('EventBridge event published with source talent-flow.candidates and detail-type CandidateCreated', async () => {
      await handler(makeEvent());
      const ebCall = mockEbSend.mock.calls[0][0];
      const entry = ebCall.Entries[0];
      expect(entry.Source).toBe('talent-flow.candidates');
      expect(entry.DetailType).toBe('CandidateCreated');
      expect(entry.EventBusName).toBe('talent-flow-bus');
      const detail = JSON.parse(entry.Detail);
      expect(detail.candidateId).toBe('CAND-01HTEST00000000000000000');
      expect(detail.tenantId).toBe('DEFAULT');
    });
  });

  // ── Checklist item 4: duplicate idempotency key returns 200 ───────────────
  test('duplicate POST with same idempotencyKey returns 200 with existing candidateId', async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Item: {
        idempotencyKey: 'idem-key-001',
        status: 'COMPLETED',
        candidateId: 'CAND-EXISTING123',
      },
    });

    const response = await handler(makeEvent());
    expect(response.statusCode).toBe(200);
    expect(parseBody(response).candidateId).toBe('CAND-EXISTING123');
    // No SAGA write and no EventBridge call on duplicate
    expect(mockEbSend).not.toHaveBeenCalled();
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
  });

  // ── Checklist item 5: missing required field → 400 ────────────────────────
  test('missing email returns 400', async () => {
    // No DynamoDB call expected before validation for missing fields,
    // BUT idempotency check (GetItem) + IN_PROGRESS write happen before validation.
    mockDynamoSend.mockResolvedValueOnce({ Item: null }); // GetItem
    mockDynamoSend.mockResolvedValueOnce({});             // PutItem IN_PROGRESS

    const response = await handler(makeEvent({ email: undefined }));
    expect(response.statusCode).toBe(400);
    expect(parseBody(response).missing).toContain('email');
  });

  test('missing idempotencyKey returns 400 immediately', async () => {
    const event = makeEvent();
    const body = JSON.parse(event.body);
    delete body.idempotencyKey;
    event.body = JSON.stringify(body);

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    // No DynamoDB calls — rejected before idempotency check
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });

  // ── Concurrent request (IN_PROGRESS) → 409 ────────────────────────────────
  test('IN_PROGRESS idempotency key returns 409', async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Item: {
        idempotencyKey: 'idem-key-001',
        status: 'IN_PROGRESS',
      },
    });

    const response = await handler(makeEvent());
    expect(response.statusCode).toBe(409);
  });

  // ── Race condition — conditional PutItem fails ────────────────────────────
  test('conditional PutItem ConditionalCheckFailedException returns 409', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: null }); // GetItem: not found
    const err = new Error('ConditionalCheckFailedException');
    err.name = 'ConditionalCheckFailedException';
    mockDynamoSend.mockRejectedValueOnce(err); // PutItem IN_PROGRESS race

    const response = await handler(makeEvent());
    expect(response.statusCode).toBe(409);
  });

  // ── Invalid positionLevel → 400 ───────────────────────────────────────────
  test('invalid positionLevel returns 400', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: null });
    mockDynamoSend.mockResolvedValueOnce({});

    const response = await handler(makeEvent({ positionLevel: 'INTERN' }));
    expect(response.statusCode).toBe(400);
    expect(parseBody(response).error).toMatch(/positionLevel/);
  });

  // ── EventBridge failure is non-fatal ─────────────────────────────────────
  test('EventBridge failure does not prevent 201 response', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: null });
    mockDynamoSend.mockResolvedValueOnce({});
    mockDynamoSend.mockResolvedValueOnce({});
    mockEbSend.mockRejectedValueOnce(new Error('EventBridge unavailable'));
    mockDynamoSend.mockResolvedValueOnce({});

    const response = await handler(makeEvent());
    expect(response.statusCode).toBe(201);
  });

  // ── DynamoDB SAGA write failure → 500 ────────────────────────────────────
  test('DynamoDB SAGA write failure returns 500', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: null });
    mockDynamoSend.mockResolvedValueOnce({});
    mockDynamoSend.mockRejectedValueOnce(new Error('ProvisionedThroughputExceeded'));

    const response = await handler(makeEvent());
    expect(response.statusCode).toBe(500);
  });
});
