# Talent Flow Platform - Maturity Levels

> **Purpose**: Define the architectural evolution path from cost-optimized POC to enterprise-grade agentic AI platform
> **Audience**: Solution Architects, Technical Leadership
> **Status**: v1.0 - Foundation Document

---

## Executive Summary

The Talent Flow Platform will evolve through **4 distinct maturity levels**, each with clear architectural characteristics, cost profiles, and migration triggers. This document defines what changes at each level and why.

**Key Principle**: Every POC component is selected with the end-state enterprise architecture in mind. No architectural dead-ends.

---

## Maturity Level Overview

```
Level 0: POC (Cost-Optimized)
  ↓ Trigger: 10 candidates, 1 dept, 2 managers, 1-3 months
Level 1: Production-Ready (Department Scale)
  ↓ Trigger: Multi-department adoption, 100+ workflows/day
Level 2: Intelligence Layer (AI Features)
  ↓ Trigger: User demand for AI features, budget available
Level 3: Enterprise + Agentic AI (Full Scale)
  ↓ Trigger: Organization-wide rollout, compliance requirements
```

---

## Maturity Level 0: POC (Cost-Optimized)

### Objective
Validate workflow orchestration, domain-driven design, and event-driven architecture patterns at minimal cost.

### Target Metrics
- **Budget**: <$50/month
- **Volume**: 1,000 workflows/day
- **Users**: 2 hiring managers, 1 department
- **Success**: 10 candidates end-to-end, 1 month usage
- **Timeline**: 1-3 months

### Technology Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| **Compute** | AWS Lambda (Node.js 20.x) | $0 within free tier, event-driven |
| **Orchestration** | AWS Step Functions (Standard) | Durable workflows, native wait states |
| **Event Bus** | Amazon EventBridge | $0 within free tier, serverless pub-sub |
| **Message Queue** | Amazon SQS (Standard) | $0 within free tier, feedback aggregation |
| **Database** | DynamoDB (On-Demand) | ~$5/month, single-table design |
| **API Gateway** | API Gateway v2 (HTTP) | $1/million requests |
| **Notifications** | Amazon SNS | $0 within free tier |
| **Monitoring** | CloudWatch Logs + Metrics | Basic observability |
| **IaC** | Terraform | Module-based, reusable |
| **Frontend** | Angular 19 + PrimeNG | Static S3 hosting |

### Architecture Characteristics
- ✅ Fully serverless (no always-on infrastructure)
- ✅ Event-driven (EventBridge + SQS)
- ✅ Saga pattern (Step Functions)
- ✅ Domain autonomy (Lambdas as domain services)
- ✅ Feedback loop (SQS aggregation)
- ✅ Audit trail (DynamoDB event-ledger)
- ✅ Incremental delivery (Stage 1-3 first)
- ⚠️ Single region (af-south-1)
- ⚠️ No high availability
- ⚠️ No AI/LLM features
- ⚠️ Manual configuration (env vars)

### Lambda Function Count
**Stage 1-3**: 7 Lambdas (Evaluation Intelligence)
- API Handler
- Workflow Orchestrator
- Interview Scheduler
- Vote Processor
- Evaluation Completer
- Notification Service
- SLA Monitor

### Cost Breakdown (Estimated)
```
DynamoDB On-Demand:     $5/month
EventBridge:            $0 (free tier)
SQS:                    $0 (free tier)
Lambda:                 $0 (free tier)
Step Functions:         $1/month
API Gateway:            $1/month
CloudWatch:             $2/month
S3 (Frontend):          $0.50/month
SNS:                    $0 (free tier)
────────────────────────────────
Total:                  ~$9.50/month
```

### What's Missing (Intentionally)
- ❌ Kubernetes/EKS
- ❌ MSK Kafka
- ❌ Aurora PostgreSQL
- ❌ NAT Gateway
- ❌ Load Balancer
- ❌ Multi-AZ deployment
- ❌ Auto-scaling groups
- ❌ Caching layer (ElastiCache)
- ❌ AI/LLM integration
- ❌ Complex analytics (Athena, Redshift)

---

## Maturity Level 1: Production-Ready (Department Scale)

### Objective
Support multi-department adoption with production-grade reliability, monitoring, and operational excellence.

### Target Metrics
- **Budget**: <$200/month
- **Volume**: 10,000 workflows/day (10x)
- **Users**: 20+ hiring managers, 3-5 departments
- **Availability**: 99.5% uptime SLA
- **Timeline**: 3-6 months from POC

### What Changes from POC

