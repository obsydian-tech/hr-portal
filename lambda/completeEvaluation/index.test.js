'use strict';

// REC-02: a score decides nothing. completeEvaluation records the final score as data and raises score_under_review_level when
// the company's REJECTION_RULES set reviewBelowScore and the score is under it. It writes no status and no outcome.

// ── Mock declarations (must be at top — no out-of-scope refs in factory) ──────
const mockDynamoSend = jest.fn();
const mockEbSend     = jest.fn();
let mockRejectionRules = { reviewVoteLevel: 'STRONG_NO', reviewBelowScore: null };
let mockSettingsError = null;

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

// The shared settings reader is tested in the acceptance suite; here the company's rules are set per test.
jest.unstable_mockModule('../shared/recruitment-settings.mjs', () => ({
  DEFAULTS: { REJECTION_RULES: { reviewVoteLevel: 'STRONG_NO', reviewBelowScore: null } },
  getRecruitmentSettings: async () => {
    if (mockSettingsError) throw mockSettingsError;
    return { REJECTION_RULES: mockRejectionRules };
  },
}));

// ── Module under test ─────────────────────────────────────────────────────────
const { handler } = require('./index');

// ── Environment ───────────────────────────────────────────────────────────────
process.env.STATE_TABLE_NAME     = 'talent-flow-state';
process.env.EVENTBRIDGE_BUS_NAME = 'talent-flow-bus';
process.env.ENVIRONMENT          = 'test';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const TEN = 'ten_0123456789abcdefghijklmnop';
const SAGA = { PK: 'CANDIDATE#cand1', SK: 'SAGA', tenant_id: TEN, configVersion: 'v1', status: 'ACTIVE' };

const eventWith = (averageScore) => ({
  detail: { candidateId: 'cand1', tenant_id: TEN, ...(averageScore === undefined ? {} : { averageScore }), result: 'COMPLETED' },
});
const sagaUpdate = () => mockDynamoSend.mock.calls.map((c) => c[0]).find((c) => c._cmd === 'UpdateItem' && c.Key.SK === 'SAGA');

beforeEach(() => {
  jest.clearAllMocks();
  mockDynamoSend.mockReset();
  mockRejectionRules = { reviewVoteLevel: 'STRONG_NO', reviewBelowScore: null };
  mockSettingsError = null;
});

