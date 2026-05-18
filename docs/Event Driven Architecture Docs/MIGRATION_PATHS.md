# Migration Paths - POC to Enterprise

> **Purpose**: Define evolution path from POC to production-grade enterprise platform
> **Audience**: Solution Architects, Technical Leadership
> **Status**: v1.0 - Strategic Planning

---

## Executive Summary

This document outlines the migration strategy from **Maturity Level 0 (POC)** → **Level 1 (Production)** → **Level 2 (Intelligence)** → **Level 3 (Agentic AI)**.

**Key Principle**: Incremental evolution, not big-bang rewrites.

---

## Maturity Level Overview

| Level | Name | Scale | Cost | Capabilities |
|-------|------|-------|------|--------------|
| **0** | POC | 10 candidates/month | <$50/month | Core workflows, basic monitoring |
| **1** | Production | 100 candidates/month | $200-300/month | Multi-tenant, high availability, compliance |
| **2** | Intelligence | 500 candidates/month | $800-1200/month | AI insights, sentiment analysis, predictive scoring |
| **3** | Enterprise + Agentic | 2000+ candidates/month | $3000-5000/month | Agentic AI automation, multi-region, advanced analytics |

---

## Migration 1: Level 0 (POC) → Level 1 (Production)

### Trigger Conditions
- ✅ POC successfully processed 10+ candidates
- ✅ 1 department validated system
- ✅ 2 managers actively using platform
- ✅ No critical bugs in 2 weeks
- ✅ Stakeholder approval for production deployment

### What Changes

#### 1. Infrastructure

| Component | POC (Level 0) | Production (Level 1) | Why? |
|-----------|--------------|---------------------|------|
| **DynamoDB** | PAY_PER_REQUEST | PROVISIONED with auto-scaling | Predictable costs at scale |
| **DynamoDB Backup** | None | Point-in-time recovery enabled | Data protection |
| **Lambda** | Best-effort concurrency | Reserved concurrency for critical functions | Reliability |
| **EventBridge** | No archive | 30-day event archive enabled | Debugging, compliance |
| **CloudWatch Logs** | 7-day retention | 90-day retention | Compliance, debugging |
| **API Gateway** | None (direct Lambda invoke) | REST API with custom domain | Security, rate limiting |
| **Authentication** | None | Cognito user pools | User management |
| **Monitoring** | Basic CloudWatch | Custom dashboards + X-Ray tracing | Observability |
| **Alerting** | None | SNS → PagerDuty for critical alerts | Incident response |
| **Multi-Region** | Single region | Single region (disaster recovery plan) | Same for Level 1 |

**Terraform Changes**:
```hcl
# Level 0 (POC)
resource "aws_dynamodb_table" "state" {
  billing_mode = "PAY_PER_REQUEST"
  # No point-in-time recovery
}

# Level 1 (Production)
resource "aws_dynamodb_table" "state" {
  billing_mode   = "PROVISIONED"
  read_capacity  = 10
  write_capacity = 5

  autoscaling_read {
    min_capacity = 5
    max_capacity = 100
    target_value = 70  # Scale at 70% utilization
  }

  autoscaling_write {
    min_capacity = 5
    max_capacity = 100
    target_value = 70
  }

  point_in_time_recovery {
    enabled = true
  }
}
```

---

#### 2. Security

| Component | POC (Level 0) | Production (Level 1) | Why? |
|-----------|--------------|---------------------|------|
| **API Authentication** | None | Cognito JWT tokens | Secure access |
| **IAM Policies** | Permissive (account-level) | Least privilege (resource-specific ARNs) | Security best practice |
| **Encryption** | At-rest (default KMS) | At-rest + in-transit (custom KMS keys) | Compliance |
| **Secrets Management** | Environment variables | AWS Secrets Manager | Secure credential rotation |
| **VPC** | None (public Lambda) | Private subnets + NAT gateway | Network isolation |
| **WAF** | None | WAF on API Gateway | DDoS protection |

**New Components**:
- Amazon Cognito User Pools (user authentication)
- AWS Secrets Manager (API keys, SMTP passwords)
- VPC with private subnets (Lambda execution)
- AWS WAF (API Gateway protection)

