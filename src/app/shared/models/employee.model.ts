/** Stage of the onboarding journey */
export type OnboardingStage =
  | 'INVITED'
  | 'DOCUMENTS'
  | 'VERIFICATION_PENDING'
  | 'VERIFIED'
  | 'TRAINING'
  | 'ONBOARDED';

/** Employee record returned by the API */
export interface Employee {
  employee_id: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  email: string;
  phone: string;
  department: string;
  stage: OnboardingStage;
  offer_accept_date: string;
  planned_start_date: string;
  created_at: string;
  created_by: string;
}

/** Document types accepted for upload */
export type DocumentType =
  | 'NATIONAL_ID'
  | 'BANK_CONFIRMATION'
  | 'MATRIC_CERTIFICATE'
  | 'TERTIARY_QUALIFICATION';

/** Status of a single document row */
export type DocumentStatus =
  | 'PENDING'
  | 'UPLOADING'
  | 'PROCESSING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'SUBMITTED';

/** A single document row in the checklist */
export interface DocumentRow {
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

/** OCR API response */
export interface OcrResult {
  success: boolean;
  documentTypeDetected: string;
  message: string;
  extractedSummary?: string;
}

// ─── HR Dashboard API Shapes ──────────────────────────────────

/** OCR processing status from backend */
export type OcrStatus = 'PENDING' | 'PROCESSING' | 'MANUAL_REVIEW' | 'PASSED' | 'FAILED';

/** Verification decision from OCR engine */
export type VerificationDecision = 'MANUAL_REVIEW' | 'PASSED' | 'FAILED';

/** Verification list item (from GET /verifications) */
export interface Verification {
  verification_id: string;
  employee_id?: string;
  employee_name: string;
  document_type?: DocumentType;
  document_id?: string;
  confidence: number;
  decision: VerificationDecision;
  created_at: string;
}

/** Verification list response */
export interface VerificationListResponse {
  items: Verification[];
}

/** Verification detail with extracted fields */
export interface VerificationDetail extends Verification {
  reasoning: string;
  id_number: string;
  name: string;
  surname: string;
  date_of_birth: string;
  gender: string;
  citizenship: string;
}

/** A document belonging to an employee (from GET /employees/:id/documents) */
export interface EmployeeDocument {
  document_id: string;
  document_type: DocumentType;
  file_name: string;
  ocr_status: OcrStatus;
  ocr_completed_at?: string;
  uploaded_at?: string;
  verification_reasoning?: string;
  ocr_result?: EmployeeDocumentOcrResult;
  verification: VerificationDetail | null;
  can_reupload: boolean;
}

/** Extracted OCR fields from a document */
export interface EmployeeDocumentOcrResult {
  id_number?: string;
  full_name?: string;
  date_of_birth?: string;
  gender?: string;
  citizenship?: string;
  bank_name?: string;
  account_number?: string;
  account_holder?: string;
  branch_code?: string;
}

/** Employee documents response */
export interface EmployeeDocumentResponse {
  employee: Pick<Employee, 'employee_id' | 'first_name' | 'last_name' | 'email' | 'stage' | 'department' | 'planned_start_date'>;
  documents: EmployeeDocument[];
  summary: {
    total: number;
    verified: number;
    pending: number;
    issues: number;
  };
}

/** Employee list response (from GET /employees?created_by=:staffId) */
export interface EmployeeListResponse {
  items: Employee[];
  count: number;
  staff_id: string;
  filters_applied: {
    created_by: string;
    stage: string;
    department: string;
  };
}

/** Payload for creating a new employee */
export interface CreateEmployeeRequest {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  department: string;
  offer_accept_date: string;
  planned_start_date: string;
}
