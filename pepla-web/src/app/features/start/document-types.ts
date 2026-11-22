import { inject } from '@angular/core';
import { CanActivateFn, ResolveFn, Router } from '@angular/router';
import type { IconName } from '../../ds';
import { formatDate } from '../../ds';
import type { DocumentState, DocumentType, MyFile } from '../../core/start/my-documents.service';

/** The four documents the card names (kit words, approved by Iggie 16 Nov): name, address, words and icon. */
export const DOCUMENT_INFO: Record<DocumentType, { name: string; slug: string; icon: IconName; button: string; description: string }> = {
  NATIONAL_ID: { name: 'National ID', slug: 'national-id', icon: 'id-card', button: 'Upload ID', description: 'Your South African ID book or card.' },
  BANK_CONFIRMATION: { name: 'Bank account confirmation letter', slug: 'bank-letter', icon: 'landmark', button: 'Upload bank letter', description: 'A letter from your bank confirming your account, from the last 3 months.' },
  MATRIC_CERTIFICATE: { name: 'Matric certificate', slug: 'matric', icon: 'file-text', button: 'Upload matric', description: 'Your matric certificate.' },
  TERTIARY_QUALIFICATION: { name: 'Tertiary qualifications', slug: 'qualifications', icon: 'graduation-cap', button: 'Upload qualification', description: 'Your degree, diploma or professional certificate. HR checks it by hand.' },
};

/** W-1 (ONB-20): the button on a sent-back row. Qualifications keep their words. */
export const SENT_BACK_BUTTON: Record<DocumentType, string> = {
  NATIONAL_ID: 'Upload a new ID',
  BANK_CONFIRMATION: 'Upload a new letter',
  MATRIC_CERTIFICATE: 'Upload a new certificate',
  TERTIARY_QUALIFICATION: 'Upload qualification',
};

/** What a state says to the person, and how the lozenge looks. */
export const STATE_WORDS: Record<DocumentState, { text: string; tone: 'neutral' | 'information' | 'success' | 'danger'; icon: IconName }> = {
  NOT_UPLOADED: { text: 'Not uploaded yet', tone: 'neutral', icon: 'circle-dashed' },
  WITH_HR: { text: 'With HR', tone: 'information', icon: 'info' },
  SENT_BACK: { text: 'Needs a new copy', tone: 'danger', icon: 'circle-x' },
  ACCEPTED: { text: 'Accepted', tone: 'success', icon: 'circle-check' },
};

/** The document an address names (`matric`), or null for anything else. */
export function typeOfSlug(slug: string | null | undefined): DocumentType | null {
  return (Object.keys(DOCUMENT_INFO) as DocumentType[]).find((t) => DOCUMENT_INFO[t].slug === slug) ?? null;
}

/** An address that names no document goes back to Today. */
export const knownDocumentGuard: CanActivateFn = (route) => (typeOfSlug(route.paramMap.get('type')) ? true : inject(Router).createUrlTree(['/start']));

export const documentTitle: ResolveFn<string> = (route) => {
  const type = typeOfSlug(route.paramMap.get('type'));
  return `${type ? DOCUMENT_INFO[type].name : 'Your documents'} · Naleko People`;
};

/**
 * What follows "Uploaded <date>" on a sent-back file: " · Returned by <name>, <date>" (W-2: " · Returned <date>"
 * when nobody is named). With no date recorded (W-4) it says nothing. Short date in the current year, else with the year.
 */
export function returnedLine(file: Pick<MyFile, 'returnedAt' | 'returnedBy'>): string {
  if (!file.returnedAt) return '';
  const when = formatDate(file.returnedAt);
  return file.returnedBy ? ` · Returned by ${file.returnedBy}, ${when}` : ` · Returned ${when}`;
}
