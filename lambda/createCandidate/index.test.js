'use strict';

/**
 * lambda/createCandidate/index.test.js
 *
 * REC-15 step B: the handler is a thin door. The add itself (body rules, the role, the key, the row, the event) lives in
 * shared/recruitment-actions/add-candidate.mjs and is checked in full by the locked acceptance tests (rec-15b.spec.ts)
 * against a fake AWS. Here: who may reach it, where the company comes from, what it is handed, and what a crash says.
 */

process.env.STATE_TABLE_NAME       = 'talent-flow-state';
process.env.IDEMPOTENCY_TABLE_NAME = 'talent-flow-idempotency-keys';
process.env.EVENTBRIDGE_BUS_NAME   = 'talent-flow-bus';
process.env.ROLES_TABLE_NAME       = 'talent-flow-roles';

const mockAdd = jest.fn();

// MOD-01: the module switch is the shared helper's job (tested in shared/modules.test.mjs); here Recruitment is on.
jest.unstable_mockModule('../shared/modules.mjs', () => ({
  MODULE_KEYS: ['onboarding', 'recruitment'],
  modulesOf: async () => ['onboarding', 'recruitment'],
  requireModule: async () => null,
}));
jest.unstable_mockModule('../shared/recruitment-settings.mjs', () => ({ activeVersions: async () => ({}) }));
jest.unstable_mockModule('../shared/recruitment-actions/add-candidate.mjs', () => ({ addCandidate: (...a) => mockAdd(...a) }));

const TEN = 'ten_0123456789abcdefghijklmnop';
// REC-01: a Recruiter is HR with the Recruitment tick; the role check comes before anything else.
const RECRUITER = { tenant_id: TEN, sub: 'user-1', 'cognito:groups': '[hr_staff perm-recruitment]' };

function makeEvent(body = {}, claims = RECRUITER, headers = {}) {
  return {
    httpMethod: 'POST',
    path: '/candidates',
    headers,
    requestContext: { authorizer: { jwt: { claims } } },
    body: JSON.stringify(body),
  };
}

describe('createCandidate', () => {
  let handler;

  beforeEach(() => {
    mockAdd.mockReset();
    jest.isolateModules(() => {
      ({ handler } = require('./index'));
    });
  });

  test('a token without a company is refused with 403 and the add never runs', async () => {
    const res = await handler(makeEvent({}, { sub: 'user-1', 'cognito:groups': '[hr_staff perm-recruitment]' }));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden' });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('REC-01: a caller who is not a Recruiter gets 403 and the add never runs', async () => {
    for (const groups of ['[hr_staff]', '[perm-recruitment]', '[admin]', '[manager]', '[employee]', '[guest]', undefined]) {
      const res = await handler(makeEvent({}, { tenant_id: TEN, sub: 'user-1', ...(groups ? { 'cognito:groups': groups } : {}) }));
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden' });
    }
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('the company comes from the token only; the body is handed over untouched, with the Idempotency-Key header', async () => {
    mockAdd.mockImplementationOnce(async () => ({ statusCode: 201, headers: {}, body: '{}' }));
    const body = { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', role_id: 'r1', tenantId: 'ten_zzzzzzzzzzzzzzzzzzzzzzzzzz' };
    const res = await handler(makeEvent(body, RECRUITER, { 'Idempotency-Key': 'key-1' }));
    expect(res.statusCode).toBe(201);
    const [ctx, input] = mockAdd.mock.calls[0];
    expect(ctx.tenantId).toBe(TEN);
    expect(input.body).toEqual(body);
    expect(input.headerKey).toBe('key-1');
  });

  test('a body that is not JSON is handed over as undefined (the add answers 400)', async () => {
    mockAdd.mockImplementationOnce(async () => ({ statusCode: 400, headers: {}, body: '{}' }));
    const event = makeEvent({});
    event.body = '{not json';
    await handler(event);
    expect(mockAdd.mock.calls[0][1].body).toBeUndefined();
  });

  test('a crash is a 500 that says nothing more, and the log carries the error name only', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('secret jane@example.com');
    err.name = 'ProvisionedThroughputExceededException';
    mockAdd.mockRejectedValueOnce(err);
    const res = await handler(makeEvent({}));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'Something went wrong' });
    expect(JSON.stringify(spy.mock.calls)).toContain('ProvisionedThroughputExceededException');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('jane@example.com');
    spy.mockRestore();
  });
});
