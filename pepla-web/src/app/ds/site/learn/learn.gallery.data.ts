import type { LearnDemoText, LearnFaq } from './learn.types';

/** The words of the demo sections the gallery shows (the kit's "Demo section" and the six shared pieces), and whether each sits on the cream ground, flipped. */
export interface GalleryDemo { cream: boolean; flip: boolean; text: LearnDemoText }
export const GALLERY_DEMOS: Record<'types' | 'timeline' | 'docRead' | 'suggestion' | 'liveStatus' | 'approvalLog' | 'choices', GalleryDemo> = {
  types: {
    cream: false,
    flip: false,
    text: {
      eyebrow: 'Leave types',
      title: 'Leave types set to the BCEA.',
      lead: 'Annual, sick, family responsibility and maternity leave start with the rules of the Basic Conditions of Employment Act. Companies add their own leave types in settings.',
      points: [
        { text: 'Annual, sick, family responsibility and maternity leave' },
        { text: 'Sick leave tracked over a 36-month cycle' },
        { text: 'Company leave types added in settings' },
        { text: 'Entitlement set per employee type' },
        { text: 'Every change to a leave type logged' },
      ],
    },
  },
  timeline: {
    cream: false,
    flip: false,
    text: {
      eyebrow: 'Reminders and follow-ups',
      title: 'Interviewers and candidates are reminded on schedule.',
      lead: 'Batsi chases missing interview feedback and drafts the reminder for a candidate who has gone quiet. HR sends it.',
      points: [
        { text: 'Interviewers reminded to submit feedback', batsi: true },
        { text: 'Candidates reminded to reply, confirm or upload', batsi: true },
        { text: 'Reminder drafted for HR to edit and send' },
        { text: 'Every reminder logged on the candidate' },
      ],
    },
  },
  docRead: {
    cream: true,
    flip: true,
    text: {
      eyebrow: 'Documents read and matched',
      title: 'Batsi reads every document. HR makes every decision.',
      lead: 'Naleko People reads ID documents, qualifications and bank letters as they are uploaded, fills the employee record and checks each detail against it. HR accepts the document or asks for a new one.',
      points: [
        { text: '13-digit ID number present, date of birth matches it' },
        { text: 'Gender and citizenship digits valid' },
        { text: 'Name and surname match the record' },
        { text: 'Bank letter matches the account holder' },
        { text: 'Matches, Needs a look or Doesn\'t match, with the reason', batsi: true },
        { text: 'Every decision logged with who made it' },
      ],
    },
  },
  suggestion: {
    cream: false,
    flip: false,
    text: {
      eyebrow: 'Approvals',
      title: 'The line manager approves. Batsi follows up.',
      lead: 'Each request goes to the line manager with the dates, the working days and who else is off. A request left waiting gets a reminder from Batsi. Approving or declining takes one tap.',
      points: [
        { text: 'Request sent to the line manager' },
        { text: 'Dates, working days and team overlap shown' },
        { text: 'Reminder sent when a request waits', batsi: true },
        { text: 'Decline recorded with a reason' },
        { text: 'Every decision logged with who made it' },
      ],
    },
  },
  liveStatus: {
    cream: false,
    flip: false,
    text: {
      eyebrow: 'Follow-ups',
      title: 'Missing documents are chased until they arrive.',
      lead: 'Batsi asks again for anything missing or unclear, on a set schedule. When nothing arrives, HR is told.',
      points: [
        { text: 'Missing or unclear documents requested again', batsi: true },
        { text: 'Reminders on the company\'s schedule', batsi: true },
        { text: 'HR told when nothing arrives' },
        { text: 'One list of who is waiting on what' },
      ],
    },
  },
  approvalLog: {
    cream: false,
    flip: false,
    text: {
      eyebrow: 'Approvals',
      title: 'A person approves every action.',
      lead: 'Batsi suggests, drafts and reminds. Nothing is sent, accepted or changed until HR approves it. Writes that arrive through the API or the MCP server wait in the same approval queue.',
      points: [
        { text: 'Batsi drafts, a person approves', batsi: true },
        { text: 'Nothing sent or saved before approval' },
        { text: 'API and MCP writes use the same queue' },
        { text: 'Approver recorded with a name and a time' },
        { text: 'Rejected actions logged with the reason' },
      ],
    },
  },
  choices: {
    cream: true,
    flip: true,
    text: {
      eyebrow: 'Roles and access',
      title: 'Each role sees its own modules and records.',
      lead: 'There are five roles: Administrator, HR, Manager, Employee and Guest. Access follows the role and the modules switched on for the company.',
      points: [
        { text: 'Administrator, HR, Manager, Employee and Guest' },
        { text: 'Each role sees only its own modules and records' },
        { text: 'Permissions added to a role for Recruitment, IT and offers' },
        { text: 'Access changes logged' },
      ],
    },
  },
};

/** The kit's "Questions" example: its words, and the question that is open on a desktop (the first) and on a phone (the third). */
export const GALLERY_QUESTIONS: { faq: LearnFaq; openDesktop: number; openPhone: number } = {
  faq: {
    lead: 'Leave types, entitlements and approvers are set during the onboarding call. Every company gets one before modules are switched on.',
    link: { text: 'Book a demo', href: '#' },
    items: [
      {
        q: 'Which leave types follow the BCEA?',
        a: 'Annual, sick, family responsibility and maternity leave start with the BCEA rules. Companies can add their own leave types in settings.',
      },
      {
        q: 'Are public holidays counted as leave days?',
        a: 'No. Weekends and South African public holidays are left out when working days are counted.',
      },
      {
        q: 'Who approves a request?',
        a: 'The employee’s line manager. A request that waits gets a reminder from Batsi. Batsi never approves a request.',
      },
      {
        q: 'Can employees request leave from a phone?',
        a: 'Yes. The request form works on a phone, and the balance is shown before the request is sent.',
      },
      {
        q: 'How is sick leave counted?',
        a: 'Over the 36-month sick leave cycle set by the BCEA. The remaining days show on the employee record.',
      },
      {
        q: 'Where is leave data kept?',
        a: 'On the employee record, with every change logged. All data stays in South Africa.',
      },
    ],
  },
  openDesktop: 0,
  openPhone: 2,
};
