/**
 * CHAT-02: where Ask Batsi keeps each person's chats (table ask-batsi-chats, one table for both chat Lambdas).
 *
 *   pk  T#<company>#S#<person>   the company and the person, both from the sign-in, never from the request
 *   sk  CHAT#<id>                the chat's header: chat_id, title, created, updated, message_count, tenant_id, staff_id
 *   sk  MSG#<id>#0001 ...        one item per message: role (person | batsi), text, at, tools, proposal_ids, tenant_id, chat_id
 *
 * Rules this file keeps (card CHAT-02 and its security review, 18 Nov 2026):
 *  - Every title and message is passed through the shared redactor (lambda/shared/pii-redact.mjs) before it is written.
 *  - The chat id is made here (a ULID). A client's id is only ever looked up under the signed-in person's own key, so
 *    another person's, another company's or a made-up id is "not found" (404), never a new chat.
 *  - A question is written with one transaction: the header moves from the count the writer read (or is created) and the
 *    two messages are new keys. A question that races a delete finds no header and creates nothing; two tabs asking at
 *    once cannot take the same message number (the second one re-reads and writes after the first).
 *  - Deleting is real removal (BatchWriteItem), messages first and the header last, and never answers success while a
 *    row is left (UnprocessedItems are retried; if some are still left it throws).
 *  - Nothing here logs a title, a message or an AWS message. Logs hold error names only.
 */
import { randomBytes } from 'node:crypto';
import { BatchWriteItemCommand, DynamoDBClient, GetItemCommand, QueryCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { redactNumbers } from './pii-redact.mjs';
import { ownsRow } from './tenant.mjs';

export const CHAT_ID_PATTERN = /^[0-9A-Z]{26}$/;
export const PAGE_SIZE = 50;
export const TITLE_MAX = 80;
/** A stored message is cut here, well under DynamoDB's 400 KB item limit. */
export const TEXT_MAX = 20_000;
/** The newest messages of a chat the model is shown again with a new question. */
export const HISTORY_MAX = 40;
const APPEND_TRIES = 4;
const DELETE_TRIES = 6;

let client;
const ddb = () => (client ??= new DynamoDBClient({}));
const table = () => process.env.CHATS_TABLE;

export class ChatNotFound extends Error {
  constructor() { super('Chat not found'); this.name = 'ChatNotFound'; }
}
export class ChatNotDeleted extends Error {
  constructor() { super('Some rows were not deleted'); this.name = 'ChatNotDeleted'; }
}
export class BadPageToken extends Error {
  constructor() { super('Bad page token'); this.name = 'BadPageToken'; }
}

// ---------------------------------------------------------------- keys and ids

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID: ten characters of time, sixteen random ones. Sorts by creation time. */
export function newChatId(now = Date.now()) {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }
  const bytes = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] % 32];
  return time + rand;
}

export const isChatId = (id) => typeof id === 'string' && CHAT_ID_PATTERN.test(id);
export const ownerKey = (tenantId, staffId) => `T#${tenantId}#S#${staffId}`;
const messageKey = (id, n) => `MSG#${id}#${String(n).padStart(4, '0')}`;

/** A title: the first question, cleaned, at most 80 characters. */
export function titleOf(question) {
  const clean = redactNumbers(String(question ?? '')).replace(/\s+/g, ' ').trim();
  if (clean.length <= TITLE_MAX) return clean;
  return `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}
const textOf = (value) => redactNumbers(String(value ?? '')).slice(0, TEXT_MAX);

// ---------------------------------------------------------------- reading

const s = (v) => ({ S: v });
const n = (v) => ({ N: String(v) });
const list = (values) => ({ L: values.map((v) => ({ S: v })) });
const plainList = (a) => (Array.isArray(a?.L) ? a.L.map((x) => x?.S).filter((x) => typeof x === 'string') : Array.isArray(a?.SS) ? [...a.SS] : []);

function headerOf(item) {
  return {
    chatId: item.chat_id?.S,
    title: item.title?.S ?? '',
    created: item.created?.S,
    updated: item.updated?.S,
    messageCount: Number(item.message_count?.N ?? 0),
    tenantId: item.tenant_id?.S,
  };
}

/** The header of one chat of this person, or null. Another person's, another company's or a made-up id is null. */
export async function getHeader(tenantId, staffId, chatId) {
  if (!isChatId(chatId)) return null;
  const res = await ddb().send(new GetItemCommand({
    TableName: table(),
    Key: { pk: s(ownerKey(tenantId, staffId)), sk: s(`CHAT#${chatId}`) },
    ConsistentRead: true,
  }));
  if (!res.Item) return null;
  const header = headerOf(res.Item);
  return ownsRow({ tenant_id: header.tenantId }, tenantId) ? header : null;
}

