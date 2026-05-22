# AI-Assisted Development Guide - Prompt Templates

> **Purpose**: Comprehensive prompt templates for AI-assisted development
> **Audience**: Solo developer using Claude for code generation
> **Status**: v1.0 - Ready to Use

---

## Executive Summary

This guide provides battle-tested prompt templates for generating:
- Lambda functions (Node.js)
- Terraform modules
- Angular components
- Unit tests
- Integration tests
- Documentation

**Key Principle**: Comprehensive context + clear requirements = high-quality AI output.

---

## Prompt Structure Best Practices

### Anatomy of a Good Prompt
```
1. **Context**: What project/system is this for?
2. **Role**: What component are you generating?
3. **Requirements**: Functional requirements (what it does)
4. **Technical Constraints**: Non-functional requirements (how it should be built)
5. **Examples/Patterns**: Reference existing patterns (e.g., "Follow LAMBDA_CATALOG.md")
6. **Acceptance Criteria**: How to validate success
```

### Example: Well-Structured Prompt
```
Context: I'm building the Talent Flow platform, an event-driven hiring orchestration system.

Role: Generate a Lambda function called "vote-processor" that processes interview evaluations.

Requirements:
- Subscribe to EventBridge event: source="talent-flow.evaluation", detail-type="VoteSubmitted"
- Extract vote details (candidateId, interviewId, interviewerId, scores, decision)
- Write vote record to DynamoDB (PK: CANDIDATE#{candidateId}, SK: VOTE#{voteId})
- Query all votes for this interview
- If all required votes received (check interview.votesRequired):
  - Calculate aggregate scores (average, min, max, stdDev)
  - Determine recommendation (STRONG_HIRE, HIRE, MIXED, NO_HIRE)
  - Publish VotingCompleted event to EventBridge
- Implement idempotency (check if vote already processed)

Technical Constraints:
- Runtime: Node.js 20.x
- AWS SDK v3 (EventBridge, DynamoDB)
- Use DynamoDBDocumentClient (not low-level client)
- Structured logging (JSON format with candidateId, interviewId in all logs)
- Error handling with try/catch
- Environment variables: EVENTBRIDGE_BUS_NAME, DYNAMODB_TABLE_NAME

Examples/Patterns:
- Follow the pattern from LAMBDA_CATALOG.md (Lambda 4: Vote Processor)
- Use the scoring algorithm defined in LAMBDA_CATALOG.md

Acceptance Criteria:
- Function passes unit tests (score calculation correctness)
- Idempotent (can be invoked multiple times safely)
- Publishes VotingCompleted event only when all votes received
- Logs all operations to CloudWatch
```

---

## Prompt Template 1: Lambda Function

### Template
```
Generate a Node.js 20.x Lambda function for the Talent Flow platform with the following specifications:

**Function Name**: {function-name}

**Purpose**: {1-2 sentence description}

**Trigger**:
- EventBridge rule: source="{source}", detail-type="{detail-type}"
  [OR]
- SQS queue: {queue-name}
  [OR]
- API Gateway: {http-method} {path}
  [OR]
- EventBridge Scheduler: {cron-expression}

**Input Event Schema**:
```json
{example-event-payload}
```

**Business Logic**:
1. {step-1}
2. {step-2}
3. {step-3}
...

**DynamoDB Operations**:
- Table: {table-name}
- Write: {PK: value, SK: value, attributes}
- Query: {describe-query-pattern}

**EventBridge Event to Publish** (if applicable):
- Source: {source}
- DetailType: {detail-type}
- Detail: {event-payload-structure}

**Technical Requirements**:
- Runtime: nodejs20.x
- Memory: {memory-mb} MB
- Timeout: {timeout-seconds} seconds
- AWS SDK v3 (use @aws-sdk/client-eventbridge, @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb)
- Structured logging: JSON format with contextual fields (candidateId, workflowId, etc.)
- Error handling: try/catch with specific error types
- Idempotency: {describe-idempotency-strategy}

**Environment Variables**:
- EVENTBRIDGE_BUS_NAME
- DYNAMODB_TABLE_NAME
- {other-env-vars}

**Error Handling**:
- {specific-error-scenarios}
- Log errors with full context
- Throw errors to trigger retry (DLQ will catch after max retries)

**Patterns to Follow**:
- Reference: LAMBDA_CATALOG.md (Lambda {N}: {name})

**Output**:
- Complete Lambda function code (index.js)
- Include all imports
- Include helper functions
- Add JSDoc comments for main function and helpers
```

### Example Usage
```
Generate a Node.js 20.x Lambda function for the Talent Flow platform with the following specifications:

**Function Name**: talent-flow-workflow-orchestrator

**Purpose**: Manages workflow state transitions, initiates stages, tracks progress.

**Trigger**:
- EventBridge rule: source="talent-flow.candidate", detail-type="CandidateCreated"

**Input Event Schema**:
```json
{
  "version": "0",
  "id": "event-123",
  "detail-type": "CandidateCreated",
  "source": "talent-flow.candidate",
  "detail": {
    "candidateId": "CAND-20240512-001",
    "workflowId": "WF-20240512-001",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "position": "Senior Software Engineer",
    "department": "Engineering",
    "timestamp": "2024-05-12T10:30:00Z"
  }
}
```

**Business Logic**:
1. Extract candidateId and workflowId from event detail
2. Create workflow record in DynamoDB with:
   - Status: IN_PROGRESS
   - Current stage: EVALUATION_INTELLIGENCE
   - Stage tracking: 12 stages (all PENDING except Stage 1-3 = IN_PROGRESS)
3. Publish WorkflowStageStarted event to EventBridge (Stage 1-3)
4. Set SLA timestamp for first engagement (48 hours from now)

**DynamoDB Operations**:
- Table: talent-flow-state
- Write:
  - PK: 'WORKFLOW#{workflowId}'
  - SK: 'METADATA'
  - Attributes: workflowId, candidateId, status, currentStage, stages (object), createdAt, updatedAt

**EventBridge Event to Publish**:
- Source: talent-flow.workflow
- DetailType: WorkflowStageStarted
- Detail:
  ```json
  {
    "workflowId": "WF-20240512-001",
    "candidateId": "CAND-20240512-001",
    "stage": "EVALUATION_INTELLIGENCE",
    "stageNumber": "1-3",
    "expectedDurationHours": 72,
    "slaDeadline": "2024-05-15T10:30:00Z",
    "timestamp": "2024-05-12T10:30:00Z"
  }
  ```

**Technical Requirements**:
- Runtime: nodejs20.x
- Memory: 512 MB
- Timeout: 30 seconds
- AWS SDK v3
- Structured logging with workflowId and candidateId in all logs
- Idempotency: Check if workflow already exists before creating

**Environment Variables**:
- EVENTBRIDGE_BUS_NAME
- DYNAMODB_TABLE_NAME
- SLA_FIRST_ENGAGEMENT_HOURS (default: 48)

**Error Handling**:
- If workflow already exists, log warning and skip creation (idempotent)
- If DynamoDB write fails, throw error (will retry)
- If EventBridge publish fails, throw error (will retry)

**Patterns to Follow**:
- Reference: LAMBDA_CATALOG.md (Lambda 2: Workflow Orchestrator)

**Output**:
- Complete Lambda function code (index.js)
```

