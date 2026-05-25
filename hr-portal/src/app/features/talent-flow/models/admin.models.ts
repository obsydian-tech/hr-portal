/**
 * TalentFlow Admin Workspace Models — Admin-S1
 *
 * Additive to talent-flow.models.ts — no existing types are modified.
 *
 * Role vocabulary (Option C architecture):
 *   TalentFlowRole[] lives in talent-flow-users DynamoDB table (query layer)
 *   AND as Cognito group membership (access-control authority).
 *   adminUpdateUser keeps both in sync on every write.
 *
 * Role → Naleko Cognito group mapping:
 *   ADMIN → TalentFlowAdmin
 *   HM    → HiringManager
 *   IT    → ITAdmin
 *   TA    → HRDirector
 */

// ─── Role ─────────────────────────────────────────────────────────────────────

export type TalentFlowRole = 'ADMIN' | 'HM' | 'IT' | 'TA';

export const ROLE_LABELS: Record<TalentFlowRole, string> = {
  ADMIN: 'Admin',
  HM:    'Hiring Manager',
  IT:    'IT Admin',
  TA:    'TA Specialist',
};

export const ALL_ROLES: TalentFlowRole[] = ['ADMIN', 'HM', 'IT', 'TA'];

// ─── Admin User ───────────────────────────────────────────────────────────────

/** User record from talent-flow-users DynamoDB table (admin query layer). */
export interface AdminUser {
  userId:         string;          // Cognito sub — stable across renames
  email:          string;
  givenName:      string;
  familyName:     string;
  fullName:       string;
  roles:          TalentFlowRole[];
  activeRole:     TalentFlowRole;  // highest-precedence role (ADMIN > HM > IT > TA)
  status:         'ACTIVE' | 'INACTIVE';
  createdAt:      string;          // ISO 8601
  updatedAt:      string;          // ISO 8601
  deactivatedAt?: string;          // ISO 8601 — present only when INACTIVE
  deactivatedBy?: string;          // userId of the admin who deactivated
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface AdminDashboardKpis {
  activePipeline: number;  // ACTIVE SAGA candidates in state table
  slaBreached:    number;  // candidates with slaStatus = BREACHED
  activeUsers:    number;  // ACTIVE entries in users table
}

/** Minimal candidate summary used in the breach table on the admin dashboard. */
export interface BreachedCandidate {
  candidateId:  string;
  firstName:    string;
  lastName:     string;
  role:         string;    // positionTitle from SAGA record
  currentStage: string;
  slaStatus:    'BREACHED';
}

/** Full response from GET /v1/admin/dashboard */
export interface AdminDashboardResponse {
  kpis:               AdminDashboardKpis;
  breachedCandidates: BreachedCandidate[];
  lastRefreshed:      string; // ISO 8601
}

// ─── Users & Roles ────────────────────────────────────────────────────────────

/** Paginated response from GET /v1/admin/users */
export interface AdminUsersResponse {
  users:      AdminUser[];
  total:      number;
  nextToken?: string;
}

/** Query params for GET /v1/admin/users */
export interface AdminUsersFilters {
  status?:    'ACTIVE' | 'INACTIVE';
  search?:    string;
  limit?:     number;
  nextToken?: string;
}

/** Body for POST /v1/admin/users */
export interface CreateUserPayload {
  email:      string;
  givenName:  string;
  familyName: string;
  roles:      TalentFlowRole[];
}

/** Body for PUT /v1/admin/users/{userId} */
export interface UpdateUserRolesPayload {
  roles: TalentFlowRole[];
}

/** Response from DELETE /v1/admin/users/{userId} */
export interface DeactivateUserResponse {
  message:       string;
  userId:        string;
  deactivatedAt: string; // ISO 8601
}

// ─── Tenant Settings — Section 3 ─────────────────────────────────────────────

export type TenantIndustry =
  | 'TECHNOLOGY'
  | 'FINANCIAL_SERVICES'
  | 'GOVERNMENT'
  | 'HEALTHCARE'
  | 'EDUCATION'
  | 'RETAIL'
  | 'MANUFACTURING'
  | 'OTHER';

export type TenantCompanySize =
  | 'MICRO'    // 1–50
  | 'SMALL'    // 51–200
  | 'MEDIUM'   // 201–500
  | 'LARGE';   // 500+

export interface TenantProfile {
  tenantId:     string;
  companyName:  string;
  tradingName?: string;
  industry:     TenantIndustry;
  companySize:  TenantCompanySize;
  logoUrl?:     string;
  createdAt:    string;
  updatedAt:    string;
}

export interface UpdateTenantProfileRequest {
  companyName:  string;
  tradingName?: string;
  industry:     TenantIndustry;
  companySize:  TenantCompanySize;
  logoUrl?:     string;
}

// ─── Seniority Definitions — SENIORITY_DEFINITIONS ───────────────────────────

export interface SeniorityDefinitionsConfig {
  levels: SeniorityLevel[];
}

export interface SeniorityLevel {
  key:              'JUNIOR' | 'MID' | 'SENIOR';
  label:            string;
  description:      string;
  experienceGuide:  string;
  colour:           string; // fixed per level — not editable
}

export const DEFAULT_SENIORITY_LEVELS: SeniorityLevel[] = [
  { key: 'JUNIOR', label: 'Junior', description: 'Graduate · Entry level · Early career',       experienceGuide: '0–3 years', colour: '#2e7d32' },
  { key: 'MID',    label: 'Mid',    description: 'Professional · Specialist · Independent',      experienceGuide: '3–7 years', colour: '#1565c0' },
  { key: 'SENIOR', label: 'Senior', description: 'Manager · Director · Executive · Lead',        experienceGuide: '7+ years',  colour: '#4a3f8a' },
];

// ─── Workflow Templates — WORKFLOW_TEMPLATES ─────────────────────────────────

export interface WorkflowTemplatesConfig {
  templates: WorkflowTemplate[];
}

export interface WorkflowTemplate {
  templateId:   string;
  name:         string;
  description:  string;
  isDefault:    boolean;
  isActive:     boolean;
  stages:       string[];
  createdAt:    string;
  createdBy:    string;
}

export const DEFAULT_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  { templateId: 'tpl-standard-001', name: 'Standard',   isDefault: true,  isActive: true, description: 'Standard hiring workflow for most roles',   stages: ['Interview', 'Offer', 'Background Check', 'IT Setup'],                                                    createdAt: new Date().toISOString(), createdBy: 'system' },
  { templateId: 'tpl-govt-001',     name: 'Government', isDefault: false, isActive: true, description: 'Extended workflow for government positions',  stages: ['Interview', 'Offer', 'Background', 'Character', 'Medical', 'Security Clearance', 'IT Setup'],          createdAt: new Date().toISOString(), createdBy: 'system' },
  { templateId: 'tpl-banking-001',  name: 'Banking',    isDefault: false, isActive: true, description: 'Regulatory workflow for banking sector roles', stages: ['Interview', 'Offer', 'Background', 'Financial Check', 'Regulatory Approval', 'IT Setup'], createdAt: new Date().toISOString(), createdBy: 'system' },
];

