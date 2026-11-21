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

// MOD-01: the module switch is the shared helper's job (tested in shared/modules.test.mjs); here Recruitment is on.
jest.unstable_mockModule('../shared/modules.mjs', () => ({
  MODULE_KEYS: ['onboarding', 'recruitment'],
  modulesOf: async () => ['onboarding', 'recruitment'],
  requireModule: async () => null,
}));

// REC-02: the company's REJECTION_RULES come from the shared settings reader (tested in the acceptance suite); here they are set per test.
let mockRejectionRules = { reviewVoteLevel: 'STRONG_NO', reviewBelowScore: null };
jest.unstable_mockModule('../shared/recruitment-settings.mjs', () => ({
  DEFAULTS: { REJECTION_RULES: { reviewVoteLevel: 'STRONG_NO', reviewBelowScore: null } },
  getRecruitmentSettings: async () => ({ REJECTION_RULES: mockRejectionRules }),
}));

jest.mock('./config-reader', () => ({
  getConfig: jest.fn(),
}));

// ── Module under test (imported AFTER mocks) ──────────────────────────────────
const { handler, _calculateWeightedScore } = require('./index');
const { getConfig } = require('./config-reader');

// ── Helpers ───────────────────────────────────────────────────────────────────
process.env.STATE_TABLE_NAME    = 'talent-flow-state';
process.env.EVENTBRIDGE_BUS_NAME = 'talent-flow-events';
process.env.ENVIRONMENT         = 'test';

const TEN = 'ten_0123456789abcdefghijklmnop';

const SAGA = {
  PK: 'CANDIDATE#cand1', SK: 'SAGA', tenant_id: TEN,
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
    candidateId: 'cand1', tenant_id: TEN,
    voterId: 'voter1', rating: 'YES',
    scores: SCORES,
  },
};

