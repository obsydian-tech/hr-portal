/**
 * NH-45: serveAgentManifest
 *
 * Serves GET /agent/agent-tools.json — the OpenAI-compatible tooling manifest
 * for the naleko-agent-api.
 *
 * The manifest JSON is bundled alongside this Lambda (copied from
 * api/agent-tools.json at deploy time). Serving from Lambda rather than a
 * raw S3 URL avoids CORS configuration and keeps auth consistent with the
 * rest of the agent namespace.
 *
 * This endpoint is intentionally unauthenticated so agents can discover
 * available tools before acquiring an API key.
 *
 * Build step (CI/CD):
 *   cp api/agent-tools.json lambda/serveAgentManifest/tools.json
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Logger } from '@aws-lambda-powertools/logger';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = new Logger({ serviceName: 'serveAgentManifest' });

// Bundled at deploy time — fallback message if file is missing
let toolsJson;
try {
  toolsJson = readFileSync(join(__dirname, 'tools.json'), 'utf8');
  // Validate it parses; throw explicitly so the catch path triggers
  JSON.parse(toolsJson);
} catch (err) {
  logger.warn('tools.json not bundled — returning placeholder', { error: err.message });
  toolsJson = JSON.stringify({
    schema_version: '1.0',
    error: 'tools.json not bundled — run: cp api/agent-tools.json lambda/serveAgentManifest/tools.json',
  });
}

export const handler = async (event) => {
  logger.info('serveAgentManifest invoked', {
    method: event.requestContext?.http?.method,
    path: event.requestContext?.http?.path,
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      // Cache for 5 minutes — the manifest changes infrequently
      'Cache-Control': 'public, max-age=300',
    },
    body: toolsJson,
  };
};
