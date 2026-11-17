import type { LearnEnding, LearnTop } from '../learn.types';

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
