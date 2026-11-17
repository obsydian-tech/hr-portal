import type { LearnEnding, LearnTop } from '../learn.types';

/** The Leave page's top: the words of the kit's "Learn more top: Leave" (the hero card is the page's own). */
export const LEAVE_TOP: LearnTop = {
  crumb: [
    { label: 'Home', href: '#' },
    { label: 'Product', href: '#' },
    { label: 'Leave Management' },
  ],
  eyebrow: 'Leave Management',
  title: 'Every leave request',
  shine: 'approved and counted.',
  lead: 'Naleko People takes leave requests from a phone, counts working days, sends each request to the line manager, follows up when it waits, and updates the balance on the employee record.',
  chips: ['Leave types set to the BCEA', 'Requests from a phone', 'Balances update on approval'],
  rings: false,
};

/** The Leave page's ending: Ask Batsi, the trust strip, "Works together with" and the questions, as in the kit's "Learn more ending: Leave". */
export const LEAVE_ENDING: LearnEnding = {
  ask: {
    key: 'leave',
    title: 'Ask Batsi about leave.',
    lead: 'Answers come from the leave records. Every action Batsi suggests waits for a person.',
    questions: [
      {
        q: 'Who is off next week?',
        a: 'Two employees are off on 14 to 18 Dec.',
        rows: [
          ['John Doe · Annual leave', 'success', '14 to 18 Dec'],
          ['Employee 2 · Annual leave', 'success', '21 to 23 Dec'],
        ],
      },
      {
        q: 'Which requests are waiting?',
        a: 'One request is waiting for the line manager.',
        rows: [
          ['John Doe · Annual leave · 4 days', 'warning', 'Waiting 1 day'],
        ],
        ask: 'Send the line manager a reminder now?',
        button: 'Send reminder',
        done: 'Reminder sent at 09:12.',
        log: 'Approved by Jane Smith · logged',
      },
      {
        q: 'What is John Doe’s annual leave balance?',
        a: 'John Doe has 15 days of annual leave left.',
        rows: [
          ['Annual leave', 'success', '15 days'],
          ['Sick leave', 'success', '28 days'],
          ['Family responsibility', 'success', '3 days'],
        ],
      },
    ],
  },
  strip: {
    label: 'Trust',
    items: [
      { icon: 'check', text: 'A person approves every request' },
      { icon: 'file-text', text: 'Every decision logged' },
      { icon: 'lock', text: 'Built for POPIA' },
      { icon: 'map-pin', text: 'All data stays in South Africa' },
    ],
    link: { text: 'Security and POPIA', href: '#' },
  },
  related: [
    {
      icon: 'users',
      title: 'Employee Records',
      text: 'Leave balances are kept on the employee record.',
      href: '#',
    },
    {
      icon: 'rocket',
      title: 'Onboarding and Offboarding',
      text: 'Leave entitlement starts on the first day. Final leave is paid out at offboarding.',
      href: '#',
    },
    {
      icon: 'zap',
      title: 'Events and webhooks',
      text: 'leave.approved events reach payroll and the systems a company already uses.',
      href: '#',
    },
  ],
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
};
