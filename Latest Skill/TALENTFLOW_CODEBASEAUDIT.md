# TalentFlow — Live Codebase Audit
## Source of Truth: TALENTFLOW_DECISIONS.md (71 Locked Decisions)
### Branch: `feature/epic4-talentflow-frontend`
### Audit Started: 20 May 2026
### Status: ✅ COMPLETE — Frontend ✅ · Backend ✅ · Config Metadata ✅ · Architecture ✅ · Infra ✅

---

> **Purpose:** This document is the living cross-layer audit of the TalentFlow codebase against the 71 locked decisions. It is updated progressively as each layer is audited. Every gap identified here maps to a specific decision number and a specific file. The goal is a complete picture of what needs to be built, rebuilt, fixed, or reused — across Frontend, Backend (Lambda), and Infrastructure (Terraform).

---

## AUDIT LEGEND

| Symbol | Meaning |
|--------|---------|
| 🔴 | Critical violation — hard rule broken or feature doesn't exist |
| 🟡 | Gap — partial implementation, wrong structure, or wrong data |
| 🟢 | Compliant — matches locked decision |
| ⬜ | Not yet audited |
| 🔗 | Cross-layer dependency — gap in this layer causes a gap in another |

---

## LAYER 1 — FRONTEND (Angular 19 / PrimeNG)
### Audit Status: ✅ Complete

---

### 1.1 Shell & Navigation

#### 🔴 GAP-FE-001 — Navigation Paradigm Wrong (D-022)
- **Decision:** Horizontal top navigation bar with brand mark, 5 nav links (Dashboard · Pipeline · Candidates · Offers · Reports), Add Candidate (teal pill), Ask AI (cyan outlined pill), Bell badge, Role pill, Avatar
- **Exists:** Vertical sidebar (`app-sidebar`) + minimal topbar (`app-topbar`) — completely wrong pattern
- **File:** `hr-portal/src/app/features/talent-flow/shell/talent-flow-shell.component.html`
- **Action:** Rebuild `TalentFlowShellComponent` — replace sidebar pattern with locked horizontal topbar
- **Cross-layer:** 🔗 HM role pill requires role from Cognito JWT claim — see Backend-Auth layer

#### 🔴 GAP-FE-002 — AI Assistant in Wrong Location (D-023)
- **Decision:** Ask AI button lives in topbar (shell level) — persistent on every screen
- **Exists:** Ask AI button lives only inside `candidate-workspace-page.component.html` as a local page action
- **File:** `hr-portal/src/app/features/talent-flow/pages/candidate-workspace/candidate-workspace-page.component.html`
- **Action:** Move AI assistant to shell topbar. `ai-chat-panel` component exists — wire to shell

#### 🟡 GAP-FE-003 — Shell Nav Links Incomplete (D-022)
- **Exists:** Dashboard · Pipeline · Config (3 items, Config is admin-only)
- **Required:** Dashboard · Pipeline · Candidates · Offers · Reports (5 items for TA, 3 for HM)
- **Action:** Add Candidates, Offers, Reports nav links. Reports is MVP 2 placeholder (disabled state)

---

### 1.2 SLA Timer Widget

#### 🔴 GAP-FE-004 — Exact Times Displayed — Hard Rule Violation (D-010, D-021, SKILL §10)
- **Decision:** "NEVER surface exact time values anywhere. ALWAYS use: At Risk / Breached / On Track"
- **Exists:** Template renders `"{{ timerState().hoursRemaining }}h {{ timerState().minutesRemaining }}m remaining"` and `"Xh Ym overdue"`
- **File:** `hr-portal/src/app/features/talent-flow/components/sla-timer-widget/sla-timer-widget.component.html` lines 22–28
- **Action:** Remove all time text from template. Display health state label only (Breached / At Risk / On Track). Keep visual progress bar fill.

#### 🟡 GAP-FE-005 — SLA Health State Names Wrong (D-010, D-021)
- **Exists:** Internal and exposed states `GREEN | AMBER | RED`
- **Required:** `ON_TRACK | AT_RISK | BREACHED`
- **File:** `hr-portal/src/app/features/talent-flow/components/sla-timer-widget/sla-timer-widget.component.ts`
- **Action:** Rename states and CSS modifiers to match locked health language

---

### 1.3 Dashboard Page

#### 🔴 GAP-FE-006 — Dashboard Not Signal-First — Complete Rebuild (D-016, D-020)
- **Decision:** 5-zone signal-first layout ordered by urgency: Signal Summary Strip → Candidates at Risk (max 2) → My Actions Today (max 3) → Pipeline Summary (health dots only) → This Month
- **Exists:** "Hiring Dashboard" with 4 KPI cards + flat "Recent Activity" table of last 10 candidates
- **File:** `hr-portal/src/app/features/talent-flow/pages/dashboard/dashboard-page.component.html`
- **Action:** Full rebuild to 5-zone layout

#### 🔴 GAP-FE-007 — Wrong KPIs in Dashboard (D-020)
- **Exists:** Total Candidates, SLA Breached, Avg Day-1 Score, In Onboarding
- **Required:** SLA Breaches (red), At Risk (amber), Acceptance Rate (green), Active Pipeline (indigo)
- "Avg Day-1 Score" is MVP 2 scope — not in MVP 1. "In Onboarding" is wrong metric focus
- **Cross-layer:** 🔗 Acceptance Rate requires offer acceptance data from `getCandidate` / `getCandidates` Lambda

#### 🔴 GAP-FE-008 — Candidate Names in Pipeline Summary (D-025)
- **Decision:** Pipeline Summary shows health dots and counts only — no candidate names on dashboard
- **Exists:** Recent Activity table shows candidate names, emails, and details
- **Action:** Pipeline Summary component to show phase name + health dot grid + total count only

#### 🔴 GAP-FE-009 — No Urgency-Zone Ordered Candidate Cards (D-024)
- **Decision:** Candidates at Risk zone shows max 2 cards with avatar (colour = urgency), name, role, seniority pill, sentiment pill, stage, stage context, health pill, SLA bar — ordered: Breached first
- **Exists:** Nothing equivalent
- **Action:** Build `CandidateDashboardCardComponent` matching Decision 024 anatomy

#### 🔴 GAP-FE-010 — No My Actions Today Zone (D-016, D-020 Zone 3)
- **Decision:** My Actions Today — max 3 action items with icon square (colour-coded), action title, description, priority tag
- **Exists:** Nothing
- **Cross-layer:** 🔗 Actions come from backend — requires notification/action queue from Lambda/DynamoDB

---

### 1.4 Pipeline View

#### 🔴 GAP-FE-011 — List View Missing — Kanban Only (D-053)
- **Decision:** Dual mode — List view (default) + Kanban toggle. List = 7-column table, health worst first
- **Exists:** Kanban only, no List view, no mode toggle
- **File:** `hr-portal/src/app/features/talent-flow/pages/pipeline/pipeline-page.component.html`
- **Action:** Add List view as default, add mode toggle (List/Kanban), add 7-column table

#### 🔴 GAP-FE-012 — Filter Bar Wrong and Incomplete (D-054)
- **Decision:** 5 filter groups: Stage / Health (Breached/At Risk/On Track) / Seniority (Junior/Mid/Senior) / Hiring Manager / Sentiment (Hesitant/Reluctant only)
- **Exists:** Search input + 3 filter buttons: All / Green / Amber / Red
- **Action:** Replace with locked 5-group filter chip bar. Health filter language must say Breached/At Risk/On Track

#### 🔴 GAP-FE-013 — Results Bar Missing (D-055)
- **Decision:** "Showing X candidates · Y breached · Z at risk" + sort dropdown (Health worst first default)
- **Exists:** Nothing
- **Action:** Add results bar component

#### 🔴 GAP-FE-014 — Kanban Drag-and-Drop Must Be Disabled (D-053, D-057)
- **Decision:** "No drag-and-drop — stage transitions are workflow-gated, not manual"
- **Exists:** Not implemented with drag-and-drop, but no explicit lock either — needs clear comment and no `cdkDrag` wiring
- **Action:** Confirm no D&D capability is ever added

---

### 1.5 Candidate Record (Workspace)

#### 🔴 GAP-FE-015 — Wrong Layout Structure (D-027, D-028, D-029, D-030, D-031)
- **Decision:** Vertical stack: Breadcrumb → Persistent Header → Details Strip (5 cols: Applied/Dept/Location/Workflow/Seniority) → 4-Phase Indicator → Actions Bar (ghost pills) → Tabs → Two-column: content + 268px Activity Log
- **Exists:** Left-rail + right panel layout. Left rail has identity card + SLA timer + stage stepper. Right panel has 3 tabs.
- **File:** `hr-portal/src/app/features/talent-flow/pages/candidate-workspace/candidate-workspace-page.component.html`
- **Action:** Full layout rebuild

