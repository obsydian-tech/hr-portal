# TalentFlow — IT Request Module
## Full Design Decisions, Process Flow & Architectural Requirements
## For Claude Code | Read alongside TALENTFLOW_DECISIONS.md

---

## CRITICAL INSTRUCTION FOR CLAUDE CODE

Before implementing anything in this module:

1. Read TALENTFLOW_CONTEXT.md, TALENTFLOW_DECISIONS.md, TALENTFLOW_SCREENS.md
   and .claude/SKILL.md first — in that order.
2. Read the existing codebase before writing a single line of new code:
   - `hr-portal/src/app/features/talent-flow/services/talent-flow-api.service.ts`
   - `hr-portal/src/app/features/talent-flow/services/talent-flow-state.service.ts`
   - `hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts`
   - `hr-portal/src/app/features/talent-flow/talent-flow.routes.ts`
   - `hr-portal/src/app/core/services/auth.service.ts`
   - `hr-portal/src/app/core/interceptors/auth.interceptor.ts`
   - `lambda/talentFlowPreTokenTrigger/` — Cognito token trigger
   - `lambda/orchestrateTalentFlowWorkflow/` — orchestration patterns
   - `lambda/manageTalentFlowConfig/` — config management patterns
   - `lambda/advanceCandidateStage/` — stage advancement patterns
   - `talent-flow-infra/` — all Terraform files
3. Understand what already exists before building anything new.
4. Do NOT regress any existing functionality.
5. Build fresh components for this module — do not patch existing
   components that serve other screens.
6. Follow all rules in .claude/SKILL.md — PrimeNG first, Angular 19
   standalone, signals, inject(), OnPush, reactive forms, Naleko tokens.

---

## THE GOLDEN TRUTH — IT REQUEST MODULE

The IT Request Module exists to solve three pain points:

1. **Visibility** — IT knows who is starting, when, and what is needed
   with enough lead time to act
2. **Coordination** — clear Queue ownership, no overlapping or
   dropped tasks
3. **Accountability** — every task has a status, an owner, and a
   traceable record

Every screen, every component, every automated action must serve
one of these three outcomes.

---

## MODULE SCOPE

### MVP 1 — In scope:
- Automatic provisioning bundle creation at offer acceptance
- Hiring Manager mandatory review and approval gate
- Queue-based task routing to IT specialists
- IT specialist Queue view and task fulfilment
- TA read-only visibility from candidate record
- System Admin Queue management and provisioning templates
- System Admin global provisioning dashboard
- Universal Risk Timer (50/75/100) applied to all provisioning SLAs
- In-app notifications only (no email — email is MVP 2)
- Configurable per tenant — Queues, templates, routing rules, SLA windows

### Post-MVP — Out of scope for now:
- Employee IT requests (ongoing requests post-hire) — same engine,
  second entry point, additive when ready
- Email notifications — MVP 2
- Employee 360 view — separate module, built after IT module is clean
- Asset catalogue with stock levels and pricing — not TalentFlow's job
- IT fulfils from their own inventory system — TalentFlow only tracks
  requirement types and completion status

---

## THE SEVEN EVENTS (Process Flow)

### Event 1 — Offer Accepted (automatic)
- Trigger: candidate offer acceptance confirmed in TalentFlow
- System reads: candidate role + seniority + department
- System looks up: configurable provisioning template for that
  role + seniority combination from DynamoDB config table
- System creates: provisioning bundle record in DynamoDB
- System creates: individual task records per requirement type
- Bundle status: PENDING_HM_REVIEW
- HM review SLA timer starts immediately

### Event 2 — HM Review Task Created (automatic)
- HM receives in-app notification: "Review provisioning bundle
  for [Name] · Starting [Date] · Action required"
- Task appears in HM Provisioning section — Pending your review
- HM review SLA follows Universal Risk Timer (50/75/100)
- 50% elapsed → no action (On Track)
- 75% elapsed → amber nudge to HM (At Risk)
- 100% elapsed → red breach, TA + HR Director notified (Breached)
- Escalation at breach: in-app notification to TA and HR Director

### Event 3 — HM Reviews and Approves Bundle (human action)
- HM opens bundle in dedicated Provisioning section
- Sees auto-generated requirement list from template
- Can: add requirement types, remove requirement types,
  add notes per requirement, change specs
- HM approves bundle
- Bundle status: APPROVED
- Approval timestamp recorded in audit trail
- Cannot be changed after approval — locked

