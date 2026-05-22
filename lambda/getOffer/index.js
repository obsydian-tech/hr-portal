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

const dynamo = new DynamoDBClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME;

const ok        = (body) => ({ statusCode: 200, body: JSON.stringify(body) });
const notFound  = (msg)  => ({ statusCode: 404, body: JSON.stringify({ error: msg }) });
const badReq    = (msg)  => ({ statusCode: 400, body: JSON.stringify({ error: msg }) });
const serverErr = (msg)  => ({ statusCode: 500, body: JSON.stringify({ error: msg }) });

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const candidateId =
    event.pathParameters?.id ??
    event.pathParameters?.candidateId ??
    event.candidateId;

  if (!candidateId) return badReq('Missing required path parameter: candidateId');

  let offer;
  try {
    const res = await dynamo.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'OFFER' }),
    }));

    if (!res.Item) {
      return notFound(`No offer found for candidate ${candidateId}`);
    }

    offer = unmarshall(res.Item);
  } catch (err) {
    console.error('Failed to read OFFER record', { candidateId, error: err.message });
    return serverErr('Failed to read offer record');
  }

  // Strip internal DynamoDB keys from the response
  const { PK, SK, ...offerData } = offer;

  console.info('Offer retrieved', { candidateId, state: offerData.state });
  return ok(offerData);
};