**Cost Impact**: +$100-150/month (mostly VPC NAT gateway)

---

#### 3. Observability

| Component | POC (Level 0) | Production (Level 1) | Why? |
|-----------|--------------|---------------------|------|
| **Distributed Tracing** | None | X-Ray enabled on all Lambdas | Debug latency issues |
| **Custom Metrics** | None | CloudWatch custom metrics (business KPIs) | Business insights |
| **Dashboards** | None | CloudWatch dashboard (SLA, errors, latency) | Operational visibility |
| **Alarms** | None | 15+ CloudWatch alarms | Proactive alerting |
| **Log Aggregation** | CloudWatch Logs | CloudWatch Logs Insights queries | Faster debugging |

**New CloudWatch Alarms**:
- Lambda error rate >5%
- DynamoDB throttling events
- API Gateway 5xx errors >10/min
- SLA breach rate >10%
- EventBridge delivery failures

**Cost Impact**: +$20-30/month (custom metrics, alarms)

---

#### 4. Multi-Tenancy

**POC**: Single tenant (1 department)
**Production**: Multi-tenant (5-10 departments)

**Changes Required**:
- Add `tenantId` to all DynamoDB records
- Add `tenantId` filter to all queries
- Implement tenant-based IAM policies
- Add tenant context to all events

**DynamoDB Schema Change**:
```javascript
// POC
{
  PK: 'CANDIDATE#CAND-123',
  SK: 'METADATA',
  candidateId: 'CAND-123',
  ...
}

// Production
{
  PK: 'TENANT#DEPT-ENG#CANDIDATE#CAND-123',
  SK: 'METADATA',
  tenantId: 'DEPT-ENG',
  candidateId: 'CAND-123',
  ...
}
```

**Migration Strategy**:
1. Add `tenantId` column to existing records (backfill script)
2. Update all Lambda functions to include `tenantId` in queries
3. Add GSI for tenant-based queries
4. Test with 2 tenants (parallel deployment)
5. Migrate all departments incrementally

**Cost Impact**: Minimal (same query patterns)

---

#### 5. Compliance & Audit

**New Requirements**:
- GDPR compliance (data retention, deletion)
- SOC 2 compliance (audit logs, access controls)
- HIPAA compliance (if healthcare clients)

**Changes**:
- Event ledger: Immutable audit log (no deletions)
- Data retention policy: Auto-delete PII after 2 years (DynamoDB TTL)
- Access logs: CloudTrail enabled (all API calls)
- Encryption: FIPS 140-2 compliant KMS keys

**Cost Impact**: +$30-50/month (CloudTrail, KMS)

---

### Migration Execution Plan

#### Phase 1: Preparation (Week 1)
- [ ] Create production AWS account (separate from POC)
- [ ] Set up Terraform backend (S3 + DynamoDB state locking)
- [ ] Configure Cognito user pools
- [ ] Set up VPC (private subnets, NAT gateway, security groups)
- [ ] Create custom KMS keys

#### Phase 2: Infrastructure Deployment (Week 2)
- [ ] Deploy production infrastructure (Terraform)
- [ ] Deploy Lambda functions (blue/green deployment)
- [ ] Configure API Gateway (custom domain, WAF)
- [ ] Set up CloudWatch dashboards + alarms
- [ ] Enable X-Ray tracing

#### Phase 3: Data Migration (Week 3)
- [ ] Export POC data from DynamoDB
- [ ] Add `tenantId` to all records (backfill script)
- [ ] Import data to production DynamoDB
- [ ] Validate data integrity (checksum comparison)
- [ ] Test queries with multi-tenant data

#### Phase 4: Cutover (Week 4)
- [ ] Parallel run (POC + Production for 1 week)
- [ ] Compare results (event counts, SLA metrics)
- [ ] Redirect traffic to production (DNS update)
- [ ] Monitor for 48 hours (rollback plan ready)
- [ ] Decommission POC environment

**Rollback Plan**:
- If critical issues detected within 48 hours
- Revert DNS to POC environment
- Root cause analysis
- Fix issues, retry cutover

---

## Migration 2: Level 1 (Production) → Level 2 (Intelligence Layer)

