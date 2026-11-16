import { createHash } from 'node:crypto';

/**
 * ONB-05: privacy notice version 2026-11-1 word for word, as the spec's appendix gives it (16 Nov 2026), with
 * the wording of kit PR #29 in sections 1 and 5 ("runs the service", "keep the service running").
 * `{company}` is filled in by the server. lambda/shared/privacy-notice.mjs must hold exactly this as
 * NOTICES['2026-11-1']: { title, intro, terms: [{ icon, term, text }], full: [{ heading, text }] }.
 * A released version is never edited: a change is a new version (AC-4 pins its SHA-256 below).
 */

export type Term = { icon: string; term: string; text: string };
export type Section = { heading: string; text: string };
export type Notice = { title: string; intro: string; terms: Term[]; full: Section[] };

export const VERSION = '2026-11-1';

export const NOTICE_2026_11_1: Notice = {
  title: 'Declaration and consent',
  intro: 'Before you upload your documents, read and accept the following.',
  terms: [
    { icon: 'file-text', term: 'Your documents', text: 'Everything you upload is real and belongs to you.' },
    {
      icon: 'users',
      term: 'Who uses your information',
      text: 'You consent to {company} processing your personal information in accordance with the Protection of Personal Information Act (POPIA).',
    },
    {
      icon: 'shield-check',
      term: 'How it is checked',
      text: 'Your ID and bank letter are checked by Batsi and reviewed by HR.',
    },
    { icon: 'triangle-alert', term: 'If something is false', text: 'False documents can lead to disqualification.' },
  ],
  full: [
    { heading: 'Who is responsible', text: '{company} is responsible for your personal information. Its service provider runs the service for {company} and uses your information only for that.' },
    { heading: 'What is collected', text: 'Your name, email, phone number, start date, department and job title, your ID number, your bank details, and the documents you upload.' },
    { heading: 'Why', text: 'To employ you, pay you, and meet the law: the Basic Conditions of Employment Act, the Unemployment Insurance Act and the Income Tax Act.' },
    { heading: 'Do you have to give it', text: "Yes, your ID and bank letter. Without them {company} can't finish your onboarding or pay you." },
    { heading: 'Who receives it', text: 'HR at {company}. Staff of the service provider, only to keep the service running. Amazon Web Services, which stores it in Cape Town, South Africa.' },
    {
      heading: 'Outside South Africa',
      text: 'Your ID and bank letter are read by Amazon Textract in Ireland, in the European Union, where the law protects personal information at least as well as POPIA. They are sent there only to be read.',
    },
    { heading: 'How it is checked', text: 'Batsi reads your documents and suggests a result. A person in HR decides every document.' },
    { heading: 'How long it is kept', text: 'While you work at {company} and for 3 years after you leave, as the Basic Conditions of Employment Act requires. Then it is deleted.' },
    {
      heading: 'Your rights',
      text: 'You can ask HR at {company} to see your information, to correct it, or to explain how it is used. You can object to how it is used, and you can complain to the Information Regulator (inforegulator.org.za).',
    },
    { heading: 'Changes', text: 'If this notice changes, you are asked to read it and agree again.' },
  ],
};

/** The released text in one fixed form: the four fields in this order, each term and section with its fields in this order. */
export function canonical(n: Notice): string {
  return JSON.stringify({
    title: n.title,
    intro: n.intro,
    terms: n.terms.map(({ icon, term, text }) => ({ icon, term, text })),
    full: n.full.map(({ heading, text }) => ({ heading, text })),
  });
}

export const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** SHA-256 of canonical(NOTICE_2026_11_1), `{company}` not filled in. Pinned: version 2026-11-1 is released. */
export const PINNED_SHA256 = '4089631126c08a58779c9d82acc814ca463dd8a6fef41b55787fd6d1679a5528';

/** `{company}` filled in, as the server sends it. */
export function filled(n: Notice, company: string): Notice {
  const f = (s: string) => s.split('{company}').join(company);
  return {
    title: f(n.title),
    intro: f(n.intro),
    terms: n.terms.map((t) => ({ icon: t.icon, term: f(t.term), text: f(t.text) })),
    full: n.full.map((s) => ({ heading: f(s.heading), text: f(s.text) })),
  };
}

/** A later notice, made up for the tests of AC-4 only: a new version that asks again. Never shipped. */
export const NEXT_VERSION = '2026-12-1';
export const NOTICE_NEXT: Notice = {
  ...NOTICE_2026_11_1,
  intro: 'This notice changed on 1 Dec 2026. Before you upload your documents, read and accept the following.',
  full: NOTICE_2026_11_1.full.map((s) =>
    s.heading === 'Changes' ? { ...s, text: 'This notice changed on 1 Dec 2026. If it changes again, you are asked to read it and agree again.' } : s,
  ),
};
