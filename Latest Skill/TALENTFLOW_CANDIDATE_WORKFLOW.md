# TalentFlow — Full Candidate Workflow (End-to-End)

**Last updated:** 2026-05-26  
**Source of truth:** Lambda source code + Terraform APIGW routes + Angular models  
**API base:** `https://57l0w7kk9h.execute-api.af-south-1.amazonaws.com`  
**Auth:** Cognito JWT — Naleko HR pool `af-south-1_2LdAGFnw2` / client `1pk5rd58glsohfplnlr63tg0qb`

---

## 1. Pipeline Overview

12 stages across 4 phases. Stages are **forward-only** — the `advanceCandidateStage` Lambda enforces this with `conflict(409)` on any backward or same-level move.

```
Phase 1 — Interview & Evaluation (MVP 1)
  1.  APPLICATION_REVIEW
  2.  PHONE_SCREENING
  3.  TECHNICAL_INTERVIEW
  4.  PANEL_INTERVIEW
  5.  EVALUATION

Phase 2 — Offer & Acceptance (MVP 1)
  6.  BACKGROUND_CHECK
  7.  OFFER_PREPARATION
  8.  OFFER_APPROVAL
  9.  OFFER_DELIVERY
  10. CONTRACT_SIGNING

Phase 3 — Pre-Onboarding (MVP 2)
  11. PRE_BOARDING

Phase 4 — Onboarding & Day 1 (MVP 2)
  12. ONBOARDING
```

The `PHASE_MAP` in `talent-flow.models.ts` maps each stage to a phase number (1–4). The stepper in the Candidate Workspace uses this to render the phase indicator.

MVP 1 scope = Phases 1–2 (stages 1–10).  
MVP 2 scope = Phases 3–4 (stages 11–12).

---

## 2. Candidate Workspace UI

**Route:** `/platform/talentflow/candidates/:id`  
**Component:** `CandidateWorkspacePageComponent`

### Layout
- **Left rail:** avatar header → identity card → stage stepper → advance-stage button → SLA timer widget
- **Right panel:** 6 tabs

### Tab Map

| Tab key | Label | What lives here |
|---|---|---|
| `overview` | Overview | Summary, notes, department/location strip (D030), engagement summary |
| `interviews` | Interviews | Schedule interview panel, panel member list, scoring link generation, sentiment capture |
| `offer` | Offer | `OfferTabComponent` — offer form, state machine actions, interaction log |
| `provisioning` | Provisioning | `ProvisioningTabComponent` — bundle creation, HM approval flow, IT task progress |
| `engagement` | Engagement | Activity timeline, vote history, sentiment history (lazy-loaded on first open) |
| `notes` | Notes | TA free-form notes (stored on candidate record) |

TypeScript type: `WorkspaceTab = 'overview' | 'interviews' | 'offer' | 'provisioning' | 'engagement' | 'notes'`

---

## 3. API Routes (Complete)

All routes secured by JWT authorizer `ko4zam` → **Naleko HR pool** (`af-south-1_2LdAGFnw2`).  
**CRITICAL: Do not change this authorizer to any other pool.** See ADR-006.

### 3.1 Candidate CRUD

| Method | Route | Lambda | Notes |
|---|---|---|---|
| `GET` | `/v1/candidates` | `getCandidates` | Supports pipeline filters |
| `GET` | `/v1/candidates/{id}` | `getCandidate` | Full candidate record |
| `POST` | `/v1/candidates` | `createCandidate` | Creates SAGA record in DynamoDB |
| `PATCH` | `/v1/candidates/{id}` | `updateCandidate` | Updates editable fields (name, role, notes etc.) |
| `GET` | `/v1/candidates/{id}/events` | `getCandidateEvents` | Activity timeline (EventBridge Audit Stream) |

### 3.2 Stage Advancement