const interviewEvent = {
  detail: { ...validEvent.detail, interviewId: 'int1' },
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
  // clearAllMocks keeps queued mockResolvedValueOnce values, so one failing
  // test would leak its leftovers into the next. Reset the queues too.
  mockDynamoSend.mockReset();
  mockEbSend.mockReset();
  getConfig.mockReset();
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

    // Current path: the vote names its interview, and the counter lives on
    // the INTERVIEW# record (returned ALL_NEW with votesRequired).
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })                                     // GetItem SAGA
      .mockResolvedValueOnce({ Items: [] })                                      // duplicate-vote Query
      .mockResolvedValueOnce({})                                                 // PutItem vote
      .mockResolvedValueOnce({ Attributes: { votesSubmitted: 3, votesRequired: 3 } }) // ADD on INTERVIEW#
      .mockResolvedValueOnce({ Items: voteItems });                              // aggregate

    getConfig
      .mockResolvedValueOnce(WEIGHTS)
      .mockResolvedValueOnce(PANEL_CONFIG);

    const res = await handler(interviewEvent);

    expect(res.statusCode).toBe(200);
    const counterUpdate = mockDynamoSend.mock.calls[3][0];
    expect(counterUpdate.Key).toEqual({ PK: 'CANDIDATE#cand1', SK: 'INTERVIEW#int1' });
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
// 4.  REC-02: a Strong No decides nothing; it adds to strong_no_count when REJECTION_RULES ask for it
// =============================================================================
describe('handler – STRONG_NO raises a flag, never an outcome', () => {
  const strongNo = () => ({ detail: { ...validEvent.detail, rating: 'STRONG_NO' } });
  const writes = () => mockDynamoSend.mock.calls.map((c) => c[0]).filter((c) => c._cmd === 'UpdateItem' || c._cmd === 'PutItem');

  beforeEach(() => { mockRejectionRules = { reviewVoteLevel: 'STRONG_NO', reviewBelowScore: null }; });

  it('records the vote, adds one to strong_no_count and writes no status or veto result', async () => {
    setupHappyPath({ votesSubmitted: 1, votesRequired: 3 });
    const res = await handler(strongNo());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).result).toBeUndefined();
    const flag = writes().find((c) => c.UpdateExpression === 'ADD strong_no_count :one');
    expect(flag).toBeDefined();
    expect(JSON.stringify(writes())).not.toMatch(/votingResult|STRONG_NO_VETO|#s = :|status/);
    expect(mockEbSend).not.toHaveBeenCalled(); // quorum not met, and no veto event
  });

  it('writes no flag when the company sets reviewVoteLevel to null', async () => {
    mockRejectionRules = { reviewVoteLevel: null, reviewBelowScore: null };
    setupHappyPath({ votesSubmitted: 1, votesRequired: 3 });
    const res = await handler(strongNo());

    expect(res.statusCode).toBe(200);
    expect(writes().some((c) => /strong_no_count/.test(c.UpdateExpression ?? ''))).toBe(false);
  });

  it('stores an empty score, not NaN, when the scoring weights carry no numbers', async () => {
    getConfig.mockReset();
    getConfig.mockResolvedValueOnce({ weights: null }).mockResolvedValueOnce(PANEL_CONFIG);
    mockDynamoSend.mockResolvedValue({ Item: SAGA, Items: [], Attributes: { votesSubmitted: 1 } });
    const res = await handler({ detail: { ...validEvent.detail, rating: 'YES' } });

    expect(res.statusCode).toBe(200);
    const vote = mockDynamoSend.mock.calls.map((c) => c[0]).find((c) => c._cmd === 'PutItem');
    expect(vote.Item.weightedScore).toBeNull();
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
    const res = await handler({ detail: { tenant_id: TEN, voterId: 'v', rating: 'YES', scores: SCORES } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/candidateId/);
  });

  it('skips an event without a company: nothing read, written or sent', async () => {
    const res = await handler({ detail: { candidateId: 'c', voterId: 'v', rating: 'YES', scores: SCORES } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ skipped: true });
    expect(mockDynamoSend).not.toHaveBeenCalled();
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  it('returns 400 when voterId missing', async () => {
    const res = await handler({ detail: { candidateId: 'c', tenant_id: TEN, rating: 'YES', scores: SCORES } });
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
// 9.  SAGA not found (or another company's) → 404
// =============================================================================
describe('handler – SAGA not found', () => {
  it('returns 404 when SAGA item is missing', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: undefined });
    getConfig.mockResolvedValue(WEIGHTS);

    const res = await handler(validEvent);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Not found' });
  });

  it('returns the same 404 for another company\'s candidate, and writes nothing', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: { ...SAGA, tenant_id: 'ten_zzzzzzzzzzzzzzzzzzzzzzzzzz' } });
    getConfig.mockResolvedValue(WEIGHTS);

    const res = await handler(validEvent);
    expect(res.statusCode).toBe(404);
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
    expect(mockEbSend).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 10.  SAGA missing configVersion → 400
// =============================================================================
// A call through the API names the candidate in the path; the body need not repeat it (TEN-04 walk).
describe('handler – candidate named in the path', () => {
  const apiEvent = (pathId, body) => ({
    requestContext: { authorizer: { jwt: { claims: { tenant_id: TEN, token_use: 'id', sub: 'u1' } } } },
    pathParameters: { id: pathId },
    body: JSON.stringify(body),
  });
  const bodyNoCandidate = { voterId: 'voter1', rating: 'YES', scores: SCORES };

  it('answers 404 for another company\'s candidate when the body has no candidateId, and writes nothing', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: { ...SAGA, tenant_id: 'ten_zzzzzzzzzzzzzzzzzzzzzzzzzz' } });
    getConfig.mockResolvedValue(WEIGHTS);

    const res = await handler(apiEvent('cand1', bodyNoCandidate));
    expect(res.statusCode).toBe(404);
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
    expect(mockDynamoSend.mock.calls[0][0].Key).toEqual({ PK: 'CANDIDATE#cand1', SK: 'SAGA' });
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  it('refuses a body that names another candidate than the path (REC-01), and reads nothing', async () => {
    const res = await handler(apiEvent('cand-from-path', { ...bodyNoCandidate, candidateId: 'cand-from-body' }));
    expect(res.statusCode).toBe(400);
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });
});

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
    expect(getConfig).toHaveBeenNthCalledWith(1, TEN, 'SCORING_WEIGHTS', 'v3');
    expect(getConfig).toHaveBeenNthCalledWith(2, TEN, 'PANEL_CONFIG',    'v3');
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
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { votesSubmitted: 3, votesRequired: 3 } })
      .mockResolvedValueOnce({ Items: voteItems });

    getConfig
      .mockResolvedValueOnce(WEIGHTS)
      .mockResolvedValueOnce(PANEL_CONFIG);

    await handler(interviewEvent);

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

// =============================================================================
// 19.  Same voter, same interview → 409 before anything is written
// =============================================================================
describe('handler – duplicate vote on the same interview', () => {
  it('returns 409 and writes nothing when the voter already voted on this interview', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: SAGA })
      .mockResolvedValueOnce({ Items: [{ SK: 'VOTE#voter1#2026-01-01T00:00:00Z' }] });
    getConfig
      .mockResolvedValueOnce(WEIGHTS)
      .mockResolvedValueOnce(PANEL_CONFIG);

    const res = await handler(interviewEvent);

    expect(res.statusCode).toBe(409);
    expect(mockDynamoSend).toHaveBeenCalledTimes(2);
    const dupQuery = mockDynamoSend.mock.calls[1][0];
    expect(dupQuery.ExpressionAttributeValues).toMatchObject({ ':votePrefix': 'VOTE#voter1#', ':iid': 'int1' });
    expect(mockEbSend).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 20.  REC-01: a person votes as themselves, and only on an interview whose panel they are on
// =============================================================================
// MOD-01: the module switch is the shared helper's job (tested in shared/modules.test.mjs); here Recruitment is on.
jest.unstable_mockModule('../shared/modules.mjs', () => ({
  MODULE_KEYS: ['onboarding', 'recruitment'],
  modulesOf: async () => ['onboarding', 'recruitment'],
  requireModule: async () => null,
}));

describe('handler – a person calling the API (REC-01)', () => {
  const INTERVIEW = { PK: 'CANDIDATE#cand1', SK: 'INTERVIEW#int1', tenant_id: TEN, panelMemberIds: ['p-1'], votesRequired: 3 };
  const apiEvent = (sub, body = {}) => ({
    requestContext: { authorizer: { jwt: { claims: { sub, tenant_id: TEN, token_use: 'id' } } } },
    pathParameters: { id: 'cand1' },
    body: JSON.stringify({ candidateId: 'cand1', interviewId: 'int1', rating: 'YES', scores: SCORES, ...body }),
  });
  const stored = () => mockDynamoSend.mock.calls.map((c) => c[0]).filter((c) => c._cmd === 'PutItem');

  beforeEach(() => {
    getConfig.mockResolvedValue(WEIGHTS);
    mockDynamoSend.mockImplementation(async (cmd) => {
      if (cmd._cmd === 'GetItem') {
        if (cmd.Key?.SK === 'SAGA') return { Item: SAGA };
        if (cmd.Key?.SK === 'INTERVIEW#int1') return { Item: INTERVIEW };
        return {};
      }
      if (cmd._cmd === 'Query') return { Items: [] };
      if (cmd._cmd === 'UpdateItem') return { Attributes: { votesSubmitted: 1, votesRequired: 3 } };
      return {};
    });
  });

  it('stores the vote under the signed-in person, not the voterId in the body', async () => {
    const res = await handler(apiEvent('p-1', { voterId: 'someone-else', staffId: 'STAFF-1' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).voterId).toBe('p-1');
    expect(stored()).toHaveLength(1);
    expect(stored()[0].Item.voterId).toBe('p-1');
    expect(stored()[0].Item.SK).toMatch(/^VOTE#p-1#/);
  });

  it('refuses a person who is not on the panel (403 Forbidden) and writes nothing', async () => {
    const res = await handler(apiEvent('p-2', { voterId: 'p-1' }));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden' });
    expect(stored()).toHaveLength(0);
  });

  it('refuses a vote with no interview, or an interview of another candidate (403)', async () => {
    expect((await handler(apiEvent('p-1', { interviewId: undefined }))).statusCode).toBe(403);
    expect((await handler(apiEvent('p-1', { interviewId: 'int-other' }))).statusCode).toBe(403);
    expect(stored()).toHaveLength(0);
  });

  it('refuses a sign-in that carries no person id (403)', async () => {
    const e = apiEvent('p-1');
    delete e.requestContext.authorizer.jwt.claims.sub;
    expect((await handler(e)).statusCode).toBe(403);
    expect(stored()).toHaveLength(0);
  });
});
