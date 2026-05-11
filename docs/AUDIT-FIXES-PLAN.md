# Naleko HR Portal — Audit Remediation Plan
## Enterprise Agentic AI Architecture — Compliance Fix Implementation

**Plan Date**: 10 May 2026  
**Based On**: `docs/ENTERPRISE-AI-AUDIT.md` + Q&A Session findings  
**Jira Project**: NH (https://obsydian.atlassian.net/jira/software/projects/NH/boards/138)  
**Branching**: `feature/NH-XXX-description` off `develop` → PR to `develop`  
**Compute Style**: Lambda-first (serverless, pay-per-use)  
**Audit Store**: Aurora Serverless v2 (scales to zero)  
**Target Score**: 80%+ compliance (up from current 41%)

---

## How Claude Will Work With These Tasks

Each Jira task below is written as a **self-contained prompt for Claude**. When you assign a task to Claude:

1. Claude reads the full task context, problem statement, and acceptance criteria
2. Claude inspects the relevant existing files before making any changes
3. Claude implements the fix, referencing existing Terraform/Lambda patterns in the repo
4. Claude runs verification steps defined in the task
5. Claude confirms all acceptance criteria pass **before** opening the PR
6. Claude opens a PR from `feature/NH-XXX-description` → `develop` with a structured PR description

> **Critical instruction for every task**: Before making any change, Claude must read the existing file it is modifying and confirm it understands the current implementation. Claude must not regress any existing functionality. Terraform changes must `terraform plan` cleanly before PR is opened.

---

## Dependency Map

```
Epic 1 (Security) — can start immediately, no dependencies
    NH-01  Pre-LLM PII guard on tool responses      ← no deps, quick win
    NH-02  HITL gate scaffold for write tools       ← no deps
    NH-03  Bedrock VPC endpoint (Terraform)         ← no deps, infra only

Epic 2 (Audit Store) — NH-04 must complete before NH-05
    NH-04  Aurora Serverless v2 (Terraform)         ← no deps
    NH-05  agent_prompts write from nalekoAiChat    ← depends on NH-04
    NH-06  WAF on MCP Function URL (Terraform)      ← no deps

Epic 3 (LLM Gateway) — NH-07 must complete before NH-08; NH-09 independent
    NH-07  Portkey Lambda proxy                     ← no deps
    NH-08  LiteLLM config + route nalekoAiChat      ← depends on NH-07
    NH-09  Intent Router in nalekoAiChat            ← no deps (parallel with NH-07)

Epic 4 (Observability) — depends on NH-05 (needs audit table) and NH-08 (needs Portkey)
    NH-10  OpenTelemetry GenAI spans                ← depends on NH-05, NH-08
    NH-11  Cost + compliance dashboard              ← depends on NH-05

Epic 5 (Resilience) — independent, can run in parallel after Epic 1
    NH-12  DynamoDB Streams → S3 → Athena          ← no deps
    NH-13  Secrets Manager 90-day key rotation     ← no deps
```

**Recommended parallel sprint groupings:**
- **Sprint 1** (Week 1–2): NH-01, NH-02, NH-03, NH-04, NH-06 — all independent
- **Sprint 2** (Week 3–4): NH-05, NH-07, NH-09, NH-13 — after Epic 2 db is live
- **Sprint 3** (Week 5–6): NH-08, NH-10, NH-11, NH-12 — after gateway is live

---

## Epic 1 — Security Hardening
**Priority: CRITICAL | Timeline: Week 1–2 | Audit findings: 5.1, 5.2, 5.5, 4.2**

---

### NH-01 — Pre-LLM PII Sanitisation on Tool Responses

**Type**: Bug / Security  
**Priority**: Critical  
**Branch**: `feature/NH-01-pre-llm-pii-guard`  
**Estimated effort**: 0.5 days  
**AWS cost impact**: $0 (Lambda code change only)

---

#### Problem (from audit finding 5.1)

The current `nalekoAiChat` Lambda collects tool responses (from `getDocumentVerifications`, `processDocumentOCR`, `getEmployee`, etc.) and **appends them directly to the Claude message array** without any PII sanitisation. This means raw SA ID numbers (13-digit), phone numbers (+27xxxxxxx), and bank account numbers from DynamoDB records enter the Bedrock LLM prompt.

`pii-sanitiser.mjs` currently only runs **after** Claude responds — too late. The POPIA principle of data minimisation requires that Special Personal Information never enters the model prompt unnecessarily.

#### Solution

Apply the existing `pii-sanitiser.mjs` regex patterns to **tool response content** before it is appended to the Claude message array. This is a single additional call in the tool-result processing loop.

#### Files to modify

- `lambda/nalekoAiChat/index.mjs` — apply sanitiser to tool results
- `lambda/nalekoAiChat/pii-sanitiser.mjs` — extend patterns if needed

#### Claude instructions

```
You are implementing a security fix for the Naleko HR Portal agentic AI system.

CONTEXT:
- File: lambda/nalekoAiChat/index.mjs
- File: lambda/nalekoAiChat/pii-sanitiser.mjs
- The system uses Claude (AWS Bedrock) as an LLM with tool-use (function calling)
- Tool responses from HR data APIs may contain SA ID numbers, phone numbers, bank accounts
- Currently pii-sanitiser.mjs is only called on the final Claude response before returning to user
- The fix: also call the sanitiser on each tool response BEFORE appending to the messages array

WHAT TO DO:
1. Read lambda/nalekoAiChat/index.mjs completely first
2. Find the section in the tool-call processing loop where tool results are appended to messages
   (look for where tool_use results are constructed and added to the conversation)
3. Import/call sanitiseText() from pii-sanitiser.mjs on the tool result content string
   BEFORE it is appended to the messages array
4. Read lambda/nalekoAiChat/pii-sanitiser.mjs and verify it exports a sanitisation function
5. Ensure the sanitiser handles: 13-digit SA IDs, +27/0 phone numbers, 8-11 digit bank accounts
6. Add a log entry when PII is detected and redacted in a tool response:
   console.log({ event: 'pii_redacted_in_tool_response', tool_name, patterns_matched })
7. Do NOT modify the existing post-response sanitisation — it stays in place as a second layer
8. Do NOT change the pii-sanitiser.mjs regex patterns unless they are broken

VERIFICATION BEFORE PR:
- Write a unit test or inline test that passes a mock tool response containing
  "9001015009087" (SA ID) and "+27821234567" (phone) and confirms both are redacted
  before the message is appended to the Claude messages array
- Confirm the existing post-response sanitiser is still called (do not remove it)
- Run: cd lambda/nalekoAiChat && npm test (if tests exist) or node -e "require('./index.mjs')"
  to confirm no syntax errors

ACCEPTANCE CRITERIA:
[ ] Tool responses containing SA ID numbers are sanitised before entering the Claude prompt
[ ] Tool responses containing phone numbers are sanitised before entering the Claude prompt
[ ] A log line is emitted when redaction occurs on a tool response
[ ] The existing post-response sanitiser is NOT removed (defence in depth: two layers)
[ ] No existing functionality is broken (read tools still return correct data to the user)
[ ] PR description explains: what changed, why, which audit finding it addresses (5.1)
```

---

### NH-02 — HITL Gate Scaffold for Write Tool Operations

**Type**: Feature / Security  
**Priority**: Critical  
**Branch**: `feature/NH-02-hitl-gate-write-tools`  
**Estimated effort**: 3 days  
**AWS cost impact**: $0 (uses existing Step Functions + API Gateway)

---

#### Problem (from audit finding 4.7, Q&A Finding #4)

The MCP server exposes `reviewDocumentVerification` as a write tool that Claude can invoke autonomously — without any human approval step. An LLM hallucination could approve or reject an employee's document incorrectly. POPIA's non-repudiation principle requires that the audit trail shows **which human** approved an action, not just "the agent".

#### Solution

Implement a HITL gate pattern: when Claude decides to call a write tool, instead of executing it immediately, the system returns a **pending action** to the frontend with a unique `action_id`. The HR manager reviews Claude's recommendation and clicks Approve or Reject. Only then does the write execute, and the audit log records the human's identity.

**Write tools requiring HITL** (from the MCP tool inventory):
- `reviewDocumentVerification` (approve/reject employee documents)
- Any future write tools added to the MCP server

#### Architecture (using existing Step Functions)

```
Claude recommends reviewDocumentVerification(doc_id, status: APPROVED)
        ↓
nalekoAiChat intercepts write tool call
        ↓
Creates a pending_action record in DynamoDB (new table: naleko-pending-actions)
Returns to frontend: { pending_action_id, tool: "reviewDocumentVerification",
                       recommendation: {...}, explanation: "Claude's reasoning" }
        ↓
Frontend displays approval card (● REQUIRES APPROVAL UI already exists)
        ↓
HR Manager clicks APPROVE or REJECT
        ↓
Frontend calls: POST /agent/v1/actions/{action_id}/approve or /reject
        ↓
Lambda executes the actual write with audit: { approved_by: user_id, agent_recommended: true }
```

#### Files to create/modify

- `lambda/nalekoAiChat/index.mjs` — intercept write tool calls, return pending action
- `lambda/nalekoAiChat/hitl-tools.mjs` — new file: list of tools requiring HITL
- `lambda/approveAgentAction/index.mjs` — NEW Lambda: handles approve/reject
- `infra/lambdas.tf` — add approveAgentAction Lambda
- `infra/dynamodb.tf` — add naleko-pending-actions table
- `infra/apigateway.tf` — add POST /agent/v1/actions/{action_id}/approve|reject routes

#### Claude instructions

```
You are implementing a Human-in-the-Loop (HITL) security gate for the Naleko HR Portal
agentic AI system. This prevents Claude from autonomously executing write operations on
employee data without explicit human approval.

CONTEXT:
- The system: nalekoAiChat Lambda orchestrates Claude (Bedrock) with tool-use
- tool-resolver.mjs maps Claude tool names to Agent API HTTP calls (agentGet/agentPost)
- reviewDocumentVerification calls POST /agent/v1/document-verifications/{id}/review
- Currently this write executes immediately when Claude decides to call it
- We need: write tool calls intercepted → pending action created → human approves → then execute

WHAT TO DO — Part A: Lambda changes

1. Read lambda/nalekoAiChat/index.mjs completely
2. Read lambda/nalekoAiChat/tool-resolver.mjs completely
3. Create lambda/nalekoAiChat/hitl-tools.mjs with a Set of tool names requiring HITL:
   export const HITL_REQUIRED_TOOLS = new Set(['reviewDocumentVerification']);

4. In the tool-call processing loop in index.mjs, before executing a tool:
   - Check if toolName is in HITL_REQUIRED_TOOLS
   - If YES: do NOT call tool-resolver, instead:
     a. Generate a UUID action_id
     b. Write a record to DynamoDB table 'naleko-pending-actions':
        { action_id, tool_name, tool_input, user_id, conversation_id,
          claude_reasoning (last assistant message), status: 'PENDING',
          created_at, expires_at (now + 24 hours) }
     c. Return to the conversation a special assistant message:
        "I recommend [action with explanation]. This action requires your approval.
         Action ID: {action_id}. Please review and approve or reject in the portal."
     d. Break the tool loop (do not continue to next round)
   - If NO: execute normally via tool-resolver

5. Create lambda/approveAgentAction/index.mjs — new Lambda that:
   - Reads the pending action from naleko-pending-actions by action_id
   - Verifies: status === 'PENDING', not expired, the requesting user has HR_MANAGER role
   - On APPROVE: calls the actual Agent API write endpoint, sets status: 'APPROVED',
     logs: { action_id, approved_by: user_id, approved_at, tool_name }
   - On REJECT: sets status: 'REJECTED', logs: { action_id, rejected_by, rejected_at }
   - Returns 200 with result

WHAT TO DO — Part B: Infrastructure (Terraform)

6. Read infra/dynamodb.tf to understand existing table patterns
7. Add to infra/dynamodb.tf:
   - Table: naleko-pending-actions
   - Partition key: action_id (String)
   - TTL attribute: expires_at
   - Encryption: aws/dynamodb KMS (match existing tables)
   - Tags: match existing table tags

8. Read infra/lambdas.tf to understand existing Lambda patterns
9. Add approveAgentAction Lambda to infra/lambdas.tf following exact same pattern
   as existing Lambdas (runtime, role reference, env vars, etc.)

10. Read infra/apigateway.tf to understand existing route patterns
11. Add to the Agent API Gateway:
    POST /agent/v1/actions/{action_id}/approve
    POST /agent/v1/actions/{action_id}/reject
    Both protected by the existing x-api-key Lambda Authorizer

VERIFICATION BEFORE PR:
- terraform plan must show no errors and only additive changes (no replacements)
- terraform plan must NOT destroy or replace any existing resources
- Test the full flow manually:
  a. Send a message that triggers reviewDocumentVerification
  b. Confirm the response contains action_id and no write was executed
  c. Call /approve endpoint and confirm the write executes
  d. Check DynamoDB naleko-pending-actions for the audit record
- Confirm existing READ tool calls (getEmployee, getEmployees, etc.) are unaffected

ACCEPTANCE CRITERIA:
[ ] reviewDocumentVerification does NOT execute when Claude decides to call it
[ ] A pending_action record is written to naleko-pending-actions DynamoDB table
[ ] The AI response contains action_id and Claude's recommendation/reasoning
[ ] POST /approve executes the write and records approved_by: user_id
[ ] POST /reject records rejected_by: user_id, write is not executed
[ ] Expired actions (>24h) cannot be approved
[ ] Terraform plan is clean — no existing resources destroyed or replaced
[ ] All existing read tools continue to work normally
[ ] PR description references audit finding 4.7 and Q&A Finding #4
```

---

### NH-03 — Bedrock VPC Endpoint (Terraform)

**Type**: Security / Infrastructure  
**Priority**: Critical  
**Branch**: `feature/NH-03-bedrock-vpc-endpoint`  
**Estimated effort**: 1 day  
**AWS cost impact**: ~$7.68/month per AZ (VPC Interface Endpoint hourly rate ~$0.01/hr × 2 AZs + data transfer). At current Naleko scale: ~$15-16/month total.

---

#### Problem (from audit finding 4.2)

LLM traffic from `nalekoAiChat` Lambda to AWS Bedrock currently traverses the **public internet** even though both are within AWS `af-south-1`. Under POPIA, employee data must be processed within a controlled environment. Public internet routing means the data path is not under your direct control.

A VPC Interface Endpoint routes Bedrock traffic entirely within the AWS private network — never touching the public internet.

#### Claude instructions

```
You are adding a Bedrock VPC Interface Endpoint to the Naleko HR Portal Terraform
infrastructure to ensure LLM traffic never traverses the public internet.

CONTEXT:
- Region: af-south-1
- All Lambdas are in af-south-1
- The nalekoAiChat Lambda calls AWS Bedrock (bedrock-runtime service)
- Currently no VPC endpoint exists for Bedrock
- AWS service name for Bedrock runtime endpoint: com.amazonaws.af-south-1.bedrock-runtime

WHAT TO DO:
1. Read infra/provider.tf to confirm region and VPC/subnet configuration
2. Read infra/lambdas.tf to find the VPC config for nalekoAiChat Lambda
   (subnet IDs, security group IDs — the endpoint must be in the same VPC)
3. Read all infra/*.tf files to check if a VPC endpoint already exists for bedrock-runtime
   If it exists already — document this finding and close the task without changes
4. Read infra/variables.tf to understand vpc_id and subnet_id variable references

5. Add to infra/apigateway.tf or a new infra/vpc-endpoints.tf:
   resource "aws_vpc_endpoint" "bedrock_runtime" {
     vpc_id            = var.vpc_id  (use existing variable)
     service_name      = "com.amazonaws.af-south-1.bedrock-runtime"
     vpc_endpoint_type = "Interface"
     subnet_ids        = var.private_subnet_ids  (use existing variable)
     security_group_ids = [aws_security_group.lambda_sg.id]  (match existing SG)
     private_dns_enabled = true
     tags = {
       Name        = "naleko-bedrock-runtime-endpoint"
       Environment = var.environment
       Project     = "naleko"
     }
   }

6. Also add endpoint for bedrock (model management, not just runtime):
   service_name = "com.amazonaws.af-south-1.bedrock"

7. Ensure the nalekoAiChat Lambda security group allows HTTPS (443) outbound
   to the VPC endpoint security group — check existing security group rules

VERIFICATION BEFORE PR:
- terraform plan must show only additive changes (new endpoint resources only)
- terraform plan must NOT destroy or replace any existing Lambda, API GW, or DynamoDB resource
- Confirm aws_vpc_endpoint resource count goes from 0 → 2 (or 1 if bedrock already exists)
- After apply (if you have access): confirm endpoint shows Available state in console

ACCEPTANCE CRITERIA:
[ ] VPC Interface Endpoint for bedrock-runtime exists in af-south-1
[ ] private_dns_enabled = true (Lambda uses standard Bedrock SDK endpoint, no code change needed)
[ ] Endpoint is in the same VPC and subnets as the nalekoAiChat Lambda
[ ] Terraform plan is clean — no existing resources destroyed or replaced
[ ] Cost comment added in Terraform file: ~$0.01/hr per AZ + $0.01/GB data transfer
[ ] PR description references audit finding 4.2 and security finding (data residency)
```

---

## Epic 2 — Audit Store & Compliance
**Priority: HIGH | Timeline: Week 1–4 | Audit findings: 3.3, 2.2, 4.3**

---

### NH-04 — Aurora Serverless v2 PostgreSQL Audit Store (Terraform)

**Type**: Feature / Infrastructure  
**Priority**: High  
**Branch**: `feature/NH-04-aurora-audit-store`  
**Estimated effort**: 2 days (Terraform only — schema comes in NH-05)  
**AWS cost impact**: Aurora Serverless v2 minimum: ~$0.06/ACU-hour. At 0.5 ACU minimum (idle): ~$22/month. Under moderate AI query load: ~$30-50/month. Scales to zero after inactivity (Aurora Serverless v2 pauses). **Significantly cheaper than RDS always-on at this scale.**

---

#### Problem (from audit finding 2.2 / Anti-Pattern 8)

All AI prompt/response audit data currently goes to CloudWatch Logs. This violates Anti-Pattern 8 from the skill. POPIA requires 7-year queryable retention, data subject access requests must be answerable in seconds, and cost-per-query tracking is impossible in CloudWatch.

#### Solution

Deploy Aurora Serverless v2 PostgreSQL in `af-south-1` as the dedicated AI audit store. This is infrastructure only — the application write logic comes in NH-05.

#### Claude instructions

```
You are provisioning an Aurora Serverless v2 PostgreSQL cluster in af-south-1 for the
Naleko HR Portal AI audit store. This is a Terraform-only task. No Lambda code changes.

CONTEXT:
- Region: af-south-1
- Purpose: Store all AI prompt/response audit records (POPIA 7-year retention)
- Scale: Low write volume (1 write per AI query), low read volume (compliance queries)
- Aurora Serverless v2 is chosen because it scales to zero when idle (cost optimised)
- This cluster must be in the same VPC as the Lambdas (private subnets, no public access)

WHAT TO DO:
1. Read infra/provider.tf, infra/variables.tf, infra/config.tf for VPC/subnet/region references
2. Read all infra/*.tf to check if any RDS/Aurora resource already exists
3. Read infra/kms.tf to understand the KMS key pattern for encryption

4. Create infra/aurora.tf with:

   a. DB Subnet Group:
      resource "aws_db_subnet_group" "naleko_audit" {
        name       = "naleko-audit-${var.environment}"
        subnet_ids = var.private_subnet_ids
        tags = { Name = "naleko-audit-db-subnet-group", Project = "naleko" }
      }

   b. Security Group (Aurora — allow inbound 5432 from Lambda SG only):
      resource "aws_security_group" "aurora_audit" {
        name   = "naleko-aurora-audit-${var.environment}"
        vpc_id = var.vpc_id
        ingress {
          from_port       = 5432
          to_port         = 5432
          protocol        = "tcp"
          security_groups = [aws_security_group.lambda_sg.id]  # adjust to actual Lambda SG name
        }
        egress { from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"] }
        tags = { Name = "naleko-aurora-audit-sg", Project = "naleko" }
      }

   c. Aurora Cluster (Serverless v2):
      resource "aws_rds_cluster" "naleko_audit" {
        cluster_identifier      = "naleko-audit-${var.environment}"
        engine                  = "aurora-postgresql"
        engine_mode             = "provisioned"  # Serverless v2 uses provisioned mode
        engine_version          = "15.4"
        database_name           = "naleko_audit"
        master_username         = "naleko_admin"
        manage_master_user_password = true       # Secrets Manager managed password
        db_subnet_group_name    = aws_db_subnet_group.naleko_audit.name
        vpc_security_group_ids  = [aws_security_group.aurora_audit.id]
        storage_encrypted       = true
        kms_key_id              = aws_kms_key.naleko.arn  # use existing KMS key
        backup_retention_period = 7
        deletion_protection     = true
        skip_final_snapshot     = false
        final_snapshot_identifier = "naleko-audit-final-${var.environment}"
        serverlessv2_scaling_configuration {
          min_capacity = 0.5   # ~$0.06/ACU-hr × 0.5 = ~$0.03/hr when idle
          max_capacity = 4.0   # max 4 ACUs under heavy load (~$0.24/hr max)
        }
        tags = { Name = "naleko-audit-cluster", Project = "naleko", Environment = var.environment }
      }

   d. Aurora Instance (Serverless v2 requires at least one instance):
      resource "aws_rds_cluster_instance" "naleko_audit" {
        identifier         = "naleko-audit-instance-1-${var.environment}"
        cluster_identifier = aws_rds_cluster.naleko_audit.id
        instance_class     = "db.serverless"
        engine             = aws_rds_cluster.naleko_audit.engine
        engine_version     = aws_rds_cluster.naleko_audit.engine_version
      }

   e. Outputs (needed by NH-05):
      output "aurora_audit_cluster_endpoint" {
        value = aws_rds_cluster.naleko_audit.endpoint
      }
      output "aurora_audit_secret_arn" {
        value = aws_rds_cluster.naleko_audit.master_user_secret[0].secret_arn
      }

5. Update infra/iam_per_lambda.tf to grant nalekoAiChat Lambda:
   - secretsmanager:GetSecretValue on the aurora master_user_secret ARN
   (Data API is NOT used — Lambda will use standard pg connection via VPC)

6. Add a cost comment block at the top of infra/aurora.tf:
   # Aurora Serverless v2 Cost Estimate (af-south-1):
   # Min (idle): 0.5 ACU × $0.06/ACU-hr × 720hr = ~$22/month
   # Typical (moderate AI load): ~$30-50/month
   # Max (4 ACU sustained): 4 × $0.06 × 720 = ~$173/month (unlikely at current scale)
   # Storage: $0.10/GB-month (audit logs grow slowly)
   # Total estimated: $25-55/month depending on AI query volume

VERIFICATION BEFORE PR:
- terraform plan must show only additive resources (new Aurora cluster, SGs, subnet group)
- terraform plan must NOT destroy or replace any existing resources
- Confirm deletion_protection = true is set (cannot accidentally delete with terraform destroy)
- Confirm storage_encrypted = true and kms_key_id is set
- Confirm the cluster is in private subnets (no publicly_accessible = true)

ACCEPTANCE CRITERIA:
[ ] Aurora Serverless v2 cluster defined in Terraform with engine_version 15.x
[ ] Cluster is in private subnets, not publicly accessible
[ ] Encrypted with existing KMS key
[ ] manage_master_user_password = true (password in Secrets Manager, not hardcoded)
[ ] min_capacity = 0.5, max_capacity = 4.0 (cost-optimised scaling)
[ ] deletion_protection = true
[ ] Outputs: aurora_audit_cluster_endpoint, aurora_audit_secret_arn
[ ] Terraform plan is clean — no existing resources modified
[ ] Cost estimate comment in the Terraform file
[ ] PR description references audit finding 2.2 / Anti-Pattern 8
```

---

### NH-05 — agent_prompts Schema + Write from nalekoAiChat

**Type**: Feature  
**Priority**: High  
**Branch**: `feature/NH-05-agent-prompts-audit-write`  
**Estimated effort**: 3 days  
**AWS cost impact**: $0 additional beyond NH-04 (Aurora already provisioned)  
**Depends on**: NH-04 (Aurora must be deployed and endpoint available)

---

#### Claude instructions

```
You are implementing the agent_prompts PostgreSQL audit table and wiring the nalekoAiChat
Lambda to write every AI interaction to this table. This replaces CloudWatch as the
primary audit store for AI conversations.

CONTEXT:
- Aurora Serverless v2 is deployed (from NH-04). Get the endpoint from Terraform outputs
  or the environment variable AURORA_AUDIT_ENDPOINT
- The nalekoAiChat Lambda is Node.js (ESM modules, .mjs files)
- Every AI query must produce one row in agent_prompts, whether it used the LLM or not
- The Lambda runs in a VPC (private subnets) and can reach Aurora directly via pg driver
- Use the 'pg' npm package (node-postgres) for database connectivity
- DB credentials come from Secrets Manager (secret ARN from NH-04 output)

SCHEMA (create this exactly):
CREATE TABLE IF NOT EXISTS agent_prompts (
    prompt_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             VARCHAR(50)      NOT NULL,
    service_id          VARCHAR(100)     NOT NULL DEFAULT 'nalekoAiChat',
    prompt_text         TEXT             NOT NULL,
    response_text       TEXT,
    intent_type         VARCHAR(50),     -- 'ai_synthesis' for now; 'deterministic' after NH-09
    llm_model_used      VARCHAR(100),    -- NULL if deterministic path
    llm_tokens_input    INT,
    llm_tokens_output   INT,
    llm_cost_usd        DECIMAL(10, 6),  -- calculated from token counts
    response_time_ms    INT              NOT NULL,
    data_sources_queried TEXT[],
    error_details       JSONB,
    created_at          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    trace_id            VARCHAR(100)     NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_prompts_user_id    ON agent_prompts (user_id);
CREATE INDEX IF NOT EXISTS idx_agent_prompts_created_at ON agent_prompts (created_at);
CREATE INDEX IF NOT EXISTS idx_agent_prompts_trace_id   ON agent_prompts (trace_id);
CREATE INDEX IF NOT EXISTS idx_agent_prompts_intent     ON agent_prompts (intent_type);

WHAT TO DO:
1. Read lambda/nalekoAiChat/index.mjs completely
2. Read lambda/nalekoAiChat/package.json — note existing dependencies

3. Add 'pg' to lambda/nalekoAiChat/package.json dependencies
4. Create lambda/nalekoAiChat/audit-writer.mjs:
   - On module load: fetch Aurora credentials from Secrets Manager (cache in module scope)
   - Export async function writeAuditRecord(record) that:
     a. Gets a pg client from connection pool
     b. Inserts into agent_prompts
     c. Handles errors without throwing (audit failure must NOT fail the user request)
     d. Logs audit write success/failure to CloudWatch (CloudWatch remains for operational logs)
   - Use connection pooling (pg.Pool) with max: 2 connections (Lambda concurrency friendly)
   - Connection string built from: host=AURORA_ENDPOINT, database=naleko_audit,
     user from secret, password from secret, port=5432, ssl=require

5. In index.mjs, after the full agentic loop completes (just before returning the response):
   - Calculate response_time_ms (start timer at Lambda invocation start)
   - Collect data_sources_queried (array of tool names that were called)
   - Collect llm_tokens_input / llm_tokens_output from Bedrock response metadata
   - Calculate llm_cost_usd:
     Claude Haiku 4.5 pricing: input $0.80/1M tokens, output $4.00/1M tokens
     llm_cost_usd = (tokens_input / 1_000_000 * 0.80) + (tokens_output / 1_000_000 * 4.00)
   - Call writeAuditRecord({ user_id, prompt_text (sanitised), response_text (sanitised),
     intent_type: 'ai_synthesis', llm_model_used, llm_tokens_input, llm_tokens_output,
     llm_cost_usd, response_time_ms, data_sources_queried, trace_id })

6. Add AURORA_AUDIT_ENDPOINT and AURORA_AUDIT_SECRET_ARN to Lambda environment variables
   in infra/lambdas.tf (follow existing env var pattern for nalekoAiChat)
   Also grant the Lambda IAM role rds-data:ExecuteStatement on the cluster (if using Data API)
   OR ensure the Lambda SG can reach the Aurora SG on port 5432

7. Create a database initialisation script: lambda/nalekoAiChat/db-init.sql
   (contains the CREATE TABLE and CREATE INDEX statements above)
   Document in the PR how to run this once after NH-04 is deployed

COST TRACKING:
Add this comment in audit-writer.mjs:
// Claude Haiku 4.5 pricing used for llm_cost_usd calculation:
// Input:  $0.80 per 1M tokens
// Output: $4.00 per 1M tokens
// Update these constants if model or pricing changes

VERIFICATION BEFORE PR:
- Deploy to a test/dev environment and send one AI query
- Query Aurora: SELECT * FROM agent_prompts ORDER BY created_at DESC LIMIT 1;
- Confirm: user_id present, prompt_text is PII-sanitised, llm_cost_usd is not null,
  response_time_ms is realistic (>0), trace_id is present
- Simulate an Aurora connection failure — confirm the Lambda still returns a response
  to the user (audit failure is non-fatal, logged to CloudWatch)
- terraform plan must show no changes (env var additions handled in lambdas.tf)

ACCEPTANCE CRITERIA:
[ ] agent_prompts table exists in Aurora naleko_audit database with correct schema
[ ] Every AI query produces exactly one row in agent_prompts
[ ] llm_cost_usd is calculated and stored for every LLM invocation
[ ] prompt_text and response_text are PII-sanitised before storage (NH-01 handles this)
[ ] Aurora connection failure does NOT fail the user-facing Lambda response
[ ] data_sources_queried lists all tool names called in the agentic loop
[ ] trace_id is a UUID generated per Lambda invocation
[ ] PR description references audit finding 2.2 / Anti-Pattern 8 and POPIA compliance
```

---

### NH-06 — WAF on MCP Function URL

**Type**: Security / Infrastructure  
**Priority**: High  
**Branch**: `feature/NH-06-waf-mcp-function-url`  
**Estimated effort**: 1 day  
**AWS cost impact**: AWS WAF: $5/month (WebACL) + $1/month per rule + $0.60/million requests. At current scale: ~$8-10/month.

---

#### Claude instructions

```
You are adding AWS WAF protection to the Naleko MCP server Lambda Function URL.
The MCP server is currently exposed without WAF, making it vulnerable to DDoS and
prompt injection via malicious MCP clients.

CONTEXT:
- The nalekoMcpServer Lambda has a Function URL (Lambda URL, not API Gateway)
- Function URLs do not support API Gateway WAF directly — WAF for Function URLs
  requires CloudFront distribution in front of the Function URL
- This task adds CloudFront + WAF in front of the MCP Function URL

WHAT TO DO:
1. Read infra/lambdas.tf to find the nalekoMcpServer Lambda and its Function URL resource
2. Read infra/*.tf to check if CloudFront is already used anywhere

3. Add to infra/waf.tf (create this file):

   a. WAF WebACL (regional for API Gateway, or CLOUDFRONT scope for CloudFront):
      resource "aws_wafv2_web_acl" "mcp_waf" {
        name  = "naleko-mcp-waf-${var.environment}"
        scope = "CLOUDFRONT"  # Must be CLOUDFRONT scope for CloudFront distributions
        # Note: CLOUDFRONT scope WAF must be created in us-east-1 region
        provider = aws.us_east_1  # Add aws.us_east_1 provider alias

        default_action { allow {} }

        rule {
          name     = "RateLimitPerIP"
          priority = 1
          action { block {} }
          statement {
            rate_based_statement {
              limit              = 100  # 100 requests per 5-minute window per IP
              aggregate_key_type = "IP"
            }
          }
          visibility_config {
            cloudwatch_metrics_enabled = true
            metric_name                = "naleko-mcp-rate-limit"
            sampled_requests_enabled   = true
          }
        }

        rule {
          name     = "AWSManagedRulesCommonRuleSet"
          priority = 2
          override_action { none {} }
          statement {
            managed_rule_group_statement {
              name        = "AWSManagedRulesCommonRuleSet"
              vendor_name = "AWS"
            }
          }
          visibility_config {
            cloudwatch_metrics_enabled = true
            metric_name                = "naleko-mcp-common-rules"
            sampled_requests_enabled   = true
          }
        }

        visibility_config {
          cloudwatch_metrics_enabled = true
          metric_name                = "naleko-mcp-waf"
          sampled_requests_enabled   = true
        }

        tags = { Project = "naleko", Environment = var.environment }
      }

   b. Add provider alias in infra/provider.tf:
      provider "aws" {
        alias  = "us_east_1"
        region = "us-east-1"
      }

   c. CloudFront distribution in front of MCP Function URL:
      resource "aws_cloudfront_distribution" "mcp" {
        enabled = true
        origin {
          domain_name = "<extract domain from Lambda Function URL output>"
          origin_id   = "naleko-mcp-origin"
          custom_origin_config {
            http_port              = 80
            https_port             = 443
            origin_protocol_policy = "https-only"
            origin_ssl_protocols   = ["TLSv1.2"]
          }
        }
        default_cache_behavior {
          allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
          cached_methods         = ["GET", "HEAD"]
          target_origin_id       = "naleko-mcp-origin"
          viewer_protocol_policy = "redirect-to-https"
          cache_policy_id        = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"  # CachingDisabled policy
          origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # AllViewer policy
        }
        web_acl_id = aws_wafv2_web_acl.mcp_waf.arn
        restrictions { geo_restriction { restriction_type = "none" } }
        viewer_certificate { cloudfront_default_certificate = true }
        tags = { Project = "naleko", Environment = var.environment }
      }

4. Add cost comment:
   # WAF Cost: ~$5/month WebACL + $1/month per rule + $0.60/million requests
   # CloudFront: $0.0085/10K HTTPS requests (af-south-1 origin)
   # Total estimated: ~$10-15/month at current MCP usage

VERIFICATION BEFORE PR:
- terraform plan must show only additive resources
- terraform plan must NOT modify or replace the nalekoMcpServer Lambda or Function URL
- Confirm WAF WebACL scope = CLOUDFRONT and provider = aws.us_east_1

ACCEPTANCE CRITERIA:
[ ] WAF WebACL with rate limiting (100 req/5min/IP) protects MCP endpoint
[ ] AWS Managed Rules Common Rule Set applied
[ ] CloudFront distribution routes to MCP Function URL with HTTPS
[ ] WAF metrics visible in CloudWatch
[ ] Terraform plan is clean — existing Lambda/Function URL unchanged
[ ] Cost estimate comment in waf.tf
[ ] PR references security finding 5.2 (prompt injection) and 4.3 (MCP exposed without WAF)
```

---

## Epic 3 — LLM Gateway & Cost Controls
**Priority: HIGH | Timeline: Week 3–6 | Audit findings: 2.3, 2.4, 2.6**

---

### NH-07 — Portkey Lambda Proxy

**Type**: Feature / Infrastructure  
**Priority**: High  
**Branch**: `feature/NH-07-portkey-lambda-proxy`  
**Estimated effort**: 3 days  
**AWS cost impact**: Portkey OSS self-hosted on Lambda: $0 infrastructure cost (pay-per-invocation). Alternative: Portkey Cloud free tier (10k requests/month free, then $49/month). Recommend Lambda-hosted OSS for cost control.

---

#### Claude instructions

```
You are deploying Portkey (open-source LLM Gateway) as a Lambda function to sit between
nalekoAiChat and AWS Bedrock. Portkey provides: semantic caching, pre-LLM PII detection,
prompt injection blocking, per-user rate limiting, and cost tracking per query.

CONTEXT:
- Portkey OSS (https://github.com/Portkey-AI/gateway) can run as a Docker container
- For Lambda deployment, use the Portkey cloud gateway via their API (simpler for Lambda)
  OR deploy as a Lambda function proxy using the @portkey-ai/gateway npm package
- The nalekoAiChat Lambda (Node.js) will send requests to Portkey instead of Bedrock directly
- Portkey then forwards to Bedrock with all guardrails applied

ARCHITECTURE:
nalekoAiChat Lambda
    ↓ POST (OpenAI-compatible format)
Portkey Lambda (new) or Portkey Cloud endpoint
    ↓ (cache miss) POST to Bedrock
    ↑ response (or cached response)

WHAT TO DO — Option: Portkey Cloud (recommended for simplicity, free tier sufficient):

1. The Portkey Cloud free tier gives 10,000 requests/month free
   At current Naleko scale (< 200 AI queries/day = ~6,000/month) this is FREE
   Sign up at https://app.portkey.ai and get API key — store in Secrets Manager

2. Create lambda/portkey-config/portkey.json:
   {
     "virtual_key": "<bedrock-virtual-key-from-portkey>",
     "config": {
       "provider": "bedrock",
       "api_key": "<portkey-virtual-key>",
       "model": "anthropic.claude-haiku-4-5:0",
       "region_name": "af-south-1",
       "cache": {
         "mode": "semantic",
         "max_age": 3600
       },
       "retry": { "attempts": 2, "on_status_codes": [429, 500, 503] },
       "guardrails": [
         {
           "type": "detect_pii",
           "deny": true,
           "targets": ["request"],
           "categories": ["SA_ID", "PHONE_NUMBER", "CREDIT_CARD", "EMAIL"]
         },
         {
           "type": "detect_prompt_injection",
           "deny": true,
           "targets": ["request"]
         }
       ]
     }
   }

3. Modify lambda/nalekoAiChat/index.mjs:
   - Read PORTKEY_API_KEY from environment (fetched from Secrets Manager)
   - Read PORTKEY_VIRTUAL_KEY from environment
   - Replace direct Bedrock SDK call with Portkey API call:

   import Portkey from 'portkey-ai';
   const portkey = new Portkey({
     apiKey: process.env.PORTKEY_API_KEY,
     virtualKey: process.env.PORTKEY_VIRTUAL_KEY
   });

   const response = await portkey.chat.completions.create({
     messages: messages,
     model: 'anthropic.claude-haiku-4-5:0',
     max_tokens: 1024
   });

   - Extract token usage from response: response.usage.prompt_tokens, response.usage.completion_tokens
   - These numbers feed directly into NH-05 audit write (llm_tokens_input/output)

4. Store in Secrets Manager:
   - naleko/portkey/api-key
   - naleko/portkey/virtual-key
   (follow existing secret naming pattern from Secrets Manager)

5. Update infra/lambdas.tf for nalekoAiChat:
   - Add env vars: PORTKEY_API_KEY_SECRET_ARN, PORTKEY_VIRTUAL_KEY_SECRET_ARN
   - Add IAM: secretsmanager:GetSecretValue on the new secret ARNs

6. Add to lambda/nalekoAiChat/package.json: "portkey-ai": "^1.x"

7. Cost comment in config:
   # Portkey Cloud pricing:
   # Free tier: 10,000 requests/month (sufficient for current scale)
   # Paid: $49/month for 100k requests
   # Semantic cache saves ~50-70% of LLM calls -> reduces Bedrock costs proportionally

VERIFICATION BEFORE PR:
- Send a test query twice with identical content
- First call: cache miss (hits Bedrock) — check Portkey dashboard shows cache MISS
- Second call: cache hit — response time should be <100ms, no Bedrock invocation
- Send a query containing "9001015009087" in the message — confirm Portkey blocks it
- Check Portkey dashboard: token counts, cost per query, guardrail hits visible

ACCEPTANCE CRITERIA:
[ ] nalekoAiChat routes all LLM calls through Portkey (not direct Bedrock SDK)
[ ] Semantic caching active: identical query returns cached response on second call
[ ] Pre-LLM PII detection blocks requests containing SA ID numbers
[ ] Token counts (input/output) available from Portkey response for audit write (NH-05)
[ ] Portkey API key stored in Secrets Manager (not hardcoded)
[ ] No regression: AI queries still return correct responses
[ ] PR description references audit findings 2.4 (Portkey missing) and 5.1 (pre-LLM PII)
```

---

### NH-08 — LiteLLM Config + Route nalekoAiChat

**Type**: Feature  
**Priority**: High  
**Branch**: `feature/NH-08-litellm-abstraction`  
**Estimated effort**: 2 days  
**AWS cost impact**: $0 (library, no new infrastructure)  
**Depends on**: NH-07 (Portkey must be routing to Bedrock first)

---

#### Claude instructions

```
You are adding LiteLLM as the model abstraction layer in nalekoAiChat so that the
application code is never tied to a specific LLM provider or model ID. After this task,
switching from Bedrock to Azure OpenAI or changing the model is a config-file change
with zero code changes.

CONTEXT:
- The stack after NH-07: nalekoAiChat → Portkey → Bedrock
- LiteLLM sits between nalekoAiChat and Portkey
- For Node.js (nalekoAiChat is ESM .mjs), use the LiteLLM proxy server pattern:
  LiteLLM runs as a separate Lambda (HTTP proxy) that nalekoAiChat calls
- LiteLLM Lambda exposes an OpenAI-compatible /v1/chat/completions endpoint
- LiteLLM routes to Portkey (which routes to Bedrock)

ARCHITECTURE AFTER THIS TASK:
nalekoAiChat → [HTTP] → LiteLLM Lambda → [HTTP] → Portkey → Bedrock
                        (model: "claude-haiku" in config)

WHAT TO DO:
1. Read lambda/nalekoAiChat/index.mjs (understand current Portkey integration from NH-07)

2. Create lambda/litellmProxy/Dockerfile:
   FROM python:3.12-slim
   RUN pip install litellm[proxy]
   COPY config.yaml /app/config.yaml
   CMD ["litellm", "--config", "/app/config.yaml", "--port", "8080"]

3. Create lambda/litellmProxy/config.yaml:
   model_list:
     - model_name: claude-haiku
       litellm_params:
         model: openai/claude-haiku  # Routes to Portkey via OpenAI-compatible endpoint
         api_base: https://api.portkey.ai/v1
         api_key: os.environ/PORTKEY_API_KEY
         extra_headers:
           x-portkey-virtual-key: os.environ/PORTKEY_VIRTUAL_KEY

     - model_name: claude-haiku-fallback
       litellm_params:
         model: bedrock/anthropic.claude-haiku-4-5:0
         aws_region_name: eu-west-1  # fallback region direct to Bedrock

   router_settings:
     num_retries: 2
     timeout: 30
     fallbacks:
       - claude-haiku: [claude-haiku-fallback]

   litellm_settings:
     drop_params: true  # ignore unsupported params silently

4. Deploy LiteLLM as a Lambda container image:
   - Add to infra/lambdas.tf: litellmProxy Lambda using container image (ECR)
   - Add to infra/ an ECR repository for the litellm container
   - Function URL (internal, IAM auth) for nalekoAiChat to call

5. Update nalekoAiChat to call LiteLLM Lambda URL instead of Portkey directly:
   const response = await fetch(process.env.LITELLM_ENDPOINT + '/v1/chat/completions', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${litellmKey}` },
     body: JSON.stringify({ model: 'claude-haiku', messages, max_tokens: 1024 })
   });

