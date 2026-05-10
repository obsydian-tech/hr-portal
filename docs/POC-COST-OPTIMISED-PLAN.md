# Naleko HR Portal — PoC Cost-Optimised Implementation Plan
## "Demo-Ready + Client-Ready Architecture" Strategy

**Plan Date**: 10 May 2026
**Last Updated**: 10 May 2026 (v2 — Gemini + ChatGPT review incorporated)
**Status**: Pre-client — Demo & PoC Phase
**Philosophy**: Build to the right architecture pattern but use PoC-grade services. When a client signs, we upgrade the _service tier_, not the _architecture_.
**Monthly AWS Budget Target**: < $20/month at zero traffic

> **v2 additions**: Cache key fix (model_id included), Bedrock native prompt caching, Firehose → Lambda-to-S3 at PoC scale, CloudWatch log discipline, DynamoDB partition strategy, token/context governance (new Epic 6), Bedrock concurrency protection, Athena Parquet optimisation.

---

## The Principle: Architecture Stays, Services Scale

> Gemini is right. The _architecture_ in the original plan is correct. What changes is **which AWS service tier** backs each component. We build the integration points now so swapping from PoC → Production is a config change, not a rewrite.

---

## Cost Reality Check: Original Plan vs PoC Plan

| Component | Original Plan | Monthly Cost | PoC Replacement | Monthly Cost |
|-----------|--------------|-------------|-----------------|-------------|
| Audit Store | Aurora Serverless v2 | ~$45–70/mo idle | DynamoDB + S3 + Athena | ~$1–3/mo |
| LLM Gateway | LiteLLM on ECS Fargate | ~$15–30/mo | LiteLLM in Lambda + DynamoDB TTL cache | ~$0–2/mo |
| LLM Caching | ElastiCache Redis | ~$15–30/mo | DynamoDB TTL (good enough for PoC) | ~$0.50/mo |
| VPC Endpoints | 3x Interface Endpoints | ~$21–43/mo | Skip for PoC, use public Bedrock | $0 |
| Observability | Full OTel + CloudWatch dashboards | ~$5–15/mo | CloudWatch structured logs only (100% sampled errors, skip traces) | ~$1/mo |
| WAF | AWS WAF on APIGW | ~$8–10/mo | API Gateway existing throttling | $0 |
| Firehose | Kinesis Firehose | ~$1/mo | Lambda-to-S3 direct (simpler at PoC scale) | ~$0/mo |
| **Total** | | **~$109–198/mo** | | **~$2.50–6.50/mo** |

**Savings: ~95% lower AWS bill during PoC phase.** All architectural decisions stay valid.

---

## What Gemini Got Right (And Why We're Adopting It)

### ✅ Aurora Audit Tax — REPLACED
- **Gemini's call**: Aurora Serverless v2 at $45/mo idle is an "audit tax" for a PoC.
- **PoC fix**: DynamoDB `naleko-agent-audit` table with TTL=30 days. Stream → Kinesis Firehose → S3 → Athena for compliance queries.
- **Why Gemini is right**: The architecture is DynamoDB → S3 → Athena. Aurora would be better _at scale_ (structured SQL joins, full-text prompt search). But the _integration interface_ (write audit record → query audit record) is identical.
- **Post-client upgrade**: Swap DynamoDB audit writes for Aurora writes. Athena queries replaced by RDS Query Editor. Same Lambda code, different target.

### ✅ VPC Endpoint Proliferation — DEFERRED
- **Gemini's call**: PrivateLink endpoints are ~$0.01/hr/AZ = ~$7/mo per endpoint. With 2–3 needed (Bedrock, Secrets Manager, DynamoDB), that's $21–43/mo for PoC.
- **PoC fix**: Use public Bedrock endpoint with TLS (already encrypted in transit). For SA data residency compliance: Bedrock af-south-1 never leaves AWS infrastructure even on public endpoints.
- **Post-client upgrade**: Add VPC + PrivateLink endpoints as part of client onboarding security hardening. This is a Terraform `aws_vpc_endpoint` resource addition only — no Lambda changes.

### ✅ ElastiCache for Prompt Caching — REPLACED
- **Gemini's call**: Over-provisioned for low throughput.
- **PoC fix**: DynamoDB with TTL=1hr keyed on SHA-256 hash of (system_prompt + first_user_turn). Good enough for demo-scale.
- **Post-client upgrade**: Drop-in replace cache backend with Momento (serverless Redis) or ElastiCache when sub-millisecond matters.

### ✅ OTel 100% Trace Sampling — DEFERRED
- **Gemini's call**: Full agent trace sampling can cost more than the LLM calls.
- **PoC fix**: Structured JSON logs to CloudWatch only. 100% error capture, 0% trace sampling. Add log metric filters for cost/latency dashboards.
- **Post-client upgrade**: OTel collector Lambda layer + X-Ray, 100% errors / 5% successes.

### ✅ HITL in Tool Definition — ADOPTED
- **Gemini's call**: Don't build HITL into the agent orchestrator. Build it into the _tool itself_ — the write tool returns `PENDING_APPROVAL` and triggers async notification.
- **Why this is better**: Agent is stateless, approval flow is decoupled. No Step Functions needed for PoC — just DynamoDB `naleko-pending-actions` + Lambda callback.

---

## Revised Task List: PoC Phase

