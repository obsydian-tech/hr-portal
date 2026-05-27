# TalentFlow — Claude Code Audit
## Source of Truth: TALENTFLOW_DECISIONS.md (71 locked decisions)
## Branch audited: feature/epic4-talentflow-frontend
## Date: 2026-05-20
## Auditor: Claude Sonnet 4.6

> This document is written iteratively in chunks. Each section is audited
> against the locked decisions before being written. Do not act on any section
> until the user has reviewed and approved it.
>
> Format per gap:
> Decision # | What exists | What is needed | Gap severity | File reference

---

## HOW TO READ THIS DOCUMENT

- **CRITICAL** — Violates a hard locked decision. Must be fixed before any screen is shippable.
- **MAJOR** — Feature or screen is missing or structurally wrong. Cannot ship without it.
- **ALIGNMENT** — Implementation exists but does not match the locked spec. Needs rebuild or refactor.
- **MISSING** — Feature, endpoint, or config does not exist at all.
- **INFRA** — Infrastructure gap — wrong folder, missing resource, wrong wiring.

---

---

# SECTION 1 — SHELL & NAVIGATION

**Decisions audited:** D022, D023, D017 (notification badge)
**Files read:**
- `hr-portal/src/app/features/talent-flow/shell/talent-flow-shell.component.ts`
- `hr-portal/src/app/features/talent-flow/shell/talent-flow-shell.component.html`
- `hr-portal/src/app/features/talent-flow/talent-flow.routes.ts`

---

## S1-001 — Navigation layout is SIDEBAR, not horizontal topbar

**Decision:** D022 — Top Navigation Structure
**What exists:**
- Shell imports `SidebarComponent` and `TopbarComponent` as two separate components
- `SidebarComponent` renders a vertical left-side navigation panel
- `sidebarOpen = signal(true)` controls a collapsible sidebar
- Template: `<app-sidebar [navItems]="navItems()" ...>` + `<app-topbar ...>`

**What is needed (D022):**
- A single horizontal top navigation bar — no sidebar at all
- Left side: Brand mark (teal square + sitemap icon) + "TalentFlow" wordmark + nav links inline
- Nav links: Dashboard · Pipeline · Candidates · Offers · Reports
- Right side (left to right): Add Candidate (teal solid pill) | divider | Ask AI (cyan outlined pill) | divider | Bell icon with badge | Role pill | Avatar initials