6. Add LITELLM_ENDPOINT env var to nalekoAiChat in infra/lambdas.tf

VERIFICATION BEFORE PR:
- terraform plan clean (only additive: ECR repo, litellmProxy Lambda)
- Send a query through nalekoAiChat → confirm it traverses: nalekoAiChat → LiteLLM → Portkey → Bedrock
- Simulate Bedrock af-south-1 failure (change model to an invalid ID) → confirm fallback
  to claude-haiku-fallback (eu-west-1 direct) works automatically

ACCEPTANCE CRITERIA:
[ ] All LLM calls route: nalekoAiChat → LiteLLM → Portkey → Bedrock
[ ] Model ID "claude-haiku" in nalekoAiChat code — never "anthropic.claude-haiku-4-5:0"
[ ] Fallback to eu-west-1 works automatically on af-south-1 failure
[ ] No hardcoded provider strings in nalekoAiChat Lambda code
[ ] Terraform plan is clean — no existing resources modified
[ ] PR references audit finding 2.3 (LiteLLM missing) and Q&A Finding #6
```

---

### NH-09 — Intent Router in nalekoAiChat

**Type**: Feature  
**Priority**: High  
**Branch**: `feature/NH-09-intent-router`  
**Estimated effort**: 4 days  
**AWS cost impact**: Negative cost (reduces LLM spend by routing deterministic queries away from Claude — expected 40-60% reduction in Bedrock API calls at scale). Net saving: $20-100+/month depending on query volume.

---

#### Claude instructions

```
You are implementing an Intent Router in nalekoAiChat that classifies every incoming
query BEFORE deciding whether to invoke the LLM. Deterministic queries (simple lookups)
bypass Claude entirely and call the Agent API directly. Only queries requiring reasoning
invoke Claude. This is the single biggest cost optimisation in the audit plan.