#### 🔴 GAP-FE-016 — Wrong Tabs (D-027)
- **Decision:** 5 fixed tabs always in this order: Overview · Interviews · Offer · Engagement · Notes
- **Exists:** 3 tabs: Overview · Timeline · Panel Votes
- **Action:** Replace with 5 locked tabs. Panel Votes content maps into Interviews tab

#### 🔴 GAP-FE-017 — Signal Intelligence Box Missing (D-032)
- **Decision:** Appears at top of every tab content when risk signal is active. Indigo tinted bg + border + "Signal Intelligence" eyebrow + 1–2 specific sentences + recommended action
- **Exists:** Not built anywhere
- **Action:** Build `SignalIntelligenceBoxComponent` as shared component. Used in Candidate Record, HM Scoring Panel, Offer Tab

#### 🔴 GAP-FE-018 — Activity Log Panel Missing (D-035)
- **Decision:** 268px right-side persistent panel, always visible, header "Activity Log", filter chips (All/Interviews/Scores/Sentiment), chronological feed with coloured dots
- **Exists:** Not built
- **Action:** Build `ActivityLogPanelComponent`
- **Cross-layer:** 🔗 Requires event log from DynamoDB `talent-flow-events` table via `getCandidate` Lambda

#### 🔴 GAP-FE-019 — Interview Rounds Layout Missing (D-033)
- **Decision:** Stacked cards — completed rounds collapsed, active round expanded with panel member rows, score dimensions grid (2×2), inline ghost actions (Add Member / Enter Score on Behalf / Send Scoring Link)
- **Exists:** Panel Votes tab has a basic vote list — no round cards structure
- **Action:** Build `InterviewRoundCardComponent`
- **Cross-layer:** 🔗 Requires multi-round interview model from `scheduleInterview` Lambda and DynamoDB schema

#### 🔴 GAP-FE-020 — Sentiment Selector Missing (D-034)
- **Decision:** 5-option horizontal visual selector (Excited/Positive/Neutral/Hesitant/Reluctant), coloured dot, click-to-update, no save button
- **Exists:** Sentiment shown as a chip only — not interactive
- **Action:** Build `SentimentSelectorComponent`
- **Cross-layer:** 🔗 Requires `updateSentiment` API endpoint

#### 🔴 GAP-FE-021 — 4-Phase Indicator Missing (D-030)
- **Decision:** Horizontal stepper with 4 phases (not 12 stages), short descriptions: "Screen, evaluate, decide" / "Create, approve, convert" / "Prepare, provision, clear" / "Engage, activate, confirm"
- **Exists:** `stage-selector` component shows 11 individual stages as a stepper
- **Action:** Replace with 4-phase indicator. Stage selector component to be rebuilt or repurposed

#### 🔴 GAP-FE-022 — Actions Bar Missing (D-031)
- **Decision:** Dedicated actions bar between phase indicator and tabs, all buttons identical ghost style (icon + label, pill shape), stage-contextual
- **Exists:** No actions bar — actions buried inside workspace sections
- **Action:** Build stage-contextual actions bar

#### 🔴 GAP-FE-023 — Reject Candidate Only in Header (D-028, D-031)
- **Decision:** Reject Candidate button lives in the persistent header ONLY — NOT in the actions bar
- **Exists:** No explicit placement of a Reject Candidate button at all
- **Action:** Place Reject Candidate as subtle red text button in persistent header only

---

### 1.6 Add Candidate

#### 🔴 GAP-FE-024 — Wrong Container — Full Page vs Drawer (D-036)
- **Decision:** 480px side drawer sliding from right (`p-drawer`), page behind remains visible, no navigation away
- **Exists:** Full-page route at `/platform/talentflow/candidates/new`
- **File:** `hr-portal/src/app/features/talent-flow/pages/candidate-create/candidate-create-page.component.html`
- **Action:** Convert to `p-drawer` component, triggered from topbar button. Remove `/candidates/new` route.

#### 🔴 GAP-FE-025 — Seniority Uses Dropdown — Should Be Visual Card Selector (D-039)
- **Decision:** Visual 3-card selector: Junior (Graduate/Entry level) · Mid (Professional/Specialist) · Senior (Manager/Director/Exec). Selected: indigo border + light bg
- **Exists:** `p-dropdown` for positionLevel
- **Action:** Replace with custom visual card selector component

#### 🔴 GAP-FE-026 — Workflow Template Selector Missing (D-040)
- **Decision:** Visual 2-card selector: Standard (teal dot) · Government (indigo dot). Default: Standard
- **Exists:** Not present in the form at all
- **Action:** Add workflow template visual card selector
- **Cross-layer:** 🔗 `workflowTemplateId` field exists in `CreateCandidatePayload` but backend needs to recognize template values

#### 🔴 GAP-FE-027 — Record Completeness Bar Missing (D-038)
- **Decision:** Progress bar at top of drawer body showing % of required fields complete, updates dynamically
- **Exists:** Not present
- **Action:** Add reactive completeness progress bar

#### 🔴 GAP-FE-028 — First Interview Setup Section Missing (D-037, D-041)
- **Decision:** Toggle "Schedule first interview now" (default OFF) — when ON reveals: interview type + format + proposed date + panel member search + ad hoc member addition
- **Exists:** Not present — no interview setup in the create form
- **Action:** Add Section 2 with toggle and conditional fields
- **Cross-layer:** 🔗 Requires `scheduleInterview` Lambda to accept initial interview data at creation time (or in follow-up call)

#### 🔴 GAP-FE-029 — Panel Member Hybrid Model Missing (D-041)
- **Decision:** Internal directory search (system users) + ad hoc addition (name/email/role → generates scoring link). Badges: System user (indigo) / Scoring link (green)
- **Exists:** Not present
- **Action:** Build `PanelMemberSelectorComponent`
- **Cross-layer:** 🔗 Requires internal directory API endpoint and scoring link generation from backend

#### 🟡 GAP-FE-030 — Drawer Footer Not Fixed (D-042)
- **Decision:** Footer always visible regardless of scroll — Cancel (ghost left) + Create Candidate Record (gradient CTA, fills space) + "→ Opens candidate record on creation" note
- **Exists:** Standard form submit button at page bottom
- **Action:** When converted to drawer, fix footer to always visible with correct CTA label

---

### 1.7 Missing Pages

#### 🔴 GAP-FE-031 — Candidates View Does Not Exist (D-059–063)
- **Decision:** Route `/talent-flow/candidates` — search-first view with ⌘K shortcut, recently viewed 4-card grid, real-time search, quick filter chips, all candidates table
- **Exists:** No route or component
- **Action:** Build `CandidatesPageComponent` with all 5 sub-decisions implemented

#### 🔴 GAP-FE-032 — Hiring Manager Dashboard Does Not Exist (D-044–051)
- **Decision:** Route `/talent-flow/hm-dashboard` — HM-specific topbar (My Tasks/My Candidates/Decisions), 3-signal strip, pending task cards, inline scoring panel with 4 dimension sliders + 2×2 vote grid
- **Exists:** No route or component
- **Action:** Build `HmDashboardPageComponent`
- **Cross-layer:** 🔗 Requires HM role detection from Cognito JWT + HM-specific candidates API endpoint

#### 🔴 GAP-FE-033 — Offer Tab Does Not Exist (D-064–071)
- **Decision:** "Offer" is the 3rd tab inside the candidate record — 4-state journey (Offer Created → In Approval → Offer Sent → Accepted), state navigator, state-driven content blocks, interaction log
- **Exists:** Tab structure has only Overview/Timeline/Panel Votes — no Offer tab at all
- **Action:** Build full Offer tab content as part of candidate record rebuild
- **Cross-layer:** 🔗 Requires offer lifecycle management from Lambda — no `createOffer`, `approveOffer`, `sendOffer`, `acceptOffer` Lambdas currently exist

---

### 1.8 Data Models

#### 🔴 GAP-FE-034 — HiringStage Type Wrong (D-006, D-012, D-013)
- **Exists:** 11 stages: `APPLICATION_REVIEW | PHONE_SCREENING | TECHNICAL_INTERVIEW | PANEL_INTERVIEW | EVALUATION | OFFER_PREPARATION | OFFER_APPROVAL | OFFER_DELIVERY | CONTRACT_SIGNING | PRE_BOARDING | ONBOARDING`
- **Required:** 12 locked stages in 4 phases matching the decisions document
- **File:** `hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts`
- **Cross-layer:** 🔗 Must align with DynamoDB `currentStage` enum in backend

#### 🔴 GAP-FE-035 — Sentiment Values Wrong (D-007)
- **Exists:** `POSITIVE | NEUTRAL | HESITANT | AT_RISK` (on Candidate model)
- **Required:** `VERY_INTERESTED | INTERESTED | NEUTRAL | HESITANT | DISENGAGED` (configurable per tenant)
- **File:** `talent-flow.models.ts`

#### 🟡 GAP-FE-036 — SLA Health Values Wrong (D-010, D-021)
- **Exists:** `'GREEN' | 'AMBER' | 'RED'`
- **Required:** `'ON_TRACK' | 'AT_RISK' | 'BREACHED'`
- **Exists in:** `Candidate` model, `SlaTimerWidget`, `PipelineFilters`

