'use strict';

/**
 * scheduleInterview — unit tests (NH-122 / BE-006)
 *
 * Covers the current HTTP contract:
 *   POST  /candidates/{id}/interviews                 schedule an interview
 *   PATCH /candidates/{id}/interviews/{interviewId}   add panel members, or { action: 'complete' }
 *   GET   /candidates/{id}/interviews                 list interviews with their votes
 */

const mockDynamoSend = jest.fn();
const mockSqsSend    = jest.fn();
const mockEbSend     = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient:    jest.fn(() => ({ send: mockDynamoSend })),
  GetItemCommand:    jest.fn((p) => ({ _cmd: 'GetItem', ...p })),
  PutItemCommand:    jest.fn((p) => ({ _cmd: 'PutItem', ...p })),
  UpdateItemCommand: jest.fn((p) => ({ _cmd: 'UpdateItem', ...p })),
  QueryCommand:      jest.fn((p) => ({ _cmd: 'Query', ...p })),
}));

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient:          jest.fn(() => ({ send: mockSqsSend })),
  SendMessageCommand: jest.fn((p) => ({ _cmd: 'SendMessage', ...p })),
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockEbSend })),
  PutEventsCommand:  jest.fn((p) => ({ _cmd: 'PutEvents', ...p })),
}));

// Pass-through marshalling, honouring removeUndefinedValues like the real one.
jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj, opts) => (opts?.removeUndefinedValues
    ? Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
    : obj)),
  unmarshall: jest.fn((obj) => obj),
}));

jest.mock('../shared/config-reader', () => ({
  getConfig:     jest.fn(),
  getConfigItem: jest.fn(),
}));

const { getConfig } = require('../shared/config-reader');

process.env.STATE_TABLE_NAME       = 'talent-flow-state';
process.env.NOTIFICATION_QUEUE_URL = 'https://sqs.test/notifications.fifo';
process.env.EVENTBRIDGE_BUS_NAME   = 'talent-flow-bus';

const { handler } = require('./index');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PANEL_CONFIG = {
  rules: {
    strongNoVeto: true,
    votesRequired: { JUNIOR: 2, MID: 3, SENIOR: 4, DIRECTOR: 5 },
  },
};

function postEvent(overrides = {}) {
  return {
    requestContext: { http: { method: 'POST' } },
    pathParameters: { id: 'cand-123' },
    body: JSON.stringify({
      tenantId: 'DEFAULT',
      interviewId: 'iv-001',
      interviewType: 'TECHNICAL_INTERVIEW',
      scheduledAt: '2026-05-20T10:00:00Z',
      panelMemberIds: ['pm-1', 'pm-2', 'pm-3'],
      ...overrides,
    }),
  };
}

function patchEvent(body) {
  return {
    requestContext: { http: { method: 'PATCH' } },
    pathParameters: { id: 'cand-123', interviewId: 'iv-001' },
    body: JSON.stringify(body),
  };
}

function saga(overrides = {}) {
  return {
    Item: {
      PK: 'CANDIDATE#cand-123', SK: 'SAGA',
      currentStage: 'INTERVIEWING', positionLevel: 'SENIOR',
      ...overrides,
    },
  };
}

/** GetItem SAGA → Query existing interviews → PutItem interview → UpdateItem SAGA → PutItem audit */
function happyChain({ sagaOverrides = {}, existing = [] } = {}) {
  mockDynamoSend
    .mockResolvedValueOnce(saga(sagaOverrides))
    .mockResolvedValueOnce({ Items: existing })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({});
}

const callsOf = (cmd) => mockDynamoSend.mock.calls.map((c) => c[0]).filter((c) => c._cmd === cmd);

beforeEach(() => {
  mockDynamoSend.mockReset();
  mockSqsSend.mockReset();
  mockEbSend.mockReset();
  getConfig.mockReset();
  mockSqsSend.mockResolvedValue({});
  mockEbSend.mockResolvedValue({});
  getConfig.mockResolvedValue(PANEL_CONFIG);
});

// ── POST: schedule ────────────────────────────────────────────────────────────

