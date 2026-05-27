# TalentFlow Admin Workspace — Implementation Handover
## Sections 1 & 2: Global Dashboard + Users & Roles
## For Claude Code | Implementation Guide

---

## CRITICAL — READ BEFORE WRITING ANY CODE

1. Read TALENTFLOW_CONTEXT.md, TALENTFLOW_DECISIONS.md,
   TALENTFLOW_SCREENS.md, TALENTFLOW_IT_MODULE.md, and
   .claude/SKILL.md in that order before doing anything.

2. Read the existing codebase first:
   - `hr-portal/src/app/features/talent-flow/services/talent-flow-api.service.ts`
   - `hr-portal/src/app/core/services/auth.service.ts`
   - `hr-portal/src/app/core/interceptors/auth.interceptor.ts`
   - `hr-portal/src/app/features/talent-flow/pages/config/` — ALL existing config pages
   - `hr-portal/src/app/features/talent-flow/guards/admin.guard.ts`
   - `hr-portal/src/app/features/talent-flow/talent-flow.routes.ts`
   - `talent-flow-infra/talent-flow-cognito.tf`
   - `lambda/talentFlowPreTokenTrigger/`
   - `lambda/manageTalentFlowConfig/`

3. DO NOT regress any existing functionality. The existing config pages
   at `/talent-flow/config/` must continue to work independently.
   They are being copied into the admin workspace — NOT replaced.
   Decommission of old routes happens at a later stage explicitly.

4. Use PrimeNG components first — query PrimeNG MCP before writing
   any custom component. Use Angular MCP for all Angular APIs.

5. All components: standalone: true, OnPush, inject(), signals,
   reactive forms, Naleko CSS tokens only — no hardcoded hex values.

---

## WHAT WE ARE BUILDING IN THIS PHASE

The Admin Workspace is a completely separate shell within the
TalentFlow Angular application. It has:
- Its own topbar (different from TA/HM topbar)
- Its own left sidebar navigation
- Its own URL space: `/talent-flow/admin/`
- Its own shell component
- Protected by AdminGuard (already exists — verify it checks
  user.roles array, update if it checks single role string)

This phase builds two sections:
- Section 1: Global Dashboard (`/talent-flow/admin/overview`)
- Section 2: Users & Roles (`/talent-flow/admin/users`)

The other five sections (Tenant Settings, TalentFlow Config,
IT Request Config, Notifications, Audit) come in subsequent phases.

---

## FILE STRUCTURE — WHAT TO CREATE

Based on the existing codebase structure, create the following
new files. Do NOT modify existing files outside of routes.

```
hr-portal/src/app/features/talent-flow/
└── admin/                                    ← NEW directory
    ├── admin.routes.ts                       ← NEW — admin child routes
    ├── shell/
    │   ├── admin-shell.component.ts          ← NEW — admin workspace shell
    │   ├── admin-shell.component.html        ← NEW
    │   └── admin-shell.component.scss        ← NEW
    ├── components/
    │   ├── admin-sidebar/
    │   │   ├── admin-sidebar.component.ts    ← NEW — left nav sidebar
    │   │   ├── admin-sidebar.component.html  ← NEW
    │   │   └── admin-sidebar.component.scss  ← NEW
    │   └── role-pill/
    │       ├── role-pill.component.ts        ← NEW — array-aware role pill
    │       ├── role-pill.component.html      ← NEW
    │       └── role-pill.component.scss      ← NEW
    ├── pages/
    │   ├── overview/
    │   │   ├── overview.component.ts         ← NEW — Section 1: Global Dashboard
    │   │   ├── overview.component.html       ← NEW
    │   │   └── overview.component.scss       ← NEW
    │   └── users-roles/
    │       ├── users-roles.component.ts      ← NEW — Section 2: Users & Roles
    │       ├── users-roles.component.html    ← NEW
    │       ├── users-roles.component.scss    ← NEW
    │       └── components/
    │           ├── add-user-drawer/
    │           │   ├── add-user-drawer.component.ts   ← NEW
    │           │   ├── add-user-drawer.component.html ← NEW
    │           │   └── add-user-drawer.component.scss ← NEW
    │           └── edit-roles-drawer/
    │               ├── edit-roles-drawer.component.ts   ← NEW
    │               ├── edit-roles-drawer.component.html ← NEW
    │               └── edit-roles-drawer.component.scss ← NEW
    ├── models/
    │   └── admin.models.ts                   ← NEW — admin TypeScript interfaces
    └── services/
        └── admin-api.service.ts              ← NEW — admin API calls
```