| Component | POC (Level 0) | Production (Level 1) | Why Change |
|-----------|---------------|---------------------|-----------|
| **Database** | DynamoDB On-Demand | DynamoDB Provisioned | Cost optimization at scale |
| **Monitoring** | CloudWatch basic | CloudWatch + X-Ray | Distributed tracing |
| **Observability** | Logs only | OpenTelemetry spans | End-to-end visibility |
| **Configuration** | Env vars | AWS Secrets Manager | Secure secret rotation |
| **Deployment** | Manual Terraform | CI/CD (GitHub Actions) | Automated deployments |
| **Analytics** | None | Athena on S3 exports | Business intelligence |
| **Caching** | None | DynamoDB DAX | Read optimization |
| **API** | HTTP API | REST API + WAF | Enhanced security |
| **Alerting** | CloudWatch Alarms | PagerDuty integration | Incident management |
| **Multi-Region** | Single region | Primary + DR region | Business continuity |

### New Components

**Added Services:**
- **AWS X-Ray**: Distributed tracing ($5/month per 1M traces)
- **DynamoDB DAX**: In-memory cache ($50/month for 1 node)
- **AWS WAF**: API protection ($5/month + rules)
- **EventBridge Archive**: Event replay capability ($0.10/GB/month)
- **S3 + Athena**: Analytics queries on DynamoDB exports
- **CloudWatch Dashboards**: Custom operational dashboards

**Enhanced Patterns:**
- Multi-region DynamoDB Global Tables
- Step Functions Express Workflows (for high-volume events)
- Lambda reserved concurrency (prevent throttling)
- API Gateway usage plans (rate limiting per department)

### Cost Breakdown (Estimated)
```
DynamoDB Provisioned:        $50/month
DynamoDB DAX:                $50/month
Lambda:                      $10/month (beyond free tier)
Step Functions:              $5/month
API Gateway + WAF:           $15/month
X-Ray:                       $10/month
Athena:                      $5/month
S3:                          $5/month
CloudWatch (enhanced):       $10/month
EventBridge Archive:         $5/month
Secrets Manager:             $5/month
────────────────────────────────────
Total:                       ~$170/month
```

### Migration Path from POC
1. Enable X-Ray tracing on existing Lambdas (no code changes)
2. Switch DynamoDB from On-Demand → Provisioned (Terraform change)
3. Add DynamoDB DAX cluster (Terraform + Lambda env var)
4. Export DynamoDB to S3 daily (DMS or native export)
5. Create Athena external tables on S3 data
6. Migrate secrets from env vars → Secrets Manager
7. Add GitHub Actions CI/CD pipeline
8. Configure CloudWatch dashboards + alarms
9. Test DR region failover

**Downtime**: Zero (blue-green deployment via weighted routing)

---

## Maturity Level 2: Intelligence Layer (AI Features)

### Objective
Introduce AI-powered intelligence: interview summarization, sentiment analysis, risk prediction, scoring recommendations.

### Target Metrics
- **Budget**: <$500/month
- **Volume**: 20,000 workflows/day (20x)
- **AI Features**: 4 core intelligence capabilities
- **Users**: 50+ hiring managers, 10+ departments
- **Timeline**: 6-12 months from POC

### What Changes from Level 1

| Component | Level 1 | Level 2 (AI) | Why Change |
|-----------|---------|--------------|-----------|
| **LLM Integration** | None | AWS Bedrock (Claude 3 Haiku) | AI features enabled |
| **Gateway** | API Gateway | LiteLLM + Portkey | LLM abstraction + caching |
| **Prompt Storage** | None | Aurora Serverless v2 | Audit compliance (7 years) |
| **Intent Router** | None | Lambda (deterministic-first) | Cost optimization |
| **Caching** | DAX only | DAX + Portkey semantic cache | 50-70% LLM cost reduction |
| **Database** | DynamoDB only | DynamoDB + Aurora | Relational audit queries |
| **Event Processing** | Lambda only | Lambda + Step Functions AI tasks | AI workflow integration |

### New AI Components

**Core AI Services:**

1. **LiteLLM Gateway (Lambda or Fargate)**
   - Unified LLM API (Bedrock, OpenAI, Anthropic)
   - Cost tracking per query
   - Model failover
   - Rate limiting

2. **Portkey Gateway**
   - Semantic caching (50-70% hit rate)
   - Prompt injection detection
   - PII masking
   - Observability

3. **Intent Router (Lambda)**
   - Level 1-5 classification (from Enterprise AI Skill)
   - Routes deterministic queries → Lambda
   - Routes synthesis queries → LLM

4. **AI Lambdas (4 Functions)**
   - Interview Summarizer (processes interview notes → summary)
   - Sentiment Analyzer (extracts candidate sentiment from text)
   - Risk Predictor (calculates ghosting/disengagement risk)
   - Score Recommender (suggests scores based on evaluation data)

5. **Prompt Audit Store (Aurora Serverless v2)**
   - Schema: `agent_prompts` table (from Enterprise AI Skill)
   - Retention: 7 years (POPIA compliance)
   - Fields: user_id, service_id, prompt_text, response_text, llm_model, tokens, cost

### Architecture Patterns (from Enterprise AI Skill)

**Pillar 1: Dual Authentication**
- User context (JWT from Cognito)
- Service context (Lambda execution role)
- Propagated through all AI requests

