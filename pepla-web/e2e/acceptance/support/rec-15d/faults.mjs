// REC-15 step D: test support only, no application code. A preload (NODE_OPTIONS --import) for one Lambda run against REC-14's fake AWS,
// so a test can make one person's name lookups fail the way AWS can (spec rule 24(d), AC-14).
//   REC15D_FAULTS = JSON { "pool": { "<username>": "<ErrorName>" }, "member": { "<sub>": "<ErrorName>" } }
//   pool:   an AdminGetUser call for that username is recorded, then throws an error with that name.
//   member: a Query of the tenants table for that sign-in's Member rows (a key value "USER#<sub>") is recorded, then throws.
// The error's message is FAULT_MESSAGE, which no answer and no log line may hold. Anything else goes to the fake as before.
const here = new URL('../rec-14/fake-aws/', import.meta.url);
const faults = JSON.parse(process.env.REC15D_FAULTS || '{}');
export const FAULT_MESSAGE = 'zz-rec15d-fault-message';
const { calls } = await import(new URL('world.mjs', here).href);
const cognito = await import(new URL('client-cognito.mjs', here).href);
const dynamo = await import(new URL('client-dynamodb.mjs', here).href);
const doc = await import(new URL('lib-dynamodb.mjs', here).href);

const fault = (name) => {
  const e = new Error(FAULT_MESSAGE);
  e.name = name;
  e.$fault = 'client';
  e.$metadata = { httpStatusCode: 400 };
  return e;
};
const valuesOf = (input) => Object.values(input?.ExpressionAttributeValues ?? {}).map((v) => (v && typeof v === 'object' && 'S' in v ? v.S : v));

const sendPool = cognito.CognitoIdentityProviderClient.prototype.send;
cognito.CognitoIdentityProviderClient.prototype.send = async function send(cmd) {
  const name = cmd?.op === 'AdminGetUser' ? faults.pool?.[cmd?.input?.Username] : undefined;
  if (name) { calls.push({ service: 'cognito', op: cmd.op, input: cmd.input }); throw fault(name); }
  return sendPool.call(this, cmd);
};
const memberFault = (cmd) => {
  if (cmd?.op !== 'Query' || !/tenants$/.test(String(cmd?.input?.TableName ?? ''))) return undefined;
  for (const v of valuesOf(cmd.input)) {
    const m = typeof v === 'string' ? /^USER#(.+)$/.exec(v) : null;
    if (m && faults.member?.[m[1]]) return faults.member[m[1]];
  }
  return undefined;
};
for (const C of [dynamo.DynamoDBClient, doc.DynamoDBDocumentClient]) {
  const send = C.prototype.send;
  C.prototype.send = async function sendWithFaults(cmd) {
    const name = memberFault(cmd);
    if (name) { calls.push({ service: 'dynamodb', op: cmd.op, table: cmd.input.TableName, input: cmd.input }); throw fault(name); }
    return send.call(this, cmd);
  };
}