### 🟢 DO NOW (PoC Sprint 1 — Week 1–2)
These deliver real value, cost near-zero, and are the same code you'd write for production.

| Task | What It Does | Cost | Effort |
|------|-------------|------|--------|
| **NH-01** | Pre-LLM PII guard on tool responses | $0 (Lambda code) | 0.5 days |
| **NH-02** | HITL gate — write tool returns PENDING_APPROVAL + DynamoDB `naleko-pending-actions` | $0 | 1 day |
| **NH-09** | Intent Router in nalekoAiChat (keyword/regex classifier) | $0 (Lambda code) | 1 day |
| **NH-13** | Secrets Manager 90-day API key rotation | $0.05/secret/mo | 0.5 days |

**Sprint 1 budget**: ~$0.05/month additional | **Audit score gain**: +16%

---

### 🟡 DO NOW (PoC Sprint 2 — Week 3–4)
Audit store on PoC architecture (DynamoDB, not Aurora). Prompt caching (DynamoDB TTL, not Redis).

| Task | What It Does | PoC Service | Cost |
|------|-------------|------------|------|
| **NH-04-poc** | Audit store Terraform — DynamoDB `naleko-agent-audit` + TTL + Stream | DynamoDB | ~$0.50/mo |
| **NH-05** | Write prompt/response to `naleko-agent-audit` from nalekoAiChat | DynamoDB (not Aurora) | $0 |
| **NH-07-poc** | Prompt caching — DynamoDB TTL cache keyed on SHA-256(system_prompt + turn_1) | DynamoDB | ~$0.50/mo |
| **NH-12-poc** | DynamoDB Streams → Kinesis Firehose → S3 (audit archive, POPIA 5yr retention) | Kinesis + S3 | ~$1/mo |

**Sprint 2 budget**: ~$2/month additional | **Audit score gain**: +14%

---

### 🟡 DO NOW (PoC Sprint 3 — Week 5–6)
LiteLLM in Lambda (not ECS Fargate). Basic CloudWatch cost dashboard.

| Task | What It Does | PoC Service | Cost |
|------|-------------|------------|------|
| **NH-08-poc** | LiteLLM lightweight config in nalekoAiChat (model aliasing + provider abstraction) | Lambda env vars (no container) | $0 |
| **NH-10-poc** | CloudWatch structured log metric filters for token cost + latency | CloudWatch | ~$1/mo |
| **NH-11-poc** | CloudWatch dashboard: cost/request, latency p50/p99, error rate | CloudWatch | ~$0.30/mo |

**Sprint 3 budget**: ~$1.30/month additional | **Audit score gain**: +10%

---

### 🔴 POST-CLIENT UPGRADES (Do When First Paying Customer Signs)

These are correct enterprise decisions. They're just expensive to run at zero traffic.

| Upgrade | From (PoC) | To (Enterprise) | Trigger | Est. Cost |
|---------|-----------|----------------|---------|-----------|
| **Audit Store** | DynamoDB + S3 | Aurora Serverless v2 (min 0.5 ACU) | Client signs + data volume > 10k records/month | +$45–70/mo |
| **Private Networking** | Public Bedrock endpoint (TLS) | VPC + PrivateLink Interface Endpoints | Client security review / banking/gov sector | +$21–43/mo |
| **Prompt Caching** | DynamoDB TTL | Momento Serverless Redis | Throughput > 1k req/day | +$5–10/mo |
| **LLM Gateway** | LiteLLM Lambda env vars | LiteLLM on ECS Fargate + ALB | Multi-model routing, >10k req/day | +$15–30/mo |
| **OTel Tracing** | CloudWatch logs only | OTel Lambda Layer + X-Ray + Sampling Rules (100% errors / 5% success) | Client SLA monitoring | +$5–15/mo |
| **WAF** | APIGW built-in throttling | AWS WAF managed rule groups on APIGW + MCP Function URL | Client contract / PCI/banking | +$8–10/mo |
| **Bedrock Guardrails** | PII regex in Lambda code | Amazon Bedrock Guardrails (managed PII + content filters) | Enterprise compliance review | +$2–5/mo per guardrail |
| **QuickSight** | CloudWatch dashboard | Amazon QuickSight + S3 Athena | Client-facing reporting/BI | +$18–24/mo |

**Estimated enterprise monthly cost** (all upgrades): ~$119–207/month
**Justified when**: Monthly client ARR > $3k

---

## Revised Audit Compliance Score

| Phase | Score | What's Done |
|-------|-------|------------|
| Current (today) | 41% (49/120) | Baseline |
| After PoC Sprints 1–3 | ~72% (~86/120) | NH-01, 02, 04-poc, 05, 07-poc, 08-poc, 09, 10-poc, 11-poc, 12-poc, 13 |
| After Enterprise Upgrades | ~88% (~106/120) | Aurora, VPC, WAF, OTel, Guardrails |

> **Note**: The remaining 12% gap at PoC level is by design — it maps exactly to the infrastructure services that are cost-prohibitive at zero traffic. The audit doc marks these as "deferred for client onboarding".

---

## Revised Jira Task Set (PoC Phase)

The original NH-03, NH-04, NH-06, NH-07, NH-08, NH-10, NH-11 tasks are replaced with PoC variants below. The unchanged tasks (NH-01, NH-02, NH-09, NH-12, NH-13) remain as-is from `AUDIT-FIXES-PLAN.md`.

