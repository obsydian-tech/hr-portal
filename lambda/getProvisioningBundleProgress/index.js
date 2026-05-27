'use strict';

/**
 * lambda/getProvisioningBundleProgress/index.js
 *
 * Trigger: HTTP API v2 — GET /v1/provisioning/bundles/{bundleId}/progress
 * Auth:    JWT — HM who owns bundle, ITAdmin, ITSpecialist, or TalentFlowAdmin.
 *
 * Returns ProvisioningBundleProgress: bundle + items enriched with
 * specialist assignment + activityLog from it-tasks (via byCandidateId GSI).
 *
 * Env vars:
 *   BUNDLES_TABLE  — provisioning-bundles DynamoDB table name
 *   IT_TASKS_TABLE — it-tasks DynamoDB table name
 */

const { DynamoDBClient, GetItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamo = new DynamoDBClient({});
const BUNDLES_TABLE  = process.env.BUNDLES_TABLE;
const IT_TASKS_TABLE = process.env.IT_TASKS_TABLE;
const GSI_BY_CANDIDATE = 'byCandidateId';

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

function extractClaims(event) {
  return event?.requestContext?.authorizer?.jwt?.claims ?? {};
}

function parseGroups(rawGroups) {
  if (!rawGroups) return [];
  const s = String(rawGroups);
  if (s.startsWith('[')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1).split(/[\s,]+/).filter(Boolean); }
  }
  return s.split(',').map(g => g.trim()).filter(Boolean);
}

/** Map it-task status to ProvisioningItemStatus */
function mapTaskStatus(taskStatus) {
  switch (taskStatus) {
    case 'COMPLETED': return 'COMPLETE';
    case 'CLAIMED':   return 'IN_PROGRESS';
    case 'BREACHED':  return 'BREACHED';
    default:          return 'PENDING';
  }
}

/** Build activityLog entries from it-task events */
function buildActivityLog(tasks) {
  const entries = [];
  for (const task of tasks) {
    if (task.completedAt) {
      entries.push({
        id:      `complete-${task.taskId}`,
        type:    'COMPLETE',
        message: `${task.requirementType ?? task.queue} task completed`,
        detail:  `${task.completedAt.slice(0, 10)} · ${task.specialistName ?? 'IT Specialist'}`,
      });
    }
    if (task.claimedAt) {
      entries.push({
        id:      `claim-${task.taskId}`,
        type:    'INFO',
        message: `${task.requirementType ?? task.queue} task claimed`,
        detail:  `${task.claimedAt.slice(0, 10)} · ${task.specialistName ?? 'IT Specialist'}`,
      });
    }
    if (task.slaStatus === 'BREACHED') {
      entries.push({
        id:      `breach-${task.taskId}`,
        type:    'BREACH',
        message: `${task.requirementType ?? task.queue} SLA breached — task unassigned in ${task.queue} queue`,
        detail:  'TA and HM notified',
      });
    }
  }
  // Sort by newest first (crude string sort on ISO timestamps)
  return entries.sort((a, b) => b.id.localeCompare(a.id));
}

exports.handler = async (event) => {
  const claims  = extractClaims(event);
  const userId  = claims.sub;
  const groups  = parseGroups(claims['cognito:groups']);
  const isAdmin = claims['custom:isAdmin'] === 'true' || groups.includes('TalentFlowAdmin');
  const isIT    = groups.some(g => ['ITAdmin', 'ITSpecialist'].includes(g));

  if (!userId) return respond(401, { message: 'Unauthorized.' });

  const bundleId = event.pathParameters?.bundleId;
  if (!bundleId) return respond(400, { message: 'bundleId path parameter is required.' });

  // Fetch bundle
  let bundle;
  try {
    const res = await dynamo.send(new GetItemCommand({
      TableName: BUNDLES_TABLE,
      Key: { bundleId: { S: bundleId } },
    }));
    if (!res.Item) return respond(404, { message: 'Bundle not found.' });
    bundle = unmarshall(res.Item);
  } catch (err) {
    console.error('[getProvisioningBundleProgress] GetItem error', err);
    return respond(500, { message: 'Internal server error.' });
  }

  // Access check: HM owner, ITAdmin, ITSpecialist, or TalentFlowAdmin
  if (!isAdmin && !isIT && bundle.hmUserId !== userId) {
    return respond(404, { message: 'Bundle not found.' });
  }

  // Fetch linked it-tasks via byCandidateId GSI
  let itTasks = [];
  try {
    const res = await dynamo.send(new QueryCommand({
      TableName:              IT_TASKS_TABLE,
      IndexName:              GSI_BY_CANDIDATE,
      KeyConditionExpression: 'candidateId = :cid',
      ExpressionAttributeValues: { ':cid': { S: bundle.candidateId } },
      ScanIndexForward: false,
      Limit: 100,
    }));
    itTasks = (res.Items ?? []).map(i => unmarshall(i));
  } catch (err) {
    // Non-fatal: progress still useful even without task-level enrichment
    console.warn('[getProvisioningBundleProgress] it-tasks query failed:', err.message);
  }

  // Build a map from requirementType/queue → task for item enrichment
  const taskByQueue = new Map();
  for (const task of itTasks) {
    const key = task.requirementType ?? task.queue;
    if (key) taskByQueue.set(key, task);
  }

  // Enrich bundle items with task-level progress
  const itemsProgress = (bundle.items ?? []).map(item => {
    const task = taskByQueue.get(item.type) ?? taskByQueue.get(item.queue);
    if (!task) return { ...item, taskSlaStatus: 'ON_TRACK' };

    return {
      ...item,
      status:              mapTaskStatus(task.taskStatus),
      specialistName:      task.specialistName ?? null,
      specialistInitials:  task.specialistName
        ? task.specialistName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
        : null,
      completedAt:         task.completedAt ?? null,
      taskSlaStatus:       task.slaStatus ?? 'ON_TRACK',
    };
  });

  // Derive bundle-level slaStatus from items
  const statuses = itemsProgress.map(i => i.taskSlaStatus);
  let bundleSlaStatus = 'ON_TRACK';
  if (statuses.includes('BREACHED'))  bundleSlaStatus = 'BREACHED';
  else if (statuses.includes('AT_RISK')) bundleSlaStatus = 'AT_RISK';

  const progress = {
    ...bundle,
    id:          bundle.id ?? bundle.bundleId,
    items:       itemsProgress,
    slaStatus:   bundleSlaStatus,
    activityLog: buildActivityLog(itTasks),
  };

  return respond(200, { progress });
};
