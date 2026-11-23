'use strict';

/**
 * lambda/getCandidates/index.js
 *
 * Returns a paginated list of candidate SAGA records from talent-flow-state
 * using GSI1 (GSI1PK = TENANT#<tenantId>) — avoids full table scan.
 *
 * Query params (all optional):
 *   stage            — FilterExpression on currentStage
 *   positionLevel    — FilterExpression on positionLevel
 *   slaStatus        — FilterExpression on slaStatus
 *   search           — contains() match on firstName/lastName/email
 *   hiringManagerId  — FilterExpression on hiringManagerId (Cognito sub of HM)
 *   limit            — default 50, max 100
 *   nextToken        — exclusive start key (base64 JSON)
 */

const { tenantHelper } = require('../shared/tf-tenant.js');


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
  // REC-01: a Recruiter lists every candidate of the company; a manager lists only the candidates they are hiring for;
  // everyone else gets 403. The role answer comes first, before any AWS call.
  const RA = await import('../shared/recruitment-access.mjs');
  const notAllowed = RA.requireRecruiterOrManager(event);
  if (notAllowed) return notAllowed;
  // TEN-03: the company comes from the sign-in only. tenantId in the query string is not read.
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;

  const qs = event.queryStringParameters || {};
  // REC-15: the one candidate list, with or without role_id.
  const personId = RA.callerId(event);
  if (!personId) return RA.forbidden();
  try {
    const { listCandidates } = await import('../shared/recruitment-actions/candidate-list.mjs');
    return await listCandidates({ tenantId, personId, event }, qs);
  } catch (err) {
    console.error('getCandidates failed', { error: err?.name ?? 'Error' });
    return respond(500, { error: 'Something went wrong' });
  }
};
