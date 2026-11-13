import { describe, expect, it } from 'vitest';
import { isEmail, problemFor, safeReturnUrl } from './auth.errors';

describe('problemFor', () => {
  it('reads a wrong password and an unknown email the same way', () => {
    expect(problemFor({ code: 'NotAuthorizedException', message: 'Incorrect username or password.' })).toBe('wrong');
    expect(problemFor({ code: 'UserNotFoundException', message: 'User does not exist.' })).toBe('wrong');
  });
  it('tells a locked-out account to wait', () => {
    expect(problemFor({ code: 'NotAuthorizedException', message: 'Password attempts exceeded' })).toBe('tooMany');
    expect(problemFor({ code: 'TooManyRequestsException', message: 'Too many requests' })).toBe('tooMany');
    expect(problemFor({ code: 'LimitExceededException' })).toBe('tooMany');
  });
  it('tells a lost connection from a wrong password', () => {
    expect(problemFor({ code: 'NetworkError', message: 'Network error' })).toBe('offline');
    expect(problemFor({ message: 'Network error' })).toBe('offline');
  });
  it('sends an account without a password to the invite email', () => {
    expect(problemFor({ code: 'PasswordResetRequiredException' })).toBe('setPassword');
  });
  it('never shows a Cognito message it does not know', () => {
    expect(problemFor({ code: 'InternalErrorException', message: 'boom' })).toBe('unknown');
    expect(problemFor(null)).toBe('unknown');
  });
});

describe('isEmail', () => {
  it('accepts any well-formed address, whatever the domain', () => {
    for (const ok of ['jane.smith@gmail.com', 'jane@outlook.com', 'jane.smith@mokoena-logistics.co.za', ' jane@x.io ']) expect(isEmail(ok)).toBe(true);
  });
  it('refuses empty and badly formed addresses', () => {
    for (const bad of ['', 'jane.smith', 'jane.smith@', 'jane smith@x.co.za', '@x.co.za', 'jane@x', 'jane@x.']) expect(isEmail(bad)).toBe(false);
  });
});

describe('safeReturnUrl', () => {
  it('keeps a page inside the app, with its query', () => {
    expect(safeReturnUrl('/hr?view=ac-9', '/hr')).toBe('/hr?view=ac-9');
  });
  it('falls back for anything that could leave the app or loop', () => {
    for (const bad of [null, undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'hr', '/sign-in', '/sign-in?returnUrl=/hr']) {
      expect(safeReturnUrl(bad, '/hr')).toBe('/hr');
    }
  });
});
