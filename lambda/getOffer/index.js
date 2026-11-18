'use strict';

/**
 * getOffer Lambda
 * Phase D — NH-131
 *
 * Trigger: GET /v1/candidates/{id}/offer (JWT-secured HTTP API)
 *
 * Implementation spec (3 steps):
 *   1.  Extract candidateId from path parameters
 *   2.  GetItem OFFER record (PK=CANDIDATE#{id}, SK=OFFER)
 *   3.  Return offer or 404 if not yet created
 *
 * Read-only — no side effects, no event publishing.
 * Returns the full offer including approvalChain and interactionLog so the
 * frontend Offer tab can render the correct state block.
 */

const {
  DynamoDBClient,
  GetItemCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { tenantHelper } = require('../shared/tf-tenant.js');

const dynamo = new DynamoDBClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME;

const ok        = (body) => ({ statusCode: 200, body: JSON.stringify(body) });
const notFound  = (msg)  => ({ statusCode: 404, body: JSON.stringify({ error: msg }) });
const badReq    = (msg)  => ({ statusCode: 400, body: JSON.stringify({ error: msg }) });
const serverErr = (msg)  => ({ statusCode: 500, body: JSON.stringify({ error: msg }) });

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const RA = await import('../shared/recruitment-access.mjs');
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;

  // REC-01: the offer is the Recruiter's and, with the salary removed, the hiring manager's of that candidate. Nobody
  // else (a panel member included) gets it: they get 404, as for an offer that does not exist.
  const isRecruiter = RA.isRecruiter(event);
  if (!isRecruiter && !RA.isManager(event)) return T.notFound();

  const candidateId =
    event.pathParameters?.id ??
    event.pathParameters?.candidateId ??
    event.candidateId;

  if (!candidateId) return badReq('Missing required path parameter: candidateId');

  let offer;
  try {
    if (!isRecruiter) {
      // A manager: only the hiring manager of this candidate (the candidate's own row, of this company).
      const own = await dynamo.send(new GetItemCommand({
        TableName: STATE_TABLE,
        Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
      }));
      const candidate = own.Item ? unmarshall(own.Item) : null;
      if (!candidate || !T.ownsRow(candidate, tenantId) || !RA.hiringManagerOf(candidate, RA.callerId(event))) return T.notFound();
    }
    const res = await dynamo.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'OFFER' }),
    }));

    // Another company's offer answers exactly as one that does not exist.
    if (!res.Item || !T.ownsRow(unmarshall(res.Item), tenantId)) {
      return T.notFound();
    }

    offer = unmarshall(res.Item);
  } catch (err) {
    console.error('Failed to read OFFER record', { candidateId, error: err.message });
    return serverErr('Failed to read offer record');
  }

  // Strip internal DynamoDB keys from the response
  const { PK, SK, ...offerData } = offer;

  console.info('Offer retrieved', { candidateId, state: offerData.state });
  // Salary stays hidden from the hiring manager (REC-05).
  return ok(isRecruiter ? offerData : RA.forHiringManager(offerData));
};