#### 🟡 GAP-FE-037 — PositionLevel Has DIRECTOR (D-019)
- **Exists:** `'JUNIOR' | 'MID' | 'SENIOR' | 'DIRECTOR'`
- **Required:** `'JUNIOR' | 'MID' | 'SENIOR'` for MVP 1. Should be called `Seniority` not `PositionLevel`

#### 🔴 GAP-FE-038 — Vote Decision Values Wrong (D-049)
- **Exists:** `'HIRE' | 'NO_HIRE' | 'STRONG_NO_VETO'`
- **Required:** `'STRONG_YES' | 'YES' | 'NO' | 'STRONG_NO'` (2×2 grid)

#### 🔴 GAP-FE-039 — Missing Models (D-004, D-005, D-012, D-013, D-019, D-065)
The following interfaces are entirely absent from `talent-flow.models.ts`:
- `PanelMember` — with `type: 'SYSTEM_USER' | 'SCORING_LINK'`, name, email, role, scoring link URL
- `InterviewRound` — multi-round, flexible type, panel members, score dimensions, status
- `ScoreDimensions` — typed: `{ technical; communication; culturalFit; problemSolving }` (all 1–10)
- `OfferRecord` — with `state: 'CREATED' | 'IN_APPROVAL' | 'SENT' | 'ACCEPTED'`, CTC, start date, expiry
- `ApprovalStep` — approver name/role, status, SLA health, rejection reason
- `InteractionLog` — offer stage interaction: type (Call/Email/WhatsApp/Meeting), outcome, notes, date
- `SentimentEntry` — sentiment history entry for Engagement tab
- `SentimentOption` — `'VERY_INTERESTED' | 'INTERESTED' | 'NEUTRAL' | 'HESITANT' | 'DISENGAGED'`
- **Cross-layer:** 🔗 All of these require corresponding DynamoDB attribute changes and Lambda response shapes

---

### 1.9 Routes

#### 🟡 GAP-FE-040 — Missing Routes (D-022, D-045, D-052, D-059)
- **Missing:** `/talent-flow/candidates` (Candidates view)
- **Missing:** `/talent-flow/hm-dashboard` (Hiring Manager view)
- **Missing:** `/talent-flow/offers` (Offers entry point)
- **Missing:** `/talent-flow/config/scoring-weights`, `/sla-thresholds`, `/panel-rules` (config sub-routes exist in spec but not in routes file)
- **Wrong:** `/talent-flow/candidates/new` should be removed (drawer replaces it)

---

### 1.10 Shared Components — Missing

#### 🔴 GAP-FE-041 — SignalIntelligenceBoxComponent Missing (D-032, D-051, D-068, D-071)
- Central to the platform's "Golden Truth made visible" principle
- Used in: Candidate Record (all tabs), HM Scoring Panel, Offer Tab (4 states)
- **Action:** Build as shared component under `talent-flow/components/signal-intelligence-box/`

#### 🔴 GAP-FE-042 — CandidateIdentityCard Missing Dashboard Anatomy (D-024)
- **Exists:** Shows name, role, level, experience, email, SLA chip, sentiment chip
- **Missing:** Seniority pill (styled per Decision 024), stage name, stage context, avatar colour coded by urgency (red gradient=breached, amber=at risk, teal/navy=healthy)

#### 🟢 GAP-FE-043 — Naleko Design Tokens Present (D-026)
- `naleko-tokens.css` and `primeng-naleko.scss` exist with all correct tokens ✅
- Webfonts (Manrope, Inter, JetBrains Mono) included ✅
- CSS custom properties follow `var(--naleko-*)` naming ✅
- **Action:** Audit component SCSS files to ensure no hardcoded hex values are used

---

### Frontend Audit Summary

| Gap ID | Area | Decision(s) | Severity | Cross-Layer? |
|--------|------|-------------|----------|--------------|
| FE-001 | Shell navigation paradigm | D-022 | 🔴 | No |
| FE-002 | AI assistant location | D-023 | 🔴 | No |
| FE-003 | Missing nav links | D-022 | 🟡 | No |
| FE-004 | Exact times displayed | D-010, D-021 | 🔴 | No |
| FE-005 | Health state names wrong | D-010 | 🟡 | 🔗 BE |
| FE-006 | Dashboard not signal-first | D-016, D-020 | 🔴 | No |
| FE-007 | Wrong dashboard KPIs | D-020 | 🔴 | 🔗 BE |
| FE-008 | Candidate names in pipeline summary | D-025 | 🔴 | No |
| FE-009 | No urgency-zone candidate cards | D-024 | 🔴 | No |
| FE-010 | No My Actions Today zone | D-020 | 🔴 | 🔗 BE |
| FE-011 | List view missing | D-053 | 🔴 | No |
| FE-012 | Filter bar wrong/incomplete | D-054 | 🔴 | No |
| FE-013 | Results bar missing | D-055 | 🔴 | No |
| FE-014 | Drag-and-drop lock needed | D-053 | 🟡 | No |
| FE-015 | Wrong layout structure | D-027–031 | 🔴 | No |
| FE-016 | Wrong tabs | D-027 | 🔴 | No |
| FE-017 | Signal Intelligence Box missing | D-032 | 🔴 | 🔗 BE |
| FE-018 | Activity Log panel missing | D-035 | 🔴 | 🔗 BE |
| FE-019 | Interview rounds layout missing | D-033 | 🔴 | 🔗 BE |
| FE-020 | Sentiment selector missing | D-034 | 🔴 | 🔗 BE |
| FE-021 | 4-Phase indicator missing | D-030 | 🔴 | No |
| FE-022 | Actions bar missing | D-031 | 🔴 | No |
| FE-023 | Reject Candidate placement wrong | D-028, D-031 | 🔴 | No |
| FE-024 | Add Candidate wrong container | D-036 | 🔴 | No |
| FE-025 | Seniority dropdown vs card selector | D-039 | 🔴 | No |
| FE-026 | Workflow template selector missing | D-040 | 🔴 | 🔗 BE |
| FE-027 | Completeness bar missing | D-038 | 🟡 | No |
| FE-028 | First interview setup missing | D-037 | 🔴 | 🔗 BE |
| FE-029 | Panel member hybrid model missing | D-041 | 🔴 | 🔗 BE |
| FE-030 | Drawer footer not fixed | D-042 | 🟡 | No |
| FE-031 | Candidates view doesn't exist | D-059–063 | 🔴 | No |
| FE-032 | HM dashboard doesn't exist | D-044–051 | 🔴 | 🔗 BE |
| FE-033 | Offer tab doesn't exist | D-064–071 | 🔴 | 🔗 BE |
| FE-034 | HiringStage type wrong | D-006 | 🔴 | 🔗 BE |
| FE-035 | Sentiment values wrong | D-007 | 🔴 | 🔗 BE |
| FE-036 | SLA health values wrong | D-010 | 🟡 | 🔗 BE |
| FE-037 | PositionLevel has DIRECTOR / wrong name | D-019 | 🟡 | 🔗 BE |
| FE-038 | Vote decision values wrong | D-049 | 🔴 | 🔗 BE |
| FE-039 | Missing model interfaces | D-004, D-005, D-012 | 🔴 | 🔗 BE |
| FE-040 | Missing routes | D-022, D-045, D-059 | 🟡 | No |
| FE-041 | SignalIntelligenceBox missing | D-032 | 🔴 | No |
| FE-042 | CandidateIdentityCard incomplete | D-024 | 🟡 | No |
| FE-043 | Naleko tokens present ✅ | D-026 | 🟢 | No |

**Total: 43 frontend gaps | 🔴 33 critical | 🟡 9 gaps | 🟢 1 compliant**
**Cross-layer dependencies flagged: 16 gaps touch backend/infra**

---

## LAYER 2 — BACKEND (AWS Lambda Functions)
### Audit Status: ✅ Complete

**Scope audited:**
- Lambda handlers: `createCandidate`, `getCandidate`, `getCandidates`, `advanceCandidateStage`, `scheduleInterview`, `submitVote`, `completeEvaluation`, `orchestrateTalentFlowWorkflow`, `monitorTalentFlowSLAs`, `manageTalentFlowConfig`, `sendTalentFlowNotification`, `getCandidateEvents`, `talentFlowAiChat`, `talentFlowApproveAction`, `talentFlowAuthorizer`
- Shared layer: `lambda/shared/config-reader.js`
- API Gateway routes: `talent-flow-infra/talent-flow-apigateway.tf` (both gateways)
- EventBridge rules: `talent-flow-infra/talent-flow-eventbridge.tf`
- TF Lambda resources: `talent-flow-infra/talent-flow-lambdas.tf`

---

### 2.1 Missing API Gateway Routes — Showstopper Gaps

