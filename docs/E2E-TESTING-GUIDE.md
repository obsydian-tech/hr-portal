# TalentFlow E2E Testing & Troubleshooting Guide

**Living document — updated as we test and fix.**
Last updated: 2026-06-04 (Phase 9 — Admin Workspace Naleko Alignment + Drawer Consistency + Config Pages Sweep)

---

## How to use this guide

This is a running log of every bug found, confirmed, and fixed during end-to-end workflow testing of the TalentFlow platform. For each issue it captures:
- What broke and what error to look for
- Which AWS service / layer to investigate
- The root cause
- The fix (always at the correct layer — no data seeding shortcuts)
- Status

---

## Test Candidates

| ID | Name | Level | Created | Final Stage | Notes |
|---|---|---|---|---|---|
| `CAND-01KT11912DY8NAC0F9PNQ6DMKF` | June July | Senior | 2026-06-01T07:27Z | `APPLICATION_REVIEW` | Original test candidate — BUG-001/002/003 era |
| `CAND-01KT14TFD46JSEB5MNA68WN3NC` | _(test)_ | — | 2026-06-01 | `APPLICATION_REVIEW` | Stale SAGA patched (BUG-004 manual fix) — discard |
| `CAND-01KT1558317GRG3Y1DSFQP1CSB` | _(test)_ | — | 2026-06-01 | `PHONE_SCREENING` | Stage no longer valid in 10-stage pipeline — discard |
| `CAND-01KT190NKFS4BMWSMH06W015WP` | _(test)_ | JUNIOR | 2026-06-01T09:42Z | `ONBOARDING` | Raced through all stages — BUG-005 era, gate was skipped — discard |
| `CAND-01KT1N9BQ9AH8ATEPJYAP2HYDY` | Ryan Giggs | JUNIOR | 2026-06-01T13:17Z | `EVALUATION` | Phase 4 pre-fix test — department/location empty (created before BUG-009 fix), interview loop completed manually |
| `CAND-01KT1Q9A6RRY8TEMA7TS5B8P2E` | _(Phase 5 test)_ | JUNIOR | 2026-06-01T13:52Z | `EVALUATION` | ✅ **Primary Phase 5 reference candidate** — all 3 interviews (Phone Screen → Behavioral → Final) completed with PASS, advanced to EVALUATION cleanly |
| `CAND-01KT3T202MG6EY83VDRRAGRP68` | _(Phase 7 test)_ | JUNIOR | 2026-06-02 | `INTERVIEWING` | Phase 7 initial vote testing — used to verify panel member sub fix (BUG-022) |
| `CAND-01KT3Y068RZVX3HHG1CA3PG87T` | _(Phase 7 vote)_ | JUNIOR | 2026-06-02 | `EVALUATION` | **Primary Phase 7 reference candidate** — vote display, TA proxy capture, HM voting, and duplicate guard all confirmed on this candidate |
| `CAND-01KT4005Z7NRHBQK68AQW8SM54` | _(Phase 7.1 adhoc)_ | JUNIOR | 2026-06-02 | `INTERVIEWING` | Phase 7.1 — adhoc panel member fix candidate; `panelMemberIds=['b10ca268-...']` (Tshepo, already voted), `adhocPanelMembers=[test panel, Another member, nso]`, `votesRequired=4`, `votesSubmitted=1` |

> **Active test candidate:** `CAND-01KT4005Z7NRHBQK68AQW8SM54` — Phase 7.1 in progress. Create a fresh candidate for any future regression tests.

---

## Platform Users & Roles (NALEKO tenant)

### Cognito Pool Architecture — IMPORTANT (updated Phase 6 — pool consolidation)

There are **two separate Cognito pools**. Everyone logs in via the **Naleko pool** — the TF pool has no login page and `TalentFlowAuthService.currentUser()` is always `null`.

| Pool | ID | Used for |
|---|---|---|
| **Naleko pool** | `af-south-1_2LdAGFnw2` | Login, API JWT auth, HM group membership |
| TF pool (legacy) | `af-south-1_C8TTlQxY7` | Exists but no active login — do not use for group/sub lookups |

The TF API Gateway authorizer (`ko4zam`) validates tokens against the **Naleko pool**.

### Naleko Pool (`af-south-1_2LdAGFnw2`) — TalentFlow users

| User | Email | Naleko Sub | Naleko Groups | Notes |
|---|---|---|---|---|
| Ignecious M | iggytanakamush@gmail.com | _(admin)_ | `naleko-talentflow-hr` | Primary test TA/admin |
| Tshepo Mashego | joworesources@gmail.com | `b10ca268-a071-70ca-78ce-9dbe8733466d` | `naleko-talentflow-hiringmanager`, `naleko-talentflow-hr`, `employee` | HM for interview flow |

### TalentFlow Cognito Pool (`af-south-1_C8TTlQxY7`) — legacy reference only

| User | Email | Old TF Sub | Notes |
|---|---|---|---|
| Tshepo Mashego | joworesources@gmail.com | `81cce2a8-6031-70d2-0245-a94444b38552` | **Superseded** — Naleko sub `b10ca268...` now used as `hiringManagerId` in DynamoDB |

### Groups with no users assigned ⚠️

| Group | Required for |
|---|---|
| `PanelMember` | Interview panel scoring |
| `ComplianceOfficer` | Compliance review stage |
| `FinanceLead` | Offer approval chain |
| `ITAdmin` / `ITSpecialist` | IT provisioning queue |

> **Action needed:** Assign real users to these groups in Cognito before testing those stages.

---

## Architecture Change — INTERVIEWING Stage (2026-06-01)

### What changed

The original 12-stage pipeline had three hardcoded interview stages:
`PHONE_SCREENING → TECHNICAL_INTERVIEW → PANEL_INTERVIEW`

These were replaced by a **single `INTERVIEWING` stage** with a configurable sub-loop driven by `PANEL_CONFIG.interviewRequirements`. This is architecturally correct — not all roles need a technical interview, and the number/type of rounds should be config-driven, not baked into code.

### New 10-stage pipeline

| # | Stage | Phase |
|---|---|---|
| 1 | `APPLICATION_REVIEW` | Phase 1 — Interview & Evaluation |
| 2 | `INTERVIEWING` | Phase 1 — Interview & Evaluation |
| 3 | `EVALUATION` | Phase 1 — Interview & Evaluation |
| 4 | `BACKGROUND_CHECK` | Phase 2 — Offer & Acceptance |
| 5 | `OFFER_PREPARATION` | Phase 2 — Offer & Acceptance |
| 6 | `OFFER_APPROVAL` | Phase 2 — Offer & Acceptance |
| 7 | `OFFER_DELIVERY` | Phase 2 — Offer & Acceptance |
| 8 | `CONTRACT_SIGNING` | Phase 2 — Offer & Acceptance |
| 9 | `PRE_BOARDING` | Phase 3 — Pre-Onboarding |
| 10 | `ONBOARDING` | Phase 4 — Onboarding & Day 1 |

### How the interview loop gate works

When `advanceCandidateStage` receives a request to move a candidate **out of** `INTERVIEWING`:

1. It reads the active `PANEL_CONFIG` (via `shared/config-reader` → `GSI1-active-configs` GSI)
2. It looks up `panelConfig.interviewRequirements[positionLevel]` — an array of `{ type, required }` objects
3. It queries all `INTERVIEW#` records for this candidate from `talent-flow-state`
4. It builds a set of interview types that have `status = COMPLETED`
5. If any **required** types are not in that set → returns `409 Conflict` with the list of pending types
6. If all required types are complete (or no requirements configured) → advance proceeds

### Interview Requirements config (PANEL_CONFIG v2)

Saved 2026-06-01 via Admin → TalentFlow Config → Panel Rules → Interview Requirements section:

| Interview Type | JUNIOR | MID | SENIOR |
|---|---|---|---|
| Phone Screen | Required | Required | Required |
| Technical | Optional | Required | Required |
| Behavioral | Required | Optional | Required |
| Culture Fit | Optional | Optional | Optional |
| Final | Required | Optional | Optional |

### Admin UI — how to configure

- **Interview Requirements** → `/platform/talentflow/admin/talentflow/panel-rules` → second section on the page
- **Stage Config (enable/disable stages)** → `/platform/talentflow/admin/talentflow/stage-config` → new page added to sidebar

---

## Config State (talent-flow-config table)

### Current active versions (TENANT#NALEKO)

| Config Type | Active Version | Notes |
|---|---|---|
| `SCORING_WEIGHTS` | v4 | Re-saved via admin UI |
| `SLA_THRESHOLDS` | v3 | Re-saved via admin UI |
| `STAGE_CONFIG` | v2 | 10-stage list saved 2026-06-01 |
| `PANEL_CONFIG` | v2 | interviewRequirements saved 2026-06-01 |
| `PANEL_RULES` | v1 | Votes required + veto rules |
| `APPROVAL_RULES` | v2 | Re-saved via admin UI |
| `IT_QUEUES` | v5 | Re-saved via admin UI |
| `PROVISIONING_TEMPLATES` | v3 | Re-saved via admin UI |
| `ROUTING_RULES` | v2 | Re-saved via admin UI |
| `EMAIL_TEMPLATES` | v1 | Re-saved via admin UI |

### How active config works

Active config items have:
```
PK       = TENANT#<tenantId>
SK       = CONFIG#<configType>#v<N>
GSI1PK   = TENANT#<tenantId>#ACTIVE
GSI1SK   = CONFIG#<configType>
isActive = true
```

The `shared/config-reader` queries `GSI1-active-configs` with both `GSI1PK` and `GSI1SK` to find the current active version. When a new version is saved, the old version has its `GSI1PK` and `GSI1SK` removed (REMOVE expression) so it drops out of the GSI.

**To confirm a config is active:** DynamoDB → `talent-flow-config` table → scan → look for your configType item with `GSI1PK` attribute present.

---

## TalentFlow UI — Naleko Design System Standards

> **Reusable reference for all TalentFlow page and component work.** Every screen — TA Dashboard, HM Dashboard, Candidate Workspace, Pipeline, Offers, Reports, Admin — must conform to these rules before merging. Use the compliance checklist at the bottom of this section when reviewing or building any TalentFlow UI.

---

### The Eight Non-Negotiable Rules

#### Rule 1 — White cards on a grey page
Page background is `--naleko-surface` (`#f8f9fa`). Every card surface — KPI card, zone container, candidate card, month card — must use:
```scss
background: var(--naleko-surface-container-lowest); // #ffffff
```
Never use coloured tinted backgrounds on card bodies (e.g. `color-mix(in srgb, var(--naleko-error) 10%, var(--naleko-surface))`).

#### Rule 2 — No-Line Rule
No `border: 1px solid var(--naleko-outline-variant)` on zone containers or card wrappers. Use `box-shadow: var(--naleko-shadow-card)` and the surface hierarchy (`surface` → `surface-container-lowest`) to create visual separation. A very subtle `border: 1px solid rgba(200, 197, 205, 0.18)` is acceptable on inner elements (candidate cards, month cards) only when needed for definition — not on zone wrappers.

#### Rule 3 — Naleko tokens only
All colour, shadow, radius, and font values must use `--naleko-*` CSS custom properties from `hr-portal/src/styles/naleko-tokens.css`. Never hardcode hex, RGB, or HSL. The only exception: `rgba()` alpha fallbacks when no `--naleko-*-rgb` token exists (e.g. `rgba(200, 197, 205, 0.18)`).

#### Rule 4 — Semantic colour lives in text / icons / borders — never in card backgrounds
When a card conveys urgency (breached, at-risk, success, warning), use:

| Element | How |
|---|---|
| Value text | `.tf-kpi__value { color: var(--naleko-error); }` |
| Top accent border | `border-top: 3px solid var(--naleko-error)` |
| Left accent border | `border-left: 3px solid var(--naleko-error)` |
| Icon box background | `background: color-mix(in srgb, var(--naleko-error) 14%, transparent)` |
| Badge / pill | `background: color-mix(in srgb, var(--naleko-error) 15%, transparent); color: var(--naleko-error)` |

Never express urgency as a card background tint.

#### Rule 5 — Use `<p-card>` for zone containers
Replace raw `<div class="tf-zone-X">` wrappers with `<p-card styleClass="tf-zone-X">`. Always add the `::ng-deep` padding reset shown below, or inner content double-pads.

```html
<!-- HTML -->
<p-card styleClass="tf-zone-X">
  <!-- inner content unchanged -->
</p-card>
```

```scss
// SCSS — outer zone class handles radius + padding; p-card handles white + shadow
.tf-zone-X {
  border-radius: var(--naleko-radius-xl);
  padding: 1.25rem 1.5rem;
}

::ng-deep {
  .tf-zone-X {
    &.p-card {
      background: var(--naleko-surface-container-lowest) !important;
      border: none !important;
      box-shadow: var(--naleko-shadow-card) !important;
    }
    .p-card-body    { padding: 0 !important; }
    .p-card-content { padding: 0 !important; }
  }
}
```

```ts
// TS — add CardModule to component imports array
import { CardModule } from 'primeng/card';
imports: [CommonModule, CardModule, ...],
```

#### Rule 6 — KPI / stat cards must have icon boxes
Every KPI or stat card must have an icon box matching the HR Portal `stat-card` pattern in `hr-portal/src/app/features/hr-dashboard/components/stat-card/`:

```html
<div class="tf-kpi-card tf-kpi-card--breached">
  <div class="tf-kpi-card__icon"><i class="pi pi-exclamation-triangle"></i></div>
  <p class="tf-kpi-card__eyebrow">SLA Breaches</p>
  <p class="tf-kpi-card__value">{{ count() }}</p>
  <p class="tf-kpi-card__sub">Candidates past SLA threshold</p>
</div>
```

```scss
.tf-kpi-card__icon {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.625rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.5rem;
  font-size: 1.2rem;
}
.tf-kpi-card--breached .tf-kpi-card__icon {
  background: color-mix(in srgb, var(--naleko-error) 14%, transparent);
  color: var(--naleko-error);
}
// --at-risk → --naleko-warning, --success → --naleko-success, --primary → --naleko-secondary
```

#### Rule 7 — Typography standards

| Element | Value |
|---|---|
| Page greeting / title | `font-size: 1.5rem; font-weight: 600; letter-spacing: -0.015em; font-family: var(--naleko-font-display)` |
| Section header (`.tf-section-head__title`) | `font-size: 1.125rem; font-weight: 700; font-family: var(--naleko-font-display)` |
| KPI value | `font-size: 2.25rem; font-weight: 800; font-family: var(--naleko-font-display)` |
| Eyebrow / label | `font-size: 0.68rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase` |

#### Rule 8 — TalentFlowAuthService.currentUser() is always null — use Naleko auth
All users (TAs, HMs, Admins) authenticate via the **Naleko pool** (`af-south-1_2LdAGFnw2`). `TalentFlowAuthService.currentUser()` is always `null`. For any user identity need (name, groups, `sub`) always use the Naleko `AuthService`:

```ts
import { AuthService } from '../../../../core/services/auth.service'; // adjust depth

private readonly nalekoAuth = inject(AuthService);

// Greeting name — always falls back to Naleko auth
protected readonly greetingName = computed(() =>
  this.tfAuth.currentUser()?.givenName ||
  this.nalekoAuth.currentUser()?.givenName ||
  'there',
);

// Time-of-day greeting
protected readonly timeOfDay = computed<string>(() => {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
});
```

For role checks (isTA, isHM) use the Naleko groups:
```ts
// TA = NOT in HM group
protected readonly isTA = computed(() =>
  !(this.nalekoAuth.currentUser()?.groups.includes('naleko-talentflow-hiringmanager') ?? false),
);
```

---

### Greeting / Page Header Pattern

Every TalentFlow page should open with a contextual greeting or page title. Copy this pattern:

```html
<div class="tf-page__greeting">
  <h1 class="tf-page__greeting-title">
    Good {{ timeOfDay() }}, {{ greetingName() }} — context phrase here.
  </h1>
</div>
```

```scss
.tf-page__greeting { padding: 0.75rem 0 0.5rem; }
.tf-page__greeting-title {
  font-family: var(--naleko-font-display);
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--naleko-on-surface);
  margin: 0;
  letter-spacing: -0.015em;
  line-height: 1.3;
}
```

---

### Design Compliance Checklist (paste into every PR that touches TalentFlow UI)

