/**
 * What a document check is, shared by the Lambdas that list documents (ONB-12, ONB-13).
 * ONB-07 changed the rules here.
 */

/**
 * The caller's groups. API Gateway hands a list claim over as one string such as
 * "[hr_staff naleko-onboarding-hr]", so it is split into names (never a substring match).
 */
export function groupsOf(claims) {
  const raw = claims?.['cognito:groups'];
  const list = Array.isArray(raw) ? raw : String(raw ?? '').replace(/^\[|\]$/g, '').split(/[\s,]+/);
  return list.map((g) => String(g).trim()).filter(Boolean);
}

const STORED_CHECKS = ['MATCHES', 'NEEDS_A_LOOK', 'DOESNT_MATCH'];

/**
 * What the check on a document is, from what is stored (ONB-12 and ONB-07 specs).
 * 1. The verification's stored `check`, when it is one of the three.
 * 2. A verification without one (rows written before ONB-07): 90% or more matches, under 90 needs a look.
 * 3. No verification: still being read is reading; everything else, PASSED included, needs a look.
 *    A document without a check is never Matches.
 */
export function checkOf(doc, verification) {
  if (verification) {
    if (STORED_CHECKS.includes(verification.check)) return verification.check;
    return Number(verification.confidence) >= 90 ? 'MATCHES' : 'NEEDS_A_LOOK';
  }
  if (doc.ocr_status === 'PENDING' || doc.ocr_status === 'PROCESSING') return 'READING';
  return 'NEEDS_A_LOOK';
}

/** Lower case, accents removed, then only letters and digits: "van Wyk" equals "VAN WYK", "D'Almeida" equals "DALMEIDA". */
export function normaliseName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** A field the model could not read: missing, empty or NOT_FOUND. */
function notRead(value) {
  if (value === null || value === undefined) return true;
  const t = String(value).trim();
  return t === '' || t.toUpperCase() === 'NOT_FOUND';
}

/**
 * Batsi's check on a document just read (ONB-07 spec), worked out here and never by the model.
 * `read` holds documentType, skipped (AI skipped or switched off, or no result), confidence and the
 * fields the model read (idNumber, surname, accountHolder). `record` is the employee: last_name and,
 * when HR typed it, id_number_last4. It only labels the document; HR still decides every one.
 */
export function checkFromRead(read, record = {}) {
  if (!read || read.skipped) return 'NEEDS_A_LOOK';
  const confident = Number(read.confidence) >= 90;
  const lastName = normaliseName(record?.last_name);
  const last4 = String(record?.id_number_last4 ?? '').trim();

  if (read.documentType === 'NATIONAL_ID') {
    const idRead = !notRead(read.idNumber);
    const surnameRead = !notRead(read.surname);
    if (last4 && idRead && String(read.idNumber).replace(/\D/g, '').slice(-4) !== last4) return 'DOESNT_MATCH';
    if (lastName && surnameRead && normaliseName(read.surname) !== lastName) return 'DOESNT_MATCH';
    const agrees = lastName && surnameRead && (!last4 || idRead);
    return confident && agrees ? 'MATCHES' : 'NEEDS_A_LOOK';
  }

  if (read.documentType === 'BANK_CONFIRMATION') {
    const holderRead = !notRead(read.accountHolder);
    if (lastName && holderRead && !normaliseName(read.accountHolder).includes(lastName)) return 'DOESNT_MATCH';
    return confident && lastName && holderRead ? 'MATCHES' : 'NEEDS_A_LOOK';
  }

  // Matric and tertiary: nothing on the record to compare.
  return confident ? 'MATCHES' : 'NEEDS_A_LOOK';
}

/** HR's decision overwrites ocr_status with PASSED or FAILED, so only hr_reviewed_at tells it apart. */
export function hrDecisionOf(doc) {
  if (!doc.hr_reviewed_at) return null;
  if (doc.ocr_status === 'PASSED') return 'ACCEPTED';
  if (doc.ocr_status === 'FAILED') return 'NEW_ONE_ASKED';
  return null;
}
