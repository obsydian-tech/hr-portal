# TalentFlow Platform — Locked Decisions & Design Principles
## Living Document | Updated Progressively
### Classification: Product Definition | Pre-Architecture Phase

---

> This document captures every locked decision, design principle, and product direction
> agreed during the TalentFlow discovery and design sessions. It is the source of truth
> before architecture and UI work begins.

---

## THE GOLDEN TRUTH
> Every stage of the process has a measurable signal. Every screen, button, action,
> and automated process must speak to these three outcomes:
> 1. Identify bottlenecks
> 2. Improve candidate experience
> 3. Reduce drop-off
>
> If a feature does not move one of these outcomes, it does not belong in the MVP.

---

## THE SIX TRACKING TRIGGERS
These are the six measurable signals the entire platform is built around:

| # | Trigger | Signal |
|---|---------|--------|
| 1 | First Interview | First interaction logged + candidate sentiment (interest baseline) |
| 2 | Interview Loop | Response time between interviews + engagement score |
| 3 | Offer Stage | Offer turnaround time + candidate responsiveness |
| 4 | Offer Acceptance | Acceptance timestamp + sentiment (excited/hesitant) |
| 5 | First Engagement | Time from acceptance to first meaningful contact (target: < 48hrs) |
| 6 | Day 1 | Readiness score: Equipment + Access + Engagement |

---

## THE FOUR SUCCESS METRICS
These are the numbers that define platform success:

1. **Time to First Engagement** — target under 48 hours from offer acceptance
2. **Time to Onboard** — offer accepted to Day 1
3. **Day 1 Readiness** — target 100%
4. **Candidate Experience Score** — post Day 1 survey

---

## THE 12-STAGE PROCESS
Grouped into four phases:

**Phase 1 — Interview & Evaluation** (Stages 1–4)
1. First Interview Completed
2. Candidate Evaluation & Shortlisting
3. Second Interview Scheduled
4. Second Interview Conducted

**Phase 2 — Offer & Acceptance** (Stages 5–8)
5. Final Decision (Approve / Reject)
6. Offer Creation & Approval
7. Offer Sent to Candidate
8. Offer Accepted ← CONVERSION POINT

**Phase 3 — Pre-Onboarding & Preparation** (Stages 9–10)
9. Pre-Onboarding Initiated ← CRITICAL PHASE (where most companies fail)
10. IT & Facilities Preparation

**Phase 4 — Onboarding & First Day** (Stages 11–12)
11. First Engagement Touchpoint ← CRITICAL STEP TO TRACK
12. Day 1 Onboarding

---

## WORKFLOW TEMPLATES
- The platform supports multiple workflow templates (Standard, Government, etc.)
- Government template adds: statutory clearances (background, character, medical,
  security), additional provisioning (eOffice, HRMS, PFMS, Gov Email), additional
  actors (Selection Committee, Security/Vigilance)
- Same 12-stage spine, template activates/deactivates steps and actors
- Templates are configurable without code changes

---

## LOCKED PRODUCT DECISIONS

---

### DECISION 001 — Platform Identity
**Decision:** TalentFlow is a candidate experience protection system, not an HR
admin tool. Every design decision is evaluated against whether it protects candidate
experience and produces measurable signals.
**Status:** Locked

---

### DECISION 002 — Core Roles (MVP)
**Decision:** The following roles are supported in MVP:
- **Talent Acquisition Specialist (TA)** — primary orchestrator, owns the process
  end-to-end, captures candidate sentiment, coordinates interviews
- **Hiring Manager** — scores candidates, makes hire/reject decisions, owns
  first engagement touchpoint post-acceptance
- **IT Administrator** — owns provisioning checklist
- **Facilities/Admin** — owns physical workspace readiness
- **System Admin** — configures tenant settings, workflow templates, sentiment
  scales

External recruiters are out of scope for MVP. Internal TA only.
**Status:** Locked

---

### DECISION 003 — TA vs HR Terminology
**Decision:** The primary orchestrator role is called "Talent Acquisition Specialist"
or "TA/Recruiter" — not generically "HR". This distinction matters for role-based
access and screen design. Talent Acquisition is an HR function but has a distinct
role in the platform.
**Status:** Locked

---

### DECISION 004 — Panel Scoring Model (Hybrid)
**Decision:** Panel member scoring uses a hybrid model:
- **Hiring Manager** always has a full system account and logs in directly
- **Occasional panel members** receive a lightweight email scoring link — no
  account, no login required. Click link, score, submit.
- **TA can enter scores on behalf** of any panel member with mandatory attribution
  note: "Score captured by TA on behalf of [Name, Role]"
- Every score has a clear named owner regardless of submission method
- Full audit trail maintained for all scoring methods
**Status:** Locked

---

### DECISION 005 — Panel Member Directory
**Decision:** Two methods for adding panel members:
- **Internal directory search** — searchable list of known system users (hiring
  managers, team leads). Pre-populated, grows organically as people are added.
  No big upfront data import required.
- **Ad hoc addition** — TA enters name + email + role/title. System generates
  unique scoring link for that interview round and sends it automatically.
- Directory builds itself over time through ad hoc additions
**Status:** Locked

---

### DECISION 006 — Interview Structure
**Decision:**
- **Stage 1** is always the fixed entry point — "Schedule First Interview"
- First interview is flexible in format: TA screening, Hiring Manager led,
  panel, or any combination
- **Stage 2 onwards** is the Interview Loop — flexible, supports as many rounds
  and types as needed (technical, cultural fit, panel, behavioural, etc.)
- Interview types are configurable per tenant
- The system always uses "Schedule First Interview" as the entry point label
**Status:** Locked

---

### DECISION 007 — Sentiment Capture (Stage 1)
**Decision:**
- Sentiment at Stage 1 is captured by the TA (not the hiring manager)
- Stage 1 sentiment measures **candidate interest and energy toward the
  opportunity** — not acceptance sentiment
- Sentiment scale at Stage 1 (default, configurable per tenant):
  - Very Interested
  - Interested
  - Neutral
  - Hesitant
  - Disengaged
- If sentiment is Hesitant or Disengaged at Stage 1, the system immediately
  surfaces a risk signal and prompts a specific recommended action
- Sentiment scale labels, thresholds, and risk trigger points are all
  configurable at tenant admin level without code changes
**Status:** Locked

---

### DECISION 008 — Configurability Principle
**Decision:** The following must be configurable at tenant admin level without
requiring a developer or code change:
- Sentiment scale labels and options
- Risk signal thresholds (e.g. which sentiment value triggers a risk flag)
- Interview types and labels
- Workflow template steps (active/inactive)
- SLA timeframes per stage
- Scoring dimensions and weightings
- Provisioning checklist items
**Status:** Locked

---

### DECISION 009 — Intelligence at Every Trigger
**Decision:** Every trigger point must produce:
1. A visible signal on the relevant screen
2. A risk indicator if the signal is outside healthy range
3. A specific recommended action — not generic, contextually relevant
This is what separates TalentFlow from a generic HR admin tool.
**Status:** Locked

---

### DECISION 010 — Universal Risk Timer Model (50/75/100)
**Decision:** All SLA timers across ALL six triggers follow the same percentage-based
risk model. No hardcoded day values — everything is relative to the configured SLA
window per trigger per tenant:

| Threshold | Status | Colour | Who is Notified | Action |
|-----------|--------|--------|-----------------|--------|
| 50% elapsed | Nudge | — | TA only | Alert links to candidate record |
| 75% elapsed | At Risk | Amber | TA only | Alert links to candidate record |
| 100% elapsed | Breached | Red | TA + Hiring Manager | Alert links to candidate record |

- Thresholds (50/75/100) are the default and are configurable per tenant
- SLA timer keeps running regardless of outreach attempts — no pause, no reset
- This model applies universally: interview gap, offer turnaround, acceptance
  window, first engagement countdown, provisioning deadline
- One consistent intelligence language across the entire platform
**Status:** Locked

---

### DECISION 011 — Trigger 2: Interview Loop Signals
**Decision:** Two signals govern the Interview Loop stage:

**Signal 1 — Time between interviews**
- Default SLA window: 7 days from last interview/contact to next scheduled interview
- Configurable per tenant
- Governed by the Universal Risk Timer Model (Decision 010)
- Clock starts from the moment the previous interview is marked complete
- Clock keeps running regardless of TA outreach — no pause, no reset

**Signal 2 — Candidate Engagement Score**
- Manually updated by TA, three states:
  - **Responsive** — candidate is confirming, replying, engaging normally
  - **Slow** — candidate is taking longer than usual to respond
  - **Unresponsive** — no response after TA outreach attempt
- Combined with time signal to produce composite drop-off risk picture:
  - Time at 75% + Unresponsive = serious drop-off risk (both signals shown together)
  - Time at 75% + Responsive = elevated but manageable risk
- Engagement score is visible on candidate record at all times during Interview Loop

**MVP Simplicity Rule:** Keep engagement score as a manual TA input for MVP.
No automated detection. Simple, honest, low friction.
**Status:** Locked

---


---

### DECISION 016 — TA Dashboard & UX Philosophy (Signal-First Design)

**Core Principle:**
Every screen on TalentFlow is a signal surface, not a generic dashboard.
Every role's home screen answers one question: "What needs me right now?"

**TA Dashboard is organised by urgency of signal — not alphabetically or by stage:**

| Zone | Content | Colour |
|------|---------|--------|
| Critical Now | Breached SLAs, reluctant sentiment, red signals | Red |
| At Risk Today | Amber signals, approaching SLA thresholds | Amber |
| On Track | Healthy candidates, no intervention needed | Green |
| Waiting | Ball in someone else's court | Neutral |

