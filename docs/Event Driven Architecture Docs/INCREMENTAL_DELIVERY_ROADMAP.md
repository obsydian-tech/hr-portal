# Incremental Delivery Roadmap - Stage 1-3 First

> **Purpose**: Week-by-week build plan for AI-assisted solo development
> **Audience**: Developer, Project Manager
> **Status**: v1.0 - Execution Ready

---

## Executive Summary

This roadmap breaks down the Talent Flow POC into **4-week sprints**, prioritizing **Stage 1-3 (Evaluation Intelligence)** first, followed by incremental expansion.

**Approach**: Build → Test → Validate → Learn → Expand

**Success Criteria**: After Week 4, system can process 10 candidates through evaluation workflow.

---

## Phase 1: Stage 1-3 Foundation (Weeks 1-4)

### Week 1: Infrastructure + Core Services

#### Day 1-2: Foundation Setup
**Goals**:
- Set up AWS environment
- Deploy core infrastructure
- Validate connectivity

**Tasks**:
- [ ] **Infrastructure (Terraform)**
  - Create S3 bucket for Terraform state
  - Create DynamoDB table for state locking
  - Deploy EventBridge bus (`talent-flow-bus`)
  - Deploy DynamoDB tables (`talent-flow-state`, `talent-flow-events`)
  - Configure IAM roles

**AI Prompt Example**:
```
Generate Terraform code to:
1. Create EventBridge custom bus named "talent-flow-bus"
2. Create DynamoDB table "talent-flow-state" with:
   - Hash key: PK (String)
   - Range key: SK (String)
   - PAY_PER_REQUEST billing
   - GSI1: GSI1PK, GSI1SK (for stage-based queries)
   - GSI2: GSI2PK, GSI2SK (for email lookup)
   - TTL enabled on "ttl" attribute

Use reusable modules from terraform/modules/
```

**Validation**:
```bash
# Verify resources
aws events list-event-buses | grep talent-flow
aws dynamodb describe-table --table-name talent-flow-state
aws dynamodb describe-table --table-name talent-flow-events
```

**Deliverable**: ✅ Infrastructure deployed, accessible via AWS Console

---

#### Day 3-5: Core Lambda Functions
**Goals**:
- Deploy API Handler Lambda
- Deploy Workflow Orchestrator Lambda
- Test event flow

**Tasks**:
- [ ] **Lambda: API Handler**
  - Generate Lambda code (AI-assisted)
  - Package deployment .zip
  - Deploy via Terraform
  - Test POST /candidate endpoint

**AI Prompt Example**:
```
Generate Node.js Lambda function "api-handler" with:
- POST /candidate endpoint (create candidate, publish CandidateCreated event)
- POST /interview endpoint (schedule interview, publish InterviewScheduled event)
- POST /vote endpoint (submit vote, publish VoteSubmitted event)
- GET /candidate/{id} endpoint (retrieve candidate details)

Technical requirements:
- AWS SDK v3 (EventBridge, DynamoDB)
- Input validation (joi library)
- Structured logging (JSON format)
- Error handling (try/catch with specific error types)
- Idempotency (check for duplicate emails before creating)

Environment variables:
- EVENTBRIDGE_BUS_NAME
- DYNAMODB_TABLE_NAME
- LOG_LEVEL

Follow the pattern from LAMBDA_CATALOG.md document
```

- [ ] **Lambda: Workflow Orchestrator**
  - Generate Lambda code (AI-assisted)
  - Deploy via Terraform
  - Create EventBridge rule (trigger on CandidateCreated)
  - Test event propagation

**Validation**:
```bash
# Test API Handler
aws lambda invoke \
  --function-name talent-flow-api-handler \
  --payload file://test-candidate.json \
  output.json

# Check EventBridge event published
aws events list-rules --event-bus-name talent-flow-bus

# Verify Workflow Orchestrator triggered
aws logs tail /aws/lambda/talent-flow-workflow-orchestrator --follow
```

**Deliverable**: ✅ Candidate creation flow working (API → EventBridge → Orchestrator)

---

### Week 2: Evaluation Workflow

#### Day 6-8: Interview & Vote Processing
**Goals**:
- Deploy Interview Scheduler Lambda
- Deploy Vote Processor Lambda
- Test interview scheduling + vote submission

**Tasks**:
- [ ] **Lambda: Interview Scheduler**
  - Generate code (AI-assisted)
  - Deploy via Terraform
  - Create EventBridge rule (trigger on InterviewScheduled)
  - Implement SQS notification queue integration

**AI Prompt Example**:
```
Generate Node.js Lambda function "interview-scheduler" that:
- Subscribes to EventBridge event: source="talent-flow.evaluation", detail-type="InterviewScheduled"
- Writes interview record to DynamoDB (PK: CANDIDATE#{candidateId}, SK: INTERVIEW#{interviewId})
- Sends notification messages to SQS queue (for calendar invites)
- Publishes InterviewConfirmed event to EventBridge
- Implements idempotency (check if interview already processed)

Follow the pattern from LAMBDA_CATALOG.md document
```

- [ ] **Lambda: Vote Processor**
  - Generate code (AI-assisted)
  - Deploy via Terraform
  - Implement score calculation logic
  - Implement voting completion detection

**Validation**:
```bash
# Test interview scheduling
aws lambda invoke \
  --function-name talent-flow-api-handler \
  --payload file://test-interview.json \
  output.json

# Verify interview record created
aws dynamodb get-item \
  --table-name talent-flow-state \
  --key '{"PK": {"S": "CANDIDATE#CAND-123"}, "SK": {"S": "INTERVIEW#INT-123"}}'

# Test vote submission
aws lambda invoke \
  --function-name talent-flow-api-handler \
  --payload file://test-vote.json \
  output.json
```

