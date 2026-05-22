# Talent Flow Platform
# UX/UI Engineering & Product Experience Document
## Version 1.0 — 11 May 2026
### Classification: Internal Product Definition | Pre-Architecture Phase

---

> **Document Purpose**
> This document defines the complete UX strategy, information architecture, component library, screen-by-screen UX flows, user stories, design system prompts, mobile strategy, accessibility standards, and MVP delivery plan for the Talent Flow Platform.
> It is the companion document to TALENTFLOW-BRD-v1.md.

---

## Table of Contents

1. UX Strategy
2. Information Architecture
3. UI Component Library Definition
4. Screen-by-Screen UX Flows
5. Frontend User Stories
6. UX State Engineering
7. Design System Prompt Engineering (Google Stitch Compatible)
8. Mobile & Responsive UX Strategy
9. Accessibility & Enterprise UX Standards
10. MVP & Delivery Strategy

---

# 1. UX Strategy

## 1.1 UX Philosophy

The Talent Flow Platform is an **operational workflow platform** — not a form-filling tool. Every UX decision must serve the operational goals of the platform:

- Reduce cognitive load on HR operational staff managing multiple candidates simultaneously
- Surface SLA risks before they become breaches
- Give every stakeholder exactly the information and actions relevant to their role
- Make the workflow state of every candidate visible at a glance
- Eliminate the need to chase status — the platform surfaces it proactively

The UX must communicate **urgency, clarity, and accountability** at every touchpoint.

## 1.2 Core UX Principles

### Principle 1 — Workflow Visibility First
The primary user need at all times is: **"What needs my attention right now?"**
Every screen must answer this question before presenting anything else.

### Principle 2 — Progressive Disclosure
Complex workflows have many details. Show the essential operational view first. Reveal depth on demand. Never overwhelm with irrelevance.

### Principle 3 — State-Driven Interfaces
The UI reflects backend workflow states. UI components render conditionally based on what state a candidate or workflow item is in. The interface is never static.

### Principle 4 — Role-Aware Rendering
Each user role sees only what is relevant and permitted for their function. IT sees provisioning. Compliance sees clearances. Finance sees offer approval. The platform enforces operational focus through the UI itself.

### Principle 5 — Operational Accountability
Every action is visible, attributed, and timestamped. Users understand that their actions are part of an auditable operational record. The UI communicates this without feeling punitive.

### Principle 6 — SLA Awareness
Time is the operational currency of this platform. The UI must communicate time remaining, time elapsed, and SLA health (green/amber/red) as a persistent visual language throughout every workflow screen.

### Principle 7 — Contextual Action
Users should never have to navigate away to take the most important action. Actions surface in context — approve an offer, log an engagement, mark a provisioning item ready — all within the relevant workspace without full page navigations.

## 1.3 Enterprise UX Patterns

| Pattern | Application |
|---|---|
| **Kanban Pipeline View** | Candidate pipeline across stages |
| **Master-Detail Workspace** | Candidate record with contextual side panels |
| **Checklist with Status Indicators** | Provisioning, clearances, readiness |
| **SLA Progress Bars** | Visual time remaining on active SLAs |
| **Stepper / Stage Selector** | Interview round progression |
| **Score Cards & Gauges** | Evaluation scores, Day-1 readiness score |
| **Activity Feed / Timeline** | Audit trail, recent activity |
| **Approval Chain Visualisation** | Offer approval flow |
| **Alert Banners & Notification Badges** | Urgent escalations, SLA breaches |
| **Role-Based Dashboards** | Personalised operational workspaces per role |

## 1.4 Operational Visibility Philosophy

The platform operates on a principle of **ambient awareness** — stakeholders should be able to glance at their dashboard and immediately understand the health of all active workflows without drilling into individual records.

This is achieved through:
- Colour-coded SLA health indicators (green = on track, amber = at risk, red = breached)
- Badge counts on navigation items showing pending actions
- Dashboard widgets summarising cohort-level health
- Proactive alert banners for imminent SLA risks

---

# 2. Information Architecture

## 2.1 Primary Navigation Structure

```
TALENT FLOW
├── Dashboard (Role-personalised home)
│
├── Pipeline
│   ├── All Candidates (Kanban / List toggle)
│   ├── Active Evaluations
│   ├── Offers
│   └── Onboarding
│
├── Candidates
│   ├── [Candidate Record] — master detail
│   │   ├── Profile
│   │   ├── Interview History
│   │   ├── Evaluations
│   │   ├── Offer
│   │   ├── Compliance
│   │   ├── Provisioning
│   │   ├── Engagement
│   │   └── Activity Log
│
├── Compliance (Compliance Officer only)
│   ├── Clearance Tracker
│   └── Audit Trail
│
├── Provisioning (IT/Facilities only)
│   ├── Provisioning Board
│   └── Upcoming Start Dates
│
├── Analytics
│   ├── Pipeline Overview
│   ├── Engagement Analytics
│   ├── Readiness Analytics
│   ├── SLA Performance
│   └── Executive Summary
│
└── Settings (Admin only)
    ├── Workflow Templates
    ├── Team Management
    ├── Roles & Permissions
    └── SLA Configuration
```

## 2.2 Workspace Layouts

### HR Operations Workspace
- Left: Navigation + badge counts
- Centre: Active pipeline Kanban or list view
- Right: Contextual action panel (selected candidate details)
- Top: Alert banner for breaches and urgent items
- Persistent: SLA health summary strip

### Candidate Record Workspace (Master-Detail)
- Header: Candidate identity card (name, role, status, applied date, sentiment badge)
- Tab navigation: Profile | Interviews | Offer | Compliance | Provisioning | Engagement | Activity
- Main panel: Tab content
- Side panel: Stage progress stepper, SLA timers, quick action buttons

### IT Provisioning Board
- Header: Upcoming start dates filtered view
- Main: Provisioning checklist cards per candidate
- Status column: Ready / In Progress / Not Started / Overdue
- Filters: By start date, by status, by assigned team

---

# 3. UI Component Library Definition

## 3.1 Stage Selector Component `<tf-stage-selector>`

**Purpose:** The primary workflow state visualisation and navigation control for the candidate evaluation pipeline.

**Behaviour:**
- Renders N stages (driven by workflow template JSON)
- Each stage has a visual state: Completed (green, tick), Current (blue, highlighted border), Pending (grey)
- Progress bar spanning all stages reflects completion percentage
- Clicking a completed stage loads the historical evaluation record (read-only)
- Current stage is the active editing context
- Future stages are locked / preview only

