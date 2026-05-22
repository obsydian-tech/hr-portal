/**
 * TalentFlow Domain Models
 * Source of truth: TALENTFLOW_DECISIONS.md (71 locked decisions)
 */

// ─── Hiring Pipeline Stages ───────────────────────────────────────────────────
// 12 stages across 4 phases. MVP 1 = Phases 1–2. MVP 2 = Phases 3–4.
export type HiringStage =
  // Phase 1 — Interview & Evaluation (MVP 1)
  | 'APPLICATION_REVIEW'
  | 'PHONE_SCREENING'
  | 'TECHNICAL_INTERVIEW'
  | 'PANEL_INTERVIEW'
  | 'EVALUATION'
  // Phase 2 — Offer & Acceptance (MVP 1)
  | 'BACKGROUND_CHECK'
  | 'OFFER_PREPARATION'
  | 'OFFER_APPROVAL'
  | 'OFFER_DELIVERY'
  | 'CONTRACT_SIGNING'
  // Phase 3 — Pre-Onboarding (MVP 2)
  | 'PRE_BOARDING'
  // Phase 4 — Onboarding & Day 1 (MVP 2)
  | 'ONBOARDING';

/** Maps each stage to its phase (1–4). Drives the phase indicator on Candidate Record. */
export const PHASE_MAP: Record<HiringStage, 1 | 2 | 3 | 4> = {
  APPLICATION_REVIEW:  1,
  PHONE_SCREENING:     1,
  TECHNICAL_INTERVIEW: 1,
  PANEL_INTERVIEW:     1,
  EVALUATION:          1,
  BACKGROUND_CHECK:    2,
  OFFER_PREPARATION:   2,
  OFFER_APPROVAL:      2,
  OFFER_DELIVERY:      2,
  CONTRACT_SIGNING:    2,
  PRE_BOARDING:        3,
  ONBOARDING:          4,
};

// ─── Evaluation States ────────────────────────────────────────────────────────
export type EvaluationState = 'DRAFT' | 'SUBMITTED' | 'LATE' | 'MISSING';

// ─── Position Level (D039 — 3 levels only, no DIRECTOR in MVP 1) ─────────────
export type PositionLevel = 'JUNIOR' | 'MID' | 'SENIOR';

// ─── SLA Status (D021 — signal health language only, never expose time values) ─
export type SlaHealthStatus = 'ON_TRACK' | 'AT_RISK' | 'BREACHED';

// ─── Engagement Sentiment — D007: TA-captured interview sentiment (Triggers 1-2)
export type EngagementSentiment = 'VERY_INTERESTED' | 'INTERESTED' | 'NEUTRAL' | 'HESITANT' | 'DISENGAGED';

// ─── Offer States (D064) ──────────────────────────────────────────────────────
export type OfferState = 'OFFER_CREATED' | 'IN_APPROVAL' | 'OFFER_SENT' | 'ACCEPTED';

// ─── Config Types ─────────────────────────────────────────────────────────────
export type ConfigType =
  | 'SCORING_WEIGHTS'
  | 'SLA_THRESHOLDS'
  | 'APPROVAL_RULES'
  | 'PANEL_CONFIG'
  | 'EMAIL_TEMPLATES'
  | 'STAGE_CONFIG'
  | 'SENTIMENT_SCALE'
  | 'INTERVIEW_TYPES'
  | 'REJECTION_RULES'
  | 'WORKFLOW_TEMPLATES'
  | 'SENIORITY_PROFILES';

// ─── Scoring Weights ──────────────────────────────────────────────────────────
export interface ScoringWeights {
  technical:      number; // 0–100, all four must sum to 100
  communication:  number;
  culturalFit:    number;
  problemSolving: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  technical:      30,
  communication:  25,
  culturalFit:    25,
  problemSolving: 20,
};

// ─── Candidate Event ──────────────────────────────────────────────────────────
export interface CandidateEvent {
  eventId:     string;
  eventType:   string;
  source:      string;
  candidateId: string;
  tenantId:    string;
  actor:       string; // 'SYSTEM' | 'HUMAN' | 'AGENT'
  timestamp:   string; // ISO-8601
  detail:      Record<string, unknown>;
}

