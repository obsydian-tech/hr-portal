// ONB-22 (security review R-1): after the claim, a failed read or write never escapes. Run: node --test index.test.mjs
// The AWS SDK is replaced by recording stubs through a module hook, so this needs nothing installed and calls nothing.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const stub = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const MAP = {
  '@aws-sdk/client-dynamodb': stub(`
    const mk = (name) => class { constructor(input) { this.name = name; this.input = input; } };
    export class DynamoDBClient { send(cmd) { return globalThis.__stub.db(cmd); } }
    export const GetItemCommand = mk('GetItem'), QueryCommand = mk('Query'), UpdateItemCommand = mk('UpdateItem');`),
  '@aws-sdk/client-eventbridge': stub(`
    export class EventBridgeClient { send(cmd) { return globalThis.__stub.bus(cmd); } }
    export class PutEventsCommand { constructor(input) { this.input = input; } }`),
  '@aws-sdk/util-dynamodb': stub(`
    const to = (v) => typeof v === 'number' ? { N: String(v) } : { S: String(v) };
    export const marshall = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, to(v)]));
    export const unmarshall = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.N !== undefined ? Number(v.N) : v.S]));`),
};
register('data:text/javascript,' + encodeURIComponent(`
  const MAP = ${JSON.stringify(MAP)};
  export async function resolve(s, c, next) { return MAP[s] ? { url: MAP[s], shortCircuit: true } : next(s, c); }`));

const TENANT = 'ten_' + 'a'.repeat(26);
process.env.EVENT_BUS_NAME = 'bus';
process.env.REVIEW_FUNCTION_NAME = 'review';
const { handler } = await import('./index.mjs');

const row = { actionId: 'act-1', type: 'ACCEPT_DOCUMENT', status: 'PENDING_APPROVAL', tenant_id: TENANT, expiresAt: Math.floor(Date.now() / 1000) + 3600,
  document_id: 'doc-1', employee_id: 'emp-1', createdAt: '2026-11-18T08:00:00Z', proposed_by_kind: 'AGENT', proposed_by_id: 'default' };
const event = () => ({
  rawPath: '/agent/v1/actions/act-1/approve',
  requestContext: { http: { method: 'POST' }, authorizer: { jwt: { claims: { 'cognito:groups': 'hr_staff', email: 'hr@example.com', given_name: 'Hana', family_name: 'Roos', tenant_id: TENANT } } } },
});

function run({ failDocumentRead = false, failFinalWrite = false }) {
  const log = { updates: [], events: [] };
  globalThis.__stub = {
    bus: async (cmd) => { log.events.push(JSON.parse(cmd.input.Entries[0].Detail)); return {}; },
    db: async (cmd) => {
      if (cmd.name === 'GetItem' && cmd.input.TableName === 'naleko-pending-actions') {
        return { Item: Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'number' ? { N: String(v) } : { S: v }])) };
      }
      if (cmd.name === 'GetItem') { if (failDocumentRead) throw Object.assign(new Error('secret words'), { name: 'ProvisionedThroughputExceededException' }); return {}; }
      if (cmd.name === 'UpdateItem') {
        const isFinal = !String(cmd.input.ConditionExpression).includes(':pending');
        if (isFinal && failFinalWrite) throw Object.assign(new Error('secret words'), { name: 'InternalServerError' });
        log.updates.push(cmd.input);
        return {};
      }
      throw new Error('unexpected ' + cmd.name);
    },
  };
  return handler(event()).then((res) => ({ res, log }));
}

test('a failed document read after the claim is FAILED RUN_FAILED, answered 200, and the event is published', async () => {
  const { res, log } = await run({ failDocumentRead: true });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.run_status, 'FAILED');
  assert.equal(body.error_code, 'RUN_FAILED');
  assert.equal(log.events.length, 1);
  assert.equal(log.events[0].run_status, 'FAILED');
  assert.doesNotMatch(res.body, /secret words/);
});

test('a failed final write after the run still answers 200 and publishes the event', async () => {
  const { res, log } = await run({ failFinalWrite: true });
  assert.equal(res.statusCode, 200);
  assert.equal(log.events.length, 1);
  assert.equal(log.events[0].approved_by, 'hr@example.com');
});
