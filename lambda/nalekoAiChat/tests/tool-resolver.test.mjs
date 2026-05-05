/**
 * NH-52: Unit tests for tool-resolver.mjs
 *
 * Test coverage:
 *  1. URL construction — all 6 read tools build the correct URL
 *  2. staff_id scoping (NH-53) — list_employees & query_audit_log always include staffId
 *  3. HITL gate — onboard_new_employee never calls agentPost / agentGet
 *  4. Unknown tool — resolveToolCall throws a descriptive error
 *  5. agentPost called for assess_employee_risk (not agentGet)
 */

import { jest } from '@jest/globals';

// ─── Mock Secrets Manager ────────────────────────────────────────────────────
jest.unstable_mockModule('@aws-sdk/client-secrets-manager', () => {
  const GetSecretValueCommand = jest.fn().mockImplementation((args) => args);
  const SecretsManagerClient  = jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ SecretString: 'test-api-key-123' }),
  }));
  return { SecretsManagerClient, GetSecretValueCommand };
});

// ─── Mock fetch ───────────────────────────────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch;

function mockOkJson(payload) {
  mockFetch.mockResolvedValueOnce({
    ok:   true,
    json: async () => payload,
  });
}

// ─── Import module under test (AFTER mocks) ──────────────────────────────────
const { resolveToolCall, TOOL_MAP, agentGet, agentPost } = await import('../tool-resolver.mjs');

// ─── Constants ────────────────────────────────────────────────────────────────
const CONTEXT = { staffId: 'AS00004' };
const BASE    = 'https://fou21cj8tj.execute-api.af-south-1.amazonaws.com';

beforeEach(() => {
  mockFetch.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. URL construction
// ─────────────────────────────────────────────────────────────────────────────

describe('URL construction', () => {
  test('list_employees — with limit, always includes created_by', async () => {
    mockOkJson([]);
    await resolveToolCall('list_employees', { limit: 10 }, CONTEXT);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/employees?limit=10&created_by=AS00004`);
  });

  test('list_employees — no limit defaults to 20', async () => {
    mockOkJson([]);
    await resolveToolCall('list_employees', {}, CONTEXT);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/employees?limit=20&created_by=AS00004`);
  });

  test('get_employee — builds correct path', async () => {
    mockOkJson({ id: 'EMP-0000012' });
    await resolveToolCall('get_employee', { id: 'EMP-0000012' }, CONTEXT);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/employees/EMP-0000012`);
  });

  test('list_verifications — with status and limit', async () => {
    mockOkJson([]);
    await resolveToolCall('list_verifications', { status: 'FAILED', limit: 20 }, CONTEXT);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/verifications?status=FAILED&limit=20`);
  });

  test('list_verifications — no args produces empty qs', async () => {
    mockOkJson([]);
    await resolveToolCall('list_verifications', {}, CONTEXT);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/verifications`);
  });

  test('get_verification_summary — builds correct path', async () => {
    mockOkJson({ summary: 'ok' });
    await resolveToolCall('get_verification_summary', { id: 'VER-001' }, CONTEXT);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/verifications/VER-001/summary`);
  });

  test('query_audit_log — includes employeeId and staffId', async () => {
    mockOkJson([]);
    await resolveToolCall('query_audit_log', { employeeId: 'EMP-0000012' }, CONTEXT);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/audit-log?employeeId=EMP-0000012&staffId=AS00004`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. staff_id scoping (NH-53)
// ─────────────────────────────────────────────────────────────────────────────

describe('NH-53: staff_id scoping', () => {
  test('list_employees URL always contains created_by from context, not from args', async () => {
    mockOkJson([]);
    // Simulate Claude trying to inject a different staffId via args — must be ignored
    await resolveToolCall('list_employees', { limit: 5, created_by: 'EVIL-INJECT' }, CONTEXT);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('created_by=AS00004');
    expect(url).not.toContain('EVIL-INJECT');
  });

  test('query_audit_log URL always contains staffId from context', async () => {
    mockOkJson([]);
    await resolveToolCall('query_audit_log', { employeeId: 'EMP-X' }, { staffId: 'HR-CLERK-99' });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('staffId=HR-CLERK-99');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. HITL gate
// ─────────────────────────────────────────────────────────────────────────────

describe('HITL gate: onboard_new_employee', () => {
  test('returns hitl: true', async () => {
    const result = await resolveToolCall('onboard_new_employee', {
      firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com',
      department: 'Engineering', role: 'Engineer',
    }, CONTEXT);
    expect(result.hitl).toBe(true);
  });

  test('returns draft with submitted fields', async () => {
    const result = await resolveToolCall('onboard_new_employee', {
      firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com',
      department: 'Engineering', role: 'Engineer', phoneNumber: '+27821234567',
    }, CONTEXT);
    expect(result.draft).toMatchObject({
      firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com',
      department: 'Engineering', role: 'Engineer', phoneNumber: '+27821234567',
    });
  });

  test('NEVER calls fetch (agentPost / agentGet not invoked)', async () => {
    await resolveToolCall('onboard_new_employee', {
      firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com',
      department: 'Engineering', role: 'Engineer',
    }, CONTEXT);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('phoneNumber defaults to null when not provided', async () => {
    const result = await resolveToolCall('onboard_new_employee', {
      firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com',
      department: 'Engineering', role: 'Engineer',
    }, CONTEXT);
    expect(result.draft.phoneNumber).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Unknown tool
// ─────────────────────────────────────────────────────────────────────────────

describe('Unknown tool', () => {
  test('throws descriptive error', async () => {
    await expect(
      resolveToolCall('delete_all_employees', {}, CONTEXT)
    ).rejects.toThrow(/Unknown tool: "delete_all_employees"/);
  });

  test('error message lists valid tools', async () => {
    await expect(
      resolveToolCall('hack_the_planet', {}, CONTEXT)
    ).rejects.toThrow(/list_employees/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. assess_employee_risk uses POST
// ─────────────────────────────────────────────────────────────────────────────

describe('HTTP method correctness', () => {
  test('assess_employee_risk uses POST', async () => {
    mockOkJson({ riskBand: 'LOW' });
    await resolveToolCall('assess_employee_risk', { id: 'EMP-0000012' }, CONTEXT);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/employees/EMP-0000012/assess-risk`);
    expect(opts.method).toBe('POST');
  });

  test('list_employees uses GET', async () => {
    mockOkJson([]);
    await resolveToolCall('list_employees', {}, CONTEXT);
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe('GET');
  });

  test('all calls include x-api-key header', async () => {
    mockOkJson([]);
    await resolveToolCall('list_employees', {}, CONTEXT);
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers?.['x-api-key']).toBe('test-api-key-123');
  });
});
