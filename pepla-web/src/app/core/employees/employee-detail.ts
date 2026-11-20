import { stepOfCode, type Step } from './employee';
import type { RiskBand } from './risk-words';

export type DocumentType = 'NATIONAL_ID' | 'BANK_CONFIRMATION' | 'MATRIC_CERTIFICATE' | 'TERTIARY_QUALIFICATION';
export type Check = 'READING' | 'MATCHES' | 'NEEDS_A_LOOK' | 'DOESNT_MATCH';
export type HrDecision = 'ACCEPTED' | 'NEW_ONE_ASKED';

/** The four types, in the order the page lists them, with the names HR sees. */
export const DOCUMENT_TYPES: ReadonlyArray<{ type: DocumentType; name: string }> = [
  { type: 'NATIONAL_ID', name: 'National ID' },
  { type: 'BANK_CONFIRMATION', name: 'Bank confirmation' },
  { type: 'MATRIC_CERTIFICATE', name: 'Matric certificate' },
  { type: 'TERTIARY_QUALIFICATION', name: 'Tertiary qualification' },
];

export const CHECK_WORD: Record<Check, string> = {
  READING: 'Being checked',
  MATCHES: 'Matches',
  NEEDS_A_LOOK: 'Needs a look',
  DOESNT_MATCH: "Doesn't match",
};

export const DECISION_WORD: Record<HrDecision, string> = {
  ACCEPTED: 'Accepted',
  NEW_ONE_ASKED: 'New one asked for',
};

/** GET /v1/employees/{id}/verifications, the parts this page reads. */
export interface ApiEmployeeDetail {
  employee: {
    employee_id: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    department?: string;
    job_title?: string;
    step?: string | null;
    planned_start_date?: string;
    hr_staff_name?: string;
    /** HR only. Left out of the answer for the employee's own view. */
    risk_band?: string | null;
    risk_reason?: string | null;
    risk_assessed_at?: string | null;
  };
  documents?: Array<{
    document_id: string;
    document_type: string;
    file_name?: string;
    uploaded_at?: string;
    check?: Check;
    hr_decision?: HrDecision | null;
    hr_decided_at?: string | null;
    verification?: { id_number_last4?: string | null; id_number_available?: boolean } | null;
  }>;
  /** The document types this company needs accepted before Verified (ONB-08). Missing means no marks. */
  required_documents?: string[];
}

export interface EmployeeDocument {
  id: string;
  type: DocumentType;
  fileName: string;
  uploadedAt: string;
  check: Check;
  decision: HrDecision | null;
  decidedAt: string;
  /** Whether the stored ID number can be shown (the full number is not in the answer). */
  idAvailable: boolean;
  idLast4: string;
}

export interface EmployeeDetail {
  id: string;
  name: string;
  jobTitle: string;
  department: string;
  email: string;
  phone: string;
  step: Step | null;
  /** YYYY-MM-DD, or empty when not set. */
  startDate: string;
  hrPartner: string;
  /** The risk check, or null when the answer carries no risk keys (the employee's view). */
  risk: { band: RiskBand | null; reason: string; assessedAt: string } | null;
  /** One entry per document type, in the page's order: its uploads newest first, empty when none. */
  byType: Array<{ type: DocumentType; name: string; required: boolean; documents: EmployeeDocument[] }>;
}

const BANDS = new Set<string>(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']);
function toBand(v: string | null | undefined): RiskBand | null {
  return v && BANDS.has(v) ? (v as RiskBand) : null;
}

const KNOWN = new Set<string>(DOCUMENT_TYPES.map((t) => t.type));

export function toEmployeeDetail(a: ApiEmployeeDetail): EmployeeDetail {
  const e = a.employee;
  const docs: EmployeeDocument[] = (a.documents ?? [])
    .filter((d) => KNOWN.has(d.document_type))
    .map((d) => ({
      id: d.document_id,
      type: d.document_type as DocumentType,
      fileName: d.file_name ?? '',
      uploadedAt: d.uploaded_at ?? '',
      check: d.check ?? 'READING',
      decision: d.hr_decision ?? null,
      decidedAt: d.hr_decided_at ?? '',
      idAvailable: d.verification?.id_number_available === true,
      idLast4: d.verification?.id_number_last4 ?? '',
    }));
  const required = new Set<string>(Array.isArray(a.required_documents) ? a.required_documents : []);
  return {
    id: e.employee_id,
    name: [e.first_name, e.last_name].filter(Boolean).join(' ').trim(),
    jobTitle: e.job_title ?? '',
    department: e.department ?? '',
    email: e.email ?? '',
    phone: e.phone ?? '',
    step: stepOfCode(e.step),
    startDate: e.planned_start_date ?? '',
    hrPartner: e.hr_staff_name ?? '',
    risk: 'risk_band' in e || 'risk_reason' in e || 'risk_assessed_at' in e
      ? { band: toBand(e.risk_band), reason: e.risk_reason ?? '', assessedAt: e.risk_assessed_at ?? '' }
      : null,
    byType: DOCUMENT_TYPES.map(({ type, name }) => ({
      type,
      name,
      required: required.has(type),
      documents: docs.filter((d) => d.type === type).sort((x, y) => y.uploadedAt.localeCompare(x.uploadedAt)),
    })),
  };
}
