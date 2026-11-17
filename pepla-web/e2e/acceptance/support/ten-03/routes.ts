import { A, B, ID, NAME, SUB, type Ask, type Caller } from './world';

/**
 * TEN-03: every TalentFlow, IT task and provisioning bundle route a person or agent calls, with one valid request
 * for company A's own record (`own`). The same request, sent by a caller of company B, aims at A's record.
 * Old clients still send tenantId in bodies and queries; it is sent here too (as A, the record's own company) so
 * the request is valid today and after the change. The spec's list plus four the BA added on 17 Nov
 * (captureSentiment, markNotificationRead, generateScoringLink, talentFlowApproveAction).
 */
export type Route = {
  name: string;
  handler: string;
  caller?: Caller;
  own: Ask;
  /** Reads or changes a record by id: another company's caller gets 404 (AC-3). */
  byId?: boolean;
  /** Writes something when it works, so a refusal must leave every row as it was. */
  writes?: boolean;
  /** What a good run answers (some routes answer with a skip, a 201 or a 200). */
  ok?: number[];
};

const ivBody = { tenantId: A, candidateId: ID.a1, interviewId: 'iv-new-0001', interviewType: 'HR_SCREEN', panelMemberIds: [SUB.panelA], scheduledAt: '2026-12-02T09:00:00.000Z' };