**Deliverable**: ✅ Interview + vote flow working

---

#### Day 9-10: Evaluation Completion
**Goals**:
- Deploy Evaluation Completer Lambda
- Test end-to-end evaluation workflow
- Validate stage transition

**Tasks**:
- [ ] **Lambda: Evaluation Completer**
  - Generate code (AI-assisted)
  - Deploy via Terraform
  - Create EventBridge rule (trigger on VotingCompleted)
  - Implement final aggregation logic

- [ ] **End-to-End Test**
  - Create candidate (API)
  - Schedule interview (API)
  - Submit 2 votes (API)
  - Verify EvaluationCompleted event published
  - Verify candidate status updated to next stage

**Validation**:
```bash
# Run end-to-end integration test
npm run test:integration:stage1-3

# Expected output:
# ✓ Candidate created (CAND-123)
# ✓ Workflow started (WF-123)
# ✓ Interview scheduled (INT-123)
# ✓ Vote 1 submitted (VOTE-123-1)
# ✓ Vote 2 submitted (VOTE-123-2)
# ✓ Evaluation completed
# ✓ Candidate transitioned to next stage
```

**Deliverable**: ✅ Complete Stage 1-3 workflow functional

---

### Week 3: Notifications + SLA Monitoring

#### Day 11-13: Notification Service
**Goals**:
- Deploy Notification Service Lambda
- Configure SQS queue
- Test email/SMS delivery

**Tasks**:
- [ ] **Lambda: Notification Service**
  - Generate code (AI-assisted)
  - Implement email templates
  - Implement SMTP integration (AWS SES)
  - Deploy via Terraform
  - Create SQS queue + event source mapping

**AI Prompt Example**:
```
Generate Node.js Lambda function "notification-service" that:
- Consumes messages from SQS queue "talent-flow-notification-queue"
- Routes to appropriate channel (EMAIL, SMS, SLACK) based on message.notificationType
- Implements email templates for:
  - Interview scheduled
  - Vote reminder
  - Evaluation completed
- Uses AWS SES for email delivery
- Logs delivery status to CloudWatch
- Deletes SQS message on successful delivery

Follow the pattern from LAMBDA_CATALOG.md document
```

- [ ] **Email Templates**
  - Design HTML email templates
  - Implement variable substitution
  - Test rendering

**Validation**:
```bash
# Send test notification
aws sqs send-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/.../talent-flow-notification-queue \
  --message-body file://test-notification.json

# Verify email delivered
# Check email inbox

# Check CloudWatch Logs
aws logs tail /aws/lambda/talent-flow-notification-service --follow
```

**Deliverable**: ✅ Notification service working (email delivery confirmed)

---

#### Day 14-15: SLA Monitoring
**Goals**:
- Deploy SLA Monitor Lambda
- Configure EventBridge Scheduler (cron)
- Test SLA breach detection

**Tasks**:
- [ ] **Lambda: SLA Monitor**
  - Generate code (AI-assisted)
  - Implement SLA calculation logic
  - Deploy via Terraform
  - Create EventBridge Scheduler rule (hourly cron)

**AI Prompt Example**:
```
Generate Node.js Lambda function "sla-monitor" that:
- Triggered by EventBridge Scheduler (cron: rate(1 hour))
- Scans DynamoDB "talent-flow-state" table for active workflows
- Checks each workflow against SLA thresholds:
  - FIRST_ENGAGEMENT: 48 hours from candidate creation
  - EVALUATION_COMPLETION: 72 hours from first interview
- For breaches, publishes EngagementSLABreached event to EventBridge
- Implements escalation levels (RECRUITER → MANAGER → DIRECTOR)
- Logs all SLA checks to CloudWatch

Environment variables:
- SLA_FIRST_ENGAGEMENT_HOURS: 48
- SLA_EVALUATION_COMPLETION_HOURS: 72

Follow the pattern from LAMBDA_CATALOG.md document
```

- [ ] **SLA Testing**
  - Create backdated candidate (simulate 50 hours elapsed)
  - Wait for SLA monitor to run (or manually invoke)
  - Verify SLABreached event published

**Validation**:
```bash
# Manually invoke SLA monitor
aws lambda invoke \
  --function-name talent-flow-sla-monitor \
  output.json

# Verify SLA breach event
aws events put-events --entries file://test-sla-breach.json

# Check escalation notification sent
aws logs tail /aws/lambda/talent-flow-notification-service --follow
```

**Deliverable**: ✅ SLA monitoring active, breach detection working

---

### Week 4: Angular UI + Testing

#### Day 16-18: Angular Frontend
**Goals**:
- Create Angular project structure
- Implement Stage 1-3 UI components
- Connect to API Gateway

**Tasks**:
- [ ] **Angular Setup**
  - Generate Angular 17 project (Standalone components)
  - Configure routing (Stage 1-3 pages)
  - Set up TailwindCSS for styling

**AI Prompt Example**:
```
Generate Angular 17 standalone component for "CandidateCreate" page with:
- Form fields: firstName, lastName, email, phone, position, department, source
- Form validation (reactive forms)
- Submit button calls POST /candidate API
- Success: Navigate to candidate detail page
- Error: Display error toast notification

Use Angular Material for UI components
```

- [ ] **UI Components**
  - Candidate creation form
  - Interview scheduling form
  - Vote submission form
  - Candidate list/detail view
  - Dashboard (evaluation metrics)