**Pillar 2: Non-Operational DB Queries**
- AI agents query DynamoDB read replicas (Global Tables)
- Never query operational DynamoDB directly

**Pillar 3: Prompt/Response Audit**
- Every LLM call logged to Aurora
- PostgreSQL for compliance queries (7-year retention)
- DynamoDB for operational state

**Pillar 6: Cost Optimisation**
- Deterministic-first routing (60-80% queries skip LLM)
- Semantic caching via Portkey (50-70% hit rate)
- Model selection: Haiku for simple, Sonnet for critical

**Pillar 7: Intent Router**
```
Query Classification:
Level 1-2 (Lookup/Aggregation) → Lambda (deterministic)
Level 3 (Correlation) → Maybe LLM (depends on complexity)
Level 4-5 (Synthesis/Creative) → LLM (Bedrock)
```

### AI Feature Implementations

**1. Interview Summarization**
```
Input: Interview notes (1000-2000 words)
Process: Claude 3 Haiku via Bedrock
Output: 3-paragraph summary
Cost: ~$0.002 per summary
```

**2. Sentiment Extraction**
```
Input: Candidate responses, email tone
Process: Claude 3 Haiku + prompt template
Output: EXCITED | NEUTRAL | HESITANT | RELUCTANT
Cost: ~$0.001 per analysis
```

**3. Risk Prediction**
```
Input: Engagement response time, sentiment, stage delays
Process: Deterministic scoring + LLM reasoning
Output: Risk score (0-100) + explanation
Cost: ~$0.005 per prediction
```

**4. Score Recommendation**
```
Input: Interview transcript, evaluator notes
Process: Claude 3 Sonnet (quality matters)
Output: Recommended scores + justification
Cost: ~$0.015 per recommendation
```

### Cost Breakdown (Estimated)

**Base Infrastructure (from Level 1):** $170/month

**AI Layer Additions:**
```
AWS Bedrock (Claude 3 Haiku):
  - 1,000 workflows/day × 4 AI features = 4k LLM calls/day
  - 120k calls/month
  - Average cost: $0.003/call
  - Subtotal: $360/month
  - With 60% cache hit rate: $144/month

Aurora Serverless v2 (Prompt Audit):
  - Minimum capacity: 0.5 ACU
  - Average usage: ~$30/month

LiteLLM + Portkey:
  - Self-hosted on Lambda/Fargate: $10/month
  - OR Portkey Cloud: $29/month (starter plan)

Additional Lambda invocations:     $5/month
Additional Step Functions:         $3/month
────────────────────────────────────────────
AI Layer Total:                    ~$220/month
────────────────────────────────────────────
Grand Total (Level 2):             ~$390/month
```

### Migration Path from Level 1
1. Deploy Aurora Serverless v2 (prompt audit store)
2. Deploy LiteLLM Lambda function
3. Integrate Portkey (semantic caching)
4. Deploy Intent Router Lambda
5. Add 4 AI Lambdas (one per feature)
6. Update Step Functions to call AI Lambdas conditionally
7. Configure Bedrock model access (Claude 3 Haiku)
8. Implement dual authentication (Cognito JWT + IAM roles)
9. Enable OpenTelemetry tracing with GenAI semantic conventions
10. Test AI features with 10% traffic (canary deployment)

**Downtime**: Zero (AI features are additive, not replacing)

---

## Maturity Level 3: Enterprise + Agentic AI (Full Scale)

### Objective
Organization-wide rollout with full Enterprise Agentic AI Architecture, multi-region HA, and autonomous workflow optimization.

### Target Metrics
- **Budget**: <$2,000/month
- **Volume**: 100,000 workflows/day (100x)
- **Availability**: 99.95% uptime SLA
- **Regions**: 3 (primary + 2 DR)
- **Users**: 500+ hiring managers, 50+ departments
- **AI Maturity**: Agentic automation enabled
- **Timeline**: 12-24 months from POC

### What Changes from Level 2

| Component | Level 2 | Level 3 (Enterprise) | Why Change |
|-----------|---------|---------------------|-----------|
| **Compute** | Lambda only | Lambda + EKS (Java Spring Boot) | Enterprise microservices |
| **Event Bus** | EventBridge | EventBridge + MSK Kafka | High-throughput streaming |
| **Database** | DynamoDB + Aurora | DynamoDB Global Tables + Aurora Multi-AZ | Multi-region HA |
| **Orchestration** | Step Functions | Step Functions + Temporal | Complex saga patterns |
| **API** | API Gateway | Spring Cloud Gateway on EKS | Enterprise API management |
| **Observability** | X-Ray + CloudWatch | Prometheus + Grafana + OpenTelemetry | Full observability stack |
| **Caching** | DAX + Portkey | ElastiCache Redis + Portkey | Distributed caching |
| **AI** | Basic intelligence | Agentic automation | Autonomous agents |
| **Configuration** | Secrets Manager | Spring Cloud Config + Vault | Centralized config |
| **Deployment** | Terraform + GitHub Actions | GitOps (Argo CD) + Helm | Kubernetes-native |

