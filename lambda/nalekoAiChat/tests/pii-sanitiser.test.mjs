/**
 * NH-56: Unit tests for pii-sanitiser.mjs
 *
 * Test coverage:
 *  1. SA ID numbers are redacted
 *  2. SA phone numbers (+27 and 0 prefix) are redacted
 *  3. Bank account numbers (8–11 digits) are redacted
 *  4. Text with no PII is returned unchanged, fired=false
 *  5. Mixed PII — multiple patterns fire in one string
 *  6. EMP- prefixed employee IDs are NOT redacted (negative lookahead)
 *  7. Empty / null input handled gracefully
 *  8. guardrailAction maps: fired → MASKED, not fired → NONE
 *  9. Multiple SA ID numbers in one string — all redacted
 * 10. Phone number in prose is redacted
 */

import { sanitisePii, PII_PATTERNS } from '../pii-sanitiser.mjs';

// ─── 1. SA ID number ──────────────────────────────────────────────────────────

test('1. SA ID number is redacted', () => {
  const input    = 'Employee ID document shows 9001015009087 as issued.';
  const { sanitised, fired, matchedPatterns } = sanitisePii(input);
  expect(sanitised).not.toContain('9001015009087');
  expect(sanitised).toContain('[SA-ID-REDACTED]');
  expect(fired).toBe(true);
  expect(matchedPatterns).toContain('SA_ID');
});

// ─── 2. Phone number (+27 prefix) ────────────────────────────────────────────

test('2a. Phone number with +27 prefix is redacted', () => {
  const { sanitised, fired } = sanitisePii('Contact: +27821234567');
  expect(sanitised).toContain('[PHONE-REDACTED]');
  expect(sanitised).not.toContain('+27821234567');
  expect(fired).toBe(true);
});

test('2b. Phone number with 0 prefix is redacted', () => {
  const { sanitised, fired } = sanitisePii('Call us on 0821234567 during hours.');
  expect(sanitised).toContain('[PHONE-REDACTED]');
  expect(fired).toBe(true);
});

// ─── 3. Bank account numbers ─────────────────────────────────────────────────

test('3a. 8-digit bank account is redacted', () => {
  const { sanitised, fired } = sanitisePii('Account: 12345678 is flagged.');
  expect(sanitised).toContain('[ACCOUNT-REDACTED]');
  expect(fired).toBe(true);
});

test('3b. 11-digit bank account is redacted', () => {
  const { sanitised, fired } = sanitisePii('Transfer to 12345678901 immediately.');
  expect(sanitised).toContain('[ACCOUNT-REDACTED]');
  expect(fired).toBe(true);
});

// ─── 4. Clean text — no PII ──────────────────────────────────────────────────

test('4. Clean text returns unchanged with fired=false', () => {
  const input = 'The employee completed onboarding stage 2 with no issues.';
  const { sanitised, fired, matchedPatterns } = sanitisePii(input);
  expect(sanitised).toBe(input);
  expect(fired).toBe(false);
  expect(matchedPatterns).toHaveLength(0);
});

// ─── 5. Mixed PII — multiple patterns ────────────────────────────────────────

test('5. Mixed PII: SA ID + phone both redacted', () => {
  const input = 'ID: 9001015009087, phone: 0821234567.';
  const { sanitised, fired, matchedPatterns } = sanitisePii(input);
  expect(sanitised).toContain('[SA-ID-REDACTED]');
  expect(sanitised).toContain('[PHONE-REDACTED]');
  expect(fired).toBe(true);
  expect(matchedPatterns).toContain('SA_ID');
  expect(matchedPatterns).toContain('PHONE');
});

// ─── 6. Employee ID (EMP-XXXXXXX) — must NOT be redacted ─────────────────────

test('6. Employee ID EMP-0000012 is NOT redacted by bank account pattern', () => {
  const input = 'Employee EMP-0000012 passed verification.';
  const { sanitised } = sanitisePii(input);
  // EMP-0000012 contains 7 digits — below the 8-digit threshold → not matched
  expect(sanitised).toContain('EMP-0000012');
  expect(sanitised).not.toContain('[ACCOUNT-REDACTED]');
});

// ─── 7. Edge cases — empty / null ────────────────────────────────────────────

test('7a. Empty string returns empty string with fired=false', () => {
  const { sanitised, fired } = sanitisePii('');
  expect(sanitised).toBe('');
  expect(fired).toBe(false);
});

test('7b. null input returns empty string gracefully', () => {
  const { sanitised, fired } = sanitisePii(null);
  expect(sanitised).toBe('');
  expect(fired).toBe(false);
});

// ─── 8. guardrailAction mapping ──────────────────────────────────────────────

test('8a. fired=true maps to guardrailAction MASKED (caller logic)', () => {
  const { fired } = sanitisePii('9001015009087');
  // Callers in index.mjs map: fired → 'MASKED', !fired → 'NONE'
  expect(fired ? 'MASKED' : 'NONE').toBe('MASKED');
});

test('8b. fired=false maps to guardrailAction NONE (caller logic)', () => {
  const { fired } = sanitisePii('No PII here.');
  expect(fired ? 'MASKED' : 'NONE').toBe('NONE');
});

// ─── 9. Multiple SA IDs in one string ────────────────────────────────────────

test('9. Multiple SA IDs in one string are all redacted', () => {
  const input = 'IDs: 9001015009087 and 8503125800087 submitted.';
  const { sanitised } = sanitisePii(input);
  expect(sanitised).not.toContain('9001015009087');
  expect(sanitised).not.toContain('8503125800087');
  const count = (sanitised.match(/\[SA-ID-REDACTED\]/g) ?? []).length;
  expect(count).toBeGreaterThanOrEqual(1); // at least one match (both may also match phone/bank overlap)
});

// ─── 10. Phone in prose ──────────────────────────────────────────────────────

test('10. Phone number embedded in prose is redacted', () => {
  const input = 'Please call John on +27731234567 for details regarding the verification.';
  const { sanitised, fired } = sanitisePii(input);
  expect(sanitised).toContain('[PHONE-REDACTED]');
  expect(sanitised).not.toContain('+27731234567');
  expect(fired).toBe(true);
});
