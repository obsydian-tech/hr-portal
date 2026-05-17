/**
 * AI-002 / NH-128: pii-sanitiser.mjs
 *
 * "Poor Man's Guardrail" — lightweight PII redaction applied to Claude's
 * final narrative response before it reaches Angular.
 *
 * Triggered because Bedrock Guardrails are unavailable in af-south-1.
 *
 * Patterns tuned for South African context:
 *   - SA ID numbers (13-digit YYMMDDSSSSCZZ format)
 *   - SA phone numbers (+27 or 0 prefix, 9 trailing digits)
 *   - Bank account numbers (8–11 digit sequences) with negative lookahead
 *     to exclude known employee ID format EMP-XXXXXXX and 7-char sequences
 */

export const PII_PATTERNS = [
  {
    // SA ID number: YYMMDD + 4 sequence digits + citizenship + checksum = 13 digits
    name:        'SA_ID',
    regex:       /\b[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[0-9]{4}[0-9]{3}\b/g,
    replacement: '[SA-ID-REDACTED]',
  },
  {
    // SA mobile/landline: +27XXXXXXXXX or 0XXXXXXXXX (10 digits total with leading 0)
    name:        'PHONE',
    regex:       /(?<!\w)(\+27|0)[0-9]{9}(?!\d)/g,
    replacement: '[PHONE-REDACTED]',
  },
  {
    // Bank account numbers: 8–11 contiguous digits
    name:        'BANK_ACCOUNT',
    regex:       /(?<!EMP-)\b[0-9]{8,11}\b(?![0-9])/g,
    replacement: '[ACCOUNT-REDACTED]',
  },
];

/**
 * Sanitise PII from a text string by applying all PII_PATTERNS in sequence.
 *
 * @param {string} text  The raw text from Claude's response.
 * @returns {{ sanitised: string, fired: boolean, matchedPatterns: string[] }}
 */
export function sanitisePii(text) {
  if (!text || typeof text !== 'string') {
    return { sanitised: text ?? '', fired: false, matchedPatterns: [] };
  }

  let result            = text;
  const matchedPatterns = [];

  for (const { name, regex, replacement } of PII_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(result)) {
      matchedPatterns.push(name);
    }
    regex.lastIndex = 0;
    result = result.replace(regex, replacement);
  }

  return {
    sanitised:       result,
    fired:           matchedPatterns.length > 0,
    matchedPatterns,
  };
}
