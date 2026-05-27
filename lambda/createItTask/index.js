'use strict';

/**
 * lambda/createItTask/index.js
 *
 * INTERNAL — invoked directly (not via API Gateway) by orchestrateTalentFlowWorkflow
 * when a provisioning bundle reaches APPROVED state.
 *
 * Responsibilities:
 *   1. Read IT admin config from talent-flow-config table:
 *      - IT_QUEUES       — queue definitions with SLA hours
 *      - ROUTING_RULES   — maps (department|role|location|seniority) → queueId
 *      - PROVISIONING_TEMPLATES — checklist items per template/role
 *
 *   2. For each item in the provisioning bundle:
 *      a. Determine the target queue via routing rules (fallback: category default)
 *      b. Resolve checklist from the matching provisioning template
 *      c. Calculate SLA deadline = candidate startDate − slaHours from queue config
 *      d. Write one record to it-tasks (PK=taskId) with initial status UNASSIGNED
 *
 *   3. Return list of created taskIds.
 *
 * Invocation payload (from orchestrateTalentFlowWorkflow):
 * {
 *   candidateId:   string,
 *   tenantId:      string,
 *   bundleId:      string,
 *   approvedBy:    string,        // HM display name
 *   startDate:     string,        // ISO date "YYYY-MM-DD"
 *   daysRemaining: number,
 *   newHire: {
 *     name:             string,
 *     role:             string,
 *     seniority:        string,
 *     department:       string,
 *     deliveryLocation: string,
 *   },
 *   requirements: Array<{
 *     itemName:  string,
 *     category:  string,          // HARDWARE | SOFTWARE | ACCESS | PERIPHERALS | OTHER
 *     optional:  boolean,
 *   }>
 * }
 *
 * Env vars:
 *   IT_TASKS_TABLE  — it-tasks DynamoDB table name
 *   CONFIG_TABLE_NAME — talent-flow-config (for admin config reads)
 */

const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { getConfig } = require('../shared/config-reader');
const { randomUUID } = require('crypto');

const client     = new DynamoDBClient({});
const TABLE      = process.env.IT_TASKS_TABLE;

// ── Default queue by category ──────────────────────────────────────────────
// Fallback when no matching routing rule exists.
const CATEGORY_TO_QUEUE = {
  HARDWARE:    'Hardware',
  SOFTWARE:    'Software',
  ACCESS:      'Access & Identity',
  PERIPHERALS: 'Hardware',
  OTHER:       'Facilities',
};

const QUEUE_TO_REQUIREMENT_TYPE = {
  'Hardware':          'Hardware',
  'Software':          'Software',
  'Access & Identity': 'Access & Identity',
  'Facilities':        'Facilities',
};

// Default SLA hours by queue name when admin has not configured a queue yet
const DEFAULT_SLA_HOURS = {
  'Hardware':          120,  // 5 business days
  'Software':          48,
  'Access & Identity': 24,
  'Facilities':        168,
};

function slaStatus(slaDeadline, now) {
  const msRemaining = new Date(slaDeadline).getTime() - now;
  const hoursRemaining = msRemaining / (1000 * 60 * 60);
  if (hoursRemaining <= 0)  return 'BREACHED';
  if (hoursRemaining <= 48) return 'AT_RISK';
  return 'ON_TRACK';
}

function resolveQueue(requirement, newHire, routingRules, queues) {
  // Try routing rules in priority order (lower number = higher priority)
  const sorted = [...routingRules].sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    let fieldValue = '';
    switch (rule.conditionField) {
      case 'department': fieldValue = (newHire.department ?? '').toLowerCase(); break;
      case 'role':       fieldValue = (newHire.role       ?? '').toLowerCase(); break;
      case 'seniority':  fieldValue = (newHire.seniority  ?? '').toLowerCase(); break;
      case 'location':   fieldValue = (newHire.deliveryLocation ?? '').toLowerCase(); break;
    }
    if (fieldValue.includes(rule.conditionValue.toLowerCase())) {
      const queue = queues.find(q => q.id === rule.targetQueueId);
      if (queue?.active) return queue.name;
    }
  }

  // Fall back to category default
  return CATEGORY_TO_QUEUE[requirement.category] ?? 'Facilities';
}

function resolveChecklist(requirement, templates, newHire) {
  // Find the best-matching template for this hire's role
  const match = templates.find(t =>
    t.active &&
    (t.targetRole.toLowerCase() === (newHire.role ?? '').toLowerCase() ||
     t.name.toLowerCase().includes(requirement.category.toLowerCase())),
  );

  if (match) {
    return match.requirements
      .filter(r => r.category === requirement.category || !r.category)
      .map((r, i) => ({ id: `c${i + 1}`, label: r.itemName, completed: false }));
  }

  // Generic fallback checklist per category
  const defaults = {
    HARDWARE:    ['Source hardware', 'Apply company image', 'Record asset tag', 'Confirm delivery'],
    SOFTWARE:    ['Procure licence', 'Assign to user account', 'Confirm in system'],
    ACCESS:      ['Create AD/IdP account', 'Provision email', 'Configure access', 'Send confirmation'],
    PERIPHERALS: ['Source peripherals', 'Record asset tag', 'Deliver to desk'],
    OTHER:       ['Complete setup', 'Confirm ready for start date'],
  };
  return (defaults[requirement.category] ?? defaults.OTHER).map((label, i) => ({
    id: `c${i + 1}`, label, completed: false,
  }));
}

