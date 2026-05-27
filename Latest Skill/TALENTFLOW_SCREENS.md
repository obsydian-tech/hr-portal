# TalentFlow Platform — Screen Specifications
## For Claude Code | UX Implementation Guide

> Before building any screen, read TALENTFLOW_DECISIONS.md.
> Every screen must serve the Golden Truth — identify bottlenecks,
> improve candidate experience, reduce drop-off.
> Every element must speak to a measurable signal.

---

## DESIGN SYSTEM REFERENCE

All screens use the **Naleko design system**.
Full design system is at: `/Users/iggie/Documents/naleko-design-handoff/`
Read the README.md in that folder before writing any component code.

Key Naleko tokens (do not hardcode hex values — use CSS variables):
- `--naleko-primary: #1a1a2e` — anchor navy
- `--naleko-primary-deep: #16124d` — editorial navy (page titles, headers)
- `--naleko-secondary: #4a3f8a` — indigo (interactive accents, active states)
- `--naleko-tertiary: #2d8f9e` — teal (Add Candidate button, brand mark)
- `--naleko-cyan: #7ad4e4` — Ask AI button, role pill, active highlights
- `--naleko-surface: #f8f9fa` — page background
- `--naleko-white: #ffffff` — card backgrounds
- `--naleko-success: #2e7d32` — green health state
- `--naleko-warning: #f57f17` — amber health state
- `--naleko-error: #ba1a1a` — red health state
- Font display: Manrope (headings, numbers)
- Font body: Inter (all body text, labels)

---

## GLOBAL LAYOUT RULES

### Top Navigation Bar (Horizontal — always present)
```
[Brand Mark + TalentFlow] [Dashboard] [Pipeline] [Candidates] [Offers] [Reports]
                                              → [Add Candidate] | [Ask AI] | [Bell] [Role Pill] [Avatar]
```

- Brand mark: teal square with sitemap icon + "TalentFlow" wordmark
- Nav links: muted white text, active = white text + subtle white background tint
- **Add Candidate**: teal solid pill button — always visible
- **Ask AI**: cyan outlined pill button — always visible, opens AI assistant
- Dividers between action groups
- Bell: notification badge (red dot) when unread
- Role pill: shows TA / HM / IT etc in cyan text on dark background
- Avatar: initials circle

### Signal Health Language (Universal — no exact times anywhere)

| Health State | Pill Text | Colour |
|-------------|-----------|--------|
| Breached | BREACHED | Red background, red text |
| At Risk | AT RISK | Amber background, amber text |
| On Track | ON TRACK | Green background, green text |
| Blocked | BLOCKED | Amber background, amber text |
| Pending | PENDING | Indigo background, indigo text |
| Waiting | WAITING | Neutral background, muted text |

SLA bar: visual fill only — no numbers, no time values, ever.

---

## SCREEN 1 — TA DASHBOARD

**Route:** `/talent-flow/dashboard`
**User:** Talent Acquisition Specialist
**Purpose:** Answer "What needs my attention right now?" — signal-first, not stage-first.

### Layout — Five Zones (top to bottom, strict priority order)

**Zone 1 — Signal Summary Strip**
Four metric cards in a horizontal row:
- SLA Breaches (red left border, red value)
- At Risk (amber left border, amber value)
- Acceptance Rate (green left border, green value)
- Active Pipeline (indigo left border, navy value)

Each card: eyebrow label (9px uppercase) + large number (Manrope 30px bold) + sub-text description.
No trend indicators. No delta numbers. No exact counts beyond the number itself.

**Zone 2 — Candidates at Risk**
Section header: "Candidates at risk" + breach badge + at-risk badge + "View all X →" link.
Maximum **2 candidate cards** shown. View all link handles the rest.

Candidate card layout (horizontal):
- Avatar (initials, colour coded by urgency: red gradient = breached, amber = at risk)
- Name + Role + Seniority pill + Sentiment pill
- Stage name + stage context (what is happening)
- Health pill (Breached / At Risk)
- SLA bar (visual fill, no numbers)

