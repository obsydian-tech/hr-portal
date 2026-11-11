'use strict';

// ── Mock declarations (must be at top — no out-of-scope refs in factory) ──────
const mockDynamoSend = jest.fn();
const mockEbSend     = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient:    jest.fn(() => ({ send: mockDynamoSend })),
  GetItemCommand:    jest.fn((p) => ({ _cmd: 'GetItem',    ...p })),
  UpdateItemCommand: jest.fn((p) => ({ _cmd: 'UpdateItem', ...p })),
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall:   jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj),
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockEbSend })),
  PutEventsCommand:  jest.fn((p) => ({ _cmd: 'PutEvents', ...p })),
}));

jest.mock('../shared/config-reader', () => ({
  getConfig: jest.fn(),
}));

// ── Module under test ─────────────────────────────────────────────────────────
const { handler } = require('./index');
const { getConfig } = require('../shared/config-reader');

// ── Environment ───────────────────────────────────────────────────────────────
process.env.STATE_TABLE_NAME     = 'talent-flow-state';
process.env.EVENTBRIDGE_BUS_NAME = 'talent-flow-bus';
process.env.ENVIRONMENT          = 'test';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const SAGA = {
  PK: 'CANDIDATE#cand1', SK: 'SAGA',
  configVersion: 'v1', status: 'TECHNICAL_INTERVIEW',
};

const APPROVAL_RULES_V1 = { minimumPassScore: 6.0 };
const APPROVAL_RULES_V2 = { minimumPassScore: 8.0 };

const passingEvent = {
  detail: { candidateId: 'cand1', tenantId: 'tenant1', averageScore: 7.5, result: 'COMPLETED' },
};
const failingEvent = {
  detail: { candidateId: 'cand1', tenantId: 'tenant1', averageScore: 4.0, result: 'COMPLETED' },
};
const vetoEvent = {
  detail: { candidateId: 'cand1', tenantId: 'tenant1', result: 'STRONG_NO_VETO' },
};

beforeEach(() => jest.clearAllMocks());

// =============================================================================
// 1.  averageScore >= minimumPassScore → outcome = PASSED
// =============================================================================
describe('handler – PASSED outcome', () => {
  // Option B: PASSED records the result only. The stage stays at EVALUATION and
  // EvaluationCompleted is published later by advanceCandidateStage.
  it('records PASSED on the SAGA without changing stage or publishing', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })   // GetItem
      .mockResolvedValueOnce({});              // UpdateItem
    getConfig.mockResolvedValueOnce(APPROVAL_RULES_V1);

    const res = await handler(passingEvent);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.outcome).toBe('PASSED');
    expect(body.finalScore).toBe(7.5);
    expect(body.configVersion).toBe('v1');

    const updateCall = mockDynamoSend.mock.calls[1][0];
    expect(updateCall.UpdateExpression).not.toMatch(/currentStage|#st/);
    expect(updateCall.ExpressionAttributeValues).toEqual({
      ':res': 'PASSED', ':fs': 7.5, ':at': expect.any(String), ':cv': 'v1',
    });

    expect(mockEbSend).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 2.  averageScore < minimumPassScore → outcome = FAILED + status = REJECTED
// =============================================================================
describe('handler – FAILED outcome', () => {
  it('sets status=REJECTED on the SAGA without changing stage', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({});
    getConfig.mockResolvedValueOnce(APPROVAL_RULES_V1);

    const res = await handler(failingEvent);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.outcome).toBe('FAILED');

    const updateCall = mockDynamoSend.mock.calls[1][0];
    expect(updateCall.ExpressionAttributeValues[':rejected']).toBe('REJECTED');
    expect(updateCall.ExpressionAttributeNames).toEqual({ '#st': 'status' });
    expect(updateCall.UpdateExpression).not.toMatch(/currentStage/);
    expect(mockEbSend).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 3.  STRONG_NO_VETO → outcome = FAILED without score comparison
// =============================================================================
describe('handler – STRONG_NO_VETO', () => {
  it('skips getConfig and sets outcome=FAILED', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({});

    const res = await handler(vetoEvent);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).outcome).toBe('FAILED');

    // getConfig must NOT be called on veto path
    expect(getConfig).not.toHaveBeenCalled();

    // SAGA still updated
    expect(mockDynamoSend).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// 4.  Config version isolation — v2 threshold used only for v2 candidates
// =============================================================================
describe('handler – config version isolation', () => {
  it('uses v2 minimumPassScore=8.0 for a candidate on v2', async () => {
    const sagaV2 = { ...SAGA, configVersion: 'v2' };
    mockDynamoSend
      .mockResolvedValueOnce({ Item: sagaV2 })
      .mockResolvedValueOnce({});
    // averageScore=7.5 passes v1 (≥6.0) but FAILS v2 (≥8.0)
    getConfig.mockResolvedValueOnce(APPROVAL_RULES_V2);

    const res = await handler(passingEvent); // averageScore=7.5

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).outcome).toBe('FAILED');
    expect(getConfig).toHaveBeenCalledWith('tenant1', 'APPROVAL_RULES', 'v2');
  });

  it('uses v1 minimumPassScore=6.0 for a candidate on v1 even if v2 is active', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })  // SAGA has configVersion = 'v1'
      .mockResolvedValueOnce({});
    getConfig.mockResolvedValueOnce(APPROVAL_RULES_V1);

    const res = await handler(passingEvent); // averageScore=7.5

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).outcome).toBe('PASSED');
    expect(getConfig).toHaveBeenCalledWith('tenant1', 'APPROVAL_RULES', 'v1');
  });
});

