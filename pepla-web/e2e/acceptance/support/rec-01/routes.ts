import { A, ID, SUB, type Ask } from './world';
import { addBody } from '../rec-15b.1/roles';

/**
 * REC-01 rule 2: every Recruitment route a person calls that the table names, with one valid request for company A's own
 * record. `kind` says which row of the table the route sits in:
 *   recruiter  Recruiter only; everyone else 403 before any AWS call.
 *   move       REC-03 (child lock rec-03.1): the stage move. Recruiter; a manager passes the role check and is refused (403, nothing
 *              written) unless it is the hiring manager's gate move; everyone else 403 before any AWS call.
 *   list       Recruiter: all of the company. Manager: only their own candidates. Everyone else 403.
 *   relation   Recruiter; the hiring manager of that candidate; (where `panel`) a panel member of an interview of it. Anyone else 404.
 *   settings   Read: Recruiter or Admin. Save: Admin. Everyone else 403.
 *   vote       The signed-in person on that interview's panel. Everyone else 403.
 * Routes left out on purpose: the pickers (hiring managers, panel members), a person's own notifications, the approver routes
 * of talentFlowApproveAction (BE-19, REC-10), the AI chat (REC-10), the public vote by token and the event handlers.
 */
export type Kind = 'recruiter' | 'move' | 'list' | 'relation' | 'settings' | 'vote';
export type Route = {
  name: string;
  handler: string;
  kind: Kind;
  /** The caller kinds a `settings` write allows (admin only). */
  write?: boolean;
  /** A relation route a panel member of an interview of the candidate may also open (with offer fields removed). */
  panel?: boolean;
  /** The answers a Recruiter gets on the fixture (the control: the fixture is a good request). */
  ok: number[];
  own: Ask;
};

const ivBody = { candidateId: ID.c2, interviewId: 'iv-new-0001', interviewType: 'TECHNICAL', panelMemberIds: [SUB.panel2A], scheduledAt: '2026-12-02T09:00:00.000Z' };
const tile = `tile-${ID.c1}-RULE-SLA-002`;

