/**
 * NH-47: Lambda handler for the Naleko MCP Server (HTTP+SSE transport)
 *
 * AWS Lambda Function URL (RESPONSE_STREAM invoke mode) is the recommended
 * transport for a remotely-accessible MCP server. The MCP SDK's
 * StreamableHTTPServerTransport handles the SSE session lifecycle.
 *
 * Environment variables (set in infra/lambdas.tf):
 *   NALEKO_AGENT_KEY   — resolved from Secrets Manager at deploy time
 *   AGENT_API_BASE     — e.g. https://api.naleko.co.za
 *   REST_API_BASE      — e.g. https://api.naleko.co.za
 *   NALEKO_HR_API_KEY  — if separate from agent key; defaults to NALEKO_AGENT_KEY
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { server } from './server.mjs';

// Keep transport alive across warm invocations (Lambda execution context reuse)
let transport;

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  // MCP requires HTTP+SSE — reject non-MCP requests early
  const method  = event.requestContext?.http?.method ?? event.httpMethod ?? 'GET';
  const path    = event.requestContext?.http?.path   ?? event.path ?? '/';

  if (method === 'GET' && path === '/health') {
    const meta = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    meta.write(JSON.stringify({ status: 'ok', server: 'naleko-mcp', version: '1.0.0' }));
    meta.end();
    return;
  }

  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    await server.connect(transport);
  }

  // Decode body — Lambda Function URL delivers it as base64 when binary
  const bodyStr = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');

  const headers = {};
  for (const [k, v] of Object.entries(event.headers ?? {})) {
    headers[k.toLowerCase()] = v;
  }

  await transport.handleRequest(
    { method, headers, body: bodyStr },
    responseStream,
  );
});