**Props:** `stages: WorkflowStage[]`, `currentStage: string`, `readonly: boolean`

**States:** `completed`, `current`, `pending`, `locked`, `error`

---

## 3.2 Candidate Identity Card `<tf-candidate-card>`

**Purpose:** Compact visual identity block for candidate at top of every candidate-related screen.

**Content:**
- Avatar with online-status dot (ACTIVE / IN_PROCESS / RISK)
- Full name + role title
- Status badges: ACTIVE, SENIOR LEVEL, HESITANT SENTIMENT (if applicable)
- Applied date, experience years, source
- Email + phone

**States:** `standard`, `at-risk` (amber), `escalation` (red)

---

## 3.3 Evaluation Scoring Panel `<tf-evaluation-panel>`

**Purpose:** Per-panel-member evaluation workspace with dimension sliders and vote selector.

**Components:**
- Interviewer identity chip (avatar, name, role, interviewer type)
- Dimension score sliders (1–10): Technical, Communication, Cultural Fit, Problem Solving
- Score labels rendered live as slider moves
- Overall Vote selector: STRONG_NO / NO / YES / STRONG_YES (colour-coded buttons)
- Feedback textarea
- DRAFT / SUBMIT action buttons

**States:** `draft`, `submitted`, `late`, `locked`

---

## 3.4 Evaluation Summary Widget `<tf-evaluation-summary>`

**Purpose:** Aggregated panel evaluation summary after all submissions.

**Content:**
- Panel Members count
- Votes Cast count (x/total)
- Weighted Average Score (highlighted in brand blue)
- Vote Distribution (horizontal bars): Strong Yes / Yes / No / Strong No
- Category Breakdown (coloured bars per dimension)
- AI Recommendation box (future phase — shows "Awaiting votes..." until implemented)
- Action buttons: Request Additional Interview / Schedule Next Stage

---

## 3.5 SLA Timer Widget `<tf-sla-timer>`

**Purpose:** Persistent time-remaining indicator for active SLA commitments.

**Behaviour:**
- Shows time remaining in hours/days
- Colour transitions: Green (>50% time remaining) → Amber (25–50%) → Red (<25% or breached)
- Pulse animation when critical
- On breach: displays "BREACHED — [duration overdue]"

**Props:** `deadline: Date`, `startedAt: Date`, `slaLabel: string`

---

## 3.6 Clearance Tracker `<tf-clearance-tracker>`

**Purpose:** Visual status board for all candidate clearances.

**Layout:** Row per clearance type with:
- Clearance label (Background, Character, Medical, Security)
- Status badge: NOT_STARTED / IN_PROGRESS / CLEARED / FAILED / OVERRIDDEN
- Date updated
- Action button (Update Status, Override — role-gated)

**States reflect colour coding:** Grey (not started), Blue (in progress), Green (cleared), Red (failed), Purple (overridden)

---

## 3.7 Provisioning Board `<tf-provisioning-board>`

**Purpose:** Checklist-style provisioning status board per candidate.

**Layout:**
- Section headers: Standard Provisioning / Government Provisioning (if applicable)
- Row per item: Item name, Status toggle, Assigned to, Deadline, Completion date
- Status: NOT_STARTED → IN_PROGRESS → READY

---

## 3.8 Engagement Log Component `<tf-engagement-log>`

**Purpose:** Log and display engagement touchpoints with SLA context.

**Content:**
- Engagement SLA timer prominently shown
- Log New Engagement action button
- Form: Type selector, Notes, Response Quality rating (1–5)
- Historical engagement list with timestamps

---

## 3.9 Readiness Score Gauge `<tf-readiness-gauge>`

**Purpose:** Composite Day-1 readiness visualisation.

**Layout:**
- Large circular gauge (0–100%) with colour coding
- Three dimension breakdown: Equipment / Access / Engagement
- Each dimension shows READY (green tick) or NOT_READY (red cross)
- Score interpretation label: PASS / HR REVIEW / CRITICAL FAILURE

---

## 3.10 Audit Timeline `<tf-audit-timeline>`

**Purpose:** Immutable chronological record of all workflow events for a candidate.

**Layout:**
- Vertical timeline
- Each event: timestamp, actor, event type, state change (from → to)
- Colour coding by event category (evaluation, offer, compliance, provisioning, engagement)
- Filter by event category

---

## 3.11 Pipeline Kanban `<tf-pipeline-kanban>`

**Purpose:** Visual overview of all candidates across workflow stages.

**Layout:**
- Column per pipeline stage
- Candidate cards in each column: name, role, SLA health indicator, dwell time
- Drag-and-drop NOT enabled (stage transitions are workflow-gated — no manual moves)
- Click card → opens candidate workspace

---

## 3.12 Workflow Template Renderer `<tf-workflow-renderer>`

**Purpose:** Dynamically renders the stage selector and contextual workspace based on the workflow template JSON definition loaded for a candidate.

**Behaviour:**
- Reads `workflow_template_id` from candidate record
- Fetches template JSON from backend
- Renders stage count, names, and stage-specific form sections dynamically
- No conditional if/else switch in frontend — purely data-driven rendering

---

# 4. Screen-by-Screen UX Flows

---

## Screen 1 — HR Dashboard (Home)

**Purpose:** Personalised operational home page for HR Operations staff.

**Users:** HR Operations Manager, HR Director

**Layout:**
- Top alert banner: Active SLA breaches and urgent escalations
- KPI strip: Active candidates / Offers pending / Avg Day-1 readiness / SLA compliance rate
- My Pipeline — cards for candidates requiring HR action today
- Upcoming starts — candidates starting in next 7 days with readiness indicators
- Recent Activity — team-wide event feed

**States:**
- All green: Clean operational state — no interventions needed
- Amber alerts: SLA risks approaching
- Red alerts: Active breaches requiring immediate action

**Key Actions:** Open candidate record, Acknowledge alert, Action task directly from card

**Edge Cases:**
- No active candidates: Empty state with "Add First Candidate" CTA
- All SLAs breached: Full-page red banner with priority action list

---

## Screen 2 — Candidate Pipeline (Kanban)

**Purpose:** Organisation-wide view of all candidates across all stages.