### Trigger Conditions
- ✅ Processing 100+ candidates/month
- ✅ 5+ departments using system
- ✅ <0.1% error rate for 3 months
- ✅ Business requests AI-powered insights
- ✅ Budget approved for AI features ($800-1200/month)

### What Changes

#### 1. AI/ML Components (New)

| Feature | Implementation | AWS Service | Cost Impact |
|---------|---------------|-------------|-------------|
| **Sentiment Analysis** | Analyze interview feedback text | Amazon Comprehend | $0.0001/unit |
| **Resume Parsing** | Extract skills, experience from resumes | Amazon Textract + Comprehend | $0.001/page |
| **Predictive Scoring** | Predict candidate success likelihood | SageMaker (hosted model) | $50-100/month |
| **Engagement Recommendations** | AI-generated follow-up suggestions | Bedrock (Claude API) | $0.002/1K tokens |
| **Interview Question Generation** | Auto-generate role-specific questions | Bedrock (Claude API) | $0.002/1K tokens |

**New Lambda Functions**:
- `sentiment-analyzer` (triggered by VoteSubmitted event)
- `resume-parser` (triggered by CandidateCreated event)
- `predictive-scorer` (triggered by EvaluationCompleted event)
- `engagement-recommender` (triggered by SLABreached event)

**Architecture Addition**:
```
EventBridge (existing events)
    ↓
Lambda: sentiment-analyzer
    ↓
Amazon Comprehend API
    ↓
DynamoDB (store sentiment scores)
    ↓
EventBridge: SentimentAnalyzed event
```

**Cost Impact**: +$400-600/month (AI API calls)

---

#### 2. Data Lake (Analytics)

**POC/Level 1**: All data in DynamoDB
**Level 2**: DynamoDB + S3 Data Lake + Athena

**Why?**
- Complex analytics queries (not suitable for DynamoDB)
- Historical trend analysis (multi-year data)
- BI tool integration (Tableau, PowerBI)

**Architecture**:
```
DynamoDB Streams
    ↓
Lambda: stream-processor
    ↓
S3 Data Lake (Parquet format, partitioned by year/month)
    ↓
AWS Glue Crawler (schema discovery)
    ↓
Athena (SQL queries)
    ↓
QuickSight Dashboard
```

**Cost Impact**: +$100-150/month (S3 storage, Glue, Athena queries)

---

#### 3. Real-Time Dashboards

**Level 1**: Static reports (generated daily)
**Level 2**: Real-time dashboards (WebSocket updates)

**Implementation**:
- EventBridge → Lambda → API Gateway WebSocket → Frontend
- Real-time candidate status updates
- Live SLA monitoring dashboard
- Real-time evaluation scoring

**Cost Impact**: +$50-80/month (API Gateway WebSocket connections)

---

### Migration Execution Plan

#### Phase 1: AI Feature POC (Month 1)
- [ ] Deploy sentiment-analyzer Lambda
- [ ] Test Amazon Comprehend integration
- [ ] Validate sentiment scores (manual review)
- [ ] Deploy to 1 department (pilot)

#### Phase 2: Data Lake Setup (Month 2)
- [ ] Configure DynamoDB Streams
- [ ] Deploy stream-processor Lambda
- [ ] Set up S3 Data Lake (partitioned structure)
- [ ] Configure AWS Glue Crawler
- [ ] Create Athena queries for common analytics

#### Phase 3: Dashboard Development (Month 3)
- [ ] Build QuickSight dashboards (or custom Angular dashboards)
- [ ] Implement WebSocket real-time updates
- [ ] Deploy to all departments

#### Phase 4: Full Rollout (Month 4)
- [ ] Enable all AI features for all departments
- [ ] Train users on new AI capabilities
- [ ] Monitor AI API costs (adjust if needed)
- [ ] Collect feedback, iterate

---

## Migration 3: Level 2 (Intelligence) → Level 3 (Agentic AI)

### Trigger Conditions
- ✅ Processing 500+ candidates/month
- ✅ 20+ departments using system
- ✅ AI features proven valuable (user satisfaction >80%)
- ✅ Business requests autonomous automation
- ✅ Budget approved ($3000-5000/month)

### What Changes

#### 1. Agentic AI Automation