### Modify these existing files (minimally):

```
hr-portal/src/app/features/talent-flow/talent-flow.routes.ts
  → ADD: admin routes as lazy-loaded child routes
  → DO NOT remove or change any existing routes

hr-portal/src/app/features/talent-flow/guards/admin.guard.ts
  → VERIFY: checks user.roles.includes('ADMIN') not user.role === 'ADMIN'
  → UPDATE if needed to check array — no other changes

lambda/talentFlowPreTokenTrigger/index.js
  → VERIFY: embeds custom:roles as JSON array string in JWT
  → VERIFY: embeds custom:activeRole in JWT
  → UPDATE if currently embedding single role string
```

---

## ARCHITECTURAL MUSTS — IMPLEMENT EXACTLY THIS WAY

These are non-negotiable. They enable Option C (multi-role)
without any future schema changes or rebuilds.

### 1. User TypeScript interface — always roles as array

```typescript
// admin/models/admin.models.ts
export interface TalentFlowUser {
  userId: string
  tenantId: string
  email: string
  firstName: string
  lastName: string
  roles: TalentFlowRole[]        // ALWAYS array — never single string
  activeRole: TalentFlowRole     // which role is currently active
  assignedQueues?: string[]      // for IT specialists only
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING_INVITE'
  lastActiveAt?: string
  createdAt: string
  createdBy: string
}

export type TalentFlowRole = 'ADMIN' | 'TA' | 'HM' | 'IT'

export interface CreateUserRequest {
  firstName: string
  lastName: string
  email: string
  roles: TalentFlowRole[]        // array from creation
  assignedQueues?: string[]
}

export interface UpdateUserRolesRequest {
  roles: TalentFlowRole[]        // array update
  assignedQueues?: string[]
  status?: 'ACTIVE' | 'INACTIVE'
}
```

### 2. AdminGuard — check roles array

```typescript
// guards/admin.guard.ts — verify and update to this
import { inject } from '@angular/core'
import { CanActivateFn, Router } from '@angular/router'
import { TalentFlowAuthService } from '../services/talent-flow-auth.service'

export const adminGuard: CanActivateFn = () => {
  const auth = inject(TalentFlowAuthService)
  const router = inject(Router)
  const user = auth.currentUser()

  // Check roles ARRAY — not single role string
  if (user?.roles?.includes('ADMIN')) {
    return true
  }

  router.navigate(['/talent-flow/dashboard'])
  return false
}
```

### 3. Role pill component — array-aware

```typescript
// admin/components/role-pill/role-pill.component.ts
import { Component, input, computed } from '@angular/core'
import { CommonModule } from '@angular/common'
import { TalentFlowRole } from '../../models/admin.models'

@Component({
  selector: 'tf-role-pill',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Single role: static badge -->
    @if (roles().length === 1) {
      <span class="role-badge" [class]="roleCssClass()">
        {{ activeRole() }}
      </span>
    }
    <!-- Multiple roles: show all badges (Option C ready) -->
    @if (roles().length > 1) {
      @for (role of roles(); track role) {
        <span class="role-badge" [class]="getRoleCssClass(role)">
          {{ role }}
        </span>
      }
    }
  `
})
export class RolePillComponent {
  roles = input<TalentFlowRole[]>([])
  activeRole = input<TalentFlowRole>('TA')

  roleCssClass = computed(() => `role-badge--${this.activeRole().toLowerCase()}`)

