/**
 * REC-03: a person moves a candidate one step along the open stages, forward or back, and always gives a reason.
 *
 *   moveCandidate   PUT /v1/candidates/{id}/stage   body { to, reason }
 *
 * The handler (lambda/advanceCandidateStage) has already run the role check, requireTenant and requireModule. This file does the
 * work. ctx = { tenantId, personId, event }: the company and the person come from the sign-in, never from a request value.
 * Another company's candidate answers 404, the same as one that does not exist. Nothing here calls a model.
 *
 * Rules (REC-00 and the card):
 *  - Hired and Not hired are never reached from here: Hired comes with an accepted offer, Not hired with REC-02's route.
 *  - One step at a time along the company's own list (Screening is a setting). Forward or back, nothing else.
 *  - A reason (1 to 1000 characters) on every move. It is stored on the history row and nowhere else: not on the candidate's row,
 *    not in the event, not in a log line.
 *  - Interview to Offer is the gate: only a person who may decide (Recruiter, or the hiring manager when the level's decider is
 *    HR_OR_HM) and only once every interview type required for the level is COMPLETED.
 *  - Back from Offer is refused while an offer is live.
 *  - A hiring manager may make that one move and no other.
 */
import { DynamoDBClient, GetItemCommand, QueryCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { json } from '../hr-group.mjs';
import { ownsRow, stampTenant } from '../tenant.mjs';
import { canDecide, isManager, isRecruiter, hiringManagerOf } from '../recruitment-access.mjs';
import { getRecruitmentSettings } from '../recruitment-settings.mjs';
import { STAGE_CODES, normaliseStage, openStages } from '../recruitment-stages.mjs';
import { moveDeciderOf, requiredInterviews } from './candidate-progress.mjs';

const db = new DynamoDBClient({});
const bus = new EventBridgeClient({});
const STATE = () => process.env.STATE_TABLE_NAME ?? 'talent-flow-state';
const BUS = () => process.env.EVENTBRIDGE_BUS_NAME ?? 'talent-flow-bus';

const MAX_REASON = 1000;
// An offer that is in approval or already sent: the states the offer routes write today (a draft, OFFER_CREATED, is not live), and
// the names REC-05 will use.
const LIVE_OFFER_STATES = ['IN_APPROVAL', 'OFFER_SENT', 'WAITING_APPROVAL', 'APPROVED', 'SENT'];

const notFound = () => json(404, { error: 'Not found' });
const forbidden = () => json(403, { error: 'Forbidden' });
const conflict = (code) => json(409, { error: 'Conflict', code });
const bad = (code) => json(400, { error: 'Bad request', code });

async function loadCandidate(tenantId, candidateId) {
  if (typeof candidateId !== 'string' || candidateId === '') return null;
  const got = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }), ConsistentRead: true }));
  const row = got.Item ? unmarshall(got.Item) : null;
  return row && ownsRow(row, tenantId) ? row : null;
}

