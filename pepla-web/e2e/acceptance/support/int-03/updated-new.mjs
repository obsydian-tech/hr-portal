// INT-03: test support only, no application code. A preload (NODE_OPTIONS --import) for one Lambda run. REC-14's fake DynamoDB
// (support/rec-14/fake-aws, locked, unchanged) answers ReturnValues ALL_NEW and ALL_OLD but not UPDATED_NEW, so the old vote path
// (submitVoteByToken, which reads votesSubmitted back with UPDATED_NEW) never reaches its quorum and never publishes VotingCompleted.
// This answers UPDATED_NEW with the whole new row (DynamoDB returns only the updated attributes; the handler reads votesSubmitted,
// which is one of them), so the publish path (and its failure) can run. Nothing else changes.
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fake = await import(pathToFileURL(join(here, '..', 'rec-14', 'fake-aws', 'client-dynamodb.mjs')).href);
const send = fake.DynamoDBClient.prototype.send;
fake.DynamoDBClient.prototype.send = async function (cmd) {
  if (cmd?.op === 'UpdateItem' && cmd.input?.ReturnValues === 'UPDATED_NEW') {
    const out = await send.call(this, { op: cmd.op, input: { ...cmd.input, ReturnValues: 'ALL_NEW' } });
    return out;
  }
  return send.call(this, cmd);
};
// Lock check round 1: anything written straight to stdout or stderr (console.dir, process.stdout.write) is recorded as a log line too,
// as a real Lambda sends both to CloudWatch. The result line run.mjs prints is left out.
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => {
    const text = String(chunk);
    if (!text.startsWith('\n@@TEN03@@')) console.log(text);
    return write(chunk, ...rest);
  };
}