/** Every page of a Query, followed to the end (or until `enough` says stop). */
async function queryAll(input, enough = () => false) {
  const items = [];
  let start;
  do {
    const res = await ddb().send(new QueryCommand({ ...input, ExclusiveStartKey: start }));
    items.push(...(res.Items ?? []));
    start = res.LastEvaluatedKey;
  } while (start && !enough(items));
  return items;
}

/** The person's chats, newest use first, PAGE_SIZE to a page. `token` is the one this function gave for the next page. */
export async function listChats(tenantId, staffId, token) {
  const after = token === undefined || token === '' ? null : readToken(token);
  const items = await queryAll({
    TableName: table(),
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :chat)',
    ExpressionAttributeValues: { ':pk': s(ownerKey(tenantId, staffId)), ':chat': s('CHAT#') },
    ProjectionExpression: 'chat_id, #title, updated, tenant_id',
    ExpressionAttributeNames: { '#title': 'title' },
  });
  const all = items
    .map((item) => ({ ...headerOf(item) }))
    .filter((h) => isChatId(h.chatId) && ownsRow({ tenant_id: h.tenantId }, tenantId))
    .sort((a, b) => (a.updated === b.updated ? (a.chatId < b.chatId ? 1 : -1) : String(a.updated) < String(b.updated) ? 1 : -1));
  const from = after ? all.findIndex((h) => h.updated === after.u && h.chatId === after.c) + 1 : 0;
  const page = all.slice(from, from + PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    chats: page.map((h) => ({ chatId: h.chatId, title: h.title, updated: h.updated })),
    ...(from + PAGE_SIZE < all.length && last ? { nextToken: makeToken(last) } : {}),
  };
}

const makeToken = (h) => Buffer.from(JSON.stringify({ u: h.updated, c: h.chatId })).toString('base64url');
function readToken(token) {
  try {
    const v = JSON.parse(Buffer.from(String(token), 'base64url').toString('utf8'));
    if (typeof v?.u === 'string' && isChatId(v?.c)) return v;
  } catch { /* fall through */ }
  throw new BadPageToken();
}

function messageOf(item) {
  const tools = plainList(item.tools);
  const proposals = plainList(item.proposal_ids);
  return {
    role: item.role?.S === 'batsi' ? 'batsi' : 'person',
    text: item.text?.S ?? '',
    at: item.at?.S,
    ...(tools.length ? { tools } : {}),
    ...(proposals.length ? { proposalIds: proposals } : {}),
  };
}

/** One chat with every message in order, or null (not this person's, not this company's, or not there). */
export async function getChat(tenantId, staffId, chatId) {
  const header = await getHeader(tenantId, staffId, chatId);
  if (!header) return null;
  const items = await queryAll({
    TableName: table(),
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :msg)',
    ExpressionAttributeValues: { ':pk': s(ownerKey(tenantId, staffId)), ':msg': s(`MSG#${chatId}#`) },
  });
  return { chatId, title: header.title, created: header.created, updated: header.updated, messages: items.map(messageOf) };
}

/**
 * The newest HISTORY_MAX messages of a chat, oldest first, as the model's turns ({ role: 'user' | 'assistant', content }).
 * The history is always the server's: nothing the request says about earlier turns is read.
 */
export async function historyOf(tenantId, staffId, chatId) {
  const items = await queryAll({
    TableName: table(),
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :msg)',
    ExpressionAttributeValues: { ':pk': s(ownerKey(tenantId, staffId)), ':msg': s(`MSG#${chatId}#`) },
    ScanIndexForward: false,
  }, (got) => got.length >= HISTORY_MAX);
  const newest = items.slice(0, HISTORY_MAX).reverse().map(messageOf);
  while (newest.length && newest[0].role !== 'person') newest.shift(); // the model's first turn is a person's
  return newest.map((m) => ({ role: m.role === 'person' ? 'user' : 'assistant', content: m.text }));
}

// ---------------------------------------------------------------- writing

const isCancelled = (err) => err?.name === 'TransactionCanceledException' || err?.name === 'ConditionalCheckFailedException';

function messageItem(base, chatId, number, role, text, at, extra = {}) {
  return {
    pk: s(base.pk),
    sk: s(messageKey(chatId, number)),
    chat_id: s(chatId),
    role: s(role),
    text: s(textOf(text)),
    at: s(at),
    tenant_id: s(base.tenantId),
    ...(extra.tools?.length ? { tools: list(extra.tools) } : {}),
    ...(extra.proposalIds?.length ? { proposal_ids: list(extra.proposalIds) } : {}),
  };
}

/**
 * Keeps one question and its answer. `chatId` undefined or null starts a new chat. Returns the chat's id.
 * Throws ChatNotFound when the chat is gone (deleted while the model was answering), or the AWS error.
 */
