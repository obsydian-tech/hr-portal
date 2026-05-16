'use strict';

/**
 * lambda/manageTalentFlowConfig/index.test.js
 *
 * Tests covering NH-120 checklist:
 *  GET:
 *   1. Returns all versions when ?active not set
 *   2. Returns active item only when ?active=true
 *   3. 404 when no active item found on ?active=true
 *   4. 400 when configType query param missing
 *  POST:
 *   5. Creates v1, returns 201 with version=1
 *   6. 403 when non-admin calls POST
 *   7. 400 when configType missing from POST body
 *   8. 409 when active version already exists
 *  PUT:
 *   9. Writes new version N+1 (PutItem) AND deactivates old version (UpdateItem with TTL)
 *  10. 403 when non-admin calls PUT
 *  11. 404 when no active version exists for PUT
 *  12. 400 when data missing from PUT body
 *  13. Old version is never deleted — only UpdateItem (TTL + isActive=false)
 *  14. Unknown HTTP method returns 405
 */

process.env.CONFIG_TABLE_NAME = 'talent-flow-config';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  QueryCommand:       jest.fn(p => ({ _cmd: 'Query',      ...p })),
  PutItemCommand:     jest.fn(p => ({ _cmd: 'PutItem',    ...p })),
  UpdateItemCommand:  jest.fn(p => ({ _cmd: 'UpdateItem', ...p }))
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall:   jest.fn(obj => obj),
  unmarshall: jest.fn(obj => obj)
}));

const { handler } = require('./index');

beforeEach(() => mockSend.mockReset());

// ── Helpers ───────────────────────────────────────────────────────────────────

function adminEvent(method, extra = {}) {
  return {
    requestContext: {
      http: { method },
      authorizer: { jwt: { claims: { 'custom:isAdmin': 'true' } } }
    },
    ...extra
  };
}

function nonAdminEvent(method, extra = {}) {
  return {
    requestContext: {
      http: { method },
      authorizer: { jwt: { claims: { 'custom:isAdmin': 'false' } } }
    },
    ...extra
  };
}

const activeItem = {
  PK: 'TENANT#DEFAULT', SK: 'CONFIG#SCORING_WEIGHTS#v2',
  GSI1PK: 'TENANT#DEFAULT#ACTIVE', GSI1SK: 'CONFIG#SCORING_WEIGHTS',
  tenantId: 'DEFAULT', configType: 'SCORING_WEIGHTS', version: 2, isActive: true,
  data: { technical: 30 }
};

// ── GET tests ─────────────────────────────────────────────────────────────────

test('GET: returns all versions when ?active not set', async () => {
  const items = [
    { ...activeItem, version: 1, isActive: false },
    { ...activeItem, version: 2, isActive: true }
  ];
  mockSend.mockResolvedValueOnce({ Items: items });

  const event = adminEvent('GET', { queryStringParameters: { configType: 'SCORING_WEIGHTS' } });
  const res = await handler(event);

  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.count).toBe(2);
  expect(body.items).toHaveLength(2);
});

test('GET: returns active item only when ?active=true', async () => {
  mockSend.mockResolvedValueOnce({ Items: [activeItem] });

  const event = adminEvent('GET', { queryStringParameters: { configType: 'SCORING_WEIGHTS', active: 'true' } });
  const res = await handler(event);

  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.version).toBe(2);
});

test('GET: 404 when no active item found', async () => {
  mockSend.mockResolvedValueOnce({ Items: [] });

  const event = adminEvent('GET', { queryStringParameters: { configType: 'SCORING_WEIGHTS', active: 'true' } });
  const res = await handler(event);

  expect(res.statusCode).toBe(404);
});

test('GET: 400 when configType query param missing', async () => {
  const event = adminEvent('GET', { queryStringParameters: {} });
  const res = await handler(event);

  expect(res.statusCode).toBe(400);
  expect(JSON.parse(res.body).error).toMatch(/configType/);
});

// ── POST tests ────────────────────────────────────────────────────────────────

test('POST: creates v1, returns 201 with version=1', async () => {
  // getActiveItem → no existing active version
  mockSend.mockResolvedValueOnce({ Items: [] });
  // PutItem → success
  mockSend.mockResolvedValueOnce({});

  const event = adminEvent('POST', {
    body: JSON.stringify({ tenantId: 'DEFAULT', configType: 'SCORING_WEIGHTS', data: { technical: 30 } })
  });
  const res = await handler(event);

  expect(res.statusCode).toBe(201);
  const body = JSON.parse(res.body);
  expect(body.version).toBe(1);
  expect(mockSend).toHaveBeenCalledTimes(2);
});

