import { CHECK_WORD, DOCUMENT_TYPES, type Check } from '../employees/employee-detail';

/** GET /v1/verifications?waiting=true, the parts this page reads (ONB-13). */
export interface ApiWaitingDocuments {
  items?: Array<{
    document_id: string;
    employee_id: string;
    employee_name?: string;
    document_type: string;
    check: Check;
    arrived_at?: string | null;
  }>;
  count?: number;
  counts?: Partial<Record<Check, number>>;
}

export interface WaitingDocument {
  id: string;
  employeeId: string;
  employeeName: string;
  typeName: string;
  check: Check;
  checkWord: string;
  /** "10 Nov 2026" on the South African calendar day, or "Not known". */
  arrived: string;
}

export interface WaitingList {
  /** Every waiting document, oldest first, in the order the answer gives. */
  documents: WaitingDocument[];
  /** The full number waiting, not one page. */
  total: number;
  counts: Record<Check, number>;
}

const SOUTH_AFRICA = 'Africa/Johannesburg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "10 Nov 2026": the South African calendar day of an ISO time, with the year. */
export function arrivedOn(iso: string | null | undefined): string {
  if (!iso) return 'Not known';
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return 'Not known';
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: SOUTH_AFRICA }).format(time).split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

const TYPE_NAME = new Map<string, string>(DOCUMENT_TYPES.map((t) => [t.type, t.name]));

/** The name HR sees for a document type; an unknown type is spelled out in plain words. */
export function typeName(type: string): string {
  const known = TYPE_NAME.get(type);
  if (known) return known;
  const words = type.toLowerCase().replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Document';
}

export function toWaitingList(answer: ApiWaitingDocuments): WaitingList {
  const documents = (answer.items ?? []).map((i) => ({
    id: i.document_id,
    employeeId: i.employee_id,
    employeeName: i.employee_name ?? '',
    typeName: typeName(i.document_type),
    check: i.check,
    checkWord: CHECK_WORD[i.check] ?? CHECK_WORD.READING,
    arrived: arrivedOn(i.arrived_at),
  }));
  const counts = { READING: 0, MATCHES: 0, NEEDS_A_LOOK: 0, DOESNT_MATCH: 0, ...answer.counts } as Record<Check, number>;
  return { documents, total: answer.count ?? documents.length, counts };
}