| Method | Route | Lambda | Notes |
|---|---|---|---|
| `PUT` | `/v1/candidates/{id}/stage` | `advanceCandidateStage` | Forward-only; resets `slaStatus` to `ON_TRACK`; publishes `StageAdvanced` to EventBridge |

**Request body:**
```json
{ "newStage": "PHONE_SCREENING", "tenantId": "tenant-uuid" }
```

**Response (200):**
```json
{ "candidateId": "...", "previousStage": "APPLICATION_REVIEW", "newStage": "PHONE_SCREENING", "stageEnteredAt": "ISO-8601" }
```

**Error codes:**
- `400` — missing `newStage` or `tenantId`, invalid stage value
- `404` — candidate SAGA record not found
- `409` — backward/same stage transition attempted
- `500` — DynamoDB write failure

**DynamoDB write:** Updates `talent-flow-state` table, key `PK=CANDIDATE#{id} / SK=SAGA`, sets `currentStage`, `stageEnteredAt`, `slaStatus='ON_TRACK'`.

**EventBridge:** Publishes `StageAdvanced` to `talent-flow-bus`, source `talent-flow.workflow`.

### 3.3 Interviews

| Method | Route | Lambda | Notes |
|---|---|---|---|
| `POST` | `/v1/candidates/{id}/interviews` | `scheduleInterview` | Creates interview record; triggers notification |
| `PATCH` | `/v1/candidates/{id}/interviews/{interviewId}` | `scheduleInterview` | Update interview (reschedule, cancel) |
| `GET` | `/v1/panel-members` | `getPanelMembers` | Returns all active panel members for the tenant |
| `POST` | `/v1/candidates/{id}/scoring-links` | `generateScoringLink` | Generates time-limited JWT token for email-link-only panellists (TF pool) |

### 3.4 Votes & Evaluation

| Method | Route | Lambda | Notes |
|---|---|---|---|
| `POST` | `/v1/candidates/{id}/votes` | `submitVote` | System-account panellist submits scores |
| `POST` | `/v1/scoring/{token}/votes` | `submitVoteByToken` | Email-link panellist (no Cognito account) — uses TF pool authorizer, **separate from `ko4zam`** |
| `POST` | `/v1/candidates/{id}/sentiment` | `captureSentiment` | TA records candidate engagement sentiment (D007) |

**Evaluation trigger:** `completeEvaluation` Lambda is **NOT a HTTP route**. It is triggered by EventBridge rule when `VotingCompleted` fires on `talent-flow-bus`. It is not callable directly from the browser.

**completeEvaluation flow (6 steps):**
1. Extract `candidateId`, `tenantId`, `averageScore`, `result` from `event.detail`
2. If `result === 'STRONG_NO_VETO'` → `outcome = FAILED` (skip scoring)
3. `GetItem` SAGA → read `configVersion`
4. `getConfig(tenantId, 'APPROVAL_RULES', configVersion)` — **must** use candidate's locked `configVersion` (POPIA compliance invariant #2)
5. Compare `averageScore >= config.minimumPassScore` (default `6.0`) → `PASSED` or `FAILED`
6. `UpdateItem` SAGA + publish `EvaluationCompleted` to EventBridge

`EvaluationCompleted(outcome=PASSED)` → EventBridge Rule → `createOffer` auto-triggered.

### 3.5 Offer

| Method | Route | Lambda | Notes |
|---|---|---|---|
| `POST` | `/v1/candidates/{id}/offer` | `createOffer` | Manual TA fallback (auto-triggered by EventBridge on PASSED evaluation) |
| `GET` | `/v1/candidates/{id}/offer` | `getOffer` | Read current offer record |
| `PUT` | `/v1/candidates/{id}/offer` | `advanceOfferState` | All state transitions |

**Offer state machine:**
```
OFFER_CREATED → IN_APPROVAL → OFFER_SENT → ACCEPTED
```

**`advanceOfferState` actions (sent as `body.action`):**

