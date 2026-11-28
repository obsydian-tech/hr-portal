// REC-UI-03 server (NH-293) rule 1 and 2: the feedback-due row items that go inside an existing transaction.
import { marshall } from '@aws-sdk/util-dynamodb';
import * as T from './tenant.mjs';

export const duePk = (tenantId, personId) => `FEEDBACK_DUE#${tenantId}#${personId}`;
export const dueSk = (candidateId, interviewId) => `CANDIDATE#${candidateId}#INTERVIEW#${interviewId}`;

/** A Put of an OPEN row (book, and the new panel of a reschedule). */
export function openItem(table, tenantId, personId, candidateId, interviewId, now) {
  const row = T.stampTenant({ PK: duePk(tenantId, personId), SK: dueSk(candidateId, interviewId), person_id: personId, interview_id: interviewId, candidate_id: candidateId, state: 'OPEN', updated_at: now }, tenantId);
  return { Put: { TableName: table, Item: marshall(row) } };
}

/** An unconditional Update to DONE that sets every field but the key, so it also makes a whole row for an interview booked before this card. */
export function doneItem(table, tenantId, personId, candidateId, interviewId, reason, now) {
  return {
    Update: {
      TableName: table, Key: marshall({ PK: duePk(tenantId, personId), SK: dueSk(candidateId, interviewId) }),
      UpdateExpression: 'SET #t = :t, #p = :p, #i = :i, #c = :c, #s = :s, #u = :u, #r = :r',
      ExpressionAttributeNames: { '#t': 'tenant_id', '#p': 'person_id', '#i': 'interview_id', '#c': 'candidate_id', '#s': 'state', '#u': 'updated_at', '#r': 'done_reason' },
      ExpressionAttributeValues: marshall({ ':t': tenantId, ':p': personId, ':i': interviewId, ':c': candidateId, ':s': 'DONE', ':u': now, ':r': reason }),
    },
  };
}
