'use strict';

// ── Mock declarations (must be at top — no out-of-scope refs in factory) ──────
const mockDynamoSend = jest.fn();
const mockEbSend     = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient:    jest.fn(() => ({ send: mockDynamoSend })),
  GetItemCommand:    jest.fn((p) => ({ _cmd: 'GetItem',  ...p })),
  PutItemCommand:    jest.fn((p) => ({ _cmd: 'PutItem',  ...p })),
  UpdateItemCommand: jest.fn((p) => ({ _cmd: 'UpdateItem', ...p })),
  QueryCommand:      jest.fn((p) => ({ _cmd: 'Query',    ...p })),
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

// ── Module under test (imported AFTER mocks) ──────────────────────────────────
const { handler, _calculateWeightedScore } = require('./index');
const { getConfig } = require('../shared/config-reader');

// ── Helpers ───────────────────────────────────────────────────────────────────
process.env.STATE_TABLE_NAME    = 'talent-flow-state';
process.env.EVENTBRIDGE_BUS_NAME = 'talent-flow-events';
process.env.ENVIRONMENT         = 'test';

const SAGA = {
  PK: 'CANDIDATE#cand1', SK: 'SAGA',
  configVersion: 'v1', status: 'TECHNICAL_INTERVIEW', votesSubmitted: 0,
};

const WEIGHTS = { technical: 30, communication: 25, culturalFit: 25, problemSolving: 20 };
const PANEL_CONFIG = {
  rules: { strongNoVeto: true, votesRequired: { senior: 3 } },
};
const PANEL_CONFIG_NO_VETO = {
  rules: { strongNoVeto: false, votesRequired: { senior: 3 } },
};

const SCORES = { technical: 8, communication: 7, culturalFit: 9, problemSolving: 6 };
// Expected: (8*30 + 7*25 + 9*25 + 6*20) / 100 = (240+175+225+120)/100 = 7.60

const INTERVIEW_ITEM = { PK: 'CANDIDATE#cand1', SK: 'INTERVIEW#int1', votesRequired: 3 };

const validEvent = {
  detail: {
    candidateId: 'cand1', tenantId: 'tenant1',
    voterId: 'voter1', rating: 'YES',
    scores: SCORES,
  },
};

// Default happy-path mock chain
function setupHappyPath({ votesSubmitted = 1, votesRequired = 3 } = {}) {
  mockDynamoSend
    .mockResolvedValueOnce({ Item: SAGA })                        // GetItem SAGA
    .mockResolvedValueOnce({})                                    // PutItem vote
    .mockResolvedValueOnce({                                      // UpdateItem ADD
      Attributes: { votesSubmitted },
    })
    .mockResolvedValueOnce({                                      // Query interview
      Items: [{ ...INTERVIEW_ITEM, votesRequired }],
    });

  getConfig
    .mockResolvedValueOnce(WEIGHTS)
    .mockResolvedValueOnce(PANEL_CONFIG);
}

// ── Purge module between tests to avoid singleton state ───────────────────────
beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// 1.  Weighted score unit test
// =============================================================================
describe('_calculateWeightedScore', () => {
  it('returns expected value for seed weights', () => {
    const result = _calculateWeightedScore(SCORES, WEIGHTS);
    expect(result).toBeCloseTo(7.60, 5);
  });
});

