# TalentFlow — Claude Code Skill
## How to work in this codebase

---

## 1. START HERE — READ THESE FILES FIRST

Before doing any work on this project, read these files in order:

1. `TALENTFLOW_CONTEXT.md` — what we are building, why, MVP scope, project structure
2. `TALENTFLOW_DECISIONS.md` — 71 locked product and UX decisions (source of truth)
3. `TALENTFLOW_SCREENS.md` — screen-by-screen UX specifications
4. This file — tech stack rules, design system, what to reuse vs rebuild

Do not skip any of these. Every decision is locked. Do not invent alternatives.

---

## 2. THE GOLDEN RULE

Every screen, every component, every button must serve one of:
1. Identify bottlenecks
2. Improve candidate experience
3. Reduce drop-off

If it does not serve one of these, it does not belong in MVP 1.

---

## 3. DESIGN SYSTEM

### Naleko Design System Location
Full design system is at:
```
/Users/iggie/Documents/naleko-design-handoff/
```

**Read the README.md in that folder before writing any component or style code.**
The design system contains:
- Color tokens (CSS custom properties)
- Typography scale and font definitions
- Spacing and radius tokens
- Shadow definitions
- Component examples and patterns
- UI kit reference

### Design System Rules
- NEVER hardcode hex values — always use `var(--naleko-*)` CSS custom properties
- NEVER invent colours not in the design system
- NEVER use arbitrary spacing — use `var(--naleko-space-*)` tokens
- The design system tokens file is at: `hr-portal/src/styles/naleko-tokens.css`
- Additional tokens in: `hr-portal/src/styles/primeng-naleko.scss`

### Key Tokens Reference
```css
--naleko-primary: #1a1a2e          /* anchor navy */
--naleko-primary-deep: #16124d     /* editorial navy — page titles */
--naleko-secondary: #4a3f8a        /* indigo — interactive accents */
--naleko-tertiary: #2d8f9e         /* teal — Add Candidate, brand mark */
--naleko-cyan: #7ad4e4             /* Ask AI button, role pill */
--naleko-surface: #f8f9fa          /* page background */
--naleko-white: #ffffff            /* card backgrounds */
--naleko-success: #2e7d32          /* green health state */
--naleko-warning: #f57f17          /* amber health state */
--naleko-error: #ba1a1a            /* red health state */
--naleko-font-display: 'Manrope'   /* headings, numbers, brand */
--naleko-font-body: 'Inter'        /* all body text, labels */
--naleko-radius-xl: 0.75rem        /* cards */
--naleko-radius-pill: 9999px       /* buttons, tags */
--naleko-shadow-card: 0 2px 12px rgba(26,26,46,0.06)
```

---

## 4. TECH STACK — MANDATORY RULES

### Stack
- **Angular 19** — standalone components only
- **PrimeNG 19** — UI components (PrimeNG first, always)
- **PrimeFlex** — layout and grid system
- **TypeScript** — strict mode
- **SCSS** — component styles (scoped, never global in component files)

### Angular Rules
- All components must be `standalone: true` — no NgModules
- Use Angular Signals for all local state: `signal()`, `computed()`, `effect()`
- Use `inject()` for dependency injection — NOT constructor injection
- Apply `OnPush` change detection on ALL components
- All forms must use Reactive Forms: `FormBuilder`, `FormGroup`, `FormControl`

### PrimeNG Rules — CRITICAL
**Always use PrimeNG components before writing any custom component or CSS.**
Map every design element to a PrimeNG component first.
Never build custom what PrimeNG already provides.

PrimeNG component examples to use:
- Tables → `p-table`
- Buttons → `p-button`
- Inputs → `p-inputtext`, `p-inputnumber`
- Dropdowns → `p-dropdown`, `p-select`
- Dialogs → `p-dialog`, `p-drawer`
- Tags/Badges → `p-tag`, `p-badge`
- Progress bars → `p-progressbar`
- Tooltips → `p-tooltip`
- Sliders → `p-slider`
- Menus → `p-menu`, `p-menubar`
- Breadcrumbs → `p-breadcrumb`
- Tabs → `p-tabview`, `p-tabs`
- Charts → `p-chart`
- Toast → `p-toast`
- Skeleton → `p-skeleton` (loading states)
- Avatar → `p-avatar`
- Chips → `p-chip`
- Divider → `p-divider`

### Styling Rules
- Use PrimeNG design tokens for colours, spacing, typography — never hardcode
- Override tokens in `_theme-overrides.scss` via PrimeNG theming API
- Use SCSS for component styles — scoped, not global
- Responsive breakpoints must follow PrimeNG grid system

---

## 5. MCP — ALWAYS CONSULT BEFORE CODING

**Before writing any Angular or PrimeNG code, query the MCP servers:**

- **Angular MCP** → `https://angular.dev/ai/mcp`
- **PrimeNG MCP** → `https://primeng.org/mcp`

These are your source of truth for APIs, directives, component options, and best practices.
Do NOT rely on prior training knowledge when documentation is available via MCP.

