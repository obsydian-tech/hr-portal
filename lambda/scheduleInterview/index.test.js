'use strict';

// ── Module-level mocks (must use mockXxx prefix to be accessible in factory) ──

process.env.STATE_TABLE_NAME = 'talent-flow-state';
process.env.CONFIG_TABLE_NAME = 'talent-flow-config';
process.env.NOTIFICATION_QUEUE_URL = 'https://sqs.af-south-1.amazonaws.com/123/talent-flow-notification-queue.fifo';
process.env.EVENTBRIDGE_BUS_NAME = 'talent-flow-bus';
process.env.AWS_ACCOUNT_ID = '937137806477';

const mockDynamoSend = jest.fn();
const mockSqsSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockDynamoSend })),
  GetItemCommand: jest.fn((p) => ({ _cmd: 'GetItem', ...p })),
  PutItemCommand: jest.fn((p) => ({ _cmd: 'PutItem', ...p })),
  UpdateItemCommand: jest.fn((p) => ({ _cmd: 'UpdateItem', ...p })),
}));

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(() => ({ send: mockSqsSend })),
  SendMessageCommand: jest.fn((p) => ({ _cmd: 'SendMessage', ...p })),
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj),
}));

jest.mock('../shared/config-reader', () => ({
  getConfig: jest.fn(),
  getConfigItem: jest.fn(),
}));

const { getConfig } = require('../shared/config-reader');

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildEvent(overrides = {}) {
  return {
    detail: {
      candidateId: 'cand-123',
      tenantId: 'DEFAULT',
      interviewId: 'iv-001',
      interviewType: 'TECHNICAL_INTERVIEW',
      scheduledAt: '2026-05-20T10:00:00Z',
      panelMemberIds: ['pm-1', 'pm-2', 'pm-3'],
      ...overrides,
    },
  };
}

const PANEL_CONFIG = {
  rules: {
    strongNoVeto: true,
    votesRequired: { JUNIOR: 2, MID: 3, SENIOR: 4, DIRECTOR: 5 },
  },
};

// SAGA item returned by DynamoDB (marshall is mocked to pass-through)
function mockSAGAItem(positionLevel = 'SENIOR') {
  return { Item: { PK: 'CANDIDATE#cand-123', SK: 'SAGA', positionLevel } };
}

beforeEach(() => {
  mockDynamoSend.mockReset();
  mockSqsSend.mockReset();
  getConfig.mockReset();
  getConfig.mockResolvedValue(PANEL_CONFIG);
});

