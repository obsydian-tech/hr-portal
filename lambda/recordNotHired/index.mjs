// REC-02: the Not hired routes. A person decides; this file only checks the caller (role, company, module, in that order,
// before any AWS call) and turns the request into the core's input. The company comes from the sign-in, never from the request.
import { requireRecruiter, requireRecruiterOrManager, callerId, forbidden } from '../shared/recruitment-access.mjs';
import { requireTenant } from '../shared/tenant.mjs';
import { requireModule } from '../shared/modules.mjs';
import { recordNotHired, confirmNotHired, cancelNotHired, reopenCandidate, oldSystemList } from '../shared/recruitment-actions/record-not-hired.mjs';

const OLD_SYSTEM = 'GET /v1/candidates/old-system';

const bodyOf = (event) => {
  if (!event.body) return {};
  try {
    const parsed = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const handler = async (event) => {
  const route = event.routeKey ?? event.requestContext?.routeKey ?? '';
  const isList = route === OLD_SYSTEM;

  const roleRefusal = isList ? requireRecruiter(event) : requireRecruiterOrManager(event);
  if (roleRefusal) return roleRefusal;
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;
  const moduleRefusal = await requireModule(event, 'recruitment');
  if (moduleRefusal) return moduleRefusal;

  const personId = callerId(event);
  if (!personId) return forbidden();
  const ctx = { tenantId, personId, event };
  if (isList) return oldSystemList(ctx);

  const candidateId = event.pathParameters?.id;
  const body = bodyOf(event);
  const key = Object.entries(event.headers ?? {}).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1];

  switch (route) {
    case 'POST /v1/candidates/{id}/not-hired':
      return recordNotHired(ctx, { candidateId, reason: body.reason, note: body.note, idempotencyKey: key });
    case 'POST /v1/candidates/{id}/not-hired/confirm':
      return confirmNotHired(ctx, { candidateId });
    case 'POST /v1/candidates/{id}/not-hired/cancel':
      return cancelNotHired(ctx, { candidateId });
    case 'POST /v1/candidates/{id}/reopen':
      return reopenCandidate(ctx, { candidateId, reason: body.reason });
    default:
      return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not found' }) };
  }
};
