import type { LearnDemoText, LearnEnding, LearnTab, LearnTop } from '../learn.types';

/** The Compliance page's top: the words of the kit's "Learn more top: Compliance" (the hero card is the page's own). */
export const COMPLIANCE_TOP: LearnTop = {
  crumb: [
    { label: 'Home', href: '#' },
    { label: 'Product', href: '#' },
    { label: 'Compliance Management' },
  ],
  eyebrow: 'Compliance Management',
  title: 'Every certificate tracked',
  shine: 'to its expiry date.',
  lead: 'Naleko People records the licences, certificates and permits each role needs, reminds employees at 60, 30 and 7 days, reads every renewal, and lists anyone with an expired requirement as not cleared to work.',
  chips: ['Reminders at 60, 30 and 7 days', 'Renewals read by Batsi', 'Not cleared to work list'],
  rings: false,
};

/** The Compliance page's ending: Ask Batsi, the trust strip, "Works together with" and the questions, as in the kit's "Learn more ending: Compliance". */
export const COMPLIANCE_ENDING: LearnEnding = {
  ask: {
    key: 'compliance',
    title: 'Ask Batsi about any certificate.',
    lead: 'Answers come from the certificate register. Every action Batsi suggests waits for HR.',
    questions: [
      {
        q: 'Which certificates expire in 30 days?',
        a: 'Two certificates expire within 30 days.',
        rows: [
          ['John Doe · Forklift licence', 'warning', '9 days'],
          ['Employee 3 · Medical certificate', 'warning', '16 days'],
        ],
        ask: 'Send both employees a reminder now?',
        button: 'Send reminders',
        done: 'Reminders sent at 09:12.',
        log: 'Approved by Jane Smith · logged',
      },
      {
        q: 'Who is not cleared to work?',
        a: 'One employee has an expired requirement.',
        rows: [
          ['Employee 5 · Driver’s licence', 'danger', '12 days overdue'],
        ],
      },
      {
        q: 'Which work permits expire this year?',
        a: 'One work permit expires this year.',
        rows: [
          ['Employee 4 · Work permit', 'success', '195 days'],
        ],
      },
    ],
  },
  strip: {
    label: 'Trust',
    items: [
      { icon: 'check', text: 'A person accepts every renewal' },
      { icon: 'file-text', text: 'Every view and decision logged' },
      { icon: 'lock', text: 'Built for POPIA' },
      { icon: 'map-pin', text: 'All data stays in South Africa' },
    ],
    link: { text: 'Security and POPIA', href: '#' },
  },
  related: [
    {
      icon: 'rocket',
      title: 'Onboarding and Offboarding',
      text: 'Certificates collected at onboarding go straight onto the register.',
      href: '#',
    },
    {
      icon: 'users',
      title: 'Employee Records',
      text: 'Every certificate is kept on the employee record.',
      href: '#',
    },
    {
      icon: 'zap',
      title: 'Events and webhooks',
      text: 'certificate.expiring events reach the systems a company already uses.',
      href: '#',
    },
  ],
  faq: {
    lead: 'Requirements, reminder days and roles are set during the onboarding call. Every company gets one before modules are switched on.',
    link: { text: 'Book a demo', href: '#' },
    items: [
      {
        q: 'Does Batsi change an expiry date on its own?',
        a: 'No. Batsi reads the renewed certificate and suggests the new expiry date with the reason. HR accepts it, and the decision is logged with HR’s name.',
      },
      {
        q: 'Who is reminded before a certificate expires?',
        a: 'The employee and the manager, at 60, 30 and 7 days. Anything overdue goes to HR.',
      },
      {
        q: 'Which certificates can be tracked?',
        a: 'Licences, certificates and permits, such as forklift licences, medical certificates, first aid certificates and work permits. Each is recorded against the role that needs it.',
      },
      {
        q: 'Can the reminder days be changed?',
        a: 'Yes. Reminder days and requirements per role are set per company during the onboarding call.',
      },
      {
        q: 'What does not cleared to work mean?',
        a: 'The employee has a requirement that has expired. They appear on one list that HR and the manager can see, with the reason, until the renewal is accepted.',
      },
      {
        q: 'Where is certificate data kept?',
        a: 'On the employee record, with every view logged. All data stays in South Africa.',
      },
    ],
  },
};