// =============================================================================
// 2.  Happy path — vote written, counter incremented, quorum NOT yet met
// =============================================================================
describe('handler – happy path, no quorum', () => {
  it('returns 200 with weightedScore, quorumMet not signalled', async () => {
    setupHappyPath({ votesSubmitted: 1, votesRequired: 3 });

    const res = await handler(validEvent);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.candidateId).toBe('cand1');
    expect(body.voterId).toBe('voter1');
    expect(body.weightedScore).toBeCloseTo(7.60, 5);
    expect(body.configVersionUsed).toBe('v1');

    // EventBridge should NOT be called — quorum not met
    expect(mockEbSend).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 3.  Quorum met — VotingCompleted published with averageScore
// =============================================================================
describe('handler – quorum met', () => {
  it('publishes VotingCompleted with averageScore when votesSubmitted >= votesRequired', async () => {
    const voteItems = [
      { weightedScore: 7.60 },
      { weightedScore: 8.00 },
      { weightedScore: 6.50 },
    ];

    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { votesSubmitted: 3 } })
      .mockResolvedValueOnce({ Items: [{ votesRequired: 3 }] })   // interview
      .mockResolvedValueOnce({ Items: voteItems });                // aggregate

    getConfig
      .mockResolvedValueOnce(WEIGHTS)
      .mockResolvedValueOnce(PANEL_CONFIG);

    const res = await handler(validEvent);

    expect(res.statusCode).toBe(200);
    expect(mockEbSend).toHaveBeenCalledTimes(1);

    const evtArg = mockEbSend.mock.calls[0][0];
    const detail = JSON.parse(evtArg.Entries[0].Detail);
    expect(detail.result).toBe('COMPLETED');
    expect(detail.averageScore).toBeCloseTo((7.60 + 8.00 + 6.50) / 3, 5);
    expect(evtArg.Entries[0].Source).toBe('talent-flow.workflow');
    expect(evtArg.Entries[0].DetailType).toBe('VotingCompleted');
  });
});

// =============================================================================
// 4.  STRONG_NO + strongNoVeto=true → veto applied, early return
// =============================================================================
describe('handler – STRONG_NO veto', () => {
  it('updates SAGA to EVALUATION_FAILED and publishes VotingCompleted result=STRONG_NO_VETO', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })  // GetItem SAGA
      .mockResolvedValueOnce({});             // UpdateItem SAGA EVALUATION_FAILED

    getConfig
      .mockResolvedValueOnce(WEIGHTS)
      .mockResolvedValueOnce(PANEL_CONFIG);

    const vetoEvent = { detail: { ...validEvent.detail, rating: 'STRONG_NO' } };
    const res = await handler(vetoEvent);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.result).toBe('STRONG_NO_VETO');

    // SAGA UpdateItem called with EVALUATION_FAILED in ExpressionAttributeValues
    const updateCall = mockDynamoSend.mock.calls[1][0];
    expect(updateCall.ExpressionAttributeValues[':sf']).toBe('EVALUATION_FAILED');

    // VotingCompleted published
    expect(mockEbSend).toHaveBeenCalledTimes(1);
    const detail = JSON.parse(mockEbSend.mock.calls[0][0].Entries[0].Detail);
    expect(detail.result).toBe('STRONG_NO_VETO');
  });
});

// =============================================================================
// 5.  STRONG_NO + strongNoVeto=false → vote counted normally
// =============================================================================
describe('handler – STRONG_NO, veto disabled', () => {
  it('counts STRONG_NO as a normal vote when strongNoVeto=false', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { votesSubmitted: 1 } })
      .mockResolvedValueOnce({ Items: [{ votesRequired: 3 }] });

    getConfig
      .mockResolvedValueOnce(WEIGHTS)
      .mockResolvedValueOnce(PANEL_CONFIG_NO_VETO);

    const noVetoEvent = { detail: { ...validEvent.detail, rating: 'STRONG_NO' } };
    const res = await handler(noVetoEvent);

    expect(res.statusCode).toBe(200);
    expect(mockEbSend).not.toHaveBeenCalled(); // quorum not met
  });
});

// =============================================================================
// 6.  STRONG_YES — counted normally, no veto
// =============================================================================
describe('handler – STRONG_YES', () => {
  it('counts STRONG_YES as a normal vote', async () => {
    setupHappyPath({ votesSubmitted: 1, votesRequired: 3 });

    const syEvent = { detail: { ...validEvent.detail, rating: 'STRONG_YES' } };
    const res = await handler(syEvent);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.weightedScore).toBeCloseTo(7.60, 5);
  });
});

