import type { LearnEnding, LearnTop } from '../learn.types';

/** The Platform page's top: the words of the kit's "Learn more top: Platform" (the hero card is the page's own). */
export const PLATFORM_TOP: LearnTop = {
  crumb: [
    { label: 'Home', href: '#' },
    { label: 'Product', href: '#' },
    { label: 'Platform' },
  ],
  eyebrow: 'Platform',
  title: 'One app.',
  shine: 'Modules switched on per company.',
  lead: 'Naleko People is one app with one sign-in. Naleko switches on the modules each company needs after the onboarding call. The sidebar, the Today list and each role’s access follow those settings.',
  chips: ['One sign-in', 'Modules per company', 'Roles and access'],
  rings: false,
};

/** The Platform page's ending: Ask Batsi, the trust strip, "Works together with" and the questions, as in the kit's "Learn more ending: Platform". */
export const PLATFORM_ENDING: LearnEnding = {
  ask: {
    key: 'platform',
    title: 'Ask Batsi across every module.',
    lead: 'One assistant works across the modules switched on for the company. Answers follow the role of the person asking.',
    questions: [
      {
        q: 'What needs my attention today?',
        a: 'Three items need Jane Smith today.',
        rows: [
          ['Leave Management · 1 request to approve', 'warning', 'Waiting'],
          ['Compliance · John Doe forklift licence', 'warning', '9 days'],
          ['Onboarding · John Doe, 2 documents left', '', 'Open'],
        ],
      },
      {
        q: 'Which modules are switched on?',
        a: 'Five modules are on for this company.',
        rows: [
          ['Employee Records', 'success', 'On'],
          ['Recruitment', 'success', 'On'],
          ['Onboarding and Offboarding', 'success', 'On'],
          ['Leave Management', 'success', 'On'],
          ['Compliance Management', 'success', 'On'],
        ],
      },
      {
        q: 'Who can see salary?',
        a: 'HR and the Administrator. It is hidden, and each Show is logged.',
        rows: [
          ['HR', 'warning', 'Hidden'],
          ['Administrator', 'warning', 'Hidden'],
          ['Manager', '', 'Not shown'],
        ],
      },
    ],
  },
  strip: {
    label: 'Trust',
    items: [
      { icon: 'check', text: 'A person approves every action' },
      { icon: 'file-text', text: 'Every change logged' },
      { icon: 'lock', text: 'Built for POPIA' },
      { icon: 'map-pin', text: 'All data stays in South Africa' },
    ],
    link: { text: 'Security and POPIA', href: '#' },
  },
  related: [
    {
      icon: 'rocket',
      title: 'Onboarding and Offboarding',
      text: 'Checklists and document lists come from templates.',
      href: '#',
    },
    {
      icon: 'calendar-days',
      title: 'Leave Management',
      text: 'Leave types and holidays start with South African defaults.',
      href: '#',
    },
    {
      icon: 'shield-check',
      title: 'Security and POPIA',
      text: 'Roles, hidden data and the audit log apply across every module.',
      href: '#',
    },
  ],
  faq: {
    lead: 'Modules, templates and roles are set during the onboarding call. Every company gets one before modules are switched on.',
    link: { text: 'Book a demo', href: '#' },
    items: [
      {
        q: 'Who switches modules on?',
        a: 'The Naleko team, after the onboarding call. Every company gets a call before modules are switched on, and each change is logged.',
      },
      {
        q: 'What does a new company start with?',
        a: 'A company account with no modules. Employee Records come with every company, and the other modules are switched on as needed.',
      },
      {
        q: 'Is it one app or one app per module?',
        a: 'One app with one sign-in. The sidebar and the Today list show the modules switched on for the company and the role of the person signed in.',
      },
      {
        q: 'Can a company change its checklists and hiring stages?',
        a: 'Yes. Hiring stages, onboarding checklists and document lists are templates that HR edits in Settings, without code.',
      },
      {
        q: 'Which roles are there?',
        a: 'Administrator, HR, Manager, Employee and Guest. Each role sees only its own modules and records.',
      },
      {
        q: 'Can a company add its own logo and colour?',
        a: 'Yes. The Administrator adds the company logo and colour in Settings. “Powered by Naleko People” stays on the page.',
      },
    ],
  },
};
