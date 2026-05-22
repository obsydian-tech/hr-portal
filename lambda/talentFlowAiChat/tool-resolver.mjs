/**
 * AI-002 / NH-128: tool-resolver.mjs
 *
 * Maps Claude tool_use responses to DynamoDB reads/writes on the
 * TalentFlow state and config tables.
 *
 * IMPORTANT: No SecretsManager, no HTTP Agent API calls — this Lambda's IAM
 * policy has no secretsmanager:GetSecretValue permission.  All queries hit
 * DynamoDB directly using the existing StateTableRead / ConfigTableRead /
 * PendingActionsTable IAM statements.
 *
 * Staff-ID scoping: every tool that filters by reviewer includes `staffId`
 * sourced ONLY from the Cognito JWT — never from Claude's output.
 *
 * HITL gate: schedule_interview, flag_sla_risk, update_config write a
 * PENDING_APPROVAL record to talent-flow-pending-actions and return the
 * sentinel instead of executing the mutation directly.
 *
 * State table key shapes (talent-flow-state):
 *   CANDIDATE#{candidateId}          SK=SAGA          — candidate record
 *   WORKFLOW#{workflowId}            SK=STATE         — workflow state
 *   INTERVIEW#{interviewId}          SK=META          — interview metadata
 *   VOTE#{candidateId}#{reviewerId}  SK=SCORE         — reviewer vote
 *   AUDIT#{workflowId}               SK={isoTimestamp} — audit events
 *
 * Config table key shapes (talent-flow-config):
 *   TENANT#{tenantId}  SK=CONFIG#{configType}#v{version}  — config version
 *   GSI1: GSI1PK=TENANT#{tenantId}#ACTIVE  GSI1SK=CONFIG#{configType}
 */

import { DynamoDBClient, GetItemCommand, QueryCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'af-south-1' });

const STATE_TABLE           = process.env.STATE_TABLE_NAME          ?? 'talent-flow-state';
const CONFIG_TABLE          = process.env.CONFIG_TABLE_NAME         ?? 'talent-flow-config';
const PENDING_ACTIONS_TABLE = process.env.PENDING_ACTIONS_TABLE_NAME ?? 'talent-flow-pending-actions';

// ─── HITL gate ────────────────────────────────────────────────────────────────

/**
 * Tool name prefixes that require HR manager approval before execution.
 * Read-only tools pass through immediately.
 */
const WRITE_TOOL_PREFIXES = ['schedule', 'flag', 'update', 'approve', 'reject', 'create', 'delete'];

function isWriteTool(toolName) {
  return WRITE_TOOL_PREFIXES.some(prefix => toolName.startsWith(prefix));
}

/**
 * Intercept a write tool call: store in DynamoDB with PENDING_APPROVAL status.
 * @param {string} toolName
 * @param {object} toolArgs
 * @param {{ staffId: string }} context
 * @returns {Promise<object>} PENDING_APPROVAL response
 */
async function pendingApproval(toolName, toolArgs, context) {
  const actionId  = randomUUID();
  const now       = Math.floor(Date.now() / 1000);
  const expiresAt = now + 24 * 60 * 60; // 24h TTL

  await ddb.send(new PutItemCommand({
    TableName: PENDING_ACTIONS_TABLE,
    Item: marshall({
      actionId,
      toolName,
      toolArgs,
      staffId:   context.staffId,
      status:    'PENDING_APPROVAL',
      createdAt: new Date().toISOString(),
      expiresAt,
    }),
  }));

  console.log(JSON.stringify({ event: 'write_tool_intercepted', toolName, actionId }));

  return {
    status:   'PENDING_APPROVAL',
    actionId,
    message:  `Action requires HR manager approval. Reference: ${actionId}`,
  };
}

// ─── DynamoDB helpers ─────────────────────────────────────────────────────────

/** GetItem with unmarshalling — returns null on not-found or error. */
async function getItem(tableName, pk, sk) {
  try {
    const res = await ddb.send(new GetItemCommand({
      TableName: tableName,
      Key:       marshall({ PK: pk, SK: sk }),
    }));
    return res.Item ? unmarshall(res.Item) : null;
  } catch (err) {
    throw new Error(`DynamoDB GetItem ${pk}/${sk}: ${err.message}`);
  }
}