export const ROUTES: Route[] = [
  { name: 'POST /v1/candidates', handler: 'createCandidate', kind: 'recruiter', ok: [200, 201], own: { method: 'POST', body: addBody(A) } }, // child lock rec-15b.1: REC-15 rule 19 body
  { name: 'PATCH /v1/candidates/{id}', handler: 'updateCandidate', kind: 'recruiter', ok: [200], own: { method: 'PATCH', path: { id: ID.c1 }, body: { firstName: 'Jon' } } },
  { name: 'PUT /v1/candidates/{id}/stage', handler: 'advanceCandidateStage', kind: 'move', ok: [200], own: { method: 'PUT', path: { id: ID.c1 }, body: { to: 'SCREENING', reason: 'Moved on after the CV read' } } },
  { name: 'POST /v1/candidates/{id}/interviews', handler: 'scheduleInterview', kind: 'recruiter', ok: [200, 201], own: { method: 'POST', path: { id: ID.c2 }, body: ivBody } },
  { name: 'PATCH /v1/candidates/{id}/interviews/{interviewId} (complete)', handler: 'scheduleInterview', kind: 'recruiter', ok: [200], own: { method: 'PATCH', path: { id: ID.c1, interviewId: ID.i1 }, body: { action: 'complete', outcome: 'PASS' } } },
  { name: 'PATCH /v1/candidates/{id}/interviews/{interviewId} (add panel)', handler: 'scheduleInterview', kind: 'recruiter', ok: [200], own: { method: 'PATCH', path: { id: ID.c1, interviewId: ID.i1 }, body: { panelMemberIds: [SUB.panelA, SUB.panelX, 'sub-panel-new'] } } },
  { name: 'POST /v1/candidates/{id}/scoring-links', handler: 'generateScoringLink', kind: 'recruiter', ok: [200, 201], own: { method: 'POST', path: { id: ID.c1 }, body: { panelMemberId: SUB.panelA, panelMemberEmail: 'panel.a@example.test', panelMemberName: 'Panel A', panelMemberRole: 'Engineer', interviewId: ID.i1 } } },
  { name: 'POST /v1/candidates/{id}/sentiment', handler: 'captureSentiment', kind: 'recruiter', ok: [200], own: { method: 'POST', path: { id: ID.c1 }, body: { interviewSentiment: 'INTERESTED' } } },
  { name: 'POST /v1/candidates/{id}/offer', handler: 'createOffer', kind: 'recruiter', ok: [200, 201], own: { method: 'POST', path: { id: ID.c2 }, body: {} } },
  { name: 'PUT /v1/candidates/{id}/offer', handler: 'advanceOfferState', kind: 'recruiter', ok: [200], own: { method: 'PUT', path: { id: ID.c1 }, body: { action: 'SUBMIT_FOR_APPROVAL', payload: { baseSalary: 100000, currency: 'ZAR', startDate: '2027-01-01', expiryDate: '2026-12-20' } } } },
  { name: 'POST /v1/intelligence/tiles/{id}/acknowledge', handler: 'acknowledgeTile', kind: 'recruiter', ok: [200], own: { method: 'POST', path: { id: tile }, body: { reason: 'seen' } } },
  { name: 'POST /v1/intelligence/tiles/{id}/snooze', handler: 'snoozeTile', kind: 'recruiter', ok: [200], own: { method: 'POST', path: { id: tile }, body: { hours: 24 } } },
  { name: 'POST /v1/intelligence/tiles/{id}/dismiss', handler: 'dismissTile', kind: 'recruiter', ok: [200], own: { method: 'POST', path: { id: tile }, body: {} } },
  { name: 'GET /v1/candidates', handler: 'getCandidates', kind: 'list', ok: [200], own: {} },
  { name: 'GET /v1/intelligence/tiles', handler: 'getIntelligenceTiles', kind: 'list', ok: [200], own: { query: { role: 'TA' } } },
  { name: 'GET /v1/candidates/{id}', handler: 'getCandidate', kind: 'relation', panel: true, ok: [200], own: { path: { id: ID.c1 } } },
  { name: 'GET /v1/candidates/{id}/events', handler: 'getCandidateEvents', kind: 'relation', panel: true, ok: [200], own: { path: { id: ID.c1 } } },
  { name: 'GET /v1/candidates/{id}/interviews', handler: 'scheduleInterview', kind: 'relation', panel: true, ok: [200], own: { path: { id: ID.c1 } } },
  { name: 'GET /v1/candidates/{id}/offer', handler: 'getOffer', kind: 'relation', ok: [200], own: { path: { id: ID.c1 } } },
  { name: 'GET /v1/config', handler: 'manageTalentFlowConfig', kind: 'settings', ok: [200], own: { query: { configType: 'SCORING_WEIGHTS', active: 'true' } } },
  { name: 'POST /v1/config', handler: 'manageTalentFlowConfig', kind: 'settings', write: true, ok: [200, 201], own: { method: 'POST', body: { configType: 'RETENTION', data: { notHiredMonths: 6 } } } },
  { name: 'PUT /v1/config', handler: 'manageTalentFlowConfig', kind: 'settings', write: true, ok: [200], own: { method: 'PUT', body: { configType: 'SCORING_WEIGHTS', data: { scale: { min: 1, max: 5 }, defaultCriteria: [{ key: 'technical', label: 'Technical' }], weights: null } } } },
  { name: 'POST /v1/candidates/{id}/votes', handler: 'submitVote', kind: 'vote', ok: [200], own: { method: 'POST', path: { id: ID.c2 }, body: { candidateId: ID.c2, interviewId: ID.i2, voterId: SUB.panel2A, rating: 'YES', scores: { technical: 4, communication: 4, culturalFit: 4, problemSolving: 4 } } } },
];

/** The Lambda folders on the rule 2 list (the folders rule 6 and the text checks walk). */
export const LIST_LAMBDAS = [...new Set(ROUTES.map((r) => r.handler))];
export { A };
