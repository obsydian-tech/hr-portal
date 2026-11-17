'use strict';

/**
 * Cognito Pre-Token Generation trigger — NH-121 / BE-005 / Admin-S1
 *
 * Injects custom claims into every TalentFlow JWT:
 *
 *   tenant_id         — TEN-03: the person's company, from their Member row in the tenants table (USER#sub / TENANT#id).
 *                       No Member row: the legacy company while LEGACY_TENANT_ID is set, else no claim (never a default).
 *                       Several rows or a failing read: no claim. It never throws, and never reads a company the
 *                       person or the client sent (user attributes and client metadata are ignored).
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

const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');

const TENANT_ID_PATTERN = /^ten_[0-9a-z]{26}$/;
const TENANTS_TABLE = process.env.TENANTS_TABLE;
const rawLegacy = process.env.LEGACY_TENANT_ID;
const LEGACY = rawLegacy && TENANT_ID_PATTERN.test(rawLegacy) ? rawLegacy : null;
const db = new DynamoDBClient({});

function skip(sub, reason) {
  console.warn(JSON.stringify({ message: 'Tenant claim skipped', sub, reason }));
  return null;
}

async function companyOf(sub) {
  if (!sub) return skip(sub, 'none');
  if (!TENANTS_TABLE) return skip(sub, 'no table');
  let items;
  try {
    const out = await db.send(new QueryCommand({
      TableName: TENANTS_TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :t)',
      ExpressionAttributeValues: { ':pk': { S: `USER#${sub}` }, ':t': { S: 'TENANT#' } },
    }));
    items = out.Items ?? [];
  } catch {
    return skip(sub, 'error');
  }
  if (items.length > 1) return skip(sub, 'several');
  if (items.length === 1) {
    const id = (items[0].tenant_id && items[0].tenant_id.S) || '';
    return TENANT_ID_PATTERN.test(id) && items[0].sk && items[0].sk.S === `TENANT#${id}` ? id : skip(sub, 'malformed');
  }
  return LEGACY ?? skip(sub, 'none');
}

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

  // TEN-03: the company claim. Only the Member row (or the legacy rule) names it.
  const sub = event.request && event.request.userAttributes && event.request.userAttributes.sub;
  const tenantId = await companyOf(sub);
  if (tenantId) claims.tenant_id = tenantId;

  return event;
};