/** Query by PK (and optional SK prefix) — returns array of unmarshalled items. */
async function queryByPk(tableName, pk, skPrefix = null, limit = 50) {
  try {
    const params = {
      TableName:                 tableName,
      KeyConditionExpression:    skPrefix
        ? 'PK = :pk AND begins_with(SK, :skp)'
        : 'PK = :pk',
      ExpressionAttributeValues: marshall(
        skPrefix ? { ':pk': pk, ':skp': skPrefix } : { ':pk': pk },
      ),
      Limit: limit,
      ScanIndexForward: false, // newest first
    };
    const res = await ddb.send(new QueryCommand(params));
    return (res.Items ?? []).map(item => unmarshall(item));
  } catch (err) {
    throw new Error(`DynamoDB Query ${pk}: ${err.message}`);
  }
}

/** Query via GSI1 on the config table. */
async function queryConfigGsi(tenantId, configType) {
  try {
    const res = await ddb.send(new QueryCommand({
      TableName:                 CONFIG_TABLE,
      IndexName:                 'GSI1-active-configs',
      KeyConditionExpression:    'GSI1PK = :pk AND GSI1SK = :sk',
      ExpressionAttributeValues: marshall({
        ':pk': `TENANT#${tenantId}#ACTIVE`,
        ':sk': `CONFIG#${configType}`,
      }),
      Limit: 1,
    }));
    return res.Items?.length ? unmarshall(res.Items[0]) : null;
  } catch (err) {
    throw new Error(`DynamoDB ConfigGSI ${tenantId}/${configType}: ${err.message}`);
  }
}

// ─── Tool definitions exposed to Claude ───────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: 'get_candidate',
    description: 'Get a single candidate record (SAGA state) by candidateId.',
    input_schema: {
      type: 'object',
      properties: { candidateId: { type: 'string', description: 'Candidate ID e.g. CAND-0001' } },
      required: ['candidateId'],
    },
  },
  {
    name: 'get_pipeline_overview',
    description: 'Get an overview of all candidates in the pipeline for a given stage or all stages.',
    input_schema: {
      type: 'object',
      properties: {
        stage: { type: 'string', description: 'Optional pipeline stage filter (SCREENING, INTERVIEW, OFFER, HIRED, REJECTED)' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'get_vote_summary',
    description: 'Get all reviewer votes for a specific candidate.',
    input_schema: {
      type: 'object',
      properties: { candidateId: { type: 'string', description: 'Candidate ID' } },
      required: ['candidateId'],
    },
  },
  {
    name: 'get_sla_status',
    description: 'Get the SLA status and deadline for a specific workflow.',
    input_schema: {
      type: 'object',
      properties: { workflowId: { type: 'string', description: 'Workflow ID' } },
      required: ['workflowId'],
    },
  },
  {
    name: 'get_workflow_audit_trail',
    description: 'Get the audit event history for a specific workflow.',
    input_schema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
        limit:      { type: 'number', description: 'Max events to return (default 20)' },
      },
      required: ['workflowId'],
    },
  },
  {
    name: 'get_config',
    description: 'Get the active configuration for a given configType (e.g. SCORING_WEIGHTS, SLA_THRESHOLDS).',
    input_schema: {
      type: 'object',
      properties: {
        configType: { type: 'string', description: 'Config type e.g. SCORING_WEIGHTS' },
        tenantId:   { type: 'string', description: 'Tenant ID (default: DEFAULT)' },
      },
      required: ['configType'],
    },
  },
  {
    name: 'schedule_interview',
    description: 'Schedule an interview for a candidate. Requires HR manager approval — returns PENDING_APPROVAL.',
    input_schema: {
      type: 'object',
      properties: {
        candidateId:       { type: 'string' },
        interviewerStaffId: { type: 'string' },
        proposedDateTime:  { type: 'string', description: 'ISO 8601 datetime' },
        interviewType:     { type: 'string', description: 'TECHNICAL or PANEL' },
      },
      required: ['candidateId', 'proposedDateTime', 'interviewType'],
    },
  },
  {
    name: 'flag_sla_risk',
    description: 'Flag a workflow as at risk of SLA breach. Requires HR manager approval — returns PENDING_APPROVAL.',
    input_schema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string' },
        reason:     { type: 'string' },
      },
      required: ['workflowId', 'reason'],
    },
  },
  {
    name: 'update_config',
    description: 'Propose a config update (e.g. new scoring weights). Requires HR manager approval — returns PENDING_APPROVAL.',
    input_schema: {
      type: 'object',
      properties: {
        configType: { type: 'string' },
        newValues:  { type: 'object', description: 'Key-value pairs to update' },
        tenantId:   { type: 'string' },
      },
      required: ['configType', 'newValues'],
    },
  },
];

