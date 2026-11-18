/**
 * CHAT-05: the check rows of an answer, worked out from the turn's own tool results. Pure functions, no AWS call, no model call.
 */
import { requiredFor } from '../shared/required-documents.mjs';
import { redactNumbers } from '../shared/pii-redact.mjs';

const LABELS = {
  NATIONAL_ID: 'ID document',
  BANK_CONFIRMATION: 'Bank letter',
  MATRIC_CERTIFICATE: 'Matric certificate',
  TERTIARY_QUALIFICATION: 'Tertiary qualifications',
};
const ORDER = Object.keys(LABELS);
const RESULTS = { MATCHES: 'Matches', NEEDS_A_LOOK: 'Needs a look', DOESNT_MATCH: "Doesn't match", READING: 'Being checked' };
const MISSING = 'Missing';

function isNewer(a, b) {
  const ta = Date.parse(a.arrived_at ?? '');
  const tb = Date.parse(b.arrived_at ?? '');
  const na = Number.isFinite(ta) ? ta : -Infinity;
  const nb = Number.isFinite(tb) ? tb : -Infinity;
  if (na !== nb) return na > nb;
  return String(a.document_id ?? '') > String(b.document_id ?? '');
}

export function checksOf(toolCallsMade) {
  const calls = (toolCallsMade ?? []).filter((c) => c.toolName === 'list_verifications' && !c.isError && typeof c.toolArgs?.employee_id === 'string' && c.toolArgs.employee_id !== '');
  const people = new Set(calls.map((c) => c.toolArgs.employee_id));
  if (people.size !== 1) return undefined;
  const documents = calls[calls.length - 1].result?.documents;
  if (!Array.isArray(documents)) return undefined;

  const newest = new Map();
  for (const d of documents) {
    if (!(d?.document_type in LABELS)) continue;
    const had = newest.get(d.document_type);
    if (!had || isNewer(d, had)) newest.set(d.document_type, d);
  }
  const required = requiredFor(null);
  const types = [...required, ...ORDER.filter((t) => !required.includes(t))];
  const rows = [];
  for (const type of types) {
    const d = newest.get(type);
    if (!d && !required.includes(type)) continue;
    rows.push({ label: redactNumbers(LABELS[type]), result: redactNumbers(d ? (RESULTS[d.check] ?? RESULTS.NEEDS_A_LOOK) : MISSING) });
  }
  return rows;
}