// ─── Approval Chains — APPROVAL_CHAINS ───────────────────────────────────────

export interface ApprovalChainsConfig {
  chains: ApprovalChain[];
}

export interface ApprovalChain {
  seniority:                  'JUNIOR' | 'MID' | 'SENIOR';
  offerApprovalChain:         ApprovalStep[];
  provisioningApprovalChain:  ApprovalStep[];
}

export interface ApprovalStep {
  order:       number;
  role:        'TA' | 'HM' | 'HR_DIRECTOR' | 'FINANCE';
  label:       string;
  isRequired:  boolean;
}

export const APPROVAL_ROLE_LABELS: Record<string, string> = {
  TA:          'TA Specialist',
  HM:          'Hiring Manager',
  HR_DIRECTOR: 'HR Director',
  FINANCE:     'Finance',
};

export const APPROVAL_ROLE_COLOURS: Record<string, string> = {
  TA:          'secondary',
  HM:          'info',
  HR_DIRECTOR: 'primary',
  FINANCE:     'warn',
};

export const DEFAULT_APPROVAL_CHAINS: ApprovalChain[] = [
  {
    seniority: 'JUNIOR',
    offerApprovalChain:        [{ order: 1, role: 'TA', label: 'TA Specialist',  isRequired: true }, { order: 2, role: 'HM', label: 'Hiring Manager', isRequired: true }],
    provisioningApprovalChain: [{ order: 1, role: 'HM', label: 'Hiring Manager', isRequired: true }],
  },
  {
    seniority: 'MID',
    offerApprovalChain:        [{ order: 1, role: 'TA', label: 'TA Specialist',  isRequired: true }, { order: 2, role: 'HM', label: 'Hiring Manager', isRequired: true }],
    provisioningApprovalChain: [{ order: 1, role: 'HM', label: 'Hiring Manager', isRequired: true }],
  },
  {
    seniority: 'SENIOR',
    offerApprovalChain:        [{ order: 1, role: 'TA', label: 'TA Specialist',  isRequired: true }, { order: 2, role: 'HM', label: 'Hiring Manager', isRequired: true }, { order: 3, role: 'HR_DIRECTOR', label: 'HR Director', isRequired: true }],
    provisioningApprovalChain: [{ order: 1, role: 'HM', label: 'Hiring Manager', isRequired: true }, { order: 2, role: 'HR_DIRECTOR', label: 'HR Director', isRequired: true }],
  },
];

