/** What sign-in says to a person. One place, so the words match the card and its tests. */
export const SIGN_IN_MESSAGES = {
  noAccess: "This account can't use Naleko People yet. Ask your HR team.",
  wrong: 'Email or password is incorrect.',
  tooMany: 'Too many attempts. Try again in a few minutes.',
  offline: "We can't reach Naleko People. Check your connection and try again.",
  setPassword: 'Use the link in your invite email to set your password.',
  badEmail: 'Enter a valid email.',
  noPassword: 'Enter your password.',
  secondStep: 'This account needs a second sign-in step that Naleko People does not offer here yet. Ask your Admin.',
  unknown: 'Sign-in did not work. Try again in a few minutes.',
} as const;

export type SignInProblem = 'noAccess' | 'wrong' | 'tooMany' | 'offline' | 'setPassword' | 'secondStep' | 'unknown';

/** ONB-24: forgot your password. Reused words (tooMany, offline, badEmail, the password rule lines) are imported. */
export const RESET_MESSAGES = {
  codeEmpty: 'Enter the code from the email.',
  codeSix: 'The code is 6 digits.',
  wrongCode: 'That code is not right. Check the email and try again.',
  expired: 'That code has expired. Send a new code.',
  other: "That didn't work. Try again in a few minutes.",
  newCodeSent: 'A new code is on its way.',
  changed: 'Your password is changed. Sign in with your new password.',
} as const;

export type ResetProblem = 'tooMany' | 'offline' | 'wrongCode' | 'expired' | 'badPassword' | 'other';

/** ONB-17's password rule lines, in their order. One place for both pages. */
export const PASSWORD_RULE_LINES: Record<string, string> = {
  minLength: 'Use at least 12 characters.',
  maxLength: 'Use 256 characters or fewer.',
  upper: 'Add an upper case letter.',
  lower: 'Add a lower case letter.',
  number: 'Add a number.',
  symbol: 'Add a symbol, such as ! or #.',
};
export const PASSWORD_RULE_ORDER = ['minLength', 'maxLength', 'upper', 'lower', 'number', 'symbol'];
export const PASSWORD_GENERAL = 'Check the password against the rules under the field.';
export const PASSWORD_HELP = 'At least 12 characters, with an upper case letter, a lower case letter, a number and a symbol.';
export const PASSWORD_EMPTY = 'Enter a new password.';

export function brokenRules(p: string): string[] {
  const out: string[] = [];
  if (p.length < 12) out.push('minLength');
  if (p.length > 256) out.push('maxLength');
  if (!/[A-Z]/.test(p)) out.push('upper');
  if (!/[a-z]/.test(p)) out.push('lower');
  if (!/[0-9]/.test(p)) out.push('number');
  if (!/[^A-Za-z0-9]/.test(p)) out.push('symbol');
  return out;
}
