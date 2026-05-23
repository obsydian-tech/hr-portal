// ─── IT Provisioning Domain Models ────────────────────────────────────────────
// Mirror of TalentFlow pattern — Screen 4: IT Specialist Queue View

export type TaskSlaStatus = 'BREACHED' | 'AT_RISK' | 'ON_TRACK';
export type TaskStatus    = 'UNASSIGNED' | 'CLAIMED' | 'COMPLETED';

export type RequirementType =
  | 'Hardware'
  | 'Access & Identity'
  | 'Software'
  | 'Facilities';

export interface ItTask {
  id: string;
  requirementType: RequirementType;
  /** The new hire this task is for. */
  newHire: {
    name: string;
    role: string;
    startDate: string; // ISO 8601 date
    daysRemaining: number;
  };
  slaStatus: TaskSlaStatus;
  taskStatus: TaskStatus;
  /** ID of the IT specialist who claimed this task (null = unassigned). */
  claimedBy: string | null;
  /** Optional note from the Hiring Manager (visible but not dominant). */
  hmNote: string | null;
  /** 0–100 percent of SLA window elapsed. */
  slaProgress: number;
  queue: RequirementType;
}

export interface ItQueue {
  type: RequirementType;
  count: number;
}