### Event 4 — Queue Tasks Created (automatic)
- Approved bundle splits into individual task records
- Each task routes to its Queue based on configurable routing rules
- Each task SLA starts — calculated from candidate start date
  minus configurable lead time per Queue
- IT specialists in each Queue notified via in-app notification
- Task status: OPEN (unassigned)

### Event 5 — IT Specialist Claims and Fulfils (human action)
- Specialist opens their Queue view
- Claims task — task status: IN_PROGRESS, assigned to specialist
- Fulfils in their own inventory/provisioning system
- Completes fulfilment checklist in TalentFlow
- Logs: asset reference (mandatory), fulfilment method, notes
- Marks task complete — task status: COMPLETE
- HM and TA notified via in-app notification immediately
- Fulfilment notes locked to audit trail

### Event 6 — Bundle Progress Visible (continuous)
- TA sees provisioning status from candidate record Provisioning tab
- HM sees fulfilment progress in Bundle Progress screen
- System Admin sees all bundles in Global Dashboard
- Universal Risk Timer applies per task — SLA tied to start date
- Escalation fires if any task breaches SLA

### Event 7 — All Tasks Complete (automatic)
- System marks provisioning bundle: COMPLETE
- Completion timestamp recorded
- All roles notified via in-app notification
- This event feeds into Day 1 Readiness score (MVP 2)

---

## ROLE ACCESS MATRIX

| Role | Access | Actions |
|------|--------|---------|
| System Admin | Global view — all bundles, all queues, all tenants config | Configure queues, templates, routing rules, SLA windows |
| Hiring Manager | Their team only — bundles for their candidates | Review, modify, approve bundles in Provisioning section |
| IT Specialist | Their assigned Queues only | Claim tasks, complete fulfilment checklist, mark complete |
| TA | Candidate record only — Provisioning tab | View only — no editing, no actions |

---

## SYSTEM ADMIN ROLE MODEL

### MVP 1 — Option A (Pure Admin Role):
- System Admin is a dedicated role — no access to operational screens
- Cannot access Pipeline, Candidates, Offers, Dashboard, HM views,
  IT Specialist views
- Access limited to Admin Workspace only: `/talent-flow/admin/`
- Protected by AdminGuard — checks `user.roles.includes('ADMIN')`
- Completely separate shell — own navigation, own topbar treatment
- Topbar: "Admin Workspace" badge + red role pill + "Exit to platform"
  button (exits to login or tenant home in MVP 1)
- Role pill colour: red/dark red — visually distinct from TA (indigo)
  and HM (teal)

### Future — Option C (Role Combination, explicitly controlled):
- A user can be assigned multiple roles per tenant
- System Admin + TA, or System Admin + HM — configured by admin
- Role switcher in topbar when user has multiple roles
- Audit trail records which role was active per action
- Approval conflict rules — admin-TA cannot approve own actions

---

## ARCHITECTURAL MUSTS — OPTION C EXTENSION

These are non-negotiable architectural decisions that must be
implemented correctly in MVP 1 so Option C is additive later.
No schema changes, no rebuilds, no migrations required.

### MUST 1 — User model: roles as array from day one

```typescript
// DynamoDB user record — implement exactly this way
interface TalentFlowUser {
  userId: string
  tenantId: string
  roles: ('ADMIN' | 'TA' | 'HM' | 'IT')[]  // ALWAYS array, never string
  activeRole: 'ADMIN' | 'TA' | 'HM' | 'IT' // which role is active now
  email: string
  name: string
  createdAt: string
}
// In MVP 1: roles array has one item. activeRole = roles[0]
// In Option C: roles array has multiple items. activeRole changes on switch
// NO schema change required when extending to Option C
```

### MUST 2 — Permission checks: always check array

```typescript
// permission.helper.ts — implement exactly this way
export function hasRole(
  user: TalentFlowUser,
  role: string
): boolean {
  return user.roles.includes(role as any)
}

export function hasActiveRole(
  user: TalentFlowUser,
  role: string
): boolean {
  return user.activeRole === role
}
// In MVP 1: hasRole and hasActiveRole return same result
// In Option C: hasRole checks if role is assigned,
// hasActiveRole checks which hat they are wearing right now
// NO code change required in Option C — function already supports arrays
```

### MUST 3 — AdminGuard: check roles array, not single role