- [ ] **API Integration**
  - Create Angular service for API calls
  - Implement HTTP interceptor (error handling, loading states)
  - Configure API Gateway base URL

**Validation**:
```bash
# Run Angular dev server
ng serve

# Test UI flows:
# 1. Navigate to http://localhost:4200/candidates/create
# 2. Fill form, submit
# 3. Verify candidate created (check API response)
# 4. Navigate to candidate detail page
# 5. Schedule interview, submit votes
# 6. Verify evaluation completed
```

**Deliverable**: ✅ Functional UI for Stage 1-3 workflow

---

#### Day 19-20: Testing + Documentation
**Goals**:
- Write unit tests for all Lambdas
- Write integration tests
- Document POC architecture

**Tasks**:
- [ ] **Unit Tests**
  - Lambda: API Handler (7 test cases)
  - Lambda: Workflow Orchestrator (5 test cases)
  - Lambda: Vote Processor (8 test cases)
  - Lambda: Evaluation Completer (6 test cases)
  - Lambda: Notification Service (4 test cases)
  - Lambda: SLA Monitor (5 test cases)

**AI Prompt Example**:
```
Generate Jest unit tests for "vote-processor" Lambda function covering:
1. Calculate aggregate scores correctly
2. Determine recommendation (STRONG_HIRE, HIRE, MIXED, NO_HIRE)
3. Publish VotingCompleted event when all votes received
4. Do not publish event if votes still pending
5. Handle missing scores gracefully (default to 0)
6. Implement idempotency (skip if already processed)
7. Update candidate aggregate scores in DynamoDB
8. Log all operations to CloudWatch

Mock DynamoDB and EventBridge clients using aws-sdk-client-mock
```

- [ ] **Integration Tests**
  - End-to-end Stage 1-3 workflow test
  - SLA breach scenario test
  - Notification delivery test

- [ ] **Documentation**
  - Update PROJECT_CONTEXT.md (progress, learnings)
  - Create deployment guide
  - Create user guide for POC demo

**Deliverable**: ✅ 80%+ test coverage, documentation complete

---

## Phase 2: Stage 6-8 (Offer Orchestration) - Weeks 5-8

### Week 5: Offer Generation
**Goals**:
- Deploy offer-generator Lambda
- Implement offer approval Step Functions workflow
- Test offer generation flow

**Tasks**:
- [ ] **Lambda: Offer Generator**
  - Triggered by EvaluationCompleted event
  - Generates offer document (PDF)
  - Stores in S3
  - Starts Step Functions approval workflow

- [ ] **Step Functions: Offer Approval**
  - Implement state machine (see STEP_FUNCTIONS_ORCHESTRATION.md)
  - Deploy via Terraform
  - Implement callback pattern (manager approval)

**Deliverable**: ✅ Offer generation + approval flow working

---

### Week 6: Offer Acceptance
**Goals**:
- Implement candidate offer response
- Deploy offer-acceptance Lambda
- Test offer acceptance/decline flow

**Tasks**:
- [ ] **Lambda: Offer Acceptance Handler**
  - API endpoint: POST /offer/{offerId}/accept
  - API endpoint: POST /offer/{offerId}/decline
  - Resume Step Functions workflow (SendTaskSuccess)

- [ ] **UI: Offer Acceptance Page**
  - Angular component: offer-review
  - Display offer details
  - Accept/Decline buttons
  - Thank you/confirmation page

**Deliverable**: ✅ Offer acceptance flow working

---

### Week 7: Offer Expiration + Retries
**Goals**:
- Implement offer expiration logic
- Implement offer revision workflow
- Test offer timeout scenarios

**Tasks**:
- [ ] **Lambda: Offer Expiration Handler**
  - Triggered by Step Functions timeout
  - Sends expiration notification
  - Updates candidate status

- [ ] **Lambda: Offer Revision Handler**
  - Manager can revise offer (salary, benefits)
  - Re-sends offer to candidate
  - Resets expiration timer

**Deliverable**: ✅ Offer expiration + revision working

---

### Week 8: Testing + Integration
**Goals**:
- End-to-end Stage 6-8 testing
- Integration with Stage 1-3
- Validate complete flow (Stage 1-8)

**Tasks**:
- [ ] **Integration Tests**
  - Complete flow: Candidate → Evaluation → Offer → Acceptance
  - Test all edge cases (rejection, expiration, revision)
  - Validate SLA tracking across stages

- [ ] **POC Demo Preparation**
  - Create demo script
  - Prepare test data (10 candidates)
  - Create presentation (architecture + demo)

**Deliverable**: ✅ Stage 1-8 complete, ready for POC demo

---

## Phase 3: Stage 9-12 (Onboarding) - Weeks 9-12

### Week 9: Background Check
**Goals**:
- Deploy background-check Lambda
- Implement Step Functions workflow (multi-week wait)
- Test background check flow

**Tasks**:
- [ ] **Lambda: Background Check Initiator**
  - Triggered by OfferAccepted event
  - Calls 3rd party background check API (mock for POC)
  - Starts Step Functions workflow

- [ ] **Step Functions: Background Check Workflow**
  - Wait for webhook callback (could take weeks)
  - Implement timeout (30 days)
  - Handle manual review (if flagged)

**Deliverable**: ✅ Background check flow working

---

### Week 10: Document Collection
**Goals**:
- Deploy document-collection Lambda
- Implement document upload UI
- Test document validation

**Tasks**:
- [ ] **Lambda: Document Upload Handler**
  - API endpoint: POST /candidate/{id}/document
  - Validates file type (PDF, JPG, PNG)
  - Stores in S3
  - Publishes DocumentUploaded event

