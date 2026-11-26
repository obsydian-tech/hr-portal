/**
 * REC-06: the employee row an accepted offer makes, and the id it is made under.
 *
 * The row has the same attribute names, types and formats as the row createEmployee writes (ONB-03), plus one extra map,
 * from_recruitment. createEmployee itself is locked and is not edited; a test ties the two rows together. Only Node's own modules
 * and local files are imported, because the Lambda that uses this ships no packages.
 */
import { createHash } from 'node:crypto';
import { stampTenant } from './tenant.mjs';

/** D-REC-6.5: the fixed namespace of every employee id made from an offer. Never change it: the ids would change with it. */
export const EMPLOYEE_ID_NAMESPACE = '6b7dcfde-d603-4673-9949-d5d39ac59e17';

/** The version 5 UUID (RFC 4122, SHA-1) of `name` in `namespace`. */
export function uuid5(namespace, name) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** The one employee id of one offer of one company: a second write for the same offer lands on the same item. */
export const employeeIdOf = (tenantId, offerId) => uuid5(EMPLOYEE_ID_NAMESPACE, `${tenantId}:${offerId}`);

const text = (v) => (typeof v === 'string' ? v : '');
const lower = (v) => text(v).trim().toLowerCase();

/** The caller's staff number (custom:staff_id), else the sign-in's own id, as createEmployee does. */
export function staffIdOf(claims) {
  const staff = claims?.['custom:staff_id'];
  if (typeof staff === 'string' && staff !== '') return staff;
  return text(claims?.sub);
}

/**
 * The employee row (plain values, not yet marshalled). `candidate` is the saved candidate row, `role` the role row or null,
 * `department` the role's current department name or null. Nothing comes from the request. Never written: salary, scores, notes,
 * CV, ID number, interview or offer details, user_sub, sfn_task_token.
 */
export function buildEmployeeRow({ tenantId, offer, candidate, role, department, claims, at, confirmedStartDate }) {
  const staffId = staffIdOf(claims);
  const name = [claims?.given_name, claims?.family_name].filter((x) => typeof x === 'string' && x.trim() !== '').join(' ');
  return stampTenant({
    employee_id: employeeIdOf(tenantId, offer.offer_id),
    first_name: text(candidate.firstName),
    middle_name: '',
    last_name: text(candidate.lastName),
    email: lower(candidate.email),
    phone: text(candidate.phone),
    department: text(department) || text(role?.department) || text(candidate.department),
    job_title: text(role?.job_title) || text(candidate.positionTitle),
    stage: 'INVITED',
    offer_accept_date: at.slice(0, 10),
    planned_start_date: confirmedStartDate,
    created_at: at,
    created_by: staffId,
    hr_staff_id: staffId,
    hr_staff_name: name,
    hr_staff_email: text(claims?.email),
    from_recruitment: {
      candidate_id: offer.candidate_id,
      ...(candidate.role_id ?? offer.role_id ? { role_id: candidate.role_id ?? offer.role_id } : {}),
      offer_id: offer.offer_id,
    },
  }, tenantId);
}