// ─── Tool map ─────────────────────────────────────────────────────────────────

export const TOOL_MAP = {
  get_candidate: async (args, _ctx) => {
    const item = await getItem(STATE_TABLE, `CANDIDATE#${args.candidateId}`, 'SAGA');
    if (!item) return { error: `Candidate ${args.candidateId} not found` };
    return item;
  },

  get_pipeline_overview: async (args, _ctx) => {
    // Candidates are stored with GSI1PK = 'TENANT#NALEKO' and GSI1SK = 'SAGA#...'
    const limit = args.limit ?? 50;
    const res = await ddb.send(new QueryCommand({
      TableName:                 STATE_TABLE,
      IndexName:                 'GSI1',
      KeyConditionExpression:    'GSI1PK = :pk AND begins_with(GSI1SK, :skp)',
      ExpressionAttributeValues: marshall({
        ':pk':  'TENANT#NALEKO',
        ':skp': 'SAGA#',
      }),
      Limit: limit,
    }));
    let items = (res.Items ?? []).map(item => unmarshall(item));
    // Filter by stage if requested
    if (args.stage) {
      items = items.filter(i => i.currentStage === args.stage);
    }
    // Summarise by stage
    const summary = {};
    for (const item of items) {
      const s = item.currentStage ?? 'UNKNOWN';
      summary[s] = (summary[s] ?? 0) + 1;
    }
    return { candidates: items, count: items.length, stageSummary: summary };
  },

  get_vote_summary: async (args, _ctx) => {
    const items = await queryByPk(STATE_TABLE, `VOTE#${args.candidateId}`, 'SCORE', 50);
    if (!items.length) return { candidateId: args.candidateId, votes: [], averageScore: null };
    const scores   = items.filter(i => typeof i.score === 'number').map(i => i.score);
    const avgScore = scores.length
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : null;
    return { candidateId: args.candidateId, votes: items, averageScore: avgScore };
  },

  get_sla_status: async (args, _ctx) => {
    const item = await getItem(STATE_TABLE, `WORKFLOW#${args.workflowId}`, 'STATE');
    if (!item) return { error: `Workflow ${args.workflowId} not found` };
    return {
      workflowId:  args.workflowId,
      status:      item.status ?? 'UNKNOWN',
      slaDeadline: item.slaDeadline ?? null,
      slaBreached: item.slaBreached ?? false,
      stage:       item.stage ?? null,
      updatedAt:   item.updatedAt ?? null,
    };
  },

  get_workflow_audit_trail: async (args, _ctx) => {
    const items = await queryByPk(STATE_TABLE, `AUDIT#${args.workflowId}`, null, args.limit ?? 20);
    return { workflowId: args.workflowId, events: items, count: items.length };
  },

  get_config: async (args, _ctx) => {
    const tenantId = args.tenantId ?? 'DEFAULT';
    const item = await queryConfigGsi(tenantId, args.configType);
    if (!item) return { error: `Config ${args.configType} not found for tenant ${tenantId}` };
    return item;
  },

  // HITL write tools — resolved via pendingApproval() in resolveToolCall()
  schedule_interview: async (_args, _ctx) => { /* intercepted by HITL gate */ },
  flag_sla_risk:      async (_args, _ctx) => { /* intercepted by HITL gate */ },
  update_config:      async (_args, _ctx) => { /* intercepted by HITL gate */ },
};

/**
 * Dispatch a Claude tool_use block to the appropriate DynamoDB resolver.
 *
 * @param {string} toolName
 * @param {object} args
 * @param {{ staffId: string }} context - sourced from Cognito JWT only
 * @returns {Promise<object>}
 */
export async function resolveToolCall(toolName, args, context) {
  const fn = TOOL_MAP[toolName];
  if (!fn) throw new Error(`Unknown tool: "${toolName}". Valid tools: ${Object.keys(TOOL_MAP).join(', ')}`);

  // HITL gate: intercept write tools before execution
  if (isWriteTool(toolName)) {
    return pendingApproval(toolName, args, context);
  }

  return fn(args, context);
}