```
TalentFlow Design System Compliance:
- [ ] All zone containers use <p-card> (not raw <div>) — Rule 5
- [ ] All card surfaces: background: var(--naleko-surface-container-lowest) — Rule 1
- [ ] No border: 1px solid var(--naleko-outline-variant) on zone wrappers — Rule 2
- [ ] No coloured tinted backgrounds on cards — Rule 4
- [ ] Urgency colour via text/icon/accent-border only — Rule 4
- [ ] All CSS uses --naleko-* tokens — Rule 3
- [ ] Section headers: font-size: 1.125rem / font-weight: 700 — Rule 7
- [ ] KPI/stat cards have icon boxes (2.75rem, 0.625rem radius) — Rule 6
- [ ] User identity via nalekoAuth.currentUser() — not tfAuth — Rule 8
- [ ] Page has a greeting or contextual title — Rule 7
- [ ] ::ng-deep p-card padding reset added for every p-card zone — Rule 5
- [ ] No regression: all TalentFlow routes navigated, pipeline loads, SLA dots render
```

---

## Bugs Found & Fix Status

---

### BUG-001 — `orchestrateTalentFlowWorkflow` cannot Query config table

| Field | Detail |
|---|---|
| **Severity** | High |
| **Status** | ✅ Fixed & deployed — `infra/iam-patches.tf`, `terraform apply` 2026-06-01 |
| **Discovered** | 2026-06-01 via CloudWatch |
| **Affects** | Every new candidate |

**Symptom:** Every new candidate gets `configVersion = NULL` in the SAGA record. Scoring weights and stage config always fall back to hardcoded defaults regardless of admin configuration.

**Where to look:**
- CloudWatch → `/aws/lambda/orchestrateTalentFlowWorkflow` → filter: `SCORING_WEIGHTS`
- DynamoDB → `talent-flow-state` → `PK: CANDIDATE#<id> SK: SAGA` → check `configVersion`

**Error in CloudWatch:**
```
ERROR config-reader: getConfigItem DynamoDB error for NALEKO/SCORING_WEIGHTS:
User: arn:aws:sts::937137806477:assumed-role/talent-flow-role-orchestrateTalentFlowWorkflow/...
is not authorized to perform: dynamodb:Query on resource:
arn:aws:dynamodb:af-south-1:937137806477:table/talent-flow-config/index/GSI1-active-configs
```

**Root cause:** The inline policy on `talent-flow-role-orchestrateTalentFlowWorkflow` only granted `dynamodb:GetItem` on the table ARN. `config-reader` uses `QueryCommand` against the `GSI1-active-configs` GSI — `Query` on the index ARN was never granted.

**Fix:** `infra/iam-patches.tf` → `aws_iam_role_policy.orchestrate_config_query`
Adds `dynamodb:Query` + `dynamodb:GetItem` on the table and `/index/*` ARN.

---

### BUG-002 — `createCandidate` cannot mark idempotency key COMPLETED

| Field | Detail |
|---|---|
| **Severity** | Medium |
| **Status** | ✅ Fixed & deployed — `infra/iam-patches.tf`, `terraform apply` 2026-06-01 |
| **Discovered** | 2026-06-01 via CloudWatch |
| **Affects** | Every new candidate creation — retry safety broken |

**Symptom:** Candidate IS created successfully, but the idempotency record stays `IN_PROGRESS`. Retrying the same `idempotencyKey` returns `409 Conflict` instead of the already-created candidate.

**Where to look:**
- CloudWatch → `/aws/lambda/createCandidate` → filter: `Failed to mark idempotency`
- DynamoDB → `talent-flow-idempotency-keys` → look up the idempotencyKey from the request

**Error in CloudWatch:**
```
WARN Failed to mark idempotency COMPLETED {
  idempotencyKey: '37001220-...',
  candidateId: 'CAND-01KT11912...',
  error: 'User: ...createCandidate... is not authorized to perform:
  dynamodb:UpdateItem on resource: .../talent-flow-idempotency-keys'
}
```

**Root cause:** `createCandidate` writes the idempotency record as `IN_PROGRESS` via `PutItemCommand`, then after success calls `UpdateItemCommand` to mark it `COMPLETED`. The policy only granted `GetItem` + `PutItem` — `UpdateItem` was never added.

**Fix:** `infra/iam-patches.tf` → `aws_iam_role_policy.create_candidate_idempotency_update`
Adds `dynamodb:UpdateItem` on `talent-flow-idempotency-keys`.

---

### BUG-003 — Config items have no active version set (GSI1PK missing)

| Field | Detail |
|---|---|
| **Severity** | High |
| **Status** | ✅ Fixed — all configs re-saved via admin UI 2026-06-01 |
| **Discovered** | 2026-06-01 via DynamoDB scan |
| **Affects** | All config-dependent features |

**Symptom:** Even after BUG-001 IAM fix, orchestrate still falls back to defaults because no config item has `GSI1PK = TENANT#NALEKO#ACTIVE`.

**Where to look:**
- DynamoDB → `talent-flow-config` → scan → check `GSI1PK` attribute is present on active items
- CloudWatch → `/aws/lambda/orchestrateTalentFlowWorkflow` → `WARN: no active item found for configType=SCORING_WEIGHTS`

**Root cause:** Existing config items were written without the `GSI1PK` active-marker. Likely created before this pattern was implemented or via a direct DynamoDB write that bypassed the Lambda.

**Fix (correct layer):** After deploying BUG-001 fix, go to Admin → each config section and re-save via UI. `manageTalentFlowConfig` PUT sets the correct `GSI1PK`. Do not write directly to DynamoDB.

---

### BUG-004 — `configVersion: null` in SAGA blocks orchestrate permanently

| Field | Detail |
|---|---|
| **Severity** | Critical |
| **Status** | ✅ Fixed — `lambda/createCandidate/index.js` deployed 2026-06-01 |
| **Discovered** | 2026-06-01 during candidate testing |
| **Affects** | Any candidate whose SAGA record has `configVersion` as a DynamoDB NULL-type |

**Symptom:** `orchestrateTalentFlowWorkflow` fires once, sees the SAGA already has `configVersion` set (even though it's `null`), and logs "already locked — skipping (idempotent)". The candidate's `configVersion` is never assigned to a real version. The workflow appears to succeed (HTTP 200) but produces a broken SAGA.

**Where to look:**
- DynamoDB → `talent-flow-state` → `PK: CANDIDATE#<id> SK: SAGA` → look for `configVersion: {"NULL": true}` in raw DynamoDB view
- CloudWatch → `/aws/lambda/orchestrateTalentFlowWorkflow` → filter `skipping`

**Error / signal in CloudWatch:**
```
INFO already locked — skipping (idempotent) { candidateId: 'CAND-...' }
```
No error — it silently skips. The SAGA looks fine at a glance but `configVersion` is a NULL-type attribute.

**Root cause (subtle DynamoDB trap):**
```javascript
// createCandidate — BEFORE fix
const sagaRecord = {
  PK: `CANDIDATE#${candidateId}`,
  configVersion: null,   // ← marshals to {"NULL": true} in DynamoDB
  ...
};
marshall(sagaRecord, { removeUndefinedValues: true });
// null is NOT undefined — it is NOT removed. DynamoDB stores {"NULL": true}.
// attribute_exists(configVersion) returns TRUE for NULL-type attributes.
// orchestrate's ConditionExpression: 'attribute_not_exists(configVersion)' FAILS.
```

**Fix:** Changed `configVersion: null` → `configVersion: undefined` in `createCandidate`.
`removeUndefinedValues: true` in `marshall()` then omits the key entirely, so the attribute is truly absent from DynamoDB and `attribute_not_exists(configVersion)` passes correctly on first invocation.

**Manual remediation for existing stale SAGAs:**
```bash
# REMOVE the null-type configVersion attribute from the stale SAGA
aws dynamodb update-item \
  --table-name talent-flow-state \
  --key '{"PK":{"S":"CANDIDATE#<id>"},"SK":{"S":"SAGA"}}' \
  --update-expression 'REMOVE configVersion' \
  --region af-south-1

# Then manually invoke orchestrate to re-run
aws lambda invoke \
  --function-name orchestrateTalentFlowWorkflow \
  --payload '{"candidateId":"<id>","tenantId":"NALEKO"}' \
  --region af-south-1 /tmp/out.json
```

---

### BUG-005 — `advanceCandidateStage` missing `CONFIG_TABLE_NAME` env var — interview loop gate silently skipped

| Field | Detail |
|---|---|
| **Severity** | Critical |
| **Status** | ✅ Fixed — env var added via AWS CLI 2026-06-01 |
| **Discovered** | 2026-06-01 — JUNIOR candidate advanced through all 10 stages without any interviews |
| **Affects** | The entire INTERVIEWING stage gate — any candidate, any level |

**Symptom:** A candidate in `INTERVIEWING` can be advanced to `EVALUATION` (and beyond) without completing any required interviews. The gate is completely bypassed.

**Where to look:**
- CloudWatch → `/aws/lambda/advanceCandidateStage` → filter: `interviewLoopGate` or `CONFIG_TABLE_NAME`
- DynamoDB → `talent-flow-state` → `PK: CANDIDATE#<id>` → query all `SK` beginning with `INTERVIEW#` → should see zero records if no interviews scheduled

**Error in CloudWatch:**
```
ERROR config-reader: DynamoDB error for NALEKO/PANEL_CONFIG/ACTIVE:
1 validation error detected: Value null at 'tableName' failed to satisfy constraint: Member must not be null

WARN config-reader: no item found for configType=PANEL_CONFIG — returning defaults

WARN interviewLoopGate: no interviewRequirements for positionLevel — gate skipped { positionLevel: 'JUNIOR' }
```

**Root cause:** When the `advanceCandidateStage` Lambda was rewritten to add the interview loop gate (which reads `PANEL_CONFIG` via `shared/config-reader`), the `CONFIG_TABLE_NAME` environment variable was never added to the Lambda's configuration. The config-reader receives `undefined` as the table name, DynamoDB rejects the call with a validation error, the reader falls back to hardcoded defaults (which have no `interviewRequirements`), and the gate logs "gate skipped" and returns `null` — allowing the advance.

**Before fix:**
```json
{
  "STATE_TABLE_NAME": "talent-flow-state",
  "EVENTBRIDGE_BUS_NAME": "talent-flow-bus",
  "ENVIRONMENT": "prod",
  "AWS_ACCOUNT_ID": "937137806477"
}
```

**After fix:**
```json
{
  "STATE_TABLE_NAME": "talent-flow-state",
  "CONFIG_TABLE_NAME": "talent-flow-config",
  "EVENTBRIDGE_BUS_NAME": "talent-flow-bus",
  "ENVIRONMENT": "prod",
  "AWS_ACCOUNT_ID": "937137806477"
}
```

**Fix applied:**
```bash
aws lambda update-function-configuration \
  --function-name advanceCandidateStage \
  --region af-south-1 \
  --environment "Variables={STATE_TABLE_NAME=talent-flow-state,CONFIG_TABLE_NAME=talent-flow-config,EVENTBRIDGE_BUS_NAME=talent-flow-bus,ENVIRONMENT=prod,AWS_ACCOUNT_ID=937137806477}"
```

**Env var audit — check all Lambdas that use shared/config-reader:**
Any Lambda added to `NEEDS_SHARED` in `scripts/deploy-talentflow-lambdas.sh` requires both `STATE_TABLE_NAME` and `CONFIG_TABLE_NAME`. Run this audit after adding a new Lambda to the shared list:

```bash
for fn in orchestrateTalentFlowWorkflow advanceCandidateStage scheduleInterview submitVote completeEvaluation sendTalentFlowNotification monitorTalentFlowSLAs createProvisioningBundle getItTasks createItTask; do
  echo "=== $fn ==="
  aws lambda get-function-configuration \
    --function-name "$fn" --region af-south-1 \
    --query 'Environment.Variables.CONFIG_TABLE_NAME' --output text
done
```

Expected output for each: `talent-flow-config`. Any `None` means the env var is missing.

---

---

### BUG-006 — Five workflow Lambdas missing `dynamodb:Query` on `talent-flow-config` index

| Field | Detail |
|---|---|
| **Severity** | Critical |
| **Status** | ✅ Fixed — IAM policies added via AWS CLI + `infra/iam-patches.tf` updated 2026-06-01 |
| **Discovered** | 2026-06-01 — gate still bypassed after BUG-005 fix |
| **Affects** | Interview loop gate, vote counting, offer notification, and any other config-dependent logic in these Lambdas |

**Symptom:** After fixing BUG-005 (`CONFIG_TABLE_NAME` env var), the gate still skips. Same end result — candidate advances through INTERVIEWING with no interviews.

**Where to look:**
- CloudWatch → `/aws/lambda/advanceCandidateStage` → filter: `not authorized to perform: dynamodb:Query`

**Error in CloudWatch:**
```
ERROR config-reader: DynamoDB error for NALEKO/PANEL_CONFIG/ACTIVE:
User: arn:aws:sts::937137806477:assumed-role/talent-flow-role-advanceCandidateStage/...
is not authorized to perform: dynamodb:Query on resource:
arn:aws:dynamodb:af-south-1:937137806477:table/talent-flow-config/index/GSI1-active-configs
because no identity-based policy allows the dynamodb:Query action
```

**Root cause:** When each Lambda was originally provisioned, its IAM role policy was scoped to the `talent-flow-state` table only. Reading config was not a requirement at the time. When `shared/config-reader` was added to these Lambdas as part of the INTERVIEWING stage architecture, no one added the corresponding IAM permissions.

**Lambdas confirmed broken (via `iam simulate-principal-policy`, 2026-06-01):**

| Lambda | Impact of missing permission |
|---|---|
| `advanceCandidateStage` | Interview loop gate silently skipped |
| `scheduleInterview` | PANEL_CONFIG unreadable — panel rules not enforced |
| `submitVote` | PANEL_CONFIG unreadable — votesRequired falls to defaults |
| `completeEvaluation` | PANEL_CONFIG unreadable — scoring rules fall to defaults |
| `sendTalentFlowNotification` | EMAIL_TEMPLATES / STAGE_CONFIG unreadable |

**Lambdas already allowed (broader policies in place):** `orchestrateTalentFlowWorkflow` (PATCH 1), `monitorTalentFlowSLAs`, `createProvisioningBundle`.

**Fix:** Added inline policy `config-table-query` to all 5 roles granting `dynamodb:Query` + `dynamodb:GetItem` on `talent-flow-config` table and `/index/*`. Tracked in `infra/iam-patches.tf` as PATCH 3 (`aws_iam_role_policy.config_table_query` with `for_each`).

**Lesson:** Any Lambda added to `NEEDS_SHARED` in `deploy-talentflow-lambdas.sh` that calls `getConfig()` needs `dynamodb:Query` on both the table ARN and `table/talent-flow-config/index/*`. Add this as part of the Lambda creation checklist.

---

---

### BUG-007 — `advanceCandidateStage` missing `dynamodb:Query` on `talent-flow-state` — gate returns 500

| Field | Detail |
|---|---|
| **Severity** | Critical |
| **Status** | ✅ Fixed — IAM policy added + Lambda redeployed 2026-06-01 |
| **Discovered** | 2026-06-01 — gate appeared to work (blocked advance) but with wrong error |
| **Affects** | Interview loop gate — the 409 was never reached, a 500 was returned instead |

**Symptom:** Clicking "Advance to Evaluation" shows "Failed to verify interview completion" in the red error banner. The gate IS blocking the advance (good) but for the wrong reason — it's a 500 from a failed DynamoDB query, not a proper 409 with the list of pending interviews.

**Where to look:**
- CloudWatch → `/aws/lambda/advanceCandidateStage` → filter: `failed to query INTERVIEW records`

**Error in CloudWatch:**
```
ERROR interviewLoopGate: failed to query INTERVIEW records {
  candidateId: 'CAND-...',
  error: 'User: ...talent-flow-role-advanceCandidateStage... is not authorized
  to perform: dynamodb:Query on resource: .../talent-flow-state'
}
```

**Root cause:** The original policy for `talent-flow-role-advanceCandidateStage` only had `GetItem` + `UpdateItem` on `talent-flow-state`. The interview loop gate added a `QueryCommand` to scan all `INTERVIEW#` records for the candidate — `Query` on the table was never in the policy.

**Fix:** Added inline policy `state-table-query` granting `dynamodb:Query` on `talent-flow-state` and `/index/*`. Tracked as PATCH 4 in `infra/iam-patches.tf`. Lambda redeployed with improved gate message (type names now formatted as "Phone Screen" not "PHONE_SCREEN").

---

### BUG-008 — `scheduleInterview` missing `dynamodb:PutItem` on `talent-flow-state` — cannot create interview record

| Field | Detail |
|---|---|
| **Severity** | Critical |
| **Status** | ✅ Fixed — IAM policy added 2026-06-01 |
| **Discovered** | 2026-06-01 — "Failed to write interview record" in Schedule Interview form |
| **Affects** | Every interview creation — the entire interview loop is unusable without this |