---

## Prompt Template 2: Terraform Module

### Template
```
Generate Terraform code to deploy a Lambda function using the reusable lambda-function module.

**Context**: Talent Flow platform, POC deployment (dev environment)

**Lambda Function Details**:
- Function name: {function-name}
- Runtime: {runtime}
- Memory: {memory-mb} MB
- Timeout: {timeout-seconds} seconds
- Source code: {path-to-zip}

**Environment Variables**:
- {KEY}: {value-or-reference}
- {KEY}: {value-or-reference}

**Trigger**:
[Option 1: EventBridge]
- Event bus: {bus-name}
- Event pattern:
  ```json
  {event-pattern}
  ```

[Option 2: SQS]
- Queue ARN: {queue-arn}
- Batch size: {batch-size}

[Option 3: EventBridge Scheduler]
- Schedule expression: {cron-expression}

**IAM Permissions Required**:
- {service}:{action} on {resource}
- {service}:{action} on {resource}

**Other Configuration**:
- Enable DLQ: {true/false}
- Log retention: {days} days
- Reserved concurrency: {number} (or None)

**Module Path**: ../../modules/lambda-function

**Output Requirements**:
- Use module syntax
- Pass all required variables
- Include IAM policy statements
- Add depends_on if needed

**Output**:
- Complete Terraform module usage block
```

### Example Usage
```
Generate Terraform code to deploy a Lambda function using the reusable lambda-function module.

**Context**: Talent Flow platform, POC deployment (dev environment)

**Lambda Function Details**:
- Function name: talent-flow-vote-processor
- Runtime: nodejs20.x
- Memory: 256 MB
- Timeout: 15 seconds
- Source code: ../../lambda-packages/vote-processor.zip

**Environment Variables**:
- EVENTBRIDGE_BUS_NAME: ${module.eventbridge_bus.bus_name}
- DYNAMODB_TABLE_NAME: ${module.dynamodb_state_table.table_name}
- LOG_LEVEL: INFO

**Trigger**:
- Event bus: talent-flow-bus
- Event pattern:
  ```json
  {
    "source": ["talent-flow.evaluation"],
    "detail-type": ["VoteSubmitted"]
  }
  ```

**IAM Permissions Required**:
- events:PutEvents on talent-flow-bus
- dynamodb:GetItem on talent-flow-state
- dynamodb:PutItem on talent-flow-state
- dynamodb:Query on talent-flow-state (and indexes)
- dynamodb:UpdateItem on talent-flow-state

**Other Configuration**:
- Enable DLQ: true
- Log retention: 7 days
- Reserved concurrency: None

**Module Path**: ../../modules/lambda-function

**Output**:
- Complete Terraform module usage block
```

---

## Prompt Template 3: Angular Component

### Template
```
Generate an Angular 17 standalone component for the Talent Flow platform.

**Component Name**: {ComponentName} (e.g., CandidateCreateComponent)

**Purpose**: {1-2 sentence description}

**Route**: /{path} (e.g., /candidates/create)

**UI Requirements**:
- {requirement-1}
- {requirement-2}
- {requirement-3}

**Form Fields** (if applicable):
- {fieldName}: {type} (validation: {rules})
- {fieldName}: {type} (validation: {rules})

**API Integration**:
- Service: {ServiceName}
- Method: {httpMethod} {endpoint}
- Request payload: {structure}
- Success response: {structure}
- Error handling: {strategy}

**User Interactions**:
- {action}: {behavior}
- {action}: {behavior}

**Technical Requirements**:
- Angular 17 (standalone component)
- Reactive forms (FormBuilder)
- Angular Material UI components
- TailwindCSS for styling
- RxJS for async operations
- Error handling: toast notifications

**Validation Rules**:
- {field}: {rules}

**Navigation**:
- On success: Navigate to {route}
- On cancel: Navigate to {route}

**Output**:
- Component TypeScript file ({component-name}.component.ts)
- Component HTML template ({component-name}.component.html)
- Component CSS ({component-name}.component.css)
- Include all imports
```

### Example Usage
```
Generate an Angular 17 standalone component for the Talent Flow platform.

**Component Name**: CandidateCreateComponent

**Purpose**: Form to create a new candidate and initiate the hiring workflow.

**Route**: /candidates/create

**UI Requirements**:
- Responsive form layout (centered card, max-width 600px)
- Section headers (Personal Info, Position Info, Source)
- Submit and Cancel buttons
- Loading spinner during API call
- Success toast notification

**Form Fields**:
- firstName: text (required, min 2 chars, max 50 chars)
- lastName: text (required, min 2 chars, max 50 chars)
- email: email (required, valid email format, unique check)
- phone: tel (required, format: +1-XXX-XXX-XXXX)
- position: text (required, min 5 chars)
- department: select (required, options: Engineering, Product, Sales, Marketing, HR)
- source: select (required, options: LinkedIn, Indeed, Referral, Career Page)

**API Integration**:
- Service: CandidateService
- Method: POST /candidates
- Request payload:
  ```json
  {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "phone": "+1-555-0100",
    "position": "Senior Software Engineer",
    "department": "Engineering",
    "source": "LinkedIn"
  }
  ```
- Success response:
  ```json
  {
    "candidateId": "CAND-123",
    "workflowId": "WF-123",
    "status": "CREATED"
  }
  ```
- Error handling: Display error toast, highlight invalid fields

**User Interactions**:
- Submit button: Validate form, call API, navigate to candidate detail on success
- Cancel button: Navigate back to candidates list
- Real-time validation: Show error messages below fields

**Technical Requirements**:
- Angular 17 (standalone component)
- Reactive forms (FormBuilder)
- Angular Material (mat-form-field, mat-input, mat-select, mat-button)
- TailwindCSS for layout
- RxJS (switchMap for API calls)
- Toast notifications (Angular Material snackbar)

**Validation Rules**:
- firstName: required, minLength(2), maxLength(50)
- lastName: required, minLength(2), maxLength(50)
- email: required, email format
- phone: required, pattern(+1-XXX-XXX-XXXX)
- position: required, minLength(5)
- department: required
- source: required

**Navigation**:
- On success: Navigate to /candidates/{candidateId}
- On cancel: Navigate to /candidates

**Output**:
- candidate-create.component.ts
- candidate-create.component.html
- candidate-create.component.css
```