// =============================================================================
// 7.  configVersionUsed stored on vote record
// =============================================================================
describe('handler – configVersionUsed on vote record', () => {
  it('stores candidate configVersion on the vote item, not active version', async () => {
    setupHappyPath();
    await handler(validEvent);

    const putCall = mockDynamoSend.mock.calls[1][0]; // second call = PutItem
    expect(putCall.Item.configVersionUsed).toBe('v1');
  });
});

// =============================================================================
// 8.  Validation — missing fields
// =============================================================================
describe('handler – validation', () => {
  it('returns 400 when candidateId missing', async () => {
    const res = await handler({ detail: { tenantId: 't', voterId: 'v', rating: 'YES', scores: SCORES } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/candidateId/);
  });

  it('returns 400 when tenantId missing', async () => {
    const res = await handler({ detail: { candidateId: 'c', voterId: 'v', rating: 'YES', scores: SCORES } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/tenantId/);
  });

  it('returns 400 when voterId missing', async () => {
    const res = await handler({ detail: { candidateId: 'c', tenantId: 't', rating: 'YES', scores: SCORES } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/voterId/);
  });

  it('returns 400 for invalid rating', async () => {
    const res = await handler({ detail: { ...validEvent.detail, rating: 'MAYBE' } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid rating/);
  });

  it('returns 400 when scores dimensions missing', async () => {
    const res = await handler({ detail: { ...validEvent.detail, scores: { technical: 8 } } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/scores/);
  });
});

// =============================================================================
// 9.  SAGA not found → 400
// =============================================================================
describe('handler – SAGA not found', () => {
  it('returns 400 when SAGA item is missing', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: undefined });
    getConfig.mockResolvedValue(WEIGHTS);

    const res = await handler(validEvent);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/SAGA record not found/);
  });
});

// =============================================================================
// 10.  SAGA missing configVersion → 400
// =============================================================================
describe('handler – SAGA missing configVersion', () => {
  it('returns 400 when configVersion is absent from SAGA', async () => {
    const sagaNoVer = { ...SAGA, configVersion: undefined };
    mockDynamoSend.mockResolvedValueOnce({ Item: sagaNoVer });
    getConfig.mockResolvedValue(WEIGHTS);

    const res = await handler(validEvent);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/configVersion/);
  });
});

// =============================================================================
// 11.  getConfig throws → 500
// =============================================================================
describe('handler – getConfig failure', () => {
  it('returns 500 when SCORING_WEIGHTS getConfig throws', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: SAGA });
    getConfig.mockRejectedValueOnce(new Error('DynamoDB timeout'));

    const res = await handler(validEvent);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/scoring configuration/);
  });

  it('returns 500 when PANEL_CONFIG getConfig throws', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: SAGA });
    getConfig
      .mockResolvedValueOnce(WEIGHTS)
      .mockRejectedValueOnce(new Error('DynamoDB timeout'));

    const res = await handler(validEvent);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/panel configuration/);
  });
});

// =============================================================================
// 12.  vote PutItem throws → 500
// =============================================================================
describe('handler – vote PutItem failure', () => {
  it('returns 500 when PutItem throws a non-conditional error', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockRejectedValueOnce(Object.assign(new Error('ProvisionedThroughputExceeded'), { name: 'ProvisionedThroughputExceededException' }));

    getConfig
      .mockResolvedValueOnce(WEIGHTS)
      .mockResolvedValueOnce(PANEL_CONFIG);

    const res = await handler(validEvent);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/vote record/);
  });
});

// =============================================================================
// 13.  Counter increment throws → 500
// =============================================================================
describe('handler – counter update failure', () => {
  it('returns 500 when UpdateItem ADD throws', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('UpdateItem failed'));

    getConfig
      .mockResolvedValueOnce(WEIGHTS)
      .mockResolvedValueOnce(PANEL_CONFIG);

    const res = await handler(validEvent);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/vote counter/);
  });
});