### NH-04-poc — DynamoDB Audit Store (replaces Aurora)

**Type**: Infra (Terraform)
**Priority**: High
**Branch**: `feature/NH-04poc-dynamodb-audit-store`
**Effort**: 0.5 days
**Cost**: ~$0.50/mo (on-demand DynamoDB)

**What to build**:
```hcl
# infra/dynamodb.tf — add:
resource "aws_dynamodb_table" "agent_audit" {
  name         = "naleko-agent-audit"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "sessionId"
  range_key    = "timestamp"

  attribute {
    name = "sessionId"
    type = "S"
  }
  attribute {
    name = "timestamp"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"  # Unix epoch, 30 days from creation
    enabled        = true
  }

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  tags = { Environment = "poc", Purpose = "agent-audit" }
}
```

**Acceptance criteria**:
- [ ] Table created via `terraform apply`
- [ ] TTL enabled (30-day expiry)
- [ ] DynamoDB Stream enabled (needed for NH-12-poc)
- [ ] PAY_PER_REQUEST billing (no provisioned capacity cost)

**Post-client upgrade path**: When Aurora is needed, add `aws_rds_cluster` alongside this table. nalekoAiChat writes to both for a 2-week dual-write migration period, then DynamoDB audit table is decommissioned.

---

### NH-07-poc — DynamoDB Prompt Cache (replaces Portkey/Redis)

**Type**: Lambda + Infra (Terraform)
**Priority**: Medium
**Branch**: `feature/NH-07poc-dynamodb-prompt-cache`
**Effort**: 1 day
**Cost**: ~$0.50/mo

**What to build**:

1. DynamoDB table `naleko-prompt-cache`:
```hcl
resource "aws_dynamodb_table" "prompt_cache" {
  name         = "naleko-prompt-cache"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "cacheKey"

  attribute {
    name = "cacheKey"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"  # Unix epoch, 1 hour from creation
    enabled        = true
  }

  tags = { Environment = "poc", Purpose = "prompt-cache" }
}
```

2. In `lambda/nalekoAiChat/index.mjs`:
   - Before invoking Bedrock, compute `cacheKey = SHA-256(systemPrompt + firstUserMessage)`
   - Check DynamoDB cache for existing response
   - On cache miss: invoke Bedrock, store response with TTL=3600
   - Log `cache_hit: true/false` to structured log

**Acceptance criteria**:
- [ ] Cache hit returns response without Bedrock invocation (confirmed via CloudWatch logs)
- [ ] Cache miss invokes Bedrock and stores result
- [ ] TTL=1hr (cost control — stale responses acceptable for demo-scale)
- [ ] `cacheKey` is deterministic for identical prompts

**Post-client upgrade path**: Replace DynamoDB read/write with Momento SDK (`@gomomento/sdk`). Same cache key logic, same TTL, different client. Lambda code change only.

---

### NH-08-poc — LiteLLM Lambda Env Var Config (replaces ECS container)

**Type**: Lambda config
**Priority**: Medium
**Branch**: `feature/NH-08poc-litellm-model-aliasing`
**Effort**: 0.5 days
**Cost**: $0

**What to build**:

In `lambda/nalekoAiChat/index.mjs`, replace the hard-coded `anthropic.claude-haiku-4-5` model string with an environment variable lookup and a lightweight model config map:

```js
// model-config.mjs (new file in lambda/nalekoAiChat/)
export const MODEL_ALIASES = {
  'fast':    process.env.MODEL_FAST    || 'anthropic.claude-haiku-4-5',
  'smart':   process.env.MODEL_SMART   || 'anthropic.claude-sonnet-4-5',
  'default': process.env.MODEL_DEFAULT || 'anthropic.claude-haiku-4-5',
};

// Usage in index.mjs:
// const modelId = MODEL_ALIASES[intentClass] || MODEL_ALIASES['default'];
```

Lambda env vars in `infra/lambdas.tf`:
```hcl
MODEL_FAST    = "anthropic.claude-haiku-4-5"
MODEL_SMART   = "anthropic.claude-sonnet-4-5"
MODEL_DEFAULT = "anthropic.claude-haiku-4-5"
```

**This creates the LiteLLM abstraction layer pattern** without the container cost. When LiteLLM on ECS is needed, the model resolution logic moves to an HTTP call to the gateway — the `MODEL_ALIASES` map becomes endpoint aliases, same keys.

**Acceptance criteria**:
- [ ] No hard-coded model string in `index.mjs`
- [ ] Model selection is driven by `intentClass` from NH-09 intent router
- [ ] Changing Lambda env var changes model without code deploy

---

### NH-10-poc — CloudWatch Structured Log Cost Metrics

**Type**: Observability (CloudWatch + Terraform)
**Priority**: Low
**Branch**: `feature/NH-10poc-cloudwatch-cost-metrics`
**Effort**: 0.5 days
**Cost**: ~$1/mo

**What to build**:

1. Add structured cost log line to `nalekoAiChat` after each Bedrock invocation:
```js
console.log(JSON.stringify({
  event: 'bedrock_invocation',
  model: modelId,
  input_tokens: usage.inputTokens,
  output_tokens: usage.outputTokens,
  cache_hit: cacheHit,
  intent_class: intentClass,
  latency_ms: Date.now() - start,
  session_id: sessionId,
}));
```