export const ROUTES: Route[] = [
  { name: 'GET /v1/candidates/{id}', handler: 'getCandidate', own: { path: { id: ID.a1 } }, byId: true },
  { name: 'PATCH /v1/candidates/{id}', handler: 'updateCandidate', own: { method: 'PATCH', path: { id: ID.a1 }, body: { firstName: 'Jon' } }, byId: true, writes: true },
  { name: 'PUT /v1/candidates/{id}/stage', handler: 'advanceCandidateStage', own: { method: 'PUT', path: { id: ID.a1 }, body: { newStage: 'INTERVIEWING', tenantId: A } }, byId: true, writes: true },
  { name: 'GET /v1/candidates/{id}/interviews', handler: 'scheduleInterview', own: { path: { id: ID.a1 } }, byId: true },
  { name: 'PATCH /v1/candidates/{id}/interviews/{interviewId}', handler: 'scheduleInterview', own: { method: 'PATCH', path: { id: ID.a1, interviewId: ID.ivA }, body: { action: 'complete', outcome: 'PASS' } }, byId: true, writes: true },
  { name: 'POST /v1/candidates/{id}/interviews', handler: 'scheduleInterview', own: { method: 'POST', path: { id: ID.a2 }, body: { ...ivBody, candidateId: ID.a2 } }, byId: true, writes: true },
  { name: 'POST /v1/candidates/{id}/votes', handler: 'submitVote', own: { method: 'POST', path: { id: ID.a1 }, body: { candidateId: ID.a1, tenantId: A, voterId: SUB.hmA, rating: 'YES', interviewId: ID.ivA, scores: { technical: 4, communication: 4, culturalFit: 4, problemSolving: 4 } } }, byId: true, writes: true },
  { name: 'POST /v1/candidates/{id}/sentiment', handler: 'captureSentiment', own: { method: 'POST', path: { id: ID.a1 }, body: { interviewSentiment: 'INTERESTED', tenantId: A } }, byId: true, writes: true },
  { name: 'POST /v1/candidates/{id}/scoring-links', handler: 'generateScoringLink', own: { method: 'POST', path: { id: ID.a1 }, body: { panelMemberId: SUB.panelA, panelMemberEmail: 'panel.a@example.test', panelMemberName: 'Panel A', panelMemberRole: 'Engineer', tenantId: A, interviewId: ID.ivA } }, byId: true, writes: true, ok: [200, 201] },
  { name: 'GET /v1/candidates/{id}/offer', handler: 'getOffer', own: { path: { id: ID.a1 } }, byId: true },
  { name: 'POST /v1/candidates/{id}/offer', handler: 'createOffer', own: { method: 'POST', path: { id: ID.a2 }, body: { tenantId: A } }, byId: true, writes: true },
  { name: 'PUT /v1/candidates/{id}/offer', handler: 'advanceOfferState', own: { method: 'PUT', path: { id: ID.a1 }, body: { action: 'SUBMIT_FOR_APPROVAL', payload: { baseSalary: 100000, currency: 'ZAR', startDate: '2027-01-01', expiryDate: '2026-12-20' } } }, byId: true, writes: true },
  { name: 'GET /v1/candidates/{id}/events', handler: 'getCandidateEvents', own: { path: { id: ID.a1 } }, byId: true },
  { name: 'POST /v1/intelligence/tiles/{id}/dismiss', handler: 'dismissTile', own: { method: 'POST', path: { id: `tile-${ID.a1}-RULE-SLA-002` }, body: { tenantId: A } }, byId: true, writes: true },
  { name: 'POST /v1/intelligence/tiles/{id}/snooze', handler: 'snoozeTile', own: { method: 'POST', path: { id: `tile-${ID.a1}-RULE-SLA-002` }, body: { hours: 24, tenantId: A } }, byId: true, writes: true },
  { name: 'POST /v1/intelligence/tiles/{id}/acknowledge', handler: 'acknowledgeTile', own: { method: 'POST', path: { id: `tile-${ID.a1}-RULE-SLA-002` }, body: { reason: 'seen', tenantId: A } }, byId: true, writes: true },
  { name: 'GET /v1/it/tasks/{taskId}', handler: 'getItTask', own: { path: { taskId: ID.taskA } }, byId: true },
  { name: 'POST /v1/it/tasks/{taskId}/claim', handler: 'claimItTask', own: { method: 'POST', path: { taskId: ID.taskA } }, byId: true, writes: true },
  { name: 'POST /v1/it/tasks/{taskId}/complete', handler: 'completeItTask', own: { method: 'POST', path: { taskId: ID.taskA3 }, body: { assetReference: 'ASSET-1', fulfilmentMethod: 'ISSUED' } }, byId: true, writes: true },
  { name: 'POST /v1/it/tasks/{taskId}/release', handler: 'releaseItTask', own: { method: 'POST', path: { taskId: ID.taskA4 }, body: { reason: 'busy' } }, byId: true, writes: true },
  { name: 'GET /v1/provisioning/bundles/{bundleId}', handler: 'getProvisioningBundle', own: { path: { bundleId: ID.bundleA } }, byId: true },
  { name: 'GET /v1/provisioning/bundles/{bundleId}/progress', handler: 'getProvisioningBundleProgress', own: { path: { bundleId: ID.bundleA } }, byId: true },
  { name: 'POST /v1/provisioning/bundles/{bundleId}/approve', handler: 'approveProvisioningBundle', own: { method: 'POST', path: { bundleId: ID.bundleA } }, byId: true, writes: true },
  { name: 'PATCH /v1/provisioning/bundles/{bundleId}', handler: 'updateProvisioningBundle', own: { method: 'PATCH', path: { bundleId: ID.bundleA }, body: { department: 'Operations' } }, byId: true, writes: true },
  // Lists and creates (no id of someone else's to aim at)
  { name: 'GET /v1/candidates', handler: 'getCandidates', own: { query: { tenantId: A } } },
  { name: 'POST /v1/candidates', handler: 'createCandidate', own: { method: 'POST', body: { idempotencyKey: 'idem-a-0001', firstName: 'Lerato', lastName: 'Mokoena', email: 'lerato@example.test', positionTitle: 'Baker', positionLevel: 'JUNIOR', tenantId: A } }, writes: true },
  { name: 'GET /v1/intelligence/tiles', handler: 'getIntelligenceTiles', own: { query: { tenantId: A, role: 'TA' } } },
  { name: 'GET /v1/config', handler: 'manageTalentFlowConfig', own: { query: { tenantId: A, configType: 'SCORING_WEIGHTS', active: 'true' } } },
  { name: 'POST /v1/config', handler: 'manageTalentFlowConfig', own: { method: 'POST', body: { tenantId: A, configType: 'PANEL_CONFIG', data: { x: 1 } } }, writes: true },
  { name: 'PUT /v1/config', handler: 'manageTalentFlowConfig', own: { method: 'PUT', body: { tenantId: A, configType: 'SCORING_WEIGHTS', data: { weights: { skills: 45 } } } }, writes: true },
  { name: 'GET /v1/it/tasks', handler: 'getItTasks', own: { query: { tenantId: A } } },
  { name: 'GET /v1/provisioning/bundles', handler: 'getProvisioningBundles', own: { query: {} } },
  { name: 'POST /v1/provisioning/bundles', handler: 'createProvisioningBundle', own: { method: 'POST', body: { candidateId: ID.a1, candidateName: NAME.a1, candidateRole: 'Junior baker', startDate: '2026-12-01', items: [{ type: 'LAPTOP', label: 'Laptop', queue: 'Laptops' }] } }, writes: true, ok: [200, 201] },
  { name: 'GET /v1/notifications', handler: 'getUserNotifications', own: { query: {} } },
  { name: 'PATCH /v1/notifications/{id}/read', handler: 'markNotificationRead', own: { method: 'PATCH', path: { id: `NOTIF#2026-11-10T08:00:00.000Z#${ID.notifA}` } }, writes: true },
  { name: 'GET /v1/panel-members', handler: 'getPanelMembers', own: { query: {} } },
  { name: 'GET /v1/hiring-managers', handler: 'getHiringManagers', own: { query: {} } },
];
export { B };
