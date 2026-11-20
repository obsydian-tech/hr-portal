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
 * ONB-22: every call must carry the agent key in x-api-key, and the handler checks it before anything else. The key is
 * read from its secret (naleko/agent/api-key), never from a setting: the current and the pending versions are accepted,
 * a key that is neither is refused with 401 after one fresh read, so a rotation works at once and the old key stops
 * working. The tools call the agent API with the secret's current key. Nothing here logs a key.
 *
 * Environment variables (set in infra/lambdas.tf):
 *   AGENT_API_BASE              — e.g. https://api.naleko.co.za
 *   AGENT_API_KEY_SECRET_NAME   — the secret's name (naleko/agent/api-key)
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { server, setKeyProvider } from './server.mjs';
import { zodToJsonSchema } from 'zod-to-json-schema';

const sm = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'af-south-1' });
const SECRET_NAME = process.env.AGENT_API_KEY_SECRET_NAME ?? 'naleko/agent/api-key';

let keys = null; // { current, pending } as last read
let readAt = 0;
const KEY_CACHE_MS = 4 * 60_000; // decision 10: a key read is used for 4 minutes at most
const fresh = async () => (keys && Date.now() - readAt < KEY_CACHE_MS ? keys : readKeys());
async function readKeys() {
  const one = async (stage) => {
    try {
      return (await sm.send(new GetSecretValueCommand({ SecretId: SECRET_NAME, VersionStage: stage }))).SecretString || null;
    } catch (err) {
      if (err?.name === 'ResourceNotFoundException') return null; // no such version right now
      throw err;
    }
  };
  keys = { current: await one('AWSCURRENT'), pending: await one('AWSPENDING') };
  readAt = Date.now();
  return keys;
}

setKeyProvider(async () => (await fresh()).current ?? '');

const same = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
const accepts = (k, presented) => [k?.current, k?.pending].some((v) => v && same(v, presented));

/** True when the caller presented the current or pending key. A refusal reads the secret again before it stands. */
async function authorised(presented) {
  if (typeof presented !== 'string' || presented === '') return false;
  if (accepts(await fresh(), presented)) return true;
  return accepts(await readKeys(), presented);
}

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
        console.error(JSON.stringify({ event: 'tool_error', tool: toolName, errorName: err?.name ?? 'Error' }));
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
    out.write(JSON.stringify({ status: 'ok' }));
    out.end();
    return;
  }

  // ── The key, before anything else ────────────────────────────────────────
  const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  let allowed = false;
  try {
    allowed = await authorised(headers['x-api-key']);
  } catch (err) {
    console.error(JSON.stringify({ event: 'key_read_failed', errorName: err?.name ?? 'Error' }));
  }
  if (!allowed) {
    const out = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    out.write(JSON.stringify({ error: 'Unauthorized' }));
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