  getRoleCssClass(role: TalentFlowRole): string {
    return `role-badge--${role.toLowerCase()}`
  }
}
// In MVP 1: roles array always has one item
// In Option C: roles array has multiple items, all shown
// NO component change required for Option C
```

### 4. Admin routes — lazy loaded

```typescript
// Add to talent-flow.routes.ts — DO NOT remove existing routes
{
  path: 'admin',
  loadChildren: () =>
    import('./admin/admin.routes').then(m => m.ADMIN_ROUTES),
  canActivate: [adminGuard]
}

// admin/admin.routes.ts
import { Routes } from '@angular/router'
import { AdminShellComponent } from './shell/admin-shell.component'

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: AdminShellComponent,
    children: [
      {
        path: '',
        redirectTo: 'overview',
        pathMatch: 'full'
      },
      {
        path: 'overview',
        loadComponent: () =>
          import('./pages/overview/overview.component')
            .then(m => m.OverviewComponent)
      },
      {
        path: 'users',
        loadComponent: () =>
          import('./pages/users-roles/users-roles.component')
            .then(m => m.UsersRolesComponent)
      }
      // Future sections added here — no existing routes affected
    ]
  }
]
```

### 5. Admin Shell component structure

```typescript
// admin/shell/admin-shell.component.ts
@Component({
  selector: 'tf-admin-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AdminSidebarComponent, RouterOutlet],
  template: `
    <!-- Admin-specific topbar — completely separate from TA/HM topbar -->
    <header class="admin-topbar">
      <div class="admin-brand">
        <div class="brand-mark">...</div>
        <span class="brand-name">TalentFlow</span>
        <span class="admin-badge">Admin Workspace</span>
      </div>
      <div class="topbar-right">
        <button class="exit-btn" (click)="exitWorkspace()">
          ← Exit to platform
        </button>
        <p-button icon="ti ti-bell" [rounded]="true" [text]="true" />
        <tf-role-pill [roles]="userRoles()" [activeRole]="activeRole()" />
        <p-avatar [label]="userInitials()" shape="circle" />
      </div>
    </header>

    <!-- Workspace layout: sidebar + content -->
    <div class="admin-workspace">
      <tf-admin-sidebar />
      <main class="admin-content">
        <router-outlet />
      </main>
    </div>
  `
})
export class AdminShellComponent {
  private auth = inject(TalentFlowAuthService)
  private router = inject(Router)

  userRoles = computed(() => this.auth.currentUser()?.roles ?? [])
  activeRole = computed(() => this.auth.currentUser()?.activeRole ?? 'ADMIN')
  userInitials = computed(() => {
    const user = this.auth.currentUser()
    return user ? `${user.firstName[0]}${user.lastName[0]}` : 'SA'
  })