### Full Enterprise AI Stack (from Enterprise AI Skill)

**All 9 Pillars Implemented:**

1. **Dual Authentication**
   - User: Cognito JWT (OAuth 2.0 PKCE)
   - Service: IRSA (IAM Roles for Service Accounts on EKS)
   - Context propagation via HTTP headers (X-User-Context, X-Agent-Identity, X-Correlation-ID)

2. **Non-Operational DB Queries**
   - Agents query Aurora read replicas only
   - DynamoDB Global Tables (cross-region replication)
   - Never touch operational write endpoints

3. **Prompt/Response Audit Storage**
   - Aurora PostgreSQL (7-year retention)
   - Partitioned by month (pg_partman)
   - Compliance queries via SQL

4. **Observability & Tracing**
   - OpenTelemetry with GenAI semantic conventions
   - Grafana dashboards (LLM cost, latency, cache hit rate)
   - Prometheus metrics (custom agent metrics)

5. **LLM Stack Integration**
   - LiteLLM (unified LLM API)
   - Portkey (semantic caching, PII detection, guardrails)
   - Bedrock (primary), OpenAI (failover)

6. **Cost Optimisation**
   - Deterministic-first routing (80% queries skip LLM)
   - Portkey semantic cache (70% hit rate at scale)
   - Model selection by query complexity (Haiku vs Sonnet)

7. **Intent Router**
   - Level 1-5 classification
   - ML-based classification (optional)
   - Feedback loop for continuous improvement

8. **Compliance by Design**
   - POPIA/GDPR compliant
   - Data residency (af-south-1)
   - Encryption at rest (KMS) + in transit (TLS 1.3)

9. **ADK Compliance (Google Agentic Design Kit)**
   - Stateless agents (no session state in pods)
   - Human-in-the-Loop gates (approval workflows)
   - Observability by default (every action traced)
   - Plan → Act → Reflect execution pattern

### Agentic Automation Features

**Phase 3 AI Capabilities (from Talent Flow scope):**

1. **Intelligent Nudging**
   - Autonomous SLA breach prevention
   - Predictive escalations (before breach occurs)
   - Context-aware reminder timing

2. **Workflow Optimization**
   - Agent learns optimal stage durations
   - Suggests process improvements
   - Identifies bottlenecks autonomously

3. **Adaptive Onboarding**
   - Personalizes onboarding flow per candidate
   - Adjusts engagement frequency based on sentiment
   - Recommends intervention strategies

4. **Autonomous Escalation**
   - Detects disengagement patterns
   - Auto-creates escalation tasks
   - Routes to appropriate manager/HR

### Infrastructure Components

**Compute:**
- EKS cluster (3 worker nodes, m5.large)
- Lambda functions (lightweight event handlers)
- Fargate tasks (on-demand batch processing)

**Data:**
- DynamoDB Global Tables (3 regions)
- Aurora PostgreSQL Global Database
- ElastiCache Redis (multi-AZ cluster)
- S3 (multi-region replication)

**Messaging:**
- MSK Kafka (3 brokers, multi-AZ)
- EventBridge (cross-region event routing)
- SQS (FIFO queues for ordered processing)

**Observability:**
- Prometheus (time-series metrics)
- Grafana (dashboards)
- Loki (log aggregation)
- Tempo (distributed tracing)
- OpenTelemetry Collector

### Cost Breakdown (Estimated)

**Infrastructure:**
```
EKS Control Plane:               $73/month
EKS Worker Nodes (3 × m5.large): $150/month
Aurora Global Database:          $300/month
MSK Kafka (3 brokers):           $350/month
ElastiCache Redis (multi-AZ):    $80/month
DynamoDB Global Tables:          $200/month
NAT Gateway (multi-AZ):          $90/month
ALB:                             $20/month
────────────────────────────────────────
Subtotal Infrastructure:         $1,263/month
```

**AI & Compute:**
```
Bedrock (100k workflows × 4 features):
  - 400k LLM calls/month
  - With 80% cache hit: 80k actual calls
  - Average: $0.003/call
  - Subtotal: $240/month

Lambda (beyond free tier):       $50/month
Step Functions:                  $30/month
Fargate tasks:                   $40/month
────────────────────────────────────────
Subtotal Compute:                $360/month
```

**Observability & Management:**
```
Prometheus (managed):            $50/month
Grafana Cloud:                   $49/month
CloudWatch (enhanced):           $30/month
X-Ray:                           $20/month
────────────────────────────────────────
Subtotal Observability:          $149/month
────────────────────────────────────────
Grand Total (Level 3):           ~$1,772/month
```

