/**
 * CHAT-09: everything about one person that the person page shows, for Batsi (the model) after get_employee.
 * Built from get_employee's raw answer and one more Agent API call (CHAT-05's per-person documents). Page words only.
 */
import { requiredFor } from '../shared/required-documents.mjs';
import { daysBetween, todayInJohannesburg, writtenDate } from '../shared/due-date.mjs';

export const STEP_WORDS = Object.freeze({ INVITED: 'Invited', DOCUMENTS: 'Documents', IN_REVIEW: 'In review', VERIFIED: 'Verified' });
const DOC_WORDS = Object.freeze({ NATIONAL_ID: 'ID document', BANK_CONFIRMATION: 'Bank letter', MATRIC_CERTIFICATE: 'Matric certificate', TERTIARY_QUALIFICATION: 'Tertiary qualifications' });
const CHECK_WORDS = Object.freeze({ MATCHES: 'Matches', NEEDS_A_LOOK: 'Needs a look', DOESNT_MATCH: "Doesn't match", READING: 'Being checked' });
const DECISION_WORDS = Object.freeze({ ACCEPTED: 'Accepted', NEW_ONE_ASKED: 'New one asked for' });
const RISK_WORDS = Object.freeze({ LOW: 'Batsi rated the risk low', MEDIUM: 'Batsi rated the risk medium', HIGH: 'Batsi rated the risk high', UNKNOWN: 'Batsi could not check the risk' });
export const MISSING = 'Missing';
export const NOT_DECIDED = 'Not decided';

const dayOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

/** HR home's overdue rule: step Invited or Documents and the due date before today. */
export function overdue(stepCode, due, today) {
  return (stepCode === 'INVITED' || stepCode === 'DOCUMENTS') && !!due && daysBetween(today, due) < 0;
}

function rowsOf(docs, required) {
  const newest = new Map();
  for (const d of docs) {
    const prev = newest.get(d.document_type);
    if (!prev || String(d.arrived_at ?? '') > String(prev.arrived_at ?? '')) newest.set(d.document_type, d);
  }
  const row = (type, isRequired) => {
    const d = newest.get(type);
    if (!d) return { document: DOC_WORDS[type], required: isRequired, check: MISSING, hr_decision: '', uploaded_written: '', decided_written: '' };
    return {
      document: DOC_WORDS[type], required: isRequired, check: CHECK_WORDS[d.check] ?? CHECK_WORDS.NEEDS_A_LOOK,
      hr_decision: DECISION_WORDS[d.hr_decision] ?? NOT_DECIDED, uploaded_written: writtenDate(dayOf(d.arrived_at)), decided_written: writtenDate(dayOf(d.hr_decided_at)),
    };
  };
  const out = required.filter((t) => DOC_WORDS[t]).map((t) => row(t, true));
  for (const d of docs) {
    if (required.includes(d.document_type) || !DOC_WORDS[d.document_type]) continue;
    if (out.some((r) => r.document === DOC_WORDS[d.document_type])) continue;
    out.push(row(d.document_type, false));
  }
  return out;
}

/** The facts the model gets for one person. `getDocuments(id)` is the per-person documents call; a failure leaves documents unknown. */
export async function personFacts(raw, getDocuments, now = new Date()) {
  const e = raw?.employee ?? {};
  const today = todayInJohannesburg(now);
  const stepCode = e.step ?? null;
  const step = STEP_WORDS[stepCode] ?? null;
  const start = dayOf(e.planned_start_date);
  const due = dayOf(e.documents_due);
  let documents = null;
  try {
    const answer = await getDocuments(e.employee_id);
    documents = rowsOf(Array.isArray(answer?.documents) ? answer.documents : [], requiredFor());
  } catch {
    documents = null;
  }
  const verified = stepCode === 'VERIFIED';
  const because = [];
  if (!(verified && start)) {
    if (documents) {
      for (const r of documents.filter((x) => x.required && x.hr_decision !== DECISION_WORDS.ACCEPTED)) {
        because.push(r.check === MISSING ? `${r.document}: ${MISSING}` : `${r.document}: ${r.check}, HR decision: ${r.hr_decision}`);
      }
    } else if (!verified) because.push('Documents could not be read');
    if (!start) because.push('Start date not set');
  }
  const days = start ? daysBetween(today, start) : null;
  return {
    name: [e.first_name, e.last_name].filter(Boolean).join(' ').trim(),
    email: e.email ?? '',
    department: e.department ?? '',
    job_title: e.job_title ?? '',
    hr_partner: e.hr_staff_name ?? '',
    step,
    start, start_written: writtenDate(start),
    due, due_written: writtenDate(due),
    risk: { result: RISK_WORDS[e.risk_band] ?? 'Not assessed', reason: e.risk_band ? (e.risk_reason ?? '') : '', assessed_written: writtenDate(dayOf(e.risk_assessed_at)) },
    documents,
    ...(documents === null ? { documents_unknown: true } : {}),
    ready_to_start: verified && start ? 'yes' : 'no',
    because,
    days_until_start: Number.isFinite(days) ? days : null,
    documents_overdue: overdue(stepCode, due, today),
  };
}