- [ ] **UI: Document Upload Page**
  - Angular component: document-upload
  - Drag-and-drop file upload
  - Progress bar
  - Document checklist (I-9, W-4, Direct Deposit)

**Deliverable**: ✅ Document collection working

---

### Week 11: Onboarding Checklist
**Goals**:
- Deploy onboarding-checklist Lambda
- Implement checklist UI
- Test checklist completion flow

**Tasks**:
- [ ] **Lambda: Checklist Manager**
  - Creates checklist items (HR orientation, IT setup, manager 1:1)
  - Tracks completion status
  - Publishes ChecklistCompleted event

- [ ] **UI: Onboarding Checklist Page**
  - Angular component: onboarding-checklist
  - Display checklist items with status
  - Mark items complete
  - Progress indicator

**Deliverable**: ✅ Onboarding checklist working

---

### Week 12: Finalization + Handoff
**Goals**:
- Complete Stage 9-12
- Validate all 12 stages functional
- Prepare for production readiness

**Tasks**:
- [ ] **End-to-End Testing**
  - Process 10 candidates through all 12 stages
  - Validate SLA tracking across all stages
  - Verify all events logged to audit ledger

- [ ] **Performance Testing**
  - Simulate 100 concurrent candidates
  - Measure Lambda cold start times
  - Validate no throttling or errors

- [ ] **Cost Analysis**
  - Review AWS Cost Explorer
  - Validate <$50/month target met
  - Document cost breakdown

- [ ] **Production Readiness Checklist**
  - All Lambdas have unit tests (>80% coverage)
  - All integration tests passing
  - Security review (IAM permissions, encryption)
  - Monitoring dashboards created (CloudWatch)
  - Alerting configured (SNS topics, PagerDuty)

**Deliverable**: ✅ All 12 stages functional, ready for production deployment

---

## Success Metrics (POC Validation)

### Week 4 Checkpoint (Stage 1-3)
- ✅ 10 candidates processed successfully through evaluation
- ✅ All events logged to audit ledger
- ✅ SLA monitoring functional (0 false positives)
- ✅ UI functional (no blockers)
- ✅ AWS costs <$20/month

### Week 8 Checkpoint (Stage 1-8)
- ✅ 10 candidates processed through offer acceptance
- ✅ Offer approval workflow functional (human-in-the-loop working)
- ✅ 0 data loss (all events persisted)
- ✅ AWS costs <$35/month

### Week 12 Checkpoint (Stage 1-12)
- ✅ 10 candidates onboarded successfully
- ✅ All 12 stages functional
- ✅ 2 managers actively using system
- ✅ 1 department fully migrated
- ✅ AWS costs <$50/month
- ✅ Production deployment plan approved

---

## Risk Mitigation

### Risk 1: AI Code Generation Quality
**Mitigation**:
- Use comprehensive prompts (reference LAMBDA_CATALOG.md patterns)
- Review all generated code before deployment
- Write unit tests immediately after code generation
- Use linters (ESLint) and formatters (Prettier)

### Risk 2: Integration Complexity
**Mitigation**:
- Build incrementally (test after each Lambda deployed)
- Use EventBridge event inspection (AWS Console)
- Enable X-Ray tracing for distributed debugging
- Create integration test suite early (Week 2)

### Risk 3: Context Loss Between Sessions
**Mitigation**:
- Update PROJECT_CONTEXT.md after major milestones
- Document architectural decisions in ADR format
- Use consistent naming conventions (easier to regenerate)
- Store all prompts in `prompts/` directory for reuse

### Risk 4: Scope Creep
**Mitigation**:
- Strictly follow incremental roadmap (no feature additions)
- Defer "nice-to-have" features to Maturity Level 2
- Focus on POC success criteria (10 candidates, 1 department, 2 managers)
- Timebox each week (move to next phase even if not perfect)

---

## Learning Checkpoints

### After Week 4 (Stage 1-3 Complete)
**Reflect**:
- What patterns worked well?
- What was harder than expected?
- How can prompts be improved?
- What should be refactored before Stage 6-8?

**Adjust Roadmap**:
- Update time estimates for Weeks 5-8
- Identify reusable patterns
- Document lessons learned in PROJECT_CONTEXT.md

### After Week 8 (Stage 1-8 Complete)
**Reflect**:
- Is Step Functions complexity justified?
- Should any workflows be simplified?
- Are SLA thresholds realistic?
- Is cost tracking on target?

**Adjust Roadmap**:
- Update time estimates for Weeks 9-12
- Optimize expensive components (if needed)
- Document lessons learned

### After Week 12 (All Stages Complete)
**Reflect**:
- What would you do differently next time?
- Which AI prompts were most effective?
- What patterns should be codified?
- Is the architecture production-ready?

**Next Steps**:
- Plan Maturity Level 1 migration (production deployment)
- Document POC learnings in retrospective
- Prepare presentation for stakeholders

---

## Next Steps

1. ✅ Review incremental delivery roadmap
2. ⏸️ Start Week 1: Deploy infrastructure (Terraform)
3. ⏸️ Generate Lambda code (AI-assisted)
4. ⏸️ Deploy Lambda functions
5. ⏸️ Test end-to-end flow
6. ⏸️ Update PROJECT_CONTEXT.md with progress

---

**End of Incremental Delivery Roadmap**

---
---

## 🆕 v2.0 Addendum: Metadata-Lite Architecture Roadmap Updates

