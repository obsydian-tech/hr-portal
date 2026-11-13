import { stepOfStage, type Step } from './employee';

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
    stage?: string;
    planned_start_date?: string;
    hr_staff_name?: string;
  };
  documents?: Array<{
    document_id: string;
    document_type: string;
    file_name?: string;
    uploaded_at?: string;
    check?: Check;
    hr_decision?: HrDecision | null;
    hr_decided_at?: string | null;
    verification?: { id_number?: string | null; id_number_last4?: string | null } | null;
  }>;
}

export interface EmployeeDocument {
  id: string;
  type: DocumentType;
  fileName: string;
  uploadedAt: string;
  check: Check;
  decision: HrDecision | null;
  decidedAt: string;
  /** The full ID number, for the masked field. Empty when there is none. */
  idNumber: string;
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
  /** One entry per document type, in the page's order: its uploads newest first, empty when none. */
  byType: Array<{ type: DocumentType; name: string; documents: EmployeeDocument[] }>;
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
      idNumber: d.verification?.id_number ?? '',
      idLast4: d.verification?.id_number_last4 ?? '',
    }));
  return {
    id: e.employee_id,
    name: [e.first_name, e.last_name].filter(Boolean).join(' ').trim(),
    jobTitle: e.job_title ?? '',
    department: e.department ?? '',
    email: e.email ?? '',
    phone: e.phone ?? '',
    step: stepOfStage(e.stage),
    startDate: e.planned_start_date ?? '',
    hrPartner: e.hr_staff_name ?? '',
    byType: DOCUMENT_TYPES.map(({ type, name }) => ({
      type,
      name,
      documents: docs.filter((d) => d.type === type).sort((x, y) => y.uploadedAt.localeCompare(x.uploadedAt)),
    })),
  };
}
