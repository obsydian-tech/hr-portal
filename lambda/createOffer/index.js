'use strict';

/**
 * createOffer Lambda
 * Phase D — NH-130
 *
 * One invocation path (REC-03): POST /v1/candidates/{id}/offer (JWT-secured HTTP API), a person makes the offer.
 * No event makes an offer any more: an EvaluationCompleted event (or anything else that is not a person's request) writes,
 * starts and sends nothing.
 *
 * Implementation spec (6 steps):
 *   1.  Refuse anything that is not a person's HTTP request
 *   2.  Guard: role, company and module come first
 *   3.  GetItem SAGA → read positionLevel, role, department, location, configVersion
 *   4.  getConfig(tenantId, 'APPROVAL_RULES', configVersion) — VERSIONED
 *   5.  Derive seniority-driven approval chain from config
 *   6.  PutItem OFFER record (PK=CANDIDATE#{id}, SK=OFFER)
 *       Start Step Functions offer-approval state machine
 *       Publish OfferInitialised event to EventBridge
 *
 * Compliance invariant #2: getConfig MUST use candidate's configVersion.
 * Offer terms are POPIA-auditable — config version is stored on the offer record.
 *
 * DynamoDB key: PK=CANDIDATE#{candidateId}, SK=OFFER
 * Offer state on creation: OFFER_CREATED
 */

