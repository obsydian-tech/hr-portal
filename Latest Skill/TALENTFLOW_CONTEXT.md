# TalentFlow Platform — Project Context
## For Claude Code | Read This First

---

## WHAT THIS PLATFORM IS

TalentFlow is a **candidate experience protection system** — not an HR admin tool.
Every screen, every button, every automated action must serve one of three outcomes:

1. **Identify bottlenecks** in the hiring process
2. **Improve candidate experience** at every stage
3. **Reduce drop-off** between offer acceptance and Day 1

If a feature does not move one of these three outcomes, it does not belong in MVP 1.

---

## THE GOLDEN TRUTH

Every stage of the hiring process has a **measurable signal**. The platform exists
to surface these signals, act on them, and protect the candidate journey.

### The Six Tracking Triggers

| # | Trigger | Signal |
|---|---------|--------|
| 1 | First Interview | First interaction logged + candidate sentiment (interest baseline) |
| 2 | Interview Loop | Response time between interviews + engagement score |
| 3 | Offer Stage | Offer turnaround time + candidate responsiveness |
| 4 | Offer Acceptance | Acceptance timestamp + sentiment (excited/hesitant) |
| 5 | First Engagement | Time from acceptance to first meaningful contact (< 48hrs) |
| 6 | Day 1 | Readiness score: Equipment + Access + Engagement |

### The Four Success Metrics

1. Time to First Engagement — target under 48 hours from offer acceptance
2. Time to Onboard — offer accepted to Day 1
3. Day 1 Readiness — target 100%
4. Candidate Experience Score — post Day 1 survey

---

## MVP 1 SCOPE — WHAT WE ARE BUILDING NOW

MVP 1 covers the full candidate journey from **creation through to offer acceptance**
(Triggers 1–4). Triggers 5 and 6 are MVP 2.

### In scope for MVP 1:
- Candidate record creation with data completeness gates
- Seniority level as master configuration parameter (Junior / Mid / Senior)
- First Interview scheduling and sentiment capture (Trigger 1)
- Interview Loop — flexible rounds and types (Trigger 2)
- Panel scoring — hybrid model (system accounts + email scoring links + TA proxy)
- Internal directory + ad hoc panel member addition
- Offer creation with configurable approval chain per seniority (Trigger 3)
- Offer sent tracking and candidate interaction log
- Offer acceptance capture with sentiment and confirmed start date (Trigger 4)
- Simultaneous downstream notifications to IT & Facilities at acceptance
- Universal Risk Timer Model (50/75/100) across all triggers
- Signal-first TA dashboard organised by urgency — not by stage
- AI assistant — signal-aware chat, floating button in topbar
- Intelligence signals and risk surfacing at every trigger point
- Configurable rejection model per seniority profile
- In-app notifications with badge counts and direct candidate links
- Full audit trail across all actions and state transitions
- Multi-tenant support with admin-level configurability

### Out of scope for MVP 1:
- IT Provisioning module → MVP 2
- First Engagement tracking (Trigger 5) → MVP 2
- Day 1 Readiness scoring (Trigger 6) → MVP 2
- Onboarding document upload → MVP 2
- Government compliance clearances → MVP 2
- Email notifications → MVP 2
- Reporting and analytics hub → MVP 2

---

## THE 12-STAGE PROCESS

Grouped into four phases. MVP 1 covers Phases 1 and 2 fully.

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

**Phase 3 — Pre-Onboarding & Preparation** (Stages 9–10) ← MVP 2
9. Pre-Onboarding Initiated
10. IT & Facilities Preparation

**Phase 4 — Onboarding & First Day** (Stages 11–12) ← MVP 2
11. First Engagement Touchpoint
12. Day 1 Onboarding

---

## CORE ROLES (MVP 1)

| Role | Purpose | System Access |
|------|---------|---------------|
| **Talent Acquisition Specialist (TA)** | Primary orchestrator. Owns the full process end-to-end. Captures sentiment. Coordinates interviews. | Full platform access |
| **Hiring Manager (HM)** | Scores candidates. Makes hire/reject decisions. Owns first engagement post-acceptance. | Focused task view |
| **IT Administrator** | Owns provisioning checklist | MVP 2 |
| **Facilities/Admin** | Physical workspace readiness | MVP 2 |
| **System Admin** | Tenant config, workflow templates, sentiment scales | Config pages only |

