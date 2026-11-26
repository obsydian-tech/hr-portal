// INT-01.F (NH-281): test support only, no application code. A preload (NODE_OPTIONS --import) for one Lambda run against REC-14's
// fake AWS (support/rec-14/fake-aws, unchanged), loaded after REC-15's clock and INT-01's race.mjs (both unchanged). It does nothing
// unless INT01F_HOOKS is given: a JSON list of hooks, each
//
//   { when: 'before' | 'after', on?: 'write' | 'read', match: '<text>', table?: '<table name>', skip?: 0, times?: 1, runs: [Run, ...] }
//
// A hook watches the DynamoDB calls of the request (writes: PutItem, UpdateItem, DeleteItem, BatchWriteItem, TransactWriteItems;
// reads: GetItem, Query) whose input, as JSON text, holds `match` (and, with `table`, names that table; without it, the request-key
// table never matches). After `skip` matching calls, it fires on each of the next `times` matching calls: fire number i does
// runs[min(i, runs.length - 1)], `before` the call reaches the fake or `after` it. Calls made inside a fire never count. A Run is:
//
//   { handler: '<file>', event: {...}, now?: '<ISO time>' }  a second request runs to its end in the same process over the same fake
//                                                           tables (at `now` when given: Date then gives that time until it ends);
//   { raw: { table, key: {...}, set?: {...}, remove?: [...] } } a row is changed directly (plain values), as no real request could;
//   { fail: true }                                          the watched call is not sent: it throws a store error (`before` only).
//
// Each fire's calls sit between a { service: 'race-start', hook } marker and a { service: 'race', hook, response, error } line, the
// markers INT-01's split() reads (so secondOf() gives the last fire's answer).
import { pathToFileURL } from 'node:url';

const here = new URL('../rec-14/fake-aws/', import.meta.url);
const { calls } = await import(new URL('world.mjs', here).href);
const dynamo = await import(new URL('client-dynamodb.mjs', here).href);
const doc = await import(new URL('lib-dynamodb.mjs', here).href);
const util = await import(new URL('util-dynamodb.mjs', here).href);

export const FAIL_MESSAGE = 'zz-int01f-store-fault-message';
const hooks = process.env.INT01F_HOOKS ? JSON.parse(process.env.INT01F_HOOKS) : [];
const IDEM = 'talent-flow-idempotency-keys';
const WRITES = new Set(['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems']);
const READS = new Set(['GetItem', 'Query']);
const tablesOf = (op, input) => {
  if (op === 'TransactWriteItems') return (input.TransactItems ?? []).map((t) => Object.values(t)[0]?.TableName);
  if (op === 'BatchWriteItem' || op === 'BatchGetItem') return Object.keys(input.RequestItems ?? {});
  return [input.TableName];
};
const seen = hooks.map(() => 0);
let inside = false;
let fires = 0;

function failure() {
  const e = new Error(FAIL_MESSAGE);
  e.name = 'InternalServerError';
  e.$fault = 'server';
  e.$metadata = { httpStatusCode: 500 };
  return e;
}

async function atTime(iso, fn) {
  if (!iso) return fn();
  const at = Date.parse(iso);
  const Prev = globalThis.Date;
  class HookDate extends Prev {
    constructor(...args) { if (args.length === 0) super(at); else super(...args); }
    static now() { return at; }
  }
  globalThis.Date = HookDate;
  try { return await fn(); } finally { globalThis.Date = Prev; }
}

async function fire(run, send, client) {
  const n = ++fires;
  calls.push({ service: 'race-start', hook: n });
  const out = { service: 'race', hook: n };
  inside = true;
  try {
    if (run.raw) {
      const { table, key, set = {}, remove = [] } = run.raw;
      const names = {};
      const values = {};
      const parts = [];
      Object.entries(set).forEach(([k, v], i) => { names[`#s${i}`] = k; values[`:s${i}`] = util.convertToAttr(v); parts.push(`#s${i} = :s${i}`); });
      const rem = remove.map((k, i) => { names[`#r${i}`] = k; return `#r${i}`; });
      const expr = `${parts.length ? `SET ${parts.join(', ')}` : ''}${rem.length ? ` REMOVE ${rem.join(', ')}` : ''}`.trim();
      await send.call(client, new dynamo.UpdateItemCommand({
        TableName: table, Key: util.marshall(key), UpdateExpression: expr, ExpressionAttributeNames: names,
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
      }));
      out.response = { raw: true };
    } else {
      const mod = await import(pathToFileURL(run.handler).href);
      const handler = mod.handler ?? mod.default?.handler;
      out.response = await atTime(run.now, () => handler(structuredClone(run.event), { awsRequestId: `int-01f-hook-${n}`, functionName: 'int-01f-hook' }));
    }
  } catch (e) {
    out.error = { name: e?.name, message: String(e?.message ?? e) };
  } finally {
    inside = false;
  }
  calls.push(out);
}

for (const C of [dynamo.DynamoDBClient, doc.DynamoDBDocumentClient]) {
  const send = C.prototype.send;
  C.prototype.send = async function int01fSend(cmd) {
    const op = cmd?.op;
    const input = cmd?.input ?? {};
    let mine = [];
    if (!inside && hooks.length && (WRITES.has(op) || READS.has(op))) {
      const tables = tablesOf(op, input);
      const text = JSON.stringify(input);
      hooks.forEach((h, i) => {
        const kind = h.on === 'read' ? READS : WRITES;
        if (!kind.has(op)) return;
        const tableOk = h.table ? tables.includes(h.table) : !tables.includes(IDEM);
        if (!tableOk || !text.includes(h.match)) return;
        const count = ++seen[i];
        const nth = count - (h.skip ?? 0);
        if (nth >= 1 && nth <= (h.times ?? 1)) mine.push({ h, run: h.runs[Math.min(nth - 1, h.runs.length - 1)] });
      });
    }
    for (const { h, run } of mine) {
      if (h.when !== 'before') continue;
      if (run.fail) { calls.push({ service: 'dynamodb', op, table: tablesOf(op, input).join(','), input, failedByHook: true }); throw failure(); }
      await fire(run, send, this);
    }
    let result;
    let thrown;
    try { result = await send.call(this, cmd); } catch (e) { thrown = e; }
    for (const { h, run } of mine) if (h.when === 'after' && !run.fail) await fire(run, send, this);
    if (thrown) throw thrown;
    return result;
  };
}
