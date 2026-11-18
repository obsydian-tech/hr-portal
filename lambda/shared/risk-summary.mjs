/**
 * ONB-11: what the risk check sends to the model, and how the flow's call is recognised. Pure functions, no AWS call.
 *
 * Security (ONB-11 security review, F-1): the stored `documentType` comes from an S3 key an employee can influence, so
 * nothing stored goes into the prompt as free text. Every value is turned into one of a few fixed words or a number.
 * No name, email, ID number, account detail, file name, employee id or company id is ever put in.
 */
import { DOCUMENT_TYPES } from './upload-link.mjs';

/** The `source` Step Functions sends on the flow's call. */
export const FLOW_SOURCE = 'naleko.onboarding-flow';

const DECISIONS = Object.freeze(['PASSED', 'FAILED', 'MANUAL_REVIEW', 'PENDING']);
const CHECKS = Object.freeze(['MATCHES', 'NEEDS_A_LOOK', 'DOESNT_MATCH']);

/**
 * The flow entry: no requestContext at all (API Gateway and the Agent API always set one), the exact source, and a
 * text employee id. Nothing else decides it, so a marker in a body, path, query or header never counts.
 */
export function isFlowEvent(event) {
  if (!event || typeof event !== 'object') return false;
  if ('requestContext' in event) return false;
  return event.source === FLOW_SOURCE && typeof event.employeeId === 'string' && event.employeeId !== '';
}

const safeType = (t) => (DOCUMENT_TYPES.includes(t) ? t : 'OTHER');
const safeDecision = (d) => (DECISIONS.includes(d) ? d : 'PENDING');
const safeCheck = (c) => (CHECKS.includes(c) ? c : 'NEEDS_A_LOOK');
/** Confidence is a percentage (0 to 100) or nothing. */
const safeConfidence = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null);

/** Newer first: the larger createdAt; a tie goes to the larger verificationId. */
function isNewer(a, b) {
  const ta = String(a.createdAt ?? '');
  const tb = String(b.createdAt ?? '');
  if (ta !== tb) return ta > tb;
  return String(a.verificationId ?? '') > String(b.verificationId ?? '');
}

/**
 * rows: plain verification rows { documentType, decision, check, confidence, hasExtractedData, createdAt, verificationId }.
 * required: the document types HR needs in. Returns one entry per type, the newest copy only, then MISSING for each
 * required type with no row.
 */
export function summaryOf(rows, required) {
  const newest = new Map();
  for (const row of rows ?? []) {
    const type = safeType(row.documentType);
    const at = newest.get(type);
    if (!at || isNewer(row, at)) newest.set(type, row);
  }
  const order = [...DOCUMENT_TYPES, 'OTHER'];
  const entries = order.filter((t) => newest.has(t)).map((t) => {
    const r = newest.get(t);
    return {
      documentType: t,
      decision: safeDecision(r.decision),
      check: safeCheck(r.check),
      ocrConfidence: safeConfidence(r.confidence),
      hasExtractedData: r.hasExtractedData === true,
    };
  });
  for (const t of required ?? []) {
    if (!newest.has(t)) entries.push({ documentType: safeType(t), decision: 'MISSING' });
  }
  return entries;
}

/** The prompt text. Internal: nobody reads it. The reply format stays {"risk":"LOW|MEDIUM|HIGH","reason":"..."}. */
export function buildPrompt(summary) {
  return [
    'You are an HR onboarding risk classifier.',
    'Classify the overall onboarding risk for this new employee as LOW, MEDIUM, or HIGH based solely on the list of documents below.',
    'Each entry has a documentType, a decision and a check. The decision is what HR has decided so far (MANUAL_REVIEW means HR has not decided yet). The check is what an automatic comparison found: MATCHES, NEEDS_A_LOOK or DOESNT_MATCH.',
    'Nothing is passed until HR decides, so MANUAL_REVIEW is normal and is not a risk by itself. Judge by the check and the confidence.',
    'A document with decision MISSING has not been uploaded. MISSING is a risk.',
    'LOW means every check matches with high confidence. MEDIUM means some checks need a look or have low confidence. HIGH means checks do not match or documents are missing.',
    'Return ONLY valid JSON with no markdown, no code blocks, no extra text: {"risk":"LOW","reason":"one sentence explanation"}',
    '',
    `Documents: ${JSON.stringify(summary)}`,
  ].join('\n');
}