The primary role is called **Talent Acquisition Specialist** or **TA** — never just "HR".

---

## UNIVERSAL RISK TIMER MODEL

Every SLA in the platform follows the same 50/75/100 percentage model.
**Never surface exact time values** on any screen. Use health states only.

| Threshold | Health State | Colour | Who is Notified |
|-----------|-------------|--------|-----------------|
| Below 50% elapsed | On Track | Green | No one |
| 75% elapsed | At Risk | Amber | TA only |
| 100% elapsed | Breached | Red | TA + Hiring Manager |

Health state language across the entire platform:
- **Breached** — red — action required now
- **At Risk** — amber — action required today
- **On Track** — green — no intervention needed
- **Blocked** — amber — data gate incomplete
- **Pending** — indigo — action awaiting TA
- **Waiting** — neutral — ball in someone else's court

---

## PROJECT STRUCTURE

```
HR Portal Naleko/               ← repo root — place context files here
├── hr-portal/                  ← Angular 19 frontend
│   └── src/app/
│       ├── core/               ← auth, interceptors, guards, services
│       ├── features/
│       │   └── talent-flow/    ← TalentFlow feature module (REBUILD UI HERE)
│       │       ├── components/ ← shared UI components
│       │       ├── pages/      ← routed page components
│       │       ├── services/   ← API services (REUSE PATTERNS)
│       │       ├── models/     ← TypeScript interfaces (REVIEW AND EXTEND)
│       │       └── shell/      ← shell/layout component
│       └── shared/             ← shared components across features
├── talent-flow-infra/          ← TalentFlow Terraform (USE THIS — not /infra)
├── lambda/                     ← All Lambda functions
│   ├── shared/                 ← Shared utilities (config-reader.js, idempotency.mjs)
│   ├── createCandidate/
│   ├── getCandidate/
│   ├── getCandidates/
│   ├── scheduleInterview/
│   ├── submitVote/
│   ├── completeEvaluation/
│   ├── orchestrateTalentFlowWorkflow/
│   ├── monitorTalentFlowSLAs/
│   ├── manageTalentFlowConfig/
│   ├── advanceCandidateStage/
│   ├── sendTalentFlowNotification/
│   └── talentFlowAiChat/
└── docs/                       ← Documentation
    └── Event Driven Architecture Docs/
```

---

## INFRASTRUCTURE REFERENCE

- **Active Terraform:** `talent-flow-infra/` — use this for all infrastructure work
- **Legacy Terraform:** `infra/` — this is the HR onboarding system, do not modify
- **Active Lambdas:** those listed above under `lambda/` prefixed with talentFlow or matching TalentFlow functionality
- **Legacy Lambdas:** createEmployee, getEmployee, processDocumentOCR, reviewDocumentVerification — these are HR onboarding, do not touch

---

## HOW TO READ THE CONTEXT FILES

Read these four files in order before doing any work on this project:

1. `TALENTFLOW_CONTEXT.md` ← you are here — what we are building and why
2. `TALENTFLOW_DECISIONS.md` ← 71 locked product and UX decisions
3. `TALENTFLOW_SCREENS.md` ← screen-by-screen UX specifications
4. `.claude/SKILL.md` ← how to work in this codebase, tech stack rules, design system

---

## WHAT TO REUSE vs REBUILD

### REUSE (do not reinvent these):
- `hr-portal/src/app/core/services/auth.service.ts` — authentication patterns
- `hr-portal/src/app/core/interceptors/auth.interceptor.ts` — auth headers
- `hr-portal/src/app/features/talent-flow/services/talent-flow-api.service.ts` — API communication patterns
- `hr-portal/src/app/features/talent-flow/services/talent-flow-state.service.ts` — state management patterns
- `hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts` — review and extend, do not replace blindly
- `hr-portal/src/app/features/talent-flow/talent-flow.routes.ts` — routing structure (extend, not replace)
- CORS configuration, error handling patterns, environment configuration

### REBUILD (these do not match locked UX decisions or Naleko design system):
- All UI components in `talent-flow/components/` — rebuild to match TALENTFLOW_SCREENS.md
- All page components in `talent-flow/pages/` — rebuild to match locked screen specs
- Shell/layout — rebuild to match locked top navigation structure
- Dashboard — completely different signal-first design from what exists

---

*Next: Read TALENTFLOW_DECISIONS.md*
