# Talent Flow Platform - Project Context

> **Purpose**: Living document capturing all architectural decisions, progress, and context
> **Last Updated**: 2026-05-15 (Metadata-Lite Architecture Alignment & MVP1 v2.0)
> **Status**: Ready for Execution - MVP1 v2.0 Finalized | All Critical Gaps Resolved

---

## 🔄 Current Session State (Resume Point)

**Session Date**: 2026-05-15

**Current Phase**: Pre-Execution — MVP1 v2.0 Architecture Finalized

**Status**: ✅ **READY TO EXECUTE**

**What's Ready**:
- MVP1-FOUNDATION-PLAN-v2.md: Production-ready (7 weeks, 280 hours, Metadata-Lite architecture)
- All 8 critical gaps from Opus analysis resolved
- Config management layer designed and spec'd
- Versioning strategy complete
- Admin UI scope defined (3 of 6 Variable Six in MVP1)
- Architecture documentation impact assessed
- Budget validated: $0/month (AWS Free Tier)

**Next Immediate Action**: T1.1 (Create AWS dev account)

**Blockers**: None

---

## 📋 Session Checkpoint: 2026-05-15 — Metadata-Lite Architecture Alignment

### Executive Summary

This session synthesized insights from **three AI models** (Claude Code, ChatGPT, Gemini) and **one AI reasoning system** (Opus) to finalize the architectural approach for TALENT_FLOW MVP1.

**Key Decision**: Adopt **Metadata-Lite architecture** — a strategic middle path between:
- ❌ **Hardcoded recruitment app** (fast to build but inflexible, requires rebuild for each vertical)
- ❌ **Universal metadata-driven platform** (maximally flexible but over-engineered for MVP, 18+ week timeline)
- ✅ **Metadata-Lite** (externalize the Variable Six, keep platform invariants in code, 7 weeks)

**Outcome**: MVP1-FOUNDATION-PLAN evolved from v1.0 (hardcoded, 6 weeks) → v2.0 (Metadata-Lite, 7 weeks)

**Investment**: +1 week (+40 hours effort)
**Return**: R1.06M saved on vertical 2 launch, foundation for AI config assistant (MVP4)

---

### The Strategic Context: Why This Matters

**Business Problem**: Initial architecture had hardcoded business rules (scoring weights, SLA thresholds, panel sizes, approval rules). Launching a second vertical (Banking, Agriculture, Healthcare) would require:
- Rewrite Lambda functions with different rules
- Redeploy entire stack
- Test everything again
- **Cost**: R1.06M in consulting fees per vertical

**The Question**: Should we build a full metadata-driven platform where everything is configurable (stages, workflows, data fields, rules)?

**Three-Model Synthesis** revealed the answer: **No.** Build Metadata-Lite instead.

---

### The Three-Model Synthesis: Universal Alignment

Three AI models (Claude Code, ChatGPT, Gemini) were asked independently: *"Should TalentFlow be a metadata-driven platform?"*

**Universal Alignment (All Three Models Agreed)**:

#### 1. **Core Architectural Principle**

> **ChatGPT**: "Business variability belongs in metadata. Platform invariants belong in code."
>
> **Claude**: "The workflow is now data, not code."
>
> **Gemini**: "The engine reads a map of how to hire, not hardcoded rules."

**Translation**: Lambda functions should be **generic interpreters** that read business rules from config, not hardcoded implementations.

#### 2. **The Variable Six** — Externalize These Day 1

All three models converged on **six categories** of business rules that vary across verticals/tenants:

| Variable | Why It Changes | Example |
|---|---|---|
| **1. Scoring Weights** | Departments value different skills | Tech: 35%, Comm: 25% (Software) vs Tech: 20%, Comm: 35% (Sales) |
| **2. SLA Thresholds** | Response time expectations differ | 48h first engagement (Standard) vs 24h (Priority candidates) |
| **3. Approval Rules** | Authority levels vary | Salary >$150K → C-level approval (Corporate) vs No approval (Startup) |
| **4. Panel Rules** | Interview panel composition | Min 3 panel members (Senior roles) vs 1 panel member (Junior roles) |
| **5. Notification Templates** | Brand voice, compliance language | Formal (Banking) vs Casual (Tech startup) |
| **6. Stage Enablement** | Not all verticals use all 12 stages | Agriculture skips Stage 9 (Background Checks), Banking requires it |

#### 3. **What Stays Hardcoded** — Platform Invariants

All three models agreed these should **remain in code** (not configurable):

- ✅ Orchestration engine (workflow state machine)
- ✅ Authentication & authorization (Cognito integration)
- ✅ Audit infrastructure (event ledger, compliance trail)
- ✅ EventBridge routing patterns
- ✅ DynamoDB access patterns
- ✅ Error handling (retries, DLQ, idempotency)

**Why?** These are **architectural decisions** that define the platform's reliability, security, and scalability. Making them configurable adds complexity without business value.

#### 4. **Versioning is CRITICAL** — Gemini's Warning

**Gemini's Scenario**:
```
Day 1: HR sets scoring weights to Tech 30%, Comm 25%, Cultural 25%, Problem 20%
Day 5: 50 candidates in Stage 2 (Interview Evaluation)
Day 6: HR changes weights to Tech 35%, Comm 20%, Cultural 25%, Problem 20%
```

**Without versioning**:
- All 50 candidates get **RECALCULATED** with new weights
- Candidate A interviewed on Day 3 with 30% tech weight → suddenly scored with 35% tech weight
- Audit trail broken
- Compliance violation

**With versioning**:
- In-flight candidates stay locked to `configVersion: 1` (weights they started with)
- New candidates (Day 6+) use `configVersion: 2` (new weights)
- Audit trail intact

**ChatGPT, Claude, Gemini all agreed**: Versioning is **non-negotiable** for audit compliance.

#### 5. **Phased Evolution** — 4-Phase Roadmap

All three models recommended the same evolution path:

| Phase | Scope | Timeline | Key Capability |
|---|---|---|---|
| **MVP1** | Variable Six externalized | 7 weeks | Launch 2nd vertical in 1-2 days (vs rebuild) |
| **MVP2** | Vertical expansion proof | +4 weeks | Banking + Agriculture live, zero code changes |
| **MVP3** | Multi-tenancy | +6 weeks | SaaS-ready, tenant isolation, usage-based pricing |
| **MVP4** | AI Config Assistant | +4 weeks | "Change SLA to 24h" → deployed in 30 seconds |

**Why phased?**
- Prove metadata-lite works (MVP1) before expanding
- Validate ROI with real verticals (MVP2) before multi-tenancy investment
- AI assistant only valuable once config management proven

---

### Key Divergences: Where Models Disagreed

**ChatGPT**: "Build admin UI for all 6 Variable Six in MVP1" (12 weeks total)

**Claude**: "Build admin UI for 3 Variable Six in MVP1, defer 3 to MVP2" (7 weeks total)

**Gemini**: "Use seed data for all 6 in MVP1, build admin UI in MVP2" (5 weeks total)

**Resolution**: **Claude's middle path** chosen (7 weeks):
- ✅ MVP1: Admin UI for Scoring, SLA, Panel Rules (3 of 6) — proves config pattern
- ⏳ MVP2: Admin UI for Approval Rules, Notifications, Stage Enablement (3 of 6)
- **Rationale**: Proves metadata-lite thesis without overloading MVP1 timeline

---

### The Golden Path: Metadata-Lite Architecture

**What It Is**:
- **Externalize** the Variable Six (business rules that change per vertical/tenant)
- **Hardcode** platform invariants (orchestration, auth, audit, error handling)
- **Version** all config (in-flight candidates stay on version they started with)
- **Phase** admin UI (3 of 6 in MVP1, full UI in MVP2)