/** The interview types this candidate has completed. Reads every page of the candidate's interview rows. */
async function completedInterviewTypes(tenantId, candidateId) {
  const done = new Set();
  let start;
  do {
    const page = await db.send(new QueryCommand({
      TableName: STATE(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${candidateId}`, ':prefix': 'INTERVIEW#' }),
      ExclusiveStartKey: start,
    }));
    for (const item of page.Items ?? []) {
      const interview = unmarshall(item);
      if (ownsRow(interview, tenantId) && interview.status === 'COMPLETED') done.add(interview.interviewType);
    }
    start = page.LastEvaluatedKey;
  } while (start);
  return done;
}

/** True when the candidate has an offer that is waiting for approval, approved or sent. */
async function hasLiveOffer(tenantId, candidateId) {
  const got = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'OFFER' }), ConsistentRead: true }));
  const offer = got.Item ? unmarshall(got.Item) : null;
  return Boolean(offer && ownsRow(offer, tenantId) && LIVE_OFFER_STATES.includes(offer.state));
}

export async function moveCandidate(ctx, { candidateId, to, reason }) {
  const row = await loadCandidate(ctx.tenantId, candidateId);
  if (!row) return notFound();

  // Who is this caller to this candidate? A Recruiter, or the hiring manager of this very candidate. Any other manager gets a 403.
  const recruiter = isRecruiter(ctx.event);
  if (!recruiter && !(isManager(ctx.event) && hiringManagerOf(row, ctx.personId))) return forbidden();

  if (typeof reason !== 'string' || reason.trim() === '' || reason.length > MAX_REASON) return bad('REASON_REQUIRED');
  if (!STAGE_CODES.includes(to)) return bad('UNKNOWN_STAGE');
  if (to === 'HIRED' || to === 'NOT_HIRED') return bad('USE_ACTION');

  // A stored old name is read through the one list. A candidate in Hired or Not hired, or in no stage at all, cannot be moved.
  const from = normaliseStage(row);
  if (!from || from === 'HIRED' || from === 'NOT_HIRED') return conflict('NOT_OPEN');

  // A hiring manager makes one move only. It is refused before any setting is read.
  const gate = from === 'INTERVIEW' && to === 'OFFER';
  if (!recruiter && !gate) return forbidden();

  const settings = await getRecruitmentSettings(ctx.tenantId, row);
  const list = openStages(settings.STAGE_CONFIG?.screening);
  const step = list.indexOf(to) - list.indexOf(from);
  if (!list.includes(from) || !list.includes(to) || Math.abs(step) !== 1) return bad('NOT_NEXT_STAGE');

  if (gate) {
    if (!canDecide(ctx.event, row, moveDeciderOf(settings, row))) return forbidden();
    if (requiredInterviews(settings, row, new Set()).total > 0) {
      const done = await completedInterviewTypes(ctx.tenantId, candidateId);
      if (requiredInterviews(settings, row, done).incomplete) return conflict('INTERVIEWS_INCOMPLETE');
    }
  }
  if (step < 0 && from === 'OFFER' && (await hasLiveOffer(ctx.tenantId, candidateId))) return conflict('OFFER_LIVE');

  // The candidate's row and the history row change together or not at all. The condition makes a second mover who read the same
  // stage lose cleanly instead of overwriting.
  const at = new Date().toISOString();
  try {
    await db.send(new TransactWriteItemsCommand({
      TransactItems: [
        {
          Update: {
            TableName: STATE(),
            Key: marshall({ PK: row.PK, SK: 'SAGA' }),
            UpdateExpression: 'SET currentStage = :to, stageEnteredAt = :at, slaStatus = :sla, updatedBy = :by, updatedAt = :at',
            ConditionExpression: 'tenant_id = :tenant AND currentStage = :stored',
            ExpressionAttributeValues: marshall({ ':to': to, ':at': at, ':sla': 'ON_TRACK', ':by': ctx.personId, ':tenant': ctx.tenantId, ':stored': row.currentStage }),
          },
        },
        {
          Put: {
            TableName: STATE(),
            Item: marshall(stampTenant({
              PK: row.PK, SK: `STAGE#${at}#${to}`, candidateId, from, to, reason, by: ctx.personId, by_kind: 'PERSON', at, recordType: 'STAGE_HISTORY',
            }, ctx.tenantId)),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    }));
  } catch (err) {
    if (err.name === 'TransactionCanceledException' || err.name === 'ConditionalCheckFailedException') return conflict('STAGE_CHANGED');
    throw err;
  }

  // One CandidateMoved per move. It never carries the reason. The move is already saved, so a failed send is logged (name only)
  // and does not turn a saved move into an error for the person.
  try {
    await bus.send(new PutEventsCommand({
      Entries: [{
        EventBusName: BUS(),
        Source: 'talent-flow.workflow',
        DetailType: 'CandidateMoved',
        Detail: JSON.stringify({ tenant_id: ctx.tenantId, candidate_id: candidateId, role_id: row.role_id ?? null, from, to, by: ctx.personId, at }),
      }],
    }));
  } catch (err) {
    console.error('moveCandidate: CandidateMoved not sent', { error: err.name });
  }
  return json(200, { candidateId, from, to, at });
}
