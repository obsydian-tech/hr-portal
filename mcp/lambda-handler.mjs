/**
 * NH-47: Lambda handler for the Naleko MCP Server (HTTP+SSE transport)
 *
 * Uses an in-process Node.js HTTP server so that StreamableHTTPServerTransport
 * receives real IncomingMessage / ServerResponse objects (it uses @hono/node-server
 * internally which requires res.writeHead — Lambda responseStream does not have it).
 *
 * Architecture:
 *   Lambda invocation → forward event as real HTTP request to 127.0.0.1:PORT
 *   → in-process http.Server → StreamableHTTPServerTransport.handleRequest
 *   → MCP SDK (Hono node adapter) → real ServerResponse
 *   → pipe response back out through Lambda responseStream
 *
 * Environment variables (set in infra/lambdas.tf):
 *   NALEKO_AGENT_KEY   — resolved from Secrets Manager at deploy time
 *   AGENT_API_BASE     — e.g. https://api.naleko.co.za
 *   REST_API_BASE      — e.g. https://api.naleko.co.za
 *   NALEKO_HR_API_KEY  — if separate from agent key; defaults to NALEKO_AGENT_KEY
 */

import { createServer, request as httpRequest } from 'http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { server } from './server.mjs';

// Kept alive across warm Lambda invocations
let internalHttpServer = null;

async function getInternalServer() {
  if (internalHttpServer) return internalHttpServer;

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  await server.connect(transport);

  internalHttpServer = createServer(async (req, res) => {
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error('MCP transport error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: String(err.message) }));
    }
  });

  await new Promise((resolve, reject) => {
    internalHttpServer.listen(0, '127.0.0.1', (err) => {
      if (err) reject(err); else resolve();
    });
  });

  console.log('Internal HTTP server listening on port', internalHttpServer.address().port);
  return internalHttpServer;
}

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'GET';
  const path   = event.requestContext?.http?.path   ?? event.path ?? '/';

  // Fast-path health check — no MCP machinery needed
  if (method === 'GET' && path === '/health') {
    const out = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    out.write(JSON.stringify({ status: 'ok', server: 'naleko-mcp', version: '1.0.0' }));
    out.end();
    return;
  }

  const srv  = await getInternalServer();
  const port = srv.address().port;

  // Decode body
  const body = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64')
    : Buffer.from(event.body ?? '', 'utf8');

  // Normalise headers — Lambda gives them lowercased already, but be safe
  const reqHeaders = {};
  for (const [k, v] of Object.entries(event.headers ?? {})) {
    reqHeaders[k.toLowerCase()] = v;
  }
  reqHeaders['content-length'] = String(body.length);

  const qs = event.rawQueryString ? '?' + event.rawQueryString : '';

  // Forward as a real HTTP request to the in-process server
  const incomingRes = await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: path + qs,
        method,
        headers: reqHeaders,
      },
      resolve,
    );
    req.on('error', reject);
    if (body.length > 0) req.write(body);
    req.end();
  });

  // Stream response back through Lambda responseStream
  const out = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: incomingRes.statusCode ?? 200,
    headers: incomingRes.headers,
  });

  await new Promise((resolve, reject) => {
    incomingRes.on('error', reject);
    incomingRes.on('data', (chunk) => out.write(chunk));
    incomingRes.on('end', () => { out.end(); resolve(); });
  });
});
