/**
 * ONB-06: what an employee may upload and how the file is named in S3, for createMyUploadLink.
 * Pure functions, no AWS call. generateDocumentUploadUrl (the old route) does not use this file.
 */

/** The four documents, in the order the checklist shows them. */
export const DOCUMENT_TYPES = Object.freeze(['NATIONAL_ID', 'BANK_CONFIRMATION', 'MATRIC_CERTIFICATE', 'TERTIARY_QUALIFICATION']);

/** What the person's phone may send: a PDF, a JPEG or a PNG. */
export const ALLOWED_CONTENT_TYPES = Object.freeze(['application/pdf', 'image/jpeg', 'image/png']);

/** 10 MB (W-1), counted as 10 x 1,048,576 bytes. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** How long the signed link works, in seconds (15 minutes). */
export const LINK_EXPIRES_IN = 900;

const MAX_KEY_NAME = 100;
const MAX_SHOWN_NAME = 200;

/**
 * The part of the S3 key that comes from the file name: the extension is kept, every character outside
 * A-Z a-z 0-9 . _ - becomes an underscore, at most 100 characters, never empty. The key then always has
 * exactly four "/" parts, which is what processDocumentOCR reads.
 */
export function cleanFileName(name) {
  const cleaned = String(name ?? '').replace(/[^A-Za-z0-9._-]/g, '_');
  if (cleaned === '') return 'file';
  if (cleaned.length <= MAX_KEY_NAME) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 11 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, MAX_KEY_NAME - ext.length) + ext;
}

/** The name shown to the person later: as given, cut to 200 characters. */
export function shownFileName(name) {
  return String(name ?? '').slice(0, MAX_SHOWN_NAME);
}

/** uploads/<employee_id>/<type>/<document_id>_<cleaned name> */
export function uploadKey(employeeId, documentType, documentId, fileName) {
  return `uploads/${employeeId}/${documentType}/${documentId}_${cleanFileName(fileName)}`;
}

const ALLOWED_WORDS = 'Allowed: PDF, JPG or PNG up to 10 MB.';

/**
 * Checks the request body. Returns { ok: true, value } or { ok: false, error } where error is the words for a 400.
 * `raw` is the parsed JSON (anything), never trusted.
 */
export function checkBody(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Missing required fields: documentType, fileName, contentType, fileSize' };
  }
  const missing = (v) => v === undefined || v === null || v === '';
  const absent = ['documentType', 'fileName', 'contentType', 'fileSize'].filter((k) => missing(raw[k]));
  if (absent.length > 0) return { ok: false, error: `Missing required fields: ${absent.join(', ')}` };

  const { documentType, fileName, contentType, fileSize } = raw;
  if (typeof documentType !== 'string' || !DOCUMENT_TYPES.includes(documentType)) {
    return { ok: false, error: `documentType must be one of: ${DOCUMENT_TYPES.join(', ')}` };
  }
  if (typeof fileName !== 'string') return { ok: false, error: 'fileName must be text' };
  if (typeof contentType !== 'string' || !ALLOWED_CONTENT_TYPES.includes(contentType)) {
    return { ok: false, error: `Unsupported contentType. ${ALLOWED_WORDS} Allowed types: ${ALLOWED_CONTENT_TYPES.join(', ')}` };
  }
  if (typeof fileSize !== 'number' || !Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_FILE_SIZE) {
    return { ok: false, error: `fileSize must be a whole number of bytes from 1 to ${MAX_FILE_SIZE} (10 MB)` };
  }
  return { ok: true, value: { documentType, fileName, contentType, fileSize } };
}

/** Reads the event body as JSON (API Gateway may send it base64-encoded). Returns { ok, value } or { ok: false }. */
export function parseBody(event) {
  let text = event?.body;
  if (text === undefined || text === null || text === '') return { ok: true, value: undefined };
  if (typeof text !== 'string') return { ok: false };
  if (event.isBase64Encoded) {
    try { text = Buffer.from(text, 'base64').toString('utf8'); } catch { return { ok: false }; }
  }
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
}