// =============================================================================
// 5.  configVersionUsedForEval stored on SAGA for audit trail
// =============================================================================
describe('handler – POPIA audit', () => {
  it('stores configVersionUsedForEval on the SAGA update', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({});
    getConfig.mockResolvedValueOnce(APPROVAL_RULES_V1);

    await handler(passingEvent);

    const updateCall = mockDynamoSend.mock.calls[1][0];
    expect(updateCall.ExpressionAttributeValues[':cv']).toBe('v1');
  });
});

// =============================================================================
// 6.  Response body carries the configVersion used
// =============================================================================
describe('handler – response body', () => {
  it('returns candidateId, tenantId and the configVersion used', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({});
    getConfig.mockResolvedValueOnce(APPROVAL_RULES_V1);

    const res = await handler(passingEvent);

    expect(JSON.parse(res.body)).toEqual({
      candidateId: 'cand1', tenantId: 'tenant1', outcome: 'PASSED', finalScore: 7.5, configVersion: 'v1',
    });
  });
});

// =============================================================================
// 7.  Default minimumPassScore = 6.0 when config field is absent
// =============================================================================
describe('handler – default pass score', () => {
  it('applies default 6.0 threshold when minimumPassScore missing from config', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({});
    // Config without minimumPassScore
    getConfig.mockResolvedValueOnce({});

    // 7.5 >= 6.0 default → PASSED
    const res = await handler(passingEvent);
    expect(JSON.parse(res.body).outcome).toBe('PASSED');
  });

  it('FAILS when score=4.0 below default 6.0', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({});
    getConfig.mockResolvedValueOnce({});

    const res = await handler(failingEvent);
    expect(JSON.parse(res.body).outcome).toBe('FAILED');
  });
});

// =============================================================================
// 8.  Validation — missing fields
// =============================================================================
describe('handler – validation', () => {
  it('returns 400 when candidateId missing', async () => {
    const res = await handler({ detail: { tenantId: 't1', result: 'COMPLETED', averageScore: 7 } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/candidateId/);
  });

  it('returns 400 when tenantId missing', async () => {
    const res = await handler({ detail: { candidateId: 'c1', result: 'COMPLETED', averageScore: 7 } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/tenantId/);
  });

  it('returns 400 when result missing', async () => {
    const res = await handler({ detail: { candidateId: 'c1', tenantId: 't1', averageScore: 7 } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/result/);
  });

  it('returns 400 when averageScore missing on non-veto result', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: SAGA });
    // getConfig is NOT called — handler returns 400 before reaching it

    const res = await handler({ detail: { candidateId: 'cand1', tenantId: 'tenant1', result: 'COMPLETED' } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/averageScore/);
  });
});

// =============================================================================
// 9.  SAGA not found → 400
// =============================================================================
describe('handler – SAGA not found', () => {
  it('returns 400 when SAGA Item is missing', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(passingEvent);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/SAGA record not found/);
  });
});