```typescript
// admin.guard.ts — implement exactly this way
@Injectable({ providedIn: 'root' })
export class AdminGuard implements CanActivate {
  private auth = inject(TalentFlowAuthService)

  canActivate(): boolean {
    const user = this.auth.currentUser()
    return user?.roles.includes('ADMIN') ?? false
  }
}
// In Option C: same guard, no change. Already checks array.
```

### MUST 4 — Role pill component: array-aware from day one

```typescript
// role-pill.component.ts — implement exactly this way
@Component({
  selector: 'tf-role-pill',
  standalone: true,
  inputs: ['roles', 'activeRole'],
  // If roles.length === 1: render static badge
  // If roles.length > 1: render dropdown switcher (Option C)
  // In MVP 1: always renders static badge (one role in array)
  // In Option C: renders dropdown when multiple roles present
  // NO component replacement required in Option C
})
export class RolePillComponent {
  roles = input<string[]>([])
  activeRole = input<string>('')
}
```

### MUST 5 — Cognito JWT claims: roles array from day one

```javascript
// lambda/talentFlowPreTokenTrigger/index.js
// Extend this existing Lambda — add roles array to JWT claims
exports.handler = async (event) => {
  // Read user's roles from DynamoDB (array)
  const user = await getUserFromDynamo(event.userName, tenantId)

  event.response.claimsOverrideDetails = {
    claimsToAddOrOverride: {
      'custom:roles': JSON.stringify(user.roles), // array as JSON string
      'custom:activeRole': user.activeRole,        // current active role
      'custom:tenantId': user.tenantId,
    }
  }
  return event
}
// In MVP 1: roles array always has one item
// In Option C: array has multiple items, activeRole changes on switch
// NO Lambda change required in Option C
```

### MUST 6 — Audit trail: activeRole recorded on every event

```typescript
// Every audit event must include activeRole
interface AuditEvent {
  eventId: string
  tenantId: string
  userId: string
  activeRole: string  // which role was active when action taken
  action: string
  entityType: string
  entityId: string
  payload: Record<string, unknown>
  timestamp: string
}
// In MVP 1: activeRole always matches the single role
// In Option C: activeRole reflects whichever hat was being worn
// NO schema change required — field exists from day one
```

### MUST 7 — DynamoDB user table: support role assignment management

```
PK: TENANT#{tenantId}#USER#{userId}
SK: PROFILE
Attributes:
  - roles: string[]          // always array
  - activeRole: string       // current active role
  - assignedQueues: string[] // for IT specialists — which Queues they belong to
  - createdAt: string
  - updatedAt: string
  - createdBy: string        // who assigned this user
```

### MUST 8 — Provisioning bundle DynamoDB schema

```
// talent-flow-state table — new entity types

// PROVISIONING BUNDLE
PK: TENANT#{tenantId}#BUNDLE#{bundleId}
SK: METADATA
Attributes:
  - bundleId: string
  - candidateId: string
  - tenantId: string
  - templateId: string        // which config template was used
  - configVersion: number     // locked at creation — same versioning pattern
  - status: 'PENDING_HM_REVIEW' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETE'
  - hmUserId: string          // which HM must approve
  - hmReviewSLADue: string    // when HM review SLA expires
  - approvedAt: string        // when HM approved
  - approvedBy: string        // HM userId
  - completedAt: string
  - candidateStartDate: string
  - createdAt: string

// PROVISIONING TASK
PK: TENANT#{tenantId}#BUNDLE#{bundleId}
SK: TASK#{taskId}
Attributes:
  - taskId: string
  - bundleId: string
  - requirementType: string   // 'LAPTOP' | 'EMAIL' | 'ACCESS_CARD' | etc
  - queueId: string           // which Queue this task belongs to
  - status: 'OPEN' | 'CLAIMED' | 'IN_PROGRESS' | 'COMPLETE' | 'BREACHED'
  - assignedTo: string        // specialist userId, null if unassigned
  - claimedAt: string
  - completedAt: string
  - slaDueAt: string          // calculated from start date - Queue lead time
  - hmNote: string            // note added by HM during review
  - assetReference: string    // logged by IT on completion
  - fulfilmentMethod: string  // logged by IT on completion
  - fulfilmentNotes: string   // logged by IT on completion
  - createdAt: string

// GSI for Queue queries
GSI1PK: TENANT#{tenantId}#QUEUE#{queueId}
GSI1SK: STATUS#{status}#SLADUE#{slaDueAt}
// Allows IT specialist to query all tasks in their queue by status and SLA
```

### MUST 9 — Config table: IT module config entries

