/**
 * TEN-01: which company a request belongs to, and the checks on stored rows.
 *
 * The rule for every onboarding Lambda from TEN-01 on:
 * 1. A handler a signed-in person or agent calls runs requireTenant right after the group check.
 * 2. Every row it writes goes through stampTenant.
 * 3. Every row it reads by key is checked with ownsRow; another company's row is notFound() (404, never 403).
 * 4. Every list (Query on an index, or Scan) adds tenantFilter (merge with andFilter).
 * 5. A public route takes the company from the stored row it reads, never from the request.
 * 6. A new table keys its rows with tenantKey.
 * 7. Tests include a caller of a second company.
 * The company never comes from the body, query string, path, headers or cookies.
 */
import { json } from './hr-group.mjs';

export const TENANT_ID_PATTERN = /^ten_[0-9a-z]{26}$/;
const valid = (v) => typeof v === 'string' && TENANT_ID_PATTERN.test(v);
const legacy = () => (valid(process.env.LEGACY_TENANT_ID) ? process.env.LEGACY_TENANT_ID : null);

export class TenantMismatch extends Error {
  constructor(message = 'Row belongs to another company') { super(message); this.name = 'TenantMismatch'; }
}

export function tenantOf(event) {
  const auth = event?.requestContext?.authorizer;
  const fromJwt = auth?.jwt?.claims?.tenant_id;
  if (fromJwt !== undefined) return valid(fromJwt) ? fromJwt : null;
  const fromAgent = auth?.lambda?.tenant_id;
  return valid(fromAgent) ? fromAgent : null;
}

export function requireTenant(event) {
  const tenantId = tenantOf(event);
  if (tenantId) return { tenantId };
  return { refusal: json(403, { error: 'Forbidden' }) };
}

export function stampTenant(item, tenantId) {
  if (!valid(tenantId)) throw new Error('Not a company id');
  if (item.tenant_id !== undefined && item.tenant_id !== tenantId) throw new TenantMismatch();
  return { ...item, tenant_id: tenantId };
}

export function ownsRow(row, tenantId) {
  if (!row || !valid(tenantId)) return false;
  if (row.tenant_id !== undefined) return row.tenant_id === tenantId;
  return legacy() !== null && tenantId === legacy();
}

export function tenantFilter(tenantId) {
  if (!valid(tenantId)) throw new Error('Not a company id');
  const withLegacy = legacy() !== null && tenantId === legacy();
  return {
    FilterExpression: withLegacy ? '(#tenant_id = :tenant_id OR attribute_not_exists(#tenant_id))' : '#tenant_id = :tenant_id',
    ExpressionAttributeNames: { '#tenant_id': 'tenant_id' },
    ExpressionAttributeValues: { ':tenant_id': tenantId },
  };
}

export function andFilter(existing, tenantPart) {
  return {
    FilterExpression: existing?.FilterExpression
      ? `(${existing.FilterExpression}) AND (${tenantPart.FilterExpression})`
      : tenantPart.FilterExpression,
    ExpressionAttributeNames: { ...(existing.ExpressionAttributeNames ?? {}), ...tenantPart.ExpressionAttributeNames },
    ExpressionAttributeValues: { ...(existing.ExpressionAttributeValues ?? {}), ...tenantPart.ExpressionAttributeValues },
  };
}

export function tenantKey(tenantId, ...parts) {
  if (!valid(tenantId)) throw new Error('Not a company id');
  if (parts.some((p) => typeof p !== 'string' || p === '')) throw new Error('Empty key part');
  return ['TENANT', tenantId, ...parts].join('#');
}

export function notFound() {
  return json(404, { error: 'Not found' });
}