**Symptom:** Schedule Interview form fills in correctly and submits, but returns "Failed to write interview record". No `INTERVIEW#` record appears in DynamoDB.

**Where to look:**
- CloudWatch → `/aws/lambda/scheduleInterview` → filter: `Failed to write interview record`

**Error in CloudWatch:**
```
ERROR Failed to write interview record {
  interviewId: '...',
  error: 'User: ...talent-flow-role-scheduleInterview... is not authorized
  to perform: dynamodb:PutItem on resource: .../talent-flow-state'
}
```

**Root cause:** The original policy for `talent-flow-role-scheduleInterview` only had `GetItem` + `UpdateItem` on `talent-flow-state`. Creating a new `INTERVIEW#<id>` record requires `PutItem` — never provisioned.

**Fix:** Added inline policy `state-table-write` granting `dynamodb:PutItem` + `dynamodb:Query` on `talent-flow-state` and `/index/*`. Tracked as PATCH 5 in `infra/iam-patches.tf`.

---

---

### BUG-009 — `createCandidate` optional fields not persisted to DynamoDB

| Field | Detail |
|---|---|
| **Severity** | Medium |
| **Status** | ✅ Fixed — Lambda redeployed + API service updated 2026-06-01 |
| **Discovered** | 2026-06-01 — department, location, experience all showing `—` on workspace after creating candidate with those fields filled in |
| **Affects** | Every candidate created — optional field data silently lost |

**Symptom:** Create Candidate form accepts department, location, experience years, phone, source. After creation the candidate workspace shows `—` for all those fields. DynamoDB SAGA record confirms they are absent.

**Two-layer bug:**

1. **Lambda** — `createCandidate/index.js` extracted the optional fields from `body` but never included them in the `sagaRecord` object passed to `PutItemCommand`.
2. **API service** — `talent-flow-api.service.ts` `createCandidate()` was building the request body with only the required fields — `department` and `location` were never forwarded to the Lambda even if the frontend had them.

**Fix:**
- `createCandidate/index.js` — added `phone`, `department`, `location`, `experienceYears`, `source`, `appliedDate` to `sagaRecord`; uses `removeUndefinedValues: true` on marshall so absent optional fields are cleanly omitted
- `talent-flow-api.service.ts` — added `department` and `location` to the HTTP request body in `createCandidate()`

**Note:** Candidates created before this fix will have empty optional fields permanently (the SAGA record was written without them). Create a new candidate to verify.

---

### BUG-010 — PANEL_CONFIG race condition — interview type dropdown not guided on Interviews tab open

| Field | Detail |
|---|---|
| **Severity** | Medium |
| **Status** | ✅ Fixed — PANEL_CONFIG now loaded on page init 2026-06-01 |
| **Discovered** | 2026-06-01 — schedule form showed all interview types as a free dropdown instead of locking to the next required type |
| **Affects** | Any user navigating directly to the Interviews tab |

**Symptom:** Opening the Interviews tab and clicking "Schedule New Interview" shows a free dropdown with all interview types (PHONE_SCREEN, TECHNICAL, BEHAVIORAL, etc.) instead of being locked to the next required type in PANEL_CONFIG order.

**Root cause:** `_loadPanelConfig()` was only called inside `setTab('interviews')` — after the tab rendered. The `nextScheduleableType` computed signal read `requiredTypes()` which was still an empty array because the async config call hadn't resolved yet. The form opened before the signal populated.

**Fix:** Call `_loadPanelConfig(candidate.positionLevel)` in `ngOnInit()` immediately after the candidate resolves (both the pipeline-cache path and the API-fetch path). By the time the user clicks the Interviews tab, the config is already loaded.

---

### BUG-011 — No backend guard: could schedule duplicate interview types or concurrent interviews

| Field | Detail |
|---|---|
| **Severity** | High |
| **Status** | ✅ Fixed — backend guards added to `scheduleInterview` Lambda 2026-06-01 |
| **Discovered** | 2026-06-01 — was able to schedule Phone Screen twice; could schedule while another was SCHEDULED |
| **Affects** | Any candidate in INTERVIEWING stage — data integrity of the interview loop |

**Symptom:** Two issues in one:
1. Could schedule a new interview while another interview was still in `SCHEDULED` state (sequential rule violated)
2. Could schedule the same interview type (e.g. Phone Screen) again after it was already `COMPLETED`

**Root cause:** The `scheduleInterview` POST handler had no pre-write checks on existing `INTERVIEW#` records. It just wrote the new record unconditionally.

**Fix:** Added a guard block after the stage check in the POST handler that:
1. Queries all existing `INTERVIEW#` records for the candidate
2. Returns `409` if any interview is currently `SCHEDULED` — "Cannot schedule a new interview while Phone Screen is still in SCHEDULED state. Mark it as COMPLETED first."
3. Returns `409` if the requested `interviewType` already has a `COMPLETED` record — "A Phone Screen interview has already been COMPLETED for this candidate. Each interview type can only be completed once."

---

### BUG-012 — Vote button reappears after submission

| Field | Detail |
|---|---|
| **Severity** | Low |
| **Status** | ✅ Fixed — session vote tracking added 2026-06-01 |
| **Discovered** | 2026-06-01 — after submitting a vote the "Submit Vote / Score" button was still visible |
| **Affects** | Vote UX — no data impact, button was effectively inert after vote submitted |

**Symptom:** After submitting a vote for an interview, the "Submit Vote / Score" button was still visible. Clicking it again would open the form and allow a second vote submission.

**Root cause:** No client-side tracking of which interviews had been voted on. The `voteSuccess` signal was set on submission but immediately cleared; `voteTargetId` was nulled; but nothing prevented the button from re-rendering.

**Fix:** Added `votedInterviewIds = signal<ReadonlySet<string>>(new Set())` to the workspace component. On vote success, the interview ID is added to the set via `votedInterviewIds.update(prev => new Set([...prev, interviewId]))`. The template checks `votedInterviewIds().has(iv.interviewId)` — if true, renders a green **✓ Voted** badge instead of the vote button.

