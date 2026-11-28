// REC-04: the role routes. This file only checks the caller (role, company, module, in that order, before any AWS call) and turns
// the request into the core's input. The company and the person come from the sign-in, never from the request.
import { requireRecruiter, requireRecruiterOrManager, callerId, forbidden } from '../shared/recruitment-access.mjs';
import { requireTenant } from '../shared/tenant.mjs';
import { requireModule } from '../shared/modules.mjs';
import { json } from '../shared/hr-group.mjs';
import { listRoles, getRole, openRole, closeRole } from '../shared/recruitment-actions/roles.mjs';

const WRITES = new Set(['POST /v1/roles', 'POST /v1/roles/{id}/close']);

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
  const roleRefusal = WRITES.has(route) ? requireRecruiter(event) : requireRecruiterOrManager(event);
  if (roleRefusal) return roleRefusal;
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;
  const moduleRefusal = await requireModule(event, 'recruitment');
  if (moduleRefusal) return moduleRefusal;

  const personId = callerId(event);
  if (!personId) return forbidden();
  const ctx = { tenantId, personId, event };
  const id = event.pathParameters?.id;

  try {
    switch (route) {
      case 'GET /v1/roles':
        return await listRoles(ctx, event.queryStringParameters ?? {});
      case 'GET /v1/roles/{id}':
        return await getRole(ctx, id);
      case 'POST /v1/roles': {
        const key = Object.entries(event.headers ?? {}).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1];
        return await openRole(ctx, { body: bodyOf(event), idempotencyKey: key });
      }
      case 'POST /v1/roles/{id}/close':
        return await closeRole(ctx, id);
      default:
        return json(404, { error: 'Not found' });
    }
  } catch (e) {
    console.error('manageRoles failed', { route, error: e?.name ?? 'Error' });
    return json(500, { error: 'Something went wrong' });
  }
};