test('POST: 403 when non-admin', async () => {
  const event = nonAdminEvent('POST', {
    body: JSON.stringify({ configType: 'SCORING_WEIGHTS', data: {} })
  });
  const res = await handler(event);

  expect(res.statusCode).toBe(403);
  // DynamoDB should NOT be called — guard must fire before any DB operation
  expect(mockSend).not.toHaveBeenCalled();
});

test('POST: 400 when configType missing', async () => {
  const event = adminEvent('POST', { body: JSON.stringify({ data: {} }) });
  const res = await handler(event);

  expect(res.statusCode).toBe(400);
  expect(mockSend).not.toHaveBeenCalled();
});

test('POST: 409 when active version already exists', async () => {
  mockSend.mockResolvedValueOnce({ Items: [activeItem] });

  const event = adminEvent('POST', {
    body: JSON.stringify({ configType: 'SCORING_WEIGHTS', data: { technical: 30 } })
  });
  const res = await handler(event);

  expect(res.statusCode).toBe(409);
  // Should only have made the getActiveItem Query — no PutItem
  expect(mockSend).toHaveBeenCalledTimes(1);
});

// ── PUT tests ─────────────────────────────────────────────────────────────────

test('PUT: writes N+1 via PutItem AND deactivates N via UpdateItem', async () => {
  // getActiveItem → returns version 2
  mockSend.mockResolvedValueOnce({ Items: [activeItem] });
  // PutItem new version
  mockSend.mockResolvedValueOnce({});
  // UpdateItem old version
  mockSend.mockResolvedValueOnce({});

  const event = adminEvent('PUT', {
    body: JSON.stringify({ configType: 'SCORING_WEIGHTS', data: { technical: 40 } })
  });
  const res = await handler(event);

  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.version).toBe(3);
  expect(body.previousVersion).toBe(2);
  expect(mockSend).toHaveBeenCalledTimes(3); // Query + PutItem + UpdateItem
});

test('PUT: 403 when non-admin', async () => {
  const event = nonAdminEvent('PUT', {
    body: JSON.stringify({ configType: 'SCORING_WEIGHTS', data: {} })
  });
  const res = await handler(event);

  expect(res.statusCode).toBe(403);
  expect(mockSend).not.toHaveBeenCalled();
});

test('PUT: 404 when no active version exists', async () => {
  mockSend.mockResolvedValueOnce({ Items: [] });

  const event = adminEvent('PUT', {
    body: JSON.stringify({ configType: 'SCORING_WEIGHTS', data: { technical: 40 } })
  });
  const res = await handler(event);

  expect(res.statusCode).toBe(404);
  expect(mockSend).toHaveBeenCalledTimes(1); // only the getActiveItem Query
});

test('PUT: 400 when data missing', async () => {
  const event = adminEvent('PUT', { body: JSON.stringify({ configType: 'SCORING_WEIGHTS' }) });
  const res = await handler(event);

  expect(res.statusCode).toBe(400);
  expect(mockSend).not.toHaveBeenCalled();
});

test('PUT: old version UpdateItem sets expiresAt TTL and isActive=false — never deletes', async () => {
  mockSend.mockResolvedValueOnce({ Items: [activeItem] });
  mockSend.mockResolvedValueOnce({});
  mockSend.mockResolvedValueOnce({});

  const event = adminEvent('PUT', {
    body: JSON.stringify({ configType: 'SCORING_WEIGHTS', data: { technical: 40 } })
  });
  await handler(event);

  // Third call (index 2) is the UpdateItem for the old version
  const updateCall = mockSend.mock.calls[2][0];
  expect(updateCall._cmd).toBe('UpdateItem');
  expect(updateCall.UpdateExpression).toContain('expiresAt');
  expect(updateCall.UpdateExpression).toContain('isActive');
  expect(updateCall.UpdateExpression).toContain('REMOVE GSI1PK');
  // Verify expiresAt is a future epoch (roughly 365 days from now)
  const ttl = updateCall.ExpressionAttributeValues[':ttl'];
  const nowS = Math.floor(Date.now() / 1000);
  expect(ttl).toBeGreaterThan(nowS + 364 * 24 * 3600);
  expect(ttl).toBeLessThan(nowS + 366 * 24 * 3600);
});

// ── Method routing ────────────────────────────────────────────────────────────

test('unknown HTTP method returns 405', async () => {
  const event = adminEvent('DELETE', {});
  const res = await handler(event);

  expect(res.statusCode).toBe(405);
});
