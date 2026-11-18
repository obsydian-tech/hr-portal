/**
 * When a new employee's required documents are due (ONB-10). One rule, one place: the employees list (HR home)
 * and the employee's own page both ask this module, so HR and the employee always see the same date.
 * Pure functions, no AWS call. Dates are calendar days as YYYY-MM-DD text, never a time of day.
 */

/** The default for every company: the documents are due this many days before the start date. */
export const DOCUMENTS_DUE_DAYS_BEFORE_START = 7;

/**
 * How many days before the start date a company's documents are due. There is no company setting yet
 * (the Admin epic adds one by changing this function only), so every company gets the default.
 */
export function dueDaysFor(_tenantId) {
  return DOCUMENTS_DUE_DAYS_BEFORE_START;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The calendar date as a UTC midnight, or null when the text is not a real date. */
function parseDay(text) {
  if (typeof text !== 'string') return null;
  const m = DAY.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/**
 * The date a person's required documents are due: the start date minus the company's days, as YYYY-MM-DD.
 * Null when there is no start date or it is not a real date. Never throws.
 */
export function documentsDueDate(plannedStartDate, tenantId) {
  const start = parseDay(plannedStartDate);
  if (!start) return null;
  start.setUTCDate(start.getUTCDate() - dueDaysFor(tenantId));
  return start.toISOString().slice(0, 10);
}