---

## Prompt Template 4: Unit Tests

### Template
```
Generate Jest unit tests for the following Lambda function.

**Function Name**: {function-name}

**Function Purpose**: {brief-description}

**Test Coverage Requirements**:
- {test-scenario-1}
- {test-scenario-2}
- {test-scenario-3}
...

**Mocking Strategy**:
- Mock AWS SDK clients: {list-of-clients}
- Mock environment variables: {list-of-vars}
- Mock external dependencies: {list-of-deps}

**Test Data**:
- Use realistic test data (see examples below)
- Mock event payloads from EventBridge/SQS/API Gateway

**Technical Requirements**:
- Jest test framework
- aws-sdk-client-mock for AWS SDK mocking
- Arrange-Act-Assert pattern
- Descriptive test names
- Use beforeEach for setup, afterEach for cleanup

**Expected Assertions**:
- Verify function behavior (return values, side effects)
- Verify AWS SDK calls (correct parameters)
- Verify error handling (throws expected errors)
- Verify idempotency (safe to retry)

**Output**:
- Complete test file ({function-name}.test.js)
- Include all imports
- Include mock data fixtures
- Target: >80% code coverage
```

### Example Usage
```
Generate Jest unit tests for the following Lambda function.

**Function Name**: vote-processor

**Function Purpose**: Processes VoteSubmitted events, calculates aggregate scores, publishes VotingCompleted event when all votes received.

**Test Coverage Requirements**:
- Calculate aggregate scores correctly (average, min, max, stdDev)
- Determine recommendation (STRONG_HIRE, HIRE, MIXED, NO_HIRE) based on decisions
- Publish VotingCompleted event only when all required votes received
- Do NOT publish event if votes still pending
- Handle missing scores gracefully (default to 0)
- Implement idempotency (skip if vote already processed)
- Update candidate aggregate scores in DynamoDB
- Log all operations to CloudWatch (verify console.log calls)

**Mocking Strategy**:
- Mock AWS SDK clients: EventBridgeClient, DynamoDBDocumentClient
- Mock environment variables: EVENTBRIDGE_BUS_NAME, DYNAMODB_TABLE_NAME
- Use aws-sdk-client-mock library

**Test Data**:
- Mock event payload (VoteSubmitted):
  ```json
  {
    "detail": {
      "voteId": "VOTE-123",
      "candidateId": "CAND-123",
      "interviewId": "INT-123",
      "interviewerId": "interviewer@example.com",
      "scores": {
        "technical": 8,
        "communication": 9,
        "culturalFit": 7,
        "problemSolving": 8
      },
      "decision": "STRONG_YES",
      "timestamp": "2024-05-15T15:30:00Z"
    }
  }
  ```

- Mock DynamoDB Query result (all votes for interview):
  ```json
  {
    "Items": [
      {
        "voteId": "VOTE-123",
        "scores": { "technical": 8, "communication": 9, "culturalFit": 7, "problemSolving": 8 },
        "decision": "STRONG_YES"
      },
      {
        "voteId": "VOTE-124",
        "scores": { "technical": 7, "communication": 8, "culturalFit": 8, "problemSolving": 8 },
        "decision": "YES"
      }
    ]
  }
  ```

**Technical Requirements**:
- Jest test framework
- aws-sdk-client-mock for mocking
- Arrange-Act-Assert pattern
- Use describe() and it() blocks
- Use beforeEach() to reset mocks

**Expected Assertions**:
- Verify DynamoDB PutItem called with correct vote data
- Verify DynamoDB Query called to fetch all votes
- Verify EventBridge PutEvents called with VotingCompleted event (when all votes in)
- Verify EventBridge NOT called (when votes still pending)
- Verify aggregate score calculations (use toBeCloseTo for floats)
- Verify recommendation logic (STRONG_HIRE, HIRE, MIXED, NO_HIRE)

**Output**:
- vote-processor.test.js
- Target: >80% code coverage
```

---

## Prompt Template 5: Integration Tests

### Template
```
Generate an integration test for the Talent Flow platform that validates the following end-to-end workflow.

**Test Scenario**: {high-level-description}

**Workflow Steps**:
1. {step-1}
2. {step-2}
3. {step-3}
...

**Involved Components**:
- Lambda: {function-name-1}
- Lambda: {function-name-2}
- EventBridge: {event-bus-name}
- DynamoDB: {table-name}

**Test Setup**:
- Deploy all Lambda functions to AWS (or use LocalStack)
- Create test data (candidates, interviews, etc.)
- Clean up DynamoDB before test

**Test Execution**:
1. Invoke {lambda/api} with {test-data}
2. Wait for {duration} (for async event processing)
3. Verify {expected-state} in DynamoDB
4. Verify {expected-event} published to EventBridge

**Assertions**:
- {assertion-1}
- {assertion-2}
- {assertion-3}

**Technical Requirements**:
- Jest test framework
- AWS SDK v3 (invoke Lambda, query DynamoDB, list events)
- Use async/await
- Timeout: {duration} (for async processing)
- Clean up test data after test

**Output**:
- Complete integration test file ({test-name}.integration.test.js)
```