/** The Compliance page's demos: the words beside each sample panel, as in the kit's "Compliance page" (`data-demo`: req, reg, rem, read, nc). */
export const COMPLIANCE_DEMOS: Record<'req' | 'reg' | 'rem' | 'read' | 'nc', LearnDemoText> = {
  req: {
    eyebrow: 'Requirements per role',
    title: 'Each role lists the certificates it needs.',
    lead: 'Licences, certificates and permits are recorded against the role that needs them. New employees inherit the requirements on day one, and they are collected during onboarding.',
    points: [
      { text: 'Requirements set per role and per site' },
      { text: 'New employees inherit them automatically' },
      { text: 'Collected during onboarding, straight onto the register' },
      { text: 'Expiry date recorded for each certificate' },
      { text: 'Requirement changes applied to everyone in the role' },
    ],
  },
  reg: {
    eyebrow: 'Certificate register',
    title: 'One register, with the days left on every certificate.',
    lead: 'Every certificate shows how many days remain. Green is over 30 days, amber is 30 days or less, and red appears only when a certificate has expired.',
    points: [
      { text: 'Days remaining on every certificate' },
      { text: 'Filter by expiring soon or overdue' },
      { text: 'Certificate and licence kept on the employee record' },
      { text: 'Every change logged with who made it' },
    ],
  },
  rem: {
    eyebrow: 'Reminders',
    title: 'Reminders go out at 60, 30 and 7 days.',
    lead: 'Batsi sends each reminder to the employee and the manager before anything expires. Anything overdue goes to HR.',
    points: [
      { text: 'Reminders at 60, 30 and 7 days before expiry', batsi: true },
      { text: 'Sent to the employee and the manager' },
      { text: 'Overdue items go to HR the day they expire' },
      { text: 'Reminder days set per company' },
      { text: 'Every reminder logged on the certificate' },
    ],
  },
  read: {
    eyebrow: 'Renewals read',
    title: 'Batsi reads the renewal. HR accepts the new date.',
    lead: 'When an employee uploads a renewed certificate, Batsi reads it, checks the holder against the record and suggests the new expiry date. HR accepts the certificate or asks for a new one.',
    points: [
      { text: 'Holder, certificate type, issue and expiry dates read', batsi: true },
      { text: 'Holder checked against the employee record' },
      { text: "Matches, Needs a look or Doesn't match, with the reason" },
      { text: 'Register updated when HR accepts' },
      { text: 'Every decision logged with who made it' },
    ],
  },
  nc: {
    eyebrow: 'Not cleared to work',
    title: 'Anyone with an expired requirement is listed.',
    lead: 'When a requirement expires, the employee joins the not cleared to work list and HR and the manager are told. The list empties when the renewal is accepted.',
    points: [
      { text: 'One list of everyone not cleared to work' },
      { text: 'HR and the manager told the day a requirement expires' },
      { text: 'Reason shown against each employee' },
      { text: 'Removed from the list once the renewal is accepted' },
      { text: 'Every change logged' },
    ],
  },
};

/** The sub-menu of the Compliance page, in the order of the page; the last tab is the questions. */
export const COMPLIANCE_TABS: readonly LearnTab[] = [
  { id: 'requirements', label: 'Requirements per role' },
  { id: 'register', label: 'Certificate register' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'renewals', label: 'Renewals read' },
  { id: 'not-cleared', label: 'Not cleared to work' },
  { id: 'questions', label: 'Questions' },
];