CONTEXT:
- Current: every query → Claude (even "what stage is EMP-0000012?")
- Target: ~60% queries → direct Agent API call (no LLM) | ~40% queries → Claude
- The skill defines 5 intent levels:
  Level 1: Exact lookup ("what is the stage of EMP-0000012") → deterministic
  Level 2: Simple filter ("show me all employees in INVITED stage") → deterministic
  Level 3: Explanation ("why is this employee stuck") → LLM
  Level 4: Synthesis ("compare risk across the engineering team") → LLM
  Level 5: Action planning ("what should I do about this backlog") → LLM + HITL

DETERMINISTIC PATTERNS for Naleko HR domain:
- Employee lookup: "what is", "show me", "get", "find" + employee ID or name
- Stage queries: "what stage", "onboarding stage", "status of"
- List queries: "list all", "show all", "how many employees"
- Risk band: "risk band", "risk score", "what is the risk of"
- Document status: "document status", "verification status", "is the document"

LLM PATTERNS (must go to Claude):
- "why", "explain", "reason", "cause" → needs reasoning
- "compare", "analyse", "what's the pattern" → needs synthesis
- "what should I do", "recommend", "plan" → needs recommendation
- "summarise", "overview", "report" → needs generation
- Anything that doesn't match a deterministic pattern → default to LLM (safe fallback)

