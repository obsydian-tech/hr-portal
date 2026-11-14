import { mask, type DlItem, type VerificationCheck } from '../../ds';
import { CHECK_WORD, DOCUMENT_TYPES, type Check, type DocumentType, type HrDecision } from '../employees/employee-detail';
import { typeName } from './documents-to-check';

export type Compared = 'AGREES' | 'DIFFERS' | 'NOT_READ' | 'NOT_ON_RECORD';
export type ComparedField = 'SURNAME' | 'ID_NUMBER' | 'ACCOUNT_HOLDER';

/** GET /v1/verifications/{id}, the parts this page reads (ONB-15). */
export interface ApiDocumentDetail {
  document: {
    document_id: string;
    employee_id?: string;
    document_type: string;
    file_name?: string;
    uploaded_at?: string | null;
    ocr_completed_at?: string | null;
  };
  verification?: {
    confidence?: number | string | null;
    extracted_data?: {
      id_number?: string | null;
      id_number_last4?: string | null;
      name?: string | null;
      surname?: string | null;
      account_holder?: string | null;
      bank_name?: string | null;
      account_number?: string | null;
      branch_code?: string | null;
      account_type?: string | null;
    } | null;
  } | null;
  employee?: { employee_id: string; first_name?: string; last_name?: string } | null;
  check?: Check;
  hr_decision?: HrDecision | null;
  hr_decided_at?: string | null;
  hr_decided_by_name?: string | null;
  hr_decision_reason?: string | null;
  comparisons?: Array<{ field: ComparedField; result: Compared }>;
}

/** PATCH /v1/verifications/{id}/review, the parts this page reads. */
export interface ApiDecisionAnswer {
  hr_decision?: HrDecision | null;
  hr_decided_at?: string | null;
  hr_decided_by_name?: string | null;
  hr_decision_reason?: string | null;
}

export interface Decided {
  decision: HrDecision;
  /** ISO time of the decision. */
  at: string;
  /** Who decided, or empty for an old decision that has no name. */
  by: string;
  /** The reason HR gave; empty when none. */
  reason: string;
}

export type Confidence = 'high' | 'check' | 'unsure';

export interface DocumentDetail {
  id: string;
  employeeId: string;
  /** "Naledi Dlamini" */
  employeeName: string;
  firstName: string;
  type: string;
  typeName: string;
  fileName: string;
  uploadedAt: string;
  checkedAt: string;
  check: Check;
  checkWord: string;
  /** The "What was compared" list, or null for a document type with nothing to compare. */
  compared: VerificationCheck[] | null;
  confidence: Confidence;
  /** What Batsi read, as rows; null for a document type that has no fields. */
  rows: DlItem[] | null;
  decided: Decided | null;
}

