// ─── IT Provisioning Domain Models ────────────────────────────────────────────
// Screen 4: IT Specialist Queue View
// Screen 5: IT Specialist Task Detail

export type TaskSlaStatus = 'BREACHED' | 'AT_RISK' | 'ON_TRACK';
export type TaskStatus    = 'UNASSIGNED' | 'CLAIMED' | 'COMPLETED';

export type RequirementType =
  | 'Hardware'
  | 'Access & Identity'
  | 'Software'
  | 'Facilities';

export type ActivityEventType = 'claim' | 'sla' | 'create' | 'complete' | 'release';

export interface ChecklistItem {
  id: string;
  label: string;
  completed: boolean;
}

export interface ActivityEvent {
  type: ActivityEventType;
  text: string;
  timestamp: string;
  subtext: string;
}

export interface FulfilmentData {
  assetReference: string;
  fulfilmentMethod: string;
  additionalNotes: string;
}

export interface ItTask {
  id: string;
  /** Display title e.g. "Laptop — Mid Analyst spec" */
  title: string;
  requirementType: RequirementType;
  queue: RequirementType;
  /** The new hire this task is for. */
  newHire: {
    name: string;
    role: string;
    seniority: string;
    department: string;
    startDate: string;       // display string e.g. "2 Jun 2026"
    daysRemaining: number;
    deliveryLocation: string;
  };
  slaStatus: TaskSlaStatus;
  taskStatus: TaskStatus;
  /** ISO date string of required-by date e.g. "2 Jun 2026" */
  requiredBy: string;
  /** 0–100 percent of SLA window elapsed. */
  slaProgress: number;
  /** ID of the IT specialist who claimed this task (null = unassigned). */
  claimedBy: string | null;
  claimedByName: string | null;
  claimedByRole: string | null;
  claimedAt: string | null;
  /** Optional note from the Hiring Manager. */
  hmNote: string | null;
  hmName: string | null;
  hmRole: string | null;
  /** Bundle/workflow reference this task was created from. */
  bundleApprovedBy: string | null;
  /** Tenant-configurable checklist per requirement type. */
  checklist: ChecklistItem[];
  /** Full activity trail. */
  activity: ActivityEvent[];
}

export interface ItQueue {
  type: RequirementType;
  count: number;
}