2. CloudWatch Log Metric Filters (`infra/cloudwatch.tf`):
```hcl
resource "aws_cloudwatch_log_metric_filter" "token_cost" {
  name           = "naleko-token-usage"
  log_group_name = "/aws/lambda/nalekoAiChat"
  pattern        = "{ $.event = \"bedrock_invocation\" }"

  metric_transformation {
    name      = "InputTokens"
    namespace = "Naleko/AI"
    value     = "$.input_tokens"
  }
}
```

**Acceptance criteria**:
- [ ] Token count appears in CloudWatch custom namespace `Naleko/AI`
- [ ] Cache hit/miss ratio visible in logs
- [ ] Latency metric published

---

### NH-11-poc — CloudWatch Dashboard (replaces QuickSight)

**Type**: Observability (Terraform)
**Priority**: Low
**Branch**: `feature/NH-11poc-cloudwatch-dashboard`
**Effort**: 0.5 days
**Cost**: ~$0.30/mo (1 dashboard = $3/mo, prorate by usage)

**What to build**:

CloudWatch dashboard `Naleko-AI-PoC` with widgets:
- Total input + output tokens (last 7 days)
- Cache hit rate (%) 
- Bedrock invocation latency p50/p99
- Error rate (Lambda errors / total invocations)
- HITL pending approvals count (from `naleko-pending-actions` DynamoDB)

All data sourced from CloudWatch metrics + log insights — no QuickSight, no Athena queries.

**Post-client upgrade path**: When client needs formatted reports or business users need self-serve analytics, add QuickSight connected to S3 Athena data. Dashboard widgets map 1:1 to QuickSight visuals.

---

### NH-12-poc — DynamoDB Streams → Kinesis Firehose → S3

**Type**: Infra (Terraform)
**Priority**: Medium
**Branch**: `feature/NH-12poc-streams-firehose-s3`
**Effort**: 1 day
**Cost**: ~$1/mo (Firehose $0.029/GB, S3 minimal)

**What to build**:

Wire the `naleko-agent-audit` DynamoDB Stream (created in NH-04-poc) to Kinesis Data Firehose → S3 `naleko-audit-archive`:

```hcl
# infra/s3.tf — add:
resource "aws_s3_bucket" "audit_archive" {
  bucket = "naleko-audit-archive-${var.aws_account_id}"
}

resource "aws_s3_bucket_lifecycle_configuration" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id
  rule {
    id     = "popia-5yr-retention"
    status = "Enabled"
    expiration { days = 1825 } # 5 years (POPIA requirement)
  }
}

# Kinesis Firehose delivery stream
resource "aws_kinesis_firehose_delivery_stream" "audit_to_s3" {
  name        = "naleko-audit-to-s3"
  destination = "extended_s3"
  extended_s3_configuration {
    role_arn   = aws_iam_role.firehose_role.arn
    bucket_arn = aws_s3_bucket.audit_archive.arn
    prefix     = "year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/"
    buffering_interval = 300 # 5 min buffering (cost: fewer S3 PUTs)
    buffering_size     = 5   # MB
  }
}
```

Add Athena workgroup + database for ad-hoc POPIA compliance queries:
```hcl
resource "aws_athena_workgroup" "audit" {
  name = "naleko-audit"
  configuration {
    result_configuration {
      output_location = "s3://${aws_s3_bucket.audit_archive.bucket}/athena-results/"
    }
  }
}
```

**This completes the DynamoDB → S3 → Athena pattern Gemini recommended**, replacing Aurora at 80% lower cost.

**Acceptance criteria**:
- [ ] Audit records appear in S3 within 10 minutes of DynamoDB write
- [ ] S3 objects are partitioned by date prefix
- [ ] Athena query returns audit records for a given date range
- [ ] S3 lifecycle rule set to 1825 days (5yr POPIA)

---

## Summary: What We're Building Now vs Later

```
NOW (PoC — target < $20/month):
┌─────────────────────────────────────────────────────────┐
│  NH-01  Pre-LLM PII guard          (Lambda code, $0)   │
│  NH-02  HITL gate                  (DynamoDB, ~$0)     │
│  NH-04  DynamoDB audit store       (PAY_PER_REQ, ~$0.50)│
│  NH-05  Write audit from Lambda    (Lambda code, $0)   │
│  NH-07  DynamoDB prompt cache      (PAY_PER_REQ, ~$0.50)│
│  NH-08  LiteLLM model aliasing     (env vars, $0)      │
│  NH-09  Intent router              (Lambda code, $0)   │
│  NH-10  CloudWatch cost metrics    (~$1/mo)            │
│  NH-11  CloudWatch dashboard       (~$0.30/mo)         │
│  NH-12  Streams → Firehose → S3    (~$1/mo)            │
│  NH-13  Secrets Manager rotation   (~$0.05/mo)         │
│  TOTAL                             ≈ $3.35–6/month     │
└─────────────────────────────────────────────────────────┘

LATER (Client Onboarding Hardening — ~$119–207/month):
┌─────────────────────────────────────────────────────────┐
│  NH-03  Bedrock VPC PrivateLink    (+$21–43/mo)        │
│  NH-04u Aurora Serverless v2       (+$45–70/mo)        │
│  NH-06  WAF on API Gateway         (+$8–10/mo)         │
│  NH-07u Portkey gateway (Lambda)   (+$0 → ECS later)   │
│  NH-08u LiteLLM on ECS Fargate    (+$15–30/mo)        │
│  NH-10u OTel traces + X-Ray       (+$5–15/mo)         │
│  NH-BCG Bedrock Guardrails (PII)   (+$2–5/mo)         │
│  NH-QST QuickSight + Athena BI     (+$18–24/mo)       │
└─────────────────────────────────────────────────────────┘
```

