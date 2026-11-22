'use strict';

/**
 * advanceCandidateStage — REC-03 (was NH-145 / BE-010)
 *
 * Trigger: PUT /v1/candidates/{id}/stage (HTTP API v2), body { to, reason }
 *
 * A person moves a candidate one step along the open stages (Applied, Screening, Interview, Offer), forward or back, and always
 * gives a reason. This file checks the caller in the fixed order and hands the rest to the core
 * (lambda/shared/recruitment-actions/move-candidate.mjs):
 *   1. role: a Recruiter or a manager (REC-01), before any AWS call
 *   2. company from the sign-in only (TEN-03), never from the request
 *   3. the Recruitment module is on for the company (MOD-01)
 *
 * Env vars: STATE_TABLE_NAME (talent-flow-state), CONFIG_TABLE_NAME (talent-flow-config), EVENTBRIDGE_BUS_NAME (talent-flow-bus)
 */

const answer = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** The JSON body as an object, or {} when there is none or it is not an object (the core then refuses the missing fields). */
function bodyOf(event) {
  if (!event.body) return {};
  try {
    const parsed = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

exports.handler = async (event) => {
  const RA = await import('../shared/recruitment-access.mjs');
  const roleRefusal = RA.requireRecruiterOrManager(event);
  if (roleRefusal) return roleRefusal;
  const { requireTenant } = await import('../shared/tenant.mjs');
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;

  const personId = RA.callerId(event);
  if (!personId) return RA.forbidden();

  const body = bodyOf(event);
  const { moveCandidate } = await import('../shared/recruitment-actions/move-candidate.mjs');
  try {
    return await moveCandidate({ tenantId, personId, event }, { candidateId: event.pathParameters?.id, to: body.to, reason: body.reason });
  } catch (err) {
    // Names only: the reason a person typed must never reach a log line.
    console.error('advanceCandidateStage failed', { error: err.name });
    return answer(500, { error: 'Failed to move candidate' });
  }
};