exports.handler = async (payload) => {
  // Support both direct invocation and EventBridge envelope
  let detail = payload;
  if (payload['detail-type'] && payload.detail) {
    // EventBridge event — unwrap
    detail = typeof payload.detail === 'string' ? JSON.parse(payload.detail) : payload.detail;
    console.info(`[createItTask] invoked from EventBridge: detail-type=${payload['detail-type']}`);
  }

  // Map BundleApproved EB event to createItTask payload
  // EB event shape: { bundleId, candidateId, candidateName, candidateRole, seniority, department, startDate, tenantId, items[], approvedBy }
  if (detail.items && !detail.requirements) {
    // Convert bundle items → requirements
    detail.requirements = (detail.items ?? []).map(item => ({
      itemName: item.label ?? item.type,
      category: item.type ?? 'OTHER',
      queueName: item.queue ?? null,
    }));
    detail.newHire = detail.newHire ?? {
      name:       detail.candidateName ?? '',
      role:       detail.candidateRole ?? '',
      seniority:  detail.seniority     ?? '',
      department: detail.department    ?? '',
      startDate:  detail.startDate     ?? '',
    };
    const startMs = new Date(detail.startDate ?? Date.now()).getTime();
    detail.daysRemaining = Math.ceil((startMs - Date.now()) / (1000 * 60 * 60 * 24));
  }

  const {
    candidateId,
    tenantId,
    bundleId,
    approvedBy,
    startDate,
    daysRemaining,
    newHire,
    requirements = [],
  } = detail;

  if (!candidateId || !tenantId || requirements.length === 0) {
    throw new Error(`createItTask: missing required fields. candidateId=${candidateId} tenantId=${tenantId} requirements=${requirements.length}`);
  }

  // ── Load admin config ──────────────────────────────────────────────────────
  const [queuesConfig, routingConfig, templatesConfig] = await Promise.all([
    getConfig(tenantId, 'IT_QUEUES').catch(() => ({ queues: [] })),
    getConfig(tenantId, 'ROUTING_RULES').catch(() => ({ rules: [] })),
    getConfig(tenantId, 'PROVISIONING_TEMPLATES').catch(() => ({ templates: [] })),
  ]);

  const queues    = queuesConfig.queues    ?? [];
  const rules     = routingConfig.rules    ?? [];
  const templates = templatesConfig.templates ?? [];

  const now          = Date.now();
  const startDateMs  = new Date(startDate).getTime();
  const createdAt    = new Date(now).toISOString();
  const startDisplay = startDate; // used as display string

  const createdTaskIds = [];

  // ── Create one task per requirement ───────────────────────────────────────
  for (const req of requirements) {
    const queueName  = resolveQueue(req, newHire, rules, queues);
    const queueCfg   = queues.find(q => q.name === queueName);
    const slaHours   = queueCfg?.slaHours ?? DEFAULT_SLA_HOURS[queueName] ?? 120;

    // SLA deadline = start date minus SLA hours
    const slaDeadlineMs = startDateMs - (slaHours * 60 * 60 * 1000);
    const slaDeadline   = new Date(slaDeadlineMs).toISOString();
    const currentSlaStatus = slaStatus(slaDeadline, now);
    const slaProgress  = Math.min(
      100,
      Math.round(((now - (slaDeadlineMs - (slaHours * 60 * 60 * 1000))) /
                   (slaHours * 60 * 60 * 1000)) * 100),
    );

    const taskId   = randomUUID();
    const title    = `${req.itemName} — ${newHire.role}`;
    const checklist = resolveChecklist(req, templates, newHire);

    const task = {
      taskId,
      tenantId,
      candidateId,
      bundleId:    bundleId ?? null,
      title,
      requirementType: QUEUE_TO_REQUIREMENT_TYPE[queueName] ?? queueName,
      queue:           queueName,
      taskStatus:      'UNASSIGNED',
      slaStatus:       currentSlaStatus,
      slaProgress,
      slaDeadline,
      requiredBy:      startDisplay,
      newHire: {
        name:             newHire.name,
        role:             newHire.role,
        seniority:        newHire.seniority     ?? '',
        department:       newHire.department    ?? '',
        startDate:        startDisplay,
        daysRemaining:    daysRemaining         ?? 0,
        deliveryLocation: newHire.deliveryLocation ?? '',
      },
      claimedBy:     null,
      claimedByName: null,
      claimedByRole: null,
      claimedAt:     null,
      hmNote:        null,
      hmName:        null,
      hmRole:        null,
      bundleApprovedBy: approvedBy ?? null,
      checklist,
      activity: [
        {
          type:      'create',
          text:      `Task created from approved bundle — ${approvedBy ?? 'System'}`,
          timestamp: createdAt,
          subtext:   `Auto-routed to ${queueName} queue`,
        },
      ],
      createdAt,
      updatedAt: createdAt,
    };

    await client.send(new PutItemCommand({
      TableName:           TABLE,
      Item:                marshall(task, { removeUndefinedValues: true }),
      // Idempotent — skip if a task with this ID already exists
      ConditionExpression: 'attribute_not_exists(taskId)',
    }));

    createdTaskIds.push(taskId);
    console.info(`createItTask: created task ${taskId} for ${candidateId} → queue ${queueName}`);
  }

  return { createdTaskIds, count: createdTaskIds.length };
};
