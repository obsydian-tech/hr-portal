// REC-UI-03 step 3 (G-10a): GET /v1/interviews/{id}, one interview for its panel member. Reads only.
import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as T from '../shared/tenant.mjs';
import * as RA from '../shared/recruitment-access.mjs';
import { requireModule } from '../shared/modules.mjs';
import { activeSettings, DEFAULTS } from '../shared/recruitment-settings.mjs';
import { voteRefusalOf } from '../shared/interview-lifecycle.mjs';
import * as S from '../shared/scoring.mjs';
import { candidateRows } from '../shared/interview-scoring.mjs';

const db = new DynamoDBClient({});
const STATE = () => process.env.STATE_TABLE_NAME;

export async function read(event) {
  const t = T.requireTenant(event);
  if (t.refusal) return t.refusal;
  const off = await requireModule(event, 'recruitment');
  if (off) return off;
  const tenantId = t.tenantId;
  const ivId = event.pathParameters?.id;
  if (!ivId || typeof ivId !== 'string') return T.notFound();
  const me = RA.callerId(event);
  try {
    const r = await db.send(new QueryCommand({ TableName: STATE(), IndexName: 'interview-id-index', KeyConditionExpression: 'interviewId = :i', ExpressionAttributeValues: marshall({ ':i': ivId }) }));
    let iv = (r.Items ?? []).map((i) => unmarshall(i)).find((x) => String(x.SK).startsWith('INTERVIEW#') && T.ownsRow(x, tenantId));
    if (!iv) return T.notFound();
    const strong = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${iv.candidateId}`, SK: `INTERVIEW#${iv.interviewId}` }), ConsistentRead: true }));
    iv = strong.Item ? unmarshall(strong.Item) : null;
    if (!iv || !T.ownsRow(iv, tenantId)) return T.notFound();
    const sagaRes = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${iv.candidateId}`, SK: 'SAGA' }) }));
    const saga = sagaRes.Item ? unmarshall(sagaRes.Item) : null;
    if (!saga || !T.ownsRow(saga, tenantId)) return T.notFound();
    if (!RA.panelMemberOf(iv, me)) return T.notFound();
    const settings = await activeSettings(tenantId);
    const criteria = S.criteriaOf(iv, settings, DEFAULTS).map((c) => ({ key: c.key, label: c.label }));
    const rows = (await candidateRows(iv.candidateId)).filter((x) => T.ownsRow(x, tenantId));
    const mine = rows.find((x) => String(x.SK).startsWith(`VOTE#${me}#`) && x.interviewId === iv.interviewId);
    const myVote = mine ? { rating: mine.rating ?? null, overall: S.oneDecimal(S.mean(criteria.map((c) => mine.scores?.[c.key]).filter((n) => Number.isFinite(n)))) } : null;
    const refusal = voteRefusalOf(iv, Date.now());
    const can = { capture_feedback: !mine && !refusal };
    const out = {
      id: iv.interviewId, candidate_first: saga.firstName ?? null, candidate_last: saga.lastName ?? null, role_title: saga.positionTitle ?? null,
      type: iv.interviewType ?? null, at: iv.scheduledAt ?? null, status: iv.status ?? null, criteria,
      my_feedback: mine ? 'GIVEN' : 'WAITING', my_vote: myVote, can,
    };
    if (!can.capture_feedback) out.why = mine ? 'GIVEN' : refusal === 'NOT_STARTED' ? 'NOT_STARTED' : 'CLOSED';
    return S.json(200, out);
  } catch (err) {
    console.error('submitVote: interview read failed', { error: err.name });
    return S.json(500, { error: 'Internal error' });
  }
}