### Migration Path from Level 2
1. Deploy EKS cluster (Terraform)
2. Migrate State Store → Spring Boot microservice on EKS
3. Deploy MSK Kafka cluster
4. Migrate EventBridge → MSK (dual-write pattern, gradual cutover)
5. Deploy Spring Cloud Gateway on EKS
6. Deploy Prometheus + Grafana + Loki stack
7. Implement OpenTelemetry instrumentation
8. Enable DynamoDB Global Tables (3 regions)
9. Enable Aurora Global Database
10. Deploy Temporal for complex sagas (optional)
11. Implement GitOps with Argo CD
12. Test multi-region failover
13. Enable agentic automation features (one by one)

**Downtime**: Minimal (<5 minutes for DNS cutover to EKS gateway)

---

## Maturity Decision Matrix

### When to Move from Level 0 → Level 1

**Triggers:**
- ✅ 10 candidates processed successfully end-to-end
- ✅ 1 department using for 1 month
- ✅ 2 hiring managers using daily
- ✅ <3 sec workflow response time validated
- ✅ Audit trail integrity verified
- ✅ Business feedback: "We want to expand to more departments"

**Budget Justification:**
- Current: $10/month
- New: $170/month
- Incremental: $160/month
- Value: Multi-department adoption, 10x scale, production SLA

---

### When to Move from Level 1 → Level 2

**Triggers:**
- ✅ 100+ workflows/day sustained for 3 months
- ✅ 3-5 departments actively using
- ✅ User feedback: "We need interview summaries, sentiment analysis"
- ✅ Budget approved for AI features
- ✅ Strong ROI demonstrated (time savings, quality improvements)

**Budget Justification:**
- Current: $170/month
- New: $390/month
- Incremental: $220/month (AI layer)
- Value: 4 AI features, 20x scale, competitive differentiation

---

### When to Move from Level 2 → Level 3

**Triggers:**
- ✅ Organization-wide rollout decision
- ✅ 50+ departments, 500+ users
- ✅ 10,000+ workflows/day sustained
- ✅ Compliance requirements mandate (POPIA, audit, multi-region)
- ✅ Budget approved for enterprise infrastructure
- ✅ Need for agentic automation validated

**Budget Justification:**
- Current: $390/month
- New: $1,772/month
- Incremental: $1,382/month (enterprise infrastructure)
- Value: 100x scale, 99.95% SLA, multi-region HA, agentic AI, full compliance

---

## Key Architectural Principles (Non-Negotiable Across All Levels)

### 1. Event-Driven Architecture
- Level 0: EventBridge + SQS
- Level 1: EventBridge + SQS + Archive
- Level 2: EventBridge + SQS + MSK (for AI events)
- Level 3: MSK primary, EventBridge for cross-region

### 2. Saga Pattern
- Level 0: Step Functions Standard
- Level 1: Step Functions + Express Workflows
- Level 2: Step Functions + Temporal (complex sagas)
- Level 3: Temporal (full saga orchestration)

### 3. Domain Autonomy
- Level 0: Lambdas as domain services
- Level 1: Lambdas + Step Functions
- Level 2: Lambdas + AI Lambdas + Step Functions
- Level 3: EKS microservices + Lambda + Temporal

### 4. Audit Trail
- Level 0: DynamoDB event-ledger table
- Level 1: DynamoDB + S3 exports + Athena
- Level 2: DynamoDB + Aurora prompt audit
- Level 3: Multi-region Aurora + S3 + compliance reports

### 5. Feedback Loop
- Level 0: SQS feedback queue → Lambda processor
- Level 1: SQS + EventBridge Archive (replay)
- Level 2: SQS + MSK (high volume)
- Level 3: MSK + Kafka Streams (real-time aggregation)

### 6. SLA Tracking
- Level 0: CloudWatch Events + Lambda cron
- Level 1: CloudWatch + PagerDuty
- Level 2: CloudWatch + ML-based prediction
- Level 3: Autonomous SLA prevention (agentic)

---

## Migration Principles

### Zero Downtime
- Blue-green deployments via weighted routing
- Dual-write patterns during migrations
- Gradual cutover (10% → 50% → 100% traffic)

### Data Continuity
- No data loss during migrations
- DynamoDB point-in-time recovery enabled
- S3 versioning for event archives
- Aurora automated backups

### Cost Control
- Each level self-funds the next level
- No "big bang" infrastructure spending
- Incremental adoption reduces risk

### AI Readiness
- Level 0 designed for future AI integration
- Event schemas support AI enrichment
- API contracts support intent routing
- Audit logging ready for prompt/response capture

---

## Summary Table

| Level | Budget | Volume | Users | Key Features | Timeline |
|-------|--------|--------|-------|--------------|----------|
| **0 (POC)** | <$50 | 1k/day | 2 managers, 1 dept | Serverless, event-driven, saga pattern | 1-3 months |
| **1 (Prod)** | <$200 | 10k/day | 20 managers, 5 depts | Multi-region, CI/CD, analytics, caching | 3-6 months |
| **2 (AI)** | <$500 | 20k/day | 50 managers, 10 depts | 4 AI features, intent routing, compliance audit | 6-12 months |
| **3 (Enterprise)** | <$2k | 100k/day | 500 managers, 50 depts | Agentic AI, multi-region HA, full observability | 12-24 months |