```
// talent-flow-config table — new config types

// QUEUE DEFINITION
PK: TENANT#{tenantId}
SK: CONFIG#IT_QUEUES#v{version}
data: {
  queues: [
    {
      queueId: string
      name: string           // 'Hardware' | 'Access & Identity' | etc
      description: string
      requirementTypes: string[] // which req types route here
      specialists: string[]      // userIds of IT specialists in this queue
      slaWindowDays: number      // lead time before start date
      isActive: boolean
    }
  ]
}

// PROVISIONING TEMPLATE
PK: TENANT#{tenantId}
SK: CONFIG#PROVISIONING_TEMPLATES#v{version}
data: {
  templates: [
    {
      templateId: string
      roleType: string       // 'ENGINEER' | 'PRODUCT_MANAGER' | etc
      seniority: string      // 'JUNIOR' | 'MID' | 'SENIOR'
      department: string     // optional modifier
      requirementTypes: [    // what this template includes
        {
          type: string       // 'LAPTOP' | 'EMAIL' | 'ACCESS_CARD' | etc
          queueId: string    // which queue handles this requirement type
          checklist: string[] // steps IT specialist must complete
          notes: string      // default notes for IT
        }
      ]
    }
  ]
}
// Templates follow same versioning as other config
// In-flight bundles locked to configVersion at creation
// Config changes only affect new bundles — same pattern as scoring weights
```

### MUST 10 — EventBridge events for IT module

```javascript
// New events to add to talent-flow-bus

// Fired when offer is accepted — triggers bundle creation
{
  source: 'talent-flow.offers',
  DetailType: 'OfferAccepted',
  Detail: {
    candidateId, tenantId, hmUserId,
    role, seniority, department,
    startDate, configVersion
  }
}

// Fired when bundle is created — notifies HM
{
  source: 'talent-flow.provisioning',
  DetailType: 'ProvisioningBundleCreated',
  Detail: { bundleId, candidateId, tenantId, hmUserId }
}

// Fired when HM approves — creates queue tasks
{
  source: 'talent-flow.provisioning',
  DetailType: 'ProvisioningBundleApproved',
  Detail: { bundleId, candidateId, tenantId, approvedBy }
}

// Fired when task SLA breaches
{
  source: 'talent-flow.provisioning',
  DetailType: 'ProvisioningTaskSLABreached',
  Detail: {
    taskId, bundleId, candidateId, tenantId,
    queueId, requirementType, escalationLevel
  }
}

// Fired when task is completed
{
  source: 'talent-flow.provisioning',
  DetailType: 'ProvisioningTaskCompleted',
  Detail: {
    taskId, bundleId, candidateId, tenantId,
    completedBy, requirementType
  }
}

// Fired when all tasks complete
{
  source: 'talent-flow.provisioning',
  DetailType: 'ProvisioningBundleComplete',
  Detail: { bundleId, candidateId, tenantId, completedAt }
  // This event feeds into Day 1 Readiness in MVP 2
}
```

### MUST 11 — New Lambda functions required

```
lambda/createProvisioningBundle/
  - Triggered by: ProvisioningBundleCreated EventBridge rule
  - Reads: provisioning template config (by role + seniority)
  - Creates: bundle record + individual task records in DynamoDB
  - Publishes: ProvisioningBundleCreated event
  - Pattern: follow orchestrateTalentFlowWorkflow patterns

lambda/approveProvisioningBundle/
  - Triggered by: API Gateway POST /provisioning/bundles/{id}/approve
  - Updates: bundle status to APPROVED
  - Creates: individual Queue task records
  - Publishes: ProvisioningBundleApproved event
  - Pattern: follow advanceCandidateStage patterns

lambda/getProvisioningBundle/
  - Triggered by: API Gateway GET /provisioning/bundles/{id}
  - Returns: bundle + all task records
  - Used by: HM bundle review screen, TA provisioning tab

lambda/getProvisioningBundles/
  - Triggered by: API Gateway GET /provisioning/bundles
  - Filters: by tenantId, hmUserId, status, queueId
  - Used by: HM provisioning section, IT Queue view, Admin dashboard

lambda/claimProvisioningTask/
  - Triggered by: API Gateway POST /provisioning/tasks/{id}/claim
  - Updates: task status to CLAIMED, sets assignedTo
  - Publishes: notification to Queue

lambda/completeProvisioningTask/
  - Triggered by: API Gateway POST /provisioning/tasks/{id}/complete
  - Updates: task status to COMPLETE, locks fulfilment notes
  - Checks: if all bundle tasks complete — fires ProvisioningBundleComplete
  - Publishes: ProvisioningTaskCompleted event
  - Notifies: HM and TA via in-app notification

lambda/monitorProvisioningSlAs/
  - Triggered by: EventBridge Scheduler (cron: hourly)
  - Scans: all active provisioning tasks past SLA due date
  - Publishes: ProvisioningTaskSLABreached events
  - Reads: active SLA config (not versioned — same as monitorTalentFlowSLAs)
  - Pattern: follow monitorTalentFlowSLAs exactly

lambda/manageProvisioningConfig/
  - Triggered by: API Gateway GET/PUT /provisioning/config/{type}
  - Handles: QUEUE definitions, PROVISIONING_TEMPLATES, ROUTING_RULES
  - Pattern: follow manageTalentFlowConfig exactly
  - Versioning: same pattern — every PUT creates new version,
    marks previous isActive: false
```