**Level 2**: AI provides insights, humans make decisions
**Level 3**: AI agents autonomously execute workflows

**AI Agents**:
1. **Recruiter Agent**
   - Autonomously sources candidates (LinkedIn, Indeed)
   - Screens resumes (accept/reject)
   - Schedules interviews (finds optimal times)
   - Sends personalized outreach messages

2. **Interview Agent**
   - Conducts preliminary phone screens (AI voice)
   - Asks follow-up questions based on resume
   - Scores responses in real-time
   - Escalates to human if uncertainty >20%

3. **Offer Negotiation Agent**
   - Autonomously negotiates salary (within bounds)
   - Handles candidate questions (benefits, PTO)
   - Escalates to hiring manager if needed

**Implementation**:
- Amazon Bedrock Agents framework
- Claude 3.5 Sonnet (reasoning model)
- Custom tools (DynamoDB queries, calendar APIs)
- Human-in-the-loop approval gates

**Cost Impact**: +$1500-2500/month (AI API calls, voice synthesis)

---

#### 2. Multi-Region Deployment

**Level 1-2**: Single region (us-east-1)
**Level 3**: Multi-region (us-east-1, eu-west-1, ap-southeast-1)

**Why?**
- Global expansion (international hiring)
- Low latency for global users
- Disaster recovery (active-active)

**Architecture**:
- DynamoDB Global Tables (multi-region replication)
- EventBridge cross-region replication
- Route 53 geo-routing (API Gateway)
- S3 cross-region replication (documents, resumes)

**Cost Impact**: +$800-1200/month (data transfer, replication)

---

#### 3. Advanced Analytics

**New Capabilities**:
- Predictive attrition risk (which candidates likely to leave)
- Diversity analytics (bias detection in hiring)
- Market benchmarking (salary, time-to-hire comparisons)
- Machine learning model training (custom models)

**Implementation**:
- SageMaker training jobs (weekly retraining)
- SageMaker endpoints (hosted models)
- Custom ML pipeline (MLOps)

**Cost Impact**: +$300-500/month (SageMaker instances)

---

### Migration Execution Plan

#### Phase 1: Agentic AI POC (Months 1-2)
- [ ] Build Recruiter Agent POC
- [ ] Test on 10 candidates (shadow mode)
- [ ] Validate accuracy (precision, recall)
- [ ] Get stakeholder approval

#### Phase 2: Multi-Region Setup (Months 3-4)
- [ ] Deploy infrastructure to eu-west-1
- [ ] Configure DynamoDB Global Tables
- [ ] Test cross-region replication
- [ ] Cutover EU users to eu-west-1

#### Phase 3: Full Agentic Rollout (Months 5-6)
- [ ] Deploy all 3 AI agents
- [ ] Train users on agentic workflows
- [ ] Monitor agent decisions (audit log)
- [ ] Tune agent confidence thresholds

---

## Cost Comparison Across Levels

| Service | Level 0 (POC) | Level 1 (Production) | Level 2 (Intelligence) | Level 3 (Agentic) |
|---------|--------------|---------------------|----------------------|------------------|
| **Lambda** | $5 | $30 | $50 | $80 |
| **DynamoDB** | $15 | $80 | $120 | $200 |
| **EventBridge** | $2 | $10 | $15 | $30 |
| **S3** | $1 | $5 | $20 | $50 |
| **API Gateway** | $0 | $20 | $30 | $60 |
| **Cognito** | $0 | $10 | $15 | $30 |
| **VPC (NAT)** | $0 | $50 | $50 | $100 (multi-region) |
| **CloudWatch** | $5 | $30 | $50 | $80 |
| **AI Services** | $0 | $0 | $500 | $2000 |
| **SageMaker** | $0 | $0 | $0 | $400 |
| **Data Transfer** | $1 | $10 | $30 | $200 (multi-region) |
| **Other** | $1 | $20 | $50 | $100 |
| **TOTAL** | **$30-50** | **$265** | **$930** | **$3330** |

---

## Risk Mitigation Across Migrations

### Risk 1: Data Loss During Migration
**Mitigation**:
- Full backup before migration (DynamoDB export to S3)
- Parallel run (old + new for 1-2 weeks)
- Checksum validation (data integrity)
- Rollback plan (revert to previous environment)

