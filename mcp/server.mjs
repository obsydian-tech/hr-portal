/**
 * NH-47 / ONB-22: Naleko MCP Server
 *
 * Exposes 8 tools to AI agents via the Model Context Protocol. Every tool is a wrapper of one naleko-agent-api route
 * (api/agent-tools.json is the list). The agent reads, checks and proposes; it never decides: the only write is
 * propose_accept_document, which makes a proposal that a signed-in HR person answers on the screen.
 *
 * Transport is chosen at runtime:
 *   - Lambda (HTTP+SSE): imported by lambda-handler.mjs (StreamableHTTPServerTransport)
 *   - Local stdio:       run `node mcp/server.mjs` directly (StdioServerTransport)
 *
 * Settings:
 *   AGENT_API_BASE     - e.g. https://api.naleko.co.za (no trailing slash)
 *   NALEKO_AGENT_KEY   - local stdio only: the key to send. The Lambda reads the key from its secret on every cold start
 *                        and again after a refusal; nothing holds it in a setting.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const AGENT_BASE = (process.env.AGENT_API_BASE ?? 'https://api.naleko.co.za').replace(/\/$/, '');

// The key the agent API is called with. The Lambda handler sets a provider that answers the secret's current key.
let keyProvider = async () => process.env.NALEKO_AGENT_KEY ?? '';
export function setKeyProvider(fn) { keyProvider = fn; }

// ─── Shared fetch helpers ──────────────────────────────────────────────────

async function agentGet(path) {
  const res = await fetch(`${AGENT_BASE}/agent/v1${path}`, {
    headers: { 'x-api-key': await keyProvider() },
  });
  if (!res.ok) throw new Error(`Agent API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function agentPost(path, body = {}) {
  const res = await fetch(`${AGENT_BASE}/agent/v1${path}`, {
    method: 'POST',
    headers: {
      'x-api-key': await keyProvider(),
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Agent API ${res.status}: ${await res.text()}`);
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
  'Retrieve a single employee record by UUID. Returns profile fields, the onboarding step (Invited, Documents, In review or Verified) and the current risk_band.',
  {
    id: z.string().uuid().describe('employee_id (UUID)'),
  },
  async ({ id }) => ok(await agentGet(`/employees/${id}`)),
);

// ── Tool 3: list_verifications ───────────────────────────────────────────
server.tool(
  'list_verifications',
  'List document verification records. With waiting=true: the documents still waiting for HR to decide, each with its check (Reading, Matches, Needs a look, Doesn\'t match). Optionally filter by status (PENDING, PROCESSING, PASSED, FAILED, MANUAL_REVIEW).',
  {
    status:  z.enum(['PENDING', 'PROCESSING', 'PASSED', 'FAILED', 'MANUAL_REVIEW']).optional().describe('Filter by verification status'),
    waiting: z.boolean().optional().describe('Only the documents waiting for HR to decide'),
    limit:   z.number().int().min(1).max(100).default(20).describe('Max results (default 20)'),
  },
  async ({ status, waiting, limit }) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (status) qs.set('status', status);
    if (waiting) qs.set('waiting', 'true');
    return ok(await agentGet(`/verifications?${qs}`));
  },
);

// ── Tool 4: get_verification_summary ────────────────────────────────────
server.tool(
  'get_verification_summary',
  'Get a plain-English summary of a document verification. Useful for human-readable status reports.',
  {
    id: z.string().uuid().describe('verification_id (UUID)'),
  },
  async ({ id }) => ok(await agentGet(`/verifications/${id}/summary`)),
);

// ── Tool 5: assess_employee_risk ─────────────────────────────────────────
server.tool(
  'assess_employee_risk',
  'Run the risk check on an employee\'s document verifications. Returns risk_band (LOW | MEDIUM | HIGH) and a plain-English reason.',
  {
    id: z.string().uuid().describe('employee_id (UUID)'),
  },
  async ({ id }) => ok(await agentPost(`/employees/${id}/assess-risk`)),
);

// ── Tool 6: query_audit_log ──────────────────────────────────────────────
server.tool(
  'query_audit_log',
  'Query the audit log. Filter by employeeId and/or ISO 8601 date range. Returns events with their type and who did it (AGENT|HUMAN).',
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

// ── Tool 7: propose_accept_document ──────────────────────────────────────
server.tool(
  'propose_accept_document',
  'Propose Accept document for one document that is waiting for HR and whose check is Matches. Only proposes. A person decides.',
  {
    document_id: z.string().min(1).max(200).describe('document_id of the waiting document'),
  },
  async ({ document_id }) => ok(await agentPost('/proposals', { type: 'ACCEPT_DOCUMENT', document_id })),
);

// ── Tool 8: get_proposal_status ──────────────────────────────────────────
server.tool(
  'get_proposal_status',
  'Read where one proposal this agent made stands: waiting for HR, approved (and whether it ran), or declined.',
  {
    action_id: z.string().min(1).max(200).describe('action_id the proposal answered with'),
  },
  async ({ action_id }) => ok(await agentGet(`/actions/${encodeURIComponent(action_id)}`)),
);

// ─── stdio transport (local dev / Claude Desktop) ────────────────────────────
// Only runs when this file is the entry point (not when imported by lambda-handler.mjs)
if (import.meta.url === `file://${process.argv[1]}`) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Naleko MCP server running on stdio\n');
}
