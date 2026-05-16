'use strict';

/**
 * sendTalentFlowNotification — test suite
 *
 * Invariants verified:
 *   1. Config-driven template alias: config[type] used when present
 *   2. Fallback alias: 'talent-flow-{type-kebab}' when type not in config
 *   3. Partial batch failure: record that throws is added to batchItemFailures, others continue
 *   4. Missing required fields (tenantId, recipientEmail, type) → batchItemFailures
 *   5. getConfig failure → batchItemFailures for that record
 *   6. Postmark failure → batchItemFailures for that record; others unaffected
 *   7. sendEmailWithTemplate called with correct From, To, TemplateAlias, TemplateModel
 *   8. All records succeed → batchItemFailures = []
 */

process.env.POSTMARK_API_TOKEN    = 'test-postmark-token';
process.env.POSTMARK_SENDER_EMAIL = 'ignecious@obsydiantechnologies.com';
process.env.CONFIG_TABLE_NAME     = 'talent-flow-config';

// ── Mock config-reader ────────────────────────────────────────────────────────
jest.mock('../shared/config-reader', () => ({
  getConfig: jest.fn(),
}));

const { getConfig } = require('../shared/config-reader');

// ── Load handler + test helpers ────────────────────────────────────────────────
const { handler, _setPostmarkClient, _resolveTemplateAlias } = require('./index');

// ── Mock Postmark client factory ──────────────────────────────────────────────
function makeMockPostmark(overrides = {}) {
  return {
    sendEmailWithTemplate: jest.fn().mockResolvedValue({ MessageID: 'msg-001' }),
    ...overrides,
  };
}

// ── SQS record factory ────────────────────────────────────────────────────────
function makeRecord(bodyOverrides = {}, messageId = 'msg-001') {
  const body = {
    type: 'INTERVIEW_SCHEDULED',
    recipientEmail: 'panel@example.com',
    recipientId: 'pm-1',
    candidateId: 'cand-001',
    tenantId: 'DEFAULT',
    scheduledAt: '2026-05-16T10:00:00Z',
    ...bodyOverrides,
  };
  return {
    messageId,
    body: JSON.stringify(body),
  };
}

function makeEvent(records) {
  return { Records: records };
}

beforeEach(() => {
  getConfig.mockReset();
  // Default: config has entries for all supported types
  getConfig.mockResolvedValue({
    CANDIDATE_CREATED:    'talent-flow-candidate-created-v1',
    INTERVIEW_SCHEDULED:  'talent-flow-interview-scheduled-v1',
    EVALUATION_COMPLETED: 'talent-flow-evaluation-completed-v1',
    OFFER_APPROVED:       'talent-flow-offer-approved-v1',
    SLA_BREACHED:         'talent-flow-sla-breached-v1',
  });
  // Inject fresh mock Postmark client before each test
  _setPostmarkClient(makeMockPostmark());
});

// ── _resolveTemplateAlias (unit) ──────────────────────────────────────────────

describe('_resolveTemplateAlias', () => {
  test('returns config value when type is present in config', () => {
    const templates = { INTERVIEW_SCHEDULED: 'my-custom-alias-v2' };
    expect(_resolveTemplateAlias('INTERVIEW_SCHEDULED', templates)).toBe('my-custom-alias-v2');
  });

  test('fallback: CANDIDATE_CREATED → talent-flow-candidate-created', () => {
    expect(_resolveTemplateAlias('CANDIDATE_CREATED', {})).toBe('talent-flow-candidate-created');
  });

  test('fallback: INTERVIEW_SCHEDULED → talent-flow-interview-scheduled', () => {
    expect(_resolveTemplateAlias('INTERVIEW_SCHEDULED', {})).toBe('talent-flow-interview-scheduled');
  });

  test('fallback: EVALUATION_COMPLETED → talent-flow-evaluation-completed', () => {
    expect(_resolveTemplateAlias('EVALUATION_COMPLETED', {})).toBe('talent-flow-evaluation-completed');
  });

  test('fallback: OFFER_APPROVED → talent-flow-offer-approved', () => {
    expect(_resolveTemplateAlias('OFFER_APPROVED', {})).toBe('talent-flow-offer-approved');
  });

  test('fallback: SLA_BREACHED → talent-flow-sla-breached', () => {
    expect(_resolveTemplateAlias('SLA_BREACHED', {})).toBe('talent-flow-sla-breached');
  });

  test('fallback: null/undefined templates → uses fallback', () => {
    expect(_resolveTemplateAlias('INTERVIEW_SCHEDULED', null)).toBe('talent-flow-interview-scheduled');
    expect(_resolveTemplateAlias('INTERVIEW_SCHEDULED', undefined)).toBe('talent-flow-interview-scheduled');
  });
});

// ── handler: happy path ───────────────────────────────────────────────────────

