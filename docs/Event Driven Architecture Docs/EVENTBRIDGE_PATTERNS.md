# EventBridge Event Routing Patterns

> **Purpose**: Complete EventBridge event catalog and routing patterns for Talent Flow POC
> **Audience**: Developers, Integration architects
> **Status**: v1.0 - Implementation Ready

---

## Executive Summary

This document defines all EventBridge events, routing rules, and integration patterns for the Talent Flow Platform POC (Stage 1-3: Evaluation Intelligence).

**Key Characteristics:**
- ✅ Event-driven architecture (async, decoupled)
- ✅ Content-based routing (filter by event attributes)
- ✅ Fan-out pattern (one event → multiple consumers)
- ✅ Idempotent event handling
- ✅ Correlation ID tracing

---

## Table of Contents

1. [Event Bus Architecture](#event-bus-architecture)
2. [Event Catalog](#event-catalog)
3. [Event Schemas](#event-schemas)
4. [Routing Rules](#routing-rules)
5. [Fan-Out Patterns](#fan-out-patterns)
6. [Content-Based Routing](#content-based-routing)
7. [Integration Patterns](#integration-patterns)
8. [Error Handling](#error-handling)
9. [Testing Strategy](#testing-strategy)

---

## Event Bus Architecture

### Custom Event Bus

```
talent-flow-events (Custom Event Bus)
    ↓
EventBridge Rules (content-based routing)
    ↓ ↓ ↓ ↓ ↓
   /  |  |  |  \
Targets: Lambda, SQS, SNS, Step Functions
```

**Configuration:**
```yaml
Name: talent-flow-events
Type: Custom Event Bus
Archive: Disabled (POC), Enabled at Level 1
Retention: 7 days (default)
Schema Registry: Disabled (POC), Enabled at Level 1
```

**Why Custom Event Bus (Not Default):**
- ✅ Isolates Talent Flow events from other AWS service events
- ✅ Enables independent event archive/replay policies
- ✅ Clearer IAM permissions (scoped to this bus)
- ✅ Matches HADES pattern (dedicated Kafka topics)

---

## Event Catalog

### Stage 1-3: Evaluation Intelligence Events

| Event Name | Source | Published By | Consumed By | Frequency |
|------------|--------|--------------|-------------|-----------|
| `CandidateCreated` | talent-flow.candidates | API Handler | Workflow Orchestrator, Audit Logger, Notification Service | 1k/day |
| `CandidateUpdated` | talent-flow.candidates | API Handler | Audit Logger | 2k/day |
| `InterviewScheduled` | talent-flow.interviews | API Handler | Interview Scheduler, Notification Service, Audit Logger | 2k/day |
| `InterviewConducted` | talent-flow.interviews | Interview Scheduler | Audit Logger | 2k/day |
| `VoteSubmitted` | talent-flow.evaluations | API Handler | Vote Processor, Audit Logger | 6k/day (3 votes × 2 interviews) |
| `VotingCompleted` | talent-flow.evaluations | Vote Processor | Evaluation Completer, Notification Service, Audit Logger | 2k/day |
| `EvaluationCompleted` | talent-flow.evaluations | Evaluation Completer | Workflow Orchestrator, Audit Logger | 1k/day |
| `WorkflowStageStarted` | talent-flow.workflows | Workflow Orchestrator | Audit Logger | 3k/day (3 stages) |
| `WorkflowStageCompleted` | talent-flow.workflows | Feedback Aggregator | Workflow Orchestrator, Step Functions, Audit Logger | 3k/day |
| `FeedbackReceived` | talent-flow.feedback | Domain Lambdas | (published to SQS, not EventBridge) | 10k/day |
| `SLABreached` | talent-flow.sla | SLA Monitor | Notification Service, Audit Logger | 50/day (estimated) |

**Total Events**: ~29k events/day = 870k events/month

**Cost**: First 1M events/month FREE = **$0/month** ✅

---

### Future Events (Stage 6-8: Offer Orchestration)

| Event Name | Source | Purpose |
|------------|--------|---------|
| `OfferCreated` | talent-flow.offers | Offer initiated |
| `OfferApproved` | talent-flow.offers | Manager/HR approval |
| `OfferSent` | talent-flow.offers | Sent to candidate |
| `OfferAccepted` | talent-flow.offers | Candidate accepted |
| `OfferRejected` | talent-flow.offers | Candidate rejected |
| `ProvisioningStarted` | talent-flow.provisioning | IT provisioning triggered |
| `ProvisioningCompleted` | talent-flow.provisioning | Laptop, email, access ready |
| `EngagementScheduled` | talent-flow.engagement | Manager call scheduled |
| `EngagementCompleted` | talent-flow.engagement | Touchpoint completed |
| `Day1Activated` | talent-flow.onboarding | Candidate started |

---

## Event Schemas

### Base Event Structure

All events follow this envelope:

```json
{
  "Source": "talent-flow.{domain}",
  "DetailType": "{EntityName}{Action}",
  "Detail": {
    // Event-specific payload
    "correlationId": "corr-uuid",
    "timestamp": "ISO-8601",
    "userId": "USER-001" (optional),
    "serviceId": "lambda-function-name"
  },
  "Time": "ISO-8601"
}
```

**Key Fields:**
- `Source`: Domain identifier (e.g., `talent-flow.candidates`)
- `DetailType`: Event name (past tense, e.g., `CandidateCreated`)
- `Detail`: Event payload (varies by event type)
- `Time`: EventBridge auto-populated timestamp

---

### Event Schema: CandidateCreated

```json
{
  "Source": "talent-flow.candidates",
  "DetailType": "CandidateCreated",
  "Detail": {
    "candidateId": "CAND-123",
    "workflowId": "WF-456",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "phone": "+27821234567",
    "position": "Software Engineer",
    "departmentId": "DEPT-ENG-01",
    "source": "LINKEDIN",
    "sentiment": "EXCITED",
    "correlationId": "corr-abc-123",
    "timestamp": "2026-05-10T10:30:00Z",
    "userId": "USER-001",
    "serviceId": "api-handler"
  },
  "Time": "2026-05-10T10:30:00Z"
}
```

**Consumers:**
1. Workflow Orchestrator (creates saga)
2. Audit Logger (writes to event-ledger)
3. Notification Service (welcome email)

---

### Event Schema: VoteSubmitted

```json
{
  "Source": "talent-flow.evaluations",
  "DetailType": "VoteSubmitted",
  "Detail": {
    "candidateId": "CAND-123",
    "interviewId": "INT-456",
    "interviewType": "INTERVIEW_1",
    "voterId": "USER-001",
    "voterName": "Jane Smith",
    "voterEmail": "jane.smith@company.com",
    "technicalScore": 9,
    "communicationScore": 8,
    "culturalFitScore": 9,
    "problemSolvingScore": 8,
    "recommendation": "STRONG_YES",
    "notes": "Excellent coding skills",
    "submittedAt": "2026-05-15T11:00:00Z",
    "correlationId": "corr-abc-123",
    "timestamp": "2026-05-15T11:00:00Z",
    "userId": "USER-001",
    "serviceId": "api-handler"
  },
  "Time": "2026-05-15T11:00:00Z"
}
```

**Consumers:**
1. Vote Processor (aggregates votes, calculates scores)
2. Audit Logger (compliance record)

---

### Event Schema: VotingCompleted

```json
{
  "Source": "talent-flow.evaluations",
  "DetailType": "VotingCompleted",
  "Detail": {
    "candidateId": "CAND-123",
    "workflowId": "WF-456",
    "interviewId": "INT-456",
    "interviewType": "INTERVIEW_1",
    "voteCount": 3,
    "scores": {
      "technical": 8.67,
      "communication": 8.33,
      "culturalFit": 9.0,
      "problemSolving": 8.0,
      "overall": 8.5
    },
    "recommendation": "PROCEED", // or "REJECT"
    "calculatedAt": "2026-05-15T11:30:00Z",
    "correlationId": "corr-abc-123",
    "timestamp": "2026-05-15T11:30:00Z",
    "serviceId": "vote-processor"
  },
  "Time": "2026-05-15T11:30:00Z"
}
```

**Consumers:**
1. Evaluation Completer (marks stage complete, triggers next stage)
2. Notification Service (notifies hiring manager)
3. Audit Logger

---

### Event Schema: WorkflowStageStarted

```json
{
  "Source": "talent-flow.workflows",
  "DetailType": "WorkflowStageStarted",
  "Detail": {
    "workflowId": "WF-456",
    "candidateId": "CAND-123",
    "stage": "INTERVIEW_1",
    "startedAt": "2026-05-10T10:30:00Z",
    "slaDueAt": "2026-05-12T10:30:00Z",
    "trackers": [
      {
        "domain": "SCHEDULING",
        "slaDueAt": "2026-05-11T10:30:00Z"
      },
      {
        "domain": "VOTING",
        "slaDueAt": "2026-05-17T10:30:00Z"
      }
    ],
    "correlationId": "corr-abc-123",
    "timestamp": "2026-05-10T10:30:00Z",
    "serviceId": "workflow-orchestrator"
  },
  "Time": "2026-05-10T10:30:00Z"
}
```

**Consumers:**
1. Audit Logger
2. (Future: Domain Lambdas that need to react to stage start)

---

### Event Schema: SLABreached

```json
{
  "Source": "talent-flow.sla",
  "DetailType": "SLABreached",
  "Detail": {
    "workflowId": "WF-456",
    "candidateId": "CAND-123",
    "stage": "INTERVIEW_1",
    "domain": "VOTING",
    "slaType": "VOTING_48H",
    "slaDueAt": "2026-05-17T10:05:00Z",
    "hoursElapsed": 48,
    "escalationLevel": "MANAGER",
    "escalationCount": 1,
    "assignedTo": "MANAGER-456",
    "correlationId": "corr-abc-123",
    "timestamp": "2026-05-17T10:05:00Z",
    "serviceId": "sla-monitor"
  },
  "Time": "2026-05-17T10:05:00Z"
}
```

**Consumers:**
1. Notification Service (sends escalation email)
2. Audit Logger

---

## Routing Rules

### EventBridge Rule Structure

```yaml
Rule Name: {event-type}-to-{target}
Event Pattern: { filter criteria }
Target: Lambda | SQS | SNS | Step Functions
Input Transformer: Optional (reshape payload)
Dead Letter Queue: Enabled (SQS DLQ)
Retry Policy: 3 retries, exponential backoff
```

---

### Rule 1: candidate-created-to-orchestrator

**Purpose**: Create workflow saga when candidate is created

```json
{
  "source": ["talent-flow.candidates"],
  "detail-type": ["CandidateCreated"]
}
```

**Target**: Lambda (workflow-orchestrator)

**Input**: Full event (no transformation)

**Terraform:**
```hcl
resource "aws_cloudwatch_event_rule" "candidate_created" {
  name           = "candidate-created-to-orchestrator"
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  event_pattern = jsonencode({
    source      = ["talent-flow.candidates"]
    detail-type = ["CandidateCreated"]
  })
}

resource "aws_cloudwatch_event_target" "workflow_orchestrator" {
  rule           = aws_cloudwatch_event_rule.candidate_created.name
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  arn            = aws_lambda_function.workflow_orchestrator.arn
  retry_policy {
    maximum_retry_attempts = 3
  }
  dead_letter_config {
    arn = aws_sqs_queue.event_dlq.arn
  }
}
```

---

### Rule 2: interview-scheduled-to-scheduler

**Purpose**: Send calendar invites when interview is scheduled

```json
{
  "source": ["talent-flow.interviews"],
  "detail-type": ["InterviewScheduled"]
}
```

**Target**: Lambda (interview-scheduler)

---

### Rule 3: vote-submitted-to-processor

**Purpose**: Process evaluation votes and check completion

```json
{
  "source": ["talent-flow.evaluations"],
  "detail-type": ["VoteSubmitted"]
}
```

**Target**: Lambda (vote-processor)

---

### Rule 4: voting-completed-to-completer

**Purpose**: Mark evaluation stage complete

```json
{
  "source": ["talent-flow.evaluations"],
  "detail-type": ["VotingCompleted"]
}
```

**Target**: Lambda (evaluation-completer)

---

### Rule 5: all-events-to-audit-ledger

**Purpose**: Log ALL events to audit trail

```json
{
  "source": [{"prefix": "talent-flow."}]
}
```

**Target**: Lambda (audit-logger) → DynamoDB (event-ledger)

**Why Catch-All:**
- ✅ Single rule captures all events
- ✅ Ensures no events are missed
- ✅ Compliance requirement (audit everything)

---

### Rule 6: notifications

**Purpose**: Send notifications for specific events

```json
{
  "source": ["talent-flow.candidates", "talent-flow.interviews", "talent-flow.sla"],
  "detail-type": ["CandidateCreated", "InterviewScheduled", "VotingCompleted", "SLABreached"]
}
```

**Target**: Lambda (notification-service)

**Why Combined Rule:**
- ✅ Single Lambda handles all notification types
- ✅ Reduces rule count
- ✅ Simpler routing logic

---

## Fan-Out Patterns

### Pattern 1: Single Event → Multiple Consumers

**Example: CandidateCreated Event**

```
CandidateCreated event published
    ↓
EventBridge (talent-flow-events bus)
    ↓
    ├──> Rule 1: candidate-created-to-orchestrator
    │        └──> Lambda: Workflow Orchestrator
    │
    ├──> Rule 5: all-events-to-audit-ledger
    │        └──> Lambda: Audit Logger
    │
    └──> Rule 6: notifications
             └──> Lambda: Notification Service
```

**Result**: 3 independent Lambdas invoked in parallel

**Key Benefits:**
- ✅ Decoupled (each consumer independent)
- ✅ Parallel execution (no blocking)
- ✅ Independent retry logic (if one fails, others succeed)

---

### Pattern 2: Event → SNS Fan-Out → Multiple SQS Queues

**Use Case**: High-volume events with multiple consumers

**Example: VotingCompleted → Analytics + Reporting + Notifications**

```
VotingCompleted event
    ↓
EventBridge Rule
    ↓
SNS Topic: voting-completed-topic
    ↓ ↓ ↓
   /  |  \
SQS  SQS  SQS
 ↓    ↓    ↓
λ    λ    λ
Analytics Reporting Notifs
```

**When to Use:**
- High-volume events (>1000/sec)
- Multiple independent consumers
- Need buffering (SQS queues)
- Need replay capability (SQS retention)

**POC Decision**: Not needed (EventBridge → Lambda direct is sufficient)

---

## Content-Based Routing

### Pattern: Route by Event Attributes

**Use Case**: SLA breach escalation routing based on severity

```json
// Rule: sla-breach-manager-escalation
{
  "source": ["talent-flow.sla"],
  "detail-type": ["SLABreached"],
  "detail": {
    "escalationLevel": ["MANAGER"]
  }
}
→ Target: SNS Topic (Manager Escalation)

// Rule: sla-breach-hr-escalation
{
  "source": ["talent-flow.sla"],
  "detail-type": ["SLABreached"],
  "detail": {
    "escalationLevel": ["HR"]
  }
}
→ Target: SNS Topic (HR Escalation)

// Rule: sla-breach-leadership-escalation
{
  "source": ["talent-flow.sla"],
  "detail-type": ["SLABreached"],
  "detail": {
    "escalationLevel": ["LEADERSHIP"]
  }
}
→ Target: SNS Topic (Leadership Escalation) + PagerDuty
```

**Key Benefit**: No routing logic in code. EventBridge handles it declaratively.

---

### Pattern: Route by Sentiment (Risk Detection)

**Use Case**: HESITANT offers trigger immediate HR intervention

```json
// Rule: hesitant-offer-escalation
{
  "source": ["talent-flow.offers"],
  "detail-type": ["OfferAccepted"],
  "detail": {
    "sentiment": ["HESITANT"]
  }
}
→ Target: Lambda (create-hr-intervention-task)
```

**Matches HADES Pattern**: Content-based routing in EventBridge rules (not Kafka consumers)

---

## Integration Patterns

### Pattern 1: EventBridge → Lambda (Async Processing)

**Most Common Pattern**

```
EventBridge Rule
    ↓
Lambda Function (async invocation)
    ↓
DynamoDB / SQS / SNS
```

**Configuration:**
```hcl
resource "aws_cloudwatch_event_target" "vote_processor" {
  rule = aws_cloudwatch_event_rule.vote_submitted.name
  arn  = aws_lambda_function.vote_processor.arn

  retry_policy {
    maximum_retry_attempts       = 3
    maximum_event_age_in_seconds = 300 # 5 minutes
  }

  dead_letter_config {
    arn = aws_sqs_queue.event_dlq.arn
  }
}
```

**Error Handling:**
- Lambda throws error → EventBridge retries (3 attempts, exponential backoff)
- After 3 failures → Event sent to DLQ
- DLQ alarm → SNS notification → Manual intervention

---

### Pattern 2: EventBridge → SQS → Lambda (Buffering)

**Use Case**: High-volume events, need buffering

```
EventBridge Rule
    ↓
SQS Queue (buffering, 4-day retention)
    ↓
Lambda Function (batch processing)
```

**Example: Feedback Queue**

```hcl
resource "aws_cloudwatch_event_rule" "feedback" {
  name = "feedback-to-queue"
  event_pattern = jsonencode({
    source      = ["talent-flow.evaluations", "talent-flow.workflows"]
    detail-type = ["VotingCompleted", "StageCompleted"]
  })
}

resource "aws_cloudwatch_event_target" "feedback_queue" {
  rule = aws_cloudwatch_event_rule.feedback.name
  arn  = aws_sqs_queue.feedback_queue.arn
}

resource "aws_lambda_event_source_mapping" "feedback_processor" {
  event_source_arn = aws_sqs_queue.feedback_queue.arn
  function_name    = aws_lambda_function.feedback_aggregator.arn
  batch_size       = 10
}
```

---

### Pattern 3: EventBridge → Step Functions (Workflow Resumption)

**Use Case**: Resume Step Functions execution via task token

```
EventBridge Rule
    ↓
Step Functions (SendTaskSuccess API)
    ↓
Workflow resumes from wait state
```

**Example: Resume workflow when voting complete**

```json
// Step Functions waits with task token
{
  "Type": "Task",
  "Resource": "arn:aws:states:::events:waitForTaskToken",
  "Parameters": {
    "EventBusName": "talent-flow-events",
    "Entries": [{
      "Source": "talent-flow.workflows",
      "DetailType": "WaitingForVoting",
      "Detail": {
        "taskToken.$": "$$.Task.Token",
        "candidateId.$": "$.candidateId"
      }
    }]
  },
  "Next": "CheckScores"
}

// Lambda publishes VotingCompleted event
// EventBridge rule invokes Lambda that calls SendTaskSuccess
{
  "source": ["talent-flow.evaluations"],
  "detail-type": ["VotingCompleted"]
}
→ Target: Lambda (resume-workflow)
   → Calls: stepFunctions.sendTaskSuccess({ taskToken, output })
```

---

## Error Handling

### Retry Policy

**Default Configuration (All Rules):**
```yaml
Maximum Retry Attempts: 3
Maximum Event Age: 300 seconds (5 minutes)
Retry Backoff:
  - 1st retry: 1 second
  - 2nd retry: 2 seconds
  - 3rd retry: 4 seconds (exponential)
```

**After Exhausted Retries:**
- Event sent to Dead Letter Queue (SQS)
- CloudWatch Alarm triggers
- SNS notification to ops team

---

### Dead Letter Queue (DLQ)

**Configuration:**
```hcl
resource "aws_sqs_queue" "event_dlq" {
  name                      = "talent-flow-event-dlq"
  message_retention_seconds = 1209600 # 14 days
  visibility_timeout_seconds = 30
}

resource "aws_cloudwatch_metric_alarm" "dlq_alarm" {
  alarm_name          = "talent-flow-event-dlq-alarm"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 0 # Alert on ANY message in DLQ
  alarm_actions       = [aws_sns_topic.ops_alerts.arn]

  dimensions = {
    QueueName = aws_sqs_queue.event_dlq.name
  }
}
```

**DLQ Processing (Manual):**
1. Ops team receives alert
2. Investigate root cause (CloudWatch Logs)
3. Fix issue (Lambda code, permissions, etc.)
4. Replay events from DLQ (manual script or Lambda)

---

### Idempotency

**All Lambda event handlers MUST be idempotent**

**Strategy: Correlation ID as Idempotency Key**

```javascript
// Example: Vote Processor Lambda
exports.handler = async (event) => {
  const { detail } = event;
  const { candidateId, interviewId, voterId, correlationId } = detail;

  // Idempotency check: Has this vote already been processed?
  const existingVote = await dynamodb.get({
    TableName: 'candidate-pipeline',
    Key: {
      PK: `CANDIDATE#${candidateId}`,
      SK: `VOTE#${interviewId}#${voterId}`
    }
  });

  if (existingVote.Item) {
    console.log(`[${correlationId}] Vote already processed (idempotent skip)`);
    return { statusCode: 200, body: 'Already processed' };
  }

  // Process vote...
  await dynamodb.put({ /* vote record */ });

  return { statusCode: 200, body: 'Vote processed' };
};
```

**Why This Matters:**
- EventBridge guarantees at-least-once delivery
- Retries can cause duplicate events
- Idempotency ensures duplicate events are safe

---

## Testing Strategy

### Local Testing (EventBridge Local)

**Install:**
```bash
npm install -g @aws/eventbridge-local
```

**Run:**
```bash
eventbridge-local --port 4010
```

**Publish Test Event:**
```javascript
const AWS = require('aws-sdk');
const eventBridge = new AWS.EventBridge({
  endpoint: 'http://localhost:4010'
});

await eventBridge.putEvents({
  Entries: [{
    Source: 'talent-flow.candidates',
    DetailType: 'CandidateCreated',
    Detail: JSON.stringify({
      candidateId: 'CAND-TEST-001',
      firstName: 'Test',
      lastName: 'User',
      correlationId: 'test-corr-123'
    }),
    EventBusName: 'talent-flow-events'
  }]
}).promise();
```

---

### Integration Testing (Testcontainers)

**Setup:**
```javascript
const { GenericContainer } = require('testcontainers');

describe('EventBridge Integration Tests', () => {
  let localstackContainer;

  beforeAll(async () => {
    localstackContainer = await new GenericContainer('localstack/localstack')
      .withExposedPorts(4566)
      .withEnv('SERVICES', 'events,sqs,lambda')
      .start();
  });

  test('CandidateCreated event triggers workflow orchestrator', async () => {
    // Publish event
    await eventBridge.putEvents({ /* ... */ });

    // Assert: Check DynamoDB for workflow record
    const workflow = await dynamodb.get({ /* ... */ });
    expect(workflow.Item).toBeDefined();
    expect(workflow.Item.candidateId).toBe('CAND-TEST-001');
  });
});
```

---

### End-to-End Testing (Cypress + LocalStack)

**Scenario: Create Candidate → Workflow Created → Stage Started**

```javascript
describe('Candidate Lifecycle', () => {
  it('should create workflow when candidate is created', () => {
    // 1. API call: Create candidate
    cy.request('POST', '/api/v1/candidates', {
      firstName: 'E2E',
      lastName: 'Test',
      email: 'e2e@test.com',
      position: 'Engineer',
      departmentId: 'DEPT-TEST'
    }).then((response) => {
      expect(response.status).to.eq(202);
      const { candidateId, workflowId } = response.body;

      // 2. Wait for async processing (EventBridge → Lambdas)
      cy.wait(2000);

      // 3. Query workflow state
      cy.request('GET', `/api/v1/workflows/${workflowId}`).then((wfResponse) => {
        expect(wfResponse.body.stage).to.eq('INTERVIEW_1');
        expect(wfResponse.body.status).to.eq('STARTED');
      });
    });
  });
});
```

---

## Event Archive & Replay (Maturity Level 1)

**Enable EventBridge Archive:**

```hcl
resource "aws_cloudwatch_event_archive" "talent_flow_archive" {
  name             = "talent-flow-archive"
  event_source_arn = aws_cloudwatch_event_bus.talent_flow.arn
  retention_days   = 90

  event_pattern = jsonencode({
    source = [{ prefix = "talent-flow." }]
  })
}
```

**Replay Events:**

```bash
aws events start-replay \
  --replay-name candidate-created-replay \
  --event-source-arn arn:aws:events:af-south-1:123456789012:event-bus/talent-flow-events \
  --event-start-time 2026-05-10T00:00:00Z \
  --event-end-time 2026-05-10T23:59:59Z \
  --destination '{
    "Arn": "arn:aws:events:af-south-1:123456789012:event-bus/talent-flow-events"
  }'
```

**Use Cases:**
- Replay events after Lambda bug fix
- Backfill analytics data
- Test new consumers with production events

---

## Cost Summary

**POC Volume**: ~870k events/month

**EventBridge Pricing:**
- First 1M events/month: FREE
- Cost: **$0/month** ✅

**Maturity Level 1** (with Archive):
- 870k events/month × $1.00/1M = $0.87
- Archive storage: 90 days × 100 GB × $0.023/GB-month = $2.07
- Total: **$2.94/month**

---

## Summary

**Key Takeaways:**
- ✅ 11 event types (Stage 1-3)
- ✅ 6 EventBridge rules (fan-out, content-based routing)
- ✅ $0/month cost (within free tier)
- ✅ Idempotent event handling
- ✅ DLQ + retry logic for resilience
- ✅ Clear migration path to MSK (Maturity Level 3)

**Next Steps:**
1. Review Lambda catalog (next document)
2. Implement EventBridge rules via Terraform
3. Test event publishing from API Handler
4. Validate routing to Lambdas

---

**Document Version**: 1.0
**Last Updated**: 2026-05-10
**Related Documents**:
- TALENT_FLOW_POC_ARCHITECTURE.md
- DYNAMODB_SCHEMA_DESIGN.md
- LAMBDA_CATALOG.md (next)