// =============================================================================
// 1.  The score is stored as data and nothing else moves
// =============================================================================
describe('handler – the score is data', () => {
  it('stores the final score and writes no status, stage or result, whatever the score', async () => {
    for (const score of [9.5, 4.0, 1.0]) {
      mockDynamoSend.mockReset();
      mockDynamoSend.mockResolvedValueOnce({ Item: SAGA }).mockResolvedValueOnce({});
      const res = await handler(eventWith(score));

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({ candidateId: 'cand1', finalScore: score, configVersion: 'v1', flagged: false });
      const update = sagaUpdate();
      expect(update.UpdateExpression).toBe('SET finalScore = :fs, evaluationCompletedAt = :at, configVersionUsedForEval = :cv');
      expect(update.ExpressionAttributeValues).toMatchObject({ ':fs': score, ':cv': 'v1' });
      expect(JSON.stringify(update)).not.toMatch(/status|#st|currentStage|evaluationResult/);
      expect(mockEbSend).not.toHaveBeenCalled();
    }
  });

  it('records an event with no score (nobody scored) as an empty final score', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: SAGA }).mockResolvedValueOnce({});
    const res = await handler(eventWith(undefined));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ finalScore: null, flagged: false });
    expect(sagaUpdate().ExpressionAttributeValues[':fs']).toBeNull();
  });

  it('treats an old veto event like any other: no outcome, no score, nothing moves', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: SAGA }).mockResolvedValueOnce({});
    const res = await handler({ detail: { candidateId: 'cand1', tenant_id: TEN, result: 'STRONG_NO_VETO' } });

    expect(res.statusCode).toBe(200);
    expect(sagaUpdate().UpdateExpression).not.toMatch(/status|#st/);
    expect(mockEbSend).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 2.  The review flag: reviewBelowScore from the company's own setting
// =============================================================================
describe('handler – score_under_review_level', () => {
  it('is set when the final score is under reviewBelowScore', async () => {
    mockRejectionRules = { reviewVoteLevel: 'STRONG_NO', reviewBelowScore: 3 };
    mockDynamoSend.mockResolvedValueOnce({ Item: SAGA }).mockResolvedValueOnce({});
    const res = await handler(eventWith(2.5));

    expect(JSON.parse(res.body).flagged).toBe(true);
    const update = sagaUpdate();
    expect(update.UpdateExpression).toMatch(/score_under_review_level = :flag/);
    expect(update.ExpressionAttributeValues[':flag']).toBe(true);
    expect(JSON.stringify(update)).not.toMatch(/status|currentStage/);
  });

  it('is not set when the score equals reviewBelowScore or is above it', async () => {
    mockRejectionRules = { reviewVoteLevel: 'STRONG_NO', reviewBelowScore: 3 };
    for (const score of [3, 3.1]) {
      mockDynamoSend.mockReset();
      mockDynamoSend.mockResolvedValueOnce({ Item: SAGA }).mockResolvedValueOnce({});
      await handler(eventWith(score));
      expect(sagaUpdate().UpdateExpression).not.toMatch(/score_under_review_level/);
    }
  });

  it('is never set when the company leaves reviewBelowScore empty (no built-in default)', async () => {
    mockRejectionRules = { reviewVoteLevel: 'STRONG_NO', reviewBelowScore: null };
    mockDynamoSend.mockResolvedValueOnce({ Item: SAGA }).mockResolvedValueOnce({});
    await handler(eventWith(1.0));
    expect(sagaUpdate().UpdateExpression).not.toMatch(/score_under_review_level/);
  });

  it('is not set when there is no score', async () => {
    mockRejectionRules = { reviewVoteLevel: 'STRONG_NO', reviewBelowScore: 3 };
    mockDynamoSend.mockResolvedValueOnce({ Item: SAGA }).mockResolvedValueOnce({});
    await handler(eventWith(undefined));
    expect(sagaUpdate().UpdateExpression).not.toMatch(/score_under_review_level/);
  });
});

// =============================================================================
// 3.  Input and company checks
// =============================================================================
describe('handler – input and company', () => {
  it('returns 400 when candidateId is missing', async () => {
    const res = await handler({ detail: { tenant_id: TEN, result: 'COMPLETED' } });
    expect(res.statusCode).toBe(400);
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });

  it('skips an event that names no company, reading and writing nothing', async () => {
    const res = await handler({ detail: { candidateId: 'cand1', averageScore: 7, result: 'COMPLETED' } });
    expect(JSON.parse(res.body)).toEqual({ skipped: true });
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });

  it('returns 404 when the candidate is missing', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: undefined });
    const res = await handler(eventWith(7));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Not found' });
  });

  it('returns the same 404 for another company\'s candidate and writes nothing', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: { ...SAGA, tenant_id: 'ten_zzzzzzzzzzzzzzzzzzzzzzzzzz' } });
    const res = await handler(eventWith(7));
    expect(res.statusCode).toBe(404);
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when the candidate has no configVersion', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: { ...SAGA, configVersion: undefined } });
    const res = await handler(eventWith(7));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/configVersion/);
  });
});

// =============================================================================
// 4.  Failures
// =============================================================================
describe('handler – failures', () => {
  it('returns 500 when the candidate cannot be read', async () => {
    mockDynamoSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));
    const res = await handler(eventWith(7));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/read candidate/);
  });

  it('returns 500 when the settings cannot be read, and writes nothing', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: SAGA });
    mockSettingsError = Object.assign(new Error('Config table timeout'), { name: 'TimeoutError' });
    const res = await handler(eventWith(7));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/rejection settings/);
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the candidate update fails', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: SAGA }).mockRejectedValueOnce(new Error('UpdateItem failed'));
    const res = await handler(eventWith(7));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/evaluation record/);
  });
});

// =============================================================================
// 5.  The current interview is marked COMPLETED
// =============================================================================
describe('handler – current interview', () => {
  it('marks the current INTERVIEW record COMPLETED', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: { ...SAGA, currentInterviewId: 'iv-1' } })
      .mockResolvedValueOnce({})   // candidate UpdateItem
      .mockResolvedValueOnce({});  // INTERVIEW UpdateItem
    const res = await handler(eventWith(7));

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
    const res = await handler(eventWith(7));
    expect(res.statusCode).toBe(200);
  });
});