// =============================================================================
// 10.  SAGA missing configVersion → 400
// =============================================================================
describe('handler – SAGA missing configVersion', () => {
  it('returns 400 when configVersion absent', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: { ...SAGA, configVersion: undefined } });

    const res = await handler(passingEvent);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/configVersion/);
  });
});

// =============================================================================
// 11.  GetItem DynamoDB failure → 500
// =============================================================================
describe('handler – DynamoDB GetItem failure', () => {
  it('returns 500 when GetItem throws', async () => {
    mockDynamoSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    const res = await handler(passingEvent);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/read candidate/);
  });
});

// =============================================================================
// 12.  getConfig throws → 500
// =============================================================================
describe('handler – getConfig failure', () => {
  it('returns 500 when APPROVAL_RULES getConfig throws', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: SAGA });
    getConfig.mockRejectedValueOnce(new Error('Config table timeout'));

    const res = await handler(passingEvent);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/approval configuration/);
  });
});

// =============================================================================
// 13.  UpdateItem failure → 500
// =============================================================================
describe('handler – UpdateItem failure', () => {
  it('returns 500 when SAGA UpdateItem throws', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockRejectedValueOnce(new Error('UpdateItem failed'));
    getConfig.mockResolvedValueOnce(APPROVAL_RULES_V1);

    const res = await handler(passingEvent);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/evaluation record/);
  });
});

// =============================================================================
// 14.  Current INTERVIEW record is marked COMPLETED
// =============================================================================
describe('handler – current interview', () => {
  it('marks the current INTERVIEW record COMPLETED', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: { ...SAGA, currentInterviewId: 'iv-1' } })
      .mockResolvedValueOnce({})   // SAGA UpdateItem
      .mockResolvedValueOnce({});  // INTERVIEW UpdateItem
    getConfig.mockResolvedValueOnce(APPROVAL_RULES_V1);

    const res = await handler(passingEvent);

    expect(res.statusCode).toBe(200);
    const interviewUpdate = mockDynamoSend.mock.calls[2][0];
    expect(interviewUpdate.Key).toEqual({ PK: 'CANDIDATE#cand1', SK: 'INTERVIEW#iv-1' });
    expect(interviewUpdate.ExpressionAttributeValues[':completed']).toBe('COMPLETED');
  });

  it('still returns 200 when marking the interview fails (non-fatal)', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: { ...SAGA, currentInterviewId: 'iv-1' } })
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('throttled'));
    getConfig.mockResolvedValueOnce(APPROVAL_RULES_V1);

    const res = await handler(passingEvent);
    expect(res.statusCode).toBe(200);
  });
});

// =============================================================================
// 15.  Boundary — score exactly equal to minimumPassScore → PASSED
// =============================================================================
describe('handler – boundary score', () => {
  it('treats score exactly equal to minimumPassScore as PASSED', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({});
    getConfig.mockResolvedValueOnce(APPROVAL_RULES_V1); // minimumPassScore=6.0

    const boundaryEvent = {
      detail: { candidateId: 'cand1', tenantId: 'tenant1', averageScore: 6.0, result: 'COMPLETED' },
    };
    const res = await handler(boundaryEvent);
    expect(JSON.parse(res.body).outcome).toBe('PASSED');
  });
});

// =============================================================================
// 16.  STRONG_NO_VETO — rejection recorded, nothing published
// =============================================================================
describe('handler – STRONG_NO_VETO records rejection', () => {
  it('sets REJECTED with a null finalScore and publishes nothing', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({});

    const res = await handler(vetoEvent);

    expect(JSON.parse(res.body)).toMatchObject({ outcome: 'FAILED', finalScore: null });
    const updateCall = mockDynamoSend.mock.calls[1][0];
    expect(updateCall.ExpressionAttributeValues[':rejected']).toBe('REJECTED');
    expect(updateCall.ExpressionAttributeValues[':fs']).toBeNull();
    expect(mockEbSend).not.toHaveBeenCalled();
  });
});