const SOUTH_AFRICA = 'Africa/Johannesburg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A time on the South African clock: its day ("4 Nov 2026") and hour and minute ("10:00"). */
export function saTime(iso: string): { day: string; time: string } | null {
  const when = new Date(iso);
  if (!iso || Number.isNaN(when.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SOUTH_AFRICA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(when);
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: `${Number(part('day'))} ${MONTHS[Number(part('month')) - 1]} ${part('year')}`, time: `${part('hour')}:${part('minute')}` };
}

/** "4 Nov 2026, 10:00" */
export function dayAndTime(iso: string | null | undefined): string {
  const t = saTime(iso ?? '');
  return t ? `${t.day}, ${t.time}` : 'Not known';
}

/** "on 4 Nov 2026 at 10:00" */
export function onAt(iso: string): string {
  const t = saTime(iso);
  return t ? `on ${t.day} at ${t.time}` : '';
}

/** The words for each comparison (ONB-15 card). AGREES is a match, DIFFERS a mismatch, the rest unsure. */
export const COMPARISON_WORDS: Record<ComparedField, Record<Compared, string>> = {
  SURNAME: {
    AGREES: 'Surname matches the record',
    DIFFERS: 'Surname is different from the record',
    NOT_READ: 'Surname could not be read',
    NOT_ON_RECORD: 'No surname on the record to compare',
  },
  ID_NUMBER: {
    AGREES: 'ID number ends in the same 4 digits as the record',
    DIFFERS: 'ID number ends in different digits from the record',
    NOT_READ: 'ID number could not be read',
    NOT_ON_RECORD: 'No ID number on the record to compare',
  },
  ACCOUNT_HOLDER: {
    AGREES: 'Account holder includes the surname on the record',
    DIFFERS: 'Account holder does not include the surname on the record',
    NOT_READ: 'Account holder could not be read',
    NOT_ON_RECORD: 'No surname on the record to compare',
  },
};

const RESULT_MARK: Record<Compared, VerificationCheck['result']> = {
  AGREES: 'match',
  DIFFERS: 'mismatch',
  NOT_READ: 'unsure',
  NOT_ON_RECORD: 'unsure',
};

const NOT_READ = 'Not read';

/** A field Batsi could not read: missing, empty or NOT_FOUND. */
const unread = (v: string | null | undefined): boolean => v == null || v.trim() === '' || v.trim().toUpperCase() === 'NOT_FOUND';
const shown = (v: string | null | undefined): string => (unread(v) ? NOT_READ : v!.trim());

/** "How sure": 90 or more is high, 1 to 89 needs a check, 0 or no result means Batsi could not tell. */
export function confidenceOf(confidence: number | string | null | undefined): Confidence {
  const n = Number(confidence);
  if (!Number.isFinite(n) || n <= 0) return 'unsure';
  return n >= 90 ? 'high' : 'check';
}

/** A hidden number: the last four digits show, with Show to see the rest. */
function hiddenRow(term: string, value: string | null | undefined, last4: string | null | undefined, record: string): DlItem {
  if (!unread(value)) {
    const full = value!.trim();
    return { term, reveal: { record, value: full, masked: mask(full), maskedLabel: term } };
  }
  if (!unread(last4)) return { term, value: mask(`xxxx${last4!.trim()}`) };
  return { term, value: NOT_READ };
}

export function toDocumentDetail(a: ApiDocumentDetail): DocumentDetail {
  const d = a.document;
  const e = a.employee;
  const read = a.verification?.extracted_data ?? {};
  const employeeName = [e?.first_name, e?.last_name].filter(Boolean).join(' ').trim();
  const type = d.document_type;
  const check: Check = a.check ?? 'NEEDS_A_LOOK';

  let compared: VerificationCheck[] | null = null;
  let rows: DlItem[] | null = null;
  if (type === 'NATIONAL_ID') {
    rows = [
      { term: 'First names', value: shown(read.name) },
      { term: 'Surname', value: shown(read.surname) },
      hiddenRow('ID number', read.id_number, read.id_number_last4 ?? read.id_number?.slice(-4), employeeName),
    ];
  } else if (type === 'BANK_CONFIRMATION') {
    rows = [
      { term: 'Account holder', value: shown(read.account_holder) },
      { term: 'Bank', value: shown(read.bank_name) },
      hiddenRow('Account number', read.account_number, null, employeeName),
      { term: 'Branch code', value: shown(read.branch_code) },
      { term: 'Account type', value: shown(read.account_type) },
    ];
  }
  if (type === 'NATIONAL_ID' || type === 'BANK_CONFIRMATION') {
    compared = (a.comparisons ?? []).map((c) => ({ label: COMPARISON_WORDS[c.field]?.[c.result] ?? '', result: RESULT_MARK[c.result] ?? 'unsure' })).filter((c) => c.label);
  }

  const decision = a.hr_decision ?? null;
  const decided: Decided | null = decision
    ? { decision, at: a.hr_decided_at ?? '', by: (a.hr_decided_by_name ?? '').trim(), reason: (a.hr_decision_reason ?? '').trim() }
    : null;

  return {
    id: d.document_id,
    employeeId: e?.employee_id ?? d.employee_id ?? '',
    employeeName,
    firstName: e?.first_name?.trim() ?? '',
    type,
    typeName: typeName(type),
    fileName: d.file_name ?? '',
    uploadedAt: d.uploaded_at ?? '',
    checkedAt: d.ocr_completed_at ?? '',
    check,
    checkWord: CHECK_WORD[check] ?? CHECK_WORD.NEEDS_A_LOOK,
    compared,
    confidence: confidenceOf(a.verification?.confidence),
    rows,
    decided,
  };
}

/** What the decision answer says, as a decided view. */
export function toDecided(a: ApiDecisionAnswer): Decided | null {
  if (!a.hr_decision) return null;
  return { decision: a.hr_decision, at: a.hr_decided_at ?? '', by: (a.hr_decided_by_name ?? '').trim(), reason: (a.hr_decision_reason ?? '').trim() };
}

export { DOCUMENT_TYPES, type DocumentType };