### MUST 12 — Terraform additions (talent-flow-infra only)

```hcl
// Add to talent-flow-infra/ — do NOT touch infra/

// New Lambda functions (8 new)
module "lambda_create_provisioning_bundle" { ... }
module "lambda_approve_provisioning_bundle" { ... }
module "lambda_get_provisioning_bundle" { ... }
module "lambda_get_provisioning_bundles" { ... }
module "lambda_claim_provisioning_task" { ... }
module "lambda_complete_provisioning_task" { ... }
module "lambda_monitor_provisioning_slas" { ... }
module "lambda_manage_provisioning_config" { ... }

// New EventBridge rules
resource "aws_cloudwatch_event_rule" "offer_accepted_to_bundle_creator" { ... }
resource "aws_cloudwatch_event_rule" "bundle_approved_to_task_creator" { ... }
resource "aws_cloudwatch_event_rule" "provisioning_sla_monitor_schedule" { ... }

// New API Gateway routes
POST /provisioning/bundles/{id}/approve
POST /provisioning/bundles/{id}/modify
GET  /provisioning/bundles
GET  /provisioning/bundles/{id}
POST /provisioning/tasks/{id}/claim
POST /provisioning/tasks/{id}/complete
GET  /provisioning/config/{type}
PUT  /provisioning/config/{type}

// DynamoDB: no new tables — use existing talent-flow-state table
// and talent-flow-config table. New entity types only.
// Add new GSI to talent-flow-state for Queue queries if not exists:
GSI: QUEUE#{queueId} / STATUS#{status}#SLADUE#{slaDueAt}
```

---

## SCREEN DECISIONS — ALL SEVEN SCREENS

### Screen 1 — HM Provisioning Section
**Route:** `/talent-flow/hm/provisioning`
**Decision 1:** Dedicated nav item "Provisioning" added to HM topbar navigation. HM nav is now: My Tasks · My Candidates · Decisions · Provisioning
**Decision 2:** Signal strip: three cards — Awaiting your review (red) · In fulfilment at risk (amber) · Ready for Day 1 (green)
**Decision 3:** Pending review section — maximum shown before "View all": no limit — all pending bundles shown (TA dashboard was 2 max but provisioning review is operationally critical)
**Decision 4:** In fulfilment section — maximum 3 shown, "View all →" link for rest
**Decision 5:** Bundle card shows: candidate avatar, name, role pill, seniority pill, start date chip, SLA health bar, health state badge, auto-generated requirement types (not specific assets), which Queue each routes to, template name in footer
**Decision 6:** Two actions on pending bundles: "Modify" (inline edit) + "Review & Approve" (opens bundle review screen)
**Decision 7:** Urgent bundle: red border (1.5px) treatment
**Decision 8:** At risk bundle: indigo border (1.5px) treatment
**Decision 9:** Bell notification alerts HM when new bundle needs review — clicking takes them to Provisioning section, not My Tasks