  exitWorkspace(): void {
    // Option A MVP: exit to login
    // Option C future: exit to their active role dashboard
    this.router.navigate(['/talent-flow/dashboard'])
  }
}
```

---

## SECTION 1 — GLOBAL DASHBOARD

### Route: `/talent-flow/admin/overview`
### Component: `OverviewComponent`

**What it shows:**
- Greeting: "Good morning, [Admin name]" + tenant name chip
- Global signal strip: 4 cards (SLA Breaches · At Risk · Active Candidates · Active Users)
- Module health cards: 2 columns (TalentFlow hiring + IT Request provisioning)
- Active breaches table: cross-module, 4 columns (Entity · Module · Breach type · Health)
- Tenant activity feed: chronological cross-module events (last 10)
- Active users widget: who logged in today, role, last active, online dot

**PrimeNG components to use:**
- `p-card` — module health cards
- `p-table` — breach table
- `p-tag` — module tags (TalentFlow / IT Request)
- `p-badge` — signal strip counts
- `p-avatar` — user avatars in active users widget
- `p-skeleton` — loading states while data fetches

**Data to fetch on load:**
```typescript
// All via admin-api.service.ts
// GET /admin/dashboard — returns all signals in one call
interface AdminDashboardResponse {
  signals: {
    activeSLABreaches: number
    atRisk: number
    activeCandidates: number
    activeUsersToday: number
  }
  talentFlowHealth: {
    activeCandidates: number
    slaBreaches: number
    offersPendingAcceptance: number
    hesitantAcceptances: number
    configVersion: string
  }
  itRequestHealth: {
    activeBundles: number
    pendingHMReview: number
    tasksUnassigned: number
    startingThisWeek: number
    queueConfigVersion: string
  }
  activeBreaches: ActiveBreach[]
  recentActivity: ActivityEvent[]
  activeUsers: ActiveUser[]
}
```

**Signal strip card design:**
- Background: white card
- Left border: 3px coloured (red/amber/indigo/green)
- Label: 9px uppercase muted
- Value: 24px Manrope bold, coloured
- Sub-text: 9px muted description
- Cards are clickable — navigate to relevant section

**Breach table design:**
- Rows sorted: worst health first
- Entity cell: small avatar + name + context
- Module tag: coloured pill (TalentFlow = indigo, IT Request = teal)
- Max 10 rows shown — "View all →" links to audit page
- Row click: navigates to relevant candidate record or bundle

**Activity feed:**
- Max 10 items shown — "Full audit →" links to audit page
- Each item: coloured dot + connector line + description + timestamp + module source
- Dot colours: red (breach), green (completion), indigo (config change), amber (at risk), neutral (user action)

**Active users widget:**
- Online dot: green if active in last 30 min, grey otherwise
- Role badge shown per user
- Max 5 shown — "Manage →" links to Users & Roles page

---

## SECTION 2 — USERS & ROLES

### Route: `/talent-flow/admin/users`
### Component: `UsersRolesComponent`

**What it shows:**
- Page header + "Add user" button
- Search input + role filter chips
- User table (6 columns)
- Add User drawer (slides from right)
- Edit Roles drawer (slides from right when "Edit roles" clicked)

**PrimeNG components to use:**
- `p-table` — user table with sort and filter
- `p-inputtext` — search input
- `p-drawer` — Add User and Edit Roles drawers (PrimeNG 19)
- `p-checkbox` — role selector checkboxes in drawer
- `p-tag` — role badges
- `p-avatar` — user avatars
- `p-button` — all action buttons
- `p-confirmdialog` — deactivation confirmation
- `p-toast` — success/error feedback
- `p-skeleton` — loading state

**User table columns:**
1. User — avatar (p-avatar) + name + email
2. Roles — role pills (tf-role-pill component, roles array)
3. Queue assignment — Queue badges for IT specialists, dash for others
4. Status — coloured dot + text (Active / Inactive / Pending invite)
5. Last active — relative timestamp
6. Actions — "View" ghost + "Edit roles" indigo (active) or "Reactivate" red (inactive)

**Default sort:** Last active — most recent first

**Search behaviour:**
- Real-time, minimum 2 characters
- Searches: name, email
- Client-side filter on loaded user list (not server-side for MVP)

**Filter chips:**
- All · TA · HM · IT · Admin · Inactive
- Multi-select NOT supported — single filter at a time
- Active chip: indigo background, white text

**Add User Drawer:**
- Width: 480px (same as Add Candidate drawer)
- Fields:
  - First name + Last name (two inputs, one row)
  - Work email (full width)
  - Role selector (visual checkbox cards — see below)
  - Queue assignment (conditional — only active when IT role checked)
- Role selector card design:
  - Each card: checkbox (left) + icon square + role name + description
  - Selected: indigo border + subtle indigo background tint
  - Multiple cards can be selected simultaneously
  - Roles: TA · HM · IT · Admin
- Queue assignment:
  - Four checkboxes: Hardware · Access & Identity · Software · Facilities
  - Disabled and greyed when IT role not selected
  - Activates when IT role checkbox is ticked
- Architectural note: visible info box explaining roles-as-array pattern
- CTA: "Send invite & create user" — creates Cognito user + DynamoDB record
- Invite email: role-aware content (tells user their role and access)

**Edit Roles Drawer:**
- Same width: 480px
- Shows current user info at top (avatar, name, email, current roles)
- Same role selector as Add User — pre-populated with current roles
- Same Queue assignment — pre-populated with current queues
- Danger zone section at bottom:
  - Separated by a red divider
  - "Deactivate user" button in red ghost style
  - Click shows p-confirmdialog: "Are you sure? This user will lose all platform access immediately."
  - Confirm: updates DynamoDB + Cognito status to INACTIVE
- CTA: "Save changes" — updates roles array in DynamoDB + JWT claims refreshed

**API calls for Section 2:**
```typescript
// admin-api.service.ts
GET  /admin/users              → TalentFlowUser[]
POST /admin/users              → CreateUserRequest → TalentFlowUser
PUT  /admin/users/:userId      → UpdateUserRolesRequest → TalentFlowUser
PUT  /admin/users/:userId/deactivate → void
PUT  /admin/users/:userId/reactivate → void
```

---

## DESIGN TOKENS — USE THESE EXACTLY

Read full design system from:
`/Users/iggie/Documents/naleko-design-handoff/`

Key tokens for admin workspace:

```scss
// Admin topbar — darker than main platform topbar
.admin-topbar {
  background: #1a1a2e;  // var(--naleko-primary)
  height: 48px;
}