**Note:** This is session-scoped — refreshing the page will show the button again. Server-side "already voted" state (checking existing VOTE# records on load) is not yet implemented.

---

### BUG-013 — `votesSubmitted` incremented on SAGA record instead of INTERVIEW# record

| Field | Detail |
|---|---|
| **Severity** | High |
| **Status** | ✅ Fixed — `submitVote` Lambda updated 2026-06-01 |
| **Discovered** | 2026-06-01 — vote counter on SAGA grew across interviews; per-interview quorum check was unreliable |
| **Affects** | Voting quorum logic — `VotingCompleted` event could fire at wrong time |

**Symptom:** The `votesSubmitted` counter on the SAGA record accumulated across ALL interviews for the candidate. A second interview's vote could push SAGA `votesSubmitted` past `votesRequired` and prematurely publish `VotingCompleted`.

**Root cause:** `submitVote` Lambda step 8 was calling `UpdateItem` on `PK=CANDIDATE#<id>, SK=SAGA` (`ADD votesSubmitted :1`). Each interview has its own `votesRequired` value and the quorum should be checked per-interview, not globally.

**Fix:**
- `submitVote` now extracts `interviewId` from the request body
- Stores `interviewId` on the `VOTE#` record for traceability
- Increments `votesSubmitted` on `INTERVIEW#${interviewId}` (not SAGA) and reads back both `votesSubmitted` and `votesRequired` from the same `ALL_NEW` response
- Quorum check now compares per-interview counts
- Fallback to SAGA increment preserved for calls without `interviewId` (backward compat, logs a WARN)

---

### BUG-014 — Activity log sidebar never shows interview events

| Field | Detail |
|---|---|
| **Severity** | Medium |
| **Status** | ✅ Fixed — EventBridge publish added to `scheduleInterview` Lambda 2026-06-01 |
| **Discovered** | 2026-06-01 — scheduling and completing interviews had no effect on the activity log sidebar |
| **Affects** | Activity log for the entire interview loop — all interview events invisible |

**Symptom:** After scheduling an interview or marking one complete, the activity log sidebar on the candidate workspace shows no interview-related events. Events like "Interview Scheduled" and "Interview Completed" never appear.

**Root cause — how the activity log works:**
- Activity log reads from `talent-flow-events` table
- `talent-flow-events` is populated by the `talentFlowAuditStream` Lambda
- `talentFlowAuditStream` is triggered by EventBridge rules on `talent-flow-bus`
- `scheduleInterview` Lambda **already had** `EventBridgeClient` imported and `EVENTBRIDGE_BUS_NAME` env var set, and even had the `publishEvent()` helper function declared — but `publishEvent()` was never actually called anywhere in the handler

**Fix:** Added two `publishEvent()` calls:
1. After `PutItem` succeeds for a new `INTERVIEW#` record (POST handler): `publishEvent('InterviewScheduled', { candidateId, interviewId, tenantId, interviewType, scheduledAt, positionLevel, panelMemberIds })`
2. After `UpdateItem` succeeds in `handleCompleteInterview`: `publishEvent('InterviewCompleted', { candidateId, interviewId, outcome })`

Both calls are non-fatal — interview record is already written before the EB call, so a publish failure only affects the activity log.

---

### BUG-015 — Manual Lambda zip skipped `require` path patch — `ImportModuleError` on cold start

| Field | Detail |
|---|---|
| **Severity** | Critical (deployment blocker) |
| **Status** | ✅ Fixed — always use `deploy-talentflow-lambdas.sh` 2026-06-01 |
| **Discovered** | 2026-06-01 — immediately after first manual zip deploy, all Lambda calls returned 500 |
| **Affects** | Any Lambda in `NEEDS_SHARED` in the deploy script if deployed manually |

**Symptom:** After manually zipping and deploying `scheduleInterview`, every request returned 500. The GET interviews endpoint (new feature) and the existing POST/PATCH also broke.

**CloudWatch error:**
```
ImportModuleError: Error: Cannot find module '../shared/config-reader'
Require stack:
- /var/task/index.js
- /var/runtime/index.mjs
```

**Root cause:** The source code uses `require('../shared/config-reader')` because in the local repo structure, `index.js` is at `lambda/scheduleInterview/index.js` and `config-reader.js` is at `lambda/shared/config-reader.js`. In the Lambda zip, both are at the same directory level (`/var/task/`), so the path should be `require('./shared/config-reader')`.

The official deploy script `scripts/deploy-talentflow-lambdas.sh` handles this automatically:
```bash
sed -i '' \
  "s|require('../shared/config-reader')|require('./shared/config-reader')|g" \
  "$BUILD/$ENTRY_FILE"
```

A manual zip does not apply this patch. The Lambda loads, cannot resolve `../shared/config-reader`, and throws `ImportModuleError` before any handler logic runs.

**Rule:** **Never manually zip and deploy Lambdas in `NEEDS_SHARED`.** Always use:
```bash
bash scripts/deploy-talentflow-lambdas.sh scheduleInterview submitVote
# or for all:
bash scripts/deploy-talentflow-lambdas.sh
```

---

### BUG-016 — HM Dashboard: `NG0203 toObservable()` called outside injection context

| Field | Detail |
|---|---|
| **Severity** | High (runtime crash) |
| **Status** | ✅ Fixed — `hm-dashboard-page.component.ts` 2026-06-01 |
| **Discovered** | 2026-06-01 — HM Dashboard would not load; Angular error thrown on navigation |
| **Affects** | Any navigation to `/platform/talentflow/hm-dashboard` |

**Symptom:** Navigating to the HM Dashboard throws a runtime Angular error. Component never renders.

**Browser console error:**
```
NG0203: toObservable() can only be used within an injection context
```

**Root cause:** `toObservable()` was called inside `ngOnInit()`, which is not an Angular injection context. It must be called in the constructor (where `inject()` is valid) or at field-initialisation time.

**Fix:** Moved the `toObservable()` call from `ngOnInit` to the constructor. Subsequently refactored to remove `toObservable` entirely — `loadCandidates()` is now called directly in the constructor after the Naleko session is confirmed available.

---

### BUG-017 — HM Dashboard loads all candidates instead of HM-filtered ones (pool consolidation)

| Field | Detail |
|---|---|
| **Severity** | Critical (data leak) |
| **Status** | ✅ Fixed — `auth.service.ts`, `hm-dashboard-page.component.ts` 2026-06-01 |
| **Discovered** | 2026-06-01 — Tshepo saw every candidate in the system, not just his own |
| **Affects** | HM Dashboard — My Candidates, My Tasks, Decisions tabs |

**Symptom:** After logging in as an HM, all candidates in the tenant are displayed instead of only those assigned to that HM.

**Root cause (multi-layer):**
1. `TalentFlowAuthService.currentUser()` is always `null` — there is no TF-specific login page; everyone authenticates via the Naleko pool, but `TalentFlowAuthService` pointed to the TF pool (`af-south-1_C8TTlQxY7`) which had no active session.
2. `hmId` was derived from `tfAuth.currentUser()?.email ?? ''` — always `''`.
3. `getCandidates` Lambda: when `hiringManagerId` is an empty string it skips the DynamoDB filter expression entirely and returns **all** candidates for the tenant.
4. `APP_INITIALIZER` only calls `nalekoAuth.checkSession()` — `tfAuth.checkSession()` was never called, so even if the TF pool had a user it would never be restored.

**Fix:**
- Added `sub: string` field to `AuthUser` interface in `auth.service.ts`, extracted from `payload['sub']`.
- `loadCandidates()` now reads `nalekoAuth.currentUser()?.sub` (Naleko pool sub = the value stored as `hiringManagerId` in DynamoDB after pool consolidation).
- Hard guard added: if `hmId` is empty, shows error message and does NOT call the API.
- Removed `tfAuth.checkSession()` wrapper — `loadCandidates()` called directly in constructor (Naleko session is already restored by `APP_INITIALIZER`).

---

### BUG-018 — DynamoDB `hiringManagerId` values are email strings or old TF pool sub

| Field | Detail |
|---|---|
| **Severity** | Critical (data) |
| **Status** | ✅ Fixed — 8 DynamoDB SAGA records backfilled 2026-06-01 |
| **Discovered** | 2026-06-01 — even after BUG-017 fix, `getCandidates` returned 0 results for Tshepo |
| **Affects** | All SAGA records created before pool consolidation |

**Symptom:** After fixing BUG-017, the API is called with the correct Naleko sub (`b10ca268...`) but still returns 0 candidates for Tshepo.

**Root cause:** Existing SAGA records had `hiringManagerId` set to either:
- `joworesources@gmail.com` (email string — from early TA test data entry)
- `81cce2a8-6031-70d2-0245-a94444b38552` (old TF pool sub — from when `createCandidate` was using the TF pool token)

Neither value matches Tshepo's Naleko pool sub `b10ca268-a071-70ca-78ce-9dbe8733466d`.

**Fix:** Backfilled all 8 Tshepo SAGA records via AWS CLI:
```bash
# Scan for stale values
aws dynamodb scan --table-name talent-flow-state \
  --filter-expression "hiringManagerId IN (:email, :oldSub)" \
  --expression-attribute-values '{
    ":email":{"S":"joworesources@gmail.com"},
    ":oldSub":{"S":"81cce2a8-6031-70d2-0245-a94444b38552"}
  }' \
  --projection-expression "PK,SK" --region af-south-1

# For each CANDIDATE#<id> / SAGA record found:
aws dynamodb update-item --table-name talent-flow-state \
  --key '{"PK":{"S":"CANDIDATE#<id>"},"SK":{"S":"SAGA"}}' \
  --update-expression "SET hiringManagerId = :newSub" \
  --expression-attribute-values '{ ":newSub":{"S":"b10ca268-a071-70ca-78ce-9dbe8733466d"} }' \
  --region af-south-1
```

**Going forward:** `createCandidate` receives `hiringManagerId` from the TA's HM dropdown, which now comes from `getHiringManagers` — which returns Naleko pool subs (see BUG-019).

---

### BUG-019 — `getHiringManagers` Lambda using TF Cognito pool — returns wrong sub for HMs

| Field | Detail |
|---|---|
| **Severity** | High |
| **Status** | ✅ Fixed — Lambda updated + deployed, Terraform applied 2026-06-01 |
| **Discovered** | 2026-06-01 — HM dropdown showed correct names but `createCandidate` saved TF-pool sub as `hiringManagerId` |
| **Affects** | All new candidates created via Create Candidate form |

**Symptom:** TA creates a candidate and assigns Tshepo as HM. Candidate is saved with `hiringManagerId = 81cce2a8...` (old TF pool sub). Tshepo's HM Dashboard never finds the candidate.

**Root cause:** `getHiringManagers/index.js` called `ListUsersInGroupCommand` against the TF pool (`af-south-1_C8TTlQxY7`) with group name `HiringManager`. The sub it returned was the user's TF-pool sub — completely different from their Naleko-pool sub.

**Fix:**
- `lambda/getHiringManagers/index.js` — changed to use Naleko pool (`af-south-1_2LdAGFnw2`) and group `naleko-talentflow-hiringmanager`
- `infra/talentflow-hiring-managers.tf` — IAM resource ARN updated to Naleko pool; env vars renamed: `TF_COGNITO_POOL_ID` → `HM_COGNITO_POOL_ID`; added `HM_GROUP_NAME = "naleko-talentflow-hiringmanager"`
- `terraform apply` — 2 resources changed (IAM policy + Lambda env vars)
- Lambda redeployed via `npm install && zip` + `aws lambda update-function-code`

**Verification:**
```bash
aws lambda invoke --function-name getHiringManagers \
  --payload '{"queryStringParameters":{"tenantId":"NALEKO"}}' \
  --region af-south-1 /tmp/out.json && cat /tmp/out.json
# Expected: [{ sub: 'b10ca268-...', name: 'Tshepo Mashego' }]
```

---

### BUG-020 — HM nav links "My Candidates" / "Decisions" navigate to wrong route

| Field | Detail |
|---|---|
| **Severity** | Medium (UX) |
| **Status** | ✅ Fixed — `talent-flow-shell.component.html` 2026-06-01 |
| **Discovered** | 2026-06-01 — clicking "My Candidates" in HM topbar navigated to `/candidates` (TA pipeline view) |
| **Affects** | HM topbar navigation — My Candidates and Decisions links |

**Symptom:** Clicking "My Candidates" in the HM topbar navigated to the TA candidate pipeline page (`/platform/talentflow/candidates`) instead of the HM dashboard candidates tab.

**Root cause:** Nav links used `routerLink="/platform/talentflow/candidates"` — the TA pipeline route. No tab-switching mechanism existed for the HM dashboard.

**Fix:**
- Links changed to `routerLink="/platform/talentflow/hm-dashboard"` with `[queryParams]="{ tab: 'candidates' }"` (and `decisions` respectively).
- `hm-dashboard-page.component.ts` constructor reads `route.snapshot.queryParamMap.get('tab')` and calls `activeTab.set(tabParam)` on init.

---

### BUG-021 — `isTA()` always returns `true` — HMs see all TA-only actions (Edit / Reject / Advance / Schedule)

| Field | Detail |
|---|---|
| **Severity** | Critical (access control) |
| **Status** | ✅ Fixed — `candidate-workspace-page.component.ts` 2026-06-01 |
| **Discovered** | 2026-06-01 — logged in as Tshepo (HM), opened candidate workspace — Edit Details, Reject Candidate, Schedule Interview, and Advance Stage all visible |
| **Affects** | Every user — all HMs have full TA UI access |

**Symptom:** An HM opening a candidate workspace sees Edit Details, Reject Candidate, Schedule Interview, and Advance Stage — all actions that should be TA-only.

**Root cause:**
```typescript
// BEFORE — broken
protected readonly isTA = computed(
  () => this.tfAuth.isAdmin() || !this.tfAuth.isHiringManager(),
);
// tfAuth.currentUser() is always null (pool consolidation — no TF login page)
// → isAdmin() = false, isHiringManager() = false
// → isTA = false || !false = TRUE for every user
```

**Fix:**
```typescript
// AFTER — correct
private readonly nalekoAuth = inject(AuthService); // Naleko pool

protected readonly isTA = computed(() => {
  const user = this.nalekoAuth.currentUser();
  if (!user) return false;
  return !user.groups.includes('naleko-talentflow-hiringmanager');
});
```
Tshepo has `naleko-talentflow-hiringmanager` in his Naleko JWT → `isTA() = false` → all TA buttons hidden.
TA users (not in that group) → `isTA() = true` → all buttons visible.

**Note:** `AuthService` (Naleko pool) is already initialized by `APP_INITIALIZER` before any routing — `currentUser()` is reliably populated when the workspace renders.

---

---

### BUG-022 — `getPanelMembers` returned email as `id` — `panelMemberIds` stored emails instead of Cognito subs

| Field | Detail |
|---|---|
| **Severity** | High (data corruption) |
| **Status** | ✅ Fixed — `lambda/getPanelMembers/index.js` redeployed 2026-06-02 |
| **Discovered** | 2026-06-02 — vote display showed "Unknown" for all panel members; panel member lookup always fell through |
| **Affects** | All INTERVIEW# records where panel members were added before this fix |

**Symptom:** Panel member names show as "Unknown" in the vote summary. Duplicate vote prevention misses because the stored `panelMemberIds` values (emails) don't match the voter's `sub` used in `VOTE#` records.

**Root cause:** `getPanelMembers/index.js` — `mapCognitoUser()` extracted the user's `sub` attribute but then returned `id: email` instead of `id: sub`. Any `PATCH /v1/candidates/{id}/interviews` call to add a panel member stored the user's email as the ID in the `panelMemberIds` array on the `INTERVIEW#` record.

```js
// BEFORE — broken
function mapCognitoUser(cognitoUser) {
  const attrs = Object.fromEntries((cognitoUser.Attributes ?? []).map(x => [x.Name, x.Value]));
  return {
    id: attrs['email'],   // ← wrong — email stored as the identity key
    email: attrs['email'],
    ...
  };
}

// AFTER — correct
function mapCognitoUser(cognitoUser) {
  const attrs = Object.fromEntries((cognitoUser.Attributes ?? []).map(x => [x.Name, x.Value]));
  const sub = attrs['sub'] || cognitoUser.Username;
  return {
    id: sub,              // ← sub is now the canonical identity key
    email: attrs['email'],
    ...
  };
}
```

**Backward compatibility:** `panelMemberNameById()` in the frontend resolves by `m.id === id || m.email === id` — both old email-based IDs and new sub-based IDs resolve correctly. No DynamoDB backfill needed (old records still display, they just don't match vote lookups — create a fresh candidate to test the fixed flow end-to-end).

**Deployed via:**
```bash
bash scripts/deploy-talentflow-lambdas.sh getPanelMembers
```

---

### BUG-023 — TA could vote as themselves — should only capture votes on behalf of panel members

| Field | Detail |
|---|---|
| **Severity** | High (access control / data integrity) |
|  **Status** | ✅ Fixed — `candidate-workspace-page.component.ts/.html` 2026-06-02 |
| **Discovered** | 2026-06-02 — TA logged in, opened candidate workspace, saw standard vote/score form identical to HM's — could submit vote under their own identity |
| **Affects** | All TA users — any interview in any candidate workspace |

**Symptom:** A TA opening an interview card sees the same "Submit Vote / Score" button and form as an HM. Submitting it records a `VOTE#` with `voterId = TA's sub` — a vote from someone who is not on the interview panel.

**Root cause:** The vote form had no role-gating. `isTA()` was used to hide the Advance Stage button but was not applied to the vote form. The `submitVote` API call used `authService.currentUser()?.email` as `voterId` regardless of who was calling.

**Fix — two-layer:**

1. **UI (Angular workspace component):** TAs see a "Capture Panel Vote" entry-point that renders a **proxy selector** — a row of buttons, one per unvoted panel member. Selecting a panel member then shows a context banner ("Capturing vote on behalf of [Name]") followed by the score/decision form. The form is disabled until a proxy target is chosen.
   - `taProxyMemberId = signal<string | null>(null)` tracks the selected target
   - `unvotedPanelMembers(iv)` filters to members who have no `VOTE#` record yet (prevents capturing a duplicate)
   - HMs see the standard "Submit Vote" button with no proxy selector

2. **API service:** `submitVote(candidateId, payload, voterIdOverride?)` — when `voterIdOverride` is set, the `voterId` field in the request body is `voterIdOverride` (the panel member's sub), and `submittedByTA` is set to the TA's own sub for audit. When not set (HM direct vote), `voterId = currentUser.sub ?? currentUser.email`.

3. **Lambda (`submitVote`):** Persists `submittedByTA` to the `VOTE#` record. If `submittedByTA` is present, the vote display shows a "via TA" indicator.

**Test:** Log in as TA → open candidate workspace → find an interview card with at least one panel member → confirm only "Capture Panel Vote" is shown (not a self-vote button) → select a panel member → fill in score → submit → verify `VOTE#` record in DynamoDB has `voterId = panelMember.sub` and `submittedByTA = TA.sub`.

---

### BUG-024 — Interview cards showed no vote data — `GET /v1/candidates/{id}/interviews` did not return VOTE# records

| Field | Detail |
|---|---|
| **Severity** | High (visibility) |
| **Status** | ✅ Fixed — `lambda/scheduleInterview/index.js` redeployed 2026-06-02 |
| **Discovered** | 2026-06-02 — interview cards rendered with panel member names but no vote rows, no tally, no "✓ Voted" indication based on server state |
| **Affects** | All users — vote results invisible to both TAs and HMs |

**Symptom:** After an HM (or TA via proxy) submits a vote, reopening the candidate workspace shows the panel vote summary with every member still marked "Pending". `VOTE#` records exist in DynamoDB but are never returned by the GET endpoint.

**Root cause:** The `scheduleInterview` Lambda's GET handler returned raw `INTERVIEW#` records but never queried `VOTE#` records. The `votes` field on each interview was always `undefined` on the client.

**Fix:** Extended the GET handler to:
1. Query all `VOTE#` records for the candidate in a single `QueryCommand` (`begins_with(SK, 'VOTE#')`)
2. Map each vote to `{ voterId, rating, weightedScore, interviewId, submittedAt, submittedByTA, scores }`
3. Attach the filtered subset (`votes.filter(v => v.interviewId === iv.interviewId)`) to each interview object before returning

**Frontend model updated:** Added `InterviewVoteRecord` interface to `talent-flow.models.ts`; `Interview` extended with `votes?: InterviewVoteRecord[]`. `voteForMember(iv, memberId)` helper looks up the vote record for each panel member row.

**Deployed via:**
```bash
bash scripts/deploy-talentflow-lambdas.sh scheduleInterview
```

---

### BUG-025 — No backend duplicate vote guard — same voter could submit multiple votes per interview

| Field | Detail |
|---|---|
| **Severity** | High (data integrity) |
| **Status** | ✅ Fixed — `lambda/submitVote/index.js` redeployed 2026-06-02 |
| **Discovered** | 2026-06-02 — page refresh cleared session vote tracking (BUG-012 was session-only) — TA could re-open vote form and submit again for the same interview |
| **Affects** | All voters — any interview — quorum logic broken if multiple votes per voter accepted |

**Symptom:** Refreshing the candidate workspace page (clearing the Angular `votedInterviewIds` session signal) allowed re-submitting a vote for an interview that already had one from the same voter. Multiple `VOTE#` records with the same `voterId` and `interviewId` accumulated in DynamoDB, inflating `votesSubmitted` past `votesRequired` and producing incorrect evaluation results.

**Root cause:** `submitVote` Lambda wrote the `VOTE#` record unconditionally. The SK pattern `VOTE#${voterId}#${timestamp}` is unique per submission, so DynamoDB's `ConditionExpression` on the key could not detect duplicates.

**Fix:** Added a pre-write duplicate check in `submitVote`:
```js
// Query for existing votes by this voter for this interview
const existingVotes = await dynamo.send(new QueryCommand({
  TableName: STATE_TABLE,
  KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
  FilterExpression: 'interviewId = :iid',
  ExpressionAttributeValues: marshall({
    ':pk': `CANDIDATE#${candidateId}`,
    ':prefix': `VOTE#${voterId}#`,
    ':iid': interviewId,
  }),
  Limit: 1,
}));
if (existingVotes.Count > 0) {
  return respond(409, { error: 'You have already submitted a vote for this interview.' });
}
```

**409 is handled on the frontend** — the submit button disables and an error toast is shown.

**Note:** The Angular `unvotedPanelMembers(iv)` helper already hides the proxy button for panel members who have a `VOTE#` record (server-sourced via the BUG-024 fix). This provides UI-level prevention; BUG-025 is the backend safety net.

**`minimumPassScore` note:** `completeEvaluation` Lambda uses `minimumPassScore = 6` (confirmed in CloudWatch logs). Use `weightedScore > 5` (i.e., ratings that produce scores ≥ 6) in real test runs — default scores of exactly 5 will produce a `FAILED` evaluation result.

**Deployed via:**
```bash
bash scripts/deploy-talentflow-lambdas.sh submitVote
```

---

### BUG-026 — "Capture Panel Vote" button missing for SCHEDULED interviews — TA had no way to record panel votes until interview was marked complete

| Field | Detail |
|---|---|
| **Severity** | High (workflow blocker) |
| **Status** | ✅ Fixed — `candidate-workspace-page.component.html` 2026-06-02 |
| **Discovered** | 2026-06-02 — TA opened a SCHEDULED interview with 4 panel members (1 already voted) and saw only "Add Panel Member" + "Mark Complete"; no way to capture remaining 3 votes |
| **Affects** | All TAs trying to capture proxy votes on any interview still in SCHEDULED state |

**Symptom:** With an interview in `SCHEDULED` state, the TA action row shows only "Add Panel Member" and "Mark Complete". There is no "Capture Panel Vote" button. TAs were forced to mark the interview complete before they could record panel feedback, which distorted the workflow.

**Root cause:** The proxy capture button and vote form were only rendered inside `@if (iv.status === 'COMPLETED')`. The SCHEDULED block had a completely separate action row with no vote capture affordance for TAs.

```html
<!-- BEFORE — SCHEDULED section (TA side) -->
@if (isTA()) {
  <button>Add Panel Member</button>
  <button>Mark Complete</button>
  <!-- no Capture Panel Vote here -->
}
```

**Fix:** Added the full proxy capture flow to the SCHEDULED block:
1. A "Capture Panel Vote" button gated on `unvotedPanelMembers(iv).length > 0`
2. An "All votes captured" badge gated on `unvotedPanelMembers(iv).length === 0 && iv.votes?.length > 0`
3. The complete vote form (proxy selector → context banner → score form) as a third inline form beneath the existing Add Panel and Mark Complete forms — identical to the COMPLETED version

Panel members can now vote (or have their vote captured) at any point after the interview is scheduled, without requiring the TA to first mark it complete.

---

### BUG-027 — `unvotedPanelMembers()` ignored adhoc panel members — "All votes captured" shown when only system user had voted

| Field | Detail |
|---|---|
| **Severity** | High (data integrity / UX) |
| **Status** | ✅ Fixed — `candidate-workspace-page.component.ts/.html` 2026-06-02 |
| **Discovered** | 2026-06-02 — candidate `CAND-01KT4005Z7NRHBQK68AQW8SM54` had 1 system panel member (Tshepo, already voted) + 3 adhoc members; after BUG-026 fix, "All votes captured" badge appeared instead of the proxy selector |
| **Affects** | Any interview with a mix of system users and adhoc panel members where system users have already voted |

**Symptom:** After BUG-026 fix, the "Capture Panel Vote" button still did not appear for a SCHEDULED interview with votes outstanding. Instead, "All votes captured" was shown despite the tally reading "1 / 4 received". The Panel Votes Summary only showed one row (Tshepo) — the 3 adhoc members were entirely invisible.

**Root cause (two layers):**

1. **`unvotedPanelMembers()` only searched `panelMembers()` (Cognito system users) against `panelMemberIds`.**
   Adhoc panel members (stored in `iv.adhocPanelMembers`) have no Cognito account and are not returned by `getPanelMembers` API. They were never considered. Since Tshepo (the only system user in `panelMemberIds`) had already voted, `unvotedPanelMembers()` returned `[]`.

2. **"All votes captured" badge condition was `(iv.votes?.length ?? 0) > 0 && iv.panelMemberIds.length > 0`.**
   This fired as soon as any vote existed and any system panel member was attached — it had no concept of adhoc members at all.

3. **Panel Votes Summary only iterated `iv.panelMemberIds`** — adhoc members never rendered a row.

**Interview record confirmed via DynamoDB:**
```json
"panelMemberIds": ["b10ca268-a071-70ca-78ce-9dbe8733466d"],
"adhocPanelMembers": [
  { "name": "test panel",     "email": "testPanel@gmail.com",  "role": "Director" },
  { "name": "Another member", "email": "another@gmail.com",    "role": "Director" },
  { "name": "nso",            "email": "nso@gmail.com",        "role": "Director" }
],
"votesRequired": 4,
"votesSubmitted": 1
```

**Fix — three changes:**

