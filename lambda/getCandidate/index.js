'use strict';

/**
 * lambda/getCandidate/index.js
 *
 * Returns a single candidate's SAGA record by candidateId.
 * Also queries for the most recent INTERVIEW# record and returns
 * currentInterviewId so the frontend can enable the vote submit button.
 *
 * Path: GET /v1/candidates/{id}
 */

const { DynamoDBClient, GetItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
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

    // Look up the most recent SCHEDULED interview for this candidate.
    // This powers the vote button (canSubmit requires a real interviewId).
    try {
      const interviewResult = await dynamo.send(
        new QueryCommand({
          TableName: STATE_TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: marshall({
            ':pk': `CANDIDATE#${candidate.id || candidate.candidateId}`,
            ':prefix': 'INTERVIEW#',
          }),
          ProjectionExpression: 'interviewId, #st, scheduledAt',
          ExpressionAttributeNames: { '#st': 'status' },
          ScanIndexForward: false, // descending by SK — latest first
          Limit: 5,
        }),
      );
      if (interviewResult.Items && interviewResult.Items.length > 0) {
        // Pick first SCHEDULED interview, fall back to any if none SCHEDULED
        const interviews = interviewResult.Items.map((i) => unmarshall(i));
        const scheduled = interviews.find((i) => i.status === 'SCHEDULED') ?? interviews[0];
        candidate.currentInterviewId = scheduled.interviewId ?? null;
      }
    } catch (interviewErr) {
      // Non-fatal: vote button will remain disabled if we can't fetch interview
      console.warn('getCandidate: failed to query interview record', { candidateId, error: interviewErr.message });
    }

    return respond(200, candidate);
  } catch (err) {
    console.error('getCandidate error', err);
    return respond(500, { message: 'Failed to retrieve candidate' });
  }
};
