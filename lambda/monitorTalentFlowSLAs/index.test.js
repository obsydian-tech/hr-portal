'use strict';

/**
 * AI-001 (NH-127) — monitorTalentFlowSLAs unit tests
 *
 * CJS jest.mock() pattern — mocks are hoisted by Jest babelPlugin before require().
 * Uses `var` (not const/let) for mock refs to avoid TDZ errors with hoisting.
 * marshall/unmarshall from @aws-sdk/util-dynamodb are left REAL (pure, no network).
 */

// ---------------------------------------------------------------------------
// Mock registrations — hoisted by Jest before require('./index.js')
// ---------------------------------------------------------------------------

// var declarations are hoisted to undefined before jest.mock factories run.
// jest.mock factories then assign jest.fn() values. By the time handler is
// require()'d, all mock vars hold valid jest.fn() references.
var mockDynSend;
var mockEbSend;
var mockGetConfig;

jest.mock('@aws-sdk/client-dynamodb', () => {
  mockDynSend = jest.fn();
  return {
    DynamoDBClient:    jest.fn().mockImplementation(() => ({ send: mockDynSend })),
    ScanCommand:       jest.fn((p) => p),
    UpdateItemCommand: jest.fn((p) => p),
  };
});

jest.mock('@aws-sdk/client-eventbridge', () => {
  mockEbSend = jest.fn();
  return {
    EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEbSend })),
    PutEventsCommand:  jest.fn((p) => p),
  };
});

jest.mock('../shared/config-reader', () => {
  mockGetConfig = jest.fn();
  return { getConfig: mockGetConfig };
});

// ---------------------------------------------------------------------------
// Load handler after mocks are registered
// ---------------------------------------------------------------------------
const { marshall } = require('@aws-sdk/util-dynamodb');
const { handler }  = require('./index.js');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const INTERVIEW_THRESHOLD = 48; // hours
const ONE_HOUR = 3600000;

/**
 * Build a DynamoDB-formatted SAGA item ready for mock scan responses.
 * stageEnteredAt defaults to 72h ago (past INTERVIEW_THRESHOLD of 48h).
 */
