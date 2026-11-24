// REC-07: the stored scoring rows of one candidate, and the numbers kept on an interview row after every vote.
import { DynamoDBClient, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as T from './tenant.mjs';
import { DEFAULTS } from './recruitment-settings.mjs';
import * as S from './scoring.mjs';

const db = new DynamoDBClient({});
const STATE = () => process.env.STATE_TABLE_NAME;

export async function candidateRows(candidateId) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const r = await db.send(new QueryCommand({ TableName: STATE(), KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${candidateId}` }), ExclusiveStartKey }));
    out.push(...(r.Items ?? []).map((i) => unmarshall(i)));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

export async function recomputeInterview(tenantId, interview, settings) {
  const rows = await candidateRows(interview.candidateId);
  const votes = rows.filter((r) => String(r.SK).startsWith('VOTE#') && T.ownsRow(r, tenantId));
  const n = S.interviewNumbers(interview, S.criteriaOf(interview, settings, DEFAULTS), votes);
  const values = { ':p': n.pending, ':s': n.split, ':one': 1, ':t': tenantId };
  let expr = 'SET PANEL_FEEDBACK_PENDING_COUNT = :p, PANEL_SPLIT_FLAG = :s';
  if (n.consensus !== null) { expr += ', PANEL_CONSENSUS = :c'; values[':c'] = n.consensus; }
  await db.send(new UpdateItemCommand({ TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${interview.candidateId}`, SK: `INTERVIEW#${interview.interviewId}` }), UpdateExpression: `${expr} ADD votesSubmitted :one`, ConditionExpression: 'tenant_id = :t', ExpressionAttributeValues: marshall(values) }));
  return n;
}
