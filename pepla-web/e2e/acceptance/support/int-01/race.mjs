// INT-01: test support only, no application code. A preload (NODE_OPTIONS --import) for one Lambda run against REC-14's fake AWS
// (support/rec-14/fake-aws, unchanged). It does nothing unless one of these settings is given:
//
//   INT01_RACE  = JSON { when: 'before' | 'after', match: '<text>', table?: '<table name>', nth?: 1, handler: '<file>', event: {...} }
//     The first (or nth) DynamoDB write (PutItem, UpdateItem, DeleteItem, BatchWriteItem, TransactWriteItems) whose input, as JSON
//     text, holds `match` (and, with `table`, names that table) runs a second request in the same process, over the same fake tables:
//     `before` the write reaches the fake (the second request was judged and written in between this request's read and its write),
//     or `after` it (the second request runs between this write and the rest of this request). The second request runs to its end.
//     Its calls sit between a { service: 'race-start' } marker and a { service: 'race', response, error } line in the calls.
//     The writes of the idempotency table never match unless `table` names it.
//
//   INT01_STALE = '1'
//     A Query of the state table without ConsistentRead: true answers as DynamoDB may just after a write: the VOTE# row written
//     most recently in this process is left out. A Query with ConsistentRead: true, and every other read, answers in full (AC-9, AC-23).
//
//   INT01_FAIL_TABLE = '<table name>'
//     Every call on that table is recorded, then throws an InternalServerError whose message is FAIL_MESSAGE (a store error).
import { pathToFileURL } from 'node:url';

const here = new URL('../rec-14/fake-aws/', import.meta.url);
const { calls } = await import(new URL('world.mjs', here).href);
const dynamo = await import(new URL('client-dynamodb.mjs', here).href);
const doc = await import(new URL('lib-dynamodb.mjs', here).href);

export const FAIL_MESSAGE = 'zz-int01-store-fault-message';
const race = process.env.INT01_RACE ? JSON.parse(process.env.INT01_RACE) : null;
const stale = process.env.INT01_STALE === '1';
const failTable = process.env.INT01_FAIL_TABLE || '';
const STATE = process.env.STATE_TABLE_NAME || 'talent-flow-state';
const IDEM = 'talent-flow-idempotency-keys';
const WRITES = new Set(['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems']);

const s = (v) => (v && typeof v === 'object' && 'S' in v ? v.S : v);
const tablesOf = (op, input) => {
  if (op === 'TransactWriteItems') return (input.TransactItems ?? []).map((t) => Object.values(t)[0]?.TableName);
  if (op === 'BatchWriteItem' || op === 'BatchGetItem') return Object.keys(input.RequestItems ?? {});
  return [input.TableName];
};
/** The VOTE# rows a write puts (as { PK, SK } text). */
function votesPut(op, input) {
  const items = op === 'TransactWriteItems'
    ? (input.TransactItems ?? []).map((t) => t.Put?.Item).filter(Boolean)
    : op === 'PutItem' ? [input.Item] : op === 'BatchWriteItem' ? Object.values(input.RequestItems ?? {}).flat().map((r) => r.PutRequest?.Item).filter(Boolean) : [];
  return items.filter((i) => String(s(i.SK) ?? '').startsWith('VOTE#')).map((i) => ({ PK: s(i.PK), SK: s(i.SK) }));
}
let lastVote = null;
let seenMatches = 0;
let raced = false;

async function runSecond() {
  raced = true;
  calls.push({ service: 'race-start' });
  const out = { service: 'race' };
  try {
    const mod = await import(pathToFileURL(race.handler).href);
    const handler = mod.handler ?? mod.default?.handler;
    out.response = await handler(structuredClone(race.event), { awsRequestId: 'int-01-race', functionName: 'int-01-race' });
  } catch (e) {
    out.error = { name: e?.name, message: String(e?.message ?? e) };
  }
  calls.push(out);
}

function failure() {
  const e = new Error(FAIL_MESSAGE);
  e.name = 'InternalServerError';
  e.$fault = 'server';
  e.$metadata = { httpStatusCode: 500 };
  return e;
}

for (const C of [dynamo.DynamoDBClient, doc.DynamoDBDocumentClient]) {
  const send = C.prototype.send;
  C.prototype.send = async function int01Send(cmd) {
    const op = cmd?.op;
    const input = cmd?.input ?? {};
    const tables = tablesOf(op, input);
    if (failTable && tables.includes(failTable)) {
      calls.push({ service: 'dynamodb', op, table: tables.join(','), input });
      throw failure();
    }
    let isRace = false;
    if (race && !raced && WRITES.has(op)) {
      const text = JSON.stringify(input);
      const tableOk = race.table ? tables.includes(race.table) : !tables.includes(IDEM);
      if (tableOk && text.includes(race.match)) {
        seenMatches++;
        isRace = seenMatches === (race.nth ?? 1);
      }
    }
    if (isRace && race.when === 'before') await runSecond();
    let result;
    let thrown;
    try {
      result = await send.call(this, cmd);
    } catch (e) {
      thrown = e;
    }
    if (!thrown && WRITES.has(op)) for (const v of votesPut(op, input)) lastVote = v;
    if (isRace && race.when === 'after') await runSecond();
    if (thrown) throw thrown;
    if (stale && op === 'Query' && input.ConsistentRead !== true && tables.includes(STATE) && lastVote && Array.isArray(result?.Items)) {
      const items = result.Items.filter((i) => !(s(i.PK) === lastVote.PK && s(i.SK) === lastVote.SK));
      if (items.length !== result.Items.length) result = { ...result, Items: items, Count: items.length };
    }
    return result;
  };
}
