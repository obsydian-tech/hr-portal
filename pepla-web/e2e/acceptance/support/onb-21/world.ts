import { row, type Row, type Tables, REMINDERS, TENANTS } from './runner';
import type { DocType } from './words';

/**
 * ONB-21: the world the reminder run reads. Two companies with the Onboarding module (A and B), the people of each, their
 * documents and an empty claims table; the company list also holds rows that are not companies (a member row, a pending
 * move row), which the run must not take for one. Every name and address is made up, none is real.
 *
 * Dates: a person who starts on 2026-12-01 has their documents due on 2026-11-24 (7 days before, ONB-10's rule), so the
 * reminder window is 2026-11-22 to 2026-11-24 (2 days before the due date up to and including it).
 */
export const A = 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa';
export const B = 'ten_bbbbbbbbbbbbbbbbbbbbbbbbbb';
/** No Onboarding module. */
export const C = 'ten_cccccccccccccccccccccccccc';
/** Has the module but is not ACTIVE. */
export const D = 'ten_dddddddddddddddddddddddddd';
/** Not a company id (it is not `ten_` and 26 lowercase letters or digits). */
export const NOT_AN_ID = 'ten_NOT-A-VALID-COMPANY-ID';

export const START = '2026-12-01';
export const DUE = '2026-11-24';
/** 08:00 in South Africa on that day. */
export const at = (date: string, time = '08:00') => `${date}T${time}:00+02:00`;

export const ID_NUMBER_LAST4 = '5800';
export const ACCOUNT_NUMBER = '62845519023';
export const HR_NAME = 'Jane Smith';
export const HR_EMAIL = 'jane.smith@mokoena-logistics.example';

export type Person = { id: string; first: string; last: string; email: string };
export const P = {
  naledi: { id: 'EMP-2101', first: 'Naledi', last: 'Dlamini', email: 'naledi.dlamini@kestrel.example' },
  sipho: { id: 'EMP-2102', first: 'Sipho', last: 'Nkosi', email: 'sipho.nkosi@kestrel.example' },
  thandi: { id: 'EMP-2103', first: 'Thandi', last: 'Zulu', email: 'thandi.zulu@kestrel.example' },
  lebo: { id: 'EMP-2104', first: 'Lebo', last: 'Mokoena', email: 'lebo.mokoena@kestrel.example' },
  bongani: { id: 'EMP-2201', first: 'Bongani', last: 'Ndlovu', email: 'bongani.ndlovu@baobab.example' },
  zanele: { id: 'EMP-2202', first: 'Zanele', last: 'Khumalo', email: 'zanele.khumalo@baobab.example' },
} satisfies Record<string, Person>;

type Over = Record<string, string | number | boolean | undefined | null>;

/** A company row of the company list: pk TENANT#<id>, sk PROFILE. */
/** `modules` null leaves the modules attribute out (a row with no modules). */
export function company(id: string, over: Over = {}, modules: string[] | null = ['onboarding', 'recruitment']): Row {
  const r = row({ pk: `TENANT#${id}`, sk: 'PROFILE', tenant_id: id, name: `Company ${id.slice(4, 5).toUpperCase()}`, status: 'ACTIVE', ...over });
  if (modules) r['modules'] = { SS: modules };
  return r;
}

/** An employee row, at step DOCUMENTS with a start date of 2026-12-01 unless the test says otherwise. */
export function person(p: Person, tenant: string | undefined, over: Over = {}): Row {
  return row({
    employee_id: p.id,
    first_name: p.first,
    last_name: p.last,
    email: p.email,
    phone: '000 000 0000',
    department: 'Operations',
    position: 'Junior baker',
    planned_start_date: START,
    stage: 'ACTIVE',
    step: 'DOCUMENTS',
    // What a reminder must never carry (AC-6): the ID number, the account number, who HR is.
    id_number_last4: ID_NUMBER_LAST4,
    id_number_encrypted: 'kms:9803145800876',
    bank_account_number: ACCOUNT_NUMBER,
    hr_staff_name: HR_NAME,
    hr_staff_email: HR_EMAIL,
    created_at: '2026-11-10T08:00:00.000Z',
    ...(tenant ? { tenant_id: tenant } : {}),
    ...over,
  });
}

/** What a documents row is, as the checklist reads it (the `counts` rule of getMyDocuments). */
export type DocState =
  /** A file was read and waits for HR. */
  | 'WITH_HR'
  /** HR accepted it. */
  | 'ACCEPTED'
  /** The reader is still on it: a file arrived. */
  | 'READING'
  /** HR sent it back. */
  | 'SENT_BACK'
  /** An upload link was made and no file came: not uploaded. */
  | 'LINK_ONLY'
  /** An upload link was made and the reader has started on a file: a file arrived. */
  | 'LINK_STARTED'
  /** An upload link was made and the reader finished: a file arrived. */
  | 'LINK_DONE';

const STATE: Record<DocState, Over> = {
  WITH_HR: { ocr_status: 'MANUAL_REVIEW', ocr_completed_at: '2026-11-12T08:02:00.000Z' },
  ACCEPTED: { ocr_status: 'PASSED', ocr_completed_at: '2026-11-12T08:02:00.000Z', hr_reviewed_at: '2026-11-12T09:00:00.000Z' },
  READING: { ocr_status: 'PROCESSING', ocr_started_at: '2026-11-12T08:01:00.000Z' },
  SENT_BACK: { ocr_status: 'FAILED', ocr_completed_at: '2026-11-12T08:02:00.000Z', hr_reviewed_at: '2026-11-12T09:00:00.000Z' },
  LINK_ONLY: { ocr_status: 'PENDING' },
  LINK_STARTED: { ocr_status: 'PENDING', ocr_started_at: '2026-11-12T08:01:00.000Z' },
  LINK_DONE: { ocr_status: 'PENDING', ocr_completed_at: '2026-11-12T08:02:00.000Z' },
};

let docCounter = 0;
/** One documents row of a person. */
export function doc(p: Person, type: DocType, state: DocState, tenant: string | undefined, over: Over = {}): Row {
  docCounter += 1;
  return row({
    employee_id: p.id,
    document_id: `doc_${1763800000000 + docCounter}`,
    document_type: type,
    file_name: `${type.toLowerCase()}.pdf`,
    upload_timestamp: '2026-11-12T08:00:00.000Z',
    ...STATE[state],
    ...(tenant ? { tenant_id: tenant } : {}),
    ...over,
  });
}

/** The tables of one run. Rows that are not companies sit in the company list on purpose. */
export function world(w: { companies?: Row[]; people?: Row[]; docs?: Row[]; claims?: Row[] } = {}): Tables {
  return {
    employees: w.people ?? [],
    documents: w.docs ?? [],
    [TENANTS]: [
      ...(w.companies ?? [company(A), company(B)]),
      // Member rows and TEN-06's pending-move rows share the table with the companies.
      row({ pk: 'USER#sub-hr-a', sk: `TENANT#${A}`, tenant_id: A }),
      row({ pk: 'USER#sub-hr-b', sk: `TENANT#${B}`, tenant_id: B }),
      row({ pk: 'MIGRATE#old.person@elsewhere.example', sk: 'PENDING', tenant_id: A }),
    ],
    [REMINDERS]: w.claims ?? [],
  };
}

/** Company A with one person who owes both required documents. */
export const oneDue = (p: Person = P.naledi, over: Over = {}) => world({ people: [person(p, A, over)] });