WHAT TO DO:
1. Read lambda/nalekoAiChat/index.mjs completely
2. Create lambda/nalekoAiChat/intent-router.mjs:

   const DETERMINISTIC_PATTERNS = [
     { pattern: /what\s+(?:is\s+the\s+)?(?:stage|status|risk)\s+(?:of\s+)?(?:emp-\d+)/i, level: 1 },
     { pattern: /(?:get|find|show|fetch)\s+(?:employee|emp)\s*(?:emp-\d+)/i, level: 1 },
     { pattern: /(?:list|show)\s+(?:all\s+)?employees/i, level: 2 },
     { pattern: /how\s+many\s+employees/i, level: 2 },
     { pattern: /(?:document|verification)\s+status/i, level: 1 },
     { pattern: /risk\s+(?:band|score|classification)\s+(?:for|of)/i, level: 1 },
   ];

   const LLM_REQUIRED_PATTERNS = [
     /\b(?:why|explain|reason|cause|because)\b/i,
     /\b(?:compare|analyse|analyze|pattern|trend)\b/i,
     /\b(?:recommend|suggest|what should|plan|strategy)\b/i,
     /\b(?:summarise|summarize|overview|report|summary)\b/i,
   ];

   export function classifyIntent(query) {
     // Check LLM-required patterns first (safety override)
     if (LLM_REQUIRED_PATTERNS.some(p => p.test(query))) {
       return { type: 'ai_synthesis', level: 3, confidence: 0.9 };
     }
     // Check deterministic patterns
     for (const { pattern, level } of DETERMINISTIC_PATTERNS) {
       if (pattern.test(query)) {
         return { type: 'deterministic', level, confidence: 0.95 };
       }
     }
     // Default: safe fallback to LLM for unclassified queries
     return { type: 'ai_synthesis', level: 3, confidence: 0.5 };
   }