**Every candidate card on the dashboard shows:**
- Candidate name and role
- Current stage
- Active signal (what trigger is live)
- Time remaining on active SLA (colour coded)
- Last sentiment reading
- One-click link to candidate record

**AI Assistant Layer:**
- Persistent chat interface on every screen — not a popup chatbot
- Reads live platform state and responds with signal-aware answers
- Example queries: "Which candidates are most at risk this week?"
  "How long has [candidate] been waiting for offer approval?"
- AI assistant is an intelligence layer — it does not take actions,
  it surfaces insights and answers questions
- AI assistant scope: MVP 1 foundation, full capability in future phase

**Same signal-first philosophy applies to every role:**
- Hiring Manager home: candidates awaiting my decision, engagement
  tasks, approval actions — ordered by urgency
- IT home: upcoming starters, provisioning status, days remaining
- Every screen earns its place by answering: "What needs me right now?"

**Status:** Locked

---

### DECISION 017 — Notification Delivery (MVP 1)

**MVP 1: Both in-app and email notifications run simultaneously**
- Notifications are persistent in-app — do not disappear until actioned
- Badge count on navigation shows number of pending alerts
- Every notification links directly to the relevant candidate record
- Notifications fire at 50%, 75%, and 100% SLA thresholds per
  Universal Risk Timer Model (Decision 010)
- Email notifications (Postmark) also fire for every alert — both channels deliver in parallel
- MVP 1 email recipient: ignecious@obsydiantechnologies.com (single recipient for now)

**MVP 2: Full email recipient management**
- Email notifications expand to per-user/per-role recipient configuration
- WhatsApp: future phase consideration

**Status:** Locked — updated 2026-05-21 (both channels from MVP 1)

---

### DECISION 018 — Rejection Decision Model (Configurable)

**Platform-Level Principle (never configurable, always enforced):**
The system NEVER automatically rejects a candidate.
A human always confirms every rejection. This is non-negotiable
regardless of tenant configuration — it protects the platform
legally and ethically.

**Configurable at tenant admin level per seniority profile:**

| Config Item | Options | Default |
|-------------|---------|---------|
| Who can reject | TA only / HM only / TA or HM / HM with TA confirmation | HM only |
| Panel vote threshold for rejection recommendation | 50% / 60% / 75% / unanimous | 50%+ No or Strong No |
| Rejection reason | Optional / Mandatory | Mandatory |
| Rejection reason categories | Configurable list | Standard list |
| Reason shared with candidate | Yes / No / Optional | Internal only |
| Second confirmation required | Yes / No | No |
| Who provides second confirmation | TA / HR Director / configurable | N/A |

**Rejection reason is always captured internally** regardless of
whether it is shared with the candidate — feeds bottleneck analytics
and identifies where in the process good candidates are being lost.

**Status:** Locked

---

### DECISION 019 — Seniority as Master Configuration Parameter

**Seniority is the master control that governs all configuration profiles.**

**MVP 1 — Three default seniority levels (configurable labels per tenant):**
- Junior — entry level, graduate
- Mid — professional, specialist
- Senior — manager, director, executive

**Seniority is captured as a mandatory field on the candidate record
at creation.** It is the parameter tenant admins use to create
different configuration profiles. Each seniority level can have
its own version of:
- Approval chain (steps, conditions, approvers)
- Interview rounds required
- Rejection governance (who decides, vote thresholds)
- SLA windows per trigger
- Sentiment risk thresholds
- Panel size requirements

**Example of seniority-driven config differences:**

| Config | Junior | Mid | Senior |
|--------|--------|-----|--------|
| Approval chain | TA + HM | TA + HM | TA + HM + Finance + HR Director |
| Interview rounds | 1–2 | 2–3 | 3–4 |
| Rejection governance | HM only | HM only | HM + HR Director confirmation |
| Offer response SLA | 5 days | 5 days | 7 days |

**Department as modifier — MVP 2:**
Department will be introduced in MVP 2 as a second-level modifier
within each seniority profile. Architecture must accommodate this
from day 1 even though the UI for it ships in MVP 2.

**Config hierarchy (full vision, MVP 2 complete):**
```
Seniority (master)
    └── Department (modifier)
            └── Approval chain
            └── Interview rounds
            └── Rejection governance
            └── SLA windows
            └── Sentiment thresholds
```

**Status:** Locked


## MVP 1 — SCOPE BOUNDARY (LOCKED)

**MVP 1 covers the full candidate journey from creation through to offer acceptance:**

### What MVP 1 IS:
- Candidate record creation with data completeness gates
- Seniority level as master configuration parameter (Junior/Mid/Senior)
- First Interview scheduling and sentiment capture (Trigger 1)
- Interview Loop with configurable rounds and types (Trigger 2)
- Panel scoring — hybrid model (full accounts + email links + TA proxy)
- Internal directory + ad hoc panel member addition
- Offer creation with configurable approval chain per seniority (Trigger 3)
- Offer sent tracking and candidate interaction log
- Offer acceptance capture with sentiment and start date (Trigger 4)
- Simultaneous downstream notifications to IT & Facilities at acceptance
- Universal Risk Timer Model (50/75/100) across all MVP 1 triggers
- Signal-first TA dashboard organised by urgency not stage
- AI assistant layer — signal-aware chat interface
- Intelligence signals and risk surfacing at every trigger point
- Configurable rejection model per seniority profile
- In-app notifications with badge counts and direct candidate links
- Configurable sentiment scales, SLA windows, interview types per tenant
- Full audit trail across all actions and state transitions
- Multi-tenant support with admin-level configurability
- Architecture accommodates department as modifier (ships MVP 2)

### What MVP 1 is NOT:
- IT Provisioning module → MVP 2
- First Engagement tracking module (Trigger 5) → MVP 2
- Day 1 Readiness scoring module (Trigger 6) → MVP 2
- Onboarding document upload module → MVP 2
- Government compliance clearance module → MVP 2
- Department as configuration modifier → MVP 2
- Email notifications → MVP 2
- External recruiter support → MVP 2
- Reporting & analytics hub → MVP 2
- Full AI recommendation engine → Future phase

---

## DECISIONS PENDING (MVP 2 and beyond)

- [ ] Trigger 5 — First Engagement: 48hr countdown, escalation path, logging
- [ ] Trigger 6 — Day 1 Readiness: scoring model, readiness gates, binary checks
- [ ] IT Provisioning module: checklist design, assignment, completion tracking
- [ ] Onboarding document upload module: integration point in process
- [ ] Government compliance workflow: clearance gate design, wait states
- [ ] Email notifications: trigger points, templates, delivery model
- [ ] Department as configuration modifier: layered config model
- [ ] Reporting & analytics: dashboards, time periods, bottleneck views
- [ ] External recruiter support: scope and access model
- [ ] WhatsApp notifications: future phase

---

*See full decision log at the end of this document — 71 decisions locked.*

---

## UX DESIGN DECISIONS — TA DASHBOARD

---

### DECISION 020 — Dashboard Layout & Zone Priority Order
**Decision:** The TA Dashboard is a single scrollable page organised into
five zones in strict priority order:

| Zone | Content | Purpose |
|------|---------|---------|
| 1 | Signal Summary Strip | Four metric cards — glance-level health |
| 2 | Candidates at Risk | Max 2 records shown — View all link for rest |
| 3 | My Actions Today | Max 3 actions shown — View all link for rest |
| 4 | Pipeline Summary | Counts + health dots only — no names |
| 5 | This Month | Three quick stat cards |

- Maximum 2 candidates shown in Zone 2 — View all handles the rest
- Maximum 3 actions shown in Zone 3 — View all handles the rest
- Pipeline shows counts and health dots only — no individual names on dashboard
- Dashboard is a glance, not a list — depth lives in the linked views
- Generous white space — not overwhelming, not dense
**Status:** Locked

---

### DECISION 021 — Signal Health Language (No Exact Times)
**Decision:** The platform never surfaces exact time values on the dashboard
or candidate cards. All SLA status is communicated in health state language
only, derived from the 50/75/100 Universal Risk Timer Model:

| Health State | Trigger | Visual |
|-------------|---------|--------|
| On Track | Below 50% elapsed | Green |
| At Risk | 75% elapsed | Amber pill |
| Breached | 100% elapsed | Red pill |
| Blocked | Data gate incomplete | Amber pill |
| Pending | Action awaiting TA | Navy/indigo pill |
| Waiting | Ball in someone else's court | Neutral |

- SLA progress bar remains as visual indicator — no numbers attached
- Action priority tags use the same language: Breached / At Risk / Blocked / Pending
- This applies across all screens and all roles — consistent language platform-wide
**Status:** Locked

---

### DECISION 022 — Top Navigation Structure
**Decision:** Horizontal top navigation bar with the following structure:

**Left — Brand + Nav links:**
- TalentFlow brand mark (teal square + sitemap icon) + wordmark
- Nav links: Dashboard · Pipeline · Candidates · Offers · Reports

**Right — Actions + Utilities (left to right):**
- Add Candidate button (teal, pill shape) — primary action always accessible
- Divider
- Ask AI button (cyan outlined, pill shape) — distinct from Add Candidate
- Divider
- Bell icon with red dot badge for unread notifications
- Role pill (TA / HM / IT etc) — cyan text on dark background
- Avatar initials circle

**Nav link active state:** white text + subtle white background tint
**Nav link hover state:** white text + lighter white background tint
**Status:** Locked

---

### DECISION 023 — AI Assistant Placement & Treatment
**Decision:**
- AI assistant lives in the top navigation bar as "Ask AI" button
- NOT a floating button — removed from floating position
- Cyan colour treatment: cyan text + cyan border + very subtle cyan background
- Visually distinct from "Add Candidate" (teal solid) and nav links (white text)
- Clicking "Ask AI" opens the AI assistant panel — behaviour to be designed
- Same button visible on every screen — persistent access via topbar
- AI assistant reads live platform state and responds with signal-aware answers
**Status:** Locked