// ─── Locale Settings — LOCALE_SETTINGS ───────────────────────────────────────

export interface LocaleSettingsConfig {
  timezone:       string; // IANA e.g. "Africa/Johannesburg"
  dateFormat:     string; // e.g. "DD MMM YYYY"
  currency:       string; // ISO 4217 e.g. "ZAR"
  currencySymbol: string; // e.g. "R"
}

export const DEFAULT_LOCALE_SETTINGS: LocaleSettingsConfig = {
  timezone:       'Africa/Johannesburg',
  dateFormat:     'DD MMM YYYY',
  currency:       'ZAR',
  currencySymbol: 'R',
};

// ─── Audit & Compliance — Section 6 ─────────────────────────────────────────

export type AuditModule = 'TalentFlow' | 'ITRequest' | 'Admin' | 'System';

export type AuditRole = 'TA' | 'HM' | 'IT' | 'Admin' | 'System';

export type AuditEventType =
  | 'SLA_BREACH'
  | 'CONFIG_CHANGE'
  | 'CANDIDATE_ACTION'
  | 'OFFER_ACTION'
  | 'PROVISIONING'
  | 'USER_MANAGEMENT';

export type AuditOutcome = 'SUCCESS' | 'FAILURE' | 'PARTIAL';

export const AUDIT_EVENT_TYPE_LABELS: Record<AuditEventType, string> = {
  SLA_BREACH:       'SLA Breach',
  CONFIG_CHANGE:    'Config Change',
  CANDIDATE_ACTION: 'Candidate Action',
  OFFER_ACTION:     'Offer Action',
  PROVISIONING:     'Provisioning',
  USER_MANAGEMENT:  'User Management',
};

export const AUDIT_MODULE_LABELS: Record<AuditModule, string> = {
  TalentFlow: 'TalentFlow',
  ITRequest:  'IT Request',
  Admin:      'Admin',
  System:     'System',
};

export const AUDIT_OUTCOME_SEVERITY: Record<AuditOutcome, 'success' | 'danger' | 'warn'> = {
  SUCCESS: 'success',
  FAILURE: 'danger',
  PARTIAL: 'warn',
};

export interface AuditEvent {
  eventId:       string;
  timestamp:     string;         // ISO 8601 localised for display
  timestampUtc:  string;         // UTC canonical
  userId:        string;
  userEmail:     string;
  userFullName:  string;
  role:          AuditRole;
  action:        string;         // human-readable e.g. "Updated scoring weights"
  entityType:    string;         // e.g. "Candidate" | "Config" | "User"
  entityId:      string;
  entityLabel:   string;         // display name for the entity
  module:        AuditModule;
  eventType:     AuditEventType;
  outcome:       AuditOutcome;
  ipAddress:     string;
  correlationId: string;
  // present for CONFIG_CHANGE events only
  diff?: AuditDiff;
  // present for non-config events
  payload?: Record<string, unknown>;
}

export interface AuditDiff {
  configType:  string;
  before:      Record<string, unknown>;
  after:       Record<string, unknown>;
  changedKeys: string[];
}

export interface AuditStatsResponse {
  totalEventsToday:    number;
  configChangesToday:  number;
  slaBreachesToday:    number;
  userActionsToday:    number;
}

export interface AuditFilters {
  module?:     AuditModule;
  role?:       AuditRole;
  eventType?:  AuditEventType;
  dateFrom?:   string;   // ISO date YYYY-MM-DD
  dateTo?:     string;
  search?:     string;
  page?:       number;
  pageSize?:   number;
  sortOrder?:  'asc' | 'desc';
}

export interface AuditEventsResponse {
  events:       AuditEvent[];
  totalCount:   number;
  page:         number;
  pageSize:     number;
  totalPages:   number;
}
