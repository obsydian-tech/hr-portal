import type { LearnEnding, LearnTop } from '../learn.types';

/** The Recruitment page's top: the words of the kit's "Learn more top: Recruitment" (the hero card is the page's own). */
export const RECRUITMENT_TOP: LearnTop = {
  crumb: [
    { label: 'Home', href: '#' },
    { label: 'Product', href: '#' },
    { label: 'Recruitment' },
  ],
  eyebrow: 'Recruitment',
  title: 'Every candidate tracked',
  shine: 'from application to signed offer.',
  lead: 'Naleko People keeps one hiring board per role. Panels score candidates against the same criteria, Batsi watches each stage for candidates who go quiet, and a signed offer starts onboarding with no retyping.',
  chips: ['Six hiring stages', 'Scored by panels', 'No automatic rejection'],
  rings: true,
};

/** The Recruitment page's ending: Ask Batsi, the trust strip, "Works together with" and the questions, as in the kit's "Learn more ending: Recruitment". */
export const RECRUITMENT_ENDING: LearnEnding = {
  ask: {
    key: 'recruitment',
    title: 'Ask Batsi about any open role.',
    lead: 'Answers come from the hiring boards. Every action Batsi suggests waits for HR.',
    questions: [
      {
        q: 'Which candidates have gone quiet?',
        a: 'Two candidates have not replied.',
        rows: [
          ['Candidate 3 · Interview', 'warning', 'No reply in 5 days'],
          ['Candidate 6 · Screening', 'warning', 'Missed interview'],
        ],
        ask: 'Send Candidate 3 a reminder about Thursday?',
        button: 'Send reminder',
        done: 'Reminder sent to Candidate 3 at 09:42.',
        log: 'Approved by Jane Smith · logged',
      },
      {
        q: 'Who still owes interview feedback?',
        a: 'One interviewer has feedback outstanding.',
        rows: [
          ['Candidate 2 · Panel 3', 'warning', 'Feedback 2 of 3'],
        ],
        ask: 'Remind Panel 3 to submit feedback?',
        button: 'Send reminder',
        done: 'Reminder sent to Panel 3 at 09:44.',
        log: 'Approved by Jane Smith · logged',
      },
      {
        q: 'Which offers expire this week?',
        a: 'One offer expires on Friday.',
        rows: [
          ['Candidate 1 · Sales Consultant', 'warning', 'Expires Fri'],
        ],
      },
    ],
  },
  strip: {
    label: 'Trust',
    items: [
      { icon: 'check', text: 'A person makes every hiring decision' },
      { icon: 'file-text', text: 'Every move and view logged' },
      { icon: 'lock', text: 'Built for POPIA' },
      { icon: 'map-pin', text: 'All data stays in South Africa' },
    ],
    link: { text: 'Security and POPIA', href: '#' },
  },
  related: [
    {
      icon: 'rocket',
      title: 'Onboarding and Offboarding',
      text: 'A signed offer opens onboarding with the details already captured.',
      href: '#',
    },
    {
      icon: 'users',
      title: 'Employee Records',
      text: 'Every hire lands on one record, sensitive data hidden.',
      href: '#',
    },
    {
      icon: 'code',
      title: 'API and MCP server',
      text: 'Hiring events and candidate data reach the systems a company already uses.',
      href: '#',
    },
  ],
  faq: {
    lead: 'More on Recruitment is covered on the onboarding call. Every company gets one before modules are switched on.',
    link: { text: 'Book a demo', href: '#' },
    items: [
      {
        q: 'Does Batsi reject candidates?',
        a: 'No. No candidate is rejected automatically. Scores and risk flags are advice, and every move to Not hired is made by a person with a reason recorded.',
      },
      {
        q: 'What are the hiring stages?',
        a: 'Applied, Screening, Interview, Offer, Hired and Not hired. Every move is recorded with who made it and why.',
      },
      {
        q: 'Can scoring criteria and reminders be changed?',
        a: 'Yes. Scoring criteria, panel sizes and reminder timings are set per company during the onboarding call.',
      },
      {
        q: 'What happens when an offer is signed?',
        a: 'The candidate moves to Hired, an employee record is created with the details already captured, and onboarding opens. HR is notified.',
      },
      {
        q: 'Who can see candidate details?',
        a: 'Access follows the role a person has in the company. Sensitive details are hidden, every view is logged, and all data stays in South Africa.',
      },
    ],
  },
};