### Example Usage
```
Generate an integration test for the Talent Flow platform that validates the following end-to-end workflow.

**Test Scenario**: Complete evaluation workflow (candidate creation → interview → voting → evaluation completion)

**Workflow Steps**:
1. Create candidate via API Handler Lambda
2. Verify candidate created in DynamoDB
3. Verify CandidateCreated event published
4. Verify Workflow Orchestrator triggered (creates workflow)
5. Schedule interview via API Handler Lambda
6. Submit 2 votes via API Handler Lambda
7. Verify Vote Processor calculates aggregate scores
8. Verify VotingCompleted event published
9. Verify Evaluation Completer triggered
10. Verify candidate status updated to next stage

**Involved Components**:
- Lambda: talent-flow-api-handler
- Lambda: talent-flow-workflow-orchestrator
- Lambda: talent-flow-vote-processor
- Lambda: talent-flow-evaluation-completer
- EventBridge: talent-flow-bus
- DynamoDB: talent-flow-state

**Test Setup**:
- Deploy all Lambda functions to AWS dev environment
- Create test candidate data
- Clean up DynamoDB (delete all test records before test)

**Test Execution**:
1. Invoke API Handler Lambda (POST /candidate)
2. Wait 2 seconds (for async event processing)
3. Query DynamoDB (verify candidate + workflow created)
4. Invoke API Handler Lambda (POST /interview)
5. Wait 1 second
6. Invoke API Handler Lambda (POST /vote) twice (2 votes)
7. Wait 3 seconds (for vote processing + evaluation completion)
8. Query DynamoDB (verify candidate status = next stage)
9. Query DynamoDB (verify aggregate scores calculated)

**Assertions**:
- Candidate record exists with status="CREATED"
- Workflow record exists with status="IN_PROGRESS"
- Interview record exists with votesSubmitted=2, votesRequired=2
- Vote records exist (2 votes)
- Aggregate scores calculated (verify average, min, max)
- Candidate status updated to "SELECTION_ORCHESTRATION"

**Technical Requirements**:
- Jest test framework
- AWS SDK v3 (LambdaClient, DynamoDBClient)
- Use async/await
- Timeout: 30 seconds (for async processing)
- Clean up: Delete test records after test (candidate, workflow, votes)

**Output**:
- stage1-3-evaluation-workflow.integration.test.js
```

---

## Prompt Template 6: Documentation

### Template
```
Generate technical documentation for {topic}.

**Audience**: {target-audience}

**Purpose**: {why-this-doc-exists}

**Sections to Include**:
1. {section-1}
2. {section-2}
3. {section-3}
...

**Style Guidelines**:
- Use Markdown format
- Include code examples
- Include diagrams (Mermaid syntax if applicable)
- Use tables for comparisons
- Use bullet points for lists
- Include "Next Steps" section at end

**Tone**: {technical/business/educational}

**Length**: {approximate-word-count}

**Output**:
- Complete Markdown document ({filename}.md)
```

### Example Usage
```
Generate technical documentation for DynamoDB single-table design in the Talent Flow platform.

**Audience**: Developers, Database architects

**Purpose**: Explain the DynamoDB schema design, access patterns, and query strategies for the Talent Flow POC.

**Sections to Include**:
1. Executive Summary
2. Single-Table Design Rationale
3. Primary Key Structure (PK, SK)
4. Global Secondary Indexes (GSI1, GSI2)
5. Access Patterns (7 patterns)
6. Query Examples (with code)
7. Write Patterns (with code)
8. Aggregation Strategies
9. Cost Optimization
10. Best Practices
11. Next Steps

**Style Guidelines**:
- Use Markdown format
- Include DynamoDB query code examples (JavaScript with AWS SDK v3)
- Include table schema examples (JSON)
- Use tables to compare access patterns
- Use Mermaid diagrams for entity relationships (if helpful)
- Include "Cost Impact" sections

**Tone**: Technical, educational

**Length**: 3000-4000 words

**Output**:
- DYNAMODB_SCHEMA_DESIGN.md
```

---

## Advanced Prompt Techniques

### Technique 1: Chain of Thought Prompting
For complex logic, ask AI to "think step by step":

```
Generate the score calculation algorithm for the vote-processor Lambda.

**Requirements**:
- Calculate aggregate scores for 4 categories (technical, communication, culturalFit, problemSolving)
- For each category, calculate: average, min, max, standard deviation
- Calculate overall score (weighted average: technical=35%, communication=25%, culturalFit=20%, problemSolving=20%)
- Determine recommendation (STRONG_HIRE, HIRE, MIXED, NO_HIRE) based on decisions

**Approach**:
1. First, explain the algorithm in plain English (step-by-step)
2. Then, implement it in JavaScript
3. Finally, provide test cases to validate correctness

**Output**:
- Algorithm explanation (plain English)
- JavaScript function (calculateAggregateScores)
- Test cases (input + expected output)
```

---

### Technique 2: Reference Existing Patterns
Always reference existing documentation:

```
Generate Lambda function "interview-scheduler" following the exact same patterns as "vote-processor" (see LAMBDA_CATALOG.md Lambda 4).

**Similarities**:
- Same EventBridge subscription pattern
- Same DynamoDB write pattern
- Same idempotency pattern
- Same error handling pattern

**Differences**:
- Subscribes to InterviewScheduled (instead of VoteSubmitted)
- Writes interview record (instead of vote record)
- Publishes InterviewConfirmed (instead of VotingCompleted)

**Output**:
- Complete Lambda function (interview-scheduler/index.js)
```

---

### Technique 3: Iterative Refinement
Generate → Review → Refine:

```
# First Prompt
Generate Lambda function "vote-processor" with basic functionality.

# Review Output
[Review generated code, identify issues]

# Second Prompt
Refine the vote-processor Lambda function:
- Add error handling for missing scores (default to 0)
- Add logging for all operations (JSON format with candidateId, interviewId)
- Add input validation (ensure scores are 0-10 range)
- Add unit test coverage for edge cases

# Review Output
[Review refined code]

# Third Prompt
Final refinement:
- Optimize DynamoDB query (use projection expression to reduce data transfer)
- Add CloudWatch metric (custom metric for voting completion rate)
- Add retry logic for EventBridge failures (exponential backoff)
```

---

## Common Pitfalls & Solutions

### Pitfall 1: Vague Requirements
❌ Bad Prompt:
```
Generate a Lambda function that processes votes.
```

✅ Good Prompt:
```
Generate a Lambda function that:
- Subscribes to EventBridge VoteSubmitted events
- Writes vote to DynamoDB
- Calculates aggregate scores
- Publishes VotingCompleted event when all votes received
- Implements idempotency
- Uses AWS SDK v3
- Follows patterns in LAMBDA_CATALOG.md
```