**Zone 3 — My Actions Today**
Section header: "My actions today" + pending count badge + "View all →" link.
Maximum **3 action items** shown.

Action item layout (horizontal):
- Icon square (30px, rounded, colour coded: red bg for breached, amber for at risk, indigo for pending)
- Action title (12px bold) + description (11px muted, truncated)
- Priority tag (Breached / At Risk / Blocked / Pending)

**Zone 4 — Pipeline Summary**
Two column grid alongside Zone 3.
Shows counts and health dots only — **no candidate names on dashboard**.

Pipeline row per phase:
- Phase name + sub-label (left)
- Health dots (one per candidate, colour = health state) (centre)
- Total count (large Manrope number) (right)

**Zone 5 — This Month**
Three quick stat cards:
- Offers sent (with breakdown: accepted / pending / declined)
- Avg interview-to-offer (days, green if healthy)
- Hesitant acceptances (amber, requires monitoring)

### Key Rules
- No candidate names in the pipeline summary zone
- No exact time values anywhere
- Dashboard is a glance — depth lives behind "View all" links
- Generous white space — not overwhelming
- AI assistant: floating button bottom-right — cyan/indigo gradient

---

## SCREEN 2 — PIPELINE VIEW

**Route:** `/talent-flow/pipeline`
**User:** TA
**Purpose:** Full candidate list for operational triage and management.

### Layout
- Page header: "Pipeline" + subtitle
- Top right: View toggle (List / Kanban) — List is default

**Filter Bar** (below header):
Five filter groups separated by dividers:
1. Stage chips (All stages / Interview / Offer Stage / Accepted / Pre-Onboarding)
2. Health chips (Breached / At Risk / On Track) — coloured when active
3. Seniority chips (Junior / Mid / Senior)
4. Hiring Manager chips (All HMs / individual names)
5. Sentiment chips (Hesitant / Reluctant — risk sentiments only)
Plus "Clear all" link at end.

**Results Bar:**
"Showing X candidates · Y breached · Z at risk" + sort dropdown (Health worst first default)

**List View Table — 7 columns:**
1. Candidate (avatar + name + role)
2. Stage (current stage name)
3. Sentiment (sentiment pill)
4. Seniority (seniority pill)
5. Hiring Manager (initials avatar + name)
6. SLA Health (health pill + SLA bar)
7. Action ("View" ghost button)

Default sort: Health worst first (Breached always at top).

**Kanban View:**
Columns per pipeline phase. Cards show: name, role, sentiment pill, health dot.
No drag-and-drop (stage transitions are workflow-gated).

---

## SCREEN 3 — CANDIDATES VIEW

**Route:** `/talent-flow/candidates`
**User:** TA
**Purpose:** Find and access any candidate record. Different from Pipeline — this is search-first.

### Layout
- Page header: "Candidates" + subtitle
- **Large search bar** (prominent, full width minus padding)
  - Magnifier icon inside input
  - Placeholder: "Search by name, email, role or department…"
  - ⌘K shortcut hint
  - Real-time search (minimum 2 characters)
- **Quick filter chips** below search:
  Breached · At Risk · Hesitant · Reluctant · Senior · Mid · Junior · Standard workflow · Government workflow

**Recently Viewed Section** (shown when no search active):
Section label: "Recently viewed · 4 candidates"
Four candidate cards in a 2×2 grid:
- Top border colour = health state
- Avatar + health pill (top row)
- Name + role
- Footer: stage name (left) + sentiment pill (right)
- "Viewed X ago" timestamp

**All Candidates Table** (below recently viewed):
Same columns as Pipeline list view. Default sort: Recently viewed.

When search is active: recently viewed cards hide, table filters to matches.
No results: empty state with icon + "No candidates found" + "Try a different name or role".

---

## SCREEN 4 — ADD CANDIDATE (Side Drawer)

