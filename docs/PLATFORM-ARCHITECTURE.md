# Naleko Platform Architecture — Golden Path

**Status:** DECISION LOCKED — all agents and PRs must follow this document  
**Date locked:** 18 May 2026  
**Supersedes:** Any prior flowcharts, BRD references, or ad-hoc route decisions in chat history  
**Authority:** This document + `docs/TALENT-FLOW-PLAN-REVISED.md` (for TalentFlow internals)

---

## 1. The Core Decision — One Login, One Platform

**There is exactly one login** for the entire Naleko platform.  
Module routing is driven by `cognito:groups` — not separate Cognito pools, not separate login pages per module.

The TalentFlow Cognito pool (`af-south-1_C8TTlQxY7`) is an **infrastructure artefact** from Epic 1. The API Gateway JWT authoriser currently points at it. This stays for now. But from a **user perspective** there is one login experience at `/login` and one platform home at `/platform/home`.

**The migration path:**  
- Today: two Cognito pools exist (Naleko + TalentFlow). The unified login page authenticates against the Naleko pool. Module access is gated by Naleko group membership.
- TalentFlow API calls still use TalentFlow pool tokens (via `TalentFlowAuthService`) until the pools are merged in a future Epic.
- Epic 5 / Epic 6: consolidate pools. One pool, one token, one authoriser everywhere.

---

## 2. Full User Journey — Landing to Module

```
naleko.app (public)
    │
    ├─ [Sign In] ──────────────────────────────────────────────────────►  /login
    │                                                                       │
    └─ [Request Access / Book a Demo] ──► Calendly / Marketing flow        │ email + password
                                                                            │ (Naleko Cognito pool)
                                                                            ▼
                                                               cognito:groups extracted from JWT
                                                                            │
                             ┌──────────────────────────────────────────────┤
                             │                                              │
                  has naleko-onboarding-hr                    no recognised group
                  OR naleko-talentflow-hr                         │
                             │                                   ▼
                             ▼                          /unauthorised  (403 page)
                    /platform/home
                    (Platform Home — module tile grid)
                             │
              ┌──────────────┼──────────────────────┐
              │              │                       │
 has naleko-onboarding-hr    │        has naleko-talentflow-hr
              │         (tile greyed             │
              ▼          / locked)               ▼
  /platform/onboarding            /platform/talentflow
  (Onboarding Module)             (TalentFlow Module)
  Candidate pipeline              Epic 4 pages FE-001 to FE-007
  Document uploads
  Risk classification
```

---

## 3. Cognito Groups — Module Access Map

| Cognito Group (Naleko pool) | Module Access | Route |
|---|---|---|
| `naleko-onboarding-hr` | Onboarding module | `/platform/onboarding/*` |
| `naleko-talentflow-hr` | TalentFlow module | `/platform/talentflow/*` |
| `naleko-it-hr` | IT Requests *(Future — Epic 7+)* | `/platform/it-requests/*` |
| `naleko-employee-self` | Employee 360 *(Future — Epic 7+)* | `/platform/employee-360/*` |
| `hr_staff` (legacy) | Legacy `/hr/:staffId` dashboard | kept until migrated |
| `employee` (legacy) | Legacy `/employees/:id` dashboard | kept until migrated |
| *(no group)* | Redirected to `/unauthorised` | — |

**TalentFlow-internal Cognito groups (TF pool — controls UI permissions within TalentFlow):**

| TF Cognito Group | What it unlocks inside TalentFlow |
|---|---|
| `TalentFlowAdmin` | Full access + config management pages |
| `HiringManager` | Create candidates, manage pipeline, approve offers |
| `PanelMember` | Submit votes for assigned interviews |
| `ComplianceOfficer` | Read-only audit access |
| `ITAdmin` | Infrastructure and config read |
| `FinanceLead` | Budget approval in offer stage |
| `HRDirector` | Dashboard and reporting |