**What It's NOT**:
- ❌ Not a hardcoded app (rules are data, not code)
- ❌ Not a universal platform (we don't externalize stage definitions, workflow structure, data schema)
- ❌ Not over-engineered (admin UI built incrementally, not all at once)

**Example: Vote Processor Lambda**

**v1.0 (Hardcoded)**:
```javascript
const overall = technical * 0.35 + communication * 0.25 +
                culturalFit * 0.20 + problemSolving * 0.20;
```

**v2.0 (Metadata-Lite)**:
```javascript
const config = await getConfig(tenantId, 'SCORING_WEIGHTS', candidate.configVersion);
const overall = technical * config.technical +
                communication * config.communication +
                culturalFit * config.culturalFit +
                problemSolving * config.problemSolving;
```

**Impact**:
- Banking tenant: Tech 20%, Comm 35% (relationship-focused)
- Software tenant: Tech 35%, Comm 20% (technical-focused)
- **Zero code changes**, just config data

---

### Critical Technical Decisions

#### Decision 1: Config Table Schema

**DynamoDB Table**: `talent-flow-config`

**Schema**:
```
PK: TENANT#{tenantId}
SK: CONFIG#{configType}#v{version}

GSI1PK: TENANT#{tenantId}#ACTIVE
GSI1SK: CONFIG#{configType}

Attributes:
- configType: "SCORING_WEIGHTS" | "SLA_THRESHOLDS" | "PANEL_RULES" | "APPROVAL_RULES" | "NOTIFICATION_TEMPLATES" | "STAGE_ENABLEMENT"
- version: Integer (incremental: 1, 2, 3...)
- isActive: Boolean (only 1 version active per configType)
- data: JSON object (config payload)
- createdBy: String (user ID or "SYSTEM")
- createdAt: ISO timestamp
- previousVersion: Integer (null for v1)
- expiresAt: TTL timestamp (365 days after isActive = false)
```

**Access Patterns**:
1. Get active config by type: Query GSI1 (PK=TENANT#{tenantId}#ACTIVE, SK=CONFIG#{configType})
2. Get specific version: GetItem (PK=TENANT#{tenantId}, SK=CONFIG#{configType}#v{version})
3. Get audit trail: Query (PK=TENANT#{tenantId}, SK begins_with CONFIG#{configType})

**TTL Strategy**: Inactive config versions auto-deleted after 365 days (keeps audit trail for compliance year, then cleans up)

---

#### Decision 2: Config Versioning Strategy

**The Rule**: "New candidates use latest config. In-flight candidates stay on version they started with."

**Implementation**:

1. **Workflow Creation** (workflow-orchestrator Lambda):
```javascript
// When candidate created, snapshot current config version
const activeConfig = await getActiveConfig(tenantId, 'SCORING_WEIGHTS');
await dynamodb.put({
  PK: `WORKFLOW#{workflowId}`,
  SK: 'METADATA',
  configVersion: activeConfig.version, // Lock to v3
  createdAt: new Date().toISOString()
});
```

2. **Vote Processing** (vote-processor Lambda):
```javascript
// Read workflow to get locked config version
const workflow = await dynamodb.get({ PK: `WORKFLOW#{workflowId}`, SK: 'METADATA' });
const config = await getConfig(tenantId, 'SCORING_WEIGHTS', workflow.configVersion); // Uses v3
const overall = technical * config.technical + ...;
```

3. **Config Update** (config-manager Lambda):
```javascript
// When HR changes config
// 1. Mark old version inactive
await dynamodb.update({
  PK: `TENANT#{tenantId}`,
  SK: `CONFIG#SCORING_WEIGHTS#v3`,
  isActive: false,
  expiresAt: Date.now() + (365 * 24 * 60 * 60) // 365 days from now
});

// 2. Create new version
await dynamodb.put({
  PK: `TENANT#{tenantId}`,
  SK: `CONFIG#SCORING_WEIGHTS#v4`,
  version: 4,
  isActive: true,
  data: { technical: 0.25, communication: 0.25, culturalFit: 0.30, problemSolving: 0.20 },
  createdBy: userId,
  createdAt: new Date().toISOString(),
  previousVersion: 3
});
```

**What This Prevents**:
- ✅ Data corruption (in-flight candidates unaffected by config changes)
- ✅ Compliance violations (audit trail shows exact rules used for each candidate)
- ✅ Inconsistent scoring (all candidates in same cohort use same weights)
- ✅ Retroactive changes (can't change rules after decisions made)

---

#### Decision 3: The Variable Six Defaults (Seed Data)

**Tenant**: `DEFAULT` (used for POC, can be overridden per tenant in MVP3)

| Config Type | Default Values | MVP1 Admin UI? |
|---|---|---|
| **SCORING_WEIGHTS** | Tech: 30%, Comm: 25%, Cultural: 25%, Problem: 20% | ✅ Yes (T3.8-T3.10) |
| **SLA_THRESHOLDS** | First Engagement: 48h, Evaluation: 72h, Offer Gen: 24h, Offer Accept: 7d | ✅ Yes (T3.11-T3.13) |
| **PANEL_RULES** | Min: 1, Max: 5, vetoPowerEnabled: true (any STRONG_NO → reject) | ✅ Yes (T3.14-T3.16) |
| **APPROVAL_RULES** | Salary >$150K → manager approval, >$200K → C-level approval | ⏳ MVP2 (seed data only in MVP1) |
| **NOTIFICATION_TEMPLATES** | INTERVIEW_SCHEDULED, VOTE_REMINDER, SLA_BREACH, OFFER_EXTENDED | ⏳ MVP2 (seed data only in MVP1) |
| **STAGE_ENABLEMENT** | All 12 stages enabled for POC | ⏳ MVP2 (seed data only in MVP1) |

**Why 3 of 6 in MVP1?**
- **Scoring, SLA, Panel Rules**: Core to demo (Scene 5b shows live config change)
- **Approval, Notifications, Stage Enablement**: Less visible in demo, can use seed data initially
- **Timeline**: 3 UI components = 16h effort (keeps MVP1 at 7 weeks)

---

#### Decision 4: SLA Monitor Reads Active Config (Not Versioned)

**Design Decision**: SLA Monitor Lambda reads **active** SLA config, not versioned config per candidate.

**Rationale**:
- SLA policy is a **current operational standard**, not a candidate-specific contract
- If HR changes "First Engagement SLA" from 48h to 24h on Day 5, **all candidates** (including in-flight) are now subject to 24h SLA
- This reflects business reality: SLA changes apply immediately to current workload

**Code**:
```javascript
// sla-monitor.js
const slaConfig = await getActiveConfig(tenantId, 'SLA_THRESHOLDS'); // Always reads active
const firstEngagementThreshold = slaConfig.FIRST_ENGAGEMENT || 48; // Fallback to 48h default
```

**Contrast with Scoring Weights**: Scoring weights are **candidate-specific** (fairness requires same weights throughout evaluation), SLA thresholds are **operational policy** (applies to all current work).

---

#### Decision 5: Which Variable Six Get Admin UI in MVP1?

**MVP1 (T3.8-T3.16, M3 Week 4-5)**: 3 of 6 with Admin UI
- ✅ Scoring Weights UI
- ✅ SLA Thresholds UI
- ✅ Panel Rules UI

**MVP2 (deferred)**: Remaining 3 with Admin UI
- ⏳ Approval Rules UI
- ⏳ Notification Templates UI
- ⏳ Stage Enablement UI

**How MVP1 Uses the Remaining 3**:
- Lambdas **read** from config table (config-driven, not hardcoded)
- Config values set via **seed data** (Terraform script populates defaults)
- Admin UI built in MVP2 (proves config pattern first, expand UI later)

**Rationale**:
- **Proves metadata-lite** without overloading MVP1
- **Demo-ready**: Scene 5b shows live config change (scoring weights)
- **Timeline**: Keeps MVP1 at 7 weeks (vs 9 weeks with all 6 UI components)
- **Risk mitigation**: Validate config pattern with 3, expand when proven

---

### MVP1 Evolution: v1.0 → v2.0

| Aspect | v1.0 (Hardcoded) | v2.0 (Metadata-Lite) |
|---|---|---|
| **Scoring Weights** | Hardcoded in vote-processor Lambda | Read from config table, versioned per candidate |
| **SLA Thresholds** | Hardcoded in sla-monitor Lambda | Read from config table, active version |
| **Panel Rules** | Hardcoded (`votesRequired: 2`) | Read from config table, min/max/veto configurable |
| **STRONG_NO Veto** | Missing (majority voting only) | Implemented with configurable toggle |
| **DynamoDB Tables** | 3 tables (state, event-ledger, workflow-state) | 4 tables (+talent-flow-config) |
| **Lambdas** | 7 Lambdas (hardcoded logic) | 8 Lambdas (+config-manager), all read config |
| **Admin UI** | None | 3 config pages (scoring, SLA, panel rules) |
| **Shared Utilities** | None | config-reader.js (5-min cache, version support) |
| **Timeline** | 6 weeks (240h) | 7 weeks (280h) |
| **M1 Effort** | 80h | 96h (+16h for config table, config-reader, tests) |
| **M3 Effort** | 80h | 104h (+24h for admin UI, Lambda updates) |
| **Config Versioning** | No versioning | Full versioning (in-flight candidates locked to version) |
| **Vertical Expansion** | Rebuild Lambdas (2-3 weeks) | Change config (1-2 days) |
| **Cost (Rebuild Vertical 2)** | R1.06M (consulting + testing) | R0 (config changes only) |

---

### Opus Gap Analysis: 8 Critical Gaps Identified & Resolved

**Context**: After three-model synthesis, Claude Code generated a modification prompt to update MVP1-FOUNDATION-PLAN from v1.0 → v2.0. Opus (AI reasoning system) performed deep analysis and found 8 gaps in the prompt.

**All 8 Gaps Resolved in v2.0**:

#### ✅ Gap #1: Versioning (CRITICAL — Was Missing, Now COMPLETE)

**Opus Warning**: "Without versioning, changing config mid-evaluation breaks audit compliance."

**v2.0 Fix**:
- Lines 100-148: Complete versioning strategy section
- T1.10 (Line 218-220): workflow-orchestrator snapshots `configVersion` at creation
- T3.30 (Lines 481-486): Integration test verifies in-flight candidates unaffected by config changes

#### ✅ Gap #2: Only 3 of 6 Variable Six UI (Was Ambiguous, Now EXPLICIT)

**Opus Warning**: "Is this intentional deferral or oversight?"

**v2.0 Fix**:
- Line 96: Explicit statement — "3 of 6 in MVP1 (scoring, SLA, panel), 3 deferred to MVP2 (approval, notifications, stage enablement)"
- Line 435: Repeats with justification (prove config pattern, keep 7 weeks)
- Lines 1163-1166: MVP2 section shows deferred UI components

#### ✅ Gap #3: Effort Math (Was Wrong, Now CORRECTED)

**Opus Warning**: "M3 effort doesn't add up — says +16h but lists +24h of tasks."

**v2.0 Fix**:
- M1: 96h (was 80h, +16h for config table setup)
- M3: 104h (was 80h, +24h for admin UI + Lambda updates)
- Total: 280h = 7 weeks (math correct)

#### ✅ Gap #4: SLA Monitor Not Config-Driven (Was Hardcoded, Now FIXED)

**Opus Warning**: "Prompt updates vote-processor but forgets sla-monitor."

**v2.0 Fix**:
- Lines 520-539 (T4.1): sla-monitor reads SLA thresholds from config table
- Line 532: Design decision documented (SLA monitor reads active config, not versioned)

#### ✅ Gap #5: Config Table Schema Undefined (Was Missing, Now COMPLETE)

**Opus Warning**: "Can't build Terraform without PK/SK pattern."

**v2.0 Fix**:
- Lines 199-203: Complete schema (PK/SK, GSI, attributes, TTL strategy)

#### ✅ Gap #6: Task Renumbering Cascade (Was Incomplete, Now COMPLETE)

**Opus Warning**: "Adding T1.14-T1.18 and T3.8-T3.14 breaks cross-references."

**v2.0 Fix**:
- Lines 573-622: Dependency graph updated
- Lines 1383-1472: Day-by-day schedule rebuilt
- Lines 1029-1084: File modification plan includes all new files

#### ✅ Gap #7: Admin Role Not Set Up (Was Missing, Now COMPLETE)

**Opus Warning**: "AdminGuard won't work without admin role in Cognito."

**v2.0 Fix**:
- T1.3 (Line 191): Create Cognito groups (Users + Admins)
- T1.16 (Lines 245-248): Create admin test user (hr-director@testcompany.com)
- T1.20 (Line 256): Auth service exposes `isAdmin()` method
- T3.8 (Line 395): AdminGuard protects config routes

#### ✅ Gap #8: Line Number References (Were Fragile, Now REMOVED)

**Opus Warning**: "Line numbers change when document regenerated."

**v2.0 Fix**:
- All line number references removed
- Uses section headings and find/replace anchors only

---

### Architecture Documentation Impact Assessment

**Question**: "With Metadata-Lite changes, do other architecture docs need updating?"

**Analysis**:

#### 🔴 DYNAMODB_SCHEMA_DESIGN.md — CRITICAL (Before T1.1)

**Missing**:
- `talent-flow-config` table schema
- Access patterns for config reads
- Cost update ($6.50/month vs $5.63/month with 2 tables)

**Impact**: Can't build config table without this schema.

**Action**: Update before T1.5 (Deploy DynamoDB Tables).

---

#### 🔴 LAMBDA_CATALOG.md — CRITICAL (Before M1 backend)

**Missing**:
- config-manager Lambda spec
- Updated vote-processor (reads config)
- Updated sla-monitor (reads config)
- Updated notification-service (reads templates)
- config-reader.js utility
- IAM permissions (all Lambdas need dynamodb:Query on config table)

**Impact**: Developers will code to wrong spec.

**Action**: Update before T1.14 (Build config-manager).

---

#### 🟡 TERRAFORM_MODULE_STRUCTURE.md — MEDIUM (Helpful but not blocking)

**Missing**:
- Config table deployment example
- IAM policy for dual-table access

**Impact**: Examples would help, but MVP1 plan has enough detail.

**Action**: Optional — update for completeness.

---

#### 🟢 STEP_FUNCTIONS_ORCHESTRATION.md — LOW (MVP2 doc)

**Missing**:
- Note that approval thresholds will be config-driven (MVP2)

**Impact**: None (Step Functions are MVP2).

**Action**: Defer to MVP2 kickoff.

---

### MVP1 v2.0 Execution Readiness

**Document**: MVP1-FOUNDATION-PLAN-v2.md

**Status**: ✅ **Production-Ready**

**Key Metrics**:
- **Timeline**: 7 weeks (4 milestones)
- **Effort**: 280 hours (~150 tasks)
- **Budget**: $0/month (AWS Free Tier)
- **Team**: Solo developer + Claude AI assistance
- **Demo**: 24 minutes (8 scenes)
- **Critical Path**: T1.1 → T1.8 → T1.14 → T2.1 → T3.2 → T4.1

**Milestones**:
- **M1 (Week 1-2, 96h)**: Foundational vertical slice + authentication + config management
- **M2 (Week 3, 40h)**: Interview scheduling workflow
- **M3 (Week 4-5, 104h)**: Evaluation submission + aggregation + admin UI for config management
- **M4 (Week 6, 40h)**: Polish, hardening, SLA monitoring

**Demo Script Highlight** (Scene 5b — The Killer Moment):
```
Scene 5b: Live Configuration Change (6 minutes)

1. HR Director logs into Admin UI (authenticated, role: admin)
2. Navigates to "Configuration > Scoring Weights"
3. Current weights displayed: Tech 30%, Comm 25%, Cultural 25%, Problem 20%
4. Changes weights to: Tech 25%, Comm 25%, Cultural 30%, Problem 20%
5. Saves → System creates configVersion: 4, marks v3 inactive
6. Business Analyst creates new candidate (John Doe, Software Engineer)
7. Compare scores:
   - Sarah Chen (created before change, locked to v3): 7.375
   - John Doe (created after change, using v4): 7.05
8. Prove: Sarah's score unchanged (versioning works), John uses new weights

**Why This Matters**:
- Proves Metadata-Lite thesis (change config, no code deploy)
- Proves versioning (in-flight candidates unaffected)
- Proves audit compliance (two candidates, two versions, both correct)
```

**Cost Analysis**:
- **MVP1 Investment**: +1 week (+R60K labor at R15K/week)
- **MVP2 Savings**: R1.06M (no Lambda rebuild, just config changes)
- **ROI**: 17.6x return on investment
- **Payback**: Vertical 2 launch (3 months)

**Vertical Expansion Examples** (MVP2):
- **Agriculture**: 1-2 days, zero code changes (adjust weights: Technical 20% → 15%, Problem Solving 20% → 25%)
- **Banking**: 2-3 days, zero code changes (SLA tightening: 48h → 24h first engagement, background checks mandatory)

**MVP4 AI Config Assistant** (Evolution Path):
```
User: "Change SLA to 24 hours for first engagement"
AI: Proposes config change (FIRST_ENGAGEMENT: 48h → 24h)
Human: Approves
System: Deploys new configVersion in 30 seconds
```

**Success Metric**: "Prompts not clicks" — Config changes via natural language, deployed in <1 minute.

---

### Current Execution State: What's Next

**Immediate Next Steps**:

1. ✅ **Execute T1.1**: Create AWS dev account (2 hours)
2. ✅ **Update PROJECT_CONTEXT.md**: This checkpoint added
3. ⏳ **Optional**: Update DYNAMODB_SCHEMA_DESIGN.md + LAMBDA_CATALOG.md (before T1.5)

**Starting Tomorrow**: T1.1 (AWS Account Setup)

**Blockers**: None

**Confidence Level**: **HIGH** — All gaps resolved, architecture proven, timeline realistic, budget validated.

---

### Key Takeaways for Context Recovery

If resuming this project after a break, remember these critical points:

1. **Metadata-Lite, Not Hardcoded, Not Universal** — We externalized the Variable Six (scoring, SLA, panel rules, approval rules, notifications, stage enablement), but keep platform invariants in code.

2. **Versioning is Non-Negotiable** — In-flight candidates stay locked to config version they started with. Prevents data corruption, ensures audit compliance.

3. **3 of 6 Admin UI in MVP1** — Scoring, SLA, Panel Rules get UI. Approval, Notifications, Stage Enablement use seed data (UI deferred to MVP2).

4. **7 Weeks, Not 6** — +1 week investment saves R1.06M on vertical 2 launch.

5. **Config Table Schema** — PK: TENANT#{tenantId}, SK: CONFIG#{configType}#v{version}, GSI for active config queries, TTL after 365 days.

6. **All Lambdas Read Config** — vote-processor (scoring), sla-monitor (SLA thresholds), notification-service (templates), interview-scheduler (panel rules), workflow-orchestrator (captures version).

7. **Shared Config Reader** — config-reader.js with 5-min cache, version support, fallback to defaults.

8. **Demo Scene 5b is the Proof** — Live config change, compare two candidates (one before, one after), prove versioning works.

9. **MVP1 v2.0 is Production-Ready** — All gaps resolved, timeline realistic, budget validated ($0/month), start T1.1 tomorrow.

10. **Architecture Docs Need Updating** — DYNAMODB_SCHEMA_DESIGN.md and LAMBDA_CATALOG.md must be updated before M1 backend work (T1.5, T1.14).

---

## 🔄 Previous Session Checkpoint: 2026-05-13 (Architecture Documents Deep Dive)

**Session Date**: 2026-05-13

### ✅ What We've Completed This Session

1. **Read PROJECT_CONTEXT.md** for session context recovery
2. **Read 4 Priority Architecture Documents**:
   - ✅ TALENT_FLOW_POC_ARCHITECTURE.md (1,589 lines) - Complete POC specs for 7 Lambdas, 3 DynamoDB tables, EventBridge, Step Functions, API Gateway
   - ✅ TALENT_FLOW_MATURITY_LEVELS.md (685 lines) - 4-level evolution roadmap (POC → Prod → AI → Enterprise)
   - ✅ INCREMENTAL_DELIVERY_ROADMAP.md (729 lines) - 12-week execution plan with week-by-week tasks
   - ✅ HADES_TO_SERVERLESS_MAPPING.md (823 lines) - Pattern translation from HADES enterprise to serverless POC

3. **Updated PROJECT_CONTEXT.md** with comprehensive technical context:
   - HADES to Serverless pattern mapping (10 core patterns)
   - Detailed POC Architecture section (7 Lambda specs, 3 DynamoDB schemas, EventBridge rules)
   - Maturity Evolution Path (4 levels with costs, triggers, technology changes)
   - 12-Week Roadmap with concrete Week 1 execution plan
   - Risk mitigation strategies
   - Total added: ~15,000 words of detailed technical specifications

### 🎯 Critical Gaps Identified (CONFIRMED)

**Alignment Validation Required**: The 12 architecture documents were created independently of BRD and UX/UI context. Reading LAMBDA_CATALOG.md has CONFIRMED critical misalignments with business requirements.

**CRITICAL GAPS (Must Fix Before Implementation)**:
1. ✅ **CONFIRMED**: Vote Processor scoring weights mismatch
   - BRD: Tech 30%, Comm 25%, Cultural 25%, Problem 20%
   - Lambda (Lines 677-683): Tech **35%**, Comm 25%, Cultural **20%**, Problem 20%
   - **Impact**: Cultural fit underweighted by 5%, technical overweighted by 5%

2. ✅ **CONFIRMED**: Missing STRONG_NO single-veto logic
   - BRD Business Rule BR-006: "Any STRONG_NO → Auto-reject (no debate)"
   - Lambda (Lines 690-701): Uses majority voting (strongNo + no >= 50%)
   - **Impact**: Single STRONG_NO can be overridden by other votes (violates business rule)

3. ✅ **CONFIRMED**: Panel size hardcoded to 2 voters
   - BRD: Min 1 panel member, size should be configurable per department/position
   - Lambda: `votesRequired: 2` hardcoded in Interview Scheduler (Line 615) and API responses (Line 211)
   - **Impact**: Cannot support flexible panel sizes for different roles/departments

**HIGH PRIORITY GAPS**:
4. ⚠️ **NEW**: SLA Monitor covers only 4 of 10 BRD SLAs
   - Lambda defines: FIRST_ENGAGEMENT (48h), EVALUATION_COMPLETION (72h), OFFER_GENERATION (24h), OFFER_ACCEPTANCE (7d)
   - BRD defines: 10 detailed SLAs across all 12 stages
   - **Impact**: 6 SLAs not monitored (no breach detection for stages 4-5, 9-12)

**Source**: Gaps identified from DYNAMODB_SCHEMA_DESIGN.md, EVENTBRIDGE_PATTERNS.md, and LAMBDA_CATALOG.md cross-validation with BRD Business Rules.

### ✅ Reading Architecture Documents (COMPLETE)

**Objective**: Read the remaining 8 architecture documents to get complete technical context before performing comprehensive BRD/UX/UI alignment validation.

**Progress**: 8/8 documents read ✅ **COMPLETE**

#### ✅ Document 1: DYNAMODB_SCHEMA_DESIGN.md (COMPLETE)
**Read**: 2026-05-13 | **Lines**: 1,010

**Key Context Gained**:
- **3 Tables with Single-Table Design**:
  - `candidate-pipeline` (operational state) - 3 GSIs: Department-Stage, Stage-Sentiment, Status-CreatedAt
  - `event-ledger` (audit trail) - 1 GSI: EventType-Timestamp, dual-partition for candidate + correlation queries
  - `workflow-state` (saga tracking) - 2 GSIs: CandidateId-Index, SLA-Index

- **Detailed Schema Patterns**:
  - Candidate: PK=CANDIDATE#{id}, SK variants: METADATA, INTERVIEW#1/2, VOTE#INT1#{voterId}, SCORES#INT1/2, OFFER#{id}
  - Vote record structure: technicalScore, communicationScore, culturalFitScore, problemSolvingScore, recommendation (STRONG_YES example shown)
  - Workflow: PK=WORKFLOW#{id}, SK variants: SAGA, STAGE#{name}, TRACKER#{stage}#{domain}

- **Stage Completion Algorithm**: Feedback aggregator checks all TRACKER records, marks STAGE complete only when all trackers = COMPLETED

- **Cost Validation**: $5.63/month estimated (matches POC cost breakdown) ✅

- **Query Examples**: Complete patterns for all 6 access patterns (get candidate, list by dept/stage, find HESITANT offers, SLA breach detection, audit trail)

**Alignment Insights for Validation**:
- ✅ Vote schema includes "recommendation" field (supports STRONG_YES/STRONG_NO logic)
- ⚠️ Example code shows `requiredVotes = 3` (hardcoded) - confirms mismatch with BRD (min 1 panel member, should be configurable)
- ⚠️ SCORES calculation shown but weighting formula not detailed in schema doc - need to verify against BRD weights in Lambda implementation
- ✅ Stage-Sentiment-Index GSI supports BRD requirement for HESITANT/RELUCTANT escalation queries
- ✅ SLA-Index GSI supports SLA Monitor Lambda for breach detection

**Potential Gaps Identified**:
- Schema supports BRD data requirements well ✅
- Vote counting logic needs to be flexible (not hardcoded to 3 votes)
- Need to verify SCORES calculation weights match BRD (Tech 30%, Comm 25%, Cultural 25%, Problem 20%)

---

---

#### ✅ Document 2: EVENTBRIDGE_PATTERNS.md (COMPLETE)
**Read**: 2026-05-13 | **Lines**: 961

**Key Context Gained**:
- **11 Event Types for Stage 1-3**:
  - CandidateCreated, CandidateUpdated, InterviewScheduled, InterviewConducted, VoteSubmitted, VotingCompleted, EvaluationCompleted, WorkflowStageStarted, WorkflowStageCompleted, FeedbackReceived, SLABreached
  - Total: ~870k events/month (within 1M free tier = $0/month)

- **6 EventBridge Rules**:
  1. candidate-created-to-orchestrator
  2. interview-scheduled-to-scheduler
  3. vote-submitted-to-processor
  4. voting-completed-to-completer
  5. all-events-to-audit-ledger (catch-all for compliance)
  6. notifications (multi-event subscription)

- **Detailed Event Schemas**:
  - VoteSubmitted: includes `recommendation` field (STRONG_YES example shown) ✅
  - VotingCompleted: includes `scores` object with technical, communication, culturalFit, problemSolving, overall
  - SLABreached: includes `escalationLevel` (MANAGER, HR, LEADERSHIP) with content-based routing
  - WorkflowStageStarted: includes `trackers[]` array with per-domain SLAs

- **Content-Based Routing Patterns**:
  - SLA escalation routing by `escalationLevel` → Different SNS topics for MANAGER/HR/LEADERSHIP
  - Sentiment-based routing: HESITANT offers → Lambda (create-hr-intervention-task)
  - No routing logic in code - all declarative in EventBridge rules

- **Integration Patterns**:
  - EventBridge → Lambda (most common, async processing)
  - EventBridge → SQS → Lambda (buffering, high-volume)
  - EventBridge → Step Functions (workflow resumption with task tokens)

- **Error Handling**:
  - Retry policy: 3 attempts, exponential backoff (1s, 2s, 4s)
  - Dead Letter Queue (SQS) with CloudWatch alarm (alerts on ANY message)
  - Idempotency pattern using correlationId + DynamoDB check before processing

- **Testing Strategy**:
  - Local: EventBridge Local (npm package)
  - Integration: Testcontainers with LocalStack
  - E2E: Cypress + LocalStack

**Alignment Insights for Validation**:
- ✅ VoteSubmitted event schema includes `recommendation` field → Supports STRONG_YES/STRONG_NO logic from BRD
- ✅ SLABreached event with `escalationLevel` (MANAGER/HR/LEADERSHIP) → Matches BRD SLA Framework escalation paths
- ✅ Content-based routing for HESITANT sentiment → Matches BRD Stage 8 requirement: "HESITANT → Reassurance Engagement task generated + HR alert"
- ✅ WorkflowStageStarted event includes `trackers[]` with per-domain SLAs → Supports BRD's detailed SLA framework (10 SLAs defined)
- ⚠️ Event catalog shows "6k votes/day (3 votes × 2 interviews)" → Again assumes 3 votes per interview (confirms panel size mismatch)

**Potential Gaps Identified**:
- EventBridge routing supports BRD escalation requirements well ✅
- Sentiment-based routing pattern ready for Stage 8 implementation ✅
- Vote counting assumption (3 votes) is consistent across architecture but misaligned with BRD (min 1 panel member)

**Cost Validation**: $0/month for POC (870k events << 1M free tier) ✅

---

#### ✅ Document 3: LAMBDA_CATALOG.md (COMPLETE)
**Read**: 2026-05-13 | **Lines**: 1,126

**Key Context Gained**:
- **7 Lambda Functions with Complete Specifications**:
  1. **API Handler** (`talent-flow-api-handler`) - 512MB, 10s timeout, arm64
     - REST endpoints: POST /candidate, POST /interview, POST /vote, GET /candidate/{id}
     - Validates input, publishes events to EventBridge, returns synchronous responses
     - IAM: events:PutEvents, dynamodb:GetItem/Query
     - Runtime: nodejs20.x, CORS-enabled, structured JSON logging

  2. **Workflow Orchestrator** (`talent-flow-workflow-orchestrator`) - 512MB, 30s timeout
     - Manages workflow state transitions, initiates stages, tracks progress
     - Subscribes to: CandidateCreated, EvaluationCompleted
     - Creates workflow records, initializes 12-stage tracking, publishes WorkflowStageStarted events
     - Implements saga pattern for distributed transaction management

  3. **Interview Scheduler** (`talent-flow-interview-scheduler`) - 256MB, 15s timeout
     - Processes InterviewScheduled events, sends calendar invites via SQS → Notification Service
     - Writes interview records to DynamoDB with `votesRequired` field (⚠️ hardcoded to 2 in examples)
     - Publishes InterviewConfirmed events

  4. **Vote Processor** (`talent-flow-vote-processor`) - 256MB, 15s timeout
     - **CRITICAL BUSINESS LOGIC**: Score aggregation and recommendation determination
     - Subscribes to VoteSubmitted events
     - **Scoring Weights** (Lines 677-683):
       ```javascript
       overall = technical * 0.35 + communication * 0.25 +
                 culturalFit * 0.20 + problemSolving * 0.20
       ```
       - ⚠️ **BRD MISMATCH**: Tech 35% (should be 30%), Cultural 20% (should be 25%)
     - **Recommendation Logic** (Lines 690-701):
       - STRONG_HIRE: strongYes >= 50% of votes
       - HIRE: strongYes + yes >= 75% of votes
       - NO_HIRE: strongNo + no >= 50% of votes
       - MIXED: otherwise
       - ⚠️ **MISSING**: "Any STRONG_NO = auto-reject" from BRD (no explicit single-veto logic)
     - Publishes VotingCompleted event when all votes received

  5. **Evaluation Completer** (`talent-flow-evaluation-completer`) - 256MB, 15s timeout
     - Triggered by VotingCompleted events
     - Checks if all required interviews complete, aggregates final scores
     - Determines final decision (HIRE, NO_HIRE, MIXED)
     - Publishes EvaluationCompleted event to trigger next stage

  6. **Notification Service** (`talent-flow-notification-service`) - 256MB, 30s timeout
     - Generic notification handler (email/SMS/Slack)
     - Consumes SQS queue (batch size 10, max concurrency 5)
     - Template-based notifications (INTERVIEW_SCHEDULED, VOTE_REMINDER, etc.)
     - SMTP integration (Gmail), Slack webhook support

  7. **SLA Monitor** (`talent-flow-sla-monitor`) - 256MB, 60s timeout
     - Cron-based (runs every 1 hour via EventBridge Scheduler)
     - Scans workflows for SLA breaches
     - **SLA Thresholds Defined** (Lines 900-906):
       - FIRST_ENGAGEMENT: 48 hours
       - EVALUATION_COMPLETION: 72 hours
       - OFFER_GENERATION: 24 hours
       - OFFER_ACCEPTANCE: 7 days
     - ⚠️ **Only 4 SLAs defined** - BRD specifies 10 detailed SLAs (need full coverage validation)
     - Publishes SLABreached events with escalationLevel (MANAGER, HR, LEADERSHIP)

- **API Endpoints Detail**:
  - POST /candidate: Creates candidate, generates candidateId + workflowId, publishes CandidateCreated event
  - POST /interview: Schedules interview, assigns interviewers, publishes InterviewScheduled event
  - POST /vote: Submits evaluation with 4 scores (technical, communication, culturalFit, problemSolving) + decision (STRONG_YES/YES/NO/STRONG_NO)
  - GET /candidate/{id}: Returns candidate details, workflow status, interviews, aggregate scores

- **Event-Driven Architecture Patterns**:
  - ✅ No direct Lambda-to-Lambda calls (all via EventBridge)
  - ✅ Idempotency pattern: Check EVENT#{eventId} in DynamoDB before processing, mark as processed after
  - ✅ Retry policy: 2 attempts, 6h max event age, DLQ for failed events
  - ✅ Structured JSON logging for CloudWatch Insights

- **DynamoDB Write Patterns**:
  - Candidate: PK=CANDIDATE#{id}, SK=METADATA (matches schema doc)
  - Interview: PK=CANDIDATE#{id}, SK=INTERVIEW#{interviewId}
  - Vote: PK=CANDIDATE#{id}, SK=VOTE#INT1#{voterId}
  - Workflow: PK=WORKFLOW#{id}, SK=METADATA with nested stages object
  - Event processing: PK=EVENT#{eventId}, SK=METADATA (7-day TTL for idempotency)

- **Performance Benchmarks**:
  - Cold start: 350-500ms, Warm execution: 50-200ms
  - Total cost: $0.13/month for 30K invocations (within free tier)

- **Testing Strategy**:
  - Unit tests: Per-Lambda with mocked AWS SDK (>80% coverage target)
  - Integration tests: LocalStack + Testcontainers for E2E workflow testing
  - Example test: Create candidate → Schedule interview → Submit 2 votes → Verify EvaluationCompleted event

**Alignment Insights for Validation**:
- ✅ API endpoints cover all Stage 1-3 requirements from BRD
- ✅ Event-driven architecture prevents tight coupling and enables future expansion
- ✅ Idempotency and retry patterns ensure reliability
- ✅ Vote schema includes `decision` field (STRONG_YES/YES/NO/STRONG_NO) ✅
- ⚠️ **CRITICAL GAP**: Vote Processor scoring weights **DO NOT MATCH BRD**:
  - Lambda: Tech 35%, Comm 25%, Cultural 20%, Problem 20%
  - BRD (from Business Rules): Tech 30%, Comm 25%, Cultural 25%, Problem 20%
  - Impact: Cultural fit underweighted by 5%, technical overweighted by 5%
- ⚠️ **CRITICAL GAP**: STRONG_NO auto-reject logic NOT explicitly implemented:
  - BRD Business Rule BR-006: "Any panel member submits STRONG_NO → Auto-reject (no debate)"
  - Lambda logic: Uses majority voting (strongNo + no >= 50%)
  - Missing: Single STRONG_NO should immediately trigger NO_HIRE regardless of other votes
- ⚠️ **Panel Size Hardcoded**: Interview record shows `votesRequired: 2`, API response shows `required: 2`
  - BRD: Min 1 panel member, size should be configurable per department/position
  - Lambda: Hardcoded assumptions throughout (need dynamic panel size configuration)
- ⚠️ **SLA Coverage Incomplete**: Only 4 SLA thresholds defined (FIRST_ENGAGEMENT, EVALUATION_COMPLETION, OFFER_GENERATION, OFFER_ACCEPTANCE)
  - BRD defines 10 detailed SLAs across all 12 stages
  - Need to verify which 6 SLAs are missing from SLA Monitor

**Potential Gaps Identified**:
1. **HIGH PRIORITY**: Fix scoring weights in Vote Processor (lines 677-683)
2. **HIGH PRIORITY**: Implement single STRONG_NO auto-reject logic in Vote Processor (lines 690-701)
3. **MEDIUM PRIORITY**: Make panel size configurable (remove hardcoded `votesRequired = 2`)
4. **MEDIUM PRIORITY**: Expand SLA Monitor to cover all 10 BRD SLAs (currently only 4)
5. **LOW PRIORITY**: Add more notification templates (currently only INTERVIEW_SCHEDULED, VOTE_REMINDER)

**Implementation Readiness**:
- Lambda specifications are detailed and implementation-ready ✅
- Clear IAM permissions, environment variables, runtime configs ✅
- Code examples provided for API Handler, Vote Processor, idempotency pattern ✅
- Testing strategy and deployment checklist included ✅
- **Action Required**: Fix BRD alignment gaps before code generation

---

#### ✅ Document 4: STEP_FUNCTIONS_ORCHESTRATION.md (COMPLETE)
**Read**: 2026-05-13 | **Lines**: 790

**Key Context Gained**:
- **Purpose**: Durable, long-running workflows using AWS Step Functions for processes requiring wait states, human approvals, complex branching, saga orchestration
- **POC Scope**: Step Functions used ONLY for workflows genuinely needing long-running orchestration (Offer Approval, Background Checks)
- **Cost**: <$1/month at POC scale (150 state transitions/month × $0.025 per 1K = $0.004/month)

- **When to Use Step Functions vs EventBridge**:
  - **EventBridge + Lambda**: Event-driven reactions (fire-and-forget), fan-out, content-based routing, <15min processing
  - **Step Functions**: Long waits (hours/days/weeks), human approvals (blocking state), complex branching (>3 levels), saga orchestration, retry/error handling with exponential backoff

- **Pattern 1: Hybrid Orchestration (Recommended)**:
  - EventBridge (fast path) → Lambda (business logic) → Step Functions (long-running only) → EventBridge (resumption events)
  - Example: EvaluationCompleted event → offer-generator Lambda → Start Step Functions workflow for approval

- **Pattern 2: Offer Approval State Machine** (Lines 105-303):
  - **11 States**: CreateOfferRecord → CheckApprovalRequired → SendApprovalRequest → WaitForApproval → CheckApprovalDecision → SendOfferToCandidate → WaitForCandidateResponse → ProcessCandidateDecision → OfferAccepted/Declined/RejectedByManager/ApprovalTimeout/CandidateOfferExpired/AutoApprove
  - **Callback Pattern**: Uses `.waitForTaskToken` to pause workflow until human decision
  - **Wait Times**:
    - Manager approval: 7 days timeout (604,800 seconds), 24h heartbeat (86,400 seconds)
    - Candidate response: 7 days timeout (604,800 seconds)
  - **Auto-Approval Logic**: If `approvalRequired: false` → AutoApprove (bypasses manager approval)
    - PassState result: `{ decision: "APPROVED", approvedBy: "SYSTEM", reason: "Below auto-approval threshold" }`
    - ⚠️ **BRD Alignment**: Need to verify if BRD specifies auto-approval thresholds (e.g., salary < $X)
  - **Resumption**: Step Functions publishes event with taskToken to EventBridge → Lambda sends email with approve/reject links → API Gateway receives click → Lambda calls SendTaskSuccess/SendTaskFailure → Workflow resumes

- **Pattern 3: Callback Pattern Implementation** (Lines 307-413):
  - **Step 1**: Step Functions enters wait state, publishes event with taskToken to EventBridge
  - **Step 2**: Lambda stores taskToken in DynamoDB (PK=OFFER#{offerId}, SK=APPROVAL_TOKEN, 7-day TTL)
  - **Step 3**: Lambda sends email to manager with approve/reject links
  - **Step 4**: Manager clicks link → API Gateway → Lambda retrieves taskToken from DynamoDB
  - **Step 5**: Lambda calls SendTaskSuccess (approved) or SendTaskFailure (rejected)
  - **Step 6**: Step Functions resumes with decision
  - **Code Examples**: Complete Lambda implementations for send-approval-request.js and process-approval-decision.js

- **Pattern 4: Background Check Workflow** (Lines 416-547):
  - **Multi-Week Wait**: Timeout 2,592,000 seconds (30 days) for external vendor integration
  - **States**: InitiateBackgroundCheck → WaitForBackgroundCheckCompletion → EvaluateBackgroundCheck → BackgroundCheckPassed/Flagged/Failed
  - **Flagged Path**: BackgroundCheckFlagged → WaitForManualReview (7-day timeout) → ProcessReviewDecision → Approved/Failed
  - **Result Options**: CLEAR (auto-pass), FLAGGED (manual review required), FAILED (auto-reject)
  - ⚠️ **BRD Alignment**: Need to verify if BRD Stage 9 (Background Checks) specifies review workflows for flagged checks

- **Pattern 5: Saga Pattern with Compensation** (Lines 550-638):
  - **Use Case**: Offer Accepted → Onboarding Initiation (if onboarding fails, reverse offer acceptance)
  - **Transaction Steps**: AcceptOffer → CreateOnboardingRecord → InitiateBackgroundCheck → SendWelcomeEmail
  - **Compensation Steps** (reverse order): CompensateBackgroundCheck → CompensateOnboardingRecord → CompensateOfferAcceptance → SagaFailed
  - **Error Handling**: Each step has Catch block that triggers compensation chain
  - **Failure State**: Saga ends with Fail state: `{ Cause: "Saga compensation completed", Error: "OnboardingInitiationFailed" }`

- **Best Practices** (Lines 662-700):
  1. Keep state machines focused (separate per domain: offer-approval, background-check, onboarding-checklist)
  2. Use EventBridge for triggering (Lambda → EventBridge → Step Functions, not direct Lambda → Step Functions)
  3. Store task tokens in DynamoDB (enables callback pattern, allows querying "who's waiting for what", TTL for cleanup)
  4. Set realistic timeouts: Offer approval 7d, Background check 30d, Onboarding checklist 90d
  5. Use exponential backoff for retries (2s, 4s, 8s intervals with max 3 attempts)

- **Monitoring & Alerting**:
  - CloudWatch metrics: ExecutionsFailed (alert if >5% failure rate), ExecutionsTimedOut (alert if any), ExecutionTime (P95, P99)
  - CloudWatch alarms: OfferApprovalTimeoutAlarm (threshold: 1 timeout → SNS → PagerDuty, severity HIGH)

- **Testing Strategy** (Lines 720-762):
  - Local: Step Functions Local (Docker container on port 8083)
  - Integration: Test callback pattern by starting execution → wait for state → retrieve taskToken → send approval → verify completion
  - Code example provided for testing offer approval workflow

- **Migration POC → Production**:
  - POC: Minimal Step Functions (only offer approval + background check), Standard Workflows
  - Production: Comprehensive workflows for all long-running processes, Express Workflows for high-throughput, X-Ray tracing, CloudWatch Logs

**Alignment Insights for Validation**:
- ✅ Step Functions correctly used only for long-running workflows (not overused for short-lived events)
- ✅ Hybrid pattern (EventBridge → Lambda → Step Functions) maintains loose coupling
- ✅ Callback pattern enables human approvals without polling
- ✅ Saga pattern ensures transactional consistency for multi-step onboarding
- ⚠️ **Auto-Approval Logic**: Architecture includes auto-approval for offers "below threshold" (Lines 291-300)
  - Need to verify: Does BRD specify auto-approval criteria? (e.g., salary < $100K, level < Senior, etc.)
  - Need to verify: Who defines approval thresholds? (HR policy, department-specific, configurable?)
- ⚠️ **Background Check Review Workflow**: Architecture includes manual review path for FLAGGED results
  - Need to verify: Does BRD Stage 9 specify review process? Who reviews? What criteria?
  - Need to verify: What happens if review takes >7 days? (current timeout)
- ⚠️ **Offer Expiration**: Candidate has 7 days to accept offer (Line 220: TimeoutSeconds 604,800)
  - Need to verify: Does BRD specify offer expiration period? Is 7 days correct?
  - BRD SLA: "Offer acceptance to start date: 14-21 days" - but offer validity period not explicitly stated
- ⚠️ **Manager Approval Timeout**: Manager has 7 days to approve offer (Line 166: TimeoutSeconds 604,800)
  - Need to verify: Does BRD specify manager approval SLA? Is 7 days acceptable?
  - BRD SLA: "Offer generation time: 24 hours from final approval" - but manager approval time not specified

**Potential Gaps Identified**:
1. **MEDIUM PRIORITY**: Auto-approval logic exists but thresholds not defined (who sets? how configured?)
2. **MEDIUM PRIORITY**: Offer expiration period (7 days) not explicitly validated against BRD requirements
3. **MEDIUM PRIORITY**: Manager approval timeout (7 days) not explicitly validated against BRD SLA framework
4. **LOW PRIORITY**: Background check manual review timeout (7 days) - may need longer for complex cases

**Implementation Readiness**:
- Step Functions patterns are production-ready with complete state machine definitions ✅
- Callback pattern fully documented with code examples ✅
- Saga compensation pattern ensures data consistency ✅
- Testing strategy includes local and integration tests ✅
- Cost negligible at POC scale ($0.004/month) ✅
- **Action Required**: Validate auto-approval, offer expiration, and approval timeout parameters against BRD

---

#### ✅ Document 5: TERRAFORM_MODULE_STRUCTURE.md (COMPLETE)
**Read**: 2026-05-13 | **Lines**: 1,040

**Key Context Gained**:
- **Purpose**: Reusable Terraform Infrastructure-as-Code modules for rapid infrastructure deployment across environments (dev, staging, prod)
- **Design Principles**: Reusability, AI-friendly structure, compatible with existing modules, incremental deployment (Stage 1-3 first)

- **Repository Structure**:
  ```
  terraform/
  ├── modules/                          # Reusable modules (7 types)
  │   ├── lambda-function/              # Lambda with IAM, DLQ, EventBridge/SQS triggers
  │   ├── eventbridge-bus/              # EventBridge with archive & schema discovery
  │   ├── dynamodb-table/               # DynamoDB with GSIs, TTL, PITR, encryption
  │   ├── sqs-queue/                    # SQS queue
  │   ├── sns-topic/                    # SNS topic
  │   ├── step-functions/               # Step Functions state machine
  │   └── api-gateway/                  # API Gateway REST API
  ├── environments/                     # Environment-specific configs (dev, staging, prod)
  └── global/                           # Shared resources (IAM roles)
  ```

- **Module 1: Lambda Function** (Lines 47-401):
  - **Resources**: Lambda function, CloudWatch log group, EventBridge trigger (optional), SQS trigger (optional), DLQ (optional)
  - **IAM**: Execution role, basic execution policy (CloudWatch Logs), VPC policy (if VPC), custom policies (DynamoDB, EventBridge, etc.), DLQ policy
  - **Variables**: function_name, handler, runtime (default: nodejs20.x), architectures (default: arm64), memory_size (default: 512MB), timeout (default: 10s), environment_variables, vpc_config (optional), eventbridge_rule (optional), sqs_trigger (optional), enable_dlq (default: true), max_retry_attempts (default: 2), max_event_age_seconds (default: 21600 = 6h)
  - **Outputs**: function_name, function_arn, function_invoke_arn, role_arn, log_group_name, dlq_arn
  - **DLQ Configuration**: Auto-creates SQS DLQ with 14-day retention, visibility timeout = Lambda timeout × 6
  - **Retry Policy**: 2 max retry attempts, 6h max event age (aligns with Lambda Catalog error handling)

- **Module 2: EventBridge Bus** (Lines 404-527):
  - **Resources**: EventBridge bus, archive (optional for event replay), schema discovery policy (optional)
  - **Variables**: bus_name, enable_archive (default: false), archive_retention_days (default: 7), enable_schema_discovery (default: false)
  - **Archive**: Event replay capability with configurable retention and event pattern filtering
  - **Outputs**: bus_name, bus_arn, archive_arn

- **Module 3: DynamoDB Table** (Lines 531-707):
  - **Resources**: DynamoDB table with GSIs, TTL, point-in-time recovery, encryption, streams
  - **Variables**: table_name, billing_mode (default: PAY_PER_REQUEST), hash_key, range_key, attributes, global_secondary_indexes, ttl_attribute, enable_point_in_time_recovery (default: false), enable_encryption (default: true), kms_key_arn, stream_view_type (NEW_IMAGE, OLD_IMAGE, NEW_AND_OLD_IMAGES, KEYS_ONLY)
  - **GSI Support**: Dynamic block for multiple GSIs with configurable projection type (ALL, KEYS_ONLY, INCLUDE)
  - **TTL**: Automatic cleanup of expired records
  - **Encryption**: Server-side encryption enabled by default (AWS-managed or customer-managed KMS)

- **Environment Configuration Example** (Lines 711-893):
  - **Backend**: S3 remote state with DynamoDB locking for concurrent safety
  - **Provider**: AWS with default tags (Project: TalentFlow, Environment, ManagedBy: Terraform, Owner)
  - **Module Usage**: Complete examples for eventbridge_bus, dynamodb_state_table, lambda_api_handler, lambda_workflow_orchestrator
  - **Cross-Module References**: Use module outputs for dependency passing (e.g., `module.eventbridge_bus.bus_name`)
  - **IAM Permissions**: Inline policy statements passed as variable (DynamoDB GetItem/PutItem/Query, EventBridge PutEvents)

- **AI Code Generation Prompts** (Lines 897-915):
  - Template for generating Terraform code using reusable modules
  - Example: "Generate Terraform code to deploy vote-processor Lambda using lambda-function module"
  - Includes requirements specification (runtime, memory, timeout, triggers, environment vars, IAM permissions)

- **Deployment Workflow** (Lines 918-950):
  1. `terraform init` - Initialize backend and download providers
  2. `terraform plan -out=tfplan` - Preview changes
  3. `terraform apply tfplan` - Apply changes
  4. Validate deployment using AWS CLI (test Lambda invocation, check EventBridge bus, query DynamoDB table)

- **Best Practices** (Lines 953-1008):
  1. **Remote State**: S3 backend with DynamoDB locking (prevents concurrent modification conflicts)
  2. **Workspaces**: Use for environment separation (dev, staging, prod)
  3. **Variables**: Parameterize configuration (environment-specific memory sizes, regions)
  4. **Outputs**: Export values for cross-module references and external access
  5. **Default Tags**: Consistent tagging via provider (Project, Environment, ManagedBy, Owner)

- **Cost Optimization Strategies** (Lines 1011-1025):
  - **POC Environment**:
    - PAY_PER_REQUEST billing for DynamoDB (no provisioned capacity → lower cost for low traffic)
    - Disable point-in-time recovery (saves backup storage costs)
    - arm64 Lambda architecture (20% cheaper than x86, Graviton processors)
    - Enable DLQ (prevent lost events, critical for POC reliability)
    - Short log retention (7 days for POC → reduces CloudWatch Logs storage)
  - **Production Environment**:
    - Consider PROVISIONED capacity with auto-scaling (if predictable load → can be cheaper at high volume)
    - Enable point-in-time recovery (compliance requirement)
    - Use reserved concurrency for critical Lambdas (guarantee availability)
    - Longer log retention (30-90 days for debugging, compliance)

- **Terraform State Management**:
  - S3 bucket: `talent-flow-terraform-state`
  - State file path: `{environment}/terraform.tfstate` (e.g., `dev/terraform.tfstate`)
  - DynamoDB table: `terraform-state-lock` (prevents concurrent apply operations)
  - Encryption: State files encrypted at rest (S3 server-side encryption)

**Alignment Insights for Validation**:
- ✅ Infrastructure-as-Code approach enables version control, repeatability, disaster recovery
- ✅ Reusable modules reduce duplication and ensure consistency across environments
- ✅ Cost optimizations (PAY_PER_REQUEST, arm64, short log retention) align with POC budget constraint (<$50/month)
- ✅ DLQ enabled by default (prevents event loss, aligns with BRD reliability requirements)
- ✅ Remote state with locking prevents infrastructure drift and concurrent modification issues
- ✅ Module structure supports incremental deployment (deploy Stage 1-3 Lambdas first, then expand)
- ✅ IAM policies defined inline (least-privilege approach, no overly permissive wildcards)
- ✅ Encryption enabled by default for DynamoDB (data security best practice)
- ⚠️ **Archive/Replay**: EventBridge archive disabled by default (Line 755: `enable_archive = true` in example but default is false)
  - Need to verify: Does BRD require event replay capability for audit/compliance?
  - Use case: Reprocess events after bug fix, compliance audit trail
  - Cost: Minimal (<$1/month for 7-day retention)
- ⚠️ **Point-in-Time Recovery**: Disabled for POC (Line 795: `enable_point_in_time_recovery = false`)
  - Need to verify: Does BRD require PITR for data protection?
  - Trade-off: PITR adds ~$0.20/GB/month (negligible for POC but important for compliance)
  - Recommendation: Enable in prod even if disabled in POC

**Potential Gaps Identified**:
1. **LOW PRIORITY**: EventBridge archive disabled by default (may need for compliance/audit requirements)
2. **LOW PRIORITY**: Point-in-time recovery disabled for POC (acceptable for POC, must enable for prod)
3. **NON-ISSUE**: Terraform state locking prevents deployment conflicts ✅
4. **NON-ISSUE**: Default tags ensure consistent resource tagging ✅

**Implementation Readiness**:
- Terraform modules are production-ready with complete resource definitions ✅
- Clear variable interfaces for customization ✅
- IAM policies follow least-privilege principle ✅
- Cost optimization strategies documented for POC and prod ✅
- Deployment workflow is straightforward (init → plan → apply) ✅
- AI code generation prompts enable rapid module usage ✅
- **Action Required**: Decide if EventBridge archive and DynamoDB PITR are needed for POC (likely acceptable to disable for POC, enable for prod)

---

#### ✅ Document 6: MIGRATION_PATHS.md (COMPLETE)
**Read**: 2026-05-13 | **Lines**: 519

**Key Context Gained**:
- **Purpose**: Define incremental evolution path from POC (Level 0) → Production (Level 1) → Intelligence (Level 2) → Agentic AI (Level 3)
- **Key Principle**: Incremental evolution, not big-bang rewrites. Each level builds on previous with clear trigger conditions.

- **Maturity Level Overview** (Lines 17-25):
  | Level | Name | Scale | Cost/Month | Capabilities |
  |-------|------|-------|-----------|--------------|
  | **0** | POC | 10 candidates | <$50 | Core workflows, basic monitoring |
  | **1** | Production | 100 candidates | $200-300 | Multi-tenant, HA, compliance |
  | **2** | Intelligence | 500 candidates | $800-1200 | AI insights, sentiment, predictive |
  | **3** | Agentic | 2000+ candidates | $3000-5000 | Autonomous AI, multi-region, analytics |

- **Migration 1: Level 0 (POC) → Level 1 (Production)** (Lines 28-224):
  - **Trigger Conditions**: 10+ candidates processed, 1 dept validated, 2 managers active, no critical bugs for 2 weeks, stakeholder approval

  - **Infrastructure Changes**:
    - DynamoDB: PAY_PER_REQUEST → PROVISIONED with auto-scaling (5-100 capacity units, 70% target utilization)
    - DynamoDB Backup: None → Point-in-time recovery enabled
    - Lambda: Best-effort concurrency → Reserved concurrency for critical functions
    - EventBridge: No archive → 30-day event archive enabled (debugging, compliance)
    - CloudWatch Logs: 7-day retention → 90-day retention
    - API Gateway: None (direct Lambda invoke) → REST API with custom domain, rate limiting
    - Authentication: None → Cognito user pools
    - Monitoring: Basic CloudWatch → Custom dashboards + X-Ray tracing
    - Alerting: None → SNS → PagerDuty for critical alerts
    - **Cost Impact**: +$150-250/month

  - **Security Changes**:
    - API Authentication: None → Cognito JWT tokens
    - IAM Policies: Permissive (account-level) → Least privilege (resource-specific ARNs)
    - Encryption: At-rest (default KMS) → At-rest + in-transit (custom KMS keys)
    - Secrets: Environment variables → AWS Secrets Manager (secure credential rotation)
    - VPC: None (public Lambda) → Private subnets + NAT gateway (network isolation)
    - WAF: None → WAF on API Gateway (DDoS protection)
    - **New Components**: Cognito, Secrets Manager, VPC + NAT, WAF
    - **Cost Impact**: +$100-150/month (mostly VPC NAT gateway)

  - **Observability Changes**:
    - Distributed Tracing: None → X-Ray enabled on all Lambdas
    - Custom Metrics: None → CloudWatch custom metrics (business KPIs)
    - Dashboards: None → CloudWatch dashboard (SLA, errors, latency)
    - Alarms: None → 15+ CloudWatch alarms (Lambda error rate >5%, DynamoDB throttling, API 5xx >10/min, SLA breach >10%, EventBridge failures)
    - Log Aggregation: CloudWatch Logs → CloudWatch Logs Insights queries
    - **Cost Impact**: +$20-30/month

  - **Multi-Tenancy** (Lines 130-169):
    - POC: Single tenant (1 department)
    - Production: Multi-tenant (5-10 departments)
    - **Schema Change**: Add `tenantId` to all DynamoDB records, update PK format from `CANDIDATE#CAND-123` to `TENANT#DEPT-ENG#CANDIDATE#CAND-123`
    - **Migration Strategy**: Backfill script to add tenantId, update all Lambdas to filter by tenantId, add GSI for tenant queries, test with 2 tenants, migrate incrementally
    - **Cost Impact**: Minimal (same query patterns)

  - **Compliance & Audit** (Lines 172-186):
    - GDPR compliance (data retention, deletion)
    - SOC 2 compliance (audit logs, access controls)
    - HIPAA compliance (if healthcare clients)
    - **Changes**: Immutable event ledger (no deletions), data retention policy (auto-delete PII after 2 years via DynamoDB TTL), CloudTrail enabled (all API calls), FIPS 140-2 KMS keys
    - **Cost Impact**: +$30-50/month

  - **4-Week Migration Execution Plan** (Lines 189-224):
    - Week 1: Preparation (prod AWS account, Terraform backend, Cognito, VPC, KMS keys)
    - Week 2: Infrastructure deployment (Terraform, Lambda blue/green, API Gateway + WAF, dashboards, X-Ray)
    - Week 3: Data migration (export POC data, add tenantId backfill, import to prod, validate integrity, test queries)
    - Week 4: Cutover (parallel run POC+prod 1 week, compare results, redirect traffic via DNS, monitor 48h, decommission POC)
    - **Rollback Plan**: If critical issues within 48h → revert DNS to POC, root cause, fix, retry

- **Migration 2: Level 1 (Production) → Level 2 (Intelligence)** (Lines 227-340):
  - **Trigger Conditions**: 100+ candidates/month, 5+ departments, <0.1% error rate for 3 months, business requests AI insights, budget approved ($800-1200/month)

  - **AI/ML Components** (NEW):
    - Sentiment Analysis: Amazon Comprehend on interview feedback ($0.0001/unit)
    - Resume Parsing: Amazon Textract + Comprehend ($0.001/page)
    - Predictive Scoring: SageMaker hosted model ($50-100/month)
    - Engagement Recommendations: Bedrock Claude API ($0.002/1K tokens)
    - Interview Question Generation: Bedrock Claude API ($0.002/1K tokens)
    - **New Lambdas**: sentiment-analyzer, resume-parser, predictive-scorer, engagement-recommender
    - **Architecture**: EventBridge → Lambda → AI API → DynamoDB → EventBridge (SentimentAnalyzed event)
    - **Cost Impact**: +$400-600/month

  - **Data Lake (Analytics)** (Lines 271-297):
    - POC/Level 1: All data in DynamoDB
    - Level 2: DynamoDB + S3 Data Lake + Athena
    - **Why**: Complex analytics (not suitable for DynamoDB), multi-year historical trends, BI tool integration (Tableau, PowerBI)
    - **Architecture**: DynamoDB Streams → Lambda (stream-processor) → S3 Data Lake (Parquet, partitioned by year/month) → AWS Glue Crawler (schema discovery) → Athena (SQL queries) → QuickSight Dashboard
    - **Cost Impact**: +$100-150/month

  - **Real-Time Dashboards** (Lines 300-312):
    - Level 1: Static reports (generated daily)
    - Level 2: Real-time dashboards (WebSocket updates)
    - **Implementation**: EventBridge → Lambda → API Gateway WebSocket → Frontend (real-time candidate status, live SLA monitoring, real-time scoring)
    - **Cost Impact**: +$50-80/month

  - **4-Month Migration Plan**: Month 1 (AI POC with 1 dept), Month 2 (data lake setup), Month 3 (dashboard development), Month 4 (full rollout + user training)

- **Migration 3: Level 2 (Intelligence) → Level 3 (Agentic AI)** (Lines 343-443):
  - **Trigger Conditions**: 500+ candidates/month, 20+ departments, AI proven valuable (>80% satisfaction), business requests autonomous automation, budget approved ($3000-5000/month)

  - **Agentic AI Automation** (Lines 354-384):
    - Level 2: AI provides insights, humans make decisions
    - Level 3: AI agents autonomously execute workflows
    - **AI Agents**:
      1. **Recruiter Agent**: Autonomously sources candidates (LinkedIn, Indeed), screens resumes (accept/reject), schedules interviews (finds optimal times), sends personalized outreach
      2. **Interview Agent**: Conducts preliminary phone screens (AI voice), asks follow-up questions based on resume, scores responses real-time, escalates if uncertainty >20%
      3. **Offer Negotiation Agent**: Autonomously negotiates salary (within bounds), handles candidate questions (benefits, PTO), escalates to hiring manager if needed
    - **Implementation**: Amazon Bedrock Agents framework, Claude 3.5 Sonnet (reasoning model), custom tools (DynamoDB queries, calendar APIs), human-in-the-loop approval gates
    - **Cost Impact**: +$1500-2500/month

  - **Multi-Region Deployment** (Lines 387-404):
    - Level 1-2: Single region (us-east-1)
    - Level 3: Multi-region (us-east-1, eu-west-1, ap-southeast-1)
    - **Why**: Global expansion, low latency for global users, disaster recovery (active-active)
    - **Architecture**: DynamoDB Global Tables (multi-region replication), EventBridge cross-region replication, Route 53 geo-routing (API Gateway), S3 cross-region replication
    - **Cost Impact**: +$800-1200/month

  - **Advanced Analytics** (Lines 407-421):
    - Predictive attrition risk (which candidates likely to leave)
    - Diversity analytics (bias detection in hiring)
    - Market benchmarking (salary, time-to-hire comparisons)
    - Machine learning model training (custom models via SageMaker training jobs, MLOps pipeline)
    - **Cost Impact**: +$300-500/month

  - **6-Month Migration Plan**: Months 1-2 (Agentic AI POC), Months 3-4 (multi-region setup), Months 5-6 (full agentic rollout + user training)

- **Cost Comparison Across Levels** (Lines 446-462):
  | Service | Level 0 | Level 1 | Level 2 | Level 3 |
  |---------|---------|---------|---------|---------|
  | Lambda | $5 | $30 | $50 | $80 |
  | DynamoDB | $15 | $80 | $120 | $200 |
  | EventBridge | $2 | $10 | $15 | $30 |
  | AI Services | $0 | $0 | $500 | $2000 |
  | VPC (NAT) | $0 | $50 | $50 | $100 |
  | **TOTAL** | **$30-50** | **$265** | **$930** | **$3330** |

- **Risk Mitigation Strategies** (Lines 466-495):
  1. **Data Loss**: Full backup before migration (DynamoDB export to S3), parallel run (1-2 weeks), checksum validation, rollback plan
  2. **Performance Degradation**: Load testing before cutover (10x traffic), auto-scaling configured, canary deployments (5% → 25% → 100%), rollback if error rate >5%
  3. **Cost Overruns**: AWS Cost Explorer alerts (daily budget checks), reserved capacity for predictable workloads, monthly cost optimization reviews, kill switches for expensive AI features
  4. **AI Hallucinations/Errors**: Human-in-the-loop for critical decisions, confidence thresholds (escalate if <80%), audit log for all AI decisions, monthly accuracy reviews (precision, recall)

- **Key Takeaways** (Lines 498-505):
  1. Incremental evolution (each level builds on previous, no rewrites)
  2. Validate before scaling (prove value at each level before investing in next)
  3. Cost-aware (understand cost implications of each migration)
  4. Rollback plans (every migration has rollback strategy)
  5. User training (don't underestimate change management)

**Alignment Insights for Validation**:
- ✅ Migration strategy is well-planned with clear trigger conditions and rollback plans
- ✅ Cost scaling is predictable and documented ($30-50 → $265 → $930 → $3330)
- ✅ POC budget constraint (<$50/month) is validated and achievable
- ✅ Multi-tenancy approach (add tenantId) aligns with BRD requirement for departmental isolation
- ✅ Compliance features (GDPR, SOC 2, HIPAA) address regulatory requirements mentioned in BRD
- ✅ Incremental evolution prevents big-bang rewrites (reduces risk, enables learning)
- ✅ Level 1 migration includes authentication (Cognito) which BRD requires for user access control
- ✅ Level 2 AI features (sentiment analysis, predictive scoring) align with BRD's vision for "measurable, data-driven hiring"
- ✅ Level 3 agentic AI (autonomous sourcing, screening) represents future vision but NOT required for POC/MVP
- ⚠️ **Multi-Tenancy Schema Change**: Adding `tenantId` to PK format will break existing queries
  - Need to verify: Are all Lambda functions designed to be tenant-aware from Day 1?
  - Recommendation: Build tenant awareness into POC even if single-tenant (prevents breaking change later)
- ⚠️ **Data Retention Policy**: 2-year PII auto-deletion via TTL (Line 181)
  - Need to verify: Does BRD specify data retention requirements? (audit trails, compliance)
  - Trade-off: GDPR requires deletion (right to be forgotten), but audit compliance may require longer retention
- ⚠️ **AI Confidence Thresholds**: Level 3 escalates if uncertainty >20% (Line 370), Level 3 escalates if confidence <80% (Line 492)
  - Need to verify: These thresholds are for future Level 3, but do we need similar thresholds for Level 2 AI features?
  - Example: If sentiment analysis confidence <80%, should we flag for manual review?

**Potential Gaps Identified**:
1. **MEDIUM PRIORITY**: Multi-tenancy schema design should be built into POC even if single-tenant (prevents breaking change during Level 0→1 migration)
2. **MEDIUM PRIORITY**: Data retention policy (2 years) not explicitly validated against BRD compliance requirements
3. **LOW PRIORITY**: AI confidence thresholds documented for Level 3 but not for Level 2 AI features
4. **NON-ISSUE**: Cost scaling is well-documented and predictable ✅
5. **NON-ISSUE**: Rollback plans are comprehensive ✅

**Implementation Readiness**:
- Migration strategy is detailed with week-by-week execution plans ✅
- Trigger conditions provide clear go/no-go decision criteria ✅
- Risk mitigation strategies address data loss, performance, cost, AI errors ✅
- Cost comparison enables informed budget planning ✅
- Incremental approach reduces risk and enables learning ✅
- **Action Required**: Decide if POC should include tenant-aware schema from Day 1 (recommended to prevent breaking change later)

---

#### ✅ Document 7: COST_BREAKDOWN.md (COMPLETE)
**Read**: 2026-05-13 | **Lines**: 570

**Key Context Gained**:
- **Target**: <$50/month for POC (Maturity Level 0)
- **Actual Projection**: $32-48/month (but achievable at **$0/month** with free tier!)
- **Confidence**: High (based on 10 candidates/month = 970 Lambda invocations, 235 events, 258 DynamoDB writes)

- **Cost Drivers** (Lines 15-21):
  1. DynamoDB (40% of cost when exceeding free tier)
  2. Lambda (20% of cost when exceeding free tier)
  3. NAT Gateway (biggest cost driver at $32.40/month - **defer to Level 1**)
  4. EventBridge (10% of cost)
  5. CloudWatch Logs (10% of cost)

- **AWS Free Tier Eligibility** (Lines 26-41):
  - **Always Free** (no expiration):
    - Lambda: 1M requests/month + 400K GB-seconds compute
    - DynamoDB: 25 GB storage + 25 WCU + 25 RCU (on-demand: 1M writes, 2.5M reads)
    - EventBridge: 14M events/month (custom buses: first 1.4M free)
    - SNS: 1M publishes/month + 100K HTTP deliveries
    - SQS: 1M requests/month
    - CloudWatch Logs: 5 GB ingestion + 5 GB storage
  - **12-Month Free Tier** (costs apply after first year):
    - S3: 5 GB standard storage
    - API Gateway: 1M API calls/month
    - Step Functions: 4,000 state transitions/month

- **POC Volume Assumptions** (Lines 43-73):
  - **Candidates**: 10/month
  - **Interviews**: 20/month (2 per candidate)
  - **Votes**: 40/month (2 votes per interview) ⚠️ **Confirms panel size assumption of 2 voters**
  - **SLA Checks**: 720/month (1/hour via cron)
  - **Total Events**: 235/month (CandidateCreated, InterviewScheduled, VoteSubmitted, VotingCompleted, EvaluationCompleted, StageTransitioned, SLABreached, notifications)
  - **Total Lambda Invocations**: 970/month (API Handler: 70, Workflow Orchestrator: 10, Interview Scheduler: 20, Vote Processor: 40, Evaluation Completer: 10, Notification Service: 100, SLA Monitor: 720)
  - **Free Tier Coverage**: 970 / 1,000,000 = **0.097% of Lambda free tier used** ✅

- **Detailed Cost Breakdown by Service** (Lines 76-310):

  1. **Lambda** (Lines 78-97):
     - Volume: 970 invocations, 500ms avg duration, 512MB avg memory = 242.5 GB-seconds
     - Pricing: $0.20 per 1M requests, $0.0000166667 per GB-second (arm64)
     - Cost: **$0.00 (within free tier)** ✅

  2. **DynamoDB** (Lines 100-140):
     - Writes: 258/month (candidate creates, workflow creates, interview creates, vote creates, event ledger writes, status updates)
     - Reads: 970/month (API queries, Lambda queries)
     - Storage: 0.28 MB (0.0003 GB)
     - Pricing: $1.25 per 1M WCU, $0.25 per 1M RCU, $0.25 per GB-month
     - Cost: **$0.0006 (within free tier)** ✅
     - Note: Uses <0.1% of free tier (1M writes + 2.5M reads/month)

  3. **EventBridge** (Lines 143-159):
     - Volume: 235 custom bus events, 1,645 rule evaluations (235 events × 7 rules)
     - Pricing: $1.00 per million events (first 1.4M free)
     - Cost: **$0.00 (within free tier)** ✅

  4. **SQS** (Lines 162-178):
     - Volume: 105 messages/month (100 notification queue + 5 DLQ at 1% failure rate)
     - Pricing: $0.40 per 1M requests (first 1M free)
     - Cost: **$0.00 (within free tier)** ✅

  5. **SNS** (Lines 181-199):
     - Volume: 15 publishes/month (5 SLA breach notifications + 10 system alerts)
     - Pricing: $0.50 per 1M requests (first 1M free), $2.00 per 100K emails
     - Cost: **$0.0003 (within free tier)** ✅

  6. **S3** (Lines 202-223):
     - Storage: 7.235 MB (5 MB resumes + 2 MB offer letters + 0.235 MB event archive)
     - Requests: 30 PUT, 50 GET
     - Pricing: $0.023 per GB-month (first 5 GB free for 12 months), $0.005 per 1K PUT, $0.0004 per 1K GET
     - Cost: **$0.0002 (within free tier for 12 months)** ✅

  7. **CloudWatch** (Lines 226-257):
     - Logs: 5 MB/month ingestion (970 Lambda invocations × 5 KB + 70 API requests × 2 KB)
     - Metrics: Standard metrics free, 0 custom metrics
     - Alarms: 0 (POC doesn't have alarms configured)
     - Pricing: $0.50 per GB ingestion (first 5 GB free), $0.03 per GB-month storage (first 5 GB free)
     - Cost: **$0.00 (within free tier)** ✅

  8. **Step Functions** (Lines 260-276):
     - Volume: 150 state transitions/month (10 offer approval workflows × 15 states)
     - Pricing: $0.025 per 1K transitions (first 4K free for 12 months)
     - Cost: **$0.00 (within free tier for 12 months)** ✅

  9. **API Gateway** (Lines 279-293):
     - Volume: 70 API calls/month (POST candidate, interview, vote)
     - Pricing: $3.50 per million requests (first 1M free for 12 months)
     - Cost: **$0.00 (within free tier for 12 months)** ✅

  10. **AWS SES** (Lines 296-310):
      - Volume: 100 emails/month
      - Pricing: First 62,000 emails/month free (when sent from EC2 or Lambda)
      - Cost: **$0.00 (within free tier)** ✅

- **Total POC Cost Summary** (Lines 313-330):
  | Service | Free Tier Used | Cost |
  |---------|---------------|------|
  | Lambda | 0.1% | $0.00 |
  | DynamoDB | 0.03% writes, 0.04% reads | $0.00 |
  | EventBridge | 0.02% | $0.00 |
  | All Others | <1% | $0.00 |
  | **TOTAL** | | **$0.00** |

  **Result**: **POC can run on 100% AWS Free Tier with 10 candidates/month!** 🎉

- **Cost Scaling Analysis** (Lines 333-372):
  - **10x Scale** (100 candidates/month): **$0.015/month** (still essentially free) ✅
  - **100x Scale** (1,000 candidates/month - Level 1):
    - Without VPC: **$3.08/month** ✅
    - With VPC: **$35.48/month** ⚠️ (VPC NAT Gateway = $32.40/month = biggest cost driver)
  - **Key Insight**: VPC NAT Gateway is the biggest cost driver at scale. POC should avoid VPC unless required.

- **Cost Optimization Strategies** (Lines 375-407):
  1. **Strategy 1 (POC)**: Maximize free tier (on-demand billing, arm64 Lambda, avoid VPC, 7-day log retention, no custom metrics, no reserved concurrency) → **$0-5/month**
  2. **Strategy 2 (Level 1)**: Right-sizing (provisioned DynamoDB with auto-scaling, Lambda reserved concurrency, S3 Intelligent-Tiering, CloudWatch retention policies, AWS Cost Explorer alerts) → **$200-300/month**
  3. **Strategy 3 (Level 2+)**: Reserved capacity (DynamoDB reserved 40% discount, Lambda Savings Plans 17% discount, S3 Glacier 90% cheaper, CloudFront for static assets) → **$600-900/month**

- **Cost Monitoring Setup** (Lines 410-453):
  - **AWS Budgets**: $50/month with alerts at 50% ($25), 80% ($40), 100% ($50)
  - **Tags**: Project: TalentFlow, Environment: POC, Owner: Engineering, CostCenter: HR-Tech
  - **Daily Cost Report**: Lambda cron (9 AM daily) → AWS Cost Explorer API → Slack notification with breakdown by service

- **Hidden Costs to Watch** (Lines 456-494):
  1. **Data Transfer**: In-region free (Lambda ↔ DynamoDB ↔ EventBridge), cross-region $0.02/GB, internet egress $0.09/GB
     - Mitigation: Keep all resources in same region (us-east-1)
  2. **NAT Gateway**: $0.045/hour = $32.40/month + $0.045/GB data processing
     - Mitigation: Avoid VPC in POC. If VPC required, use VPC endpoints (cheaper than NAT)
  3. **CloudWatch Logs**: $0.50/GB ingestion, $0.03/GB-month storage
     - Mitigation: 7-day retention for POC, filter verbose logs (only errors/warnings), use CloudWatch Logs Insights (don't export to S3)
  4. **DynamoDB On-Demand Spikes**: No throttling protection, pricing can spike if unexpected traffic
     - Mitigation: Set CloudWatch alarm on consumed WCU/RCU, switch to provisioned if consistent traffic

- **Break-Even Analysis** (Lines 496-521):
  - **On-Demand vs Provisioned DynamoDB**:
    - On-Demand: $1.25 per 1M WCU, $0.25 per 1M RCU
    - Provisioned: $0.47 per WCU-month, $0.094 per RCU-month (with auto-scaling)
    - Break-even: Provisioned cheaper when monthly WCU > 376,000
  - **Recommendation**:
    - POC (258 WCU/month): Stay on-demand ✅
    - Level 1 (25,800 WCU/month): Stay on-demand ✅
    - Level 2 (258,000 WCU/month): Consider provisioned

- **Cost Projections by Maturity Level** (Lines 523-533):
  | Level | Candidates/Month | Monthly Cost | Cost/Candidate | Key Drivers |
  |-------|-----------------|--------------|----------------|-------------|
  | 0 (POC) | 10 | $0-5 | $0.50 | Free tier |
  | 1 (Production) | 100 | $200-300 | $2-3 | VPC NAT, provisioned capacity |
  | 2 (Intelligence) | 500 | $800-1200 | $1.60-2.40 | AI API calls |
  | 3 (Agentic) | 2000+ | $3000-5000 | $1.50-2.50 | Agentic AI, multi-region |

  **Key Insight**: Cost per candidate **decreases** as you scale (economies of scale: $0.50 → $2-3 → $1.60-2.40 → $1.50-2.50)

- **ROI Analysis** (Lines 536-556):
  - **Traditional Hiring** (Manual Process):
    - Recruiter: $60/hour × 20 hours = $1,200/candidate
    - HR admin: $40/hour × 10 hours = $400/candidate
    - **Total**: $1,600/candidate
  - **Talent Flow** (Automated):
    - Platform: $2/candidate (Level 1)
    - Recruiter (reduced): $60/hour × 5 hours = $300/candidate
    - HR admin (reduced): $40/hour × 2 hours = $80/candidate
    - **Total**: $382/candidate
  - **Savings**:
    - **Per Candidate**: $1,218 saved (76% reduction)
    - **10 Candidates/Month**: $12,180/month saved
    - **Annual Savings**: $146,160/year
    - **Payback Period**: Less than 1 month! 🚀

**Alignment Insights for Validation**:
- ✅ **POC Budget Constraint VALIDATED**: POC can run at **$0/month** using 100% AWS Free Tier (target was <$50/month)
- ✅ **Cost scaling is predictable**: $0 → $0.015 (10x) → $3.08 (100x without VPC) → $35.48 (100x with VPC)
- ✅ **Free tier coverage is comprehensive**: All services use <1% of free tier (Lambda 0.1%, DynamoDB 0.03% writes, EventBridge 0.02%)
- ✅ **VPC deferral strategy is correct**: VPC NAT Gateway ($32.40/month) is biggest cost driver → defer to Level 1 production
- ✅ **Cost optimization strategies align with maturity levels**: POC (maximize free tier) → Level 1 (right-sizing) → Level 2+ (reserved capacity)
- ✅ **ROI is compelling**: 76% cost reduction, <1 month payback period validates business case
- ✅ **Cost monitoring is well-designed**: AWS Budgets with 3-tier alerts (50%, 80%, 100%), daily cost reports, proper tagging
- ✅ **Hidden costs are identified**: Data transfer, NAT Gateway, CloudWatch Logs, DynamoDB on-demand spikes with mitigation strategies
- ⚠️ **Panel Size Assumption Confirmed Again**: Cost breakdown assumes 2 votes per interview (Line 48: "Votes: 2 votes per interview")
  - This is the 5th document confirming hardcoded panel size of 2 voters
  - Reinforces gap: BRD requires flexible panel sizes (min 1), architecture assumes 2
- ⚠️ **12-Month Free Tier Expiration**: S3, API Gateway, Step Functions free tiers expire after 12 months
  - Need to plan: What happens after Year 1? Cost increases from $0 to ~$5-10/month
  - Mitigation: Budget for Year 2 cost increase or migrate to Level 1 production before expiration

**Potential Gaps Identified**:
1. **NON-ISSUE**: POC budget constraint validated ($0/month achievable) ✅
2. **NON-ISSUE**: Cost scaling is well-understood and documented ✅
3. **NON-ISSUE**: Cost monitoring and alerting strategy is comprehensive ✅
4. **LOW PRIORITY**: 12-month free tier expiration not explicitly addressed (need Year 2 cost plan)
5. **CONFIRMED GAP**: Panel size assumption (2 voters) reconfirmed in cost breakdown

**Implementation Readiness**:
- Cost breakdown validates POC is financially feasible at $0/month ✅
- Detailed cost projections enable budget planning for all maturity levels ✅
- Hidden costs are identified with mitigation strategies ✅
- ROI analysis ($146K/year savings) validates business case ✅
- Cost monitoring setup (budgets, alerts, daily reports) ensures cost control ✅
- Break-even analysis guides on-demand vs provisioned decision ✅
- **Action Required**: Plan for Year 2 cost increase when 12-month free tiers expire (S3, API Gateway, Step Functions)

---

#### ✅ Document 8: AI_DEVELOPMENT_GUIDE.md (COMPLETE)
**Read**: 2026-05-13 | **Lines**: 999

**Key Context Gained**:
- **Purpose**: Comprehensive prompt templates for AI-assisted development using Claude to generate Lambda functions, Terraform modules, Angular components, unit tests, integration tests, documentation
- **Key Principle**: Comprehensive context + clear requirements = high-quality AI output

- **Prompt Structure Best Practices** (Lines 23-69):
  - **Anatomy of Good Prompt**: 6 sections
    1. Context: What project/system is this for?
    2. Role: What component are you generating?
    3. Requirements: Functional requirements (what it does)
    4. Technical Constraints: Non-functional requirements (how it should be built)
    5. Examples/Patterns: Reference existing patterns (e.g., "Follow LAMBDA_CATALOG.md")
    6. Acceptance Criteria: How to validate success
  - **Example**: 60-line prompt for vote-processor Lambda with full context, requirements, technical constraints, patterns to follow

- **6 Prompt Templates**:

  1. **Lambda Function Template** (Lines 73-228):
     - Structure: Function name, purpose, trigger (EventBridge/SQS/API Gateway/Scheduler), input event schema, business logic (numbered steps), DynamoDB operations, EventBridge events to publish, technical requirements (runtime, memory, timeout, AWS SDK v3, structured logging, error handling, idempotency), environment variables, patterns to follow (reference LAMBDA_CATALOG.md)
     - Example: Complete prompt for workflow-orchestrator Lambda (150+ lines) with full specifications
     - Output: Complete Lambda function code (index.js) with imports, helpers, JSDoc comments

  2. **Terraform Module Template** (Lines 232-331):
     - Structure: Context, Lambda function details (name, runtime, memory, timeout, source code path), environment variables, trigger (EventBridge/SQS/Scheduler with patterns), IAM permissions required, other configuration (DLQ, log retention, reserved concurrency), module path, output requirements
     - Example: vote-processor Lambda deployment using reusable lambda-function module
     - Output: Complete Terraform module usage block with all required variables

  3. **Angular Component Template** (Lines 335-470):
     - Structure: Component name, purpose, route, UI requirements, form fields (with validation rules), API integration (service, method, endpoint, request/response payloads, error handling), user interactions, technical requirements (Angular 17 standalone, reactive forms, Material UI, TailwindCSS, RxJS), validation rules, navigation
     - Example: CandidateCreateComponent with full form specification (7 fields with validation)
     - Output: Component TypeScript, HTML template, CSS files with all imports

  4. **Unit Tests Template** (Lines 474-599):
     - Structure: Function name, function purpose, test coverage requirements (list of scenarios), mocking strategy (AWS SDK clients, env vars, dependencies), test data (realistic mocks), technical requirements (Jest, aws-sdk-client-mock, Arrange-Act-Assert pattern, beforeEach/afterEach), expected assertions
     - Example: vote-processor unit tests covering 8 scenarios (score calculation, recommendation logic, VotingCompleted event, idempotency, logging)
     - Output: Complete test file with mock data fixtures, target >80% coverage

  5. **Integration Tests Template** (Lines 603-709):
     - Structure: Test scenario, workflow steps (numbered), involved components (Lambdas, EventBridge, DynamoDB), test setup (deploy functions, create test data, cleanup), test execution (invoke Lambda/API, wait for async processing, verify state/events), assertions, technical requirements (Jest, AWS SDK v3, async/await, timeout, cleanup)
     - Example: Complete evaluation workflow test (10 steps from candidate creation to stage transition)
     - Output: Complete integration test file

  6. **Documentation Template** (Lines 713-780):
     - Structure: Audience, purpose, sections to include, style guidelines (Markdown, code examples, Mermaid diagrams, tables, bullet points, "Next Steps"), tone (technical/business/educational), length
     - Example: DynamoDB single-table design documentation (3000-4000 words) with 11 sections
     - Output: Complete Markdown document

- **Advanced Prompt Techniques** (Lines 784-859):
  1. **Chain of Thought Prompting** (Lines 786-807): For complex logic, ask AI to "think step by step" → explain algorithm in plain English → implement in code → provide test cases
  2. **Reference Existing Patterns** (Lines 811-831): Always reference existing documentation (e.g., "Generate Lambda X following same patterns as Lambda Y from LAMBDA_CATALOG.md")
  3. **Iterative Refinement** (Lines 834-859): Generate → Review → Refine cycle (first basic functionality, then add error handling/logging, then optimize/add metrics)

- **Common Pitfalls & Solutions** (Lines 863-930):
  1. **Pitfall: Vague Requirements** (Lines 865-882):
     - ❌ Bad: "Generate a Lambda function that processes votes"
     - ✅ Good: Specify EventBridge subscription, DynamoDB writes, score calculation, VotingCompleted event, idempotency, AWS SDK v3, follow LAMBDA_CATALOG.md patterns
  2. **Pitfall: No Context** (Lines 885-903):
     - ❌ Bad: "Generate a candidate creation API"
     - ✅ Good: Provide project context (Talent Flow platform, event-driven orchestration), specify validation, duplicate checks, single-table design, EventBridge events, reference patterns
  3. **Pitfall: Missing Technical Constraints** (Lines 906-930):
     - ❌ Bad: "Generate a Lambda function to send notifications"
     - ✅ Good: Specify SQS batch size, routing logic, AWS SES, email templates, message deletion, CloudWatch logging, runtime, memory, timeout, AWS SDK v3, Nodemailer

- **Prompt Library (Quick Reference)** (Lines 933-985):
  - Lambda Function: 1-line template with placeholders for name, purpose, trigger, logic, DynamoDB, EventBridge, technical requirements
  - Terraform Module: 1-line template for module usage with function specs, trigger, env vars, IAM, DLQ
  - Angular Component: 1-line template for standalone component with route, form fields, API, UI, navigation
  - Unit Test: 1-line template for Jest tests with scenarios, mocks, assertions, coverage target
  - Integration Test: 1-line template for E2E workflow with steps, components, setup, assertions, timeout

**Alignment Insights for Validation**:
- ✅ **Comprehensive prompt engineering guide** ensures consistent code generation quality across all Lambda functions
- ✅ **Reference to LAMBDA_CATALOG.md** throughout guide means generated code will follow architecture patterns
- ✅ **Structured logging requirement** (JSON format with contextual fields) aligns with observability best practices
- ✅ **Idempotency requirement** in all templates ensures reliable event processing
- ✅ **Error handling** and **retry logic** are built into prompt templates
- ✅ **AWS SDK v3** specified consistently (modern SDK, tree-shaking, better performance)
- ✅ **Unit test coverage target (>80%)** ensures code quality
- ✅ **Integration test patterns** validate E2E workflows (prevent integration bugs)
- ✅ **Iterative refinement approach** enables continuous improvement of generated code
- ✅ **Common pitfalls documented** helps avoid AI generation mistakes (vague requirements, no context, missing constraints)
- ⚠️ **No Explicit BRD References in Prompts**: Prompt templates reference LAMBDA_CATALOG.md but don't explicitly mention validating against BRD requirements
  - Need to enhance: Add step to prompt templates: "Validate requirements against BRD Business Rules (BR-XXX)"
  - Example: vote-processor prompt should reference BR-006 (STRONG_NO auto-reject), BR-010 (scoring weights)
  - Recommendation: Create prompt checklist that includes BRD validation before code generation

**Potential Gaps Identified**:
1. **MEDIUM PRIORITY**: Prompt templates don't explicitly require BRD validation
   - Templates reference architecture docs (LAMBDA_CATALOG.md) but not BRD requirements
   - Risk: Generated code may follow architecture patterns but miss business rules from BRD
   - Mitigation: Add BRD reference section to all prompt templates (e.g., "Business Rules to Validate: BR-006, BR-010")
2. **LOW PRIORITY**: No prompt template for Step Functions state machines
   - Guide covers Lambda, Terraform, Angular, tests, documentation
   - Missing: Step Functions state machine generation prompts
   - Impact: Minimal (only 2 state machines in POC: offer approval, background check)
3. **NON-ISSUE**: Prompt engineering approach is comprehensive and production-ready ✅
4. **NON-ISSUE**: Iterative refinement enables fixing gaps discovered during generation ✅

**Implementation Readiness**:
- Prompt templates are detailed and immediately usable ✅
- Examples demonstrate proper structure (60-150 line prompts with full context) ✅
- Advanced techniques (chain of thought, reference patterns, iterative refinement) enable complex code generation ✅
- Common pitfalls documented prevent AI generation mistakes ✅
- Quick reference library enables rapid prompt creation ✅
- **Action Required**: Enhance prompt templates to include BRD validation step (reference specific business rules in requirements section)

---

### 🎯 All 8 Documents Read - Ready for Validation

**Documents Completed**:
1. ✅ DYNAMODB_SCHEMA_DESIGN.md (1,010 lines) - Single-table design, 3 tables, GSIs, schema patterns
2. ✅ EVENTBRIDGE_PATTERNS.md (961 lines) - 11 event types, 6 rules, content-based routing, error handling
3. ✅ LAMBDA_CATALOG.md (1,126 lines) - 7 Lambda specs, API endpoints, scoring algorithm, **CRITICAL GAPS FOUND**
4. ✅ STEP_FUNCTIONS_ORCHESTRATION.md (790 lines) - Long-running workflows, callback pattern, saga compensation
5. ✅ TERRAFORM_MODULE_STRUCTURE.md (1,040 lines) - 7 reusable modules, deployment workflow, cost optimization
6. ✅ MIGRATION_PATHS.md (519 lines) - 4 maturity levels, migration execution plans, risk mitigation
7. ✅ COST_BREAKDOWN.md (570 lines) - **POC runs at $0/month**, detailed cost analysis, ROI validation
8. ✅ AI_DEVELOPMENT_GUIDE.md (999 lines) - Prompt templates, advanced techniques, common pitfalls

**Total Lines Read**: 7,015 lines of technical documentation ✅

---

**Next Document to Read**: AI_DEVELOPMENT_GUIDE.md (Final document - AI-assisted development workflow, prompt templates for code generation, context management strategies)

**Why Continue Reading**:
- DynamoDB schema provides solid data foundation ✅
- EventBridge routing patterns support BRD escalation requirements ✅
- **Lambda catalog revealed CRITICAL gaps**: Scoring weights mismatch, STRONG_NO logic missing, panel size hardcoded ⚠️
- **Step Functions patterns validated** for long-running workflows (offer approval, background checks) ✅
- **Terraform modules ready** for infrastructure deployment with cost optimization ✅
- **Migration strategy complete** with 4 maturity levels, clear trigger conditions, rollback plans ✅
- **Cost breakdown VALIDATED**: POC runs at **$0/month** using 100% AWS Free Tier, budget constraint satisfied ✅
- **New gaps identified**: Auto-approval thresholds undefined, offer expiration period not validated, manager approval timeout not specified, multi-tenancy schema change, panel size assumption reconfirmed (5th time) ⚠️
- Need to review AI development guide for code generation efficiency and prompt engineering best practices
- Complete technical picture needed before creating comprehensive alignment validation document

### 📋 Next Steps After Reading

1. **Create**: `ARCHITECTURE_ALIGNMENT_VALIDATION.md` document
2. **Validate**:
   - All 10 stakeholder needs → Architecture components mapping
   - All business rules (21 rules) → Lambda implementation verification
   - All SLAs (10 SLAs) → SLA Monitor coverage check
   - All UI components (11 components) → DynamoDB schema support validation
   - MVP delivery alignment (UX/UI MVP 1-3 vs Architecture Weeks 1-12)
3. **Identify**: Critical gaps, high-priority gaps, medium gaps
4. **Recommend**: Fixes and adjustments before implementation starts
5. **Decide**: Confirm MVP1, MVP2, MVP3 scope and breakdown

### 🔖 Resume Instructions (If Session Terminates)

**To resume this session**:
1. Read PROJECT_CONTEXT.md (this file)
2. Navigate to "Current Session State" section (this section)
3. Note: **ALL 8 ARCHITECTURE DOCUMENTS READ** ✅ **COMPLETE**
4. Review "Critical Gaps Identified" section for all confirmed misalignments
5. Proceed to create: **ARCHITECTURE_ALIGNMENT_VALIDATION.md**
6. Validate BRD/UX/UI alignment with complete architecture context

**Key Context Fully Captured**:
- All BRD requirements are in PROJECT_CONTEXT.md (Business Requirements section) ✅
- All UX/UI design is in PROJECT_CONTEXT.md (UX/UI Design section) ✅
- 4 priority architecture documents were read earlier (POC Architecture, Maturity Levels, Roadmap, HADES Mapping) ✅
- **8 detailed architecture documents now read** (DynamoDB, EventBridge, Lambda Catalog, Step Functions, Terraform, Migration Paths, Cost Breakdown, AI Development Guide) with comprehensive context ✅
- **Total Lines Read**: 7,015 lines of technical documentation ✅
- **CRITICAL GAPS CONFIRMED**: Scoring weights mismatch, STRONG_NO logic missing, panel size hardcoded (confirmed 5 times across documents), SLA coverage incomplete
- **ADDITIONAL GAPS IDENTIFIED**: Auto-approval thresholds undefined, offer expiration period not validated, manager approval timeout not specified, multi-tenancy schema change consideration, 12-month free tier expiration planning, BRD references missing from AI prompts
- **POC BUDGET VALIDATED**: POC runs at $0/month using 100% AWS Free Tier (target was <$50/month) ✅
- All gaps documented in "Critical Gaps Identified" section above

**Current Checkpoint**: ✅ **READING PHASE COMPLETE** - Ready to create ARCHITECTURE_ALIGNMENT_VALIDATION.md

**Session Continuity**: ✅ Fully backed up and resumable

---

## Project Overview

### What We're Building
**Talent Flow Platform** - An event-driven orchestration platform for managing the complete 12-stage hiring lifecycle, from candidate sourcing to onboarding.

### Key Constraints
- **Budget**: <$50/month for POC
- **Scale**: 1,000 events/day POC → 10-30x at maturity
- **Timeline**: Dictated by AI-assisted development effectiveness
- **Developer**: Solo build with extensive Claude AI assistance
- **Approach**: Incremental delivery (Stage 1-3 first, then expand)

### Success Criteria (POC)
- 10 candidates processed successfully
- 1 department using the system
- 2 managers actively engaging
- All 12 stages functional
- <$50/month AWS costs

---

## Business Requirements (From BRD v1.0)

### Executive Summary
**Vision**: Transform hiring from disconnected administrative tasks into a measurable, orchestrated, and accountable operational workflow where **"the process itself becomes the product."**

**The Problem We Solve**:
- Industry candidate ghosting rate: 15-22% between offer acceptance and Day 1
- Day-1 failures where equipment, access, or introductions are not ready
- Compliance gaps discovered after candidate has started
- No visibility into which department caused onboarding failure
- Inability to measure or improve onboarding experience systematically

**The Solution**: Treat onboarding as a **workflow orchestration problem**, not a documentation problem. Every lifecycle stage is a workflow state, every stakeholder is an actor with operational accountability, and every KPI is a measurable SLA.

### Operational Goals
- Reduce average time-to-first-engagement to under 48 hours from offer acceptance
- Achieve 100% Day-1 readiness on equipment, access, and engagement dimensions
- Reduce offer acceptance-to-onboarding dropout rate by 40%+
- Reduce compliance workflow cycle time by eliminating manual tracking
- Enable HR leaders to identify provisioning and engagement bottlenecks in real time
- Create an immutable audit trail for every workflow transition for regulatory compliance

### Complete 12-Stage Workflow

| Stage | Purpose | Key Actors | SLA | Critical Gates |
|-------|---------|------------|-----|----------------|
| **1. First Interview Completed** | Capture initial interview outcome | HR, Panel | 24h evaluation submission | All panel evaluations submitted |
| **2. Candidate Evaluation & Shortlisting** | Aggregate scores, produce weighted recommendation | HR, Hiring Mgr, Panel | 24h decision | Weighted avg ≥6.0/10 to proceed |
| **3. Second Interview Scheduled** | Schedule next round, prepare evaluation workspace | HR, Hiring Mgr | 5 business days | Stage 2 approved |
| **4. Second Interview Conducted** | Execute second interview, capture structured evaluation | HR, Hiring Mgr, Panel | 24h evaluation submission | Interview in SCHEDULED state |
| **5. Final Decision** | Make final HIRE or REJECT decision | Hiring Mgr, HR Director | 24h decision | 60% YES/STRONG_YES votes required |
| **6. Offer Creation & Approval** | Create, validate, approve offer package | HR, Finance, HR Director | 2 business days | CTC within band, Finance approval |
| **7. Offer Sent** | Deliver formal offer to candidate | HR | 5 business days response | Offer approval complete |
| **8. Offer Accepted (Conversion Point)** | Capture acceptance + sentiment, trigger ALL downstream workflows | HR, Candidate | 48h first engagement | Sentiment capture mandatory |
| **9. Pre-Onboarding & Compliance** | Complete all statutory/regulatory requirements | Compliance, Security, HR | Varies by template | All clearances CLEARED |
| **10. IT & Facilities Provisioning** | Ensure all technical and physical resources provisioned | IT Admin, Facilities | 2 days before start date | Compliance cleared (Stage 9) |
| **11. First Engagement Touchpoint** | Ensure meaningful human connection within 48h of acceptance | Hiring Mgr, HR | 48h from acceptance | Engagement logged |
| **12. Day 1 Activation** | Verify all readiness dimensions complete | HR, IT, Hiring Mgr | Start date reached | Readiness score ≥80% |

### Stage 8: The Conversion Point
**Critical Insight**: Stage 8 (Offer Accepted) is the platform's orchestration trigger. At this moment, ALL downstream workflows activate simultaneously, not sequentially:
- ✅ Provisioning tasks created
- ✅ Compliance workflow initiated
- ✅ Engagement SLA timer started (48h countdown begins)
- ✅ Hiring Manager tasked with welcome call
- ✅ IT and Facilities teams notified

**Sentiment Capture**: Mandatory field at acceptance with workflow branching:
- **EXCITED** → Standard flow
- **NEUTRAL** → Standard flow with monitoring
- **HESITANT** → Reassurance Engagement task generated + HR alert
- **RELUCTANT** → URGENT escalation to Hiring Manager AND HR Director

### Key Stakeholders & Their Needs

| Stakeholder | Primary Need | Key Pain Point | System Interaction |
|-------------|--------------|----------------|-------------------|
| **HR Operations Manager** | Reduce manual follow-up, gain pipeline visibility | Siloed systems, manual status chasing | Dashboard, pipeline view, compliance tracking |
| **Hiring Manager** | Smooth team integration, avoid Day-1 failure | No visibility into onboarding progress | Evaluation workspace, engagement scheduling |
| **Interview Panel Member** | Collaborate with panel, contribute to objective hiring | Unstructured feedback capture | Evaluation scoring panel, voting controls |
| **Candidate** | Clarity on process status, smooth Day-1 experience | Black hole communications, delayed provisioning | Candidate portal (limited), email/WhatsApp |
| **IT Administrator** | Complete provisioning on time with clear deadlines | Last-minute requests, no visibility into start dates | Provisioning board, checklist interface |
| **Facilities Manager** | Know start dates early | Short lead times, no IT integration | Facilities checklist, provisioning board |
| **Compliance Officer** | Zero compliance gaps, auditable records | Manual status updates, no workflow visibility | Compliance dashboard, clearance tracking |
| **Security Officer** | Accurate clearance records, full audit trail | Paper-based processes with no digital tracking | Security clearance module, audit log |
| **Finance Lead** | Ensure compensation within budget | Slow approval chains | Offer approval workflow |
| **HR Director / Executive** | Organisation-wide visibility, trend analysis | Lack of cross-functional data | Executive dashboard, analytics views |

### Business Rules Summary

#### Evaluation Rules
- Minimum 1 panel member required
- All assigned panel members must submit before evaluation closes
- Weighted score: Technical 30%, Communication 25%, Cultural Fit 25%, Problem Solving 20%
- Minimum weighted average of 6.0/10 to proceed
- Any STRONG_NO vote triggers mandatory HR Director review
- Panel evaluation must be submitted within 24h (SLA enforced)

#### Offer Rules
- Offer CTC must be within approved compensation band
- CTC above band requires Finance Lead approval
- All senior-level offers require HR Director sign-off
- Offer locked from editing once SENT
- Offer expires after 5 business days without response (configurable)
- Acceptance sentiment is mandatory field

#### Compliance Rules
- Stage 10 (IT Provisioning) blocked until all mandatory clearances CLEARED
- Government flow: All 4 clearances mandatory (Background, Character, Medical, Security)
- Standard flow: Background check mandatory, others configurable
- Manual override requires authoriser identity, reason, timestamp (full audit trail)
- FAILED clearance requires HR + Compliance Officer review

#### Engagement Rules
- First engagement must occur within 48h of offer acceptance (SLA enforced)
- HESITANT acceptance triggers Reassurance Engagement task type
- RELUCTANT acceptance triggers immediate escalation to Hiring Manager AND HR Director
- If no engagement logged by 72h → automatic ENGAGEMENT_AT_RISK flag

#### Readiness Scoring Rules
- Day-1 Readiness Score = (Equipment 33.3% + Access 33.3% + Human Engagement 33.3%)
- Score 80-100% = PASS (Activate candidate)
- Score 60-79% = HR Review Required (gaps resolved before EOD)
- Score <60% = Critical Failure (HR Director escalation, Day-1 crisis protocol)

### SLA Framework

| SLA ID | Stage | SLA | Escalation Path |
|--------|-------|-----|----------------|
| SLA-001 | Panel Evaluation | 24h from interview | 24h: Reminder → 48h: HR Escalation |
| SLA-002 | Shortlist Decision | 24h from evaluation | 24h: HR Director notified |
| SLA-003 | Interview 2 Scheduling | 5 business days | Alert to HR; candidate notified |
| SLA-004 | Final Hire Decision | 24h from final evaluation | HR Director notified |
| SLA-005 | Offer Creation & Approval | 2 business days | 1 day: Finance reminder → 2 days: HR Director |
| SLA-006 | Offer Acceptance Window | 5 business days | 3 days: Reminder → 5 days: HM engagement |
| SLA-007 | First Engagement | 48h from acceptance | 24h: nudge → 36h: warning → 48h: HR alert → 72h: Director escalation |
| SLA-008 | Compliance (Standard) | Background: 5 business days | +2 days: Compliance alert |
| SLA-009 | Security Clearance (Gov) | 15 business days | +3 days: Compliance escalation |
| SLA-010 | IT Provisioning | 2 business days before start | -3 days: IT alert → -1 day: HR Director |

### Workflow Templates
The platform supports **configurable workflow templates** for different industries:
- **Standard**: Corporate hiring (standard compliance)
- **Government**: 4-clearance mandatory flow (Background, Character, Medical, Security)
- **Banking/Finance**: Enhanced compliance + regulatory requirements
- **Agricultural**: Rapid-hire workflows with reduced compliance

### Strategic Differentiators
1. **Engagement as an SLA**: Enforces welcome calls as timed operational commitments with escalation paths
2. **Configurable Workflow Templates**: JSON-based templates enable same engine to run multiple industry flows
3. **Dual-Ledger Operational Intelligence**: System of Record (current state) + System of Truth (immutable events)
4. **The Conversion Point**: Stage 8 triggers all downstream workflows simultaneously
5. **Government-Ready Compliance Engine**: Native support for statutory clearance workflows with wait-state orchestration

---

## UX/UI Design (From UXUI v1.0)

### UX Philosophy
**Core Principle**: This is an **operational workflow platform** — not a form-filling tool. Every UX decision serves operational goals: reduce cognitive load, surface SLA risks before breaches, give stakeholders exactly the information relevant to their role, make workflow state visible at a glance.

### UX Principles

| Principle | Application |
|-----------|-------------|
| **Workflow Visibility First** | Primary user need: "What needs my attention right now?" Every screen answers this first |
| **Progressive Disclosure** | Show essential operational view first. Reveal depth on demand. Never overwhelm with irrelevance |
| **State-Driven Interfaces** | UI reflects backend workflow states. Components render conditionally based on candidate/workflow state |
| **Role-Aware Rendering** | Each user role sees only what's relevant and permitted (IT sees provisioning, Compliance sees clearances, Finance sees offer approval) |
| **Operational Accountability** | Every action is visible, attributed, and timestamped. Users understand actions are part of auditable operational record |
| **SLA Awareness** | Time is operational currency. UI communicates time remaining, time elapsed, and SLA health (green/amber/red) as persistent visual language |
| **Contextual Action** | Users never navigate away for most important action. Actions surface in context (approve offer, log engagement, mark item ready) |

### Enterprise UX Patterns Applied
- **Kanban Pipeline View**: Candidate pipeline across stages
- **Master-Detail Workspace**: Candidate record with contextual side panels
- **Checklist with Status Indicators**: Provisioning, clearances, readiness
- **SLA Progress Bars**: Visual time remaining on active SLAs
- **Stepper / Stage Selector**: Interview round progression
- **Score Cards & Gauges**: Evaluation scores, Day-1 readiness score
- **Activity Feed / Timeline**: Audit trail, recent activity
- **Approval Chain Visualisation**: Offer approval flow
- **Alert Banners & Notification Badges**: Urgent escalations, SLA breaches
- **Role-Based Dashboards**: Personalised operational workspaces per role

### Information Architecture

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
│   └── [Candidate Record] — master detail
│       ├── Profile
│       ├── Interview History
│       ├── Evaluations
│       ├── Offer
│       ├── Compliance
│       ├── Provisioning
│       ├── Engagement
│       └── Activity Log
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

### Key UI Components

| Component | Purpose | Key States |
|-----------|---------|-----------|
| **Stage Selector** | Primary workflow state visualization and navigation | completed (green tick), current (blue highlight), pending (grey), locked, error |
| **Candidate Identity Card** | Compact visual identity block at top of every candidate screen | standard, at-risk (amber), escalation (red) |
| **Evaluation Scoring Panel** | Per-panel-member evaluation with dimension sliders and vote selector | draft, submitted, late, locked |
| **Evaluation Summary Widget** | Aggregated panel evaluation summary after all submissions | Shows weighted average, vote distribution, category breakdown |
| **SLA Timer Widget** | Persistent time-remaining indicator for active SLA commitments | Green (>50%), Amber (25-50%), Red (<25% or breached), pulse animation when critical |
| **Clearance Tracker** | Visual status board for all candidate clearances | NOT_STARTED, IN_PROGRESS, CLEARED, FAILED, OVERRIDDEN |
| **Provisioning Board** | Checklist-style provisioning status board per candidate | NOT_STARTED → IN_PROGRESS → READY |
| **Engagement Log** | Log and display engagement touchpoints with SLA context | Includes SLA timer, engagement type, notes, response quality |
| **Readiness Score Gauge** | Composite Day-1 readiness visualization (0-100%) | PASS (green), HR REVIEW (amber), CRITICAL FAILURE (red) |
| **Audit Timeline** | Immutable chronological record of all workflow events | Vertical timeline with timestamp, actor, event type, state change |
| **Pipeline Kanban** | Visual overview of all candidates across workflow stages | Drag-and-drop disabled (workflow-gated transitions only) |

### Screen Inventory (13 Primary Screens)

1. **HR Dashboard (Home)**: Alert banners, KPI strip, pipeline cards, upcoming starts
2. **Candidate Pipeline (Kanban)**: Stage columns, candidate cards with SLA health indicators
3. **Add New Candidate**: 4-step form with workflow template selection
4. **Candidate Workspace (Master Record)**: Master-detail with tabs (Profile, Interviews, Offer, Compliance, Provisioning, Engagement, Activity)
5. **Interview Evaluation Workspace**: Stage selector, psychometric section, panel scoring, evaluation summary
6. **Offer Management**: Offer form, approval chain visualization, acceptance sentiment capture
7. **Compliance Dashboard**: Clearance status rows, SLA breach alerts, manual override capability
8. **IT Provisioning Board**: Candidate cards with provisioning checklists, urgency color coding
9. **Engagement & SLA Workspace**: Engagement task list, SLA timers, quick-log form
10. **Day-1 Readiness Dashboard**: Readiness gauges, dimension breakdown, action items
11. **Candidate Experience Survey**: Post-onboarding feedback (5 days post Day-1)
12. **Analytics & Reporting Hub**: Pipeline overview, engagement analytics, SLA performance, bottleneck analysis
13. **Workflow Template Management (Admin)**: Template list, drag-and-drop stage builder, JSON preview

### Design System
**Brand Colors**:
- Primary: Deep blue (#1A3C8F)
- Interactive: Accent blue (#2563EB)
- Background: White with light grey sections (#F8F9FA)
- Success: Green (#10B981)
- Warning: Amber (#F59E0B)
- Critical: Red (#EF4444)
- Override: Purple (clearance overrides)

**Typography**: Inter or Roboto at various weights
**Aesthetic**: Professional enterprise SaaS — clean, data-dense but not cluttered (similar to Salesforce Service Cloud, Linear, Notion)

### Mobile & Responsive Strategy

**Mobile-Priority Interactions** (must be fully functional on phone):
- Log engagement touchpoint (dedicated full-screen mobile form, 3 fields max)
- View SLA status for assigned candidates (card-based list, color-coded)
- Approve offers (swipe-to-approve + confirmation modal)
- Mark provisioning item READY (single-tap toggle)
- Receive and acknowledge SLA breach alerts (push notification with deep link)

**Responsive Breakpoints**:
- Mobile (<768px): Single column, bottom nav, condensed cards
- Tablet (768-1024px): Two-column master-detail, side drawer nav
- Desktop (>1024px): Full workspace layout, persistent sidebar, multi-panel
- Wide (>1440px): Wide content columns, expanded data tables, full analytics

### Accessibility Standards
- **WCAG 2.1 AA** compliance minimum
- **Colour contrast**: 4.5:1 for text, 3:1 for large text/UI components
- **Keyboard navigation**: Full operability across all workflows
- **Screen reader support**: ARIA labels on all interactive elements, status regions for live updates
- **Focus management**: Logical tab order; focus returns to trigger after modal close
- **Motion**: Respect OS-level reduced motion settings
- **Error identification**: Errors described in text, not colour alone

### MVP Delivery Strategy

**MVP 1 — The Evaluation Core (Sprint 1-2, 4 weeks)**
- **Objective**: Prove structured evaluation platform works
- **Features**: Candidate creation, stage selector (4 stages), panel assignment, evaluation scoring (4 dimensions + sliders), structured voting, STRONG_NO escalation, evaluation summary, email notifications, basic pipeline list
- **Excluded**: Psychometric assessments, offer workflow, compliance, provisioning, engagement tracking
- **Value**: Eliminates unstructured hiring decisions, creates first audit trail
- **Risk**: Low

**MVP 2 — The Offer & Conversion Engine (Sprint 3-4, 4 weeks)**
- **Objective**: Operationalise offer lifecycle and conversion trigger
- **Features**: Offer creation form, approval chain (Finance + HR Director), offer tracking, acceptance sentiment capture (mandatory), HESITANT/RELUCTANT escalation, engagement task creation, engagement log, 48h SLA timer, SLA breach alerts
- **Excluded**: Compliance workflows, IT provisioning, advanced analytics
- **Value**: Eliminates post-acceptance black hole, creates first measurable engagement SLA
- **Risk**: Medium (approval chain logic nuanced)

**MVP 3 — Onboarding Operations (Sprint 5-7, 6 weeks)**
- **Objective**: Close loop from acceptance to Day-1 readiness
- **Features**: Compliance clearance tracker (standard flow), IT provisioning board (standard checklist), compliance gate blocking IT provisioning, Day-1 readiness score calculation, readiness dashboard, candidate experience survey, full audit timeline
- **Excluded**: Government compliance module, psychometric assessments, analytics hub
- **Value**: Full MVP lifecycle from creation to Day-1 activation, measurable readiness score, end-to-end audit trail
- **Risk**: Medium (compliance gating requires robust state engine)

**Enterprise Phase (Sprint 8-12, 8 weeks)**
- **Features**: Workflow template management (JSON-driven), dynamic frontend workflow rendering, full analytics/reporting hub, executive dashboard, RBAC/PBAC, psychometric assessment module, full pipeline Kanban, mobile-optimised engagement logging, multi-stage interview support
- **Value**: Platform is commercially viable as standalone enterprise SaaS product

**Government Compliance Phase (Post-Enterprise)**
- **Features**: Government workflow template (4-clearance mandatory), security clearance wait-state orchestration, government IT provisioning (eOffice, HRMS, PFMS, Gov Email), manual override with audit trail, compliance export reports, Security Officer role
- **Value**: Opens regulated industry market (government, banking, defence)

**AI/Agentic Phase (Post-Market Validation)**
- **Phase 2 (Intelligence)**: Sentiment extraction, interview summarization, onboarding risk scoring, NPS sentiment analysis
- **Phase 3 (Agentic)**: Proactive SLA nudge agent, workflow optimization suggestions, intelligent escalation routing, predictive ghosting detection

### Total Timeline to Market
- **MVP to Enterprise-Grade**: ~6 months (14 weeks)
- **MVP to Market-Ready SaaS**: ~9 months (includes Government Phase)

---

## Architectural Foundation

### Pattern Source: HADES Architecture
This project is NOT designed from scratch. It's based on proven enterprise patterns from the **HADES Deceased Estates Platform** (also architected by the project owner).

**Critical HADES Documents Analyzed**:
1. `HADES_SYSTEM_DOCUMENTATION.md`
2. `deceased-estates-hades-comprehensive-architecture.md`
3. `COMPLETE_EVENT_STREAM_ARCHITECTURE.md`
4. `DMS_API_EXPOSURE_IDEAS.md`

**Why HADES Matters**:
- Proven at enterprise scale (EKS + Kafka + Aurora PostgreSQL)
- Cost: ~$600/month baseline
- Our Goal: Apply same patterns in serverless POC at <$50/month (12x cost reduction)

---

## Core Architectural Patterns (From HADES)

### HADES to Serverless Pattern Translation

**Cost Reduction Achievement**: 98.9% ($700/month → $8/month)

**Confidence Statement**: *"The POC is not a prototype. It's the real architecture at serverless scale. The patterns you're learning now will carry you to 100,000 workflows/day at Maturity Level 3."*

### 1. Event-Driven Saga Orchestration
**HADES Pattern**:
- 3 stages: RESTRICT → MANAGE → CLOSE
- Each stage has multiple domain executions
- Feedback loop aggregation determines stage completion
- MSK Kafka event bus (~$350/month)
- Spring Boot State Store on EKS (~$150/month)

**Talent Flow Mapping**:
- 12 stages: Evaluation → Selection → Offer → Onboarding → ...
- Each stage has multiple activities (interview, vote, feedback)
- Same feedback aggregation pattern
- EventBridge + SQS ($0/month within free tier)
- Lambda Workflow Orchestrator ($0/month within free tier)

**Pattern Preserved**: ✅ Saga orchestration, stage-based workflow, feedback aggregation
**What Changed**: Infrastructure (Kubernetes → Serverless), Event bus (Kafka → EventBridge)

### 2. Domain Autonomy
**HADES Pattern**:
- No REST calls between domains
- Event-based communication only
- Each domain publishes domain events
- Centralized state store aggregates feedback
- 7+ microservices on EKS

**Talent Flow Mapping**:
- No direct Lambda-to-Lambda calls
- All communication via EventBridge
- Each Lambda publishes events
- Feedback aggregator updates workflow state
- 7 Lambda functions (same domain boundaries)

**Pattern Preserved**: ✅ Domain autonomy, event-driven communication, bounded contexts
**What Changed**: Compute (EKS microservices → Lambda functions)

### 3. Dual-Ledger Architecture
**HADES Pattern**:
- Operational State: Aurora PostgreSQL (current workflow state) (~$150/month)
- Event Audit: Kafka retention (immutable event log) (~$350/month)
- Two independent systems of truth

**Talent Flow Mapping**:
- Operational State: DynamoDB `candidate-pipeline` table (~$5/month)
- Event Audit: DynamoDB `event-ledger` table (~$0.25/month)
- Two independent tables (operational vs audit)

**Pattern Preserved**: ✅ Dual-ledger, immutable audit trail, operational state separation
**What Changed**: Database (PostgreSQL + Kafka → DynamoDB single-table design)

### 4. Long-Running Wait States
**HADES Pattern**:
- Workflows can wait months (e.g., waiting for client documents)
- No polling, event-driven resumption
- Spring State Machine + PostgreSQL persistence

**Talent Flow Mapping**:
- Workflows can wait days/weeks (e.g., background checks, offer acceptance)
- Step Functions Standard (wait states up to 1 year) (~$1/month)
- EventBridge callback pattern for resumption
- No polling required

**Pattern Preserved**: ✅ Long-running workflows, wait states, event-driven resumption
**What Changed**: Orchestration engine (Spring State Machine → Step Functions)

### 5. SLA Tracking
**HADES Pattern**:
- Spring Scheduler (hourly cron job)
- Queries PostgreSQL for SLA breaches
- Per-domain SLA tracking
- Escalation events when SLA breached

**Talent Flow Mapping**:
- EventBridge Scheduler (hourly cron) ($0/month)
- Scans DynamoDB GSI for SLA breaches
- Per-stage SLA tracking
- Automated escalation events published to EventBridge

**Pattern Preserved**: ✅ SLA monitoring, breach detection, escalation workflow
**What Changed**: Scheduler (Spring Scheduler → EventBridge Scheduler)

### 6. Feedback Loop Pattern
**HADES Pattern**:
```
Domain Event → Kafka Topic → Feedback Proxy → deceased-feedback-events
  → State Store Consumer → PostgreSQL Update → Saga Completion Check
```

**Talent Flow Mapping**:
```
Domain Event → EventBridge → Domain Lambda → SQS Feedback Queue
  → Feedback Aggregator → DynamoDB Update → Saga Completion Check
```

**Pattern Preserved**: ✅ Feedback aggregation, saga completion detection
**What Changed**: Message bus (Kafka → SQS), Database (PostgreSQL → DynamoDB)

### 7. Dual-Event Pattern
**HADES Pattern**:
- **Status Event**: `ClientBecameDeceased` (status change)
- **Orchestration Event**: `DeceasedEstateStageStarted` (workflow instruction)
- Two independent event streams (status ≠ process)

**Talent Flow Mapping**:
- **Status Event**: `CandidateStatusChanged` (status change)
- **Orchestration Event**: `WorkflowStageStarted` (workflow instruction)
- Two independent event streams on same bus

**Pattern Preserved**: ✅ Status vs orchestration separation, resilience
**What Changed**: Event bus (separate Kafka topics → EventBridge with filtering)

### Non-Negotiable Patterns (100% Preserved)

✅ **Event-driven architecture** (no synchronous cross-domain calls)
✅ **Saga pattern** (multi-stage orchestration with compensation)
✅ **Domain autonomy** (bounded contexts, independent deployment)
✅ **Feedback loop** (aggregate feedback before state updates)
✅ **SLA tracking** (per-domain/per-stage monitoring)
✅ **Dual-event pattern** (status vs orchestration)
✅ **Audit trail** (immutable event log for compliance)
✅ **Correlation IDs** (distributed tracing across services)
✅ **Idempotency** (safe retries, external ID patterns)
✅ **Long-running workflows** (wait states without polling)

---

## Technology Stack Decisions

### AWS Services (Finalized)
| Service | Purpose | HADES Equivalent | Cost Impact |
|---------|---------|------------------|-------------|
| **EventBridge** | Event routing | Kafka (MSK) | -95% cost |
| **DynamoDB** | Operational + Audit data | PostgreSQL + Kafka | -90% cost |
| **Lambda** | Compute | Spring Boot on EKS | -98% cost (pay-per-use) |
| **SQS** | Feedback queues | Kafka topics | -90% cost |
| **SNS** | Notifications | External SMTP | Similar cost |
| **Step Functions** | Long-running workflows | Spring State Machine | -95% cost |
| **S3** | Document storage | PostgreSQL BLOB | -80% cost |

### Infrastructure as Code
- **Choice**: Terraform
- **Rationale**: Already have Terraform modules for other project components
- **Strategy**: Create reusable modules for Lambda, EventBridge, DynamoDB

### Runtime
- **Lambda Runtime**: Node.js 20.x
- **Rationale**: Fast cold starts, excellent AWS SDK support, good for AI code generation

---

## Detailed POC Architecture (Stage 1-3)

### Component Overview

**Focus**: Evaluation Intelligence (First 3 stages of 12-stage workflow)

**Stages Implemented in POC**:
1. **INTERVIEW_1**: First interview → Panel evaluation → Voting → Score calculation
2. **INTERVIEW_2**: Second interview → Panel evaluation → Voting → Score calculation
3. **OFFER**: Offer creation → Approval workflow (placeholder for Week 5-8)

### 7 Lambda Functions (Complete Catalog)

#### 1. API Handler
- **Purpose**: Entry point for all REST API requests
- **Trigger**: API Gateway (synchronous invocation)
- **Responsibilities**:
  - Input validation (JSON schema with Ajv)
  - Correlation ID generation (UUID v4)
  - Publishes events to EventBridge
  - Returns 202 Accepted (async processing)
- **Events Published**: `CandidateCreated`, `InterviewScheduled`, `VoteSubmitted`
- **DynamoDB Operations**: Write to `candidate-pipeline` + `event-ledger`
- **Memory**: 512 MB | **Timeout**: 30 seconds
- **Cost**: $0 (within free tier)

#### 2. Workflow Orchestrator
- **Purpose**: Creates saga state and starts workflow execution
- **Trigger**: EventBridge rule (`DetailType = 'CandidateCreated'`)
- **Responsibilities**:
  - Creates workflow state in `workflow-state` table
  - Initializes Stage 1-3 records (SAGA + STAGE + TRACKER records)
  - Publishes `WorkflowStageStarted` event
  - Starts Step Functions execution
- **Events Published**: `WorkflowStageStarted`
- **DynamoDB Operations**: Write to `workflow-state` table (7 items: 1 SAGA + 3 STAGE + 3 TRACKER)
- **Memory**: 512 MB | **Timeout**: 5 minutes
- **Cost**: $0 (within free tier)

#### 3. Interview Scheduler
- **Purpose**: Handles interview scheduling logic
- **Trigger**: EventBridge rule (`DetailType = 'InterviewScheduled'`)
- **Responsibilities**:
  - Sends calendar invites via SNS → Email
  - Updates candidate state in `candidate-pipeline`
  - Logs to audit ledger
- **Events Consumed**: `InterviewScheduled`
- **SQS Integration**: Publishes to notification queue
- **Memory**: 512 MB | **Timeout**: 30 seconds
- **Cost**: $0 (within free tier)

#### 4. Vote Processor
- **Purpose**: Processes evaluation votes and calculates scores
- **Trigger**: EventBridge rule (`DetailType = 'VoteSubmitted'`)
- **Responsibilities**:
  - Stores vote in `candidate-pipeline` table
  - Checks if all required votes received (query by PK, filter SK begins_with `VOTE#`)
  - Calculates weighted scores:
    - Technical: 30%
    - Communication: 25%
    - Cultural Fit: 25%
    - Problem Solving: 20%
  - If voting complete → publishes `VotingCompleted` event
- **Scoring Formula**:
  ```javascript
  overallScore = (technical * 0.3) + (communication * 0.25) +
                 (culturalFit * 0.25) + (problemSolving * 0.2)
  ```
- **Events Published**: `VotingCompleted` (conditional)
- **Memory**: 512 MB | **Timeout**: 5 minutes
- **Cost**: $0 (within free tier)

#### 5. Evaluation Completer
- **Purpose**: Finalizes evaluation stage when voting complete
- **Trigger**: EventBridge rule (`DetailType = 'VotingCompleted'`)
- **Responsibilities**:
  - Updates `workflow-state` table (mark STAGE endedAt)
  - Publishes `EvaluationCompleted` event
  - Publishes `WorkflowStageStarted` for next stage (if score passes threshold)
- **Business Rule**: Minimum score 6.0/10 to proceed to next stage
- **Events Published**: `EvaluationCompleted`, `WorkflowStageStarted` (next stage)
- **Memory**: 512 MB | **Timeout**: 30 seconds
- **Cost**: $0 (within free tier)

#### 6. Notification Service
- **Purpose**: Generic notification handler (email, SMS, Slack)
- **Trigger**: SQS queue (`talent-flow-notification-queue`)
- **Responsibilities**:
  - Routes to appropriate channel (EMAIL, SMS, SLACK) based on message type
  - Uses AWS SES for email delivery
  - Implements email templates (interview scheduled, vote reminder, evaluation completed)
  - Logs delivery status to CloudWatch
  - Deletes SQS message on successful delivery
- **Event Subscriptions**: Multiple (via EventBridge rules → SQS)
  - `CandidateCreated` → Welcome email
  - `InterviewScheduled` → Calendar invite
  - `VotingCompleted` → Hiring manager notification
  - `SLABreached` → Escalation email
- **Memory**: 512 MB | **Timeout**: 30 seconds
- **Cost**: $0 (SNS within free tier)

#### 7. SLA Monitor
- **Purpose**: Detects and escalates SLA breaches
- **Trigger**: EventBridge Scheduler (cron: `rate(1 hour)`)
- **Responsibilities**:
  - Scans DynamoDB `workflow-state` using GSI `SLA-Index`
  - Filter: `status = STARTED AND slaDueAt < NOW`
  - For each breach: publishes `SLABreached` event
  - Updates escalation counter in DynamoDB
  - Sends escalation notifications via SNS
- **SLA Thresholds**:
  ```javascript
  INTERVIEW_1: {
    SCHEDULING: 24 hours,
    VOTING: 48 hours
  }
  INTERVIEW_2: {
    SCHEDULING: 48 hours,
    VOTING: 48 hours
  }
  OFFER: {
    CREATION: 24 hours,
    APPROVAL: 48 hours
  }
  ```
- **Events Published**: `SLABreached`
- **Memory**: 512 MB | **Timeout**: 5 minutes
- **Cost**: $0 (within free tier, 720 invocations/month)

### 3 DynamoDB Tables (Detailed Schema)

#### Table 1: `candidate-pipeline` (Operational State)
**Purpose**: Current operational state of all candidates

**Billing**: On-Demand (no capacity planning, cost-effective at POC scale)

**Single-Table Design**:
| PK | SK | Attributes |
|----|-----|-----------|
| `CANDIDATE#{id}` | `METADATA` | candidateId, firstName, lastName, email, phone, position, departmentId, source, status, stage, createdAt, updatedAt |
| `CANDIDATE#{id}` | `INTERVIEW#1` | interviewId, scheduledAt, conductedAt, interviewer, location, notes |
| `CANDIDATE#{id}` | `INTERVIEW#2` | interviewId, scheduledAt, conductedAt, interviewer, location, notes |
| `CANDIDATE#{id}` | `VOTE#INT1#{voterId}` | voterId, voterName, technicalScore, communicationScore, culturalFitScore, problemSolvingScore, recommendation, submittedAt |
| `CANDIDATE#{id}` | `SCORES` | technical, communication, culturalFit, problemSolving, overall, calculatedAt |

**Global Secondary Indexes**:
- **GSI1: Department-Stage-Index**
  - PK: `departmentId`
  - SK: `stage#createdAt`
  - Use case: List candidates by department and stage

- **GSI2: Stage-Sentiment-Index**
  - PK: `stage`
  - SK: `sentiment#createdAt`
  - Use case: Get all HESITANT candidates in OFFER stage (risk detection)

- **GSI3: Status-CreatedAt-Index**
  - PK: `status`
  - SK: `createdAt`
  - Use case: Time-range queries (candidates created in last 7 days)

**Cost**: ~$5/month (600k operations/month, 25 GB storage)

#### Table 2: `event-ledger` (Audit Trail)
**Purpose**: Immutable append-only event log for compliance

**Retention**: Indefinite (7-year compliance requirement)

**Schema**:
| PK | SK | Attributes |
|----|-----|-----------|
| `CANDIDATE#{id}` | `EVENT#{timestamp}#{eventId}` | eventId, eventType, source, correlationId, userId, serviceId, payload, timestamp |
| `CORRELATION#{id}` | `EVENT#{timestamp}#{eventId}` | (same - for distributed tracing queries) |

**Why Two Partitions**:
- Partition 1: Candidate-centric queries (audit trail UI)
- Partition 2: Correlation-centric queries (distributed tracing, debugging)

**GSI: EventType-Timestamp-Index**
- PK: `eventType`
- SK: `timestamp`
- Use case: Analytics queries (all `VoteSubmitted` events in date range)

**Example Audit Trail Query**:
```javascript
// Get full audit trail for candidate CAND-123
const auditTrail = await dynamodb.query({
  TableName: 'event-ledger',
  KeyConditionExpression: 'PK = :pk',
  ExpressionAttributeValues: { ':pk': 'CANDIDATE#CAND-123' },
  ScanIndexForward: true // chronological order
});
```

**Cost**: ~$0.25/month (900k writes/month)

#### Table 3: `workflow-state` (Saga Tracking)
**Purpose**: Multi-stage saga orchestration state

**Schema**:
| PK | SK | Attributes |
|----|-----|-----------|
| `WORKFLOW#{id}` | `SAGA` | workflowId, candidateId, initiatedAt, completedAt, source, correlationId |
| `WORKFLOW#{id}` | `STAGE#INTERVIEW_1` | stage, status (NOT_STARTED \| STARTED \| COMPLETED), startedAt, endedAt, slaDueAt |
| `WORKFLOW#{id}` | `STAGE#INTERVIEW_2` | (same as above) |
| `WORKFLOW#{id}` | `STAGE#OFFER` | (same as above) |
| `WORKFLOW#{id}` | `TRACKER#INTERVIEW_1#SCHEDULING` | domain, status, startedAt, slaDueAt, endedAt, escalationCount |
| `WORKFLOW#{id}` | `TRACKER#INTERVIEW_1#VOTING` | (same as above) |

**GSI1: CandidateId-Index**
- PK: `candidateId`
- SK: `workflowId`
- Use case: Get workflow by candidate ID

**GSI2: SLA-Index** (Used by SLA Monitor Lambda)
- PK: `status`
- SK: `slaDueAt`
- Use case: Find all STARTED stages with `slaDueAt < NOW` (SLA breaches)

**Cost**: ~$0.08/month (300k writes/month)

### Event Flow Architecture

**EventBridge Bus**: `talent-flow-bus` (Custom Event Bus)

**Event Routing Rules** (7 rules for Stage 1-3):

| Rule Name | Event Pattern | Target | Purpose |
|-----------|---------------|--------|---------|
| `candidate-created-to-orchestrator` | `DetailType = 'CandidateCreated'` | Lambda: Workflow Orchestrator | Start workflow |
| `interview-scheduled-to-scheduler` | `DetailType = 'InterviewScheduled'` | Lambda: Interview Scheduler | Send calendar invites |
| `vote-submitted-to-processor` | `DetailType = 'VoteSubmitted'` | Lambda: Vote Processor | Calculate scores |
| `voting-completed-to-completer` | `DetailType = 'VotingCompleted'` | Lambda: Evaluation Completer | Finalize stage |
| `all-events-to-ledger` | `source = 'talent-flow.*'` | Lambda: Audit Logger | Audit trail |
| `notifications` | `DetailType IN ['CandidateCreated', 'InterviewScheduled', 'SLABreached']` | SQS: notification-queue | Email notifications |
| `sla-breaches` | `DetailType = 'SLABreached'` | SNS: escalation-topic | Urgent alerts |

**Cost**: $0/month (90k event deliveries << 1M free tier)

### SQS Feedback Queue

**Queue**: `talent-flow-feedback-queue` (Standard, not FIFO for POC)

**Purpose**: Aggregate feedback from domain handlers before updating workflow state

**Configuration**:
- Visibility Timeout: 30 seconds
- Message Retention: 4 days
- Dead Letter Queue: `talent-flow-feedback-dlq`
- Max Receive Count: 3

**Message Format**:
```json
{
  "workflowId": "WF-uuid",
  "candidateId": "CAND-uuid",
  "stage": "INTERVIEW_1",
  "domain": "VOTING",
  "status": "COMPLETED",
  "detail": "All votes received, scores calculated",
  "timestamp": "2026-05-10T10:30:00Z",
  "correlationId": "corr-uuid"
}
```

**Cost**: $0/month (10k messages << 1M free tier)

### Step Functions (Workflow Orchestration)

**State Machine**: `evaluation-workflow` (Standard Workflow)

**Why Standard vs Express**:
- Supports wait states up to 1 year
- Execution history for debugging (90 days)
- Callback pattern with task tokens

**Key Patterns Used**:
1. **Wait States**: `"Type": "Wait", "Seconds": 259200` (3 days for voting)
2. **Task Tokens**: Resume workflow via callback when external event occurs
3. **Choice States**: Conditional routing based on voting results
4. **Retry Logic**: Automatic retries with exponential backoff

**Cost**: ~$0.25/month (10k state transitions)

### API Gateway (HTTP API)

**Endpoints**:
- POST `/api/v1/candidates` - Create candidate
- GET `/api/v1/candidates/{id}` - Get candidate details
- POST `/api/v1/interviews` - Schedule interview
- POST `/api/v1/votes` - Submit evaluation vote
- GET `/api/v1/workflows/{id}` - Get workflow status
- GET `/api/v1/workflows/{id}/audit` - Get audit trail

**Why HTTP API vs REST API**:
- 70% cheaper ($1 vs $3.50 per million requests)
- Lower latency (11ms vs 50ms p99)
- Native JWT authorizer support (for Maturity Level 1)

**Cost**: ~$0.18/month (180k requests)

### Total POC Cost Breakdown

```
DynamoDB (3 tables):        $5.33/month
API Gateway HTTP:           $0.18/month
Step Functions:             $0.25/month
CloudWatch Logs:            $2.00/month
S3 (Frontend):              $0.50/month
SNS (Notifications):        $0.10/month
Lambda:                     $0.00 (free tier)
EventBridge:                $0.00 (free tier)
SQS:                        $0.00 (free tier)
───────────────────────────────────────
Total:                      $8.36/month
```

**Budget Target**: <$50/month ✅ **Met** (83% under budget)

---

## Lambda Decomposition Strategy

### Decision: Option A (Single-Purpose Lambdas)

**Final Count for Stage 1-3**: 7 Lambdas

#### Why Option A?
1. **AI Code Generation**: Focused prompts = better AI output quality
2. **Incremental Development**: Each Lambda is a discrete deliverable
3. **Debugging**: Clear isolation (one function = one responsibility)
4. **Testing**: Simple unit tests per function
5. **Cost**: No difference (well within free tier at POC scale)
6. **Pattern Match**: Aligns with HADES service decomposition
7. **Extensibility**: Easy to add new stages without modifying existing functions

#### Stage 1-3 Lambda Catalog
1. **API Handler** - REST endpoints (create candidate, schedule interview, submit vote)
2. **Workflow Orchestrator** - Saga creation, stage transitions
3. **Interview Scheduler** - Calendar invites, state updates
4. **Vote Processor** - Score calculation, voting completion check
5. **Evaluation Completer** - Final aggregation, next stage trigger
6. **Notification Service** - Email/SMS/Slack notifications
7. **SLA Monitor** - EventBridge cron, breach detection

---

## Data Architecture

### DynamoDB Single-Table Design

**Primary Table**: `talent-flow-state`

**Access Patterns**:
1. Get candidate by ID
2. Get all candidates in a stage
3. Get workflow by candidate ID
4. Get all workflows by status
5. Get candidate by email
6. Query events by candidate ID + timestamp

**Key Schema**:
```
PK: CANDIDATE#{candidateId}
SK: METADATA | WORKFLOW#{workflowId} | EVENT#{timestamp}
```

**GSI-1**: Stage-based queries
```
GSI1PK: STAGE#{stageName}
GSI1SK: STATUS#{status}#TIMESTAMP#{timestamp}
```

**GSI-2**: Email lookup
```
GSI2PK: EMAIL#{email}
GSI2SK: CANDIDATE#{candidateId}
```

**Event Ledger Table**: `talent-flow-events`
- Immutable event log
- Single-table design
- TTL for POC (90 days retention)

---

## Event-Driven Patterns

### EventBridge Event Bus
**Name**: `talent-flow-bus`

### Event Naming Convention
```
Source: talent-flow.{domain}
DetailType: {Entity}{Action}
```

**Examples**:
- `talent-flow.candidate` / `CandidateCreated`
- `talent-flow.evaluation` / `VoteSubmitted`
- `talent-flow.evaluation` / `VotingCompleted`
- `talent-flow.workflow` / `StageTransitioned`
- `talent-flow.sla` / `EngagementSLABreached`

### Event Routing Patterns
1. **Content-Based Routing**: Filter by detail fields (stage, status, score)
2. **Fan-Out**: Single event → multiple Lambda targets
3. **Workflow Resumption**: Step Functions callback integration
4. **SLA Triggers**: EventBridge Scheduler → Lambda

---

## Development Approach

### Incremental Delivery Strategy

**Phase 1: Stage 1-3 Foundation (Weeks 1-4)**
- Focus: Evaluation Intelligence
- Deliverable: Candidate creation → Interview scheduling → Voting → Score aggregation
- Validation: 10 candidates, 1 department, 2 managers

**Phase 2: Stage 6-8 (Weeks 5-8)**
- Focus: Offer Orchestration
- Deliverable: Offer generation → Approval workflow → Acceptance tracking

**Phase 3: Stage 9-12 (Weeks 9-12)**
- Focus: Onboarding
- Deliverable: Background checks → Document collection → Start date coordination

**Phase 4: Intelligence Layer (Maturity Level 2)**
- Focus: AI-powered insights
- Deliverable: Sentiment analysis, predictive scoring, engagement recommendations

### AI-Assisted Development
- **Requirements**: AI-generated user stories
- **UI/UX**: AI-generated designs (Angular components)
- **Code**: AI-generated Lambda functions, Terraform modules
- **Testing**: AI-generated test cases
- **Documentation**: AI-generated technical docs
- **Jira**: AI-generated epics, stories, tasks
- **PRs**: AI-generated pull request descriptions

**Critical Success Factor**: Comprehensive, well-structured prompts

### 12-Week Incremental Roadmap (Detailed)

**Approach**: Build → Test → Validate → Learn → Expand

#### Phase 1: Stage 1-3 Foundation (Weeks 1-4)

**Week 1: Infrastructure + Core Services**
- **Day 1-2**: Foundation Setup
  - [ ] Create S3 bucket for Terraform state
  - [ ] Deploy EventBridge bus `talent-flow-bus`
  - [ ] Deploy 3 DynamoDB tables (candidate-pipeline, event-ledger, workflow-state)
  - [ ] Configure IAM roles for Lambda execution
  - **Validation**: `aws events list-event-buses | grep talent-flow`
  - **Deliverable**: ✅ Infrastructure deployed, accessible via AWS Console

- **Day 3-5**: Core Lambda Functions
  - [ ] Deploy Lambda: API Handler (AI-generated code)
  - [ ] Deploy Lambda: Workflow Orchestrator (AI-generated code)
  - [ ] Create EventBridge rule: `CandidateCreated` → Workflow Orchestrator
  - [ ] Test event flow: API → EventBridge → Orchestrator
  - **Validation**: End-to-end candidate creation flow working
  - **Deliverable**: ✅ Candidate creation working (API → EventBridge → Orchestrator)

**Week 2: Evaluation Workflow**
- **Day 6-8**: Interview & Vote Processing
  - [ ] Deploy Lambda: Interview Scheduler
  - [ ] Deploy Lambda: Vote Processor (with score calculation)
  - [ ] Create EventBridge rules for interview and vote events
  - [ ] Test interview scheduling + vote submission
  - **Deliverable**: ✅ Interview + vote flow working

- **Day 9-10**: Evaluation Completion
  - [ ] Deploy Lambda: Evaluation Completer
  - [ ] Create EventBridge rule: `VotingCompleted` → Evaluation Completer
  - [ ] Run end-to-end test (create → interview → 2 votes → completion)
  - **Validation**: `npm run test:integration:stage1-3`
  - **Deliverable**: ✅ Complete Stage 1-3 workflow functional

**Week 3: Notifications + SLA Monitoring**
- **Day 11-13**: Notification Service
  - [ ] Deploy Lambda: Notification Service
  - [ ] Configure SQS queue + event source mapping
  - [ ] Implement email templates (interview scheduled, vote reminder)
  - [ ] Test email delivery via AWS SES
  - **Deliverable**: ✅ Notification service working (email delivery confirmed)

- **Day 14-15**: SLA Monitoring
  - [ ] Deploy Lambda: SLA Monitor
  - [ ] Configure EventBridge Scheduler (cron: `rate(1 hour)`)
  - [ ] Test SLA breach detection (create backdated candidate, trigger monitor)
  - [ ] Verify escalation notifications sent
  - **Deliverable**: ✅ SLA monitoring active, breach detection working

**Week 4: Angular UI + Testing**
- **Day 16-18**: Angular Frontend
  - [ ] Generate Angular 17 project (Standalone components)
  - [ ] Implement 4 core components: Candidate Create, Interview Schedule, Vote Submit, Dashboard
  - [ ] Connect to API Gateway (HTTP service + interceptor)
  - [ ] Test full UI workflow
  - **Deliverable**: ✅ Functional UI for Stage 1-3 workflow

- **Day 19-20**: Testing + Documentation
  - [ ] Write unit tests for all 7 Lambdas (Jest, >80% coverage)
  - [ ] Write integration tests (end-to-end workflow)
  - [ ] Update PROJECT_CONTEXT.md with progress and learnings
  - **Deliverable**: ✅ 80%+ test coverage, documentation complete

**Week 4 Checkpoint (POC Validation)**:
- ✅ 10 candidates processed successfully through evaluation
- ✅ All events logged to audit ledger
- ✅ SLA monitoring functional (0 false positives)
- ✅ UI functional (no blockers)
- ✅ AWS costs <$20/month

#### Phase 2: Stage 6-8 Offer Orchestration (Weeks 5-8)

**Week 5**: Offer Generation
- Deploy offer-generator Lambda
- Implement Step Functions approval workflow
- Test offer generation flow
- **Deliverable**: ✅ Offer generation + approval flow working

**Week 6**: Offer Acceptance
- Implement candidate offer response API
- Deploy offer-acceptance Lambda
- Build Angular offer review component
- **Deliverable**: ✅ Offer acceptance flow working

**Week 7**: Offer Expiration + Retries
- Implement offer expiration logic (Step Functions timeout)
- Implement offer revision workflow
- Test timeout scenarios
- **Deliverable**: ✅ Offer expiration + revision working

**Week 8**: Testing + Integration
- End-to-end Stage 6-8 testing
- Integration with Stage 1-3
- Validate complete flow (Stage 1-8)
- **Deliverable**: ✅ Stage 1-8 complete, ready for POC demo

**Week 8 Checkpoint**:
- ✅ 10 candidates processed through offer acceptance
- ✅ Offer approval workflow functional (human-in-the-loop working)
- ✅ 0 data loss (all events persisted)
- ✅ AWS costs <$35/month

#### Phase 3: Stage 9-12 Onboarding (Weeks 9-12)

**Week 9**: Background Check
- Deploy background-check Lambda
- Implement Step Functions workflow (multi-week wait states)
- Test background check flow
- **Deliverable**: ✅ Background check flow working

**Week 10**: Document Collection
- Deploy document-upload Lambda
- Implement Angular document upload component
- Test document validation and S3 storage
- **Deliverable**: ✅ Document collection working

**Week 11**: Onboarding Checklist
- Deploy checklist-manager Lambda
- Implement Angular checklist component
- Test checklist completion flow
- **Deliverable**: ✅ Onboarding checklist working

**Week 12**: Finalization + Handoff
- Process 10 candidates through all 12 stages
- Performance testing (100 concurrent candidates)
- Cost analysis (validate <$50/month)
- Production readiness checklist
- **Deliverable**: ✅ All 12 stages functional, ready for production deployment

**Week 12 Checkpoint (POC Complete)**:
- ✅ 10 candidates onboarded successfully
- ✅ All 12 stages functional
- ✅ 2 managers actively using system
- ✅ 1 department fully migrated
- ✅ AWS costs <$50/month
- ✅ Production deployment plan approved

### Risk Mitigation Strategies

#### Risk 1: AI Code Generation Quality
**Mitigation**:
- Use comprehensive prompts (reference LAMBDA_CATALOG.md patterns)
- Review all generated code before deployment
- Write unit tests immediately after code generation
- Use linters (ESLint) and formatters (Prettier)
- Store all prompts in `prompts/` directory for reuse

#### Risk 2: Integration Complexity
**Mitigation**:
- Build incrementally (test after each Lambda deployed)
- Use EventBridge event inspection (AWS Console)
- Enable X-Ray tracing for distributed debugging (Maturity Level 1)
- Create integration test suite early (Week 2)

#### Risk 3: Context Loss Between Sessions
**Mitigation**:
- Update PROJECT_CONTEXT.md after major milestones
- Document architectural decisions in ADR format
- Use consistent naming conventions (easier to regenerate)
- Store all prompts in `prompts/` directory for reuse

#### Risk 4: Scope Creep
**Mitigation**:
- Strictly follow incremental roadmap (no feature additions)
- Defer "nice-to-have" features to Maturity Level 2
- Focus on POC success criteria (10 candidates, 1 department, 2 managers)
- Timebox each week (move to next phase even if not perfect)

#### Risk 5: DynamoDB Query Complexity
**Mitigation**:
- Design GSIs upfront (cannot add complex GSIs without downtime)
- Test all access patterns during Week 1 infrastructure deployment
- Use single-table design patterns from AWS documentation
- If complex queries needed → add Aurora at Maturity Level 2

#### Risk 6: EventBridge Rule Misconfiguration
**Mitigation**:
- Test each EventBridge rule immediately after creation
- Use event pattern testing tool in AWS Console
- Log all events to CloudWatch for debugging
- Document all event schemas in EVENTBRIDGE_PATTERNS.md

### Learning Checkpoints

**After Week 4 (Stage 1-3 Complete)**:
- **Reflect**: What patterns worked well? What was harder than expected?
- **Adjust**: Update time estimates for Weeks 5-8
- **Document**: Lessons learned in PROJECT_CONTEXT.md

**After Week 8 (Stage 1-8 Complete)**:
- **Reflect**: Is Step Functions complexity justified? Should any workflows be simplified?
- **Adjust**: Update time estimates for Weeks 9-12
- **Document**: Optimize expensive components (if needed)

**After Week 12 (All Stages Complete)**:
- **Reflect**: What would you do differently next time? Which AI prompts were most effective?
- **Next Steps**: Plan Maturity Level 1 migration (production deployment)
- **Document**: POC learnings in retrospective

---

## Documentation Progress

### All Documents Complete! ✅ (12/12)

✅ **TALENT_FLOW_MATURITY_LEVELS.md**
   - Maturity Level 0: POC (<$50/month)
   - Maturity Level 1: Production-Ready (department scale)
   - Maturity Level 2: Intelligence Layer (AI features)
   - Maturity Level 3: Enterprise + Agentic AI
   - Migration triggers between levels

✅ **TALENT_FLOW_POC_ARCHITECTURE.md**
   - AWS service architecture
   - Component diagram
   - Cost breakdown (<$50/month)
   - Deployment architecture
   - Security model

✅ **HADES_TO_SERVERLESS_MAPPING.md**
   - Direct pattern translation from HADES enterprise to serverless POC
   - Service-to-Lambda mappings
   - Kafka-to-EventBridge mappings
   - PostgreSQL-to-DynamoDB mappings
   - Pattern preservation strategies

✅ **DYNAMODB_SCHEMA_DESIGN.md**
   - Single-table design
   - Access patterns
   - GSI design
   - Query patterns
   - Write patterns
   - Aggregation strategies

✅ **EVENTBRIDGE_PATTERNS.md**
   - Event catalog
   - Event schemas
   - Routing rules
   - Content-based filtering
   - Fan-out patterns
   - Workflow resumption

✅ **LAMBDA_CATALOG.md**
   - Detailed specifications for all 7 Lambdas (Stage 1-3)
   - Input/output contracts
   - Event subscriptions
   - DynamoDB access patterns
   - Error handling strategies
   - Performance benchmarks

✅ **STEP_FUNCTIONS_ORCHESTRATION.md**
   - Long-running workflow patterns
   - Callback integration with EventBridge
   - Wait state management
   - Error handling and retries
   - Saga coordination with compensation

✅ **TERRAFORM_MODULE_STRUCTURE.md**
   - Reusable module design
   - Module catalog (Lambda, EventBridge, DynamoDB, SQS, SNS)
   - Variable conventions
   - Output conventions
   - Module composition patterns
   - Deployment workflow

✅ **INCREMENTAL_DELIVERY_ROADMAP.md**
   - Week-by-week build plan (12 weeks)
   - Dependencies between components
   - Testing checkpoints
   - Demo milestones
   - Validation criteria
   - Risk mitigation strategies

✅ **MIGRATION_PATHS.md**
   - POC → Maturity Level 1 (what changes, cost impact)
   - Level 1 → Level 2 (Intelligence Layer integration)
   - Level 2 → Level 3 (Full Agentic AI)
   - Execution plans for each migration
   - Risk mitigation strategies

✅ **COST_BREAKDOWN.md**
   - Detailed cost analysis per AWS service
   - Free tier utilization (POC: $0-5/month!)
   - Cost projections at 10x, 30x, 100x scale
   - Cost optimization strategies
   - Budget alerts and monitoring
   - ROI analysis ($146K/year savings)

✅ **AI_DEVELOPMENT_GUIDE.md**
   - Prompt templates for Lambda functions
   - Prompt templates for Terraform modules
   - Prompt templates for Angular components
   - Prompt templates for unit/integration tests
   - Context management strategies
   - Code review checklists for AI-generated code
   - Common pitfalls and solutions

---

## Maturity Evolution Path

### 4-Level Progression

| Level | Budget | Volume | Users | Key Features | Timeline |
|-------|--------|--------|-------|--------------|----------|
| **0 (POC)** | <$50 | 1k/day | 2 mgrs, 1 dept | Serverless, event-driven, saga pattern | 1-3 months |
| **1 (Prod)** | <$200 | 10k/day | 20 mgrs, 5 depts | Multi-region, CI/CD, analytics, caching | 3-6 months |
| **2 (AI)** | <$500 | 20k/day | 50 mgrs, 10 depts | 4 AI features, intent routing, compliance audit | 6-12 months |
| **3 (Enterprise)** | <$2k | 100k/day | 500 mgrs, 50 depts | Agentic AI, multi-region HA, full observability | 12-24 months |

### Level 0: POC (Current)

**Objective**: Validate workflow orchestration patterns at minimal cost

**Technology Stack**:
- Compute: Lambda (Node.js 20.x)
- Orchestration: Step Functions Standard
- Event Bus: EventBridge
- Database: DynamoDB On-Demand (3 tables)
- API: API Gateway HTTP
- Monitoring: CloudWatch Logs + Metrics (basic)
- Frontend: Angular 19 (S3 static hosting)

**Cost**: ~$8.36/month

**Characteristics**:
- ✅ Fully serverless
- ✅ Event-driven architecture
- ✅ Saga pattern operational
- ✅ Audit trail (DynamoDB)
- ✅ Stage 1-3 functional (Evaluation Intelligence)
- ⚠️ Single region (af-south-1)
- ⚠️ No high availability
- ⚠️ No AI features

### Level 1: Production-Ready (Department Scale)

**Objective**: Support multi-department adoption with production-grade reliability

**What Changes**:
- Database: DynamoDB Provisioned (cost optimization at scale)
- Monitoring: + X-Ray distributed tracing
- Configuration: + AWS Secrets Manager (secure secret rotation)
- Deployment: + CI/CD (GitHub Actions)
- Analytics: + Athena on S3 exports
- Caching: + DynamoDB DAX (read optimization)
- API: + WAF (enhanced security)
- Observability: + OpenTelemetry spans

**New Services Added**:
- AWS X-Ray ($5/month)
- DynamoDB DAX ($50/month)
- AWS WAF ($5/month)
- EventBridge Archive ($0.10/GB)
- S3 + Athena ($5/month)

**Cost**: ~$170/month (17x increase, 10x volume increase)

**Migration Trigger**:
- ✅ 10 candidates processed successfully
- ✅ 1 department using for 1 month
- ✅ 2 hiring managers using daily
- ✅ Business feedback: "We want to expand to more departments"

**Budget Justification**:
- Incremental: $160/month
- Value: Multi-department adoption, 10x scale, 99.5% SLA

### Level 2: Intelligence Layer (AI Features)

**Objective**: Introduce AI-powered intelligence features

**What Changes**:
- LLM: + AWS Bedrock (Claude 3 Haiku)
- Gateway: + LiteLLM + Portkey (LLM abstraction + semantic caching)
- Database: + Aurora Serverless v2 (prompt audit, 7-year retention)
- Intent Router: + Lambda (deterministic-first routing)
- AI Features: + 4 Lambda functions (AI-powered)

**4 AI Features**:
1. **Interview Summarization**: 3-paragraph summary from notes (~$0.002/summary)
2. **Sentiment Extraction**: EXCITED/NEUTRAL/HESITANT/RELUCTANT (~$0.001/analysis)
3. **Risk Prediction**: Ghosting/disengagement risk score + explanation (~$0.005/prediction)
4. **Score Recommendation**: Suggested scores + justification (~$0.015/recommendation)

**AI Architecture** (from Enterprise AI Skill):
- **Pillar 1**: Dual Authentication (User: Cognito JWT, Service: IAM roles)
- **Pillar 2**: Non-Operational DB Queries (read replicas only)
- **Pillar 3**: Prompt/Response Audit (Aurora, 7-year retention)
- **Pillar 6**: Cost Optimisation (deterministic-first routing, semantic caching)
- **Pillar 7**: Intent Router (Level 1-5 classification)

**Cost Breakdown**:
- Base (Level 1): $170/month
- AWS Bedrock: $360/month (raw) → $144/month (with 60% cache hit rate)
- Aurora Serverless v2: $30/month
- LiteLLM + Portkey: $10-29/month
- Additional Lambda/Step Functions: $8/month
- **Total**: ~$390/month

**Migration Trigger**:
- ✅ 100+ workflows/day sustained for 3 months
- ✅ 3-5 departments actively using
- ✅ User feedback: "We need interview summaries, sentiment analysis"
- ✅ Budget approved for AI features

**Budget Justification**:
- Incremental: $220/month (AI layer)
- Value: 4 AI features, 20x scale, competitive differentiation

### Level 3: Enterprise + Agentic AI (Full Scale)

**Objective**: Organization-wide rollout with agentic automation

**What Changes**:
- Compute: + EKS (Java Spring Boot microservices)
- Event Bus: + MSK Kafka (high-throughput streaming)
- Database: + Aurora Global Database (multi-region)
- API: + Spring Cloud Gateway on EKS
- Observability: + Prometheus + Grafana + Loki
- Caching: + ElastiCache Redis (distributed cache)
- AI: + Agentic automation (autonomous agents)
- Orchestration: + Temporal (complex saga patterns)
- Deployment: + GitOps (Argo CD) + Helm

**Infrastructure**:
- EKS cluster: $73/month (control plane) + $150/month (3 × m5.large workers)
- MSK Kafka: $350/month (3 brokers)
- Aurora Global Database: $300/month
- ElastiCache Redis: $80/month
- DynamoDB Global Tables: $200/month
- NAT Gateway: $90/month
- Observability (Prometheus + Grafana): $99/month

**Agentic Automation Features** (Phase 3):
1. **Intelligent Nudging**: Autonomous SLA breach prevention
2. **Workflow Optimization**: Agent learns optimal stage durations, suggests improvements
3. **Adaptive Onboarding**: Personalizes flow per candidate
4. **Autonomous Escalation**: Detects disengagement, auto-creates tasks

**Cost**: ~$1,772/month

**Migration Trigger**:
- ✅ Organization-wide rollout decision
- ✅ 50+ departments, 500+ users
- ✅ 10,000+ workflows/day sustained
- ✅ Compliance requirements mandate (POPIA, multi-region)
- ✅ Budget approved for enterprise infrastructure

**Budget Justification**:
- Incremental: $1,382/month (enterprise infrastructure)
- Value: 100x scale, 99.95% SLA, multi-region HA, agentic AI, full compliance

### Migration Confidence

**Key Principle**: No "rip and replace." Every component has clear migration path.

**Example: Event Bus Evolution**
```
Level 0 (POC):
  EventBridge → Lambda → SQS

Level 1 (Production):
  EventBridge (with Archive) → Lambda → SQS
  + X-Ray tracing
  + EventBridge Schemas

Level 2 (AI):
  EventBridge + MSK (for AI events) → Lambda + AI Lambdas → SQS
  + High-volume AI events → MSK
  + Operational events → EventBridge

Level 3 (Enterprise):
  MSK primary, EventBridge for cross-region routing
  + All internal events → MSK
  + Cross-region events → EventBridge
  + Lambda + EKS consumers
```

**No architectural dead-ends. Just additive evolution.**

---

## Key Decisions & Rationale

### Q: Why Single-Table DynamoDB vs Multi-Table?
**Answer**:
- Cost: 1 table = 1 free tier allocation vs 5 tables = 5 allocations
- Performance: Single table with GSIs faster than cross-table joins
- Pattern: Matches HADES single-source-of-truth state store

### Q: Why EventBridge vs SNS/SQS for events?
**Answer**:
- Content-based routing (filter events without Lambda code)
- Native Step Functions integration (callback pattern)
- Event replay capability (future-proof for debugging)
- Archive capability (compliance/audit)

### Q: Why 7 Lambdas instead of 4 or 15?
**Answer**:
- 4 Lambdas = multi-purpose functions (harder for AI to generate/maintain)
- 15 Lambdas = over-decomposition (unnecessary management overhead)
- 7 Lambdas = sweet spot (single responsibility + manageable)

### Q: Why Node.js vs Python/Go/Java?
**Answer**:
- Cold start: Node.js < 500ms, Python ~1s, Java ~3s
- AWS SDK: Native JavaScript SDK (no translation layer)
- AI Generation: Claude excels at JavaScript/TypeScript
- Cost: Faster cold start = lower billed duration

### Q: Why Terraform vs CloudFormation vs CDK?
**Answer**:
- Already have Terraform expertise and existing modules
- Multi-cloud portability (future-proof)
- Better state management than CloudFormation
- More explicit than CDK (easier for AI to generate)

---

## Open Questions

### Technical Decisions Pending
- [ ] Angular version (v17 Standalone vs v18?)
- [ ] Authentication strategy (Cognito vs Auth0 vs custom?)
- [ ] Monitoring strategy (CloudWatch vs Datadog vs Grafana?)
- [ ] CI/CD pipeline (GitHub Actions vs GitLab CI vs AWS CodePipeline?)

### Business Decisions Answered (From BRD/UX/UI)
- ✅ **SLA thresholds per stage**: Fully defined in BRD (see SLA Framework table)
- ✅ **Notification preferences**: Email/SMS/Slack notifications (see Notification Service in Lambda catalog)
- ✅ **User interface requirements**: 13 primary screens defined with detailed UX flows
- ✅ **Workflow stages**: Complete 12-stage workflow defined with gates and transitions
- ✅ **Stakeholder requirements**: 10 stakeholder personas with needs and pain points documented

### Business Decisions Still Pending
- [ ] Which department will be the POC pilot?
- [ ] Who are the 2 managers for validation?
- [ ] Final approval on MVP 1-3 delivery timeline (4 weeks + 4 weeks + 6 weeks)?

---

## Next Steps

### Documentation Phase ✅ COMPLETE
1. ✅ Create PROJECT_CONTEXT.md (this document)
2. ✅ Complete all 12 architecture documents
3. ✅ Establish AI prompt templates for code generation
4. ✅ Complete Business Requirements Document (BRD v1.0)
5. ✅ Complete UX/UI Design Document (UXUI v1.0)
6. ✅ Integrate BRD & UX/UI context into PROJECT_CONTEXT.md

**Documentation Status**: 100% Complete
- **Architecture**: 12 comprehensive technical documents
- **Business**: Complete BRD with 12-stage workflow, stakeholder analysis, business rules, SLA framework
- **Design**: Complete UX/UI with 13 primary screens, component library, design system, MVP strategy
- **Total**: ~120,000 words of comprehensive documentation

### Implementation Phase (READY TO START!)
1. ⏸️ Begin Terraform module development (use TERRAFORM_MODULE_STRUCTURE.md)
2. ⏸️ Generate Lambda function code (use AI_DEVELOPMENT_GUIDE.md prompts)
3. ⏸️ Set up Angular project structure (use UXUI v1.0 component library and screen flows)
4. ⏸️ Create Jira epic for MVP 1 (Stage 1-3, The Evaluation Core)
5. ⏸️ Deploy POC infrastructure to AWS

### Week 1: Concrete Execution Plan (Day-by-Day)

#### Day 1-2: Infrastructure Foundation

**Terraform Tasks**:
```bash
# 1. Create Terraform state backend
cd terraform
terraform init

# 2. Deploy core infrastructure
terraform apply -target=module.eventbridge
terraform apply -target=module.dynamodb
terraform apply -target=module.iam
```

**Resources to Deploy**:
- [ ] S3 bucket: `talent-flow-terraform-state` (with versioning)
- [ ] DynamoDB: `terraform-state-lock` table (for state locking)
- [ ] EventBridge bus: `talent-flow-bus`
- [ ] DynamoDB table: `candidate-pipeline` (with GSI1, GSI2, GSI3)
- [ ] DynamoDB table: `event-ledger` (with EventType-Timestamp GSI)
- [ ] DynamoDB table: `workflow-state` (with CandidateId and SLA GSIs)
- [ ] IAM role: `talent-flow-lambda-execution-role` (with DynamoDB, EventBridge, CloudWatch policies)

**AI Prompt for Terraform**:
```
Generate Terraform code to create EventBridge custom bus named "talent-flow-bus"
with archive disabled for POC. Use module structure from TERRAFORM_MODULE_STRUCTURE.md.
```

**Validation Commands**:
```bash
# Verify EventBridge bus
aws events list-event-buses | grep talent-flow

# Verify DynamoDB tables
aws dynamodb list-tables | grep talent-flow

# Describe table schema
aws dynamodb describe-table --table-name candidate-pipeline
aws dynamodb describe-table --table-name event-ledger
aws dynamodb describe-table --table-name workflow-state
```

**Success Criteria**: All infrastructure resources visible in AWS Console

---

#### Day 3-5: Core Lambda Functions

**Lambda 1: API Handler**

**AI Prompt**:
```
Generate Node.js 20.x Lambda function "api-handler" that:
- Handles POST /api/v1/candidates (create candidate)
- Handles POST /api/v1/interviews (schedule interview)
- Handles POST /api/v1/votes (submit vote)
- Handles GET /api/v1/candidates/{id} (get candidate)

Technical requirements:
- AWS SDK v3 (EventBridge, DynamoDB DocumentClient)
- Input validation using Ajv JSON schema validator
- Structured JSON logging (correlationId, timestamp, level, message)
- Error handling with try/catch and specific error types
- Idempotency check (duplicate email detection)

Environment variables:
- EVENTBRIDGE_BUS_NAME
- DYNAMODB_TABLE_NAME (candidate-pipeline)
- DYNAMODB_LEDGER_TABLE_NAME (event-ledger)
- LOG_LEVEL (INFO)

Follow the pattern from LAMBDA_CATALOG.md, API Handler section.
Return 202 Accepted for async operations.
```

**Deployment**:
```bash
# Build Lambda package
cd lambda-api-handler
npm install
npm run build  # webpack bundle

# Deploy via Terraform
cd ../terraform
terraform apply -target=module.lambda_api_handler
```

**Testing**:
```bash
# Test Lambda directly
aws lambda invoke \
  --function-name talent-flow-api-handler \
  --payload file://test-payloads/create-candidate.json \
  output.json

cat output.json  # Should show 202 Accepted + candidateId

# Check CloudWatch Logs
aws logs tail /aws/lambda/talent-flow-api-handler --follow
```

**Lambda 2: Workflow Orchestrator**

**AI Prompt**:
```
Generate Node.js 20.x Lambda function "workflow-orchestrator" that:
- Subscribes to EventBridge event: source="talent-flow.candidates", DetailType="CandidateCreated"
- Creates workflow state in DynamoDB workflow-state table:
  - 1 SAGA record (PK: WORKFLOW#{workflowId}, SK: SAGA)
  - 3 STAGE records (INTERVIEW_1, INTERVIEW_2, OFFER with status NOT_STARTED)
  - Mark INTERVIEW_1 status as STARTED
- Publishes WorkflowStageStarted event to EventBridge
- Starts Step Functions execution (arn stored in env var)

Environment variables:
- DYNAMODB_WORKFLOW_TABLE (workflow-state)
- EVENTBRIDGE_BUS_NAME
- STEP_FUNCTIONS_ARN (evaluation-workflow)

Follow LAMBDA_CATALOG.md, Workflow Orchestrator section.
```

**EventBridge Rule** (Terraform):
```hcl
resource "aws_cloudwatch_event_rule" "candidate_created" {
  name        = "candidate-created-to-orchestrator"
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name

  event_pattern = jsonencode({
    source      = ["talent-flow.candidates"]
    detail-type = ["CandidateCreated"]
  })
}

resource "aws_cloudwatch_event_target" "workflow_orchestrator" {
  rule      = aws_cloudwatch_event_rule.candidate_created.name
  target_id = "WorkflowOrchestrator"
  arn       = aws_lambda_function.workflow_orchestrator.arn
}
```

**End-to-End Test**:
```bash
# 1. Create candidate via API Handler
aws lambda invoke --function-name talent-flow-api-handler \
  --payload '{"httpMethod":"POST","path":"/api/v1/candidates","body":"{\"firstName\":\"John\",\"lastName\":\"Doe\",\"email\":\"john@example.com\",\"position\":\"Engineer\"}"}' \
  output.json

# 2. Check EventBridge published CandidateCreated event
aws events put-events --entries file://test-events/candidate-created.json

# 3. Verify Workflow Orchestrator triggered
aws logs tail /aws/lambda/talent-flow-workflow-orchestrator --follow

# 4. Verify workflow-state table updated
aws dynamodb query --table-name workflow-state \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"WORKFLOW#WF-123"}}'
```

**Success Criteria**:
- ✅ API Handler creates candidate in DynamoDB
- ✅ EventBridge routes event to Workflow Orchestrator
- ✅ Workflow Orchestrator creates SAGA + 3 STAGE records
- ✅ WorkflowStageStarted event published

**Deliverable**: End-to-end candidate creation flow functional

---

### Week 1 Success Metrics
- [ ] All infrastructure deployed (6 resources)
- [ ] 2 Lambda functions operational (API Handler, Workflow Orchestrator)
- [ ] 1 EventBridge rule working (candidate-created-to-orchestrator)
- [ ] End-to-end test passing (create candidate → workflow created)
- [ ] CloudWatch Logs showing structured JSON logs
- [ ] Cost tracking: <$2/month at this stage

---

## Project Contacts & Resources

### Key Stakeholders
- **Architect/Developer**: Iggie Mushanguri (solo build)
- **AI Assistant**: Claude (Sonnet 4.5)

### Related Projects
- **HADES Platform**: Deceased Estates orchestration (enterprise reference architecture)
- **Existing Terraform**: Already has Terraform modules for other project components

### Repository Structure
```
/Documents/Deceased Estates Agentic AI/
├── PROJECT_CONTEXT.md (this file) ✅
├── Event Driven Architecture Docs/
│   ├── TALENTFLOW-BRD-v1.md ✅ NEW
│   ├── TALENTFLOW-UXUI-v1.md ✅ NEW
│   ├── TALENT_FLOW_MATURITY_LEVELS.md ✅
│   ├── TALENT_FLOW_POC_ARCHITECTURE.md ✅
│   ├── HADES_TO_SERVERLESS_MAPPING.md ✅
│   ├── DYNAMODB_SCHEMA_DESIGN.md ✅
│   ├── EVENTBRIDGE_PATTERNS.md ✅
│   ├── LAMBDA_CATALOG.md ✅
│   ├── STEP_FUNCTIONS_ORCHESTRATION.md ✅
│   ├── TERRAFORM_MODULE_STRUCTURE.md ✅
│   ├── INCREMENTAL_DELIVERY_ROADMAP.md ✅
│   ├── MIGRATION_PATHS.md ✅
│   ├── COST_BREAKDOWN.md ✅
│   └── AI_DEVELOPMENT_GUIDE.md ✅
├── HADES_SYSTEM_DOCUMENTATION.md (reference)
├── deceased-estates-hades-comprehensive-architecture.md (reference)
└── COMPLETE_EVENT_STREAM_ARCHITECTURE.md (reference)
```

---

## Lessons Learned (Update as we progress)

### What's Working Well
- ✅ HADES pattern mapping provides clear architectural foundation
- ✅ Incremental approach reduces complexity
- ✅ Single-purpose Lambdas align well with AI code generation
- ✅ Splitting documentation into focused files prevented timeouts
- ✅ AI-assisted documentation generation was highly effective
- ✅ PROJECT_CONTEXT.md enables session recovery and context preservation
- ✅ BRD and UX/UI documents provide comprehensive business and design context
- ✅ Living document approach maintains continuity across sessions
- ✅ Batch reading of architecture files (4 files in parallel) prevents context loss
- ✅ Structured updates to PROJECT_CONTEXT.md create comprehensive snapshots
- ✅ Detailed Week 1 execution plan with AI prompts provides clear starting point

### Challenges Encountered
- ⚠️ Context length limits in AI conversations (need frequent context saves)
- ⚠️ File write timeouts on very long documents (split into focused docs)
- ⚠️ 400 error occurred due to large conversation context (resolved by completing remaining docs)

### Adjustments Made
- ✅ Split comprehensive doc into 12 focused documents
- ✅ Created PROJECT_CONTEXT.md for session recovery
- ✅ Chose Option A (7 Lambdas) over Option B (4 Lambdas) after deep analysis

### Major Milestones Achieved

**2026-05-12: Architecture Documentation Complete**
🎉 **All 12 architecture documents completed in single session!**
- Total content: ~50,000+ words across 12 comprehensive documents
- Documents cover: Architecture, Implementation, Migration, Cost, Testing, AI Prompts
- Ready to begin implementation (Week 1 of INCREMENTAL_DELIVERY_ROADMAP.md)

**2026-05-13: Business Requirements & UX/UI Documentation Complete**
🎉 **Comprehensive BRD and UX/UI design documents integrated!**
- TALENTFLOW-BRD-v1.md: Complete 12-stage workflow, stakeholder analysis, business rules, SLA framework
- TALENTFLOW-UXUI-v1.md: Complete UX strategy, 13 primary screens, component library, MVP delivery plan
- PROJECT_CONTEXT.md updated as living document with full business and design context
- Total documentation: ~120,000+ words across business, design, and technical architecture
- **Status**: Ready for implementation kickoff with complete business and technical foundation

**2026-05-13: Detailed Architecture Context Integrated**
🎉 **All 4 priority architecture documents fully integrated into PROJECT_CONTEXT.md!**
- **HADES Pattern Mapping**: 10 core patterns with enterprise-to-serverless translation, 98.9% cost reduction ($700 → $8)
- **Detailed POC Architecture**: Complete specs for 7 Lambda functions, 3 DynamoDB tables, EventBridge rules, Step Functions
- **Maturity Evolution**: 4-level progression with migration triggers, cost breakdowns, and technology changes at each level
- **12-Week Roadmap**: Week-by-week execution plan with concrete Day 1-2 tasks, AI prompts, validation commands
- **Risk Mitigation**: 6 identified risks with detailed mitigation strategies
- **Week 1 Execution Plan**: Day-by-day tasks with Terraform commands, AI prompts, testing procedures
- Total added content: ~15,000 words of detailed technical specifications
- **Status**: PROJECT_CONTEXT.md now contains complete end-to-end context for session recovery

---

## Document Update Log

| Date | Update | Author |
|------|--------|--------|
| 2026-05-12 | Initial context document created | Claude + Iggie |
| 2026-05-12 | Completed 5/12 architecture documents | Claude |
| 2026-05-12 | **Completed all 12/12 architecture documents** | Claude |
| 2026-05-12 | Updated PROJECT_CONTEXT.md with completion status | Claude |
| 2026-05-13 | **Added comprehensive Business Requirements from BRD v1.0** | Claude |
| 2026-05-13 | **Added comprehensive UX/UI Design from UXUI v1.0** | Claude |
| 2026-05-13 | Updated repository structure and documentation status | Claude |
| 2026-05-13 | **Read 4 priority architecture documents (POC, Maturity, Roadmap, HADES Mapping)** | Claude |
| 2026-05-13 | **Integrated detailed architecture context: HADES patterns, Lambda catalog, DynamoDB schemas, EventBridge rules, Maturity evolution, 12-week roadmap, Risk mitigation, Week 1 execution plan** | Claude |
| 2026-05-13 | **Added ~15,000 words of detailed technical specifications** | Claude |
| 2026-05-13 | **Created "Current Session State" section for session recovery and resume point** | Claude |
| 2026-05-13 | **Identified alignment validation requirement: BRD/UX/UI vs Architecture** | Claude + Iggie |
| 2026-05-13 | **Documented 3 initial alignment gaps found (scoring weights, STRONG_NO, panel size)** | Claude |
| 2026-05-13 | **Created checkpoint before reading remaining 8 architecture documents** | Claude |
| 2026-05-13 | **Read document 1/8: DYNAMODB_SCHEMA_DESIGN.md (1,010 lines)** | Claude |
| 2026-05-13 | **Created checkpoint: Captured DynamoDB schema context, identified 2 additional alignment insights, 7 documents remaining** | Claude |
| 2026-05-13 | **Read document 2/8: EVENTBRIDGE_PATTERNS.md (961 lines)** | Claude |
| 2026-05-13 | **Created checkpoint: Captured EventBridge routing patterns, 11 event types, 6 rules, content-based routing, 6 documents remaining** | Claude |

---

**End of Project Context Document**

*This document should be updated after major decisions, milestones, or architectural changes.*
*Reference this document when starting new Claude sessions to restore full context.*
