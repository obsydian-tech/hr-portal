'use strict';

/**
 * getHiringManagers Lambda
 *
 * Returns all CONFIRMED users in the `naleko-talentflow-hiringmanager` Cognito group
 * from the Naleko (HR Portal) user pool.
 *
 * Pool consolidation (Epic 5): TF API GW authorizer was switched to the Naleko pool.
 * All user lookups must use the Naleko pool so that `sub` values match
 * the `hiringManagerId` stored on Candidate SAGA records.
 *
 * Used by the TA Create Candidate form to populate the HM selector dropdown.
 *
 * GET /v1/hiring-managers
 * Auth: JWT (any authenticated TalentFlow user)
 *
 * Response: { hiringManagers: [{ sub, email, givenName, familyName, name }] }
 */

const { tenantHelper } = require('../shared/tf-tenant.js');

// After pool consolidation, use the Naleko (HR Portal) Cognito pool.
// The TF API GW authorizer validates against this pool, so subs must match.
// BE-15: a setting that names one environment has no fallback value. A missing
// one stops the Lambda when it starts, with one clear line in the log.
function requireSetting(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing setting ${name}`);
    throw new Error(`Missing setting ${name}`);
  }
  return value;
}

const HM_POOL_ID  = requireSetting('HM_COGNITO_POOL_ID');

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  // TEN-03: the company check. TEN-04.2: the pool holds no company, so the list is narrowed to the company's people by
  // their Member rows (inCompany). A failed Member read answers 500, never the whole pool.
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;

  // REC-14 rule 12: the people come from the one shared function (the same list the options route and the role check use).
  let hiringManagers;
  try {
    const { hiringManagerPeopleOf } = await import('../shared/hiring-managers.mjs');
    hiringManagers = await hiringManagerPeopleOf(tenantId);
  } catch (err) {
    console.error('getHiringManagers: read failed', { error: err?.name });
    return respond(500, { error: 'Failed to retrieve hiring managers' });
  }

  return respond(200, { hiringManagers });
};
