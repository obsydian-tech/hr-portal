'use strict';

/**
 * lambda/getItTasks/index.js
 *
 * Trigger: HTTP API v2 — GET /v1/it/tasks
 * Auth:    JWT (Naleko Cognito pool — via talentFlowAuthorizer)
 *
 * Query params:
 *   tenantId  — required
 *   status    — comma-separated, default "UNASSIGNED,CLAIMED"
 *               allowed: UNASSIGNED | CLAIMED | COMPLETED
 *   queue     — optional filter: queue name (overrides role-scoping for admins)
 *   nextToken — optional pagination cursor
 *
 * Role-scoping:
 *   ITAdmin / TalentFlowAdmin → see ALL tasks.
 *   ITSpecialist              → see only tasks whose queue.assignedSpecialists
 *                               includes their Cognito sub.
 *
 * Env vars:
 *   IT_TASKS_TABLE    — it-tasks DynamoDB table name
 *   CONFIG_TABLE_NAME — talent-flow-config DynamoDB table name
 */

const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { getConfig } = require('../shared/config-reader');

const client = new DynamoDBClient({});
const TABLE  = process.env.IT_TASKS_TABLE;
const GSI1   = 'byTenantStatus';

const ALLOWED_STATUSES = new Set(['UNASSIGNED', 'CLAIMED', 'COMPLETED']);

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

function extractClaims(event) {
  return event?.requestContext?.authorizer?.jwt?.claims ?? {};
}

function parseGroups(rawGroups) {
  if (!rawGroups) return [];
  if (Array.isArray(rawGroups)) return rawGroups;
  const s = String(rawGroups);
  if (s.startsWith('[')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1).split(/[\s,]+/).filter(Boolean); }
  }
  return s.split(',').map(g => g.trim()).filter(Boolean);
}

exports.handler = async (event) => {
  const claims   = extractClaims(event);
  const groups   = parseGroups(claims['cognito:groups']);
  const userSub  = claims.sub;
  // DEBUG — remove once auth is confirmed working
  console.log('[getItTasks] sub:', userSub, 'groups_raw:', claims['cognito:groups'], 'parsed:', JSON.stringify(groups));

  const isITSpecialist = groups.includes('ITSpecialist') && !groups.includes('ITAdmin');
  const isITAdmin      = groups.includes('ITAdmin');
  const isAdmin        = claims['custom:isAdmin'] === 'true' || groups.includes('TalentFlowAdmin') || isITAdmin;

  if (!isITSpecialist && !isAdmin) {
    return respond(403, { message: 'Forbidden: IT Admin or IT Specialist group required.' });
  }

  const qs          = event.queryStringParameters ?? {};
  const tenantId    = qs.tenantId;
  const queueFilter = qs.queue ?? null;

  if (!tenantId) {
    return respond(400, { message: 'tenantId query param is required.' });
  }

  const rawStatus = qs.status ?? 'UNASSIGNED,CLAIMED';
  const statuses  = rawStatus.split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => ALLOWED_STATUSES.has(s));

  if (statuses.length === 0) {
    return respond(400, { message: `Invalid status values: ${rawStatus}` });
  }

  // ── Determine which queue names this user is allowed to see ──────────────
  // ITSpecialists only see queues where their sub is in assignedSpecialists.
  // ITAdmin / TalentFlowAdmin see all queues (allowedQueues = null = unlimited).
  let allowedQueues = null; // null → no queue restriction
  if (isITSpecialist && !isAdmin) {
    try {
      const queuesConfig = await getConfig(tenantId, 'IT_QUEUES');
      const queues = queuesConfig.queues ?? [];
      allowedQueues = queues
        .filter(q => q.active && Array.isArray(q.assignedSpecialists) && q.assignedSpecialists.includes(userSub))
        .map(q => q.name);
      console.log('[getItTasks] specialist queue scope:', JSON.stringify(allowedQueues));
      if (allowedQueues.length === 0) {
        // Assigned to no queues — return empty legitimately
        return respond(200, { tasks: [] });
      }
    } catch (err) {
      // Config read failure — fail open (show all tasks) so specialists aren't locked out during a config outage
      console.warn('[getItTasks] IT_QUEUES config read failed, falling back to unscoped query:', err.message);
      allowedQueues = null;
    }
  }

  try {
    // Query GSI1 once per requested status (DynamoDB cannot do OR on SK)
    const results = await Promise.all(
      statuses.map(status =>
        client.send(new QueryCommand({
          TableName:              TABLE,
          IndexName:              GSI1,
          KeyConditionExpression: 'tenantId = :tid AND taskStatus = :status',
          ExpressionAttributeValues: {
            ':tid':    { S: tenantId },
            ':status': { S: status  },
          },
          Limit: 100,
        })),
      ),
    );

    // Normalize: DynamoDB PK is `taskId`; Angular model expects `id`
    let tasks = results.flatMap(r =>
      (r.Items ?? []).map(item => {
        const t = unmarshall(item);
        if (!t.id) t.id = t.taskId;
        return t;
      }),
    );

    // Apply role-based queue scope (ITSpecialists only see their queues)
    if (allowedQueues !== null) {
      tasks = tasks.filter(t => allowedQueues.includes(t.queue));
    }

    // Apply optional explicit queue filter (works for admins browsing by queue)
    if (queueFilter) {
      tasks = tasks.filter(t => t.queue === queueFilter);
    }

    // Sort: BREACHED first → AT_RISK → ON_TRACK; within each group: soonest daysRemaining
    const slaOrder = { BREACHED: 0, AT_RISK: 1, ON_TRACK: 2 };
    tasks.sort((a, b) => {
      const diff = (slaOrder[a.slaStatus] ?? 9) - (slaOrder[b.slaStatus] ?? 9);
      if (diff !== 0) return diff;
      return (a.newHire?.daysRemaining ?? 999) - (b.newHire?.daysRemaining ?? 999);
    });

    return respond(200, { tasks });

  } catch (err) {
    console.error('getItTasks error', err);
    return respond(500, { message: 'Internal server error.' });
  }
};
