'use strict';

/**
 * lambda/orchestrateTalentFlowWorkflow/index.test.js
 *
 * Unit tests for orchestrateTalentFlowWorkflow — NH-119 checklist:
 *   1. Happy path: configVersion set, stages set, workflowStartedAt set
 *   2. configVersion format: 'v' + item.version (reads from getConfigItem, not hardcoded)
 *   3. UpdateItem ConditionExpression = attribute_not_exists(configVersion)
 *   4. Idempotent: ConditionalCheckFailedException → returns without error
 *   5. Stages seeded from STAGE_CONFIG (not hardcoded)
 *   6. WorkflowStarted source = 'talent-flow.workflow'
 *   7. WorkflowStarted DetailType = 'WorkflowStarted'
 *   8. WorkflowStarted detail includes candidateId, tenantId, configVersion, stages
 *   9. EventBridge failure is non-fatal (UpdateItem succeeded, handler still returns cleanly)
 *  10. DynamoDB UpdateItem error (not ConditionalCheck) is re-thrown
 *  11. Missing candidateId in event.detail throws
 *  12. Missing tenantId in event.detail throws
 */

process.env.STATE_TABLE_NAME = 'talent-flow-state';
process.env.CONFIG_TABLE_NAME = 'talent-flow-config';
process.env.EVENTBRIDGE_BUS_NAME = 'talent-flow-bus';

const mockDynamoSend = jest.fn();
const mockEbSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockDynamoSend })),
  UpdateItemCommand: jest.fn(params => ({ _cmd: 'UpdateItem', ...params }))
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockEbSend })),
  PutEventsCommand: jest.fn(params => ({ _cmd: 'PutEvents', ...params }))
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn(obj => obj),
  unmarshall: jest.fn(obj => obj)
}));

// Mock config-reader so we control version + stages in isolation
jest.mock('../shared/config-reader', () => ({
  getConfigItem: jest.fn(),
  getConfig: jest.fn()
}));

const { getConfigItem, getConfig } = require('../shared/config-reader');

beforeEach(() => {
  mockDynamoSend.mockReset();
  mockEbSend.mockReset();
  getConfigItem.mockReset();
  getConfig.mockReset();

  // Default happy-path responses
  getConfigItem.mockResolvedValue({ version: 1, data: {} });
  getConfig.mockResolvedValue({ enabled: ['APPLICATION_REVIEW', 'PHONE_SCREENING', 'TECHNICAL_INTERVIEW'] });
  mockDynamoSend.mockResolvedValue({});  // UpdateItem success
  mockEbSend.mockResolvedValue({});      // PutEvents success
});

// Helper to build a valid CandidateCreated event
function makeEvent(overrides = {}) {
  return {
    detail: {
      candidateId: 'CAND-01J000000000000000000000',
      tenantId: 'DEFAULT',
      positionLevel: 'SENIOR',
      ...overrides
    }
  };
}

const { handler } = require('./index');

// ── Test 1: happy path ────────────────────────────────────────────────────────
test('happy path: calls UpdateItem then PutEvents and returns without error', async () => {
  await expect(handler(makeEvent())).resolves.toBeUndefined();
  expect(mockDynamoSend).toHaveBeenCalledTimes(1);
  expect(mockEbSend).toHaveBeenCalledTimes(1);
});

// ── Test 2: configVersion format ─────────────────────────────────────────────
test('configVersion is "v" + item.version read from getConfigItem (not hardcoded)', async () => {
  getConfigItem.mockResolvedValue({ version: 7, data: {} });

  await handler(makeEvent());

  const updateCall = mockDynamoSend.mock.calls[0][0];
  expect(updateCall.ExpressionAttributeValues[':cv']).toBe('v7');
});

// ── Test 3: ConditionExpression ───────────────────────────────────────────────
test('UpdateItem uses ConditionExpression attribute_not_exists(configVersion)', async () => {
  await handler(makeEvent());

  const updateCall = mockDynamoSend.mock.calls[0][0];
  expect(updateCall.ConditionExpression).toBe('attribute_not_exists(configVersion)');
});