---

### DECISION 024 — Candidate Card Anatomy (Dashboard)
**Decision:** Every candidate card on the dashboard follows this structure
regardless of which zone it appears in — the emphasis shifts by context
but the structure is consistent:

| Element | Position | Always shown |
|---------|----------|-------------|
| Avatar initials | Left | Yes |
| Candidate name | Centre-left | Yes |
| Role + Seniority pill + Sentiment pill | Below name | Yes |
| Stage name | Right | Yes |
| Stage context (what is happening) | Below stage | Yes |
| Health pill (Breached/At Risk/etc) | Bottom right | Yes |

- Avatar colour reflects urgency: red gradient for breached, amber for at risk,
  teal/navy for healthy
- Seniority pill: always indigo/navy background
- Sentiment pill: colour matches sentiment (amber=hesitant, green=positive, etc)
- Cards are clickable — open full candidate record directly
- No exact times, no countdown numbers anywhere on the card
**Status:** Locked

---

### DECISION 025 — Pipeline Summary Treatment (Dashboard)
**Decision:** The pipeline summary on the dashboard shows counts and
health dots only — no individual candidate names:
- One row per pipeline phase
- Phase name + sub-label on left
- Health dots in the middle (one dot per candidate, coloured by health state)
- Total count (large number) on the right
- Each row is clickable — opens the full pipeline filtered to that phase
- Dot colours: red = breached, amber = at risk, green = on track, grey = waiting
**Status:** Locked

---

### DECISION 026 — Design System Application
**Decision:** All TalentFlow screens use the Naleko design system tokens:
- Primary: #1a1a2e (anchor navy)
- Primary deep: #16124d (editorial navy — welcome bars, page titles)
- Secondary: #4a3f8a (indigo — interactive accents, section icons)
- Tertiary/Teal: #2d8f9e (Add Candidate button, brand mark)
- Cyan: #7ad4e4 (Ask AI button, role pill, active highlights)
- Surface: #f8f9fa (page background)
- Cards: #ffffff with naleko-shadow-card
- Font display: Manrope (headings, numbers, brand)
- Font body: Inter (all body text, labels, descriptions)
- Border radius: xl (0.75rem) for cards, pill (9999px) for tags and buttons
- No decorative borders for sectioning — tonal surface shifts only
- No exact times or countdown numbers on any screen
- Status colours: success #2e7d32, warning #f57f17, error #ba1a1a
**Status:** Locked

---

## UPDATED DECISION LOG SUMMARY

| # | Decision | Status |
|---|----------|--------|
| 001 | Platform Identity | Locked |
| 002 | Core Roles MVP 1 | Locked |
| 003 | TA vs HR Terminology | Locked |
| 004 | Panel Scoring Model — Hybrid | Locked |
| 005 | Panel Member Directory | Locked |
| 006 | Interview Structure | Locked |
| 007 | Sentiment Capture Stage 1 | Locked |
| 008 | Configurability Principle | Locked |
| 009 | Intelligence at Every Trigger | Locked |
| 010 | Universal Risk Timer Model 50/75/100 | Locked |
| 011 | Trigger 2 — Interview Loop Signals | Locked |
| 012 | Trigger 3 — Offer Stage | Locked |
| 013 | Trigger 4 — Offer Acceptance | Locked |
| 014 | Candidate Data Model & Completeness Gates | Locked |
| 015 | Scope Boundary Current Phase | Locked |
| 016 | TA Dashboard & UX Philosophy | Locked |
| 017 | Notification Delivery MVP 1 | Locked |
| 018 | Rejection Decision Model | Locked |
| 019 | Seniority as Master Configuration Parameter | Locked |
| 020 | Dashboard Layout & Zone Priority Order | Locked |
| 021 | Signal Health Language — No Exact Times | Locked |
| 022 | Top Navigation Structure | Locked |
| 023 | AI Assistant Placement & Treatment | Locked |
| 024 | Candidate Card Anatomy | Locked |
| 025 | Pipeline Summary Treatment | Locked |
| 026 | Design System Application — Naleko Tokens | Locked |

---

*Document owner: TalentFlow Product Team*
*Last updated: TA Dashboard UX locked*
*Status: 26 decisions locked. Next: Candidate Record screen UX.*

---

## UX DESIGN DECISIONS — CANDIDATE RECORD SCREEN

---

### DECISION 027 — Candidate Record Navigation Model
**Decision:** The candidate record uses fixed tabs with stage-driven content
inside each tab. The tab structure never changes regardless of which stage
the candidate is in. The content inside each tab responds to the current stage.

**Fixed tabs (always present, always in this order):**
| Tab | Contains |
|-----|---------|
| Overview | Candidate details, phase progress, signal intelligence box |
| Interviews | All interview rounds — past collapsed, current active |
| Offer | Offer creation, approval chain, acceptance capture |
| Engagement | Sentiment history, engagement log |
| Notes | Free text notes, TA observations |

- Tabs have text labels only — no icons on tabs
- Active tab indicated by indigo bottom border + indigo text
- Inactive tabs: muted grey text, no border
- Tab bar sits below the actions bar, above the content area
**Status:** Locked

---

### DECISION 028 — Candidate Record Persistent Header
**Decision:** The following elements are always visible on the candidate
record regardless of which tab is active:

| Element | Position | Notes |
|---------|----------|-------|
| Candidate avatar (initials) | Far left | Colour reflects urgency state |
| Candidate name | Header | Manrope display font, 17px, bold |
| Role pill | Below name | Grey background |
| Seniority pill | Below name | Indigo background |
| Sentiment pill | Below name | Colour matches sentiment state |
| Source + experience | Below name | Grey, secondary info |
| Current stage name | Header right | 12px, medium weight |
| Health pill | Header right | Breached/At Risk/On Track |
| SLA health bar | Header right | Visual only, no numbers |
| Reject Candidate button | Header right | Subtle red text, light border |

- Reject Candidate lives in the header only — not in the actions bar
- Reject is a candidate-level decision, not a stage-level action
- SLA bar shows percentage fill only — no time values
**Status:** Locked

---

### DECISION 029 — Details Strip
**Decision:** A compact horizontal strip immediately below the candidate
header showing five key candidate data fields:
- Applied date
- Department
- Location
- Workflow template
- Seniority

- Five equal columns, white background, surface-low dividers
- Labels: 9px uppercase, muted
- Values: 12px, medium weight
- No borders — tonal shift separates from header above and tabs below
**Status:** Locked

---

### DECISION 030 — Phase Indicator (Four Phase Groups)
**Decision:** A horizontal four-phase progress indicator sits between the
details strip and the actions bar. Shows the four phases of the 12-stage
process with meaningful short descriptions — not stage numbers.

| Phase | Name | Description |
|-------|------|-------------|
| 1 | Interview & Evaluation | Screen, evaluate, decide |
| 2 | Offer & Acceptance | Create, approve, convert |
| 3 | Pre-Onboarding | Prepare, provision, clear |
| 4 | Onboarding & Day 1 | Engage, activate, confirm |

**Visual states:**
- Completed phase: green dot with tick + green text
- Active phase: indigo dot with number + indigo text + glow ring
- Pending phase: grey dot with number + grey text
- Connector line between phases: green if previous phase done, grey if not

- No stage numbers shown (e.g. "Stages 1-4") — descriptions replace them
- Phase dots are 22px diameter
- Clicking a completed phase navigates to its content (read-only)
**Status:** Locked

---

### DECISION 031 — Actions Bar Design
**Decision:** A dedicated actions bar sits between the phase indicator and
the tab bar. Contains all stage-relevant actions the TA can take.

**Design rules:**
- All buttons identical ghost style — transparent background, outline border,
  same height, same font size, same weight
- Icon left of label on every button — icon 11px, label 11px
- Pill shape (border-radius: pill)
- Hover state: surface-low background + indigo text + indigo border
- No filled/gradient buttons in the actions bar
- No size hierarchy between buttons — all equal
- Actions are stage-contextual — change based on current stage
- Reject Candidate is NOT in the actions bar — lives in candidate header only

**Example actions for Interview Loop stage:**
Schedule Interview · Update Sentiment · Log Panel Score ·
Add Panel Member · Send Scoring Link · View All Stages
**Status:** Locked

---

### DECISION 032 — Signal Intelligence Box
**Decision:** Every tab content area opens with a Signal Intelligence box
when there is an active risk signal for the candidate in the current stage.

- Subtle indigo tinted background, indigo border
- Small indigo icon box (info-circle icon) on the left
- "Signal Intelligence" eyebrow label in indigo uppercase
- One or two sentences of contextual intelligence — reads the current signals
  and surfaces a specific recommended action
- Not generic — always specific to the candidate's current state
- If no risk signal present — intelligence box is not shown
- This is the Golden Truth made visible on every screen
**Status:** Locked

---

### DECISION 033 — Interview Rounds Layout (Interviews Tab)
**Decision:** Interview rounds are displayed as stacked cards within the
Interviews tab — not horizontally side by side:

- Completed rounds: collapsed summary card showing avg score, panel vote,
  sentiment. Not editable.
- Active round: expanded card with full panel member list, scoring progress,
  and inline actions
- Pending rounds: not yet shown — appear when scheduled

**Active round card contains:**
- Panel member rows: avatar, name, role, score status tag, score value
- Score dimensions grid (2x2): dimension label, progress bar, value
- Inline round actions (small ghost buttons): Add Member, Enter Score on
  Behalf, Send Scoring Link