---

## Architecture Diagram (PoC vs Enterprise)

```
PoC Flow:
User → APIGW → nalekoAiChat Lambda
                 ├── Check DynamoDB prompt cache (SHA-256 key, TTL 1hr)
                 ├── [cache miss] → Apply intent router → select model alias
                 ├── Apply pre-LLM PII sanitiser on tool responses
                 ├── Invoke Bedrock (public endpoint, TLS)
                 ├── Write to naleko-agent-audit (DynamoDB, TTL 30d)
                 ├── [write tool] → Return PENDING_APPROVAL → naleko-pending-actions
                 └── Return response
                 
DynamoDB Stream → Kinesis Firehose → S3 (5yr archive) → Athena (compliance queries)

Enterprise Additions (post-client):
- VPC + PrivateLink replaces public Bedrock endpoint
- Aurora Serverless v2 replaces DynamoDB audit table
- ECS Fargate LiteLLM proxy sits between Lambda and Bedrock
- Bedrock Guardrails replaces Lambda-level PII regex
- OTel collector layer + X-Ray replaces CloudWatch-only
- QuickSight replaces CloudWatch dashboards
```

---

## Gemini's Tips We're Implementing

1. ✅ **DynamoDB → S3 → Athena** for audit (80% cost saving vs Aurora) — NH-04-poc, NH-12-poc
2. ✅ **HITL in the Tool, not the Agent** — NH-02 redesigned per this pattern
3. ✅ **Prompt Caching** via DynamoDB TTL — NH-07-poc (Momento when scale warrants)
4. ✅ **OTel Sampling** — PoC logs only, traces deferred. When enabled: 100% errors / 5% success
5. ✅ **VPC First is correct but deferred** — public Bedrock endpoint (TLS) is acceptable for PoC
6. ✅ **Intent Router** builds in parallel with gateway (NH-09, no infra dependency)
7. ✅ **Cache key includes model_id** — see NH-07-poc correction below
8. ✅ **Native Bedrock prompt caching** — system prompt prefix caching if >1024 tokens
9. ✅ **CloudWatch log discipline** — structured events only, NO prompt/response text in logs
10. ✅ **DynamoDB partition strategy** — composite keys to avoid hot partitions
11. ✅ **Firehose replaced by Lambda-to-S3** at PoC scale — simpler + no minimum billing
12. ✅ **Token/context governance** — new Epic 6 (NH-14 through NH-17)
13. ✅ **Bedrock concurrency protection** — exponential backoff + reserved concurrency

---

## v2 Corrections & Additions

### Fix 1: NH-07-poc Cache Key Must Include model_id

**Original**: `cacheKey = SHA-256(systemPrompt + firstUserMessage)`
**Corrected**: `cacheKey = SHA-256(systemPrompt + firstUserMessage + modelId)`

**Why**: Intent router (NH-09) selects `haiku` vs `sonnet` based on query type. A cached haiku response must not be served for the same prompt when the router selects sonnet. Without `modelId` in the key, a cache hit returns the wrong model's response silently.

```js
// lambda/nalekoAiChat/cache.mjs
import { createHash } from 'crypto';

export function buildCacheKey(systemPrompt, firstUserMessage, modelId) {
  return createHash('sha256')
    .update(systemPrompt + '||' + firstUserMessage + '||' + modelId)
    .digest('hex');
}
```

---

### Fix 2: NH-12-poc — Replace Kinesis Firehose with Lambda-to-S3

**Original**: DynamoDB Stream → Kinesis Firehose → S3

**Corrected**: DynamoDB Stream → Lambda transformer → compressed JSONL → S3

**Why** (ChatGPT):
- Firehose has minimum billing sizes per data record — inefficient at PoC-scale tiny writes
- At low traffic, per-invocation Lambda cost + S3 PUT is cheaper
- Lambda transformer gives you Parquet-ready compressed JSONL from day one
- Firehose becomes worth it when throughput makes Lambda concurrency expensive

**PoC pattern**:
```js
// lambda/auditStreamProcessor/index.mjs  (new Lambda triggered by DynamoDB Stream)
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { gzipSync } from 'zlib';

export const handler = async (event) => {
  const records = event.Records
    .filter(r => r.eventName !== 'REMOVE')
    .map(r => JSON.stringify(r.dynamodb.NewImage));

  if (!records.length) return;

  const now = new Date();
  const key = `year=${now.getUTCFullYear()}/month=${String(now.getUTCMonth()+1).padStart(2,'0')}/day=${String(now.getUTCDate()).padStart(2,'0')}/${Date.now()}.jsonl.gz`;

  await s3.send(new PutObjectCommand({
    Bucket: process.env.AUDIT_BUCKET,
    Key: key,
    Body: gzipSync(records.join('\n')),
    ContentEncoding: 'gzip',
    ContentType: 'application/x-ndjson',
  }));
};
```

