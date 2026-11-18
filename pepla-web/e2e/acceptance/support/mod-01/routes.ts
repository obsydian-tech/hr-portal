import { A, ID, NAME, SUB, type Ask, type Caller } from './world';

/**
 * MOD-01 rule 4: every Recruitment route a person or agent calls, after TEN-03 and TEN-05 (develop 6122df1), with one valid
 * request for company A's own record (`own`). The list is TEN-03's 38 routes less the IT task and provisioning bundle
 * routes (not gated, rule 4), plus the agent and HR routes of talentFlowApproveAction (read, pending list, approve, reject). Decision D-2 in cards/mod-01.md.
 * Old clients still send tenantId; it is sent as A here so the request is the one they send today.
 *
 * Not here on purpose: the IT task and bundle routes, every Onboarding route, Ask Batsi's own chat routes (the
 * Recruitment tools inside the TalentFlow chat are judged on their own, see TOOLS), the /v1/admin/* routes (TEN-05),
 * and the public vote by token (judged in AC-4).
 */
export type Route = {
  name: string;
  handler: string;
  /** staff: a signed-in person with every TalentFlow role; agent: the TalentFlow agent key's company context. */
  who?: 'staff' | 'agent';
  own: Ask;
};

const ivBody = { tenantId: A, candidateId: ID.a1, interviewId: 'iv-new-0001', interviewType: 'HR_SCREEN', panelMemberIds: [SUB.panelA], scheduledAt: '2026-12-02T09:00:00.000Z' };

export const ROUTES: Route[] = [
  { name: 'GET /v1/candidates/{id}', handler: 'getCandidate', own: { path: { id: ID.a1 } } },
  { name: 'PATCH /v1/candidates/{id}', handler: 'updateCandidate', own: { method: 'PATCH', path: { id: ID.a1 }, body: { firstName: 'Jon' } } },
  { name: 'PUT /v1/candidates/{id}/stage', handler: 'advanceCandidateStage', own: { method: 'PUT', path: { id: ID.a1 }, body: { newStage: 'INTERVIEWING', tenantId: A } } },
  { name: 'GET /v1/candidates/{id}/interviews', handler: 'scheduleInterview', own: { path: { id: ID.a1 } } },
  { name: 'PATCH /v1/candidates/{id}/interviews/{interviewId}', handler: 'scheduleInterview', own: { method: 'PATCH', path: { id: ID.a1, interviewId: ID.ivA }, body: { action: 'complete', outcome: 'PASS' } } },
  { name: 'POST /v1/candidates/{id}/interviews', handler: 'scheduleInterview', own: { method: 'POST', path: { id: ID.a2 }, body: { ...ivBody, candidateId: ID.a2 } } },
  { name: 'POST /v1/candidates/{id}/votes', handler: 'submitVote', own: { method: 'POST', path: { id: ID.a1 }, body: { candidateId: ID.a1, tenantId: A, voterId: SUB.hmA, rating: 'YES', interviewId: ID.ivA, scores: { technical: 4, communication: 4, culturalFit: 4, problemSolving: 4 } } } },
  { name: 'POST /v1/candidates/{id}/sentiment', handler: 'captureSentiment', own: { method: 'POST', path: { id: ID.a1 }, body: { interviewSentiment: 'INTERESTED', tenantId: A } } },
  { name: 'POST /v1/candidates/{id}/scoring-links', handler: 'generateScoringLink', own: { method: 'POST', path: { id: ID.a1 }, body: { panelMemberId: SUB.panelA, panelMemberEmail: 'panel.a@example.test', panelMemberName: 'Panel A', panelMemberRole: 'Engineer', tenantId: A, interviewId: ID.ivA } } },
  { name: 'GET /v1/candidates/{id}/offer', handler: 'getOffer', own: { path: { id: ID.a1 } } },
  { name: 'POST /v1/candidates/{id}/offer', handler: 'createOffer', own: { method: 'POST', path: { id: ID.a2 }, body: { tenantId: A } } },
  { name: 'PUT /v1/candidates/{id}/offer', handler: 'advanceOfferState', own: { method: 'PUT', path: { id: ID.a1 }, body: { action: 'SUBMIT_FOR_APPROVAL', payload: { baseSalary: 100000, currency: 'ZAR', startDate: '2027-01-01', expiryDate: '2026-12-20' } } } },
  { name: 'GET /v1/candidates/{id}/events', handler: 'getCandidateEvents', own: { path: { id: ID.a1 } } },
  { name: 'POST /v1/intelligence/tiles/{id}/dismiss', handler: 'dismissTile', own: { method: 'POST', path: { id: `tile-${ID.a1}-RULE-SLA-002` }, body: { tenantId: A } } },
  { name: 'POST /v1/intelligence/tiles/{id}/snooze', handler: 'snoozeTile', own: { method: 'POST', path: { id: `tile-${ID.a1}-RULE-SLA-002` }, body: { hours: 24, tenantId: A } } },
  { name: 'POST /v1/intelligence/tiles/{id}/acknowledge', handler: 'acknowledgeTile', own: { method: 'POST', path: { id: `tile-${ID.a1}-RULE-SLA-002` }, body: { reason: 'seen', tenantId: A } } },
  { name: 'GET /v1/candidates', handler: 'getCandidates', own: { query: { tenantId: A } } },
  { name: 'POST /v1/candidates', handler: 'createCandidate', own: { method: 'POST', body: { idempotencyKey: 'idem-a-0001', firstName: 'Lerato', lastName: 'Mokoena', email: 'lerato@example.test', positionTitle: 'Baker', positionLevel: 'JUNIOR', tenantId: A } } },
  { name: 'GET /v1/intelligence/tiles', handler: 'getIntelligenceTiles', own: { query: { tenantId: A, role: 'TA' } } },
  { name: 'GET /v1/config', handler: 'manageTalentFlowConfig', own: { query: { tenantId: A, configType: 'SCORING_WEIGHTS', active: 'true' } } },
  { name: 'POST /v1/config', handler: 'manageTalentFlowConfig', own: { method: 'POST', body: { tenantId: A, configType: 'PANEL_CONFIG', data: { x: 1 } } } },
  { name: 'PUT /v1/config', handler: 'manageTalentFlowConfig', own: { method: 'PUT', body: { tenantId: A, configType: 'SCORING_WEIGHTS', data: { weights: { skills: 45 } } } } },
  { name: 'GET /v1/notifications', handler: 'getUserNotifications', own: { query: {} } },
  { name: 'PATCH /v1/notifications/{id}/read', handler: 'markNotificationRead', own: { method: 'PATCH', path: { id: `NOTIF#2026-11-10T08:00:00.000Z#${ID.notifA}` } } },
  { name: 'GET /v1/panel-members', handler: 'getPanelMembers', own: { query: {} } },
  { name: 'GET /v1/hiring-managers', handler: 'getHiringManagers', own: { query: {} } },
  // talentFlowApproveAction: the agent key route and the HR routes (TEN-03 rule 5), reject included.
  { name: 'GET /v1/actions/{id} (agent)', handler: 'talentFlowApproveAction', who: 'agent', own: { rawPath: `/v1/actions/${ID.actionA}` } },
  { name: 'GET /v1/actions/pending (HR)', handler: 'talentFlowApproveAction', own: { rawPath: '/v1/actions/pending' } },
  { name: 'POST /v1/actions/{id}/approve (HR)', handler: 'talentFlowApproveAction', own: { method: 'POST', rawPath: `/v1/actions/${ID.actionA}/approve`, body: {} } },
  { name: 'POST /v1/actions/{id}/reject (HR)', handler: 'talentFlowApproveAction', own: { method: 'POST', rawPath: `/v1/actions/${ID.actionA}/reject`, body: { reason: 'Not now' } } },
];