> **Added**: 2026-05-15
> **Document Version**: 2.0
> **Context**: MVP1 evolved to Metadata-Lite architecture (externalized Variable Six)
> **See**: MVP1-FOUNDATION-PLAN-v2.md (complete execution plan), PROJECT_CONTEXT.md (Session Checkpoint 2026-05-15)

---

### What Changed in v2.0

**v1.0 Roadmap**:
- **Phase 1**: Stage 1-3 (Weeks 1-4)
- **Phase 2**: Stage 4-5 (Weeks 5-6)
- **Phase 3**: Stage 6-8 (Weeks 7-8)
- **Phase 4**: Stage 9-12 (Weeks 9-12)
- **Total**: 12 weeks

**v2.0 Roadmap** (Metadata-Lite):
- **MVP1**: Stage 1-3 + **Config Management** (Weeks 1-7) ← **+1 week**
- **MVP2**: Stage 4-5 + **Remaining Config UI** (Weeks 8-11)
- **MVP3**: Stage 6-8 + **Multi-Tenancy** (Weeks 12-17)
- **MVP4**: Stage 9-12 + **AI Config Assistant** (Weeks 18-21)
- **Total**: 21 weeks (was 12 weeks, but with config management foundation)

**Why the Change**: Config management layer added to MVP1 (proves metadata-lite thesis before expanding to more stages).

---

### Updated Phase 1: MVP1 (Weeks 1-7) — Stage 1-3 + Config Management

**v1.0**: Stage 1-3 in 4 weeks
**v2.0**: Stage 1-3 + Config Management in **7 weeks** (+3 weeks for config layer)

**New Deliverables (v2.0)**:
- ✅ Config DynamoDB table (`talent-flow-config` with GSI1, TTL)
- ✅ Config-manager Lambda (admin API with versioning)
- ✅ config-reader.js shared utility (5-min caching)
- ✅ Admin UI for 3 of 6 Variable Six (scoring, SLA, panel rules)
- ✅ Updated 5 Lambdas to read config (workflow-orchestrator, interview-scheduler, vote-processor, notification-service, sla-monitor)
- ✅ Seed data script (initialize default configs)
- ✅ Integration tests for versioning (verify in-flight candidates unaffected)

---

### Updated Week 1-2: Infrastructure + Core Services + **Config Foundation**

#### Day 1-2: Foundation Setup (Updated)

**v1.0 Tasks**:
- Create S3 bucket for Terraform state
- Deploy EventBridge bus
- Deploy 3 DynamoDB tables (candidate-pipeline, event-ledger, workflow-state)
- Configure IAM roles

**v2.0 Tasks** (updated):
- Create S3 bucket for Terraform state
- Deploy EventBridge bus
- Deploy **4 DynamoDB tables** (add talent-flow-config) ← **NEW**
- Configure IAM roles (all Lambdas need config table read access) ← **UPDATED**
- **Create seed data script** ← **NEW**

**New AI Prompt**:
```
Generate Terraform code to:
1. Create DynamoDB table "talent-flow-config" with:
   - Hash key: PK (String)
   - Range key: SK (String)
   - PAY_PER_REQUEST billing
   - GSI1: GSI1PK, GSI1SK (for active config queries)
   - TTL enabled on "expiresAt" attribute
   - Encryption at rest enabled

2. Output table name and ARN for Lambda environment variables

Use reusable modules from terraform/modules/dynamodb-table/
```

**Validation** (updated):
```bash
# Verify 4 tables (not 3)
aws dynamodb list-tables | grep talent-flow

# Verify config table GSI
aws dynamodb describe-table --table-name talent-flow-config | grep GSI1

# Seed default configs
CONFIG_TABLE_NAME=talent-flow-config node scripts/seed-config.js

# Verify configs seeded
aws dynamodb query \
  --table-name talent-flow-config \
  --index-name GSI1 \
  --key-condition-expression "GSI1PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"TENANT#DEFAULT#ACTIVE"}}'
```

**Deliverable**: ✅ 4 DynamoDB tables deployed, configs seeded

---

#### Day 3-5: Core Lambda Functions (Updated)

**v1.0 Tasks**:
- Deploy API Handler Lambda
- Deploy Workflow Orchestrator Lambda
- Test event flow

**v2.0 Tasks** (updated):
- Deploy API Handler Lambda (no config needed)
- Deploy Workflow Orchestrator Lambda ← **UPDATED: Captures configVersion**
- **Deploy config-manager Lambda** ← **NEW**
- **Create config-reader.js shared utility** ← **NEW**
- Test event flow + config reads

**New AI Prompt** (config-manager):
```
Generate Node.js Lambda function "config-manager" with:

**Endpoints**:
- GET /config/{configType} — Get active config
- PUT /config/{configType} — Update config (creates new version)
- GET /config/{configType}/history — Get audit trail
- GET /config — List all active configs

**Versioning Logic** (CRITICAL):
1. Mark old version inactive (set isActive=false, expiresAt=+365 days, remove from GSI1)
2. Create new version (increment version, set isActive=true, add to GSI1)
3. Return new version details

**Technical Requirements**:
- AWS SDK v3 (DynamoDB)
- Admin-only access (check isAdmin claim in JWT)
- Input validation (config data must match schema)
- Structured logging (JSON with tenantId, configType, version)

**Environment Variables**:
- CONFIG_TABLE_NAME
- LOG_LEVEL

Follow LAMBDA_CATALOG.md v2.0 Addendum for complete spec
```