> Note: TF pool groups are checked by `TalentFlowAuthService` / `adminGuard` after the user is already inside `/platform/talentflow`. They are independent of the Naleko pool groups above.

---

## 4. Full Angular Route Tree

```
app.routes.ts (root router)
│
├── /                   → LandingComponent          [PUBLIC — no guard]
├── /login              → LoginComponent            [loginPageGuard: redirect if already authed]
├── /unauthorised       → UnauthorisedComponent     [PUBLIC]
│
├── /platform           → PlatformShellComponent    [authGuard — Naleko pool JWT required]
│   ├── /platform/home  → PlatformHomeComponent     (module tile grid + activity feed)
│   │
│   ├── /platform/onboarding   [moduleGuard: naleko-onboarding-hr]
│   │   ├── /platform/onboarding/candidates          → CandidateListPage
│   │   ├── /platform/onboarding/candidates/:id      → CandidateDetailPage
│   │   └── /platform/onboarding/documents           → DocumentsPage
│   │
│   ├── /platform/talentflow   [moduleGuard: naleko-talentflow-hr]
│   │   ├── /platform/talentflow                     → TalentFlowDashboardPage
│   │   ├── /platform/talentflow/pipeline            → PipelinePage
│   │   ├── /platform/talentflow/candidates/new      → CandidateCreatePage
│   │   ├── /platform/talentflow/candidates/:id      → CandidateWorkspacePage
│   │   ├── /platform/talentflow/candidates/:id/evaluate → EvaluationPage
│   │   ├── /platform/talentflow/config/scoring      → ScoringWeightsPage  [adminGuard]
│   │   ├── /platform/talentflow/config/sla          → SLAThresholdsPage   [adminGuard]
│   │   └── /platform/talentflow/config/panel        → PanelRulesPage      [adminGuard]
│   │
│   ├── /platform/it-requests  [moduleGuard: naleko-it-hr]  ← FUTURE Epic 7+
│   └── /platform/employee-360 [moduleGuard: naleko-employee-self] ← FUTURE Epic 7+
│
├── /hr/:staffId        → HrDashboardComponent      [LEGACY — keep until migrated]
└── /employees/:id      → EmployeeDashboardComponent [LEGACY — keep until migrated]
```

### Route Guards Summary

| Guard | Logic |
|---|---|
| `authGuard` | Checks `AuthService.isAuthenticated`. If not authed → `/login` |
| `loginPageGuard` | If already authed → `/platform/home`. Prevents back-button re-login |
| `moduleGuard(group)` | Checks `AuthService.currentUser().groups.includes(group)`. If not in group → `/platform/home` (tile is locked/upgrade prompt) |
| `adminGuard` (TF-internal) | Checks `TalentFlowAuthService.isAdmin()`. If not admin → `/platform/talentflow` |

---

## 5. Landing Page — `/`

Public, no auth required. Goal: convert visitors to sign-up requests or demos.

### Section Order (top to bottom)

| # | Section | Content |
|---|---|---|
| 1 | **Hero** | Naleko logo, tagline "Intelligent HR for Africa", sub "Onboard faster. Hire smarter. Manage better.", `[Sign In]` + `[Request Access]` CTAs, animated platform screenshot loop in background |
| 2 | **Social Proof Bar** | "Trusted by 12 SA companies" — logo strip (anonymised or real clients) |
| 3 | **Module Showcase** | 3 cards side-by-side: 📋 Onboarding · 🎯 TalentFlow · 🖥️ IT Requests. Each card: real screenshot + 3-bullet value prop. Hover: short animated GIF of that module in use |
| 4 | **How It Works** | Step 1: Sign in → Step 2: Pick your module → Step 3: Invite your team → Step 4: Go live. Animated step-through, 4 frames |
| 5 | **Feature Deep-Dives** | Alternating image + text rows: Onboarding (WhatsApp candidate flow + risk classification), TalentFlow (Requisition → Pipeline → Offer), IT Requests (Raise → Approve → Provision — *coming soon*) |
| 6 | **Trust Section** | POPIA compliant · AWS hosted in `af-south-1` · SOC2 ready · End-to-end encryption |
| 7 | **Testimonials** | 2–3 quotes from HR managers (real if available, placeholders until then) |
| 8 | **CTA Footer** | `[Request Access]` `[Book a Demo]` — LinkedIn · Email · Privacy Policy |

