// REC-16: copied from ../../rec-06/fake-aws (code added only: world.landBeforeWrite, below).
// REC-06: copied from ../../rec-05/fake-aws (code added only: world.failTransactItem, world.landBeforeTransact and the
// cancellation reasons on a cancelled transaction, below).
// REC-05: copied from ../../rec-14/fake-aws (code added only: world.denyReads and world.raceBeforeWrite, below).
// REC-14: copied from ../../rec-04/fake-aws (code added only: world.clashBeforeTransact, below).
// Copied from ../../onb-07/fake-aws (ONB-07 lock); GetItem also honours ProjectionExpression (top-level names).
// A DynamoDB client over the fake tables (AttributeValue form). Reads as ../../onb-13/fake-aws does
// (Scan in pages of at most world.pageSize rows, filter after the page is read). Writes change the
// tables: PutItem, UpdateItem, DeleteItem, BatchWriteItem and TransactWriteItems, each honouring its
// ConditionExpression (a failed condition throws ConditionalCheckFailedException, as DynamoDB does).
import { world, calls, table, awsError, KEYS, INDEXES, failIfAsked } from './world.mjs';
import { compile } from './expression.mjs';
import { applyUpdate } from './update.mjs';
import { marshall, unmarshall } from './util-dynamodb.mjs';

class Command { constructor(input) { this.input = input; } }
export class QueryCommand extends Command { get op() { return 'Query'; } }
export class GetItemCommand extends Command { get op() { return 'GetItem'; } }
export class ScanCommand extends Command { get op() { return 'Scan'; } }
export class BatchGetItemCommand extends Command { get op() { return 'BatchGetItem'; } }
export class PutItemCommand extends Command { get op() { return 'PutItem'; } }
export class UpdateItemCommand extends Command { get op() { return 'UpdateItem'; } }
export class DeleteItemCommand extends Command { get op() { return 'DeleteItem'; } }
export class BatchWriteItemCommand extends Command { get op() { return 'BatchWriteItem'; } }
export class TransactWriteItemsCommand extends Command { get op() { return 'TransactWriteItems'; } }
export class ConditionalCheckFailedException extends Error { constructor(o = {}) { super(o.message ?? 'The conditional request failed'); this.name = 'ConditionalCheckFailedException'; } }
export class TransactionCanceledException extends Error { constructor(o = {}) { super(o.message ?? 'Transaction cancelled'); this.name = 'TransactionCanceledException'; if (o.CancellationReasons) this.CancellationReasons = o.CancellationReasons; } }

const keyOf = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));
const sameKey = (row, key) => Object.entries(key).every(([k, v]) => JSON.stringify(row[k]) === JSON.stringify(v));