---

## Next Steps

1. **Review this maturity roadmap** with stakeholders
2. **Validate budget assumptions** with finance
3. **Confirm success criteria** for Level 0 → Level 1 transition
4. **Proceed to POC Architecture document** (detailed design)
5. **Plan incremental delivery** (Stage 1-3 first)

---

**Document Version**: 1.0
**Last Updated**: 2026-05-10
**Next Review**: After POC completion

---
---

## 🆕 v2.0 Addendum: Metadata-Lite Architecture Impact on Maturity Levels

> **Added**: 2026-05-15
> **Document Version**: 2.0
> **Context**: MVP1 evolved to Metadata-Lite architecture (externalized Variable Six)
> **See**: MVP1-FOUNDATION-PLAN-v2.md, PROJECT_CONTEXT.md (Session Checkpoint 2026-05-15)

---

### What Changed Across All Levels

**v1.0 Maturity Levels**: Each level had hardcoded business rules, launching new verticals required Lambda rebuild at each level

**v2.0 Maturity Levels**: Config management layer introduced in Level 0, evolves through all levels

**Key Insight**: Config management is now a **cross-cutting capability** that matures from Level 0 → Level 3, enabling faster vertical expansion at every level.

---

### Updated Maturity Level 0: POC (v2.0)

#### Objective (Updated)
Validate workflow orchestration, domain-driven design, event-driven architecture patterns, **AND config management foundation** at minimal cost.

#### Target Metrics (No Change)
- **Budget**: <$50/month
- **Volume**: 1,000 workflows/day
- **Users**: 2 hiring managers, 1 department
- **Success**: 10 candidates end-to-end, 1 month usage
- **Timeline**: 1-3 months

#### Architecture Characteristics (Updated)

**v1.0 Characteristics** (all preserved):
- ✅ Fully serverless
- ✅ Event-driven
- ✅ Saga pattern
- ✅ Domain autonomy
- ✅ Feedback loop
- ✅ Audit trail
- ✅ Incremental delivery

**v2.0 Additions** (new capabilities):
- ✅ **Config management layer** (Variable Six externalized)
- ✅ **Config versioning** (in-flight candidates locked)
- ✅ **Admin UI** (3 of 6 config types)
- ✅ **Vertical expansion ready** (1-2 days vs 2-3 weeks)

#### Lambda Function Count (Updated)
**v1.0**: 7 Lambdas
**v2.0**: **8 Lambdas** (+1: config-manager)

#### Cost Breakdown (Updated)
```
DynamoDB On-Demand:     $5.50/month (+$0.50 for config table)
EventBridge:            $0 (free tier)
SQS:                    $0 (free tier)
Lambda:                 $0.02/month (+$0.02 for config-manager)
Step Functions:         $1/month
API Gateway:            $1/month
CloudWatch:             $2/month
S3 (Frontend):          $0.50/month
SNS:                    $0 (free tier)
────────────────────────────────
Total:                  ~$10.02/month (+$0.52/month vs v1.0)
```

**Still under $50/month budget** ✅

#### Config Management Capabilities (NEW in v2.0)

| Config Type | Level 0 Capability | Admin UI? |
|-------------|-------------------|-----------|
| **Scoring Weights** | Read from config table, versioned | ✅ Yes |
| **SLA Thresholds** | Read from config table, active | ✅ Yes |
| **Panel Rules** | Read from config table, versioned | ✅ Yes |
| **Approval Rules** | Read from config table (seed data only) | ⏳ MVP2 |
| **Notification Templates** | Read from config table (seed data only) | ⏳ MVP2 |
| **Stage Enablement** | Read from config table (seed data only) | ⏳ MVP2 |

**Rationale**: Proves config pattern with 3 of 6, expand UI in Level 1 (MVP2).

---

### Updated Maturity Level 1: Production-Ready (v2.0)

#### Trigger (Updated)
- **v1.0**: Multi-department adoption, 100+ workflows/day
- **v2.0**: Multi-department adoption, **OR** 2nd vertical launch (Banking/Agriculture)

**Why the Change**: With config management, launching a 2nd vertical triggers Level 1 migration (needs multi-tenancy, tenant-specific configs).

#### Budget (Updated)
- **v1.0**: <$200/month
- **v2.0**: <$220/month (+$20/month for multi-tenant config management)

#### Config Management Capabilities (Enhanced in Level 1)

**Level 0 → Level 1 Evolution**:
- ✅ **Tenant Isolation**: Config table already tenant-aware (`PK: TENANT#{tenantId}`), add tenant selection in admin UI
- ✅ **Full Admin UI**: Add remaining 3 Variable Six (approval rules, notification templates, stage enablement)
- ✅ **Config Import/Export**: Bulk config changes via JSON upload (for consultants setting up new tenants)
- ✅ **Config Comparison**: Side-by-side diff of two tenants' configs
- ✅ **Role-Based Access**: Tenant admins can only edit their own configs

