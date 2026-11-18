/**
 * TEN-04 AC-7: one walk row for every route. The file (api/openapi.yaml) says who may call a route and where its company
 * comes from; this table says how to aim a request at company A's row on that route, and how company A reads the row back.
 * The walk fails when a route of the file has no row here, and the test fails when a Terraform route has no row.
 *
 * kinds:
 *   byId     a route with an id in its path. B's caller aims A's id at it. A write also names how A reads the row back.
 *   list     a route with no id that lists or reads. B's caller sees none of A's rows; naming A's company changes nothing.
 *   create   a write with no id. B's caller names A's company in the body; A's list is the same afterwards.
 *   stored   a public route whose company is the stored invite, vote token or row. A made-up token answers a refusal.
 *   agent    an agent-key route. One check on the lists: the answers hold none of B's rows (B has rows in the seed).
 *   covered  an agent-key route that the one agent check stands for (it is still a row, so the file cannot grow a route unwalked).
 *   none     docs and the tool manifest: served to anyone, hold no company data.
 */
export type Kind = 'employee' | 'document' | 'candidate' | 'interview' | 'tile' | 'config' | 'itTask' | 'bundle' | 'notification' | 'action' | 'user';
export type Row = {
  kind: 'byId' | 'list' | 'create' | 'stored' | 'agent' | 'covered' | 'none';
  /** path parameter -> what it names in company A */
  ids?: Record<string, Kind>;
  query?: Record<string, string>;
  body?: unknown;
  /** A reads the row (or the list) back with this route, before and after B's write. `ids` renames the path parameters of that route. */
  read?: { op: string; ids?: Record<string, Kind> };
  /** The answer echoes what the caller typed, so the typed values are not counted as data. */
  echo?: boolean;
};

const EMAIL_A = 'pepla-demo-naledi.dlamini@blackhole.postmarkapp.com';
const MARK = 'e2e.run-ten04';
export const TENANT_A_QUERY = '$A';
export const A_BODY = '$A';

const byId = (ids: Record<string, Kind>, extra: Partial<Row> = {}): Row => ({ kind: 'byId', ids, ...extra });
const write = (ids: Record<string, Kind>, body: unknown, read: Row['read'], extra: Partial<Row> = {}): Row => ({ kind: 'byId', ids, body, read, ...extra });
const list = (extra: Partial<Row> = {}): Row => ({ kind: 'list', ...extra });
const create = (body: unknown, read?: Row['read']): Row => ({ kind: 'create', body, read });
const cand = { id: 'candidate' } as const;
const readCand: Row['read'] = { op: 'GET /v1/candidates/{id}', ids: cand };
const iv = { tenantId: A_BODY, candidateId: 'CAND-01TEN04AAAAAAAAAAAAAAA1', interviewId: 'iv-ten04-b-0002', interviewType: 'HR_SCREEN', panelMemberIds: ['sub-ten04-panel'], scheduledAt: '2026-12-02T09:00:00.000Z' };