#### 🔴 GAP-BE-001 — `advanceCandidateStage` Lambda: No TF Resource, No API Route (D-001, D-014)
- **Decision:** Stage advancement is a core interaction — TA clicks advance buttons in the Pipeline & workspace
- **Reality:** The Lambda code is fully implemented (`lambda/advanceCandidateStage/index.js`) with correct 11-stage STAGE_ORDER and EventBridge publish but:
  1. **No `aws_lambda_function` resource** in `talent-flow-lambdas.tf` — Lambda is not deployed to AWS
  2. **No `aws_apigatewayv2_route`** in `talent-flow-apigateway.tf` — even if deployed, it has no HTTP entry point
- **Files:** `lambda/advanceCandidateStage/index.js`, `talent-flow-infra/talent-flow-lambdas.tf`, `talent-flow-infra/talent-flow-apigateway.tf`
- **Action:** Add `aws_lambda_function.advance_stage` to TF + add `PUT /v1/candidates/{id}/stage` route in API Gateway (note: should also appear in EventBridge as a sub-workflow step)
- **Cross-layer:** 🔗 FE-034 (wrong HiringStage enum), FE-013 (pipeline kanban advance buttons will 404)

#### 🔴 GAP-BE-002 — `getCandidateEvents` Lambda: No TF Resource, No API Route (D-009, D-031)
- **Decision:** Candidate Activity Log (right panel in workspace) is a first-class feature — feeds Timeline tab
- **Reality:** `lambda/getCandidateEvents/index.js` exists with DynamoDB query by `CANDIDATE#{id}` for EVENT# records. But:
  1. **No `aws_lambda_function` resource** in TF — not deployed
  2. **No API Gateway route** — no `GET /v1/candidates/{id}/events`
- **Files:** `lambda/getCandidateEvents/index.js`, `talent-flow-infra/talent-flow-lambdas.tf`
- **Action:** Add TF Lambda resource + `GET /v1/candidates/{id}/events` route
- **Cross-layer:** 🔗 FE-018 (Activity Log panel), FE Timeline tab

#### 🔴 GAP-BE-003 — Missing `PATCH /v1/candidates/{id}/sentiment` Route & Lambda (D-007, D-034)
- **Decision:** D-007 defines candidate sentiment as a first-class HR signal stored on the SAGA record. D-034 specifies the TA updates sentiment directly from the candidate workspace — it is a distinct signal update, not wrapped in SAGA stage advancement
- **Reality:** No Lambda exists for sentiment update. No route defined. No validation of sentiment enum values in any Lambda. The existing `createCandidate` Lambda does not set an initial sentiment value
- **Action:** Create `updateCandidateSentiment` Lambda: validate sentiment ∈ configurable options (default per D-007: Very Interested / Interested / Neutral / Hesitant / Disengaged), `UpdateItem` SAGA, publish `SentimentUpdated` to EventBridge. Add `PATCH /v1/candidates/{id}/sentiment` route
- **Note:** Sentiment options are tenant-configurable (D-008) — Lambda must read `SENTIMENT_CONFIG` from config store, not hardcode values
- **Cross-layer:** 🔗 FE-020 (sentiment selector), FE-035 (wrong frontend enum values)

#### 🔴 GAP-BE-003B — Missing `PUT /v1/candidates/{id}/engagement` Route & Lambda (D-011)
- **Decision:** D-011 defines candidate engagement level as a discrete signal: `RESPONSIVE | SLOW | UNRESPONSIVE`. This is a TA-managed signal distinct from sentiment — it tracks communication responsiveness
- **Reality:** No Lambda exists for engagement update. No route defined. `createCandidate` does not initialise an `engagementLevel` field on the SAGA record
- **Action:** Create `updateCandidateEngagement` Lambda: validate engagementLevel ∈ {RESPONSIVE, SLOW, UNRESPONSIVE}, `UpdateItem` SAGA with `engagementLevel` and `engagementUpdatedAt`, publish `EngagementUpdated` to EventBridge. Add `PUT /v1/candidates/{id}/engagement` route
- **Note:** Unlike sentiment, engagement values are not tenant-configurable per decisions — 3 values are locked
- **Cross-layer:** 🔗 FE Signal Intelligence Box (FE-017), FE-032 (HM dashboard engagement column)

#### 🔴 GAP-BE-004 — Missing `GET /v1/candidates/{id}/votes` Route (D-049)
- **Decision:** Votes tab in candidate workspace shows all panel votes for this candidate
- **Reality:** `submitVote` writes `VOTE#` records to `talent-flow-state`. No endpoint exists to READ them back. `getCandidate` doesn't include votes in its response
- **Action:** Add `GET /v1/candidates/{id}/votes` route → Lambda queries `PK=CANDIDATE#{id} AND begins_with(SK, 'VOTE#')`. Can be added to `getCandidate` response or as a separate Lambda
- **Cross-layer:** 🔗 FE Panel Votes tab

#### 🔴 GAP-BE-005 — Offer Lifecycle: No Lambda, No Routes — EventBridge Rule 7 Is Orphaned (D-056, D-057, D-058)
- **Decision:** Offer lifecycle is MVP1: create draft → approval workflow → deliver to candidate → acceptance/decline
- **Reality:**
  - EventBridge Rule 7 (`OfferApproved → sendTalentFlowNotification`) is wired in TF but nothing ever publishes `OfferApproved`
  - No `createOffer`, `getOffer`, `updateOffer`, `approveOffer`, `deliverOffer` Lambdas exist
  - No offer routes in API Gateway
- **Action:** Create Offer Lambda (single Lambda with method routing is fine): `POST /v1/offers`, `GET /v1/offers/{id}`, `PATCH /v1/offers/{id}/approve`, `PATCH /v1/offers/{id}/deliver`. Write `OFFER#` records to `talent-flow-state`. Publish `OfferApproved` when approval status changes
- **Cross-layer:** 🔗 FE-033 (Offer tab blank), FE-007 (Acceptance Rate KPI impossible)

---

### 2.2 Enum & Data Contract Mismatches

#### 🟡 GAP-BE-006 — STAGE_ORDER in `advanceCandidateStage` Missing `BACKGROUND_CHECK` (D-001)
- **Decision:** 12-stage pipeline — `BACKGROUND_CHECK` sits between `EVALUATION` and `OFFER_PREPARATION`
- **Exists in code:** `advanceCandidateStage` STAGE_ORDER has 11 stages — omits `BACKGROUND_CHECK`
- **Contradicts:** `lambda/shared/config-reader.js` default `STAGE_CONFIG.enabled` array which correctly lists 12 stages including `BACKGROUND_CHECK`
- **Risk:** If a candidate's `currentStage` is set to `BACKGROUND_CHECK` (possible via orchestrator or direct DB write), `advanceCandidateStage` will return 500 "Current stage is not recognised"
- **File:** `lambda/advanceCandidateStage/index.js` line 37
- **Action:** Add `BACKGROUND_CHECK` between `EVALUATION` and `OFFER_PREPARATION` in STAGE_ORDER

#### 🟡 GAP-BE-007 — `DIRECTOR` Accepted as Valid positionLevel in MVP1 (D-019)
- **Decision:** D-019 locks positionLevel to JUNIOR | MID | SENIOR for MVP1. DIRECTOR is MVP2 scope
- **Exists:** Both `createCandidate` and `scheduleInterview` include `DIRECTOR` in `VALID_POSITION_LEVELS`
- **Risk:** `DIRECTOR` candidates will be created and proceed through the workflow; votesRequired for DIRECTOR is set to 5 in PANEL_CONFIG defaults — this is MVP2 business logic entering the system early
- **Files:** `lambda/createCandidate/index.js` line 35, `lambda/scheduleInterview/index.js` line 32
- **Action:** Remove `'DIRECTOR'` from both VALID_POSITION_LEVELS arrays. Add a TODO comment noting this is re-enabled in MVP2

#### 🟡 GAP-BE-008 — `submitVote` Accepts `NEUTRAL` Rating — Not in Locked Decisions (D-049)
- **Decision:** Valid vote ratings are `STRONG_YES | YES | NO | STRONG_NO` (4 values)
- **Exists:** `VALID_RATINGS = ['STRONG_NO', 'NO', 'NEUTRAL', 'YES', 'STRONG_YES']` — 5 values, includes `NEUTRAL`
- **Impact:** NEUTRAL votes are stored in DynamoDB, included in weighted score averages. NEUTRAL is undefined in the scoring model — its value is ambiguous. The frontend model was also wrong (different issue) but NEUTRAL in the backend is a data integrity problem
- **File:** `lambda/submitVote/index.js` line 58
- **Action:** Remove `'NEUTRAL'` from VALID_RATINGS. Existing NEUTRAL votes in DB should be migrated to `NO` or flagged for review

---

### 2.3 SLA Monitoring Gaps