describe('handler: happy path', () => {
  test('single INTERVIEW_SCHEDULED record — sendEmailWithTemplate called, batchItemFailures=[]', async () => {
    const mockClient = makeMockPostmark();
    _setPostmarkClient(mockClient);

    const result = await handler(makeEvent([makeRecord()]));

    expect(result).toEqual({ batchItemFailures: [] });
    expect(mockClient.sendEmailWithTemplate).toHaveBeenCalledTimes(1);
    expect(mockClient.sendEmailWithTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        From:          'ignecious@obsydiantechnologies.com',
        To:            'panel@example.com',
        TemplateAlias: 'talent-flow-interview-scheduled-v1',  // from config
        TemplateModel: expect.objectContaining({
          type:        'INTERVIEW_SCHEDULED',
          candidateId: 'cand-001',
          recipientId: 'pm-1',
          scheduledAt: '2026-05-16T10:00:00Z',
        }),
      })
    );
  });

  test('template resolved from config — uses config alias, not fallback', async () => {
    getConfig.mockResolvedValue({ INTERVIEW_SCHEDULED: 'acme-interview-v3' });
    const mockClient = makeMockPostmark();
    _setPostmarkClient(mockClient);

    await handler(makeEvent([makeRecord()]));

    expect(mockClient.sendEmailWithTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ TemplateAlias: 'acme-interview-v3' })
    );
  });

  test('type not in config — fallback alias used', async () => {
    getConfig.mockResolvedValue({});  // no entry for INTERVIEW_SCHEDULED
    const mockClient = makeMockPostmark();
    _setPostmarkClient(mockClient);

    await handler(makeEvent([makeRecord()]));

    expect(mockClient.sendEmailWithTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ TemplateAlias: 'talent-flow-interview-scheduled' })
    );
  });

  test('getConfig called with tenantId and EMAIL_TEMPLATES', async () => {
    await handler(makeEvent([makeRecord()]));
    expect(getConfig).toHaveBeenCalledWith('DEFAULT', 'EMAIL_TEMPLATES');
  });
});

// ── handler: validation failures ─────────────────────────────────────────────

describe('handler: missing required fields → batchItemFailures', () => {
  test('missing recipientEmail → record in batchItemFailures', async () => {
    const record = makeRecord({ recipientEmail: undefined }, 'msg-missing-email');
    const result = await handler(makeEvent([record]));
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-missing-email' }]);
  });

  test('missing tenantId → record in batchItemFailures', async () => {
    const record = makeRecord({ tenantId: undefined }, 'msg-missing-tenant');
    const result = await handler(makeEvent([record]));
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-missing-tenant' }]);
  });

  test('missing type → record in batchItemFailures', async () => {
    const record = makeRecord({ type: undefined }, 'msg-missing-type');
    const result = await handler(makeEvent([record]));
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-missing-type' }]);
  });

  test('invalid JSON body → record in batchItemFailures', async () => {
    const record = { messageId: 'msg-bad-json', body: 'not-json{{' };
    const result = await handler(makeEvent([record]));
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-bad-json' }]);
  });
});

// ── handler: error cases ──────────────────────────────────────────────────────

describe('handler: error handling', () => {
  test('Postmark throws → that record in batchItemFailures, does not affect others', async () => {
    const mockClient = {
      sendEmailWithTemplate: jest.fn()
        .mockRejectedValueOnce(new Error('Postmark 422 template not found'))  // record 1 fails
        .mockResolvedValue({ MessageID: 'msg-ok' }),                           // record 2 succeeds
    };
    _setPostmarkClient(mockClient);

    const result = await handler(makeEvent([
      makeRecord({}, 'msg-fail'),
      makeRecord({ recipientEmail: 'other@example.com' }, 'msg-ok'),
    ]));

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-fail' }]);
    expect(mockClient.sendEmailWithTemplate).toHaveBeenCalledTimes(2);
  });

  test('getConfig throws → record in batchItemFailures', async () => {
    getConfig.mockRejectedValue(new Error('DynamoDB unavailable'));

    const result = await handler(makeEvent([makeRecord({}, 'msg-config-fail')]));

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-config-fail' }]);
  });

  test('batch of 3: middle record fails → only middle in batchItemFailures', async () => {
    const mockClient = {
      sendEmailWithTemplate: jest.fn()
        .mockResolvedValueOnce({ MessageID: 'ok-1' })
        .mockRejectedValueOnce(new Error('Postmark down'))
        .mockResolvedValueOnce({ MessageID: 'ok-3' }),
    };
    _setPostmarkClient(mockClient);

    const result = await handler(makeEvent([
      makeRecord({}, 'msg-1'),
      makeRecord({ recipientEmail: 'fail@example.com' }, 'msg-2'),
      makeRecord({ recipientEmail: 'ok@example.com' }, 'msg-3'),
    ]));

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-2' }]);
    expect(mockClient.sendEmailWithTemplate).toHaveBeenCalledTimes(3);
  });

  test('all records fail → all in batchItemFailures', async () => {
    getConfig.mockRejectedValue(new Error('Config table down'));

    const result = await handler(makeEvent([
      makeRecord({}, 'msg-a'),
      makeRecord({}, 'msg-b'),
    ]));

    expect(result.batchItemFailures).toHaveLength(2);
    expect(result.batchItemFailures).toEqual(
      expect.arrayContaining([
        { itemIdentifier: 'msg-a' },
        { itemIdentifier: 'msg-b' },
      ])
    );
  });
});