**Users:** HR, Hiring Manager (read-only for other managers' candidates)

**Layout:**
- Stage columns: Created / Evaluation / Offer / Compliance / Provisioning / Onboarding
- Candidate cards: Name, role, current stage duration, SLA health indicator
- Filter bar: By role, by hiring manager, by SLA status, by sentiment

**Interactions:**
- Click candidate card → opens Candidate Workspace (Screen 4)
- Filter by SLA → shows only at-risk candidates
- Column header badge counts = number of candidates in that stage

**Edge Cases:**
- Candidate stuck in stage > expected dwell time → card shows amber/red indicator
- Compliance blocked candidates shown with lock icon on card

---

## Screen 3 — Add New Candidate

**Purpose:** Create a new candidate record and assign to the appropriate workflow template.

**Users:** HR

**Layout:**
- Step 1: Candidate details (name, email, phone, role, experience, application source, level)
- Step 2: Workflow template selection (Standard / Banking / Government / Agricultural)
- Step 3: Interview round configuration (number of rounds, panel assignments)
- Step 4: Confirm and create

**Validations:**
- Email uniqueness check
- Mandatory fields: name, email, role, template
- Panel members must be active system users

**Workflow Trigger:** On creation → candidate enters CREATED state; Interview 1 scheduling task appears

---

## Screen 4 — Candidate Workspace (Master Record)

**Purpose:** The central operational workspace for managing a single candidate's full lifecycle.

**Users:** All roles (role-based tab visibility)

**Layout:**
- Header: Candidate Identity Card + Stage Selector + Save Draft / Submit Evaluation CTAs
- Tab Navigation: Profile | Interviews | Offer | Compliance | Provisioning | Engagement | Activity
- Right side panel: SLA Timers, Quick Actions, Stage-specific alerts

**Tab: Profile**
- Candidate details, edit (HR only), document links

**Tab: Interviews**
- Per-round evaluation workspaces
- Stage selector drives which round is active
- Historical rounds are read-only summaries

**Tab: Offer**
- Offer creation form (if HIRE_APPROVED state)
- Offer approval status if in approval
- Offer sent status if sent
- Acceptance sentiment capture if accepted

**Tab: Compliance**
- Clearance Tracker component
- Manual override controls (HR Admin role only)

**Tab: Provisioning**
- Provisioning Board component (visible to IT and HR)

**Tab: Engagement**
- Engagement Log component
- SLA timer prominent

**Tab: Activity**
- Audit Timeline component — full history

---

## Screen 5 — Interview Evaluation Workspace

**Purpose:** Panel member's primary work screen for scoring and voting on a candidate.

**Users:** Panel Members, Hiring Manager

**Layout:**
- Header: Candidate identity card
- Interview Process stepper (stage selector) — shows current round
- Psychometric Assessments section (if configured) — toggleable, read-only for non-HR
- Interview Panel & Feedback section — one card per panel member
  - Dimension score sliders
  - Overall vote buttons
  - Feedback textarea
- Evaluation Summary section (visible once all vote)
- Live Statistics section (real-time, updated as votes come in)
- Recent Activity panel (engagement history for this evaluation session)

**States:**
- DRAFT: Save Draft enabled, Submit locked until all required fields complete
- SUBMITTED: All fields locked, summary visible
- AWAITING_OTHERS: Own submission done, waiting for other panel members

**Validations:**
- All 4 dimension scores required to submit
- Overall vote is required
- Feedback text: minimum 50 characters (enforced for quality)

**Edge Cases:**
- If a panelist submits STRONG_NO → HR Director review banner appears at top
- If evaluation submitted late → late badge shown on panelist card

---

## Screen 6 — Offer Management

**Purpose:** Create, review, and manage the candidate offer lifecycle.

**Users:** HR (create), Finance (approve CTC), HR Director (sign off)

**Layout:**
- Offer Details form (HR view): Role, CTC, benefits, start date, expiry date
- Approval Chain visualisation: HR Created → Finance Approved → HR Director Signed Off
- Status indicators per approver: Pending / Approved / Rejected
- Offer preview panel
- Send Offer CTA (enabled only when all approvals complete)

**States:**
- DRAFT: Form editable
- AWAITING_FINANCE: Form locked, Finance approval pending
- AWAITING_DIRECTOR: Finance approved, HR Director pending
- APPROVED: All approvals complete, Send Offer CTA active
- SENT: Offer locked, acceptance tracking active
- ACCEPTED: Sentiment capture form appears
- REJECTED / EXPIRED: Terminal state displayed

**Edge Cases:**
- CTC above band → Finance approval section automatically expands
- Finance rejects → HR notified, form re-opens for adjustment

---

## Screen 7 — Compliance Dashboard

**Purpose:** Centralised visibility into all active clearance workflows.

**Users:** Compliance Officer, Security Officer (clearance-specific view), HR

**Layout:**
- Top KPIs: Total candidates in compliance / Cleared today / Pending / SLA breaches
- Candidate clearance rows: Name, role, start date, clearance statuses (badge per type)
- Bottleneck view: Which clearance type is most commonly causing delays
- SLA breach alerts: Candidates exceeding clearance SLA

**Filters:** By clearance type, by status, by SLA health, by start date

**Actions:**
- Update clearance status (role-gated)
- Apply manual override (HR Admin role, with mandatory audit fields)
- Export compliance report

---

## Screen 8 — IT Provisioning Board

**Purpose:** IT operations workspace for managing provisioning tasks across all upcoming starters.

**Users:** IT Administrator, Facilities Manager

**Layout:**
- Filter by: This week's starters / All active / Overdue
- Candidate cards: Name, start date, days remaining, overall provisioning status bar
- Expand card: Full checklist with per-item status toggles and assignment
- Colour-coded urgency: Green (>5 days remaining), Amber (2–5 days), Red (<2 days or overdue)

**Actions:**
- Mark item READY
- Assign item to specific team member
- Add note to item
- Flag item as BLOCKED (with reason)

---

## Screen 9 — Engagement & SLA Workspace

**Purpose:** Hiring manager's focused workspace for managing engagement commitments.

**Users:** Hiring Manager, HR (oversight)

**Layout:**
- My Engagement Tasks: List of candidates with outstanding engagement SLAs
- Per candidate: SLA timer, candidate name, acceptance sentiment badge, engagement history
- Log Engagement button: Opens quick-log form (type, notes, response quality)
- Completed engagements: Historical log with timestamps

**Escalation Indicators:**
- Amber badge: 36h approaching
- Red badge: SLA breached
- Pulse animation: Critical threshold

---

## Screen 10 — Day-1 Readiness Dashboard

**Purpose:** Pre-Day-1 operational review screen ensuring all readiness dimensions are met.

**Users:** HR, IT, Facilities, Hiring Manager

**Layout:**
- Today's / Tomorrow's starters list
- Per candidate: Readiness Gauge (0–100%), dimension breakdown, any blocking items
- Overall cohort readiness score
- Action items: Outstanding provisioning or engagement tasks with owner and deadline

**States:**
- READY: All dimensions green — candidate is fully prepared
- AT_RISK: One or more dimensions amber — action needed today
- CRITICAL: One or more dimensions red — escalation triggered

---

## Screen 11 — Candidate Experience Survey

**Purpose:** Post-onboarding feedback collection from the candidate (5 days post Day-1).

**Users:** Candidate (external-facing, email/mobile link)

**Layout:**
- Simple, mobile-first form
- Sections: Interview experience / Communication quality / Day-1 readiness / Manager engagement / Overall rating
- NPS score question
- Free-text feedback field

**Design Principle:** Minimalist, candidate-friendly, not enterprise-heavy

---

## Screen 12 — Analytics & Reporting Hub

**Purpose:** Executive and HR operational analytics across the full pipeline.

**Users:** HR Director, HR Operations, Executives

**Layout:**
- Tab: Pipeline Overview (funnel from stage to stage)
- Tab: Engagement Analytics (time-to-engagement distribution, sentiment trends)
- Tab: Readiness Analytics (Day-1 score distribution, readiness failure causes)
- Tab: SLA Performance (breach rates per stage, trending over time)
- Tab: Bottleneck Analysis (dwell time per stage, top delay causes)

**Filters:** Date range, role type, department, hiring manager, workflow template

---

## Screen 13 — Workflow Template Management (Admin)

**Purpose:** Configure and manage workflow templates for different industries.

**Users:** System Admin, HR Director

**Layout:**
- Template list: Name, industry, version, active/inactive status
- Edit template: Drag-and-drop stage builder with JSON preview
- Stage configuration per step: required, blocking, parallel, permissions, SLA
- Version history and rollback capability

---

# 5. Frontend User Stories

---

## Cluster 1: HR Operations

---

**US-HR-001**
**As an** HR Operations Manager,
**I want to** see all active candidates grouped by pipeline stage on a Kanban board,
**So that** I can immediately understand the operational state of the entire talent pipeline without opening individual records.

*Acceptance Criteria:*
- [ ] Kanban columns map to defined workflow stages
- [ ] Each candidate card shows: name, role, stage dwell time, SLA health indicator
- [ ] SLA status colour coding: green / amber / red
- [ ] Card count badge on each column header
- [ ] Filter controls available: by role, department, SLA status, sentiment

---

**US-HR-002**
**As an** HR Operations Manager,
**I want to** see an alert banner at the top of my dashboard whenever an SLA has been breached,
**So that** I can take immediate remediation action before further damage occurs.

*Acceptance Criteria:*
- [ ] Alert banner triggers for any SLA breach state
- [ ] Banner shows: candidate name, SLA type, duration of breach
- [ ] Direct action link from banner to relevant candidate workspace
- [ ] Dismissing a banner creates an audit record of acknowledgement
- [ ] Multiple simultaneous breaches shown as expandable list

---

**US-HR-003**
**As an** HR Operations Manager,
**I want to** create a new candidate record and assign a workflow template in under 3 minutes,
**So that** I can efficiently onboard new pipeline additions without process delays.

*Acceptance Criteria:*
- [ ] Maximum 4 form steps to create a complete candidate record
- [ ] Workflow template selection is visual with template descriptions
- [ ] Email uniqueness validated in real time
- [ ] Panel member search is role-based and shows user availability
- [ ] Candidate record confirmed with summary before final create

---

**US-HR-004**
**As an** HR Operations Manager,
**I want to** monitor the compliance clearance status of all candidates in the pre-onboarding stage on a single screen,
**So that** I can proactively identify compliance blockers before they delay start dates.

*Acceptance Criteria:*
- [ ] Compliance dashboard shows all candidates in COMPLIANCE_IN_PROGRESS state
- [ ] Per candidate: all clearance types with status badges
- [ ] SLA timer shown per clearance for overdue items
- [ ] Filter by clearance type, status, and SLA health
- [ ] Export to CSV available

---

**US-HR-005**
**As an** HR Operations Manager,
**I want to** capture a candidate's acceptance sentiment as a mandatory step when recording offer acceptance,
**So that** the system can correctly route the candidate to either standard or escalated engagement workflows.

*Acceptance Criteria:*
- [ ] Sentiment capture is mandatory — acceptance cannot be recorded without it
- [ ] Four options: EXCITED / NEUTRAL / HESITANT / RELUCTANT
- [ ] HESITANT selection shows confirmation prompt explaining the escalation that will be triggered
- [ ] RELUCTANT selection shows urgent escalation warning
- [ ] Sentiment recorded as a timestamped audit event

---

## Cluster 2: Hiring Manager

---

**US-HM-001**
**As a** Hiring Manager,
**I want to** see all candidates awaiting my evaluation or engagement action on a single task view,
**So that** I can prioritise my actions and not miss SLA commitments.

*Acceptance Criteria:*
- [ ] My Tasks view shows: evaluations pending, engagement tasks pending, decisions awaiting
- [ ] Each task shows: candidate name, task type, SLA deadline, priority
- [ ] SLA colour coding applied to each task
- [ ] Click task → direct to relevant workspace section

---

**US-HM-002**
**As a** Hiring Manager,
**I want to** score a candidate across four dimensions using sliders and cast a structured vote,
**So that** my evaluation is captured in a standardised, comparable format.

*Acceptance Criteria:*
- [ ] Four dimension sliders (1–10), each with live score label
- [ ] Overall vote (four options) clearly distinct from dimension scores
- [ ] STRONG_NO vote shows a prominent warning about HR Director review
- [ ] Feedback textarea with minimum character count enforcement
- [ ] Save Draft available before final Submit
- [ ] Submit locks the evaluation and cannot be undone without HR Admin override

---

**US-HM-003**
**As a** Hiring Manager,
**I want to** be notified via the platform (and optionally mobile push) when my engagement window is approaching 36 hours,
**So that** I have a final opportunity to complete the welcome call before SLA breach.

*Acceptance Criteria:*
- [ ] In-app notification at 24h, 36h, and 48h marks
- [ ] Notification includes: candidate name, sentiment badge, time remaining
- [ ] One-click navigation from notification to engagement log
- [ ] Notification count badge persists in navigation until actioned

---

**US-HM-004**
**As a** Hiring Manager,
**I want to** log a completed engagement touchpoint in under 60 seconds from my mobile,
**So that** I can fulfil my SLA commitment immediately after a call without needing a desktop.

*Acceptance Criteria:*
- [ ] Mobile engagement log form: type, notes (optional), response quality (1–5 stars)
- [ ] Pre-selected engagement type based on context (HESITANT → Reassurance Call pre-selected)
- [ ] Timestamp auto-populated from device clock
- [ ] Confirmation shown with time-to-completion vs SLA

---

## Cluster 3: Interview Panel Member

---

**US-PANEL-001**
**As an** Interview Panel Member,
**I want to** see a clear summary of both panelists' scores side-by-side after all evaluations are submitted,
**So that** I can understand the full panel perspective before the hiring decision is made.

*Acceptance Criteria:*
- [ ] Summary visible only after all panel members submit
- [ ] Individual scores shown per panel member (anonymisation option configurable)
- [ ] Category breakdown bars shown in contrasting colours per panelist
- [ ] Divergent scores (>3 point gap) highlighted for discussion

---

**US-PANEL-002**
**As an** Interview Panel Member,
**I want to** save my evaluation as a draft and return to complete it later,
**So that** I can capture initial notes immediately after the interview without missing detail.

*Acceptance Criteria:*
- [ ] Draft state persists across sessions
- [ ] Draft does not count toward "all submitted" gate
- [ ] Draft shows a "Draft saved at [time]" indicator
- [ ] Reminder notification sent if draft not submitted within 12h of interview

---

## Cluster 4: IT Administrator

---

**US-IT-001**
**As an** IT Administrator,
**I want to** see all candidates starting in the next 10 days with their provisioning status,
**So that** I can plan and prioritise equipment and access provisioning ahead of start dates.

*Acceptance Criteria:*
- [ ] Default filter: next 10 business days
- [ ] Sort by start date (ascending)
- [ ] Each candidate shows: name, role, start date, provisioning items and status
- [ ] Items overdue shown with red indicator
- [ ] Export to task management tool (CSV minimum)

---

**US-IT-002**
**As an** IT Administrator,
**I want to** mark individual provisioning items as READY and have this update the candidate's Day-1 readiness score in real time,
**So that** HR can see provisioning progress without chasing me directly.

*Acceptance Criteria:*
- [ ] Status toggle per item: NOT_STARTED → IN_PROGRESS → READY
- [ ] READY status updates reflected on HR dashboard within 30 seconds
- [ ] Day-1 readiness score recalculates automatically on each item READY
- [ ] Completion timestamp recorded per item for audit

---

## Cluster 5: Compliance Officer

---

**US-COMP-001**
**As a** Compliance Officer,
**I want to** update the status of each statutory clearance as results are received,
**So that** the system can automatically unblock IT provisioning when all mandatory clearances are complete.

*Acceptance Criteria:*
- [ ] Status update form per clearance: status dropdown + date received + reference number
- [ ] CLEARED status triggers automatic evaluation of overall compliance gate
- [ ] If all mandatory clearances CLEARED → system automatically transitions candidate to COMPLIANCE_CLEARED
- [ ] FAILED status prevents auto-transition and triggers HR notification

---

**US-COMP-002**
**As a** Compliance Officer,
**I want to** apply a manual override to a clearance with a documented reason,
**So that** paper-based or offline clearance approvals can be recorded with full audit trail.

*Acceptance Criteria:*
- [ ] Override requires: reason text (min 100 chars), reference document identifier, authoriser confirmation
- [ ] Override creates immutable audit event visible in Activity Log
- [ ] HR Director is automatically notified of any manual override
- [ ] Override status badge visually distinct from CLEARED badge (purple vs green)

---

## Cluster 6: Finance Lead

---

**US-FIN-001**
**As a** Finance Lead,
**I want to** receive a notification when an offer package requires my compensation approval,
**So that** I can review and approve within the 1-business-day SLA without missing the request.

*Acceptance Criteria:*
- [ ] In-app + email notification on offer entering AWAITING_FINANCE state
- [ ] Notification includes: candidate name, role, CTC value, compensation band
- [ ] One-click approve or reject with reason
- [ ] Rejection sends HR a notification with the reason provided
- [ ] SLA timer visible on the approval screen

---

## Cluster 7: Executive / HR Director

---

**US-EXEC-001**
**As an** HR Director,
**I want to** see a single-page executive summary showing the health of the entire talent operations pipeline,
**So that** I can identify systemic bottlenecks and intervene strategically.

*Acceptance Criteria:*
- [ ] KPIs visible: offer acceptance rate, avg Day-1 readiness, SLA compliance rate, active pipeline count
- [ ] Bottleneck heat map: which stage has the most dwell time this month
- [ ] Sentiment distribution: breakdown of acceptance sentiments across accepted offers
- [ ] Period filter: last 30 / 60 / 90 days
- [ ] Drill-down available from any KPI to the underlying candidate records

---

# 6. UX State Engineering

## 6.1 Global State Indicators

| State | Visual Treatment | Description |
|---|---|---|
| `LOADING` | Skeleton loaders, no spinners (enterprise pattern) | Data being fetched |
| `EMPTY` | Illustrated empty state with contextual CTA | No data in current view |
| `ERROR` | Inline error banner (never modal for non-critical) | System or validation error |
| `SUCCESS` | Toast notification (bottom right, 3s auto-dismiss) | Action completed |
| `SAVING` | Button loading state + "Saving..." label | Background save in progress |
| `OFFLINE` | Top alert banner — persistent | Network unavailable |

## 6.2 SLA States

| State | Colour | Behaviour |
|---|---|---|
| `ON_TRACK` | Green | Standard rendering |
| `AT_RISK` | Amber | Pulse or badge indicator |
| `CRITICAL` | Red | Animated pulse, notification badge, banner |
| `BREACHED` | Dark red + strikethrough time | Breach duration shown, escalation triggered |

## 6.3 Workflow-Specific States

| State | Screen Impact |
|---|---|
| `BLOCKED_BY_COMPLIANCE` | Provisioning tab shows lock icon + reason |
| `AWAITING_APPROVAL` | Offer tab shows approval chain with pending indicator |
| `ESCALATION_ACTIVE` | Candidate card shows escalation badge; alert appears in dashboard |
| `DRAFT` | Evaluation shows unsaved indicator; submit CTA disabled until complete |
| `AT_RISK_ENGAGEMENT` | Engagement tab header turns amber; countdown timer prominent |
| `TERMINATED` | Candidate record shows greyed-out UI with terminal state banner |

---

# 7. Design System Prompt Engineering

> The following prompts are formatted for AI design systems including Google Stitch, Figma AI, and similar tools. Each prompt describes a specific screen or component with full visual, layout, and interaction context.

---

## STITCH PROMPT 1 — HR Dashboard (Home)

```
Design an enterprise HR operations dashboard for a Talent Operations Orchestration Platform called Talent Flow.

The platform brand uses a rich deep blue (#1A3C8F) primary colour with white backgrounds, light grey section backgrounds (#F8F9FA), and accent blue (#2563EB) for interactive elements. Typography is clean and professional — Inter or Roboto at various weights.

The dashboard is the home screen for an HR Operations Manager. The layout is:

TOP: A persistent alert banner in amber/red if any SLA is breached. Shows: "SLA Breach — [Candidate Name]: [SLA Type] — [Duration Overdue]" with a "View Now" link. If no breaches, the banner is not shown.

BELOW HEADER: A horizontal KPI strip with 4 stat cards (white, subtle shadow):
1. Active Candidates — large number, blue
2. Offers Pending — number, neutral
3. Avg Day-1 Readiness — percentage with colour coding (green if >80%, amber if 60-79%, red if <60%)
4. SLA Compliance Rate — percentage green/amber/red

LEFT SIDEBAR: Navigation with icons and labels. Items: Dashboard, Pipeline, Candidates, Compliance, Provisioning, Analytics, Settings. Each nav item shows a badge count if there are pending actions. Active item has left border accent.

MAIN CONTENT (left 65%): "Action Required Today" section — vertical list of candidate task cards. Each card: candidate avatar, name, role, action type (Evaluation Due / Engagement Overdue / Compliance Review), SLA timer badge (colour coded), quick action button.

RIGHT PANEL (35%): "Upcoming Starts" — list of candidates starting in next 7 days with readiness score gauge per candidate. Each row: candidate name, start date badge (n days away), readiness percentage bar.

BOTTOM: "Recent Activity" — compact team event feed with timestamps.

The overall aesthetic is professional enterprise SaaS — clean, data-dense but not cluttered, optimised for operational awareness. Similar to Salesforce Service Cloud or Linear.
```

---

## STITCH PROMPT 2 — Candidate Evaluation Workspace

```
Design a Candidate Evaluation screen for an enterprise HR platform called Talent Flow. This screen is used by hiring managers and interview panel members to score candidates after interviews.

The screen is for a candidate called "Sarah Mitchell" who is a "Product Manager Candidate". She is ACTIVE and SENIOR LEVEL. Interview is at Stage 2 of 4.

Brand: Deep blue (#1A3C8F) header regions; white card backgrounds; Inter font.

HEADER SECTION: Full-width blue hero banner behind a candidate profile card. Profile card (white, rounded, shadow) contains:
- Square avatar placeholder with online green dot
- Candidate name (bold, 24px)
- Job title subtitle
- Three data chips in a row: "Applied: May 5, 2026", "Experience: 8 Years", "Source: LinkedIn"
- Email and phone below with icons
- Status badges top-right: "ACTIVE" (teal outline pill) and "SENIOR LEVEL" (purple outline pill)

Page header above hero banner: "Candidate Evaluation" (H1), "Manage interview stages, panel members, and collect feedback" (subtitle). Top-right: "Save Draft" (outlined button) and "Submit Evaluation" (filled blue button).

INTERVIEW PROCESS SECTION (below hero): White card with header "Interview Process" and "Stage 2 of 4" in grey on right.
- Full-width progress bar (blue fill, 50% progress)
- 2x2 grid of stage cards:
  - Stage 1 "HR Screening" — Completed — Green fill, tick icon (✓)
  - Stage 2 "Technical" — Current — Blue border, "In Progress", "Current" label in blue
  - Stage 3 "Managerial" — Pending — Grey, neutral
  - Stage 4 "Final" — Pending — Grey, neutral

PSYCHOMETRIC SECTION: White card "Psychometric Assessments" header with toggle switch on right (default OFF). Below: list of assessment items (greyed because toggle is off): Cognitive Ability Test (45 min), Personality Profile Big Five (30 min), Situational Judgment Test (25 min), Leadership Style Assessment (20 min). Each is a light row with title, duration, and right arrow.

INTERVIEW PANEL SECTION: White card "Interview Panel & Feedback" with "+ Add Member" button (outlined, top right).
Panel member card for "John Davidson" (Engineering Lead • Technical Interviewer):
- Initials avatar "JD" in blue circle
- Name and role
- X to remove
- Four sliders (1–10) labelled: Technical Skills, Communication, Cultural Fit, Problem Solving
- Slider track is grey, filled portion blue, thumb is blue circle, current value shown in blue below
- Overall Vote row: Four pill buttons — "Strong No" (red outline), "No" (orange outline), "Yes" (blue outline), "Strong Yes" (green outline)
- Detailed Feedback textarea with grey placeholder text

EVALUATION SUMMARY SECTION: White card at bottom showing aggregate stats once votes are in:
- "Panel Members: 2", "Avg Score: 7.6 (blue)", "Votes Cast: 0/2"
- Vote Distribution horizontal bar chart: Strong Yes / Yes / No / Strong No rows all empty
- Recommendation box: "Awaiting panel votes..." in muted blue
- Two action buttons: "Request Additional Interview" (outlined) and "Schedule Next Stage" (outlined)

The design is enterprise-grade, visually structured, information-dense but clean. Like Linear or Notion meets Salesforce.
```

---

## STITCH PROMPT 3 — IT Provisioning Board

```
Design an IT Provisioning Board screen for an enterprise HR onboarding platform called Talent Flow.

This screen is used by IT Administrators to track and manage all technical provisioning tasks for upcoming new hires.

Brand: White background, grey card backgrounds (#F8F9FA), deep blue (#1A3C8F) accents.

TOP HEADER: Page title "Provisioning Board" with subtitle "Manage IT & Facilities readiness for upcoming starters." Filter chips on right: "This Week", "Next 7 Days", "All Active", "Overdue". Plus a search bar.

KPI STRIP: 4 stat cards: Total Active / Completed Today / Overdue / Avg Days to Start

MAIN CONTENT: Vertical list of candidate provisioning cards.

Each card is a white rounded rectangle with subtle shadow containing:
- LEFT: Candidate avatar (initials circle), name, role title, start date badge ("Starting in 3 days" — red if ≤2 days, amber if 2-5, green if >5)
- CENTRE: Provisioning progress bar (0–100% based on items marked READY)
- CHECKLIST SECTION (expanded by default for urgent items): 
  - Standard items: Laptop, Email Account, Access Card, Workspace allocated
  - Government items (if applicable): eOffice, HRMS, PFMS, Gov Email
  - Each item row: status toggle (NOT_STARTED → IN_PROGRESS → READY), assigned person chip, deadline date
  - READY items have green fill and tick
  - Overdue items have red text on deadline
- BOTTOM of card: Last updated timestamp, "View Full Record" link

URGENCY COLOUR CODING: Cards with start date ≤2 days have a red left border accent. Cards 2–5 days have amber. Cards >5 days have green.

The screen should feel like a Jira-style task board merged with a provisioning dashboard. Clean, operational, data-focused.
```

---

## STITCH PROMPT 4 — Compliance Clearance Dashboard

```
Design a Government Compliance & Clearance Dashboard for an enterprise HR onboarding platform called Talent Flow.

This screen is used by Compliance Officers and Security Officers to track statutory clearances for candidates in the government onboarding workflow.

Brand: White background, deep blue primary (#1A3C8F), certification-green (#10B981) for cleared states, red (#EF4444) for failed.

PAGE HEADER: "Compliance Dashboard" with subtitle "Track statutory clearance requirements for active candidates."

TOP KPI CARDS: 4 cards in a row:
- "In Progress" — number of candidates with active clearances
- "Cleared Today" — green badge
- "SLA Breaches" — red badge with number
- "Awaiting Override" — purple badge

FILTER BAR: Filter by clearance type (ALL / BACKGROUND / CHARACTER / MEDICAL / SECURITY), Filter by status, Filter by SLA health.

MAIN TABLE/LIST: Candidate rows, each expandable.

Collapsed row: Candidate name, role, start date, and 4 clearance status badges (Background / Character / Medical / Security). Each badge: coloured pill (NOT_STARTED=grey, IN_PROGRESS=blue, CLEARED=green, FAILED=red, OVERRIDDEN=purple).

Expanded row (click to expand): Per clearance type card:
- Clearance type header
- Status toggle/selector
- Date received / date submitted field
- Reference number input
- SLA timer (time remaining or "OVERDUE X hours")
- If status = CLEARED: green confirmation with date
- If status = FAILED: red alert with "Initiate Review" and "Apply Override" buttons
- If status = OVERRIDDEN: purple card with override reason, authoriser, timestamp

BOTTOM: Audit export button and compliance report generation.

The design should feel authoritative, compliance-grade, like a government audit tool merged with a modern SaaS interface.
```

---

## STITCH PROMPT 5 — Day-1 Readiness Dashboard

```
Design a Day-1 Readiness Dashboard for an enterprise HR platform called Talent Flow.

Used by HR Managers on the morning of new hire start dates to verify operational readiness before candidates arrive.

Brand: Deep blue (#1A3C8F), white cards, readiness green (#10B981), amber (#F59E0B), red (#EF4444).

HEADER: "Day 1 Readiness" — "Today's and Tomorrow's Starters" subtitle. Date filter: Today / Tomorrow / This Week.

TOP SUMMARY: Cohort readiness score — large circular gauge showing overall percentage (e.g. "8/10 candidates fully ready"). Colour coded.

CANDIDATE READINESS CARDS: Grid or list of candidate cards.

Each card:
- Candidate name, role, start time
- Three dimension indicators in a row:
  - IT Equipment: READY (green tick) or NOT READY (red cross + item name blocking it)
  - Access & Systems: READY or detail of missing access
  - Manager Engagement: COMPLETED (green tick + engagement type + date) or OVERDUE (red, engagement SLA duration)
- Composite Readiness Score: large percentage number, colour coded
- Readiness label: "Ready for Day 1" (green) / "Action Required" (amber) / "Critical — Escalate" (red)
- Quick action links to the blocking item

BOTTOM: "Candidates Not Starting Today" — collapsed list of upcoming starters this week with readiness preview.

CRITICAL STATE: If any candidate has readiness < 60% — a full page alert banner with escalation options. "Critical: [Candidate Name] is not Day-1 ready. 3 items outstanding. Escalating to HR Director."

Design should feel like a mission control dashboard — clear, urgent, action-oriented.
```

---

# 8. Mobile & Responsive UX Strategy

## 8.1 Mobile-Priority Interactions

The following interactions must be fully functional on mobile (phone-sized screens) because they are time-sensitive and context-dependent:

| Interaction | Mobile Treatment |
|---|---|
| Log engagement touchpoint | Dedicated full-screen mobile form, 3 fields max |
| View SLA status for assigned candidates | Card-based list, colour-coded, immediate |
| Approve offers (Finance Lead) | Swipe-to-approve interaction + confirmation modal |
| Mark provisioning item READY | Single-tap toggle with confirmation |
| Receive and acknowledge SLA breach alerts | Push notification with deep link |
| Submit structured vote | Full-screen voting interface, one vote at a time |

## 8.2 Responsive Breakpoints

| Breakpoint | Layout Behaviour |
|---|---|
| Mobile (< 768px) | Single column, bottom nav, condensed cards |
| Tablet (768–1024px) | Two-column master-detail, side drawer nav |
| Desktop (> 1024px) | Full workspace layout, persistent sidebar, multi-panel |
| Wide (> 1440px) | Wide content columns, expanded data tables, full analytics |

## 8.3 Mobile Dashboard (HR Manager)

On mobile, the HR dashboard reduces to:
- Alert banner (if active SLA breach)
- "My Actions Today" — scrollable vertical task list
- Bottom navigation: Pipeline / Candidates / Alerts / Profile

---

# 9. Accessibility & Enterprise UX Standards

## 9.1 Accessibility Requirements

| Standard | Requirement |
|---|---|
| **WCAG 2.1 AA** | Minimum compliance target for all screens |
| **Colour contrast** | Minimum 4.5:1 for text; 3:1 for large text and UI components |
| **Keyboard navigation** | Full keyboard operability across all workflows |
| **Screen reader support** | ARIA labels on all interactive elements, status regions for live updates |
| **Focus management** | Logical tab order; focus returns to trigger after modal close |
| **Motion** | Respect OS-level reduced motion settings; no mandatory animations |
| **Error identification** | Errors described in text, not colour alone |

## 9.2 Enterprise Usability Standards

| Standard | Application |
|---|---|
| **Consistent interaction patterns** | All sliders, toggles, and voting controls behave the same way across all screens |
| **Predictable navigation** | Breadcrumbs on all deep pages; back navigation never loses unsaved state silently |
| **Inline validation** | Form fields validate on blur, not on submit only |
| **Undo/cancel** | All destructive actions require confirmation; submit evaluations show final confirmation modal |
| **Status feedback** | Every action immediately shows status (saving, saved, error) — no silent failures |
| **Timeout warnings** | Session expiry warned 5 minutes in advance with option to extend |

---

# 10. MVP & Delivery Strategy

---

## MVP 1 — The Evaluation Core (Sprint 1–2)

**Objective:** Prove the structured evaluation platform works and delivers immediate value for the hiring decision phase.

**Features Included:**
- Candidate creation and basic profile
- Stage selector (4 stages: HR Screening, Technical, Managerial, Final)
- Panel assignment per stage
- Evaluation scoring panel (4 dimensions + sliders)
- Structured voting (STRONG_NO / NO / YES / STRONG_YES)
- STRONG_NO escalation flag
- Evaluation summary widget
- Email notifications for panel evaluation tasks
- Basic candidate pipeline list view

**Excluded:** Psychometric assessments, offer workflow, compliance, provisioning, engagement tracking

**Business Value Delivered:**
- Eliminates unstructured hiring decisions immediately
- Creates first audit trail of evaluation data
- Foundation for all downstream data models

**Complexity:** Medium
**Dependencies:** Angular app scaffold, basic backend (candidate + interview + evaluation entities)
**Implementation Risk:** Low — this is CRUD with state logic

---

## MVP 2 — The Offer & Conversion Engine (Sprint 3–4)

**Objective:** Operationalise the offer lifecycle and create the conversion trigger that starts onboarding.

**Features Included:**
- Offer creation form with compensation fields
- Approval chain (Finance + HR Director)
- Offer sent and acceptance tracking
- Acceptance sentiment capture (mandatory)
- HESITANT/RELUCTANT escalation logic
- Engagement task creation at acceptance
- Basic engagement log (Hiring Manager)
- 48h engagement SLA timer
- SLA breach alerts (in-app)

**Excluded:** Compliance workflows, IT provisioning, advanced analytics

**Business Value Delivered:**
- Eliminates the post-acceptance black hole
- Creates first measurable engagement SLA
- Sentiment data begins accumulating from Day 1

**Complexity:** Medium-high
**Dependencies:** MVP 1 complete; offer entity; approval workflow engine
**Implementation Risk:** Medium — approval chain logic is nuanced

---

## MVP 3 — Onboarding Operations (Sprint 5–7)

**Objective:** Close the loop from acceptance to Day-1 readiness with provisioning and compliance tracking.

**Features Included:**
- Compliance clearance tracker (standard flow: background check mandatory)
- IT provisioning board (standard checklist: Laptop, Email, Access Card, Workspace)
- Compliance gate blocking IT provisioning
- Day-1 readiness score calculation
- Readiness dashboard for HR
- Candidate experience survey (simple form)
- Full audit timeline per candidate

**Excluded:** Government compliance module, psychometric assessments, analytics hub

**Business Value Delivered:**
- Full MVP lifecycle from candidate creation to Day-1 activation
- Measurable Day-1 readiness score
- End-to-end audit trail

**Complexity:** High
**Dependencies:** MVP 1 + 2 complete; compliance entity; provisioning entity; SLA timer engine
**Implementation Risk:** Medium — compliance gating requires robust state engine

---

## Enterprise Phase — Full Platform (Sprint 8–12)

**Objective:** Complete the full feature set for enterprise-grade deployment.

**Features Added:**
- Workflow template management (JSON-driven, Admin configurable)
- Dynamic frontend workflow rendering
- Full analytics & reporting hub
- Executive dashboard
- RBAC / PBAC implementation (role-gated field/screen access)
- Psychometric assessment module
- Full Pipeline Kanban view
- Mobile-optimised engagement logging
- Multi-stage interview support (configurable rounds)

**Business Value:** Platform is now commercially viable as a standalone enterprise SaaS product.

---

## Government Compliance Phase (Post-Enterprise)

**Objective:** Extend the platform to serve government sector clients with regulated onboarding.

**Features Added:**
- Government workflow template (4-clearance mandatory flow)
- Security clearance wait-state orchestration
- Government IT provisioning checklist (eOffice, HRMS, PFMS, Gov Email)
- Manual override capability with full audit trail
- Compliance export reports (audit-grade)
- Government-sector RBAC extensions (Security Officer role)

**Business Value:** Opens regulated industry market (government, banking, defence).

---

## AI/Agentic Phase (Post-Market Validation)

**Objective:** Layer intelligence and automation over the operational workflow core.

**Phase 2 (Intelligence):**
- Sentiment extraction from engagement notes
- Interview summarisation from evaluation data
- Onboarding risk scoring model
- NPS survey sentiment analysis

**Phase 3 (Agentic):**
- Proactive SLA nudge agent (pre-breach interventions)
- Workflow optimisation suggestions
- Intelligent escalation routing (manager vs HR vs director)
- Predictive ghosting detection

**Prerequisite:** Enterprise Phase deployed and generating sufficient operational data for model training.

---

## MVP Delivery Summary

| Phase | Key Deliverable | Timeline | Risk |
|---|---|---|---|
| MVP 1 | Evaluation Core | 4 weeks | Low |
| MVP 2 | Offer & Conversion | 4 weeks | Medium |
| MVP 3 | Onboarding Operations | 6 weeks | Medium |
| Enterprise Phase | Full Platform | 8 weeks | Medium-High |
| Government Phase | Regulated Compliance | 6 weeks | High |
| AI/Agentic Phase | Intelligence & Automation | Ongoing | High |

Total to Enterprise-Grade: ~6 months
Total to Market-Ready SaaS: ~9 months

---

*End of Document: TALENTFLOW-UXUI-v1.md*
*Next Document: TALENTFLOW-ARCHITECTURE-v1.md (to be authored after BRD and UX/UI review)*