#### 🔴 GAP-BE-009 — SLA Monitor Writes `slaBreachedAt` But Never Writes `slaStatus` Field (D-010, D-021)
- **Decision:** D-010/021 require `slaStatus: ON_TRACK | AT_RISK | BREACHED` to be stored on SAGA records. This is the field `getCandidates` filters on and the frontend reads
- **Exists:** `monitorTalentFlowSLAs` only writes `slaBreachedAt` and `slaBreachedStage` on breach. No `slaStatus` field is ever written. No AT_RISK logic exists
- **Impact:**
  1. `getCandidates?slaStatus=BREACHED` always returns zero results (no records have this field)
  2. Frontend Pipeline filter "Breached/At Risk/On Track" has no data to filter against
  3. Dashboard SLA Breaches KPI will always show zero
- **File:** `lambda/monitorTalentFlowSLAs/index.js` lines 71–85
- **Action:**
  - On breach: write `slaStatus = 'BREACHED'` (in addition to existing `slaBreachedAt`)
  - On AT_RISK detection (e.g. `hoursElapsed >= thresholdHours * 0.8`): write `slaStatus = 'AT_RISK'`
  - On stage advancement in `advanceCandidateStage`: reset `slaStatus = 'ON_TRACK'`, clear `slaBreachedAt`
  - Default SAGA value in `createCandidate`: set `slaStatus = 'ON_TRACK'` at creation time

#### 🟡 GAP-BE-010 — SLA Monitor Uses Full Table Scan (Performance / Cost Risk) (D-008)
- **Decision:** D-008 mandates GSI-based access patterns only — no table scans in production
- **Exists:** `monitorTalentFlowSLAs` uses `ScanCommand` with FilterExpression. As `talent-flow-state` grows (every candidate creates multiple records), this scan will read all records including INTERVIEW#, VOTE#, EVENT# items
- **File:** `lambda/monitorTalentFlowSLAs/index.js` `scanOpenSagas()` function
- **Action:** Replace scan with GSI1 query — `GSI1PK = TENANT#DEFAULT AND begins_with(GSI1SK, 'SAGA#')` — same pattern used by `getCandidates`
- **Note:** Requires `createCandidate` to also set `GSI1PK` and `GSI1SK` on the SAGA record (it already does — confirmed in code)

---

### 2.4 Config Management Gaps

#### 🟡 GAP-BE-011 — `PUT /v1/config/{id}` Route Key Mismatch (D-068)
- **Decision:** Config versioning API must be consistent and documented
- **Reality:** TF defines route key `PUT /v1/config/{id}` but `manageTalentFlowConfig` PUT handler reads from body (`tenantId`, `configType`, `data`) and never reads `event.pathParameters.id`. The `{id}` parameter is dead
- **Files:** `talent-flow-infra/talent-flow-apigateway.tf` line 170, `lambda/manageTalentFlowConfig/index.js` `handlePut()` function
- **Action:** Fix route key to `PUT /v1/config` (no path param) or update Lambda to read `configType` from path. Prefer fixing Terraform route to match Lambda contract (body-driven = `PUT /v1/config`)

#### 🟡 GAP-BE-012 — SLA_THRESHOLDS Defaults Missing 4 Stages (D-001, D-013)
- **Decision:** SLA thresholds must cover all 12 active stages
- **Exists in `config-reader.js` defaults:** Only 8 stages have thresholds: APPLICATION_REVIEW, PHONE_SCREENING, TECHNICAL_INTERVIEW, PANEL_INTERVIEW, EVALUATION, OFFER_PREPARATION, OFFER_APPROVAL, OFFER_DELIVERY
- **Missing:** `BACKGROUND_CHECK`, `CONTRACT_SIGNING`, `PRE_BOARDING`, `ONBOARDING` — no default thresholds
- **Impact:** `monitorTalentFlowSLAs` will log `sla_no_threshold` warning and skip these stages. Candidates stuck in CONTRACT_SIGNING will never breach SLA
- **File:** `lambda/shared/config-reader.js` `getDefaults()` function
- **Action:** Add reasonable default thresholds for the 4 missing stages (e.g. BACKGROUND_CHECK: 72h, CONTRACT_SIGNING: 48h, PRE_BOARDING: 168h, ONBOARDING: 720h). Flag as provisional — TA admin must configure proper values in DynamoDB

---

### 2.5 Missing Domain Features

#### 🔴 GAP-BE-013 — No `hiringManagerId` Field on SAGA + No HM Dashboard Endpoint (D-045, D-055)
- **Decision:** D-045 HM Dashboard is a first-class MVP1 screen. HMs see only their own open roles. This requires candidates to be queryable by hiringManagerId
- **Reality:**
  - `createCandidate` does not accept or store `hiringManagerId` in the SAGA record
  - `talent-flow-state` DynamoDB has GSI2 provisioned (good) but it is unused — no Lambda assigns GSI2 keys
  - No `getHMDashboard` Lambda exists
  - No `GET /v1/hm/dashboard` or `GET /v1/hm/candidates` route in API Gateway
- **Files:** `lambda/createCandidate/index.js` line 155 (SAGA record construction), `talent-flow-infra/talent-flow-dynamodb.tf` (GSI2 exists but unused)
- **Action:**
  1. Add optional `hiringManagerId` field to `createCandidate` body and SAGA record
  2. Set `GSI2PK = HM#{hiringManagerId}`, `GSI2SK = SAGA#{createdAt}` on SAGA write
  3. Create `getHMDashboard` Lambda — queries GSI2 by `HM#{sub}` where `sub` comes from JWT claims
  4. Add `GET /v1/hm/dashboard` route to API Gateway

#### 🔴 GAP-BE-014 — No Scoring Link Generator Lambda (D-036)
- **Decision:** When a panel member is added, an anonymous scoring link is generated and stored as a `SCORING_LINK#` DynamoDB record. Panel members can score via this link without Cognito auth
- **Reality:** No Lambda exists to generate scoring links. `scheduleInterview` stores `panelMemberIds` array but never creates scoring link records
- **Action:** Create `generateScoringLink` Lambda: generate UUID token, write `PK=CANDIDATE#{id} SK=SCORING_LINK#{token} { voterId, expiresAt, status: PENDING }`. Add `POST /v1/candidates/{id}/scoring-links` route. Must set `expiresAt` TTL on the record

---

### 2.6 Compliant Implementations ✅

| Lambda / Component | Decision | Status | Notes |
|---|---|---|---|
| `createCandidate` — idempotency (9-step flow) | D-003 | 🟢 | Race-safe conditional PutItem, 48h TTL, IN_PROGRESS guard |
| `orchestrateTalentFlowWorkflow` — configVersion lock | D-003, D-006 | 🟢 | Conditional UpdateItem with `attribute_not_exists(configVersion)` — idempotent for EB retries |
| `submitVote` — versioned config reads | D-007 | 🟢 | Uses candidate's `configVersion` for SCORING_WEIGHTS + PANEL_CONFIG — POPIA compliance invariant #2 |
| `scheduleInterview` — active config read | D-007 | 🟢 | Uses ACTIVE (no version arg) for PANEL_CONFIG per Invariant #3 |
| `monitorTalentFlowSLAs` — active SLA read | D-007 | 🟢 | Active read confirmed: `getConfig('DEFAULT', 'SLA_THRESHOLDS')` — no version |
| `manageTalentFlowConfig` — versioning + TTL | D-068 | 🟢 | Version N+1 write, deactivates version N with 365d `expiresAt` TTL. Admin guard with multi-format Cognito groups parsing |
| `config-reader.js` — caching + safe defaults | D-067 | 🟢 | 5-min container cache, never caches errors, safe defaults with console.warn |
| `submitVote` — STRONG_NO veto | D-049 | 🟢 | Runs before scoring, updates SAGA with STRONG_NO_VETO + EVALUATION_FAILED, publishes VotingCompleted |
| `talent-flow-bus` EventBridge bus | D-009 | 🟢 | Custom bus, never default, 7 routing rules wired |
| `getCandidate` — normalise `id` field | D-024 | 🟢 | `if (!candidate.id && candidate.candidateId) candidate.id = candidate.candidateId` |
| `getCandidates` — GSI1 query, paginated | D-008 | 🟢 | No scan — uses `GSI1PK = TENANT#{id}` with cursor-based `nextToken` |
| `talent-flow-state` DynamoDB — PITR, KMS, streams | D-008 | 🟢 | PITR enabled, CMK `talent_flow_state`, stream `NEW_AND_OLD_IMAGES` |

---

### Backend Audit Summary