**New AI Prompt** (config-reader.js):
```
Generate shared utility "config-reader.js" with:

**Exports**:
- getActiveConfig(tenantId, configType) — Query GSI1 for active config
- getConfigVersion(tenantId, configType, version) — GetItem for specific version

**Caching**:
- In-memory Map with 5-min TTL
- Cache key: `${tenantId}#${configType}#${version || 'ACTIVE'}`
- 95% cache hit rate reduces DynamoDB reads

**Fallback**:
- Return default values if config not found
- Log warning but don't throw (defensive coding)

Follow LAMBDA_CATALOG.md v2.0 Addendum for complete implementation
```

**Updated Validation**:
```bash
# Test config-manager
curl -X PUT https://api.talentflow.com/config/SCORING_WEIGHTS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"data": {"technical": 0.25, "communication": 0.25, "culturalFit": 0.30, "problemSolving": 0.20}}'

# Verify new version created
curl https://api.talentflow.com/config/SCORING_WEIGHTS/history

# Test workflow-orchestrator captures configVersion
aws lambda invoke --function-name workflow-orchestrator \
  --payload '{"detail": {"candidateId": "CAND-123", "tenantId": "DEFAULT"}}' \
  response.json

# Verify configVersion captured
aws dynamodb get-item --table-name workflow-state \
  --key '{"PK": {"S": "WORKFLOW#..."}, "SK": {"S": "METADATA"}}' \
  | grep configVersion
```

**Deliverable**: ✅ 8 Lambdas deployed (was 7), config reads working

---

### New Week: Week 4-5 — Admin UI for Config Management

**What's New in v2.0**: Full 2-week sprint dedicated to building admin UI for 3 of 6 Variable Six.

**Goals**:
- Build admin UI pages (Angular Material + TailwindCSS)
- Integrate with config-manager API
- Test config changes end-to-end
- Verify versioning protection (integration tests)

---

#### Day 16-18: Scoring Weights Config UI

**Tasks**:
- [ ] **Generate Angular component**: `ScoringWeightsConfigComponent`
  - Form fields: Technical, Communication, Cultural Fit, Problem Solving (sliders, 0-100%)
  - Custom validator: Sum must equal 100%
  - Real-time sum calculation display
  - GET /config/SCORING_WEIGHTS on load
  - PUT /config/SCORING_WEIGHTS on save
  - GET /config/SCORING_WEIGHTS/history for audit trail table

**AI Prompt**:
```
Generate Angular 17 standalone component "ScoringWeightsConfigComponent" for route /admin/config/scoring-weights.

**Form Fields**:
- technicalWeight (mat-slider, 0-100, step 1, default 30)
- communicationWeight (mat-slider, 0-100, step 1, default 25)
- culturalFitWeight (mat-slider, 0-100, step 1, default 25)
- problemSolvingWeight (mat-slider, 0-100, step 1, default 20)

**Custom Validator**:
- Sum of all weights must equal 100
- Show error message if sum ≠ 100: "Total must be 100% (currently: {{sum}}%)"
- Disable Save button if invalid

**UI Components**:
- Angular Material: mat-card, mat-form-field, mat-slider, mat-button
- Display current version number: "Version 3 (Active)"
- Warning banner: "Changes will apply to new candidates only (in-flight candidates unaffected)"
- Success toast on save: "Config updated to version 4. Changes take effect in 5 minutes."

**API Calls**:
- Load: GET /api/config/SCORING_WEIGHTS
- Save: PUT /api/config/SCORING_WEIGHTS
- History: GET /api/config/SCORING_WEIGHTS/history (show table below form)

**Auth**: AdminGuard (requires isAdmin: true)

Follow AI_DEVELOPMENT_GUIDE.md v2.0 Addendum for patterns
```

**Validation**:
```bash
# Run Angular dev server
ng serve

# Navigate to http://localhost:4200/admin/config/scoring-weights

# Test form validation (change weights to sum to 98%)
# → Save button should be disabled

# Test form save (change weights to sum to 100%)
# → Should show success toast
# → Version number should increment

# Verify in DynamoDB
aws dynamodb query --table-name talent-flow-config \
  --index-name GSI1 \
  --key-condition-expression "GSI1PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"TENANT#DEFAULT#ACTIVE"}}'
```

**Deliverable**: ✅ Scoring weights config UI working

---

#### Day 19-21: SLA Thresholds + Panel Rules Config UI

**Tasks**:
- [ ] **Generate**: `SLAThresholdsConfigComponent`
  - Form fields: First Engagement (hours), Evaluation (hours), Offer Gen (hours), Offer Accept (hours)
  - Validation: Must be positive integers
  - Note: "SLA changes apply to all candidates (including in-flight)"

- [ ] **Generate**: `PanelRulesConfigComponent`
  - Form fields: Min size, Max size, Veto power (toggle), Size by level (Junior, Mid, Senior, Staff, Principal)
  - Validation: Min ≤ Max, sizes within min/max bounds

**AI Prompt** (similar structure, different fields):
```
Generate Angular 17 standalone component "SLAThresholdsConfigComponent" for route /admin/config/sla-thresholds.

**Form Fields**:
- firstEngagement (mat-input, type="number", min=1, default=48)
- evaluationCompletion (mat-input, type="number", min=1, default=72)
- offerGeneration (mat-input, type="number", min=1, default=24)
- offerAcceptance (mat-input, type="number", min=1, default=168)

**UI Notes**:
- Note banner: "SLA changes apply to all candidates (including in-flight)"
- Display in hours with "(hours)" label

**API Calls**: Same pattern as scoring weights

