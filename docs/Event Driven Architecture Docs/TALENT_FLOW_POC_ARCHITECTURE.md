# Talent Flow Platform - POC Architecture (Level 0)

> **Purpose**: Detailed technical architecture for cost-optimized POC (<$50/month)
> **Audience**: Development team, Technical architects
> **Status**: v1.0 - Implementation Ready

---

## Executive Summary

This document defines the complete POC architecture for the Talent Flow Platform, focusing on **Stage 1-3 (Evaluation Intelligence)** as the initial increment.

**Key Characteristics:**
- ✅ 100% serverless (no always-on infrastructure)
- ✅ Event-driven architecture (EventBridge + SQS)
- ✅ Saga orchestration (Step Functions)
- ✅ Domain-driven design (7 Lambda functions)
- ✅ Cost-optimized (<$50/month)
- ✅ AI-ready (future integration without refactoring)

---

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Component Specifications](#component-specifications)
3. [Data Flow Diagrams](#data-flow-diagrams)
4. [Technology Stack](#technology-stack)
5. [Service Boundaries](#service-boundaries)
6. [API Specifications](#api-specifications)
7. [Security Architecture](#security-architecture)
8. [Monitoring & Observability](#monitoring--observability)
9. [Deployment Architecture](#deployment-architecture)
10. [Cost Optimization Strategies](#cost-optimization-strategies)

---

## High-Level Architecture

### System Context Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                     Talent Flow Platform                      │
│                         (POC - Level 0)                       │
└──────────────────────────────────────────────────────────────┘

External Systems:
├── Salesforce (optional for POC) ────> API Gateway
├── Email Service (SNS) <──────────── Notification Lambda
└── Calendar Service (optional) <──── Interview Scheduler


Core Platform:

┌─────────────────┐
│  Angular 19 UI  │ (S3 Static Hosting)
│   + PrimeNG     │
└────────┬────────┘
         │ HTTPS
         ↓
┌─────────────────────────────────────────────────────────────┐
│              API Gateway (HTTP API)                         │
│  - /api/v1/candidates (POST, GET)                           │
│  - /api/v1/interviews (POST, GET)                           │
│  - /api/v1/votes (POST)                                     │
│  - /api/v1/workflows/{id} (GET)                             │
└────────┬────────────────────────────────────────────────────┘
         │
         ↓
┌─────────────────┐
│  Lambda: API    │
│    Handler      │
└────────┬────────┘
         │
         ↓
┌─────────────────────────────────────────────────────────────┐
│                   EventBridge (Event Bus)                   │
│  Topic: talent-flow-events                                  │
└────────┬────────────────────────────────────────────────────┘
         │
         ├──────────────┬───────────────┬────────────────┐
         ↓              ↓               ↓                ↓
┌──────────────┐  ┌──────────┐  ┌─────────────┐  ┌──────────┐
│ Lambda:      │  │ Lambda:  │  │  Lambda:    │  │ Lambda:  │
│ Workflow     │  │Interview │  │    Vote     │  │Evaluation│
│Orchestrator  │  │Scheduler │  │  Processor  │  │Completer │
└──────┬───────┘  └────┬─────┘  └──────┬──────┘  └────┬─────┘
       │               │               │              │
       ↓               ↓               ↓              ↓
┌─────────────────────────────────────────────────────────────┐
│                  DynamoDB Tables                            │
│  - candidate-pipeline (operational state)                   │
│  - event-ledger (audit trail)                               │
│  - workflow-state (saga tracking)                           │
└─────────────────────────────────────────────────────────────┘
       │
       ↓
┌─────────────────┐
│  SQS: Feedback  │
│      Queue      │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  Lambda:        │
│  Feedback       │
│  Aggregator     │
└─────────────────┘

┌─────────────────────────────────────────────────────────────┐
│           Step Functions (Workflow Orchestration)           │
│  - evaluation-workflow (State Machine)                       │
│  - offer-workflow (State Machine) [Future]                  │
└─────────────────────────────────────────────────────────────┘

Scheduled Jobs:
┌─────────────────────────────────────────────────────────────┐
│  EventBridge Scheduler (Cron)                               │
│  - Hourly: SLA Monitor                                       │
│  - Daily: Workflow Cleanup                                   │
└────────┬────────────────────────────────────────────────────┘
         │
         ↓
┌─────────────────┐
│  Lambda: SLA    │
│    Monitor      │
└─────────────────┘
         │
         ↓
┌─────────────────┐
│  SNS: Alerts    │
└─────────────────┘
```

---

## Component Specifications

### 1. API Gateway (HTTP API)

**Service**: Amazon API Gateway v2 (HTTP API)

**Why HTTP API vs REST API:**
- 70% cheaper than REST API ($1 vs $3.50 per million requests)
- Sufficient for POC (no need for API keys, usage plans, request validation)
- Native JWT authorizer support
- Lower latency (11ms vs 50ms p99)

**Configuration:**
```yaml
Type: HTTP API
Protocol: HTTPS only
CORS: Enabled (Angular frontend)
Authorization: JWT (AWS Cognito) [Future]
Throttling: 1000 requests/sec (default)
Timeout: 30 seconds
Logging: CloudWatch Logs (error + info)
```

**Endpoints (Stage 1-3):**

| Method | Path | Handler Lambda | Purpose |
|--------|------|---------------|---------|
| POST | /api/v1/candidates | api-handler | Create candidate record |
| GET | /api/v1/candidates/{id} | api-handler | Get candidate details |
| POST | /api/v1/interviews | api-handler | Schedule interview |
| GET | /api/v1/interviews/{id} | api-handler | Get interview details |
| POST | /api/v1/votes | api-handler | Submit evaluation vote |
| GET | /api/v1/workflows/{id} | api-handler | Get workflow status |
| GET | /api/v1/workflows/{id}/audit | api-handler | Get audit trail |

**Request/Response Format:**
```json
// POST /api/v1/candidates
Request:
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "phone": "+27821234567",
  "position": "Software Engineer",
  "departmentId": "DEPT-ENG-01",
  "source": "LINKEDIN"
}

Response (202 Accepted):
{
  "candidateId": "CAND-uuid",
  "workflowId": "WF-uuid",
  "status": "CREATED",
  "stage": "INTERVIEW_1_SCHEDULED",
  "message": "Candidate created successfully",
  "timestamp": "2026-05-10T10:30:00Z"
}
```

**Cost (Estimated):**
- 1,000 workflows/day × 6 API calls avg = 6,000 calls/day
- 180,000 calls/month
- Cost: $1.00/million requests = **$0.18/month**

---

### 2. Lambda Functions (7 Functions for Stage 1-3)

**Runtime**: Node.js 20.x (latest LTS)

**Why Node.js:**
- ✅ Native async/await (event-driven patterns)
- ✅ Lightweight (faster cold starts vs Java)
- ✅ DynamoDB DocumentClient (native support)
- ✅ EventBridge SDK (native support)
- ✅ Smaller package sizes (faster deployments)
- ✅ Your expertise (JavaScript/TypeScript)

**Memory Allocation**: 512 MB (default for all)
**Timeout**: 30 seconds (API handlers), 5 minutes (processors)
**Concurrency**: 10 (POC limit)
**Environment Variables**:
- `DYNAMODB_PIPELINE_TABLE`
- `DYNAMODB_LEDGER_TABLE`
- `EVENTBRIDGE_BUS_NAME`
- `SQS_FEEDBACK_QUEUE_URL`

---

#### Lambda 1: API Handler

**Purpose**: Entry point for all REST API requests

**Responsibilities:**
- Input validation (JSON schema)
- Request authentication (JWT validation - future)
- Correlation ID generation
- Publishes events to EventBridge
- Returns 202 Accepted (async processing)

**Triggered By**: API Gateway (synchronous)

**Publishes Events:**
- `CandidateCreated`
- `InterviewScheduled`
- `VoteSubmitted`

**DynamoDB Operations:**
- Write to `candidate-pipeline` (operational state)
- Write to `event-ledger` (audit)

**Code Structure:**
```
lambda-api-handler/
├── index.js (main handler)
├── validators/
│   ├── candidateValidator.js
│   ├── interviewValidator.js
│   └── voteValidator.js
├── publishers/
│   └── eventBridgePublisher.js
├── repositories/
│   └── dynamoRepository.js
└── package.json
```

**Sample Handler:**
```javascript
// index.js
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

exports.handler = async (event) => {
  const { httpMethod, path, body } = event;
  const correlationId = uuidv4();

  console.log(`[${correlationId}] ${httpMethod} ${path}`);

  try {
    switch (true) {
      case httpMethod === 'POST' && path === '/api/v1/candidates':
        return await createCandidate(JSON.parse(body), correlationId);

      case httpMethod === 'POST' && path === '/api/v1/votes':
        return await submitVote(JSON.parse(body), correlationId);

      // ... other routes

      default:
        return { statusCode: 404, body: JSON.stringify({ error: 'Not Found' }) };
    }
  } catch (error) {
    console.error(`[${correlationId}] Error:`, error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error', correlationId })
    };
  }
};

async function createCandidate(data, correlationId) {
  const candidateId = `CAND-${uuidv4()}`;
  const workflowId = `WF-${uuidv4()}`;

  // 1. Write to DynamoDB
  await dynamoRepository.putCandidate({
    PK: `CANDIDATE#${candidateId}`,
    SK: 'METADATA',
    candidateId,
    workflowId,
    ...data,
    status: 'CREATED',
    stage: 'INTERVIEW_1_SCHEDULED',
    createdAt: new Date().toISOString(),
    correlationId
  });

  // 2. Publish event to EventBridge
  await eventBridge.putEvents({
    Entries: [{
      Source: 'talent-flow.candidates',
      DetailType: 'CandidateCreated',
      Detail: JSON.stringify({
        candidateId,
        workflowId,
        ...data,
        correlationId,
        timestamp: new Date().toISOString()
      }),
      EventBusName: process.env.EVENTBRIDGE_BUS_NAME
    }]
  });

  return {
    statusCode: 202,
    body: JSON.stringify({
      candidateId,
      workflowId,
      status: 'CREATED',
      message: 'Candidate created successfully'
    })
  };
}
```

**Cost**: $0 (within free tier)

---

#### Lambda 2: Workflow Orchestrator

**Purpose**: Creates saga state and starts workflow execution

**Responsibilities:**
- Receives `CandidateCreated` event
- Creates workflow state in `workflow-state` table
- Initializes Stage 1-3 records
- Publishes `WorkflowStageStarted` (INTERVIEW_1)
- Triggers Step Functions execution

**Triggered By**: EventBridge rule (filter: `DetailType = 'CandidateCreated'`)

**Publishes Events:**
- `WorkflowStageStarted`

**DynamoDB Operations:**
- Write to `workflow-state` (saga table)

**Sample Handler:**
```javascript
exports.handler = async (event) => {
  const { detail } = event;
  const { candidateId, workflowId, correlationId } = detail;

  console.log(`[${correlationId}] Creating workflow for candidate ${candidateId}`);

  // 1. Create saga record
  await dynamoRepository.putWorkflow({
    PK: `WORKFLOW#${workflowId}`,
    SK: 'SAGA',
    workflowId,
    candidateId,
    initiatedAt: new Date().toISOString(),
    source: 'TALENT_FLOW_UI',
    correlationId
  });

  // 2. Create stage records (INTERVIEW_1, INTERVIEW_2, OFFER)
  const stages = ['INTERVIEW_1', 'INTERVIEW_2', 'OFFER'];
  for (const stage of stages) {
    await dynamoRepository.putStage({
      PK: `WORKFLOW#${workflowId}`,
      SK: `STAGE#${stage}`,
      stage,
      status: stage === 'INTERVIEW_1' ? 'STARTED' : 'NOT_STARTED',
      startedAt: stage === 'INTERVIEW_1' ? new Date().toISOString() : null
    });
  }

  // 3. Publish stage started event
  await eventBridge.putEvents({
    Entries: [{
      Source: 'talent-flow.workflows',
      DetailType: 'WorkflowStageStarted',
      Detail: JSON.stringify({
        workflowId,
        candidateId,
        stage: 'INTERVIEW_1',
        correlationId,
        timestamp: new Date().toISOString()
      })
    }]
  });

  // 4. Start Step Functions execution
  await stepFunctions.startExecution({
    stateMachineArn: process.env.EVALUATION_WORKFLOW_ARN,
    name: `evaluation-${workflowId}`,
    input: JSON.stringify({ candidateId, workflowId, correlationId })
  });

  return { statusCode: 200, body: 'Workflow created' };
};
```

**Cost**: $0 (within free tier)

---

#### Lambda 3: Interview Scheduler

**Purpose**: Handles interview scheduling logic

**Responsibilities:**
- Receives `InterviewScheduled` event
- Sends calendar invites (via SNS → Email)
- Updates candidate state
- Logs to audit ledger

**Triggered By**: EventBridge rule (filter: `DetailType = 'InterviewScheduled'`)

**Publishes Events:**
- `InterviewScheduled` (to SNS for notifications)

**DynamoDB Operations:**
- Update `candidate-pipeline` (add interview details)
- Write to `event-ledger`

**Cost**: $0 (within free tier)

---

#### Lambda 4: Vote Processor

**Purpose**: Processes evaluation votes and calculates scores

**Responsibilities:**
- Receives `VoteSubmitted` event
- Stores vote in DynamoDB
- Checks if all required votes received
- Calculates scores (Technical, Communication, Cultural Fit, Problem Solving)
- If voting complete → publishes `VotingCompleted` event

**Triggered By**: EventBridge rule (filter: `DetailType = 'VoteSubmitted'`)

**Publishes Events:**
- `VotingCompleted` (when all votes received)

**DynamoDB Operations:**
- Write to `candidate-pipeline` (vote records)
- Read all votes for interview
- Update candidate score

**Scoring Logic:**
```javascript
async function calculateScores(candidateId, interviewId) {
  // Get all votes for this interview
  const votes = await dynamoRepository.getVotes(candidateId, interviewId);

  // Get required vote count (from interview config)
  const requiredVotes = 3; // Configurable

  if (votes.length < requiredVotes) {
    return null; // Not ready yet
  }

  // Calculate weighted averages
  const scores = {
    technical: average(votes.map(v => v.technicalScore)),
    communication: average(votes.map(v => v.communicationScore)),
    culturalFit: average(votes.map(v => v.culturalFitScore)),
    problemSolving: average(votes.map(v => v.problemSolvingScore))
  };

  scores.overall = (
    scores.technical * 0.4 +
    scores.communication * 0.2 +
    scores.culturalFit * 0.2 +
    scores.problemSolving * 0.2
  );

  return scores;
}
```

**Cost**: $0 (within free tier)

---

#### Lambda 5: Evaluation Completer

**Purpose**: Finalizes evaluation stage when voting complete

**Responsibilities:**
- Receives `VotingCompleted` event
- Updates workflow stage status
- Publishes `EvaluationCompleted` event
- Triggers next stage (if candidate passes threshold)

**Triggered By**: EventBridge rule (filter: `DetailType = 'VotingCompleted'`)

**Publishes Events:**
- `EvaluationCompleted`
- `WorkflowStageStarted` (next stage)

**DynamoDB Operations:**
- Update `workflow-state` (mark stage complete)
- Update `candidate-pipeline` (stage transition)

**Cost**: $0 (within free tier)

---

#### Lambda 6: Notification Service

**Purpose**: Generic notification handler (email, SMS, Slack)

**Responsibilities:**
- Subscribes to multiple event types
- Routes to appropriate notification channel
- Uses SNS for email delivery
- Logs notification status

**Triggered By**: EventBridge rules (multiple DetailTypes)

**Event Subscriptions:**
- `CandidateCreated` → Welcome email
- `InterviewScheduled` → Calendar invite
- `VotingCompleted` → Hiring manager notification
- `SLABreached` → Escalation email

**Publishes To:**
- SNS topics (email, SMS)
- Future: Slack webhooks

**Cost**: $0 (SNS within free tier)

---

#### Lambda 7: SLA Monitor

**Purpose**: Detects and escalates SLA breaches

**Responsibilities:**
- Runs hourly (EventBridge cron)
- Scans `workflow-state` for breaches
- Publishes `SLABreached` events
- Sends escalation notifications

**Triggered By**: EventBridge Scheduler (cron: `rate(1 hour)`)

**Publishes Events:**
- `SLABreached`

**DynamoDB Operations:**
- Scan `workflow-state` (filter: `slaDueAt < NOW && status != COMPLETED`)
- Update escalation counters

**SLA Configuration:**
```javascript
const SLA_CONFIG = {
  INTERVIEW_1: {
    SCHEDULING: 24 * 60 * 60 * 1000, // 24 hours
    VOTING: 48 * 60 * 60 * 1000      // 48 hours
  },
  INTERVIEW_2: {
    SCHEDULING: 48 * 60 * 60 * 1000,
    VOTING: 48 * 60 * 60 * 1000
  },
  OFFER: {
    CREATION: 24 * 60 * 60 * 1000,
    APPROVAL: 48 * 60 * 60 * 1000
  }
};
```

**Cost**: $0 (within free tier)

---

### 3. DynamoDB Tables

**Configuration:** On-Demand billing (pay-per-request)

**Why On-Demand for POC:**
- No capacity planning required
- Cost-effective at low volumes (<1M requests/month)
- Automatic scaling
- Migration to Provisioned at Maturity Level 1

---

#### Table 1: candidate-pipeline (Operational State)

**Purpose**: Current operational state of all candidates

**Access Patterns:**
1. Get candidate by ID
2. Get all candidates for department
3. Get candidates by stage
4. Get candidates by sentiment
5. Get candidates created in date range

**Schema (Single Table Design):**

| PK | SK | Attributes |
|----|-----|-----------|
| `CANDIDATE#{id}` | `METADATA` | candidateId, firstName, lastName, email, phone, position, departmentId, source, status, stage, sentiment, createdAt, updatedAt |
| `CANDIDATE#{id}` | `INTERVIEW#1` | interviewId, scheduledAt, conductedAt, interviewer, location, notes |
| `CANDIDATE#{id}` | `INTERVIEW#2` | (same as above) |
| `CANDIDATE#{id}` | `VOTE#INT1#{voterId}` | voterId, voterName, technicalScore, communicationScore, culturalFitScore, problemSolvingScore, recommendation, submittedAt |
| `CANDIDATE#{id}` | `SCORES` | technical, communication, culturalFit, problemSolving, overall, calculatedAt |
| `CANDIDATE#{id}` | `OFFER#{offerId}` | offerId, salary, startDate, benefits, status, sentAt, acceptedAt, sentiment |

**Global Secondary Indexes (GSI):**

**GSI1: Department-Stage-Index**
- PK: `departmentId`
- SK: `stage#createdAt`
- Purpose: List candidates by department and stage

**GSI2: Stage-Sentiment-Index**
- PK: `stage`
- SK: `sentiment#createdAt`
- Purpose: Get all HESITANT candidates in OFFER stage (risk detection)

**GSI3: Status-CreatedAt-Index**
- PK: `status`
- SK: `createdAt`
- Purpose: Time-range queries (candidates created in last 7 days)

**Example Queries:**

```javascript
// Get candidate with all related data
const result = await dynamodb.query({
  TableName: 'candidate-pipeline',
  KeyConditionExpression: 'PK = :pk',
  ExpressionAttributeValues: {
    ':pk': 'CANDIDATE#CAND-123'
  }
});
// Returns: METADATA + both interviews + all votes + scores + offer

// Get all candidates in OFFER stage with HESITANT sentiment
const hesitantOffers = await dynamodb.query({
  TableName: 'candidate-pipeline',
  IndexName: 'Stage-Sentiment-Index',
  KeyConditionExpression: 'stage = :stage AND begins_with(sentiment, :sentiment)',
  ExpressionAttributeValues: {
    ':stage': 'OFFER',
    ':sentiment': 'HESITANT'
  }
});
```

**Cost (Estimated):**
- 1,000 workflows/day × 20 DynamoDB operations avg = 20k ops/day
- 600k operations/month (25 GB-month storage)
- Cost: $0.25/million write requests + $0.25/GB-month = **$5/month**

---

#### Table 2: event-ledger (Audit Trail)

**Purpose**: Immutable append-only event log for compliance

**Access Patterns:**
1. Get all events for candidate (audit trail)
2. Get all events by correlation ID (distributed trace)
3. Get events by type in time range (analytics)

**Schema:**

| PK | SK | Attributes |
|----|-----|-----------|
| `CANDIDATE#{id}` | `EVENT#{timestamp}#{eventId}` | eventId, eventType, source, correlationId, userId, serviceId, payload, timestamp |
| `CORRELATION#{id}` | `EVENT#{timestamp}#{eventId}` | (same as above - for correlation ID queries) |

**Why Two Partitions:**
- Partition 1: Candidate-centric queries (audit trail)
- Partition 2: Correlation-centric queries (distributed tracing)

**GSI: EventType-Timestamp-Index**
- PK: `eventType`
- SK: `timestamp`
- Purpose: Analytics queries (all VoteSubmitted events in date range)

**Example Events:**

```javascript
// CandidateCreated event
{
  PK: 'CANDIDATE#CAND-123',
  SK: 'EVENT#2026-05-10T10:30:00Z#evt-uuid',
  eventId: 'evt-uuid',
  eventType: 'CandidateCreated',
  source: 'talent-flow.candidates',
  correlationId: 'corr-abc',
  userId: 'USER-001',
  serviceId: 'api-handler',
  payload: {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    position: 'Software Engineer'
  },
  timestamp: '2026-05-10T10:30:00Z'
}
```

**Retention:** Indefinite (compliance requirement)

**Cost (Estimated):**
- 1,000 workflows × 15 events avg = 15k events/day
- 450k events/month × 2 writes (two partitions) = 900k writes
- Cost: $0.25/million writes = **$0.25/month**

---

#### Table 3: workflow-state (Saga Tracking)

**Purpose**: Multi-stage saga orchestration state

**Access Patterns:**
1. Get workflow by ID
2. Get workflow by candidate ID
3. Get workflows by stage status (for SLA monitoring)
4. Get workflows with SLA breaches

**Schema:**

| PK | SK | Attributes |
|----|-----|-----------|
| `WORKFLOW#{id}` | `SAGA` | workflowId, candidateId, initiatedAt, completedAt, source, correlationId |
| `WORKFLOW#{id}` | `STAGE#INTERVIEW_1` | stage, status (NOT_STARTED \| STARTED \| COMPLETED), startedAt, endedAt, slaDueAt |
| `WORKFLOW#{id}` | `STAGE#INTERVIEW_2` | (same as above) |
| `WORKFLOW#{id}` | `STAGE#OFFER` | (same as above) |
| `WORKFLOW#{id}` | `TRACKER#INTERVIEW_1#SCHEDULING` | domain, status, startedAt, slaDueAt, endedAt, escalationCount |
| `WORKFLOW#{id}` | `TRACKER#INTERVIEW_1#VOTING` | (same as above) |

**GSI: CandidateId-Index**
- PK: `candidateId`
- SK: `workflowId`
- Purpose: Get workflow by candidate ID

**GSI: SLA-Index**
- PK: `status`
- SK: `slaDueAt`
- Purpose: SLA monitoring (find all STARTED stages with slaDueAt < NOW)

**Cost (Estimated):**
- 1,000 workflows × 10 saga records = 10k writes/day
- 300k writes/month
- Cost: $0.25/million writes = **$0.08/month**

---

### 4. EventBridge (Event Bus)

**Configuration:**

```yaml
Name: talent-flow-events
Type: Custom Event Bus
Archive: Disabled (POC), Enabled at Level 1
Retention: 7 days (default)
```

**Event Schema Registry:** (Optional for POC)

**Event Naming Convention:**
- Source: `talent-flow.{domain}`
- DetailType: `{Entity}{Action}` (past tense)
- Examples: `CandidateCreated`, `VoteSubmitted`, `WorkflowStageStarted`

**Event Envelope:**
```json
{
  "Source": "talent-flow.candidates",
  "DetailType": "CandidateCreated",
  "Detail": {
    "candidateId": "CAND-uuid",
    "workflowId": "WF-uuid",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "position": "Software Engineer",
    "departmentId": "DEPT-ENG-01",
    "correlationId": "corr-uuid",
    "timestamp": "2026-05-10T10:30:00Z",
    "userId": "USER-001",
    "source": "TALENT_FLOW_UI"
  },
  "Time": "2026-05-10T10:30:00Z"
}
```

**EventBridge Rules (Stage 1-3):**

| Rule Name | Event Pattern | Target |
|-----------|---------------|--------|
| `candidate-created-to-orchestrator` | `DetailType = 'CandidateCreated'` | Lambda: Workflow Orchestrator |
| `interview-scheduled-to-scheduler` | `DetailType = 'InterviewScheduled'` | Lambda: Interview Scheduler |
| `vote-submitted-to-processor` | `DetailType = 'VoteSubmitted'` | Lambda: Vote Processor |
| `voting-completed-to-completer` | `DetailType = 'VotingCompleted'` | Lambda: Evaluation Completer |
| `all-events-to-ledger` | `source = 'talent-flow.*'` | Lambda: Audit Logger |
| `notifications` | `DetailType IN ['CandidateCreated', 'InterviewScheduled', 'SLABreached']` | Lambda: Notification Service |

**Content-Based Routing Example:**

```json
// Route only HESITANT sentiment offers to HR escalation
{
  "source": ["talent-flow.offers"],
  "detail-type": ["OfferAccepted"],
  "detail": {
    "sentiment": ["HESITANT"]
  }
}
→ Target: SNS Topic (HR Escalation)
```

**Cost (Estimated):**
- 1,000 workflows × 15 events × 6 rules avg = 90k event deliveries/month
- Cost: First 1M free = **$0/month**

---

### 5. SQS (Feedback Queue)

**Purpose**: Aggregate feedback from domain handlers before updating workflow state

**Configuration:**

```yaml
Queue Name: talent-flow-feedback-queue
Type: Standard (FIFO not required for POC)
Visibility Timeout: 30 seconds
Message Retention: 4 days
Dead Letter Queue: talent-flow-feedback-dlq
Max Receive Count: 3
```

**Why SQS for Feedback:**
- ✅ Decouples domain handlers from state updates
- ✅ Buffering (absorbs bursts)
- ✅ Retry logic (DLQ for failures)
- ✅ Preserves HADES feedback loop pattern

**Message Format:**

```json
{
  "workflowId": "WF-uuid",
  "candidateId": "CAND-uuid",
  "stage": "INTERVIEW_1",
  "domain": "VOTING",
  "status": "COMPLETED",
  "detail": "All votes received, scores calculated",
  "timestamp": "2026-05-10T10:30:00Z",
  "correlationId": "corr-uuid"
}
```

**Lambda: Feedback Aggregator** (subscribes to SQS)

**Responsibilities:**
- Reads feedback messages
- Updates `workflow-state` table
- Checks stage completion (all domains SUCCESS)
- If stage complete → publishes `WorkflowStageCompleted` event
- Triggers next stage

**Cost (Estimated):**
- 1,000 workflows × 10 feedback messages = 10k messages/month
- Cost: First 1M free = **$0/month**

---

### 6. Step Functions (Workflow Orchestration)

**Purpose**: Durable long-running workflows with wait states

**State Machine**: evaluation-workflow

**Configuration:**

```yaml
Type: Standard Workflow (not Express)
Why: Supports wait states up to 1 year
Execution History: 90 days
Max Concurrency: 10 (POC limit)
```

**State Machine Definition (Simplified):**

```json
{
  "Comment": "Evaluation Intelligence Workflow (Stage 1-3)",
  "StartAt": "CreateWorkflow",
  "States": {
    "CreateWorkflow": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:....:workflow-orchestrator",
      "Next": "WaitForInterview1Scheduled"
    },
    "WaitForInterview1Scheduled": {
      "Type": "Task",
      "Resource": "arn:aws:states:::events:waitForTaskToken",
      "Parameters": {
        "EventBusName": "talent-flow-events",
        "Entries": [{
          "Source": "talent-flow.workflows",
          "DetailType": "WaitingForInterview1",
          "Detail": {
            "taskToken.$": "$$.Task.Token",
            "candidateId.$": "$.candidateId"
          }
        }]
      },
      "Next": "WaitForVoting"
    },
    "WaitForVoting": {
      "Type": "Wait",
      "Seconds": 259200,
      "Comment": "Wait up to 3 days for voting to complete",
      "Next": "CheckVotingCompleted"
    },
    "CheckVotingCompleted": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:....:vote-checker",
      "Next": "VotingCompleteChoice"
    },
    "VotingCompleteChoice": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.votingComplete",
          "BooleanEquals": true,
          "Next": "CalculateScores"
        },
        {
          "Variable": "$.votingComplete",
          "BooleanEquals": false,
          "Next": "EscalateSLA"
        }
      ]
    },
    "CalculateScores": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:....:score-calculator",
      "Next": "Interview1Complete"
    },
    "EscalateSLA": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:....:sla-escalator",
      "Next": "WaitForVoting"
    },
    "Interview1Complete": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:....:stage-completer",
      "End": true
    }
  }
}
```

**Key Patterns:**

1. **Wait States**: `"Type": "Wait", "Seconds": 259200` (3 days)
2. **Task Tokens**: Resume workflow via callback when external event occurs
3. **Choice States**: Conditional routing based on data
4. **Retry Logic**: Automatic retries with exponential backoff

**Future Expansion:**
- Add Interview 2 workflow
- Add Offer workflow
- Add Provisioning workflow

**Cost (Estimated):**
- 1,000 workflows × 10 state transitions avg = 10k transitions/month
- Cost: $0.025/1000 transitions = **$0.25/month**

---

### 7. SNS (Notifications)

**Purpose**: Email/SMS notifications

**Topics:**

| Topic | Purpose | Subscribers |
|-------|---------|-------------|
| `talent-flow-notifications` | General notifications | Email (hiring managers) |
| `talent-flow-sla-alerts` | SLA breach escalations | Email (HR, leadership) |

**Message Format:**

```json
{
  "Subject": "Interview Scheduled: John Doe",
  "Message": "Interview scheduled for Software Engineer position.\n\nCandidate: John Doe\nDate: 2026-05-15 at 10:00 AM\nInterviewer: Jane Smith\n\nView details: https://app.talentflow.com/candidates/CAND-123",
  "MessageAttributes": {
    "candidateId": { "DataType": "String", "StringValue": "CAND-123" },
    "type": { "DataType": "String", "StringValue": "INTERVIEW_SCHEDULED" }
  }
}
```

**Cost (Estimated):**
- 1,000 workflows × 5 notifications avg = 5k emails/month
- Cost: First 1,000 free, then $2/100k = **$0.10/month**

---

## Data Flow Diagrams

### Flow 1: Create Candidate (Happy Path)

```
User (Angular UI)
   │
   │ POST /api/v1/candidates
   ↓
API Gateway
   │
   ↓
Lambda: API Handler
   │
   ├─→ DynamoDB: candidate-pipeline (write)
   ├─→ DynamoDB: event-ledger (write)
   └─→ EventBridge: Publish CandidateCreated
   │
   │ Returns 202 Accepted
   ↓
User (receives candidateId)

────────────────────────────────────────

EventBridge receives CandidateCreated
   │
   ├─→ Rule: candidate-created-to-orchestrator
   │      │
   │      ↓
   │   Lambda: Workflow Orchestrator
   │      │
   │      ├─→ DynamoDB: workflow-state (create saga)
   │      ├─→ EventBridge: Publish WorkflowStageStarted
   │      └─→ Step Functions: Start evaluation-workflow
   │
   └─→ Rule: all-events-to-ledger
          │
          ↓
       Lambda: Audit Logger
          │
          └─→ DynamoDB: event-ledger (audit record)
```

---

### Flow 2: Submit Vote & Calculate Scores

```
User submits vote (POST /api/v1/votes)
   │
   ↓
Lambda: API Handler
   │
   ├─→ DynamoDB: candidate-pipeline (write vote)
   └─→ EventBridge: Publish VoteSubmitted
   │
   ↓
EventBridge routes to Lambda: Vote Processor
   │
   ├─→ DynamoDB: Query all votes for interview
   │
   ├─→ Check: All votes received?
   │      │
   │      ├── No → Return (wait for more votes)
   │      │
   │      └── Yes
   │           │
   │           ├─→ Calculate scores (Technical, Communication, etc.)
   │           ├─→ DynamoDB: Update candidate scores
   │           ├─→ EventBridge: Publish VotingCompleted
   │           └─→ SQS: Send feedback message
   │
   ↓
Lambda: Feedback Aggregator (triggered by SQS)
   │
   ├─→ DynamoDB: Update workflow-state (mark tracker SUCCESS)
   │
   ├─→ Check: All trackers for stage SUCCESS?
   │      │
   │      └── Yes
   │           │
   │           ├─→ DynamoDB: Mark stage COMPLETED
   │           ├─→ EventBridge: Publish WorkflowStageCompleted
   │           └─→ Step Functions: Resume execution (taskToken)
```

---

### Flow 3: SLA Monitoring & Escalation

```
EventBridge Scheduler (runs hourly)
   │
   ↓
Lambda: SLA Monitor
   │
   ├─→ DynamoDB: Scan workflow-state
   │      Filter: slaDueAt < NOW && status = STARTED
   │
   ├─→ For each breach:
   │      │
   │      ├─→ Update escalationCount++
   │      ├─→ EventBridge: Publish SLABreached
   │      └─→ SNS: Send alert email
   │
   ↓
EventBridge routes SLABreached event
   │
   ├─→ Lambda: Notification Service
   │      │
   │      └─→ SNS: Email to hiring manager
   │
   └─→ Lambda: Audit Logger
          │
          └─→ DynamoDB: event-ledger (compliance log)
```

---

## Technology Stack

### Frontend

| Technology | Version | Purpose |
|-----------|---------|---------|
| Angular | 19+ | Modern reactive framework |
| PrimeNG | Latest | Enterprise UI components |
| RxJS | 7+ | Reactive state management |
| TypeScript | 5+ | Type safety |
| Signals | Angular 19 | Simplified reactivity |

**Deployment**: S3 static hosting + CloudFront (optional for POC)

**Cost**: $0.50/month (S3 only), $1/month with CloudFront

---

### Backend

| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js | 20.x | Lambda runtime |
| AWS SDK v3 | Latest | AWS service clients |
| UUID | v9 | ID generation |
| Ajv | v8 | JSON schema validation |

---

### Infrastructure

| Service | Configuration | Cost/Month |
|---------|---------------|------------|
| Lambda | 7 functions, 512 MB, Node.js 20.x | $0 |
| API Gateway | HTTP API, 180k requests | $0.18 |
| EventBridge | Custom bus, 90k events | $0 |
| SQS | Standard queue, 10k messages | $0 |
| DynamoDB | On-Demand, 3 tables, 900k ops | $5.33 |
| Step Functions | Standard, 10k transitions | $0.25 |
| SNS | 5k emails | $0.10 |
| CloudWatch | Logs + Metrics (basic) | $2 |
| S3 | Frontend hosting, 10 GB transfer | $0.50 |
| **Total** | | **~$8.36/month** |

---

## Service Boundaries

### Domain Decomposition (Aligned with HADES Pattern)

```
┌────────────────────────────────────────────────────────┐
│              Talent Flow Domain Services               │
└────────────────────────────────────────────────────────┘

Domain 1: Candidate Management
├── Owns: Candidate entity, interview records, votes
├── Lambdas: API Handler, Workflow Orchestrator
└── Events Published: CandidateCreated, InterviewScheduled, VoteSubmitted

Domain 2: Evaluation
├── Owns: Voting logic, score calculation
├── Lambdas: Vote Processor, Evaluation Completer
└── Events Published: VotingCompleted, EvaluationCompleted

Domain 3: Notifications
├── Owns: Email/SMS delivery
├── Lambdas: Notification Service
└── Events Consumed: All (content-based routing)

Domain 4: Orchestration
├── Owns: Saga state, workflow lifecycle
├── Components: Step Functions, Feedback Aggregator
└── Events Published: WorkflowStageStarted, WorkflowStageCompleted

Domain 5: Compliance
├── Owns: Audit trail, SLA monitoring
├── Lambdas: SLA Monitor, Audit Logger
└── Events Published: SLABreached
```

**Key Principle**: No direct Lambda-to-Lambda calls. All communication via EventBridge + SQS.

---

## API Specifications

### OpenAPI Specification (Abbreviated)

```yaml
openapi: 3.0.0
info:
  title: Talent Flow API
  version: 1.0.0
  description: Recruitment & Onboarding Orchestration Platform

servers:
  - url: https://api.talentflow.com/api/v1
    description: Production
  - url: https://dev-api.talentflow.com/api/v1
    description: Development

paths:
  /candidates:
    post:
      summary: Create candidate
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateCandidateRequest'
      responses:
        '202':
          description: Accepted
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CandidateResponse'
        '400':
          description: Bad Request
        '500':
          description: Internal Server Error

  /candidates/{candidateId}:
    get:
      summary: Get candidate details
      parameters:
        - name: candidateId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Candidate'

components:
  schemas:
    CreateCandidateRequest:
      type: object
      required:
        - firstName
        - lastName
        - email
        - position
        - departmentId
      properties:
        firstName:
          type: string
          example: "John"
        lastName:
          type: string
          example: "Doe"
        email:
          type: string
          format: email
          example: "john.doe@example.com"
        phone:
          type: string
          example: "+27821234567"
        position:
          type: string
          example: "Software Engineer"
        departmentId:
          type: string
          example: "DEPT-ENG-01"
        source:
          type: string
          enum: [LINKEDIN, REFERRAL, WEBSITE, AGENCY]
          example: "LINKEDIN"

    CandidateResponse:
      type: object
      properties:
        candidateId:
          type: string
        workflowId:
          type: string
        status:
          type: string
        stage:
          type: string
        message:
          type: string
        timestamp:
          type: string
          format: date-time
```

---

## Security Architecture

### Authentication & Authorization (POC - Simplified)

**POC Approach**: No authentication (internal tool)

**Maturity Level 1**: Add AWS Cognito JWT validation

**Planned Security:**
- Cognito User Pool (user authentication)
- API Gateway JWT Authorizer
- IAM roles for Lambda (service authentication)
- Secrets Manager (database credentials)

### Data Security

**Encryption:**
- At Rest: DynamoDB default encryption (AWS-managed keys)
- In Transit: HTTPS/TLS 1.3 (API Gateway enforced)

**Network Security:**
- Lambdas in private subnets (Maturity Level 1)
- Security groups (Maturity Level 1)
- VPC endpoints (Maturity Level 1)

### Compliance

**Data Residency**: af-south-1 (Cape Town)

**Retention:**
- Operational data: 90 days
- Audit logs: 7 years (compliance requirement)

---

## Monitoring & Observability

### CloudWatch Logs

**Log Groups:**
- `/aws/lambda/api-handler`
- `/aws/lambda/workflow-orchestrator`
- `/aws/lambda/vote-processor`
- `/aws/lambda/evaluation-completer`
- `/aws/lambda/notification-service`
- `/aws/lambda/sla-monitor`
- `/aws/lambda/feedback-aggregator`

**Log Format (Structured JSON):**

```json
{
  "timestamp": "2026-05-10T10:30:00Z",
  "level": "INFO",
  "correlationId": "corr-abc",
  "function": "api-handler",
  "message": "Candidate created successfully",
  "candidateId": "CAND-123",
  "workflowId": "WF-456",
  "duration": 120
}
```

**Retention**: 7 days (POC), 90 days (Level 1)

---

### CloudWatch Metrics

**Custom Metrics:**
- `CandidatesCreated` (count per day)
- `VotesSubmitted` (count per day)
- `WorkflowsCompleted` (count per day)
- `SLABreaches` (count per hour)
- `AvgWorkflowDuration` (seconds)

**Lambda Metrics (Built-in):**
- Invocations
- Duration
- Errors
- Throttles
- Concurrent Executions

---

### CloudWatch Alarms

**Alarms:**
1. Lambda Errors > 5 in 5 minutes → SNS alert
2. SLA Breaches > 3 in 1 hour → SNS alert
3. DynamoDB Throttling → SNS alert
4. API Gateway 5xx > 10 in 5 minutes → SNS alert

---

### Distributed Tracing (Maturity Level 1)

**AWS X-Ray Integration:**
- Trace ID = Correlation ID
- End-to-end request flow visibility
- Latency analysis
- Error hotspot detection

**Cost**: $5/1M traces (beyond free tier)

---

## Deployment Architecture

### Terraform Module Structure

```
terraform/
├── main.tf
├── variables.tf
├── outputs.tf
├── terraform.tfvars
├── modules/
│   ├── lambda/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── dynamodb/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── eventbridge/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── api-gateway/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── step-functions/
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
└── environments/
    ├── dev.tfvars
    ├── qa.tfvars
    └── prod.tfvars
```

### CI/CD Pipeline (Maturity Level 1)

**GitHub Actions Workflow:**

```yaml
name: Deploy Talent Flow POC

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20.x'
      - name: Install dependencies
        run: npm ci
      - name: Run tests
        run: npm test
      - name: Build Lambdas
        run: npm run build
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v2
      - name: Terraform Init
        run: terraform init
      - name: Terraform Plan
        run: terraform plan -var-file=environments/dev.tfvars
      - name: Terraform Apply
        run: terraform apply -auto-approve -var-file=environments/dev.tfvars
```

---

## Cost Optimization Strategies

### 1. Use On-Demand Billing Where Possible
- DynamoDB On-Demand (no capacity planning)
- Lambda pay-per-invoke (no idle costs)
- API Gateway pay-per-request

### 2. Leverage Free Tiers
- Lambda: 1M requests/month free
- DynamoDB: 25 GB storage free
- EventBridge: 1M events/month free
- SQS: 1M requests/month free
- SNS: 1,000 emails/month free

### 3. Right-Size Lambda Memory
- Start with 512 MB (balance cost/performance)
- Monitor actual memory usage
- Adjust based on data

### 4. Use Single-Table Design (DynamoDB)
- Reduces table count = fewer costs
- Fewer GSIs = lower storage costs

### 5. Minimize Cross-Region Data Transfer
- All services in af-south-1
- S3 + CloudFront for frontend (optional)

### 6. Use CloudWatch Log Insights (Not Athena) for POC
- CloudWatch Logs Insights included in log costs
- Athena requires S3 exports ($$$)

### 7. Disable Unnecessary Features for POC
- No X-Ray tracing (add at Level 1)
- No EventBridge Archive (add at Level 1)
- No multi-AZ deployments
- No reserved capacity

---

## Next Steps

1. ✅ Review this POC architecture
2. Review DynamoDB schema design (next document)
3. Review EventBridge patterns (next document)
4. Review Lambda catalog (next document)
5. Review Terraform structure (next document)
6. Review incremental delivery roadmap (next document)
7. Begin implementation (Stage 1-3)

---

**Document Version**: 1.0
**Last Updated**: 2026-05-10
**Related Documents**:
- TALENT_FLOW_MATURITY_LEVELS.md
- DYNAMODB_SCHEMA_DESIGN.md (next)
- EVENTBRIDGE_PATTERNS.md (next)

---
---

## 🆕 v2.0 Addendum: Metadata-Lite Architecture Updates

> **Added**: 2026-05-15
> **Document Version**: 2.0
> **Context**: MVP1 evolved to Metadata-Lite architecture (externalized Variable Six)
> **See**: MVP1-FOUNDATION-PLAN-v2.md, PROJECT_CONTEXT.md (Session Checkpoint 2026-05-15)

---

### What Changed in v2.0

**v1.0 POC Architecture**:
- 7 Lambda functions
- 3 DynamoDB tables
- Hardcoded business rules (scoring weights, SLA thresholds, panel size)
- Total cost: $9.50/month

**v2.0 POC Architecture** (Metadata-Lite):
- **8 Lambda functions** (+1: config-manager)
- **4 DynamoDB tables** (+1: talent-flow-config)
- **Config-driven business rules** (Variable Six externalized)
- **New shared utility**: config-reader.js (5-min caching)
- **Total cost**: $10.02/month (+$0.52/month increase)

**Why This Matters**: Launching a 2nd vertical (Banking, Agriculture) now takes 1-2 days (config changes) vs 2-3 weeks (Lambda rebuild).

---

### Updated Component Count

| Component | v1.0 | v2.0 | Change |
|-----------|------|------|--------|
| **Lambda Functions** | 7 | 8 | +1 (config-manager) |
| **DynamoDB Tables** | 3 | 4 | +1 (talent-flow-config) |
| **Shared Utilities** | 0 | 1 | +1 (config-reader.js) |
| **Admin UI Pages** | 0 | 3 | +3 (scoring, SLA, panel rules) |
| **API Endpoints** | 4 | 8 | +4 (config CRUD) |

---

### Updated High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                  Talent Flow Platform v2.0                  │
│                    (POC - Metadata-Lite)                    │
└─────────────────────────────────────────────────────────────┘

Core Platform:

┌─────────────────┐
│  Angular 19 UI  │ (S3 Static Hosting)
│   + PrimeNG     │
│   + Admin UI    │ ← NEW: 3 config pages (scoring, SLA, panel)
└────────┬────────┘
         │ HTTPS
         ↓
┌──────────────────────────────────────────────────────────────┐
│              API Gateway (HTTP API)                          │
│  - /api/v1/candidates (POST, GET)                            │
│  - /api/v1/interviews (POST, GET)                            │
│  - /api/v1/votes (POST)                                      │
│  - /api/v1/workflows/{id} (GET)                              │
│  - /api/v1/config/{type} (GET, PUT) ← NEW: Config management │
│  - /api/v1/config/{type}/history (GET) ← NEW: Audit trail   │
└────────┬─────────────────────────────────────────────────────┘
         │
         ↓
┌─────────────────┐     ┌──────────────────┐
│  Lambda: API    │     │  Lambda: Config  │ ← NEW
│    Handler      │     │    Manager       │
└────────┬────────┘     └────────┬─────────┘
         │                       │
         ↓                       ↓
┌─────────────────────────────────────────────────────────────┐
│                   EventBridge (Event Bus)                   │
│  Topic: talent-flow-events                                  │
└────────┬────────────────────────────────────────────────────┘
         │
         ├──────────────┬───────────────┬────────────────┐
         ↓              ↓               ↓                ↓
┌──────────────┐  ┌──────────┐  ┌─────────────┐  ┌──────────┐
│ Lambda:      │  │ Lambda:  │  │  Lambda:    │  │ Lambda:  │
│ Workflow     │  │Interview │  │    Vote     │  │Evaluation│
│Orchestrator  │  │Scheduler │  │  Processor  │  │Completer │
└──────┬───────┘  └────┬─────┘  └──────┬──────┘  └────┬─────┘
       │               │               │              │
       │  (All Lambdas now read config via config-reader.js) │
       │               │               │              │
       ↓               ↓               ↓              ↓
┌─────────────────────────────────────────────────────────────┐
│                  DynamoDB Tables                            │
│  - candidate-pipeline (operational state)                   │
│  - event-ledger (audit trail)                               │
│  - workflow-state (saga tracking)                           │
│  - talent-flow-config (business rules) ← NEW               │
└─────────────────────────────────────────────────────────────┘
```

**Key Change**: All Lambdas now import `config-reader.js` and read business rules from `talent-flow-config` table instead of hardcoded values.

---

### New Component: talent-flow-config Table

**Purpose**: Store tenant-specific business rules with versioning support

**Schema**:
```
PK: TENANT#{tenantId}
SK: CONFIG#{configType}#v{version}

GSI1 (Active Config Index):
  GSI1PK: TENANT#{tenantId}#ACTIVE
  GSI1SK: CONFIG#{configType}

Attributes:
- configType: SCORING_WEIGHTS | SLA_THRESHOLDS | PANEL_RULES | APPROVAL_RULES | NOTIFICATION_TEMPLATES | STAGE_ENABLEMENT
- version: Integer (1, 2, 3, ...)
- isActive: Boolean (only 1 active per configType)
- data: JSON (config payload)
- createdBy: String (userId or "SYSTEM")
- createdAt: ISO 8601 timestamp
- previousVersion: Integer (null for v1)
- expiresAt: Number (TTL, 365 days after inactive)
```

**Access Patterns**:
1. Get active config: Query GSI1 (fast lookup, no version filter)
2. Get specific version: GetItem (for in-flight candidates locked to version)
3. Get audit trail: Query PK+SK prefix (config change history)

**Storage**: <100 MB (6 config types × 3 versions avg × 1 KB each = 18 KB)
**Cost**: $0.25/month (storage) + $0.004/month (reads, 95% cache hit rate)

**See**: DYNAMODB_SCHEMA_DESIGN.md v2.0 Addendum for complete schema details

---

### New Lambda: config-manager

**Purpose**: Admin API for config management with automatic versioning

**Function Name**: `talent-flow-config-manager`

**Runtime**: Node.js 20.x, 256 MB, 15s timeout, arm64

**Endpoints**:
- `GET /config/{configType}` — Get active config
- `PUT /config/{configType}` — Update config (creates new version)
- `GET /config/{configType}/history` — Get audit trail
- `GET /config` — List all active configs

**Versioning Logic**:
1. Mark old version inactive (set `isActive=false`, `expiresAt=+365 days`, remove from GSI1)
2. Create new version (increment version number, set `isActive=true`, add to GSI1)
3. Return new version details

**IAM Permissions**:
- `dynamodb:GetItem`, `dynamodb:Query` (read config)
- `dynamodb:PutItem`, `dynamodb:UpdateItem` (write config)
- Access to `talent-flow-config` table + GSI1

**See**: LAMBDA_CATALOG.md v2.0 Addendum for complete Lambda spec

---

### Updated Lambdas (v2.0)

All 5 business logic Lambdas now read config instead of hardcoding rules:

| Lambda | v1.0 (Hardcoded) | v2.0 (Config-Driven) | Config Type | Versioned? |
|--------|------------------|----------------------|-------------|-----------|
| **workflow-orchestrator** | N/A | Captures `configVersion` at creation | N/A | Yes |
| **interview-scheduler** | `votesRequired: 2` | Reads `PANEL_RULES` | PANEL_RULES | Yes |
| **vote-processor** | Tech 35%, Comm 25% | Reads `SCORING_WEIGHTS`, `PANEL_RULES` | SCORING_WEIGHTS, PANEL_RULES | Yes |
| **notification-service** | Hardcoded templates | Reads `NOTIFICATION_TEMPLATES` | NOTIFICATION_TEMPLATES | No (active) |
| **sla-monitor** | 48h, 72h, 24h, 7d | Reads `SLA_THRESHOLDS` | SLA_THRESHOLDS | No (active) |

**Critical Design Decision**: Scoring and panel rules use **versioned config** (locked to workflow version at creation), SLA and notification templates use **active config** (operational policy applies to all current work).

---

### New Shared Utility: config-reader.js

**Purpose**: Centralized config reads with 5-min caching

**Location**: `lambda/shared/config-reader.js` (copied into every Lambda package)

**Exports**:
- `getActiveConfig(tenantId, configType)` — Read current active config
- `getConfigVersion(tenantId, configType, version)` — Read specific version

**Caching**:
- 5-min TTL (config changes take effect within 5 minutes)
- In-memory Map (survives Lambda warm starts)
- 95% cache hit rate (reduces DynamoDB reads by 95%)

**Fallback**: Returns default values if config not found (defensive coding)

**See**: LAMBDA_CATALOG.md v2.0 Addendum for complete implementation

---

### Updated Cost Breakdown (v2.0)

| Component | v1.0 Cost | v2.0 Cost | Change |
|-----------|-----------|-----------|--------|
| **DynamoDB** | $5.00/month | $5.50/month | +$0.50 (4th table) |
| **Lambda** | $0/month (free tier) | $0.02/month | +$0.02 (config-manager) |
| **EventBridge** | $0 (free tier) | $0 (free tier) | No change |
| **SQS** | $0 (free tier) | $0 (free tier) | No change |
| **Step Functions** | $1.00/month | $1.00/month | No change |
| **API Gateway** | $1.00/month | $1.00/month | No change |
| **CloudWatch** | $2.00/month | $2.00/month | No change |
| **S3 (Frontend)** | $0.50/month | $0.50/month | No change |
| **SNS** | $0 (free tier) | $0 (free tier) | No change |
| **Total** | **$9.50/month** | **$10.02/month** | **+$0.52/month (5.5% increase)** |

**ROI**: +$0.52/month investment saves R1.06M on vertical 2 launch

**Still Under Budget**: $10.02/month << $50/month budget ✅

---

### Updated Architecture Characteristics (v2.0)

**v1.0 Characteristics** (all preserved):
- ✅ Fully serverless (no always-on infrastructure)
- ✅ Event-driven (EventBridge + SQS)
- ✅ Saga pattern (Step Functions)
- ✅ Domain autonomy (Lambdas as domain services)
- ✅ Feedback loop (SQS aggregation)
- ✅ Audit trail (DynamoDB event-ledger)
- ✅ Incremental delivery (Stage 1-3 first)

**v2.0 Additions** (new capabilities):
- ✅ **Config-driven business rules** (Variable Six externalized)
- ✅ **Config versioning** (in-flight candidates locked to version)
- ✅ **Admin UI** (3 of 6 Variable Six: scoring, SLA, panel rules)
- ✅ **Shared utilities** (config-reader.js with caching)
- ✅ **Vertical expansion ready** (1-2 days to launch Banking/Agriculture)
- ✅ **Multi-tenancy foundation** (config table tenant-aware)

---

### The Variable Six (Externalized in v2.0)

| Config Type | What It Controls | MVP1 Admin UI? | Example |
|-------------|------------------|----------------|---------|
| **SCORING_WEIGHTS** | Evaluation dimension weights | ✅ Yes | Tech 30%, Comm 25%, Cultural 25%, Problem 20% |
| **SLA_THRESHOLDS** | Response time expectations | ✅ Yes | First Engagement: 48h, Evaluation: 72h |
| **PANEL_RULES** | Interview panel composition | ✅ Yes | Min: 1, Max: 5, Veto: enabled |
| **APPROVAL_RULES** | Offer approval authority | ⏳ MVP2 | Salary >$150K → manager approval |
| **NOTIFICATION_TEMPLATES** | Email/SMS content | ⏳ MVP2 | "Your interview is scheduled for {{date}}" |
| **STAGE_ENABLEMENT** | Which stages active | ⏳ MVP2 | Agriculture skips background checks |

**MVP1**: Admin UI for 3 of 6 (proves config pattern)
**MVP2**: Admin UI for remaining 3 (full externalization)

---

### Updated Lambda Function Count

**v1.0**: 7 Lambdas (Stage 1-3)
- API Handler
- Workflow Orchestrator
- Interview Scheduler
- Vote Processor
- Evaluation Completer
- Notification Service
- SLA Monitor

**v2.0**: **8 Lambdas** (Stage 1-3)
- API Handler
- Workflow Orchestrator ← *Updated: Captures configVersion*
- Interview Scheduler ← *Updated: Reads PANEL_RULES*
- Vote Processor ← *Updated: Reads SCORING_WEIGHTS, PANEL_RULES*
- Evaluation Completer
- Notification Service ← *Updated: Reads NOTIFICATION_TEMPLATES*
- SLA Monitor ← *Updated: Reads SLA_THRESHOLDS*
- **config-manager** ← *NEW: Admin API*

---

### Updated Admin UI (v2.0)

**v1.0**: No admin UI (all config changes via code deploy)

**v2.0**: 3 admin pages (Angular Material + TailwindCSS)

1. **Scoring Weights Config** (`/admin/config/scoring-weights`)
   - Form: Tech, Comm, Cultural, Problem (sliders, sum must = 100%)
   - Validation: Real-time sum calculation
   - Save: Creates new config version (e.g., v2 → v3)
   - Warning: "Changes apply to new candidates only (in-flight unaffected)"

2. **SLA Thresholds Config** (`/admin/config/sla-thresholds`)
   - Form: First Engagement, Evaluation, Offer Gen, Offer Accept (hours input)
   - Validation: Must be positive integers
   - Save: Creates new config version
   - Note: "SLA changes apply to all candidates (including in-flight)"

3. **Panel Rules Config** (`/admin/config/panel-rules`)
   - Form: Min size, Max size, Veto power toggle, Size by level (Junior/Mid/Senior/etc.)
   - Validation: Min ≤ Max, size by level within min/max bounds
   - Save: Creates new config version

**Auth**: All pages protected by `AdminGuard` (requires `isAdmin: true` in JWT)

**Audit Trail**: Each page shows version history (version, createdBy, createdAt, data)

---

### Updated Security Architecture (v2.0)

**v1.0 IAM Policies**:
```json
{
  "Effect": "Allow",
  "Action": ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem"],
  "Resource": [
    "arn:aws:dynamodb:*:*:table/candidate-pipeline",
    "arn:aws:dynamodb:*:*:table/event-ledger",
    "arn:aws:dynamodb:*:*:table/workflow-state"
  ]
}
```

**v2.0 IAM Policies** (updated):
```json
{
  "Effect": "Allow",
  "Action": ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem"],
  "Resource": [
    "arn:aws:dynamodb:*:*:table/candidate-pipeline",
    "arn:aws:dynamodb:*:*:table/event-ledger",
    "arn:aws:dynamodb:*:*:table/workflow-state",
    "arn:aws:dynamodb:*:*:table/talent-flow-config",        // NEW
    "arn:aws:dynamodb:*:*:table/talent-flow-config/index/*" // NEW (GSI1)
  ]
}
```

**Admin Role** (NEW in v2.0):
- Cognito User Pool has 2 groups: "Users" and "Admins"
- Admin users have `isAdmin: true` claim in JWT
- Frontend `AdminGuard` checks `isAdmin` claim
- Config-manager Lambda validates admin role before PUT operations

---

### Updated Deployment Architecture (v2.0)

**v1.0 Deployment**:
```bash
terraform apply
# Deploy 7 Lambdas, 3 tables, EventBridge, API Gateway
```

**v2.0 Deployment** (updated):
```bash
# 1. Deploy infrastructure (4 tables, 8 Lambdas)
terraform apply

# 2. Seed default configs
CONFIG_TABLE_NAME=talent-flow-config node scripts/seed-config.js

# 3. Verify configs
aws dynamodb query \
  --table-name talent-flow-config \
  --index-name GSI1 \
  --key-condition-expression "GSI1PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"TENANT#DEFAULT#ACTIVE"}}'
```

**Build Process** (updated):
```bash
# Each Lambda now includes config-reader.js
./scripts/build-lambda.sh vote-processor
# → Copies lambda/shared/config-reader.js into vote-processor/
# → Creates dist/function.zip with index.js + config-reader.js + node_modules
```

---

### Vertical Expansion: Before vs After

**v1.0 (Hardcoded) — Launching Banking Vertical**:
```
1. Update vote-processor.js → Change scoring weights (Tech 35% → 20%)
2. Update sla-monitor.js → Change SLA thresholds (48h → 24h)
3. Update interview-scheduler.js → Change panel size (2 → 3)
4. Redeploy 3 Lambdas
5. Run full integration test suite
6. Deploy to prod

Timeline: 2-3 weeks
Cost: R1.06M (consulting + testing)
```

**v2.0 (Config-Driven) — Launching Banking Vertical**:
```
1. Admin logs into UI
2. Navigate to Scoring Weights config
3. Change Tech 30% → 20%, Comm 25% → 35%
4. Save (creates v4)
5. Navigate to SLA Thresholds config
6. Change First Engagement 48h → 24h
7. Save (creates v2)
8. Navigate to Panel Rules config
9. Change min panel size 1 → 3
10. Save (creates v2)

Timeline: 1-2 days (mostly waiting for config cache to expire)
Cost: R0 (no code changes, no redeployment)
```

**Savings**: R1.06M per vertical

---

### Summary of v2.0 Changes

**New Components**:
- ✅ 1 new Lambda (config-manager)
- ✅ 1 new DynamoDB table (talent-flow-config with GSI1)
- ✅ 1 new shared utility (config-reader.js)
- ✅ 3 new admin UI pages (scoring, SLA, panel)
- ✅ 4 new API endpoints (config CRUD)

**Updated Components**:
- ✅ 5 Lambdas read config (workflow-orchestrator, interview-scheduler, vote-processor, notification-service, sla-monitor)
- ✅ IAM policies updated (all Lambdas need config table access)
- ✅ Build scripts updated (copy config-reader.js into packages)

**Business Impact**:
- ✅ Vertical expansion: 2-3 weeks → 1-2 days
- ✅ Cost savings: R1.06M per vertical
- ✅ Admin autonomy: HR changes rules without developers
- ✅ Audit compliance: Config versioning ensures fairness

**Cost Impact**: +$0.52/month (5.5% increase, still <$50/month budget)

**Timeline Impact**: MVP1 now 7 weeks (was 6 weeks in v1.0)

---

**v2.0 Addendum Complete**
**Last Updated**: 2026-05-15
**Related Documents**:
- MVP1-FOUNDATION-PLAN-v2.md (execution plan)
- DYNAMODB_SCHEMA_DESIGN.md v2.0 Addendum (config table schema)
- LAMBDA_CATALOG.md v2.0 Addendum (Lambda updates)
- TALENT_FLOW_MATURITY_LEVELS.md v2.0 Addendum (evolution path)
- PROJECT_CONTEXT.md (Session Checkpoint 2026-05-15)