**Trigger:** "Add Candidate" button in topbar
**Container:** Side drawer slides in from right (480px wide)
**Page behind:** Dimmed but visible — TA retains context

### Drawer Structure

**Header:**
- Title: "Add Candidate" (Manrope 15px bold)
- Subtitle: "Fill in what you have — interview setup is optional"
- Close button (X, top right)

**Record Completeness Bar:**
- Label: "Record completeness" + percentage (right)
- Progress bar (indigo fill)
- Note: lists required fields

**Section 1 — Candidate Details (required to create)**
Fields in two-column rows:
- First name + Last name
- Email + Phone
- Role + Department
- Location + Source (dropdown)
- Years of experience (single)
- **Seniority selector** — visual three-option card selector (NOT a dropdown):
  - Junior: "Graduate · Entry level"
  - Mid: "Professional · Specialist"
  - Senior: "Manager · Director · Exec"
  - Selected: indigo border + light indigo background
- **Workflow template selector** — visual two-option card selector:
  - Standard: teal dot + "Default hiring workflow"
  - Government: indigo dot + "Statutory clearances required"
  - Default: Standard selected

**Section 2 — First Interview Setup (optional, clearly labelled)**
Toggle: "Schedule first interview now" — default OFF.
When ON reveals:
- Interview Type (dropdown) + Format (dropdown)
- Proposed Date
- Panel Members: search input + added members list + "Add someone not in the directory" button

Panel member rows show: avatar, name, role, badge (System user = indigo / Scoring link = green), remove X.

**Drawer Footer (always visible, never scrolls away):**
- Cancel (ghost button, left)
- Create Candidate Record (gradient CTA, fills remaining space)
- Small note: "→ Opens candidate record on creation"

**On completion:** Drawer closes → navigates to new candidate record.

### Field Design Rules
- Labels: 9px uppercase, letter-spaced, muted
- Required fields: red asterisk (*)
- Filled state: indigo tinted border + very subtle indigo background tint
- Focus: indigo border + 2px indigo ring at 10% opacity
- All inputs consistent height, 7px vertical padding

---

## SCREEN 5 — CANDIDATE RECORD

**Route:** `/talent-flow/candidates/:id`
**User:** TA (primary), HM (limited view)
**Purpose:** Full candidate workspace — all information and actions for one candidate.

### Layout Structure (top to bottom)

**Breadcrumb:** Pipeline → [Stage] → [Candidate Name]

**Persistent Header (always visible):**
- Avatar (initials, 44px, colour coded by urgency)
- Name (Manrope 17px bold)
- Pills row: Role pill + Seniority pill + Sentiment pill + Source + experience
- Right: Stage name + Health pill + SLA bar + **Reject Candidate** button (subtle red, header only)

**Details Strip (5 columns):**
Applied date · Department · Location · Workflow · Seniority
9px uppercase labels, 12px medium values.

**Four Phase Indicator:**
Horizontal stepper showing four phases with short descriptions:
- Phase 1: Interview & Evaluation — "Screen, evaluate, decide"
- Phase 2: Offer & Acceptance — "Create, approve, convert"
- Phase 3: Pre-Onboarding — "Prepare, provision, clear"
- Phase 4: Onboarding & Day 1 — "Engage, activate, confirm"
Visual states: done (green tick), active (indigo dot + glow), pending (grey).

**Actions Bar:**
All buttons identical ghost style — transparent background, outline border, same height.
Icon left of label on every button. Pill shape.
Stage-contextual actions (change based on current stage).
Example for Interview Loop: Schedule Interview · Update Sentiment · Log Panel Score · Add Panel Member · Send Scoring Link · View All Stages

**Tab Bar (fixed, always same tabs):**
Overview | Interviews | Offer | Engagement | Notes

**Content Area (two column):**
- Left: Tab content (stage-driven, changes based on active tab and current stage)
- Right: Activity Log panel (268px, persistent, always visible)

### Interviews Tab Content (when in Interview Loop)

