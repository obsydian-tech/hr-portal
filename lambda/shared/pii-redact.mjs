/**
 * PII-01: take numbers out of text before it is sent to a model. Pure functions, no AWS call.
 *
 * The rule: any run of six or more digits is replaced, where up to three characters that are neither a letter nor a digit
 * may sit between two digits (spaces, dashes of every kind, dots, slashes, commas, line breaks, zero-width and direction
 * marks). Digits are Unicode digits, so full-width and Arabic-Indic digits count. A gap of four or more characters between
 * two groups is a column gap and is not joined. Dates written with digits only are removed too: over-removing is the safe side.
 *
 * Linear time: the only characters that can sit between two digits are non-digits, so each step has one way forward.
 */

/** What replaces a number. One constant, so the word can change in one place. */
export const REPLACEMENT = '[removed]';

/** The one rule both functions use. Never use it with `.test` or `.exec` directly: it keeps `lastIndex` (global flag). */
export const NUMBER_RUN = /(?<!\p{Nd})\+?\p{Nd}(?:[^\p{L}\p{Nd}]{0,3}\p{Nd}){5,}(?!\p{Nd})/gu;

/** Passport-like: one or two capital letters then six to nine digits. */
const PASSPORT_LIKE = /\b[A-Z]{1,2}\d{6,9}\b/g;

/** Text with every number run and passport-like code replaced. A non-string gives ''. */
export function redactNumbers(text) {
  if (typeof text !== 'string') return '';
  return text.replace(NUMBER_RUN, REPLACEMENT).replace(PASSPORT_LIKE, REPLACEMENT);
}

/**
 * True if the digit rule still matches. It uses the wide rule on its own, so it is never weaker than the redactor: it is the
 * last check on a finished prompt. `search` ignores the global flag and `lastIndex`, so repeat calls always agree.
 */
export function hasNumberRun(text) {
  if (typeof text !== 'string') return false;
  return text.search(NUMBER_RUN) !== -1;
}
