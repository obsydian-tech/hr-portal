// REC-12: runs the Recruitment seed (the Standard pack) once, the way scripts/tenancy/lib/set-modules.mjs calls it:
//   <seed file> <company id> <dev|prod>
// It runs under script-run.mjs, so every AWS client is the fake and the world after the run is written out.
import { pathToFileURL } from 'node:url';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
const [seedFile, tenantId, env] = process.argv.slice(2);
const seed = await import(pathToFileURL(seedFile).href);
const run = seed.default ?? seed.seed;
await run({ ddb: new DynamoDBClient({}), env, tenantId, table: `naleko-people-${env}-tenants`, log: (line) => console.log(line) });