describe('POST schedule interview', () => {
  test('SENIOR: writes a SCHEDULED interview with votesRequired=4, links it on the SAGA, notifies panel', async () => {
    happyChain();

    const res = await handler(postEvent());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      interviewId: 'iv-001', candidateId: 'cand-123',
      interviewType: 'TECHNICAL_INTERVIEW', votesRequired: 4, status: 'SCHEDULED',
    });

    const [interviewPut, auditPut] = callsOf('PutItem');
    expect(interviewPut.Item).toMatchObject({
      PK: 'CANDIDATE#cand-123', SK: 'INTERVIEW#iv-001',
      votesRequired: 4, votesSubmitted: 0, status: 'SCHEDULED',
      panelMemberIds: ['pm-1', 'pm-2', 'pm-3'],
    });
    expect(interviewPut.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(auditPut.Item).toMatchObject({ eventType: 'INTERVIEW_SCHEDULED', interviewId: 'iv-001' });

    const [sagaUpdate] = callsOf('UpdateItem');
    expect(sagaUpdate.Key).toEqual({ PK: 'CANDIDATE#cand-123', SK: 'SAGA' });
    expect(sagaUpdate.ExpressionAttributeValues).toEqual({ ':iid': 'iv-001' });

    expect(mockSqsSend).toHaveBeenCalledTimes(3);
    expect(mockEbSend).toHaveBeenCalledTimes(1);
    expect(mockEbSend.mock.calls[0][0].Entries[0].DetailType).toBe('InterviewScheduled');
  });

  test.each([
    ['JUNIOR', 2],
    ['MID', 3],
  ])('%s: votesRequired=%i comes from PANEL_CONFIG', async (level, expected) => {
    happyChain({ sagaOverrides: { positionLevel: level } });

    const res = await handler(postEvent());

    expect(JSON.parse(res.body).votesRequired).toBe(expected);
  });

  test('reads the active PANEL_CONFIG for the tenant', async () => {
    happyChain();
    await handler(postEvent());
    expect(getConfig).toHaveBeenCalledWith('DEFAULT', 'PANEL_CONFIG');
  });

  test('DIRECTOR is not an accepted position level → 400', async () => {
    mockDynamoSend
      .mockResolvedValueOnce(saga({ positionLevel: 'DIRECTOR' }))
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(postEvent());

    expect(res.statusCode).toBe(400);
    expect(callsOf('PutItem')).toHaveLength(0);
  });

  test('SQS: MessageGroupId=candidateId, MessageDeduplicationId=interviewId#recipientId, body fields', async () => {
    happyChain();

    await handler(postEvent());

    const first = mockSqsSend.mock.calls[0][0];
    expect(first.MessageGroupId).toBe('cand-123');
    expect(first.MessageDeduplicationId).toBe('iv-001#pm-1');
    expect(JSON.parse(first.MessageBody)).toMatchObject({
      type: 'INTERVIEW_SCHEDULED', recipientId: 'pm-1', candidateId: 'cand-123',
      scheduledAt: '2026-05-20T10:00:00Z', interviewId: 'iv-001',
    });
  });

  test('ad hoc panel members only: interview is written, nobody is queued', async () => {
    happyChain();

    const res = await handler(postEvent({
      panelMemberIds: [],
      adhocPanelMembers: [{ name: 'Ext Reviewer', email: 'ext@example.com' }],
    }));

    expect(res.statusCode).toBe(200);
    expect(callsOf('PutItem')[0].Item.adhocPanelMembers).toHaveLength(1);
    expect(mockSqsSend).not.toHaveBeenCalled();
  });

  test('duplicate interviewId (ConditionalCheckFailed) is skipped idempotently', async () => {
    const condErr = Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
    mockDynamoSend
      .mockResolvedValueOnce(saga())
      .mockResolvedValueOnce({ Items: [] })
      .mockRejectedValueOnce(condErr)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await handler(postEvent());

    expect(res.statusCode).toBe(200);
  });

  test('other PutItem errors → 500', async () => {
    mockDynamoSend
      .mockResolvedValueOnce(saga())
      .mockResolvedValueOnce({ Items: [] })
      .mockRejectedValueOnce(new Error('throttled'));

    const res = await handler(postEvent());

    expect(res.statusCode).toBe(500);
    expect(mockSqsSend).not.toHaveBeenCalled();
  });

  test('EventBridge failure is non-fatal', async () => {
    happyChain();
    mockEbSend.mockRejectedValueOnce(new Error('EB down'));

    const res = await handler(postEvent());

    expect(res.statusCode).toBe(200);
  });

  test('candidateId falls back to the path parameter', async () => {
    happyChain();
    await handler(postEvent());
    expect(callsOf('GetItem')[0].Key).toEqual({ PK: 'CANDIDATE#cand-123', SK: 'SAGA' });
  });
});

