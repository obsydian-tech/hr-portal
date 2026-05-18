# MVP1 Foundation Plan — Talent Flow Platform (Metadata-Lite Architecture)

> **Version:** 2.0
> **Date:** 2026-05-15
> **Status:** Approved - Ready for Execution
> **POC Budget:** $0/month (validated - 100% AWS Free Tier)
> **Architecture:** Metadata-Lite — Business variability in config, platform invariants in code

---

## Table of Contents

1. [Executive Summary](#executive-summary)
   - [The Variable Six](#the-variable-six-externalized-from-day-1)
   - [Versioning Strategy](#versioning-strategy-built-in-from-day-1)
   - [Cost Analysis](#cost-analysis-metadata-lite-vs-hardcoded)
2. [MVP Roadmap](#mvp-roadmap)
3. [MVP1: Detailed Milestone Breakdown](#mvp1-detailed-milestone-breakdown)
   - [Milestone 1: Foundational Vertical Slice + Authentication + Config Layer](#milestone-1-foundational-vertical-slice--authentication--config-layer-week-1-2)
   - [Milestone 2: Interview Scheduling Workflow](#milestone-2-interview-scheduling-workflow-week-3)
   - [Milestone 3: Evaluation Submission & Aggregation + Config UI](#milestone-3-evaluation-submission--aggregation--config-ui-week-4-5)
   - [Milestone 4: Polish, Hardening & SLA Monitoring](#milestone-4-polish-hardening--sla-monitoring-week-6-7)
4. [Dependency Graph](#dependency-graph)
5. [Demo Script](#demo-script)
6. [Risk Mitigation Strategy](#risk-mitigation-strategy)
7. [File Modification Plan](#file-modification-plan)
8. [MVP2–MVP5 Expanded Skeleton](#mvp2mvp5-expanded-skeleton)
9. [Execution Readiness](#execution-readiness)
10. [Summary](#summary)

---

## Executive Summary

**MVP1 Goal:** Deliver a production-ready, demo-able Evaluation Intelligence workflow (Stage 1–3) that proves the Talent Flow platform orchestrates hiring decisions through event-driven automation — no manual handoffs, no disconnected tools. Business rules are **configurable, not hardcoded** — proving the platform thesis from Day 1.

**Demo Success:** Business Analyst creates a candidate → Hiring Manager schedules interview → Panel Members submit evaluations → System aggregates scores **using configurable weights read from tenant config** → applies business rules (including configurable STRONG_NO veto) → auto-advances candidate to next stage → HR Director **changes scoring weights via admin UI with no code deployment** → next evaluation uses new weights immediately. All stakeholders receive notifications. All actions tracked in real-time UI.

| Attribute | Detail |
|---|---|
| **Timeline** | 7 weeks (4 milestones) |
| **Budget** | $0/month (AWS Free Tier) |
| **Team** | Solo developer + Claude AI assistance |
| **Infrastructure** | AWS (Lambda, DynamoDB, EventBridge, API Gateway, SQS, SES, Cognito), Angular 17, Terraform |
| **Architecture** | Metadata-Lite — The Variable Six externalized to config from Day 1 |

**Architectural Approach: Metadata-Lite Architecture**
- Business variability (scoring weights, SLAs, approval rules, panel sizes, notifications, stage enablement) externalized to configuration from Day 1
- Platform invariants (orchestration engine, event processing, authentication, audit infrastructure) remain in code
- **Golden Rule:** *"Business variability belongs in metadata. Platform invariants belong in code."*
- Enables vertical expansion (agriculture, banking verticals) without code changes
- Foundation for AI configuration assistant (Phase 3)

**Critical Fixes Included:**
- Scoring weights **configurable** (stored in tenant config, not hardcoded) — corrects BRD gap
- STRONG_NO veto logic **configurable** (implements BR-006 as tenant rule, can be toggled per tenant)
- Panel size **fully configurable** per position level (min 1 member, stored in config)
- SLA thresholds **configurable** per tenant (not hardcoded in Lambda)
- Stage enablement flags (tenants can disable stages like police clearance)
- Notification templates stored as metadata (not hardcoded in code)

**Foundation Established:**
- Tenant-aware architecture from Day 1
- Cognito authentication with admin role support
- Event-driven orchestration patterns that extend to all 12 stages without refactoring
- **Metadata-Lite configuration layer:** Business rules stored in DynamoDB config table, read at runtime by Lambdas
- **The Variable Six externalized:** Scoring, SLAs, Approvals, Panel Rules, Notifications, Stage Enablement
- **Versioning from Day 1:** In-flight candidates stay on the config version they started with — config changes only affect new candidates
- **Vertical adapter pattern enabled:** Same codebase serves multiple industries via different config metadata

---

### The Variable Six (Externalized from Day 1)

These six categories of business rules are stored as tenant-specific configuration metadata, not hardcoded in Lambda functions:

| # | Category | What It Controls | Default Value | Who Changes It |
|---|---|---|---|---|
| 1 | **Scoring Weights** | Technical, Communication, Cultural Fit, Problem Solving percentages | Tech 30%, Comm 25%, Cultural 25%, Problem 20% | HR Director |
| 2 | **SLA Thresholds** | First engagement, Evaluation completion deadlines and escalation levels | First engagement 48h, Evaluation 72h | HR Director |
| 3 | **Approval Rules** | Position-level thresholds requiring manager/executive approval | Senior+ requires manager approval | HR Director |
| 4 | **Panel Size Rules** | Required votes per position level | Junior: 2, Senior: 3, Executive: 5 | HR Director |
| 5 | **Notification Templates** | Email/SMS/WhatsApp message templates with variable substitution | Standard email templates | HR Director |
| 6 | **Stage Enablement Flags** | Enable/disable stages per tenant | All 12 stages enabled | HR Director |

**Why These Six:** Industry analysis shows these represent 80% of customization requests. Externalizing these eliminates ~R800K of the typical R1.2M implementation consulting fee.

**What Stays Hardcoded (Platform Invariants):**
- Workflow orchestration engine (EventBridge, Step Functions, Lambda)
- Event processing patterns
- DynamoDB table schemas
- Authentication/permissions primitives (Cognito)
- Audit infrastructure
- Permission engine core

**Admin UI in MVP1:** Scoring Weights, SLA Thresholds, Panel Rules (3 of 6). Approval Rules, Notification Templates, and Stage Enablement are read from config by Lambdas but configured via seed data — admin UI for these 3 deferred to MVP2 to keep timeline at 7 weeks.

---

### Versioning Strategy (Built-In from Day 1)

> ⚠️ **Critical architectural decision** identified during three-model synthesis (Gemini): *"If you change metadata for Stage 2 while 50 candidates are in Stage 2, do they follow old rules or new ones?"*

**The Rule:**
- **New candidates:** Always use the latest active config version
- **In-flight candidates:** Stay on the config version they started with
- **Optional migration:** HR Director can trigger "migrate candidate to new config" if safe

**Implementation:**

Config records in DynamoDB are versioned:

```
// talent-flow-config table
{
  PK: "TENANT#acme-corp",
  SK: "CONFIG#SCORING_WEIGHTS#v3",
  configType: "SCORING_WEIGHTS",
  version: 3,
  isActive: true,          // ← Current version for NEW candidates
  data: { technical: 0.30, communication: 0.25, culturalFit: 0.25, problemSolving: 0.20 },
  createdBy: "jane.doe@acme-corp.com",
  createdAt: "2026-05-20T10:30:00Z",
  previousVersion: 2
}
```

Workflow state records lock to a config version:

```
// talent-flow-state table
{
  PK: "TENANT#acme-corp#CANDIDATE#candidate-123",
  SK: "WORKFLOW#STATE",
  configVersion: 3,       // ← Locked at creation time
  currentStage: "EVALUATION_INTELLIGENCE",
  stageHistory: [
    { stage: "STAGE_1", startedAt: "...", configVersion: 3 }
  ]
}
```

**What This Prevents:**
- ❌ Candidates scored with different weights mid-evaluation
- ❌ Compliance violations (audit trail shows which rules applied to each candidate)
- ❌ Data corruption (old stages don't exist in new config)

---

### Cost Analysis: Metadata-Lite vs Hardcoded

| Scenario | Implementation Cost | Vertical 2 Launch Cost | Total Cost (2 Verticals) |
|---|---|---|---|
| **Hardcoded Approach** | 6 weeks dev | 12 weeks dev (rebuild) | 18 weeks (R1.8M @ R100K/week) |
| **Metadata-Lite Approach** | 7 weeks dev | 2 days config | 7.4 weeks (R740K @ R100K/week) |
| **Savings** | -1 week | +11.6 weeks | **R1.06M saved** |

**Customer Perspective:**
- **Hardcoded:** "We need to customize scoring weights" → "That requires development, R200K, 2 weeks"
- **Metadata-Lite:** "We need to customize scoring weights" → "Here's the config UI, change it yourself, 5 minutes"
- **Value Proposition:** Eliminate ~R800K of typical R1.2M consulting implementation fee

---

## MVP Roadmap

| MVP | Theme | Stages | Timeline | Budget | Demo Audience |
|---|---|---|---|---|---|
| **MVP1** | Foundational Workflow Engine (Metadata-Lite) | 1–3: Evaluation Intelligence | Week 1–7 | $0/month | BA, PO, Hiring Mgr, Panel |
| **MVP2** | Selection & Offer Intelligence + Vertical Packs | 4–8: Selection + Offer Orchestration | Week 8–15 | $0–5/month | + C-level, + Candidates |
| **MVP3** | Onboarding Orchestration | 9–12: Onboarding + Compliance | Week 16–25 | $5–15/month | + IT, + Finance, + Legal |
| **MVP4** | Intelligence Layer + AI Config Assistant | AI Insights + Conversational Config | Week 26–34 | $50–100/month | All users |
| **MVP5** | Agentic Automation | Autonomous AI Agents | Week 35–50 | $300–500/month | All users + AI |


---

## MVP1: Detailed Milestone Breakdown

### Milestone 1: Foundational Vertical Slice + Authentication + Config Layer (Week 1–2)

**Goal:** Prove the entire stack works end-to-end with secured access AND config-driven business rules from Day 1.

**Effort:** 12 days (96 hours)

#### Infrastructure Setup (Day 1–2, 18h)

- **T1.1:** Create AWS dev account, configure IAM user with programmatic access (2h)
- **T1.2:** Set up Terraform backend (S3 bucket for state, DynamoDB table for locking) (2h)
- **T1.3:** Deploy Cognito User Pool + App Client (email/password auth, MFA disabled for POC) (3h)
  - Create two Cognito groups: `Users` (standard access) and `Admins` (config management access)
  - Admin group maps to `isAdmin: true` custom claim in JWT token
- **T1.4:** Deploy EventBridge custom bus (`talent-flow-bus`) (1h)
- **T1.5:** Deploy DynamoDB tables with tenant-aware schemas (4h):
  - **`talent-flow-state`** — operational state (candidates, interviews, votes, workflows)
    - PK: `TENANT#{tenantId}#CANDIDATE#{candidateId}` | SK: varies by entity
    - GSI1: `GSI1PK` / `GSI1SK` (generic, reusable for multiple access patterns)
    - GSI2: `GSI2PK` / `GSI2SK` (generic, reusable)
  - **`talent-flow-config`** — tenant configuration metadata (the Variable Six)
    - PK: `TENANT#{tenantId}` | SK: `CONFIG#{configType}#v{version}`
    - GSI1PK: `TENANT#{tenantId}#ACTIVE` | GSI1SK: `CONFIG#{configType}` (query active config by type)
    - Attributes: `configType`, `version`, `isActive`, `data` (JSON), `createdBy`, `createdAt`, `previousVersion`
    - TTL on inactive versions: 365 days (keep for audit, auto-cleanup after 1 year)
- **T1.6:** Deploy API Gateway REST API with Cognito authorizer (3h)
- **T1.7:** Configure AWS SES for email sending (verify domain or use SES sandbox with verified emails) (2h)
- **T1.8:** Validate infrastructure (test Cognito signup with both User and Admin groups, DynamoDB write to both tables, EventBridge event publish) (1h)

#### Backend — Candidate Creation (Day 3–4, 16h)

- **T1.9:** Create Lambda: `api-handler` (POST /candidates endpoint) (4h)
  - Validates input (firstName, lastName, email, position, department, tenantId from JWT claims)
  - Checks duplicate email (query GSI2)
  - Writes candidate record to DynamoDB with tenantId
  - Publishes `CandidateCreated` event to EventBridge
  - Returns candidateId + workflowId
- **T1.10:** Create Lambda: `workflow-orchestrator` (subscribes to `CandidateCreated`) (5h)
  - Creates workflow record with tenantId
  - **Snapshots current config version:** Reads active config version from `talent-flow-config` and stores `configVersion` in the workflow state record — locking this candidate to these business rules
  - Initializes 12-stage tracking (Stage 1–3: `IN_PROGRESS`, rest: `PENDING`)
  - Publishes `WorkflowStageStarted` event (Stage 1–3: Evaluation Intelligence)
- **T1.11:** Deploy Lambdas with Terraform (use lambda-function module) (4h)
- **T1.12:** Create EventBridge rule: `candidate-created-to-orchestrator` (2h)
- **T1.13:** Write unit tests for `api-handler` and `workflow-orchestrator` (1h)
  - Include test: verify `configVersion` is captured in workflow state record

#### Backend — Configuration Management (Day 4–5, 10h)

- **T1.14:** Create Lambda: `config-manager` (API for CRUD on tenant configs) (4h)
  - `GET /config/{configType}` — Returns active config for tenant (reads from GSI1 where `isActive=true`)
  - `PUT /config/{configType}` — Creates new config version, sets previous to `isActive: false`
    - Validates input (e.g., scoring weights must sum to 100%)
    - Publishes `ConfigurationUpdated` event to EventBridge
    - Stores audit trail: who changed what, previous values, new values
  - `GET /config/audit-trail` — Returns config change history for tenant
  - IAM: `dynamodb:GetItem/PutItem/Query` on `talent-flow-config` table
  - **Versioning logic:** Every PUT creates a NEW record (`v{n+1}`), never overwrites. Old version marked `isActive: false`.
- **T1.15:** Seed default config for test tenant (2h)
  - Default scoring weights: `{ technical: 0.30, communication: 0.25, culturalFit: 0.25, problemSolving: 0.20 }`
  - Default SLA thresholds: `{ firstEngagement: { hours: 48, escalationLevel: "MANAGER" }, evaluationCompletion: { hours: 72, escalationLevel: "HR" } }`
  - Default panel rules: `{ junior: { votesRequired: 2 }, senior: { votesRequired: 3 }, executive: { votesRequired: 5 }, rules: { strongNoVeto: true, unanimousForExec: false } }`
  - Default approval rules: `{ seniorRequiresManager: true, executiveRequiresCLevel: true, salaryThreshold: 150000 }`
  - Default notification templates: `{ interviewScheduled: { subject: "...", body: "..." }, slaBreachAlert: { subject: "...", body: "..." } }`
  - Default stage enablement: `{ stages: { policeClearance: true, backgroundCheck: true, drugScreening: true, ... } }`
  - Insert via Terraform DynamoDB item resource or bootstrap script — all 6 Variable Six seeded as `v1`
- **T1.16:** Create Cognito admin group + admin test user (2h)
  - Create user `hr-director@testcompany.com` in Cognito with `Admins` group
  - Create user `ba@testcompany.com` in Cognito with `Users` group (standard access)
  - Verify JWT tokens include `custom:isAdmin` claim based on group membership
- **T1.17:** Deploy `config-manager` Lambda with Terraform (1h)
- **T1.18:** Test config API — GET config returns seeded defaults, PUT creates v2, GET returns v2, v1 still exists with `isActive: false` (1h)

#### Frontend — Candidate Creation (Day 6–7, 16h)

- **T1.19:** Set up Angular 17 project with standalone components, Angular Material, TailwindCSS (3h)
- **T1.20:** Create Cognito authentication service (sign up, sign in, sign out, get JWT token) (4h)
  - Parse `isAdmin` claim from JWT — expose `isAdmin()` method for route guards
- **T1.21:** Create login component (email/password form, error handling) (3h)
- **T1.22:** Create candidate service (API integration with Authorization header from Cognito) (2h)
- **T1.23:** Create `candidate-create` component (reactive form with 7 fields + tenantId injected from auth) (4h)
  - **Fields:** firstName, lastName, email, phone, position, department (dropdown), source (dropdown)
  - **Validation:** required fields, email format, phone pattern
  - **Submit:** POST /candidates, navigate to candidate list on success

#### Frontend — Candidate List (Day 8–9, 16h)

- **T1.24:** Create `candidate-list` component (table view with columns: name, position, department, status, stage, created date) (4h)
- **T1.25:** Add polling mechanism (refresh every 5 seconds to show status updates) (2h)
- **T1.26:** Add navigation (header with "Candidates" link, "Configuration" link for admins only, logout button) (2h)
  - "Configuration" link visible only when `authService.isAdmin()` returns true
- **T1.27:** Add empty state ("No candidates yet. Create your first candidate.") (1h)
- **T1.28:** Add loading states (spinner during API calls) (2h)
- **T1.29:** Add error handling (toast notifications for API failures) (2h)
- **T1.30:** Style with TailwindCSS (responsive design, clean layout) (3h)

#### Testing & Validation (Day 10–12, 20h)

- **T1.31:** Integration test: Create candidate → verify DynamoDB record + workflow created **with configVersion snapshot** (2h)
- **T1.32:** E2E test: Login → Create candidate → See candidate in list (3h)
- **T1.33:** Config test: GET /config/SCORING_WEIGHTS returns seeded defaults, PUT creates v2, GET returns v2 (2h)
- **T1.34:** Versioning test: Create candidate (gets configVersion=1) → Update config to v2 → Create second candidate (gets configVersion=2) → Verify first candidate still references v1 (2h)
- **T1.35:** Deploy to AWS dev environment (2h)
- **T1.36:** Smoke test all flows (login as admin, login as user, create candidate, list candidates, get config, logout) (2h)
- **T1.37:** Document M1 completion (update `PROJECT_CONTEXT.md` checkpoint) (1h)
- **T1.38:** Internal demo to self (record video, take screenshots) (3h)
- **T1.39:** Fix any critical bugs discovered (3h buffer)

**Deliverables:** Working login (with admin/user roles), candidate creation, candidate list, **config management API with all 6 Variable Six seeded, config versioning working**. Cognito + DynamoDB (2 tables) + EventBridge + Lambda + API Gateway all operational. Tenant-aware and config-driven from Day 1.


---

### Milestone 2: Interview Scheduling Workflow (Week 3)

**Goal:** Add interview scheduling with email notifications. Notification service reads templates from config.

**Effort:** 5 days (40 hours)

#### Backend — Interview Scheduling (Day 1–2, 16h)

- **T2.1:** Create Lambda: `interview-scheduler` (subscribes to `InterviewScheduled` event) (4h)
  - Writes interview record to DynamoDB (`PK: TENANT#{tenantId}#CANDIDATE#{candidateId}`, `SK: INTERVIEW#{interviewId}`)
  - Sends calendar invite notifications (publish to SQS notification queue)
  - Publishes `InterviewConfirmed` event
- **T2.2:** Create SQS queue: `talent-flow-notification-queue` + DLQ (2h)
- **T2.3:** Create Lambda: `notification-service` (consumes SQS, sends emails via SES) (6h)
  - Route by notificationType (`EMAIL` / `SMS` / `SLACK`)
  - **Config-driven templates:** Reads notification template from `talent-flow-config` table (configType: `NOTIFICATION_TEMPLATES`)
  - Falls back to hardcoded default if config not found (defensive coding)
  - Template supports variable substitution: `{{candidateName}}`, `{{position}}`, `{{interviewDate}}`, `{{meetingLink}}`
  - Delete SQS message on success
- **T2.4:** Update `api-handler`: Add POST /interviews endpoint (3h)
  - **Input:** candidateId, interviewType, interviewers (array), scheduledAt, durationMinutes, meetingLink
  - Publishes `InterviewScheduled` event
- **T2.5:** Deploy new Lambdas + SQS with Terraform (1h)

#### Frontend — Interview Scheduling (Day 3–4, 16h)

- **T2.6:** Create `candidate-detail` component (shows candidate metadata + timeline) (4h)
- **T2.7:** Create `interview-schedule` component (dialog/modal with form) (4h)
  - **Fields:** interviewType (dropdown: `TECHNICAL_SCREEN`, `CULTURAL_FIT`, `PANEL_INTERVIEW`), scheduledAt (datetime picker), durationMinutes (dropdown: 30, 60, 90), meetingLink (text), interviewers (multi-select with email autocomplete)
  - **Validation:** required fields, scheduledAt in future, valid emails
- **T2.8:** Add "Schedule Interview" button to candidate-detail page (2h)
- **T2.9:** Update candidate-detail to show interview timeline (list of interviews with status) (3h)
- **T2.10:** Add interview service (API integration for POST /interviews) (2h)
- **T2.11:** Style interview components (1h)

#### Testing & Validation (Day 5, 8h)

- **T2.12:** Unit tests for `interview-scheduler` and `notification-service` (2h)
  - Include test: notification-service reads template from config, falls back to default if missing
- **T2.13:** Integration test: Schedule interview → verify DynamoDB + email sent (2h)
- **T2.14:** E2E test: Login → Create candidate → Schedule interview → Verify timeline (2h)
- **T2.15:** Deploy to AWS dev environment (1h)
- **T2.16:** Internal demo (verify email received, calendar invite looks good) (1h)

**Deliverables:** Interview scheduling UI, config-driven email notifications working, interview timeline in candidate detail.

---

### Milestone 3: Evaluation Submission & Aggregation + Config UI (Week 4–6)

**Goal:** Complete core business logic with **config-driven** scoring, STRONG_NO veto, and configurable panel size. Deliver admin UI for 3 of 6 Variable Six (Scoring Weights, SLA Thresholds, Panel Rules).

**Effort:** 13 days (104 hours)

#### Backend — Evaluation Submission (Day 1–3, 24h)

- **T3.1:** Update `api-handler`: Add POST /votes endpoint (4h)
  - **Input:** candidateId, interviewId, interviewerId, scores (technical, communication, culturalFit, problemSolving — each 0–10), decision (`STRONG_YES` / `YES` / `NO` / `STRONG_NO`), feedback (text)
  - Publishes `VoteSubmitted` event
  - Returns voteId + voting progress (submitted/required)
- **T3.2:** Create Lambda: `vote-processor` (subscribes to `VoteSubmitted` event) (10h)
  - **CONFIG-DRIVEN SCORING:** Read scoring weights from config table using candidate's `configVersion`
    - At Lambda start: `const config = await getConfig(tenantId, 'SCORING_WEIGHTS', candidate.configVersion)`
    - Calculate: `overall = tech * config.technical + comm * config.communication + culturalFit * config.culturalFit + problem * config.problemSolving`
    - NOT hardcoded: Business rule lives in metadata, not code
  - **CONFIG-DRIVEN VETO LOGIC:** Read voting rules from config table
    - Check: `if (panelConfig.rules.strongNoVeto && votes.some(v => v.decision === 'STRONG_NO'))`
    - Immediately set recommendation = `NO_HIRE` (bypass all other logic)
    - Log reason: `"Veto: STRONG_NO from {interviewerId}"`
    - Enables future: "Disable STRONG_NO veto for internal hires" (just toggle config)
  - **CONFIG-DRIVEN PANEL SIZE:** Read `interview.votesRequired` from DynamoDB (already metadata)
    - Query interview record to get `votesRequired` (configurable per interview)
    - Only publish `VotingCompleted` when `votesSubmitted === votesRequired`
  - Calculate aggregate scores (average, min, max, stdDev for each category)
  - Determine recommendation (`STRONG_HIRE` / `HIRE` / `MIXED` / `NO_HIRE`) if no STRONG_NO veto
  - Publish `VotingCompleted` event when all votes in

  **Architectural Note — The Metadata-Lite Pattern:**
  - **Before (hardcoded):** `const overall = technical * 0.30 + communication * 0.25 + culturalFit * 0.25 + problemSolving * 0.20;`
  - **After (metadata-lite):** `const overall = technical * config.technical + communication * config.communication + culturalFit * config.culturalFit + problemSolving * config.problemSolving;`
  - **Impact:** HR Director can change weights via admin UI — no code deployment needed, changes take effect on next candidate
  - **Performance:** One DynamoDB read at Lambda start (cached for 5 min via TTL), negligible performance impact
  - **Versioning:** Uses candidate's `configVersion`, not latest — in-flight candidates unaffected by config changes

- **T3.3:** Create Lambda: `evaluation-completer` (subscribes to `VotingCompleted`) (4h)
  - Check if all required interviews complete for candidate
  - Aggregate final scores across all interviews
  - Update candidate status
  - Publish `EvaluationCompleted` event
  - Update workflow stage to `SELECTION_ORCHESTRATION` (Stage 4–8)
- **T3.4:** Update `interview-scheduler`: Add `votesRequired` field to interview record (2h)
  - Read default from panel rules config based on position level (junior/senior/executive)
  - Store in DynamoDB interview record (can be overridden per interview)
- **T3.5:** Deploy updated Lambdas with Terraform (2h)
- **T3.6:** Create EventBridge rules: `vote-submitted-to-processor`, `voting-completed-to-completer` (2h)
- **T3.7:** Update DynamoDB schema to support vote records (`PK: TENANT#{tenantId}#CANDIDATE#{candidateId}`, `SK: VOTE#{interviewId}#{voterId}`) (2h)

#### Admin UI — Configuration Management (Day 4–5, 16h)

**Goal:** HR Directors can modify 3 of the Variable Six via web UI without touching code.

- **T3.8:** Create `config` Angular module with routing (1h)
  - Route: `/config/scoring-weights`, `/config/sla-thresholds`, `/config/panel-rules`
  - Protected by `AdminGuard` (checks `authService.isAdmin()` — only users in Cognito `Admins` group)
  - Redirect to `/candidates` if non-admin tries to access

- **T3.9:** Create `scoring-weights-config` component (4h)
  - **UI:** 4 sliders (Technical, Communication, Cultural Fit, Problem Solving)
  - **Validation:** Sliders total must equal 100% (live validation as user drags)
  - **Display:** Current values with percentage labels, color-coded sliders
  - **Versioning display:** "Current version: v3 (changed by jane.doe@company.com on 2026-05-20)"
  - **Actions:** [Reset to Defaults] [Save Changes]
  - **On Save:** PUT /config/scoring-weights → creates new version → success toast → refresh
  - **Style:** Clean card layout, Material Design sliders

- **T3.10:** Create `sla-config` component (3h)
  - **UI:** Table with SLA name, duration input (hours/days toggle), escalation level dropdown
  - **Rows:** First Engagement (default 48h, escalate to Manager), Evaluation Completion (default 72h, escalate to HR)
  - **Validation:** Duration must be > 0, escalation level required
  - **Actions:** [Add SLA] [Save Changes]

- **T3.11:** Create `panel-rules-config` component (3h)
  - **UI:** Table with position level, required votes dropdown (1–5)
  - **Rows:** Junior (2 votes), Mid-Level (2 votes), Senior (3 votes), Executive (5 votes)
  - **Extra Rules:**
    - Checkbox: "Any STRONG_NO = Auto-reject" (default: checked) — maps to `panelConfig.rules.strongNoVeto`
    - Checkbox: "Executive roles require unanimous YES" (default: unchecked) — maps to `panelConfig.rules.unanimousForExec`
  - **Versioning display:** Shows current version number and last modified by

- **T3.12:** Create `config.service.ts` (API integration) (2h)
  - Methods: `getConfig(type)`, `updateConfig(type, data)`, `getAuditTrail()`
  - Handles auth headers, error handling, caching
  - Returns typed interfaces for each config type

- **T3.13:** Add "Configuration" link to admin nav menu (1h)
  - Only visible to users with `isAdmin: true` in JWT claims
  - Sidebar or top-nav dropdown: Scoring Weights, SLA Thresholds, Panel Rules

- **T3.14:** Add audit trail view (2h)
  - Table showing: Timestamp, User, Config Type, Changes, Previous Values
  - Query: GET /config/audit-trail
  - Display: "2026-05-20 10:30 — jane.doe@company.com changed Scoring Weights: Tech 30%→35%, Cultural 25%→20%"

**Admin UI Deferred to MVP2:** Approval Rules, Notification Templates, Stage Enablement Flags. These 3 are seeded as config data and read by Lambdas, but no admin UI yet — configured via seed data or direct DynamoDB update during MVP1.

**Deliverables:** Admin users can modify scoring weights, SLA thresholds, panel rules via UI. Changes create new config version. In-flight candidates unaffected. Audit trail shows all config changes for compliance.

#### Frontend — Evaluation Form (Day 6–7, 16h)

- **T3.15:** Create `evaluation-submit` component (form for panel members) (6h)
  - **Fields:** 4 score sliders (0–10 with labels), decision radio buttons (`STRONG_YES` / `YES` / `NO` / `STRONG_NO`), feedback textarea
  - **Validation:** all scores required, decision required, feedback min 50 chars
  - **Visual indicator:** `STRONG_NO` in red with warning "This will auto-reject the candidate"
- **T3.16:** Add "Submit Evaluation" button to candidate-detail (only visible if user is interviewer) (2h)
- **T3.17:** Update candidate-detail to show votes submitted (progress: 1/2, 2/2 with checkmarks) (3h)
- **T3.18:** Create `aggregate-scores` component (displays average, min, max for each category + overall recommendation) (4h)
- **T3.19:** Update candidate-detail to show aggregate scores after voting complete (3h)
- **T3.20:** Add vote service (API integration for POST /votes) (2h)
- **T3.21:** Update candidate-list to show new stage "Selection Orchestration" after evaluation complete (2h)
- **T3.22:** Style evaluation components (2h)

#### Testing — Critical Gap Validation (Day 8–9, 16h)

- **T3.23:** Unit test: Verify config-driven scoring weights (2h)
  - **Setup:** Mock config with weights `[Tech 30%, Comm 25%, Cultural 25%, Problem 20%]`
  - **Test case:** votes with scores `[8,9,7,8]` and `[7,8,8,8]`
  - **Expected overall:** `(7.5×0.30 + 8.5×0.25 + 7.5×0.25 + 8×0.20) = 7.875`
  - **Verify:** Lambda reads config from DynamoDB, not hardcoded values
- **T3.24:** Unit test: Verify STRONG_NO veto logic reads from config (4h)
  - **Test case 1:** Config `strongNoVeto: true`, 2 votes (`STRONG_YES`, `STRONG_NO`) → Expected: `NO_HIRE` (veto)
  - **Test case 2:** Config `strongNoVeto: true`, 3 votes (`STRONG_YES`, `YES`, `STRONG_NO`) → Expected: `NO_HIRE` (veto)
  - **Test case 3:** Config `strongNoVeto: false`, 2 votes (`STRONG_YES`, `STRONG_NO`) → Expected: `MIXED` (no veto, majority rules)
  - **Test case 4:** Config `strongNoVeto: true`, 2 votes (`STRONG_YES`, `YES`) → Expected: `STRONG_HIRE` (no veto triggered)
- **T3.25:** Unit test: Verify configurable panel size (2h)
  - **Test case 1:** `interview.votesRequired = 1` → `VotingCompleted` after 1 vote
  - **Test case 2:** `interview.votesRequired = 3` → `VotingCompleted` after 3 votes
  - **Test case 3:** `interview.votesRequired = 2` → `VotingCompleted` after 2 votes
- **T3.26:** Integration test: Full evaluation workflow (create candidate → schedule interview with `votesRequired=2` → submit 2 votes → verify scores + recommendation) (4h)
- **T3.27:** Integration test: STRONG_NO veto scenario (create candidate → schedule interview → submit `STRONG_YES` → submit `STRONG_NO` → verify `NO_HIRE`) (2h)
- **T3.28:** E2E test: Complete workflow from UI (login → create → schedule → submit evaluations → verify aggregate scores shown) (2h)

#### Testing — Config-Driven Validation (Day 9–10, 7h)

- **T3.29:** Integration test: Change config via API, verify Lambda behavior (3h)
  - **Step 1:** Set scoring weights via API: Tech 40%, Comm 20%, Cultural 20%, Problem 20%
  - **Step 2:** Create NEW candidate (gets new configVersion)
  - **Step 3:** Submit vote with scores `[10,5,5,5]`
  - **Step 4:** Verify overall score = `10×0.40 + 5×0.20 + 5×0.20 + 5×0.20 = 7.0` (uses new config)
  - **Step 5:** Verify PREVIOUS candidate (old configVersion) still calculates with old weights
- **T3.30:** Integration test: Versioning protection (2h)
  - **Step 1:** Create candidate A (configVersion=1, weights: 30/25/25/20)
  - **Step 2:** Change config to v2 (weights: 40/20/20/20)
  - **Step 3:** Create candidate B (configVersion=2)
  - **Step 4:** Submit identical scores for both candidates
  - **Step 5:** Verify: Candidate A overall ≠ Candidate B overall (different weights applied)
- **T3.31:** E2E test: Admin config workflow (2h)
  - Login as HR Director → Navigate to Configuration → Change scoring weights → Save → Logout
  - Login as Panel Member → Submit evaluation → Verify scores calculated with new weights (for new candidates only)

#### Configuration UI — Panel Size (Day 11, 8h)

- **T3.32:** Add `votesRequired` field to interview-schedule form (dropdown: 1, 2, 3, 4, 5) (2h)
  - **Default:** Pre-populated from panel rules config based on candidate's position level
- **T3.33:** Display `votesRequired` in candidate-detail interview timeline ("Votes: 2/3 submitted") (2h)
- **T3.34:** Update interview service to pass `votesRequired` to API (1h)
- **T3.35:** Test configurable panel size in UI (create interview with 1 voter, 3 voters, verify logic) (2h)
- **T3.36:** Document configurable panel size in UI tooltips ("Number of panel members required to evaluate") (1h)

#### Deployment & Validation (Day 12–13, 10h)

- **T3.37:** Deploy all M3 changes to AWS dev environment (2h)
- **T3.38:** Run full regression tests (M1 + M2 + M3 flows) (2h)
- **T3.39:** Internal demo: Complete evaluation workflow with STRONG_NO veto + config change demo (2h)
- **T3.40:** Document critical gap fixes and config-driven architecture in `PROJECT_CONTEXT.md` (2h)
- **T3.41:** Fix any bugs discovered (2h buffer)

**Deliverables:** Evaluation submission UI, **config-driven** aggregate scoring, STRONG_NO veto **configurable**, panel size configurable, **admin UI for 3 Variable Six** (Scoring Weights, SLAs, Panel Rules), **config versioning protecting in-flight candidates**, candidate auto-advances to next stage. Audit trail for all config changes.



---

### Milestone 4: Polish, Hardening & SLA Monitoring (Week 7)

**Goal:** Production-ready UI + config-driven operational monitoring.

**Effort:** 5 days (40 hours)

#### SLA Monitoring — Config-Driven (Day 1–2, 16h)

- **T4.1:** Create Lambda: `sla-monitor` (cron: hourly) (6h)
  - Scan workflows with status `IN_PROGRESS`
  - **CONFIG-DRIVEN:** Read SLA thresholds from `talent-flow-config` table (configType: `SLA_THRESHOLDS`)
    - Uses tenant's active config (not candidate's configVersion — SLA monitoring applies current policy)
    - Falls back to hardcoded defaults if config missing (defensive)
  - Check **SLA #1:** First engagement (default 48h from candidate creation, **configurable**)
    - If no interview scheduled within threshold → Publish `SLABreached` event (`type: FIRST_ENGAGEMENT`, `escalationLevel` from config)
  - Check **SLA #2:** Evaluation completion (default 72h from first interview, **configurable**)
    - If evaluation not complete within threshold → Publish `SLABreached` event (`type: EVALUATION_COMPLETION`, `escalationLevel` from config)
  - Log all SLA checks to CloudWatch
  - **Design decision:** SLA monitor reads ACTIVE config (not candidate's configVersion) — this is intentional. If HR changes SLA from 48h to 24h, they want ALL candidates monitored against the new SLA, including in-flight ones. This is different from scoring weights (which lock to candidate version).
- **T4.2:** Deploy `sla-monitor` with EventBridge Scheduler (1h)
- **T4.3:** Create EventBridge rule: `sla-breached-to-notification` (routes to SQS notification queue) (2h)
- **T4.4:** Add email template: `SLA_BREACH_ALERT` — reads template from config table, falls back to default (2h)
  - Template includes: candidate name, SLA type, hours elapsed, escalation level
- **T4.5:** Test SLA monitoring (manually set candidate `createdAt` to 50h ago, verify breach detected using config threshold) (3h)
  - Also test: Change SLA config to 24h, verify breach triggers for candidates > 24h old (not 48h)
- **T4.6:** Add SLA indicator to candidate-list (red badge if SLA breached) (2h)

#### UI Polish (Day 3–4, 16h)

- **T4.7:** Add form validation messages (client-side: red underlines + error text below fields) (3h)
- **T4.8:** Add server-side error handling (API returns 400/409/500 → display specific error messages in toasts) (3h)
- **T4.9:** Add loading spinners (button disabled + spinner during API calls) (2h)
- **T4.10:** Add confirmation dialogs (2h)
  - "Are you sure you want to submit this evaluation? Decision: STRONG_NO will auto-reject."
  - "Are you sure you want to save these scoring weight changes? New weights will apply to all future candidates."
- **T4.11:** Improve responsive design (mobile-friendly tables, forms, config pages) (3h)
- **T4.12:** Add tooltips for complex fields (e.g., "votesRequired: Number of panel members needed", "Config changes affect new candidates only") (1h)
- **T4.13:** Add accessibility features (ARIA labels, keyboard navigation) (2h)

#### Authentication Hardening (Day 4–5, 8h)

- **T4.14:** Add token refresh logic (auto-refresh JWT before expiration) (2h)
- **T4.15:** Add session timeout (redirect to login after 1 hour of inactivity) (2h)
- **T4.16:** Add password reset flow (forgot password → email with reset link → reset password form) (3h)
- **T4.17:** Test authentication edge cases (expired token, invalid credentials, admin vs non-admin access to config pages, network errors) (1h)

#### Documentation & Testing (Day 5, 8h)

- **T4.18:** Write `README.md` (setup instructions, env vars, deployment commands, config seeding instructions) (2h)
- **T4.19:** Create CloudWatch dashboard (Lambda invocations, DynamoDB read/write for BOTH tables, API Gateway requests, error rates) (2h)
- **T4.20:** Add CloudWatch alarms (Lambda errors >5%, DynamoDB throttling, API 5xx >10/min) (2h)
- **T4.21:** Final E2E test (full workflow from login to evaluation complete, including config change mid-test) (1h)
- **T4.22:** Deploy to AWS dev environment (final deployment) (1h)

**Deliverables:** Production-quality UI, **config-driven SLA monitoring** with breach alerts, CloudWatch dashboards + alarms, authentication hardened (admin/user separation tested), comprehensive documentation including config management guide.

---

## Dependency Graph

```
M1: Foundation + Config Layer
├─ T1.1–T1.8: Infrastructure — 2 DynamoDB tables, Cognito with Admin group (no dependencies)
├─ T1.9–T1.13: Backend Candidate Creation (depends on T1.1–T1.8)
│   └─ T1.10: workflow-orchestrator captures configVersion (depends on T1.5 config table)
├─ T1.14–T1.18: Backend Config Management (depends on T1.5 config table)
│   └─ T1.15: Seed default config for all 6 Variable Six
│   └─ T1.16: Cognito admin group + admin test user
├─ T1.19–T1.23: Frontend Auth + Candidate Create (depends on T1.9, T1.14)
│   └─ T1.20: Auth service parses isAdmin claim
├─ T1.24–T1.30: Frontend Candidate List (depends on T1.19–T1.23)
│   └─ T1.26: Nav includes Config link (admin-only)
└─ T1.31–T1.39: Testing (depends on all above)
    └─ T1.34: CRITICAL — Versioning test (configVersion snapshot)

M2: Interview Scheduling
├─ T2.1–T2.5: Backend Interview Scheduling (depends on M1 complete)
│   └─ T2.3: notification-service reads templates from config
├─ T2.6–T2.11: Frontend Interview UI (depends on T2.1–T2.5, M1 frontend)
└─ T2.12–T2.16: Testing (depends on all M2 tasks)

M3: Evaluation + Config UI
├─ T3.1–T3.7: Backend Evaluation Logic (depends on M2 complete)
│   └─ T3.2: CRITICAL — vote-processor reads config using candidate's configVersion
├─ T3.8–T3.14: Admin UI Config Management (depends on T1.14–T1.18 config API, can parallel with T3.1–T3.7)
│   └─ T3.8–T3.11: Scoring, SLA, Panel Rules config components
│   └─ T3.14: Audit trail view
├─ T3.15–T3.22: Frontend Evaluation UI (depends on T3.1–T3.7, M2 frontend)
├─ T3.23–T3.28: Critical Gap Testing (depends on T3.2)
├─ T3.29–T3.31: Config-Driven Testing (depends on T3.2, T3.8–T3.14)
│   └─ T3.30: CRITICAL — Versioning protection test
├─ T3.32–T3.36: Panel Size Configuration (depends on T3.1–T3.7, T3.15–T3.22)
└─ T3.37–T3.41: Deployment (depends on all M3 tasks)

M4: Polish + Config-Driven SLA
├─ T4.1–T4.6: SLA Monitoring (depends on M3 complete — reads SLA config)
│   └─ T4.1: CRITICAL — sla-monitor reads thresholds from config (active config, not versioned)
├─ T4.7–T4.13: UI Polish (depends on M1–M3 UI, can start early)
├─ T4.14–T4.17: Auth Hardening + Admin Access Testing (depends on M1 auth)
└─ T4.18–T4.22: Documentation + Monitoring (depends on all above)
```

**CRITICAL PATH:** `T1.1–T1.8 → T1.9–T1.13 → T1.14–T1.18 → T2.1–T2.5 → T3.1–T3.7 (esp. T3.2) → T4.1–T4.6`

**PARALLEL OPPORTUNITIES:**
- Frontend tasks (T1.19+, T2.6+, T3.15+, T4.7+) can overlap with backend testing
- Admin UI (T3.8–T3.14) can be built in parallel with backend evaluation logic (T3.1–T3.7)
- Auth hardening (T4.14–T4.17) can start before SLA monitoring is complete



---

## Demo Script

> **Demo Audience:** Business Analyst (BA) and Product Owner (PO)
> **Duration:** 24 minutes
> **Environment:** AWS dev environment, BA logged in as test user

---

### Scene 1: Login & Authentication (2 min)

**Narrative:** *"The platform is secured. Only authorized users can access candidate data. Each user belongs to a tenant (department). Admin users have additional access to platform configuration."*

**Actions:**
1. Navigate to Angular app URL
2. See login screen (email/password form)
3. Enter test user credentials (BA role, tenant: Engineering)
4. Click "Sign In"
5. Successfully authenticated → redirected to candidate list
6. Point out: "Configuration" link is **not visible** (BA is not admin)

**What This Proves:** Cognito authentication working, tenant-aware access, role-based UI visibility.

---

### Scene 2: Create Candidate (3 min)

**Narrative:** *"HR receives a resume. They create a candidate record. The platform automatically initiates the evaluation workflow — no manual handoffs. Behind the scenes, the system locks the current business rules to this candidate."*

**Actions:**
1. Click "Create Candidate" button
2. Fill form:
   - First Name: Sarah
   - Last Name: Chen
   - Email: sarah.chen@example.com
   - Phone: +1-555-0123
   - Position: Senior Software Engineer
   - Department: Engineering (tenant auto-injected)
   - Source: LinkedIn
3. Click "Submit"
4. See success toast: "Candidate created successfully"
5. Redirected to candidate list
6. Sarah Chen appears in list with:
   - Status: `CREATED`
   - Stage: `Evaluation Intelligence`
   - Created: (current timestamp)

**What This Proves:**
- Candidate creation UI works
- DynamoDB write successful (candidate record)
- EventBridge event published (`CandidateCreated`)
- Workflow Orchestrator triggered (workflow record created **with configVersion snapshot**)
- UI polling shows real-time updates

**Behind the Scenes** (explain during demo):
- API Handler Lambda validated input, wrote to DynamoDB, published event to EventBridge
- Workflow Orchestrator Lambda subscribed to event, **read current active config version (v1)**, stored `configVersion: 1` in workflow state
- Stage 1–3 set to `IN_PROGRESS`, remaining stages `PENDING`
- All records include tenantId for multi-tenant isolation
- **Key point:** Sarah is now locked to config v1's scoring weights (30/25/25/20) — even if weights change later

---

### Scene 3: Schedule Interview (3 min)

**Narrative:** *"Hiring Manager reviews candidate and schedules technical interview. Panel members receive automated calendar invites."*

**Actions:**
1. Click on Sarah Chen in candidate list
2. See candidate detail page (metadata + empty timeline)
3. Click "Schedule Interview" button
4. Fill interview form:
   - Type: Technical Screen
   - Date/Time: Tomorrow 2:00 PM
   - Duration: 60 minutes
   - Meeting Link: `https://zoom.us/j/123456789`
   - Interviewers: `interviewer1@company.com`, `interviewer2@company.com`
   - Votes Required: 2 (pre-populated from panel rules config for "Senior" position level)
5. Click "Schedule"
6. See success toast: "Interview scheduled successfully"
7. Interview appears in candidate timeline with:
   - Type: Technical Screen
   - Scheduled: Tomorrow 2:00 PM
   - Status: `SCHEDULED`
   - Votes: 0/2 submitted

**What This Proves:**
- Interview scheduling UI works
- Configurable panel size (Votes Required: 2, read from config)
- Email notifications triggered (interviewers receive calendar invites via SQS → Notification Service → AWS SES)

**Behind the Scenes:**
- API Handler published `InterviewScheduled` event
- Interview Scheduler Lambda wrote interview record (with `votesRequired=2` from panel config)
- Notification Service read email template from config table, sent emails to both interviewers

---

### Scene 4: Submit Evaluation — First Vote (3 min)

**Narrative:** *"After interview, first panel member submits evaluation with scores and recommendation."*

**Actions:**
1. Click "Submit Evaluation" button (from candidate detail page)
2. Fill evaluation form:
   - Technical Skills: 8/10
   - Communication: 9/10
   - Cultural Fit: 8/10
   - Problem Solving: 8/10
   - Decision: `STRONG_YES` (green highlight)
   - Feedback: "Excellent system design skills. Strong communicator. Would be great addition to team."
3. Click "Submit"
4. See success toast: "Evaluation submitted successfully"
5. Candidate timeline updates:
   - Votes: 1/2 submitted (checkmark for interviewer1)

**What This Proves:**
- Evaluation form validation works
- Vote submission successful
- Progress tracking (1/2 votes in)

---

### Scene 5: Submit Evaluation — Second Vote with STRONG_NO (4 min)

**Narrative:** *"Second panel member has concerns. Submits STRONG_NO. Per configurable business rules (BR-006), any STRONG_NO auto-rejects candidate — no debate, no override. This rule is a configuration toggle, not hardcoded logic."*

**Actions:**
1. (Simulate second interviewer login or use same session)
2. Click "Submit Evaluation" button again
3. Fill evaluation form:
   - Technical Skills: 6/10
   - Communication: 7/10
   - Cultural Fit: 5/10
   - Problem Solving: 6/10
   - Decision: `STRONG_NO` (red highlight with warning icon)
4. See warning dialog: *"⚠️ STRONG_NO will auto-reject the candidate regardless of other votes. This cannot be overridden. Are you sure?"*
5. Confirm "Yes, Submit"
6. See success toast: "Evaluation submitted successfully"
7. Candidate timeline updates:
   - Votes: 2/2 submitted (checkmark for both interviewers)
8. Wait 2 seconds (for async event processing)
9. Aggregate scores appear on candidate detail:
   - Technical: Avg 7.0, Min 6, Max 8
   - Communication: Avg 8.0, Min 7, Max 9
   - Cultural Fit: Avg 6.5, Min 5, Max 8
   - Problem Solving: Avg 7.0, Min 6, Max 8
   - **Overall: `NO_HIRE` (STRONG_NO VETO)** (red badge)
   - Veto Reason: `"STRONG_NO from interviewer2@company.com"`
   - **Config applied:** v1 weights (Tech 30%, Comm 25%, Cultural 25%, Problem 20%)
10. Candidate status updates to next stage:
    - Stage: `Selection Orchestration` (workflow continues for analytics/audit trail)

**What This Proves:**
- **CRITICAL:** STRONG_NO veto logic works — **and is a config toggle** (`panelConfig.rules.strongNoVeto: true`)
- Aggregate score calculation uses **config-driven weights** (Tech 30%, Comm 25%, Cultural 25%, Problem 20%)
- Even with first vote `STRONG_YES`, the `STRONG_NO` overrides → `NO_HIRE`
- Workflow auto-advances to next stage (no manual intervention)
- **Config v1 applied** — locked at candidate creation time

**Behind the Scenes:**
- Vote Processor Lambda received 2nd vote
- **Read scoring config using Sarah's configVersion (v1)** — not latest active
- Checked `votesRequired = 2`, `votesSubmitted = 2` → all votes in
- **Read panel rules config:** `strongNoVeto: true` → scanned votes for any `STRONG_NO` → found one → immediately set recommendation = `NO_HIRE`
- Published `VotingCompleted` event with `NO_HIRE` recommendation
- Evaluation Completer Lambda updated candidate status and advanced stage

---

### Scene 5b: Live Configuration Change (4 min)

**Narrative:** *"The platform is configurable. Business rules aren't hardcoded. Let's change scoring weights and see the difference immediately — no code deployment, no developer needed."*

**Actions:**
1. Logout → Login as HR Director (admin account: `hr-director@testcompany.com`)
2. "Configuration" link now **visible** in nav (admin-only)
3. Click "Configuration" → "Scoring Weights"
4. Show current weights:
   - Technical: 30%
   - Communication: 25%
   - Cultural Fit: 25%
   - Problem Solving: 20%
   - Version: v1 (created during initial setup)
5. Explain: *"Our hiring manager wants to prioritize cultural fit over technical for this department. Let's adjust."*
6. Drag sliders:
   - Technical: 25% (down from 30%)
   - Communication: 25% (unchanged)
   - Cultural Fit: 30% (up from 25%)
   - Problem Solving: 20% (unchanged)
7. Total shows: 100% ✓ (green checkmark)
8. Click "Save Changes"
9. See success toast: "Scoring weights updated successfully (v2)"
10. Navigate to "Audit Trail"
11. See entry: *"2026-05-20 10:30 — hr-director@testcompany.com changed Scoring Weights: Tech 30%→25%, Cultural 25%→30% (v1→v2)"*
12. Navigate back to "Candidates" → Create new candidate: "John Smith, Senior Developer"
13. Schedule interview → Submit 2 evaluations with same scores as Sarah's interviewers: `[8,9,8,8]` and `[6,7,5,6]`
14. Wait 2 seconds (async processing)
15. Show aggregate scores for John:
    - **Overall: 7.05** (with new weights: Tech 25%, Cultural 30%)
    - Point out: *"Sarah's overall was 7.375 with old weights. John's is 7.05 — same scores, different result."*
16. Navigate to Sarah Chen's detail:
    - **Overall: still shows 7.375** — unchanged, locked to config v1
17. Point out: *"Sarah was evaluated under the original rules. John under the new rules. Both are correct for their context. This is config versioning — no data corruption, full audit trail."*

**What This Proves:**
- **CRITICAL:** Business rules are configurable, not hardcoded
- HR users have autonomy (don't need dev team for policy changes)
- Changes take effect immediately for NEW candidates
- **In-flight candidates are protected** (Sarah's scores unchanged)
- Audit trail maintained (who changed what when)
- Config versioning prevents compliance violations
- Foundation for vertical differentiation (agriculture vertical would have different default weights)

**Behind the Scenes:**
- Config UI called PUT /config/scoring-weights
- Config Manager Lambda created v2 record in `talent-flow-config` table, set v1 `isActive: false`
- John's workflow-orchestrator captured `configVersion: 2` at creation
- John's vote-processor read config v2 (25/25/30/20)
- Sarah's vote-processor still reads config v1 (30/25/25/20) — locked at her workflow creation
- No Lambda code changed, no deployment occurred

---

### Scene 6: SLA Monitoring (3 min)

**Narrative:** *"Platform monitors SLAs. Thresholds are configurable — the HR Director just set first engagement to 48 hours, but can change it anytime."*

**Actions:**
1. Navigate back to candidate list
2. Point out SLA indicator column (green checkmarks for recent candidates)
3. (For demo, manually create old candidate with `createdAt` = 50 hours ago via backend)
4. Refresh candidate list
5. See red badge next to old candidate: "SLA BREACH: First Engagement"
6. Click on candidate detail
7. See SLA alert banner: *"⚠️ SLA Breach: First engagement exceeded 48 hours. Escalated to Hiring Manager."*

**What This Proves:**
- SLA Monitor Lambda runs hourly (cron)
- **Reads SLA thresholds from config** (not hardcoded)
- Detects breaches (`FIRST_ENGAGEMENT`, `EVALUATION_COMPLETION`)
- Publishes breach events → triggers email alerts to managers
- UI shows real-time SLA status
- HR Director can change 48h to 24h via admin UI → SLA monitor immediately uses new threshold

---

### Scene 7: Recap & Architecture Explanation (2 min)

**Narrative:** *"Let's review what we demonstrated and the architecture powering it."*

**Architecture Diagram** (shown on screen):

```
User (Angular) ─── AdminGuard ───→ Config UI (Variable Six)
  ↓ (HTTPS)                              ↓
API Gateway (Cognito Authorizer)    Config Manager Lambda
  ↓ (invokes)                            ↓ (reads/writes)
Lambda: API Handler                 DynamoDB: talent-flow-config
  ↓ (writes)                        (versioned tenant configs)
DynamoDB: talent-flow-state              ↑
  ↓ (publishes)                    All Lambdas read config ──┘
EventBridge (custom bus: talent-flow-bus)
  ↓ (routes events)
Lambda: Workflow Orchestrator (captures configVersion)
        Interview Scheduler (reads panel config)
        Vote Processor (reads scoring + veto config)
        Evaluation Completer
        Notification Service (reads templates from config)
        SLA Monitor (reads SLA thresholds from config)
  ↓ (sends)
AWS SES (email notifications)
```

**Key Points:**
- ✅ **Metadata-Lite:** Business rules in config, platform invariants in code
- ✅ **Config-Driven:** Scoring weights, SLAs, panel rules, veto logic — all read from DynamoDB config table
- ✅ **Versioned:** In-flight candidates locked to config version at creation. Config changes only affect new candidates.
- ✅ **Event-driven:** No tight coupling. Lambdas communicate via EventBridge events.
- ✅ **Tenant-aware:** Every record, every API call includes tenantId.
- ✅ **Secured:** Cognito authentication with admin/user roles.
- ✅ **Audited:** Every config change logged with who, what, when, previous values.
- ✅ **Cost:** $0/month (100% AWS Free Tier).
- ✅ **Extensible:** Same codebase serves multiple verticals via different config. Agriculture, banking = different config metadata, not different code.



---

## Risk Mitigation Strategy

### Risk 1: Critical Gap Fixes Break Existing Logic

**Severity:** 🔴 HIGH

**Mitigation:**
- Comprehensive unit tests BEFORE deployment (T3.23–T3.25 validate all 3 gaps — now config-driven)
- **Config-driven tests:** T3.29–T3.31 verify Lambda reads from config, not hardcoded values
- **Versioning tests:** T3.30 verifies in-flight candidates unaffected by config changes
- Integration tests with realistic data (T3.26–T3.27)
- Regression tests after deployment (T3.38)
- Rollback plan: Keep previous Lambda version, can revert via Terraform if production issues detected

---

### Risk 2: Cognito Setup Delays M1

**Severity:** 🟡 MEDIUM

**Mitigation:**
- Allocate 3 hours for Cognito setup (T1.3) — now includes Admin group creation
- Use email/password (simplest flow, no OAuth complexity)
- Disable MFA for POC (can enable in M4 or post-MVP1)
- Test authentication early, including admin vs user role separation (T1.36)
- If Cognito blocks progress, defer admin UI to M4 and use "as if logged in" for M1–M3 demo (not ideal but viable)

---

### Risk 3: EventBridge Event Ordering/Delivery

**Severity:** 🟡 MEDIUM

**Mitigation:**
- Implement idempotency in all Lambdas (check if event already processed before executing)
- Use DynamoDB TTL for event deduplication records (7-day TTL)
- Add retry logic (2 attempts, 6h max event age, DLQ for failures)
- Monitor CloudWatch Logs for DLQ messages (T4.20 sets up alarm)

---

### Risk 4: DynamoDB Schema Changes During Development

**Severity:** 🟢 LOW

**Mitigation:**
- Single-table design is flexible (can add attributes without schema migration)
- GSI1 and GSI2 are generic (`GSI1PK`, `GSI1SK`) so can reuse for new access patterns
- Config table (`talent-flow-config`) uses generic PK/SK pattern that supports new config types without schema change
- If schema change needed: create migration script, test on copy of data, apply to dev environment

---

### Risk 5: SES Sandbox Restrictions (Email Sending)

**Severity:** 🟡 MEDIUM

**Mitigation:**
- For POC, use SES sandbox (free, but requires verifying recipient emails)
- Verify test user emails during T1.7 (BA, PO, interviewers, HR Director)
- If demo requires sending to unverified emails, request SES production access (requires AWS support ticket, 1–2 day approval)
- Backup: Use local email service (e.g., Nodemailer with Gmail SMTP) if SES blocked

---

### Risk 6: AWS Free Tier Exhaustion

**Severity:** 🟢 LOW

**Mitigation:**
- Cost breakdown validated: POC uses <1% of free tier (970 Lambda invocations vs 1M free)
- Second DynamoDB table (`talent-flow-config`) adds minimal read capacity (config reads are infrequent, cached in Lambda for 5 min)
- Set up AWS Budget alert at $10 threshold (T4.18)
- Monitor daily costs via Cost Explorer (T4.19)
- If costs spike, identify culprit service and optimize (e.g., reduce CloudWatch log retention)

---

### Risk 7: Solo Developer Bandwidth

**Severity:** 🔴 HIGH

**Mitigation:**
- Use Claude AI for code generation (leverage `AI_DEVELOPMENT_GUIDE.md` prompt templates)
- Prioritize tasks: Focus on M1–M3 (core workflow + config), defer polish to M4
- Build incrementally: Deploy + test after each milestone (catch issues early)
- Buffer time in each milestone (T1.39: 3h buffer, T3.41: 2h buffer)
- If falling behind: Cut M4 scope (defer SLA monitoring or UI polish to post-MVP1)
- **Admin UI (T3.8–T3.14) can be parallelized** with backend evaluation work — use this to optimize schedule

---

### Risk 8: Config Versioning Complexity

**Severity:** 🟡 MEDIUM

**Mitigation:**
- Keep versioning simple: every PUT creates v(n+1), old version stays in table with `isActive: false`
- In-flight protection is read-only: candidate's `configVersion` is set once at creation, never updated
- Lambda config reads include version parameter: `getConfig(tenantId, configType, version)` — no ambiguity
- **SLA monitor intentionally reads ACTIVE config** (not versioned per-candidate) — documented as design decision in T4.1
- Auto-cleanup: Old config versions have 365-day TTL — kept for audit, auto-deleted after 1 year
- If versioning logic causes bugs: fall back to "always read active" (lose in-flight protection but unblock demo)

---

## File Modification Plan

### New Files (Created During MVP1)

#### Infrastructure (Terraform)

| File | Purpose |
|---|---|
| `terraform/environments/dev/main.tf` | Cognito (with Admin group), EventBridge, API Gateway, SQS, Lambdas |
| `terraform/environments/dev/state-table.tf` | DynamoDB table: `talent-flow-state` (operational state) |
| `terraform/environments/dev/config-table.tf` | DynamoDB table: `talent-flow-config` (tenant configuration metadata) |
| `terraform/environments/dev/variables.tf` | Environment-specific variables |
| `terraform/environments/dev/outputs.tf` | API Gateway URL, Cognito user pool ID, table names |
| `terraform/modules/lambda-function/` | Reusable Lambda module (from `TERRAFORM_MODULE_STRUCTURE.md`) |
| `terraform/modules/eventbridge-bus/` | Reusable EventBridge module |
| `terraform/modules/dynamodb-table/` | Reusable DynamoDB module |

#### Backend (Lambda Functions)

| File | Purpose |
|---|---|
| `lambda/api-handler/index.js` | POST /candidates, POST /interviews, POST /votes |
| `lambda/workflow-orchestrator/index.js` | `CandidateCreated` → create workflow **with configVersion snapshot** |
| `lambda/config-manager/index.js` | GET/PUT /config/{configType} — CRUD for tenant configs, **versioned writes**, audit trail |
| `lambda/interview-scheduler/index.js` | `InterviewScheduled` → write interview + notify, **reads panel config for votesRequired default** |
| `lambda/vote-processor/index.js` | `VoteSubmitted` → **read scoring config (versioned)** → aggregate scores → **read veto rules config** → publish `VotingCompleted` |
| `lambda/evaluation-completer/index.js` | `VotingCompleted` → update candidate + advance stage |
| `lambda/notification-service/index.js` | Consume SQS → **read notification templates from config** → send emails via SES |
| `lambda/sla-monitor/index.js` | Cron hourly → **read SLA thresholds from active config** → check breaches |
| `lambda/shared/config-reader.js` | Shared utility: `getConfig(tenantId, configType, version?)` with 5-min cache |

#### Backend (Tests)

| File | Purpose |
|---|---|
| `lambda/api-handler/index.test.js` | Unit tests |
| `lambda/vote-processor/index.test.js` | Unit tests — config-driven scoring, veto, panel size validation |
| `lambda/config-manager/index.test.js` | Unit tests — versioning, validation (weights sum to 100%), audit trail |
| `tests/integration/stage1-3-evaluation-workflow.test.js` | E2E integration test |
| `tests/integration/config-versioning.test.js` | Config versioning protection tests |

#### Frontend (Angular)

| File | Purpose |
|---|---|
| `src/app/auth/` | `login.component.ts`, `auth.service.ts` (includes `isAdmin()` method), `auth.guard.ts` |
| `src/app/guards/admin.guard.ts` | Route guard for admin-only config pages |
| `src/app/candidates/` | `candidate-list.component.ts`, `candidate-detail.component.ts`, `candidate-create.component.ts` |
| `src/app/interviews/` | `interview-schedule.component.ts`, `interview.service.ts` |
| `src/app/evaluations/` | `evaluation-submit.component.ts`, `aggregate-scores.component.ts`, `evaluation.service.ts` |
| `src/app/config/` | `scoring-weights-config.component.ts`, `sla-config.component.ts`, `panel-rules-config.component.ts`, `audit-trail.component.ts`, `config.service.ts` |
| `src/app/services/` | `candidate.service.ts`, `api.service.ts` |
| `src/app/app.routes.ts` | Route definitions (includes `/config/*` routes with `AdminGuard`) |
| `src/environments/environment.ts` | API Gateway URL, Cognito config |

#### Documentation

| File | Purpose |
|---|---|
| `README.md` | Setup instructions, config seeding guide |
| `docs/API.md` | API endpoint documentation (includes /config/* endpoints) |
| `docs/ARCHITECTURE.md` | High-level architecture diagram (metadata-lite) |
| `docs/CONFIG-GUIDE.md` | Guide for HR Directors: how to use config UI, what each setting does |

---

### Modified Files

**Existing Files to Update:**

| File | When | What Changes |
|---|---|---|
| `Event Driven Architecture Docs/PROJECT_CONTEXT.md` | After each milestone | Update checkpoints, add metadata-lite architecture note |
| `Event Driven Architecture Docs/LAMBDA_CATALOG.md` | After M3 | Mark critical gaps as `FIXED (config-driven)`, add config-manager Lambda |
| `Event Driven Architecture Docs/COST_BREAKDOWN.md` | After deployment | Update with actual POC costs (2 DynamoDB tables) |

**NO modifications to these 12 MD files during MVP1** (reference only):

- `DYNAMODB_SCHEMA_DESIGN.md`
- `EVENTBRIDGE_PATTERNS.md`
- `STEP_FUNCTIONS_ORCHESTRATION.md`
- `TERRAFORM_MODULE_STRUCTURE.md`
- `MIGRATION_PATHS.md`
- `AI_DEVELOPMENT_GUIDE.md`
- All other MD files

---

### File Modification Sequence

**Week 1–2 (M1):**
1. Create Terraform files (infrastructure — 2 DynamoDB tables)
2. Deploy infrastructure (AWS resources created, Cognito with Admin group)
3. Create Lambda: `api-handler`, `workflow-orchestrator` (with configVersion capture)
4. Create Lambda: `config-manager` (CRUD for tenant configs)
5. Create shared utility: `config-reader.js`
6. Seed default configs for all 6 Variable Six
7. Create Angular app structure + auth service (with `isAdmin()`)
8. Create `candidate-create` component + `candidate-list` component (with admin nav)
9. Write unit tests + integration tests + config versioning tests

**Week 3 (M2):**
1. Create Lambda: `interview-scheduler` (reads panel config), `notification-service` (reads templates from config)
2. Create SQS queue (Terraform)
3. Create `interview-schedule` component
4. Update `candidate-detail` component (add timeline)

**Week 4–6 (M3):**
1. **CRITICAL:** Create `vote-processor` Lambda (config-driven scoring, veto, panel size)
2. Create Lambda: `evaluation-completer`
3. **Create admin UI:** `scoring-weights-config`, `sla-config`, `panel-rules-config`, `audit-trail` components
4. Create `evaluation-submit` component + `aggregate-scores` component
5. Write config-driven tests (T3.29–T3.31) + critical gap validation tests (T3.23–T3.28)

**Week 7 (M4):**
1. Create Lambda: `sla-monitor` (**reads SLA thresholds from config**)
2. Polish frontend components (error handling, loading states)
3. Harden authentication (token refresh, password reset, admin access testing)
4. Create CloudWatch dashboards + alarms
5. Write `README.md` + `CONFIG-GUIDE.md`


---

## MVP2–MVP5 Expanded Skeleton

### MVP2: Selection & Offer Intelligence + Vertical Packs (Week 8–15, 8 weeks)

**Theme:** Extend workflow to selection phase and offer generation with approval gates. Complete admin UI for all 6 Variable Six. Launch first vertical expansion.

**Stages Covered:** 4–8
- Stage 4–5: Selection Orchestration (shortlisting, second interviews, reference checks)
- Stage 6–8: Offer Orchestration (offer generation, approval, negotiation, acceptance)

**Key Capabilities:**
- **Shortlisting Logic:** Auto-generate shortlist based on aggregate scores (threshold configurable per tenant, default: overall >= 7.0)
- **Second Interview Scheduling:** Support multiple interview rounds (`PANEL_INTERVIEW`, `CULTURAL_FIT`, `EXECUTIVE_INTERVIEW`)
- **Offer Generation:** Create offer letter (PDF) with salary, benefits, start date
- **Approval Workflow:** Step Functions state machine for manager/C-level approval (wait state with email callback) — **approval thresholds read from config**
- **Offer Negotiation:** Candidate can counter-offer, HR can revise, multiple rounds supported
- **Offer Acceptance:** Candidate accepts offer → auto-trigger onboarding workflow
- **Real-time Notifications:** Candidate receives offer via email + can view/accept in UI
- **Admin UI for Remaining Variable Six:**
  - Approval Rules UI (position/salary thresholds for manager/exec approval)
  - Notification Templates UI (edit email/SMS templates with live preview)
  - Stage Enablement UI (toggle stages on/off per tenant)

**What It Unlocks:**
- Complete candidate lifecycle from sourcing to offer acceptance
- Human-in-the-loop approval gates (manager/C-level sign-off before offer sent)
- Step Functions long-running workflows (wait days/weeks for approval)
- Candidate portal (view offer, accept/decline, negotiate)
- **Full config UI for all 6 Variable Six** — platform is fully self-service

**Vertical Expansion Enabled by Metadata-Lite:**

- **Agriculture Vertical:** Launch by creating new tenant with config:
  - Scoring weights: Physical Ability 50%, Communication 25%, Reliability 25%
  - SLA thresholds: First engagement 24h (fast hiring), Evaluation 48h (not 72h)
  - Stage enablement: Disable police clearance, disable second interview
  - Panel rules: 1 vote required (not 2), single supervisor approval
  - **Time to launch: 1–2 days** | **Code changes: Zero**

- **Banking Vertical:** Launch by creating new tenant with config:
  - Scoring weights: Technical 35%, Compliance Knowledge 25%, Communication 20%, Problem Solving 20%
  - SLA thresholds: Background check 14 days (longer for financial vetting)
  - Stage enablement: Enable police clearance, financial background check, regulatory approval
  - Panel rules: 3 votes required for all levels, CFO approval for senior roles
  - **Time to launch: 2–3 days** | **Code changes: Zero** (unless new stage type needs new Lambda)

**Dependencies on Previous MVPs:**
- MVP1: Tenant-aware architecture, EventBridge orchestration patterns, Cognito authentication
- **MVP1 Metadata-Lite Foundation:** Config table pattern, Lambdas read business rules from metadata, versioning strategy
- MVP1 DynamoDB schema extends cleanly (add `SK: OFFER#{offerId}`, `SK: APPROVAL#{approvalId}`)

**New User Roles Introduced:**
- **C-level Executive** (approves offers above threshold from config, e.g., salary > R150K)
- **Candidate** (views offer, accepts/declines, negotiates)

**New AWS Services:**
- **Step Functions:** Offer approval state machine, background check state machine
- **S3:** Store offer letters (PDFs), resume documents
- **Lambda (new functions):** `offer-generator`, `approval-handler`, `offer-sender`, `acceptance-processor`

**MVP2 Demo:** BA creates candidate → completes evaluation (`STRONG_HIRE`) → candidate auto-shortlisted → second interview scheduled → offer generated → manager approves via email link → offer sent to candidate → candidate accepts in UI → workflow advances to onboarding stage. **Bonus:** Switch to agriculture tenant, show different scoring weights and stage enablement — same platform, different config.

---

### MVP3: Onboarding Orchestration (Week 16–25, 10 weeks)

**Theme:** Prevent Day-1 failures through multi-domain provisioning and compliance automation.

**Stages Covered:** 9–12
- Stage 9: Background Checks & Compliance (criminal record, employment verification, drug screening)
- Stage 10: Pre-Onboarding Provisioning (IT setup, finance setup, office access)
- Stage 11: Day-1 Engagement (welcome email, buddy assignment, orientation scheduling)
- Stage 12: First Week Milestone (manager check-in, HR check-in, equipment verification)

**Key Capabilities:**
- **Background Check Integration:** API integration with 3rd party vendor (Checkr, Sterling)
- **Multi-Domain Orchestration:** Parallel workflows for IT (laptop, email, VPN), Finance (payroll setup), Facilities (badge, parking)
- **Compliance Checklist:** I-9 verification, tax forms (W-4), benefits enrollment
- **Config-Driven Stage Enablement:** Tenants toggle which onboarding stages apply (banking needs police clearance, agriculture doesn't)
- **Provisioning Tracker:** Real-time dashboard showing IT/Finance/Facilities completion status
- **Day-1 Readiness Gate:** Block Day-1 if any critical item incomplete (laptop not shipped, email not created)
- **Engagement Automation:** Auto-send welcome email, assign buddy, schedule orientation
- **Real-time Analytics Dashboard:** Live view of onboarding pipeline

**What It Unlocks:**
- Complete 12-stage workflow (sourcing → offer → onboarding → Day-1)
- Multi-domain coordination (IT, Finance, HR, Facilities all on same platform)
- Compliance automation (no manual tracking of I-9, tax forms)
- Operational visibility (HR can see bottlenecks: "IT is slow, 8 laptops not shipped")
- Proof of BRD vision: "100% Day-1 readiness on equipment, access, and engagement dimensions"

**Dependencies on Previous MVPs:**
- MVP1: EventBridge orchestration, DynamoDB schema, Lambda patterns, config-driven architecture
- MVP2: Step Functions long-running workflows (background check can take weeks)
- MVP1–2: Notification system (extend to support SMS, Slack, not just email — templates from config)

**New User Roles Introduced:**
- **IT Admin** (provisions laptop, email, VPN)
- **Finance Admin** (sets up payroll, benefits)
- **Facilities Admin** (creates badge, assigns desk)
- **Compliance Officer** (verifies I-9, reviews background check results)
- **Buddy** (assigned to new hire for first week support)

**New AWS Services:**
- **API Gateway (external):** Webhooks for 3rd party integrations (Checkr, ADP, Office 365)
- **Lambda (new functions):** `background-check-initiator`, `provisioning-orchestrator`, `compliance-tracker`, `day1-readiness-checker`
- **DynamoDB (new access patterns):** Query by provisioning status, query by Day-1 readiness

**MVP3 Demo:** Candidate accepts offer → background check initiated → wait 5 days (Step Functions) → clears → provisioning triggered in parallel → all domains complete → Day-1 ready → welcome email sent → buddy assigned → manager notified → Day-1 arrives, all equipment ready.

---

### MVP4: Intelligence Layer + AI Config Assistant (Week 26–34, 8 weeks)

**Theme:** Augment human judgment with AI-powered insights AND introduce conversational configuration — "Change SLA to 24 hours" via natural language.

**Stages Covered:** All stages (1–12) enhanced with AI

**Key Capabilities:**
- **Sentiment Analysis:** Analyze interview feedback text (Amazon Comprehend) → detect `HESITANT` sentiment → trigger HR intervention task
- **Resume Parsing:** Extract skills, experience, education from resume PDF (Amazon Textract + Comprehend) → auto-populate candidate fields
- **Predictive Scoring:** Train ML model (SageMaker) to predict candidate success likelihood → "78% likely to succeed"
- **Engagement Recommendations:** AI-generated follow-up suggestions (Bedrock Claude API)
- **Interview Question Generation:** Auto-generate role-specific questions (Bedrock Claude API)
- **Bias Detection:** Analyze evaluation feedback for biased language → flag for review
- **AI Configuration Assistant (Phase 3 of Metadata-Lite evolution):**
  - Natural language → config changes: "Change first engagement SLA to 24 hours" → generates JSON config update
  - AI generates structured JSON → Schema Validation → Simulation → Approval → Deploy
  - **Constrained vocabulary:** AI can only modify the Variable Six — cannot create new stages or arbitrary workflows
  - Pattern: AI proposes → Human approves → System validates → Deploy to staging → Test → Deploy to prod
  - Proves: Conversational configuration reduces consulting dependency
  - **Success metric:** HR Director says "Require 3 interviewers for executive roles" → AI updates panel config → HR approves → deployed in 30 seconds
- **Real-time Dashboards with AI Insights:** Live KPIs + AI predictions

**What It Unlocks:**
- Data-driven hiring decisions (not just gut feel)
- Proactive engagement (AI detects disengagement, suggests actions)
- Reduced bias (AI flags problematic feedback)
- **Conversational configuration** — eliminates remaining consulting fees
- Competitive advantage (AI insights + natural language config = unique value prop)

**Dependencies on Previous MVPs:**
- MVP1–3: Historical data needed to train ML models
- MVP1: EventBridge patterns, **config table pattern** (AI assistant writes to same config table)
- MVP1: Config versioning (AI-generated configs go through same versioning pipeline)

**New User Roles Introduced:**
- No new roles (AI augments existing users: HR, managers, panel members)

**New AWS Services:**
- **Amazon Comprehend:** Sentiment analysis, entity recognition
- **Amazon Textract:** Resume parsing
- **SageMaker:** Custom ML models
- **Bedrock (Claude API):** AI recommendations, question generation, **config assistant**
- **Lambda (new functions):** `sentiment-analyzer`, `resume-parser`, `predictive-scorer`, `engagement-recommender`, `ai-config-assistant`
- **S3 Data Lake**, **AWS Glue**, **Athena** for analytics

**MVP4 Demo:** HR Director says "Change scoring to prioritize communication for client-facing roles" → AI generates config: `{ technical: 0.20, communication: 0.35, culturalFit: 0.25, problemSolving: 0.20 }` → HR reviews and approves → config deployed as v4 → next candidate uses new weights.

---

### MVP5: Agentic Automation (Week 35–50, 16 weeks)

**Theme:** Autonomous AI agents reduce human effort by 70% while maintaining quality.

**Stages Covered:** All stages (1–12) with autonomous agents

**Key Capabilities:**
- **Recruiter Agent:** Autonomously sources candidates, screens resumes, schedules interviews, sends personalized outreach
- **Interview Agent:** Conducts preliminary phone screens (AI voice), scores responses, escalates to human if uncertainty >20%
- **Offer Negotiation Agent:** Negotiates salary within configurable bounds, handles candidate questions, escalates if outside bounds
- **Onboarding Agent:** Monitors provisioning, sends reminders, auto-resolves common issues
- **Human-in-the-Loop Gates:** AI agents have confidence thresholds (configurable via the Variable Six pattern)
- **Audit Trail:** All AI decisions logged for transparency and compliance

**What It Unlocks:**
- 70% reduction in human effort
- 10x scale (2000+ candidates/month with same team)
- 24/7 operation
- Consistency (AI applies same criteria, configurable per tenant)
- Future-proof architecture

**Dependencies on Previous MVPs:**
- MVP1–3: Complete workflow foundation (agents orchestrate existing Lambdas)
- MVP4: AI intelligence layer + config assistant
- MVP1: EventBridge patterns (agents publish events like human users), **config patterns (agent thresholds are config)**

**New User Roles Introduced:**
- **AI Agent** (autonomous, not human)
- **Agent Monitor** (human: oversees AI agents, adjusts confidence thresholds via config)

**New AWS Services:**
- **Amazon Bedrock Agents**, **Claude 3.5 Sonnet**, **Amazon Polly**, **Amazon Transcribe**
- **Lambda (new functions):** `recruiter-agent`, `interview-agent`, `offer-negotiation-agent`, `onboarding-agent`, `agent-monitor`

**MVP5 Demo:** Job posted → Recruiter Agent sources 50 candidates overnight → screens → identifies 10 matches → Interview Agent conducts phone screens → 2 strong → human confirms → Offer Agent negotiates → candidate accepts → Onboarding Agent monitors → Day-1 ready.

---

## Execution Readiness

### What is the very first task in M1?

**Task T1.1:** Create AWS dev account, configure IAM user with programmatic access (2 hours)

**Why First:** All subsequent tasks depend on AWS infrastructure. Cannot deploy Cognito, DynamoDB, or Lambdas without AWS account + IAM credentials.

**Prerequisites:**
- AWS account (free tier eligible)
- Credit card (for AWS billing, but won't be charged if staying in free tier)
- Email address (for AWS root account)

**Outcome:** AWS account created, IAM user with Administrator access created, Access Key ID + Secret Access Key generated (store securely), AWS CLI configured locally (`aws configure`).

---

### What files get created or modified first?

**First Files Created (in order):**

| # | File | When | Duration |
|---|---|---|---|
| 1 | `terraform/backend.tf` | Day 1 | 30 min |
| 2 | `terraform/environments/dev/main.tf` | Day 1–2 | 4 hours |
| 3 | `terraform/environments/dev/state-table.tf` | Day 1 | 1 hour |
| 4 | `terraform/environments/dev/config-table.tf` | Day 1 | 1 hour |
| 5 | `terraform/environments/dev/variables.tf` | Day 1 | 30 min |
| 6 | `terraform/environments/dev/outputs.tf` | Day 1 | 30 min |
| 7 | `lambda/api-handler/index.js` | Day 3 | 4 hours |
| 8 | `lambda/config-manager/index.js` | Day 4 | 4 hours |
| 9 | `lambda/shared/config-reader.js` | Day 4 | 2 hours |

**No MD Files Modified in Week 1–2:** Only reference existing MD files (`LAMBDA_CATALOG.md`, `TERRAFORM_MODULE_STRUCTURE.md`, `AI_DEVELOPMENT_GUIDE.md`).

---

### What is the task-by-task sequence for Week 1–2?

#### Monday (Day 1): Infrastructure Foundation

| Time | Task | Duration |
|---|---|---|
| 9:00–11:00 AM | **T1.1** — Create AWS account, IAM user, configure AWS CLI | 2h |
| 11:00 AM–1:00 PM | **T1.2** — Set up Terraform backend (S3 + DynamoDB) | 2h |
| 2:00–5:00 PM | **T1.3** — Deploy Cognito User Pool + App Client + Admin group | 3h |
| 5:00–6:00 PM | **T1.4** — Deploy EventBridge custom bus | 1h |

#### Tuesday (Day 2): Infrastructure Completion

| Time | Task | Duration |
|---|---|---|
| 9:00 AM–1:00 PM | **T1.5** — Deploy 2 DynamoDB tables (`talent-flow-state` + `talent-flow-config`) | 4h |
| 1:00–4:00 PM | **T1.6** — Deploy API Gateway with Cognito authorizer | 3h |
| 4:00–6:00 PM | **T1.7** — Configure AWS SES (verify domain/emails) | 2h |

#### Wednesday (Day 3): Validate Infra + Backend Candidate

| Time | Task | Duration |
|---|---|---|
| 9:00–10:00 AM | **T1.8** — Validate infrastructure (Cognito signup, DynamoDB write, EventBridge publish) | 1h |
| 10:00 AM–2:00 PM | **T1.9** — Create Lambda: `api-handler` (POST /candidates) | 4h |
| 2:00–7:00 PM | **T1.10** — Create Lambda: `workflow-orchestrator` (with configVersion snapshot) | 5h |

#### Thursday (Day 4): Backend Deployment + Config Management

| Time | Task | Duration |
|---|---|---|
| 9:00 AM–1:00 PM | **T1.11** — Deploy Lambdas with Terraform | 4h |
| 1:00–3:00 PM | **T1.12** — Create EventBridge rule: `candidate-created-to-orchestrator` | 2h |
| 3:00–4:00 PM | **T1.13** — Write unit tests (api-handler, workflow-orchestrator, configVersion capture) | 1h |
| 4:00–8:00 PM | **T1.14** — Create Lambda: `config-manager` (GET/PUT /config, versioning, audit) | 4h |

#### Friday (Day 5): Config Seeding + Auth Setup

| Time | Task | Duration |
|---|---|---|
| 9:00–11:00 AM | **T1.15** — Seed default config for all 6 Variable Six | 2h |
| 11:00 AM–1:00 PM | **T1.16** — Create Cognito admin group + admin/user test users | 2h |
| 1:00–2:00 PM | **T1.17** — Deploy `config-manager` Lambda with Terraform | 1h |
| 2:00–3:00 PM | **T1.18** — Test config API (GET defaults, PUT creates v2, verify versioning) | 1h |
| 3:00–6:00 PM | **T1.19** — Set up Angular 17 project (standalone components, Material, TailwindCSS) | 3h |

#### Monday (Day 6): Frontend Auth + Candidate Creation

| Time | Task | Duration |
|---|---|---|
| 9:00 AM–1:00 PM | **T1.20** — Create Cognito auth service (with `isAdmin()` from JWT claims) | 4h |
| 1:00–4:00 PM | **T1.21** — Create login component (email/password, error handling) | 3h |
| 4:00–6:00 PM | **T1.22** — Create candidate service (API integration with Auth header) | 2h |

#### Tuesday (Day 7): Frontend Candidate Form + List

| Time | Task | Duration |
|---|---|---|
| 9:00 AM–1:00 PM | **T1.23** — Create `candidate-create` component (7 fields + tenantId) | 4h |
| 1:00–5:00 PM | **T1.24** — Create `candidate-list` component (table view) | 4h |
| 5:00–7:00 PM | **T1.25** — Add polling mechanism (refresh every 5s) | 2h |

#### Wednesday (Day 8): Frontend Nav + Polish

| Time | Task | Duration |
|---|---|---|
| 9:00–11:00 AM | **T1.26** — Add navigation (Candidates link, Config link for admins, logout) | 2h |
| 11:00 AM–12:00 PM | **T1.27** — Add empty state | 1h |
| 12:00–2:00 PM | **T1.28** — Add loading states (spinners) | 2h |
| 2:00–4:00 PM | **T1.29** — Add error handling (toast notifications) | 2h |
| 4:00–7:00 PM | **T1.30** — Style with TailwindCSS (responsive design) | 3h |

#### Thursday (Day 9): Integration Testing

| Time | Task | Duration |
|---|---|---|
| 9:00–11:00 AM | **T1.31** — Integration test: Create candidate → verify DynamoDB + workflow + configVersion | 2h |
| 11:00 AM–2:00 PM | **T1.32** — E2E test: Login → Create candidate → See in list | 3h |
| 2:00–4:00 PM | **T1.33** — Config test: GET/PUT config, verify versioning | 2h |
| 4:00–6:00 PM | **T1.34** — Versioning test: 2 candidates, config change between them, verify different configVersions | 2h |

#### Friday (Day 10): Deployment + Smoke Testing

| Time | Task | Duration |
|---|---|---|
| 9:00–11:00 AM | **T1.35** — Deploy to AWS dev environment | 2h |
| 11:00 AM–1:00 PM | **T1.36** — Smoke test all flows (admin login, user login, create, list, config GET, logout) | 2h |
| 1:00–2:00 PM | **T1.37** — Document M1 completion | 1h |
| 2:00–5:00 PM | **T1.38** — Internal demo to self (record video, screenshots) | 3h |
| 5:00–8:00 PM | **T1.39** — Fix critical bugs (3h buffer) | 3h |

**End of Week 2:** M1 complete. Working login (admin/user), candidate creation, candidate list, **config management API with all 6 Variable Six seeded, config versioning working**. Cognito + 2 DynamoDB tables + EventBridge + Lambda + API Gateway all operational. Tenant-aware and config-driven from Day 1.

---

### Do you need to read any MD files?

**NO** — I do not need to read any MD files at this time.

**Reasoning:** The `PROJECT_CONTEXT.md` already provided contains comprehensive extracts (7,015 lines) from all 12 architecture documents with key context, code examples, schema patterns, and critical gaps identified. I have sufficient context to execute MVP1.

**If I Need to Read Later** (will ask permission first):
- `LAMBDA_CATALOG.md` — during M2 if `interview-scheduler` implementation details are ambiguous
- `AI_DEVELOPMENT_GUIDE.md` — during code generation if prompt template needs clarification
- `STEP_FUNCTIONS_ORCHESTRATION.md` — during MVP2 when implementing offer approval state machine

**Current Context is Sufficient For:**
- M1–M4 task execution (including config management layer)
- Config-driven business rules (scoring, SLAs, veto, panel size)
- Config versioning strategy (in-flight protection)
- Terraform module usage
- DynamoDB schema design (both tables)
- EventBridge patterns
- Lambda implementation patterns

---

## Summary

**MVP1 Foundation Plan v2.0 Complete (Metadata-Lite Architecture).** This document defines:

- ✅ **4 milestones** (M1–M4) with **~150 tasks**, **280 hours** effort over **7 weeks**
- ✅ **Metadata-Lite architecture:** The Variable Six externalized to config from Day 1
- ✅ **Config versioning:** In-flight candidates locked to config version at creation (Gemini's critical insight)
- ✅ **Config-driven Lambdas:** vote-processor, sla-monitor, notification-service, interview-scheduler all read from config
- ✅ **Admin UI for 3 Variable Six:** Scoring Weights, SLA Thresholds, Panel Rules (remaining 3 deferred to MVP2)
- ✅ **Critical gap fixes** baked into M3 (config-driven scoring, STRONG_NO veto as toggle, configurable panel size)
- ✅ **Cognito authentication** with admin/user role separation from M1
- ✅ **Tenant-aware architecture** from Day 1
- ✅ **SLA monitoring** config-driven in M4
- ✅ **Dependency graph** showing critical path (updated with config tasks)
- ✅ **Demo script** for BA/PO walkthrough (**24 min, 8 scenes** — includes live config change)
- ✅ **Risk mitigation** for **8 identified risks** (including config versioning complexity)
- ✅ **File modification plan** (new: config table, config-manager Lambda, admin UI components, shared config-reader)
- ✅ **MVP2–5 expanded skeleton** (updated: vertical expansion via config, AI config assistant in MVP4)
- ✅ **Execution readiness** (first task, first files, day-by-day Week 1–2 schedule)
- ✅ **Cost analysis:** R1.06M savings vs hardcoded approach for 2 verticals
- ✅ **Vertical adapter pattern:** Agriculture and banking launch in 1–3 days with zero code changes

---

**Next Step:** Save this document as `MVP1-FOUNDATION-PLAN-v2.md` and begin execution with **Task T1.1**.

**Timeline:** 7 weeks to production-ready MVP1 demo. Demo-able after 6 weeks (M1–M3 complete), M4 adds polish, SLA monitoring, and hardening.

**Budget:** $0/month (100% AWS Free Tier validated).

**Architecture:** Metadata-Lite — business rules in config, platform invariants in code. Foundation for vertical expansion and AI configuration assistant.

**Confidence:** HIGH — All critical gaps identified (including versioning), mitigation strategies defined, task breakdown is detailed and actionable. The +1 week investment (vs hardcoded) saves R1.06M on vertical 2 launch.

---

### What Changed from v1.0 to v2.0

| Aspect | v1.0 (Hardcoded) | v2.0 (Metadata-Lite) |
|---|---|---|
| **Scoring weights** | Hardcoded in Lambda | Read from config table |
| **SLA thresholds** | Hardcoded 48h/72h | Read from config table |
| **STRONG_NO veto** | Hardcoded logic | Configurable toggle in config |
| **Panel sizes** | Partially configurable | Fully config-driven by position level |
| **Notification templates** | Hardcoded strings | Read from config table |
| **Stage enablement** | All stages hardcoded | Feature flags per tenant |
| **Config versioning** | Not addressed | Built-in from Day 1 |
| **Admin UI** | None | 3 config pages (Scoring, SLAs, Panel Rules) |
| **Admin role** | Not addressed | Cognito Admin group + AdminGuard |
| **DynamoDB tables** | 1 table | 2 tables (state + config) |
| **Timeline** | 6 weeks (240h) | 7 weeks (280h) |
| **Demo duration** | 20 min, 7 scenes | 24 min, 8 scenes |
| **Vertical 2 launch** | 12 weeks rebuild | 1–3 days config only |
| **Risks** | 7 risks | 8 risks (+ config versioning) |

---

*END OF MVP1 FOUNDATION PLAN v2.0*
