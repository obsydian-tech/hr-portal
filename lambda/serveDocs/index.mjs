/**
 * NH-13: serveDocs Lambda
 *
 * Routes:
 *   GET /docs        → Swagger UI HTML (loads spec from /openapi.yaml)
 *   GET /openapi.yaml → raw OpenAPI 3.0 YAML spec
 *
 * Both routes are unauthenticated (no JWT required).
 *
 * The spec file (spec.yaml) is bundled alongside this Lambda.
 * CI/CD build step: cp api/openapi.yaml lambda/serveDocs/spec.yaml
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Bundled spec — copied from api/openapi.yaml at build time
let specYaml;
try {
  specYaml = readFileSync(join(__dirname, 'spec.yaml'), 'utf8');
} catch {
  specYaml = '# spec.yaml not bundled — run: cp api/openapi.yaml lambda/serveDocs/spec.yaml\n';
}

const SWAGGER_HTML = (specUrl) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Naleko HR Portal API</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📋</text></svg>" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; }
    .topbar { display: none; }
    .swagger-ui .info .title { color: #1a5276; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '${specUrl}',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset
      ],
      layout: 'BaseLayout',
      tryItOutEnabled: true,
      // Strip Authorization header before S3 presigned PUT requests
      requestInterceptor: (req) => {
        if (req.url.includes('s3.amazonaws.com') || req.url.includes('s3.af-south-1.amazonaws.com')) {
          delete req.headers['Authorization'];
        }
        return req;
      }
    });
  </script>
</body>
</html>`;

export const handler = async (event) => {
  const path = event.requestContext?.http?.path ?? event.path ?? '/docs';
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  // Handle preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // Serve raw OpenAPI YAML
  if (path === '/openapi.yaml') {
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/yaml; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
      body: specYaml,
    };
  }

  // Serve Swagger UI HTML — spec URL points to /openapi.yaml on same API
  const apiEndpoint = process.env.API_ENDPOINT ?? '';
  const specUrl = `${apiEndpoint}/openapi.yaml`;

  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
    body: SWAGGER_HTML(specUrl),
  };
};