3. For deterministic path: create lambda/nalekoAiChat/deterministic-handler.mjs
   - Takes the query + intent classification
   - Extracts entity identifiers (employee ID, etc.) using regex from the query
   - Calls the appropriate Agent API endpoint directly (without Claude)
   - Returns a structured (but human-readable) response
   - Example: "EMP-0000012 is in INVITED stage. Onboarding started 2026-05-01."

4. In index.mjs main handler:
   a. Classify the query using intent-router.mjs
   b. Log: { event: 'intent_classified', type, level, confidence, query_preview: query.slice(0,50) }
   c. If deterministic: call deterministic-handler → return response (no Claude invoked)
   d. If ai_synthesis: continue to existing Claude invocation flow
   e. In audit write (NH-05): set intent_type from the classification result

5. Add intent metrics to CloudWatch:
   - Emit custom metric: NalekoAI/IntentType with dimensions Deterministic/AISynthesis
   - This enables the skill's required 'deterministic_ratio' metric

VERIFICATION BEFORE PR:
- Test query: "What is the stage of EMP-0000012?"
  → Must NOT invoke Bedrock (check CloudWatch: no Bedrock invocations)
  → Must return correct stage from Agent API
  → Audit record in agent_prompts: intent_type = 'deterministic', llm_model_used = NULL
