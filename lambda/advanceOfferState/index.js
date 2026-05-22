'use strict';

/**
 * advanceOfferState Lambda
 * Phase D — NH-132
 *
 * Trigger: PUT /v1/candidates/{id}/offer (JWT-secured HTTP API)
 *
 * Actions (body.action):
 *   SUBMIT_FOR_APPROVAL  — OFFER_CREATED → IN_APPROVAL
 *     Validates offer form fields (baseSalary, currency, startDate, expiryDate) are present.
 *     Updates OFFER record; Step Functions approval chain is already running (started by createOffer).
 *
 *   MARK_SENT            — IN_APPROVAL → OFFER_SENT
 *     Records sentAt timestamp; starts the response SLA timer.
 *     Payload: {} (no extra fields required)
 *
 *   LOG_INTERACTION      — no state change; appends to interactionLog (D069)
 *     Payload: { interactionType, outcome, notes? }
 *     interactionType: 'CALL' | 'EMAIL' | 'WHATSAPP' | 'MEETING'
 *     outcome: 'ACKNOWLEDGED' | 'ASKING_QUESTIONS' | 'COUNTER_RECEIVED' | 'GOING_QUIET' | 'VERBAL_ACCEPT' | 'DECLINED'
 *
 *   CONFIRM_ACCEPTANCE   — OFFER_SENT → ACCEPTED (D070 — Trigger 4)
 *     Payload: { acceptanceDate, confirmedStartDate, acceptanceSentiment, notes? }
 *     Publishes OfferAccepted to EventBridge → IT/Facilities fan-out + 48hr HM countdown.
 *
 * State transition guard: invalid transitions return 409 Conflict.
 *
 * DynamoDB key: PK=CANDIDATE#{candidateId}, SK=OFFER
 */

const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const {
  EventBridgeClient,
  PutEventsCommand,
} = require('@aws-sdk/client-eventbridge');

const dynamo = new DynamoDBClient({});
const eb     = new EventBridgeClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME;
const EB_BUS      = process.env.EVENTBRIDGE_BUS_NAME;

const ok        = (body) => ({ statusCode: 200,  body: JSON.stringify(body) });
const badReq    = (msg)  => ({ statusCode: 400,  body: JSON.stringify({ error: msg }) });
const notFound  = (msg)  => ({ statusCode: 404,  body: JSON.stringify({ error: msg }) });
const conflict  = (msg)  => ({ statusCode: 409,  body: JSON.stringify({ error: msg }) });
const serverErr = (msg)  => ({ statusCode: 500,  body: JSON.stringify({ error: msg }) });

const VALID_INTERACTION_TYPES = ['CALL', 'EMAIL', 'WHATSAPP', 'MEETING'];
const VALID_OUTCOMES = [
  'ACKNOWLEDGED', 'ASKING_QUESTIONS', 'COUNTER_RECEIVED',
  'GOING_QUIET', 'VERBAL_ACCEPT', 'DECLINED',
];
const VALID_ACCEPTANCE_SENTIMENTS = ['EXCITED', 'POSITIVE', 'HESITANT'];