---

### Pitfall 2: No Context
❌ Bad Prompt:
```
Generate a candidate creation API.
```

✅ Good Prompt:
```
Context: Talent Flow platform, event-driven hiring orchestration system.

Generate Lambda function for candidate creation API:
- Validates input (firstName, lastName, email, position, department)
- Checks for duplicate email (query DynamoDB GSI2)
- Writes candidate record to DynamoDB (single-table design)
- Publishes CandidateCreated event to EventBridge
- Returns candidate ID and workflow ID

Follow patterns in LAMBDA_CATALOG.md (Lambda 1: API Handler)
```

---

### Pitfall 3: Missing Technical Constraints
❌ Bad Prompt:
```
Generate a Lambda function to send notifications.
```

✅ Good Prompt:
```
Generate Lambda function for notification service:
- Consumes SQS queue (batch size 10)
- Routes to EMAIL, SMS, or SLACK based on message.notificationType
- Uses AWS SES for email delivery
- Implements email templates (Interview Scheduled, Vote Reminder)
- Deletes SQS message on success
- Logs delivery status to CloudWatch

Technical constraints:
- Runtime: Node.js 20.x
- Memory: 256 MB
- Timeout: 30 seconds
- AWS SDK v3
- Use Nodemailer for SMTP (SES)
```

---

## Prompt Library (Quick Reference)

### Lambda Function Generation
```
Generate Node.js 20.x Lambda function "{name}" for Talent Flow platform.
Purpose: {1-sentence-description}
Trigger: {EventBridge/SQS/Cron}
Business Logic: {step-by-step}
DynamoDB: {operations}
EventBridge: {events-to-publish}
Technical: AWS SDK v3, structured logging, idempotency
Follow: LAMBDA_CATALOG.md (Lambda {N})
```

### Terraform Module Usage
```
Generate Terraform code to deploy Lambda "{name}" using module at ../../modules/lambda-function.
Function: {name}, runtime: {runtime}, memory: {mb} MB, timeout: {s} seconds
Trigger: EventBridge event-pattern: {pattern}
Env vars: {list}
IAM: {permissions}
Enable DLQ: {true/false}
```

### Angular Component Generation
```
Generate Angular 17 standalone component "{Name}" for route /{path}.
Purpose: {description}
Form fields: {list-with-validation}
API: {method} {endpoint}
UI: Angular Material + TailwindCSS
Navigation: Success → {route}, Cancel → {route}
```

### Unit Test Generation
```
Generate Jest unit tests for Lambda "{name}".
Test scenarios: {list-of-scenarios}
Mocks: AWS SDK ({clients}), env vars
Assertions: {expected-behaviors}
Target: >80% coverage
```

### Integration Test Generation
```
Generate integration test for workflow: {description}
Steps: {numbered-list}
Components: {Lambda functions, EventBridge, DynamoDB}
Setup: {test-data-creation}
Assertions: {expected-outcomes}
Timeout: {duration}
```

---

## Next Steps

1. ✅ Review AI development guide
2. ⏸️ Use prompt templates to generate Lambda functions
3. ⏸️ Review generated code before deployment
4. ⏸️ Write unit tests immediately after generation
5. ⏸️ Iterate on prompts based on output quality

---

**End of AI Development Guide**

---
---

## 🆕 v2.0 Addendum: Metadata-Lite Architecture Development Patterns

> **Added**: 2026-05-15
> **Document Version**: 2.0
> **Context**: MVP1 evolved to Metadata-Lite architecture (externalized Variable Six)
> **See**: MVP1-FOUNDATION-PLAN-v2.md, LAMBDA_CATALOG.md v2.0 Addendum, PROJECT_CONTEXT.md (Session Checkpoint 2026-05-15)

---

### What Changed in v2.0

**v1.0**: Lambdas had hardcoded business rules (scoring weights, SLA thresholds, panel size)

**v2.0**: Lambdas read business rules from `talent-flow-config` DynamoDB table

**Impact on Development**:
- ✅ **New Pattern**: Config-driven Lambda development (read from config table, not hardcode)
- ✅ **New Utility**: `config-reader.js` shared module (5-min caching, version support)
- ✅ **New Testing**: Versioning tests (verify in-flight candidates unaffected by config changes)
- ✅ **Updated Prompts**: Templates updated to include config reads

---

### New Development Pattern: Config-Driven Lambdas

#### Anti-Pattern (v1.0 — Hardcoded) ❌

```javascript
// vote-processor.js - v1.0 (WRONG)
async function calculateScore(vote) {
  // ❌ HARDCODED scoring weights
  const overall =
    vote.technical * 0.35 +
    vote.communication * 0.25 +
    vote.culturalFit * 0.20 +
    vote.problemSolving * 0.20;

  return overall;
}
```

**Problems**:
- Launching Banking vertical requires Lambda code changes
- No versioning (changing weights affects in-flight candidates)
- No admin control (developers required for rule changes)

---

#### Best Practice (v2.0 — Config-Driven) ✅

```javascript
// vote-processor.js - v2.0 (CORRECT)
const { getConfigVersion } = require('./config-reader');

async function calculateScore(vote, workflow) {
  // ✅ Read scoring weights from LOCKED config version
  const config = await getConfigVersion(
    workflow.tenantId,
    'SCORING_WEIGHTS',
    workflow.configVersion  // Locked to version workflow started with
  );

  // ✅ Calculate score using config weights
  const overall =
    vote.technical * config.data.technical +
    vote.communication * config.data.communication +
    vote.culturalFit * config.data.culturalFit +
    vote.problemSolving * config.data.problemSolving;

  return overall;
}
```

**Benefits**:
- ✅ Launching Banking vertical = change config data (1-2 days vs 2-3 weeks)
- ✅ Versioning built-in (in-flight candidates unaffected by config changes)
- ✅ Admin control (HR changes rules via UI, no developer needed)

---

### Pattern 1: Reading Versioned Config (For Fairness)

**Use Case**: Candidate evaluation logic (must use same rules throughout evaluation)

**When to Use**:
- Scoring weights (vote-processor)
- Panel rules (interview-scheduler, vote-processor)

