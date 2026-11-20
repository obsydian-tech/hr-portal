'use strict';

/**
 * TEN-03: the company helper (tenant.mjs) for the CommonJS TalentFlow, IT task and provisioning bundle handlers.
 *
 * tenant.mjs is an ES module, so a CommonJS handler loads it once with import() (no flag, works on every Node 22).
 * The rule is the one in tenant.mjs: requireTenant right after the group or role check, ownsRow on every row read
 * by key (another company's row is notFound(), 404), stampTenant on every row written, tenantKey for keys that hold
 * a company. The company never comes from the body, query, path or headers.
 *
 *   const T = await tenantHelper();
 *   const { tenantId, refusal } = T.requireTenant(event);
 *   if (refusal) return refusal;
 */
let loaded;
function tenantHelper() {
  if (!loaded) loaded = import('./tenant.mjs');
  return loaded;
}

/** The company of a stored row (or a stream image in AttributeValue form), or null when it has none. */
function companyOfRow(row) {
  if (!row) return null;
  const v = row.tenant_id;
  if (typeof v === 'string') return v;
  if (v && typeof v.S === 'string') return v.S;
  return null;
}

/**
 * Adds "the row still belongs to this company" to a write (UpdateItem, PutItem, DeleteItem input in AttributeValue
 * form). A row that became another company's before the write fails the condition (ConditionalCheckFailedException),
 * which the handler answers with 404. Returns the same input object.
 */
function scopeWrite(input, tenantId) {
  const clause = '#tf_tenant = :tf_tenant';
  input.ConditionExpression = input.ConditionExpression ? `(${input.ConditionExpression}) AND ${clause}` : clause;
  input.ExpressionAttributeNames = { ...(input.ExpressionAttributeNames || {}), '#tf_tenant': 'tenant_id' };
  input.ExpressionAttributeValues = { ...(input.ExpressionAttributeValues || {}), ':tf_tenant': { S: tenantId } };
  return input;
}

/** True when the error is a failed condition (the row is gone, or belongs to another company now). */
const conditionFailed = (err) => err && err.name === 'ConditionalCheckFailedException';

/**
 * The company an event (EventBridge detail, SQS body, stream record) names in tenant_id, or null when it names none
 * or not a company id. Events never name it any other way (tenantId is not read).
 */
async function eventTenant(detail) {
  const T = await tenantHelper();
  const v = detail && detail.tenant_id;
  return typeof v === 'string' && T.TENANT_ID_PATTERN.test(v) ? v : null;
}

/**
 * True when the candidate's SAGA row exists and is this company's. Tile routes act on a candidate's tile, so they
 * are judged through the candidate they name. send is the handler's DynamoDBClient.send, QueryCommand its class (a Query on the table: every tile role that reads the state table already may Query it).
 */
async function candidateIsOurs(send, QueryCommand, table, candidateId, tenantId) {
  const T = await tenantHelper();
  const res = await send(new QueryCommand({
    TableName: table,
    KeyConditionExpression: 'PK = :pk AND SK = :sk',
    ExpressionAttributeValues: { ':pk': { S: `CANDIDATE#${candidateId}` }, ':sk': { S: 'SAGA' } },
    Limit: 1,
  }));
  const item = res.Items && res.Items[0];
  return !!item && T.ownsItem(item, tenantId);
}

module.exports = { candidateIsOurs, tenantHelper, companyOfRow, scopeWrite, conditionFailed, eventTenant };
