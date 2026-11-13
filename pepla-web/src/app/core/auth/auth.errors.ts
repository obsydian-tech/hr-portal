import { SignInProblem } from './auth.messages';

/** The part of a Cognito or network error that decides what a person is told. */
export interface CognitoErrorLike { code?: string; name?: string; message?: string }

/**
 * Turns a Cognito error into one of the sign-in problems. A wrong password and an unknown email
 * are the same problem on purpose: the page never says which one it was.
 */
export function problemFor(error: CognitoErrorLike | null | undefined): SignInProblem {
  const code = error?.code ?? error?.name ?? '';
  const message = error?.message ?? '';
  if (code === 'NetworkError' || message === 'Network error') return 'offline';
  if (code === 'TooManyRequestsException' || code === 'LimitExceededException') return 'tooMany';
  if (code === 'NotAuthorizedException' && /attempts exceeded/i.test(message)) return 'tooMany';
  if (code === 'NotAuthorizedException' || code === 'UserNotFoundException') return 'wrong';
  if (code === 'PasswordResetRequiredException' || code === 'UserNotConfirmedException') return 'setPassword';
  return 'unknown';
}

/** A well-formed email address of any domain. No company-domain rule: Gmail and Outlook are fine. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value.trim());
}

/**
 * Where to go after sign-in. Only a path inside this app counts, so a crafted link cannot send
 * a person to another site after they sign in.
 */
export function safeReturnUrl(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/^\/sign-in(?:[?#]|$)/.test(value)) return fallback;
  return value;
}
