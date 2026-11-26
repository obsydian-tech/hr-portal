// REC-07: the stored scoring rows of one candidate, and the numbers kept on an interview row after every vote.
// INT-01 (R-7, R-19): reads are strong; the counter is raised in the vote's own transaction; done is set here.
import { DynamoDBClient, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as T from './tenant.mjs';
import { DEFAULTS } from './recruitment-settings.mjs';
import * as S from './scoring.mjs';
import { everyoneVoted, isNewWay } from './interview-lifecycle.mjs';

const db = new DynamoDBClient({});
const eb = new EventBridgeClient({});
const STATE = () => process.env.STATE_TABLE_NAME;

export async function candidateRows(candidateId) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const r = await db.send(new QueryCommand({ TableName: STATE(), KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${candidateId}` }), ConsistentRead: true, ExclusiveStartKey }));
    out.push(...(r.Items ?? []).map((i) => unmarshall(i)));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

/**
 * INT-01.F rule 2: the clause that ties a write to the interview copy it was judged on. Callers name '#q' as 'sequence'.
 * A new-way copy needs the same sequence; an old-way copy (no sequence) needs the row to still have none.
 */
export function sequenceClause(iv) {
  return isNewWay(iv) ? { expr: '#q = :seqRead', values: { ':seqRead': iv.sequence } } : { expr: 'attribute_not_exists(#q)', values: {} };
}

/** `interview` must be the strong copy the successful vote was conditioned on; the done write holds the same sequence clause. */
export async function recomputeInterview(tenantId, interview, settings) {
  const rows = await candidateRows(interview.candidateId);
  const votes = rows.filter((r) => String(r.SK).startsWith('VOTE#') && T.ownsRow(r, tenantId));
  const n = S.interviewNumbers(interview, S.criteriaOf(interview, settings, DEFAULTS), votes);
  const values = { ':p': n.pending, ':s': n.split, ':t': tenantId };
  let expr = 'SET PANEL_FEEDBACK_PENDING_COUNT = :p, PANEL_SPLIT_FLAG = :s';
  if (n.consensus !== null) { expr += ', PANEL_CONSENSUS = :c'; values[':c'] = n.consensus; }
  await db.send(new UpdateItemCommand({ TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${interview.candidateId}`, SK: `INTERVIEW#${interview.interviewId}` }), UpdateExpression: expr, ConditionExpression: 'tenant_id = :t', ExpressionAttributeValues: marshall(values) }));
  // R-19: done by itself when every panel person and the guest have a new-format vote (counted with the strong read above).
  if (interview.status === 'SCHEDULED' && everyoneVoted(interview, votes)) {
    const now = new Date().toISOString();
    const seq = sequenceClause(interview);
    try {
      const r = await db.send(new UpdateItemCommand({
        TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${interview.candidateId}`, SK: `INTERVIEW#${interview.interviewId}` }),
        UpdateExpression: 'SET #s = :done, completed_by = :sys, completed_at = :now, completedAt = :now', ConditionExpression: `tenant_id = :t AND #s = :sch AND ${seq.expr}`,
        ExpressionAttributeNames: { '#s': 'status', '#q': 'sequence' }, ExpressionAttributeValues: marshall({ ':done': 'COMPLETED', ':sys': 'SYSTEM', ':now': now, ':t': tenantId, ':sch': 'SCHEDULED', ...seq.values }), ReturnValues: 'ALL_NEW',
      }));
      const iv = unmarshall(r.Attributes ?? {});
      const entry = { EventBusName: process.env.EVENTBRIDGE_BUS_NAME, Source: 'talent-flow.interviews', DetailType: 'INTERVIEW_DONE', Detail: JSON.stringify({
        candidateId: interview.candidateId, tenant_id: tenantId, interviewId: interview.interviewId, interviewType: interview.interviewType, sequence: iv.sequence ?? interview.sequence ?? null, actor: 'SYSTEM',
      }) };
      let sent = false;
      for (let i = 0; i < 2 && !sent; i++) { try { await eb.send(new PutEventsCommand({ Entries: [entry] })); sent = true; } catch { /* once more */ } }
      if (!sent) console.error('interview done: event not sent', { error: 'INTERVIEW_EVENT_NOT_SENT', eventType: 'INTERVIEW_DONE' });
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    }
  }
  return n;
}