// Admin badge in topbar
.admin-badge {
  background: rgba(186, 26, 26, 0.25);
  color: #ff8a80;
  border: 0.5px solid rgba(186, 26, 26, 0.4);
  border-radius: var(--naleko-radius-pill);
  font-size: 9px;
  padding: 2px 7px;
}

// Admin role pill — red treatment (distinct from TA indigo, HM teal)
.role-pill--admin {
  background: rgba(186, 26, 26, 0.2);
  color: #ff8a80;
  border: 0.5px solid rgba(186, 26, 26, 0.3);
}

// Sidebar
.admin-sidebar {
  width: 220px;
  background: var(--naleko-white);
  border-right: 0.5px solid var(--naleko-outline-variant);
}

// Sidebar active item
.sb-item--active {
  background: rgba(74, 63, 138, 0.08);
  color: var(--naleko-secondary);
  border-left: 2px solid var(--naleko-secondary);
}

// Content area
.admin-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background: var(--naleko-surface);
}
```

---

## WHAT NOT TO BUILD IN THIS PHASE

The following are out of scope for Sections 1 and 2.
Do not build these yet:
- Section 3: Tenant Settings
- Section 4: TalentFlow Config (scoring weights etc.) — copy happens later
- Section 5: IT Request Config (queues, templates, routing)
- Section 6: Audit & Compliance
- Section 7: Notifications & Escalations
- Employee 360 view
- Any IT Request Module Lambda functions

The sidebar should show all seven sections in the navigation
(so the shell is complete) but only Sections 1 and 2 routes
are active. All other sidebar items navigate to a
"Coming soon" placeholder page for now — do not hide them.

---

## LAMBDA FUNCTIONS NEEDED FOR SECTIONS 1 & 2

### New Lambda: `adminGetDashboard`
```
GET /admin/dashboard
- Reads: candidate pipeline signals from talent-flow-state
- Reads: provisioning bundle signals from talent-flow-state
- Reads: active user list from DynamoDB users table
- Reads: recent audit events (last 10) from event-ledger
- Returns: AdminDashboardResponse (single aggregated response)
- Pattern: follow getCandidate patterns for DynamoDB reads
- Auth: AdminGuard — JWT must contain 'ADMIN' in roles array
```

### New Lambda: `adminGetUsers`
```
GET /admin/users
- Reads: all users for tenantId from DynamoDB
- Returns: TalentFlowUser[] sorted by lastActiveAt desc
- Auth: AdminGuard
```

### New Lambda: `adminCreateUser`
```
POST /admin/users
- Creates: Cognito user (AdminCreateUser API)
- Creates: DynamoDB user record (roles as array)
- Sends: Cognito invite email (AdminInitiateAuth with FORCE_CHANGE_PASSWORD)
- Publishes: UserCreated event to EventBridge (audit trail)
- Pattern: follow createCandidate patterns
- Auth: AdminGuard
```

### New Lambda: `adminUpdateUser`
```
PUT /admin/users/:userId
- Updates: roles array in DynamoDB
- Updates: assignedQueues in DynamoDB
- Updates: Cognito custom:roles claim (AdminUpdateUserAttributes)
- Publishes: UserRolesUpdated event (audit trail)
- Auth: AdminGuard
```

### New Lambda: `adminDeactivateUser`
```
PUT /admin/users/:userId/deactivate
- Disables: Cognito user (AdminDisableUser)
- Updates: DynamoDB status to INACTIVE
- Publishes: UserDeactivated event (audit trail)
- Auth: AdminGuard
- Cannot deactivate self — guard against this
```

### Extend existing Lambda: `talentFlowPreTokenTrigger`
```
- Verify: embeds custom:roles as JSON.stringify(user.roles) — array
- Verify: embeds custom:activeRole as user.activeRole
- Update if currently embedding single role string
- This is the Cognito Pre Token Generation trigger — already exists
```

---

## EXISTING CONFIG PAGES — DO NOT TOUCH IN THIS PHASE

The following existing pages must continue to work
independently at their current routes. Do not modify them.
They will be copied into the admin workspace in a later phase.

```
/talent-flow/config/scoring-weights    → leave as is
/talent-flow/config/sla-thresholds     → leave as is
/talent-flow/config/panel-rules        → leave as is
/talent-flow/config/config-hub         → leave as is
```

---

## IMPLEMENTATION ORDER — FOLLOW THIS SEQUENCE

Build in this order. Test after each step before moving on.

```
Step 1: Update AdminGuard to check roles array
Step 2: Update talentFlowPreTokenTrigger — verify roles array in JWT
Step 3: Create admin.models.ts — TypeScript interfaces
Step 4: Create admin-api.service.ts — stub all methods first
Step 5: Create AdminShellComponent — topbar + sidebar layout
Step 6: Create AdminSidebarComponent — full nav, placeholder routes
Step 7: Create admin.routes.ts — lazy loaded
Step 8: Add admin routes to talent-flow.routes.ts
Step 9: Verify: /talent-flow/admin/ loads the shell ✓
Step 10: Deploy adminGetDashboard Lambda
Step 11: Build OverviewComponent — Section 1
Step 12: Verify: /talent-flow/admin/overview shows dashboard ✓
Step 13: Deploy adminGetUsers, adminCreateUser, adminUpdateUser, adminDeactivateUser Lambdas
Step 14: Build UsersRolesComponent — Section 2 (table + search + filter)
Step 15: Build AddUserDrawerComponent
Step 16: Build EditRolesDrawerComponent (includes deactivation danger zone)
Step 17: Build RolePillComponent — array-aware
Step 18: Verify: /talent-flow/admin/users shows user table ✓
Step 19: Verify: Add user flow works end to end ✓
Step 20: Verify: Edit roles works end to end ✓
Step 21: Verify: Deactivate user works with confirmation ✓
Step 22: Verify: Existing config pages at /talent-flow/config/* still work ✓
Step 23: Audit — check no regression on existing TA/HM flows ✓
```

---

## SCREENSHOTS FOR REFERENCE

Two screen designs are available as visual reference:
- Section 1: Admin Global Dashboard (rendered in Claude web chat)
- Section 2: Users & Roles with Add User drawer open (rendered in Claude web chat)

Take screenshots of both designs from the Claude conversation
and attach them to this implementation task as visual reference.
The LLM implementing should treat these as the design spec —
match layout, spacing, colour treatment, and component patterns exactly.

---

*Handover document: Sections 1 & 2 only*
*Next phase: Sections 3–7 after Sections 1 & 2 are live and verified*
*Document owner: TalentFlow Product Team*
