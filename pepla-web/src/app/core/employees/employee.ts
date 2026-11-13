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
  stage?: string;
  planned_start_date?: string;
  hr_staff_name?: string;
}

/** A new employee as the screens see them. No phone number, no ID digits. */
export interface NewEmployee {
  id: string;
  name: string;
  email: string;
  department: string;
  /** Null when the stored stage is not one of the four (it counts in no step). */
  step: Step | null;
  /** YYYY-MM-DD, or empty when not set. */
  startDate: string;
  hrPartner: string;
}

/**
 * The stored stage as one of the four steps. Until ONB-09 gives the backend the four steps,
 * this is the only place that knows how today's stages map. ONB-09 removes it.
 */
export function stepOfStage(stage: string | undefined | null): Step | null {
  switch (stage) {
    case 'INVITED': return 'Invited';
    case 'ACTIVE': return 'Documents';
    case 'DOCUMENTS_SUBMITTED': return 'In review';
    case 'VERIFIED':
    case 'TRAINING':
    case 'ONBOARDED': return 'Verified';
    default: return null;
  }
}

export function toNewEmployee(a: ApiEmployee): NewEmployee {
  return {
    id: a.employee_id,
    name: [a.first_name, a.last_name].filter(Boolean).join(' ').trim(),
    email: a.email ?? '',
    department: a.department ?? '',
    step: stepOfStage(a.stage),
    startDate: a.planned_start_date ?? '',
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

/** Part of a name or email, any case. Words of the query may be split across first and last name. */
export function matchesSearch(p: NewEmployee, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
}