// ── State machine allowed transitions ─────────────────────────────────────────
const ALLOWED_TRANSITIONS = {
  SUBMIT_FOR_APPROVAL: { from: 'OFFER_CREATED', to: 'IN_APPROVAL' },
  MARK_SENT:           { from: 'IN_APPROVAL',   to: 'OFFER_SENT'  },
  CONFIRM_ACCEPTANCE:  { from: 'OFFER_SENT',     to: 'ACCEPTED'    },
};

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const candidateId =
    event.pathParameters?.id ??
    event.pathParameters?.candidateId ??
    event.candidateId;

  if (!candidateId) return badReq('Missing required path parameter: candidateId');

  const body = typeof event.body === 'string' ? JSON.parse(event.body ?? '{}') : (event.body ?? {});
  const { action, payload = {} } = body;

  if (!action) return badReq('Missing required field: action');

  // ── Read current offer ────────────────────────────────────────────────────
  let offer;
  try {
    const res = await dynamo.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'OFFER' }),
    }));
    if (!res.Item) return notFound(`No offer found for candidate ${candidateId}`);
    offer = unmarshall(res.Item);
  } catch (err) {
    console.error('Failed to read OFFER record', { candidateId, error: err.message });
    return serverErr('Failed to read offer record');
  }

  const now = new Date().toISOString();

  // ── Route by action ───────────────────────────────────────────────────────
  switch (action) {

    case 'SUBMIT_FOR_APPROVAL': {
      const transition = ALLOWED_TRANSITIONS.SUBMIT_FOR_APPROVAL;
      if (offer.state !== transition.from) {
        return conflict(`Cannot submit for approval from state ${offer.state}. Expected: ${transition.from}`);
      }

      const { baseSalary, currency, startDate, expiryDate, benefits } = payload;
      if (!baseSalary)  return badReq('Missing required field: baseSalary');
      if (!currency)    return badReq('Missing required field: currency');
      if (!startDate)   return badReq('Missing required field: startDate');
      if (!expiryDate)  return badReq('Missing required field: expiryDate');

      try {
        await dynamo.send(new UpdateItemCommand({
          TableName: STATE_TABLE,
          Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'OFFER' }),
          UpdateExpression:
            'SET #state = :state, baseSalary = :salary, currency = :currency, ' +
            'startDate = :start, expiryDate = :expiry, benefits = :benefits, ' +
            'submittedForApprovalAt = :now, updatedAt = :now',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: marshall({
            ':state':    transition.to,
            ':salary':   baseSalary,
            ':currency': currency,
            ':start':    startDate,
            ':expiry':   expiryDate,
            ':benefits': benefits ?? null,
            ':now':      now,
          }, { removeUndefinedValues: true }),
        }));
      } catch (err) {
        console.error('Failed to update OFFER to IN_APPROVAL', { candidateId, error: err.message });
        return serverErr('Failed to advance offer state');
      }

      console.info('Offer submitted for approval', { candidateId });
      return ok({ candidateId, state: transition.to });
    }

    case 'MARK_SENT': {
      const transition = ALLOWED_TRANSITIONS.MARK_SENT;
      if (offer.state !== transition.from) {
        return conflict(`Cannot mark as sent from state ${offer.state}. Expected: ${transition.from}`);
      }

      try {
        await dynamo.send(new UpdateItemCommand({
          TableName: STATE_TABLE,
          Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'OFFER' }),
          UpdateExpression: 'SET #state = :state, sentAt = :now, updatedAt = :now',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: marshall({ ':state': transition.to, ':now': now }),
        }));
      } catch (err) {
        console.error('Failed to update OFFER to OFFER_SENT', { candidateId, error: err.message });
        return serverErr('Failed to advance offer state');
      }

      console.info('Offer marked as sent', { candidateId });
      return ok({ candidateId, state: transition.to, sentAt: now });
    }

    case 'LOG_INTERACTION': {
      const { interactionType, outcome, notes } = payload;
      if (!interactionType) return badReq('Missing required field: interactionType');
      if (!outcome)         return badReq('Missing required field: outcome');
      if (!VALID_INTERACTION_TYPES.includes(interactionType)) {
        return badReq(`Invalid interactionType. Must be one of: ${VALID_INTERACTION_TYPES.join(', ')}`);
      }
      if (!VALID_OUTCOMES.includes(outcome)) {
        return badReq(`Invalid outcome. Must be one of: ${VALID_OUTCOMES.join(', ')}`);
      }
      if (offer.state !== 'OFFER_SENT') {
        return conflict(`Interaction logging only available in OFFER_SENT state. Current: ${offer.state}`);
      }

      const entry = { interactionType, outcome, notes: notes ?? null, loggedAt: now };

      try {
        await dynamo.send(new UpdateItemCommand({
          TableName: STATE_TABLE,
          Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'OFFER' }),
          UpdateExpression: 'SET interactionLog = list_append(if_not_exists(interactionLog, :empty), :entry), updatedAt = :now',
          ExpressionAttributeValues: marshall({
            ':entry': [entry],
            ':empty': [],
            ':now':   now,
          }),
        }));
      } catch (err) {
        console.error('Failed to append interaction log entry', { candidateId, error: err.message });
        return serverErr('Failed to log interaction');
      }

      console.info('Interaction logged', { candidateId, interactionType, outcome });
      return ok({ candidateId, entry });
    }

    case 'CONFIRM_ACCEPTANCE': {
      const transition = ALLOWED_TRANSITIONS.CONFIRM_ACCEPTANCE;
      if (offer.state !== transition.from) {
        return conflict(`Cannot confirm acceptance from state ${offer.state}. Expected: ${transition.from}`);
      }

      const { acceptanceDate, confirmedStartDate, acceptanceSentiment, notes } = payload;
      if (!acceptanceDate)      return badReq('Missing required field: acceptanceDate');
      if (!confirmedStartDate)  return badReq('Missing required field: confirmedStartDate');
      if (!acceptanceSentiment) return badReq('Missing required field: acceptanceSentiment');
      if (!VALID_ACCEPTANCE_SENTIMENTS.includes(acceptanceSentiment)) {
        return badReq(`Invalid acceptanceSentiment. Must be one of: ${VALID_ACCEPTANCE_SENTIMENTS.join(', ')}`);
      }

      try {
        await dynamo.send(new UpdateItemCommand({
          TableName: STATE_TABLE,
          Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'OFFER' }),
          UpdateExpression:
            'SET #state = :state, acceptanceDate = :accDate, confirmedStartDate = :startDate, ' +
            'acceptanceSentiment = :sentiment, acceptanceNotes = :notes, acceptedAt = :now, updatedAt = :now',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: marshall({
            ':state':     transition.to,
            ':accDate':   acceptanceDate,
            ':startDate': confirmedStartDate,
            ':sentiment': acceptanceSentiment,
            ':notes':     notes ?? null,
            ':now':       now,
          }, { removeUndefinedValues: true }),
        }));
      } catch (err) {
        console.error('Failed to update OFFER to ACCEPTED', { candidateId, error: err.message });
        return serverErr('Failed to confirm acceptance');
      }

      // Trigger 4 — OfferAccepted publishes to EventBridge → IT/Facilities + 48hr HM countdown
      try {
        await eb.send(new PutEventsCommand({
          Entries: [{
            EventBusName: EB_BUS,
            Source:       'talent-flow.workflow',
            DetailType:   'OfferAccepted',
            Detail:       JSON.stringify({
              candidateId,
              tenantId:            offer.tenantId,
              configVersion:       offer.configVersion,
              role:                offer.role,
              department:          offer.department,
              location:            offer.location,
              confirmedStartDate,
              acceptanceSentiment,
              acceptanceDate,
              timestamp:           now,
            }),
          }],
        }));
      } catch (err) {
        // Non-fatal: OFFER record is already marked ACCEPTED; downstream can reconcile
        console.error('Failed to publish OfferAccepted event', { candidateId, error: err.message });
      }

      // Also update SAGA to reflect acceptance and move candidate to CONTRACT_SIGNING
      try {
        await dynamo.send(new UpdateItemCommand({
          TableName: STATE_TABLE,
          Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
          UpdateExpression:
            'SET currentStage = :stage, acceptanceSentiment = :sentiment, updatedAt = :now',
          ExpressionAttributeValues: marshall({
            ':stage':     'CONTRACT_SIGNING',
            ':sentiment': acceptanceSentiment,
            ':now':       now,
          }),
        }));
      } catch (err) {
        console.error('Failed to update SAGA stage on acceptance', { candidateId, error: err.message });
      }

      console.info('Offer accepted — Trigger 4 published', { candidateId, acceptanceSentiment, confirmedStartDate });
      return ok({ candidateId, state: transition.to, confirmedStartDate, acceptanceSentiment });
    }

    default:
      return badReq(`Unknown action: ${action}. Valid actions: SUBMIT_FOR_APPROVAL, MARK_SENT, LOG_INTERACTION, CONFIRM_ACCEPTANCE`);
  }
};
