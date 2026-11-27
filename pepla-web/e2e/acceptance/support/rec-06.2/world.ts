import { createHash } from 'node:crypto';
import { EMPLOYEE } from '../onb-03/lambda-harness';
import { HR, ROBOT_HR, member, row, worldWithPool, type Row, type World18 } from '../onb-18/lambda-harness';
import type { Who } from './lambda-harness';

/**
 * REC-06.2: the people and rows the Lambda tests use. Two companies (A and B), HR of each, and for each a person hired through Recruitment
 * (a `from_recruitment` map, stage INVITED, no sign-in, no invite) and a person added by hand in Onboarding (no `from_recruitment`).
 * Every name and address is made up. Company comes only from the caller's token (tenant_id claim) and the row's own tenant_id.
 */
export const A = 'ten_' + 'a'.repeat(26);
export const B = 'ten_' + 'b'.repeat(26);

export const HR_A: Who = { caller: HR, tenant: A };
export const HR_B: Who = { caller: { ...HR, email: 'bongani.hr@company-b.example', staffId: 'HRB001', givenName: 'Bongani', familyName: 'Hr' }, tenant: B };
export const ROBOT_HR_A: Who = { caller: ROBOT_HR, tenant: A };
export const EMPLOYEE_A: Who = { caller: EMPLOYEE, tenant: A };

export const IDS = {
  hireA: '5f1c0a9e-7f3b-4c2a-9e1d-2b6f8a4c3e01',
  handA: '5f1c0a9e-7f3b-4c2a-9e1d-2b6f8a4c3e02',
  hireB: '5f1c0a9e-7f3b-4c2a-9e1d-2b6f8a4c3e03',
};
export const PEOPLE = {
  hireA: { first: 'Naledi', last: 'Dlamini', email: 'naledi.dlamini@private-mail.example', phone: '082 555 0199' },
  handA: { first: 'Sipho', last: 'Khumalo', email: 'sipho.khumalo@private-mail.example', phone: '082 555 0123' },
  hireB: { first: 'Thandeka', last: 'Ngwenya', email: 'thandeka.ngwenya@company-b.example', phone: '082 555 0177' },
  /** A test address: a robot (blackhole), so no email goes out. */
  robot: { first: 'Rob', last: 'Ot', email: 'e2e.run-rec062-0001@blackhole.postmarkapp.com', phone: '000 000 0000' },
};

export type Person = { id: string; first: string; last: string; email: string; phone: string };

/** The row a person hired through Recruitment has (lambda/shared/employee-row.mjs): stage INVITED, a from_recruitment MAP, no user_sub, no sfn_task_token. */
export function recruitmentHire(p: Person, tenant: string, over: Record<string, string> = {}, fromRecruitment: Record<string, string> | null = { candidate_id: 'CAND-REC062-0001', role_id: 'role-rec062-0001', offer_id: 'offer-rec062-0001' }): Row {
  const r = row({
    employee_id: p.id, first_name: p.first, middle_name: '', last_name: p.last, email: p.email, phone: p.phone, department: 'Operations', job_title: 'Junior baker',
    stage: 'INVITED', offer_accept_date: '2026-11-20', planned_start_date: '2026-12-01', created_at: '2026-11-20T08:00:00.000Z', created_by: 'E2EHR01', hr_staff_id: 'E2EHR01',
    hr_staff_name: 'Jane Smith', hr_staff_email: 'jane.smith@mokoena-logistics.co.za', tenant_id: tenant, ...over,
  });
  if (fromRecruitment) r['from_recruitment'] = { M: Object.fromEntries(Object.entries(fromRecruitment).map(([k, v]) => [k, { S: v }])) };
  return r;
}

/** The row of a person added by hand in Onboarding (createEmployee): the same fields, no from_recruitment. */
export const handAdded = (p: Person, tenant: string, over: Record<string, string> = {}): Row => recruitmentHire(p, tenant, over, null);

export const person = (key: keyof typeof PEOPLE, id: string): Person => ({ id, ...PEOPLE[key] });

/** A world with HR of A and of B in the pool, and these rows in the employees table. */
export function worldWith(rows: Row[], extra: Partial<World18> = {}): World18 {
  const w = worldWithPool();
  w.cognito.users.push(member('Bongani', 'Hr', { staffId: 'HRB001', email: HR_B.caller.kind === 'jwt' ? HR_B.caller.email : '' }));
  w.tables.employees.push(...rows);
  const { cognito, ...others } = extra;
  if (cognito) w.cognito.users.push(...cognito.users);
  return { ...w, ...others };
}

export const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