| Gap ID | Description | Decision | Severity | Cross-layer |
|--------|-------------|----------|----------|-------------|
| BE-001 | `advanceCandidateStage` not deployed, no route | D-001, D-014 | 🔴 | 🔗 FE |
| BE-002 | `getCandidateEvents` not deployed, no route | D-009, D-031 | 🔴 | 🔗 FE |
| BE-003 | Missing sentiment update endpoint + Lambda | D-007, D-034 | 🔴 | 🔗 FE |
| BE-003B | Missing engagement update endpoint + Lambda | D-011 | 🔴 | 🔗 FE |
| BE-004 | Missing GET votes endpoint | D-049 | 🔴 | 🔗 FE |
| BE-005 | Offer lifecycle completely absent | D-012, D-013, D-064–071 | 🔴 | 🔗 FE, Infra |
| BE-006 | STAGE_ORDER missing BACKGROUND_CHECK | D-001 | 🟡 | 🔗 FE |
| BE-007 | DIRECTOR accepted in MVP1 | D-019 | 🟡 | 🔗 FE |
| BE-008 | NEUTRAL vote rating not in decisions | D-049 | 🟡 | 🔗 FE |
| BE-009 | SLA monitor never writes `slaStatus` field | D-010, D-021 | 🔴 | 🔗 FE, Infra |
| BE-010 | SLA monitor uses full table scan | D-008 | 🟡 | No |
| BE-011 | PUT /v1/config/{id} route/Lambda mismatch | D-068 | 🟡 | No |
| BE-012 | SLA_THRESHOLDS defaults missing 4 stages | D-001, D-013 | 🟡 | 🔗 FE |
| BE-013 | No hiringManagerId on SAGA, no HM dashboard | D-045, D-055 | 🔴 | 🔗 FE, Infra |
| BE-014 | No scoring link generator | D-036 | 🔴 | 🔗 FE |

**Total: 15 backend gaps | 🔴 9 critical | 🟡 6 gaps**
**6 compliant implementations confirmed**

---

## LAYER 2B — CONFIG METADATA GAPS (From Decisions — Not In Codebase)

The following config types are required by locked decisions but do not exist in the codebase. All must be seeded as DynamoDB records in `talent-flow-config` and readable via `manageTalentFlowConfig` GET + `config-reader.js`. They are distinct from the backend Lambda code gaps above — this is the data plane that the code would read.

| Config Type | Required By | What It Stores | Codebase Status |
|-------------|-------------|----------------|-----------------|
| `SENTIMENT_CONFIG` | D-007, D-008, D-034 | Tenant-configurable sentiment options array (label / value / colour per option), which values are risk-trigger signals, default labels per D-007 | ❌ Missing |
| `INTERVIEW_TYPES` | D-006, D-008 | Tenant-configurable list of interview type labels (Phone Screen, Technical, Behavioural, Culture Fit, Final, custom) — used to populate scheduleInterview and the Add Candidate first interview selector | ❌ Missing |
| `REJECTION_CONFIG` | D-018, D-019 | Per-seniority rejection governance: who can trigger reject, vote threshold for rejection recommendation, rejection reason required (Y/N), reason category list, second confirmation required flag | ❌ Missing |
| `APPROVAL_CHAIN_CONFIG` | D-019, D-068 | Per-seniority offer approval chain steps: step order, approver role, SLA window per step (Junior: TA+HM, Senior: TA+HM+Finance+HRDir) — drives offer approval workflow | ❌ Missing |
| `OFFER_CONFIG` | D-067, D-019 | Per-seniority offer expiry window (default 5 business days), response SLA, counter-offer handling behaviour flag | ❌ Missing |
| `RISK_SIGNAL_THRESHOLDS` | D-010 | The 50/75/100 percentage thresholds that map to AT_RISK/NUDGE/BREACHED. D-010 states: *"Thresholds are the default and are configurable"* — must be stored as config, not hardcoded | ❌ Missing |
| Extend `SLA_THRESHOLDS` | D-001, D-019 | Add 4 missing stages: BACKGROUND_CHECK (suggest 72h), CONTRACT_SIGNING (48h), PRE_BOARDING (168h), ONBOARDING (720h). Add seniority dimension per D-019 (Senior roles have wider SLA windows) | 🟡 Partial |
| Extend `PANEL_CONFIG` | D-018, D-049 | Add per-seniority rejection vote threshold (currently only has `votesRequired` and `strongNoVeto` globally). Senior rejections require broader consensus per D-019 | 🟡 Partial |

**Note on seeding:** All new config types must be seeded in the Terraform `null_resource` bootstrap scripts (or a migration Lambda) before any backend Lambda can read them. The `config-reader.js` safe-defaults approach means missing configs degrade to hardcoded defaults — this is acceptable for development but must be closed before UAT.

---

## LAYER 2C — ARCHITECTURE VALIDATION

Result: **Architecture is confirmed solid. No structural changes needed.** All 10 architectural principles from the decisions have been individually verified against Lambda code, TF resources, and DynamoDB schema.

| Principle | Decision | Validation Result | Evidence |
|-----------|----------|-------------------|----------|
| Event-driven — no Lambda-to-Lambda | D-003, D-009 | ✅ Confirmed | `createCandidate` → EventBridge only; `config-reader.js` is in-process, not a remote call |
| Metadata-lite — config separate from SAGA | D-008, D-067 | ✅ Confirmed | `talent-flow-config` is a separate table; SAGA holds only `configVersion` pointer |
| Config-versioned — POPIA invariant enforced | D-007, D-068 | ✅ Confirmed | `submitVote` reads at `candidateConfigVersion`; `scheduleInterview` reads active |
| Tenant-aware — all data isolated by tenant | D-001, D-002 | ✅ Confirmed | `TENANT#` PK prefix on all tables; all Lambdas extract `tenantId` from body/JWT |
| Agentic-ready — AI can subscribe and act | D-015, D-016 | ✅ Confirmed | Dual API Gateway (HTTP v2 for FE, REST v1 for agents); `approveAgentAction` Lambda; `talent-flow-agent-audit` table |
| SAGA orchestration — forward-only, compensatable | D-003, D-014 | ✅ Confirmed | `orchestrateTalentFlowWorkflow` writes SAGA; `advanceCandidateStage` validates index-based forward progression; STRONG_NO_VETO compensation path exists |
| Dual-ledger — operational + audit trail separated | D-015 | ✅ Confirmed | `talent-flow-state` (operational) + `talent-flow-agent-audit` (AI audit immutable) — separate tables, separate streams |
| Feedback loop — SLA monitor → notify | D-010, D-021 | ✅ Confirmed | `monitorTalentFlowSLAs` → publishes `SLABreached` → EB Rule routes to `sendTalentFlowNotification` |
| Forward-only SAGA — no backward stage movement | D-014 | ✅ Confirmed | `advanceCandidateStage` uses `indexOf()` comparison — rejects same or lower index |
| Single responsibility — each Lambda one job | D-003 | ✅ Confirmed | No Lambda does more than its named function; config-reader is shared utility only |

**Architecture verdict:** The bones are right. All gaps identified in Layers 2 and 2B are business rule corrections and data plane additions — not structural changes.

---

## LAYER 3 — INFRASTRUCTURE (Terraform)
### Audit Status: ✅ Complete

**Scope audited:**
- `talent-flow-infra/talent-flow-dynamodb.tf` — 7 tables
- `talent-flow-infra/talent-flow-lambdas.tf` — 15 Lambda resources + 2 ESMs
- `talent-flow-infra/talent-flow-apigateway.tf` — HTTP API v2 (frontend) + REST API v1 (agents)
- `talent-flow-infra/talent-flow-eventbridge.tf` — 8 routing rules
- `talent-flow-infra/talent-flow-cognito.tf` — User Pool, App Client, 7 groups, Pre-Token Lambda
- `talent-flow-infra/talent-flow-iam.tf` — 15 per-Lambda IAM roles
- `talent-flow-infra/talent-flow-kms.tf` — 2 CMKs
- `talent-flow-infra/talent-flow-sqs.tf` — 2 FIFO queue pairs (4 queues total)
- `talent-flow-infra/talent-flow-stepfunctions.tf` — 1 STANDARD state machine
- `talent-flow-infra/locals.tf` — resource name constants, Cognito groups

---

### 3.1 Missing Lambda TF Resources & IAM Roles — Showstopper Gaps

#### 🔴 GAP-INF-001 — 7 Lambda Functions Have No TF Resource and No IAM Role

The following Lambdas exist as code (or are needed per decisions) but have zero Terraform presence — not in `talent-flow-lambdas.tf`, not in `talent-flow-iam.tf`, and not in `talent-flow-apigateway.tf`. Every one of these is a showstopper for its corresponding feature.

| Lambda | Decision | Code Exists? | TF Resource | IAM Role | API Route |
|--------|----------|-------------|-------------|----------|-----------|
| `advanceCandidateStage` | D-001, D-014 | ✅ Yes | ❌ Missing | ❌ Missing | ❌ Missing |
| `getCandidateEvents` | D-009, D-031 | ✅ Yes | ❌ Missing | ❌ Missing | ❌ Missing |
| `updateCandidateSentiment` | D-007, D-034 | ❌ Must build | ❌ Missing | ❌ Missing | ❌ Missing |
| `updateCandidateEngagement` | D-011 | ❌ Must build | ❌ Missing | ❌ Missing | ❌ Missing |
| `offerLifecycle` (create/approve/deliver) | D-012, D-013, D-064–071 | ❌ Must build | ❌ Missing | ❌ Missing | ❌ Missing |
| `generateScoringLink` | D-004, D-005, D-041 | ❌ Must build | ❌ Missing | ❌ Missing | ❌ Missing |
| `getHMDashboard` | D-044–051 | ❌ Must build | ❌ Missing | ❌ Missing | ❌ Missing |

