// PII-01 harness only: a broken stand-in for lambda/shared/pii-redact.mjs (throw). Never in a build.
const REAL = process.env.PII01_REAL_REDACTOR + '?real';
const real = await import(REAL);
export const redactNumbers = () => { throw new TypeError('redactor boom'); };
export const hasNumberRun = real.hasNumberRun;
export const NUMBER_RUN = real.NUMBER_RUN;
