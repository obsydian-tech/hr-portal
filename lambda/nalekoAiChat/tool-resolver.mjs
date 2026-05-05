/**
 * NH-53: tool-resolver.mjs
 *
 * Maps Claude tool_use responses to Agent API HTTP calls.
 * Staff-ID scoping (NH-53): every call that filters by HR clerk includes
 * `created_by` sourced ONLY from the Cognito JWT — never from Claude's output.
 *
 * HITL gate: onboard_new_employee returns a draft payload and NEVER calls the
 * agent API directly — the HR clerk must confirm via the frontend (NH-58).
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'af-south-1' });
const AGENT_API_BASE = process.env.AGENT_API_BASE_URL ?? 'https://fou21cj8tj.execute-api.af-south-1.amazonaws.com';
const SECRET_NAME    = process.env.AGENT_API_KEY_SECRET_NAME ?? 'naleko/agent/api-key';

// Module-level cache — survives warm Lambda invocations
let _cachedApiKey = null;

/**
 * Fetch the agent API key from Secrets Manager (cached per warm container).
 * @returns {Promise<string>}
 */
async function getApiKey() {
  if (_cachedApiKey) return _cachedApiKey;
  const result = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
  _cachedApiKey = result.SecretString;
  return _cachedApiKey;
}

/**
 * Make an authenticated GET request to the Agent API.
 * @param {string} path
 * @returns {Promise<object>}
 */
export async function agentGet(path) {
  const apiKey = await getApiKey();
  const url    = `${AGENT_API_BASE}${path}`;
  const res    = await fetch(url, {
    method:  'GET',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Agent API GET ${path} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Make an authenticated POST request to the Agent API.
 * @param {string} path
 * @param {object} body
 * @returns {Promise<object>}
 */
export async function agentPost(path, body) {
  const apiKey = await getApiKey();
  const url    = `${AGENT_API_BASE}${path}`;
  const res    = await fetch(url, {
    method:  'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Agent API POST ${path} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Tool definitions exposed to Claude (used to build the `tools` array in NH-54).
 * Listed here so tool-resolver is the single source of truth.
 */
export const TOOL_DEFINITIONS = [
  {
    name: 'list_employees',
    description: 'List employees created by this HR clerk. Supports optional limit.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max results (default 20)' } },
    },
  },
  {
    name: 'get_employee',
    description: 'Get a single employee record by ID.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Employee ID e.g. EMP-0000012' } },
      required: ['id'],
    },
  },
  {
    name: 'assess_employee_risk',
    description: 'Run Bedrock risk classification for an employee.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Employee ID' } },
      required: ['id'],
    },
  },
  {
    name: 'list_verifications',
    description: 'List document verifications, optionally filtered by status.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['PENDING', 'VERIFIED', 'FAILED'] },
        limit:  { type: 'number' },
      },
    },
  },
  {
    name: 'get_verification_summary',
    description: 'Get a plain-English Bedrock summary for a single verification.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Verification ID' } },
      required: ['id'],
    },
  },
  {
    name: 'query_audit_log',
    description: 'Query the audit log for an employee.',
    input_schema: {
      type: 'object',
      properties: { employeeId: { type: 'string' } },
      required: ['employeeId'],
    },
  },
  {
    name: 'get_high_risk_report',
    description: 'Returns ALL employees grouped by risk band (HIGH/MEDIUM/LOW/NO_DATA). Use this instead of calling assess_employee_risk per employee — avoids N+1 Bedrock calls for Template 1.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'onboard_new_employee',
    description: 'Draft a new employee record for HR clerk review. DOES NOT submit — returns draft for human confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        firstName:   { type: 'string' },
        lastName:    { type: 'string' },
        email:       { type: 'string' },
        department:  { type: 'string' },
        role:        { type: 'string' },
        phoneNumber: { type: 'string' },
      },
      required: ['firstName', 'lastName', 'email', 'department', 'role'],
    },
  },
];

/**
 * Build the URL-safe query string from a plain object (omits undefined/null).
 * @param {Record<string, string|number|undefined>} params
 * @returns {string}  e.g. "?limit=20&created_by=AS00004"
 */
function qs(params) {
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}

/**
 * TOOL_MAP — maps tool names to resolver functions.
 * Each function receives (args, context) where context.staffId is the
 * Cognito JWT `custom:staff_id` claim (sourced in index.mjs, NH-53).
 *
 * Rule: context.staffId is ONLY sourced from the JWT — never from Claude.
 */
export const TOOL_MAP = {
  /**
   * NH-53: always scopes to created_by={staffId} so the clerk only sees their own employees.
   */
  list_employees: (args, context) =>
    agentGet(`/employees${qs({ limit: args.limit ?? 20, created_by: context.staffId })}`),

  get_employee: (args, _context) =>
    agentGet(`/employees/${encodeURIComponent(args.id)}`),

  assess_employee_risk: (args, _context) =>
    agentPost(`/employees/${encodeURIComponent(args.id)}/assess-risk`, {}),

  list_verifications: (args, _context) =>
    agentGet(`/verifications${qs({ status: args.status, limit: args.limit })}`),

  get_verification_summary: (args, _context) =>
    agentGet(`/verifications/${encodeURIComponent(args.id)}/summary`),

  /**
   * NH-53: always appends staffId so the audit log query is clerk-scoped.
   */
  query_audit_log: (args, context) =>
    agentGet(`/audit-log${qs({ employeeId: args.employeeId, staffId: context.staffId })}`),

  /**
   * NH-55: single call returns all employees grouped by risk band.
   * Prevents N+1 Bedrock calls for Template 1 ("show me HIGH risk employees").
   */
  get_high_risk_report: (_args, _context) =>
    agentGet('/agent/v1/employees/risk-report'),

  /**
   * HITL gate (NH-53 / NH-58): NEVER calls agentPost.
   * Returns { hitl: true, draft: { ... } } — frontend must confirm before submission.
   */
  // NH-58: draft keys mapped to snake_case to match createEmployee Lambda expectations.
  // confirmEndpoint targets the employees API (Cognito JWT, not agent x-api-key).
  onboard_new_employee: (args, _context) => ({
    hitl:    true,
    draft:   {
      first_name:  args.firstName,
      last_name:   args.lastName,
      email:       args.email,
      department:  args.department,
      job_title:   args.role ?? '',
      phone:       args.phoneNumber ?? '',
    },
    message: 'Please review the employee details above and confirm to proceed with onboarding.',
  }),
};

/**
 * Dispatch a Claude tool_use block to the appropriate agent API call.
 *
 * @param {string} toolName   - The tool name Claude selected.
 * @param {object} args       - The input arguments Claude provided.
 * @param {{ staffId: string }} context - Caller context sourced from the Cognito JWT.
 * @returns {Promise<object>}
 * @throws {Error}  If toolName is not in TOOL_MAP.
 */
export async function resolveToolCall(toolName, args, context) {
  const fn = TOOL_MAP[toolName];
  if (!fn) throw new Error(`Unknown tool: "${toolName}". Valid tools: ${Object.keys(TOOL_MAP).join(', ')}`);
  return fn(args, context);
}