### Risk 2: Performance Degradation
**Mitigation**:
- Load testing before cutover (simulate 10x traffic)
- Auto-scaling configured (DynamoDB, Lambda)
- Canary deployments (5% → 25% → 100%)
- Rollback triggers (error rate >5%)

### Risk 3: Cost Overruns
**Mitigation**:
- AWS Cost Explorer alerts (daily budget checks)
- Reserved capacity for predictable workloads (Level 1+)
- Cost optimization reviews (monthly)
- Kill switches for expensive AI features (if budget exceeded)

### Risk 4: AI Hallucinations/Errors
**Mitigation**:
- Human-in-the-loop for critical decisions
- Confidence thresholds (escalate if <80% confidence)
- Audit log for all AI decisions
- Monthly accuracy reviews (precision, recall)

---

## Key Takeaways

1. **Incremental Evolution**: Each maturity level builds on the previous, no rewrites
2. **Validate Before Scaling**: Prove value at each level before investing in next
3. **Cost-Aware**: Understand cost implications of each migration
4. **Rollback Plans**: Every migration has a rollback strategy
5. **User Training**: Don't underestimate change management

---

## Next Steps

1. ✅ Review migration paths
2. ⏸️ Complete POC (Maturity Level 0)
3. ⏸️ Validate POC success criteria (10 candidates, 1 dept, 2 managers)
4. ⏸️ Get stakeholder approval for Level 1 migration
5. ⏸️ Begin Level 1 migration planning

---

**End of Migration Paths Document**

---
---

## 🆕 v2.0 Addendum: Metadata-Lite Migration Impact

> **Added**: 2026-05-15
> **Document Version**: 2.0
> **Context**: MVP1 evolved to Metadata-Lite architecture (externalized Variable Six)
> **See**: MVP1-FOUNDATION-PLAN-v2.md, PROJECT_CONTEXT.md (Session Checkpoint 2026-05-15)

---

### What Changed in v2.0

**v1.0 Migration Paths**: Focused on infrastructure scaling (DynamoDB, Lambda, EventBridge)

**v2.0 Migration Paths**: Added **config management evolution** as a cross-cutting migration concern

**Key Insight**: Config management matures across all levels (Level 0 → Level 3), enabling faster vertical expansion at each level.

---

### Updated Migration 1: Level 0 (POC) → Level 1 (Production)

#### New Config Management Migrations (v2.0)

**v1.0**: No config management changes (configs hardcoded)

**v2.0**: Config management enhancements for production

| Component | Level 0 (POC) | Level 1 (Production) | Migration Effort |
|-----------|--------------|---------------------|------------------|
| **Config UI** | 3 of 6 Variable Six | **6 of 6 Variable Six** (+3 pages) | 2 weeks |
| **Tenant Isolation** | Single tenant (DEFAULT) | **Multi-tenant** (tenant selection in UI) | 1 week |
| **Config Import/Export** | None | **Bulk config via JSON upload** | 1 week |
| **Config Comparison** | None | **Side-by-side tenant config diff** | 3 days |
| **Role-Based Access** | All admins see all configs | **Tenant admins see only their configs** | 3 days |
| **Config Backup** | No backup | **Point-in-time recovery on config table** | 1 day (Terraform) |

**Total Migration Effort**: 4 weeks (vs 0 weeks in v1.0)

**Why Worth It**: Enables 2nd vertical launch (Banking/Agriculture) in 1 day vs 2-3 weeks.

---

#### Updated Infrastructure Changes (v2.0)

**v1.0 Changes** (all preserved):
- DynamoDB: PAY_PER_REQUEST → PROVISIONED with auto-scaling
- Lambda: Reserved concurrency for critical functions
- EventBridge: 30-day archive enabled
- CloudWatch: 90-day log retention

**v2.0 Additions**:
- **Config Table**: Enable point-in-time recovery (PITR)
- **Config Manager Lambda**: Increase memory 256 MB → 512 MB (handles more tenants)
- **Multi-Tenant IAM**: Add tenant-based access control policies

