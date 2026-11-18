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
const { tenantHelper } = require('../shared/tf-tenant.js');

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
  // REC-01: who may open one candidate is judged on the rows, after the company and module checks. This one is not a
  // 403 route: anyone who may not see the candidate gets 404, as for a candidate that does not exist.
  const RA = await import('../shared/recruitment-access.mjs');
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;

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

    // Another company's candidate answers exactly as one that does not exist.
    if (!result.Item || !T.ownsRow(unmarshall(result.Item), tenantId)) {
      return T.notFound();
    }

    let candidate = unmarshall(result.Item);
    // Normalise: frontend Candidate interface uses `id`, DynamoDB stores `candidateId`
    if (!candidate.id && candidate.candidateId) candidate.id = candidate.candidateId;

    // Look up the interviews of this candidate: the most recent SCHEDULED one powers the vote button (canSubmit
    // requires a real interviewId), and a panel member's right to open the candidate is judged on them.
    let interviews = [];
    let interviewsRead = false;
    const loadInterviews = async () => {
      if (interviewsRead) return interviews;
      interviewsRead = true;
      const interviewResult = await dynamo.send(
        new QueryCommand({
          TableName: STATE_TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: marshall({
            ':pk': `CANDIDATE#${candidate.id || candidate.candidateId}`,
            ':prefix': 'INTERVIEW#',
          }),
          ProjectionExpression: 'interviewId, #st, scheduledAt, panelMemberIds, tenant_id',
          ExpressionAttributeNames: { '#st': 'status' },
          ScanIndexForward: false, // descending by SK — latest first
        }),
      );
      interviews = (interviewResult.Items || []).map((i) => unmarshall(i)).filter((i) => T.ownsRow(i, tenantId));
      return interviews;
    };

    // REC-01: a Recruiter, the hiring manager of this candidate, or a panel member of one of its interviews.
    // Anyone else gets the answer of a candidate that does not exist.
    let relation;
    try {
      relation = await RA.relationOf(event, candidate, loadInterviews);
    } catch (relationErr) {
      // The interviews could not be read: the right is not proven, so the candidate is not shown (fail closed).
      console.warn('getCandidate: could not prove access', { candidateId, error: relationErr.name });
      return T.notFound();
    }
    if (!relation) return T.notFound();

    try {
      const mine = relation === 'panel' ? interviews.filter((i) => RA.panelMemberOf(i, RA.callerId(event))) : await loadInterviews();
      if (mine.length > 0) {
        // Pick first SCHEDULED interview, fall back to any if none SCHEDULED
        const scheduled = mine.find((i) => i.status === 'SCHEDULED') ?? mine[0];
        candidate.currentInterviewId = scheduled.interviewId ?? null;
      }
    } catch (interviewErr) {
      // Non-fatal: vote button will remain disabled if we can't fetch interview
      console.warn('getCandidate: failed to query interview record', { candidateId, error: interviewErr.message });
    }

    // REC-01: salary stays hidden from the hiring manager; a panel member sees no offer and no salary field.
    if (relation === 'hiringManager') candidate = RA.forHiringManager(candidate);
    if (relation === 'panel') candidate = RA.forPanelMember(candidate);

    return respond(200, candidate);
  } catch (err) {
    console.error('getCandidate error', err);
    return respond(500, { message: 'Failed to retrieve candidate' });
  }
};