- Test query: "Why is EMP-0000012 stuck in the INVITED stage?"
  → MUST invoke Claude (intent_type = 'ai_synthesis')
- Test query: "Show me all employees" → deterministic
- Test query: "Analyse the risk pattern across the engineering team" → ai_synthesis
- Check CloudWatch custom metric NalekoAI/IntentType is emitting

ACCEPTANCE CRITERIA:
[ ] Simple lookup queries do NOT invoke Bedrock (verified via CloudWatch metrics)
[ ] Reasoning/synthesis queries still correctly invoke Claude
[ ] intent_type is recorded in agent_prompts for every query
[ ] CloudWatch custom metric NalekoAI/IntentType emitted per query
[ ] Unclassified queries default to ai_synthesis (safe fallback — never return blank)
[ ] No regression: all AI responses are still accurate
[ ] PR references audit Anti-Patterns 1 and 5, and Q&A Finding #1
```

---

## Epic 4 — Observability
**Priority: MEDIUM | Timeline: Week 5–6 | Depends on: NH-05, NH-07**

---

### NH-10 — OpenTelemetry GenAI Semantic Convention Spans

**Type**: Feature  
**Priority**: Medium  
**Branch**: `feature/NH-10-opentelemetry-genai-spans`  
**Estimated effort**: 3 days  
**AWS cost impact**: X-Ray traces: $5 per 1M traces recorded. At <1M/month: ~$0-5/month.

---

#### Claude instructions

```
You are adding OpenTelemetry instrumentation to nalekoAiChat with GenAI semantic
convention attributes. This makes every AI query traceable end-to-end and compatible
with any OTel-aware observability platform.