export interface CandidateEventsResponse {
  events:     CandidateEvent[];
  total:      number;
  nextToken?: string;
}

// ─── Panel Member ─────────────────────────────────────────────────────────────
// D004: hybrid model — system users, email-link-only externals, and TA proxies
export interface PanelMember {
  id:                string;
  name:              string;
  email:             string;
  role:              string;
  tenantId:          string;
  accessType?:       'SYSTEM_ACCOUNT' | 'EMAIL_LINK' | 'TA_PROXY';
  scoringLinkToken?: string; // present only for EMAIL_LINK members (Phase E)
}

// ─── Core Entities ────────────────────────────────────────────────────────────

export interface Candidate {
  id:                  string;
  firstName:           string;
  lastName:            string;
  email:               string;
  phone?:              string;
  role:                string;
  department?:         string;  // D030 details strip column
  location?:           string;  // D030 details strip column
  positionLevel:       PositionLevel;
  currentStage:        HiringStage;
  appliedDate:         string;  // ISO 8601
  experienceYears:     number;
  source?:             string;
  workflowTemplateId:  string;
  configVersion:       string;
  hiringManagerId?:    string;
  // Trigger 1 — First Interview sentiment baseline (D008)
  interviewSentiment?: EngagementSentiment;
  // Interview loop engagement sentiment (5-option scale — D035 activity log)
  engagementSentiment?: EngagementSentiment;
  // Trigger 4 — Offer acceptance sentiment (D071)
  acceptanceSentiment?: 'EXCITED' | 'POSITIVE' | 'HESITANT';
  // Trigger 2 — Interview Loop engagement score (D009)
  engagementScore?:    number; // 0–100
  // SLA — signal health language only (D021)
  slaStatus?:          SlaHealthStatus;
  slaBreachedAt?:      string; // ISO 8601
  createdAt:           string;
  updatedAt:           string;
  currentInterviewId?: string;
}

export interface Interview {
  id:              string;
  candidateId:     string;
  round:           number;  // configurable rounds (not capped at 2)
  interviewType?:  string;
  scheduledAt:     string;  // ISO 8601
  location?:       string;
  panelMemberIds:  string[];
  votesRequired:   number;
  status:          'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  completedAt?:    string;
}

export interface Vote {
  id:               string;
  candidateId:      string;
  interviewId:      string;
  panelMemberId:    string;
  // D050: vote grid values — STRONG_NO | NO | YES | STRONG_YES (no NEUTRAL)
  decision:         'STRONG_NO' | 'NO' | 'YES' | 'STRONG_YES';
  scores:           Record<string, number>;
  notes?:           string;
  configVersionUsed: string;
  submittedAt:      string;
  state:            EvaluationState;
}

// ─── Offer (D064–D071) ────────────────────────────────────────────────────────

export interface ApprovalStep {
  stepId:       string;
  approverRole: string;
  status:       'PENDING' | 'APPROVED' | 'REJECTED';
  decidedAt?:   string;
  notes?:       string;
}

// D069: interaction types and outcomes logged in State 3 (Offer Sent)
export type InteractionType = 'CALL' | 'EMAIL' | 'WHATSAPP' | 'MEETING';
export type InteractionOutcome =
  | 'ACKNOWLEDGED' | 'ASKING_QUESTIONS' | 'COUNTER_RECEIVED'
  | 'GOING_QUIET'  | 'VERBAL_ACCEPT'    | 'DECLINED';

export interface InteractionLogEntry {
  interactionType: InteractionType;
  outcome:         InteractionOutcome;
  notes?:          string | null;
  loggedAt:        string; // ISO 8601
}

export interface Offer {
  offerId:              string;
  candidateId:          string;
  tenantId:             string;
  state:                OfferState;
  positionLevel?:       string;
  role?:                string;
  department?:          string;
  location?:            string;
  baseSalary?:          number;
  currency?:            string;
  startDate?:           string;           // ISO 8601
  expiryDate?:          string;           // ISO 8601
  benefits?:            string;
  approvalChain:        ApprovalStep[];
  currentApprovalStep:  number;
  configVersion:        string;
  interactionLog:       InteractionLogEntry[];
  sentAt?:              string;           // ISO 8601 — set when MARK_SENT action fires
  submittedForApprovalAt?: string;
  acceptanceDate?:      string;
  confirmedStartDate?:  string;
  acceptanceSentiment?: 'EXCITED' | 'POSITIVE' | 'HESITANT';
  acceptanceNotes?:     string | null;
  createdAt:            string;
  updatedAt:            string;
}