**Terraform Example** (config table PITR):
```hcl
# Level 0 (POC)
resource "aws_dynamodb_table" "config" {
  table_name   = "talent-flow-config"
  billing_mode = "PAY_PER_REQUEST"
  # No PITR
}

# Level 1 (Production)
resource "aws_dynamodb_table" "config" {
  table_name   = "talent-flow-config"
  billing_mode = "PROVISIONED"
  read_capacity  = 5
  write_capacity = 2

  autoscaling_read {
    min_capacity = 5
    max_capacity = 50
    target_value = 70
  }

  point_in_time_recovery {
    enabled = true  # NEW: Disaster recovery for config
  }

  tags = {
    Environment = "production"
    CriticalData = "true"  # Config changes affect business logic
  }
}
```

**Cost Impact**: +$1/month (PITR for config table)

---

#### Updated Migration Timeline (v2.0)

**v1.0 Timeline**: 2-3 weeks (infrastructure scaling only)

**v2.0 Timeline**: **6-7 weeks** (infrastructure + config management)

**Breakdown**:
- Week 1-2: Infrastructure scaling (DynamoDB, Lambda, EventBridge) — same as v1.0
- Week 3-4: Build remaining 3 config UIs (approval rules, notification templates, stage enablement)
- Week 5: Multi-tenancy implementation (tenant selection, isolation)
- Week 6: Config import/export + comparison tools
- Week 7: Testing, rollback plan, documentation

**Why Longer**: Config management UI takes time to build (6 pages total, 3 new in Level 1).

---

### Updated Migration 2: Level 1 (Production) → Level 2 (Intelligence)

#### New Config Management Migrations (v2.0)

**v1.0**: No config management changes

**v2.0**: AI-enhanced config management

| Component | Level 1 (Production) | Level 2 (Intelligence) | Migration Effort |
|-----------|---------------------|------------------------|------------------|
| **AI Config Assistant** | None | **Natural language config changes** | 2 weeks |
| **Config Anomaly Detection** | None | **AI flags unusual config changes** | 1 week |
| **Config Recommendations** | None | **AI suggests optimizations** | 1 week |
| **One-Click Rollback** | Manual (CLI) | **UI button to revert to previous version** | 3 days |

**Total Migration Effort**: 4 weeks

**Why Worth It**: Admin changes config in 30 seconds ("Change SLA to 24h") vs 5 minutes (manual form fill).

---

#### AI Config Assistant Architecture (NEW in v2.0)

```
User (Admin UI)
    ↓
"Change SLA to 24 hours for first engagement"
    ↓
Lambda: ai-config-parser (LangChain + Claude API)
    ↓
Parse intent: { configType: 'SLA_THRESHOLDS', field: 'FIRST_ENGAGEMENT', newValue: 24 }
    ↓
Validate: Current value = 48h, new value = 24h (50% reduction)
    ↓
AI Anomaly Check: "Warning: This is a 50% reduction. Confirm?"
    ↓
User confirms
    ↓
Lambda: config-manager (existing)
    ↓
DynamoDB: talent-flow-config (creates v5, marks v4 inactive)
    ↓
Success: "SLA updated to 24h (version 5). Changes take effect in 5 minutes."
```

**Cost**: +$50/month (LLM API calls for config parsing)

**Benefit**: 10x faster config changes (30 seconds vs 5 minutes)

---

### Updated Migration 3: Level 2 (Intelligence) → Level 3 (Enterprise)

#### New Config Management Migrations (v2.0)

**v1.0**: No config management changes

**v2.0**: Enterprise governance for config

| Component | Level 2 (Intelligence) | Level 3 (Enterprise) | Migration Effort |
|-----------|------------------------|----------------------|------------------|
| **Config Approval Workflow** | None | **C-level approval for critical changes** | 2 weeks |
| **Config Compliance Checks** | None | **Automated validation against regulations** | 2 weeks |
| **Config Audit Reports** | Manual query | **One-click compliance report generation** | 1 week |
| **Config Disaster Recovery** | PITR (manual restore) | **Automated backup + cross-region replication** | 1 week |
| **Config Performance Analytics** | None | **Track config impact on business metrics** | 2 weeks |

**Total Migration Effort**: 8 weeks

**Why Worth It**: Enterprise compliance (SOX, GDPR, industry regulations) requires config governance.

