// PII-01 harness only: a broken stand-in for lambda/shared/pii-redact.mjs (miss12). Never in a build.
const REAL = process.env.PII01_REAL_REDACTOR + '?real';
const real = await import(REAL);
// Misses every run shorter than 13 digits (what a regex written for IDs only does).
export const redactNumbers = (t) => (typeof t === 'string' ? t.replace(/\d{13,}/g, '[removed]') : '');
export const hasNumberRun = real.hasNumberRun;
export const NUMBER_RUN = real.NUMBER_RUN;