**Pattern**:
```javascript
const { getConfigVersion } = require('./config-reader');

async function handler(event) {
  const { candidateId, workflowId } = event.detail;

  // Step 1: Get workflow to find locked config version
  const workflow = await dynamodb.get({
    TableName: process.env.WORKFLOW_TABLE_NAME,
    Key: { PK: `WORKFLOW#${workflowId}`, SK: 'METADATA' }
  }).promise();

  // Step 2: Read config LOCKED to workflow version
  const config = await getConfigVersion(
    workflow.Item.tenantId,
    'SCORING_WEIGHTS',  // or 'PANEL_RULES'
    workflow.Item.configVersion  // e.g., 2 (even if active is now 3)
  );

  // Step 3: Use config data
  const weights = config.data;
  // ... business logic using weights
}
```

**Key Point**: Always read `workflow.configVersion`, NOT active config. This ensures in-flight candidates unaffected by config changes.

---

### Pattern 2: Reading Active Config (For Operational Policy)

**Use Case**: Operational policies that apply to current workload (not candidate-specific)

**When to Use**:
- SLA thresholds (sla-monitor)
- Notification templates (notification-service)

**Pattern**:
```javascript
const { getActiveConfig } = require('./config-reader');

async function handler(event) {
  const { tenantId } = event.detail;

  // Step 1: Read ACTIVE config (not versioned)
  const config = await getActiveConfig(
    tenantId,
    'SLA_THRESHOLDS'  // or 'NOTIFICATION_TEMPLATES'
  );

  // Step 2: Use config data
  const thresholds = config.data;
  const firstEngagementSLA = thresholds.FIRST_ENGAGEMENT || 48;  // Fallback to 48h

  // ... business logic using thresholds
}
```

**Key Point**: SLA policies apply to all current work (not locked per candidate). If HR changes SLA from 48h to 24h, all candidates (including in-flight) are now subject to 24h SLA.

---

### Pattern 3: Capturing Config Version at Workflow Start

**Use Case**: Workflow orchestrator locks candidate to config version at creation

**When to Use**: workflow-orchestrator Lambda (when candidate created)

**Pattern**:
```javascript
const { getActiveConfig } = require('./config-reader');

async function createWorkflow(event) {
  const { candidateId, tenantId } = event.detail;
  const workflowId = `WF-${Date.now()}-${candidateId}`;

  // Step 1: Get ACTIVE config version (snapshot current state)
  const activeConfig = await getActiveConfig(tenantId, 'SCORING_WEIGHTS');

  // Step 2: Create workflow with locked config version
  await dynamodb.put({
    TableName: process.env.WORKFLOW_TABLE_NAME,
    Item: {
      PK: `WORKFLOW#${workflowId}`,
      SK: 'METADATA',
      workflowId,
      candidateId,
      tenantId,
      configVersion: activeConfig.version,  // Lock to v2 (even if v3 created later)
      createdAt: new Date().toISOString(),
      status: 'ACTIVE'
    }
  }).promise();

  // Step 3: Publish WorkflowStageStarted event
  await eventbridge.putEvents({
    Entries: [{
      Source: 'talent-flow.workflow',
      DetailType: 'WorkflowStageStarted',
      Detail: JSON.stringify({ workflowId, candidateId, configVersion: activeConfig.version })
    }]
  }).promise();
}
```

**Key Point**: Snapshot active config version at workflow creation. All downstream Lambdas read this locked version.

---

### Shared Utility: config-reader.js

**Location**: `lambda/shared/config-reader.js`

**Usage**: Import in every Lambda that reads config

**Example**:
```javascript
// vote-processor.js
const { getConfigVersion, getActiveConfig } = require('./config-reader');

// Read versioned config (for in-flight candidates)
const config = await getConfigVersion('DEFAULT', 'SCORING_WEIGHTS', 2);

// Read active config (for new operations)
const activeConfig = await getActiveConfig('DEFAULT', 'SLA_THRESHOLDS');
```

**Complete Implementation**: See `LAMBDA_CATALOG.md v2.0 Addendum` for full `config-reader.js` code.

**Caching Behavior**:
- 5-min TTL (config changes take effect within 5 minutes)
- 95% cache hit rate (warm Lambdas)
- Reduces DynamoDB reads by 95% (300K → 15K reads/month)

---

### Updated Prompt Template: Config-Driven Lambda

#### Template

```
Generate a Node.js 20.x Lambda function for the Talent Flow platform with the following specifications:

**Function Name**: {function-name}

**Purpose**: {1-2 sentence description}

**Trigger**: {EventBridge event / SQS queue / API Gateway / Scheduler}

**Input Event Schema**:
```json
{example-event-payload}
```

**Business Logic**:
1. {step-1}
2. {step-2}
3. {step-3}

**Config Requirements** (NEW in v2.0):
- Import config-reader.js: `const { getConfigVersion, getActiveConfig } = require('./config-reader');`
- Read config: `const config = await get{ConfigVersion|ActiveConfig}(tenantId, '{CONFIG_TYPE}', version?);`
- Config types: SCORING_WEIGHTS | SLA_THRESHOLDS | PANEL_RULES | APPROVAL_RULES | NOTIFICATION_TEMPLATES | STAGE_ENABLEMENT
- Use versioned config for: Scoring, Panel Rules (fairness requirement)
- Use active config for: SLA Thresholds, Notification Templates (operational policy)

**Output**:
- DynamoDB writes: {describe records to write}
- EventBridge events: {describe events to publish}

**Technical Constraints**:
- Runtime: Node.js 20.x
- AWS SDK v3 (DynamoDB, EventBridge)
- Structured logging (JSON with tenantId, candidateId, workflowId)
- Error handling: try/catch with DLQ on failure
- Environment variables: CONFIG_TABLE_NAME, {other vars}

**Testing Requirements**:
- Unit test: Config read mocked, business logic validated
- Integration test: Real config reads, verify correct config version used
- Versioning test (if applicable): Verify config changes don't affect in-flight candidates

**Reference**: Follow patterns from LAMBDA_CATALOG.md v2.0 Addendum
```

---

### Example Prompt: Generate vote-processor (v2.0)

```
Generate a Node.js 20.x Lambda function for the Talent Flow platform with the following specifications:

**Function Name**: vote-processor

**Purpose**: Process interview votes, calculate aggregate scores, determine recommendation, check for STRONG_NO veto.

**Trigger**: EventBridge event
- Source: talent-flow.evaluation
- DetailType: VoteSubmitted