**Post-client upgrade**: Replace Lambda with Firehose + Glue catalog + Parquet transform when daily record volume exceeds ~50k/day.

---

### Fix 3: Bedrock Native Prompt Caching

**Gemini's tip**: If the Naleko system prompt is >1024 tokens, Bedrock's native prefix caching cuts input costs by ~90% automatically.

**Action in NH-07-poc**: Add `cache_control` to the system prompt in `nalekoAiChat`:

```js
// In the Bedrock converse API call:
const systemPrompt = [{
  text: NALEKO_SYSTEM_INSTRUCTIONS,
  cacheControl: { type: 'ephemeral' }  // Bedrock native cache — no extra cost
}];
```

This is orthogonal to the DynamoDB full-response cache. Together they handle:
- **Bedrock native cache** → prefix/system prompt tokens (90% input reduction)
- **DynamoDB TTL cache** → full identical responses (100% call elimination)

**Check**: Count tokens in `NALEKO_SYSTEM_INSTRUCTIONS`. If >1024, native caching is active. Add `console.log({ cached_prompt_tokens: usage.cacheReadInputTokens })` to confirm.

---

### Fix 4: CloudWatch Log Discipline (Critical Cost Control)

**ChatGPT warning**: Verbose JSON logs (full prompts, responses, conversation history) can generate MBs per request and make CloudWatch the biggest line item.

**Rule for ALL Lambda functions in this project**:

| ✅ LOG THIS | ❌ NEVER LOG THIS |
|------------|-----------------|
| `event`, `model`, `input_tokens`, `output_tokens`, `latency_ms`, `cache_hit`, `intent_class`, `session_id` | Full prompt text |
| Error stack traces | Full Claude response text |
| HITL action type + employee_id | Conversation history array |
| Tool name + result status | Raw tool response payloads |
| Cache key hash (not plaintext) | SA ID numbers, phone numbers, bank details |

**Enforce with a log wrapper**:
```js
// lambda/nalekoAiChat/logger.mjs
export function logInvocation({ model, inputTokens, outputTokens, latencyMs, cacheHit, intentClass, sessionId, error }) {
  console.log(JSON.stringify({
    event: 'bedrock_invocation',
    model, input_tokens: inputTokens, output_tokens: outputTokens,
    latency_ms: latencyMs, cache_hit: cacheHit,
    intent_class: intentClass, session_id: sessionId,
    ...(error && { error: error.message, stack: error.stack }),
  }));
}
```

**Verbatim audit payloads** (prompt + response text) go directly to `naleko-agent-audit` DynamoDB → S3. They never touch CloudWatch.

---

### Fix 5: DynamoDB Partition Strategy

**ChatGPT warning**: `sessionId` as partition key can create hot partitions if sessions are short and rapidly created (demo scenario = many sessions from same user).

**Corrected key design**:

| Table | PK | SK | Notes |
|-------|----|----|-------|
| `naleko-agent-audit` | `tenantId#sessionId` | ISO8601 timestamp | Distributes across tenants |
| `naleko-prompt-cache` | `sha256(prompt+model)` | — | Hash naturally distributes |
| `naleko-pending-actions` | `actionId` (UUID v4) | — | UUIDs distribute naturally |
| `naleko-agent-audit` GSI | `date` (YYYY-MM-DD) | `timestamp` | For date-range compliance queries |

**For PoC**: `tenantId = "demo"` — still uses the composite key so production migration requires no table restructure.

---

### Fix 6: Athena Parquet Optimisation (Do From Day 1)

**ChatGPT warning**: Raw JSON + unpartitioned S3 = expensive Athena scans. Parquet with partitioning reduces Athena cost by 80–95%.

**Since we're using Lambda-to-S3** (Fix 2), the Lambda writes gzipped JSONL. Add an AWS Glue Crawler that runs weekly to build the Athena schema — no extra cost at PoC scale.

**Glue/Athena config in Terraform** (`infra/athena.tf`):
```hcl
resource "aws_glue_catalog_database" "audit" {
  name = "naleko_audit"
}

resource "aws_glue_crawler" "audit" {
  name          = "naleko-audit-crawler"
  role          = aws_iam_role.glue_role.arn
  database_name = aws_glue_catalog_database.audit.name
  schedule      = "cron(0 2 ? * MON *)"  # Weekly - free for PoC

  s3_target {
    path = "s3://${aws_s3_bucket.audit_archive.bucket}/"
  }
}
```

**Partitions**: Already correct in Fix 2 (`year=/month=/day=` prefix). Athena will auto-partition on these.

---

### Fix 7: Bedrock Concurrency Protection

**ChatGPT warning**: af-south-1 has lower Bedrock service limits than us-east-1. A single demo with 5 concurrent users can trigger 429s.

**Add to nalekoAiChat** (Sprint 1, lowest effort):
```js
// Exponential backoff with jitter for Bedrock calls
async function invokeBedrockWithRetry(params, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await bedrockClient.send(new ConverseCommand(params));
    } catch (err) {
      if (err.name === 'ThrottlingException' && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 10000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}
```

**Add to `infra/lambdas.tf`**:
```hcl
reserved_concurrent_executions = 10  # Prevents Lambda storm → Bedrock 429 cascade
```

**Post-client**: Add SQS queue in front of nalekoAiChat for sustained load scenarios. Lambda pulls from queue — natural concurrency control.

---