const {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const {
  EventBridgeClient,
  PutEventsCommand,
} = require('@aws-sdk/client-eventbridge');
const {
  SFNClient,
  StartExecutionCommand,
} = require('@aws-sdk/client-sfn');
const { getConfig } = require('./shared/config-reader');
const { tenantHelper } = require('../shared/tf-tenant.js');

const dynamo = new DynamoDBClient({});
const eb     = new EventBridgeClient({});
const sfn    = new SFNClient({});

const STATE_TABLE       = process.env.STATE_TABLE_NAME;
const EB_BUS            = process.env.EVENTBRIDGE_BUS_NAME;
const SFN_STATE_MACHINE = process.env.SFN_OFFER_APPROVAL_ARN;

const ok          = (body) => ({ statusCode: 200, body: JSON.stringify(body) });
const badRequest  = (msg)  => ({ statusCode: 400, body: JSON.stringify({ error: msg }) });
const serverError = (msg)  => ({ statusCode: 500, body: JSON.stringify({ error: msg }) });

// ── Seniority-driven approval chain builder ───────────────────────────────────
function buildApprovalChain(positionLevel, approvalRules) {
  const chains = approvalRules?.approvalChains ?? {
    JUNIOR: ['HiringManager'],
    MID:    ['HiringManager'],
    SENIOR: ['HiringManager', 'FinanceLead', 'HRDirector'],
  };
  const roles = chains[positionLevel] ?? chains['MID'] ?? ['HiringManager'];
  return roles.map((role, idx) => ({
    stepId:       `step-${idx + 1}`,
    approverRole: role,
    status:       'PENDING',
  }));
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Step 1: only a person's HTTP request makes an offer. HTTP API sets pathParameters; an event does not.
  const isHttp = !!(event.pathParameters || event.requestContext);
  if (!isHttp) {
    console.warn('createOffer: skipped, not a request from a person');
    return ok({ skipped: true, reason: 'not_http' });
  }

  // TEN-03: the company comes from the sign-in (tenantId in the body is not read).
  const T = await tenantHelper();

  // REC-01: only a Recruiter (HR with the Recruitment tick) may make an offer. The role answer comes first.
  const RA = await import('../shared/recruitment-access.mjs');
  const notRecruiter = RA.requireRecruiter(event);
  if (notRecruiter) return notRecruiter;
  const candidateId = event.pathParameters?.id ?? event.pathParameters?.candidateId;
  const body        = event.body
    ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body)
    : {};
  const t = T.requireTenant(event);
  if (t.refusal) return t.refusal;
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;
  const tenantId = t.tenantId;

  if (!candidateId) return badRequest('Missing required field: candidateId');

  // Step 3: Read SAGA — candidate details + configVersion
  let saga;
  try {
    const res = await dynamo.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
    }));
    if (!res.Item) return T.notFound();
    saga = unmarshall(res.Item);
    if (!T.ownsRow(saga, tenantId)) {
      console.warn('createOffer: skipped, the candidate is not in the requester\'s company');
      return T.notFound();
    }
  } catch (err) {
    console.error('Failed to read SAGA record', { candidateId, error: err.message });
    return serverError('Failed to read candidate record');
  }

  const positionLevel = saga.positionLevel;
  if (!positionLevel) return badRequest(`SAGA for candidate ${candidateId} has no positionLevel`);

  // configVersion: prefer EventBridge-supplied value, fall back to SAGA
  const configVersion = saga.configVersion;
  if (!configVersion) return badRequest(`No configVersion available for candidate ${candidateId}`);

  // Step 4: Versioned config read — POPIA invariant #2
  let approvalRules;
  try {
    approvalRules = await getConfig(tenantId, 'APPROVAL_RULES', configVersion);
  } catch (err) {
    console.error('Failed to read APPROVAL_RULES config', { tenantId, configVersion, error: err.message });
    return serverError('Failed to read approval configuration');
  }

  // Step 5: Build seniority-driven approval chain
  const approvalChain = buildApprovalChain(positionLevel, approvalRules);

  // Step 6a: Write OFFER record to DynamoDB
  const now     = new Date().toISOString();
  const offerId = `OFFER#${candidateId}`;

  const offerItem = T.stampTenant({
    PK:                  `CANDIDATE#${candidateId}`,
    SK:                  'OFFER',
    offerId,
    candidateId,
    tenantId,
    state:               'OFFER_CREATED',
    positionLevel,
    role:                saga.role       ?? null,
    department:          saga.department ?? null,
    location:            saga.location   ?? null,
    approvalChain,
    currentApprovalStep: 0,
    configVersion,
    interactionLog:      [],
    createdAt:           now,
    updatedAt:           now,
  }, tenantId);

  try {
    await dynamo.send(new PutItemCommand({
      TableName:           STATE_TABLE,
      Item:                marshall(offerItem, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(SK)',
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.warn('Offer already exists — idempotent skip', { candidateId });
      return ok({ candidateId, skipped: true, reason: 'offer_already_exists' });
    }
    console.error('Failed to write OFFER record', { candidateId, error: err.message });
    return serverError('Failed to create offer record');
  }

  // Step 6b: Start Step Functions offer-approval state machine
  if (SFN_STATE_MACHINE) {
    try {
      await sfn.send(new StartExecutionCommand({
        stateMachineArn: SFN_STATE_MACHINE,
        name:            `offer-${candidateId}-${Date.now()}`,
        input:           JSON.stringify({ candidateId, tenant_id: tenantId, configVersion, positionLevel, approvalChain }),
      }));
    } catch (err) {
      console.error('Failed to start Step Functions execution', { candidateId, error: err.message });
    }
  }

  // Step 6c: Publish OfferInitialised event
  try {
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: EB_BUS,
        Source:       'talent-flow.workflow',
        DetailType:   'OfferInitialised',
        Detail:       JSON.stringify({
          candidateId,
          tenant_id: tenantId,
          configVersion,
          positionLevel,
          approvalSteps: approvalChain.length,
          createdManually: isHttp,
          timestamp: now,
        }),
      }],
    }));
  } catch (err) {
    console.error('Failed to publish OfferInitialised event', { candidateId, error: err.message });
  }

  console.info('Offer created', { candidateId, positionLevel, approvalSteps: approvalChain.length, manual: isHttp });
  return ok({ candidateId, offerId, state: 'OFFER_CREATED', approvalChain });
};