function filtered(input, rows) {
  if (!input.FilterExpression) return rows;
  const f = compile(input.FilterExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
  return rows.filter(f);
}

function checkKey(name, key) {
  const want = KEYS[name];
  const got = Object.keys(key ?? {}).sort();
  if (JSON.stringify(got) !== JSON.stringify([...want].sort())) throw awsError('ValidationException', `The provided key element does not match the schema of ${name}`);
}

function condition(input, current) {
  if (!input.ConditionExpression) return true;
  return compile(input.ConditionExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues)(current ?? {});
}

/** One write, applied to the tables (or only checked, when `dry`). Returns the old item. */
function write(kind, input, dry = false) {
  const { rows, keys } = table(input.TableName);
  if (kind === 'Put') {
    const key = keyOf(input.Item, keys);
    checkKey(input.TableName, key);
    const at = rows.findIndex((r) => sameKey(r, key));
    const old = at >= 0 ? rows[at] : undefined;
    if (!condition(input, old)) throw new ConditionalCheckFailedException();
    if (!dry) { if (at >= 0) rows[at] = input.Item; else rows.push(input.Item); }
    return old;
  }
  checkKey(input.TableName, input.Key);
  const at = rows.findIndex((r) => sameKey(r, input.Key));
  const old = at >= 0 ? rows[at] : undefined;
  if (!condition(input, old)) throw new ConditionalCheckFailedException();
  if (dry || kind === 'ConditionCheck') return old;
  if (kind === 'Delete') { if (at >= 0) rows.splice(at, 1); return old; }
  const next = applyUpdate(old ?? { ...input.Key }, input.UpdateExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
  Object.assign(next, input.Key);
  if (at >= 0) rows[at] = next; else rows.push(next);
  return old;
}

export async function answer(op, input) {
  const tableName = input.TableName ?? Object.keys(input.RequestItems ?? {}).join(',');
  calls.push({ service: 'dynamodb', op, table: tableName || undefined, input });
  failIfAsked('dynamodb', op);
  denyRead(op, input);
  raceBefore(op, input);
  landBefore(op, input);
  if (op === 'Query') {
    if (input.IndexName && !INDEXES[input.IndexName]) throw new Error(`fake DynamoDB: no index ${input.IndexName}; query the table by its key`);
    const { rows } = table(input.TableName);
    const k = compile(input.KeyConditionExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
    // BE-17: an index holds only rows that carry its key attributes.
    const inIndex = input.IndexName ? rows.filter((r) => INDEXES[input.IndexName].every((a) => r[a] !== undefined)) : rows;
    let matched = inIndex.filter(k);
    // REC-02 (code added only): with world.queryPageSize set, a Query answers that many key matches a page and a LastEvaluatedKey, as
    // DynamoDB does when a page reaches 1 MB; the filter runs after the page is cut, so a page can hold fewer rows or none.
    let lastKey;
    if (world.queryPageSize && input.Limit === undefined) {
      let from = 0;
      if (input.ExclusiveStartKey) {
        from = matched.findIndex((r) => sameKey(r, input.ExclusiveStartKey)) + 1;
        if (from < 1) throw new Error('fake DynamoDB: ExclusiveStartKey is not a key this Query returned');
      }
      const page = matched.slice(from, from + world.queryPageSize);
      if (from + world.queryPageSize < matched.length) lastKey = keyOf(page[page.length - 1], [...table(input.TableName).keys, ...(input.IndexName ? INDEXES[input.IndexName] : [])]);
      matched = page;
    } else matched = matched.slice(0, input.Limit ?? Infinity);
    let items = filtered(input, matched);
    if (input.ProjectionExpression) {
      const names = input.ProjectionExpression.split(',').map((n) => n.trim()).map((n) => (n.startsWith('#') ? input.ExpressionAttributeNames?.[n] : n));
      items = items.map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => names.includes(key))));
    }
    return { Items: items, Count: items.length, ScannedCount: matched.length, ...(lastKey ? { LastEvaluatedKey: lastKey } : {}) };
  }
  if (op === 'GetItem') {
    const { rows } = table(input.TableName);
    checkKey(input.TableName, input.Key);
    const item = rows.find((r) => sameKey(r, input.Key));
    if (!item) return {};
    if (!input.ProjectionExpression) return { Item: item };
    const names = input.ProjectionExpression.split(',').map((n) => n.trim()).map((n) => (n.startsWith('#') ? input.ExpressionAttributeNames?.[n] : n));
    return { Item: Object.fromEntries(Object.entries(item).filter(([k]) => names.includes(k))) };
  }
  if (op === 'Scan') {
    if (input.IndexName) throw new Error(`fake DynamoDB: no index ${input.IndexName}`);
    const { rows: all, keys } = table(input.TableName);
    const rows = input.TotalSegments ? all.filter((_r, i) => i % input.TotalSegments === (input.Segment ?? 0)) : all;
    let from = 0;
    if (input.ExclusiveStartKey) {
      const at = rows.findIndex((r) => sameKey(r, input.ExclusiveStartKey));
      if (at < 0) throw new Error('fake DynamoDB: ExclusiveStartKey is not a key of this table');
      from = at + 1;
    }
    const size = Math.max(1, Math.min(input.Limit ?? Infinity, world.pageSize ?? Infinity));
    const page = rows.slice(from, from + size);
    const items = filtered(input, page);
    const out = { Items: items, Count: items.length, ScannedCount: page.length };
    if (from + size < rows.length && page.length) out.LastEvaluatedKey = keyOf(page[page.length - 1], keys);
    return out;
  }
  if (op === 'BatchGetItem') {
    const Responses = {};
    for (const [name, req] of Object.entries(input.RequestItems)) {
      if (req.Keys.length > 100) throw new Error('fake DynamoDB: BatchGetItem takes at most 100 keys');
      const { rows } = table(name);
      Responses[name] = req.Keys.map((key) => rows.find((r) => sameKey(r, key))).filter(Boolean);
    }
    return { Responses, UnprocessedKeys: {} };
  }
  if (op === 'PutItem' || op === 'UpdateItem' || op === 'DeleteItem') {
    // TEN-03: world.flipOnUpdate = { table, set } changes the target row (e.g. to another company) just before the
    // first update of that table, as if it changed between the route's read and its write.
    const flip = world.flipOnUpdate;
    if (op === 'UpdateItem' && flip && flip.table === input.TableName && !flip.done) {
      const target = table(input.TableName).rows.find((r) => sameKey(r, input.Key));
      if (target) Object.assign(target, flip.set);
      flip.done = true;
    }
    const kind = { PutItem: 'Put', UpdateItem: 'Update', DeleteItem: 'Delete' }[op];
    const old = write(kind, input);
    const out = {};
    if (input.ReturnValues === 'ALL_OLD' && old) out.Attributes = old;
    if (input.ReturnValues === 'ALL_NEW' && kind === 'Update') out.Attributes = table(input.TableName).rows.find((r) => sameKey(r, input.Key));
    return out;
  }
  if (op === 'BatchWriteItem') {
    for (const [TableName, reqs] of Object.entries(input.RequestItems)) {
      for (const r of reqs) {
        if (r.PutRequest) write('Put', { TableName, Item: r.PutRequest.Item });
        if (r.DeleteRequest) write('Delete', { TableName, Key: r.DeleteRequest.Key });
      }
    }
    return { UnprocessedItems: {} };
  }
  if (op === 'TransactWriteItems') {
    const steps = input.TransactItems.map((t) => {
      const kind = Object.keys(t)[0];
      return [kind, t[kind]];
    });
    // REC-14 (code added only): world.clashBeforeTransact = { table, key, times, add: [department map, ...] } makes another person
    // change the row at `key` just before each of the first `times` transactions that touch it: its version goes up by one and one
    // department is added to its list, as if an Admin saved in between this caller's read and its write.
    const clash = world.clashBeforeTransact;
    if (clash && (clash.done ?? 0) < clash.times && steps.some(([, i]) => i.TableName === clash.table && sameKey(i.Key ?? i.Item ?? {}, clash.key))) {
      const target = table(clash.table).rows.find((r) => sameKey(r, clash.key));
      if (target) {
        target.version = { N: String(Number(target.version?.N ?? 0) + 1) };
        const extra = clash.add?.[clash.done ?? 0];
        if (extra) target.departments = { L: [...(target.departments?.L ?? []), extra] };
      }
      clash.done = (clash.done ?? 0) + 1;
    }
    // REC-06 (code added only): world.landBeforeTransact = { tables: { name: rows } } lets another request's whole write land just
    // before this caller's first transaction: each named table's rows are replaced by the given rows (once). The caller read the
    // world as it was; its conditions now meet the other request's rows, as two calls at once would in DynamoDB.
    const land = world.landBeforeTransact;
    if (land && !land.done) {
      for (const [name, rows] of Object.entries(land.tables ?? {})) world.tables[name] = structuredClone(rows);
      land.done = true;
    }
    // REC-06 (code added only): world.failTransactItem = { index, times? } cancels the transaction at that item (0 = the first), as
    // DynamoDB does when that item's condition fails, for the first `times` transactions (default 1) that have such an item. Nothing
    // of the transaction is written. The reasons list names the item, the others are None.
    const inject = world.failTransactItem;
    if (inject && (inject.done ?? 0) < (inject.times ?? 1) && steps.length > inject.index) {
      inject.done = (inject.done ?? 0) + 1;
      const reasons = steps.map((_s, n) => ({ Code: n === inject.index ? 'ConditionalCheckFailed' : 'None' }));
      throw new TransactionCanceledException({ message: `Transaction cancelled, please refer cancellation reasons for specific reasons [${reasons.map((r) => r.Code).join(', ')}]`, CancellationReasons: reasons });
    }
    const reasons = [];
    for (const [kind, i] of steps) {
      try { write(kind, i, true); reasons.push({ Code: 'None' }); } catch (e) {
        if (e.name !== 'ConditionalCheckFailedException') throw e;
        reasons.push({ Code: 'ConditionalCheckFailed' });
      }
    }
    if (reasons.some((r) => r.Code !== 'None')) {
      throw new TransactionCanceledException({ message: `Transaction cancelled, please refer cancellation reasons for specific reasons [${reasons.map((r) => r.Code).join(', ')}]`, CancellationReasons: reasons });
    }
    for (const [kind, i] of steps) write(kind, i);
    return {};
  }
  throw new Error(`fake DynamoDB: ${op} is not supported`);
}

