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