describe('POST guards', () => {
  test('missing required fields → 400 listing them', async () => {
    const event = postEvent();
    const body = JSON.parse(event.body);
    delete body.scheduledAt;
    delete body.interviewType;
    event.body = JSON.stringify(body);

    const res = await handler(event);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/interviewType, scheduledAt/);
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });

  test('no panel members at all → 400', async () => {
    const res = await handler(postEvent({ panelMemberIds: [] }));
    expect(res.statusCode).toBe(400);
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });

  test('SAGA not found → 404', async () => {
    mockDynamoSend.mockResolvedValueOnce({});
    const res = await handler(postEvent());
    expect(res.statusCode).toBe(404);
  });

  test('candidate not in INTERVIEWING → 409', async () => {
    mockDynamoSend.mockResolvedValueOnce(saga({ currentStage: 'SCREENING' }));
    const res = await handler(postEvent());
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/INTERVIEWING/);
  });

  test('another interview still SCHEDULED → 409 (interviews run one at a time)', async () => {
    mockDynamoSend
      .mockResolvedValueOnce(saga())
      .mockResolvedValueOnce({ Items: [{ interviewType: 'HR_INTERVIEW', status: 'SCHEDULED' }] });

    const res = await handler(postEvent());

    expect(res.statusCode).toBe(409);
    expect(callsOf('PutItem')).toHaveLength(0);
  });

  test('same interview type already COMPLETED → 409', async () => {
    mockDynamoSend
      .mockResolvedValueOnce(saga())
      .mockResolvedValueOnce({ Items: [{ interviewType: 'TECHNICAL_INTERVIEW', status: 'COMPLETED' }] });

    const res = await handler(postEvent());

    expect(res.statusCode).toBe(409);
  });

  test('PANEL_CONFIG read fails → 500', async () => {
    mockDynamoSend.mockResolvedValueOnce(saga()).mockResolvedValueOnce({ Items: [] });
    getConfig.mockRejectedValueOnce(new Error('boom'));

    const res = await handler(postEvent());

    expect(res.statusCode).toBe(500);
  });

  test('PANEL_CONFIG has no votesRequired for the level → 500', async () => {
    mockDynamoSend.mockResolvedValueOnce(saga()).mockResolvedValueOnce({ Items: [] });
    getConfig.mockResolvedValueOnce({ rules: { votesRequired: { JUNIOR: 2 } } });

    const res = await handler(postEvent());

    expect(res.statusCode).toBe(500);
  });
});

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe('PATCH complete interview', () => {
  test('marks the interview COMPLETED with an outcome and publishes InterviewCompleted', async () => {
    mockDynamoSend.mockResolvedValueOnce({});

    const res = await handler(patchEvent({ action: 'complete', outcome: 'PASS' }));

    expect(res.statusCode).toBe(200);
    const update = callsOf('UpdateItem')[0];
    expect(update.Key).toEqual({ PK: 'CANDIDATE#cand-123', SK: 'INTERVIEW#iv-001' });
    expect(update.ConditionExpression).toBe('attribute_exists(PK)');
    expect(update.ExpressionAttributeValues).toMatchObject({ ':completed': 'COMPLETED', ':outcome': 'PASS' });
    expect(mockEbSend.mock.calls[0][0].Entries[0].DetailType).toBe('InterviewCompleted');
  });

  test('unknown interview → 404', async () => {
    mockDynamoSend.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { name: 'ConditionalCheckFailedException' }),
    );

    const res = await handler(patchEvent({ action: 'complete' }));

    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH add panel members', () => {
  test('merges new members without duplicates', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: {
        panelMemberIds: ['pm-1'],
        adhocPanelMembers: [{ name: 'A', email: 'a@example.com' }],
      } })
      .mockResolvedValueOnce({});

    const res = await handler(patchEvent({
      panelMemberIds: ['pm-1', 'pm-2'],
      adhocPanelMembers: [{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }],
    }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.panelMemberIds).toEqual(['pm-1', 'pm-2']);
    expect(body.adhocPanelMembers.map((m) => m.email)).toEqual(['a@example.com', 'b@example.com']);
  });

  test('nothing to add → 400', async () => {
    const res = await handler(patchEvent({ panelMemberIds: [] }));
    expect(res.statusCode).toBe(400);
  });

  test('unknown interview → 404', async () => {
    mockDynamoSend.mockResolvedValueOnce({});
    const res = await handler(patchEvent({ panelMemberIds: ['pm-9'] }));
    expect(res.statusCode).toBe(404);
  });
});

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET interviews', () => {
  test('returns interviews in date order, each with only its own votes', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [
        { PK: 'x', SK: 'INTERVIEW#b', interviewId: 'b', scheduledAt: '2026-05-21T10:00:00Z' },
        { PK: 'x', SK: 'INTERVIEW#a', interviewId: 'a', scheduledAt: '2026-05-20T10:00:00Z' },
      ] })
      .mockResolvedValueOnce({ Items: [
        { voterId: 'v1', interviewId: 'a', rating: 'YES' },
        { voterId: 'v2', interviewId: 'b', rating: 'NO' },
      ] });

    const res = await handler({ requestContext: { http: { method: 'GET' } }, pathParameters: { id: 'cand-123' } });

    expect(res.statusCode).toBe(200);
    const { interviews } = JSON.parse(res.body);
    expect(interviews.map((i) => i.interviewId)).toEqual(['a', 'b']);
    expect(interviews[0].votes.map((v) => v.voterId)).toEqual(['v1']);
    expect(interviews[0]).not.toHaveProperty('PK');
  });
});