CONTEXT:
- Use @opentelemetry/sdk-node, @opentelemetry/auto-instrumentations-node
- Export to AWS X-Ray (already integrated with Lambda)
- Apply gen_ai.* attribute namespace on LLM invocation spans
- Span hierarchy to implement:
  api_gateway_receive → intent_classification → [context_gathering] → llm_invoke → audit_logging

KEY GenAI attributes (from skill §3.6):
  gen_ai.system = "aws.bedrock"
  gen_ai.request.model = "anthropic.claude-haiku-4-5:0"
  gen_ai.request.max_tokens = 1024
  gen_ai.usage.input_tokens = <from response>
  gen_ai.usage.output_tokens = <from response>
  gen_ai.usage.total_tokens = <sum>
  gen_ai.response.finish_reason = "end_turn"
  gen_ai.response.latency_ms = <measured>
  gen_ai.cache.hit = true/false  (from Portkey response header)

WHAT TO DO:
1. Add OTel packages to package.json:
   @opentelemetry/sdk-node, @opentelemetry/auto-instrumentations-node,
   @opentelemetry/exporter-trace-otlp-http, @aws-lambda-powertools/tracer (optional)

2. Create lambda/nalekoAiChat/telemetry.mjs — initialise OTel tracer
3. Wrap key operations in index.mjs with spans (use the attribute names above)
4. Add gen_ai.cache.hit by checking Portkey response header: x-portkey-cache-status

VERIFICATION BEFORE PR:
- Send a query, open AWS X-Ray console, find the trace
- Confirm gen_ai.* attributes are present on the llm_invoke span
- Confirm intent_classification span shows intent_type attribute

ACCEPTANCE CRITERIA:
[ ] Distributed trace visible in X-Ray for every AI query
[ ] gen_ai.usage.input_tokens and output_tokens on llm_invoke span
[ ] gen_ai.cache.hit correctly reflects Portkey cache status
[ ] intent_type attribute on intent_classification span
[ ] No regression in Lambda performance (OTel overhead < 20ms)
```

---

### NH-11 — Cost & Compliance Dashboard

**Type**: Feature  
**Priority**: Medium  
**Branch**: `feature/NH-11-cost-compliance-dashboard`  
**Estimated effort**: 2 days  
**AWS cost impact**: CloudWatch dashboards: $3/month per dashboard.  
**Depends on**: NH-05 (audit table must have data)

---

#### Claude instructions

```
You are creating a CloudWatch dashboard and cost alerting for Naleko AI queries.
This gives financial visibility into LLM spend and compliance query capabilities.

CONTEXT:
- Source data: agent_prompts Aurora table (from NH-05) + CloudWatch Lambda metrics
- Required metrics from skill §3.6: cost_per_query, deterministic_ratio,
  cache_hit_rate, error_rate, llm_latency_p95

WHAT TO DO:
1. Create infra/cloudwatch-dashboard.tf:
   - CloudWatch dashboard "Naleko-AI-Operations"
   - Widgets: Daily LLM cost (from custom metric), deterministic ratio,
     cache hit rate (Portkey), p95 latency, query volume, error rate

2. Create CloudWatch Alarms in infra/alarms.tf (or extend existing):
   - cost_spike: if daily LLM cost > 2× 7-day rolling average → SNS warning
   - error_rate_high: Lambda error rate > 5% for 5 minutes → SNS critical
   - cache_degradation: cache hit rate < 30% for 1 hour → SNS warning

3. Create a read-only Aurora view for compliance reporting:
   Create this SQL in a migration file:
   CREATE OR REPLACE VIEW v_daily_ai_cost AS
   SELECT DATE_TRUNC('day', created_at) AS day,
          SUM(llm_cost_usd) AS total_cost_usd,
          COUNT(*) AS total_queries,
          COUNT(*) FILTER (WHERE intent_type = 'ai_synthesis') AS llm_queries,
          COUNT(*) FILTER (WHERE intent_type = 'deterministic') AS deterministic_queries,
          ROUND(COUNT(*) FILTER (WHERE intent_type='deterministic')::DECIMAL /
                COUNT(*) * 100, 1) AS deterministic_ratio_pct
   FROM agent_prompts
   WHERE created_at >= NOW() - INTERVAL '90 days'
   GROUP BY day ORDER BY day DESC;

VERIFICATION: Dashboard visible in CloudWatch console with data after NH-05/NH-09 active.

