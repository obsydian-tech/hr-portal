import { isPast } from '../deadline';

/** The four steps HR sees, in order. */
export const STEPS = ['Invited', 'Documents', 'In review', 'Verified'] as const;
export type Step = (typeof STEPS)[number];

/** One person as GET /v1/employees returns them. Only what this app reads: phone and id_number_last4 are left out on purpose. */
export interface ApiEmployee {
  employee_id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  department?: string;
  /** INVITED, DOCUMENTS, IN_REVIEW or VERIFIED; null or missing when the API has none. */
  step?: string | null;
  planned_start_date?: string;
  /** YYYY-MM-DD: when the person's required documents are due, worked out by the API; empty when there is none. */
  documents_due?: string;
  hr_staff_name?: string;
}

/** A new employee as the screens see them. No phone number, no ID digits. */
export interface NewEmployee {
  id: string;
  name: string;
  email: string;
  department: string;
  /** Null when the API gives no step, or one that is not of the four (it counts in no step). */
  step: Step | null;
  /** YYYY-MM-DD, or empty when not set. */
  startDate: string;
  /** YYYY-MM-DD, or empty when there is none. */
  documentsDue: string;
  hrPartner: string;
}

/** The API's step codes and the words HR sees: one row each. */
const STEP_WORDS: Readonly<Record<string, Step>> = {
  INVITED: 'Invited',
  DOCUMENTS: 'Documents',
  IN_REVIEW: 'In review',
  VERIFIED: 'Verified',
};

/** The API's step code as the words on screen. Any other value, or none, is null. */
export function stepOfCode(code: string | undefined | null): Step | null {
  return typeof code === 'string' && Object.hasOwn(STEP_WORDS, code) ? STEP_WORDS[code]! : null;
}

export function toNewEmployee(a: ApiEmployee): NewEmployee {
  return {
    id: a.employee_id,
    name: [a.first_name, a.last_name].filter(Boolean).join(' ').trim(),
    email: a.email ?? '',
    department: a.department ?? '',
    step: stepOfCode(a.step),
    startDate: a.planned_start_date ?? '',
    documentsDue: a.documents_due ?? '',
    hrPartner: a.hr_staff_name ?? '',
  };
}

/** Today in South Africa as YYYY-MM-DD. */
export function todayInSouthAfrica(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(now);
}

/**
 * Who starts next comes first: start dates from today on (soonest first), then earlier ones
 * (most recent first), then people with no date. Same date: by name.
 */
export function orderNewEmployees(people: readonly NewEmployee[], today: string): NewEmployee[] {
  const group = (p: NewEmployee) => (!p.startDate ? 2 : p.startDate >= today ? 0 : 1);
  return [...people].sort((a, b) => {
    const g = group(a) - group(b);
    if (g) return g;
    const byDate = group(a) === 0 ? a.startDate.localeCompare(b.startDate) : group(a) === 1 ? b.startDate.localeCompare(a.startDate) : 0;
    return byDate || a.name.localeCompare(b.name, 'en');
  });
}

export function countBySteps(people: readonly NewEmployee[]): Record<Step, number> {
  const out: Record<Step, number> = { Invited: 0, Documents: 0, 'In review': 0, Verified: 0 };
  for (const p of people) if (p.step) out[p.step]++;
  return out;
}

/**
 * Overdue means: the person still has a required document to give (step Invited or Documents) and the due
 * date has passed. A person whose documents are with HR, or who is verified, is never overdue (ONB-10).
 */
export function isOverdue(p: NewEmployee, today: string): boolean {
  return (p.step === 'Invited' || p.step === 'Documents') && isPast(p.documentsDue, today);
}

/** Part of a name or email, any case. Words of the query may be split across first and last name. */
export function matchesSearch(p: NewEmployee, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
}
