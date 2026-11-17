import type { LearnEnding, LearnTop } from '../learn.types';

/** The Security page's top: the words of the kit's "Learn more top: Security" (the hero card is the page's own). */
export const SECURITY_TOP: LearnTop = {
  crumb: [
    { label: 'Home', href: '#' },
    { label: 'Trust', href: '#' },
    { label: 'Security and POPIA' },
  ],
  eyebrow: 'Security and POPIA',
  title: 'Every action approved.',
  shine: 'Every step recorded.',
  lead: 'Batsi suggests and drafts. A person approves before anything is sent or saved. Each step goes into the audit log with a name, a time and whether a person or Batsi did it. All data stays in South Africa.',
  chips: ['Approval before any action', 'Full audit trail', 'Data stays in South Africa'],
  rings: false,
};

/** The Security page's ending: Ask Batsi, the trust strip, "Works together with" and the questions, as in the kit's "Learn more ending: Security". */
export const SECURITY_ENDING: LearnEnding = {
  ask: {
    key: 'security',
    title: 'Ask Batsi what was done, and by whom.',
    lead: 'Answers come from the audit log. Batsi shows the entries and never changes them.',
    questions: [
      {
        q: 'What did Batsi do for John Doe?',
        a: 'Batsi made two entries for John Doe.',
        rows: [
          ['09:00 · Asked for UIF reference number', 'success', 'Logged'],
          ['09:15 · Read ID document, suggested Matches', 'success', 'Logged'],
        ],
      },
      {
        q: 'Who viewed an ID number today?',
        a: 'One ID number was viewed today.',
        rows: [
          ['09:45 · Jane Smith · John Doe', 'success', 'Logged'],
        ],
      },
      {
        q: 'Which actions are waiting for approval?',
        a: 'One action is waiting for approval.',
        rows: [
          ['Reminder to Candidate 3', 'warning', 'Waiting'],
        ],
        ask: 'Send the reminder to Jane Smith for review?',
        button: 'Send for review',
        done: 'Sent to Jane Smith at 09:43.',
        log: 'Approved by Jane Smith · logged',
      },
    ],
  },
  strip: {
    label: 'Trust',
    items: [
      { icon: 'check', text: 'A person approves every action' },
      { icon: 'file-text', text: 'Every view and decision logged' },
      { icon: 'lock', text: 'Built for POPIA' },
      { icon: 'map-pin', text: 'All data stays in South Africa' },
    ],
  },
  related: [
    {
      icon: 'rocket',
      title: 'Onboarding and Offboarding',
      text: 'Consent is recorded before the first document is collected.',
      href: '#',
    },
    {
      icon: 'users',
      title: 'Employee Records',
      text: 'ID, bank and salary details are hidden on every record.',
      href: '#',
    },
    {
      icon: 'zap',
      title: 'API, MCP and events',
      text: 'Writes from outside wait in the same approval queue.',
      href: '#',
    },
  ],
  faq: {
    lead: 'Roles, approvers and the privacy notice are set during the onboarding call. Every company gets one before modules are switched on.',
    link: { text: 'Book a demo', href: '#' },
    items: [
      {
        q: 'Can Batsi act without approval?',
        a: 'No. Batsi suggests, drafts and reminds. Anything that sends a message, accepts a document or changes a record waits for a person to approve it.',
      },
      {
        q: 'What does the audit log record?',
        a: 'Every upload, check, approval and view, with the name of who did it, the time, and whether it was a person or Batsi. The log exports to CSV.',
      },
      {
        q: 'Which personal data is hidden?',
        a: 'ID numbers, bank account details and salary. Each Show is logged and the value hides again.',
      },
      {
        q: 'How is POPIA consent handled?',
        a: 'The employee or candidate agrees to the privacy notice before any document is collected. The consent is kept on the record with its date and time.',
      },
      {
        q: 'Where is the data kept?',
        a: 'Employee records, documents and audit history are stored and processed in South Africa.',
      },
      {
        q: 'What happens to writes from the API or the MCP server?',
        a: 'They go into the same approval queue as Batsi’s own suggestions. Keys are issued per company.',
      },
    ],
  },
};