function makeSagaItem({
  pk            = 'CANDIDATE#cand-001',
  stage         = 'INTERVIEW',
  stageEnteredAt,
  slaBreachedAt,
  candidateId   = 'cand-001',
  tenantId      = 'DEFAULT',
} = {}) {
  const item = {
    PK:             pk,
    SK:             'SAGA',
    status:         'ACTIVE',
    currentStage:   stage,
    stageEnteredAt: stageEnteredAt ?? new Date(Date.now() - (INTERVIEW_THRESHOLD + 24) * ONE_HOUR).toISOString(),
    candidateId,
    tenantId,
  };
  if (slaBreachedAt) item.slaBreachedAt = slaBreachedAt;
  return marshall(item);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockDynSend.mockReset();
  mockEbSend.mockReset();
  mockGetConfig.mockReset();
  process.env.STATE_TABLE_NAME     = 'talent-flow-state';
  process.env.EVENTBRIDGE_BUS_NAME = 'talent-flow-bus';
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('monitorTalentFlowSLAs', () => {
  test('1. Active SAGA past threshold, not yet breached → conditional UpdateItem + PutEvents', async () => {
    mockGetConfig.mockResolvedValue({ data: { INTERVIEW: INTERVIEW_THRESHOLD } });
    mockDynSend
      .mockResolvedValueOnce({ Items: [makeSagaItem()], LastEvaluatedKey: undefined }) // Scan
      .mockResolvedValueOnce({});                                                       // UpdateItem
    mockEbSend.mockResolvedValueOnce({});

    await handler();

    // Scan + UpdateItem = 2 dynamo calls
    expect(mockDynSend).toHaveBeenCalledTimes(2);

    // Verify UpdateItem has idempotency guard
    const updateArgs = mockDynSend.mock.calls[1][0];
    expect(updateArgs.ConditionExpression).toBe('attribute_not_exists(slaBreachedAt)');
    expect(updateArgs.UpdateExpression).toBe('SET slaBreachedAt = :now, slaBreachedStage = :stage');
    expect(updateArgs.TableName).toBe('talent-flow-state');

    // Verify EventBridge event
    expect(mockEbSend).toHaveBeenCalledTimes(1);
    const ebArgs = mockEbSend.mock.calls[0][0];
    expect(ebArgs.Entries[0].Source).toBe('talent-flow.sla');
    expect(ebArgs.Entries[0].DetailType).toBe('SLABreached');
    const detail = JSON.parse(ebArgs.Entries[0].Detail);
    expect(detail.stage).toBe('INTERVIEW');
    expect(detail.thresholdHours).toBe(INTERVIEW_THRESHOLD);
    expect(detail.candidateId).toBe('cand-001');
  });

  test('2. Already-breached SAGA (slaBreachedAt set) → no UpdateItem, no PutEvents', async () => {
    mockGetConfig.mockResolvedValue({ data: { INTERVIEW: INTERVIEW_THRESHOLD } });
    mockDynSend.mockResolvedValueOnce({
      Items: [makeSagaItem({ slaBreachedAt: '2026-05-10T00:00:00.000Z' })],
      LastEvaluatedKey: undefined,
    });

    await handler();

    expect(mockDynSend).toHaveBeenCalledTimes(1); // Scan only — skip branch hit
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  test('3. Active SAGA within threshold → no breach event', async () => {
    mockGetConfig.mockResolvedValue({ data: { INTERVIEW: INTERVIEW_THRESHOLD } });
    const recentEnteredAt = new Date(Date.now() - 10 * ONE_HOUR).toISOString(); // 10h ago
    mockDynSend.mockResolvedValueOnce({
      Items: [makeSagaItem({ stageEnteredAt: recentEnteredAt })],
      LastEvaluatedKey: undefined,
    });

    await handler();

    expect(mockDynSend).toHaveBeenCalledTimes(1); // Scan only
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  test('4. Stage not in config thresholds → skipped gracefully, no crash', async () => {
    // Config contains APPLICATION_REVIEW but NOT INTERVIEW
    mockGetConfig.mockResolvedValue({ data: { APPLICATION_REVIEW: 24 } });
    mockDynSend.mockResolvedValueOnce({
      Items: [makeSagaItem({ stage: 'INTERVIEW' })],
      LastEvaluatedKey: undefined,
    });

    await expect(handler()).resolves.toBeUndefined();
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  test('5. getConfig failure → Lambda throws (fatal, cron will retry)', async () => {
    mockGetConfig.mockRejectedValue(new Error('DynamoDB config timeout'));

    await expect(handler()).rejects.toThrow('DynamoDB config timeout');
    expect(mockDynSend).not.toHaveBeenCalled(); // scan never reached
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  test('6. Single candidate UpdateItem failure (non-ConditionalCheck) → logged, other candidates still processed', async () => {
    mockGetConfig.mockResolvedValue({ data: { INTERVIEW: INTERVIEW_THRESHOLD } });

    const item1 = makeSagaItem({ pk: 'CANDIDATE#c1', candidateId: 'c1' });
    const item2 = makeSagaItem({ pk: 'CANDIDATE#c2', candidateId: 'c2' });

    mockDynSend
      .mockResolvedValueOnce({ Items: [item1, item2], LastEvaluatedKey: undefined }) // Scan
      .mockRejectedValueOnce(new Error('ProvisionedThroughputExceeded'))             // UpdateItem c1 fails
      .mockResolvedValueOnce({});                                                     // UpdateItem c2 succeeds
    mockEbSend.mockResolvedValue({});

    await handler(); // must not throw

    // c1 error caught → no PutEvents for c1; c2 succeeded → 1 PutEvents
    expect(mockEbSend).toHaveBeenCalledTimes(1);
    const detail = JSON.parse(mockEbSend.mock.calls[0][0].Entries[0].Detail);
    expect(detail.candidateId).toBe('c2');
  });

  test('7. Concurrent run: ConditionalCheckFailedException on UpdateItem → silent skip, no PutEvents', async () => {
    mockGetConfig.mockResolvedValue({ data: { INTERVIEW: INTERVIEW_THRESHOLD } });
    mockDynSend
      .mockResolvedValueOnce({ Items: [makeSagaItem()], LastEvaluatedKey: undefined }) // Scan
      .mockRejectedValueOnce(Object.assign(new Error('Conditional check failed'), { name: 'ConditionalCheckFailedException' })); // UpdateItem race

    await handler(); // must not throw

    expect(mockDynSend).toHaveBeenCalledTimes(2); // Scan + UpdateItem (which failed conditionally)
    expect(mockEbSend).not.toHaveBeenCalled(); // PutEvents skipped on conditional failure
  });
});