### Screen 2 — HM Bundle Review & Approve
**Route:** `/talent-flow/hm/provisioning/:bundleId/review`
**Decision 10:** Breadcrumb: Provisioning → Review bundle — [Candidate Name]
**Decision 11:** Two column layout: main column (working area) + right sidebar (SLA, approval chain, what happens)
**Decision 12:** Candidate strip: avatar, name, role, seniority, department, start date, days remaining (red when urgent)
**Decision 13:** Signal Intelligence box fires when review SLA is breached — red treatment, specific and actionable
**Decision 14:** Requirement rows: requirement type, Queue routing, "From template" tag, edit (pencil) and remove (trash) icons, optional notes field
**Decision 15:** Inline edit: clicking pencil expands a notes textarea on that row — no navigation away. Notes only — cannot change Queue routing from inline edit
**Decision 16:** "Add requirement" button: dashed ghost style — for items not in template
**Decision 17:** "From template" tag shown on auto-generated items — manually added items have no tag
**Decision 18:** Right sidebar: Review SLA health bar + Approval chain (Queue-level, not specialist-level) + What Happens On Approval (three bullet points)
**Decision 19:** Footer CTA: "Approve bundle & send to IT queues" — deliberate label, not generic Submit
**Decision 20:** Lock note: "Cannot be changed after approval"
**Decision 21:** Approval chain in sidebar shows Queues as steps — not individual specialists

### Screen 3 — HM Bundle Progress
**Route:** `/talent-flow/hm/provisioning/:bundleId`
**Decision 22:** Breadcrumb: Provisioning → Bundle progress — [Candidate Name]
**Decision 23:** Candidate strip includes overall progress bar + four-count summary (Complete / Breached / In Progress / Pending) immediately below candidate strip
**Decision 24:** Signal Intelligence fires in red when any task breached — names exact risk and consequence
**Decision 25:** Completed task rows dimmed (opacity 0.75) — audit trail preserved, eye goes to problem
**Decision 26:** Each completed task shows specialist name and Queue
**Decision 27:** Breached task: red border, "Unassigned" specialist treatment, HM note visible, two inline actions — Add Note + Escalate Now
**Decision 28:** Escalate Now = in-app notification to IT Manager (MVP 1) — email notifications are MVP 2
**Decision 29:** Tasks are self-claimed by IT specialists from the Queue — not auto-assigned by system
**Decision 30:** Right sidebar: Day 1 Readiness gauge (%) + Action Required panel (escalation promoted to sidebar when breach active) + Activity Log
**Decision 31:** Activity log: bundle-level events only — approvals, completions, breaches. Task-level notes remain on task row only

### Screen 4 — IT Specialist Queue View
**Route:** `/talent-flow/it/queue`
**Decision 32:** IT Specialist navigation: two items only — My Queue · Completed. No access to any other TalentFlow navigation
**Decision 33:** Role pill shows IT — visually distinct from TA (indigo) and HM (teal)
**Decision 34:** Signal strip: four cards — Breached / At Risk / Claimed by me / On Track
**Decision 35:** Queue selector: specialist sees only their assigned Queues (locked by System Admin) with count badges — switches between them inline on same page
**Decision 36:** IT specialist cannot pick up tasks from Queues outside their assignment
**Decision 37:** Default sort: start date soonest first — planning by deadline not breach status
**Decision 38:** Task card shows: requirement type, seniority spec, new hire context (name, role, start date, days remaining — no salary, no offer details), SLA health bar, HM note (italic, not dominant)
**Decision 39:** Days remaining colour: red under 14 days, amber 14–30 days, green over 30 days
**Decision 40:** CTA changes by urgency and claim state:
  - Breached unassigned → "Claim & resolve" in red
  - At risk unassigned → "Claim task" in indigo
  - Claimed by me → "View & complete"
  - On track unassigned → "Claim task" in indigo

### Screen 5 — IT Specialist Task Detail
**Route:** `/talent-flow/it/queue/:taskId`
**Decision 41:** Breadcrumb: My Queue → [Queue name] → [Requirement type] — [Candidate name]
**Decision 42:** New hire context shows: name, role, seniority, department, start date, days to start, delivery location — no offer details, salary, or hiring journey data
**Decision 43:** HM note shown prominently — attributed to HM by name and role
**Decision 44:** Fulfilment checklist: configurable per requirement type per tenant — hardware tasks have hardware-specific steps, access tasks have different steps
**Decision 45:** All checklist items must be ticked before "Mark as complete" CTA is enabled
**Decision 46:** Fulfilment form: asset reference (mandatory), fulfilment method (dropdown), additional notes (optional)
**Decision 47:** Asset reference is mandatory — specialist must log what specific item was used before completing
**Decision 48:** Release back to queue requires a reason — not a silent one-click release
**Decision 49:** Footer CTA: "Mark as complete" in green + "Notifies HM and TA immediately" note
**Decision 50:** On completion: bundle progress updates immediately, HM and TA notified via in-app, fulfilment notes locked to audit trail — immutable
**Decision 51:** Right sidebar: Claimed by panel (with release link) + On Completion panel + Task Activity log
**Decision 52:** Task activity log: full trail from bundle creation, SLA events, claim event, completion