**Signal Intelligence Box** (indigo tinted, appears when risk signal active):
- Small indigo icon
- "Signal Intelligence" eyebrow label
- One or two specific sentences about current risk + recommended action
- Only shown when risk is present — not shown when healthy

**Interview Rounds (stacked cards):**
- Completed rounds: collapsed summary (avg score, panel vote, sentiment) — read-only
- Active round: expanded card with full panel member list, scoring progress, inline actions
- Pending rounds: not shown until scheduled

Active round card contains:
- Panel member rows: avatar, name, role, score status tag, score value
- Score dimensions grid (2×2): dimension label, progress bar (3px), value
- Inline round actions (small ghost pill buttons): Add Member · Enter Score on Behalf · Send Scoring Link

**Sentiment Selector:**
Five-option visual selector (horizontal row):
Excited · Positive · Neutral · Hesitant · Reluctant
Each: coloured dot + label. Selected: highlighted border + tinted background.
Updates on click — no separate save button.

### Activity Log Panel (Right Side — always visible)
- Header: "Activity Log" (11px uppercase Manrope)
- Filter chips: All · Interviews · Scores · Sentiment (text only)
- Chronological feed, newest first
- Each item: coloured dot + connector line + what happened + who + when
- Dot colours: blue (TA actions), green (completions), amber (sentiment/risk), grey (setup)
- Timestamps shown here — this is the one place timestamps appear (explicit audit view)

---

## SCREEN 6 — OFFER TAB (within Candidate Record)

**Location:** "Offer" tab within the candidate record (Screen 5)
**Purpose:** Manage the full offer lifecycle — state-driven, one active state at a time.

### State Navigator (top of tab)
Four states shown as a journey:
Offer Created → In Approval → Offer Sent → Accepted
- Completed: green pill + tick
- Active: indigo pill + spinner
- Pending: muted pill, dimmed

### Four State Blocks (stacked)
Only active state is fully interactive.
Completed states: collapsed read-only summary.
Future states: visible but dimmed (opacity 0.5, non-interactive).
Active state: indigo border (1.5px).

**State 1 — Offer Creation:**
Fields: Official role title + Department + Location (pre-populated, confirm)
+ Total CTC + Proposed start date + Offer expiry + Benefits/notes
Once submitted: all fields lock to read-only display. Lock note shown.

**State 2 — Approval Chain:**
Vertical step-by-step flow:
- Each step: numbered dot (green=done, amber=active, grey=pending) + approver name/role + status badge
- Connector line between steps
- Signal Intelligence box when approval step is at risk
- Actions: "Remind [Approver]" ghost + "Send Reminder Now" primary CTA
- Chain is seniority-driven (Senior = TA → HM → HR Director)

If approver rejects: step turns red, rejection reason shown, TA prompted to amend and resubmit from rejection point only.

**State 3 — Offer Sent:**
- Sent date + Response window
- SLA health bar (no numbers)
- Interaction log (chronological): type badge (Call/Email/WhatsApp/Meeting) + outcome + note + date
- "+ Log Interaction" button
- Outcome options: Acknowledged / Asking Questions / Counter Received / Going Quiet / Verbal Accept / Declined
- Counter Received: Signal Intelligence box appears immediately
- "Mark as Sent Externally" action — no document generation in platform

**State 4 — Offer Acceptance (The Conversion Point):**
Four mandatory fields:
1. Acceptance date (auto-populated, editable)
2. Confirmed start date (mandatory)
3. Acceptance sentiment (five-option visual selector — same design as sentiment selector)
4. Notes (optional)

Downstream triggers visualisation (three cards):
- 48hr engagement countdown starts
- IT & Facilities notified
- Risk signal surfaced (if Hesitant/Reluctant)

Confirm button: **"Confirm Acceptance & Trigger Workflows"** — deliberate label.

---

## SCREEN 7 — HIRING MANAGER VIEW

**Route:** `/talent-flow/hm-dashboard`
**User:** Hiring Manager only
**Purpose:** Answer "What decisions and actions do I need to take right now?"