Follow AI_DEVELOPMENT_GUIDE.md v2.0 Addendum
```

**Deliverable**: ✅ All 3 admin UI pages working

---

#### Day 22-23: Integration Tests for Config Versioning

**Tasks**:
- [ ] **Write integration test**: Verify in-flight candidates unaffected by config changes
- [ ] **Write integration test**: Verify new candidates use new config
- [ ] **Write integration test**: Verify STRONG_NO veto logic (configurable toggle)

**Test Spec** (from LAMBDA_CATALOG.md v2.0 Addendum):
```javascript
// test/integration/config-versioning.test.js
it('should lock in-flight candidates to config version at creation', async () => {
  // Step 1: Create candidate Sarah (locks to v1: Tech 30%)
  const sarah = await createCandidate('Sarah Chen', 'Software Engineer');
  expect(sarah.workflow.configVersion).toBe(1);

  // Step 2: Change config to v2 (Tech 25%, Cultural 30%)
  await updateConfig('SCORING_WEIGHTS', { technical: 0.25, ..., culturalFit: 0.30 });

  // Step 3: Submit votes for Sarah
  await submitVote(sarah.candidateId, { technical: 8, communication: 7, culturalFit: 9, problemSolving: 8 });

  // Step 4: Verify Sarah's score uses v1 weights (Tech 30%)
  const sarahScore = await getScore(sarah.candidateId);
  expect(sarahScore.overall).toBe(8.0);  // 8*0.30 + 7*0.25 + 9*0.25 + 8*0.20

  // Step 5: Create new candidate John (locks to v2: Tech 25%)
  const john = await createCandidate('John Doe', 'Software Engineer');
  expect(john.workflow.configVersion).toBe(2);

  // Step 6: Submit identical votes for John
  await submitVote(john.candidateId, { technical: 8, communication: 7, culturalFit: 9, problemSolving: 8 });

  // Step 7: Verify John's score uses v2 weights (Tech 25%)
  const johnScore = await getScore(john.candidateId);
  expect(johnScore.overall).toBe(8.15);  // 8*0.25 + 7*0.25 + 9*0.30 + 8*0.20

  // ✅ PASS: Two candidates, two versions, both correct
});
```

**Deliverable**: ✅ Integration tests pass (config versioning works)

---

### Updated Week 6-7: Update Existing Lambdas + Polish

**v1.0**: Week 4 was polish + hardening
**v2.0**: Week 6-7 is updating existing Lambdas to read config + polish

---

#### Day 24-26: Update 5 Lambdas to Read Config

**Tasks**:
- [ ] **Update workflow-orchestrator**: Capture configVersion at workflow creation
- [ ] **Update interview-scheduler**: Read PANEL_RULES for dynamic panel size
- [ ] **Update vote-processor**: Read SCORING_WEIGHTS, PANEL_RULES (for veto)
- [ ] **Update notification-service**: Read NOTIFICATION_TEMPLATES
- [ ] **Update sla-monitor**: Read SLA_THRESHOLDS

**AI Prompt Example** (vote-processor):
```
Update Lambda function "vote-processor" to read config from config table.

**Changes Required**:
1. Import config-reader.js: `const { getConfigVersion } = require('./config-reader');`

2. Get workflow to find locked config version:
   ```javascript
   const workflow = await dynamodb.get({
     TableName: process.env.WORKFLOW_TABLE_NAME,
     Key: { PK: `WORKFLOW#${workflowId}`, SK: 'METADATA' }
   }).promise();
   ```

3. Read SCORING_WEIGHTS config (versioned):
   ```javascript
   const scoringConfig = await getConfigVersion(
     workflow.Item.tenantId,
     'SCORING_WEIGHTS',
     workflow.Item.configVersion  // Locked to version
   );
   ```

4. Read PANEL_RULES config (versioned):
   ```javascript
   const panelConfig = await getConfigVersion(
     workflow.Item.tenantId,
     'PANEL_RULES',
     workflow.Item.configVersion
   );
   ```

5. Calculate overall score using config weights:
   ```javascript
   const overall =
     vote.technical * scoringConfig.data.technical +
     vote.communication * scoringConfig.data.communication +
     vote.culturalFit * scoringConfig.data.culturalFit +
     vote.problemSolving * scoringConfig.data.problemSolving;
   ```

6. Check for STRONG_NO veto:
   ```javascript
   if (panelConfig.data.vetoPowerEnabled && vote.recommendation === 'STRONG_NO') {
     return { recommendation: 'NO_HIRE', vetoApplied: true, ... };
   }
   ```

**Environment Variables**:
- Add CONFIG_TABLE_NAME

**Terraform**:
- Add IAM permission: dynamodb:Query on talent-flow-config table + GSI1

Follow LAMBDA_CATALOG.md v2.0 Addendum for complete spec
```

**Deliverable**: ✅ All 5 Lambdas updated, config reads working

---

#### Day 27-30: Polish, Hardening, Demo Prep

**Tasks** (same as v1.0, plus config demo):
- [ ] Run full integration test suite
- [ ] Fix any bugs discovered
- [ ] Polish admin UI (loading states, error messages)
- [ ] **NEW**: Prepare config change demo (Scene 5b)
  - Show current config (Tech 30%)
  - Change config (Tech 25%, Cultural 30%)
  - Create 2 candidates (before + after config change)
  - Prove versioning works (different scores for same votes)

**Demo Script** (from MVP1-FOUNDATION-PLAN-v2.md):
```
Scene 5b: Live Configuration Change (6 minutes)

1. HR Director logs into Admin UI (/admin/config/scoring-weights)
2. Shows current config: Tech 30%, Comm 25%, Cultural 25%, Problem 20%
3. Changes to: Tech 25%, Comm 25%, Cultural 30%, Problem 20%
4. Saves → System shows "Config updated to version 4"
5. BA creates candidate John Doe (locks to v4)
6. Compare scores:
   - Sarah Chen (created with v3): 7.375
   - John Doe (created with v4): 7.05
7. Narrator: "Same votes, different scores — proves versioning works"
```