// ── Test 4: idempotency ───────────────────────────────────────────────────────
test('ConditionalCheckFailedException is swallowed (idempotent for EB retries)', async () => {
  const err = new Error('Condition failed');
  err.name = 'ConditionalCheckFailedException';
  mockDynamoSend.mockRejectedValue(err);

  await expect(handler(makeEvent())).resolves.toBeUndefined();
  // EventBridge should NOT be called when idempotent path taken
  expect(mockEbSend).not.toHaveBeenCalled();
});

// ── Test 5: stages from STAGE_CONFIG ─────────────────────────────────────────
test('stages array in UpdateItem comes from STAGE_CONFIG getConfig call (not hardcoded)', async () => {
  const customStages = ['APPLICATION_REVIEW', 'TECHNICAL_INTERVIEW', 'OFFER_PREPARATION'];
  getConfig.mockResolvedValue({ enabled: customStages });

  await handler(makeEvent());

  const updateCall = mockDynamoSend.mock.calls[0][0];
  expect(updateCall.ExpressionAttributeValues[':stages']).toEqual(customStages);
});

// ── Test 6: WorkflowStarted source ───────────────────────────────────────────
test('WorkflowStarted event uses source = "talent-flow.workflow"', async () => {
  await handler(makeEvent());

  const ebCall = mockEbSend.mock.calls[0][0];
  expect(ebCall.Entries[0].Source).toBe('talent-flow.workflow');
});

// ── Test 7: WorkflowStarted DetailType ───────────────────────────────────────
test('WorkflowStarted event uses DetailType = "WorkflowStarted"', async () => {
  await handler(makeEvent());

  const ebCall = mockEbSend.mock.calls[0][0];
  expect(ebCall.Entries[0].DetailType).toBe('WorkflowStarted');
});

// ── Test 8: WorkflowStarted detail payload ────────────────────────────────────
test('WorkflowStarted detail includes candidateId, tenantId, configVersion, stages', async () => {
  getConfigItem.mockResolvedValue({ version: 3, data: {} });
  getConfig.mockResolvedValue({ enabled: ['APPLICATION_REVIEW', 'PHONE_SCREENING'] });

  await handler(makeEvent({ candidateId: 'CAND-ABC', tenantId: 'T1', positionLevel: 'MID' }));

  const ebCall = mockEbSend.mock.calls[0][0];
  const detail = JSON.parse(ebCall.Entries[0].Detail);
  expect(detail.candidateId).toBe('CAND-ABC');
  expect(detail.tenantId).toBe('T1');
  expect(detail.configVersion).toBe('v3');
  expect(detail.stages).toEqual(['APPLICATION_REVIEW', 'PHONE_SCREENING']);
});

// ── Test 9: EventBridge failure is non-fatal ──────────────────────────────────
test('EventBridge PutEvents failure is non-fatal — handler still resolves', async () => {
  mockEbSend.mockRejectedValue(new Error('EventBridge timeout'));

  await expect(handler(makeEvent())).resolves.toBeUndefined();
  // UpdateItem should still have been called
  expect(mockDynamoSend).toHaveBeenCalledTimes(1);
});

// ── Test 10: DynamoDB error re-throws ─────────────────────────────────────────
test('non-ConditionalCheck DynamoDB error is re-thrown (triggers EB retry)', async () => {
  const err = new Error('ProvisionedThroughputExceededException');
  err.name = 'ProvisionedThroughputExceededException';
  mockDynamoSend.mockRejectedValue(err);

  await expect(handler(makeEvent())).rejects.toThrow('ProvisionedThroughputExceededException');
});

// ── Test 11: missing candidateId ─────────────────────────────────────────────
test('throws if candidateId is missing from event.detail', async () => {
  await expect(handler({ detail: { tenantId: 'DEFAULT', positionLevel: 'MID' } }))
    .rejects.toThrow('Missing required fields');
});

// ── Test 12: missing tenantId ─────────────────────────────────────────────────
test('throws if tenantId is missing from event.detail', async () => {
  await expect(handler({ detail: { candidateId: 'CAND-001', positionLevel: 'MID' } }))
    .rejects.toThrow('Missing required fields');
});