### Topbar Differences from TA
- Nav links: My Tasks · My Candidates · Decisions (three only)
- No Add Candidate button
- Role pill shows HM (not TA)
- Avatar: teal gradient (visual role differentiation)

### Layout (vertical stack)

**Page header:** "Good morning, [Name]" + pending action count

**Signal Strip (3 cards only — maps to HM's 3 jobs):**
- Scores Due (red)
- Decisions Pending (amber)
- Engagement Tasks (indigo)

**Two Column Grid:**
Left: Pending actions list (task cards, urgency ordered)
Right: My candidates list (assigned candidates only)

**Task Card Layout:**
- Left border colour = urgency (red/amber/indigo)
- Task type eyebrow label: "Score candidate" / "Final decision" / "First engagement"
- Candidate name (12px bold)
- Context line (round, interview type, or relevant detail)
- Priority tag (Breached / At Risk / Pending / Due)

**Task Ordering (always by urgency):**
1. Breached (red) — score tasks past SLA
2. At Risk (amber) — approaching SLA
3. Pending (amber) — decisions awaiting
4. Due (indigo) — engagement tasks

**Scoring Panel (opens inline below dashboard when task clicked):**
- Section label: candidate name + round + health tag
- Panel header: "Score Candidate" + round + close button
- Candidate summary strip: avatar, name, role pill, seniority pill, sentiment pill, round indicator
- **Signal Intelligence box** (always shown — connects HM action to Golden Truth)
- Two column body:
  - Left: four dimension sliders (Technical, Communication, Cultural Fit, Problem Solving — each 1–10)
  - Right: Overall Vote (2×2 grid: Strong No / No / Yes / Strong Yes) + Feedback textarea
- Footer: Save Draft (ghost) + Submit Evaluation (gradient CTA) + "Cannot be changed after submission"

---

## COMPONENT PATTERNS (Universal)

### Candidate Card (appears in multiple screens — consistent structure)
| Element | Position | Always shown |
|---------|----------|-------------|
| Avatar initials | Left | Yes — colour = urgency |
| Name | Centre-left | Yes |
| Role + Seniority pill + Sentiment pill | Below name | Yes |
| Stage name | Right | Yes |
| Stage context | Below stage | Yes |
| Health pill | Bottom right | Yes |

No exact times. No countdown numbers. Ever.

### Ghost Action Buttons (universal pattern)
- All action buttons: identical ghost style
- Transparent background, 1px outline border
- Icon left of label (11px icon, 11px label)
- Pill shape (border-radius: 9999px)
- Hover: surface-low background + indigo text + indigo border
- No size hierarchy between buttons — all equal

### Signal Intelligence Box (appears at every trigger point when risk is active)
- Subtle indigo tinted background + indigo border
- Small indigo icon (info-circle)
- "Signal Intelligence" eyebrow (9px uppercase, indigo)
- 1–2 sentences: current signals + specific recommended action
- Always specific to the candidate's state — never generic
- Only shown when risk signal is present

---

## ROUTING STRUCTURE

```
/talent-flow/                     → redirects to dashboard
/talent-flow/dashboard            → TA Dashboard (Screen 1)
/talent-flow/pipeline             → Pipeline View (Screen 2)
/talent-flow/candidates           → Candidates View (Screen 3)
/talent-flow/candidates/:id       → Candidate Record (Screen 5)
/talent-flow/offers               → Offers View (Screen 6 entry point)
/talent-flow/hm-dashboard         → Hiring Manager View (Screen 7)
/talent-flow/config/              → Config Hub (System Admin only)
/talent-flow/config/scoring-weights
/talent-flow/config/sla-thresholds
/talent-flow/config/panel-rules
```

---

*Read TALENTFLOW_DECISIONS.md for the full decision rationale behind every element above.*
*Read .claude/SKILL.md for tech stack rules and how to implement using PrimeNG and the Naleko design system.*
