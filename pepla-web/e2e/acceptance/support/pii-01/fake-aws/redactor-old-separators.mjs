// PII-01 harness only: a broken stand-in for lambda/shared/pii-redact.mjs (old-separators). Never in a build.
const REAL = process.env.PII01_REAL_REDACTOR + '?real';
const real = await import(REAL);
// Only space, tab, line break, no-break space, dot and hyphen between digits (the first rule of the card).
const OLD = /(?<!\p{Nd})\+?\p{Nd}(?:[\s\u00a0.\-]{0,3}\p{Nd}){5,}(?!\p{Nd})/gu;
export const redactNumbers = (t) => (typeof t === 'string' ? t.replace(OLD, '[removed]') : '');
export const hasNumberRun = real.hasNumberRun;
export const NUMBER_RUN = real.NUMBER_RUN;