1. **`unvotedPanelMembers(iv: Interview): PanelMember[]`** now returns two combined groups:
   ```ts
   // System users — match by sub OR email for backward compat (pre-BUG-022 records)
   const systemUnvoted = this.panelMembers().filter((m) => {
     const inPanel = iv.panelMemberIds.includes(m.id) || iv.panelMemberIds.includes(m.email);
     const hasVoted = votedIds.has(m.id) || votedIds.has(m.email);
     return inPanel && !hasVoted;
   });
   // Adhoc members — normalised to PanelMember shape; email is their canonical identifier
   const adhocUnvoted = (iv.adhocPanelMembers ?? [])
     .filter((a) => !votedIds.has(a.email))
     .map((a) => ({ id: a.email, email: a.email, name: a.name } as PanelMember));
   return [...systemUnvoted, ...adhocUnvoted];
   ```
   When a TA selects an adhoc member and submits, `voterIdOverride = adhoc.email` → stored as `voterId` in the `VOTE#` record. The duplicate guard, vote display lookup, and proxy selector removal all key on this email and work correctly.

2. **Panel Votes Summary HTML** — added a second `@for` loop over `iv.adhocPanelMembers` using `voteForMember(iv, adhoc.email)` to show voted/pending state. All adhoc rows display "via TA" on the vote row (since adhoc members can only vote through TA proxy capture).

3. **"All votes captured" badge condition** — changed to `unvotedPanelMembers(iv).length === 0 && (iv.votes?.length ?? 0) > 0`. This now correctly accounts for both system and adhoc members and only fires when the combined list is exhausted.

**Key invariant:** `votesRequired` on the `INTERVIEW#` record should equal `panelMemberIds.length + adhocPanelMembers.length`. The `scheduleInterview` Lambda sets `votesRequired` from PANEL_CONFIG, not from the panel size — if these diverge, the tally may show a mismatch. Create interviews with panel sizes matching the configured `votesRequired` for clean quorum tracking.

---

## Interview Voting Flow — E2E Test Checklist (Phase 7)

### Pre-conditions

- [ ] A candidate is at `INTERVIEWING` stage with at least one interview (SCHEDULED or COMPLETED) that has panel members attached
- [ ] Panel members were added **after** BUG-022 fix (so `panelMemberIds` stores subs, not emails)
- [ ] `getHiringManagers` returns Tshepo Mashego with Naleko sub `b10ca268...`
- [ ] Dev server running on `:4200`
- [ ] To test adhoc member proxy capture: interview must have at least one entry in `adhocPanelMembers` (add via "Add someone not in the directory" in the Schedule form)

### HM voting flow (from Task Card)

| Step | Action | Expected result | Status |
|---|---|---|---|
| 1 | Log in as HM (joworesources@gmail.com) | HM Dashboard loads; My Tasks tab shows candidates in INTERVIEWING/EVALUATION | 🔲 |
| 2 | Find a candidate with at least one completed interview on My Tasks tab | Task card shows "Evaluate" button | 🔲 |
| 3 | Click "Evaluate" on task card | Panel expands with interview score form | 🔲 |
| 4 | Submit score (use values that produce weightedScore > 5 to avoid FAILED result) | Green "✓ Voted" badge replaces Evaluate button | 🔲 |
| 5 | Decisions tab after 2.5s | Candidate appears in Decisions with PASSED / FAILED result badge | 🔲 |
| 6 | Attempt to re-open the vote form on the same card | "✓ Voted" badge shown — panel locked (no re-vote in session) | 🔲 |
| 7 | Refresh page, navigate back to HM Dashboard | Backend 409 prevents duplicate if vote form is somehow reached | 🔲 |

### HM voting flow (from Candidate Workspace)

| Step | Action | Expected result | Status |
|---|---|---|---|
| 1 | Log in as HM, click a candidate row in My Candidates | Navigates to candidate workspace | 🔲 |
| 2 | Open Interviews tab | Interview cards visible; TA-only actions (Advance Stage, Schedule Interview, Edit Details, Reject) hidden | 🔲 |
| 3 | Locate COMPLETED interview card | Panel Votes Summary shows each panel member as "Pending" (initially) | 🔲 |
| 4 | Click "Submit Vote" button | Vote/score form opens | 🔲 |
| 5 | Submit vote | "✓ Voted" badge appears; panel vote row shows rating + score | 🔲 |
| 6 | Refresh page | Panel vote row still shows HM vote (server-sourced — BUG-024 fix) | 🔲 |

### TA proxy capture flow — system panel members (COMPLETED interview)

| Step | Action | Expected result | Status |
|---|---|---|---|
| 1 | Log in as TA | Candidate workspace accessible with all TA actions visible |🔲 |
| 2 | Navigate to a candidate with a COMPLETED interview + ≥1 unvoted system panel member | Interviews tab shows interview card |🔲 |
| 3 | Verify TA does NOT see standard "Submit Vote" button | Only "Capture Panel Vote" is shown (TA cannot vote as themselves) | 🔲 |
| 4 | Click "Capture Panel Vote" | Proxy selector renders — one button per unvoted panel member by name | 🔲 |
| 5 | Select a system panel member | Context banner shows "Capturing vote on behalf of [Name]"; score form appears | 🔲 |
| 6 | Submit score | Vote submitted; panel vote row shows "via TA" indicator; `VOTE#` in DynamoDB has `voterId = panelMember.sub`, `submittedByTA = TA.sub` | 🔲 |
| 7 | Proxy-captured member removed from selector | `unvotedPanelMembers()` no longer includes that member | 🔲 |
| 8 | Attempt to capture a second vote for same member | Backend returns 409 — "already submitted a vote for this interview" | 🔲 |

### TA proxy capture flow — SCHEDULED interview (BUG-026 fix)

| Step | Action | Expected result | Status |
|---|---|---|---|
| 1 | Navigate to a candidate with a SCHEDULED interview with ≥1 panel member | Interview card shows SCHEDULED badge | 🔲 |
| 2 | Verify "Capture Panel Vote" button is visible alongside Add Panel Member + Mark Complete | All three buttons visible for TA (BUG-026 fixed) | 🔲 |
| 3 | Click "Capture Panel Vote" | Proxy selector opens below the action row | 🔲 |
| 4 | Select an unvoted panel member, fill score, submit | Vote stored; panel vote row updates; proxy selector removes that member | 🔲 |
| 5 | Interview is still SCHEDULED after vote submission | Status unchanged — vote capture does not auto-complete the interview | 🔲 |

### TA proxy capture flow — adhoc panel members (BUG-027 fix)

| Step | Action | Expected result | Status |
|---|---|---|---|
| 1 | Navigate to an interview that has adhoc panel members (added via "not in the directory") | Panel chips show their names alongside system users | 🔲 |
| 2 | Open "Capture Panel Vote" | Proxy selector shows both system AND adhoc members who haven't voted | 🔲 |
| 3 | Select an adhoc member | Context banner shows their name; score form appears | 🔲 |
| 4 | Submit score | Panel Votes Summary updates — adhoc row shows rating + score + "via TA"; `VOTE#` record has `voterId = adhoc.email` | 🔲 |
| 5 | Adhoc member removed from proxy selector after vote | `unvotedPanelMembers()` excludes them (checks `votedIds.has(adhoc.email)`) | 🔲 |
| 6 | All members voted (system + adhoc) | "All votes captured" badge appears; proxy selector hidden | 🔲 |

### Panel Vote Summary verification

| Step | Action | Expected result | Status |
|---|---|---|---|
| 1 | Open interview card (any role) | Panel Votes section shows tally "N / M received" and a row per panel member | 🔲 |
| 2 | Voted member row | Shows name, rating label (Strongly Recommend / Recommend / Do Not Recommend), weighted score, and "via TA" if applicable | 🔲 |
| 3 | Unvoted member row | Shows name + clock icon + "Pending" | 🔲 |
| 4 | After all panel members vote | Tally shows "M / M received"; `completeEvaluation` Lambda fires; `EVALUATION` result set on SAGA | 🔲 |

---

## Interview Loop — E2E Test Checklist

Use a fresh candidate for this test. Existing stale candidates (at `PHONE_SCREENING`, `ONBOARDING`, etc.) should be discarded.

### Pre-conditions

- [ ] `PANEL_CONFIG` v2 active with `interviewRequirements` (confirm in DynamoDB)
- [ ] `STAGE_CONFIG` v2 active with all 10 stages (confirm in DynamoDB)
- [ ] `advanceCandidateStage` has `CONFIG_TABLE_NAME=talent-flow-config` env var set
- [ ] Dev server running on `:4200`

### Test sequence (JUNIOR candidate — 3 required types: Phone Screen, Behavioral, Final)

| Step | Action | Expected result | Status |
|---|---|---|---|
| 1 | Create new JUNIOR candidate | SAGA at `APPLICATION_REVIEW`, `configVersion = v<N>` | 🔲 |
| 2 | Advance to `INTERVIEWING` | Success — no gate on exit from APPLICATION_REVIEW | 🔲 |
| 3 | **Try advancing to `EVALUATION` immediately** | `409 Conflict` — lists pending: PHONE_SCREEN, BEHAVIORAL, FINAL | 🔲 |
| 4 | Schedule a `PHONE_SCREEN` interview | `INTERVIEW#<id>` record created, `status=SCHEDULED` | 🔲 |
| 5 | Mark PHONE_SCREEN complete | `status=COMPLETED`, `completedAt` set | 🔲 |
| 6 | Try advancing to EVALUATION again | Still `409` — BEHAVIORAL and FINAL still pending | 🔲 |
| 7 | Schedule + complete `BEHAVIORAL` interview | `status=COMPLETED` | 🔲 |
| 8 | Schedule + complete `FINAL` interview | `status=COMPLETED` | 🔲 |
| 9 | Advance to `EVALUATION` | Success — all required types complete | 🔲 |
| 10 | Verify CloudWatch — no gate-skipped WARN | Clean log — gate fired and passed | 🔲 |

### CloudWatch verification for step 3 (gate blocking correctly)

Filter `/aws/lambda/advanceCandidateStage` for the candidate ID. Expected log:
```
INFO interviewLoopGate: blocking advance — pending types { pending: ['PHONE_SCREEN', 'BEHAVIORAL', 'FINAL'] }
```
And HTTP response to the frontend should be `409`.

### CloudWatch verification for step 9 (gate passing)

No gate-related WARN. Should see:
```
INFO Stage advanced { candidateId: '...', previousStage: 'INTERVIEWING', newStage: 'EVALUATION' }
```

---

## Workflow Stages — Current Status

| Stage | Status | Notes |
|---|---|---|
| Candidate Created | ✅ Verified | All optional fields (department, location, experience) now persisted — BUG-009 fixed |
| `APPLICATION_REVIEW` | ✅ Verified | — |
| `INTERVIEWING` (advance in) | ✅ Verified | — |
| `INTERVIEWING` gate (block until interviews done) | ✅ Verified | Gate fires correctly — 409 with pending type list |
| Schedule interview — sequential enforcement | ✅ Verified | Type locked to next in PANEL_CONFIG order; backend 409 if another SCHEDULED exists |
| Schedule interview — duplicate type guard | ✅ Verified | Backend 409 if same type already COMPLETED |
| Complete interview (Mark Complete inline form) | ✅ Verified | PATCH updates status + outcome; list refreshes |
| Add Panel Member to interview | ✅ Verified | PATCH merges panel member IDs; list refreshes |
| Submit vote per interview (HM direct) | ✅ Verified | HM vote from task card or workspace; "✓ Voted" badge replaces button; 2.5s delay before re-fetch |
| Submit vote on behalf of system panel member (TA proxy) | ✅ Verified | TA selects unvoted system user from proxy selector; `submittedByTA` audit field stored; "via TA" shown in vote row |
| Submit vote on behalf of adhoc panel member (TA proxy) | ✅ Verified | Adhoc members (not in Cognito) normalised to `PanelMember` with email as id; vote stored with `voterId = adhoc.email`; Panel Votes Summary shows their row with "via TA" |
| Capture Panel Vote on SCHEDULED interview | ✅ Verified | "Capture Panel Vote" button available on SCHEDULED interviews alongside Add Panel + Mark Complete (BUG-026 fix) |
| Vote display per interview card | ✅ Verified | Panel Votes Summary shows per-member voted/pending state from server (BUG-024 fix) |
| Duplicate vote prevention (backend) | ✅ Verified | `submitVote` returns 409 if same `voterId` + `interviewId` already in DynamoDB (BUG-025) |
| Panel member name resolution (sub + email backward compat) | ✅ Verified | `panelMemberNameById()` matches `m.id === id \|\| m.email === id` — old email-keyed records still display |
| Activity log — interview events | ✅ Verified | InterviewScheduled + InterviewCompleted now published to EventBridge → audit stream |
| Interview loop progress tracker | ✅ Verified | Loop stepper shows PENDING / SCHEDULED / COMPLETED per required type |
| `EVALUATION` (advance out of INTERVIEWING) | ✅ Verified | Gate passes when all 3 required types COMPLETED — CloudWatch confirmed clean |
| `BACKGROUND_CHECK` | 🔲 Not tested | — |
| `OFFER_PREPARATION` | 🔲 Not tested | — |
| `OFFER_APPROVAL` | 🔲 Not tested | Needs FinanceLead in Cognito |
| `OFFER_DELIVERY` | 🔲 Not tested | — |
| `CONTRACT_SIGNING` | 🔲 Not tested | Triggers IT provisioning |
| `PRE_BOARDING` | 🔲 Not tested | — |
| `ONBOARDING` | 🔲 Not tested | — |
| IT provisioning bundle created | 🔲 Not tested | Needs ITAdmin/ITSpecialist |

---

### BUG-028 — Zone containers using grey background + 1px border (No-Line Rule violation)

| Field | Detail |
|---|---|
| **Severity** | Medium — visual/design regression |
| **Status** | ✅ Fixed — `dashboard-page.component.html` + `.scss`, branch `feature/tf-dashboard-naleko-redesign` 2026-06-02 |
| **Affects** | TA Dashboard zones 2, 3, 4, 5 |
| **Rule violated** | Rule 1 (white cards) + Rule 2 (No-Line Rule) |

**Symptom:** Zones 2/3/4/5 had `background: var(--naleko-surface-container-low)` (grey) and `border: 1px solid var(--naleko-outline-variant)` (visible line). Cards looked flat and out-of-family with the HR Portal dashboard.

**Root cause:** Zone containers were raw `<div>` elements with manually-applied grey surface background. The HR Portal uses `p-card` PrimeNG components which provide white background + shadow — this pattern was never applied to TalentFlow zones.

**Fix:**
1. Replaced `<div class="tf-dash__zone-X">` with `<p-card styleClass="tf-dash__zone-X">` in HTML
2. Removed `background` + `border` from zone SCSS rules
3. Added `::ng-deep` block to force `p-card` to white (`--naleko-surface-container-lowest`), `--naleko-shadow-card`, `border: none`, and zero internal padding
4. Added `CardModule` to component imports

**Pattern to apply to all future TalentFlow zone containers** — see Rule 5 in the Design System Standards section above.

---

### BUG-029 — KPI signal cards (Zone 1) had coloured tinted backgrounds

| Field | Detail |
|---|---|
| **Severity** | Medium — design non-conformance |
| **Status** | ✅ Fixed — `dashboard-page.component.scss` 2026-06-02 |
| **Affects** | TA Dashboard Zone 1 (SLA Breaches, At Risk, Acceptance Rate, Active Pipeline cards) |
| **Rule violated** | Rule 1 (white cards) + Rule 4 (semantic colour = text/icons/borders) |

**Symptom:** Each KPI card variant used a coloured tinted background: `color-mix(in srgb, var(--naleko-error) 10%, var(--naleko-surface))`. The HR Portal stat-cards are all white.

**Root cause:** Urgency/state was being expressed via background colour instead of accent borders and text colour.

**Fix:** Removed all coloured backgrounds from card variants. Added:
- `background: var(--naleko-surface-container-lowest)` + `box-shadow: var(--naleko-shadow-card)` on the base class
- `border-top: 3px solid var(--naleko-error/warning/success/secondary)` per variant (colour accent without tinting the card body)
- Coloured value text (`.tf-signal-card__value`) retained per variant

---

### BUG-030 — Candidate cards in Zone 2 had coloured tinted backgrounds

| Field | Detail |
|---|---|
| **Severity** | Medium — design non-conformance |
| **Status** | ✅ Fixed — `dashboard-page.component.scss` 2026-06-02 |
| **Affects** | TA Dashboard Zone 2 candidate cards (breached + at-risk variants) |
| **Rule violated** | Rule 1 (white cards) + Rule 4 (semantic colour = text/icons/borders) |

