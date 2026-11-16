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
