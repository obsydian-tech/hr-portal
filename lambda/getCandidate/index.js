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
const ROLES_TABLE = process.env.ROLES_TABLE_NAME || 'talent-flow-roles';
// REC-15 rule 12: the old fields the record keeps (and step 0 item 1's additions). Nothing else of the stored row is sent.
const KEPT_OLD = [
  'firstName', 'lastName', 'email', 'phone', 'positionTitle', 'positionLevel', 'location', 'experienceYears', 'source',
  'hiringManagerId', 'appliedDate', 'currentStage', 'stageEnteredAt', 'status', 'slaStatus', 'createdAt',
  'workflowTemplateId', 'configVersion', 'updatedAt', 'slaBreachedAt', 'interviewSentiment', 'engagementSentiment', 'acceptanceSentiment', 'engagementScore',
  'evaluationResult', 'finalScore', 'decided_by_kind',
];

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
    const row = unmarshall(result.Item);

    // Every interview row of this candidate (every page), the company's own only.
    let interviews = null;
    const loadInterviews = async () => {
      if (interviews) return interviews;
      const out = [];
      let start;
      do {
        const page = await dynamo.send(new QueryCommand({
          TableName: STATE_TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${row.candidateId}`, ':prefix': 'INTERVIEW#' }),
          ScanIndexForward: false,
          ExclusiveStartKey: start,
        }));
        for (const i of page.Items || []) { const iv = unmarshall(i); if (T.ownsRow(iv, tenantId)) out.push(iv); }
        start = page.LastEvaluatedKey;
      } while (start);
      interviews = out;
      return out;
    };

    let relation;
    try {
      relation = await RA.relationOf(event, row, loadInterviews);
    } catch (relationErr) {
      console.warn('getCandidate: could not prove access', { error: relationErr.name });
      return T.notFound();
    }
    if (!relation) return T.notFound();

    const S = await import('../shared/recruitment-stages.mjs');
    const CLOCK = await import('../shared/recruitment-actions/stage-clock.mjs');
    const PROG = await import('../shared/recruitment-actions/candidate-progress.mjs');
    const SET = await import('../shared/recruitment-settings.mjs');
    const DEPS = await import('../shared/departments.mjs');

    const all = await loadInterviews();
    const mine = relation === 'panel' ? all.filter((i) => RA.panelMemberOf(i, RA.callerId(event))) : all;
    const stage = S.normaliseStage(row) ?? 'APPLIED';
    const { settings, active } = await SET.settingsForRead(tenantId, row);

    // The role's current title (rule 5's fallback: the stored title when the role row is not found).
    let roleTitle = null;
    if (typeof row.role_id === 'string' && row.role_id) {
      try {
        const got = await dynamo.send(new GetItemCommand({ TableName: ROLES_TABLE, Key: marshall({ pk: `TENANT#${tenantId}`, sk: `ROLE#${row.role_id}` }) }));
        const r = got.Item ? unmarshall(got.Item) : null;
        if (r && T.ownsRow(r, tenantId) && r.role_id === row.role_id) roleTitle = r.job_title ?? null;
      } catch (roleErr) {
        if (roleErr.name !== 'ResourceNotFoundException' && !/no table/.test(String(roleErr.message))) throw roleErr;
      }
    }
    let department = row.department;
    if (typeof row.department_id === 'string' && row.department_id) {
      const { departments } = await DEPS.departmentsOf(tenantId, { table: process.env.TENANTS_TABLE });
      const d = departments.find((x) => x.id === row.department_id);
      if (d) department = d.name;
    }

    const out = {};
    for (const k of KEPT_OLD) if (row[k] !== undefined) out[k] = row[k];
    out.candidateId = row.candidateId;
    out.id = row.candidateId;
    if (mine.length > 0) {
      const scheduled = mine.find((i) => i.status === 'SCHEDULED') ?? mine[0];
      out.currentInterviewId = scheduled.interviewId ?? null;
    }
    out.stage = stage;
    out.role_id = row.role_id ?? null;
    out.role_title = roleTitle || row.positionTitle || null;
    out.level = row.positionLevel ?? null;
    out.applied_at = row.appliedDate ?? row.createdAt ?? null;
    if (row.department_id !== undefined) out.department_id = row.department_id;
    if (row.department_id !== undefined || row.department !== undefined) out.department = department ?? null;
    if (row.source !== undefined) out.source = row.source;

    const decider = { move: PROG.moveDeciderOf(settings, row), decide: PROG.decisionDeciderOf(settings, row) };
    const open = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'].includes(stage);
    if (relation === 'panel') {
      out.can_move = false;
      out.can_decide = false;
      return respond(200, RA.withoutKeys(out, /offer|salary/i));
    }
    for (const k of ['strong_no_count', 'reason_code', 'decided_by', 'stage_before_not_hired', 'legacy_stage']) {
      if (row[k] !== undefined) out[k] = row[k];
    }
    out.can_move = relation === 'recruiter' ? open : stage === 'INTERVIEW' && RA.canDecide(event, row, decider.move);
    out.can_decide = stage !== 'HIRED' && RA.canDecide(event, row, decider.decide);

    const clock = CLOCK.stageClock(row, active.SLA_THRESHOLDS ?? null, Date.now());
    out.stage_entered_at = CLOCK.enteredAt(row, stage);
    out.due_at = clock.due_at;
    out.sla_status = clock.sla_status;
    const completed = new Set(all.filter((i) => i.status === 'COMPLETED').map((i) => i.interviewType));
    const req = PROG.requiredInterviews(settings, row, completed);
    const counted = ['INTERVIEW', 'OFFER', 'HIRED', 'NOT_HIRED'].includes(stage);
    out.interviews_done = counted ? req.done : null;
    out.interviews_required = counted ? req.total : null;
    let next = null;
    if (['APPLIED', 'SCREENING', 'INTERVIEW'].includes(stage)) {
      const list = S.openStages(settings.STAGE_CONFIG?.screening);
      const order = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
      const to = order.slice(order.indexOf(stage) + 1).find((x) => list.includes(x));
      next = { from: stage, to, blocker: stage === 'INTERVIEW' && req.incomplete ? { code: 'INTERVIEWS_INCOMPLETE', done: req.done, total: req.total } : null };
    }
    out.next_step = next;
    out.legacy_hired = row.legacy_hired === true;
    if (relation === 'recruiter') {
      if (row.employee_id !== undefined) out.employee_id = row.employee_id;
      if (row.added_by !== undefined) out.added_by = row.added_by;
      if (row.settingVersions !== undefined) out.settingVersions = row.settingVersions;
    }
    return respond(200, RA.withoutKeys(out, /offer|salary/i));
  } catch (err) {
    console.error('getCandidate error', { error: err.name });
    return respond(500, { error: 'Something went wrong' });
  }
};