**Inline round actions** are small ghost pill buttons within the round card —
not duplicated in the main actions bar. Same ghost style, smaller padding.
**Status:** Locked

---

### DECISION 034 — Sentiment Display & Update (Interviews Tab)
**Decision:** Candidate engagement sentiment is shown and editable within
the Interviews tab as a five-option selector:

- Five options displayed as equal-width cards in a horizontal row
- Each option: coloured dot + label
- Selected state: highlighted border + tinted background matching sentiment colour
- Last updated timestamp shown next to the section title
- Sentiment options are the configured scale (default: Excited/Positive/Neutral/
  Hesitant/Reluctant) — configurable per tenant per Decision 007
- Clicking an option updates sentiment immediately — no separate save button
**Status:** Locked

---

### DECISION 035 — Activity Log Panel (Right Side)
**Decision:** A persistent right-side panel (268px wide) shows the full
activity log and audit trail for the candidate:

- Always visible alongside the main tab content
- Separated from main content by a 1px surface-low border
- Header: "Activity Log" in uppercase display font
- Filter chips: All · Interviews · Scores · Sentiment (text only, no icons)
- Active filter: indigo background + white text
- Feed: chronological list, newest first
- Each feed item: coloured dot + connector line + what happened + who + when
- Dot colours: blue (system/TA actions), green (completions), amber (sentiment/
  risk), grey (creation/setup events)
- No timestamps with exact times on dashboard — activity log is the one place
  where timestamps are shown because it is an explicit audit trail view
**Status:** Locked

---

## UPDATED DECISION LOG SUMMARY

| # | Decision | Status |
|---|----------|--------|
| 001 | Platform Identity | Locked |
| 002 | Core Roles MVP 1 | Locked |
| 003 | TA vs HR Terminology | Locked |
| 004 | Panel Scoring Model — Hybrid | Locked |
| 005 | Panel Member Directory | Locked |
| 006 | Interview Structure | Locked |
| 007 | Sentiment Capture Stage 1 | Locked |
| 008 | Configurability Principle | Locked |
| 009 | Intelligence at Every Trigger | Locked |
| 010 | Universal Risk Timer Model 50/75/100 | Locked |
| 011 | Trigger 2 — Interview Loop Signals | Locked |
| 012 | Trigger 3 — Offer Stage | Locked |
| 013 | Trigger 4 — Offer Acceptance | Locked |
| 014 | Candidate Data Model & Completeness Gates | Locked |
| 015 | Scope Boundary Current Phase | Locked |
| 016 | TA Dashboard & UX Philosophy | Locked |
| 017 | Notification Delivery MVP 1 | Locked |
| 018 | Rejection Decision Model | Locked |
| 019 | Seniority as Master Configuration Parameter | Locked |
| 020 | Dashboard Layout & Zone Priority Order | Locked |
| 021 | Signal Health Language — No Exact Times | Locked |
| 022 | Top Navigation Structure | Locked |
| 023 | AI Assistant Placement & Treatment | Locked |
| 024 | Candidate Card Anatomy | Locked |
| 025 | Pipeline Summary Treatment | Locked |
| 026 | Design System Application — Naleko Tokens | Locked |
| 027 | Candidate Record Navigation Model | Locked |
| 028 | Candidate Record Persistent Header | Locked |
| 029 | Details Strip | Locked |
| 030 | Phase Indicator — Four Phase Groups | Locked |
| 031 | Actions Bar Design | Locked |
| 032 | Signal Intelligence Box | Locked |
| 033 | Interview Rounds Layout | Locked |
| 034 | Sentiment Display & Update | Locked |
| 035 | Activity Log Panel | Locked |

---

*Document owner: TalentFlow Product Team*
*Last updated: Candidate Record screen UX locked*
*Status: 35 decisions locked.*
*Next: Hiring Manager view · Offer screen · Add Candidate flow*

---

## UX DESIGN DECISIONS — ADD CANDIDATE FLOW

---

### DECISION 036 — Add Candidate Flow: Entry Point & Container
**Decision:** Add Candidate opens as a side drawer sliding in from the right.

- Triggered from the "Add Candidate" button in the top navigation bar
- Drawer width: 480px on desktop
- Page behind the drawer remains visible but dimmed — TA retains context
- Drawer does not navigate away from the current screen
- On successful creation → drawer closes → system navigates directly to
  the new candidate record
- The candidate record opens at the correct stage based on what was entered:
  CREATED state if no interview set up, INTERVIEW_SCHEDULED if interview
  details were added

**Why side drawer over other options:**
- Modal: too restrictive for a multi-field form
- Full page: loses context, feels heavy for a data entry task
- Wizard steps: unnecessary navigation for a single record creation
- Side drawer: enterprise-standard (Salesforce, ServiceNow pattern),
  contextual, shows the platform behind it
**Status:** Locked

---

### DECISION 037 — Add Candidate Flow: Structure & Sections
**Decision:** The Add Candidate drawer has two clearly labelled sections
in a single continuous form — no pagination, no step-by-step wizard:

**Section 1 — Candidate Details (always required to create)**
Fields in Section 1:
- First name + Last name (two column row)
- Email + Phone (two column row)
- Role + Department (two column row)
- Location + Source (two column row)
- Years of experience (single field)
- Seniority selector (visual three-option selector)
- Workflow template selector (visual two-option selector)

**Section 2 — First Interview Setup (optional, clearly labelled)**
- Toggle: "Schedule first interview now" — default OFF
- When toggle is ON: Interview Type, Format, Proposed Date, Panel Members
- When toggle is OFF: section is visible but fields are inactive
- TA can skip Section 2 entirely and set up the interview later from
  the candidate record

**On completion:** Creates the candidate record and navigates to it.
No extra navigation required.
**Status:** Locked

---

### DECISION 038 — Add Candidate: Record Completeness Indicator
**Decision:** A completeness bar sits at the top of the drawer body,
below the drawer header:
- Label: "Record completeness" + percentage on the right
- Progress bar fills as required fields are completed
- Note below the bar: lists which fields are required at creation
- Required fields for creation: Name, Email, Role, Seniority, Workflow
- All other fields are optional at creation — can be completed later
- Completeness bar updates dynamically as the TA fills in fields
**Status:** Locked

---

### DECISION 039 — Add Candidate: Seniority Selector Design
**Decision:** Seniority is a visual three-option card selector — not a
dropdown:
- Three equal-width cards: Junior · Mid · Senior
- Each card: name (bold) + short description below
  - Junior: Graduate · Entry level
  - Mid: Professional · Specialist
  - Senior: Manager · Director · Exec
- Selected state: indigo border + light indigo background + indigo text
- Unselected: grey border + white background
- One selection required — no default pre-selected
- This visual treatment reinforces that seniority is a governing parameter
  that affects downstream configuration (Decision 019)
**Status:** Locked

---

### DECISION 040 — Add Candidate: Workflow Template Selector Design
**Decision:** Workflow template is a visual two-option card selector:
- Two equal-width cards: Standard · Government
- Each card: coloured dot + name (bold) + short description
  - Standard: teal dot · Default hiring workflow
  - Government: indigo dot · Statutory clearances required
- Selected state: indigo border + light indigo background
- Default selection: Standard
- More workflow templates can be added by tenant admin — selector
  expands to accommodate additional templates
**Status:** Locked

---

### DECISION 041 — Add Candidate: Panel Member Addition
**Decision:** Panel members in the First Interview Setup section use
the hybrid model locked in Decision 004 and 005:

**Search internal directory:**
- Search input at top of panel section
- Returns system users by name or role
- One-click to add to panel
- Added as "System user" badge — has full platform access

**Ad hoc addition:**
- "Add someone not in the directory" button at the bottom
- Opens a small inline form: name + email + role/title
- System generates a scoring link for that person
- Added as "Scoring link" badge — receives email with scoring link

**Panel member rows show:**
- Initials avatar (colour coded by type)
- Name + role
- Badge: System user (indigo) or Scoring link (green)
- Remove button (X) on the right

**Status:** Locked

---

### DECISION 042 — Add Candidate: Drawer Footer
**Decision:** The drawer footer is fixed at the bottom of the drawer,
always visible regardless of scroll position:
- Cancel button: ghost style, left aligned
- Create Candidate Record button: gradient CTA, fills remaining space
- Small note to the right: "Opens candidate record" with arrow icon
- No ambiguity about what happens on creation
- Create button is always visible — TA never has to scroll to find it
**Status:** Locked

---

### DECISION 043 — Add Candidate: Field Design Rules
**Decision:** All form fields in the drawer follow these rules:
- Label: 9px uppercase, letter-spaced, muted colour
- Required fields: red asterisk (*) after the label
- Input height: comfortable tap target, 7px vertical padding
- Border: 1px outline-variant, transitions to indigo on focus
- Focus ring: 2px indigo at 10% opacity
- Filled state: indigo tinted border + very subtle indigo background tint
- Placeholder: outline-variant colour (muted grey)
- Select dropdowns: custom chevron, no browser default styling
- Two-column rows for related pairs, one-column for standalone fields
- No labels that say "Enter..." or "Type..." — placeholder text handles hints
**Status:** Locked

---

## UPDATED DECISION LOG SUMMARY

