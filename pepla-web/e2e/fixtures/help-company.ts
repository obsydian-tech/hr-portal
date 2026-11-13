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
 * Johan Botha's page (GET /v1/employees/{id}/verifications), as HELP-02 shows it: In review, two
 * documents uploaded before HELP_TODAY, no phone. Job title comes from HELP_PEOPLE.
 *
 * The ID number is made up and can never belong to a real person: its birth month is 00 and it
 * fails the ID check digit.
 */
const JOHAN_ID_NUMBER = '8500015009087';
const JOHAN_UPLOADED = '2026-02-26T08:00:00Z';

export const HELP_JOHAN_DETAIL = (() => {
  const person = HELP_PEOPLE.find((p) => p.email === 'johan@example.com')!;
  const employee = HELP_NEW_EMPLOYEES.find((e) => e.email === person.email)!;
  return {
    employee: { ...employee, phone: '', job_title: person.title },
    documents: [
      {
        document_id: 'sunbird-johan-id',
        document_type: 'NATIONAL_ID',
        file_name: 'johan-id.pdf',
        uploaded_at: JOHAN_UPLOADED,
        check: 'MATCHES',
        hr_decision: null,
        hr_decided_at: null,
        verification: { id_number: JOHAN_ID_NUMBER, id_number_last4: JOHAN_ID_NUMBER.slice(-4) },
      },
      {
        document_id: 'sunbird-johan-bank',
        document_type: 'BANK_CONFIRMATION',
        file_name: 'johan-bank-letter.pdf',
        uploaded_at: JOHAN_UPLOADED,
        check: 'NEEDS_A_LOOK',
        hr_decision: null,
        hr_decided_at: null,
        verification: null,
      },
    ],
  };
})();