### Pre-coding checklist (run through this every time):
1. Query Angular MCP for any Angular APIs you plan to use (components, directives, lifecycle hooks, router, signals)
2. Query PrimeNG MCP for every UI component you identify in the design
3. Confirm the correct import path, inputs/outputs, and template syntax for PrimeNG 19
4. Map each design element to the correct PrimeNG component
5. Only write custom code if PrimeNG has no suitable component

---

## 6. WHAT TO REUSE FROM THE EXISTING CODEBASE

The existing codebase has patterns that work and are connected to the real backend.
Reuse these — do not reinvent them.

### REUSE — backend communication and auth patterns:
```
hr-portal/src/app/core/services/auth.service.ts
hr-portal/src/app/core/interceptors/auth.interceptor.ts
hr-portal/src/app/features/talent-flow/services/talent-flow-api.service.ts
hr-portal/src/app/features/talent-flow/services/talent-flow-state.service.ts
```

Read these files before building any new service. Understand:
- How JWT tokens are attached to requests
- How CORS is handled
- How errors are caught and surfaced
- The API base URL patterns
- The observable patterns in use

### REVIEW AND EXTEND — data models:
```
hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts
```
Read this. Extend it to match the locked decisions. Do not replace blindly.

### REUSE — routing structure:
```
hr-portal/src/app/features/talent-flow/talent-flow.routes.ts
```
Extend with new routes. Keep existing route patterns.

### REUSE — environment config:
```
hr-portal/src/environments/environment.ts
hr-portal/src/environments/environment.prod.ts
```

### REUSE — also reference the HR onboarding codebase for tech stack patterns:
The legacy HR onboarding feature (`hr-portal/src/app/features/hr-dashboard/`) has
working examples of the full tech stack in action. Read it for pattern reference —
do not modify it.

---

## 7. WHAT TO REBUILD

The existing TalentFlow UI components do not match the locked UX decisions or the
Naleko design system. They must be rebuilt — not patched.

### REBUILD — all page components:
```
hr-portal/src/app/features/talent-flow/pages/dashboard/
hr-portal/src/app/features/talent-flow/pages/pipeline/
hr-portal/src/app/features/talent-flow/pages/candidate-create/
hr-portal/src/app/features/talent-flow/pages/candidate-workspace/
hr-portal/src/app/features/talent-flow/pages/evaluation/
```

### REBUILD — all shared UI components:
```
hr-portal/src/app/features/talent-flow/components/candidate-identity-card/
hr-portal/src/app/features/talent-flow/components/evaluation-scoring-panel/
hr-portal/src/app/features/talent-flow/components/evaluation-summary-widget/
hr-portal/src/app/features/talent-flow/components/sla-timer-widget/
hr-portal/src/app/features/talent-flow/components/stage-selector/
hr-portal/src/app/features/talent-flow/components/ai-chat-panel/
```

### REBUILD — shell/layout:
```
hr-portal/src/app/features/talent-flow/shell/talent-flow-shell.component.ts
```
Must match the locked top navigation structure from TALENTFLOW_SCREENS.md.

---

## 8. INFRASTRUCTURE REFERENCE

- **Use:** `talent-flow-infra/` — TalentFlow Terraform
- **Do not touch:** `infra/` — legacy HR onboarding Terraform

### TalentFlow Lambdas (these are in scope):
```
lambda/createCandidate/
lambda/getCandidate/
lambda/getCandidates/
lambda/scheduleInterview/
lambda/submitVote/
lambda/completeEvaluation/
lambda/orchestrateTalentFlowWorkflow/
lambda/monitorTalentFlowSLAs/
lambda/manageTalentFlowConfig/
lambda/advanceCandidateStage/
lambda/sendTalentFlowNotification/
lambda/talentFlowAiChat/
lambda/shared/config-reader.js
lambda/shared/idempotency.mjs
```

### Legacy HR onboarding Lambdas (do not touch):
createEmployee, getEmployee, getEmployees, processDocumentOCR,
reviewDocumentVerification, generateDocumentUploadUrl, etc.

---

## 9. AUDIT APPROACH

When asked to audit the codebase against the locked decisions:

1. Read `TALENTFLOW_DECISIONS.md` — all 71 decisions
2. Read each existing component/service
3. For each component, determine:
   - Does it match the locked UX decision? (reference decision number)
   - Does it use the Naleko design system correctly?
   - Does it use PrimeNG components where available?
   - Does it follow Angular 19 standalone + signals patterns?
4. Produce a gap list: Decision # | What exists | What is needed | Priority
5. Do not start building until the gap analysis is reviewed and approved

---

## 10. SIGNAL HEALTH — NEVER USE EXACT TIMES

This is a hard rule across the entire platform.

**NEVER:** "6h 12m remaining" / "Due at 3pm" / "2 days overdue"
**ALWAYS:** "At Risk" / "Breached" / "On Track"

The SLA bar is visual only — it shows fill percentage from the 50/75/100 model.
No numbers on the bar. No time labels. Ever.

---

## 11. CONTEXT RECOVERY

If starting a new session on this project, read these files in order:
1. `TALENTFLOW_CONTEXT.md`
2. `TALENTFLOW_DECISIONS.md`
3. `TALENTFLOW_SCREENS.md`
4. This file (`.claude/SKILL.md`)

Then ask the user: "What would you like to work on?" — do not assume.