**Example Use Case**: Agriculture tenant launches → HR selects "Agriculture" tenant → Changes config → Only affects Agriculture candidates.

#### Cost Breakdown (Updated)
```
DynamoDB On-Demand:        $15/month (multi-tenant, higher volume)
DynamoDB PITR:             $5/month (point-in-time recovery enabled)
Config table:              $1/month (multiple tenants × 6 configs × versions)
Lambda (8 functions):      $5/month (higher invocation volume)
EventBridge:               $2/month (>1M events)
SQS:                       $1/month
Step Functions:            $5/month
API Gateway:               $3/month
CloudWatch:                $10/month (longer retention)
S3 + CloudFront:           $5/month
Multi-region replication:  $20/month (DynamoDB global tables)
────────────────────────────────────
Total:                     ~$72/month
```

**Note**: Config table cost increases slightly due to more tenants, but still negligible (<2% of total).

---

### Updated Maturity Level 2: Intelligence Layer (v2.0)

#### Trigger (Updated)
- **v1.0**: User demand for AI features, budget available
- **v2.0**: User demand for AI features, **OR** 5+ verticals launched (config management at scale)

**Why the Change**: With many tenants, config management at scale needs AI assistance (natural language config changes).

#### Budget (Updated)
- **v1.0**: <$500/month
- **v2.0**: <$550/month (+$50/month for AI config assistant)

#### Config Management Capabilities (AI-Enhanced in Level 2)

**Level 1 → Level 2 Evolution**:
- ✅ **AI Config Assistant**: Natural language config changes
  - "Change SLA to 24 hours for first engagement" → AI proposes config change → Human approves → Deployed
- ✅ **Config Anomaly Detection**: AI flags unusual config changes
  - "Warning: Tech weight changed from 30% to 5% — this seems like a typo"
- ✅ **Config Recommendations**: AI suggests config optimizations
  - "Based on candidate drop-off rates, consider increasing SLA from 48h to 36h"
- ✅ **Config Rollback**: One-click rollback to previous config version (UI button, not CLI)

**Example Use Case**: HR types "Make the SLA tighter for urgent roles" → AI proposes "Change FIRST_ENGAGEMENT from 48h to 24h?" → HR approves → Deployed in 30 seconds.

#### Cost Breakdown (Updated)
```
DynamoDB Provisioned:      $50/month (predictable load → provisioned cheaper)
Config table:              $2/month (many tenants, but small records)
Lambda (8 functions):      $20/month
LLM API calls:             $100/month (OpenAI/Anthropic for AI features)
AI Config Assistant:       $50/month (additional LLM calls for config changes)
EventBridge:               $5/month
SQS:                       $2/month
Step Functions:            $10/month
API Gateway:               $10/month
Aurora Serverless v2:      $100/month (replaces DynamoDB for analytics)
S3 + CloudFront:           $10/month
Multi-region:              $50/month
────────────────────────────────────
Total:                     ~$409/month
```

**Note**: AI config assistant adds $50/month (LLM calls for natural language config parsing + validation).

---

### Updated Maturity Level 3: Enterprise + Agentic AI (v2.0)

#### Trigger (Updated)
- **v1.0**: Organization-wide rollout, compliance requirements
- **v2.0**: Organization-wide rollout, **OR** 20+ verticals (config management becomes mission-critical)

**Why the Change**: At scale (20+ tenants), config management needs enterprise governance (approval workflows, change control, compliance).

#### Budget (Updated)
- **v1.0**: <$2k/month
- **v2.0**: <$2.2k/month (+$200/month for enterprise config governance)

#### Config Management Capabilities (Enterprise-Grade in Level 3)

**Level 2 → Level 3 Evolution**:
- ✅ **Config Change Approval Workflow**: Config changes >certain threshold require CFO/CEO approval
  - "Changing scoring weights requires C-level approval" (Step Functions workflow)
- ✅ **Config Compliance Checks**: Automated validation against industry standards
  - "Banking tenant must have background checks enabled (regulatory requirement)"
- ✅ **Config Audit Reports**: Generate compliance reports for regulators
  - "Show all config changes in Q1 2026 for SOX audit"
- ✅ **Config Disaster Recovery**: Automated backups, point-in-time restore across all tenants
- ✅ **Config Performance Analytics**: Track config impact on business metrics
  - "After changing SLA to 24h, candidate drop-off decreased by 15%"

**Example Use Case**: Banking regulator requests audit trail → Admin clicks "Generate Audit Report" → PDF shows all config changes with timestamps, approvers, reasons → Regulator satisfied.

