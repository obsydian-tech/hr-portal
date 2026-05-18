'use strict';

/**
 * lambda/getCandidate/index.js
 *
 * Returns a single candidate's SAGA record by candidateId.
 *
 * Path: GET /v1/candidates/{id}
 */

const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamo = new DynamoDBClient({});
const STATE_TABLE = process.env.STATE_TABLE_NAME || 'talent-flow-state';

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const candidateId = event.pathParameters?.id;
  if (!candidateId) {
    return respond(400, { message: 'Missing candidateId path parameter' });
  }

  try {
    const result = await dynamo.send(
      new GetItemCommand({
        TableName: STATE_TABLE,
        Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
      }),
    );

    if (!result.Item) {
      return respond(404, { message: `Candidate ${candidateId} not found` });
    }

    const candidate = unmarshall(result.Item);
    // Normalise: frontend Candidate interface uses `id`, DynamoDB stores `candidateId`
    if (!candidate.id && candidate.candidateId) candidate.id = candidate.candidateId;
    return respond(200, candidate);
  } catch (err) {
    console.error('getCandidate error', err);
    return respond(500, { message: 'Failed to retrieve candidate' });
  }
};
