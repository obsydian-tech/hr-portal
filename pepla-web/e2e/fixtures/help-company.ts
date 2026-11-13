/**
 * The ONE company that appears in help pictures and walkthrough videos.
 *
 * Everything here is made up. It is public (the repo is public), so never put
 * a real person, company, ID number, bank account or phone number here.
 * South African by default (day zero is South Africa only).
 *
 * When journeys run against pepla-dev, the dev seed creates this same company
 * and these same people, so names and counts never change between retakes.
 */
export const HELP_COMPANY = {
  name: 'Sunbird Bakery (Pty) Ltd',
  shortName: 'Sunbird Bakery',
  city: 'Gqeberha',
  country: 'ZA',
  currency: 'ZAR',
} as const;

export type HelpRole = 'Admin' | 'HR' | 'Manager' | 'Employee';

/** Fake people. Emails use example.com, which can never receive mail. */
export const HELP_PEOPLE = [
  { key: 'admin', name: 'Nomsa Dlamini', role: 'Admin', title: 'Owner', email: 'nomsa@example.com' },
  { key: 'hr', name: 'Pieter van Wyk', role: 'HR', title: 'People and payroll', email: 'pieter@example.com' },
  { key: 'manager', name: 'Ayesha Patel', role: 'Manager', title: 'Head baker', email: 'ayesha@example.com' },
  { key: 'employee', name: 'Sipho Mokoena', role: 'Employee', title: 'Baker', email: 'sipho@example.com' },
  { key: 'employee2', name: 'Lerato Nkosi', role: 'Employee', title: 'Shop assistant', email: 'lerato@example.com' },
  { key: 'employee3', name: 'Johan Botha', role: 'Employee', title: 'Delivery driver', email: 'johan@example.com' },
  { key: 'new', name: 'Thandi Mahlangu', role: 'Employee', title: 'Junior baker (starting soon)', email: 'thandi@example.com' },
] as const satisfies ReadonlyArray<{ key: string; name: string; role: HelpRole; title: string; email: string }>;

/**
 * Sunbird Bakery's new employees, as the employees API (GET /v1/employees)
 * returns them. HR home shows these in help pictures (ONB-02, HELP-01.2): the
 * sign-in journey and the HELP-01 reference both answer the API with exactly
 * this list. Only people from HELP_PEOPLE, HR partner Pieter van Wyk. Start
 * dates are around HELP_TODAY (2 March 2026). No phone or ID digits.
 */
export const HELP_NEW_EMPLOYEES = [
  {
    employee_id: 'sunbird-thandi-mahlangu',
    first_name: 'Thandi',
    last_name: 'Mahlangu',
    email: 'thandi@example.com',
    department: 'Bakery',
    stage: 'INVITED',
    planned_start_date: '2026-03-16',
    hr_staff_name: 'Pieter van Wyk',
  },
  {
    employee_id: 'sunbird-lerato-nkosi',
    first_name: 'Lerato',
    last_name: 'Nkosi',
    email: 'lerato@example.com',
    department: 'Shop',
    stage: 'ACTIVE',
    planned_start_date: '2026-03-09',
    hr_staff_name: 'Pieter van Wyk',
  },
  {
    employee_id: 'sunbird-johan-botha',
    first_name: 'Johan',
    last_name: 'Botha',
    email: 'johan@example.com',
    department: 'Delivery',
    stage: 'DOCUMENTS_SUBMITTED',
    planned_start_date: '2026-03-02',
    hr_staff_name: 'Pieter van Wyk',
  },
  {
    employee_id: 'sunbird-sipho-mokoena',
    first_name: 'Sipho',
    last_name: 'Mokoena',
    email: 'sipho@example.com',
    department: 'Bakery',
    stage: 'VERIFIED',
    planned_start_date: '2026-02-16',
    hr_staff_name: 'Pieter van Wyk',
  },
] as const;

/**
 * Johan Botha's page (HELP-02): what the document upload API answers for
 * GET /v1/employees/sunbird-johan-botha/verifications. He is In review: his
 * National ID matches, his bank letter needs a look, and HR has decided
 * nothing. No phone, so the page leaves it out.
 *
 * The ID number is made up and can never be a real person's: its birth month
 * is 00 and its check digit is wrong. Pictures show it hidden to the last four
 * digits, and no journey ever presses Show.
 */
export const HELP_JOHAN_ID_NUMBER = '8700015800087';

export const HELP_JOHAN_DOCUMENTS = [
  { document_type: 'NATIONAL_ID', file_name: 'johan-id.pdf', uploaded_at: '2026-02-26T08:00:00Z', check: 'MATCHES' },
  { document_type: 'BANK_CONFIRMATION', file_name: 'johan-bank-letter.pdf', uploaded_at: '2026-02-26T08:00:00Z', check: 'NEEDS_A_LOOK' },
] as const;

/** Johan's answer from the document upload API, built only from the lists above. */
export function helpJohanDetail() {
  const person = HELP_PEOPLE.find((p) => p.key === 'employee3')!;
  const row = HELP_NEW_EMPLOYEES.find((e) => `${e.first_name} ${e.last_name}` === person.name)!;
  return {
    employee: {
      employee_id: row.employee_id,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      phone: '',
      department: row.department,
      job_title: person.title,
      stage: row.stage,
      planned_start_date: row.planned_start_date,
      hr_staff_name: row.hr_staff_name,
    },
    documents: HELP_JOHAN_DOCUMENTS.map((d, i) => ({
      ...d,
      document_id: `sunbird-johan-document-${i + 1}`,
      hr_decision: null,
      hr_decided_at: null,
      verification: d.document_type === 'NATIONAL_ID' ? { id_number: HELP_JOHAN_ID_NUMBER, id_number_last4: HELP_JOHAN_ID_NUMBER.slice(-4) } : null,
    })),
  };
}