---

## 6. Login Page — `/login`

Single login for all users — no "which module?" decision at login time.

| Element | Detail |
|---|---|
| Email input | Standard text input, auto-focus |
| Password input | Password type, show/hide toggle |
| Forgot password | Link → Cognito forgot password flow |
| Auth call | `AuthService.login(email, password)` — Naleko Cognito pool ONLY |
| On success | Decode JWT → extract `cognito:groups` → redirect to `/platform/home` |
| On `NEW_PASSWORD_REQUIRED` | Inline "set new password" form (same page, no redirect) |
| On failure | Inline error below password field (no toast) |
| No module selector | Never ask the user which module they want at login time |

---

## 7. Platform Home — `/platform/home`

First page every authenticated user sees after login — regardless of which module they have access to.

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  TOP NAV (global, persistent across all /platform/* pages)      │
│  🔷 Naleko  |  Home  |  Notifications 🔔  |  👤 Jane ▾  |  Sign Out │
├─────────────────────────────────────────────────────────────────┤
│  GREETING BANNER                                                │
│  "Good morning, Jane 👋"                                        │
│  "Your HR workspace at [Company Name]"                          │
├──────────────────────────────┬──────────────────────────────────┤
│  MODULE TILES  (2×2 grid)    │  RECENT ACTIVITY FEED            │
│                              │  Today 09:14  Thabo Nkosi —      │
│  📋 ONBOARDING               │  document uploaded               │
│  ─────────────────           │                                  │
│  5 candidates active         │  Today 08:50  REQ-042 moved      │
│  2 docs pending review       │  to Interview stage              │
│  1 HIGH risk flag            │                                  │
│  [Open Onboarding →]         │  Yesterday  Lerato Dlamini —     │
│                              │  POPIA risk flagged HIGH         │
│  🎯 TALENTFLOW               │                                  │
│  ─────────────────           ├──────────────────────────────────┤
│  3 open requisitions         │  QUICK LINKS                     │
│  12 candidates in pipeline   │  [+ New Candidate]               │
│  2 interviews this week      │  [+ New Requisition]             │
│  [Open TalentFlow →]         │  [📊 Reports]                    │
│                              │                                  │
│  🖥️ IT REQUESTS              │                                  │
│  ─────────────────           │                                  │
│  🔒 Not in your plan         │                                  │
│  [Learn More / Upgrade]      │                                  │
│                              │                                  │
│  👤 EMPLOYEE 360             │                                  │
│  ─────────────────           │                                  │
│  🔒 Coming soon              │                                  │
│  [Join Waitlist]             │                                  │
└──────────────────────────────┴──────────────────────────────────┘
```

### Module Tile States

| State | Trigger | Visual |
|---|---|---|
| **Active** | User has the required Cognito group | Full colour, live stats, `[Open Module →]` CTA clickable |
| **Locked / Upgrade** | User authenticated but not in group | Greyed tile, lock icon 🔒, upgrade/contact CTA — tile is visible but not clickable |
| **Coming Soon** | Module not yet deployed | Dark grey, "Coming soon" label, waitlist CTA |

### Live Stats in Tile (sourced from API on home page load)

| Module | Stats shown |
|---|---|
| Onboarding | Active candidate count · Docs pending review · HIGH risk flag count |
| TalentFlow | Open requisitions · Candidates in pipeline · Interviews scheduled this week |
| IT Requests | Open requests · SLA breach count *(future)* |

---

## 8. What Needs to Be Built (Gap vs Current State)

Current codebase has TalentFlow living at `/talent-flow/*`. The golden path requires it at `/platform/talentflow/*`. The current login is the Naleko login at `/login`. The shell and platform home don't exist yet.

### Components / Pages to Build

| Item | Priority | Notes |
|---|---|---|
| `LandingComponent` at `/` | Epic 5 | Public marketing page (sections 1–8 above) |
| `UnauthorisedComponent` at `/unauthorised` | Epic 5 | 403 page with link back to `/platform/home` |
| `PlatformShellComponent` at `/platform` | **Epic 5 — blockers everything** | Top nav (global), `<router-outlet>`, applies `authGuard` |
| `PlatformHomeComponent` at `/platform/home` | **Epic 5** | Module tile grid + live stats + activity feed |
| `moduleGuard` | **Epic 5** | Checks Naleko group → redirect to `/platform/home` if not in group |
| `loginPageGuard` | Epic 5 | Redirect away from `/login` if already authed |
| Migrate routes from `/talent-flow/*` → `/platform/talentflow/*` | Epic 5 | Update `app.routes.ts` + all `router.navigate()` calls |
| `TalentFlowShellComponent` logout redirect → `/platform/home` | Epic 5 | Currently redirects to `/login` |

### What Must NOT Change Yet

| Item | Reason |
|---|---|
| `TalentFlowAuthService` (uses TF Cognito pool) | API Gateway authoriser still validates TF pool tokens. Don't merge pools until Infra task |
| `TalentFlowApiService.authHeaders()` | Must continue using TF pool JWT for API calls |
| TalentFlow internal `adminGuard` | Fine as-is — checks `TalentFlowAuthService.isAdmin()` |
| Legacy `/hr/:staffId` and `/employees/:id` routes | Keep in `app.routes.ts` until migrated in Epic 6 |

---

## 9. Future — Nx Monorepo (Epic 6)

Today, everything lives in a single Angular app at `hr-portal/`. Epic 6 restructures into an Nx monorepo:

```
naleko/                          ← Nx workspace root
  apps/
    hr-portal/                   ← promoted from current hr-portal/ (HR staff app)
    marketing/                   ← new — separate Vercel deployment, public site
    employee-self/               ← Employee 360 app (Epic 7+)
  libs/
    @naleko/auth                 ← AuthService, guards (shared across apps)
    @naleko/ui                   ← PrimeNG wrappers, design tokens
    @naleko/core                 ← API client, types, models
    @naleko/onboarding           ← shared onboarding logic
```

Each `apps/*` gets its own Vercel project. `@naleko/*` libs are build-time imports only — no runtime federation.

**Estimated:** 5–8 days migration. `npx create-nx-workspace` → move + rewire imports → test all routes.

---

## 10. Vercel Deployment Map (Post-Epic 6)

| Vercel Project | App | Domain |
|---|---|---|
| `naleko-marketing` | `apps/marketing/` | `naleko.app` (root) |
| `naleko-hr-portal` | `apps/hr-portal/` | `app.naleko.app` |
| `naleko-employee-self` | `apps/employee-self/` | `me.naleko.app` *(future)* |

Today: single Vercel project `naleko-hr-portal` serving everything including the `/` public landing page.

---

## 11. Agent Instructions — Using This Document

1. **Before any FE task**, re-read sections 2, 3, 4 of this document to confirm route paths and guard requirements.
2. **All new platform routes** go under `/platform/*` — never at the top level (exception: `/login`, `/`, `/unauthorised`).
3. **One `AuthService`** (Naleko pool) for global authentication. `TalentFlowAuthService` is only for TalentFlow API JWT signing until pools are merged.
4. **Module routing is group-based** — never hardcode which module a user goes to. Always read `cognito:groups` from the JWT.
5. **`/talent-flow/*` routes are LEGACY** — do not add new routes there. New TalentFlow pages go to `/platform/talentflow/*` once `PlatformShellComponent` is built.
6. **Epic 5 is the prerequisite** for any cross-module work. Do not attempt unified login testing until `PlatformShellComponent` + `PlatformHomeComponent` + `moduleGuard` are built and deployed.
