/**
 * AI-004 (NH-130): talentFlowApproveAction unit tests
 * ESM — Lesson 12 pattern (jest.unstable_mockModule, mockReset, fake timers)
 */

import { jest, describe, test, expect, beforeAll, beforeEach } from '@jest/globals';

// ─── Shared mock function ─────────────────────────────────────────────────────

const mockDbSend = jest.fn();
const mockEbSend = jest.fn();

// ─── Module mocks (must be declared before dynamic import) ────────────────────

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient:    jest.fn(() => ({ send: mockDbSend })),
  GetItemCommand:    jest.fn((args) => ({ _type: 'Get',    ...args })),
  UpdateItemCommand: jest.fn((args) => ({ _type: 'Update', ...args })),
}));

jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockEbSend })),
  PutEventsCommand:  jest.fn((args) => ({ _type: 'PutEvents', ...args })),
}));

// Identity marshalling so we can use plain JS objects in tests
jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
  marshall:   jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj),
}));

let handler;

beforeAll(async () => {
  ({ handler } = await import('./index.mjs'));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PENDING_ACTION = {
  actionId: 'action-001',
  toolName: 'schedule_interview',
  toolArgs: { candidateId: 'c-42', interviewerIds: ['i-1'] },
  staffId: 'staff-requester',
  status: 'PENDING_APPROVAL',
  createdAt: '2026-05-17T10:00:00.000Z',
};

function makeEvent({ method, path, body = {}, staffId = null } = {}) {
  return {
    requestContext: {
      http: { method },
      ...(staffId ? { authorizer: { lambda: { staffId } } } : {}),
    },
    rawPath: path,
    body: Object.keys(body).length ? JSON.stringify(body) : null,
  };
}

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  mockDbSend.mockReset();
  mockEbSend.mockReset();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('talentFlowApproveAction', () => {

  // ── GET ─────────────────────────────────────────────────────────────────────

  test('GET /actions/{id} returns 200 with action data', async () => {
    mockDbSend.mockResolvedValueOnce({ Item: { ...PENDING_ACTION } });

    const res = await handler(makeEvent({ method: 'GET', path: '/agent/actions/action-001' }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.actionId).toBe('action-001');
    expect(body.status).toBe('PENDING_APPROVAL');
  });

  test('GET /actions/{id} returns 404 when action not found', async () => {
    mockDbSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent({ method: 'GET', path: '/agent/actions/no-such' }));

    expect(res.statusCode).toBe(404);
  });

  // ── POST /approve ────────────────────────────────────────────────────────────

  test('POST /approve returns 200 and dispatches EventBridge event', async () => {
    mockDbSend
      .mockResolvedValueOnce({ Item: { ...PENDING_ACTION } })    // GetItem
      .mockResolvedValueOnce({});                                  // UpdateItem APPROVED
    mockEbSend.mockResolvedValueOnce({ FailedEntryCount: 0 });

    const res = await handler(makeEvent({
      method: 'POST',
      path: '/agent/actions/action-001/approve',
      staffId: 'staff-approver',
    }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('APPROVED');
    expect(body.actionId).toBe('action-001');
    // EventBridge must have been called once
    expect(mockEbSend).toHaveBeenCalledTimes(1);
  });

  test('POST /approve returns 404 when action not found', async () => {
    mockDbSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent({
      method: 'POST',
      path: '/agent/actions/missing/approve',
      staffId: 'staff-approver',
    }));

    expect(res.statusCode).toBe(404);
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  test('POST /approve returns 409 when action is not PENDING_APPROVAL', async () => {
    mockDbSend.mockResolvedValueOnce({ Item: { ...PENDING_ACTION, status: 'APPROVED' } });

    const res = await handler(makeEvent({
      method: 'POST',
      path: '/agent/actions/action-001/approve',
      staffId: 'staff-approver',
    }));

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/already APPROVED/);
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  test('POST /approve returns 403 for self-approval', async () => {
    mockDbSend.mockResolvedValueOnce({ Item: { ...PENDING_ACTION } });

    const res = await handler(makeEvent({
      method: 'POST',
      path: '/agent/actions/action-001/approve',
      staffId: 'staff-requester',   // same as action.staffId
    }));

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/Self-approval/);
    expect(mockDbSend).toHaveBeenCalledTimes(1); // GetItem only — no UpdateItem
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  test('POST /approve returns 409 on ConditionalCheckFailedException race', async () => {
    const raceErr = Object.assign(new Error('race'), { name: 'ConditionalCheckFailedException' });
    mockDbSend
      .mockResolvedValueOnce({ Item: { ...PENDING_ACTION } })   // GetItem
      .mockRejectedValueOnce(raceErr);                           // UpdateItem race

    const res = await handler(makeEvent({
      method: 'POST',
      path: '/agent/actions/action-001/approve',
      staffId: 'staff-approver',
    }));

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/already been processed/);
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  test('POST /approve returns 200 even when EventBridge dispatch fails', async () => {
    mockDbSend
      .mockResolvedValueOnce({ Item: { ...PENDING_ACTION } })    // GetItem
      .mockResolvedValueOnce({});                                  // UpdateItem OK
    mockEbSend.mockRejectedValueOnce(new Error('EventBridge unavailable'));

    const res = await handler(makeEvent({
      method: 'POST',
      path: '/agent/actions/action-001/approve',
      staffId: 'staff-approver',
    }));

    // Status saved as APPROVED in DDB; EventBridge failure is non-fatal
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('APPROVED');
  });

  // ── POST /reject ─────────────────────────────────────────────────────────────

  test('POST /reject returns 200 and does NOT dispatch EventBridge', async () => {
    mockDbSend
      .mockResolvedValueOnce({ Item: { ...PENDING_ACTION } })    // GetItem
      .mockResolvedValueOnce({});                                  // UpdateItem REJECTED

    const res = await handler(makeEvent({
      method: 'POST',
      path: '/agent/actions/action-001/reject',
      staffId: 'staff-approver',
      body: { reason: 'Insufficient supporting data' },
    }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('REJECTED');
    expect(body.actionId).toBe('action-001');
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  test('POST /reject returns 404 when action not found', async () => {
    mockDbSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent({
      method: 'POST',
      path: '/agent/actions/missing/reject',
      staffId: 'staff-approver',
    }));

    expect(res.statusCode).toBe(404);
  });

  test('POST /reject returns 409 when action already processed', async () => {
    mockDbSend.mockResolvedValueOnce({ Item: { ...PENDING_ACTION, status: 'REJECTED' } });

    const res = await handler(makeEvent({
      method: 'POST',
      path: '/agent/actions/action-001/reject',
      staffId: 'staff-approver',
    }));

    expect(res.statusCode).toBe(409);
  });

  // ── Edge cases ───────────────────────────────────────────────────────────────

  test('returns 400 for invalid path', async () => {
    const res = await handler({ requestContext: { http: { method: 'GET' } }, rawPath: '/agent/invalid' });
    expect(res.statusCode).toBe(400);
  });

  test('returns 405 for unsupported method', async () => {
    mockDbSend.mockResolvedValueOnce({ Item: { ...PENDING_ACTION } });
    const res = await handler(makeEvent({ method: 'DELETE', path: '/agent/actions/action-001' }));
    expect(res.statusCode).toBe(405);
  });
});
