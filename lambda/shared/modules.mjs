/**
 * MOD-01: which modules a company has switched on, decided on the server.
 *
 * modules on the Company row (pk TENANT#<id>, sk PROFILE) is a string set of keys from MODULE_KEYS. A row with no
 * modules attribute counts as every key only when founding = true. A missing row, a row that is not ACTIVE, or a read
 * error gives none (fail closed) and logs "Modules read failed" with the company id only.
 *
 * Every Recruitment handler, after requireTenant:
 *   const { requireModule } = await import('../shared/modules.mjs');
 *   const off = await requireModule(event, 'recruitment');
 *   if (off) return off;
 *
 * The company is requireTenant's. Nothing the caller sends, and nothing in the sign-in but the company, is read here.
 */
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { json } from './hr-group.mjs';
import { TENANT_ID_PATTERN, requireTenant } from './tenant.mjs';

export const MODULE_KEYS = Object.freeze(['onboarding', 'recruitment']);

const CACHE_MS = 60_000;
const cache = new Map();
let client;
const dynamo = () => (client ??= new DynamoDBClient({}));

function fromRow(item) {
  if (!item) return null;
  if (item.status?.S !== 'ACTIVE') return null;
  const stored = item.modules;
  if (stored === undefined) return item.founding?.BOOL === true ? [...MODULE_KEYS] : [];
  const keys = Array.isArray(stored.SS) ? stored.SS : Array.isArray(stored.L) ? stored.L.map((v) => v?.S) : [];
  return MODULE_KEYS.filter((k) => keys.includes(k));
}

/** The modules switched on for a company, sorted. Never throws. */
export async function modulesOf(tenantId) {
  if (typeof tenantId !== 'string' || !TENANT_ID_PATTERN.test(tenantId)) return [];
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_MS) return [...hit.keys];
  let item;
  try {
    const res = await dynamo().send(new GetItemCommand({
      TableName: process.env.TENANTS_TABLE,
      Key: { pk: { S: `TENANT#${tenantId}` }, sk: { S: 'PROFILE' } },
      ConsistentRead: true,
    }));
    item = res.Item;
  } catch (err) {
    console.error('Modules read failed', { tenantId, error: err?.name ?? 'Error' });
    return [];
  }
  const keys = fromRow(item);
  if (keys === null) console.warn('Modules read failed', { tenantId, reason: item ? 'not active' : 'no company row' });
  cache.set(tenantId, { at: Date.now(), keys: keys ?? [] });
  return [...(keys ?? [])];
}

/** null when the company of the request has `key` on, else the 403 answer. */
export async function requireModule(event, key) {
  if (!MODULE_KEYS.includes(key)) throw new Error(`Unknown module key: ${key}`);
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;
  const on = await modulesOf(tenantId);
  return on.includes(key) ? null : json(403, { error: 'Forbidden' });
}
