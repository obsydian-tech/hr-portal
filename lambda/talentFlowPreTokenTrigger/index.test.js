'use strict';

const { handler } = require('./index');

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
});
