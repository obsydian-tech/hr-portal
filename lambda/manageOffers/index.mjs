// REC-05: the offer routes. This file only checks the caller (role, company, module, in that order, before any AWS call) and turns
// the request into the core's input. The company and the person come from the sign-in, never from the request.
import { requireRecruiter, requireApprover, isRecruiter, isApprover, isManager, callerId, forbidden } from '../shared/recruitment-access.mjs';
import { requireTenant, notFound } from '../shared/tenant.mjs';
import { requireModule } from '../shared/modules.mjs';
import { withIdempotency } from '../shared/idempotency.mjs';
import { json, hrOnly } from '../shared/hr-group.mjs';
import { listOffers, getOffer, createOffer, actOnOffer, nameOf } from '../shared/recruitment-actions/offers.mjs';

const ACTIONS = {
  'PATCH /v1/offers/{id}': 'patch', 'POST /v1/offers/{id}/submit': 'submit', 'POST /v1/offers/{id}/approve': 'approve',
  'POST /v1/offers/{id}/send-back': 'send-back', 'POST /v1/offers/{id}/send': 'send', 'POST /v1/offers/{id}/answer': 'answer',
  'POST /v1/offers/{id}/withdraw': 'withdraw', 'POST /v1/offers/{id}/signed-upload': 'signed-upload',
};
const APPROVER_ROUTES = new Set(['POST /v1/offers/{id}/approve', 'POST /v1/offers/{id}/send-back']);

/** The role answer for a route: null when the caller may go on. */
function roleRefusal(route, event) {
  if (route === 'GET /v1/offers') return isRecruiter(event) || isApprover(event) ? null : forbidden();
  if (route === 'GET /v1/offers/{id}') return isRecruiter(event) || isApprover(event) || isManager(event) ? null : notFound();
  if (APPROVER_ROUTES.has(route)) return requireApprover(event);
  return requireRecruiter(event);
}

/** The parsed body, {} when there is none, undefined when it is not JSON. */
const bodyOf = (event) => {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return undefined;
  }
};

export const handler = async (event) => {
  const route = event.routeKey ?? event.requestContext?.routeKey ?? '';
  const refusal = roleRefusal(route, event);
  if (refusal) return refusal;
  // REC-06 (D-REC-6.8): recording an accepted offer makes an employee, so it needs hr_staff itself, checked before any AWS call.
  if (route === 'POST /v1/offers/{id}/answer' && bodyOf(event)?.answer === 'ACCEPTED') {
    const notHr = hrOnly(event, 'Forbidden');
    if (notHr) return notHr;
  }
  const { tenantId, refusal: noCompany } = requireTenant(event);
  if (noCompany) return noCompany;
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;
  const personId = callerId(event);
  if (!personId) return forbidden();
  const ctx = { tenantId, personId, personName: nameOf(event), event };
  const id = event.pathParameters?.id;
  const key = Object.entries(event.headers ?? {}).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1];
  try {
    if (route === 'GET /v1/offers') return await listOffers(ctx, event.queryStringParameters ?? {});
    if (route === 'GET /v1/offers/{id}') return await getOffer(ctx, id, event.queryStringParameters ?? {});
    const body = bodyOf(event);
    if (body === undefined) return json(400, { error: 'Bad request', code: 'INVALID_BODY' });
    if (route === 'POST /v1/offers') return await withIdempotency(key ? `OFFER_CREATE#${key}` : undefined, () => createOffer(ctx, body), tenantId);
    const action = ACTIONS[route];
    if (!action) return notFound();
    return await withIdempotency(key ? `OFFER#${action}#${key}` : undefined, () => actOnOffer(ctx, action, id, body), tenantId);
  } catch (e) {
    console.error('manageOffers failed', { route, error: e?.name ?? 'Error' });
    return json(500, { error: 'Something went wrong' });
  }
};
