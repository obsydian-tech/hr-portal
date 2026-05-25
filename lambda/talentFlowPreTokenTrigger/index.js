'use strict';

/**
 * Cognito Pre-Token Generation trigger — NH-121 / BE-005 / Admin-S1
 *
 * Injects three custom claims into every TalentFlow JWT:
 *
 *   custom:isAdmin    — 'true' for TalentFlowAdmin group members (existing, no change)
 *   custom:roles      — JSON array of TalentFlowRole values, e.g. '["ADMIN","HM"]'
 *   custom:activeRole — highest-precedence role string, e.g. "ADMIN"
 *
 * Role mapping (Cognito group → TalentFlowRole):
 *   TalentFlowAdmin → ADMIN
 *   HiringManager   → HM
 *   ITAdmin         → IT
 *   PanelMember / ComplianceOfficer / FinanceLead / HRDirector → TA
 *
 * Claims are computed at token-generation time from groupsToOverride — no
 * DynamoDB read, no added latency. Cognito is the access-control authority;
 * DynamoDB users table is the query layer (Option C architecture).
 *
 * @param {import('@types/aws-lambda').PreTokenGenerationTriggerHandler} event
 */

const GROUP_TO_ROLE = {
  TalentFlowAdmin: 'ADMIN',
  HiringManager:   'HM',
  ITAdmin:         'IT',
};

// Highest → lowest precedence. Used to pick activeRole when user has multiple.
const ROLE_PRECEDENCE = ['ADMIN', 'HM', 'IT', 'TA'];

exports.handler = async (event) => {
  const groups = (event.request &&
    event.request.groupConfiguration &&
    event.request.groupConfiguration.groupsToOverride) || [];

  // ── Existing claim: custom:isAdmin (no regression) ──────────────────────
  const isAdmin = groups.includes('TalentFlowAdmin') ? 'true' : 'false';

  // ── New: map groups → TalentFlowRole[] ──────────────────────────────────
  const mapped = groups.map((g) => GROUP_TO_ROLE[g]).filter(Boolean);
  // Groups not in the map (PanelMember, ComplianceOfficer, FinanceLead,
  // HRDirector) resolve to TA — they still need a valid role claim.
  const roles = mapped.length > 0 ? [...new Set(mapped)] : ['TA'];
  const activeRole = ROLE_PRECEDENCE.find((r) => roles.includes(r)) || 'TA';

  // ── Inject all three claims ──────────────────────────────────────────────
  event.response = event.response || {};
  event.response.claimsOverrideDetails = event.response.claimsOverrideDetails || {};
  event.response.claimsOverrideDetails.claimsToAddOrOverride =
    event.response.claimsOverrideDetails.claimsToAddOrOverride || {};

  const claims = event.response.claimsOverrideDetails.claimsToAddOrOverride;
  claims['custom:isAdmin']    = isAdmin;
  claims['custom:roles']      = JSON.stringify(roles);
  claims['custom:activeRole'] = activeRole;

  return event;
};