| Action | From | To | Required payload fields |
|---|---|---|---|
| `SUBMIT_FOR_APPROVAL` | `OFFER_CREATED` | `IN_APPROVAL` | `baseSalary`, `currency`, `startDate`, `expiryDate` |
| `MARK_SENT` | `IN_APPROVAL` | `OFFER_SENT` | none |
| `LOG_INTERACTION` | any | no change | `interactionType` (CALL/EMAIL/WHATSAPP/MEETING), `outcome` (ACKNOWLEDGED/ASKING_QUESTIONS/COUNTER_RECEIVED/GOING_QUIET/VERBAL_ACCEPT/DECLINED), `notes?` |
| `CONFIRM_ACCEPTANCE` | `OFFER_SENT` | `ACCEPTED` | `acceptanceDate`, `confirmedStartDate`, `acceptanceSentiment` (EXCITED/POSITIVE/HESITANT), `notes?` |

**`createOffer` invocation paths:**
- **A — Automatic:** EventBridge `EvaluationCompleted(outcome=PASSED)` → Lambda
- **B — Manual:** `POST /v1/candidates/{id}/offer` (TA fallback)

**createOffer steps (6):**
1. Detect HTTP vs EventBridge invocation path
2. EventBridge path: guard `outcome === PASSED`; HTTP path: bypasses guard
3. `GetItem` SAGA → `positionLevel`, `role`, `department`, `location`, `configVersion`
4. `getConfig(tenantId, 'APPROVAL_RULES', configVersion)` — versioned (POPIA invariant #2)
5. Derive seniority-driven approval chain: `JUNIOR/MID → [HiringManager]`, `SENIOR → [HiringManager, Director]`
6. `PutItem` OFFER record (`PK=CANDIDATE#{id}, SK=OFFER`), start Step Functions offer-approval state machine, publish `OfferInitialised` to EventBridge

`CONFIRM_ACCEPTANCE` publishes `OfferAccepted` → EventBridge fan-out → IT provisioning + 48hr HM countdown.

### 3.6 IT Provisioning

**TA-side (bundle management):**

| Method | Route | Lambda | Notes |
|---|---|---|---|
| `POST` | `/v1/provisioning/bundles` | `createProvisioningBundle` | Creates bundle; optionally matches template; publishes to `naleko-onboarding` bus |
| `GET` | `/v1/provisioning/bundles` | `getProvisioningBundles` | List all bundles (optional status filter) |
| `GET` | `/v1/provisioning/bundles/{bundleId}` | `getProvisioningBundle` | Single bundle detail |
| `POST` | `/v1/provisioning/bundles/{bundleId}/approve` | `approveProvisioningBundle` | HM approves the bundle |
| `PATCH` | `/v1/provisioning/bundles/{bundleId}` | `updateProvisioningBundle` | Edit bundle items pre-approval |
| `GET` | `/v1/provisioning/bundles/{bundleId}/progress` | `getProvisioningBundleProgress` | Task progress (claimed/completed counts) |

**IT Specialist task operations:**

| Method | Route | Lambda | Notes |
|---|---|---|---|
| `GET` | `/v1/it/tasks` | `getItTasks` | All tasks visible to the specialist's queue |
| `GET` | `/v1/it/tasks/{taskId}` | `getItTask` | Single task detail |
| `POST` | `/v1/it/tasks/{taskId}/claim` | `claimItTask` | Assigns task to calling specialist |
| `POST` | `/v1/it/tasks/{taskId}/release` | `releaseItTask` | Returns task to queue |
| `POST` | `/v1/it/tasks/{taskId}/complete` | `completeItTask` | Marks task done; triggers progress update |

**`createProvisioningBundle` body:**
```json
{
  "candidateId":   "CAND-...",
  "candidateName": "Wayne Rooney",
  "candidateRole": "Software Engineer",
  "seniority":     "MID",
  "department":    "Engineering",
  "startDate":     "2026-06-01",
  "templateId":    "optional-template-uuid",
  "items":         []
}
```

**Bundle provisioning flow:**
```
TA creates bundle (POST /v1/provisioning/bundles)
  → HM reviews    (/platform/talentflow/hm-provisioning/:bundleId/review)
  → HM approves   (POST /v1/provisioning/bundles/:bundleId/approve)
  → IT tasks auto-created, routed to queues by routing rules config
  → IT specialists claim/complete tasks
  → Progress polled (/platform/talentflow/hm-provisioning/:bundleId/progress)
```

### 3.7 Config (Admin)

| Method | Route | Lambda | Notes |
|---|---|---|---|
| `GET` | `/v1/config` | `manageTalentFlowConfig` | Read config by type + optional version |
| `POST` | `/v1/config` | `manageTalentFlowConfig` | Create new config version |
| `PUT` | `/v1/config/{id}` | `manageTalentFlowConfig` | Update existing config |

**Config types:** `SCORING_WEIGHTS`, `SLA_THRESHOLDS`, `APPROVAL_RULES`, `PANEL_CONFIG`, `PANEL_RULES`, `EMAIL_TEMPLATES`, `STAGE_CONFIG`, `SENTIMENT_SCALE`, `SENTIMENT_SCALES`, `INTERVIEW_TYPES`, `REJECTION_RULES`, `WORKFLOW_TEMPLATES`, `SENIORITY_PROFILES`, `IT_QUEUES`, `PROVISIONING_TEMPLATES`, `ROUTING_RULES`, `SENIORITY_DEFINITIONS`, `APPROVAL_CHAINS`, `LOCALE_SETTINGS`

### 3.8 Notifications

| Method | Route | Lambda | Notes |
|---|---|---|---|
| `GET` | `/v1/notifications` | `getUserNotifications` | Bell icon inbox, polling-based |
| `PATCH` | `/v1/notifications/{id}/read` | `markNotificationRead` | Mark individual notification read |

### 3.9 Admin

| Method | Route | Lambda | Notes |
|---|---|---|---|
| `GET` | `/v1/admin/users` | `adminGetUsers` | List all TalentFlow users |
| `POST` | `/v1/admin/users` | `adminCreateUser` | Create new user (sets Cognito + DynamoDB) |
| `PUT` | `/v1/admin/users/{userId}` | `adminUpdateUser` | Update user role/details |
| `DELETE` | `/v1/admin/users/{userId}` | `adminDeactivateUser` | Deactivate user |
| `GET` | `/v1/admin/dashboard` | `adminGetDashboard` | Admin overview metrics |

---

## 4. EventBridge Event Flow

**Bus:** `talent-flow-bus`

```
StageAdvanced              → [monitorTalentFlowSLAs, sendTalentFlowNotification]
VotingCompleted            → [completeEvaluation]
EvaluationCompleted(PASS)  → [createOffer]
EvaluationCompleted(FAIL)  → [sendTalentFlowNotification]
OfferInitialised           → [sendTalentFlowNotification]
OfferAccepted              → [createProvisioningBundle trigger, sendTalentFlowNotification]
```

All events use source `talent-flow.workflow` and `DetailType` = event name.

---

## 5. DynamoDB Data Model

**Table:** `talent-flow-state`

| PK | SK | Contents |
|---|---|---|
| `CANDIDATE#{id}` | `SAGA` | `currentStage`, `slaStatus`, `stageEnteredAt`, `configVersion`, `positionLevel`, `tenantId`, and all candidate fields |
| `CANDIDATE#{id}` | `OFFER` | `state` (OfferState), `baseSalary`, `currency`, `startDate`, `expiryDate`, `approvalChain`, `interactionLog[]`, `configVersion` |
| `CANDIDATE#{id}` | `INTERVIEW#{interviewId}` | Interview record |
| `CANDIDATE#{id}` | `VOTE#{voteId}` | Individual panellist vote |

**Table:** `provisioning-bundles`

| PK | SK | Contents |
|---|---|---|
| `BUNDLE#{bundleId}` | `META` | Bundle metadata, items[], status, candidateId |
| `BUNDLE#{bundleId}` | `TASK#{taskId}` | Individual IT task, assignedTo, status |

---

## 6. Frontend Service API Reference

**Service:** `TalentFlowApiService` (injects core `AuthService` — Naleko HR pool)

| Method | API call |
|---|---|
| `getCandidates(filters?)` | `GET /v1/candidates` |
| `getCandidate(id)` | `GET /v1/candidates/{id}` |
| `getCandidateEvents(id, filters?)` | `GET /v1/candidates/{id}/events` |
| `createCandidate(payload)` | `POST /v1/candidates` |
| `updateCandidate(id, patch)` | `PATCH /v1/candidates/{id}` |
| `getPanelMembers()` | `GET /v1/panel-members` |
| `scheduleInterview(id, payload)` | `POST /v1/candidates/{id}/interviews` |
| `addPanelMembers(id, payload)` | `POST /v1/candidates/{id}/scoring-links` |
| `submitVote(id, payload)` | `POST /v1/candidates/{id}/votes` |
| `captureSentiment(id, payload)` | `POST /v1/candidates/{id}/sentiment` |
| `advanceStage(id, newStage)` | `PUT /v1/candidates/{id}/stage` |
| `getConfig(type, version?)` | `GET /v1/config` |
| `updateConfig(type, data)` | `PUT /v1/config/{id}` |
| `getItSpecialists()` | `GET /v1/admin/users` (filtered) |
| `getOffer(id)` | `GET /v1/candidates/{id}/offer` |
| `createOffer(id)` | `POST /v1/candidates/{id}/offer` |
| `advanceOfferState(id, action, payload)` | `PUT /v1/candidates/{id}/offer` |
| `getProvisioningBundles(statusFilter?)` | `GET /v1/provisioning/bundles` |
| `getProvisioningBundle(id)` | `GET /v1/provisioning/bundles/{bundleId}` |
| `getProvisioningBundleProgress(id)` | `GET /v1/provisioning/bundles/{bundleId}/progress` |
| `createProvisioningBundle(payload)` | `POST /v1/provisioning/bundles` |
| `approveProvisioningBundle(bundleId)` | `POST /v1/provisioning/bundles/{bundleId}/approve` |
| `updateProvisioningBundle(bundleId, patch)` | `PATCH /v1/provisioning/bundles/{bundleId}` |

**Static helper:** `TalentFlowApiService.nextStage(current)` — returns the next stage in `STAGE_ORDER` or `null` if at last stage. Used by the advance-stage button.

---

## 7. Frontend Routes (Angular)

**Base:** `/platform/talentflow`

| Path | Component | Role guard |
|---|---|---|
| `/` | `DashboardPageComponent` | TA (HM redirected to `/hm-dashboard`) |
| `/pipeline` | `PipelinePageComponent` | any |
| `/candidates` | `CandidatesPageComponent` | any |
| `/candidates/:id` | `CandidateWorkspacePageComponent` | any |
| `/offers` | `OffersPageComponent` | any |
| `/hm-dashboard` | `HmDashboardPageComponent` | HM |
| `/hm-provisioning` | `HmProvisioningPageComponent` | HM |
| `/hm-provisioning/:bundleId/review` | `HmBundleReviewPageComponent` | HM |
| `/hm-provisioning/:bundleId/progress` | `HmBundleProgressPageComponent` | HM |
| `/config` | `ConfigHubPageComponent` | admin |
| `/admin/overview` | `AdminOverviewPageComponent` | admin |
| `/admin/audit` | `AdminAuditPageComponent` | admin |
| `/admin/users` | `AdminUsersPageComponent` | admin |
| `/admin/notifications` | `AdminNotificationsPageComponent` | admin |
| `/admin/tenant` | `AdminTenantSettingsComponent` | admin |
| `/admin/talentflow/scoring-weights` | `AdminScoringWeightsComponent` | admin |
| `/admin/talentflow/sla-thresholds` | `AdminSlaThresholdsComponent` | admin |
| `/admin/talentflow/panel-rules` | `AdminPanelRulesComponent` | admin |
| `/admin/talentflow/sentiment-scales` | `AdminSentimentScalesComponent` | admin |
| `/admin/it-request/queues` | `AdminQueueManagementComponent` | admin |
| `/admin/it-request/templates` | `AdminProvisioningTemplatesComponent` | admin |
| `/admin/it-request/routing` | `AdminRoutingRulesComponent` | admin |

---

## 8. Domain Types (Key)

```typescript
type HiringStage =
  'APPLICATION_REVIEW' | 'PHONE_SCREENING' | 'TECHNICAL_INTERVIEW' |
  'PANEL_INTERVIEW' | 'EVALUATION' | 'BACKGROUND_CHECK' |
  'OFFER_PREPARATION' | 'OFFER_APPROVAL' | 'OFFER_DELIVERY' |
  'CONTRACT_SIGNING' | 'PRE_BOARDING' | 'ONBOARDING';

type OfferState       = 'OFFER_CREATED' | 'IN_APPROVAL' | 'OFFER_SENT' | 'ACCEPTED';
type EvaluationState  = 'DRAFT' | 'SUBMITTED' | 'LATE' | 'MISSING';
type SlaHealthStatus  = 'ON_TRACK' | 'AT_RISK' | 'BREACHED';
type PositionLevel    = 'JUNIOR' | 'MID' | 'SENIOR';
type EngagementSentiment = 'VERY_INTERESTED' | 'INTERESTED' | 'NEUTRAL' | 'HESITANT' | 'DISENGAGED';
type WorkspaceTab     = 'overview' | 'interviews' | 'offer' | 'provisioning' | 'engagement' | 'notes';
```

---

## 9. Auth Architecture — Critical Facts

> **DO NOT CHANGE THE APIGW AUTHORIZER WITHOUT READING ADR-006**

| Pool | ID | Client ID | Used by |
|---|---|---|---|
| Naleko HR (main app) | `af-south-1_2LdAGFnw2` | `1pk5rd58glsohfplnlr63tg0qb` | All browser login sessions, all API calls |
| TalentFlow (panel scoring links only) | `af-south-1_C8TTlQxY7` | `74644m5eck56vvq4fp7nfm8dht` | `submitVoteByToken` route only |

- APIGW authorizer `ko4zam` on API `57l0w7kk9h` → **must stay on Naleko HR pool**
- `TalentFlowApiService` injects `AuthService` from `core/services/auth.service.ts` → Naleko pool token
- `TalentFlowAuthService` (at `talent-flow/services/talent-flow-auth.service.ts`) → TalentFlow pool → used **only** for scoring link pages
- Switching `ko4zam` to TF pool causes **all** browser API calls to 401

---

## 10. Outstanding Issues (as of 2026-05-26)

| Issue | Severity | Notes |
|---|---|---|
| `PUT /v1/candidates/{id}/stage` returns 500 from browser | High | Lambda works when invoked directly. Root cause not yet isolated — auth ruled out. Likely DynamoDB condition or missing field in browser request payload. |
| `completeEvaluation` has no direct HTTP route | Design | Intentional — it is only EventBridge-triggered. Browser cannot call it directly. HM completes evaluation via the inline scoring panel; votes trigger `VotingCompleted` → auto-evaluation. |
| SLA breached display / reset not consistent | Medium | `slaStatus` resets to `ON_TRACK` on stage advance, but display may not re-poll. |
| Offer tab end-to-end not tested in browser | Medium | |
| IT Provisioning tab end-to-end not tested in browser | Medium | |
| Wayne Rooney test candidate (`CAND-01KS5H7TKYCP8KYQSAFXQHZAME`) DynamoDB state | Low | Currently at `EVALUATION` stage after direct Lambda invocation during debugging — not at `PANEL_INTERVIEW` as originally. |
