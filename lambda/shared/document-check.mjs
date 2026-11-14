/**
 * What a document check is, shared by the Lambdas that list documents (ONB-12, ONB-13).
 * ONB-07 changes the rules here only.
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

/**
 * What the check on a document is, from what is stored (ONB-12 spec).
 * A verification at 90% or more matches; under 90 needs a look; a file that could not be read needs a look;
 * a file still being read is being checked.
 */
export function checkOf(doc, verification) {
  if (verification) return Number(verification.confidence) >= 90 ? 'MATCHES' : 'NEEDS_A_LOOK';
  if (doc.ocr_status === 'FAILED' || doc.ocr_status === 'MANUAL_REVIEW') return 'NEEDS_A_LOOK';
  if (doc.ocr_status === 'PASSED') return 'MATCHES';
  return 'READING';
}

/** HR's decision overwrites ocr_status with PASSED or FAILED, so only hr_reviewed_at tells it apart. */
export function hrDecisionOf(doc) {
  if (!doc.hr_reviewed_at) return null;
  if (doc.ocr_status === 'PASSED') return 'ACCEPTED';
  if (doc.ocr_status === 'FAILED') return 'NEW_ONE_ASKED';
  return null;
}