export async function appendExchange({ tenantId, staffId, chatId, question, answer, tools = [], proposalIds = [] }) {
  const base = { pk: ownerKey(tenantId, staffId), tenantId };
  const at = new Date().toISOString();
  const put = (item, condition) => ({ Put: { TableName: table(), Item: item, ConditionExpression: condition } });
  const notThere = 'attribute_not_exists(pk) AND attribute_not_exists(sk)';

  if (chatId === undefined || chatId === null) {
    const id = newChatId();
    const header = {
      pk: s(base.pk), sk: s(`CHAT#${id}`), chat_id: s(id), title: s(titleOf(question)), created: s(at), updated: s(at),
      message_count: n(2), tenant_id: s(tenantId), staff_id: s(staffId),
    };
    await ddb().send(new TransactWriteItemsCommand({
      TransactItems: [
        put(header, notThere),
        put(messageItem(base, id, 1, 'person', question, at), notThere),
        put(messageItem(base, id, 2, 'batsi', answer, at, { tools, proposalIds }), notThere),
      ],
    }));
    return id;
  }

  for (let attempt = 0; attempt < APPEND_TRIES; attempt++) {
    const header = await getHeader(tenantId, staffId, chatId);
    if (!header) throw new ChatNotFound();
    const next = header.messageCount;
    try {
      await ddb().send(new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: table(),
              Key: { pk: s(base.pk), sk: s(`CHAT#${chatId}`) },
              UpdateExpression: 'SET message_count = :count, updated = :now',
              ConditionExpression: 'attribute_exists(pk) AND message_count = :was',
              ExpressionAttributeValues: { ':count': n(next + 2), ':now': s(at), ':was': n(next) },
            },
          },
          put(messageItem(base, chatId, next + 1, 'person', question, at), notThere),
          put(messageItem(base, chatId, next + 2, 'batsi', answer, at, { tools, proposalIds }), notThere),
        ],
      }));
      return chatId;
    } catch (err) {
      if (!isCancelled(err)) throw err;
      // Someone else wrote first (or the chat was deleted): read again. A deleted chat is ChatNotFound on the next turn.
    }
  }
  throw Object.assign(new Error('The chat kept changing'), { name: 'ChatBusy' });
}

// ---------------------------------------------------------------- deleting

async function keysOf(input) {
  const items = await queryAll({ ...input, ProjectionExpression: 'pk, sk' });
  return items.map((i) => ({ pk: i.pk, sk: i.sk }));
}

/** Deletes the keys, 25 to a batch, and retries what DynamoDB left unprocessed. Throws ChatNotDeleted if any is left. */
export async function deleteKeys(keys) {
  const name = table();
  for (let i = 0; i < keys.length; i += 25) {
    let pending = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
    for (let attempt = 0; pending.length && attempt < DELETE_TRIES; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(50 * 2 ** attempt, 1000)));
      const res = await ddb().send(new BatchWriteItemCommand({ RequestItems: { [name]: pending } }));
      pending = res?.UnprocessedItems?.[name] ?? [];
    }
    if (pending.length) throw new ChatNotDeleted();
  }
}

/** Header and every message of one chat. Returns false when there was no such chat of this person. */
export async function deleteChat(tenantId, staffId, chatId) {
  const header = await getHeader(tenantId, staffId, chatId);
  if (!header) return false;
  const pk = ownerKey(tenantId, staffId);
  const messages = await keysOf({
    TableName: table(),
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :msg)',
    ExpressionAttributeValues: { ':pk': s(pk), ':msg': s(`MSG#${chatId}#`) },
  });
  await deleteKeys([...messages, { pk: s(pk), sk: s(`CHAT#${chatId}`) }]);
  return true;
}

/** Every row of this person, messages before headers. Nothing else is touched: the key holds the company and the person. */
export async function deleteAllChats(tenantId, staffId) {
  const pk = ownerKey(tenantId, staffId);
  const rows = await keysOf({
    TableName: table(),
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': s(pk) },
  });
  const isHeader = (k) => String(k.sk.S).startsWith('CHAT#');
  await deleteKeys([...rows.filter((k) => !isHeader(k)), ...rows.filter(isHeader)]);
  return rows.length;
}

// ---------------------------------------------------------------- the audit record

function deep(v) {
  if (typeof v === 'string') return redactNumbers(v);
  if (typeof v === 'number') return String(Math.trunc(Math.abs(v))).length >= 6 ? '[removed]' : v;
  if (Array.isArray(v)) return v.map(deep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]));
  return v;
}

/**
 * What an Ask Batsi audit record keeps of a tool call ({ "tool#0": { called_at, request, response, ... } }): the request and the
 * answer with every run of six or more digits taken out, at any depth. The times, the count and the status stay as they are.
 */
export function redactToolOutputs(raw) {
  return Object.fromEntries(Object.entries(raw ?? {}).map(([name, entry]) => [name, { ...entry, request: deep(entry?.request), response: deep(entry?.response) }]));
}