ACCEPTANCE CRITERIA:
[ ] CloudWatch dashboard "Naleko-AI-Operations" exists with cost, ratio, latency widgets
[ ] Cost spike alarm fires correctly when threshold exceeded (test with mock metric)
[ ] v_daily_ai_cost view queryable in Aurora
[ ] PR references audit finding 2.5 (observability gap)
```

---

## Epic 5 — Resilience
**Priority: MEDIUM | Timeline: Week 5–8**

---

### NH-12 — DynamoDB Streams → S3 → Athena for AI Queries

**Type**: Feature / Infrastructure  
**Priority**: Medium  
**Branch**: `feature/NH-12-dynamodb-streams-athena`  
**Estimated effort**: 5 days  
**AWS cost impact**: DynamoDB Streams: $0.02 per 100k read request units. Kinesis/Lambda consumer: ~$5-10/month. S3: $0.023/GB-month. Athena: $5 per TB scanned. At Naleko scale: ~$10-20/month total. Eliminates AI query load from production DynamoDB.

---

#### Claude instructions

```
You are implementing a non-operational read path for AI queries: DynamoDB Streams →
Lambda consumer → S3 (Parquet) → Athena. This prevents AI agent queries from competing
with production HR Portal writes on the DynamoDB tables.

CONTEXT:
- Current: AI agent calls same production Lambdas/DynamoDB as the HR Portal frontend
- Target: AI agent queries Athena (5-min stale copy of DynamoDB), not production tables
- Tables to stream: naleko-employees, naleko-document-verifications, naleko-onboarding-risk
- The S3 landing zone stores snapshots as JSON (Parquet conversion is a future optimisation)

WHAT TO DO:
1. Read infra/dynamodb.tf to understand existing table definitions
2. Enable DynamoDB Streams on relevant tables (add stream_view_type = "NEW_AND_OLD_IMAGES")
3. Create lambda/dynamoStreamConsumer/index.mjs:
   - Triggered by DynamoDB Stream events
   - Writes records to S3: s3://naleko-ai-data-store/{table}/{year}/{month}/{day}/{timestamp}.json
4. Create Glue Data Catalog tables pointing to S3 paths (for Athena)
5. Create lambda/agentAthenaQuery/index.mjs — replacement for direct Agent API calls in AI path:
   - Executes Athena queries against the S3 data
   - Returns results to nalekoAiChat tool-resolver

COST NOTE in Terraform:
# DynamoDB Streams: $0.02/100k stream read RUs
# S3 storage: $0.023/GB-month (grows ~1MB/day at current scale → ~$0.03/month)
# Athena: $5/TB scanned (JSON, not Parquet — Parquet optimisation in future sprint)
# Total: ~$10-20/month, eliminates AI query impact on production DynamoDB

VERIFICATION: Query Athena for employees table — confirm data is <5 min stale.

ACCEPTANCE CRITERIA:
[ ] DynamoDB Streams enabled on naleko-employees and naleko-document-verifications
[ ] New records appear in S3 within 5 minutes of DynamoDB write
[ ] Athena can query employee data without touching production DynamoDB
[ ] PR references audit finding 2.1 / Anti-Pattern 2
```

---

### NH-13 — Secrets Manager 90-Day API Key Rotation

**Type**: Security  
**Priority**: Medium  
**Branch**: `feature/NH-13-api-key-rotation`  
**Estimated effort**: 2 days  
**AWS cost impact**: $0 (Secrets Manager rotation Lambda invocations are negligible — <$0.01/month)

---

#### Claude instructions

```
You are implementing automatic 90-day rotation for the Naleko agent API key stored in
Secrets Manager (naleko/agent/api-key). This prevents long-lived credentials from
becoming a security liability.

CONTEXT:
- Secret: naleko/agent/api-key (x-api-key for Agent API Gateway)
- Secrets Manager rotation requires a rotation Lambda
- Rotation Lambda: generates new API key, updates API Gateway usage plan,
  updates the secret, tests the new key
- 90-day rotation interval

WHAT TO DO:
1. Read infra/apigateway.tf to understand how the API key is currently created
2. Create lambda/rotateApiKey/index.mjs — rotation Lambda with 4 lifecycle steps:
   createSecret → setSecret → testSecret → finishSecret
3. Add rotation configuration to Secrets Manager resource in Terraform:
   rotation_rules { automatically_after_days = 90 }
4. Grant rotation Lambda: apigateway:CreateApiKey, apigateway:DeleteApiKey,
   secretsmanager:GetSecretValue, secretsmanager:PutSecretValue

VERIFICATION: Trigger a manual rotation in Secrets Manager console — confirm new key
is generated and the Lambda Authorizer accepts the new key.

ACCEPTANCE CRITERIA:
[ ] Rotation Lambda implements all 4 Secrets Manager rotation lifecycle steps
[ ] Rotation set to every 90 days
[ ] After rotation, Agent API still accepts requests (new key active)
[ ] Old key is deactivated after rotation
[ ] PR references audit security finding 5.4 and Pillar 1 compliance gap
```

---

## Projected Compliance Score After All Epics

| Pillar | Before | After Epic 1 | After Epic 2 | After Epic 3 | Final |
|--------|--------|-------------|-------------|-------------|-------|
| Pillar 1 (Dual Auth) | 9/10 | 9/10 | 10/10 | 10/10 | **10/10** |
| Pillar 2 (Non-Op DB) | 2/10 | 2/10 | 2/10 | 2/10 → NH-12 | **8/10** |
| Pillar 3 (Audit Store) | 2/10 | 2/10 | 9/10 | 9/10 | **9/10** |
| Pillar 4 (Observability) | 4/10 | 4/10 | 4/10 | 8/10 | **8/10** |
| Pillar 5 (LiteLLM) | 0/10 | 0/10 | 0/10 | 8/10 | **8/10** |
| Pillar 6 (Portkey) | 0/10 | 0/10 | 0/10 | 9/10 | **9/10** |
| Pillar 7 (Bedrock) | 9/10 | 10/10 | 10/10 | 10/10 | **10/10** |
| Pillar 8 (MCP) | 8/10 | 8/10 | 9/10 | 9/10 | **9/10** |
| Pillar 9 (ADK) | 5/10 | 8/10 | 8/10 | 9/10 | **9/10** |
| Anti-Patterns (8) | 3/8 | 5/8 | 6/8 | 8/8 | **8/8** |
| Security (12) | 6/12 | 9/12 | 10/12 | 12/12 | **12/12** |
| Cost Controls (7) | 1/7 | 1/7 | 2/7 | 7/7 | **7/7** |
| **TOTAL** | **49/120 (41%)** | **68/120 (57%)** | **79/120 (66%)** | **101/120 (84%)** | **~100/120 (83%)** |

**Target achieved: 83% compliance (up from 41%)**

---

## AWS Monthly Cost Summary

| Component | Monthly Cost | Task |
|-----------|-------------|------|
| Aurora Serverless v2 (audit store, af-south-1) | ~$25-50 | NH-04 |
| VPC Endpoint for Bedrock (2 AZs) | ~$15-16 | NH-03 |
| WAF WebACL + CloudFront (MCP protection) | ~$10-15 | NH-06 |
| Portkey Cloud (free tier at current scale) | **$0** (10k req/month free) | NH-07 |
| LiteLLM Lambda container (pay-per-invocation) | ~$1-3 | NH-08 |
| DynamoDB Streams → S3 → Athena | ~$10-20 | NH-12 |
| CloudWatch Dashboard (1 dashboard) | ~$3 | NH-11 |
| X-Ray traces (< 1M/month) | ~$0-5 | NH-10 |
| Secrets Manager rotation (negligible) | ~$0 | NH-13 |
| **Total additional monthly cost** | **~$64-112/month** | All |
| **LLM cost reduction from caching + intent router** | **~$20-100/month saved** | NH-07, NH-09 |
| **Net additional cost** | **~$44-72/month** | |

*The intent router (NH-09) and Portkey semantic cache (NH-07) are expected to reduce Bedrock spend by 40-70%, partially or fully offsetting the infrastructure additions.*

---

*Plan version 1.0 — 10 May 2026. Based on ENTERPRISE-AI-AUDIT.md and Q&A session findings.*
