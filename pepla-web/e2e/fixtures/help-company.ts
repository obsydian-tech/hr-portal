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
 * The step the API answers for each of those people (ONB-09), by employee_id: the same step their
 * stage gives. A separate export, because HELP_NEW_EMPLOYEES is locked exactly as HELP-01.2 left it.
 */
export const HELP_NEW_EMPLOYEE_STEPS: Readonly<Record<string, 'INVITED' | 'DOCUMENTS' | 'IN_REVIEW' | 'VERIFIED'>> = {
  'sunbird-thandi-mahlangu': 'INVITED',
  'sunbird-lerato-nkosi': 'DOCUMENTS',
  'sunbird-johan-botha': 'IN_REVIEW',
  'sunbird-sipho-mokoena': 'VERIFIED',
};

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
    employee: { ...employee, step: HELP_NEW_EMPLOYEE_STEPS[employee.employee_id], phone: '', job_title: person.title, risk_band: null, risk_reason: null, risk_assessed_at: null },
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

/**
 * HELP-03 · HR checks a document. Johan Botha's two HELP-02 documents as Documents to check and the
 * document page answer them, and HR's two decisions. Built from HELP_JOHAN_DETAIL, nothing typed twice.
 * The bank letter was a dark photo: nothing but the account holder was read, so no account number or
 * bank name exists here.
 */
const JOHAN_CHECKED = JOHAN_UPLOADED;
export const HELP_DOCUMENT_REASON = 'The account number cannot be read. Upload a clearer copy of the bank letter.';
export const HELP_DOCUMENT_DECIDED_AT: Readonly<Record<string, string>> = {
  'sunbird-johan-id': '2026-03-02T07:00:00Z',
  'sunbird-johan-bank': '2026-03-02T07:05:00Z',
};

export const HELP_WAITING_DOCUMENTS = (() => {
  const e = HELP_JOHAN_DETAIL.employee;
  return HELP_JOHAN_DETAIL.documents.map((d) => ({
    document_id: d.document_id,
    employee_id: e.employee_id,
    employee_name: `${e.first_name} ${e.last_name}`,
    document_type: d.document_type,
    check: d.check,
    arrived_at: d.uploaded_at,
  }));
})();

export const HELP_DOCUMENT_PAGES = (() => {
  const e = HELP_JOHAN_DETAIL.employee;
  const [id, bank] = HELP_JOHAN_DETAIL.documents;
  const base = (d: typeof id | typeof bank) => ({
    document: { document_id: d!.document_id, employee_id: e.employee_id, document_type: d!.document_type, file_name: d!.file_name, uploaded_at: d!.uploaded_at, ocr_completed_at: JOHAN_CHECKED },
    employee: { employee_id: e.employee_id, first_name: e.first_name, last_name: e.last_name },
    check: d!.check,
    hr_decision: null,
    hr_decided_at: null,
  });
  return {
    [id!.document_id]: {
      ...base(id),
      verification: { confidence: 96, extracted_data: { name: e.first_name, surname: e.last_name, id_number: id!.verification!.id_number, id_number_last4: id!.verification!.id_number_last4 } },
      comparisons: [{ field: 'SURNAME', result: 'AGREES' }, { field: 'ID_NUMBER', result: 'AGREES' }],
    },
    [bank!.document_id]: {
      ...base(bank),
      verification: { confidence: 40, extracted_data: { account_holder: `${e.first_name[0]} ${e.last_name}`, bank_name: null, account_number: null, branch_code: null, account_type: null } },
      comparisons: [{ field: 'ACCOUNT_HOLDER', result: 'AGREES' }],
    },
  } as Record<string, unknown>;
})();

/**
 * HELP-04 · HR adds a new employee. Pieter van Wyk registers Thandi Mahlangu, opens her page and
 * resends her invite link. Built from HELP_PEOPLE and HELP_NEW_EMPLOYEES, nothing typed twice.
 * Phone, department, job title and staff ID are the card's sample values. The phone
 * number cannot be anyone's. Values that hold it are functions, so the fixture's exported strings
 * still hold no phone number (HELP-02 and HELP-03 AC-5).
 */
const THANDI_PERSON = HELP_PEOPLE.find((p) => p.key === 'new')!;
const THANDI_ROW = HELP_NEW_EMPLOYEES.find((e) => e.email === THANDI_PERSON.email)!;
const HELP_HR_PERSON = HELP_PEOPLE.find((p) => p.key === 'hr')!;
const DUMMY_PHONE = '000 000 0000';

export const HELP_HR_PARTNERS = [{ id: 'sunbird-pieter-van-wyk', name: HELP_HR_PERSON.name, staffId: 'HR-001', email: HELP_HR_PERSON.email }] as const;

/** What HR types and chooses on the four steps. */
export const helpNewEmployeeForm = () => ({
  firstName: THANDI_ROW.first_name,
  lastName: THANDI_ROW.last_name,
  email: THANDI_ROW.email,
  phone: DUMMY_PHONE,
  department: 'Operations',
  jobTitle: 'Junior baker',
  startDate: THANDI_ROW.planned_start_date,
});

/** POST /v1/employees answers 201 with this; the welcome email is sent. */
export const HELP_REGISTERED = { employee: { employee_id: THANDI_ROW.employee_id }, email: { sent: true } } as const;

/** Thandi's page (GET /v1/employees/{id}/verifications): Invited, nothing uploaded yet. */
export const helpThandiDetail = () => {
  const f = helpNewEmployeeForm();
  return {
    employee: {
      employee_id: THANDI_ROW.employee_id, first_name: f.firstName, last_name: f.lastName, email: f.email, phone: f.phone,
      department: f.department, job_title: f.jobTitle, step: 'INVITED', planned_start_date: f.startDate, hr_staff_name: HELP_HR_PERSON.name,
    },
    documents: [] as unknown[],
  };
};

/** Her invite link before and after Resend link. Fixed times, never the clock. */
export const HELP_INVITE = {
  sent: { status: 'ok', sentAt: '2026-03-02T09:00:00+02:00', expiresAt: '2026-03-09T09:00:00+02:00', sentTo: THANDI_ROW.email },
  resent: { status: 'ok', sentAt: '2026-03-02T09:05:00+02:00', expiresAt: '2026-03-09T09:05:00+02:00', sentTo: THANDI_ROW.email, email: { sent: true } },
} as const;