**Symptom:** `.tf-cand-card--breached` had `background: color-mix(in srgb, var(--naleko-error) 4%, var(--naleko-surface))`. Cards had a pink/red wash.

**Fix:** Changed base `.tf-cand-card` to `background: var(--naleko-surface-container-lowest)`. Replaced thick coloured border with a `border-left: 3px solid var(--naleko-error/warning)` left accent. The red "BREACHED" badge and SLA bar still communicate urgency — no information is lost.

---

### BUG-031 — "This month" cards in Zone 5 had coloured tinted backgrounds

| Field | Detail |
|---|---|
| **Severity** | Medium — design non-conformance |
| **Status** | ✅ Fixed — `dashboard-page.component.scss` 2026-06-02 |
| **Affects** | TA Dashboard Zone 5 (Acceptance Rate card = green tint; Hesitant Signals card = amber tint) |
| **Rule violated** | Rule 1 (white cards) + Rule 4 (semantic colour = text/icons/borders) |

**Symptom:** `.tf-month-card--success` and `.tf-month-card--warning` used `color-mix(success/warning 6%, surface)` as background. The base `.tf-month-card` used `--naleko-surface` (page grey, not white).

**Fix:** All month card variants set to `background: var(--naleko-surface-container-lowest)`. Added `box-shadow: var(--naleko-shadow-card)`. Removed tinted background overrides on success/warning variants — coloured value text retained. Base border changed from `1.5px solid --naleko-outline-variant` to `1px solid rgba(200, 197, 205, 0.18)` (very subtle, not a visible line).

---

### BUG-032 — TA Dashboard missing welcome greeting section

| Field | Detail |
|---|---|
| **Severity** | Low — missing feature / UX gap |
| **Status** | ✅ Fixed — `dashboard-page.component.html` + `.scss` + `.ts` 2026-06-02 |
| **Affects** | TA Dashboard (all TAs) |
| **Rule violated** | Rule 7 (page should have a greeting or contextual title) |

**Symptom:** The TA Dashboard opened directly into KPI cards with no personalised greeting. The HR Portal HR Dashboard and Employee Dashboard both have a "Good morning, [Name]" greeting. TalentFlow felt disconnected.

**Fix:** Added `<div class="tf-dash__greeting">` above Zone 1 with computed `timeOfDay()` (morning/afternoon/evening) and `greetingName()`. See the Greeting Pattern in the Design System Standards section above.

---

### BUG-033 — KPI signal cards missing icon boxes

| Field | Detail |
|---|---|
| **Severity** | Low — design gap vs HR Portal pattern |
| **Status** | ✅ Fixed — `dashboard-page.component.html` + `.scss` 2026-06-02 |
| **Affects** | TA Dashboard Zone 1 — all 4 KPI cards |
| **Rule violated** | Rule 6 (KPI cards must have icon boxes) |

**Symptom:** Zone 1 signal cards showed eyebrow label → large value → sub text with no icon. The HR Portal stat-cards always have a coloured icon box as the first element.

**Fix:** Added `<div class="tf-signal-card__icon"><i class="pi pi-*"></i></div>` as the first child of each signal card. Icons chosen: `pi-exclamation-triangle` (breached), `pi-clock` (at risk), `pi-percentage` (acceptance rate), `pi-users` (active pipeline). Icon box styled at 2.75rem × 2.75rem with coloured tinted background matching the card's accent colour.

---

### BUG-034 — Section headers too small (1rem vs design standard 1.125rem)

| Field | Detail |
|---|---|
| **Severity** | Low — visual polish |
| **Status** | ✅ Fixed — `dashboard-page.component.scss` 2026-06-02 |
| **Affects** | All section headers on TA Dashboard (`Candidates at risk`, `My actions today`, `Pipeline`, `This month`) |
| **Rule violated** | Rule 7 (section headers: 1.125rem / 700) |

**Symptom:** `.tf-section-head__title` was `font-size: 1rem` — visually undersized compared to the HR Portal's section headers.

**Fix:** Updated to `font-size: 1.125rem`. Weight was already `700` — no change needed.

---

### BUG-035 — Dashboard greeting showing "there" — TalentFlowAuthService always null

| Field | Detail |
|---|---|
| **Severity** | Medium — user identity broken for any TF component that uses tfAuth for display |
| **Status** | ✅ Fixed — `dashboard-page.component.ts` 2026-06-02 |
| **Affects** | All TalentFlow components that call `tfAuth.currentUser()` for the user's name or identity |
| **Rule violated** | Rule 8 (always use nalekoAuth for user identity) |

**Symptom:** Greeting showed "Good evening, there — here's your pipeline today." despite being logged in. The `greetingName` computed returned the fallback `'there'` because `tfAuth.currentUser()?.givenName` was `undefined`.

**Root cause:** `TalentFlowAuthService.currentUser()` is always `null`. All users (TAs, HMs, Admins) authenticate via the **Naleko Cognito pool** (`af-south-1_2LdAGFnw2`) — the TF pool (`af-south-1_C8TTlQxY7`) has no login page and is not used for authentication. The TF API Gateway authorizer (`ko4zam`) validates tokens from the Naleko pool. This is documented in the Cognito Pool Architecture section above.

This same bug affects the shell's `initials()` computed (shows `?` instead of user initials) — the shell handles it correctly via `tfAuth.currentUser() ?? nalekoAuth.currentUser()` chain, but any new TalentFlow component that naively calls `tfAuth.currentUser()` will silently get `null`.

**Fix:** Added `AuthService` (Naleko) injection to the dashboard component. Updated `greetingName`:
```ts
import { AuthService } from '../../../../core/services/auth.service';
// ...
private readonly nalekoAuth = inject(AuthService);

protected readonly greetingName = computed(() =>
  this.tfAuth.currentUser()?.givenName ||
  this.nalekoAuth.currentUser()?.givenName ||
  'there',
);
```

**Future prevention:** See Rule 8 in the Design System Standards section. Always use `nalekoAuth.currentUser()` in TalentFlow components. The `tfAuth` call is kept as a forward-compat stub in case the pool architecture changes.

---

## Where to Investigate What

| Symptom | Where to look |
|---|---|
| Candidate advanced through INTERVIEWING without interviews | CloudWatch `/aws/lambda/advanceCandidateStage` — filter `interviewLoopGate` |
| Gate says "gate skipped" | Lambda missing `CONFIG_TABLE_NAME` env var (BUG-005) |
| Gate says "no item found for PANEL_CONFIG" | PANEL_CONFIG not re-saved via admin UI (BUG-003 pattern) |
| Candidate stuck in stage | CloudWatch `/aws/lambda/advanceCandidateStage` |
| Config not applying | CloudWatch `/aws/lambda/orchestrateTalentFlowWorkflow` + DynamoDB `talent-flow-config` GSI1PK |
| `configVersion` stuck as NULL | BUG-004 — check SAGA for `{"NULL": true}` attribute |
| Idempotency errors | CloudWatch `/aws/lambda/createCandidate` + DynamoDB `talent-flow-idempotency-keys` |
| Events not firing | CloudWatch `/aws/lambda/orchestrateTalentFlowWorkflow` + EventBridge `talent-flow-bus` |
| Notifications not sending | CloudWatch `/aws/lambda/sendTalentFlowNotification` |
| Offer approval stuck | Step Functions console → `talent-flow-offer-approval` execution |
| IT tasks not created | CloudWatch `/aws/lambda/createItTask` + DynamoDB `it-tasks` table |
| Provisioning bundle missing | DynamoDB `provisioning-bundles` + CloudWatch `/aws/lambda/createProvisioningBundle` |
| Audit log missing | CloudWatch `/aws/lambda/talentFlowAuditStream` + DynamoDB `talent-flow-events` |
| Interview events missing from activity log | `scheduleInterview` Lambda not publishing to EventBridge (BUG-014 pattern) — check `publishEvent` calls exist |
| Interview scheduled 500 immediately after deploy | Manual zip used instead of deploy script — `ImportModuleError` for `../shared/config-reader` (BUG-015) — use `deploy-talentflow-lambdas.sh` |
| Same interview type schedulable twice | Backend guard missing — check `scheduleInterview` has duplicate-type 409 guard (BUG-011) |
| Vote button reappears after submission | `votedInterviewIds` signal not tracking this interviewId — check `submitVoteForInterview` success handler |
| `votesSubmitted` growing beyond `votesRequired` | SAGA-level counter not cleared between interviews — `submitVote` should target `INTERVIEW#` record (BUG-013) |
| Candidate fields empty despite being entered | Created before BUG-009 fix, or `createCandidate` not redeployed — check Lambda version date |
| SLA breach not detected | CloudWatch `/aws/lambda/monitorTalentFlowSLAs` |
| HM Dashboard shows all candidates / no candidates | `nalekoAuth.currentUser()?.sub` empty, or DynamoDB `hiringManagerId` not backfilled — compare sub to SAGA records (BUG-017/018) |
| HM Dashboard infinite loading / NG0203 error | `toObservable()` called outside injection context — must be in constructor (BUG-016) |
| `getHiringManagers` returns wrong subs | Lambda still pointing at TF pool — check `HM_COGNITO_POOL_ID` env var = `af-south-1_2LdAGFnw2` (BUG-019) |
| HM nav link opens TA pipeline view | Shell nav link missing `?tab=` query param — check `routerLink` + `[queryParams]` in `talent-flow-shell.component.html` (BUG-020) |
| HM sees Edit / Reject / Advance / Schedule buttons | `isTA()` using broken `tfAuth` — must use `nalekoAuth` Naleko group check (BUG-021) |
| New candidate `hiringManagerId` is email or old TF sub | `getHiringManagers` was using TF pool — redeploy Lambda + backfill DynamoDB (BUG-018/019) |
| Panel member names show as "Unknown" in vote summary | `getPanelMembers` returning email as `id` — panelMemberIds stored emails not subs (BUG-022) — redeploy `getPanelMembers`, create fresh candidate |
| TA vote form shows self-vote instead of proxy selector | `isTA()` not gating vote form — check workspace HTML renders "Capture Panel Vote" + proxy selector for TAs (BUG-023) |
| Vote rows all show "Pending" even after votes submitted | `GET /v1/candidates/{id}/interviews` not returning `votes` — check `scheduleInterview` Lambda GET handler queries `VOTE#` records (BUG-024) |
| Voter can submit a second vote after page refresh | Backend duplicate guard missing — check `submitVote` Lambda has pre-write `QueryCommand` returning 409 on match (BUG-025) |
| Evaluation result is FAILED with seemingly good scores | `minimumPassScore = 6` in `completeEvaluation` — ensure submitted scores produce `weightedScore > 5` |
| "via TA" not showing on proxy-captured vote | `submittedByTA` not persisted — check `submitVote` Lambda stores the field + `scheduleInterview` GET returns it in projection |
| "Capture Panel Vote" button missing on SCHEDULED interview | Vote form was COMPLETED-only — check workspace HTML has proxy button + vote form inside SCHEDULED block (BUG-026) |
| "All votes captured" shown when adhoc members still pending | `unvotedPanelMembers()` not including adhoc — check it returns `[...systemUnvoted, ...adhocUnvoted]` (BUG-027) |
| Adhoc panel members show no vote row in Panel Votes Summary | HTML only iterating `panelMemberIds` — check second `@for (adhoc of iv.adhocPanelMembers)` loop exists in template (BUG-027) |
| Proxy selector empty even though panel members exist | Mix of system + adhoc members, system have all voted — `unvotedPanelMembers` must include adhoc; verify `iv.adhocPanelMembers` is populated in DynamoDB INTERVIEW# record |
| `votesRequired` tally doesn't match panel size | `scheduleInterview` sets `votesRequired` from PANEL_CONFIG (role-based), not panel size — create interviews with panel counts matching the configured required votes |
| TalentFlow card background is grey/tinted instead of white | Zone div not wrapped in `<p-card>` or card uses `--naleko-surface-container-low` — see Rule 1 + Rule 5, BUG-028/029/030/031 |
| TalentFlow card has a visible 1px border line | Zone container has `border: 1px solid --naleko-outline-variant` — remove it, use `box-shadow: --naleko-shadow-card` instead — see Rule 2, BUG-028 |
| `<p-card>` zone has double padding (content indented too far) | Missing `::ng-deep` padding reset for `.p-card-body` and `.p-card-content` — add `padding: 0 !important` — see Rule 5 |
| KPI card has no icon | Signal/stat card missing `<div class="...__icon"><i class="pi pi-*"></i></div>` — see Rule 6, BUG-033 |
| TalentFlow page shows "there" in greeting or "?" initials | `tfAuth.currentUser()` is always null — must use `nalekoAuth.currentUser()?.givenName` from `AuthService` — see Rule 8, BUG-035 |
| Section headers look too small compared to HR Portal | `.tf-section-head__title` font-size is below 1.125rem — update to `font-size: 1.125rem; font-weight: 700` — see Rule 7, BUG-034 |
| Hardcoded hex colour in TalentFlow SCSS | Replace with the correct `--naleko-*` token from `hr-portal/src/styles/naleko-tokens.css` — see Rule 3 |

---

## Deploy Checklist

### Phase 1 — IAM + config (completed 2026-06-01)
- [x] `terraform apply` — 2 IAM patches deployed (BUG-001, BUG-002)
- [x] All config types re-saved via Admin UI (BUG-003)
- [x] `createCandidate` redeployed — `configVersion: null → undefined` fix (BUG-004)
- [x] `orchestrateTalentFlowWorkflow` redeployed — comment fix
- [x] Confirmed new candidate gets real `configVersion` (not NULL) in SAGA

### Phase 2 — INTERVIEWING stage architecture (completed 2026-06-01)
- [x] `advanceCandidateStage` rewritten — 10-stage STAGE_ORDER, interview loop gate
- [x] `scheduleInterview` refactored — removed per-type stage-map, added `completeInterview` handler
- [x] `completeEvaluation` fixed — advances to `BACKGROUND_CHECK` (not `OFFER_PREPARATION`)
- [x] `submitVote` fixed — votesRequired from PANEL_CONFIG not fragile INTERVIEW# query
- [x] All 4 Lambdas redeployed via `deploy-talentflow-lambdas.sh`
- [x] Frontend updated — 10-stage models, STAGE_LABELS, service STAGE_ORDER, workspace HTML
- [x] `PANEL_CONFIG` v2 saved with `interviewRequirements` via new Admin UI panel
- [x] `STAGE_CONFIG` v2 saved with 10 stages via new Admin UI page
- [x] `CONFIG_TABLE_NAME` env var added to `advanceCandidateStage` (BUG-005)
- [x] `dynamodb:Query` on `talent-flow-config/index/*` added to 5 Lambda roles (BUG-006)
- [x] `infra/iam-patches.tf` updated with PATCH 3 (`for_each` across all 5 roles)
- [x] `dynamodb:Query` on `talent-flow-state` added to `advanceCandidateStage` (BUG-007)
- [x] `dynamodb:PutItem` + `Query` on `talent-flow-state` added to `scheduleInterview` (BUG-008)
- [x] `advanceCandidateStage` redeployed — gate message now shows readable interview type names

### Phase 3 — Interview GET route + full deploy (completed 2026-06-01)
- [x] PR #233 (`feature/interviewing-stage-loop` → `develop`) merged — 19 files, interview loop UI + Lambda GET handler
- [x] PR #234 (`develop` → `main`) merge conflicts resolved — `docs/E2E-TESTING-GUIDE.md` and `infra/iam-patches.tf` add/add conflicts kept develop's version
- [x] `terraform apply` — 3 new resources: `aws_lambda_permission.apigw_get_interviews`, `aws_apigatewayv2_integration.get_candidate_interviews`, `aws_apigatewayv2_route.get_candidate_interviews`
- [x] API GW route `GET /v1/candidates/{id}/interviews` live (JWT-protected, route ID `vdkqhg2`)
- [x] All 33 TalentFlow Lambdas redeployed via `deploy-talentflow-lambdas.sh`
- [x] Lambda invoked directly — returned real interview record (`BEHAVIORAL`, `SCHEDULED`, panel member attached) for `CAND-01KS5H7TKYCP8KYQSAFXQHZAME`

### Phase 4 — Interview loop E2E verification (completed 2026-06-01)
- [x] Fresh candidate created (JUNIOR) — `CAND-01KT1N9BQ9AH8ATEPJYAP2HYDY` (Ryan Giggs)
- [x] Gate blocks advance at INTERVIEWING → EVALUATION before interviews done
- [x] All 3 required interview types scheduled and completed (Phone Screen → Behavioral → Final)
- [x] Gate passes — advance to EVALUATION succeeds
- [x] CloudWatch confirms clean gate log with no "gate skipped" WARN
- [x] Angular workspace UI — Interview tab loads scheduled interviews from `GET /v1/candidates/{id}/interviews`
- [x] "Complete Interview" form submits PATCH and updates status in UI
- [x] "Add Panel Member" form submits PATCH and updates panelMemberIds in UI
- [x] Several UX and data bugs discovered in this phase → fixed in Phase 5