**Action:** For each Lambda: add `aws_lambda_function`, `aws_iam_role`, `aws_iam_role_policy` (least-privilege per existing pattern), `aws_apigatewayv2_integration`, `aws_apigatewayv2_route`, and `aws_lambda_permission` for API Gateway invoke.

---

### 3.2 API Gateway Gaps

#### 🔴 GAP-INF-002 — 10 API Routes Missing from HTTP API v2 (D-001, D-044, D-049)

**Currently deployed (HTTP API v2):** `POST /v1/candidates`, `GET /v1/candidates`, `GET /v1/candidates/{id}`, `POST /v1/candidates/{id}/interviews`, `POST /v1/candidates/{id}/votes`, `GET /v1/config`, `POST /v1/config`, `PUT /v1/config/{id}` — **8 routes total.**

**Missing routes that block MVP1 features:**

| Route | Lambda Target | Decision | Status |
|-------|--------------|----------|--------|
| `PUT /v1/candidates/{id}/stage` | `advanceCandidateStage` | D-001, D-014 | ❌ Missing |
| `GET /v1/candidates/{id}/events` | `getCandidateEvents` | D-009, D-031 | ❌ Missing |
| `PATCH /v1/candidates/{id}/sentiment` | `updateCandidateSentiment` | D-007, D-034 | ❌ Missing |
| `PUT /v1/candidates/{id}/engagement` | `updateCandidateEngagement` | D-011 | ❌ Missing |
| `GET /v1/candidates/{id}/votes` | `getCandidateVotes` (new or inline) | D-049 | ❌ Missing |
| `POST /v1/offers` | `offerLifecycle` | D-012, D-064 | ❌ Missing |
| `GET /v1/offers/{id}` | `offerLifecycle` | D-012 | ❌ Missing |
| `PATCH /v1/offers/{id}/approve` | `offerLifecycle` | D-068 | ❌ Missing |
| `PATCH /v1/offers/{id}/deliver` | `offerLifecycle` | D-013 | ❌ Missing |
| `GET /v1/hm/dashboard` | `getHMDashboard` | D-044–051 | ❌ Missing |

**Note:** `POST /v1/candidates/{id}/scoring-links` (D-041) is also needed but can be added simultaneously with `generateScoringLink` Lambda.

#### 🟡 GAP-INF-003 — CORS `allow_methods` Missing `PATCH` (D-007, D-034)

- **Decision:** Sentiment update uses `PATCH /v1/candidates/{id}/sentiment`
- **Reality:** `talent-flow-apigateway.tf` CORS configuration declares: `allow_methods = ["GET", "OPTIONS", "POST", "PUT"]` — `PATCH` is absent
- **Impact:** Browser preflight for `PATCH` requests will return a CORS 403 regardless of whether the Lambda and route are deployed. Sentiment updates will fail from the Angular frontend silently
- **File:** `talent-flow-infra/talent-flow-apigateway.tf` line ~40
- **Action:** Add `"PATCH"` to `allow_methods` list and `"DELETE"` while there (good to have for offer cancellation)

#### 🟡 GAP-INF-004 — Cognito App Client `callback_urls` Missing Vercel Prod URL

- **Reality:** `callback_urls` in `talent-flow-cognito.tf` only includes `http://localhost:4200/auth/callback`. The API Gateway CORS `allow_origins` correctly includes `https://hr-portal-beryl-three.vercel.app` but Cognito will refuse the auth redirect on prod
- **Impact:** Auth flow fails entirely when accessed from the Vercel prod deployment. Only localhost works
- **File:** `talent-flow-infra/talent-flow-cognito.tf` App Client block
- **Action:** Add `https://hr-portal-beryl-three.vercel.app/auth/callback` to `callback_urls` and `https://hr-portal-beryl-three.vercel.app/auth/logout` to `logout_urls`

---

### 3.3 EventBridge Gaps

#### 🔴 GAP-INF-005 — 3 Event Types Routed Nowhere: `StageAdvanced`, `SentimentUpdated`, `EngagementUpdated` (D-009)

- **Decision:** D-009 mandates all inter-Lambda communication via `talent-flow-bus`. All published events must have a routing rule or they silently drop
- **Reality:**
  - `advanceCandidateStage` (once deployed) publishes `StageAdvanced` — **no EB rule routes this event**
  - `updateCandidateSentiment` (once built) publishes `SentimentUpdated` — **no EB rule**
  - `updateCandidateEngagement` (once built) publishes `EngagementUpdated` — **no EB rule**
- **Impact:** Events fire and vanish. The SLA monitor won't reset `slaStatus = ON_TRACK` on advancement (unless that logic moves into the Lambda itself). No downstream notification on sentiment/engagement change
- **Action:**
  - Add EB rule: `StageAdvanced → monitorTalentFlowSLAs` (to trigger slaStatus reset) AND optionally `→ sendNotification` for HM notification
  - Decide: `SentimentUpdated` and `EngagementUpdated` — route to `sendNotification` or log only. At minimum, add rules to prevent silent drops

#### 🔴 GAP-INF-006 — Step Functions `talent-flow-offer-approval` Is Unreachable (D-068)

- **Decision:** D-068 defines the offer approval chain as a Step Functions workflow
- **Reality:** The `talent-flow-offer-approval` state machine is correctly declared (STANDARD type, WaitForTaskToken, correct Lambda targets). However, nothing will ever start an execution — the `offerLifecycle` Lambda that would call `StartExecution` does not exist (INF-001 gap cascades here)
- **Impact:** The Step Functions state machine is infrastructure that sits deployed but completely unreachable. EventBridge Rule 7 (`OfferApproved → sendNotification`) is also orphaned for the same reason
- **Action:** This gap is resolved when `offerLifecycle` Lambda is built (INF-001). The state machine itself needs no changes — it is correctly designed

#### 🟡 GAP-INF-007 — `talent-flow-feedback-queue.fifo` Has No Consumer Lambda (MVP2 scoped)

- **Reality:** The feedback FIFO queue exists in TF with correct DLQ wiring. But there is no ESM and no consumer Lambda. Comment in `talent-flow-sqs.tf` correctly states: *"Consumer: future feedback processing Lambda (MVP2)"*
- **Severity:** 🟡 — by design for MVP1. Flagged here for visibility, not as a blocking gap. Messages published to this queue will not be consumed and will expire after 4 days
- **Action:** No immediate action needed. Ensure `talentFlowAiChat` does NOT publish to this queue in MVP1 code path

---

### 3.4 DynamoDB Schema Gaps

#### 🟡 GAP-INF-008 — GSI2 on `talent-flow-state` Is Provisioned but Unused (D-044)

- **Decision:** D-044/BE-013 requires querying candidates by `hiringManagerId` for the HM Dashboard
- **Reality:** `GSI2` (hash: `GSI2PK`, range: `GSI2SK`) is correctly provisioned on `talent-flow-state`. However, `createCandidate` never writes `GSI2PK` or `GSI2SK` on SAGA records. GSI2 is an empty index consuming no reads but providing no value
- **Impact:** `getHMDashboard` Lambda (once written) cannot query GSI2 because no records have GSI2 keys
- **Action:** Update `createCandidate` to write `GSI2PK = "HM#${hiringManagerId}"` and `GSI2SK = "SAGA#${createdAt}"` when `hiringManagerId` is provided in the request body. This is a Lambda code fix that unblocks the infra capability already provisioned

#### 🟡 GAP-INF-009 — No `talent-flow-scoring-links` Table (D-004, D-005, D-041)

- **Decision:** Scoring links for ad-hoc panel members are anonymous (no Cognito auth) and stored as `SCORING_LINK#` records with UUID token, expiry TTL, and status
- **Reality:** `generateScoringLink` stores these in `talent-flow-state` table as `PK=CANDIDATE#{id} SK=SCORING_LINK#{token}`. This is acceptable for MVP1 (single-table approach). **No separate table is required** — using `talent-flow-state` is the correct choice
- **Severity:** 🟢 — **Not a gap.** Single-table design for scoring links is compliant. Flagged here to document the decision explicitly
- **Action:** None for table. Ensure `generateScoringLink` Lambda IAM role has write access to `talent-flow-state` table (not config)

---

### 3.5 IAM & Security Gaps

#### 🟡 GAP-INF-010 — `monitor_slas` IAM Policy Grants `dynamodb:Scan` (D-008)

- **Decision:** D-008 mandates GSI-based access patterns; no table scans in production
- **Reality:** `monitor_slas` IAM policy `StateTableScan` Sid grants both `dynamodb:Query` AND `dynamodb:Scan` on `talent-flow-state` and its indexes. This was presumably added intentionally to support the current scan-based Lambda code
- **Impact:** Over-permissive IAM role enables full-table scans. When BE-010 (scan → GSI query) is fixed, the `dynamodb:Scan` permission should be revoked
- **Action:** After fixing BE-010 Lambda code, remove `dynamodb:Scan` from this policy. Leave `dynamodb:Query` + index access only

