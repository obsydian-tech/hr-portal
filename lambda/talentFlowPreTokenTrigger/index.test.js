'use strict';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  QueryCommand:   jest.fn((p) => ({ _cmd: 'Query', ...p })),
}));

process.env.TENANTS_TABLE = 'naleko-people-test-tenants';
const { handler } = require('./index');

beforeEach(() => { mockSend.mockReset(); mockSend.mockResolvedValue({ Items: [] }); });

// ── helpers ───────────────────────────────────────────────────────────────────

function buildEvent(groups = []) {
  return {
    request: {
      groupConfiguration: {
        groupsToOverride: groups,
      },
    },
    response: {},
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('talentFlowPreTokenTrigger', () => {
  describe('custom:isAdmin claim', () => {
    test('sets isAdmin = true when TalentFlowAdmin is the only group', async () => {
      const event = buildEvent(['TalentFlowAdmin']);
      const result = await handler(event);
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:isAdmin']
      ).toBe('true');
    });

    test('sets isAdmin = true when TalentFlowAdmin is among multiple groups', async () => {
      const event = buildEvent(['HiringManager', 'TalentFlowAdmin', 'HRDirector']);
      const result = await handler(event);
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:isAdmin']
      ).toBe('true');
    });

    test('sets isAdmin = false when user is HiringManager only', async () => {
      const event = buildEvent(['HiringManager']);
      const result = await handler(event);
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:isAdmin']
      ).toBe('false');
    });

    test('sets isAdmin = false when groups list is empty', async () => {
      const event = buildEvent([]);
      const result = await handler(event);
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:isAdmin']
      ).toBe('false');
    });

    test('sets isAdmin = false for PanelMember, ComplianceOfficer, FinanceLead', async () => {
      const event = buildEvent(['PanelMember', 'ComplianceOfficer', 'FinanceLead']);
      const result = await handler(event);
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:isAdmin']
      ).toBe('false');
    });
  });

  describe('event passthrough', () => {
    test('returns the mutated event object (Cognito requires same object returned)', async () => {
      const event = buildEvent(['TalentFlowAdmin']);
      const result = await handler(event);
      expect(result).toBe(event);
    });

    test('preserves existing claimsToAddOrOverride keys', async () => {
      const event = buildEvent(['TalentFlowAdmin']);
      event.response = {
        claimsOverrideDetails: {
          claimsToAddOrOverride: { 'custom:tenantId': 'DEFAULT' },
        },
      };
      const result = await handler(event);
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:tenantId']
      ).toBe('DEFAULT');
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:isAdmin']
      ).toBe('true');
    });
  });

  describe('custom:roles claim', () => {
    test('TalentFlowAdmin group → roles = ["ADMIN"]', async () => {
      const event = buildEvent(['TalentFlowAdmin']);
      const result = await handler(event);
      const roles = JSON.parse(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:roles']
      );
      expect(roles).toEqual(['ADMIN']);
    });

    test('HiringManager group → roles = ["HM"]', async () => {
      const event = buildEvent(['HiringManager']);
      const result = await handler(event);
      const roles = JSON.parse(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:roles']
      );
      expect(roles).toEqual(['HM']);
    });

    test('ITAdmin group → roles = ["IT"]', async () => {
      const event = buildEvent(['ITAdmin']);
      const result = await handler(event);
      const roles = JSON.parse(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:roles']
      );
      expect(roles).toEqual(['IT']);
    });

    test('PanelMember / ComplianceOfficer / FinanceLead / HRDirector → roles = ["TA"]', async () => {
      for (const group of ['PanelMember', 'ComplianceOfficer', 'FinanceLead', 'HRDirector']) {
        const event = buildEvent([group]);
        const result = await handler(event);
        const roles = JSON.parse(
          result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:roles']
        );
        expect(roles).toEqual(['TA']);
      }
    });

    test('empty groups → roles = ["TA"]', async () => {
      const event = buildEvent([]);
      const result = await handler(event);
      const roles = JSON.parse(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:roles']
      );
      expect(roles).toEqual(['TA']);
    });

    test('TalentFlowAdmin + HiringManager → roles contains ADMIN and HM (no duplicates)', async () => {
      const event = buildEvent(['TalentFlowAdmin', 'HiringManager', 'TalentFlowAdmin']);
      const result = await handler(event);
      const roles = JSON.parse(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:roles']
      );
      expect(roles).toContain('ADMIN');
      expect(roles).toContain('HM');
      expect(roles.filter((r) => r === 'ADMIN').length).toBe(1);
    });
  });

  describe('custom:activeRole claim', () => {
    test('TalentFlowAdmin → activeRole = ADMIN', async () => {
      const event = buildEvent(['TalentFlowAdmin']);
      const result = await handler(event);
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:activeRole']
      ).toBe('ADMIN');
    });

    test('ADMIN takes precedence over HM when user has both groups', async () => {
      const event = buildEvent(['HiringManager', 'TalentFlowAdmin']);
      const result = await handler(event);
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:activeRole']
      ).toBe('ADMIN');
    });

    test('HM takes precedence over IT', async () => {
      const event = buildEvent(['ITAdmin', 'HiringManager']);
      const result = await handler(event);
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:activeRole']
      ).toBe('HM');
    });

    test('PanelMember only → activeRole = TA', async () => {
      const event = buildEvent(['PanelMember']);
      const result = await handler(event);
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:activeRole']
      ).toBe('TA');
    });

    test('empty groups → activeRole = TA', async () => {
      const event = buildEvent([]);
      const result = await handler(event);
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:activeRole']
      ).toBe('TA');
    });
  });

  describe('defensive: malformed event shapes', () => {
    test('handles missing groupConfiguration gracefully — sets isAdmin false', async () => {
      const event = { request: {}, response: {} };
      const result = await handler(event);
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:isAdmin']
      ).toBe('false');
    });

    test('handles missing request property gracefully — sets isAdmin false', async () => {
      const event = { response: {} };
      const result = await handler(event);
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:isAdmin']
      ).toBe('false');
    });

    test('handles null groupsToOverride gracefully — sets isAdmin false', async () => {
      const event = {
        request: { groupConfiguration: { groupsToOverride: null } },
        response: {},
      };
      const result = await handler(event);
      expect(
        result.response.claimsOverrideDetails.claimsToAddOrOverride['custom:isAdmin']
      ).toBe('false');
    });
  });

  describe('tenant_id claim (TEN-03)', () => {
    const A = 'ten_0123456789abcdefghijklmnop';
    const B = 'ten_zzzzzzzzzzzzzzzzzzzzzzzzzz';
    const SUB = 'sub-1';
    const withSub = (groups = ['TalentFlowAdmin']) => ({ ...buildEvent(groups), request: { ...buildEvent(groups).request, userAttributes: { sub: SUB, 'custom:tenant_id': B, tenant_id: B } }, callerContext: {} });
    const member = (tenant) => ({ pk: { S: `USER#${SUB}` }, sk: { S: `TENANT#${tenant}` }, tenant_id: { S: tenant } });
    const claimOf = (r) => r.response.claimsOverrideDetails.claimsToAddOrOverride.tenant_id;

    test('one Member row: that company, from one Query on the tenants table', async () => {
      mockSend.mockResolvedValueOnce({ Items: [member(A)] });
      const r = await handler(withSub());
      expect(claimOf(r)).toBe(A);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0].TableName).toBe('naleko-people-test-tenants');
      expect(r.response.claimsOverrideDetails.claimsToAddOrOverride['custom:isAdmin']).toBe('true');
    });

    test('a company named in the user attributes is never used', async () => {
      mockSend.mockResolvedValueOnce({ Items: [member(A)] });
      expect(claimOf(await handler(withSub()))).toBe(A);
    });

    test('no Member row and no legacy company: no claim, logged, never a default', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const r = await handler(withSub());
      expect(claimOf(r)).toBeUndefined();
      expect(warn.mock.calls.some((c) => String(c[0]).includes('Tenant claim skipped'))).toBe(true);
      warn.mockRestore();
    });

    test('several Member rows: no claim', async () => {
      mockSend.mockResolvedValueOnce({ Items: [member(A), member(B)] });
      expect(claimOf(await handler(withSub()))).toBeUndefined();
    });

    test('a failing read: no claim, and the handler still returns the old claims without throwing', async () => {
      mockSend.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));
      const r = await handler(withSub());
      expect(claimOf(r)).toBeUndefined();
      expect(r.response.claimsOverrideDetails.claimsToAddOrOverride['custom:roles']).toBe(JSON.stringify(['ADMIN']));
    });
  });
});
