'use strict';

/**
 * lambda/shared/config-reader.test.js
 *
 * Unit tests for config-reader.js covering the 5 checklist items from NH-117:
 *   1. Versioned read returns correct item when version found
 *   2. Active read returns correct item via GSI1 query
 *   3. Missing item returns defaults + logs warning
 *   4. Second call within 5 min uses cache (no DynamoDB call)
 *   5. Call after 5 min re-queries DynamoDB
 */

process.env.CONFIG_TABLE_NAME = 'talent-flow-config';

// mockSend is prefixed with 'mock' so Jest allows it in the factory despite hoisting
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  GetItemCommand: jest.fn(params => ({ _cmd: 'GetItem', ...params })),
  QueryCommand: jest.fn(params => ({ _cmd: 'Query', ...params })),
}));

// Identity functions — test data can be plain JS objects
jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn(obj => obj),
  unmarshall: jest.fn(obj => obj),
}));

// Reset the shared mockSend call-counter before every test
beforeEach(() => {
  mockSend.mockReset();
});

// ─── Test 1 & 2 & 3: fresh module instance each time (empty cache) ───────────
// Tests that need isolation from each other use jest.isolateModules to get a
// fresh in-memory Map per test.

describe('versioned read', () => {
  test('returns .data attribute from DynamoDB item when version found', async () => {
    const payload = { technical: 40, communication: 20, culturalFit: 25, problemSolving: 15 };
    mockSend.mockResolvedValueOnce({
      Item: { PK: 'TENANT#DEFAULT', SK: 'CONFIG#SCORING_WEIGHTS#v3', data: payload }
    });

    let getConfig;
    jest.isolateModules(() => {
      ({ getConfig } = require('./config-reader'));
    });

    const result = await getConfig('DEFAULT', 'SCORING_WEIGHTS', 'v3');
    expect(result).toEqual(payload);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe('active read', () => {
  test('returns .data attribute from GSI1 query result when active item found', async () => {
    const payload = { APPLICATION_REVIEW: 24, PHONE_SCREENING: 48 };
    mockSend.mockResolvedValueOnce({
      Items: [{ GSI1PK: 'TENANT#DEFAULT#ACTIVE', GSI1SK: 'CONFIG#SLA_THRESHOLDS', data: payload }]
    });

    let getConfig;
    jest.isolateModules(() => {
      ({ getConfig } = require('./config-reader'));
    });

    const result = await getConfig('DEFAULT', 'SLA_THRESHOLDS');
    expect(result).toEqual(payload);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe('defaults fallback', () => {
  test('returns safe defaults and logs a warning when DynamoDB returns no item', async () => {
    // Versioned GetItem returns no Item; active Query returns empty Items
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    let getConfig;
    jest.isolateModules(() => {
      ({ getConfig } = require('./config-reader'));
    });

    const result = await getConfig('DEFAULT', 'SCORING_WEIGHTS', 'v99');

    expect(result).toEqual({
      technical: 30,
      communication: 25,
      culturalFit: 25,
      problemSolving: 20
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('SCORING_WEIGHTS')
    );

    warnSpy.mockRestore();
  });

  test('returns empty object {} for unknown configType default', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    let getConfig;
    jest.isolateModules(() => {
      ({ getConfig } = require('./config-reader'));
    });

    const result = await getConfig('DEFAULT', 'UNKNOWN_TYPE', 'v1');
    expect(result).toEqual({});

    warnSpy.mockRestore();
  });
});

describe('caching behaviour', () => {
  let getConfig;
  const REAL_NOW = Date.now;

  beforeEach(() => {
    mockSend.mockReset();
    // Fresh module = empty in-memory cache
    jest.isolateModules(() => {
      ({ getConfig } = require('./config-reader'));
    });
  });

  afterEach(() => {
    // Restore Date.now in case a test replaced it
    Date.now = REAL_NOW;
  });

  test('second call within 5 min returns cache — no additional DynamoDB call', async () => {
    const payload = { minimumPassScore: 6.0 };
    mockSend.mockResolvedValue({
      Item: { PK: 'TENANT#T1', SK: 'CONFIG#APPROVAL_RULES#v1', data: payload }
    });

    const first = await getConfig('T1', 'APPROVAL_RULES', 'v1');
    const second = await getConfig('T1', 'APPROVAL_RULES', 'v1');

    expect(first).toEqual(payload);
    expect(second).toEqual(payload);
    // DynamoDB must only have been called ONCE despite two getConfig calls
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('call after 5-min TTL re-queries DynamoDB', async () => {
    const payload = { minimumPassScore: 7.5 };
    mockSend.mockResolvedValue({
      Item: { PK: 'TENANT#T2', SK: 'CONFIG#APPROVAL_RULES#v2', data: payload }
    });

    const t0 = 1_000_000;
    // First call at t0 — populates cache
    Date.now = jest.fn(() => t0);
    await getConfig('T2', 'APPROVAL_RULES', 'v2');
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Second call still within TTL — cache hit
    Date.now = jest.fn(() => t0 + 4 * 60 * 1000); // +4 min
    await getConfig('T2', 'APPROVAL_RULES', 'v2');
    expect(mockSend).toHaveBeenCalledTimes(1); // still 1

    // Third call past TTL — cache miss, DynamoDB hit
    Date.now = jest.fn(() => t0 + 6 * 60 * 1000); // +6 min
    await getConfig('T2', 'APPROVAL_RULES', 'v2');
    expect(mockSend).toHaveBeenCalledTimes(2); // now 2
  });
});

describe('error handling', () => {
  test('DynamoDB errors return defaults and do NOT cache the error', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockSend
      .mockRejectedValueOnce(new Error('ResourceNotFoundException'))
      .mockResolvedValueOnce({
        Item: { PK: 'TENANT#T3', SK: 'CONFIG#PANEL_CONFIG#v1', data: { rules: { strongNoVeto: false } } }
      });

    let getConfig;
    jest.isolateModules(() => {
      ({ getConfig } = require('./config-reader'));
    });

    // First call — DynamoDB throws, should return defaults
    const first = await getConfig('T3', 'PANEL_CONFIG', 'v1');
    expect(first).toEqual({
      rules: { strongNoVeto: true, votesRequired: { JUNIOR: 2, MID: 3, SENIOR: 4, DIRECTOR: 5 } }
    });

    // Second call — DynamoDB succeeds this time (error was NOT cached)
    const second = await getConfig('T3', 'PANEL_CONFIG', 'v1');
    expect(second).toEqual({ rules: { strongNoVeto: false } });

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// ─── getConfigItem tests ─────────────────────────────────────────────────────

describe('getConfigItem', () => {
  test('returns full item including version when active item found in GSI1', async () => {
    const fullItem = {
      PK: 'TENANT#DEFAULT',
      SK: 'CONFIG#SCORING_WEIGHTS#v3',
      GSI1PK: 'TENANT#DEFAULT#ACTIVE',
      GSI1SK: 'CONFIG#SCORING_WEIGHTS',
      version: 3,
      data: { technical: 30, communication: 25, culturalFit: 25, problemSolving: 20 }
    };
    mockSend.mockResolvedValueOnce({ Items: [fullItem] });

    let getConfigItem;
    jest.isolateModules(() => {
      ({ getConfigItem } = require('./config-reader'));
    });

    const result = await getConfigItem('DEFAULT', 'SCORING_WEIGHTS');
    expect(result).toEqual(fullItem);
    expect(result.version).toBe(3);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('returns { version: 0, data: defaults } and warns when no active item found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    let getConfigItem;
    jest.isolateModules(() => {
      ({ getConfigItem } = require('./config-reader'));
    });

    const result = await getConfigItem('DEFAULT', 'SCORING_WEIGHTS');
    expect(result.version).toBe(0);
    expect(result.data).toMatchObject({ technical: expect.any(Number) });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('version=0'));

    warnSpy.mockRestore();
  });
});
