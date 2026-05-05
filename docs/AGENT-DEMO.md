# Naleko HR Portal — Agent API Live Demo

This document provides four copy-pasteable `curl` commands that demonstrate the full AI agent loop:
**discover → list → summarise → assess risk → audit trail**.

All commands target the live `api.naleko.co.za` environment and require an API key.

---

## Prerequisites

Retrieve the agent API key from AWS Secrets Manager and set environment variables:

```bash
export NALEKO_AGENT_KEY=$(aws secretsmanager get-secret-value \
  --secret-id naleko/agent-api-key \
  --query SecretString \
  --output text)

export API_BASE=https://api.naleko.co.za
```

> **No AWS credentials?** Ask the Naleko platform team for a temporary read-only key.

---

## Command 1 — Discover available tools

Fetch the OpenAI-compatible tooling manifest. No API key required — this endpoint is public.

```bash
curl -s "$API_BASE/agent/agent-tools.json" | jq '{schema_version, tools: [.tools[].name]}'
```

Expected output:

```json
{
  "schema_version": "1.0",
  "tools": [
    "list_employees",
    "get_employee",
    "list_verifications",
    "get_verification_summary",
    "assess_employee_risk",
    "query_audit_log"
  ]
}
```

---

## Command 2 — List employees

Retrieve the first 5 onboarding employees with their current risk band.

```bash
curl -s \
  -H "x-api-key: $NALEKO_AGENT_KEY" \
  "$API_BASE/agent/v1/employees?limit=5" \
  | jq '.employees[] | {id, fullName, riskBand}'
```

Expected output:

```json
{ "id": "emp-uuid-001", "fullName": "Thabo Nkosi",   "riskBand": "LOW"    }
{ "id": "emp-uuid-002", "fullName": "Priya Reddy",   "riskBand": "MEDIUM" }
{ "id": "emp-uuid-003", "fullName": "Zanele Mokoena","riskBand": "LOW"    }
```

---

## Command 3 — Get AI verification summary

Get a plain-English Bedrock-generated summary of a document verification.

```bash
VERIFICATION_ID="ver-uuid-001"

curl -s \
  -H "x-api-key: $NALEKO_AGENT_KEY" \
  "$API_BASE/agent/v1/verifications/$VERIFICATION_ID/summary" \
  | jq '{summary, generatedAt}'
```

Expected output:

```json
{
  "summary": "The employee submitted a South African green barcoded ID document. OCR extracted name and ID number with 94% confidence. Verification status is APPROVED with no anomalies detected.",
  "generatedAt": "2026-05-01T08:30:00.000Z"
}
```

---

## Command 4 — Assess onboarding risk

Trigger Bedrock risk classification for an employee and retrieve their risk band and reason.
The `Idempotency-Key` header prevents duplicate assessments if the command is retried.

```bash
EMPLOYEE_ID="emp-uuid-001"

curl -s -X POST \
  -H "x-api-key: $NALEKO_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  "$API_BASE/agent/v1/employees/$EMPLOYEE_ID/assess-risk" \
  | jq '{riskBand, reason}'
```

Expected output:

```json
{
  "riskBand": "LOW",
  "reason": "All documents verified with high OCR confidence and no failed checks."
}
```

---

## Command 5 — Verify audit trail

Confirm that all agent actions were logged with `actor: AGENT` in the POPIA-compliant audit log.

```bash
curl -s \
  -H "x-api-key: $NALEKO_AGENT_KEY" \
  "$API_BASE/agent/v1/audit-log?employeeId=$EMPLOYEE_ID" \
  | jq '.events[] | select(.actor == "AGENT") | {timestamp, detailType, actor}'
```

Expected output:

```json
{
  "timestamp": "2026-05-01T08:31:05.123Z",
  "detailType": "employee.risk.assessed",
  "actor": "AGENT"
}
```

---

## Full agent loop — one-liner script

The commands above can be chained into a single script for demo purposes:

```bash
#!/usr/bin/env bash
set -euo pipefail

export NALEKO_AGENT_KEY=$(aws secretsmanager get-secret-value \
  --secret-id naleko/agent-api-key \
  --query SecretString --output text)
export API_BASE=https://api.naleko.co.za

echo "=== 1. Available tools ==="
curl -s "$API_BASE/agent/agent-tools.json" | jq '[.tools[].name]'

echo "=== 2. First employee ==="
EMPLOYEE_ID=$(curl -s \
  -H "x-api-key: $NALEKO_AGENT_KEY" \
  "$API_BASE/agent/v1/employees?limit=1" \
  | jq -r '.employees[0].id')
echo "Employee ID: $EMPLOYEE_ID"

echo "=== 3. Latest verification summary ==="
VERIFICATION_ID=$(curl -s \
  -H "x-api-key: $NALEKO_AGENT_KEY" \
  "$API_BASE/agent/v1/verifications?limit=1" \
  | jq -r '.verifications[0].id')
curl -s \
  -H "x-api-key: $NALEKO_AGENT_KEY" \
  "$API_BASE/agent/v1/verifications/$VERIFICATION_ID/summary" \
  | jq '.summary'

echo "=== 4. Risk assessment ==="
curl -s -X POST \
  -H "x-api-key: $NALEKO_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  "$API_BASE/agent/v1/employees/$EMPLOYEE_ID/assess-risk" \
  | jq '{riskBand, reason}'

echo "=== 5. Audit trail ==="
curl -s \
  -H "x-api-key: $NALEKO_AGENT_KEY" \
  "$API_BASE/agent/v1/audit-log?employeeId=$EMPLOYEE_ID" \
  | jq '.events[] | select(.actor == "AGENT") | {timestamp, detailType}'

echo "=== Demo complete ==="
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `401 Unauthorized` | Missing or expired API key | Re-export `NALEKO_AGENT_KEY` from Secrets Manager |
| `403 Forbidden` | Key lacks access to this route | Contact platform team to check key policy |
| `404 Not Found` | Wrong employee/verification UUID | Use IDs returned by the list commands above |
| `409 Conflict` | Duplicate idempotency key | Re-run with a fresh `$(uuidgen)` |
| `502 Bad Gateway` | Lambda cold start timeout | Retry once; cold starts are under 2s |