#### Cost Breakdown (Updated)
```
Aurora Multi-AZ:           $500/month (HA replicas)
Config table (Global):     $50/month (global replication for DR)
Lambda (8 functions):      $100/month (high volume)
LLM API calls:             $300/month (agentic AI features)
AI Config Assistant:       $200/month (enterprise governance features)
EventBridge:               $20/month
SQS:                       $5/month
Step Functions:            $50/month (config approval workflows)
API Gateway:               $50/month
ECS (AI Agents):           $500/month
S3 + CloudFront:           $50/month
Multi-region HA:           $200/month
Observability (Datadog):   $150/month
────────────────────────────────────
Total:                     ~$2,175/month
```

**Note**: Config governance adds $200/month (approval workflows, compliance checks, disaster recovery).

---

### Config Management Evolution Summary

| Level | Config Capabilities | Admin UI | Cost Impact | Timeline |
|-------|---------------------|----------|-------------|----------|
| **Level 0 (POC)** | 3 of 6 Variable Six, versioning, seed data | 3 pages | +$0.52/month | Week 1-7 |
| **Level 1 (Prod)** | 6 of 6 Variable Six, multi-tenancy, import/export | 6 pages | +$20/month | Week 8-11 |
| **Level 2 (AI)** | Natural language config, anomaly detection, recommendations | AI chat | +$50/month | Week 12-24 |
| **Level 3 (Enterprise)** | Approval workflows, compliance checks, DR, analytics | Governance dashboard | +$200/month | Week 24+ |

---

### Vertical Expansion Impact (v2.0)

**v1.0**: Launching each new vertical required Lambda rebuild, testing, deployment (2-3 weeks per vertical)

**v2.0**: Launching each new vertical is config change + seed data (1-2 days per vertical)

**Vertical Expansion Timeline**:

| Vertical | Level 0 (v1.0) | Level 0 (v2.0) | Level 1 (v2.0) | Level 2 (v2.0) | Level 3 (v2.0) |
|----------|----------------|----------------|----------------|----------------|----------------|
| **Software** | 7 weeks (build) | 7 weeks (build) | 7 weeks (build) | 7 weeks (build) | 7 weeks (build) |
| **Banking** | +3 weeks (rebuild) | **+2 days** (config) | **+1 day** (multi-tenant) | **+30 min** (AI assistant) | **+30 min** (AI + governance) |
| **Agriculture** | +3 weeks (rebuild) | **+2 days** (config) | **+1 day** (multi-tenant) | **+30 min** (AI assistant) | **+30 min** (AI + governance) |
| **Healthcare** | +3 weeks (rebuild) | **+2 days** (config) | **+1 day** (multi-tenant) | **+30 min** (AI assistant) | **+30 min** (AI + governance) |

**Cost Savings** (v1.0 vs v2.0):
- Vertical 2: R1.06M saved (2-3 weeks → 2 days)
- Vertical 3: R1.06M saved
- Vertical 4: R1.06M saved
- **Total savings (3 verticals)**: R3.18M

**Payback Period**: v2.0 investment (+1 week MVP1 dev time) pays back with vertical 2 launch.

---

### Updated Migration Triggers (v2.0)

| Transition | v1.0 Trigger | v2.0 Trigger (Updated) |
|------------|--------------|------------------------|
| **Level 0 → 1** | Multi-department, 100+ workflows/day | Multi-department **OR** 2nd vertical launch |
| **Level 1 → 2** | User demand for AI, budget available | 5+ verticals **OR** AI config assistant request |
| **Level 2 → 3** | Org-wide rollout, compliance req | 20+ verticals **OR** regulatory audit requirement |

**Why Updated**: Config management accelerates vertical expansion, which becomes a migration trigger.

---

### Summary of v2.0 Changes Across Levels

**Level 0 (POC)**:
- ✅ Config management foundation (3 of 6 Variable Six)
- ✅ +$0.52/month cost (+5.5%)
- ✅ Vertical expansion ready (1-2 days)

**Level 1 (Production)**:
- ✅ Full admin UI (6 of 6 Variable Six)
- ✅ Multi-tenant config isolation
- ✅ Config import/export, comparison
- ✅ +$20/month cost (+10%)

**Level 2 (Intelligence)**:
- ✅ AI config assistant (natural language)
- ✅ Config anomaly detection
- ✅ Config recommendations
- ✅ +$50/month cost (+12%)

**Level 3 (Enterprise)**:
- ✅ Config approval workflows
- ✅ Compliance checks, audit reports
- ✅ Disaster recovery, analytics
- ✅ +$200/month cost (+10%)

**Cross-Cutting Benefit**: Config management enables vertical expansion at every level (1-2 days per vertical vs 2-3 weeks rebuild).

---

**v2.0 Addendum Complete**
**Last Updated**: 2026-05-15
**Related Documents**:
- MVP1-FOUNDATION-PLAN-v2.md (execution plan)
- TALENT_FLOW_POC_ARCHITECTURE.md v2.0 Addendum (updated component count)
- INCREMENTAL_DELIVERY_ROADMAP.md v2.0 Addendum (7-week timeline)
- PROJECT_CONTEXT.md (Session Checkpoint 2026-05-15)