| # | Decision | Status |
|---|----------|--------|
| 001 | Platform Identity | Locked |
| 002 | Core Roles MVP 1 | Locked |
| 003 | TA vs HR Terminology | Locked |
| 004 | Panel Scoring Model — Hybrid | Locked |
| 005 | Panel Member Directory | Locked |
| 006 | Interview Structure | Locked |
| 007 | Sentiment Capture Stage 1 | Locked |
| 008 | Configurability Principle | Locked |
| 009 | Intelligence at Every Trigger | Locked |
| 010 | Universal Risk Timer Model 50/75/100 | Locked |
| 011 | Trigger 2 — Interview Loop Signals | Locked |
| 012 | Trigger 3 — Offer Stage | Locked |
| 013 | Trigger 4 — Offer Acceptance | Locked |
| 014 | Candidate Data Model & Completeness Gates | Locked |
| 015 | Scope Boundary Current Phase | Locked |
| 016 | TA Dashboard & UX Philosophy | Locked |
| 017 | Notification Delivery MVP 1 | Locked |
| 018 | Rejection Decision Model | Locked |
| 019 | Seniority as Master Configuration Parameter | Locked |
| 020 | Dashboard Layout & Zone Priority Order | Locked |
| 021 | Signal Health Language — No Exact Times | Locked |
| 022 | Top Navigation Structure | Locked |
| 023 | AI Assistant Placement & Treatment | Locked |
| 024 | Candidate Card Anatomy | Locked |
| 025 | Pipeline Summary Treatment | Locked |
| 026 | Design System Application — Naleko Tokens | Locked |
| 027 | Candidate Record Navigation Model | Locked |
| 028 | Candidate Record Persistent Header | Locked |
| 029 | Details Strip | Locked |
| 030 | Phase Indicator — Four Phase Groups | Locked |
| 031 | Actions Bar Design | Locked |
| 032 | Signal Intelligence Box | Locked |
| 033 | Interview Rounds Layout | Locked |
| 034 | Sentiment Display & Update | Locked |
| 035 | Activity Log Panel | Locked |
| 036 | Add Candidate — Entry Point & Container | Locked |
| 037 | Add Candidate — Structure & Sections | Locked |
| 038 | Add Candidate — Completeness Indicator | Locked |
| 039 | Add Candidate — Seniority Selector | Locked |
| 040 | Add Candidate — Workflow Template Selector | Locked |
| 041 | Add Candidate — Panel Member Addition | Locked |
| 042 | Add Candidate — Drawer Footer | Locked |
| 043 | Add Candidate — Field Design Rules | Locked |

---

*Document owner: TalentFlow Product Team*
*Last updated: Add Candidate flow locked*
*Status: 43 decisions locked.*
*Next: Hiring Manager view · Offer screen*

---

## UX DESIGN DECISIONS — HIRING MANAGER VIEW

---

### DECISION 044 — Hiring Manager: Role Scope on Platform
**Decision:** The Hiring Manager has a focused, action-oriented role on
TalentFlow. They are NOT managing the pipeline — they have three jobs only:

1. **Evaluate** — score candidates, cast votes after interviews
2. **Decide** — make the final hire or reject call
3. **Engage** — conduct first meaningful contact after offer acceptance

Everything on the HM's screens is designed around these three jobs only.
No Add Candidate button. No pipeline management. No provisioning.
**Status:** Locked

---

### DECISION 045 — Hiring Manager: Navigation Structure
**Decision:** The HM topbar has three focused nav items only:
- My Tasks — home screen, default landing
- My Candidates — full list of candidates assigned to this HM
- Decisions — history of hire/reject decisions made