## Epic 6 — AI Cost Governance Layer (New — ChatGPT Recommendation)

**Priority: HIGH — implement in Sprint 2 alongside audit store**
**Why**: Token explosion is the #1 actual cost risk at PoC scale. Not infrastructure.
**AWS Cost Impact**: $0 (Lambda code + env vars only)

The real budget killer is not DynamoDB or CloudWatch — it's a 20-turn conversation where tool responses inject 3,000 tokens each turn, accumulating a 60,000-token context by turn 10.

### NH-14 — Token Budget Enforcement Per Request

**Branch**: `feature/NH-14-token-budget-guard`
**Effort**: 0.5 days | **Cost**: $0

**What to build** in `lambda/nalekoAiChat/`:

```js
// token-budget.mjs
const MAX_CONTEXT_TOKENS = 8000;     // Hard limit per conversation turn
const MAX_TOOL_PAYLOAD_TOKENS = 2000; // Max tokens from any single tool result
const MAX_TURNS_BEFORE_SUMMARY = 8;  // Trigger summarisation after N turns

export function enforceToolPayloadBudget(toolResult, maxTokens = MAX_TOOL_PAYLOAD_TOKENS) {
  // Rough token estimate: 1 token ≈ 4 chars
  const estimatedTokens = JSON.stringify(toolResult).length / 4;
  if (estimatedTokens <= maxTokens) return toolResult;

  // Truncate + add notice
  const truncated = JSON.stringify(toolResult).slice(0, maxTokens * 4);
  return { ...JSON.parse(truncated + '{}'), _truncated: true, _originalTokens: Math.round(estimatedTokens) };
}

export function shouldSummariseHistory(messages) {
  return messages.filter(m => m.role === 'user').length >= MAX_TURNS_BEFORE_SUMMARY;
}
```

**Acceptance criteria**:
- [ ] Tool responses >2000 estimated tokens are truncated before entering prompt
- [ ] Truncation is logged (`event: 'tool_payload_truncated', tool_name, original_tokens, truncated_tokens`)
- [ ] `MAX_TOOL_PAYLOAD_TOKENS` is a Lambda env var (not hard-coded)

---

### NH-15 — Conversation History Summarisation

**Branch**: `feature/NH-15-history-summarisation`
**Effort**: 1 day | **Cost**: ~$0.001/summary (cheap Haiku call)

**What to build**: After every 8 turns, compress conversation history using Claude Haiku before the next user message is processed.