**Input Event Schema**:
```json
{
  "detail": {
    "candidateId": "CAND-123",
    "workflowId": "WF-456",
    "interviewId": "INT-789",
    "voterId": "hr@company.com",
    "technicalScore": 8,
    "communicationScore": 7,
    "culturalFitScore": 9,
    "problemSolvingScore": 8,
    "recommendation": "STRONG_YES",
    "notes": "Excellent candidate",
    "submittedAt": "2026-05-15T10:30:00Z"
  }
}
```

**Business Logic**:
1. Extract vote details from event
2. Get workflow record to retrieve locked configVersion
3. Read SCORING_WEIGHTS config (versioned, locked to workflow.configVersion)
4. Read PANEL_RULES config (versioned, locked to workflow.configVersion)
5. Calculate overall score using config weights: `overall = tech * weights.technical + comm * weights.communication + ...`
6. Check for STRONG_NO veto (if panelRules.vetoPowerEnabled && recommendation === 'STRONG_NO', auto-reject)
7. If veto triggered, return immediately with NO_HIRE recommendation
8. Otherwise, write vote record to DynamoDB
9. Query all votes for this interview
10. If all required votes received (compare to interview.votesRequired):
    - Calculate aggregate scores (average, min, max)
    - Determine final recommendation (STRONG_HIRE, HIRE, NO_HIRE, MIXED)
    - Publish VotingCompleted event to EventBridge

**Config Requirements**:
- Import: `const { getConfigVersion } = require('./config-reader');`
- Read versioned config:
  - `const scoringConfig = await getConfigVersion(workflow.tenantId, 'SCORING_WEIGHTS', workflow.configVersion);`
  - `const panelConfig = await getConfigVersion(workflow.tenantId, 'PANEL_RULES', workflow.configVersion);`
- Use config data: `scoringConfig.data.technical`, `panelConfig.data.vetoPowerEnabled`

**Output**:
- DynamoDB writes:
  - Vote record: PK=CANDIDATE#{candidateId}, SK=VOTE#INT1#{voterId}
  - Score record (if all votes in): PK=CANDIDATE#{candidateId}, SK=SCORES#INT1
- EventBridge events:
  - VotingCompleted (if all votes received): detail={ candidateId, interviewId, scores, recommendation }

**Technical Constraints**:
- Runtime: Node.js 20.x
- AWS SDK v3: @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb, @aws-sdk/client-eventbridge
- Structured logging: console.log(JSON.stringify({ level: 'INFO', candidateId, workflowId, message: '...' }))
- Error handling: try/catch, throw errors for DLQ retry
- Environment variables: CONFIG_TABLE_NAME, WORKFLOW_TABLE_NAME, CANDIDATE_TABLE_NAME, EVENTBRIDGE_BUS_NAME

**Testing Requirements**:
- Unit test: Mock config reads, verify score calculation correctness (Tech 30%, Comm 25%, Cultural 25%, Problem 20%)
- Unit test: Mock config reads with vetoPowerEnabled=true, verify STRONG_NO triggers auto-reject
- Integration test: Real DynamoDB + config reads, verify in-flight candidate uses locked config version

**Reference**: Follow LAMBDA_CATALOG.md v2.0 Addendum (Updated Lambda: vote-processor)
```

---

### Testing Patterns: Config-Driven Lambdas

#### Unit Test: Mock Config Reads

```javascript
// test/unit/vote-processor.test.js
const { handler } = require('../../lambda/vote-processor');
const { getConfigVersion } = require('../../lambda/vote-processor/config-reader');

jest.mock('../../lambda/vote-processor/config-reader');

describe('vote-processor', () => {
  beforeEach(() => {
    // Mock config reads
    getConfigVersion.mockResolvedValue({
      version: 2,
      data: {
        technical: 0.30,
        communication: 0.25,
        culturalFit: 0.25,
        problemSolving: 0.20
      }
    });
  });

  it('should calculate overall score using config weights', async () => {
    const event = {
      detail: {
        candidateId: 'CAND-123',
        workflowId: 'WF-456',
        technicalScore: 8,
        communicationScore: 7,
        culturalFitScore: 9,
        problemSolvingScore: 8
      }
    };

    // Expected: 8*0.30 + 7*0.25 + 9*0.25 + 8*0.20 = 2.4 + 1.75 + 2.25 + 1.6 = 8.0
    const result = await handler(event);
    expect(result.overallScore).toBe(8.0);
  });

  it('should auto-reject on STRONG_NO if veto enabled', async () => {
    // Mock panel rules with veto enabled
    getConfigVersion.mockResolvedValueOnce({ version: 2, data: { technical: 0.30, ... } });
    getConfigVersion.mockResolvedValueOnce({ version: 2, data: { vetoPowerEnabled: true } });

    const event = {
      detail: {
        candidateId: 'CAND-123',
        workflowId: 'WF-456',
        recommendation: 'STRONG_NO',
        scores: { ... }
      }
    };

    const result = await handler(event);
    expect(result.recommendation).toBe('NO_HIRE');
    expect(result.vetoApplied).toBe(true);
  });
});
```

---

#### Integration Test: Verify Config Versioning

```javascript
// test/integration/config-versioning.test.js
const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

describe('Config Versioning', () => {
  it('should lock in-flight candidates to config version at creation', async () => {
    // Step 1: Create candidate Sarah (locks to config v1)
    const sarah = await createCandidate('Sarah Chen', 'Software Engineer');
    const sarahWorkflow = await getWorkflow(sarah.workflowId);
    expect(sarahWorkflow.configVersion).toBe(1);

    // Step 2: Change config to v2 (Tech 25%, Cultural 30%)
    await updateConfig('DEFAULT', 'SCORING_WEIGHTS', {
      technical: 0.25,
      communication: 0.25,
      culturalFit: 0.30,
      problemSolving: 0.20
    });

    // Step 3: Submit votes for Sarah
    await submitVote(sarah.candidateId, {
      technical: 8, communication: 7, culturalFit: 9, problemSolving: 8
    });

    // Step 4: Verify Sarah's score uses v1 weights (Tech 30%, not 25%)
    const sarahScore = await getScore(sarah.candidateId);
    expect(sarahScore.overall).toBe(8.0);  // 8*0.30 + 7*0.25 + 9*0.25 + 8*0.20

    // Step 5: Create new candidate John (locks to config v2)
    const john = await createCandidate('John Doe', 'Software Engineer');
    const johnWorkflow = await getWorkflow(john.workflowId);
    expect(johnWorkflow.configVersion).toBe(2);

    // Step 6: Submit identical votes for John
    await submitVote(john.candidateId, {
      technical: 8, communication: 7, culturalFit: 9, problemSolving: 8
    });

    // Step 7: Verify John's score uses v2 weights (Tech 25%, not 30%)
    const johnScore = await getScore(john.candidateId);
    expect(johnScore.overall).toBe(8.15);  // 8*0.25 + 7*0.25 + 9*0.30 + 8*0.20

    // ✅ PASS: Two candidates, two config versions, both correct
  });
});
```

---

### Admin UI Development Patterns (Angular)

#### Config Form Component (Example: Scoring Weights)

**Prompt Template**:
```
Generate Angular 17 standalone component "ScoringWeightsConfigComponent" for route /admin/config/scoring-weights.