// ─── Activity Entry (D035 — activity log, right panel, ONLY place timestamps appear) ─
export interface ActivityEntry {
  entryId:     string;
  candidateId: string;
  actor:       string;
  actorType:   'SYSTEM' | 'HUMAN' | 'AGENT';
  // typed union drives icon rendering per entry type in the activity log panel
  eventType?:  'INTERVIEW' | 'SCORE' | 'SENTIMENT' | 'STAGE' | 'NOTE' | 'SYSTEM';
  action:      string;
  detail?:     string;
  timestamp:   string; // ISO 8601 — timestamps only in activity log (D035)
}

// ─── Request Payloads ─────────────────────────────────────────────────────────

export interface CreateCandidatePayload {
  firstName:           string;
  lastName:            string;
  email:               string;
  phone?:              string;
  role:                string;
  department?:         string; // D029: details strip column
  location?:           string; // D029: details strip column
  positionLevel:       PositionLevel;
  experienceYears:     number;
  source?:             string;
  workflowTemplateId?: string;
}

// All fields are optional — PATCH semantics (only send what changed)
export interface UpdateCandidatePayload {
  firstName?:      string;
  lastName?:       string;
  phone?:          string;
  role?:           string;
  department?:     string;
  location?:       string;
  experienceYears?: number;
  source?:         string;
  hiringManagerId?: string;
  positionLevel?:  PositionLevel; // locked if stage >= PANEL_INTERVIEW
}

export type InterviewType = 'PHONE_SCREEN' | 'TECHNICAL' | 'BEHAVIORAL' | 'CULTURE_FIT' | 'FINAL';

// D004/D005/D041: ad hoc panel member (no platform account — receives scoring link in Phase E)
export interface AdhocPanelMember {
  name:  string;
  email: string;
  role?: string;
}

export interface ScheduleInterviewPayload {
  interviewType:     InterviewType;
  scheduledAt:       string; // ISO 8601
  location?:         string;
  panelMemberIds:    string[];
  adhocPanelMembers?: AdhocPanelMember[]; // D041: ad hoc additions
}

export interface AddPanelMembersPayload {
  panelMemberIds?:    string[];
  adhocPanelMembers?: AdhocPanelMember[];
}

export interface VotePayload {
  interviewId: string;
  // D050: no NEUTRAL vote (removed)
  decision:    'STRONG_NO' | 'NO' | 'YES' | 'STRONG_YES';
  scores:      Record<string, number>;
  notes?:      string;
}

// ─── Pipeline Filters ─────────────────────────────────────────────────────────

export interface PipelineFilters {
  stage?:           HiringStage;
  positionLevel?:   PositionLevel;
  // D021: filter by signal health language, not colour codes
  slaStatus?:       SlaHealthStatus;
  search?:          string;
  /** D051 — filter to candidates assigned to this HM (sub or email). */
  hiringManagerId?: string;
  limit?:           number;
  nextToken?:     string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface ConfigResponse {
  configType: ConfigType;
  version:    string;
  isActive:   boolean;
  data:       Record<string, unknown>;
  createdAt:  string;
  updatedAt:  string;
}

// ─── Agent / AI Chat ──────────────────────────────────────────────────────────

export interface ChatContext {
  candidateId?: string;
  stage?:       HiringStage;
  sessionId?:   string;
}

export interface ChatResponse {
  message:    string;
  intent?:    string;
  toolsUsed?: string[];
  sessionId?: string;
}

export interface PendingAction {
  actionId:    string;
  toolName:    string;
  parameters:  Record<string, unknown>;
  requestedBy: string;
  createdAt:   string;
  expiresAt:   string;
  status:      'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
}

export interface ApproveActionResponse {
  actionId:   string;
  status:     'APPROVED';
  executedAt: string;
}

export interface RejectActionResponse {
  actionId: string;
  status:   'REJECTED';
  reason:   string;
}