### Phase 5 — Interview UX hardening + activity log (completed 2026-06-01)
- [x] BUG-009: `createCandidate` optional fields not persisted — fixed Lambda + API service
- [x] BUG-010: PANEL_CONFIG race condition — `nextScheduleableType` empty on Interviews tab open — fixed load-on-init
- [x] BUG-011: No backend guard for duplicate/concurrent interviews — added 409 guards in `scheduleInterview`
- [x] BUG-012: Vote button stays after submission — added `votedInterviewIds` session tracking, replaced with "✓ Voted" badge
- [x] BUG-013: `votesSubmitted` incremented on SAGA not INTERVIEW# record — fixed `submitVote` Lambda
- [x] BUG-014: Activity log never showed interview events — `scheduleInterview` never published to EventBridge — fixed
- [x] BUG-015: Manual Lambda zip skipped `require` path patch — broke cold start with `ImportModuleError` — must always use `deploy-talentflow-lambdas.sh`
- [x] Both Lambdas redeployed via `deploy-talentflow-lambdas.sh`
- [x] Phase 5 reference candidate `CAND-01KT1Q9A6RRY8TEMA7TS5B8P2E` — full interview loop + advance to EVALUATION confirmed clean in CloudWatch

### Phase 6 — HM Dashboard pool consolidation fixes (completed 2026-06-01)
- [x] BUG-016: `NG0203 toObservable()` outside injection context — moved to constructor; replaced with direct `loadCandidates()` call
- [x] BUG-017: HM Dashboard showing all candidates — switched from `tfAuth.currentUser()?.email` to `nalekoAuth.currentUser()?.sub`
- [x] `AuthUser` interface: added `sub: string` field extracted from JWT `payload['sub']`
- [x] BUG-018: DynamoDB `hiringManagerId` backfilled — 8 SAGA records updated from email/TF-sub to `b10ca268-a071-70ca-78ce-9dbe8733466d` (Tshepo's Naleko sub)
- [x] BUG-019: `getHiringManagers` Lambda updated to Naleko pool (`af-south-1_2LdAGFnw2`) + group `naleko-talentflow-hiringmanager`; `terraform apply` (2 resources changed); Lambda redeployed
- [x] BUG-020: HM nav links fixed — `routerLink="/platform/talentflow/hm-dashboard"` + `[queryParams]="{ tab: 'candidates' | 'decisions' }"`
- [x] BUG-021: `isTA()` rewritten — uses `nalekoAuth.currentUser()?.groups.includes('naleko-talentflow-hiringmanager')`; commit `f846051`
- [x] All changes committed + pushed → `feat/candidate-workspace-interview-flow-fix` (commits `beff9e3`, `f846051`)

### Phase 7 — Interview voting UX + data integrity (completed 2026-06-02)

#### Backend fixes (Lambdas deployed)
- [x] BUG-022: `getPanelMembers` returning `id: email` — fixed to `id: sub`; `getPanelMembers` redeployed via `deploy-talentflow-lambdas.sh`
- [x] BUG-024: `scheduleInterview` GET never returned `VOTE#` records — added single `QueryCommand` for all `VOTE#` under the candidate; each interview now includes `votes: InterviewVoteRecord[]`; redeployed via `deploy-talentflow-lambdas.sh`
- [x] BUG-025: No backend duplicate vote guard — added pre-write `QueryCommand` in `submitVote` Lambda returning 409 if `voterId + interviewId` already exists; `submittedByTA` field now persisted to `VOTE#` record; redeployed via `deploy-talentflow-lambdas.sh`

#### Frontend fixes (Angular)
- [x] BUG-023: TA vote form allowed self-voting — replaced with "Capture Panel Vote" proxy selector; `taProxyMemberId` signal gates the score form; `unvotedPanelMembers(iv)` helper hides already-voted members from proxy list
- [x] `submitVote()` API signature extended: `submitVote(candidateId, payload, voterIdOverride?)` — `voterIdOverride` sets `voterId` to proxy sub; `submittedByTA` set to self when override used
- [x] `voterId` in API service updated to use `currentUser.sub ?? currentUser.email` (was email-only)
- [x] `InterviewVoteRecord` interface added to `talent-flow.models.ts`; `Interview` extended with `votes?: InterviewVoteRecord[]`
- [x] Panel Votes Summary section added to each interview card in workspace HTML — per-member voted/pending rows with rating label, weighted score, "via TA" indicator
- [x] `voteForMember(iv, memberId)`, `panelMemberNameById(id)`, `ratingLabel(rating)`, `ratingClass(rating)`, `hasCurrentUserVoted(iv)` helpers added to workspace component
- [x] HM task card: `voted = input<boolean>(false)` input; "Submit Evaluation" → "Submit Vote"; "✓ Voted" badge shown when `voted()` is true; `voteSubmitted = output<string>()` emits `candidateId`
- [x] HM Dashboard: `evaluatedCandidateIds = signal<Set<string>>(new Set())`; `onVoteSubmitted(candidateId)` adds to set + triggers `loadCandidates()` after 2.5s delay; Decisions tab shows evaluation result badges (PASSED green / FAILED red)
- [x] Sentiment "Save" button wrapped with `@if (isTA())` — HMs read sentiment but cannot edit

### Phase 7.1 — TA proxy capture on SCHEDULED interviews + adhoc panel member votes (completed 2026-06-02)

- [x] BUG-026: "Capture Panel Vote" absent from SCHEDULED interview actions — added proxy button + vote form to SCHEDULED block; no backend change required
- [x] BUG-027: `unvotedPanelMembers()` returned empty when system users all voted, hiding adhoc members from proxy selector — fixed to union system (sub/email backward compat) + adhoc (email as id) unvoted lists
- [x] "All votes captured" badge condition tightened — now `unvotedPanelMembers(iv).length === 0 && iv.votes?.length > 0` (was `iv.votes?.length > 0 && iv.panelMemberIds.length > 0`)
- [x] Panel Votes Summary HTML extended — second `@for` loop over `iv.adhocPanelMembers` renders voted/pending rows for each; all adhoc voted rows show "via TA" indicator
- [x] Verified on `CAND-01KT4005Z7NRHBQK68AQW8SM54`: Tshepo (system user) already voted; "test panel", "Another member", "nso" (adhoc) now appear in proxy selector and Panel Votes Summary as Pending

### Phase 8 — TA Dashboard Naleko Design System Alignment (completed 2026-06-02)

**Branch:** `feature/tf-dashboard-naleko-redesign` — frontend only, no Lambda or Terraform changes.

- [x] BUG-028: Zone containers (Zones 2/3/4/5) replaced raw `<div>` with `<p-card styleClass="...">` — white background + shadow-card, border removed
- [x] BUG-029: Zone 1 KPI signal cards — removed coloured tinted backgrounds; added `background: --naleko-surface-container-lowest` + `box-shadow: --naleko-shadow-card`; urgency now expressed via `border-top: 3px solid` accent + coloured value text
- [x] BUG-030: Zone 2 candidate cards — removed red/amber tinted backgrounds; white background; urgency via `border-left: 3px solid --naleko-error/warning` accent
- [x] BUG-031: Zone 5 month cards — removed green/amber tinted backgrounds; white background + shadow; coloured value text retained
- [x] BUG-032: Added welcome greeting section — `Good {{ timeOfDay() }}, {{ greetingName() }} — here's your pipeline today.` — above Zone 1
- [x] BUG-033: Added icon boxes to all 4 Zone 1 KPI cards — `pi-exclamation-triangle`, `pi-clock`, `pi-percentage`, `pi-users` — coloured tinted backgrounds via `color-mix`
- [x] BUG-034: Section headers updated — `font-size: 1rem → 1.125rem` on `.tf-section-head__title`
- [x] BUG-035: Greeting name fallback fixed — `tfAuth.currentUser()?.givenName || nalekoAuth.currentUser()?.givenName || 'there'` — `AuthService` (Naleko) injected as fallback
- [x] `::ng-deep` padding reset added for all p-card zone containers (`.p-card-body`, `.p-card-content` → `padding: 0`)
- [x] `CardModule` added to `dashboard-page.component.ts` imports
- [x] TalentFlow UI Design System Standards documented in this guide — reusable reference + compliance checklist for all future TalentFlow page/component work
- [x] No regression: build clean, `ng serve` hot-reload confirmed, pipeline data loads, navigation works

### Phase 9 — Admin Workspace Naleko Alignment + Drawer Consistency (2026-06-04)

**Branch:** `fix/it-provisioning-taskid-normalization` — frontend only, no Lambda or Terraform changes.

- [x] BUG-036: Audit KPI cards had `border-left: 4px solid currentColor` (coloured strips violating Rule 4) — removed
- [x] BUG-037: Workflow template cards missing `box-shadow`; stage-number badge used stale `var(--primary-50)` — fixed to naleko tokens
- [x] BUG-038: PrimeNG Aura emerald palette overriding all button colour overrides globally — fixed via `definePreset`
- [x] BUG-039: Multiple admin SCSS files using stale PrimeNG tokens (`var(--surface-ground)`, etc.) — swept and replaced
- [x] BUG-040: Add User form was a `p-dialog` modal — converted to `p-drawer` matching candidate-create experience
- [x] BUG-041: Edit Roles form was a `p-dialog` modal — converted to `p-drawer` matching candidate-create experience
- [x] BUG-042: Add User drawer used PrimeNG `pInputText` / `p-button` / `p-checkbox` — replaced with raw inputs and custom buttons matching candidate-create design language
- [x] BUG-043: Edit Roles drawer used PrimeNG `p-checkbox` role cards and `p-button` footer — converted to button-card pattern with `pi-check-circle`/`pi-circle` icons
- [x] BUG-044: Edit Approval Chains drawer used PrimeNG `p-button`, `p-checkbox`, `CommonModule` `*ngIf`/`*ngFor`, stale SCSS tokens — fully modernised
- [x] BUG-045: Queue Form Drawer (`queue-form-drawer`) used PrimeNG `ButtonModule`, `InputTextModule`, `Textarea`, `CommonModule` — fully modernised to naleko pattern, width `50vw`
- [x] BUG-046: Template Form Drawer (`template-form-drawer`) used PrimeNG `ButtonModule`, `InputTextModule`, `CheckboxModule`, `Textarea`, `CommonModule` — fully modernised, native checkbox + custom buttons
- [x] BUG-047: Six admin config pages (SLA, Scoring, Sentiment, Panel, Stage, Routing) had `max-width` constraint, stale `rgba()` borders, `p-button` footers, `CommonModule`/`ButtonModule`, legacy `*ngFor` in skeletons — swept and fixed
- [x] BUG-048: Sentiment Scales escalation path `p-select` dropdown clipped/unfocusable — root cause was missing `appendTo="body"` inside a card with `overflow: hidden`
- [x] BUG-049: `p-inputNumber` increment (`+`) button cropped on SLA Thresholds and Panel Rules pages — root cause was `overflow: hidden` on `.config-card`; fixed by removing overflow clip and adding `border-radius` to section-label header rows
- [x] BUG-050: Scoring Weights and Routing Rules SCSS used `--naleko-danger` (undefined token) instead of `--naleko-error` — replaced globally

---

### BUG-036 — Audit KPI cards had `border-left: 4px solid currentColor` (coloured strips)

| Field | Detail |
|---|---|
| **Severity** | Low — visual / Rule 4 violation |
| **Status** | ✅ Fixed — `admin-audit-page.component.scss` 2026-06-04 |
| **Affects** | Admin → Audit & Compliance KPI strip |
| **Rule violated** | Rule 4 — semantic colour in text/icons/borders only; never as a thick left stripe on a white card body |

**Symptom:** Each KPI card (Total Events, Critical, Failed, etc.) rendered a thick coloured left stripe via `border-left: 4px solid currentColor`. The colour was inherited from the card's text colour, producing garish stripes that violated the design language used everywhere else in the portal.

**Root cause:** The audit KPI cards were built with a quick `border-left` shortcut for urgency indication. While a left accent is valid in some contexts, `currentColor` is unpredictable across dark/light modes and colour schemes.

**Fix:** Removed `border-left: 4px solid currentColor` from `.tf-audit-kpi__card`. Cards already use `box-shadow: var(--naleko-shadow-card)` and coloured value text for semantic expression — no information is lost.

---

### BUG-037 — Workflow template cards missing shadow; stage-number badge used stale token

| Field | Detail |
|---|---|
| **Severity** | Low — visual polish |
| **Status** | ✅ Fixed — `workflow-templates-card.component.scss` 2026-06-04 |
| **Affects** | Admin → Tenant Settings → Workflow Templates |

**Symptom:** Workflow template cards had no `box-shadow`, making them visually flat compared to every other card in the portal. The stage-number badge used `background: var(--primary-50, #e3f2fd)` — a PrimeNG/Material blue fallback that rendered as light blue instead of indigo.

**Fix:**
- Added `box-shadow: var(--naleko-shadow-card)` to `.tf-wf__card`
- Stage-number badge `background` changed from `var(--primary-50, #e3f2fd)` → `color-mix(in srgb, var(--naleko-secondary) 10%, transparent)` (consistent with all other numbered badges in the admin workspace)

---

### BUG-038 — PrimeNG Aura emerald palette rendered all buttons teal regardless of CSS token overrides

| Field | Detail |
|---|---|
| **Severity** | High — platform-wide visual inconsistency |
| **Status** | ✅ Fixed — `app.config.ts` 2026-06-04 |
| **Affects** | Every `<p-button>` across the entire TalentFlow + Admin workspace |

**Symptom:** All PrimeNG buttons (Save, Cancel, Submit, Add Step, Apply Changes, etc.) rendered in teal/emerald green instead of the Naleko indigo (`--naleko-secondary` = `#4a3f8a`). This was visible across the admin workspace, user management drawers, workflow templates, and notifications pages.

**Root cause:** PrimeNG 19's Aura preset generates its CSS variable values **at runtime via JavaScript** using the `{emerald.*}` palette as the default primary. Any `:root` level CSS variable overrides (`--p-primary-color`, etc.) in `primeng-naleko.scss` are written to the stylesheet *before* Aura's runtime injection, so Aura's values win. There is no way to override PrimeNG's generated primary palette purely through CSS.

**Fix:** Used `definePreset` from `@primeuix/styled` in `app.config.ts` to replace Aura's primary palette before PrimeNG generates its CSS:

```typescript
import { definePreset } from '@primeuix/styled';

const NalekoPreset = definePreset(Aura, {
  semantic: {
    primary: {
      // Indigo scale matching --naleko-secondary = #4a3f8a (shade 600)
      50: '#f2f0ff', 100: '#e5deff', 200: '#c8bfff', 300: '#b7acff',
      400: '#8577cc', 500: '#6655b0', 600: '#4a3f8a',
      700: '#3a3070', 800: '#2a2256', 900: '#1a153c', 950: '#0d0a1e',
    },
    colorScheme: {
      light: {
        primary: {
          color: '{primary.600}',
          contrastColor: '#ffffff',
          hoverColor: '{primary.700}',
          activeColor: '{primary.800}',
        },
        highlight: {
          background: '{primary.50}',
          focusBackground: '{primary.100}',
          color: '{primary.600}',
          focusColor: '{primary.700}',
        },
      },
    },
  },
});

// In providers:
providePrimeNG({
  theme: {
    preset: NalekoPreset,
    options: { darkModeSelector: '.dark-mode' },
  },
})
```

Also removed the conflicting `--p-primary-color: var(--naleko-primary)` override from `primeng-naleko.scss` (was setting buttons to dark navy) and updated focus-ring and highlight tokens to reference `--naleko-secondary`.

**Lesson:** PrimeNG 19 theming requires `definePreset` at the TypeScript level. CSS-only overrides of `--p-primary-*` do not reliably win against Aura's runtime-injected stylesheet. Any palette change must go through `definePreset`.

---

### BUG-039 — Multiple admin SCSS files using stale PrimeNG tokens

| Field | Detail |
|---|---|
| **Severity** | Medium — visual inconsistency across admin workspace |
| **Status** | ✅ Fixed — 6 admin SCSS files updated 2026-06-04 |
| **Affects** | Admin audit event detail drawer, notifications page + drawers, branding card, template edit drawer, escalation edit drawer, approval chain drawer |

**Symptom:** Several admin workspace components had grey/off-colour backgrounds on certain sections because they used PrimeNG legacy tokens that no longer resolve correctly after the Naleko token migration:

| Token found | Replacement |
|---|---|
| `var(--surface-ground)` | `var(--naleko-surface-container-low)` |
| `var(--surface-hover)` | `var(--naleko-surface-container)` |
| `rgba(200, 197, 205, 0.2)` (hardcoded border) | `var(--naleko-outline-variant)` |
| `var(--primary-100, #e3f2fd)` | `color-mix(in srgb, var(--naleko-secondary) 10%, transparent)` |

**Files fixed:**
- `admin-audit-page.component.scss` — KPI card border-left removed (BUG-036)
- `event-detail-drawer.component.scss` — `__technical` block background
- `admin-notifications-page.component.scss` — footer note, golden rule card, group headers, table headers/hover, locked badges, template card body
- `template-edit-drawer.component.scss` — preview + vars-section backgrounds
- `escalation-edit-drawer.component.scss` — locked section background, locked badge
- `branding-card.component.scss` — logo preview background
- `approval-chain-drawer.component.scss` — all borders and backgrounds (full rewrite)

---

### BUG-040 & BUG-041 — Add User and Edit Roles forms were `p-dialog` modals instead of side drawers

| Field | Detail |
|---|---|
| **Severity** | Medium — UX inconsistency |
| **Status** | ✅ Fixed — both components rewritten 2026-06-04 |
| **Affects** | Admin → Users & Roles → Add User / Edit Roles actions |

**Symptom:** Clicking "Add User" and "Edit Roles" opened centred modal dialogs. Every other form in the TalentFlow platform (Create Candidate, candidate workspace panels, config drawers) uses a right-side `p-drawer`. The modals blocked the full page and felt inconsistent.

**Fix:** Both components converted from `<p-dialog>` to `<p-drawer position="right">`:
- Add User: `width: 50vw; minWidth: 560px`
- Edit Roles: `width: 50vw; minWidth: 480px`

`DialogModule` removed from both component `imports` arrays.

---

### BUG-042 — Add User drawer used PrimeNG form inputs and buttons (inconsistent with candidate-create)

| Field | Detail |
|---|---|
| **Severity** | Medium — design language inconsistency |
| **Status** | ✅ Fixed — `add-user-drawer.component.html/.scss/.ts` 2026-06-04 |
| **Affects** | Admin → Users & Roles → Add User drawer |

**Symptom:** After converting to `p-drawer` (BUG-040), the Add User drawer still used PrimeNG form elements:
- `<input pInputText>` — PrimeNG-styled inputs (rounded borders, PrimeNG focus ring in teal)
- `<p-button>` for Cancel and Submit — rendered teal until BUG-038 fix, then indigo but with PrimeNG padding/typography
- `<p-checkbox>` for role selection — did not match the role card pattern used in candidate workflows

**Fix:**
- Replaced `<input pInputText>` with raw `<input class="au-fld__input">` styled identically to `tf-fld__input` from the candidate-create form
- Labels: `font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase`
- Role selection: `<p-checkbox>` + `<label>` → `<button class="au-role-card">` with `pi-check-circle`/`pi-circle` icons
- Footer: `<p-button>` → `<button class="au__btn-cancel">` (outline) + `<button class="au__btn-submit">` (indigo gradient)
- Removed `ButtonModule`, `InputTextModule`, `CheckboxModule` from TS imports — `imports: [FormsModule, DrawerModule]` only

---

### BUG-043 — Edit Roles drawer used PrimeNG checkbox role cards and `p-button` footer

| Field | Detail |
|---|---|
| **Severity** | Medium — design language inconsistency |
| **Status** | ✅ Fixed — `edit-roles-drawer.component.html/.scss/.ts` 2026-06-04 |
| **Affects** | Admin → Users & Roles → Edit Roles drawer |

**Symptom:** The Edit Roles drawer (after BUG-041 drawer conversion) still rendered role selection as `<label>` + `<p-checkbox>` rows. Footer used `<p-button>`. Neither matched the button-card pattern established in the Add User drawer or candidate workflows.

**Fix:**
- Role cards: `<label>` + `<p-checkbox>` → `<button class="er-role-card">` with `pi-check-circle`/`pi-circle` check icons and `toggleRole()` on click
- Footer: `<p-button label="Cancel">` + `<p-button label="Save Roles">` → `<button class="er-btn-cancel">` + `<button class="er-btn-submit">` (gradient)
- Footer background updated to `var(--naleko-surface-container-low)` with `var(--naleko-outline-variant)` border
- Role card border: `1.5px solid rgba(200,197,205,0.25)` → `2px solid var(--naleko-outline-variant)` with secondary ring on selected state
- Removed `ButtonModule`, `CheckboxModule` from TS imports — `imports: [FormsModule, DrawerModule]` only

---

### BUG-044 — Edit Approval Chains drawer used PrimeNG buttons, checkbox, CommonModule, and stale SCSS tokens

| Field | Detail |
|---|---|
| **Severity** | Medium — design language inconsistency + stale code patterns |
| **Status** | ✅ Fixed — `approval-chain-drawer.component.html/.scss/.ts` + parent width 2026-06-04 |
| **Affects** | Admin → Tenant Settings → Default Approval Chains → Edit (pencil icon) |

**Symptom:** The Edit Approval Chains drawer used:
- `*ngIf` / `*ngFor` (Angular CommonModule legacy control flow — requires `CommonModule` import)
- `<p-button icon="pi pi-plus" label="Add Step">` for chain step buttons — teal/indigo depending on BUG-038 status
- `<p-checkbox>` for the "Required" toggle per approval step
- `<p-button label="Cancel">` + `<p-button label="Apply Changes">` in the footer
- `var(--surface-overlay)`, `rgba(200, 197, 205, 0.2)` — stale PrimeNG tokens throughout SCSS
- `var(--primary-100)` for the tier badge background
- Header had no icon box or Manrope display font — did not match Add User / Edit Roles header pattern
- Parent `p-drawer` width hardcoded to `480px`

**Fix:**

*TS:* Removed `CommonModule`, `ButtonModule`, `TagModule`, `CheckboxModule` from imports. Kept `FormsModule`, `TooltipModule`, `SelectModule`. `imports: [FormsModule, TooltipModule, SelectModule]` only.

*HTML:*
- `*ngIf` → `@if`; `*ngFor="let step of ...; let i = index"` → `@for (step of ...; track step.order; let i = $index)`
- Header rebuilt with icon box (`pi-share-alt` in secondary-tinted circle), Manrope `font-weight: 800` title, tier pill badge, subtitle
- `<p-button icon="pi pi-plus" label="Add Step">` → `<button class="acd-add-btn">` (indigo outline ghost button)
- `<p-checkbox>` Required toggle → native `<input type="checkbox" class="acd-checkbox">` with custom CSS checkmark
- Footer `<p-button>` → `<button class="acd-btn-cancel">` (outline) + `<button class="acd-btn-submit">` (gradient), identical to Add User / Edit Roles
- `p-select` (role dropdown) retained — complex enough to keep PrimeNG

*SCSS:* Full rewrite — all borders use `var(--naleko-outline-variant)`, `var(--surface-overlay)` → `var(--naleko-surface)`, tier badge uses `color-mix(in srgb, var(--naleko-secondary) 10%, transparent)`, delete button uses `var(--naleko-error)`, native checkbox uses `var(--naleko-secondary)` checked state, footer uses `var(--naleko-surface-container-low)` background

*Parent:* `[style]="{ width: '480px' }"` → `[style]="{ width: '50vw', minWidth: '520px' }"`

---

### BUG-045 — Queue Form Drawer used PrimeNG form inputs, buttons, and CommonModule

| Field | Detail |
|---|---|
| **Severity** | Medium — design language inconsistency |
| **Status** | ✅ Fixed — `queue-form-drawer.component.html/.scss/.ts` 2026-06-04 |
| **Affects** | Admin → IT Queues → New Queue / Edit Queue drawer |

**Symptom:** The Queue Form Drawer used `pInputText` on the name input, `pTextarea` on description, `<p-button>` for Cancel/Submit in the footer, and imported `CommonModule`, `ButtonModule`, `InputTextModule`, `Textarea`. Width was `480px`. Header was a plain `ng-template pTemplate="header"` with no icon or Manrope styling.

**Fix:**

*TS:* Removed `CommonModule`, `ButtonModule`, `InputTextModule`, `Textarea`. `imports: [FormsModule, DrawerModule, InputNumberModule, SelectModule, MultiSelectModule]`.

*HTML:* Converted to `ng-template pTemplate="content"` with full custom `<div class="qfd-drawer">` structure — icon header (`pi-server`), raw `<input class="qfd-fld__input">` for name, raw `<textarea>` for description, kept `p-select appendTo="body"` for category, `p-inputNumber` for SLA, `p-multiSelect appendTo="body"` for specialists, custom `qfd-btn-cancel` / `qfd-btn-submit` footer. Width: `50vw / minWidth: 520px`.

*SCSS:* Full naleko drawer styles — header icon box, body padding, naleko outline-variant borders, gradient submit button.

---

### BUG-046 — Template Form Drawer used PrimeNG form inputs, checkbox, and CommonModule

| Field | Detail |
|---|---|
| **Severity** | Medium — design language inconsistency |
| **Status** | ✅ Fixed — `template-form-drawer.component.html/.scss/.ts` 2026-06-04 |
| **Affects** | Admin → Provisioning Templates → New Template / Edit Template drawer |

**Symptom:** Template Form Drawer used `pInputText` on name/role inputs, `pTextarea`, `<p-checkbox [binary]>` for the Optional flag per requirement item, `<p-button>` for Add item and footer buttons. Imported `CommonModule`, `ButtonModule`, `InputTextModule`, `CheckboxModule`, `Textarea`. Width was `560px`.

**Fix:**

*TS:* Removed `CommonModule`, `ButtonModule`, `InputTextModule`, `CheckboxModule`, `Textarea`. `imports: [FormsModule, DrawerModule, SelectModule]`.

*HTML:* `ng-template pTemplate="content"` with full custom structure — icon header (`pi-list-check`), raw `<input>` fields, raw `<textarea>`, native `<input type="checkbox" class="tfd-checkbox">` for Optional toggle, `<button class="tfd-add-btn">` for Add item, `<button class="tfd-icon-btn--delete">` for trash, `tfd-btn-cancel` / `tfd-btn-submit` footer. Width: `50vw / minWidth: 560px`.

*SCSS:* Full naleko drawer styles matching the established pattern (icon box, outline-variant borders, gradient footer).

---

### BUG-047 — Six admin config pages had max-width, stale SCSS tokens, p-button footers, and CommonModule

| Field | Detail |
|---|---|
| **Severity** | High — visual inconsistency + broken functionality (`CommonModule` usage, stale tokens) |
| **Status** | ✅ Fixed — all 6 config page component trios 2026-06-04 |
| **Affects** | SLA Thresholds, Scoring Weights, Sentiment Scales, Panel Rules, Stage Config, Routing Rules |

**Symptom:** All six pages shared the same set of issues:
- `max-width: 860px` (or `1000px` for sentiment-scales) on `.config-page` — caused the "chopped off" appearance reported by user
- `rgba(200, 197, 205, 0.2)` and `rgba(200, 197, 205, 0.15)` stale PrimeNG border tokens throughout SCSS
- `p-button label="Reset to Defaults"` + `p-button label="Save Changes"` in footer — required `ButtonModule` import
- `CommonModule` imported for `*ngFor` in skeleton loading rows and (where applicable) pipes like `lowercase`, `titlecase`
- `*ngFor="let _ of [1,2,3]"` in skeleton divs — incompatible once `CommonModule` removed
- `pInputText` directive on inline inputs (sentiment-scales, routing-rules)
- `p-checkbox` in Panel Rules interview requirements matrix

**Fix per page:**

All pages: removed `max-width`, replaced `rgba()` tokens with `var(--naleko-outline-variant)`, removed `CommonModule` + `ButtonModule` from TS imports and decorator array, replaced `p-button` footer rows with custom `cfg-btn-reset` (outline) + `cfg-btn-save` (gradient) buttons, replaced `*ngFor` skeleton with `@for`.

Additional per-page:
- **Sentiment Scales**: added `LowerCasePipe` import (replaces `CommonModule` for `| lowercase` pipe)
- **Panel Rules**: added `TitleCasePipe` import (replaces `CommonModule` for `| titlecase` pipe); `p-checkbox` in IR matrix → native `<input type="checkbox" class="ir-matrix__checkbox">` with custom CSS
- **Routing Rules**: removed `InputTextModule`; removed `pInputText` directive from inline edit input; replaced all `p-button` elements (Add Rule header button, table row Save/Cancel/Edit/Delete) with custom `cfg-btn-save` and `cfg-icon-btn` elements

---

### BUG-048 — Sentiment Scales escalation path dropdown clipped and unfocusable

| Field | Detail |
|---|---|
| **Severity** | High — functional breakage, users could not change escalation path |
| **Status** | ✅ Fixed — `admin-sentiment-scales.component.html` 2026-06-04 |
| **Affects** | Admin → TalentFlow Config → Sentiment Scales → Escalation Path column |
| **Root cause** | Same pattern as all other clipped dropdowns — `overflow: hidden` on parent card |

**Symptom:** The Escalation Path `p-select` dropdown panel was either invisible or clipped to the card boundary. Clicking the dropdown opened a panel that was immediately cut off and couldn't be interacted with.

**Root cause:** `.config-card` had `overflow: hidden`. PrimeNG `p-select` renders its dropdown panel as a sibling overlay — it tries to position absolutely within the nearest scrolling ancestor. When the card has `overflow: hidden`, the panel is clipped. The `appendTo="body"` attribute was already present on every other `p-select` in the admin workspace but was missing from this one field.

**Fix:** Added `appendTo="body"` to the `p-select` for `escalationPath` in `admin-sentiment-scales.component.html`. This moves the dropdown overlay to `document.body`, outside the clipping parent.

---

### BUG-049 — p-inputNumber increment (+) button cropped on config pages

| Field | Detail |
|---|---|
| **Severity** | High — functional breakage, users could not increment values using the `+` button |
| **Status** | ✅ Fixed — 5 config page SCSS files 2026-06-04 |
| **Affects** | SLA Thresholds, Scoring Weights (if inputNumber present), Sentiment Scales, Panel Rules, Stage Config |
| **Root cause** | `overflow: hidden` on `.config-card` |

**Symptom:** The `+` (increment) button of `p-inputNumber` with `buttonLayout="horizontal"` was visually cut off at the right edge of the card. The button was not interactive because it was outside the visible and clippable area.

**Root cause:** Every `.config-card` had `overflow: hidden` set for border-radius visual consistency (to clip child backgrounds to rounded corners). The PrimeNG `p-inputNumber` component with horizontal buttons renders its increment button as a flex child that can extend to the very edge of its container. When `overflow: hidden` clips the card, the rightmost button is clipped.

**Fix:** Removed `overflow: hidden` from `.config-card` in all 5 SCSS files. Added `border-radius: var(--naleko-radius-xl) var(--naleko-radius-xl) 0 0` to any element that has its own background colour and appears at the top of a card (`.config-card__section-label`, `.sentiment-grid--header`, `.ir-matrix__row--header`). This preserves the rounded-corner appearance for header rows without requiring the parent to clip its children.

**Files changed:**
- `admin-sla-thresholds.component.scss`
- `admin-scoring-weights.component.scss`
- `admin-sentiment-scales.component.scss`
- `admin-panel-rules.component.scss`
- `admin-stage-config.component.scss`

---

### BUG-050 — Scoring Weights and Routing Rules SCSS used undefined `--naleko-danger` token

| Field | Detail |
|---|---|
| **Severity** | Low — visual (token resolves to nothing, colour disappears) |
| **Status** | ✅ Fixed — `admin-scoring-weights.component.scss`, `admin-routing-rules.component.scss` 2026-06-04 |
| **Affects** | Scoring Weights "Total invalid" state colour; Routing Rules duplicate-row left border colour |

**Symptom:** When scoring weights did not sum to 100%, the "Total" indicator was supposed to turn red. It rendered with no colour (token `--naleko-danger` is not defined in the naleko design system). Similarly, duplicate routing rule rows had no visible left-border indicator.

**Root cause:** The correct token is `--naleko-error`. The `--naleko-danger` token does not exist in the naleko token set and resolves to `unset`/transparent.

**Fix:** Replaced all occurrences of `var(--naleko-danger)` with `var(--naleko-error)` in both files. Also fixed `admin-routing-rules.component.scss` skeleton shimmer which used hardcoded `#f3f4f6`/`#e5e7eb` instead of naleko surface tokens.
