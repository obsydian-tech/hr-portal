# Naleko MCP Server

Model Context Protocol server for the Naleko HR Onboarding Portal.

Exposes **7 tools** to any MCP-compatible AI client (Claude Desktop, Cursor, Claude.ai Projects, custom agents):

| Tool | Description |
|------|-------------|
| `list_employees` | List onboarding employees with pagination |
| `get_employee` | Retrieve a single employee by UUID |
| `list_verifications` | List document verifications with status filter |
| `get_verification_summary` | Get a Bedrock-generated plain-English summary |
| `assess_employee_risk` | Run Bedrock risk classification (LOW/MEDIUM/HIGH) |
| `query_audit_log` | Query the POPIA-compliant audit log |
| `onboard_new_employee` | **Composite**: creates employee then immediately runs risk assessment |

---

## Connecting to the hosted server (Lambda Function URL)

After `terraform apply`, retrieve the URL:

```bash
terraform -chdir=infra output mcp_server_url
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "naleko": {
      "url": "https://<your-function-url>.lambda-url.af-south-1.on.aws/",
      "headers": {
        "x-api-key": "<your-naleko-agent-key>"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "naleko": {
      "url": "https://<your-function-url>.lambda-url.af-south-1.on.aws/",
      "headers": {
        "x-api-key": "<your-naleko-agent-key>"
      }
    }
  }
}
```

### Retrieve your API key

```bash
export NALEKO_AGENT_KEY=$(aws secretsmanager get-secret-value \
  --secret-id naleko/agent-api-key \
  --query SecretString \
  --output text)
```

---

## Running locally (stdio transport)

Useful for development and debugging with `@modelcontextprotocol/inspector`.

```bash
cd mcp
npm install

export NALEKO_AGENT_KEY="your-key-here"
export AGENT_API_BASE="https://api.naleko.co.za"
export REST_API_BASE="https://api.naleko.co.za"

# Run server on stdio
node server.mjs
```

### Inspect with the MCP Inspector

```bash
npx @modelcontextprotocol/inspector node mcp/server.mjs
```

Open `http://localhost:5173` in your browser — you'll see all 7 tools and can invoke them interactively.

For Claude Desktop in stdio mode, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "naleko-local": {
      "command": "node",
      "args": ["/absolute/path/to/hr-portal-naleko/mcp/server.mjs"],
      "env": {
        "NALEKO_AGENT_KEY": "your-key-here",
        "AGENT_API_BASE": "https://api.naleko.co.za",
        "REST_API_BASE": "https://api.naleko.co.za"
      }
    }
  }
}
```

---

## Architecture

```
AI Client (Claude / Cursor)
    │  HTTP+SSE (MCP protocol)
    ▼
Lambda Function URL
    │  (RESPONSE_STREAM invoke mode)
    ▼
nalekoMcpServer Lambda (mcp/lambda-handler.mjs)
    │  StreamableHTTPServerTransport
    ▼
McpServer (mcp/server.mjs)
    ├── Tools 1–6: fetch() → naleko-agent-api (/agent/v1/*)
    │                          authenticated via x-api-key header
    └── Tool 7 (composite): fetch() → standard REST API (/v1/employees)
                             then → naleko-agent-api (/agent/v1/employees/{id}/assess-risk)
```

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NALEKO_AGENT_KEY` | Yes | x-api-key for `/agent/v1/*` — read from Secrets Manager `naleko/agent-api-key` |
| `AGENT_API_BASE` | Yes | Base URL of the agent API (e.g. `https://api.naleko.co.za`) |
| `REST_API_BASE` | Yes | Base URL of the standard HR REST API (same host as agent API) |
| `NALEKO_HR_API_KEY` | No | Separate key for `/v1/*` routes. Defaults to `NALEKO_AGENT_KEY` if unset |

---

## Health check

```bash
curl https://<your-function-url>.lambda-url.af-south-1.on.aws/health
```

Expected response:
```json
{ "status": "ok", "server": "naleko-mcp", "version": "1.0.0" }
```