#### 🟡 GAP-INF-011 — No Cognito `TalentAcquisition` Group — TA Role Bundled Into `TalentFlowAdmin` (D-002)

- **Decision:** D-002 defines 7 distinct internal roles. The Talent Acquisition role is the primary user of the pipeline and candidate workspace
- **Reality:** Cognito groups in `locals.tf` are: TalentFlowAdmin, HiringManager, PanelMember, ComplianceOfficer, ITAdmin, FinanceLead, HRDirector. There is no `TalentAcquisition` group. The comment says "TalentFlowAdmin: full access + config management" — this bundles the TA primary role with admin config access
- **Impact:** Frontend route guards cannot distinguish a TA user (manages pipeline, workspace access) from a TalentFlowAdmin (manages config, system settings). Both get `isAdmin = true` from the pre-token Lambda. A TA who is not an admin should not see config management UI
- **Action:** Add `TalentAcquisition` group with pipeline access but no config management. `TalentFlowAdmin` becomes a super-admin only. Update `pre_token_trigger` Lambda to inject `isAdmin = true` only for `TalentFlowAdmin`, and a new `isTalentAcquisition = true` claim for the TA group

---

### 3.6 Compliant Infrastructure ✅

| Resource | Decision | Status | Notes |
|----------|----------|--------|-------|
| 7 DynamoDB tables, all with PITR + KMS + TTL | D-008 | 🟢 | PAY_PER_REQUEST, encrypted, PITR all correct |
| `talent-flow-state` stream `NEW_AND_OLD_IMAGES` | D-009, D-015 | 🟢 | Feeds archive Lambda via ESM |
| 2 CMKs (`talent_flow_state` + `talent_flow_agent_audit`) | D-015 | 🟢 | Correct split: operational vs audit data |
| 15 per-Lambda IAM roles (least-privilege each) | D-003 | 🟢 | Follows Naleko `tf_iam_role_prefix` pattern |
| SQS FIFO + DLQ, `content_based_deduplication`, `maxReceiveCount = 5` | D-009 | 🟢 | ESM `ReportBatchItemFailures` ✅ |
| Step Functions STANDARD type (not EXPRESS) | D-068 | 🟢 | Correctly chosen — WaitForTaskToken can run days |
| EventBridge 8 rules (7 workflow + 1 hourly cron) | D-009 | 🟢 | Custom bus only, never default bus |
| HTTP API v2 Cognito JWT authorizer | D-002 | 🟢 | PKCE + code grant, correct token validity |
| REST API v1 TOKEN Lambda authorizer for agent API | D-015, D-016 | 🟢 | Correct — TOKEN type needs REST v1 |
| All Lambdas: `arm64`, `nodejs22.x`, `JSON` logging, `X-Ray Active` | D-003 | 🟢 | Uniform runtime pattern |
| Cognito `admin_create_user_config.allow_admin_create_user_only = true` | D-002 | 🟢 | Staff-only auth, no self-registration |
| `isAdmin` injected via Pre-Token Lambda (not stored in token directly) | D-002 | 🟢 | Custom claim pattern matches decisions |
| `talent-flow-feedback-queue.fifo` scoped to MVP2 in comments | D-008 | 🟢 | Correct deferral, not a gap |
| S3 audit archive bucket for agent-audit stream | D-015 | 🟢 | `archive_audit_log_stream` ESM with DLQ |
| GitHub OIDC provider (`talent-flow-github-oidc.tf`) | D-003 | 🟢 | CI/CD deploy pattern, no long-lived keys |

---

### Infrastructure Audit Summary

| Gap ID | Description | Decision | Severity | Cross-layer |
|--------|-------------|----------|----------|-------------|
| INF-001 | 7 Lambda functions not in TF + no IAM roles | D-001, D-007, D-011, D-013, D-044, D-064 | 🔴 | 🔗 BE, FE |
| INF-002 | 10 API routes missing from HTTP API v2 | D-001, D-044, D-049 | 🔴 | 🔗 BE, FE |
| INF-003 | CORS `allow_methods` missing `PATCH` | D-007, D-034 | 🟡 | 🔗 FE |
| INF-004 | Cognito callback_urls missing Vercel prod URL | D-002 | 🟡 | 🔗 FE |
| INF-005 | 3 EB event types have no routing rules | D-009 | 🔴 | 🔗 BE |
| INF-006 | Step Functions offer approval unreachable (cascades from INF-001) | D-068 | 🔴 | 🔗 BE |
| INF-007 | Feedback queue has no consumer (MVP2 deferred — by design) | — | 🟡 | No |
| INF-008 | GSI2 provisioned but never written to | D-044 | 🟡 | 🔗 BE |
| INF-009 | Scoring links use talent-flow-state — confirmed correct ✅ | D-041 | 🟢 | No |
| INF-010 | `monitor_slas` IAM grants `dynamodb:Scan` (should be Query only) | D-008 | 🟡 | 🔗 BE |
| INF-011 | No `TalentAcquisition` Cognito group — TA bundled into TalentFlowAdmin | D-002 | 🟡 | 🔗 FE |

**Total: 10 infra gaps | 🔴 4 critical | 🟡 5 gaps | 🟢 1 compliant note**
**14 compliant implementations confirmed**

---

## CROSS-LAYER DEPENDENCY MAP
*Updated after Backend audit completion.*

| FE Gap | Requires | Backend Gap | Notes |
|--------|----------|-------------|-------|
| FE-007 (Dashboard KPIs — Acceptance Rate) | Offer acceptance data | BE-005 (offer lifecycle missing) | No offer table, no acceptance tracking possible |
| FE-010 (My Actions Today) | Action queue data | `talent-flow-pending-actions` table (DynamoDB) | Infra table exists; Lambda write path TBD |
| FE-013 (Pipeline advance buttons) | Stage advance API | BE-001 (advanceCandidateStage undeployed) | Lambda code good, TF + route missing |
| FE-018 (Activity Log / Timeline) | Events endpoint | BE-002 (getCandidateEvents undeployed) | Lambda code good, TF + route missing |
| FE-020 (Sentiment selector) | Sentiment update API | BE-003 (Lambda + route missing entirely — D-007, D-034) | Must build from scratch |
| FE-017 (Signal Intelligence Box) | Engagement level field on SAGA | BE-003B (engagement Lambda + route missing — D-011) | Must build from scratch |
| FE-026 (Workflow template selector) | Template config data | `manageTalentFlowConfig` GET — exists ✅ | TF route `GET /v1/config` wired |
| FE-029 (Panel member hybrid) | Scoring link generation | BE-014 (generateScoringLink missing) | Must build |
| FE-032 (HM Dashboard) | HM data endpoint | BE-013 (no HM endpoint, no hiringManagerId on SAGA) | Must build GSI2 + Lambda |
| FE-033 (Offer tab) | Offer CRUD endpoints | BE-005 (entire offer lifecycle missing) | Must build |
| FE-034 (HiringStage enum) | Backend stage values | BE-006 (BACKGROUND_CHECK missing from STAGE_ORDER) | Fix both FE model and BE STAGE_ORDER |
| FE-035 (Sentiment enum) | Backend validation | BE-003 (no validation exists) | Fix both FE model and create BE Lambda |
| FE-036 (SLA health values ON_TRACK/AT_RISK/BREACHED) | slaStatus field on SAGA | BE-009 (slaStatus never written) | Fix BE monitor + FE enum simultaneously |
| FE-037 (DIRECTOR not MVP1) | Validated positionLevel | BE-007 (DIRECTOR in VALID_POSITION_LEVELS) | Remove from both FE and BE |
| FE-038 (Vote decision enum) | Backend vote validation | BE-008 (NEUTRAL included, 5 values) | Remove NEUTRAL from both FE model and BE validator |
| FE-039 (Missing model interfaces) | DynamoDB schema | BE-005 (Offer, ApprovalStep), BE-003 (SentimentEntry) | Build BE first, then model FE types from real schema |
| FE-040 (Missing routes) | API routes | BE-001 (advance stage), BE-002 (events), BE-003 (sentiment), BE-004 (votes), BE-005 (offers) | 5 missing routes, all confirmed missing from infra too (INF-002) |
| FE-032 (HM Dashboard) | GSI2 data + HM endpoint | INF-008 (GSI2 provisioned but never written), BE-013 (no HM Lambda) | Fix createCandidate to write GSI2 keys, then build Lambda + route |
| All PATCH requests | CORS allow_methods | INF-003 (PATCH missing from CORS) | Even once sentiment Lambda is deployed, browser will CORS-fail without this fix |
| Vercel prod auth | Cognito callback_urls | INF-004 (Vercel URL not in callback_urls) | Auth flow works on localhost only until fixed |

---

*Document owner: TalentFlow Engineering*
*Last updated: 20 May 2026 — Frontend audit ✅ + Backend audit ✅ + Config metadata gaps ✅ + Architecture validation ✅ + Infrastructure audit ✅*
*Audit complete across all 3 layers. Next: implementation sprint planning*