**Purpose**: Admin form to update scoring weights config with real-time validation.

**Form Fields**:
- technicalWeight (number, 0-100, step: 1)
- communicationWeight (number, 0-100, step: 1)
- culturalFitWeight (number, 0-100, step: 1)
- problemSolvingWeight (number, 0-100, step: 1)
- Custom validator: Sum of all weights must equal 100

**API**:
- GET /api/config/SCORING_WEIGHTS → Load current config
- PUT /api/config/SCORING_WEIGHTS → Update config (creates new version)
- GET /api/config/SCORING_WEIGHTS/history → Show audit trail

**UI**:
- Angular Material: mat-card, mat-form-field, mat-slider, mat-button
- Real-time sum calculation (e.g., "Total: 98% (must be 100%)")
- Disable Save button if sum ≠ 100
- Display current version number (e.g., "Version 3 (Active)")
- Show "Changes will apply to new candidates only" warning
- Success toast: "Config updated to version 4. Changes take effect in 5 minutes."

**Navigation**:
- Success → Stay on page (reload config to show new version)
- Cancel → /admin/config (config dashboard)

**Auth**: Requires AdminGuard (isAdmin: true)

**Reference**: Follow Angular Material patterns, TailwindCSS for layout
```

---

### Common Config Patterns Cheatsheet

#### Pattern Summary

| Use Case | Config Type | Read Method | Versioned? | Example Lambda |
|----------|-------------|-------------|------------|----------------|
| Score calculation | SCORING_WEIGHTS | `getConfigVersion` | ✅ Yes | vote-processor |
| Panel size | PANEL_RULES | `getConfigVersion` | ✅ Yes | interview-scheduler |
| SLA breach detection | SLA_THRESHOLDS | `getActiveConfig` | ❌ No | sla-monitor |
| Email templates | NOTIFICATION_TEMPLATES | `getActiveConfig` | ❌ No | notification-service |
| Offer approval | APPROVAL_RULES | `getActiveConfig` | ❌ No | send-approval-request (MVP2) |
| Stage enablement | STAGE_ENABLEMENT | `getActiveConfig` | ❌ No | workflow-orchestrator (MVP2) |

**Rule of Thumb**:
- **Versioned** (getConfigVersion): Candidate evaluation logic (must be fair, same rules throughout)
- **Active** (getActiveConfig): Operational policies (apply to current workload, not per-candidate)

---

### Error Handling: Config Reads

#### Handle Missing Config Gracefully

```javascript
const { getActiveConfig } = require('./config-reader');

async function handler(event) {
  try {
    // Attempt to read config
    const config = await getActiveConfig(tenantId, 'SLA_THRESHOLDS');
    const threshold = config.data.FIRST_ENGAGEMENT;

  } catch (error) {
    if (error.message.includes('No active config found')) {
      // Fallback to defaults if config not found
      console.warn(`Config not found for ${tenantId}, using defaults`);
      const threshold = 48;  // Default: 48h
    } else {
      // Unexpected error, throw for DLQ retry
      console.error('Config read error:', error);
      throw error;
    }
  }

  // ... rest of business logic
}
```

**Best Practice**: Always provide fallback defaults for config reads (defensive coding).

---

### Summary of v2.0 Development Changes

**New Patterns**:
- ✅ **Config-driven Lambdas**: Read rules from config table, not hardcode
- ✅ **Versioned config reads**: `getConfigVersion` for fairness (scoring, panel)
- ✅ **Active config reads**: `getActiveConfig` for operational policy (SLA, notifications)
- ✅ **Workflow version locking**: Capture `configVersion` at workflow creation

**New Shared Utility**:
- ✅ **config-reader.js**: 5-min caching, version support, fallback defaults

**Updated Prompt Templates**:
- ✅ **Lambda prompts**: Include config requirements, import config-reader, specify versioned vs active
- ✅ **Testing prompts**: Include versioning tests, config mocking

**Testing Strategy**:
- ✅ **Unit tests**: Mock config reads, verify business logic
- ✅ **Integration tests**: Real config reads, verify correct version used
- ✅ **Versioning tests**: Change config, verify in-flight candidates unaffected

**Admin UI Patterns**:
- ✅ **Angular Material forms**: Validate config constraints (e.g., weights sum to 100)
- ✅ **Real-time feedback**: Show version number, warn about change impact
- ✅ **Audit trail**: Display config history with version, timestamp, createdBy

**Common Pitfalls to Avoid**:
- ❌ **Reading active config for scoring**: WRONG (must use versioned config)
- ❌ **Forgetting to include config-reader.js**: Lambda will fail at runtime
- ❌ **Hardcoding fallback values**: Use constants, document why
- ❌ **Not testing versioning**: Critical for audit compliance

**Next Steps**:
1. Review config-driven patterns (this addendum)
2. Use updated prompt templates to generate Lambdas
3. Always include config-reader.js in Lambda packages
4. Write versioning integration tests for all config-driven Lambdas
5. Build admin UI using Angular Material config form pattern

---

**v2.0 Addendum Complete**
**Last Updated**: 2026-05-15
**Related Documents**:
- MVP1-FOUNDATION-PLAN-v2.md (execution plan)
- LAMBDA_CATALOG.md v2.0 Addendum (Lambda updates with config reads)
- DYNAMODB_SCHEMA_DESIGN.md v2.0 Addendum (config table schema)
- PROJECT_CONTEXT.md (Session Checkpoint 2026-05-15)
