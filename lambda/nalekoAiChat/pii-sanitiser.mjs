/**
 * NH-56: pii-sanitiser.mjs
 *
 * "Poor Man's Guardrail" — lightweight PII redaction applied to Claude's
 * final narrative response before it reaches Angular.
 *
 * Triggered because Bedrock Guardrails (NH-49) are unavailable in af-south-1.
 *
 * Patterns tuned for South African context:
 *   - SA ID numbers (13-digit YYMMDDSSSSCZZ format)
 *   - SA phone numbers (+27 or 0 prefix, 9 trailing digits)
 *   - Bank account numbers (8–11 digit sequences) with negative lookahead
 *     to exclude known employee ID format EMP-XXXXXXX and 7-char sequences
 *
 * NOTE: The bank account regex is intentionally broad. Log false positive rate
 * in production and tighten the lookahead if needed.
 */

export const PII_PATTERNS = [
  {
    // SA ID number: YYMMDD + 4 sequence digits + citizenship + checksum = 13 digits
    // Format: YYMMDDSSSSCZZ — e.g. 9001015009087
    name:        'SA_ID',
    regex:       /\b[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[0-9]{4}[0-9]{3}\b/g,
    replacement: '[SA-ID-REDACTED]',
  },
  {
    // SA mobile/landline: +27XXXXXXXXX or 0XXXXXXXXX (10 digits total with leading 0)
    // Using (?<!\w) instead of \b because \b does not match before '+' (non-word char)
    name:        'PHONE',
    regex:       /(?<!\w)(\+27|0)[0-9]{9}(?!\d)/g,
    replacement: '[PHONE-REDACTED]',
  },
  {
    // Bank account numbers: 8–11 contiguous digits
    // Negative lookahead: exclude sequences that are part of longer digit strings,
    // or that follow EMP- (employee IDs like EMP-0000012 are 7 digits, excluded).
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
 *   - `sanitised`:       The text with PII replaced.
 *   - `fired`:           `true` if at least one pattern matched.
 *   - `matchedPatterns`: Names of patterns that fired (for audit log).
 */
export function sanitisePii(text) {
  if (!text || typeof text !== 'string') {
    return { sanitised: text ?? '', fired: false, matchedPatterns: [] };
  }

  let result           = text;
  const matchedPatterns = [];

  for (const { name, regex, replacement } of PII_PATTERNS) {
    // Reset regex lastIndex between calls (global flag)
    regex.lastIndex = 0;
    if (regex.test(result)) {
      matchedPatterns.push(name);
    }
    // Reset again before replace (global regex state is mutated by test())
    regex.lastIndex = 0;
    result = result.replace(regex, replacement);
  }

  return {
    sanitised:       result,
    fired:           matchedPatterns.length > 0,
    matchedPatterns,
  };
}
