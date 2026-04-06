# HR Portal — Frontend Developer Guide

**Version:** 1.0 | **Last Updated:** 31 March 2026 | **Platform:** Naleko Digital Solutions HR Portal  
**Company:** Naleko Digital Solutions — *"Verifying people, building trust."*

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Getting Started](#3-getting-started)
4. [Architecture & Conventions](#4-architecture--conventions)
5. [Project Structure](#5-project-structure)
6. [Design System](#6-design-system)
7. [Routing Map](#7-routing-map)
8. [Models & Interfaces](#8-models--interfaces)
9. [Services & Data Layer](#9-services--data-layer)
10. [Mock Data Inventory](#10-mock-data-inventory)
11. [Feature Inventory — HR Portal](#11-feature-inventory--hr-portal)
12. [Feature Inventory — Employee Portal](#12-feature-inventory--employee-portal)
13. [Shared Components](#13-shared-components)
14. [Client Feedback — Action Items](#14-client-feedback--action-items)
15. [Production Readiness Checklist](#15-production-readiness-checklist)
16. [Service → API Endpoint Mapping](#16-service--api-endpoint-mapping)
17. [Coding Conventions](#17-coding-conventions)

---

## 1. Project Overview

### 1.1 What Is the HR Portal?

The HR Portal is a web-based employee onboarding and document management system built for **Naleko Digital Solutions**, a South African company specialising in identity verification and trust services. The portal streamlines the end-to-end onboarding journey — from HR staff registering a new hire, through document upload and OCR verification, to full onboarding completion.

The system serves **two distinct user personas**, each with their own dashboard:

| Persona | Entry Point | Purpose |
|---------|-------------|---------|
| **HR Staff** | `/hr/:staffId` | Register new employees, review uploaded documents, manage OCR verifications, track onboarding progress across all employees |
| **Employee** | `/employees/:employeeId` | View own onboarding progress, accept POPIA consent, upload required documents (ID, bank confirmation, certificates), track verification status |

### 1.2 Current State

The entire frontend is built as a **working prototype**. All pages render, navigation works, the complete HR-to-Employee onboarding flow is functional. However:

- **100% of data is mocked in-memory** — there are zero HTTP calls in the entire codebase
- **No authentication** — no login, no Cognito, no route guards
- **No environment files** — no `environment.ts` / `environment.prod.ts`
- **No tests** — all schematics configured with `skipTests: true`, no `.spec.ts` files exist
- **`provideHttpClient()` is not configured** in `app.config.ts`

The backend (AWS — af-south-1 Cape Town) has prototype-level API Gateway endpoints, Lambda functions, DynamoDB tables, and an S3 bucket, but the frontend has not been wired to any of them.

### 1.3 Key Business Context

- **South African operations** — SA ID documents, SA phone numbers (+27), SA banks (FNB, Capitec, Standard Bank)
- **POPIA compliance** — Protection of Personal Information Act; employee consent gate built into employee portal
- **OCR document verification** — National IDs and bank confirmations processed through OCR; matric certificates and tertiary qualifications are manual review
- **External verification partners** — VerifyNow (SA identity verification via Home Affairs) and AVS (Account Verification Services for bank accounts) — currently simulated
- **Onboarding stages** — 6 stages: Invited → Documents → Verification Pending → Verified → Training → Onboarded

---

## 2. Tech Stack

### 2.1 Complete Technology Breakdown

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Framework | Angular | 19.2.0 | SPA framework (standalone components, signals) |
| Language | TypeScript | 5.7.2 | Type-safe JavaScript |
| Styling | SCSS | — | CSS preprocessor, component-scoped |
| UI Library | PrimeNG | 19.1.4 | Component library (tables, dialogs, forms, steppers, etc.) |
| Theme | @primeng/themes (Aura) | 19.1.4 | Pre-built UI theme with dark mode support |
| Layout | PrimeFlex | 3.3.1 | Flexbox/grid CSS utility classes |
| Icons | PrimeIcons | 7.0.0 | Icon set (`pi pi-*`) |
| State Mgmt | Angular Signals + RxJS | 19.x / 7.8.x | `signal()`, `computed()` for state; `Observable` for async data |
| Fonts | Google Fonts (Inter) | 300–900 | Typography |
| Deployment | Vercel | — | Static hosting with SPA rewrites (temporary) |
| Build | Angular CLI | 19.2.22 | Build tooling (`@angular-devkit/build-angular:application`) |

### 2.2 Dependencies (`package.json`)

**Runtime:**
- `@angular/*` — all `^19.2.0` (core, common, compiler, forms, platform-browser, router, animations)
- `primeng` `^19.1.4`, `@primeng/themes` `^19.1.4`
- `primeflex` `^3.3.1`, `primeicons` `^7.0.0`
- `rxjs` `~7.8.0`, `tslib` `^2.3.0`, `zone.js` `~0.15.0`

**Dev:**
- `@angular-devkit/build-angular` `^19.2.22`, `@angular/cli` `^19.2.22`, `@angular/compiler-cli` `^19.2.0`
- `typescript` `~5.7.2`
- `karma` `~6.4.0`, `jasmine-core` `~5.1.0` (auto-generated, unused)

### 2.3 What's NOT in the Stack Yet (Required for Production)

| Missing Piece | Details |
|--------------|---------|
| `provideHttpClient()` | Not in `app.config.ts` — Angular's `HttpClient` cannot be injected anywhere |
| Authentication library | No AWS Amplify Auth, no Cognito SDK, no auth interceptor |
| Environment files | No `src/environments/environment.ts` or `environment.prod.ts` |
| HTTP interceptors | No auth token attachment, no global error handling |
| Route guards | All routes are publicly accessible — no `AuthGuard`, `HrStaffGuard`, or `EmployeeGuard` |
| Global error handler | No `ErrorHandler` implementation, no toast-based error display |
| Tests | `skipTests: true` in all schematics — zero `.spec.ts` files |

---

## 3. Getting Started

```bash
# Clone the repository
git clone https://github.com/obsydian-tech/hr-portal.git
cd hr-portal

# Switch to development branch
git checkout develop

# Install dependencies
npm install

# Start development server
ng serve
# App runs at http://localhost:4200

# Build for production
ng build
# Output: dist/hr-portal/browser

# Run tests (none exist yet)
ng test
```

### Current Deployment (Vercel)

The app is deployed on Vercel via `vercel.json`:

- **Build command:** `npm run build`
- **Output directory:** `dist/hr-portal/browser`
- **SPA routing:** All paths rewrite to `/index.html`
- **Security headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`
- **Static asset caching:** 1 year (`max-age=31536000, immutable`) for JS, CSS, images, fonts

> **Note:** Vercel will be replaced by AWS hosting (CloudFront + S3 in af-south-1) when the backend is built.

---

## 4. Architecture & Conventions

### Standalone Components (No NgModules)

All components use Angular's standalone component pattern — no `NgModule` files exist anywhere in the project:

```typescript
@Component({
  selector: 'app-example',
  standalone: true,
  imports: [CommonModule, ButtonModule, TagModule, ...],
  templateUrl: './example.component.html',
  styleUrl: './example.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExampleComponent { ... }
```

### Angular 19 Signals-First Architecture

The project uses Angular 19's signal primitives exclusively — no legacy `@Input()` / `@Output()` decorators:

| Signal API | Usage |
|-----------|-------|
| `signal()` | Local mutable state (`loading = signal(false)`) |
| `computed()` | Derived state (`totalCount = computed(() => this.items().length)`) |
| `input()` / `input.required()` | Component inputs (replaces `@Input()`) |
| `output()` | Component outputs (replaces `@Output()`) |
| `model()` | Two-way binding (`isOpen = model(false)` for sidebar) |
| `viewChild()` | Template refs (`fileInput = viewChild<ElementRef>('fileInput')`) |

### Modern Control Flow

Angular 19 `@if` / `@for` / `@switch` control flow blocks are used throughout — no `*ngIf`, `*ngFor`, or `*ngSwitch` directives:

```html
@if (loading()) {
  <p-skeleton height="3rem" />
} @else {
  @for (item of items(); track item.id) {
    <app-item [data]="item" />
  }
}

@switch (activeStep()) {
  @case (0) { <div>Step 1</div> }
  @case (1) { <div>Step 2</div> }
}
```

### Lazy Loading

All routes use `loadComponent()` for code-splitting:

```typescript
{
  path: 'hr/:staffId',
  loadComponent: () =>
    import('./features/hr-dashboard/hr-dashboard.component')
      .then(m => m.HrDashboardComponent),
}
```

### Providers Configuration (`app.config.ts`)

```typescript
providers: [
  provideZoneChangeDetection({ eventCoalescing: true }),
  provideRouter(routes, withComponentInputBinding()),
  provideAnimationsAsync(),
  providePrimeNG({
    theme: { preset: Aura, options: { darkModeSelector: '.dark-mode' } },
  }),
]
```

- `withComponentInputBinding()` — route params automatically bind to component `input()` signals
- `providePrimeNG()` — Aura theme with dark mode readiness
- **Critical:** `provideHttpClient()` must be added here before any real HTTP service works

---

## 5. Project Structure

```
src/
├── index.html                                    # Root HTML shell
├── main.ts                                       # Bootstrap entry point
├── styles.scss                                   # Global styles (PrimeNG theme, CSS vars, fonts)
│
├── app/
│   ├── app.component.ts / .html / .scss          # Root: inline <router-outlet/>
│   ├── app.config.ts                             # Providers (Router, Animations, PrimeNG)
│   ├── app.routes.ts                             # All route definitions (lazy-loaded)
│   │
│   ├── core/                                     # ── Singleton Services ──
│   │   └── services/
│   │       ├── hr-api.service.ts                 # Main mock API (506 lines, 7 methods)
│   │       └── document-upload.service.ts        # OCR upload simulation (82 lines)
│   │
│   ├── features/                                 # ── Feature Modules ──
│   │   ├── landing/                              # Marketing landing page
│   │   │   └── landing.component.ts/html/scss
│   │   │
│   │   ├── hr-dashboard/                         # ── HR Staff Portal ──
│   │   │   ├── hr-dashboard.component.*          # Layout shell (sidebar + topbar + router-outlet)
│   │   │   └── components/
│   │   │       ├── hr-dashboard-home/            # Employee table + 4 stat cards
│   │   │       ├── stat-card/                    # Reusable KPI card (label, value, icon, color)
│   │   │       ├── new-employee-registration/    # 4-step wizard (380 lines TS)
│   │   │       ├── employee-detail/              # Employee profile + document review
│   │   │       ├── document-detail-card/         # Per-document card (OCR results, approve/reject)
│   │   │       ├── verifications-list/           # Verification queue table with filters
│   │   │       └── verification-detail/          # Single verification OCR review + decision
│   │   │
│   │   └── employee-dashboard/                   # ── Employee Self-Service Portal ──
│   │       ├── employee-dashboard.component.*    # Layout (consent gate + onboarding flow)
│   │       └── components/
│   │           ├── onboarding-stepper/           # 6-stage progress bar with guidance
│   │           ├── employee-highlights/          # Profile summary card + avatar
│   │           ├── document-checklist/           # 4-document upload manager
│   │           └── document-row/                 # Individual upload row (drag & drop + OCR)
│   │
│   └── shared/                                   # ── Shared Components & Models ──
│       ├── components/
│       │   ├── sidebar/                          # Nav sidebar (mobile overlay, two-way isOpen)
│       │   ├── topbar/                           # Toolbar (hamburger, profile pill, bell, search)
│       │   └── footer/                           # Simple footer
│       └── models/
│           └── employee.model.ts                 # All interfaces & types (179 lines)
│
├── assets/
│   └── images/                                   # (empty — no local images used by components)
│
└── public/
    └── images/
        └── hero-office.png                       # Landing page hero background
```

---

## 6. Design System

### 6.1 Color Palette (Locked)

| Color | Hex | CSS Variable | Usage |
|-------|-----|-------------|-------|
| Dark Navy | `#1a1a2e` | `--naleko-primary` | Primary brand color, headings, dark backgrounds |
| Deep Purple | `#2a1a4e` | — | Gradient midpoint (hero, header icon backgrounds) |
| Portal Blue | `#4a3f8a` | `--naleko-secondary` | Buttons, active stepper steps, interactive elements |
| Teal Accent | `#7ad4e4` | `--naleko-tertiary-fixed-dim` | Accent badges, progress indicators, guidance banners |
| White | `#ffffff` | `--naleko-on-primary` | Text on dark, card backgrounds |

### 6.2 Extended Design Tokens (`styles.scss`)

```scss
:root {
  --naleko-primary:                  #1a1a2e;
  --naleko-secondary:                #4a3f8a;
  --naleko-tertiary:                 #2d8f9e;
  --naleko-surface:                  #f8f9fa;
  --naleko-surface-container:        #edeeef;
  --naleko-surface-container-low:    #f3f4f5;
  --naleko-surface-container-lowest: #ffffff;
  --naleko-surface-container-high:   #e7e8e9;
  --naleko-surface-container-highest:#e1e3e4;
  --naleko-on-surface:               #191c1d;
  --naleko-on-surface-variant:       #47464c;
  --naleko-on-primary:               #ffffff;
  --naleko-secondary-container:      #b7acff;
  --naleko-tertiary-fixed-dim:       #7ad4e4;
  --naleko-outline:                  #78767d;
  --naleko-outline-variant:          #c8c5cd;
  --naleko-error:                    #ba1a1a;
  --naleko-font-family:              'Inter', sans-serif;
}
```

### 6.3 Typography

- **Font:** Inter (Google Fonts) — weights 300, 400, 500, 600, 700, 800, 900
- **Global line-height:** 1.6
- **Antialiasing:** `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale`

### 6.4 Responsive Breakpoints

| Breakpoint | Width | Usage |
|-----------|-------|-------|
| Mobile | `≤ 768px` | Sidebar overlay, hamburger toggle, stacked layouts, hidden labels |
| Tablet | `≤ 1024px` | Adjusted grid columns, condensed stat cards |
| Desktop | `> 1024px` | Full sidebar, multi-column layouts |

### 6.5 Component Patterns

- **Stepper circles:** Custom HTML/SCSS (no `p-steps`). Active = filled `#4a3f8a`, Completed = green-bordered with checkmark (`#27ae60`), Upcoming = grey-bordered (`#d1d5db`). Connecting lines: blue for completed, grey for upcoming.
- **Stat cards:** Colored left accent icon, label + value, powered by `StatCardComponent`
- **Document cards:** Left border color-coded by OCR status, expandable with action buttons
- **Form fields:** `UPPERCASE` labels, `0.8rem` font size, PrimeNG input components

---

## 7. Routing Map

All routes are defined in `src/app/app.routes.ts` using lazy-loaded standalone components.

| Path | Component | Auth Required? | Description |
|------|-----------|---------------|-------------|
| `/` | `LandingComponent` | No | Marketing landing page with hero + CTAs |
| `/hr/:staffId` | `HrDashboardComponent` | **Should be (HR Staff)** | Layout shell with sidebar + topbar |
| `/hr/:staffId/` (default child) | `HrDashboardHomeComponent` | **Should be (HR Staff)** | Employee table + 4 KPI stat cards |
| `/hr/:staffId/new-employee` | `NewEmployeeRegistrationComponent` | **Should be (HR Staff)** | 4-step registration wizard |
| `/hr/:staffId/employees/:employeeId` | `EmployeeDetailComponent` | **Should be (HR Staff)** | Employee document review |
| `/hr/:staffId/verifications` | `VerificationsListComponent` | **Should be (HR Staff)** | All verifications table with filters |
| `/hr/:staffId/verifications/:verificationId` | `VerificationDetailComponent` | **Should be (HR Staff)** | Single verification OCR review + decision |
| `/employees/:employeeId` | `EmployeeDashboardComponent` | **Should be (Employee)** | Employee self-service onboarding portal |
| `**` | Redirect → `/` | — | Wildcard catch-all |

> **⚠️ No route guards exist.** All "Should be" routes are currently accessible by anyone. Three guards need to be implemented: `AuthGuard` (any authenticated user), `HrStaffGuard` (hr_staff Cognito group), `EmployeeGuard` (employee group + matching employeeId).

---

## 8. Models & Interfaces

All types are defined in `src/app/shared/models/employee.model.ts` (179 lines).

### 8.1 Type Unions (String Enums)

```typescript
type OnboardingStage =
  | 'INVITED' | 'DOCUMENTS' | 'VERIFICATION_PENDING'
  | 'VERIFIED' | 'TRAINING' | 'ONBOARDED';

type DocumentType =
  | 'NATIONAL_ID' | 'BANK_CONFIRMATION'
  | 'MATRIC_CERTIFICATE' | 'TERTIARY_QUALIFICATION';

type DocumentStatus =
  | 'PENDING' | 'UPLOADING' | 'PROCESSING'
  | 'ACCEPTED' | 'REJECTED' | 'SUBMITTED';

type OcrStatus =
  | 'PENDING' | 'PROCESSING' | 'MANUAL_REVIEW'
  | 'PASSED' | 'FAILED';

type VerificationDecision =
  | 'MANUAL_REVIEW' | 'PASSED' | 'FAILED';
```

### 8.2 Core Interfaces

#### Employee

```typescript
interface Employee {
  employee_id: string;       // e.g., "EMP-0000011"
  first_name: string;
  middle_name?: string;
  last_name: string;
  email: string;
  phone: string;             // SA format: "+2783..."
  department: string;        // Engineering, Finance, Marketing, HR, Legal, Operations
  job_title?: string;
  stage: OnboardingStage;
  offer_accept_date: string; // ISO date
  planned_start_date: string;// ISO date
  created_at: string;        // ISO datetime
  created_by: string;        // Staff ID (e.g., "AS00001")
}
```

#### EmployeeDocument

```typescript
interface EmployeeDocument {
  document_id: string;
  document_type: DocumentType;
  file_name: string;
  ocr_status: OcrStatus;
  ocr_completed_at?: string;
  uploaded_at?: string;
  uploaded_by?: string;
  verification_reasoning?: string;
  ocr_result?: EmployeeDocumentOcrResult;
  verification: VerificationDetail | null;
  can_reupload: boolean;
}
```

#### EmployeeDocumentOcrResult

```typescript
interface EmployeeDocumentOcrResult {
  id_number?: string;        // National ID fields
  full_name?: string;
  date_of_birth?: string;
  gender?: string;
  citizenship?: string;
  bank_name?: string;        // Bank confirmation fields
  account_number?: string;
  account_holder?: string;
  branch_code?: string;
}
```

#### Verification & VerificationDetail

```typescript
interface Verification {
  verification_id: string;
  employee_id?: string;
  employee_name: string;
  document_type?: DocumentType;
  document_id?: string;
  confidence: number;        // 0–100
  decision: VerificationDecision;
  created_at: string;
}

interface VerificationDetail extends Verification {
  reasoning: string;         // Human-readable OCR analysis
  id_number: string;
  name: string;
  surname: string;
  date_of_birth: string;
  gender: string;
  citizenship: string;
  document_file_url?: string;
}
```

#### API Request/Response Types

```typescript
interface CreateEmployeeRequest {
  first_name: string;
  middle_name?: string;
  last_name: string;
  email: string;
  phone: string;
  department: string;
  job_title?: string;
  offer_accept_date: string;
  planned_start_date: string;
}

interface EmployeeListResponse {
  items: Employee[];
  count: number;
  staff_id: string;
  filters_applied: { created_by: string; stage: string; department: string };
}

interface EmployeeDocumentResponse {
  employee: Pick<Employee, 'employee_id' | 'first_name' | 'last_name' | 'email' | 'department' | 'stage'>;
  documents: EmployeeDocument[];
  summary: { total: number; verified: number; pending: number; issues: number };
}

interface VerificationListResponse {
  items: Verification[];
}
```

#### Document Upload Types

```typescript
interface DocumentRow {
  type: DocumentType;
  label: string;
  description: string;
  icon: string;
  status: DocumentStatus;
  ocrMessage?: string;
  fileName?: string;
  file?: File;
  requiresOcr: boolean;
}

interface OcrResult {
  success: boolean;
  documentTypeDetected: string;
  message: string;
  extractedSummary?: string;
}

interface WizardDocumentSlot {
  type: DocumentType;
  label: string;
  description: string;
  icon: string;
  file: File | null;
  fileName: string;
  uploading: boolean;
  uploaded: boolean;
  ocrResult: OcrResult | null;
}
```

---

## 9. Services & Data Layer

> **Critical Note:** Every service operates on mock data. There are **zero HTTP calls** in the entire codebase. All services use `of(...).pipe(delay(...))` to return Observables that simulate network latency.

### 9.1 HrApiService — `src/app/core/services/hr-api.service.ts`

**506 lines** | `@Injectable({ providedIn: 'root' })` | No dependencies (no `HttpClient`)

| Method | Signature | Delay | Mock Behavior |
|--------|----------|-------|--------------|
| `getEmployees` | `(staffId: string) → Observable<EmployeeListResponse>` | 600ms | Returns all 8 mock employees filtered by `created_by: staffId` |
| `getVerifications` | `(_staffId: string) → Observable<VerificationListResponse>` | 800ms | Returns all 6 mock verifications |
| `getVerificationById` | `(verificationId: string) → Observable<VerificationDetail \| null>` | 300–600ms | Finds by ID, builds detail object with OCR fields, reasoning string |
| `getEmployeeDocuments` | `(employeeId: string) → Observable<EmployeeDocumentResponse>` | 700ms | Calls `buildMockDocuments()` — returns employee-specific document set |
| `createEmployee` | `(staffId: string, data: CreateEmployeeRequest) → Observable<Employee>` | 1000ms | **Mutates** `mockEmployees` array (`.unshift()`), auto-increments `nextId` starting at 19 |
| `searchEmployeeByEmail` | `(email: string) → Observable<boolean>` | 500ms | Case-insensitive `.some()` check against mock employees |
| `triggerExternalVerification` | `(documentId: string, documentType: DocumentType) → Observable<{success, message}>` | 2000ms | Only for NATIONAL_ID/BANK_CONFIRMATION; returns success message mentioning "VerifyNow" or "AVS" |

**Key Detail:** `createEmployee()` uses a hardcoded `created_by: 'AS00001'` and persists new employees in-memory for the session duration. The employee counter starts at `EMP-0000019` and increments.

### 9.2 DocumentUploadService — `src/app/core/services/document-upload.service.ts`

**82 lines** | `@Injectable({ providedIn: 'root' })` | No dependencies

| Method | Signature | Delay | Mock Behavior |
|--------|----------|-------|--------------|
| `upload` | `(file: File, documentType: DocumentType) → Observable<OcrResult>` | 1500–3000ms | Non-OCR docs (MATRIC, TERTIARY): 1500ms, always succeeds. OCR docs (NATIONAL_ID, BANK_CONFIRMATION): 3000ms, outcome based on filename |

**Filename-based OCR simulation:**
- File name contains `"wrong"` → returns error: wrong document type detected
- File name contains `"blur"` or `"bad"` → returns error: unreadable/blurry
- Otherwise → returns success with extracted summary:
  - NATIONAL_ID: `"National ID detected"`, summary: `"ID Number: ****1234"`
  - BANK_CONFIRMATION: `"Bank confirmation detected"`, summary: `"Account: ****5678 — FNB"`

### 9.3 Service Refactoring Pattern

When migrating from mock to real API, follow this transformation. **Component code does not change** — only service internals:

**Before (Mock — current state):**
```typescript
getEmployees(staffId: string): Observable<EmployeeListResponse> {
  const filtered = this.mockEmployees.filter(e => e.created_by === staffId);
  return of({ items: filtered, count: filtered.length, ... }).pipe(delay(600));
}
```

**After (Real API):**
```typescript
constructor(private http: HttpClient) {}

getEmployees(staffId: string): Observable<EmployeeListResponse> {
  return this.http.get<EmployeeListResponse>(
    `${environment.apiUrl}/employees?staffId=${staffId}`
  );
}
```

---

## 10. Mock Data Inventory

A complete inventory of **every hardcoded/mocked value** in the codebase that must be replaced with real data.

### 10.1 Mock Employees (8 records)

All `created_by: 'AS00001'` | Defined in `hr-api.service.ts`

| ID | Name | Department | Stage | Email | Phone | Offer Date | Start Date |
|----|------|-----------|-------|-------|-------|-----------|-----------|
| `EMP-0000011` | Sarah Nkosi | Engineering | `VERIFICATION_PENDING` | sarah.nkosi@example.com | +27831234567 | 2026-03-10 | 2026-04-01 |
| `EMP-0000012` | Thabo James Mokoena | Finance | `DOCUMENTS` | thabo.mokoena@example.com | +27829876543 | 2026-03-12 | 2026-04-15 |
| `EMP-0000013` | Lerato Dlamini | Marketing | `VERIFIED` | lerato.dlamini@example.com | +27845551234 | 2026-02-28 | 2026-03-25 |
| `EMP-0000014` | Sipho Mthembu | HR | `TRAINING` | sipho.mthembu@example.com | +27836667890 | 2026-02-20 | 2026-03-20 |
| `EMP-0000015` | John David Smith | Finance | `DOCUMENTS` | john.smith@example.com | +27821112233 | 2026-03-15 | 2026-04-15 |
| `EMP-0000016` | Nomsa Khumalo | Legal | `ONBOARDED` | nomsa.khumalo@example.com | +27849998877 | 2026-01-15 | 2026-02-15 |
| `EMP-0000017` | Andile Zulu | Operations | `INVITED` | andile.zulu@example.com | +27837776655 | 2026-03-20 | 2026-04-20 |
| `EMP-0000018` | Palesa Mahlangu | Engineering | `VERIFICATION_PENDING` | palesa.mahlangu@example.com | +27825554433 | 2026-03-08 | 2026-04-08 |

### 10.2 Mock Verifications (6 records)

| ID | Employee | Document Type | Document ID | Decision | Confidence |
|----|----------|--------------|------------|----------|-----------|
| `ver_1774013221576` | Unknown | — | — | `MANUAL_REVIEW` | 0 |
| `ver_1774085249990` | Unknown | — | — | `MANUAL_REVIEW` | 0 |
| `ver_1774091968566` | Sarah Nkosi (EMP-0000011) | `NATIONAL_ID` | `doc_1774091957246` | `MANUAL_REVIEW` | 0 |
| `ver_1774085454231` | Unknown | — | — | `MANUAL_REVIEW` | 0 |
| `ver_1774088048209` | Sarah Nkosi (EMP-0000011) | `NATIONAL_ID` | `doc_1774088035608` | `MANUAL_REVIEW` | 0 |
| `ver_1774086532748` | Unknown | — | — | `MANUAL_REVIEW` | 0 |

### 10.3 Mock Document Fixtures (per employee)

**Sarah Nkosi (EMP-0000011):** 4 documents
| Document | OCR Status | File Name | Details |
|----------|-----------|-----------|---------|
| National ID | `MANUAL_REVIEW` | body_corporate_levy.pdf | Misidentified — body corporate levy statement, not SA ID |
| Bank Confirmation | `PASSED` | fnb_confirmation.pdf | FNB, account `****5678`, confidence 92 |
| Matric Certificate | `PENDING` | — | Not yet uploaded |
| Tertiary Qualification | `PENDING` | — | Not yet uploaded |

**Lerato Dlamini (EMP-0000013):** 3 documents
| Document | OCR Status | File Name | Details |
|----------|-----------|-----------|---------|
| National ID | `PASSED` | sa_id_lerato.pdf | Confidence 97, with `uploaded_by: "Lerato Dlamini"` |
| Bank Confirmation | `PASSED` | capitec_letter.pdf | Capitec Bank, confidence 95, with `uploaded_by: "Lerato Dlamini"` |
| Matric Certificate | `PASSED` | matric_cert.pdf | With `uploaded_by: "Lerato Dlamini"` |

**Default (any other employee):** 4 documents, all `PENDING` status with generated filenames.

### 10.4 Hardcoded Values

| What | Location | Value |
|------|----------|-------|
| HR Staff ID | `new-employee-registration.component.ts` | `'AS00001'` (used in `createEmployee()` call) |
| Employee ID counter | `hr-api.service.ts` | Starts at 19 → generates `EMP-0000019`, `EMP-0000020`, etc. |
| Employee Dashboard employee | `employee-dashboard.component.ts` | Hardcoded Sarah Nkosi (EMP-0000011) in component |
| Employee Dashboard stage | `employee-dashboard.component.ts` | Hardcoded `'DOCUMENTS'` |
| Employee Dashboard HR partner | `employee-highlights.component.ts` | Default `'Sandra Nkosi'` (overridden to `'Thabo Molefe'` in dashboard template) |
| Landing page CTAs | `landing.component.html` | Links to `/hr/STAFF-001` and `/employees/EMP-001` |
| Topbar name/role | `hr-dashboard.component.html` | `employeeName="Thabo Molefe"`, `employeeRole="HR Manager"` |
| Department list | `new-employee-registration.component.ts` | Engineering, Finance, Marketing, HR, Legal, Operations |
| External verification partners | `hr-api.service.ts` | "VerifyNow" (identity), "AVS" (bank accounts) |
| Verification reasoning strings | `hr-api.service.ts` | ~5 hardcoded reasoning paragraphs for different verification scenarios |
| OCR extracted data | `hr-api.service.ts` | Mock ID numbers, names, bank details for Sarah Nkosi / Lerato Dlamini |
| Simulated API delays | Multiple services | 300ms, 500ms, 600ms, 700ms, 800ms, 1000ms, 1500ms, 2000ms, 3000ms |

---

## 11. Feature Inventory — HR Portal

### 11.1 Landing Page — `features/landing/`

**Status:** Fully built (UI complete, no backend dependency)

- Hero section with gradient background (`#1a1a2e` → `#4a3f8a`) and `hero-office.png`
- Headline: "NALEKO DIGITAL SOLUTIONS" with tagline "Verifying people, building trust."
- Two CTA buttons: "HR Staff Login" → `/hr/STAFF-001` and "Employee Portal" → `/employees/EMP-001`
- Three features grid: Onboarding, Verification, Compliance
- How it works section: 4-step process
- Company overview section
- Footer with current year
- **422-line SCSS** with responsive breakpoints

### 11.2 HR Dashboard Home — `hr-dashboard/components/hr-dashboard-home/`

**Status:** Fully built (UI complete, data mocked)

- **4 stat cards** (via `StatCardComponent`): Total Employees, Pending Documents, Verification Pending, Onboarded
- **Employee search** — email filter input (client-side filter on `filteredEmployees` computed signal)
- **Employee table** — PrimeNG Table showing: Name, Email, Department, Stage (color-coded tag), Action button
- Row click navigates to `/hr/:staffId/employees/:employeeId`
- Loading state with PrimeNG skeleton
- **Services:** `HrApiService.getEmployees()`
- **PrimeNG:** `TableModule`, `TagModule`, `ButtonModule`, `CardModule`, `SkeletonModule`, `InputTextModule`

### 11.3 New Employee Registration — `hr-dashboard/components/new-employee-registration/`

**Status:** Fully built (4-step wizard, data mocked)

**380+lines of TypeScript** implementing a complete registration wizard:

**Step 1 — Personal Information:**
- First name, middle name (optional), last name, email, phone
- Real-time email uniqueness check via `hrApi.searchEmployeeByEmail()`
- Validation: all required fields + email must not exist

**Step 2 — Employment Details:**
- Department dropdown (6 options), job title, offer accept date, planned start date
- Validation: department + both dates required

**Step 3 — Documents:**
- 4 upload slots: SA ID, Bank Confirmation, Matric Certificate, Tertiary Qualification
- File select → OCR simulation via `DocumentUploadService`
- Upload progress, success/failure states per document
- Documents are optional at this step

**Step 4 — Confirmation:**
- Review grid with all entered data + uploaded document summary
- Edit buttons per section (jump back to step)
- Submit creates employee via `hrApi.createEmployee()`
- Success state with: View Employee, Register Another, Back to Dashboard

**Custom stepper:** Blue circles (#4a3f8a) with icons, green checkmarks for completed steps, grey for upcoming. Not using PrimeNG `p-steps`.

### 11.4 Employee Detail — `hr-dashboard/components/employee-detail/`

**Status:** Fully built (UI complete, data mocked)

- Employee profile header: name, email, department, stage tag
- Completion progress bar (verified / total documents × 100)
- Document list rendered via `DocumentDetailCardComponent`
- Back navigation to HR dashboard
- **Services:** `HrApiService.getEmployeeDocuments()`

### 11.5 Document Detail Card — `hr-dashboard/components/document-detail-card/`

**Status:** Fully built (UI complete, actions mocked)

- Color-coded left border by OCR status (green = passed, amber = manual review, red = failed, grey = pending)
- Document metadata: type label, file name, uploaded by, uploaded at, OCR status tag
- **OCR results section:** Extracted fields displayed when available (ID number, name, DOB, bank details, etc.)
- **Verification reasoning:** Human-readable analysis paragraph
- **Action buttons:**
  - Approve Document (with confirmation dialog)
  - Reject Document (with confirmation dialog)
  - Request External Verification (triggers `hrApi.triggerExternalVerification()`, 2s delay, VerifyNow/AVS)
- External verification only available for NATIONAL_ID and BANK_CONFIRMATION
- **PrimeNG:** `CardModule`, `TagModule`, `ButtonModule`, `DividerModule`, `ConfirmDialogModule`, `MessageModule`, `TooltipModule`

### 11.6 Verifications List — `hr-dashboard/components/verifications-list/`

**Status:** Fully built (UI complete, data mocked)

- Filterable table of all verification requests
- Decision filter dropdown: All, Manual Review, Passed, Failed
- Summary stats: Total, Manual Review count, Passed count, Failed count
- PrimeNG Table with: Employee Name, Document Type, Decision (tag), Confidence, Created At, Action
- Row action navigates to verification detail
- **Services:** `HrApiService.getVerifications()`

### 11.7 Verification Detail — `hr-dashboard/components/verification-detail/`

**Status:** Fully built (UI complete, actions mocked)

- Full verification data: employee name, document type, decision tag, confidence score
- **Extracted OCR fields** in a structured grid: ID Number, Name, Surname, Date of Birth, Gender, Citizenship
- **Reasoning panel:** Full text explanation of OCR findings (color-coded: green/amber/red background based on decision)
- **Action buttons:** Approve Manual Review, Reject Manual Review, Trigger External Verification — all with `ConfirmationService.confirm()` dialogs
- Back navigation to verifications list
- **Services:** `HrApiService.getVerificationById()`

---

## 12. Feature Inventory — Employee Portal

### 12.1 Employee Dashboard — `features/employee-dashboard/`

**Status:** Fully built (UI complete, data hardcoded in component)

- **Welcome tile** — gradient banner: "Welcome, Sarah!" with start date and encouraging message
- **POPIA consent gate** — checkbox with declaration text; document checklist is hidden until consent is accepted
- **Consent flow:** Checkbox → Accept button → `consentAccepted` signal → reveals document section
- **Layout:** Sidebar (with nav to `/employees/EMP-0000011`), Topbar (employee name + role from signals), main content area
- **Child components:** OnboardingStepperComponent, EmployeeHighlightsComponent, DocumentChecklistComponent
- **Services:** None — employee data is hardcoded: `signal<Employee>({...Sarah Nkosi...})`
- **PrimeNG:** `CardModule`, `ButtonModule`, `CheckboxModule`, `FormsModule`

### 12.2 Onboarding Stepper — `employee-dashboard/components/onboarding-stepper/`

**Status:** Fully built (custom stepper, no PrimeNG p-steps)

- **6 stages:** Profile Created → Documents → Verification → Verified → Training → Onboarded
- **Custom numbered circles:** Active = blue filled (#4a3f8a), Completed = green border + check, Upcoming = grey border + number
- **Connecting lines:** Blue for completed segments, grey for upcoming
- **Progress tag:** "X% Complete" rounded badge
- **Stage heading:** "Stage N of 6: Label"
- **Guidance banner:** Contextual message per stage with icon, title, description, and action text (full `stageGuidanceMap` record)
- **Step-by-step guide section:** Vertical list of all 6 stages with completion badges (Done/Current/Upcoming)
- **Input:** `currentStage` signal from parent
- **PrimeNG:** `CardModule`, `TagModule`

### 12.3 Employee Highlights — `employee-dashboard/components/employee-highlights/`

**Status:** Fully built (UI complete)

- Avatar with initials (first + last name initials)
- Employee details: Email, Department, Start Date
- Stage tag with color coding
- HR Partner name (configurable input, defaults to "Sandra Nkosi")
- **PrimeNG:** `CardModule`, `AvatarModule`, `TagModule`, `DividerModule`

### 12.4 Document Checklist — `employee-dashboard/components/document-checklist/`

**Status:** Fully built (UI complete, upload mocked)

- Manages 4 required documents: National ID, Bank Confirmation, Matric Certificate, Tertiary Qualification
- Progress tracking: "X of 4 documents complete"
- Overall status message (with color coding)
- Renders individual `DocumentRowComponent` for each document
- **Output:** `allComplete` — emits `true` when all documents are ACCEPTED or SUBMITTED
- **PrimeNG:** `CardModule`, `TagModule`, `DividerModule`, `MessageModule`

### 12.5 Document Row — `employee-dashboard/components/document-row/`

**Status:** Fully built (upload mocked via DocumentUploadService)

- **File validation:** PDF, JPG, PNG only — 10MB maximum
- **Upload methods:** Click-to-select (hidden file input) OR drag-and-drop
- **Upload flow:** File selected → status UPLOADING → `DocumentUploadService.upload()` → status PROCESSING (for OCR docs) → ACCEPTED/REJECTED or SUBMITTED
- **OCR result display:** Shows success/failure message inline
- **Re-upload:** Available when document is rejected — resets state for another attempt
- **Output:** `statusChanged` — emits `{ type, status, message }` back to checklist
- **Services:** `DocumentUploadService`
- **PrimeNG:** `ButtonModule`, `TagModule`, `ProgressSpinnerModule`

---

## 13. Shared Components

### 13.1 Sidebar — `shared/components/sidebar/`

| Feature | Implementation |
|---------|---------------|
| Navigation items | `navItems` input with `NavItem[]` interface (label, icon, route, disabled) |
| Active route | `activeRoute` input for highlighting current nav item |
| Action button | `actionLabel` + `actionIcon` inputs → `actionClicked` output |
| Mobile overlay | `isOpen = model(false)` two-way binding, backdrop, slide-in animation |
| Close on nav | Auto-closes sidebar on mobile when a nav item is clicked |
| **PrimeNG** | `AvatarModule`, `DividerModule`, `TooltipModule`, `ButtonModule` |

`NavItem` interface exported from sidebar component:
```typescript
interface NavItem {
  label: string;
  icon: string;
  route: string;
  disabled?: boolean;
}
```

### 13.2 Topbar — `shared/components/topbar/`

| Feature | Implementation |
|---------|---------------|
| Portal title | `title` input (defaults to `'HR Portal'`) |
| Profile pill | `employeeName` + `employeeRole` inputs → displays initials avatar + name + role |
| Hamburger button | Visible on mobile (`≤ 768px`), emits `menuToggle` output |
| Search input | `showSearch` input (hidden on mobile) |
| Notification bell | `showNotifications` input, green dot indicator |
| **PrimeNG** | `ToolbarModule`, `AvatarModule`, `ButtonModule`, `BadgeModule`, `InputTextModule` |

### 13.3 Footer — `shared/components/footer/`

- Simple footer with Naleko branding
- Uses `DividerModule`
- Stateless, template-only

---

## 14. Client Feedback — Action Items

> *HR Portal — HR/Employee Feedback, 30 March 2026, Naleko Team*

### 14.1 HR Staff Feedback

| # | Feedback | Current State | Action Required |
|---|----------|--------------|-----------------|
| HR-1 | Add a filter on the employee dashboard | Only email search exists (`searchEmail` signal in `HrDashboardHomeComponent`) | Add filters for: **Department** dropdown, **Onboarding Stage** dropdown, **Date range** picker. Use PrimeNG `Select` + `DatePicker` components above the table. Wire into `filteredEmployees` computed signal |
| HR-2 | Specify that documents are outstanding or missing | Employee table shows stage tag but no document status | Add a **"Docs"** column to the employee table showing `X/4` document count with color coding (red if missing, amber if pending, green if complete). Requires `getEmployeeDocuments()` data or a summary field on the Employee model |

### 14.2 Employee Feedback — Upload Documents Section

| # | Feedback | Current State | Action Required |
|---|----------|--------------|-----------------|
| EMP-1 | Primary "Upload Documents" action button | Document checklist exists but no prominent CTA | Add a large primary **"Upload Documents"** button above the document checklist, styled with `#4a3f8a` background, `pi-upload` icon. Scrolls to or reveals the document section |
| EMP-2 | Checklist of required documents | Checklist exists but could be clearer | Enhance the document checklist header with clear requirement text: "You need to upload these 4 documents:" with bullet points for each doc type |
| EMP-3 | Friendlier, more encouraging wording | Current wording is functional but formal | Update guidance text to be warmer: "You're doing great!", "Almost there!", "Just a few more steps..." etc. |
| EMP-4 | Additional helper text (estimated time) | No time estimates | Add helper badge: **"Takes less than 5 minutes"** near the upload section header, with `pi-clock` icon |

### 14.3 Employee Feedback — Employee Details Card

| # | Feedback | Current State | Action Required |
|---|----------|--------------|-----------------|
| EMP-5 | 2-column grid layout for employee info | `EmployeeHighlightsComponent` uses a single-column layout | Reorganize into a **2-column grid** using PrimeFlex `col-12 md:col-6` for each field pair |
| EMP-6 | **Contact HR button** | Does not exist | **New feature — see detailed spec below** |

### 14.4 Contact HR Feature — Detailed Specification

**Flow:**
1. Employee clicks **"Contact HR"** button on their dashboard
2. A **modal dialog** (PrimeNG `Dialog`) appears with a form:
   - **Subject** — dropdown: General Inquiry, Document Issue, Onboarding Question, Other
   - **Description** — textarea (required, min 20 characters)
   - **Priority** — Low / Medium / High (default: Medium)
   - **Attachment** — optional file upload (PrimeNG FileUpload)
3. Employee clicks **Submit**
4. A **Case record** is created (POST /cases API)
5. The Case is automatically assigned to the **HR Queue** (or specific HR user based on department)
6. Employee sees a **confirmation message** with Case reference number

**Frontend implementation required:**
- New `ContactHrDialogComponent` in `employee-dashboard/components/`
- New `Case` interface in `employee.model.ts`:
  ```typescript
  interface Case {
    case_id: string;
    employee_id: string;
    subject: string;
    category: 'general' | 'document_issue' | 'onboarding' | 'other';
    description: string;
    priority: 'low' | 'medium' | 'high';
    status: 'open' | 'in_progress' | 'resolved' | 'closed';
    assigned_to?: string;
    created_at: string;
    updated_at?: string;
  }
  ```
- New `createCase()` method in `HrApiService` (mock initially, then real API)
- PrimeNG components: `DialogModule`, `SelectModule`, `TextareaModule`, `FileUploadModule`, `MessageModule`

**Backend requirement:** Cases DynamoDB table + API endpoint (documented in HR-PORTAL-AWS-BACKEND.md)

---

## 15. Production Readiness Checklist

### P0 — Blocking (Must Be Done Before Any Backend Integration)

| # | Task | Details | Files Affected |
|---|------|---------|---------------|
| 1 | **Add `provideHttpClient()`** | Add to `app.config.ts` providers array. Without this, Angular's `HttpClient` cannot be injected in any service | `app.config.ts` |
| 2 | **Create environment files** | `src/environments/environment.ts` (dev) and `environment.prod.ts` with: API Gateway URL, Cognito User Pool ID, Cognito App Client ID, region (`af-south-1`), S3 bucket names | New files + `angular.json` fileReplacements |
| 3 | **Implement AWS Cognito authentication** | Install `@aws-amplify/auth` or use `amazon-cognito-identity-js` directly. Build login/signup flow — either Cognito Hosted UI redirect or in-app form. Replace hardcoded topbar name/role with Cognito JWT claims | `app.config.ts`, new `auth.service.ts`, login component |
| 4 | **Add route guards** | `AuthGuard` (any authenticated user), `HrStaffGuard` (hr_staff Cognito group), `EmployeeGuard` (employee group + own employeeId only). Apply to all routes in `app.routes.ts` | New guard files, `app.routes.ts` |
| 5 | **Refactor all services to use `HttpClient`** | Replace `of().pipe(delay())` pattern with `this.http.get/post/put/patch/delete()` calls in `HrApiService` and `DocumentUploadService`. Remove all mock data arrays. PdfInvoiceService equivalent not applicable | `hr-api.service.ts`, `document-upload.service.ts` |
| 6 | **Add HTTP interceptors** | Auth interceptor: attach Cognito JWT `accessToken` to `Authorization: Bearer` header. Error interceptor: handle 401 (redirect to login), 403 (show forbidden), 500 (show toast) | New interceptor files, `app.config.ts` |

### P1 — Required (Core Functionality for Production Launch)

| # | Task | Details |
|---|------|---------|
| 7 | **Real document upload to S3** | Replace `DocumentUploadService` mock with presigned URL flow: GET presigned URL from Lambda → PUT file directly to S3 → S3 event triggers Textract Lambda for OCR |
| 8 | **Real OCR processing** | Amazon Textract integration via Lambda. Replace simulated OCR results with real extracted fields from Textract `AnalyzeDocument`/`AnalyzeID` |
| 9 | **External verification integration** | Wire `triggerExternalVerification()` to real VerifyNow (identity) and AVS (bank) API endpoints via Lambda |
| 10 | **Contact HR feature** | New component + API (see Section 14.4 spec). Case management with DynamoDB backend |
| 11 | **HR dashboard filters** | Add Department + Stage filter dropdowns to employee table (see HR-1 feedback) |
| 12 | **Document status column** | Add document completion count to employee table (see HR-2 feedback) |
| 13 | **Employee portal UX polish** | Upload Documents CTA button, helper text, time estimate badge, friendlier wording (see EMP-1 through EMP-4 feedback) |
| 14 | **Employee details 2-column layout** | Reorganize EmployeeHighlightsComponent grid (see EMP-5 feedback) |
| 15 | **Error handling UX** | Toast notifications for API failures (`MessageService`), loading spinners during async operations, retry/offline messaging, form validation errors |
| 16 | **Employee data from API** | Replace hardcoded Sarah Nkosi in `employee-dashboard.component.ts` with real API call using `employeeId` from route params |

### P2 — Pre-Launch Polish

| # | Task | Details |
|---|------|---------|
| 17 | **POPIA consent backend** | Record employee consent timestamp + IP in DynamoDB via API (currently only tracked in-memory via `consentAccepted` signal) |
| 18 | **Notification system** | Real notifications for: document uploaded, verification complete, stage change. Replace green dot placeholder on topbar bell icon |
| 19 | **Search functionality** | Wire topbar search input to real search endpoint (currently non-functional input) |
| 20 | **Unit + integration tests** | Currently zero test files. Add tests for: services, route guards, form validation, wizard flow, document upload flow |
| 21 | **Accessibility audit** | Keyboard navigation, ARIA labels, color contrast ratios, screen reader support |
| 22 | **CI/CD pipeline** | Replace Vercel with AWS hosting (S3 + CloudFront). Set up GitHub Actions: `develop → staging → main` branch deployments |
| 23 | **Sidebar disabled items** | Enable "Employees", "Documents", and "Settings" nav items in sidebar (currently `disabled: true`) |
| 24 | **Landing page auth** | Replace hardcoded CTA links (`/hr/STAFF-001`, `/employees/EMP-001`) with real login flow that routes based on Cognito group |

---

## 16. Service → API Endpoint Mapping

Quick reference for the frontend team — exactly what changes when each backend piece is ready.

### 16.1 HrApiService Methods → REST Endpoints

| Frontend Method | HTTP Call | Lambda | DynamoDB Table |
|----------------|-----------|--------|---------------|
| `getEmployees(staffId)` | `GET /employees?staffId={staffId}` | `employeesFunction` | Employee |
| `getEmployeeDocuments(employeeId)` | `GET /employees/{employeeId}/documents` | `documentsFunction` | Document + Employee |
| `createEmployee(staffId, data)` | `POST /employees` | `employeesFunction` | Employee |
| `searchEmployeeByEmail(email)` | `GET /employees/search?email={email}` | `employeesFunction` | Employee |
| `getVerifications(staffId)` | `GET /verifications` | `verificationsFunction` | Verification |
| `getVerificationById(id)` | `GET /verifications/{id}` | `verificationsFunction` | Verification + Document |
| `triggerExternalVerification(docId, type)` | `POST /verifications/external` | `externalVerificationFunction` | Verification + Document |

### 16.2 DocumentUploadService Methods → REST Endpoints

| Frontend Method | HTTP Call | Lambda | Storage |
|----------------|-----------|--------|---------|
| `upload(file, documentType)` | Step 1: `POST /documents/upload-url` → presigned URL | `documentsFunction` | S3 |
| | Step 2: `PUT {presignedUrl}` (direct S3 upload) | — | S3 |
| | Step 3: S3 event → OCR Lambda (automatic) | `ocrProcessorFunction` | S3 + Document table |
| | Step 4: Poll `GET /documents/{docId}/status` for OCR result | `documentsFunction` | Document |

### 16.3 New Endpoints (Not Yet in Frontend)

| Endpoint | Purpose | Frontend Location |
|----------|---------|-------------------|
| `POST /auth/login` | Cognito authentication | New LoginComponent |
| `GET /employees/{id}/profile` | Employee own profile | `employee-dashboard.component.ts` (replace hardcoded data) |
| `POST /cases` | Create Contact HR case | New ContactHrDialogComponent |
| `GET /cases?employeeId={id}` | Get employee's cases | New CaseHistoryComponent (optional) |
| `GET /dashboard/stats?staffId={id}` | HR dashboard KPIs | `hr-dashboard-home.component.ts` (currently computed from mock array) |
| `PATCH /documents/{id}/decision` | Approve/reject document | `document-detail-card.component.ts` (currently local state only) |
| `PATCH /verifications/{id}/decision` | Approve/reject verification | `verification-detail.component.ts` (currently local state only) |

### 16.4 Existing Prototype API Endpoints

These endpoints already exist at prototype level in AWS (API Gateway + Lambda):

| Method | Endpoint | Status |
|--------|---------|--------|
| `POST` | `uploadDocument` | Prototype — needs formalization |
| `GET` | `getAllDocumentVerifications` | Prototype — maps to `getVerifications()` |
| `GET` | `getDocumentVerificationDetails` | Prototype — maps to `getVerificationById()` |
| `GET` | `getDocumentVerificationForEmployee` | Prototype — maps to `getEmployeeDocuments()` |
| `POST` | `createEmployee` | Prototype — maps to `createEmployee()` |
| `GET` | `getEmployees` | Prototype — maps to `getEmployees()` |

---

## 17. Coding Conventions

### Patterns Used Throughout the Codebase

| Pattern | Details |
|---------|---------|
| **Standalone components** | All components are standalone. No `NgModule` files exist anywhere |
| **Angular 19 signals** | `signal()`, `computed()`, `input()`, `output()`, `model()` — no legacy decorators |
| **Modern control flow** | `@if`, `@for`, `@switch` — no structural directives (`*ngIf`, `*ngFor`) |
| **OnPush change detection** | Every component uses `ChangeDetectionStrategy.OnPush` |
| **PrimeNG for all UI** | Tables, Cards, Tags, Buttons, Dialogs, Selects, DatePickers, etc. |
| **SCSS per component** | Each component has its own `.component.scss` file with BEM-like naming |
| **PrimeFlex for layout** | `flex`, `gap-3`, `p-4`, `col-12 md:col-6`, `justify-content-between`, etc. |
| **External templates** | All components use `templateUrl` (separate `.html` files), never inline |
| **No barrel exports** | Each component/service imported directly by file path. No `index.ts` files |
| **Simulated latency** | `of(data).pipe(delay(ms))` — replace with `this.http.get<T>(url)` |

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Component folders | kebab-case | `new-employee-registration/` |
| Component classes | PascalCase | `NewEmployeeRegistrationComponent` |
| Service files | kebab-case.service.ts | `hr-api.service.ts` |
| Service classes | PascalCase | `HrApiService` |
| Model files | kebab-case.model.ts | `employee.model.ts` |
| Route paths | Lowercase, hyphenated | `/hr/:staffId/new-employee` |
| CSS classes | BEM-like | `.step-card__header`, `.doc-slot--uploaded` |
| Signals | camelCase | `loading`, `activeStep`, `sidebarOpen` |
| Computed signals | camelCase | `filteredEmployees`, `completionPercent` |

### Component File Structure Pattern

Every component in the project follows this structure:
```
component-name/
├── component-name.component.ts     # Logic, signals, services
├── component-name.component.html   # Template (external)
└── component-name.component.scss   # Scoped styles
```

No `.spec.ts` files (tests disabled in schematics).

---

*End of Frontend Guide — HR Portal, Naleko Digital Solutions*  
*Document Version 1.0 — 31 March 2026 — Obsydian Technologies*