export const ROWS: Record<string, Row> = {
  // ---- employees API
  'POST /v1/invites/lookup': { kind: 'stored', body: { token: 'ten04-made-up-token' } },
  'POST /v1/invites/redeem': { kind: 'stored', body: { token: 'ten04-made-up-token', password: 'Ten04-made-up-1!' } },
  'GET /v1/employees/lookup': { kind: 'stored', query: { employeeId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' } },
  'POST /v1/employees/{id}/invite': write({ id: 'employee' }, {}, { op: 'GET /v1/employees/{id}/invite', ids: { id: 'employee' } }),
  'GET /v1/employees/{id}/invite': byId({ id: 'employee' }),
  'GET /v1/employees/by-email': list({ query: { email: EMAIL_A }, echo: true }),
  'GET /v1/hr-partners': list(),
  'GET /v1/employees/email-check': list({ query: { email: EMAIL_A }, echo: true }),
  'GET /v1/employees': list(),
  'POST /v1/employees': create({ first_name: 'Ten04', last_name: 'Walk', email: `${MARK}-b-new@example.com`, phone: '000 000 0000', department: 'Operations', job_title: 'Baker', tenantId: A_BODY }, { op: 'GET /v1/employees' }),
  'GET /v1/me': list(),
  'GET /v1/me/documents': list(),
  'POST /v1/me/documents/upload-url': create({ document_type: 'id_document', content_type: 'application/pdf', file_name: 'ten04.pdf', tenantId: A_BODY }, { op: 'GET /v1/me/documents' }),
  'POST /v1/me/consent': create({ tenantId: A_BODY }, { op: 'GET /v1/me' }),
  // ---- documents API
  'POST /v1/employees/{employee_id}/documents/upload-url': write({ employee_id: 'employee' }, { document_type: 'id_document', content_type: 'application/pdf', file_name: 'ten04.pdf' }, { op: 'GET /v1/employees/{id}/verifications', ids: { id: 'employee' } }),
  'GET /v1/verifications': list(),
  'GET /v1/verifications/{id}': byId({ id: 'document' }),
  'GET /v1/employees/{id}/verifications': byId({ id: 'employee' }),
  'GET /v1/documents/{id}/url': byId({ id: 'document' }),
  'GET /v1/verifications/{id}/summary': byId({ id: 'document' }),
  'PATCH /v1/verifications/{id}/review': write({ id: 'document' }, { decision: 'approved', notes: 'ten04' }, { op: 'GET /v1/verifications/{id}', ids: { id: 'document' } }),
  'POST /v1/employees/{id}/assess-risk': write({ id: 'employee' }, {}, { op: 'GET /v1/employees/{id}/verifications', ids: { id: 'employee' } }),
  'POST /v1/verifications/{id}/external': write({ id: 'document' }, {}, { op: 'GET /v1/verifications/{id}', ids: { id: 'document' } }),
  // ---- agent API (agent key: one check on the lists; the other routes stand behind it)
  'GET /agent/v1/employees': { kind: 'agent' },
  'GET /agent/v1/verifications': { kind: 'agent' },
  'GET /agent/v1/audit-log': { kind: 'agent' },
  'GET /agent/v1/employees/risk-report': { kind: 'agent' },
  'GET /agent/v1/employees/{id}': { kind: 'covered' },
  'GET /agent/v1/verifications/{id}/summary': { kind: 'covered' },
  'POST /agent/v1/employees/{id}/assess-risk': { kind: 'covered' },
  'GET /agent/v1/actions/{actionId}': { kind: 'covered' },
  'POST /agent/v1/actions/{actionId}/approve': { kind: 'covered' },
  'POST /agent/v1/actions/{actionId}/reject': { kind: 'covered' },
  'GET /agent/agent-tools.json': { kind: 'none' },
  // ---- agent API, signed-in people
  'GET /agent/v1/actions/pending': list(),
  'POST /agent/v1/ai-chat': create({ message: 'How many people are on the list?', tenantId: A_BODY }),
  'POST /agent/v1/talentflow/chat': create({ message: 'How many candidates are there?', tenantId: A_BODY }),
  // ---- TalentFlow API
  'GET /v1/candidates': list({ query: { tenantId: TENANT_A_QUERY } }),
  'POST /v1/candidates': create({ idempotencyKey: 'ten04-b-0001', firstName: 'Ten04', lastName: 'Walk', email: `${MARK}-b-cand@example.com`, positionTitle: 'Baker', positionLevel: 'JUNIOR', tenantId: A_BODY }, { op: 'GET /v1/candidates' }),
  'GET /v1/candidates/{id}': byId(cand),
  'PATCH /v1/candidates/{id}': write(cand, { firstName: 'Changed', tenantId: A_BODY }, readCand),
  'PUT /v1/candidates/{id}/stage': write(cand, { newStage: 'INTERVIEWING', tenantId: A_BODY }, readCand),
  'GET /v1/candidates/{id}/interviews': byId(cand),
  'POST /v1/candidates/{id}/interviews': write(cand, iv, { op: 'GET /v1/candidates/{id}/interviews', ids: cand }),
  'PATCH /v1/candidates/{id}/interviews/{interviewId}': write({ id: 'candidate', interviewId: 'interview' }, { action: 'complete', outcome: 'PASS' }, { op: 'GET /v1/candidates/{id}/interviews', ids: cand }),
  'POST /v1/candidates/{id}/votes': write(cand, { tenantId: A_BODY, voterId: 'sub-ten04-b', rating: 'YES', scores: { technical: 4, communication: 4, culturalFit: 4, problemSolving: 4 } }, readCand),
  'POST /v1/candidates/{id}/sentiment': write(cand, { interviewSentiment: 'INTERESTED', tenantId: A_BODY }, readCand),
  'POST /v1/candidates/{id}/scoring-links': write(cand, { panelMemberId: 'sub-ten04-panel', panelMemberEmail: `${MARK}-panel@example.com`, panelMemberName: 'Panel Walk', panelMemberRole: 'Engineer', tenantId: A_BODY }, readCand),
  'GET /v1/candidates/{id}/offer': byId(cand),
  'POST /v1/candidates/{id}/offer': write(cand, { tenantId: A_BODY }, { op: 'GET /v1/candidates/{id}/offer', ids: cand }),
  'PUT /v1/candidates/{id}/offer': write(cand, { action: 'SUBMIT_FOR_APPROVAL', payload: { baseSalary: 100000, currency: 'ZAR', startDate: '2027-01-01', expiryDate: '2026-12-20' } }, { op: 'GET /v1/candidates/{id}/offer', ids: cand }),
  'GET /v1/candidates/{id}/events': byId(cand),
  'GET /v1/panel-members': list(),
  'GET /v1/hiring-managers': list(),
  'GET /v1/notifications': list(),
  'PATCH /v1/notifications/{id}/read': write({ id: 'notification' }, {}, { op: 'GET /v1/notifications' }),
  'GET /v1/intelligence/tiles': list({ query: { tenantId: TENANT_A_QUERY, role: 'TA' } }),
  'POST /v1/intelligence/tiles/{id}/dismiss': write({ id: 'tile' }, { tenantId: A_BODY }, { op: 'GET /v1/intelligence/tiles' }),
  'POST /v1/intelligence/tiles/{id}/snooze': write({ id: 'tile' }, { hours: 24, tenantId: A_BODY }, { op: 'GET /v1/intelligence/tiles' }),
  'POST /v1/intelligence/tiles/{id}/acknowledge': write({ id: 'tile' }, { reason: 'seen', tenantId: A_BODY }, { op: 'GET /v1/intelligence/tiles' }),
  'GET /v1/config': list({ query: { tenantId: TENANT_A_QUERY, configType: 'SCORING_WEIGHTS', active: 'true' } }),
  'POST /v1/config': create({ tenantId: A_BODY, configType: 'PANEL_CONFIG', data: { x: 1 } }, { op: 'GET /v1/config' }),
  'PUT /v1/config/{id}': write({ id: 'config' }, { tenantId: A_BODY, data: { weights: { skills: 45 } } }, { op: 'GET /v1/config' }),
  'GET /v1/admin/dashboard': list(),
  'GET /v1/admin/users': list(),
  'POST /v1/admin/users': create({ email: `${MARK}-b-user@example.com`, givenName: 'Ten04', familyName: 'Walk', role: 'manager', permissions: [], tenantId: A_BODY }, { op: 'GET /v1/admin/users' }),
  'PUT /v1/admin/users/{userId}': write({ userId: 'user' }, { role: 'manager', permissions: [] }, { op: 'GET /v1/admin/users' }),
  'DELETE /v1/admin/users/{userId}': write({ userId: 'user' }, undefined, { op: 'GET /v1/admin/users' }),
  'GET /v1/it/tasks': list({ query: { tenantId: TENANT_A_QUERY } }),
  'GET /v1/it/tasks/{taskId}': byId({ taskId: 'itTask' }),
  'POST /v1/it/tasks/{taskId}/claim': write({ taskId: 'itTask' }, {}, { op: 'GET /v1/it/tasks/{taskId}', ids: { taskId: 'itTask' } }),
  'POST /v1/it/tasks/{taskId}/release': write({ taskId: 'itTask' }, { reason: 'busy' }, { op: 'GET /v1/it/tasks/{taskId}', ids: { taskId: 'itTask' } }),
  'POST /v1/it/tasks/{taskId}/complete': write({ taskId: 'itTask' }, { assetReference: 'ASSET-1', fulfilmentMethod: 'ISSUED' }, { op: 'GET /v1/it/tasks/{taskId}', ids: { taskId: 'itTask' } }),
  'GET /v1/provisioning/bundles': list(),
  'POST /v1/provisioning/bundles': create({ candidateId: 'CAND-01TEN04AAAAAAAAAAAAAAA1', candidateName: 'TEN04 Walk', candidateRole: 'Baker', startDate: '2026-12-01', items: [{ type: 'LAPTOP', label: 'Laptop', queue: 'Laptops' }], tenantId: A_BODY }, { op: 'GET /v1/provisioning/bundles' }),
  'GET /v1/provisioning/bundles/{bundleId}': byId({ bundleId: 'bundle' }),
  'GET /v1/provisioning/bundles/{bundleId}/progress': byId({ bundleId: 'bundle' }),
  'POST /v1/provisioning/bundles/{bundleId}/approve': write({ bundleId: 'bundle' }, {}, { op: 'GET /v1/provisioning/bundles/{bundleId}', ids: { bundleId: 'bundle' } }),
  'PATCH /v1/provisioning/bundles/{bundleId}': write({ bundleId: 'bundle' }, { department: 'Operations' }, { op: 'GET /v1/provisioning/bundles/{bundleId}', ids: { bundleId: 'bundle' } }),
  'POST /v1/scoring/{token}/votes': { kind: 'stored', ids: undefined, body: { rating: 'YES', scores: { technical: 4, communication: 4, culturalFit: 4, problemSolving: 4 } } },
  // ---- served to anyone
  'GET /docs': { kind: 'none' },
  'GET /openapi.yaml': { kind: 'none' },
};
void iv;