### Screen 6 — TA Candidate Record Provisioning Tab
**Location:** "Provisioning" tab within the candidate record — sits between Offer and Engagement tabs
**Decision 53:** Provisioning tab added to the fixed candidate record tab bar: Overview · Interviews · Offer · Provisioning · Engagement · Notes
**Decision 54:** Tab badge: red count showing breached items only — not total outstanding
**Decision 55:** Readiness strip: Complete count + Breached count + Readiness percentage — three cards immediately visible at top of tab
**Decision 56:** Overall progress bar shown below readiness strip
**Decision 57:** Signal Intelligence fires in red when any task breached — specific, names exact problem, confirms what has already been actioned
**Decision 58:** Bundle shows all requirement rows — same visual treatment as HM and IT views for consistency
**Decision 59:** Completed tasks dimmed — specialist name shown on each completed task
**Decision 60:** Breached task: red border, unassigned treatment
**Decision 61:** Read-only note at bottom of bundle: explicit "You have visibility only — provisioning is managed by the Hiring Manager and IT specialists"
**Decision 62:** TA has no actions on provisioning tasks — visibility only, no editing
**Decision 63:** Activity panel (right column): full provisioning trail from bundle auto-creation to current state — all events visible to TA

### Screen 7 — System Admin Workspace
**Route:** `/talent-flow/admin/` (dedicated shell, separate from main platform)
**Decision 64:** Admin Workspace is a completely separate shell — own navigation, own topbar, own URL space
**Decision 65:** Topbar: "Admin Workspace" badge next to brand name + red role pill (ADMIN) + "Exit to platform" button (exits to login/tenant home in MVP 1 Option A)
**Decision 66:** No operational nav links in admin topbar — admin is isolated from operational screens
**Decision 67:** Left sidebar navigation with four sections:
  - Overview (Global dashboard)
  - Global config (Users & roles, Tenant settings, Workflow templates, Audit & compliance)
  - TalentFlow config (Scoring weights, SLA thresholds, Panel rules, Sentiment scales)
  - IT Request config (Queue management, Provisioning templates, Routing rules)
**Decision 68:** Sidebar items: left border highlight when active (indigo), hover state on all items
**Decision 69:** Sidebar badge on Queue management shows count of issues needing attention
**Decision 70:** Queue Management page: signal strip (tenant-wide numbers) + queue table (name, description, specialists, SLA window, open tasks, status, Manage/Edit actions) + two-column section below (provisioning templates + global dashboard summary)
**Decision 71:** Provisioning templates table: role + seniority combination, requirement types shown as pills, Edit action
**Decision 72:** Global Provisioning Dashboard: separate dedicated page (not inline only) — accessible from sidebar Global dashboard item. Shows full table of all active bundles, filterable by queue, health, HM, days to start. Inline summary panel on Queue Management page remains as quick glance only
**Decision 73:** Queue definitions are fully configurable per tenant — name, description, requirement types, specialists, SLA window, active/inactive status
**Decision 74:** Provisioning templates configurable per tenant per role + seniority combination
**Decision 75:** Routing rules configurable — which requirement type routes to which Queue
**Decision 76:** All config changes follow same versioning pattern as rest of platform — every change creates new version, in-flight bundles locked to configVersion at creation, new bundles use latest active config

---

## METADATA-LITE PRINCIPLE — IT REQUEST MODULE

Everything configurable lives in the config table. Nothing is hardcoded.

| Config Type | What it controls | Who changes it |
|-------------|-----------------|----------------|
| IT_QUEUES | Queue definitions, specialists, SLA windows | System Admin |
| PROVISIONING_TEMPLATES | What each role+seniority gets | System Admin |
| ROUTING_RULES | Which requirement type goes to which Queue | System Admin |
| HM_REVIEW_SLA | How long HM has to review a bundle | System Admin |
| FULFILMENT_CHECKLISTS | Steps per requirement type | System Admin |

All follow the same versioning pattern:
- Every PUT creates v(n+1), marks previous isActive: false
- In-flight bundles locked to configVersion at creation
- Config changes only affect new bundles
- TTL on inactive versions: 365 days (audit trail then auto-clean)

---

## UNIVERSAL RISK TIMER — PROVISIONING SLAs

Same 50/75/100 model as rest of platform. No exact times surfaced anywhere.

