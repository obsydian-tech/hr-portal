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
 *   ADMIN → naleko-talentflow-admin
 *   HM    → naleko-talentflow-hiringmanager
 *   IT    → naleko-it-provisioning
 *   TA    → naleko-talentflow-hr
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
