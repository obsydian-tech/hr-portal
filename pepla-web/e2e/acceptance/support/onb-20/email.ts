import { runHandler, busEvent, emails, EMAIL, ENV, type Email, type Run, type Tables } from '../onb-07/lambda-harness';
import { row, encrypted } from '../onb-15/lambda-harness';

/**
 * ONB-20: the "needs a new copy" email, run through the real sendNotificationEmail on ONB-07's harness
 * (a fake AWS and a recording Postmark; nothing is sent anywhere). Words are the card's W-5, exactly.
 */
export { ENV, emails, runHandler, busEvent, type Email, type Run, type Tables };

export const LOGIN_URL = ENV.LOGIN_URL;
export const NALEDI = { id: 'EMP-1501', first: 'Naledi', last: 'Dlamini', email: 'naledi.dlamini@kestrel-foods.co.za' };
export const HR_EMAIL = 'thandi.demo-hr@kestrel-foods.co.za';
export const ID_NUMBER = '9803145800876';
export const ACCOUNT_NUMBER = '62845519023';
export const REASON = 'The letter is dated 2 Aug 2026. Upload one from the last 3 months.';

/** The names the person sees for each type (the kit's row names). */
export const TYPE_NAME = {
  NATIONAL_ID: 'National ID',
  BANK_CONFIRMATION: 'Bank account confirmation letter',
  MATRIC_CERTIFICATE: 'Matric certificate',
  TERTIARY_QUALIFICATION: 'Tertiary qualifications',
} as const;
export type Type = keyof typeof TYPE_NAME;

export const subjectOf = (type: Type) => `Your ${TYPE_NAME[type]} needs a new copy`;
/** W-5 body, with every run of white space as one space: "Hi {first name}. HR asked ... {link}" then "Naleko People". */
export const bodyOf = (first: string, type: Type) =>
  `Hi ${first}. HR asked for a new copy of your ${TYPE_NAME[type]}. Sign in to Naleko People to see why and upload a new one: ${LOGIN_URL} Naleko People`;

export const squashWhite = (s: string) => s.replace(/\s+/g, ' ').trim();
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&apos;': "'" };
/** What a mail program shows from the HTML: tags out, entities read, white space as one space. */
export const shownFromHtml = (html: string) =>
  squashWhite(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&(amp|lt|gt|quot|#39|#x27|apos);/g, (m) => ENTITIES[m]!));
export const allText = (e: Email) => [e.Subject, e.TextBody, e.HtmlBody, e.To, e.Cc, e.Bcc, e.From].map((x) => String(x ?? '')).join('\n');

type EmployeeOver = Record<string, string | undefined>;
export function tablesFor(opts: { type?: Type; documentId?: string; employee?: EmployeeOver; document?: EmployeeOver } = {}): Tables {
  const type = opts.type ?? 'BANK_CONFIRMATION';
  const documentId = opts.documentId ?? 'doc_1763800000001';
  const emp = row({
    employee_id: NALEDI.id, first_name: NALEDI.first, last_name: NALEDI.last, email: NALEDI.email, stage: 'DOCUMENTS_SUBMITTED',
    id_number_last4: ID_NUMBER.slice(-4), id_number_encrypted: encrypted(ID_NUMBER), bank_account_number: ACCOUNT_NUMBER,
    hr_staff_name: 'Jane Smith', hr_staff_email: 'jane.smith@mokoena-logistics.co.za', created_at: '2026-10-20T08:00:00.000Z', ...(opts.employee ?? {}),
  });
  const doc = row({
    employee_id: NALEDI.id, document_id: documentId, document_type: type, file_name: `${type.toLowerCase()}.pdf`, ocr_status: 'MANUAL_REVIEW',
    upload_timestamp: '2026-11-04T08:00:00.000Z', ocr_completed_at: '2026-11-04T08:02:00.000Z', verification_id: `ver_${documentId}`, ...(opts.document ?? {}),
  });
  const verification = row({
    verificationId: `ver_${documentId}`, employeeId: NALEDI.id, documentId, documentType: type, decision: 'MANUAL_REVIEW', confidence: 72, check: 'NEEDS_A_LOOK',
    accountNumber: ACCOUNT_NUMBER, createdAt: '2026-11-04T08:02:00.000Z',
  });
  return { employees: [emp], documents: [doc], 'document-verification': [verification] };
}

/** What reviewDocumentVerification puts on the bus for HR's "Ask for a new one" (support/onb-15 locks its shape). */
export const askedDetail = (documentId = 'doc_1763800000001', over: Record<string, unknown> = {}) => ({
  document_id: documentId, employee_id: NALEDI.id, decision: 'FAILED', notes: REASON, decided_by: HR_EMAIL, decided_by_name: 'Thandi Demo-HR',
  decided_at: '2026-11-10T08:00:00.000Z', actor: 'HUMAN', ...over,
});

/** One document.reviewed event, delivered to sendNotificationEmail in a fresh process. */
export function deliverReviewed(tables: Tables, detail: Record<string, unknown>): { run: Run; sent: Email[] } {
  const run = runHandler(EMAIL, { tables }, busEvent('document.reviewed', detail));
  return { run, sent: emails(run) };
}
