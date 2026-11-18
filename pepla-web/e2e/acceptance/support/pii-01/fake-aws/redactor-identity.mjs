// PII-01 harness only: a broken stand-in for lambda/shared/pii-redact.mjs (identity). Never in a build.
const REAL = process.env.PII01_REAL_REDACTOR + '?real';
const real = await import(REAL);
export const redactNumbers = (t) => (typeof t === 'string' ? t : '');
export const hasNumberRun = real.hasNumberRun;
export const NUMBER_RUN = real.NUMBER_RUN;
