import { A, B, TABLE, TENANTS, plain, type Ask } from './world';
import type { Run, Tables } from './lambda-harness';

/** The same ask with company B's id put everywhere a client could put one: query, body, headers (and a snake_case twin). */
export function withB(a: Ask): Ask {
  return {
    ...a,
    query: { ...(a.query ?? {}), tenantId: B, tenant_id: B },
    body: a.body && typeof a.body === 'object' ? { ...(a.body as object), tenantId: B, tenant_id: B } : a.method && a.method !== 'GET' ? { tenantId: B } : a.body,
    headers: { ...(a.headers ?? {}), 'x-tenant-id': B, tenantid: B },
  };
}

/** The same ask with no company at all. */
export function withoutCompany(a: Ask): Ask {
  const { tenantId: _q, tenant_id: _q2, ...query } = (a.query ?? {}) as Record<string, string>;
  const body = a.body && typeof a.body === 'object' ? Object.fromEntries(Object.entries(a.body as object).filter(([k]) => k !== 'tenantId' && k !== 'tenant_id')) : a.body;
  return { ...a, query, body };
}

/** Rows that are new or changed by a run (plain values), per table. */
export function changed(before: Tables, after: Tables): { table: string; row: Record<string, any> }[] {
  const out: { table: string; row: Record<string, any> }[] = [];
  for (const [table, rows] of Object.entries(after)) {
    const was = new Set((before[table] ?? []).map((r) => JSON.stringify(sortKeys(r))));
    for (const r of rows) if (!was.has(JSON.stringify(sortKeys(r)))) out.push({ table, row: plain(r) });
  }
  return out;
}
function sortKeys(o: any): any {
  return Array.isArray(o) ? o.map(sortKeys) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o;
}
/** Whether a run changed any row at all. */
export const wrote = (before: Tables, after: Tables) => JSON.stringify(sortKeys(before)) !== JSON.stringify(sortKeys(after));

/** Mask ids and times a run makes up, so two answers can be compared. */
export const masked = (v: unknown) =>
  JSON.stringify(v)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<time>');

/** The AWS calls of a run that are not reads of DynamoDB. */
export const notReads = (r: Run) =>
  (r.calls as any[]).filter((c) => c.service !== 'log' && !(c.service === 'dynamodb' && /^(GetItem|Query|Scan|BatchGetItem)$/.test(c.op)));

/** Everything a run asked of AWS (not the log), as text. */
export const sent = (r: Run) => JSON.stringify((r.calls as any[]).filter((c) => c.service !== 'log'));

export { TABLE, TENANTS, A, B };