const { handler } = require('./index');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('scheduleInterview', () => {
  describe('happy path', () => {
    test('SENIOR candidate: votesRequired=4, interview record written, SAGA updated, SQS messages sent', async () => {
      mockDynamoSend
        .mockResolvedValueOnce(mockSAGAItem('SENIOR'))  // GetItem SAGA
        .mockResolvedValueOnce({})                       // PutItem interview
        .mockResolvedValueOnce({});                      // UpdateItem SAGA
      mockSqsSend.mockResolvedValue({});

      const result = await handler(buildEvent());

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.votesRequired).toBe(4);
      expect(body.status).toBe('SCHEDULED');

      // GetItem + PutItem + UpdateItem
      expect(mockDynamoSend).toHaveBeenCalledTimes(3);
      // SQS: one message per panelMember (3 in default event)
      expect(mockSqsSend).toHaveBeenCalledTimes(3);
    });

    test('JUNIOR candidate: votesRequired=2', async () => {
      mockDynamoSend
        .mockResolvedValueOnce(mockSAGAItem('JUNIOR'))
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      mockSqsSend.mockResolvedValue({});

      const result = await handler(buildEvent());
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).votesRequired).toBe(2);
    });

    test('MID candidate: votesRequired=3', async () => {
      mockDynamoSend
        .mockResolvedValueOnce(mockSAGAItem('MID'))
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      mockSqsSend.mockResolvedValue({});

      const result = await handler(buildEvent());
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).votesRequired).toBe(3);
    });

    test('DIRECTOR candidate: votesRequired=5', async () => {
      mockDynamoSend
        .mockResolvedValueOnce(mockSAGAItem('DIRECTOR'))
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      mockSqsSend.mockResolvedValue({});

      const result = await handler(buildEvent());
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).votesRequired).toBe(5);
    });

    test('SQS MessageGroupId=candidateId, MessageDeduplicationId=interviewId#recipientId', async () => {
      mockDynamoSend
        .mockResolvedValueOnce(mockSAGAItem('SENIOR'))
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      mockSqsSend.mockResolvedValue({});

      await handler(buildEvent({ panelMemberIds: ['pm-A', 'pm-B'] }));

      const sqsCalls = mockSqsSend.mock.calls.map((c) => c[0]);
      expect(sqsCalls[0].MessageGroupId).toBe('cand-123');
      expect(sqsCalls[0].MessageDeduplicationId).toBe('iv-001#pm-A');
      expect(sqsCalls[1].MessageDeduplicationId).toBe('iv-001#pm-B');
    });

    test('SQS message body contains type, recipientId, candidateId, scheduledAt', async () => {
      mockDynamoSend
        .mockResolvedValueOnce(mockSAGAItem('SENIOR'))
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      mockSqsSend.mockResolvedValue({});

      await handler(buildEvent({ panelMemberIds: ['pm-X'] }));

      const body = JSON.parse(mockSqsSend.mock.calls[0][0].MessageBody);
      expect(body.type).toBe('INTERVIEW_SCHEDULED');
      expect(body.recipientId).toBe('pm-X');
      expect(body.candidateId).toBe('cand-123');
      expect(body.scheduledAt).toBe('2026-05-20T10:00:00Z');
    });

    test('duplicate interviewId (ConditionalCheckFailed) is silently skipped — idempotent', async () => {
      const dupError = Object.assign(new Error('Conditional failed'), { name: 'ConditionalCheckFailedException' });
      mockDynamoSend
        .mockResolvedValueOnce(mockSAGAItem('SENIOR'))
        .mockRejectedValueOnce(dupError)   // PutItem — already exists
        .mockResolvedValueOnce({});         // UpdateItem SAGA still runs
      mockSqsSend.mockResolvedValue({});

      const result = await handler(buildEvent());
      expect(result.statusCode).toBe(200);
    });
  });

  describe('validation: missing / invalid input', () => {
    test('missing candidateId → 400', async () => {
      const result = await handler(buildEvent({ candidateId: undefined }));
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toMatch(/candidateId/);
    });

    test('missing panelMemberIds → 400', async () => {
      const result = await handler(buildEvent({ panelMemberIds: undefined }));
      expect(result.statusCode).toBe(400);
    });

    test('empty panelMemberIds array → 400', async () => {
      const result = await handler(buildEvent({ panelMemberIds: [] }));
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toMatch(/panelMemberIds/);
    });
  });

  describe('error cases', () => {
    test('SAGA record not found → 400', async () => {
      mockDynamoSend.mockResolvedValueOnce({ Item: undefined });

      const result = await handler(buildEvent());
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toMatch(/SAGA record not found/);
    });

    test('SAGA GetItem throws → 500', async () => {
      mockDynamoSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

      const result = await handler(buildEvent());
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toMatch(/candidate record/);
    });

    test('invalid positionLevel on SAGA record → 400', async () => {
      mockDynamoSend.mockResolvedValueOnce(mockSAGAItem('VP'));

      const result = await handler(buildEvent());
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toMatch(/positionLevel/);
    });

    test('getConfig throws → 500', async () => {
      mockDynamoSend.mockResolvedValueOnce(mockSAGAItem('SENIOR'));
      getConfig.mockRejectedValueOnce(new Error('Config table down'));

      const result = await handler(buildEvent());
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toMatch(/panel configuration/);
    });

    test('PutItem interview record throws non-conditional error → 500', async () => {
      mockDynamoSend
        .mockResolvedValueOnce(mockSAGAItem('SENIOR'))
        .mockRejectedValueOnce(new Error('Provisioned throughput exceeded'));

      const result = await handler(buildEvent());
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toMatch(/interview record/);
    });

    test('SQS send failure is non-fatal — returns 200', async () => {
      mockDynamoSend
        .mockResolvedValueOnce(mockSAGAItem('SENIOR'))
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      mockSqsSend.mockRejectedValue(new Error('SQS down'));

      const result = await handler(buildEvent({ panelMemberIds: ['pm-1'] }));
      expect(result.statusCode).toBe(200);
    });

    test('SAGA UpdateItem failure is non-fatal — returns 200', async () => {
      mockDynamoSend
        .mockResolvedValueOnce(mockSAGAItem('SENIOR'))
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('UpdateItem failed'));
      mockSqsSend.mockResolvedValue({});

      const result = await handler(buildEvent());
      expect(result.statusCode).toBe(200);
    });
  });
});
