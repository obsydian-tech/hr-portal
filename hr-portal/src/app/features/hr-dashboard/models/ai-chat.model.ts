/**
 * NH-57: AI Mode — TypeScript types for nalekoAiChat Lambda request/response
 * Mirrors the shapes defined in AI-MODE-PLAN.md § 5
 */

// ─── Screen Context ─────────────────────────────────────────────────────────

export interface AiScreenContext {
  view: 'EMPLOYEE_DETAIL' | 'VERIFICATIONS_LIST' | 'HR_DASHBOARD';
  employeeId?: string;
  employeeName?: string;
}

// ─── Conversation ────────────────────────────────────────────────────────────

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Request ─────────────────────────────────────────────────────────────────

export interface AiChatRequest {
  templateId: AiTemplateId;
  slots: Record<string, string>;
  conversationHistory: ConversationTurn[];
  screenContext: AiScreenContext;
  followUpText?: string;
}

// ─── Response ────────────────────────────────────────────────────────────────

export interface PendingAction {
  type: 'CREATE_EMPLOYEE';
  draft: Record<string, unknown>;
  confirmEndpoint: string;
}

export interface AiChatResponse {
  status: 'COMPLETE' | 'PENDING_APPROVAL';
  message: string;
  structuredData?: unknown;
  toolCallsMade: string[];
  conversationId: string;
  guardrailAction?: 'MASKED' | 'NONE';
  pendingAction?: PendingAction;
}

// ─── Templates ───────────────────────────────────────────────────────────────

export type AiTemplateId =
  | 'high_risk_employees'
  | 'risk_assessment'
  | 'document_verification_summary'
  | 'verifications_by_status'
  | 'audit_log'
  | 'onboard_employee'
  | 'employees_by_department'
  | 'follow_up';

export type AiSlotType =
  | 'text'
  | 'email'
  | 'dropdown'
  | 'autocomplete'
  | 'selectbutton'
  | 'inputnumber'
  | 'calendar';

export interface AiTemplateSlot {
  key: string;
  label: string;
  type: AiSlotType;
  options?: string[];
  defaultValue?: string;
  placeholder?: string;
  required: boolean;
}

export interface AiTemplate {
  id: AiTemplateId;
  label: string;
  description: string;
  icon: string;
  slots: AiTemplateSlot[];
  /** true → HITL gate will trigger (write operation) */
  isWrite: boolean;
}

// ─── Template definitions ────────────────────────────────────────────────────

export const AI_TEMPLATES: AiTemplate[] = [
  {
    id: 'high_risk_employees',
    label: 'Show me all HIGH risk employees',
    description: 'Assess and list employees whose document verifications are flagged as high risk.',
    icon: 'pi-exclamation-triangle',
    slots: [],
    isWrite: false,
  },
  {
    id: 'risk_assessment',
    label: 'Risk assessment for an employee',
    description: 'Run a Bedrock-powered risk classification on one employee\'s documents.',
    icon: 'pi-shield',
    slots: [
      { key: 'employeeId', label: 'Employee ID', type: 'text', placeholder: 'EMP-0000012', required: true },
    ],
    isWrite: false,
  },
  {
    id: 'document_verification_summary',
    label: 'Document verification summary',
    description: 'Get a plain-English explanation of why a document passed, failed, or needs review.',
    icon: 'pi-file-check',
    slots: [
      { key: 'employeeId', label: 'Employee ID', type: 'text', placeholder: 'EMP-0000012', required: true },
      {
        key: 'documentType',
        label: 'Document type',
        type: 'dropdown',
        options: ['NATIONAL_ID', 'BANK_CONFIRMATION', 'MATRIC_CERTIFICATE', 'TERTIARY_QUALIFICATION'],
        required: true,
      },
    ],
    isWrite: false,
  },
  {
    id: 'verifications_by_status',
    label: 'All verifications with status',
    description: 'List all document verifications filtered by their current status.',
    icon: 'pi-list-check',
    slots: [
      {
        key: 'status',
        label: 'Status',
        type: 'selectbutton',
        options: ['PENDING', 'MANUAL_REVIEW', 'FAILED', 'PASSED'],
        defaultValue: 'PENDING',
        required: true,
      },
    ],
    isWrite: false,
  },
  {
    id: 'audit_log',
    label: 'Audit log for an employee',
    description: 'View all POPIA-compliant audit trail entries for a specific employee.',
    icon: 'pi-history',
    slots: [
      { key: 'employeeId', label: 'Employee ID', type: 'text', placeholder: 'EMP-0000012', required: true },
    ],
    isWrite: false,
  },
  {
    id: 'onboard_employee',
    label: 'Onboard a new employee',
    description: 'Create a new employee record and run an initial risk assessment.',
    icon: 'pi-user-plus',
    slots: [
      { key: 'firstName', label: 'First name', type: 'text', required: true },
      { key: 'lastName', label: 'Last name', type: 'text', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'phone', label: 'Phone', type: 'text', placeholder: '+27...', required: true },
      {
        key: 'department',
        label: 'Department',
        type: 'dropdown',
        options: ['Engineering', 'Finance', 'Marketing', 'Operations', 'HR', 'Legal'],
        required: true,
      },
      { key: 'jobTitle', label: 'Job title', type: 'text', required: true },
    ],
    isWrite: true,
  },
  {
    id: 'employees_by_department',
    label: 'List employees in a department',
    description: 'View all onboarding employees in a specific department.',
    icon: 'pi-users',
    slots: [
      {
        key: 'department',
        label: 'Department',
        type: 'dropdown',
        options: ['Engineering', 'Finance', 'Marketing', 'Operations', 'HR', 'Legal'],
        required: true,
      },
    ],
    isWrite: false,
  },
];
