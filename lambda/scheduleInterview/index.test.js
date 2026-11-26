'use strict';

/**
 * scheduleInterview — unit tests (NH-122 / BE-006)
 *
 * Covers the read and the doors:
 *   GET   /candidates/{id}/interviews                 list interviews with their votes
 *   POST and PATCH (INT-01): the booking and the four actions are judged in the locked acceptance suite int-01;
 *   here only that anyone but a Recruiter is refused first, and that a call with no sign-in is skipped (R-15).
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
  TransactWriteItemsCommand: jest.fn((p) => ({ _cmd: 'TransactWriteItems', ...p })),
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

const TEN = 'ten_0123456789abcdefghijklmnop';
// REC-01: scheduling and changing an interview is the Recruiter's (HR with the Recruitment tick).
const RECRUITER = { tenant_id: TEN, 'cognito:groups': '[hr_staff perm-recruitment]' };
const AS = (method, claims = RECRUITER) => ({ http: { method }, authorizer: { jwt: { claims } } });

const PANEL_CONFIG = {
  rules: {
    strongNoVeto: true,
    votesRequired: { JUNIOR: 2, MID: 3, SENIOR: 4, DIRECTOR: 5 },
  },
};

const postEvent = () => ({ requestContext: AS('POST'), pathParameters: { id: 'cand-123' }, body: '{}' });
const patchEvent = () => ({ requestContext: AS('PATCH'), pathParameters: { id: 'cand-123', interviewId: 'iv-001' }, body: '{}' });

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

// MOD-01: the module switch is the shared helper's job (tested in shared/modules.test.mjs); here Recruitment is on.
jest.unstable_mockModule('../shared/modules.mjs', () => ({
  MODULE_KEYS: ['onboarding', 'recruitment'],
  modulesOf: async () => ['onboarding', 'recruitment'],
  requireModule: async () => null,
}));

// REC-07: the criteria an interview keeps and the decider rule come from the Standard pack (shared/recruitment-settings.mjs, tested
// with its own file); here the company has no setting of its own, so the pack's defaults apply and no extra read is made.
const mockPack = {
  PANEL_CONFIG: { panelSize: { JUNIOR: 2, MID: 3, SENIOR: 4 } },
  SCORING_WEIGHTS: { defaultCriteria: [{ key: 'technical', label: 'Technical' }, { key: 'communication', label: 'Communication' }] },
  REJECTION_RULES: { decider: { JUNIOR: 'HR_OR_HM', MID: 'HR_OR_HM', SENIOR: 'HR_OR_HM' } },
  SLA_THRESHOLDS: { feedbackDueHours: 48 },
};
jest.unstable_mockModule('../shared/recruitment-settings.mjs', () => ({
  DEFAULTS: mockPack,
  activeSettings: async () => ({}),
  getRecruitmentSettings: async () => ({}),
  // REC-15 step D: the interviews read takes the candidate's settings without writing (D-5).
  settingsForRead: async () => ({ settings: {} }),
}));

// REC-15 step D: names come from the shared helper (tested with the acceptance suite rec-15d); here nobody has a name.
jest.unstable_mockModule('../shared/people-names.mjs', () => ({
  SIGN_IN_ID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  namesOf: async (_tenantId, ids) => Object.fromEntries((ids ?? []).map((id) => [id, null])),
}));

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET interviews', () => {
  test('returns interviews in date order, each with only its own votes', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Item: { tenant_id: TEN } })
      .mockResolvedValueOnce({ Items: [
        { PK: 'x', SK: 'INTERVIEW#b', tenant_id: TEN, interviewId: 'b', scheduledAt: '2026-05-21T10:00:00Z' },
        { PK: 'x', SK: 'INTERVIEW#a', tenant_id: TEN, interviewId: 'a', scheduledAt: '2026-05-20T10:00:00Z' },
      ] })
      .mockResolvedValueOnce({ Items: [
        { voterId: 'v1', interviewId: 'a', rating: 'YES' },
        { voterId: 'v2', interviewId: 'b', rating: 'NO' },
      ] });

    const res = await handler({ requestContext: AS('GET'), pathParameters: { id: 'cand-123' } });

    expect(res.statusCode).toBe(200);
    const { interviews } = JSON.parse(res.body);
    expect(interviews.map((i) => i.interviewId)).toEqual(['a', 'b']);
    expect(interviews[0].votes.map((v) => v.voterId)).toEqual(['v1']);
    expect(interviews[0]).not.toHaveProperty('PK');
  });
});

// ── REC-01: who may do what ───────────────────────────────────────────────────

describe('REC-01 role checks', () => {
  const claimsOf = (groups, extra = {}) => ({ tenant_id: TEN, ...(groups ? { 'cognito:groups': groups } : {}), ...extra });

  test('scheduling or changing an interview by anyone but a Recruiter is 403 before any AWS call', async () => {
    for (const groups of ['[hr_staff]', '[perm-recruitment]', '[admin]', '[manager]', '[employee]', '[guest]', undefined]) {
      for (const [method, make] of [['POST', postEvent], ['PATCH', patchEvent]]) {
        const event = make();
        event.requestContext = AS(method, claimsOf(groups));
        const res = await handler(event);
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden' });
      }
    }
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });

  const rows = () => [
    { Item: { tenant_id: TEN, hiringManagerId: 'hm-1', positionLevel: 'MID' } },
    { Items: [
      { PK: 'x', SK: 'INTERVIEW#a', tenant_id: TEN, interviewId: 'a', scheduledAt: '2026-05-20T10:00:00Z', panelMemberIds: ['p-1'] },
      { PK: 'x', SK: 'INTERVIEW#b', tenant_id: TEN, interviewId: 'b', scheduledAt: '2026-05-21T10:00:00Z', panelMemberIds: ['p-2'] },
    ] },
    { Items: [
      { voterId: 'p-1', interviewId: 'a', rating: 'YES' },
      { voterId: 'p-2', interviewId: 'b', rating: 'NO' },
    ] },
  ];
  const get = (claims) => handler({ requestContext: AS('GET', claims), pathParameters: { id: 'cand-123' } });
  const stage = () => rows().forEach((r) => mockDynamoSend.mockResolvedValueOnce(r));

  test('the hiring manager of the candidate sees every interview and vote', async () => {
    stage();
    const res = await get(claimsOf('[manager]', { sub: 'hm-1' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).interviews.map((i) => i.votes.map((v) => v.voterId))).toEqual([['p-1'], ['p-2']]);
  });

  test('REC-07: a hiring manager who is not the decider for the level sees no vote', async () => {
    stage();
    mockPack.REJECTION_RULES.decider.MID = 'HR_ONLY';
    try {
      const res = await get(claimsOf('[manager]', { sub: 'hm-1' }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).interviews.map((i) => i.votes)).toEqual([[], []]);
    } finally { mockPack.REJECTION_RULES.decider.MID = 'HR_OR_HM'; }
  });

  test('a panel member sees only their own interview and only their own vote', async () => {
    stage();
    const res = await get(claimsOf('[employee]', { sub: 'p-1' }));
    expect(res.statusCode).toBe(200);
    const { interviews } = JSON.parse(res.body);
    expect(interviews.map((i) => i.interviewId)).toEqual(['a']);
    expect(interviews[0].votes.map((v) => v.voterId)).toEqual(['p-1']);
  });

  test('a call with no sign-in (a bus event or a direct invoke) is skipped before any AWS call (INT-01 R-15)', async () => {
    for (const event of [{ source: 'talent-flow.workflow', 'detail-type': 'InterviewScheduled', detail: { tenant_id: TEN } }, { pathParameters: { id: 'cand-123' }, body: '{}' }]) {
      const res = await handler(event);
      expect(res).toEqual({ statusCode: 200, body: JSON.stringify({ skipped: true }) });
    }
    expect(mockDynamoSend).not.toHaveBeenCalled();
    expect(mockSqsSend).not.toHaveBeenCalled();
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  test('anyone else gets 404, the answer of a candidate that does not exist', async () => {
    for (const claims of [claimsOf('[manager]', { sub: 'hm-2' }), claimsOf('[guest]', { sub: 'g-1' }), claimsOf(undefined, { sub: 'n-1' })]) {
      mockDynamoSend.mockReset();
      stage();
      const res = await get(claims);
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body)).toEqual({ error: 'Not found' });
    }
  });
});