---

#### Config Approval Workflow (NEW in v2.0)

**Use Case**: Banking tenant changes scoring weights → Requires CFO approval (compliance requirement)

**Architecture**:
```
Admin proposes config change
    ↓
Lambda: config-manager
    ↓
Check: Does this config change require approval?
    ↓
YES: Start Step Functions workflow (offer-approval pattern)
    ├─ Store task token in DynamoDB
    ├─ Send approval request email to CFO
    ├─ Wait for approval (blocking state, 7-day timeout)
    ├─ CFO clicks approve/reject
    ├─ API Gateway receives decision
    ├─ Lambda calls SendTaskSuccess/Failure
    └─ Step Functions resumes
    ↓
Approved: Create new config version
Rejected: Notify admin (no config change)
```

**Cost**: +$1/month (Step Functions executions for config approvals)

**Benefit**: Compliance with regulatory requirements (banking, healthcare)

---

### New Migration Path: Vertical Expansion (v2.0)

**v1.0**: No explicit vertical expansion migration path (hardcoded architecture assumed single vertical)

**v2.0**: Vertical expansion is now a **first-class migration path**

---

#### Vertical Expansion Migration: Software → Banking

**Trigger**: Business decision to launch Banking vertical

**Prerequisites**:
- Level 1 or higher (multi-tenancy enabled)
- Config table has PITR enabled (disaster recovery)
- Admin UI supports tenant selection

**Migration Steps**:

**Week 1: Tenant Setup**

**Day 1-2: Create Banking Tenant**
- [ ] Create tenant record in DynamoDB (`TENANT#BANKING_CO`)
- [ ] Seed default configs (copy from Software tenant as starting point)
- [ ] Create Cognito user group: "BankingAdmins"
- [ ] Add test user: `bank-hr@bankingco.com` with `tenantId: BANKING_CO`

**Day 3-5: Customize Configs**
- [ ] Admin logs in, selects "Banking" tenant
- [ ] **Scoring Weights**: Change Tech 30% → 20%, Comm 25% → 35% (relationship-focused)
- [ ] **SLA Thresholds**: Change First Engagement 48h → 24h (tighter SLA for banking)
- [ ] **Panel Rules**: Change min panel size 1 → 3 (all banking roles require 3 interviewers)
- [ ] **Stage Enablement**: Enable background checks (regulatory requirement)
- [ ] Save all configs (creates v1 for Banking tenant)

**Total Effort**: 5 days (1 week)

**v1.0 Comparison**: Would take 2-3 weeks (rebuild Lambdas with different rules)

**Cost**: R0 (no code changes, no redeployment)

**v1.0 Cost**: R1.06M (consulting + testing)

---

#### Vertical Expansion at Each Maturity Level

| Level | Vertical Expansion Timeline | Effort | Cost |
|-------|----------------------------|--------|------|
| **Level 0 (POC)** | Not supported (single tenant only) | N/A | N/A |
| **Level 1 (Production)** | **1-2 days** (tenant setup + config) | 16 hours | R0 (config changes only) |
| **Level 2 (Intelligence)** | **30 minutes** (AI config assistant) | 30 min | R0 |
| **Level 3 (Enterprise)** | **30 minutes** (AI + approval workflow) | 30 min + approval time | R0 |

**v1.0 Comparison**: 2-3 weeks per vertical at all levels (Lambda rebuild required)

**Savings**: R1.06M per vertical × 3 verticals = **R3.18M total savings**

---

### New Risk: Config Misconfiguration (v2.0)

**v1.0**: No config misconfiguration risk (rules hardcoded, tested in CI/CD)

**v2.0**: Runtime config changes introduce misconfiguration risk

**Risk**: Admin accidentally sets all scoring weights to 0% → All candidates score 0 → Workflow breaks

**Mitigation Strategies**:

**Level 1 (Production)**:
- ✅ Form validation (weights must sum to 100%, SLA must be positive, panel size min ≤ max)
- ✅ Confirmation dialog ("Are you sure? This will affect all new candidates.")
- ✅ One-click rollback (revert to previous version if mistake detected)