/** The caller of `company` a route is called with. */
export function callerFor(route: Route, company: 'A' | 'B' | 'C' | 'D'): Caller {
  if (route.who === 'agent') return company === 'D' ? 'agentC' : (`agent${company}` as Caller);
  return `staff${company}` as Caller;
}

/** The Lambda folders on the rule 4 list (routes above, the TalentFlow chat's tools, vote by token, the three event handlers). */
export const GATED_ROUTE_LAMBDAS = [...new Set(ROUTES.map((r) => r.handler))];
export const GATED_EVENT_LAMBDAS = ['evaluateIntelligenceRules', 'sendTalentFlowNotification', 'orchestrateTalentFlowWorkflow'];
export const GATED_LAMBDAS = [...GATED_ROUTE_LAMBDAS, 'talentFlowAiChat', 'submitVoteByToken', ...GATED_EVENT_LAMBDAS];

/**
 * The Recruitment tools of the TalentFlow chat (lambda/talentFlowAiChat/tool-resolver.mjs, TOOL_DEFINITIONS), with
 * arguments that name company A's records. Rule 4 gates them inside resolveToolCall (decision D-3).
 */
export const TOOLS: { name: string; args: Record<string, unknown> }[] = [
  { name: 'get_candidate', args: { candidateId: ID.a1 } },
  { name: 'get_pipeline_overview', args: {} },
  { name: 'get_vote_summary', args: { candidateId: ID.a1 } },
  { name: 'get_sla_status', args: { workflowId: 'wf-a-0001' } },
  { name: 'get_workflow_audit_trail', args: { workflowId: 'wf-a-0001' } },
  { name: 'get_config', args: { configType: 'SCORING_WEIGHTS' } },
  { name: 'schedule_interview', args: { candidateId: ID.a1, interviewType: 'HR_SCREEN' } },
  { name: 'flag_sla_risk', args: { candidateId: ID.a1, reason: 'late' } },
  { name: 'update_config', args: { configType: 'SCORING_WEIGHTS', data: { weights: { skills: 10 } } } },
];
export { NAME };
