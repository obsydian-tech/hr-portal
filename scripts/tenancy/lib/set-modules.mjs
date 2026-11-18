/**
 * MOD-01: the one function that changes a company's modules. scripts/tenancy/set-modules.mjs calls it; ADM-01 must
 * call it too and never write the attribute another way.
 *
 * Seed before flip: each module being turned on runs its seed (module-seeds/<key>.mjs) first. If a seed fails the
 * modules are not changed and nothing is written. The change and its audit row are written together in one
 * transaction: pk TENANT#<id>, sk MODULES#<iso time>#<ulid>, from, to, reason, by (the AWS caller ARN), env.
 * Audit rows are never updated or deleted. Nothing is deleted.
 */
import { randomBytes } from 'node:crypto';
import { GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { MODULE_KEYS } from '../../../lambda/shared/modules.mjs';
import { seedFile } from '../module-seeds/index.mjs';

export { MODULE_KEYS };
export const TENANT_ID = /^ten_[0-9a-z]{26}$/;
export const tenantsTable = (env) => `naleko-people-${env}-tenants`;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(now = Date.now()) {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }
  const bytes = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] % 32];
  return time + rand;
}

/** What a stored Company row has on (the attribute, or every key for a founding row with none). */
export function storedModules(item) {
  const m = item?.modules;
  if (m === undefined) return item?.founding?.BOOL === true ? [...MODULE_KEYS] : [];
  const keys = Array.isArray(m.SS) ? m.SS : Array.isArray(m.L) ? m.L.map((v) => v?.S) : [];
  return MODULE_KEYS.filter((k) => keys.includes(k));
}

export class Refused extends Error {
  constructor(message, code = 2) { super(message); this.name = 'Refused'; this.code = code; }
}

/**
 * Plans (and with mode 'apply', makes) one change.
 * Returns { from, to, changed, wrote }. Throws Refused for anything it will not do.
 */
export async function setModules({ ddb, env, tenantId, on = [], off = [], reason, mode = 'dry', by, log = console.log }) {
  if (!['dev', 'prod'].includes(env)) throw new Refused('--env must be dev or prod');
  if (!TENANT_ID.test(tenantId ?? '')) throw new Refused('--tenant must be a company id (ten_ and 26 letters or digits)');
  const unknown = [...on, ...off].filter((k) => !MODULE_KEYS.includes(k));
  if (unknown.length) throw new Refused(`Unknown module key: ${unknown.join(', ')} (known: ${MODULE_KEYS.join(', ')})`);
  if (!on.length && !off.length) throw new Refused('Name at least one module with --on or --off');
  if (on.some((k) => off.includes(k))) throw new Refused('A module cannot be both --on and --off');
  if (mode === 'apply' && !(typeof reason === 'string' && reason.trim())) throw new Refused('--apply needs --reason');

  const table = tenantsTable(env);
  const res = await ddb.send(new GetItemCommand({ TableName: table, Key: { pk: { S: `TENANT#${tenantId}` }, sk: { S: 'PROFILE' } }, ConsistentRead: true }));
  if (!res.Item) throw new Refused(`No company ${tenantId} in ${table}`);
  const from = storedModules(res.Item);
  const to = MODULE_KEYS.filter((k) => (from.includes(k) || on.includes(k)) && !off.includes(k));
  const added = to.filter((k) => !from.includes(k));
  const changed = to.length !== from.length || added.length > 0;
  log(`Company ${tenantId} (${env}): ${from.join(', ') || 'none'} -> ${to.join(', ') || 'none'}${changed ? '' : ' (no change)'}`);
  if (mode !== 'apply' || !changed) return { from, to, changed, wrote: false };

  if (to.length === 0) throw new Refused('A company cannot be left with no module by this script');
  if (res.Item.founding?.BOOL === true && to.length === 0) throw new Refused('The founding company keeps at least one module');

  // Seed before flip. Load every seed first, then run them; any failure stops here with nothing written.
  const seeds = [];
  for (const key of added) seeds.push([key, await import(seedFile(key).href)]);
  if (env === 'prod') {
    for (const [key, seed] of seeds) {
      if (seed.available === false) {
        if (seed.STANDARD_PACK_LINE) log(seed.STANDARD_PACK_LINE);
        throw new Refused(`Not turning ${key} on in prod: its seed is not available yet`, 1);
      }
    }
  }
  for (const [key, seed] of seeds) {
    const run = seed.default ?? seed.seed;
    if (typeof run !== 'function') throw new Refused(`The ${key} seed has no function to run`, 1);
    await run({ ddb, env, tenantId, table, log });
  }

  const at = new Date();
  const list = (keys) => ({ L: keys.map((k) => ({ S: k })) });
  const profileUpdate = {
    TableName: table,
    Key: { pk: { S: `TENANT#${tenantId}` }, sk: { S: 'PROFILE' } },
    UpdateExpression: 'SET #modules = :modules',
    ConditionExpression: 'attribute_exists(pk)',
    ExpressionAttributeNames: { '#modules': 'modules' },
    ExpressionAttributeValues: { ':modules': { SS: to } },
  };
  const audit = {
    TableName: table,
    Item: {
      pk: { S: `TENANT#${tenantId}` },
      sk: { S: `MODULES#${at.toISOString()}#${ulid(at.getTime())}` },
      tenant_id: { S: tenantId },
      from: list(from),
      to: list(to),
      reason: { S: reason },
      by: { S: by },
      env: { S: env },
    },
    ConditionExpression: 'attribute_not_exists(sk)',
  };
  await ddb.send(new TransactWriteItemsCommand({ TransactItems: [{ Update: profileUpdate }, { Put: audit }] }));
  log(`Company ${tenantId}: modules set, 1 audit row written`);
  return { from, to, changed, wrote: true };
}
