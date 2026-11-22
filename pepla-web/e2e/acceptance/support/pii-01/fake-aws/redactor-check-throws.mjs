// PII-01 harness only: a broken stand-in for lambda/shared/pii-redact.mjs (check-throws). Never in a build.
const REAL = process.env.PII01_REAL_REDACTOR + '?real';
const real = await import(REAL);
export const redactNumbers = real.redactNumbers;
export const hasNumberRun = () => { throw new TypeError('check boom'); };
export const NUMBER_RUN = real.NUMBER_RUN;