**Deliverable**: ✅ MVP1 complete, ready for demo

---

### Updated Phase 2: MVP2 (Weeks 8-11) — Stage 4-5 + Remaining Config UI

**v1.0**: Stage 4-5 in 2 weeks
**v2.0**: Stage 4-5 + Remaining Config UI (3 of 6) in **4 weeks**

**New Deliverables (v2.0)**:
- ✅ Admin UI for remaining 3 Variable Six (approval rules, notification templates, stage enablement)
- ✅ Step Functions state machines (offer approval, background checks)
- ✅ Updated Step Functions Lambdas to read config (send-approval-request, send-offer-email)

**Why 4 Weeks**: Building 3 more config UIs (each 3-4 days) + Step Functions (5 days) + testing (3 days)

---

### Updated Phase 3: MVP3 (Weeks 12-17) — Stage 6-8 + Multi-Tenancy

**v1.0**: Stage 6-8 in 2 weeks
**v2.0**: Stage 6-8 + Multi-Tenancy in **6 weeks**

**New Deliverables (v2.0)**:
- ✅ Tenant selection UI (admin chooses tenant before editing config)
- ✅ Tenant-specific config isolation (Banking config ≠ Agriculture config)
- ✅ Config import/export (bulk tenant setup)
- ✅ Config comparison tool (side-by-side diff)
- ✅ Role-based access (tenant admins can only edit their own configs)

**Why 6 Weeks**: Multi-tenancy is complex (authentication, authorization, data isolation, testing)

---

### Updated Phase 4: MVP4 (Weeks 18-21) — Stage 9-12 + AI Config Assistant

**v1.0**: Stage 9-12 in 4 weeks
**v2.0**: Stage 9-12 + AI Config Assistant in **4 weeks**

**New Deliverables (v2.0)**:
- ✅ AI config assistant chat UI
- ✅ Natural language config parsing ("Change SLA to 24 hours" → proposes config change)
- ✅ Config anomaly detection (flags unusual changes)
- ✅ Config recommendations (suggests optimizations)
- ✅ One-click rollback (revert to previous version)

**Why Same Duration**: AI config assistant is mostly prompt engineering (LangChain + Claude API), less infrastructure work

---

### Summary of v2.0 Roadmap Changes

| Phase | v1.0 Duration | v2.0 Duration | Difference | Key Additions |
|-------|---------------|---------------|------------|---------------|
| **MVP1** | 4 weeks | **7 weeks** | +3 weeks | Config management (3 of 6), versioning, admin UI |
| **MVP2** | 2 weeks | **4 weeks** | +2 weeks | Remaining config UI (3 of 6), Step Functions config-driven |
| **MVP3** | 2 weeks | **6 weeks** | +4 weeks | Multi-tenancy, tenant isolation, config import/export |
| **MVP4** | 4 weeks | **4 weeks** | No change | AI config assistant, anomaly detection, recommendations |
| **Total** | **12 weeks** | **21 weeks** | **+9 weeks** | Full config management evolution |

**Trade-Off**: v2.0 takes +9 weeks total, but saves R1.06M per vertical (payback with vertical 2).

---

### Vertical Expansion Timeline (v2.0)

**After MVP1 Complete** (Week 7):
- Software vertical live (7 weeks build)
- Banking vertical: **2 days** (config changes only)
- Agriculture vertical: **2 days** (config changes only)

**After MVP2 Complete** (Week 11):
- All config UI complete (6 of 6)
- Banking vertical: **1 day** (faster with full UI)
- Agriculture vertical: **1 day**

**After MVP3 Complete** (Week 17):
- Multi-tenancy live
- Banking vertical: **1 day** (tenant setup + config)
- Agriculture vertical: **1 day**

**After MVP4 Complete** (Week 21):
- AI config assistant live
- Banking vertical: **30 minutes** (AI proposes config, human approves)
- Agriculture vertical: **30 minutes**

---

### Updated Success Criteria

**MVP1 (Week 7)**:
- ✅ 10 candidates through Stage 1-3
- ✅ Config change via admin UI (live demo)
- ✅ Versioning test passes (in-flight candidates unaffected)
- ✅ All 8 Lambdas deployed, config reads working
- ✅ Cost <$50/month

**MVP2 (Week 11)**:
- ✅ 10 candidates through Stage 4-5 (offers generated)
- ✅ All 6 Variable Six have admin UI
- ✅ Step Functions workflows config-driven

**MVP3 (Week 17)**:
- ✅ 2 tenants live (Software + Banking)
- ✅ Tenant isolation verified (config changes don't affect other tenant)

**MVP4 (Week 21)**:
- ✅ AI config assistant working ("Change SLA to 24h" → deployed in 30 seconds)
- ✅ 3+ tenants live, each with unique configs

---

**v2.0 Addendum Complete**
**Last Updated**: 2026-05-15
**Related Documents**:
- MVP1-FOUNDATION-PLAN-v2.md (complete 7-week execution plan)
- TALENT_FLOW_POC_ARCHITECTURE.md v2.0 Addendum (updated component count)
- TALENT_FLOW_MATURITY_LEVELS.md v2.0 Addendum (evolution path)
- PROJECT_CONTEXT.md (Session Checkpoint 2026-05-15)