```js
// conversation-memory.mjs
export async function summariseHistory(messages, bedrockClient) {
  const historyText = messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : '[tool interaction]'}`)
    .join('\n');

  const summary = await bedrockClient.send(new ConverseCommand({
    modelId: 'anthropic.claude-haiku-4-5',  // Always use cheap model for summaries
    messages: [{
      role: 'user',
      content: `Summarise this HR assistant conversation in 3-5 bullet points. Keep key facts (employee IDs, decisions made, pending actions). Conversation:\n\n${historyText}`
    }],
    inferenceConfig: { maxTokens: 300 },
  }));

  return [{
    role: 'user',
    content: `[Previous conversation summary]: ${summary.output.message.content[0].text}`
  }];
}
```

**Why this matters**: A 20-turn conversation without summarisation: ~40,000 tokens/request → ~$0.048 per turn at Haiku rates. With summarisation every 8 turns: ~8,000 tokens/request → ~$0.0096 per turn. **5× cost reduction at no quality loss for HR tasks.**

**Acceptance criteria**:
- [ ] History summarisation fires after `MAX_TURNS_BEFORE_SUMMARY` (env var, default 8)
- [ ] Summary replaces full history, not appended to it
- [ ] Summary call always uses `MODEL_FAST` (Haiku), never Sonnet
- [ ] Log `event: 'history_summarised', turns_compressed, tokens_saved_estimate`

---

### NH-16 — Per-Session Rate Limiting

**Branch**: `feature/NH-16-session-rate-limiting`
**Effort**: 0.5 days | **Cost**: ~$0 (DynamoDB conditional writes)

**What to build**: DynamoDB conditional write to enforce max requests per session per hour.

```js
// rate-limiter.mjs
export async function checkRateLimit(sessionId, dynamoClient, maxPerHour = 50) {
  const windowKey = `${sessionId}#${new Date().toISOString().slice(0, 13)}`; // hourly window
  
  try {
    await dynamoClient.send(new UpdateItemCommand({
      TableName: 'naleko-rate-limits',
      Key: { pk: { S: windowKey } },
      UpdateExpression: 'ADD #count :one SET #ttl = if_not_exists(#ttl, :exp)',
      ConditionExpression: 'attribute_not_exists(#count) OR #count < :max',
      ExpressionAttributeNames: { '#count': 'count', '#ttl': 'expiresAt' },
      ExpressionAttributeValues: {
        ':one': { N: '1' },
        ':max': { N: String(maxPerHour) },
        ':exp': { N: String(Math.floor(Date.now() / 1000) + 3600) },
      },
    }));
    return { allowed: true };
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') return { allowed: false, reason: 'rate_limit_exceeded' };
    throw e;
  }
}
```

**Acceptance criteria**:
- [ ] Sessions exceeding `MAX_REQUESTS_PER_HOUR` (env var, default 50) return HTTP 429
- [ ] Rate limit window resets each hour (DynamoDB TTL)
- [ ] Rate limit events logged for CloudWatch dashboard

---

### NH-17 — Cost Anomaly Alert

**Branch**: `feature/NH-17-cost-anomaly-alert`
**Effort**: 0.5 days | **Cost**: ~$0.10/mo (CloudWatch alarm)

**What to build**: CloudWatch alarm on `Naleko/AI InputTokens` metric. Alert via SNS → email if daily spend exceeds threshold.

```hcl
# infra/alarms.tf — add:
resource "aws_cloudwatch_metric_alarm" "token_cost_anomaly" {
  alarm_name          = "naleko-ai-token-spike"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "InputTokens"
  namespace           = "Naleko/AI"
  period              = 3600  # 1 hour window
  statistic           = "Sum"
  threshold           = 100000  # ~$0.025 per hour at Haiku rates — adjust as needed
  alarm_description   = "AI token usage spike detected — possible runaway agent loop"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
```

**Why**: A runaway agentic loop (agent calling itself in a cycle) can burn hundreds of dollars in minutes. This alarm is the emergency brake.

**Acceptance criteria**:
- [ ] Alarm fires when hourly input tokens > 100k (env var threshold)
- [ ] SNS notification goes to ops email
- [ ] Alarm visible on NH-11-poc CloudWatch dashboard

---

## Revised Complete Task List (v2)

| Sprint | Task | Title | Effort | Cost |
|--------|------|-------|--------|------|
| 1 | NH-01 | Pre-LLM PII guard | 0.5d | $0 |
| 1 | NH-02 | HITL gate (tool-level PENDING_APPROVAL) | 1d | $0 |
| 1 | NH-09 | Intent router (keyword classifier + Haiku fallback) | 1d | $0 |
| 1 | NH-13 | Secrets Manager rotation | 0.5d | $0.05 |
| 1 | **NH-fix1** | Bedrock retry + reserved concurrency | 0.5d | $0 |
| 2 | NH-04-poc | DynamoDB audit store (composite PK) | 0.5d | $0.50 |
| 2 | NH-05 | Write audit from nalekoAiChat | 0.5d | $0 |
| 2 | NH-07-poc | DynamoDB prompt cache (model_id in key + native Bedrock cache) | 1d | $0.50 |
| 2 | NH-12-poc | Lambda-to-S3 audit archive + Glue crawler | 1d | $0 |
| 2 | NH-14 | Token budget + tool payload truncation | 0.5d | $0 |
| 2 | NH-15 | Conversation summarisation every 8 turns | 1d | ~$0 |
| 2 | NH-16 | Per-session rate limiting | 0.5d | $0 |
| 3 | NH-08-poc | Model aliasing via env vars | 0.5d | $0 |
| 3 | NH-10-poc | CloudWatch structured log metrics (log discipline enforced) | 0.5d | $1 |
| 3 | NH-11-poc | CloudWatch dashboard | 0.5d | $0.30 |
| 3 | NH-17 | Cost anomaly alarm | 0.5d | $0.10 |

**Total PoC Sprint cost addition**: ~$2.45/month | **Compliance score**: ~78% (up from 41%)

---

## Gemini's Tips We're Implementing

1. ✅ **DynamoDB → S3 → Athena** for audit (80% cost saving vs Aurora) — NH-04-poc, NH-12-poc
2. ✅ **HITL in the Tool, not the Agent** — NH-02 redesigned per this pattern
3. ✅ **Prompt Caching** via DynamoDB TTL + Bedrock native prefix cache — NH-07-poc
4. ✅ **OTel Sampling** — PoC logs only, traces deferred. When enabled: 100% errors / 5% success
5. ✅ **VPC First is correct but deferred** — public Bedrock endpoint (TLS) is acceptable for PoC
6. ✅ **Intent Router** builds in parallel with gateway (NH-09, no infra dependency)
7. ✅ **Cache key includes model_id** — fix applied to NH-07-poc
8. ✅ **Small-LLM Classifier** — NH-09 intent router uses Haiku for classification, not Sonnet

## ChatGPT's Tips We're Implementing

1. ✅ **CloudWatch log discipline** — structured events only, audit payloads go to DynamoDB/S3
2. ✅ **DynamoDB composite partition key** — `tenantId#sessionId` prevents hot partitions
3. ✅ **Firehose replaced by Lambda-to-S3** — simpler + no minimum billing at PoC scale
4. ✅ **Parquet-ready gzip JSONL** — reduces Athena scan cost by 80–95%
5. ✅ **Token budget enforcement** — NH-14 (tool payload truncation + context limits)
6. ✅ **Conversation summarisation** — NH-15 (5× token cost reduction at scale)
7. ✅ **Rate limiting** — NH-16 (prevents abuse + runaway loops)
8. ✅ **Cost anomaly alarm** — NH-17 (emergency brake on runaway spend)
9. ✅ **Bedrock retry + concurrency cap** — Fix 7 applied in Sprint 1

---

*This document supersedes the enterprise service tiers in `AUDIT-FIXES-PLAN.md`. The task descriptions in AUDIT-FIXES-PLAN.md remain valid for NH-01, NH-02, NH-09, NH-13. PoC variant tasks defined here replace NH-03, NH-04, NH-06, NH-07, NH-08, NH-10, NH-11, NH-12. New tasks NH-14 through NH-17 are additions not in the original plan.*