**Gap severity:** CRITICAL
**Why:** The entire shell layout is wrong. This is not a style tweak — the sidebar pattern is architecturally different from the horizontal topbar. Every screen in the platform inherits this layout so this must be rebuilt first.
**File:** [talent-flow-shell.component.ts](hr-portal/src/app/features/talent-flow/shell/talent-flow-shell.component.ts#L25)

---

## S1-002 — Nav items: 3 items present, 5 required, wrong items

**Decision:** D022
**What exists:**
```typescript
// talent-flow-shell.component.ts:37-41
protected readonly navItems = computed<NavItem[]>(() => [
  { label: 'Dashboard', icon: 'pi pi-th-large',  route: '/platform/talentflow' },
  { label: 'Pipeline',  icon: 'pi pi-briefcase', route: '/platform/talentflow/pipeline' },
  { label: 'Config',    icon: 'pi pi-cog',        route: '/platform/talentflow/config' },
]);
```

**What is needed (D022):**
- Dashboard · Pipeline · Candidates · Offers · Reports (5 nav links)
- "Config" is a System Admin-only config page — it should NOT appear as a nav link for regular users; it is a protected sub-route
- Nav links have no icons in D022 spec — text labels only

**Gap severity:** CRITICAL
**File:** [talent-flow-shell.component.ts:37](hr-portal/src/app/features/talent-flow/shell/talent-flow-shell.component.ts#L37)

---

## S1-003 — "New Candidate" navigates to a full page — must open a drawer

**Decision:** D036 — Add Candidate is a side drawer (480px), not a routed page
**What exists:**
```typescript
// talent-flow-shell.component.ts:47-49
protected onNewCandidate(): void {
  void this.router.navigate(['/platform/talentflow/candidates/new']);
}
```
The shell navigates to `/candidates/new` which loads `CandidateCreatePageComponent` as a full routed page.

**What is needed (D036):**
- Clicking "Add Candidate" opens a 480px side drawer sliding in from the right
- Page behind stays visible but dimmed — no navigation away from current screen
- On successful creation → drawer closes → navigates to new candidate record

**Gap severity:** CRITICAL
**File:** [talent-flow-shell.component.ts:47](hr-portal/src/app/features/talent-flow/shell/talent-flow-shell.component.ts#L47)

---

## S1-004 — Ask AI button absent from topbar

**Decision:** D023 — AI assistant lives in the top navigation bar as "Ask AI" button
**What exists:**
- `<app-topbar [showSearch]="false" [showNotifications]="false">` — search and notifications explicitly disabled
- No "Ask AI" button anywhere in the shell template
- AI chat is accessible only from within the candidate workspace page via a floating toggle button

**What is needed (D023):**
- "Ask AI" button in the topbar on every screen
- Cyan outlined pill: `border: 1px solid var(--naleko-cyan)`, `color: var(--naleko-cyan)`, subtle cyan background tint
- Visually distinct from the teal "Add Candidate" button
- Clicking opens the AI assistant panel — persistent access from every route

**Gap severity:** CRITICAL
**File:** [talent-flow-shell.component.html:11](hr-portal/src/app/features/talent-flow/shell/talent-flow-shell.component.html#L11)

---

## S1-005 — Bell notification badge absent

**Decision:** D017 — In-app notifications with badge count on navigation, persistent until actioned
**What exists:**
- `[showNotifications]="false"` explicitly disables notifications on the topbar
- No badge count anywhere in the shell

**What is needed (D017):**
- Bell icon in topbar right side
- Red dot badge showing count of unread notifications
- Notifications persist until actioned — they do not auto-dismiss
- Every notification links directly to the relevant candidate record
- Notifications fire at 50%, 75%, and 100% SLA thresholds

**Gap severity:** MAJOR
**File:** [talent-flow-shell.component.html:11](hr-portal/src/app/features/talent-flow/shell/talent-flow-shell.component.html#L11)

---

## S1-006 — Role pill and avatar absent from topbar

**Decision:** D022 — Right side of topbar: Role pill (TA/HM/IT) + Avatar initials circle
**What exists:** Not present at all in the current shell template.
**What is needed:** Role pill showing current user's role in cyan text on dark background. Avatar showing user initials.
**Gap severity:** ALIGNMENT
**File:** [talent-flow-shell.component.html](hr-portal/src/app/features/talent-flow/shell/talent-flow-shell.component.html)

---

## S1-007 — Routes: missing 3 required routes, 2 wrong routes present

**Decision:** D022 (nav structure), D036 (no full-page add candidate), D059 (candidates view), D064 (offers), D046 (HM dashboard)
**What exists in talent-flow.routes.ts:**
```
''                          → DashboardPageComponent
'pipeline'                  → PipelinePageComponent
'candidates/new'            → CandidateCreatePageComponent   ← WRONG (should be drawer, not route)
'candidates/:id'            → CandidateWorkspacePageComponent
'candidates/:id/evaluate'   → EvaluationPageComponent
'config'                    → ConfigHubPageComponent
```

**What is needed:**
```
''                          → DashboardPageComponent          ✓ keep
'pipeline'                  → PipelinePageComponent           ✓ keep
'candidates'                → CandidatesPageComponent         MISSING (D059)
'candidates/:id'            → CandidateWorkspacePageComponent ✓ keep
'offers'                    → OffersPageComponent             MISSING (D064 entry point)
'hm-dashboard'              → HmDashboardPageComponent        MISSING (D046)
'config'                    → ConfigHubPageComponent          ✓ keep (admin-guarded)
'config/scoring-weights'    → ScoringWeightsPageComponent     MISSING
'config/sla-thresholds'     → SlaThresholdsPageComponent      MISSING
'config/panel-rules'        → PanelRulesPageComponent         MISSING
```

**Routes to remove:**
- `'candidates/new'` — Add Candidate is a drawer triggered from the topbar, not a routed page (D036)
- `'candidates/:id/evaluate'` — Evaluation (vote submission) is an inline panel on the HM dashboard (D049), not a separate page

**Gap severity:** MAJOR
**File:** [talent-flow.routes.ts](hr-portal/src/app/features/talent-flow/talent-flow.routes.ts)

---

## S1 — Summary Table

| ID | Decision | Gap | Severity |
|----|----------|-----|----------|
| S1-001 | D022 | Shell uses sidebar layout — must be horizontal topbar | CRITICAL |
| S1-002 | D022 | Nav has 3 wrong items — needs Dashboard · Pipeline · Candidates · Offers · Reports | CRITICAL |
| S1-003 | D036 | Add Candidate navigates to full page — must open side drawer | CRITICAL |
| S1-004 | D023 | Ask AI button missing from topbar entirely | CRITICAL |
| S1-005 | D017 | Bell notification badge missing, notifications disabled | MAJOR |
| S1-006 | D022 | Role pill and avatar missing from topbar | ALIGNMENT |
| S1-007 | D022/D036/D059/D046 | 3 routes missing, 2 routes present that should not exist | MAJOR |

---

---

# SECTION 2 — TA DASHBOARD

**Decisions audited:** D016, D020, D021, D024, D025, D026
**Files read:**
- `hr-portal/src/app/features/talent-flow/pages/dashboard/dashboard-page.component.ts`
- `hr-portal/src/app/features/talent-flow/pages/dashboard/dashboard-page.component.html`

---

## D2-001 — Dashboard layout: single KPI grid + table vs locked 5-zone structure

**Decision:** D020 — Dashboard is a single scrollable page with 5 zones in strict priority order
**What exists:**
- Zone: 4-stat KPI grid (Total Candidates | SLA Breached | Avg Day-1 Score | In Onboarding)
- Zone: One plain HTML `<table>` showing the 10 most recently updated candidates

**What is needed (D020) — 5 zones in this order:**
1. Signal Summary Strip — 4 metric cards (SLA Breaches | At Risk | Acceptance Rate | Active Pipeline)
2. Candidates at Risk — max 2 candidate cards + "View all X →" link
3. My Actions Today — max 3 action items + "View all →" link
4. Pipeline Summary — counts + health dots only, no candidate names (D025)
5. This Month — 3 stat cards (Offers sent | Avg interview-to-offer | Hesitant acceptances)

**Gap severity:** CRITICAL
**The entire dashboard must be rebuilt.** The current layout is not a subset of the locked design — it is a different design entirely.
**File:** [dashboard-page.component.html](hr-portal/src/app/features/talent-flow/pages/dashboard/dashboard-page.component.html)

---

## D2-002 — KPI cards show wrong metrics (MVP 2 concepts on MVP 1 screen)

**Decision:** D020 Zone 1 — Signal Summary Strip: SLA Breaches | At Risk | Acceptance Rate | Active Pipeline
**What exists (current 4 KPIs):**
- Total Candidates — acceptable
- SLA Breached — acceptable (maps to Signal Strip "SLA Breaches")
- **Avg Day-1 Score** — Day-1 Readiness is Trigger 6, explicitly MVP 2 (out of scope per Context doc)
- **In Onboarding** — Onboarding is Phase 4, explicitly MVP 2

**What is needed:**
- SLA Breaches (red left border, red value)
- At Risk (amber left border, amber value)
- Acceptance Rate (green left border, green value)
- Active Pipeline (indigo left border, navy value)

**Gap severity:** CRITICAL
**The MVP 2 KPIs must be removed entirely.** Surfacing "Avg Day-1 Score" and "In Onboarding" on a screen
where they cannot yet be populated is misleading and incorrect.
**File:** [dashboard-page.component.ts:48](hr-portal/src/app/features/talent-flow/pages/dashboard/dashboard-page.component.ts#L48)

---

## D2-003 — SLA health label outputs raw internal codes, not health state language

**Decision:** D021 — Signal health language is "Breached" / "At Risk" / "On Track" — never internal codes
**What exists:**
```typescript
// dashboard-page.component.ts:92-94
protected slaLabel(c: Candidate): string {
  return c.slaHealthStatus ?? 'OK';
}
```
This returns the raw DynamoDB value: `'RED'`, `'AMBER'`, `'GREEN'`, or `'OK'`.
The template at line 116 renders this directly: `{{ slaLabel(c) }}`

**What is needed (D021):**
- `'RED'` → pill text: **"BREACHED"**, red background
- `'AMBER'` → pill text: **"AT RISK"**, amber background
- `'GREEN'` → pill text: **"ON TRACK"**, green background
- Never surface `'RED'`, `'AMBER'`, `'GREEN'`, or `'OK'` to the user

**Gap severity:** CRITICAL — D021 hard rule violation
**File:** [dashboard-page.component.ts:92](hr-portal/src/app/features/talent-flow/pages/dashboard/dashboard-page.component.ts#L92)

---

## D2-004 — Dashboard table shows exact timestamps — direct D021 violation

**Decision:** D021 — The platform never surfaces exact time values on the dashboard or candidate cards
**What exists:**
```html
<!-- dashboard-page.component.html:118 -->
<td>{{ c.updatedAt | date:'d MMM HH:mm' }}</td>
```
This renders `"19 May 14:32"` — an exact timestamp on the dashboard.

**What is needed (D021):**
- No exact time values on the dashboard. Ever.
- SLA status communicated in health state language only
- The `updatedAt` column must be removed from the dashboard entirely
- The Activity Log panel (inside the candidate record) is the **only** place timestamps appear (D035)

**Gap severity:** CRITICAL — hard rule violation
**File:** [dashboard-page.component.html:118](hr-portal/src/app/features/talent-flow/pages/dashboard/dashboard-page.component.html#L118)

---

## D2-005 — Dashboard table shows candidate names in bulk — violates D025

**Decision:** D025 — Pipeline Summary zone shows counts and health dots only. No individual candidate names on dashboard (except max 2 cards in Zone 2).
**What exists:**
```html
<!-- dashboard-page.component.html:108-109 -->
<div class="tf-dashboard__candidate-name">{{ c.firstName }} {{ c.lastName }}</div>
<div class="tf-dashboard__candidate-email">{{ c.email }}</div>
```
10 candidates listed by full name and email in a table on the main dashboard.

**What is needed:**
- Zone 2 (Candidates at Risk): max 2 candidate cards using locked card anatomy (D024)
- Zone 4 (Pipeline Summary): health dots + count only — no names, no emails

**Gap severity:** MAJOR
**File:** [dashboard-page.component.html:105](hr-portal/src/app/features/talent-flow/pages/dashboard/dashboard-page.component.html#L105)

---

## D2-006 — Candidate card anatomy not implemented anywhere on dashboard

**Decision:** D024 — Locked candidate card structure for all dashboard cards
**What exists:** Plain HTML table rows — no card component, no avatar, no pills, no stage context.
**What is needed (D024) — every card must show:**
- Avatar initials (colour = urgency: red gradient = breached, amber = at risk, teal/navy = healthy)
- Candidate name + Role pill + Seniority pill + Sentiment pill
- Stage name (right) + Stage context / what is happening (below stage)
- Health pill (Breached / At Risk / On Track) — bottom right
- No exact times on the card. Ever.

**Gap severity:** CRITICAL — the locked card anatomy is the core reusable component across all screens
**File:** Needs new/rebuilt `candidate-card` component — does not exist

---

## D2-007 — Dashboard sorted by recency, not urgency — violates signal-first principle

**Decision:** D016 — TA Dashboard organised by urgency of signal, not by recency or stage
**What exists:**
```typescript
// dashboard-page.component.ts:66-70
protected readonly recentCandidates = computed<Candidate[]>(() =>
  [...this.state.pipeline()]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10),
);
```
Sorted by `updatedAt` descending — most recently modified first.

**What is needed (D016):**
- Zone 2 shows the candidates with worst health status first: Breached → At Risk
- Zone 3 shows actions ordered: Breached → At Risk → Blocked → Pending
- The question the dashboard answers is "What needs me RIGHT NOW?" — not "What changed recently?"

**Gap severity:** CRITICAL
**File:** [dashboard-page.component.ts:66](hr-portal/src/app/features/talent-flow/pages/dashboard/dashboard-page.component.ts#L66)

---

## D2-008 — Zone 3 "My Actions Today" missing entirely

**Decision:** D020 Zone 3 — My Actions Today: max 3 action items, "View all →" link
**What exists:** No actions zone on the dashboard.
**What is needed:**
- Action item: icon square (colour coded by urgency) + action title + description + priority tag
- Priority tags using locked language: Breached / At Risk / Blocked / Pending
- Maximum 3 items visible — "View all →" link handles overflow

**Gap severity:** MAJOR
**File:** Not present in [dashboard-page.component.html](hr-portal/src/app/features/talent-flow/pages/dashboard/dashboard-page.component.html)

---

## D2-009 — Zone 4 Pipeline Summary with health dots missing entirely

**Decision:** D025 — Pipeline summary: one row per phase, health dots, count — no candidate names
**What exists:** Not present.
**What is needed:**
- One row per pipeline phase (4 phases matching the 12-stage process)
- Phase name + sub-label left | health dots centre | total count right
- Dot colours: red = breached, amber = at risk, green = on track, grey = waiting
- Each row clickable — opens Pipeline filtered to that phase

**Gap severity:** MAJOR — Zone 4 of 5 required zones is entirely absent
**File:** Not present in [dashboard-page.component.html](hr-portal/src/app/features/talent-flow/pages/dashboard/dashboard-page.component.html)

---

## D2 — Summary Table

| ID | Decision | Gap | Severity |
|----|----------|-----|----------|
| D2-001 | D020 | Dashboard is a KPI grid + table — must be 5-zone signal-first layout | CRITICAL |
| D2-002 | D020 | Wrong KPIs: Avg Day-1 Score + In Onboarding are MVP 2 concepts | CRITICAL |
| D2-003 | D021 | SLA label outputs raw 'RED'/'AMBER'/'GREEN'/'OK' — not health language | CRITICAL |
| D2-004 | D021 | Dashboard shows `c.updatedAt` exact timestamp — hard rule violation | CRITICAL |
| D2-005 | D025 | Table lists 10 candidates by name + email — violates no-names-on-dashboard rule | MAJOR |
| D2-006 | D024 | Candidate card anatomy not implemented — plain table row instead | CRITICAL |
| D2-007 | D016 | Sorted by updatedAt recency — must be urgency-first (Breached → At Risk) | CRITICAL |
| D2-008 | D020 | Zone 3 "My Actions Today" completely absent | MAJOR |
| D2-009 | D025 | Zone 4 Pipeline Summary with health dots completely absent | MAJOR |

---

---

# SECTION 3 — SLA TIMER WIDGET & SIGNAL HEALTH LANGUAGE

**Decisions audited:** D010, D021
**Files read:**
- `hr-portal/src/app/features/talent-flow/components/sla-timer-widget/sla-timer-widget.component.ts`
- `hr-portal/src/app/features/talent-flow/components/sla-timer-widget/sla-timer-widget.component.html`
- `hr-portal/src/app/features/talent-flow/components/sla-timer-widget/sla-timer-widget.component.scss`

---

## S3-001 — SLA timer widget displays exact time values — hardest D021 violation in the codebase

**Decision:** D021 — The platform NEVER surfaces exact time values anywhere. "6h 12m remaining" and "2 days overdue" are explicitly named as forbidden.
**What exists:**
```html
<!-- sla-timer-widget.component.html:17-25 -->
@if (timerState().status === 'BREACHED') {
  <p class="tf-sla-timer__time tf-sla-timer__time--breached">
    BREACHED &mdash; {{ timerState().breachedDuration }}
  </p>
} @else {
  <p class="tf-sla-timer__time">
    {{ timerState().hoursRemaining }}h {{ timerState().minutesRemaining }}m remaining
  </p>
}
```
This renders exactly what D021 forbids:
- `"14h 23m remaining"` when on track
- `"BREACHED — 2h 45m overdue"` when breached

The `TimerState` interface in the `.ts` file explicitly computes `hoursRemaining`, `minutesRemaining`, and `breachedDuration` — all exact time values.

**What is needed (D021 + D010):**
- The SLA bar is **visual only** — fill percentage from the 50/75/100 model. No numbers. No time labels. Ever.
- The component should output only:
  - A filled progress bar (percentage fill derived from elapsed/total)
  - A health state pill: "On Track" / "At Risk" / "Breached"
  - The pill colour: green / amber / red
- `TimerState.hoursRemaining`, `TimerState.minutesRemaining`, `TimerState.breachedDuration` must be removed from the interface and the computed function

**Gap severity:** CRITICAL — this is the most direct and explicit violation of D021 in the entire codebase. The widget actively does the exact thing D021 says never to do.
**File (TypeScript):** [sla-timer-widget.component.ts:88-103](hr-portal/src/app/features/talent-flow/components/sla-timer-widget/sla-timer-widget.component.ts#L88)
**File (Template):** [sla-timer-widget.component.html:17-25](hr-portal/src/app/features/talent-flow/components/sla-timer-widget/sla-timer-widget.component.html#L17)

---

## S3-002 — SLA threshold model does not follow the 50/75/100 percentage model

**Decision:** D010 — Universal Risk Timer Model: 50% = Nudge, 75% = At Risk (amber), 100% = Breached (red). All thresholds are configurable per tenant, read from config.
**What exists:**
```typescript
// sla-timer-widget.component.ts:77-86
if (remainingMs <= 0) {
  status = 'BREACHED';
} else if (percentRemaining <= 25) {    // ← 75% elapsed
  status = 'RED';
} else if (percentRemaining <= 50) {    // ← 50% elapsed
  status = 'AMBER';
} else {
  status = 'GREEN';
}
```
The thresholds are hardcoded as `percentRemaining <= 25` (RED) and `percentRemaining <= 50` (AMBER).

**Issues:**
1. Thresholds are **hardcoded** — D008 and D010 require them to be configurable per tenant from the config table
2. The status uses internal codes `'RED'`, `'AMBER'`, `'GREEN'` — not the health state language
3. The 50% threshold per D010 triggers a "Nudge" (notification only) — the widget treats it as a visible colour change. The visual change should begin at 75% elapsed (At Risk), not 50%.

**What is needed:**
- Thresholds read from `SLA_THRESHOLDS` config via `TalentFlowApiService.getConfig('SLA_THRESHOLDS')`
- Default: 75% elapsed = At Risk (amber), 100% elapsed = Breached (red)
- 50% elapsed = nudge (notification only — no visual change on bar)
- Status language: `'On Track'` / `'At Risk'` / `'Breached'` — not `'GREEN'` / `'AMBER'` / `'RED'`

**Gap severity:** CRITICAL
**File:** [sla-timer-widget.component.ts:77](hr-portal/src/app/features/talent-flow/components/sla-timer-widget/sla-timer-widget.component.ts#L77)

---

## S3-003 — SLA threshold passed as a hardcoded prop — not config-driven

**Decision:** D008 — SLA timeframes per stage must be configurable at tenant admin level without code changes
**What exists:**
```html
<!-- candidate-workspace-page.component.html:49-52 -->
<tf-sla-timer
  [stageEnteredAt]="toDate(c.updatedAt)"
  [thresholdHours]="defaultThreshold"
  slaLabel="Stage SLA" />
```
```typescript
// candidate-workspace-page.component.ts:164
protected readonly defaultThreshold = 72;
```
The threshold is hardcoded to 72 hours in the component that uses it. The pipeline page also uses this same `defaultThreshold = 72`.

**What is needed (D008):**
- SLA threshold resolved from `SLA_THRESHOLDS` config for each stage, per tenant
- Not hardcoded in any component
- The config lookup: `getConfig('SLA_THRESHOLDS')` → stage-specific SLA window in hours

**Gap severity:** CRITICAL — hardcoded business rules that D008 explicitly requires to be tenant-configurable
**File:** [candidate-workspace-page.component.ts:164](hr-portal/src/app/features/talent-flow/pages/candidate-workspace/candidate-workspace-page.component.ts#L164)

---

## S3-004 — SLA bar progress bar uses percentage display — this part is correct

**Decision:** D021 — SLA bar is visual fill only (percentage)
**What exists:**
```html
<!-- sla-timer-widget.component.html:28-33 -->
<div class="tf-sla-timer__bar" role="progressbar"
     [attr.aria-valuenow]="timerState().percentElapsed">
  <div class="tf-sla-timer__bar-fill"
       [style.width.%]="timerState().percentElapsed"></div>
</div>
```
The bar fills by percentage. This is the correct pattern for D021.

**Status:** COMPLIANT — keep the bar fill mechanism. Remove only the text time display above it.

---

## S3 — Summary Table

| ID | Decision | Gap | Severity |
|----|----------|-----|----------|
| S3-001 | D021 | Timer renders "14h 23m remaining" and "2h 45m overdue" — exact forbidden strings | CRITICAL |
| S3-002 | D010 | Thresholds hardcoded (25%/50% remaining) and use wrong internal codes | CRITICAL |
| S3-003 | D008 | SLA threshold is `72` hours hardcoded in consuming components — not config-driven | CRITICAL |
| S3-004 | D021 | Progress bar fill by % is correct — keep this pattern | COMPLIANT |

---

---

# SECTION 4 — PIPELINE PAGE

**Decisions audited:** D052, D053, D054, D055, D056, D057, D058, D021
**Files read:**
- `hr-portal/src/app/features/talent-flow/pages/pipeline/pipeline-page.component.ts`
- `hr-portal/src/app/features/talent-flow/pages/pipeline/pipeline-page.component.html`

---

## P4-001 — Pipeline is Kanban-only — List view (required default) is missing

**Decision:** D053 — Pipeline supports two display modes: List view (default) and Kanban view. Toggle between them via a two-button toggle top-right.
**What exists:**
- Only a Kanban board is implemented
- The eyebrow text in the header even says `"TalentFlow · Kanban"`
- No List/Kanban toggle control anywhere

**What is needed (D053):**
- **List view is the default** — full-width table with candidates as rows
- Kanban view is the alternative — columns per pipeline phase (4 columns, not 11)
- Two-button toggle top-right: List / Kanban. Active: white background + indigo text + card shadow. Inactive: transparent + muted text.

**Gap severity:** CRITICAL — the default view is completely missing
**File:** [pipeline-page.component.html:65](hr-portal/src/app/features/talent-flow/pages/pipeline/pipeline-page.component.html#L65)

---

## P4-002 — Kanban has 11 stage columns — required is 4 phase columns

**Decision:** D057 — Kanban columns are per pipeline **phase** (Interview · Offer Stage · Accepted · Pre-Onboarding). Not per individual stage.
**What exists:**
```typescript
// pipeline-page.component.ts:33-45
export const KANBAN_STAGES: HiringStage[] = [
  'APPLICATION_REVIEW', 'PHONE_SCREENING', 'TECHNICAL_INTERVIEW',
  'PANEL_INTERVIEW', 'EVALUATION', 'OFFER_PREPARATION',
  'OFFER_APPROVAL', 'OFFER_DELIVERY', 'CONTRACT_SIGNING',
  'PRE_BOARDING', 'ONBOARDING',
];
```
11 columns, one per granular stage.

**What is needed (D057):**
- 4 columns: Interview & Evaluation | Offer Stage | Accepted | Pre-Onboarding
- Kanban cards show: candidate name, role, sentiment pill, health dot — nothing else (D057)
- Left border colour on card: red = breached, amber = at risk, green = on track (D057)
- No drag-and-drop (D057 explicitly: "No drag-and-drop — stage transitions are workflow-gated, not manual")
- "+N more" link if overflow — no scroll within columns

**Gap severity:** CRITICAL — Kanban structure fundamentally wrong
**File:** [pipeline-page.component.ts:33](hr-portal/src/app/features/talent-flow/pages/pipeline/pipeline-page.component.ts#L33)

---

## P4-003 — Filter bar does not match the locked 5-group filter specification

**Decision:** D054 — Persistent filter bar with 5 filter groups: Stage | Health | Seniority | Hiring Manager | Sentiment
**What exists:**
- A search input (free text)
- SLA filter buttons: All | Green | Amber | Red (4 buttons — raw colour codes, wrong labels)

**What is needed (D054):**
1. **Stage** chips: All stages · Interview · Offer Stage · Accepted · Pre-Onboarding
2. **Health** chips: Breached · At Risk · On Track (coloured when active — not raw colour codes)
3. **Seniority** chips: Junior · Mid · Senior
4. **Hiring Manager** chips: All HMs · individual HM names
5. **Sentiment** chips: Hesitant · Reluctant (risk sentiments only)
6. "Clear all" link at end
7. Chips separated by vertical dividers between groups
8. Active health chip colours: Breached = error background, At Risk = warning background

**Gap severity:** CRITICAL — 3 of 5 filter groups are entirely absent; existing filters use wrong labels
**File:** [pipeline-page.component.html:19](hr-portal/src/app/features/talent-flow/pages/pipeline/pipeline-page.component.html#L19)

---

## P4-004 — Filter labels use raw colour codes — D021 violation in filter controls

**Decision:** D021 — Signal health language only; never raw colour codes
**What exists:**
```html
<!-- pipeline-page.component.html:37-53 -->
<button ... (click)="setSlaFilter('GREEN')">
  <i class="pi pi-check-circle"></i> Green
</button>
<button ... (click)="setSlaFilter('AMBER')">
  <i class="pi pi-clock"></i> Amber
</button>
<button ... (click)="setSlaFilter('RED')">
  <i class="pi pi-times-circle"></i> Red
</button>
```
The filter buttons are labelled "Green", "Amber", "Red" — raw colour names.

**What is needed (D054 + D021):**
- "Breached" (not "Red")
- "At Risk" (not "Amber")
- "On Track" (not "Green")

**Gap severity:** CRITICAL — D021 hard rule. Colour names must never be surfaced.
**File:** [pipeline-page.component.html:37](hr-portal/src/app/features/talent-flow/pages/pipeline/pipeline-page.component.html#L37)

---

## P4-005 — Results bar missing entirely

**Decision:** D055 — Results bar between filter bar and content: "Showing X candidates · Y breached · Z at risk" + sort dropdown
**What exists:** No results bar. No candidate count. No sort control.
**What is needed (D055):**
- Left: "Showing X candidates · Y breached · Z at risk" — count bold, health summary muted
- Right: sort dropdown with options: Health worst first (default) | Stage | Name A–Z | Applied date | Hiring Manager

**Gap severity:** MAJOR
**File:** Not present in [pipeline-page.component.html](hr-portal/src/app/features/talent-flow/pages/pipeline/pipeline-page.component.html)

---

## P4-006 — No default sort: health worst first

**Decision:** D058 — Default sort is Health worst first: Breached → At Risk → On Track. Resets to this on page load.
**What exists:**
```typescript
// pipeline-page.component.ts:70-88
protected readonly filteredPipeline = computed<Candidate[]>(() => {
  let list = this.state.pipeline();
  // ... filter by slaFilter and searchQuery only
  return list;  // no sort applied
});
```
No sort is applied. Candidates appear in the order returned by the API.

**What is needed (D058):**
- Default sort: slaHealthStatus — RED/Breached first, AMBER/At Risk second, GREEN/On Track last
- Sort resets on page load
- User can change sort per session via the results bar sort dropdown

**Gap severity:** CRITICAL — the core operational purpose of the pipeline view is to surface highest-risk candidates first
**File:** [pipeline-page.component.ts:70](hr-portal/src/app/features/talent-flow/pages/pipeline/pipeline-page.component.ts#L70)

---

## P4-007 — SLA timer widget on each Kanban card outputs exact times — D021 violation

**Decision:** D021 — No exact time values on candidate cards or pipeline
**What exists:**
```html
<!-- pipeline-page.component.html:81-84 -->
<tf-sla-timer
  [stageEnteredAt]="toDate(c.updatedAt)"
  [thresholdHours]="defaultThreshold" />
```
Each Kanban card renders the full `SlaTimerWidget` which displays "14h 23m remaining" — exact forbidden strings. This is the S3-001 violation multiplied across every card in the pipeline.

**What is needed (D057):**
- Kanban cards show: name, role, sentiment pill, **health dot** only
- Health dot = coloured circle (red/amber/green) — no text, no bar, no time
- The detailed SLA bar belongs only in the candidate record header

**Gap severity:** CRITICAL
**File:** [pipeline-page.component.html:81](hr-portal/src/app/features/talent-flow/pages/pipeline/pipeline-page.component.html#L81)

---

## P4-008 — List view table columns not defined (view doesn't exist yet)

**Decision:** D056 — List view has 7 columns in locked order: Candidate | Stage | Sentiment | Seniority | Hiring Manager | SLA Health | Action
**What exists:** List view does not exist.
**What is needed (D056):**
- Column 1: Avatar + name + role (avatar colour coded by urgency)
- Column 2: Stage — current stage name, plain text
- Column 3: Sentiment pill — colour coded
- Column 4: Seniority pill — indigo/blue tones
- Column 5: HM — initials avatar + name (small, secondary)
- Column 6: SLA Health — health pill + SLA bar (no numbers)
- Column 7: Action — "View" ghost button
- Header row: surface-low background, 9px uppercase labels
- Row hover: subtle indigo tint
- No checkbox column for MVP 1

**Gap severity:** MAJOR — entire view to be built
**File:** Not present in pipeline

---

## P4 — Summary Table

| ID | Decision | Gap | Severity |
|----|----------|-----|----------|
| P4-001 | D053 | List view (required default) completely missing — Kanban only | CRITICAL |
| P4-002 | D057 | Kanban has 11 stage columns — must be 4 phase columns | CRITICAL |
| P4-003 | D054 | Filter bar has 2 controls — needs 5 filter groups per spec | CRITICAL |
| P4-004 | D021 | Filter labels show "Green"/"Amber"/"Red" — must be health state language | CRITICAL |
| P4-005 | D055 | Results bar (candidate count + sort dropdown) completely missing | MAJOR |
| P4-006 | D058 | No sort applied — must default to health worst first | CRITICAL |
| P4-007 | D021 | SLA timer widget on each card renders exact times — hard rule violation | CRITICAL |
| P4-008 | D056 | List view 7-column table not defined (view doesn't exist) | MAJOR |

---

---

# SECTION 5 — CANDIDATE RECORD (WORKSPACE)

**Decisions audited:** D027, D028, D029, D030, D031, D032, D033, D034, D035, D023
**Files read:**
- `hr-portal/src/app/features/talent-flow/pages/candidate-workspace/candidate-workspace-page.component.html`
- `hr-portal/src/app/features/talent-flow/pages/candidate-workspace/candidate-workspace-page.component.ts`
- `hr-portal/src/app/features/talent-flow/components/candidate-identity-card/candidate-identity-card.component.ts`
- `hr-portal/src/app/features/talent-flow/components/candidate-identity-card/candidate-identity-card.component.html`

---

## W5-001 — Layout is left-rail + right-panel — must be header + tabs + activity log

**Decision:** D027, D028, D030, D031, D035 — Candidate record has a specific top-to-bottom layout:
1. Breadcrumb
2. Persistent header (avatar + name + pills + stage + health pill + SLA bar + Reject button)
3. Details strip (5 columns)
4. Four-phase indicator
5. Actions bar
6. Tab bar (fixed 5 tabs)
7. Two-column content: tab content (left) + Activity Log panel (268px right, always visible)

**What exists:**
- Left rail (`<aside class="tf-workspace__rail">`) containing identity card + SLA timer + stage stepper
- Right panel (`<main class="tf-workspace__main">`) containing tab nav + tab content
- No breadcrumb
- No details strip
- No four-phase indicator
- No actions bar
- No persistent right-side activity log panel
- Stage stepper is a generic vertical step list (`tf-stage-selector`) — not the locked 4-phase indicator

**Gap severity:** CRITICAL — the entire page layout must be rebuilt
**File:** [candidate-workspace-page.component.html:37](hr-portal/src/app/features/talent-flow/pages/candidate-workspace/candidate-workspace-page.component.html#L37)

---

## W5-002 — Tabs: 3 present vs 5 required, wrong tab names

**Decision:** D027 — Fixed tabs always present in this order: Overview | Interviews | Offer | Engagement | Notes
**What exists:**
```html
<!-- candidate-workspace-page.component.html:70-89 -->
Tab 1: Overview    ← exists, different content
Tab 2: Timeline    ← wrong: should be part of the right-side Activity Log panel (D035), not a tab
Tab 3: Panel Votes ← wrong: should be "Interviews" tab with the locked interview rounds layout (D033)
```

**What is needed (D027):**
- Tab 1: Overview — candidate details, phase progress, signal intelligence box
- Tab 2: Interviews — all interview rounds (collapsed/expanded per D033) + sentiment selector (D034)
- Tab 3: Offer — offer lifecycle (D064-D071) — state navigator + 4 state blocks
- Tab 4: Engagement — sentiment history, engagement log
- Tab 5: Notes — free text notes, TA observations
- Tab active state: indigo bottom border + indigo text
- Tab inactive: muted grey text, no border
- Tabs have text labels only — no icons (D027 spec)

**Note:** "Timeline" is the Activity Log panel from D035 — it should be a **persistent right-side panel** (268px, always visible alongside tab content), not a tab.

**Gap severity:** CRITICAL — structural mismatch
**File:** [candidate-workspace-page.component.html:70](hr-portal/src/app/features/talent-flow/pages/candidate-workspace/candidate-workspace-page.component.html#L70)

---

## W5-003 — Persistent header missing: no Reject button, no SLA bar, no health pill in header

**Decision:** D028 — Persistent header always shows: avatar + name + pills row + current stage + health pill + SLA bar + Reject Candidate button (header only)
**What exists:**
- `CandidateIdentityCardComponent` shows: avatar + name + role + positionLevel + experience + applied date + source + email + phone
- SLA timer is a separate widget below in the left rail — not in the header
- No Reject Candidate button anywhere in the workspace
- No health pill in the header area

**What is needed (D028):**
- Reject Candidate button: subtle red text, light red border — **in the persistent header only**
- D031: "Reject Candidate is NOT in the actions bar — lives in candidate header only"
- SLA health bar: visual fill, in the header right area — no numbers
- Health pill (Breached / At Risk / On Track) — header right
- Current stage name — header right

**Gap severity:** CRITICAL — Reject button placement is a hard product decision (D018 + D031)
**File:** [candidate-workspace-page.component.html:44](hr-portal/src/app/features/talent-flow/pages/candidate-workspace/candidate-workspace-page.component.html#L44)

---

## W5-004 — Details strip (5 columns) completely missing

**Decision:** D029 — Compact horizontal strip below header: Applied date · Department · Location · Workflow template · Seniority. 5 equal columns, 9px uppercase labels, 12px medium values.
**What exists:** Not present. Department, Location, and Workflow template are not surfaced anywhere on the candidate record.
**What is needed:** 5-column strip rendering these 5 candidate data fields horizontally. No borders — tonal shift only.
**Note:** The current `Candidate` model also **lacks `department` and `location` fields** (see Section 7 — Models audit).
**Gap severity:** MAJOR
**File:** Not present in [candidate-workspace-page.component.html](hr-portal/src/app/features/talent-flow/pages/candidate-workspace/candidate-workspace-page.component.html)

---

## W5-005 — Four-phase indicator missing — replaced by an 11-stage stepper

**Decision:** D030 — Horizontal four-phase progress indicator showing 4 phases with short descriptions, not stage numbers
**What exists:**
```html
<!-- candidate-workspace-page.component.html:57-62 -->
<tf-stage-selector
  [stages]="allStages"       <!-- 11 individual stages -->
  [currentStage]="c.currentStage"
  [readonly]="true" />
```
An 11-step vertical stepper showing every granular stage by its internal key.

**What is needed (D030):**
- 4 horizontal phase dots: Interview & Evaluation · Offer & Acceptance · Pre-Onboarding · Onboarding & Day 1
- Each phase has a short description below the name
- States: completed (green tick) | active (indigo dot + glow ring) | pending (grey)
- Phase dots 22px diameter, connector line between phases
- No stage numbers — descriptions replace them

**Gap severity:** CRITICAL — the 4-phase model is the locked process representation (directly tied to D030 and the 12-stage process)
**File:** [candidate-workspace-page.component.html:57](hr-portal/src/app/features/talent-flow/pages/candidate-workspace/candidate-workspace-page.component.html#L57)

---

## W5-006 — Actions bar missing — stage-contextual ghost pill buttons not implemented

**Decision:** D031 — Dedicated actions bar between phase indicator and tab bar. All buttons identical ghost style, pill shape, icon left of label, stage-contextual.
**What exists:**
- Interview scheduling is an inline expanded form inside the Overview tab
- Stage advancement is an inline card inside the Overview tab
- These are functional but do not match the locked actions bar pattern

**What is needed (D031):**
- Dedicated horizontal actions bar: transparent bg, outline border, pill shape, 11px icon + 11px label
- Hover: surface-low background + indigo text + indigo border
- Actions are stage-contextual — different set for each stage
- Example for Interview Loop: Schedule Interview · Update Sentiment · Log Panel Score · Add Panel Member · Send Scoring Link · View All Stages
- No size hierarchy — all buttons equal

**Gap severity:** ALIGNMENT — the actions exist but are buried in tab content instead of the dedicated bar
**File:** [candidate-workspace-page.component.html:165](hr-portal/src/app/features/talent-flow/pages/candidate-workspace/candidate-workspace-page.component.html#L165)

---

## W5-007 — Signal Intelligence box not implemented anywhere

**Decision:** D032 — Signal Intelligence box appears at every trigger point when there is an active risk signal. Subtle indigo tinted background, "Signal Intelligence" eyebrow, 1-2 specific sentences, never generic, only shown when risk present.
**What exists:** No Signal Intelligence box anywhere in the workspace.
**What is needed:** Every tab content area opens with this box when there is an active risk. It is the Golden Truth made visible — "what needs action and why" in plain language. Not generic. Candidate and stage specific.
**Gap severity:** CRITICAL — this is a core product differentiator (D009, D032)
**File:** Not present in any component

---

## W5-008 — Activity Log is a tab (Timeline), not a persistent right panel

**Decision:** D035 — Persistent right-side panel (268px wide), always visible alongside tab content. Chronological feed with filter chips (All · Interviews · Scores · Sentiment). Timestamps appear here only (explicit audit view).
**What exists:**
- "Timeline" tab — switching to it replaces the entire content area
- Only accessible when that tab is active — not always visible

**What is needed (D035):**
- Always-visible 268px right panel alongside whatever tab is active
- Header: "Activity Log" in 11px uppercase Manrope
- Filter chips: All · Interviews · Scores · Sentiment (text only, no icons)
- Chronological feed, newest first: coloured dot + connector line + event + who + when
- Timestamps shown here — this is the only place they appear on this screen

**Gap severity:** MAJOR — layout structure wrong; the timeline visibility must not depend on tab selection
**File:** [candidate-workspace-page.component.html:300](hr-portal/src/app/features/talent-flow/pages/candidate-workspace/candidate-workspace-page.component.html#L300)

---

## W5-009 — Ask AI button on workspace page — must be in topbar only

**Decision:** D023 — AI assistant lives in the top navigation bar as "Ask AI" button. NOT a floating button. Same button visible on every screen.
**What exists:**
```html
<!-- candidate-workspace-page.component.html:11-16 -->
<button pButton
  class="p-button-outlined p-button-sm tf-workspace__ai-btn"
  icon="pi pi-sparkles"
  label="Ask AI"
  (click)="toggleChat()">
</button>
```
A separate "Ask AI" button inside the workspace page navigation bar — not in the topbar shell.

**What is needed (D023):**
- Remove the workspace-level Ask AI button
- The topbar Ask AI button (to be added in S1-004) opens the AI panel globally
- The AI panel receives `candidateId` context from the current route, not from a per-page toggle

**Gap severity:** CRITICAL — D023 explicitly says "NOT a floating button"
**File:** [candidate-workspace-page.component.html:11](hr-portal/src/app/features/talent-flow/pages/candidate-workspace/candidate-workspace-page.component.html#L11)

---

## W5-010 — Candidate identity card: sentiment chip uses wrong model field

**Decision:** D034 — Sentiment selector uses the candidate's interview sentiment (D007): Very Interested | Interested | Neutral | Hesitant | Disengaged (configurable per tenant). This is the TA-captured sentiment at Stage 1.
**What exists:**
```typescript
// candidate-identity-card.component.ts:67-76
readonly sentimentChip = computed(() => {
  const s = this.candidate().acceptanceSentiment;  // ← wrong field
  const map = {
    HESITANT: ..., NEUTRAL: ..., AT_RISK: ...
  };
});
```
The card reads `acceptanceSentiment` (Trigger 4 — offer acceptance sentiment) for the chip.
The interview-stage sentiment (Trigger 1/2) is a different field that does not exist in the current model.

**What is needed:**
- Sentiment chip should reflect the current active trigger's sentiment
- During interview stage: display Stage 1 TA-captured sentiment (D007)
- During offer stage: display acceptance sentiment (D013/D070)
- The `Candidate` model needs a `sentiment` field (or `candidateEngagementSentiment`) for Triggers 1-2
- `AT_RISK` is not a valid sentiment value per any decision — it is a health state, not a sentiment

**Gap severity:** CRITICAL — wrong data field driving a visible UI component
**File:** [candidate-identity-card.component.ts:67](hr-portal/src/app/features/talent-flow/components/candidate-identity-card/candidate-identity-card.component.ts#L67)

---

## W5 — Summary Table

| ID | Decision | Gap | Severity |
|----|----------|-----|----------|
| W5-001 | D027/D028/D030/D031/D035 | Entire layout wrong — left-rail + panel vs locked header/tabs/activity-log | CRITICAL |
| W5-002 | D027 | Wrong tabs: 3 present (Overview/Timeline/Panel Votes) vs 5 required | CRITICAL |
| W5-003 | D028/D031 | No Reject button, no health pill, no SLA bar in persistent header | CRITICAL |
| W5-004 | D029 | Details strip (5 columns) completely missing | MAJOR |
| W5-005 | D030 | 11-stage vertical stepper vs locked 4-phase horizontal indicator | CRITICAL |
| W5-006 | D031 | Actions bar missing — stage actions are inline forms in tab content | ALIGNMENT |
| W5-007 | D032/D009 | Signal Intelligence box not implemented anywhere | CRITICAL |
| W5-008 | D035 | Activity Log is a tab (Timeline) not a persistent 268px right panel | MAJOR |
| W5-009 | D023 | Per-page Ask AI button exists — must be topbar only | CRITICAL |
| W5-010 | D007/D034 | Identity card reads `acceptanceSentiment` (wrong field + wrong values) | CRITICAL |

---

---

# SECTION 6 — MISSING PAGES & ADD CANDIDATE DRAWER

**Decisions audited:** D019, D036, D037, D038, D039, D040, D041, D044–D051, D059–D063, D064–D071
**Files read:**
- `hr-portal/src/app/features/talent-flow/pages/candidate-create/candidate-create-page.component.ts`
- `hr-portal/src/app/features/talent-flow/pages/candidate-create/candidate-create-page.component.html`
- `hr-portal/src/app/features/talent-flow/pages/evaluation/evaluation-page.component.ts`
- `hr-portal/src/app/features/talent-flow/talent-flow.routes.ts`
- Directory listing: `/pages/` — confirmed no `candidates/`, `hm-dashboard/`, or `offers/` folders exist

---

## A6-001 — Add Candidate is a full routed page — must be a 480px side drawer

**Decision:** D036 — Add Candidate opens as a side drawer (480px wide, slides from right). Page behind stays visible and dimmed. No navigation away from the current screen.
**What exists:**
- `CandidateCreatePageComponent` is a standalone full-page route at `/candidates/new`
- Renders a full-width `<section class="tf-create">` with header, form card, and footer — a complete page
- `cancel()` navigates back to `/platform/talentflow/pipeline`
- `onNewCandidate()` in the shell navigates: `router.navigate(['/platform/talentflow/candidates/new'])`

**What is needed (D036):**
- No `/candidates/new` route — Add Candidate is a drawer triggered from the topbar "Add Candidate" button
- `p-drawer` (PrimeNG 19) component: `position="right"`, `[style.width]="'480px'"`
- Page behind stays fully rendered and interactive (except input focus)
- On successful creation: drawer closes + navigates to new candidate record
- The `CandidateCreatePageComponent` must be converted to a drawer component, not a page

**Gap severity:** CRITICAL — drawer vs full-page is a hard architectural decision (D036)
**File:** [candidate-create-page.component.ts:122](hr-portal/src/app/features/talent-flow/pages/candidate-create/candidate-create-page.component.ts#L122)

---

## A6-002 — Seniority uses a dropdown — must be 3-card visual selector, and includes DIRECTOR (D039 + D019)

**Decision:** D039 — Seniority must be a 3-card visual selector (one card per level, not a dropdown). D019 — Only 3 seniority levels: JUNIOR / MID / SENIOR.
**What exists:**
```typescript
// candidate-create-page.component.ts:31-36
const POSITION_LEVELS: { label: string; value: PositionLevel }[] = [
  { label: 'Junior',   value: 'JUNIOR' },
  { label: 'Mid',      value: 'MID' },
  { label: 'Senior',   value: 'SENIOR' },
  { label: 'Director', value: 'DIRECTOR' },   // ← D019 violation
];
```
Rendered as a `p-dropdown` in the template (line 70-78).

**What is needed (D039 + D019):**
- 3 clickable cards in a row: Junior | Mid | Senior
- Each card: level name (bold) + short description (e.g. "Entry level, 0–3 years") + SLA note
- Selected state: indigo border + light indigo background
- DIRECTOR removed entirely — it does not exist in MVP 1

**Gap severity:** CRITICAL — D039 names this as "3-card visual selector" and D019 removes DIRECTOR
**File:** [candidate-create-page.component.ts:31](hr-portal/src/app/features/talent-flow/pages/candidate-create/candidate-create-page.component.ts#L31)

---

## A6-003 — Workflow template selector absent from Add Candidate form (D040)

**Decision:** D040 — Workflow template must be a 2-card visual selector: Standard | Fast-Track. Each card shows a brief description of the workflow.
**What exists:**
- `CreateCandidatePayload` has `workflowTemplateId?: string`
- The form has no workflow template control at all — the field is never captured

**What is needed (D040):**
- 2-card selector: Standard (default) | Fast-Track
- Standard: "Full interview loop, panel scoring, standard approval chain"
- Fast-Track: "Compressed loop, expedited approval — for urgent hires only"
- `workflowTemplateId` sent to `createCandidate` API call
- Cards follow same visual pattern as seniority cards (D039)

**Gap severity:** MAJOR — required field is never captured
**File:** [candidate-create-page.component.html](hr-portal/src/app/features/talent-flow/pages/candidate-create/candidate-create-page.component.html)

---

## A6-004 — Form has 1 section — requires 2 sections including Interview Setup (D037)

**Decision:** D037 — Single continuous form with 2 sections: (1) Candidate Profile, (2) Interview Setup. A clear section divider with label separates them.
**What exists:**
- 4 rows of form fields covering name, contact, role/level, experience/source
- This covers Section 1 (Candidate Profile) partially — no Section 2 at all

**What is needed (D037) — Section 2: Interview Setup:**
- Interview type selector: Phone Screen | Technical | Behavioral | Culture Fit | Final
- Hiring Manager assignment: search/select from HM list
- First interview date/time picker
- Section divider between Section 1 and Section 2 with "Interview Setup" label

**Gap severity:** MAJOR — half the form is missing
**File:** [candidate-create-page.component.html](hr-portal/src/app/features/talent-flow/pages/candidate-create/candidate-create-page.component.html)

---

## A6-005 — No data completeness progress bar (D038)

**Decision:** D038 — Completeness progress bar below the drawer header. Fills as required fields are completed. Shows percentage complete.
**What exists:** No completeness bar anywhere in the form.
**What is needed:** `p-progressbar` or custom bar below the drawer header, computing fill from required field completion count.
**Gap severity:** ALIGNMENT
**File:** Not present in [candidate-create-page.component.html](hr-portal/src/app/features/talent-flow/pages/candidate-create/candidate-create-page.component.html)

---

## A6-006 — Add Candidate footer actions have wrong labels and not fixed position (D041)

**Decision:** D041 — Footer always fixed at bottom of drawer: Cancel (ghost, left) | Create Candidate Record (teal, right). Exact label required.
**What exists:**
- `<div class="tf-create__actions">` at the bottom of the form card — not fixed position
- Buttons: `label="Cancel"` + `label="Create Candidate"` — label is wrong
- Footer scrolls away with the form content

**What is needed (D041):**
- Fixed-position footer, always visible at drawer bottom, even when form is scrolled
- Cancel: ghost style (no fill, no border) on the left
- "Create Candidate Record" — exact label, teal solid pill, right side
- D041 names this label exactly — do not shorten it

**Gap severity:** ALIGNMENT
**File:** [candidate-create-page.component.html:122](hr-portal/src/app/features/talent-flow/pages/candidate-create/candidate-create-page.component.html#L122)

---

## A6-007 — Department and Location fields absent from Add Candidate form

**Decision:** D029 — Details strip in candidate record has 5 columns: Applied · Department · Location · Workflow · Seniority. These must be captured at creation.
**What exists:**
- Form captures: name, email, phone, role, positionLevel, experienceYears, source
- No department field. No location field.
- The `Candidate` model also has no `department` or `location` fields (see Section 7)

**What is needed:**
- Department field: free text or dropdown of departments (from config)
- Location field: free text (city/country or remote)
- Both fields added to `CreateCandidatePayload` and `Candidate` model

**Gap severity:** MAJOR — data that must be captured at creation is not captured at all
**File:** [candidate-create-page.component.ts:72](hr-portal/src/app/features/talent-flow/pages/candidate-create/candidate-create-page.component.ts#L72)

---

## A6-008 — Candidates View: Page and route completely missing (D059–D063)

**Decision:** D059 — Candidates view is a search-first interface distinct from the Pipeline (which is triage-first). D060 — Real-time search, min 2 chars. D061 — Recently viewed: 4 cards in a grid when no search is active.
**What exists:**
- No `CandidatesPageComponent` of any kind
- No route for `/candidates` in `talent-flow.routes.ts`
- The nav link "Candidates" (S1-002) has no page to route to

**What is needed (D059–D063):**
- New page: `CandidatesPageComponent`
- Route: `'candidates'` → `CandidatesPageComponent`
- Header: "Candidates" h1 + real-time search input (full width, prominent)
- When no search active: 4 recently-viewed candidate cards in a 2×2 grid (D061)
- When search active (≥ 2 chars): scrollable list of results
- Result row: avatar + name + role + current stage + health dot (D062)
- Click any row → navigate to `candidates/:id` (D063)

**Gap severity:** MAJOR — entire screen is missing
**File:** Not present in [pages/](hr-portal/src/app/features/talent-flow/pages/)

---

## A6-009 — Hiring Manager Dashboard: Page, routes, and role view completely missing (D044–D051)

**Decision:** D044–D051 — HM has a distinct, narrower dashboard. D046 — Route: `/hm-dashboard`. D044 — Navigation: My Tasks · My Candidates · Decisions (3 items only, no Add Candidate). D047 — 3 jobs only: Evaluate · Decide · Engage. D048 — Scoring panel opens inline (not modal, not new page). D049 — 4 sliders: Technical / Communication / Cultural Fit / Problem Solving (1–10). D050 — Vote grid: Strong No / No / Yes / Strong Yes — Yes pre-selected by default.
**What exists:**
- No `HmDashboardPageComponent` of any kind
- No `/hm-dashboard` route
- The existing `EvaluationPageComponent` at `/candidates/:id/evaluate` is a separate routed full page — this violates D048 which requires inline panel
- HM cannot access the platform at all (no role-gated routes exist)

**What is needed (D044–D051):**
- New page: `HmDashboardPageComponent` at route `'hm-dashboard'`
- Shell (topbar) shows 3 nav items for HM role: My Tasks · My Candidates · Decisions
- No Add Candidate button visible to HM users
- My Tasks: list of candidates awaiting HM action (score / vote / engage)
- Scoring panel opens as inline expanded section within the task card — not a drawer, not a route
- `EvaluationPageComponent` at `/candidates/:id/evaluate` should be removed — HM scores inline (D048)
- Vote options: Strong No (1) | No (2) | Yes (3) | Strong Yes (4) — "Yes" pre-selected (D050)
- HM sees only candidates assigned to them (D051)

**Gap severity:** MAJOR — entire HM experience is missing. The current evaluation workaround (separate page) directly violates D048.
**File:** Not present in [pages/](hr-portal/src/app/features/talent-flow/pages/)

---

## A6-010 — Offer Tab: Completely absent inside candidate record (D064–D071)

**Decision:** D064 — Offer lifecycle lives inside the candidate record as Tab 3 ("Offer"). D065 — 4 states in sequence: Offer Created → In Approval → Offer Sent → Accepted. D066 — State navigator at top (read-only). D067 — Only active state is interactive; completed = collapsed read-only; future = dimmed to 0.5 opacity. D070 — Acceptance button label: "Confirm Acceptance & Trigger Workflows" (exact).
**What exists:**
- Candidate workspace has 3 tabs: Overview | Timeline | Panel Votes
- No Offer tab of any kind
- No `Offer` interface in the models file
- No offer-related methods in `TalentFlowApiService`

**What is needed (D064–D071):**
- Tab 3 in candidate record: "Offer"
- State navigator: read-only 4-step progress strip at top of tab
- State 1 (Offer Created): offer fields form — base salary, bonus, equity, start date, benefits
- State 2 (In Approval): approval chain display, who has approved, who is pending (seniority-driven per D069)
- State 3 (Offer Sent): confirmation display, sent timestamp (activity log format)
- State 4 (Accepted): "Confirm Acceptance & Trigger Workflows" button (exact label per D070)
- Completed states: collapsed read-only summary
- Future states: full opacity at 0.5, non-interactive
- Signal Intelligence box if hesitant sentiment or slow candidate response (D071)
- New `Offer`, `ApprovalStep` interfaces needed in models

**Gap severity:** MAJOR — entire offer lifecycle (Triggers 3 + 4) has no frontend
**File:** Not present in [candidate-workspace-page.component.html](hr-portal/src/app/features/talent-flow/pages/candidate-workspace/candidate-workspace-page.component.html)

---

## A6 — Summary Table

| ID | Decision | Gap | Severity |
|----|----------|-----|----------|
| A6-001 | D036 | Add Candidate is a full routed page — must be 480px side drawer | CRITICAL |
| A6-002 | D039/D019 | Seniority uses dropdown + includes DIRECTOR — must be 3-card selector | CRITICAL |
| A6-003 | D040 | Workflow template selector (2-card) absent from form | MAJOR |
| A6-004 | D037 | Form Section 2 (Interview Setup) completely missing | MAJOR |
| A6-005 | D038 | Data completeness progress bar absent | ALIGNMENT |
| A6-006 | D041 | Footer not fixed, wrong button label ("Create Candidate" vs "Create Candidate Record") | ALIGNMENT |
| A6-007 | D029 | Department + Location not captured — missing from form and Candidate model | MAJOR |
| A6-008 | D059–D063 | Candidates View (search-first, recently viewed) completely missing | MAJOR |
| A6-009 | D044–D051 | Hiring Manager Dashboard + inline scoring panel completely missing | MAJOR |
| A6-010 | D064–D071 | Offer Tab (Triggers 3+4) completely absent from candidate record | MAJOR |

---

---

# SECTION 7 — DATA MODELS

**Decisions audited:** D004, D006, D007, D010, D013, D019, D021, D029, D050, D064–D071
**File read:**
- `hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts`

---

## M7-001 — HiringStage: 11 old BRD stage keys do not align to locked 12-stage / 4-phase model

**Decision:** D030, TALENTFLOW_CONTEXT.md — 12 stages across 4 phases. Phases used as the UX grouping across all screens (4-phase indicator, 4 Kanban columns, Pipeline Summary).
**What exists:**
```typescript
export type HiringStage =
  | 'APPLICATION_REVIEW' | 'PHONE_SCREENING' | 'TECHNICAL_INTERVIEW'
  | 'PANEL_INTERVIEW'    | 'EVALUATION'       | 'OFFER_PREPARATION'
  | 'OFFER_APPROVAL'     | 'OFFER_DELIVERY'   | 'CONTRACT_SIGNING'
  | 'PRE_BOARDING'       | 'ONBOARDING';
```
11 granular keys from the old BRD. Comments in the file say "do NOT use BRD values" — yet these are BRD values.

**What is needed:**
- Stage keys must align to the 12-stage locked process (Context doc §12-Stage Process)
- Phase groupings must be codified alongside the stage keys to enable:
  - 4-phase Kanban columns
  - 4-phase horizontal indicator on candidate record (D030)
  - Pipeline Summary health dots per phase (D025)
- A `PHASE_MAP: Record<HiringStage, Phase>` constant is needed to drive all phase-based UI

**Gap severity:** CRITICAL — stage keys drive all state transitions. Misaligned stage keys mean DynamoDB writes use old values and the entire phase model breaks.
**File:** [talent-flow.models.ts:9](hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts#L9)

---

## M7-002 — PositionLevel includes DIRECTOR — must be JUNIOR | MID | SENIOR only (D019)

**Decision:** D019 — Seniority as master configuration parameter. Three levels only: JUNIOR / MID / SENIOR.
**What exists:**
```typescript
export type PositionLevel = 'JUNIOR' | 'MID' | 'SENIOR' | 'DIRECTOR';
```
`DIRECTOR` is used in `POSITION_LEVELS` in `candidate-create-page.component.ts` and is referenced throughout the type system.

**What is needed:**
```typescript
export type PositionLevel = 'JUNIOR' | 'MID' | 'SENIOR';
```
Every reference to `'DIRECTOR'` must be removed from models, components, and APIs.

**Gap severity:** CRITICAL — D019 is a master config parameter that cascades into approval chains, SLA thresholds, and scoring weights. DIRECTOR would create a phantom fourth track.
**File:** [talent-flow.models.ts:44](hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts#L44)

---

## M7-003 — Candidate.acceptanceSentiment has wrong values (includes AT_RISK) and covers only Trigger 4

**Decision:** D007 — Interview sentiment (Triggers 1–2): configurable scale, default: Very Interested | Interested | Neutral | Hesitant | Disengaged. D013/D070 — Acceptance sentiment (Trigger 4): Excited | Positive | Hesitant.
**What exists:**
```typescript
acceptanceSentiment?: 'POSITIVE' | 'NEUTRAL' | 'HESITANT' | 'AT_RISK';
```
- `AT_RISK` is a health state (D021 vocabulary), NOT a sentiment value — this conflation is a data model error
- `POSITIVE` vs `Excited/Positive` — values don't match the locked acceptance sentiment set
- There is NO interview sentiment field at all on the `Candidate` interface

**What is needed:**
```typescript
// Trigger 4 — offer acceptance
acceptanceSentiment?: 'EXCITED' | 'POSITIVE' | 'HESITANT';

// Triggers 1–2 — TA-captured interview engagement sentiment
interviewSentiment?: 'VERY_INTERESTED' | 'INTERESTED' | 'NEUTRAL' | 'HESITANT' | 'DISENGAGED';
// (or a configurable string from SENTIMENT_SCALE config)
```

**Gap severity:** CRITICAL — wrong field values drive the sentiment chip on `CandidateIdentityCardComponent` (W5-010). AT_RISK conflation means a data model flag could be misread as a health signal.
**File:** [talent-flow.models.ts:107](hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts#L107)

---

## M7-004 — Candidate missing required fields: department, location, engagementScore, hiringManagerId

**Decision:** D029 — Details strip requires: Applied · Department · Location · Workflow · Seniority. D013 — Trigger 2 captures engagement score. D051 — HM sees only their assigned candidates (requires hiringManagerId on Candidate).
**What exists (Candidate interface):**
Fields present: id, firstName, lastName, email, phone, role, positionLevel, currentStage, appliedDate, experienceYears, source, workflowTemplateId, configVersion, day1ReadinessScore, acceptanceSentiment, slaHealthStatus, slaBreachedAt, createdAt, updatedAt, currentInterviewId

**Missing fields:**
- `department: string` — required for details strip (D029)
- `location: string` — required for details strip (D029)
- `interviewSentiment?: string` — Trigger 1/2 TA-captured sentiment
- `engagementScore?: number` — Trigger 2 response-time engagement score (0–100)
- `hiringManagerId?: string` — for HM assignment and filtered HM views (D051)

**Gap severity:** MAJOR — structural fields missing from core entity
**File:** [talent-flow.models.ts:92](hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts#L92)

---

## M7-005 — Interview.round restricted to 1 | 2 — should support configurable rounds (D006)

**Decision:** D006 — Interview Loop supports configurable rounds per tenant. The number of rounds is not fixed at 2.
**What exists:**
```typescript
export interface Interview {
  round: 1 | 2;   // ← too restrictive
  ...
}
```

**What is needed:**
```typescript
round: number;   // 1-based, max determined by tenant config
```

**Gap severity:** ALIGNMENT — the backend already supports configurable rounds (Lambda config). The frontend type locks it to 2.
**File:** [talent-flow.models.ts:119](hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts#L119)

---

## M7-006 — Vote.decision uses old BRD decision names, not locked values (D050)

**Decision:** D050 — Vote grid uses: Strong No | No | Yes | Strong Yes (4 options, "Yes" pre-selected).
**What exists:**
```typescript
decision: 'HIRE' | 'NO_HIRE' | 'STRONG_NO_VETO';
```
`VotePayload` uses the same wrong values. The API service has a translation layer mapping old→new, but the underlying model type is still wrong.

**What is needed:**
```typescript
decision: 'STRONG_NO' | 'NO' | 'YES' | 'STRONG_YES';
```
The translation layer in `TalentFlowApiService` should be removed — models should match the API contract directly.

**Gap severity:** CRITICAL — the vote decision is a business-critical field. Wrong enum values mean the Lambda receives the wrong vote type if the translation layer ever breaks.
**File:** [talent-flow.models.ts:133](hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts#L133)

---

## M7-007 — ConfigType missing required types for MVP 1 (D008–D011)

**Decision:** D008 — Seniority-specific SLA thresholds configurable per tenant. D009 — Signal Intelligence configurable thresholds. D010 — Risk timer percentages (50/75/100) configurable. D011 — Sentiment scale configurable per tenant.
**What exists:**
```typescript
export type ConfigType =
  | 'SCORING_WEIGHTS' | 'SLA_THRESHOLDS' | 'APPROVAL_RULES'
  | 'PANEL_CONFIG'    | 'EMAIL_TEMPLATES' | 'STAGE_CONFIG';
```

**Missing config types:**
- `'SENTIMENT_SCALE'` — D011: the interview sentiment labels are tenant-configurable
- `'INTERVIEW_TYPES'` — D006: interview types per tenant
- `'REJECTION_RULES'` — D018: rejection confirmation workflow configurable
- `'WORKFLOW_TEMPLATES'` — D040: Standard vs Fast-Track templates
- `'SENIORITY_PROFILES'` — D019: seniority-specific SLA and approval rules
- `'EMAIL_TEMPLATES'` — retain (MVP 2 but safe to declare)

**Gap severity:** ALIGNMENT — missing config type declarations mean the frontend cannot request or render these config categories from the config hub
**File:** [talent-flow.models.ts:47](hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts#L47)

---

## M7-008 — Missing interfaces: Offer, ApprovalStep, ActivityEntry, PanelMember, SentimentScale

**Decision:** D064–D071 require `Offer` and `ApprovalStep`. D035 requires `ActivityEntry` for the activity log panel. D004 requires `PanelMember` with hybrid model badge. D011 requires `SentimentScale`.
**What exists:** None of these interfaces exist in the models file.

**What is needed:**
```typescript
interface Offer {
  offerId: string;
  candidateId: string;
  state: 'OFFER_CREATED' | 'IN_APPROVAL' | 'OFFER_SENT' | 'ACCEPTED';
  baseSalary: number;
  bonus?: number;
  equity?: number;
  startDate: string;
  benefitsPackage?: string;
  approvalChain: ApprovalStep[];
  createdAt: string;
  updatedAt: string;
}

interface ApprovalStep {
  approverRole: string;     // role required per seniority config
  approverId?: string;      // set when approved
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedAt?: string;
}

interface ActivityEntry {
  entryId: string;
  eventType: 'INTERVIEW' | 'SCORE' | 'SENTIMENT' | 'STAGE' | 'NOTE' | 'SYSTEM';
  actor: string;
  actorType: 'HUMAN' | 'SYSTEM' | 'AGENT';
  description: string;
  timestamp: string;         // ONLY place timestamps appear in UI (D035)
}

interface PanelMember {
  memberId: string;
  name: string;
  email: string;
  accessType: 'SYSTEM_ACCOUNT' | 'EMAIL_LINK' | 'TA_PROXY';   // D004 hybrid model
  scoringLinkToken?: string;
}
```

**Gap severity:** MAJOR — these interfaces are prerequisites for Offer Tab (A6-010), Activity Log (W5-008), and panel scoring (D004)
**File:** New additions needed in [talent-flow.models.ts](hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts)

---

## M7-009 — ClearanceState and ProvisioningState are MVP 2 — must not be in MVP 1 models

**Decision:** TALENTFLOW_CONTEXT.md — IT Provisioning and Clearance tracking are explicitly MVP 2 (Phases 3–4, Triggers 5–6). They are out of scope for MVP 1.
**What exists:**
```typescript
export type ClearanceState = 'NOT_STARTED' | 'IN_PROGRESS' | 'CLEARED' | 'FAILED' | 'OVERRIDDEN' | 'NOT_REQUIRED';
export type ProvisioningState = 'NOT_STARTED' | 'ASSIGNED' | 'IN_PROGRESS' | 'READY' | 'FAILED' | 'NOT_REQUIRED';
```
These types exist in the MVP 1 models file and are referenced in components.

**What is needed:**
- Remove `ClearanceState` and `ProvisioningState` from the models file
- Move them to a future `talent-flow-mvp2.models.ts` or remove entirely until MVP 2 scope begins
- They create false signals that these features exist

**Gap severity:** ALIGNMENT — scope creep in the type system. Their presence implies these features are in-flight.
**File:** [talent-flow.models.ts:22](hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts#L22)

---

## M7-010 — Candidate.day1ReadinessScore is a MVP 2 field (Trigger 6)

**Decision:** TALENTFLOW_CONTEXT.md — Day 1 Readiness (Trigger 6) is explicitly MVP 2.
**What exists:**
```typescript
day1ReadinessScore?: number; // 0–100
```
This field drives the "Avg Day-1 Score" KPI on the dashboard (D2-002 gap).

**What is needed:**
- Remove `day1ReadinessScore` from the `Candidate` interface for MVP 1
- This prevents it from ever being surfaced in the dashboard or any component

**Gap severity:** ALIGNMENT (minor) — optional field, but its existence invites misuse
**File:** [talent-flow.models.ts:106](hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts#L106)

---

## M7-011 — PipelineFilters.slaStatus uses raw colour codes — D021 violation in API contract

**Decision:** D021 — Signal health language only. Never raw colour codes.
**What exists:**
```typescript
export interface PipelineFilters {
  slaStatus?: 'GREEN' | 'AMBER' | 'RED';
}
```
The filter API contract surfaces raw internal codes. The pipeline page filter buttons also use these (P4-004).

**What is needed:**
```typescript
slaStatus?: 'ON_TRACK' | 'AT_RISK' | 'BREACHED';
```
API Gateway and Lambda must be updated to accept the new vocabulary, or a translation layer added at the service layer.

**Gap severity:** MAJOR — the health state language contract must be consistent from model → component → API → Lambda → DynamoDB
**File:** [talent-flow.models.ts:176](hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts#L176)

---

## M7 — Summary Table

| ID | Decision | Gap | Severity |
|----|----------|-----|----------|
| M7-001 | D030/Context | HiringStage: 11 BRD keys, no phase grouping constant | CRITICAL |
| M7-002 | D019 | PositionLevel includes DIRECTOR — must be 3 levels only | CRITICAL |
| M7-003 | D007/D013 | acceptanceSentiment has AT_RISK value; interviewSentiment field missing entirely | CRITICAL |
| M7-004 | D029/D013/D051 | Candidate missing: department, location, interviewSentiment, engagementScore, hiringManagerId | MAJOR |
| M7-005 | D006 | Interview.round is `1 \| 2` — must support configurable number of rounds | ALIGNMENT |
| M7-006 | D050 | Vote.decision uses BRD values (HIRE/NO_HIRE/STRONG_NO_VETO) vs locked values | CRITICAL |
| M7-007 | D008–D011 | ConfigType missing: SENTIMENT_SCALE, INTERVIEW_TYPES, REJECTION_RULES, WORKFLOW_TEMPLATES, SENIORITY_PROFILES | ALIGNMENT |
| M7-008 | D004/D035/D064 | Missing interfaces: Offer, ApprovalStep, ActivityEntry, PanelMember, SentimentScale | MAJOR |
| M7-009 | Context MVP2 | ClearanceState + ProvisioningState are MVP 2 types polluting the MVP 1 model | ALIGNMENT |
| M7-010 | Context MVP2 | day1ReadinessScore is MVP 2 (Trigger 6) — should be removed from Candidate | ALIGNMENT |
| M7-011 | D021 | PipelineFilters.slaStatus uses 'GREEN'/'AMBER'/'RED' — must use health state language | MAJOR |

---

---

# SECTION 8 — BACKEND LAMBDA & API AUDIT

**Decisions audited:** D004, D006, D007, D010, D017, D019, D050, D064–D071
**AWS account:** 937137806477 · Region: af-south-1
**Method:** AWS CLI + local Lambda source code reads

## Deployed Lambdas (confirmed via `aws lambda list-functions`)

**Core workflow (MVP 1):** createCandidate, getCandidates, getCandidate, getCandidateEvents, scheduleInterview, submitVote, completeEvaluation, orchestrateTalentFlowWorkflow, advanceCandidateStage, monitorTalentFlowSLAs, manageTalentFlowConfig, sendTalentFlowNotification

**AI/Agent layer:** talentFlowAiChat, talentFlowApproveAction, talentFlowAuthorizer, talentFlowPreTokenTrigger, talentFlowAuditStream, talentFlowArchiveAuditLog, talentFlowRotateApiKey

**Not TalentFlow (legacy HR):** sendNotificationEmail (HR onboarding — do not touch)

## Deployed API Routes (talent-flow HTTP API — id: 57l0w7kk9h)

```
GET  /v1/candidates
POST /v1/candidates
GET  /v1/candidates/{id}
GET  /v1/candidates/{id}/events
POST /v1/candidates/{id}/interviews
POST /v1/candidates/{id}/votes
PUT  /v1/candidates/{id}/stage
GET  /v1/config
POST /v1/config
PUT  /v1/config
```

**Agent API (REST v1 — id: 16sd07qd9h):** POST /chat, POST /approve

---

## L8-001 — sendTalentFlowNotification sends Postmark emails — D017 requires in-app only (MVP 1)

**Decision:** D017 — Notifications are in-app for MVP 1. Persistent until actioned. Each notification links to the relevant candidate record. Email notifications are explicitly MVP 2.
**What exists:**
```javascript
// sendTalentFlowNotification/index.js:104-110
const client = getPostmarkClient();
await client.sendEmailWithTemplate({
  From:          SENDER_EMAIL,
  To:            recipientEmail,
  TemplateAlias: templateAlias,
  TemplateModel: templateModel,
});
```
The Lambda sends transactional email via Postmark on every SQS message: INTERVIEW_SCHEDULED, CANDIDATE_CREATED, EVALUATION_COMPLETED, OFFER_APPROVED, SLA_BREACHED.

**Chain consequence:** Every SLA breach, every interview scheduled, every evaluation completed triggers a Postmark email. This affects `monitorTalentFlowSLAs`, `scheduleInterview`, and `completeEvaluation` which all enqueue to the SQS queue. All of these deliver via email today.

**What is needed (D017):**
- SQS → `sendTalentFlowNotification` → write to `talent-flow-notifications` DynamoDB table (not email)
- Notification item: notificationId, userId, type, candidateId, candidateName, message, read=false, createdAt, TTL
- In-app bell badge (S1-005) reads from this table
- Email path (Postmark) moved to MVP 2 — behind a feature flag in config or removed

**Gap severity:** CRITICAL — the entire notification delivery channel is wrong for MVP 1
**File:** [lambda/sendTalentFlowNotification/index.js:104](lambda/sendTalentFlowNotification/index.js#L104)

---

## L8-002 — No in-app notifications DynamoDB table or API routes

**Decision:** D017 — In-app notifications: badge count, persistent, links to candidate record
**What exists:**
- SQS queue + `sendTalentFlowNotification` Lambda (currently emailing, not writing to DB)
- No `talent-flow-notifications` DynamoDB table in `talent-flow-infra/talent-flow-dynamodb.tf`
- No `GET /v1/notifications` route (user's unread list)
- No `PATCH /v1/notifications/{id}/read` route (mark as actioned)
- No Lambda functions for either operation

**What is needed:**
- New DynamoDB table: `talent-flow-notifications` — PK=`USER#{userId}`, SK=`NOTIF#{timestamp}`, GSI: unread count
- New Lambda: `getUserNotifications` — GET /v1/notifications?userId=&unreadOnly=true
- New Lambda: `markNotificationRead` — PATCH /v1/notifications/{id}/read
- sendTalentFlowNotification writes to this table instead of Postmark

**Gap severity:** MAJOR — entire in-app notification delivery infrastructure does not exist
**File:** Not present in [talent-flow-infra/](talent-flow-infra/)

---

## L8-003 — No offer management Lambdas — Triggers 3 and 4 have no backend

**Decision:** D064–D071 — Offer lifecycle: Offer Created → In Approval → Offer Sent → Accepted. Each state is a distinct transition. Trigger 3 = offer creation + approval chain. Trigger 4 = acceptance + simultaneous IT & Facilities notification.
**What exists:**
- No offer-related Lambda in the deployed list
- No offer API routes in the HTTP API
- `completeEvaluation` advances SAGA to `OFFER_PREPARATION` stage on PASSED — but there is no handler for what happens next
- `EvaluationCompleted` event is published but no EventBridge rule consumes it to start the offer flow

**What is needed (minimum for MVP 1):**
- Lambda: `createOffer` — POST /v1/candidates/{id}/offer — creates offer record, derives approval chain from `APPROVAL_RULES` config keyed by seniority
- Lambda: `advanceOfferState` — PUT /v1/candidates/{id}/offer — transitions: OFFER_CREATED → IN_APPROVAL → OFFER_SENT → ACCEPTED
- Lambda: `getOffer` — GET /v1/candidates/{id}/offer — reads current offer record and approval chain state
- EventBridge rule: EvaluationCompleted (PASSED) → createOffer (or orchestrateOffer workflow)
- Trigger 4: on ACCEPTED state → publish `OfferAccepted` event → fan out to IT + Facilities notifications (DynamoDB entries, not email)
- New API routes: GET/POST/PUT /v1/candidates/{id}/offer

**Gap severity:** MAJOR — Triggers 3 + 4 (half of MVP 1 scope) have no backend implementation
**File:** Not present in [lambda/](lambda/)

---

## L8-004 — No sentiment capture Lambda or API route — Trigger 1 signal cannot be recorded

**Decision:** D007 — Interview sentiment is TA-captured after first interview (Trigger 1): Very Interested | Interested | Neutral | Hesitant | Disengaged. D034 — Sentiment selector is in the candidate record Interviews tab.
**What exists:**
- No `POST /v1/candidates/{id}/sentiment` route in the API
- No Lambda to write sentiment to the SAGA record or activity log
- The `TalentFlowApiService` has no `updateSentiment()` method
- The SLA monitor and Signal Intelligence logic cannot fire on sentiment because it is never captured

**What is needed:**
- Lambda: `captureSentiment` — POST /v1/candidates/{id}/sentiment — writes `{interviewSentiment, capturedBy, capturedAt}` to SAGA record; appends SENTIMENT_CAPTURED audit entry; publishes `SentimentCaptured` to EventBridge
- New route: POST /v1/candidates/{id}/sentiment
- EventBridge rule: SentimentCaptured (HESITANT or DISENGAGED) → trigger Signal Intelligence evaluation

**Gap severity:** MAJOR — Trigger 1 signal (the foundational signal of the entire platform) cannot be captured
**File:** Not present in [lambda/](lambda/)

---

## L8-005 — No panel member directory Lambda or API route — panel roster is hardcoded in frontend

**Decision:** D004 — Hybrid panel model: system accounts (Cognito users) + email scoring links + TA proxy entry. Panel members come from a directory, not a hardcoded list.
**What exists:**
- `PANEL_ROSTER` is hardcoded as a static array in `candidate-workspace-page.component.ts`
- No `GET /v1/panel-members` route
- No Lambda to query the Cognito user pool or a panel-members config for available panelists
- `scheduleInterview` accepts `panelMemberIds[]` from the request body — but the source of those IDs has no backend

**What is needed:**
- Lambda: `getPanelMembers` — GET /v1/panel-members?tenantId= — queries Cognito group `PanelMember` for system accounts + reads `PANEL_CONFIG` for email-link-only members
- New route: GET /v1/panel-members
- `PanelMember` interface with `accessType: 'SYSTEM_ACCOUNT' | 'EMAIL_LINK' | 'TA_PROXY'`
- Frontend `Add Panel Member` action reads from this endpoint, not a hardcoded array

**Gap severity:** MAJOR — scheduling an interview requires a panel list that has no backend source
**File:** Not present in [lambda/](lambda/)

---

## L8-006 — No scoring link generation — email-only panel members cannot submit votes

**Decision:** D004 — Panel members without system accounts receive a scoring link via email. The link is a time-limited token that opens a vote submission form.
**What exists:**
- `scheduleInterview` enqueues a notification per panel member, but it only contains `recipientId` and `scheduledAt`
- No token generation, no scoring URL, no route for token-gated vote submission
- `submitVote` requires `voterId` from JWT (Cognito auth) — email-link panel members have no JWT

**What is needed:**
- Lambda: `generateScoringLink` — POST /v1/candidates/{id}/scoring-links — creates a short-lived JWT or signed token, stores in `talent-flow-pending-actions` or a `talent-flow-scoring-tokens` table, returns a URL
- A separate vote submission endpoint (token-gated, not Cognito) or a token-to-Cognito exchange flow
- This is a hard requirement: the hybrid panel model (D004) has a user type that cannot authenticate with Cognito

**Gap severity:** MAJOR — hybrid panel model (a locked D004 decision) is partially unimplementable without this
**File:** Not present in [lambda/](lambda/)

---

## L8-007 — scheduleInterview validates DIRECTOR as a valid position level (D019 violation)

**Decision:** D019 — Only 3 seniority levels: JUNIOR / MID / SENIOR. DIRECTOR does not exist.
**What exists:**
```javascript
// scheduleInterview/index.js:37
const VALID_POSITION_LEVELS = ['JUNIOR', 'MID', 'SENIOR', 'DIRECTOR'];
```
A candidate with `positionLevel: 'DIRECTOR'` (if created through other means) would pass this validation. Once removed from the frontend and models, this Lambda validation will be out of sync if not also fixed.

**What is needed:**
```javascript
const VALID_POSITION_LEVELS = ['JUNIOR', 'MID', 'SENIOR'];
```
All Lambda functions that validate positionLevel must be checked and aligned.

**Gap severity:** ALIGNMENT — residual BRD artifact. Must be fixed alongside frontend/model cleanup.
**File:** [lambda/scheduleInterview/index.js:37](lambda/scheduleInterview/index.js#L37)

---

## L8-008 — submitVote accepts NEUTRAL as a valid rating — D050 does not include NEUTRAL

**Decision:** D050 — Vote grid: Strong No | No | Yes | Strong Yes (4 options). No NEUTRAL option.
**What exists:**
```javascript
// submitVote/index.js:57
const VALID_RATINGS = ['STRONG_NO', 'NO', 'NEUTRAL', 'YES', 'STRONG_YES'];
```
`NEUTRAL` is accepted by the Lambda. If a frontend bug or API call sends `NEUTRAL`, it would pass and be stored as a valid vote — but it does not exist in the UX (D050). This creates a data integrity gap.

**What is needed:**
```javascript
const VALID_RATINGS = ['STRONG_NO', 'NO', 'YES', 'STRONG_YES'];
```

**Gap severity:** ALIGNMENT — the UX will never send NEUTRAL per D050, but the Lambda accepting it means a malformed API call would silently succeed
**File:** [lambda/submitVote/index.js:57](lambda/submitVote/index.js#L57)

---

## L8-009 — GET /v1/candidates/{id}/events and PUT /v1/candidates/{id}/stage not declared in talent-flow-infra Terraform

**Decision:** Architectural rule — all TalentFlow API routes must be declared in `talent-flow-infra/` Terraform, not `infra/`.
**What exists:**
- `talent-flow-infra/talent-flow-apigateway.tf` declares 10 routes — but **not** `GET /v1/candidates/{id}/events` and **not** `PUT /v1/candidates/{id}/stage`
- Both routes are **deployed** and **working** — confirmed via AWS CLI
- `infra/talentflow-advance-stage.tf` (wrong folder) is the likely source of the stage route
- `infra/talent_flow_ai_chat_route.tf` (new untracked file in git status) likely declares the events route outside of `talent-flow-infra/`

**What is needed:**
- Migrate `PUT /v1/candidates/{id}/stage` declaration into `talent-flow-infra/talent-flow-apigateway.tf`
- Migrate `GET /v1/candidates/{id}/events` declaration into `talent-flow-infra/talent-flow-apigateway.tf`
- Remove `infra/talentflow-advance-stage.tf` (or move its Terraform to `talent-flow-infra/`)
- Do NOT destroy and recreate deployed routes — use `terraform import` to bring existing resources under correct state

**Gap severity:** INFRA — routes work but are managed outside the canonical Terraform module, creating drift risk on next `terraform apply`
**File:** [infra/talentflow-advance-stage.tf](infra/talentflow-advance-stage.tf)

---

## L8-010 — No EventBridge rule wiring EvaluationCompleted → offer flow

**Decision:** The event-driven architecture requires an EventBridge rule for every state transition. EvaluationCompleted (PASSED) must trigger the offer creation flow.
**What exists:**
- `completeEvaluation` publishes `EvaluationCompleted` (source: talent-flow.workflow)
- No EventBridge rule exists in `talent-flow-infra/` to route this event to an offer Lambda
- This is a dead event — published but consumed by nothing (no offer Lambda exists yet per L8-003)

**What is needed:**
- EventBridge rule in `talent-flow-eventbridge.tf`: `EvaluationCompleted` (outcome=PASSED) → `createOffer` Lambda
- `EvaluationCompleted` (outcome=FAILED) → `sendTalentFlowNotification` queue (rejection notification)

**Gap severity:** MAJOR — after a candidate passes evaluation, the workflow has no automatic next step
**File:** Not present in [talent-flow-infra/](talent-flow-infra/)

---

## L8 — Summary Table

| ID | Decision | Gap | Severity |
|----|----------|-----|----------|
| L8-001 | D017 | sendTalentFlowNotification sends Postmark emails — must write to in-app notification table | CRITICAL |
| L8-002 | D017 | No talent-flow-notifications DynamoDB table, no GET/PATCH notification routes or Lambdas | MAJOR |
| L8-003 | D064–D071 | No offer management Lambdas (createOffer, advanceOfferState, getOffer) — Triggers 3+4 unimplemented | MAJOR |
| L8-004 | D007/D034 | No sentiment capture Lambda or API route — Trigger 1 signal cannot be recorded | MAJOR |
| L8-005 | D004 | No panel member directory Lambda or route — panel roster hardcoded in frontend | MAJOR |
| L8-006 | D004 | No scoring link generation — email-only panel members cannot submit votes | MAJOR |
| L8-007 | D019 | scheduleInterview accepts DIRECTOR as valid positionLevel | ALIGNMENT |
| L8-008 | D050 | submitVote accepts NEUTRAL rating — not a valid vote option | ALIGNMENT |
| L8-009 | Arch | Stage and events routes deployed via wrong Terraform folder (infra/ not talent-flow-infra/) | INFRA |
| L8-010 | Arch | No EventBridge rule wiring EvaluationCompleted → offer creation flow | MAJOR |

---

---

# SECTION 9 — INFRASTRUCTURE AUDIT

**Files read:**
- `talent-flow-infra/talent-flow-dynamodb.tf`
- `talent-flow-infra/talent-flow-eventbridge.tf`
- `talent-flow-infra/talent-flow-stepfunctions.tf`
- `talent-flow-infra/talent-flow-apigateway.tf`
- Directory listing of `talent-flow-infra/`

**AWS CLI queries:** Lambda list, HTTP API routes, REST API routes

---

## I9-001 — talent-flow-notifications DynamoDB table missing (D017)

**Decision:** D017 — In-app notifications, persistent until actioned. Requires a notification store.
**What exists:** 7 DynamoDB tables declared in `talent-flow-dynamodb.tf`:
1. talent-flow-state ✓
2. talent-flow-config ✓
3. talent-flow-agent-audit ✓
4. talent-flow-prompt-cache ✓
5. talent-flow-pending-actions ✓
6. talent-flow-ai-rate-limit ✓
7. talent-flow-idempotency-keys ✓

**What is missing:**
```hcl
# talent-flow-notifications
# PK = USER#{userId}, SK = NOTIF#{timestamp}
# GSI: UnreadIndex — PK = USER#{userId}#UNREAD
# TTL: 30 days (notifications auto-expire after 30 days regardless of read status)
```
- No `talent-flow-notifications` table
- Without this table, `sendTalentFlowNotification` has nowhere to write in-app notifications (L8-001/L8-002)

**Gap severity:** MAJOR — prerequisite for all in-app notification delivery (D017)
**File:** [talent-flow-infra/talent-flow-dynamodb.tf](talent-flow-infra/talent-flow-dynamodb.tf) — new resource needed

---

## I9-002 — EventBridge Rule 5 routes EvaluationCompleted → email, not offer creation

**Decision:** After evaluation passes, the workflow must proceed to offer creation (D064–D068). This is an event-driven architecture — EvaluationCompleted (PASSED) must trigger the offer flow.
**What exists (Rule 5):**
```hcl
# talent-flow-eventbridge.tf:168-197
event_pattern = { source = ["talent-flow.workflow"], detail-type = ["EvaluationCompleted"] }
target = sendTalentFlowNotification   ← sends email, not offer creation
```
Rule 5 routes ALL `EvaluationCompleted` events (both PASSED and FAILED) to `sendTalentFlowNotification`. This means:
- A PASSED evaluation → email (not the correct next step)
- A FAILED evaluation → email (correct behaviour)

**What is needed:**
- Rule 5a: `EvaluationCompleted` where `detail.outcome = "PASSED"` → `createOffer` Lambda (or Step Functions `talent-flow-offer-approval` startExecution)
- Rule 5b: `EvaluationCompleted` where `detail.outcome = "FAILED"` → `sendTalentFlowNotification` (notify TA of evaluation failure)
- EventBridge content-based filtering can split these two paths at the rule level

**Gap severity:** MAJOR — successful evaluations currently go nowhere after notification. The offer flow has no trigger.
**File:** [talent-flow-infra/talent-flow-eventbridge.tf:168](talent-flow-infra/talent-flow-eventbridge.tf#L168)

---

## I9-003 — EventBridge Rule 6 (SLABreached → email) routes to wrong delivery channel for MVP 1

**Decision:** D017 — Notifications are in-app for MVP 1. Email = MVP 2.
**What exists (Rule 6):**
```hcl
event_pattern = { source = ["talent-flow.sla"], detail-type = ["SLABreached"] }
target = sendTalentFlowNotification   ← sends Postmark email
```
SLA breach notifications fire hourly from `monitorTalentFlowSLAs` → EventBridge → `sendTalentFlowNotification` → Postmark email.

**What is needed:**
- Rule 6 target should be the in-app notification writer (once L8-001/L8-002 are resolved)
- For MVP 1: write to `talent-flow-notifications` DynamoDB table, not Postmark

**Gap severity:** CRITICAL — directly contradicts D017 for a high-frequency operational event (SLA breaches happen hourly for every at-risk candidate)
**File:** [talent-flow-infra/talent-flow-eventbridge.tf:199](talent-flow-infra/talent-flow-eventbridge.tf#L199)

---

## I9-004 — EventBridge Rule 7 (OfferApproved → email) routes to wrong channel for MVP 1

**Decision:** D017 — In-app notifications for MVP 1.
**What exists (Rule 7):**
```hcl
event_pattern = { source = ["talent-flow.workflow"], detail-type = ["OfferApproved"] }
target = sendTalentFlowNotification   ← sends Postmark email
```
Same issue as I9-003. Offer approval notifications go to email.

**What is needed:**
- Rule 7 target → in-app notification writer
- Additionally, `OfferApproved` should trigger the OFFER_SENT state transition in the offer flow (the approval chain completing → offer moves to Offer Sent state — D067)

**Gap severity:** MAJOR
**File:** [talent-flow-infra/talent-flow-eventbridge.tf:230](talent-flow-infra/talent-flow-eventbridge.tf#L230)

---

## I9-005 — Missing EventBridge rules: SentimentCaptured and OfferAccepted

**Decision:** D007/D034 — Sentiment capture (Trigger 1) must flow into Signal Intelligence. D070 — Offer acceptance (Trigger 4) must trigger simultaneous IT & Facilities notifications.
**What exists:** 8 EventBridge rules (7 workflow + 1 cron). None handle `SentimentCaptured` or `OfferAccepted`.

**What is needed:**
- New Rule: `SentimentCaptured` (source: talent-flow.workflow) → evaluate signal intelligence trigger conditions
  - If `interviewSentiment = HESITANT or DISENGAGED` → write Signal Intelligence notification to in-app table
- New Rule: `OfferAccepted` (source: talent-flow.workflow) → fan-out to:
  - In-app notification for IT provisioning (Trigger 4 per Context doc)
  - In-app notification for Facilities (Trigger 4)
  - This corresponds to the "simultaneous IT & Facilities notifications" from the MVP 1 scope

**Gap severity:** MAJOR — Trigger 1 and Trigger 4 fan-out have no EventBridge wiring
**File:** [talent-flow-infra/talent-flow-eventbridge.tf](talent-flow-infra/talent-flow-eventbridge.tf) — new rules needed

---

## I9-006 — Step Functions state machine declared but not wired into the event flow

**Decision:** D069 — Approval chain is seniority-driven. SENIOR+ requires CEO-level approval chain. The Step Functions state machine `talent-flow-offer-approval` exists to handle this multi-step, long-running process.
**What exists:**
- `talent-flow-stepfunctions.tf` declares `aws_sfn_state_machine.offer_approval` correctly (STANDARD type, WaitForTaskToken, HeartbeatSeconds=86400)
- The state machine ASL is correct for the approval flow

**What is missing:**
1. No Lambda to START the execution (`aws_sfn:startExecution`) — there is no `createOffer` Lambda that calls `sfn:StartExecution`
2. No EventBridge rule routing anything to the state machine (I9-002 confirms EvaluationCompleted goes to email instead)
3. Step 1 (`SendApprovalRequest`) calls `sendTalentFlowNotification` with `waitForTaskToken` — this sends a Postmark email with the task token. For MVP 1 this should write an in-app approval notification with the token.
4. The Step Functions IAM role has no `dynamodb:*` permissions — the `approve_action` Lambda processes state transitions but the state machine itself cannot read/write DynamoDB directly (not needed, but note the dependency)

**Gap severity:** MAJOR — the state machine infrastructure is correct but is orphaned: nothing starts it and its internal notification step uses the wrong delivery channel
**File:** [talent-flow-infra/talent-flow-stepfunctions.tf:156](talent-flow-infra/talent-flow-stepfunctions.tf#L156)

---

## I9-007 — infra/talentflow-advance-stage.tf is in the wrong Terraform module

**Decision:** Architectural rule — all TalentFlow resources belong in `talent-flow-infra/`. The `infra/` folder is the legacy HR onboarding module.
**What exists:**
```
infra/talentflow-advance-stage.tf     ← tracked, wrong folder
infra/talent_flow_ai_chat_route.tf    ← UNTRACKED new file, wrong folder
```
- `infra/talentflow-advance-stage.tf` deploys the `advanceCandidateStage` Lambda + its API route (`PUT /v1/candidates/{id}/stage`) using the legacy HR Terraform module's `var.aws_account_id` vs `talent-flow-infra`'s `var.aws_account_id`
- The route is deployed and working, but managed by the wrong module → `terraform apply` in `talent-flow-infra/` has no knowledge of this route; `terraform apply` in `infra/` could accidentally destroy or conflict with it
- `infra/talent_flow_ai_chat_route.tf` is untracked — appears to declare the `GET /v1/candidates/{id}/events` route outside the canonical module

**What is needed:**
- Migrate both resources into `talent-flow-infra/talent-flow-apigateway.tf`
- Use `terraform import` to avoid destroy/recreate of the live deployed routes
- Remove both files from `infra/`
- Verify variable names match `talent-flow-infra` conventions (`var.aws_account_id`)

**Gap severity:** INFRA — creates operational drift risk. The next `terraform plan` in `talent-flow-infra/` will not see these routes.
**File:** [infra/talentflow-advance-stage.tf](infra/talentflow-advance-stage.tf)

---

## I9-008 — DynamoDB table architecture is sound — confirming compliant aspects

The following aspects of the DynamoDB design are **fully compliant** with the locked architectural decisions and do not require changes:

- **Config versioning** ✓ — GSI1-active-configs for hot reads; TTL on inactive versions; NEVER delete old versions (in-flight candidates reference them)
- **PITR** ✓ — all 7 tables have PITR enabled (POPIA data recovery requirement)
- **KMS encryption** ✓ — split KMS keys: state key for operational tables, agent_audit key for audit/cache tables
- **TTLs** ✓ — all tables with TTL-eligible data have TTL configured correctly
- **Stream on talent-flow-state** ✓ — enables SLA monitor to consume state changes
- **Stream on agent-audit** ✓ — feeds S3 archiver for 5-year POPIA retention
- **PAY_PER_REQUEST** ✓ — all tables use on-demand billing (no capacity planning needed)
- **GSI count** ✓ — talent-flow-state has GSI1 and GSI2 for future access patterns

**Status:** COMPLIANT — DynamoDB table infrastructure is well-designed and does not need changes beyond adding `talent-flow-notifications`.

---

## I9-009 — talent-flow-infra Terraform module has no talent-flow-notifications table or Lambda declarations for MVP 1 missing Lambdas

**Decision:** MVP 1 scope requires: createOffer, advanceOfferState, getOffer, captureSentiment, getPanelMembers, getUserNotifications, markNotificationRead
**What exists in `talent-flow-lambdas.tf`:** (already known) — 15 Lambda declarations covering the core workflow
**What is missing:**
- Lambda Terraform resource declarations for all 7 missing MVP 1 Lambdas (identified in L8-003 through L8-006, L8-002)
- These cannot be deployed by CI/CD until declared

**Gap severity:** MAJOR — prerequisite before any new Lambda source code can be deployed
**File:** [talent-flow-infra/talent-flow-lambdas.tf](talent-flow-infra/talent-flow-lambdas.tf) — new resource declarations needed

---

## I9 — Summary Table

| ID | Decision | Gap | Severity |
|----|----------|-----|----------|
| I9-001 | D017 | talent-flow-notifications DynamoDB table not declared or deployed | MAJOR |
| I9-002 | D064/Arch | EventBridge Rule 5: EvaluationCompleted → email (not offer creation) | MAJOR |
| I9-003 | D017 | EventBridge Rule 6: SLABreached → Postmark email (must be in-app for MVP 1) | CRITICAL |
| I9-004 | D017 | EventBridge Rule 7: OfferApproved → Postmark email (must be in-app for MVP 1) | MAJOR |
| I9-005 | D007/D070 | No EventBridge rules for SentimentCaptured or OfferAccepted (Trigger 1/4 fan-out) | MAJOR |
| I9-006 | D069 | Step Functions state machine declared but orphaned — nothing starts it | MAJOR |
| I9-007 | Arch | advanceCandidateStage + events routes in wrong Terraform module (infra/ not talent-flow-infra/) | INFRA |
| I9-008 | Arch | DynamoDB table design is fully compliant — no structural changes needed | COMPLIANT |
| I9-009 | Arch | talent-flow-lambdas.tf missing declarations for all 7 new MVP 1 Lambdas | MAJOR |

---

---

# MASTER GAP SUMMARY

**Audit completed:** 2026-05-20
**Total gaps identified:** 79 (59 frontend + 10 backend + 10 infrastructure)
**Compliant findings:** 3 (S3-004 SLA bar fill, I9-008 DynamoDB design, W5-006 partial actions)

---

## CRITICAL gaps (must fix before any screen ships)

| # | ID | Area | Gap | Decision |
|---|-----|------|-----|----------|
| 1 | S1-001 | Shell | Sidebar layout → must be horizontal topbar | D022 |
| 2 | S1-003 | Shell | Add Candidate → full page, must be 480px drawer | D036 |
| 3 | S1-004 | Shell | Ask AI missing from topbar entirely | D023 |
| 4 | S3-001 | SLA Widget | Renders "14h 23m remaining" / "BREACHED — 2h overdue" | D021 |
| 5 | S3-002 | SLA Widget | Hardcoded thresholds using wrong % model + wrong codes | D010 |
| 6 | S3-003 | SLA Widget | 72-hour threshold hardcoded in every consumer | D008 |
| 7 | D2-001 | Dashboard | Entire layout wrong — KPI grid+table vs 5-zone design | D020 |
| 8 | D2-003 | Dashboard | SLA label outputs 'RED'/'AMBER'/'GREEN' to user | D021 |
| 9 | D2-004 | Dashboard | `c.updatedAt` exact timestamp rendered on dashboard | D021 |
| 10 | D2-006 | Dashboard | No candidate card component — raw table rows | D024 |
| 11 | D2-007 | Dashboard | Sorted by recency not urgency | D016 |
| 12 | P4-001 | Pipeline | List view (required default) completely missing | D053 |
| 13 | P4-002 | Pipeline | Kanban has 11 stage columns vs 4 phase columns | D057 |
| 14 | P4-003 | Pipeline | Filter bar has 2 controls vs 5 filter groups | D054 |
| 15 | P4-004 | Pipeline | Filter labels "Green/Amber/Red" — must be health language | D021 |
| 16 | P4-006 | Pipeline | No default sort — must be health worst first | D058 |
| 17 | P4-007 | Pipeline | SLA timer on Kanban cards renders exact times | D021 |
| 18 | W5-001 | Workspace | Entire page layout wrong — left-rail vs header+tabs+log | D027–D035 |
| 19 | W5-002 | Workspace | Wrong tabs: 3 present vs 5 required (wrong names) | D027 |
| 20 | W5-003 | Workspace | No Reject button in header, no health pill, no SLA bar | D028/D031 |
| 21 | W5-005 | Workspace | 11-stage stepper vs 4-phase horizontal indicator | D030 |
| 22 | W5-007 | Workspace | Signal Intelligence box not implemented anywhere | D032/D009 |
| 23 | W5-009 | Workspace | Per-page Ask AI button exists — must be topbar only | D023 |
| 24 | W5-010 | Workspace | Identity card reads `acceptanceSentiment` (wrong field + AT_RISK value) | D007/D034 |
| 25 | A6-001 | Add Cand. | Full routed page — must be 480px side drawer | D036 |
| 26 | A6-002 | Add Cand. | Seniority is dropdown + includes DIRECTOR | D039/D019 |
| 27 | M7-001 | Models | HiringStage: 11 BRD keys, no phase grouping | D030 |
| 28 | M7-002 | Models | PositionLevel includes DIRECTOR | D019 |
| 29 | M7-003 | Models | acceptanceSentiment has AT_RISK; interviewSentiment missing | D007/D013 |
| 30 | M7-006 | Models | Vote.decision uses BRD values not locked values | D050 |
| 31 | L8-001 | Lambda | sendTalentFlowNotification → Postmark vs in-app | D017 |
| 32 | I9-003 | Infra | EventBridge Rule 6 (SLABreached) → email not in-app | D017 |

---

## MAJOR gaps (features or screens that must exist for MVP 1)

| # | ID | Area | Gap | Decision |
|---|-----|------|-----|----------|
| 33 | S1-002 | Shell | Nav has 3 wrong items — needs 5 correct items | D022 |
| 34 | S1-005 | Shell | Bell notification badge missing | D017 |
| 35 | S1-007 | Shell | 3 routes missing, 2 wrong routes present | D022/D036 |
| 36 | D2-002 | Dashboard | Wrong KPIs (Avg Day-1 Score + In Onboarding = MVP 2) | D020 |
| 37 | D2-005 | Dashboard | 10 candidates by name in table — violates no-names rule | D025 |
| 38 | D2-008 | Dashboard | Zone 3 "My Actions Today" missing | D020 |
| 39 | D2-009 | Dashboard | Zone 4 Pipeline Summary with health dots missing | D025 |
| 40 | W5-004 | Workspace | Details strip (5 columns) completely missing | D029 |
| 41 | W5-008 | Workspace | Activity Log is a tab not a persistent 268px right panel | D035 |
| 42 | P4-005 | Pipeline | Results bar (count + sort dropdown) missing | D055 |
| 43 | P4-008 | Pipeline | List view 7-column table not defined | D056 |
| 44 | A6-003 | Add Cand. | Workflow template 2-card selector absent | D040 |
| 45 | A6-004 | Add Cand. | Form Section 2 (Interview Setup) missing | D037 |
| 46 | A6-007 | Add Cand. | Department + Location not captured | D029 |
| 47 | A6-008 | Candidates | Candidates View completely missing | D059–D063 |
| 48 | A6-009 | HM | HM Dashboard + inline scoring panel completely missing | D044–D051 |
| 49 | A6-010 | Offer | Offer Tab (Triggers 3+4) absent from candidate record | D064–D071 |
| 50 | M7-004 | Models | Candidate missing: department, location, interviewSentiment, hiringManagerId | D029/D051 |
| 51 | M7-008 | Models | Missing interfaces: Offer, ApprovalStep, ActivityEntry, PanelMember | D004/D035/D064 |
| 52 | M7-011 | Models | PipelineFilters.slaStatus uses raw colour codes | D021 |
| 53 | L8-002 | Lambda | No talent-flow-notifications table or GET/PATCH notification routes | D017 |
| 54 | L8-003 | Lambda | No offer management Lambdas (createOffer/advanceOfferState/getOffer) | D064–D071 |
| 55 | L8-004 | Lambda | No sentiment capture Lambda or route — Trigger 1 unrecordable | D007/D034 |
| 56 | L8-005 | Lambda | No panel member directory Lambda or route | D004 |
| 57 | L8-006 | Lambda | No scoring link generation for email-only panel members | D004 |
| 58 | L8-010 | Lambda | No EventBridge rule: EvaluationCompleted → offer flow | Arch |
| 59 | I9-001 | Infra | talent-flow-notifications DynamoDB table missing | D017 |
| 60 | I9-002 | Infra | EvaluationCompleted routes to email not offer creation | D064 |
| 61 | I9-004 | Infra | OfferApproved routes to email not in-app | D017 |
| 62 | I9-005 | Infra | No EventBridge rules for SentimentCaptured or OfferAccepted | D007/D070 |
| 63 | I9-006 | Infra | Step Functions state machine orphaned — nothing starts it | D069 |
| 64 | I9-009 | Infra | talent-flow-lambdas.tf missing 7 new MVP 1 Lambda declarations | Arch |

---

## ALIGNMENT gaps (exists but does not match spec — refactor needed)

| # | ID | Area | Gap | Decision |
|---|-----|------|-----|----------|
| 65 | S1-006 | Shell | Role pill and avatar missing from topbar | D022 |
| 66 | W5-006 | Workspace | Actions bar: actions buried in tabs vs dedicated bar | D031 |
| 67 | A6-005 | Add Cand. | No data completeness progress bar | D038 |
| 68 | A6-006 | Add Cand. | Footer not fixed, wrong button label | D041 |
| 69 | M7-005 | Models | Interview.round is `1|2` — must support configurable rounds | D006 |
| 70 | M7-007 | Models | ConfigType missing 5 required types | D008–D011 |
| 71 | M7-009 | Models | ClearanceState + ProvisioningState are MVP 2 in MVP 1 file | Context |
| 72 | M7-010 | Models | day1ReadinessScore is MVP 2 (Trigger 6) on Candidate | Context |
| 73 | L8-007 | Lambda | scheduleInterview accepts DIRECTOR as valid positionLevel | D019 |
| 74 | L8-008 | Lambda | submitVote accepts NEUTRAL rating — D050 has no NEUTRAL | D050 |
| 75 | D2-002 | Dashboard | Wrong KPI metrics (Avg Day-1 + In Onboarding = MVP 2) | D020 |

---

## INFRA gaps (Terraform / AWS configuration)

| # | ID | Area | Gap | Severity |
|---|-----|------|-----|----------|
| 76 | L8-009 | Lambda/Infra | Stage + events routes in wrong Terraform module | INFRA |
| 77 | I9-007 | Infra | advanceCandidateStage + events in infra/ not talent-flow-infra/ | INFRA |

---

## Recommended implementation order

### Phase A — Fix first (unblock all other frontend work)
1. Rebuild shell as horizontal topbar (S1-001) — every screen depends on it
2. Fix D021 violations in SLA widget (S3-001, S3-002, S3-003) — cross-cutting, affects all screens
3. Fix models layer (M7-001 through M7-006) — compile errors cascade if left
4. Move Terraform files to correct module (I9-007, L8-009) — prevents infra drift

### Phase B — Core screens (TA workflow)
5. Rebuild TA Dashboard to 5-zone layout (D2-001 through D2-009)
6. Rebuild Candidate Record/Workspace (W5-001 through W5-010)
7. Convert Add Candidate to side drawer (A6-001 through A6-007)
8. Build Candidates View (A6-008)
9. Rebuild Pipeline — list view + corrected Kanban (P4-001 through P4-008)

### Phase C — Backend & signals
10. Pivot sendTalentFlowNotification to in-app (L8-001) + create talent-flow-notifications table (I9-001, L8-002)
11. Implement captureSentiment Lambda + route (L8-004) + EventBridge rule (I9-005)
12. Implement getPanelMembers Lambda + route (L8-005)
13. Wire EventBridge rules to correct targets (I9-002, I9-003, I9-004, I9-005)

### Phase D — Offer lifecycle (Triggers 3 + 4)
14. Implement createOffer + advanceOfferState + getOffer Lambdas (L8-003)
15. Wire Step Functions to offer flow (I9-006)
16. Build Offer Tab inside Candidate Record (A6-010)
17. Implement OfferAccepted fan-out (I9-005)
18. Build HM Dashboard + inline scoring panel (A6-009)

### Phase E — Scoring link generation (D004 hybrid model)
19. Implement generateScoringLink Lambda (L8-006)
20. Token-gated vote submission endpoint

---

*End of TalentFlow Claude Audit — all 9 sections complete*
