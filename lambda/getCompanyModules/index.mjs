/**
 * MOD-01: GET /v1/company/modules. Any signed-in person whose sign-in carries a company (no role needed, guests
 * included) gets { "modules": [...] }, sorted, from lambda/shared/modules.mjs. No company name, plan or status.
 * No company on the sign-in: 403. A read error is [] (modulesOf logs it), never a 500.
 */
import { requireTenant } from '../shared/tenant.mjs';
import { modulesOf } from '../shared/modules.mjs';
import { json } from '../shared/hr-group.mjs';

export const handler = async (event) => {
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;
  const modules = [...(await modulesOf(tenantId))].sort();
  const res = json(200, { modules });
  return { ...res, headers: { ...res.headers, 'Cache-Control': 'private, no-store' } };
};