// =============================================================================
// 14.  EventBridge failure is non-fatal (vote written, counter incremented)
// =============================================================================
describe('handler – EventBridge non-fatal on quorum', () => {
  it('returns 200 even when VotingCompleted publish fails', async () => {
    const voteItems = [{ weightedScore: 7.60 }, { weightedScore: 8.00 }, { weightedScore: 6.50 }];

    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { votesSubmitted: 3 } })
      .mockResolvedValueOnce({ Items: [{ votesRequired: 3 }] })
      .mockResolvedValueOnce({ Items: voteItems });

    getConfig
      .mockResolvedValueOnce(WEIGHTS)
      .mockResolvedValueOnce(PANEL_CONFIG);

    mockEbSend.mockRejectedValueOnce(new Error('EventBridge throttled'));

    const res = await handler(validEvent);
    expect(res.statusCode).toBe(200);
  });
});

// =============================================================================
// 15.  Interview record not found — quorum check skipped, vote still 200
// =============================================================================
describe('handler – interview record missing', () => {
  it('still returns 200 but skips quorum publish when interview query returns empty', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { votesSubmitted: 1 } })
      .mockResolvedValueOnce({ Items: [] });  // no interview record

    getConfig
      .mockResolvedValueOnce(WEIGHTS)
      .mockResolvedValueOnce(PANEL_CONFIG);

    const res = await handler(validEvent);
    expect(res.statusCode).toBe(200);
    expect(mockEbSend).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 16.  getConfig uses configVersion from SAGA (not active)
// =============================================================================
describe('handler – versioned config invariant #2', () => {
  it('passes configVersion from SAGA to both getConfig calls', async () => {
    const sagaV3 = { ...SAGA, configVersion: 'v3' };
    mockDynamoSend
      .mockResolvedValueOnce({ Item: sagaV3 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { votesSubmitted: 1 } })
      .mockResolvedValueOnce({ Items: [{ votesRequired: 3 }] });

    getConfig
      .mockResolvedValueOnce(WEIGHTS)
      .mockResolvedValueOnce(PANEL_CONFIG);

    await handler(validEvent);

    expect(getConfig).toHaveBeenCalledTimes(2);
    expect(getConfig).toHaveBeenNthCalledWith(1, 'tenant1', 'SCORING_WEIGHTS', 'v3');
    expect(getConfig).toHaveBeenNthCalledWith(2, 'tenant1', 'PANEL_CONFIG',    'v3');
  });
});

// =============================================================================
// 17.  Correct averageScore calculation across multiple votes
// =============================================================================
describe('handler – averageScore calculation', () => {
  it('calculates correct average across all VOTE# items', async () => {
    const voteItems = [
      { weightedScore: 6.00 },
      { weightedScore: 8.00 },
      { weightedScore: 10.00 },
    ];

    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { votesSubmitted: 3 } })
      .mockResolvedValueOnce({ Items: [{ votesRequired: 3 }] })
      .mockResolvedValueOnce({ Items: voteItems });

    getConfig
      .mockResolvedValueOnce(WEIGHTS)
      .mockResolvedValueOnce(PANEL_CONFIG);

    await handler(validEvent);

    const detail = JSON.parse(mockEbSend.mock.calls[0][0].Entries[0].Detail);
    expect(detail.averageScore).toBeCloseTo(8.00, 5);
  });
});

// =============================================================================
// 18.  Duplicate vote — ConditionalCheckFailed is idempotent (not a 500)
// =============================================================================
describe('handler – duplicate vote idempotent', () => {
  it('does not return 500 when PutItem raises ConditionalCheckFailedException', async () => {
    const condErr = Object.assign(new Error('Condition failed'), { name: 'ConditionalCheckFailedException' });

    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockRejectedValueOnce(condErr)   // PutItem duplicate
      .mockResolvedValueOnce({ Attributes: { votesSubmitted: 1 } })
      .mockResolvedValueOnce({ Items: [{ votesRequired: 3 }] });

    getConfig
      .mockResolvedValueOnce(WEIGHTS)
      .mockResolvedValueOnce(PANEL_CONFIG);

    const res = await handler(validEvent);
    expect(res.statusCode).toBe(200);
  });
});