**Level 2 (Intelligence)**:
- ✅ AI anomaly detection ("Warning: Setting all weights to 0% will break scoring. Revert?")
- ✅ AI confidence threshold (if AI is <80% confident intent parsed correctly, ask for confirmation)

**Level 3 (Enterprise)**:
- ✅ Approval workflow (critical config changes require C-level approval)
- ✅ Automated compliance checks (validates config against industry regulations before save)
- ✅ Canary testing (apply config to 5% of candidates first, monitor metrics, then roll out to 100%)

**Additional Safeguard**: All Lambdas have **fallback defaults** (if config read fails, use default values).

**Example** (sla-monitor.js):
```javascript
try {
  const config = await getActiveConfig(tenantId, 'SLA_THRESHOLDS');
  const threshold = config.data.FIRST_ENGAGEMENT;
} catch (error) {
  console.warn('Config read failed, using default threshold');
  const threshold = 48; // Fallback to 48h default
}
```

---

### Updated Cost Breakdown by Level (v2.0)

| Level | Infrastructure Cost | Config Management Cost | Total Cost | v1.0 Total | Difference |
|-------|---------------------|------------------------|------------|------------|------------|
| **Level 0 (POC)** | $9.50/month | +$0.52/month | **$10.02/month** | $9.50/month | +$0.52 |
| **Level 1 (Production)** | $200/month | +$20/month (multi-tenant, full UI) | **$220/month** | $200/month | +$20 |
| **Level 2 (Intelligence)** | $450/month | +$50/month (AI config assistant) | **$500/month** | $450/month | +$50 |
| **Level 3 (Enterprise)** | $1,800/month | +$200/month (governance, DR, analytics) | **$2,000/month** | $1,800/month | +$200 |

**Config Management Cost as % of Total**:
- Level 0: 5% (negligible)
- Level 1: 9% (small investment)
- Level 2: 10% (worthwhile for AI assistant)
- Level 3: 10% (essential for compliance)

**ROI**: Config management investment pays back with vertical 2 launch (R1.06M savings).

---

### Updated Key Takeaways (v2.0)

**v1.0 Takeaways** (all preserved):
1. ✅ Incremental Evolution (each level builds on previous)
2. ✅ Validate Before Scaling (prove value before investing)
3. ✅ Cost-Aware (understand cost implications)
4. ✅ Rollback Plans (every migration has rollback strategy)
5. ✅ User Training (change management)

**v2.0 Additions**:
6. ✅ **Config Management Matures** (evolves from Level 0 → Level 3)
7. ✅ **Vertical Expansion is a Migration** (1st-class path, not an afterthought)
8. ✅ **Versioning Prevents Retroactive Changes** (in-flight candidates unaffected)
9. ✅ **AI Assistance Accelerates Config** (30 seconds vs 5 minutes at Level 2+)
10. ✅ **Governance is Essential at Scale** (approval workflows, compliance checks at Level 3)

---

### Summary of v2.0 Migration Changes

**New Migration Paths**:
- ✅ Vertical expansion (Software → Banking → Agriculture)
- ✅ Config UI expansion (3 of 6 → 6 of 6)
- ✅ AI config assistant (natural language config changes)
- ✅ Config governance (approval workflows, compliance checks)

**Updated Timelines**:
- Level 0 → 1: 2-3 weeks → **6-7 weeks** (+4 weeks for config UI)
- Level 1 → 2: 3-4 weeks → **7-8 weeks** (+4 weeks for AI config assistant)
- Level 2 → 3: 6-8 weeks → **14-16 weeks** (+8 weeks for config governance)

**Trade-Off**: v2.0 takes longer to reach Level 3, but enables 100x faster vertical expansion at every level.

**Business Impact**: Config management investment pays back immediately with vertical 2 launch (R1.06M savings).

---

**v2.0 Addendum Complete**
**Last Updated**: 2026-05-15
**Related Documents**:
- MVP1-FOUNDATION-PLAN-v2.md (execution plan)
- TALENT_FLOW_MATURITY_LEVELS.md v2.0 Addendum (evolution path)
- HADES_TO_SERVERLESS_MAPPING.md v2.0 Addendum (config pattern comparison)
- PROJECT_CONTEXT.md (Session Checkpoint 2026-05-15)