// REC-05 (code added only): world.denyReads = [{ table, pk?, sk? }] refuses, with AccessDeniedException as IAM does, every read
// (GetItem, BatchGetItem, Query, Scan) of that table that would touch a row whose pk/PK starts with `pk` and whose sk/SK starts with
// `sk` (a missing prefix matches every row). A test uses it to prove a caller's answer is built without reading the candidate, the
// role or the people.
const strOf = (v) => (v && typeof v === 'object' ? v.S ?? v.N ?? '' : '');
function rowMatches(rule, row) {
  const pk = strOf(row.PK ?? row.pk);
  const sk = strOf(row.SK ?? row.sk);
  return (rule.pk === undefined || pk.startsWith(rule.pk)) && (rule.sk === undefined || sk.startsWith(rule.sk));
}
function denyRead(op, input) {
  const rules = world.denyReads;
  if (!Array.isArray(rules) || !/^(GetItem|BatchGetItem|Query|Scan)$/.test(op)) return;
  const refuse = (name) => { throw awsError('AccessDeniedException', `fake DynamoDB: this caller may not read ${name}`); };
  for (const rule of rules) {
    if (op === 'BatchGetItem') {
      const req = input.RequestItems?.[rule.table];
      if (req && (req.Keys ?? []).some((k) => rowMatches(rule, k))) refuse(rule.table);
      continue;
    }
    if (input.TableName !== rule.table) continue;
    if (op === 'GetItem') { if (rowMatches(rule, input.Key ?? {})) refuse(rule.table); continue; }
    if ((world.tables[rule.table] ?? []).some((r) => rowMatches(rule, r))) {
      // A Query or Scan is refused when any row it could read matches (the key condition is checked first for a Query).
      if (op === 'Query') {
        const k = compile(input.KeyConditionExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
        const idx = input.IndexName ? INDEXES[input.IndexName] : undefined;
        const rows = (world.tables[rule.table] ?? []).filter((r) => (!idx || idx.every((a) => r[a] !== undefined)) && k(r));
        if (rows.some((r) => rowMatches(rule, r))) refuse(rule.table);
      } else refuse(rule.table);
    }
  }
}
// REC-05 (code added only): world.raceBeforeWrite = { table, match: { attr: AttributeValue }, replace: Row } makes another request win
// between this caller's read and its write: just before the first write of any kind to that table, the row that matches `match` is
// replaced by `replace` (once). A write whose condition still names what the caller read then fails, as it would in DynamoDB.
function raceBefore(op, input) {
  const race = world.raceBeforeWrite;
  if (!race || race.done || !/^(PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems)$/.test(op)) return;
  const touches = op === 'TransactWriteItems'
    ? (input.TransactItems ?? []).some((t) => Object.values(t)[0]?.TableName === race.table)
    : op === 'BatchWriteItem' ? Boolean(input.RequestItems?.[race.table]) : input.TableName === race.table;
  if (!touches) return;
  const rows = table(race.table).rows;
  const at = rows.findIndex((r) => Object.entries(race.match).every(([k, v]) => JSON.stringify(r[k]) === JSON.stringify(v)));
  if (at >= 0) rows[at] = structuredClone(race.replace);
  race.done = true;
}

async function* pages(client, Cmd, input) {
  let key = input.ExclusiveStartKey;
  do {
    const out = await client.send(new Cmd({ ...input, ExclusiveStartKey: key }));
    yield out;
    key = out.LastEvaluatedKey;
  } while (key);
}
export function paginateScan(config, input) { return pages(config.client, ScanCommand, input); }
export function paginateQuery(config, input) { return pages(config.client, QueryCommand, input); }

export class DynamoDBClient {
  constructor() { this.config = {}; this.middlewareStack = { add() {}, use() {} }; }
  async send(cmd) { return answer(cmd.op, cmd.input); }
  destroy() {}
}
export { marshall, unmarshall, world };

// REC-16 (code added only): world.landBeforeWrite = { table, rows: [Row] } lets another run's write land just before this caller's first
// write of any kind to that table (once): each row is put (a row with the same key is replaced), as a second delivery of the same event
// running at the same time would. The caller read the world as it was; its conditions now meet the other run's rows.
function landBefore(op, input) {
  const land = world.landBeforeWrite;
  if (!land || land.done || !/^(PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems)$/.test(op)) return;
  const touches = op === 'TransactWriteItems'
    ? (input.TransactItems ?? []).some((t) => Object.values(t)[0]?.TableName === land.table)
    : op === 'BatchWriteItem' ? Boolean(input.RequestItems?.[land.table]) : input.TableName === land.table;
  if (!touches) return;
  const { rows, keys } = table(land.table);
  for (const r of land.rows ?? []) {
    const at = rows.findIndex((x) => sameKey(x, keyOf(r, keys)));
    if (at >= 0) rows[at] = structuredClone(r); else rows.push(structuredClone(r));
  }
  land.done = true;
}
