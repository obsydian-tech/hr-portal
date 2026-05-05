/**
 * NH-47: Lambda handler for the Naleko MCP Server (stateless JSON-RPC)
 *
 * Why stateless?
 *   StreamableHTTPServerTransport stores sessions in-memory. Lambda concurrent
 *   execution environments don't share memory, so `initialize` can hit instance A
 *   while `tools/list` hits instance B → "Server not initialized" error.
 *
 *   Solution: handle each JSON-RPC method independently without any session state.
 *   This works for all standard MCP tool calls (init, list, call, ping).
 *
 * Response format: text/event-stream (SSE) — expected by MCP Inspector + Claude Desktop.
 *
 * Environment variables (set in infra/lambdas.tf):
 *   NALEKO_AGENT_KEY   — resolved from Secrets Manager at deploy time
 *   AGENT_API_BASE     — e.g. https://api.naleko.co.za
 *   REST_API_BASE      — e.g. https://api.naleko.co.za
 *   NALEKO_HR_API_KEY  — if separate from agent key; defaults to NALEKO_AGENT_KEY
 */

import { server } from './server.mjs';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Stable session ID for this Lambda execution environment (reused on warm invocations).
const SESSION_ID = crypto.randomUUID();

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

function rpcOk(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcErr(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ─── MCP method dispatcher ────────────────────────────────────────────────────

async function dispatch(msg) {
  const { method, params, id } = msg;

  switch (method) {
    case 'initialize':
      return rpcOk(id, {
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'naleko-hr-portal', version: '1.0.0' },
      });

    case 'notifications/initialized':
      return null; // notification — no response body

    case 'ping':
      return rpcOk(id, {});

    case 'tools/list': {
      const tools = Object.entries(server._registeredTools ?? {})
        .filter(([, t]) => t.enabled !== false)
        .map(([name, t]) => ({
          name,
          description: t.description ?? '',
          inputSchema: zodToJsonSchema(t.inputSchema, { strictUnions: true }),
        }));
      return rpcOk(id, { tools });
    }

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};
      const tool = server._registeredTools?.[toolName];

      if (!tool) {
        return rpcErr(id, -32602, `Unknown tool: ${toolName}`);
      }

      try {
        const result = await tool.handler(toolArgs, {
          signal: AbortSignal.timeout(25_000),
          sendNotification: async () => {},
          sendRequest: async () => ({}),
          authInfo: undefined,
        });
        return rpcOk(id, result);
      } catch (err) {
        console.error(`Tool "${toolName}" error:`, err);
        return rpcOk(id, {
          content: [{ type: 'text', text: `Tool error: ${err.message}` }],
          isError: true,
        });
      }
    }

    default:
      return rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

// ─── SSE writer ───────────────────────────────────────────────────────────────

function writeSse(stream, data) {
  stream.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
}

// ─── Lambda handler ───────────────────────────────────────────────────────────

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'GET';
  const path   = event.requestContext?.http?.path   ?? event.path ?? '/';

  // ── /health ──────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/health') {
    const out = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    out.write(JSON.stringify({ status: 'ok', server: 'naleko-mcp', version: '1.0.0' }));
    out.end();
    return;
  }

  // ── Only POST is valid for MCP protocol ──────────────────────────────────
  if (method !== 'POST') {
    const out = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    out.write(JSON.stringify({ error: 'Method Not Allowed' }));
    out.end();
    return;
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  const bodyStr = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');

  let msg;
  try {
    msg = JSON.parse(bodyStr);
  } catch {
    const out = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 400,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
    writeSse(out, rpcErr(null, -32700, 'Parse error'));
    out.end();
    return;
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────
  let response;
  try {
    response = await dispatch(msg);
  } catch (err) {
    console.error('Dispatch error:', err);
    response = rpcErr(msg?.id ?? null, -32603, `Internal error: ${err.message}`);
  }

  // ── Notifications (no response body) ─────────────────────────────────────
  if (response === null) {
    const out = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 202,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
    out.end();
    return;
  }

  // ── Normal response as SSE ────────────────────────────────────────────────
  const out = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'mcp-session-id': SESSION_ID,
    },
  });
  writeSse(out, response);
  out.end();
});
