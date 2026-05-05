/**
 * NH-47: Naleko MCP Server
 *
 * Exposes 7 tools to AI agents via the Model Context Protocol:
 *   6 direct wrappers of the naleko-agent-api endpoints (from api/agent-tools.json)
 *   1 composite tool (onboard_new_employee) that chains createEmployee + assessRisk
 *
 * Transport is chosen at runtime:
 *   - Lambda (HTTP+SSE): imported by lambda-handler.mjs (StreamableHTTPServerTransport)
 *   - Local stdio:       run `node mcp/server.mjs` directly (StdioServerTransport)
 *
 * Required env vars:
 *   NALEKO_AGENT_KEY   — x-api-key for /agent/v1/* routes
 *   AGENT_API_BASE     — e.g. https://api.naleko.co.za (no trailing slash)
 *   REST_API_BASE      — e.g. https://api.naleko.co.za (no trailing slash, same host for now)
 *   NALEKO_HR_API_KEY  — API key for the standard /v1/* HR routes (used by composite tool)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const AGENT_BASE = (process.env.AGENT_API_BASE ?? 'https://api.naleko.co.za').replace(/\/$/, '');
const REST_BASE  = (process.env.REST_API_BASE  ?? 'https://api.naleko.co.za').replace(/\/$/, '');
const AGENT_KEY  = process.env.NALEKO_AGENT_KEY  ?? '';
const HR_KEY     = process.env.NALEKO_HR_API_KEY ?? AGENT_KEY; // fallback to agent key in dev

// ─── Shared fetch helpers ──────────────────────────────────────────────────

async function agentGet(path) {
  const res = await fetch(`${AGENT_BASE}/agent/v1${path}`, {
    headers: { 'x-api-key': AGENT_KEY },
  });
  if (!res.ok) throw new Error(`Agent API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function agentPost(path, body = {}) {
  const res = await fetch(`${AGENT_BASE}/agent/v1${path}`, {
    method: 'POST',
    headers: {
      'x-api-key': AGENT_KEY,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Agent API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function restPost(path, body = {}) {
  const res = await fetch(`${REST_BASE}/v1${path}`, {
    method: 'POST',
    headers: {
      'x-api-key': HR_KEY,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`REST API ${res.status}: ${await res.text()}`);
  return res.json();
}

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// ─── MCP Server ───────────────────────────────────────────────────────────

export const server = new McpServer({
  name: 'naleko-hr-portal',
  version: '1.0.0',
});

// ── Tool 1: list_employees ────────────────────────────────────────────────
server.tool(
  'list_employees',
  'List onboarding employees with optional pagination. Returns employee_id, email, first_name, last_name, department, stage, and risk_band for each record.',
  {
    limit:  z.number().int().min(1).max(100).default(20).describe('Max results (default 20)'),
    cursor: z.string().optional().describe('Pagination cursor from previous response'),
  },
  async ({ limit, cursor }) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (cursor) qs.set('cursor', cursor);
    return ok(await agentGet(`/employees?${qs}`));
  },
);

// ── Tool 2: get_employee ─────────────────────────────────────────────────
server.tool(
  'get_employee',
  'Retrieve a single employee record by UUID. Returns profile fields and current risk_band.',
  {
    id: z.string().uuid().describe('employee_id (UUID)'),
  },
  async ({ id }) => ok(await agentGet(`/employees/${id}`)),
);

// ── Tool 3: list_verifications ───────────────────────────────────────────
server.tool(
  'list_verifications',
  'List document verification records. Optionally filter by status (PENDING, PASSED, FAILED, MANUAL_REVIEW).',
  {
    status: z.enum(['PENDING', 'PASSED', 'FAILED', 'MANUAL_REVIEW']).optional().describe('Filter by verification status'),
    limit:  z.number().int().min(1).max(100).default(20).describe('Max results (default 20)'),
  },
  async ({ status, limit }) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (status) qs.set('status', status);
    return ok(await agentGet(`/verifications?${qs}`));
  },
);

// ── Tool 4: get_verification_summary ────────────────────────────────────
server.tool(
  'get_verification_summary',
  'Get a Bedrock-generated plain-English summary of a document verification. Useful for human-readable status reports.',
  {
    id: z.string().uuid().describe('verification_id (UUID)'),
  },
  async ({ id }) => ok(await agentGet(`/verifications/${id}/summary`)),
);

// ── Tool 5: assess_employee_risk ─────────────────────────────────────────
server.tool(
  'assess_employee_risk',
  'Run Bedrock risk classification on an employee\'s document verifications. Returns risk_band (LOW | MEDIUM | HIGH) and a plain-English reason.',
  {
    id: z.string().uuid().describe('employee_id (UUID)'),
  },
  async ({ id }) => ok(await agentPost(`/employees/${id}/assess-risk`)),
);

// ── Tool 6: query_audit_log ──────────────────────────────────────────────
server.tool(
  'query_audit_log',
  'Query the immutable POPIA-compliant audit log. Filter by employeeId and/or ISO 8601 date range. Returns events with actor (AGENT|HUMAN) tagging.',
  {
    employeeId: z.string().uuid().optional().describe('Filter to a specific employee'),
    startDate:  z.string().optional().describe('ISO 8601 lower bound (e.g. 2026-01-01T00:00:00Z)'),
    endDate:    z.string().optional().describe('ISO 8601 upper bound (e.g. 2026-12-31T23:59:59Z)'),
    limit:      z.number().int().min(1).max(200).default(50).describe('Max results (default 50)'),
  },
  async ({ employeeId, startDate, endDate, limit }) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (employeeId) qs.set('employeeId', employeeId);
    if (startDate)  qs.set('startDate', startDate);
    if (endDate)    qs.set('endDate', endDate);
    return ok(await agentGet(`/audit-log?${qs}`));
  },
);

// ── Tool 7: onboard_new_employee (composite) ──────────────────────────────
server.tool(
  'onboard_new_employee',
  'Composite tool: creates a new employee via the HR REST API, then immediately runs Bedrock risk classification. Returns {employee, riskAssessment}. Use this single tool to fully onboard and assess a new hire in one step.',
  {
    email:       z.string().email().describe('Work email address of the new employee'),
    firstName:   z.string().describe('First name'),
    lastName:    z.string().describe('Last name'),
    department:  z.string().describe('Department name'),
    role:        z.string().describe('Job title / role'),
    phoneNumber: z.string().optional().describe('Mobile number (optional, for WhatsApp onboarding)'),
  },
  async ({ email, firstName, lastName, department, role, phoneNumber }) => {
    // Step 1 — create the employee via the standard HR REST API
    const employee = await restPost('/employees', {
      email, firstName, lastName, department, role,
      ...(phoneNumber ? { phoneNumber } : {}),
    });

    // Step 2 — immediately assess risk via the agent API
    let riskAssessment = null;
    try {
      riskAssessment = await agentPost(`/employees/${employee.employee_id}/assess-risk`);
    } catch (err) {
      // Risk assessment is non-fatal — employee was created successfully
      riskAssessment = { error: err.message, note: 'Employee created but risk assessment failed' };
    }

    return ok({ employee, riskAssessment });
  },
);

// ─── stdio transport (local dev / Claude Desktop) ────────────────────────────
// Only runs when this file is the entry point (not when imported by lambda-handler.mjs)
if (import.meta.url === `file://${process.argv[1]}`) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Naleko MCP server running on stdio\n');
}