| SLA Type | 50% | 75% | 100% |
|----------|-----|-----|------|
| HM Review | On Track | At Risk — nudge HM | Breached — notify TA + HR Director |
| Queue Task | On Track | At Risk — visible in Queue | Breached — notify HM + TA, Admin sees in global dashboard |
| Bundle overall | On Track | At Risk — HM bundle progress shows amber | Breached — red treatment across all views |

SLA windows are configurable per Queue per tenant.
SLA bars are visual fill only — no numbers, no time values, ever.

---

## ANGULAR FRONTEND STRUCTURE — NEW FILES

```
hr-portal/src/app/features/talent-flow/
├── pages/
│   ├── hm-provisioning/                    ← NEW — HM provisioning section (Screen 1)
│   │   ├── hm-provisioning.component.ts
│   │   ├── hm-provisioning.component.html
│   │   └── hm-provisioning.component.scss
│   ├── hm-bundle-review/                   ← NEW — bundle review screen (Screen 2)
│   │   ├── hm-bundle-review.component.ts
│   │   ├── hm-bundle-review.component.html
│   │   └── hm-bundle-review.component.scss
│   ├── hm-bundle-progress/                 ← NEW — bundle progress screen (Screen 3)
│   │   ├── hm-bundle-progress.component.ts
│   │   ├── hm-bundle-progress.component.html
│   │   └── hm-bundle-progress.component.scss
│   ├── it-queue/                           ← NEW — IT specialist queue view (Screen 4)
│   │   ├── it-queue.component.ts
│   │   ├── it-queue.component.html
│   │   └── it-queue.component.scss
│   ├── it-task-detail/                     ← NEW — IT specialist task detail (Screen 5)
│   │   ├── it-task-detail.component.ts
│   │   ├── it-task-detail.component.html
│   │   └── it-task-detail.component.scss
│   └── candidate-workspace/               ← EXTEND — add Provisioning tab (Screen 6)
│       └── tabs/
│           └── provisioning-tab/          ← NEW — add this tab component
├── components/
│   ├── provisioning-bundle-card/          ← NEW — reusable bundle card
│   ├── provisioning-task-row/             ← NEW — reusable task row
│   ├── provisioning-readiness-strip/      ← NEW — readiness 3-card strip
│   └── role-pill/                         ← NEW — array-aware role pill component
├── services/
│   └── provisioning-api.service.ts        ← NEW — all provisioning API calls
├── models/
│   └── provisioning.models.ts             ← NEW — provisioning TypeScript interfaces
└── admin/                                 ← NEW — Admin Workspace shell
    ├── admin-shell.component.ts           ← NEW — dedicated admin shell
    ├── admin.routes.ts                    ← NEW — admin routing
    └── pages/
        ├── admin-dashboard/               ← NEW — global dashboard
        ├── users-roles/                   ← NEW — user management
        ├── queue-management/              ← NEW — Queue config
        ├── provisioning-templates/        ← NEW — template config
        └── routing-rules/                 ← NEW — routing config
```

---

## ROUTES — NEW ADDITIONS

```typescript
// Extend talent-flow.routes.ts with:
{
  path: 'hm/provisioning',
  component: HmProvisioningComponent,
  canActivate: [HmGuard]
},
{
  path: 'hm/provisioning/:bundleId/review',
  component: HmBundleReviewComponent,
  canActivate: [HmGuard]
},
{
  path: 'hm/provisioning/:bundleId',
  component: HmBundleProgressComponent,
  canActivate: [HmGuard]
},
{
  path: 'it/queue',
  component: ItQueueComponent,
  canActivate: [ItGuard]
},
{
  path: 'it/queue/:taskId',
  component: ItTaskDetailComponent,
  canActivate: [ItGuard]
},
// Admin workspace — separate routes file
{
  path: 'admin',
  component: AdminShellComponent,
  canActivate: [AdminGuard],
  children: [
    { path: 'overview', component: AdminDashboardComponent },
    { path: 'users', component: UsersRolesComponent },
    { path: 'it-request/queues', component: QueueManagementComponent },
    { path: 'it-request/templates', component: ProvisioningTemplatesComponent },
    { path: 'it-request/routing', component: RoutingRulesComponent },
  ]
}
```

---

*Document owner: TalentFlow Product Team*
*Last updated: IT Request Module fully locked — all 7 screens + architectural musts*
*Status: Ready for implementation*
*Implementation files: See IT_IMPL_01 through IT_IMPL_06*
