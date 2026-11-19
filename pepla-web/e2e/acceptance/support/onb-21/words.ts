/**
 * ONB-21: the reminder email's words, W-1 to W-3, as the spec PROPOSES them. They wait for Iggie (project rule: new
 * user-facing wording is his). They live in this file and nowhere else in the tests, so a words-only change after his
 * answer touches this file and `lambda/shared/reminder-email.mjs`. W-4: no first name on file, nothing is sent.
 *
 * Nothing in the tests invents any other sentence: the checks that no other words are in the email take everything
 * here out and expect nothing to be left.
 */
export const SIGNED = 'Naleko People';
export const BUTTON = 'Upload your documents';
export const w1 = (date: string) => `Your documents are due on ${date}`;
export const w2 = (first: string, date: string, list: string) => `Hi ${first}. Still to upload, due ${date}: ${list}.`;
export const w3Text = (url: string) => `Sign in to Naleko People to upload your documents: ${url}`;

/** The names the person sees for each type (the kit's row names), in the order of the required list. */
export const KIT_NAME = {
  NATIONAL_ID: 'National ID',
  BANK_CONFIRMATION: 'Bank account confirmation letter',
  MATRIC_CERTIFICATE: 'Matric certificate',
  TERTIARY_QUALIFICATION: 'Tertiary qualifications',
} as const;
export type DocType = keyof typeof KIT_NAME;
