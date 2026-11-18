/**
 * Which documents a new employee must have accepted before they are Verified (ONB-08).
 * One list and one rule, shared by the Lambdas that decide or show it. Pure functions, no AWS call.
 * Rows are plain objects (already unmarshalled): { document_type, document_id, ocr_status, hr_reviewed_at, upload_timestamp }.
 */

/** The default for every company: the National ID and the Bank confirmation. */
export const REQUIRED_DOCUMENT_TYPES = Object.freeze(['NATIONAL_ID', 'BANK_CONFIRMATION']);

/**
 * The required types for a company. There is no company setting yet (the Admin epic adds one),
 * so every company gets the default, whatever the value is.
 */
export function requiredFor(_company) {
  return [...REQUIRED_DOCUMENT_TYPES];
}

/** A row where a file was read: PENDING means an upload link was made and no file was read. */
const isRead = (doc) => doc?.ocr_status !== 'PENDING';

/** Accepted by HR: PASSED with a decision time. An old auto-pass has no `hr_reviewed_at`. */
const acceptedByHr = (doc) => doc?.ocr_status === 'PASSED' && !!doc?.hr_reviewed_at;

/** When the row was uploaded, in ms: its `upload_timestamp` (ISO text or a number), else the number in `doc_<ms>`. */
function uploadedAt(doc) {
  const raw = doc?.upload_timestamp;
  if (raw !== undefined && raw !== null && raw !== '') {
    const ms = typeof raw === 'number' ? raw : (/^\d+$/.test(String(raw)) ? Number(raw) : Date.parse(String(raw)));
    if (Number.isFinite(ms)) return ms;
  }
  const fromId = Number(String(doc?.document_id ?? '').replace(/^doc_/, ''));
  return Number.isFinite(fromId) ? fromId : 0;
}

/** Newer first: the larger upload time; ties go to the larger document_id. */
export function isNewer(a, b) {
  const ta = uploadedAt(a);
  const tb = uploadedAt(b);
  if (ta !== tb) return ta > tb;
  return String(a?.document_id ?? '') > String(b?.document_id ?? '');
}

/** True when the newest read upload of this type is accepted by HR. */
export function requiredDone(docs, type) {
  let newest = null;
  for (const doc of docs ?? []) {
    if (doc?.document_type !== type || !isRead(doc)) continue;
    if (newest === null || isNewer(doc, newest)) newest = doc;
  }
  return newest !== null && acceptedByHr(newest);
}

/** Required types not yet done, in the order of the list. */
export function requiredMissing(docs, required = REQUIRED_DOCUMENT_TYPES) {
  return required.filter((type) => !requiredDone(docs, type));
}

/** True when every required type is done. */
export function verifiedReady(docs, required = REQUIRED_DOCUMENT_TYPES) {
  return requiredMissing(docs, required).length === 0;
}

/** True when the newest read upload of this type is not sent back: being read, waiting for HR, or accepted (ONB-09). */
export function requiredIn(docs, type) {
  let newest = null;
  for (const doc of docs ?? []) {
    if (doc?.document_type !== type || !isRead(doc)) continue;
    if (newest === null || isNewer(doc, newest)) newest = doc;
  }
  return newest !== null && newest.ocr_status !== 'FAILED';
}

/** True when every required type is in (ONB-09). */
export function allRequiredIn(docs, required = REQUIRED_DOCUMENT_TYPES) {
  return required.every((type) => requiredIn(docs, type));
}
