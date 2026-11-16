/**
 * ONB-05: the privacy notice a new employee reads and accepts. One source: GET /v1/me serves it, POST /v1/me/consent
 * hashes what it served, and the page shows exactly these words, so the words a person accepted are the words stored.
 *
 * A released version is never edited. A change is a new version: add it to NOTICES and make it
 * CURRENT_NOTICE_VERSION, and everyone is asked again. `{company}` is filled in with the COMPANY_NAME setting.
 *
 * Version 2026-11-1 is a DRAFT. Iggie polishes the full notice before go-live (a lawyer checks it before prod),
 * as a new version.
 */
import { createHash } from 'node:crypto';

export const CURRENT_NOTICE_VERSION = '2026-11-1';

export const NOTICES = {
  '2026-11-1': {
    "title": "Declaration and consent",
    "intro": "Before you upload your documents, read and accept the following.",
    "terms": [
      {
        "icon": "file-text",
        "term": "Your documents",
        "text": "Everything you upload is real and belongs to you."
      },
      {
        "icon": "users",
        "term": "Who uses your information",
        "text": "You consent to {company} processing your personal information in accordance with the Protection of Personal Information Act (POPIA)."
      },
      {
        "icon": "shield-check",
        "term": "How it is checked",
        "text": "Your ID and bank letter are checked by Batsi and reviewed by HR."
      },
      {
        "icon": "triangle-alert",
        "term": "If something is false",
        "text": "False documents can lead to disqualification."
      }
    ],
    "full": [
      {
        "heading": "Who is responsible",
        "text": "{company} is responsible for your personal information. Its service provider runs the service for {company} and uses your information only for that."
      },
      {
        "heading": "What is collected",
        "text": "Your name, email, phone number, start date, department and job title, your ID number, your bank details, and the documents you upload."
      },
      {
        "heading": "Why",
        "text": "To employ you, pay you, and meet the law: the Basic Conditions of Employment Act, the Unemployment Insurance Act and the Income Tax Act."
      },
      {
        "heading": "Do you have to give it",
        "text": "Yes, your ID and bank letter. Without them {company} can't finish your onboarding or pay you."
      },
      {
        "heading": "Who receives it",
        "text": "HR at {company}. Staff of the service provider, only to keep the service running. Amazon Web Services, which stores it in Cape Town, South Africa."
      },
      {
        "heading": "How it is checked",
        "text": "Batsi reads your documents and suggests a result. A person in HR decides every document."
      },
      {
        "heading": "How long it is kept",
        "text": "While you work at {company} and for 3 years after you leave, as the Basic Conditions of Employment Act requires. Then it is deleted."
      },
      {
        "heading": "Your rights",
        "text": "You can ask HR at {company} to see your information, to correct it, or to explain how it is used. You can object to how it is used, and you can complain to the Information Regulator (inforegulator.org.za)."
      },
      {
        "heading": "Changes",
        "text": "If this notice changes, you are asked to read it and agree again."
      }
    ]
  },
};

const fill = (text, company) => String(text).split('{company}').join(company);

/**
 * The notice as GET /v1/me serves it: `{ version, title, intro, terms, full }`, `{company}` filled in.
 * Returns null for a version that does not exist.
 */
export function renderNotice(version, company) {
  const n = NOTICES[version];
  if (!n) return null;
  return {
    version,
    title: fill(n.title, company),
    intro: fill(n.intro, company),
    terms: n.terms.map((t) => ({ icon: t.icon, term: fill(t.term, company), text: fill(t.text, company) })),
    full: n.full.map((s) => ({ heading: fill(s.heading, company), text: fill(s.text, company) })),
  };
}

/** SHA-256 (hex) of the exact notice served for this company: the JSON of renderNotice(). */
export const noticeHash = (served) => createHash('sha256').update(JSON.stringify(served), 'utf8').digest('hex');
