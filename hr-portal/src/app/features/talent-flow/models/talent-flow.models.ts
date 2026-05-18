/**
 * TalentFlow Domain Models
 * Primary source of truth: docs/TALENT-FLOW-PLAN-REVISED.md
 * Plan takes precedence over BRD where they differ.
 */

// ─── Hiring Pipeline Stages (TALENT-FLOW-PLAN-REVISED §2.5 + SLA defaults) ──
// 11 operational stages matching Lambda DynamoDB keys — do NOT use BRD values
export type HiringStage =
  | 'APPLICATION_REVIEW'
  | 'PHONE_SCREENING'
  | 'TECHNICAL_INTERVIEW'
  | 'PANEL_INTERVIEW'
  | 'EVALUATION'
  | 'OFFER_PREPARATION'
  | 'OFFER_APPROVAL'
  | 'OFFER_DELIVERY'
  | 'CONTRACT_SIGNING'
  | 'PRE_BOARDING'
  | 'ONBOARDING';

// ─── Clearance States (BRD §7.2) ────────────────────────────────────────────
export type ClearanceState =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'CLEARED'
  | 'FAILED'
  | 'OVERRIDDEN'
  | 'NOT_REQUIRED';

// ─── Provisioning Item States (BRD §7.3) ────────────────────────────────────
export type ProvisioningState =
  | 'NOT_STARTED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'READY'
  | 'FAILED'
  | 'NOT_REQUIRED';

// ─── Evaluation States (BRD §7.4) ───────────────────────────────────────────
export type EvaluationState = 'DRAFT' | 'SUBMITTED' | 'LATE' | 'MISSING';

// ─── Position Level ──────────────────────────────────────────────────────────
export type PositionLevel = 'JUNIOR' | 'MID' | 'SENIOR' | 'DIRECTOR';

// ─── Config Types (TALENT-FLOW-PLAN-REVISED §3.1) ───────────────────────────
export type ConfigType =
  | 'SCORING_WEIGHTS'
  | 'SLA_THRESHOLDS'
  | 'APPROVAL_RULES'
  | 'PANEL_CONFIG'
  | 'EMAIL_TEMPLATES'
  | 'STAGE_CONFIG';

// ─── Scoring Weights (talent-flow-config, configType SCORING_WEIGHTS) ────────
export interface ScoringWeights {
  technical:       number; // 0–100, weights must sum to 100
  communication:   number;
  culturalFit:     number;
  problemSolving:  number;
}

/** Default weights — used when config has not been loaded yet */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  technical:      30,
  communication:  25,
  culturalFit:    25,
  problemSolving: 20,
};

// ─── Candidate Event (talent-flow-events DynamoDB table) — FE-006 ─────────────

export interface CandidateEvent {
  eventId:     string;
  eventType:   string;   // EventBridge detail-type, e.g. 'CandidateCreated'
  source:      string;   // EventBridge source, e.g. 'talent-flow.candidates'
  candidateId: string;
  tenantId:    string;
  actor:       string;   // 'SYSTEM' | 'HUMAN' | 'AGENT'
  timestamp:   string;   // ISO-8601
  detail:      Record<string, unknown>;
}

export interface CandidateEventsResponse {
  events:     CandidateEvent[];
  total:      number;
  nextToken?: string;
}

// ─── Core Entities ───────────────────────────────────────────────────────────

export interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: string;
  positionLevel: PositionLevel;
  currentStage: HiringStage;
  appliedDate: string; // ISO 8601
  experienceYears: number;
  source?: string;
  workflowTemplateId: string;
  configVersion: string;
  day1ReadinessScore?: number; // 0–100
  acceptanceSentiment?: 'POSITIVE' | 'NEUTRAL' | 'HESITANT' | 'AT_RISK';
  slaHealthStatus?: 'GREEN' | 'AMBER' | 'RED';
  slaBreachedAt?: string; // ISO 8601
  createdAt: string;
  updatedAt: string;
}

export interface Interview {
  id: string;
  candidateId: string;
  round: 1 | 2;
  scheduledAt: string; // ISO 8601
  location?: string;
  panelMemberIds: string[];
  votesRequired: number;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  completedAt?: string;
}

export interface Vote {
  id: string;
  candidateId: string;
  interviewId: string;
  panelMemberId: string;
  decision: 'HIRE' | 'NO_HIRE' | 'STRONG_NO_VETO';
  scores: Record<string, number>;
  notes?: string;
  configVersionUsed: string;
  submittedAt: string;
  state: EvaluationState;
}

// ─── Request Payloads ────────────────────────────────────────────────────────

export interface CreateCandidatePayload {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: string;
  positionLevel: PositionLevel;
  experienceYears: number;
  source?: string;
  workflowTemplateId?: string;
}

export interface ScheduleInterviewPayload {
  round: 1 | 2;
  scheduledAt: string; // ISO 8601
  location?: string;
  panelMemberIds: string[];
}

export interface VotePayload {
  interviewId: string;
  decision: 'HIRE' | 'NO_HIRE' | 'STRONG_NO_VETO';
  scores: Record<string, number>;
  notes?: string;
}

// ─── Pipeline Filters ────────────────────────────────────────────────────────

export interface PipelineFilters {
  stage?: HiringStage;
  positionLevel?: PositionLevel;
  slaStatus?: 'GREEN' | 'AMBER' | 'RED';
  search?: string;
  limit?: number;
  nextToken?: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface ConfigResponse {
  configType: ConfigType;
  version: string;
  isActive: boolean;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ─── Agent / AI Chat ─────────────────────────────────────────────────────────

export interface ChatContext {
  candidateId?: string;
  stage?: HiringStage;
  sessionId?: string;
}

export interface ChatResponse {
  message: string;
  intent?: string;
  toolsUsed?: string[];
  sessionId?: string;
  // TODO: extend with streaming support when AI chat panel component is built (FE-00x)
}

export interface PendingAction {
  actionId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  requestedBy: string;
  createdAt: string;
  expiresAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
}

export interface ApproveActionResponse {
  actionId: string;
  status: 'APPROVED';
  executedAt: string;
}

export interface RejectActionResponse {
  actionId: string;
  status: 'REJECTED';
  reason: string;
}