**Topbar differences from TA:**
- No Add Candidate button — HMs do not create candidate records
- Ask AI button remains — same cyan treatment as TA
- Role pill shows HM (not TA)
- Avatar colour: teal gradient (vs TA's indigo gradient) — visual role
  differentiation at a glance
**Status:** Locked

---

### DECISION 046 — Hiring Manager: Home Screen Layout
**Decision:** The HM home screen uses a vertical stacking layout:

**Zone 1 — Page header:** Name greeting + pending action count summary

**Zone 2 — Signal strip (3 cards):**
- Scores Due — evaluations awaiting HM input (red)
- Decisions Pending — final hire calls required (amber)
- Engagement Tasks — first contact tasks after acceptance (navy/indigo)

Only three signal cards — maps directly to the HM's three jobs.
No offer acceptance rate, no pipeline count — those are TA signals.

**Zone 3 — Two column grid:**
- Left column: Pending actions list (task cards ordered by urgency)
- Right column: My candidates list (all candidates assigned to HM)

**Zone 4 — Scoring panel** (when a score task is selected):
- Shown inline below the dashboard, clearly labelled
- Not a separate page — stays within the HM's context
**Status:** Locked

---

### DECISION 047 — Hiring Manager: Task Card Design
**Decision:** Task cards in the pending actions list follow the same
ghost card pattern as the rest of the platform with these specifics:

- Left border colour indicates urgency (red/amber/navy)
- Task type shown as eyebrow label above candidate name:
  "Score candidate" / "Final decision" / "First engagement"
- Candidate name prominent (12px bold)
- Context line below: round, interview type, or relevant detail
- Priority tag on the right: Breached / At Risk / Pending / Due
- Clicking a task card opens the scoring panel below

**Task ordering — always by urgency:**
1. Breached (red) — score tasks past SLA
2. At Risk (amber) — score tasks approaching SLA
3. Pending (amber) — decisions awaiting
4. Due (navy) — engagement tasks
**Status:** Locked

---

### DECISION 048 — Hiring Manager: Candidate List Design
**Decision:** The HM candidate list (right column of home screen) shows:
- Avatar (initials, colour coded by urgency)
- Candidate name + role
- Sentiment pill + seniority pill
- Current stage (right aligned)
- Health status badge (right aligned below stage)

Clicking a candidate row opens their scoring panel if a score is due,
or navigates to a focused candidate view for decisions and engagement.
The list shows all candidates assigned to this HM — not the full pipeline.
**Status:** Locked

---

### DECISION 049 — Hiring Manager: Scoring Panel Design
**Decision:** When a HM clicks a score task, the scoring panel opens
inline below the dashboard — not a separate page, not a modal:

**Scoring panel structure:**
- Section label above the panel: candidate name + round + health tag
- Panel header: "Score Candidate" title + round description + close button
- Candidate summary strip: avatar, name, role pill, seniority pill,
  sentiment pill, round indicator (e.g. Round 2 of 3)
- Signal Intelligence box: contextual message about current risk state
  and what submitting will unblock — always specific, never generic
- Two column body:
  - Left: four dimension sliders (Technical, Communication, Cultural
    Fit, Problem Solving) with live score display
  - Right: Overall Vote (2x2 grid: Strong No / No / Yes / Strong Yes)
    + Feedback Notes textarea
- Footer: Save Draft (ghost) + Submit Evaluation (gradient CTA) +
  "Cannot be changed after submission" note

**Scoring panel rules:**
- All four dimensions must be scored before submit is enabled
- Overall vote is required before submit is enabled
- Save Draft saves current state without submitting
- Submit is irreversible — note makes this clear
- "Yes" pre-selected as default vote — HM must actively choose No/Strong No
**Status:** Locked

---

### DECISION 050 — Hiring Manager: Scoring Dimensions
**Decision:** The HM scores candidates on four dimensions using sliders:
- Technical Skills (1–10)
- Communication (1–10)
- Cultural Fit (1–10)
- Problem Solving (1–10)

- Slider track: 3px, outline-variant colour
- Slider thumb: 12px circle, indigo fill
- Score value displayed live next to dimension name as slider moves
- No labels at each point — just 1 at start, 10 at end
- Dimensions are configurable per tenant per Decision 008
**Status:** Locked

---

### DECISION 051 — Hiring Manager: Signal Intelligence in Scoring Panel
**Decision:** The Signal Intelligence box appears at the top of every
scoring panel — same pattern as on the candidate record (Decision 032).

For the scoring panel specifically it always tells the HM:
- The candidate's current sentiment
- Whether their score is the last outstanding for this round
- What submitting will unblock in the process
- Any risk context relevant to acting quickly

This connects the HM's individual action back to the Golden Truth —
every score submitted is not just an evaluation, it is a signal that
moves the candidate experience forward or leaves it at risk.
**Status:** Locked

---

## UPDATED DECISION LOG SUMMARY

| # | Decision | Status |
|---|----------|--------|
| 001 | Platform Identity | Locked |
| 002 | Core Roles MVP 1 | Locked |
| 003 | TA vs HR Terminology | Locked |
| 004 | Panel Scoring Model — Hybrid | Locked |
| 005 | Panel Member Directory | Locked |
| 006 | Interview Structure | Locked |
| 007 | Sentiment Capture Stage 1 | Locked |
| 008 | Configurability Principle | Locked |
| 009 | Intelligence at Every Trigger | Locked |
| 010 | Universal Risk Timer Model 50/75/100 | Locked |
| 011 | Trigger 2 — Interview Loop Signals | Locked |
| 012 | Trigger 3 — Offer Stage | Locked |
| 013 | Trigger 4 — Offer Acceptance | Locked |
| 014 | Candidate Data Model & Completeness Gates | Locked |
| 015 | Scope Boundary Current Phase | Locked |
| 016 | TA Dashboard & UX Philosophy | Locked |
| 017 | Notification Delivery MVP 1 | Locked |
| 018 | Rejection Decision Model | Locked |
| 019 | Seniority as Master Configuration Parameter | Locked |
| 020 | Dashboard Layout & Zone Priority Order | Locked |
| 021 | Signal Health Language — No Exact Times | Locked |
| 022 | Top Navigation Structure | Locked |
| 023 | AI Assistant Placement & Treatment | Locked |
| 024 | Candidate Card Anatomy | Locked |
| 025 | Pipeline Summary Treatment | Locked |
| 026 | Design System Application — Naleko Tokens | Locked |
| 027 | Candidate Record Navigation Model | Locked |
| 028 | Candidate Record Persistent Header | Locked |
| 029 | Details Strip | Locked |
| 030 | Phase Indicator — Four Phase Groups | Locked |
| 031 | Actions Bar Design | Locked |
| 032 | Signal Intelligence Box | Locked |
| 033 | Interview Rounds Layout | Locked |
| 034 | Sentiment Display & Update | Locked |
| 035 | Activity Log Panel | Locked |
| 036 | Add Candidate — Entry Point & Container | Locked |
| 037 | Add Candidate — Structure & Sections | Locked |
| 038 | Add Candidate — Completeness Indicator | Locked |
| 039 | Add Candidate — Seniority Selector | Locked |
| 040 | Add Candidate — Workflow Template Selector | Locked |
| 041 | Add Candidate — Panel Member Addition | Locked |
| 042 | Add Candidate — Drawer Footer | Locked |
| 043 | Add Candidate — Field Design Rules | Locked |
| 044 | HM — Role Scope on Platform | Locked |
| 045 | HM — Navigation Structure | Locked |
| 046 | HM — Home Screen Layout | Locked |
| 047 | HM — Task Card Design | Locked |
| 048 | HM — Candidate List Design | Locked |
| 049 | HM — Scoring Panel Design | Locked |
| 050 | HM — Scoring Dimensions | Locked |
| 051 | HM — Signal Intelligence in Scoring Panel | Locked |

---

*Document owner: TalentFlow Product Team*
*Last updated: Hiring Manager view locked*
*Status: 51 decisions locked.*
*Next: Offer screen · Pipeline view · Notifications*

---

## UX DESIGN DECISIONS — PIPELINE VIEW

---

### DECISION 052 — Pipeline View: Entry Points
**Decision:** The Pipeline view is accessed from:
- "Pipeline" nav link in the top navigation bar
- "Full view →" link on the dashboard pipeline summary (Zone 4)
- "View all →" links on the dashboard risk and actions zones

When accessed from a filtered dashboard link (e.g. "View all 8 at risk")
the pipeline view opens with the relevant filter pre-applied.
**Status:** Locked

---

### DECISION 053 — Pipeline View: Dual Mode Layout
**Decision:** The pipeline view supports two display modes toggled
from the top right of the page:

**List view (default):**
- Full-width table with all candidates as rows
- Columns: Candidate · Stage · Sentiment · Seniority ·
  Hiring Manager · SLA Health · Action
- Default sort: Health worst first (Breached → At Risk → On Track)
- Clicking any row opens the candidate record

**Kanban view:**
- Columns per pipeline phase (Interview · Offer Stage · Accepted ·
  Pre-Onboarding)
- Cards show: name, role, sentiment pill, health dot
- No drag-and-drop — stage transitions are workflow-gated, not manual
- Clicking any card opens the candidate record

**Toggle design:** Two-button toggle (List / Kanban) in the top right
of the page header. Active mode has white background + indigo text +
card shadow. Inactive mode is transparent with muted text.

**Default mode:** List view — more information density, better for
operational decision making.
**Status:** Locked

---

### DECISION 054 — Pipeline View: Filter Bar
**Decision:** A persistent filter bar sits below the page header with
five filter groups separated by vertical dividers:

| Filter Group | Options |
|-------------|---------|
| Stage | All stages · Interview · Offer Stage · Accepted · Pre-Onboarding |
| Health | Breached · At Risk · On Track |
| Seniority | Junior · Mid · Senior |
| Hiring Manager | All HMs · Individual HM names |
| Sentiment | Hesitant · Reluctant (risk sentiments only) |

**Filter chip design:**
- Default: white background, outline border, muted text
- Active (neutral): indigo background, white text
- Active (health — breached): error-bg background, error text, error border
- Active (health — at risk): warning-bg background, warning text
- Chips are multi-selectable within each group
- "Clear all" link at the end resets all filters

**When accessed from a dashboard link with a pre-applied filter:**
the relevant chip is pre-activated on load.
**Status:** Locked

---

### DECISION 055 — Pipeline View: Results Bar
**Decision:** A results bar sits between the filter bar and the list/
kanban content showing:
- Left: "Showing X candidates · Y breached · Z at risk"
  — updates dynamically as filters change
- Right: Sort dropdown with options:
  - Health — worst first (default)
  - Stage
  - Name A–Z
  - Applied date
  - Hiring Manager

The results count uses bold for the candidate number and muted for
the health summary so the total is always prominent.
**Status:** Locked

---

### DECISION 056 — Pipeline View: List Table Columns
**Decision:** The list view table has seven columns in this order:

| Column | Content | Notes |
|--------|---------|-------|
| Candidate | Avatar initials + name + role | Avatar colour coded by urgency |
| Stage | Current stage name | Plain text, 10px medium |
| Sentiment | Sentiment pill | Colour coded per sentiment |
| Seniority | Seniority pill | Indigo/blue tones |
| Hiring Manager | HM initials avatar + name | Small, secondary info |
| SLA Health | Health pill + SLA bar | Pill left, bar right — no numbers |
| Action | "View" ghost button | Opens candidate record |

**Table design rules:**
- Header row: surface-low background, 9px uppercase labels
- Row hover: very subtle indigo tint (#fdfcff)
- Row border: 1px surface-low between rows
- Default sort: worst health first — breached candidates always top
- No checkbox column for MVP 1 — bulk actions are MVP 2
**Status:** Locked

---

### DECISION 057 — Pipeline View: Kanban Card Design
**Decision:** Kanban cards show minimal information — just enough to
identify the candidate and their health state:
- Candidate name (11px bold)
- Role (9px muted)
- Footer row: sentiment pill (left) + health dot (right)
- Left border colour: red (breached), amber (at risk), green (on track)
- No drag-and-drop — candidates cannot be manually moved between columns
- Card click opens full candidate record

**Kanban column design:**
- Column header: stage name (10px uppercase, muted) + count (14px bold)
- Column background: white card with shadow
- Cards inside have surface-low background
- No scroll within columns for MVP 1 — "+N more" link if overflow
**Status:** Locked

---

### DECISION 058 — Pipeline View: Sort Default
**Decision:** The default sort order for both List and Kanban views
is Health — worst first:
- Breached candidates always appear at the top
- At Risk candidates appear next
- On Track candidates appear last

This ensures the TA's attention is always directed to the highest risk
candidates first, even when no filters are applied. The sort is
configurable per session but resets to this default on page load.
**Status:** Locked

---

## UPDATED DECISION LOG SUMMARY

| # | Decision | Status |
|---|----------|--------|
| 001 | Platform Identity | Locked |
| 002 | Core Roles MVP 1 | Locked |
| 003 | TA vs HR Terminology | Locked |
| 004 | Panel Scoring Model — Hybrid | Locked |
| 005 | Panel Member Directory | Locked |
| 006 | Interview Structure | Locked |
| 007 | Sentiment Capture Stage 1 | Locked |
| 008 | Configurability Principle | Locked |
| 009 | Intelligence at Every Trigger | Locked |
| 010 | Universal Risk Timer Model 50/75/100 | Locked |
| 011 | Trigger 2 — Interview Loop Signals | Locked |
| 012 | Trigger 3 — Offer Stage | Locked |
| 013 | Trigger 4 — Offer Acceptance | Locked |
| 014 | Candidate Data Model & Completeness Gates | Locked |
| 015 | Scope Boundary Current Phase | Locked |
| 016 | TA Dashboard & UX Philosophy | Locked |
| 017 | Notification Delivery MVP 1 | Locked |
| 018 | Rejection Decision Model | Locked |
| 019 | Seniority as Master Configuration Parameter | Locked |
| 020 | Dashboard Layout & Zone Priority Order | Locked |
| 021 | Signal Health Language — No Exact Times | Locked |
| 022 | Top Navigation Structure | Locked |
| 023 | AI Assistant Placement & Treatment | Locked |
| 024 | Candidate Card Anatomy | Locked |
| 025 | Pipeline Summary Treatment | Locked |
| 026 | Design System Application — Naleko Tokens | Locked |
| 027 | Candidate Record Navigation Model | Locked |
| 028 | Candidate Record Persistent Header | Locked |
| 029 | Details Strip | Locked |
| 030 | Phase Indicator — Four Phase Groups | Locked |
| 031 | Actions Bar Design | Locked |
| 032 | Signal Intelligence Box | Locked |
| 033 | Interview Rounds Layout | Locked |
| 034 | Sentiment Display & Update | Locked |
| 035 | Activity Log Panel | Locked |
| 036 | Add Candidate — Entry Point & Container | Locked |
| 037 | Add Candidate — Structure & Sections | Locked |
| 038 | Add Candidate — Completeness Indicator | Locked |
| 039 | Add Candidate — Seniority Selector | Locked |
| 040 | Add Candidate — Workflow Template Selector | Locked |
| 041 | Add Candidate — Panel Member Addition | Locked |
| 042 | Add Candidate — Drawer Footer | Locked |
| 043 | Add Candidate — Field Design Rules | Locked |
| 044 | HM — Role Scope on Platform | Locked |
| 045 | HM — Navigation Structure | Locked |
| 046 | HM — Home Screen Layout | Locked |
| 047 | HM — Task Card Design | Locked |
| 048 | HM — Candidate List Design | Locked |
| 049 | HM — Scoring Panel Design | Locked |
| 050 | HM — Scoring Dimensions | Locked |
| 051 | HM — Signal Intelligence in Scoring Panel | Locked |
| 052 | Pipeline — Entry Points | Locked |
| 053 | Pipeline — Dual Mode Layout | Locked |
| 054 | Pipeline — Filter Bar | Locked |
| 055 | Pipeline — Results Bar | Locked |
| 056 | Pipeline — List Table Columns | Locked |
| 057 | Pipeline — Kanban Card Design | Locked |
| 058 | Pipeline — Sort Default | Locked |

---

*Document owner: TalentFlow Product Team*
*Last updated: Pipeline view locked*
*Status: 58 decisions locked.*
*Next: Offer screen*

---

## UX DESIGN DECISIONS — CANDIDATES VIEW

---

### DECISION 059 — Candidates View: Purpose & Distinction from Pipeline
**Decision:** The Candidates view is distinctly different from Pipeline:

| | Candidates View | Pipeline View |
|--|----------------|---------------|
| Purpose | Find and access any candidate record | Manage workflow and stage progression |
| Default sort | Recently viewed | Health — worst first |
| Primary interaction | Search | Filter and triage |
| Layout | Recent cards + full list | List or Kanban |
| Use case | "I need to find Sarah's record" | "Who is at risk right now" |

Both views show the same columns and data — the difference is the
intent and default behaviour, not the information architecture.
**Status:** Locked

---

### DECISION 060 — Candidates View: Default State (Recent + Search)
**Decision:** The Candidates view opens showing:

**Top — Search bar (always prominent):**
- Large search input with magnifier icon
- Placeholder: "Search by name, email, role or department…"
- ⌘K keyboard shortcut hint shown on the right of the search bar
- Search triggers as the TA types — no need to press enter
- Searches across: name, email, role, department

**Below search — Quick filter chips:**
- One-click filters for the most common triage needs:
  Breached · At Risk · Hesitant · Reluctant · Senior · Mid · Junior ·
  Standard workflow · Government workflow
- Chips can be combined with search
- Active chip state: coloured background matching the filter type
- Red for Breached, Amber for At Risk, Indigo for everything else

**When search is empty and no filters active:**
- Recently viewed cards shown (four cards, 4-column grid)
- All candidates table shown below
**Status:** Locked

---

### DECISION 061 — Candidates View: Recently Viewed Cards
**Decision:** Four recently viewed candidate cards shown in a 4-column
grid immediately below the search bar when no search is active:

**Card design:**
- Top border colour: matches health state (red/amber/green/indigo)
- Top row: avatar initials (left) + health pill (right)
- Candidate name (12px bold)
- Role (10px muted)
- Footer row: current stage (left) + sentiment pill (right)
- Bottom: "Viewed X ago" timestamp in muted grey

**Card behaviour:**
- Clicking opens the candidate record directly
- Cards update on each visit — always shows the four most recently
  viewed candidates for this TA
- Cards are TA-specific — each TA sees their own recently viewed list

**Why four cards:** Matches the dashboard pipeline summary grid width.
Consistent visual language across the platform.
**Status:** Locked

---

### DECISION 062 — Candidates View: All Candidates Table
**Decision:** Below the recently viewed section, the full candidates
table is shown with the same columns as the Pipeline list view:

| Column | Content |
|--------|---------|
| Candidate | Avatar + name + role |
| Stage | Current stage name |
| Sentiment | Sentiment pill |
| Seniority | Seniority pill |
| Hiring Manager | HM initials avatar + name |
| SLA Health | Health pill + SLA bar |
| Action | View ghost button |

**Default sort:** Recently viewed — mirrors the cards above.
TA can switch sort to: Health worst first / Name A–Z / Applied date / Stage.

**Section label above table:** "All candidates" with user count.
**Results bar:** "Showing X candidates" + sort dropdown.

The table is identical in design to the Pipeline list table (Decision 056)
— same column widths, same pill styles, same hover states.
Consistency means zero relearning between the two views.
**Status:** Locked

---

### DECISION 063 — Candidates View: Search Behaviour
**Decision:** Search on the Candidates view works as follows:
- Real-time search — results update as the TA types, no submit needed
- Searches across: name, email, role, department
- Minimum 2 characters to trigger search
- When search is active: recently viewed cards are hidden, results
  table updates to show matching candidates only
- When search is cleared: recently viewed cards reappear
- No results state: shows an empty state with icon, "No candidates
  found" title, and "Try a different name or role" subtitle
- Search + quick filter chips can be combined — e.g. search "Sarah"
  with "Hesitant" filter active returns only hesitant candidates
  named Sarah
- ⌘K keyboard shortcut focuses the search bar from anywhere
  on the Candidates screen
**Status:** Locked

---

## UPDATED DECISION LOG SUMMARY

| # | Decision | Status |
|---|----------|--------|
| 001 | Platform Identity | Locked |
| 002 | Core Roles MVP 1 | Locked |
| 003 | TA vs HR Terminology | Locked |
| 004 | Panel Scoring Model — Hybrid | Locked |
| 005 | Panel Member Directory | Locked |
| 006 | Interview Structure | Locked |
| 007 | Sentiment Capture Stage 1 | Locked |
| 008 | Configurability Principle | Locked |
| 009 | Intelligence at Every Trigger | Locked |
| 010 | Universal Risk Timer Model 50/75/100 | Locked |
| 011 | Trigger 2 — Interview Loop Signals | Locked |
| 012 | Trigger 3 — Offer Stage | Locked |
| 013 | Trigger 4 — Offer Acceptance | Locked |
| 014 | Candidate Data Model & Completeness Gates | Locked |
| 015 | Scope Boundary Current Phase | Locked |
| 016 | TA Dashboard & UX Philosophy | Locked |
| 017 | Notification Delivery MVP 1 | Locked |
| 018 | Rejection Decision Model | Locked |
| 019 | Seniority as Master Configuration Parameter | Locked |
| 020 | Dashboard Layout & Zone Priority Order | Locked |
| 021 | Signal Health Language — No Exact Times | Locked |
| 022 | Top Navigation Structure | Locked |
| 023 | AI Assistant Placement & Treatment | Locked |
| 024 | Candidate Card Anatomy | Locked |
| 025 | Pipeline Summary Treatment | Locked |
| 026 | Design System Application — Naleko Tokens | Locked |
| 027 | Candidate Record Navigation Model | Locked |
| 028 | Candidate Record Persistent Header | Locked |
| 029 | Details Strip | Locked |
| 030 | Phase Indicator — Four Phase Groups | Locked |
| 031 | Actions Bar Design | Locked |
| 032 | Signal Intelligence Box | Locked |
| 033 | Interview Rounds Layout | Locked |
| 034 | Sentiment Display & Update | Locked |
| 035 | Activity Log Panel | Locked |
| 036 | Add Candidate — Entry Point & Container | Locked |
| 037 | Add Candidate — Structure & Sections | Locked |
| 038 | Add Candidate — Completeness Indicator | Locked |
| 039 | Add Candidate — Seniority Selector | Locked |
| 040 | Add Candidate — Workflow Template Selector | Locked |
| 041 | Add Candidate — Panel Member Addition | Locked |
| 042 | Add Candidate — Drawer Footer | Locked |
| 043 | Add Candidate — Field Design Rules | Locked |
| 044 | HM — Role Scope on Platform | Locked |
| 045 | HM — Navigation Structure | Locked |
| 046 | HM — Home Screen Layout | Locked |
| 047 | HM — Task Card Design | Locked |
| 048 | HM — Candidate List Design | Locked |
| 049 | HM — Scoring Panel Design | Locked |
| 050 | HM — Scoring Dimensions | Locked |
| 051 | HM — Signal Intelligence in Scoring Panel | Locked |
| 052 | Pipeline — Entry Points | Locked |
| 053 | Pipeline — Dual Mode Layout | Locked |
| 054 | Pipeline — Filter Bar | Locked |
| 055 | Pipeline — Results Bar | Locked |
| 056 | Pipeline — List Table Columns | Locked |
| 057 | Pipeline — Kanban Card Design | Locked |
| 058 | Pipeline — Sort Default | Locked |
| 059 | Candidates — Purpose & Distinction from Pipeline | Locked |
| 060 | Candidates — Default State (Recent + Search) | Locked |
| 061 | Candidates — Recently Viewed Cards | Locked |
| 062 | Candidates — All Candidates Table | Locked |
| 063 | Candidates — Search Behaviour | Locked |

---

*Document owner: TalentFlow Product Team*
*Last updated: Candidates view locked*
*Status: 63 decisions locked.*
*Next: Offer screen*

---

## UX DESIGN DECISIONS — OFFER TAB (CANDIDATE RECORD)

---

### DECISION 064 — Offer Tab: Location & Access
**Decision:** The Offer screen lives inside the candidate record as the
"Offer" tab — the third tab in the fixed tab navigation locked in
Decision 027. It is not a standalone page or a separate drawer.

Accessed by:
- Clicking the Offer tab on any candidate record
- Clicking offer-related action buttons in the actions bar
- Clicking offer-related tasks in the TA dashboard actions zone

The Offer tab is always visible in the tab bar but shows a "not yet
reached" state if the candidate has not progressed to the offer phase.
**Status:** Locked

---

### DECISION 065 — Offer Tab: State Navigator
**Decision:** A horizontal state navigator sits at the top of the Offer
tab content showing all four offer states as a journey:

| State | Label | Icon |
|-------|-------|------|
| 1 | Offer Created | Check icon when done |
| 2 | In Approval | Spinner when active |
| 3 | Offer Sent | Send icon |
| 4 | Accepted | Check-circle icon |

**Visual treatment per state:**
- Completed: green background pill + white text + tick icon
- Active: indigo background pill + white text + spinner icon
- Pending: white background + grey border + muted text

States are connected by arrows (→). The navigator is read-only —
it shows progress, it does not allow jumping between states.
**Status:** Locked

---

### DECISION 066 — Offer Tab: State-Driven Content
**Decision:** The Offer tab shows four stacked state blocks. Only the
active state is fully interactive. Completed states are collapsed to
a locked read-only summary. Future states are visible but dimmed and
non-interactive (opacity 0.5, pointer-events none).

This gives the TA visibility of the full journey without overwhelming
them with forms they cannot yet interact with. The "what comes next"
is always visible — building anticipation and understanding of the
downstream process.

**Active state** has a distinct indigo border (1.5px) to draw the eye.
**Status:** Locked

---

### DECISION 067 — Offer Tab: State 1 — Offer Creation
**Decision:** When the offer has not yet been created, State 1 shows
an active form with the following fields:

**Pre-populated from candidate record (editable to confirm):**
- Official role title
- Department
- Location

**TA completes:**
- Total CTC (compensation)
- Proposed start date
- Offer expiry window (default: 5 business days, configurable)
- Benefits and notes (free text)

**Once submitted:**
- All fields lock immediately — displayed as read-only value blocks
- Lock note shown: "Offer details are locked once submitted for approval"
- No editing without HR Director override (Decision 018)
- State transitions to State 2 automatically

**Data completeness gate:** If role, department, or location are missing
from the candidate record, the system prompts the TA to complete them
before the offer form can be submitted (Decision 014 Gate 1).
**Status:** Locked

---

### DECISION 068 — Offer Tab: State 2 — Approval Chain
**Decision:** The approval chain is shown as a vertical step-by-step
flow with one entry per approver:

**Each step shows:**
- Step number dot (green tick when done, amber with number when active,
  grey when pending)
- Approver name and role
- Status badge: Completed / Awaiting approval / Not yet reached
- Contextual note if at risk (e.g. "SLA at risk — approval overdue")

**Connector line** between steps: thin vertical line from dot to dot,
green if the step above is done, grey otherwise.

**Signal Intelligence box** appears when any approval step is at risk
— surfaces the specific delay and its impact on candidate experience.

**Actions available in State 2:**
- "Remind [Approver]" — ghost button
- "Send Reminder Now" — primary CTA

**Approval chain is seniority-driven** per Decision 019. Senior
candidates have longer chains (TA → HM → HR Director). Junior/Mid
may have shorter chains (TA → HM only). All configurable per tenant.

**If an approver rejects:** the step turns red, a rejection reason is
shown, and the TA is prompted to amend and resubmit from the rejection
point only (Decision 012 — rejection returns to TA, re-enters at point
of rejection).
**Status:** Locked

---

### DECISION 069 — Offer Tab: State 3 — Offer Sent
**Decision:** Once all approvals are complete, the TA marks the offer
as sent externally. State 3 activates showing:

**Top section — offer sent details:**
- Sent date (captured when TA marks as sent)
- Response window (calculated from sent date + configured expiry)
- SLA health bar (no numbers — health state only)

**Interaction log:**
- Chronological list of all candidate interactions logged by the TA
- Each entry: interaction type badge (Call/Email/WhatsApp/Meeting) +
  outcome + optional note + date
- "+ Log Interaction" button opens a simple inline form:
  Type selector · Outcome selector · Notes (optional)
- Outcome options: Acknowledged / Asking Questions / Counter Received /
  Going Quiet / Verbal Accept / Declined

**Counter Received intelligence:** If TA logs "Counter Received" —
a Signal Intelligence box appears immediately:
"Counter offer received. Hiring Manager review required before responding."

**"Mark as Sent Externally" action:** Single ghost button — clicking
records the send timestamp and activates the response SLA timer.
No document generation in platform (Decision 012).

**SLA behaviour in State 3:**
- Timer starts when offer is marked as sent
- 50% elapsed → TA nudge
- 75% elapsed → amber signal in state header
- 100% elapsed → red breach, TA + HM notified
**Status:** Locked

---

### DECISION 070 — Offer Tab: State 4 — Offer Acceptance
**Decision:** When the candidate verbally or formally accepts, the TA
records acceptance in State 4. The form has four elements:

**Mandatory fields:**
1. Acceptance date — auto-populated with today's date, editable
2. Confirmed start date — TA enters this, mandatory
3. Acceptance sentiment — five-option visual selector (same design
   as Stage 1 sentiment, Decision 034)
4. Notes — optional free text

**Downstream triggers visualisation:**
Before the TA confirms, three trigger cards are shown explaining
exactly what fires simultaneously on confirmation:
- 48hr engagement countdown starts — HM tasked
- IT & Facilities notified — full candidate details + start date sent
- Risk signal surfaced — if Hesitant or Reluctant, immediate alert

This makes the conversion point tangible — the TA understands the
weight and consequence of this single action before they take it.

**Confirm button:** "Confirm Acceptance & Trigger Workflows" — the
label is deliberate. It tells the TA exactly what they are doing.
No ambiguity. No generic "Submit" label.

**After confirmation:** State 4 collapses to a locked summary showing
acceptance date, start date, sentiment captured, and a confirmation
that all downstream workflows were triggered successfully.
**Status:** Locked

---

### DECISION 071 — Offer Tab: Signal Intelligence Placement
**Decision:** The Signal Intelligence box (Decision 032) appears
in the Offer tab under these conditions:

| Condition | Message |
|-----------|---------|
| Approval step SLA at risk | Names the pending approver + risk context |
| Offer not sent after approval | "Offer approved but not yet sent — candidate is waiting" |
| No candidate response | "No response logged — SLA approaching" |
| Counter received | "Counter offer received — HM review required" |
| Hesitant/Reluctant acceptance | "Hesitant sentiment — engagement priority elevated" |

Intelligence box only appears when there is an active risk signal.
When the offer is progressing healthily it is not shown — no noise.
**Status:** Locked

---

## UPDATED DECISION LOG SUMMARY

| # | Decision | Status |
|---|----------|--------|
| 001 | Platform Identity | Locked |
| 002 | Core Roles MVP 1 | Locked |
| 003 | TA vs HR Terminology | Locked |
| 004 | Panel Scoring Model — Hybrid | Locked |
| 005 | Panel Member Directory | Locked |
| 006 | Interview Structure | Locked |
| 007 | Sentiment Capture Stage 1 | Locked |
| 008 | Configurability Principle | Locked |
| 009 | Intelligence at Every Trigger | Locked |
| 010 | Universal Risk Timer Model 50/75/100 | Locked |
| 011 | Trigger 2 — Interview Loop Signals | Locked |
| 012 | Trigger 3 — Offer Stage | Locked |
| 013 | Trigger 4 — Offer Acceptance | Locked |
| 014 | Candidate Data Model & Completeness Gates | Locked |
| 015 | Scope Boundary Current Phase | Locked |
| 016 | TA Dashboard & UX Philosophy | Locked |
| 017 | Notification Delivery MVP 1 | Locked |
| 018 | Rejection Decision Model | Locked |
| 019 | Seniority as Master Configuration Parameter | Locked |
| 020 | Dashboard Layout & Zone Priority Order | Locked |
| 021 | Signal Health Language — No Exact Times | Locked |
| 022 | Top Navigation Structure | Locked |
| 023 | AI Assistant Placement & Treatment | Locked |
| 024 | Candidate Card Anatomy | Locked |
| 025 | Pipeline Summary Treatment | Locked |
| 026 | Design System Application — Naleko Tokens | Locked |
| 027 | Candidate Record Navigation Model | Locked |
| 028 | Candidate Record Persistent Header | Locked |
| 029 | Details Strip | Locked |
| 030 | Phase Indicator — Four Phase Groups | Locked |
| 031 | Actions Bar Design | Locked |
| 032 | Signal Intelligence Box | Locked |
| 033 | Interview Rounds Layout | Locked |
| 034 | Sentiment Display & Update | Locked |
| 035 | Activity Log Panel | Locked |
| 036 | Add Candidate — Entry Point & Container | Locked |
| 037 | Add Candidate — Structure & Sections | Locked |
| 038 | Add Candidate — Completeness Indicator | Locked |
| 039 | Add Candidate — Seniority Selector | Locked |
| 040 | Add Candidate — Workflow Template Selector | Locked |
| 041 | Add Candidate — Panel Member Addition | Locked |
| 042 | Add Candidate — Drawer Footer | Locked |
| 043 | Add Candidate — Field Design Rules | Locked |
| 044 | HM — Role Scope on Platform | Locked |
| 045 | HM — Navigation Structure | Locked |
| 046 | HM — Home Screen Layout | Locked |
| 047 | HM — Task Card Design | Locked |
| 048 | HM — Candidate List Design | Locked |
| 049 | HM — Scoring Panel Design | Locked |
| 050 | HM — Scoring Dimensions | Locked |
| 051 | HM — Signal Intelligence in Scoring Panel | Locked |
| 052 | Pipeline — Entry Points | Locked |
| 053 | Pipeline — Dual Mode Layout | Locked |
| 054 | Pipeline — Filter Bar | Locked |
| 055 | Pipeline — Results Bar | Locked |
| 056 | Pipeline — List Table Columns | Locked |
| 057 | Pipeline — Kanban Card Design | Locked |
| 058 | Pipeline — Sort Default | Locked |
| 059 | Candidates — Purpose & Distinction from Pipeline | Locked |
| 060 | Candidates — Default State (Recent + Search) | Locked |
| 061 | Candidates — Recently Viewed Cards | Locked |
| 062 | Candidates — All Candidates Table | Locked |
| 063 | Candidates — Search Behaviour | Locked |
| 064 | Offer Tab — Location & Access | Locked |
| 065 | Offer Tab — State Navigator | Locked |
| 066 | Offer Tab — State-Driven Content | Locked |
| 067 | Offer Tab — State 1 Offer Creation | Locked |
| 068 | Offer Tab — State 2 Approval Chain | Locked |
| 069 | Offer Tab — State 3 Offer Sent | Locked |
| 070 | Offer Tab — State 4 Offer Acceptance | Locked |
| 071 | Offer Tab — Signal Intelligence Placement | Locked |

---

*Document owner: TalentFlow Product Team*
*Last updated: Offer tab locked*
*Status: 71 decisions locked.*
*Next: Notifications · Reports · MVP 1 complete*
