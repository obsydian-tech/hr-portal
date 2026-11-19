import type { LearnDemoText, LearnEnding, LearnTab, LearnTop } from '../learn.types';

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
  lead: 'Naleko People keeps one hiring board per role. Panels score candidates against the same criteria, and Batsi watches each stage for candidates who go quiet.',
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

/** The words of the Recruitment page's five demo sections, beside each demo's panel (kit "Recruitment page", "Site Recruitment demos"). */
export const RECRUITMENT_DEMOS: Record<'board' | 'score' | 'follow' | 'risk' | 'offer', LearnDemoText> = {
  board: {
    eyebrow: 'Hiring board',
    title: 'One hiring board per role, six stages.',
    lead: 'Applied, Screening, Interview, Offer, Hired and Not hired. Candidates move across the board and every move is recorded with a reason.',
    points: [
      { text: 'One board for each open role' },
      { text: 'Every move recorded with who made it and why' },
      { text: 'Not hired always carries a reason' },
      { text: 'Candidate details open from the card, sensitive data hidden' },
      { text: 'Counts per stage update as candidates move' },
    ],
  },
  score: {
    eyebrow: 'Interview panels',
    title: 'Every panel member scores against the same criteria.',
    lead: 'Panel members score each candidate on the criteria set for the role. Scores are combined on one sheet. Scores inform the decision. They never make it.',
    points: [
      { text: 'Scoring criteria set per role' },
      { text: 'Each panel member scores on their own' },
      { text: 'Average per criterion and overall' },
      { text: 'No candidate is rejected automatically' },
      { text: 'Decision recorded with the name of the person who made it' },
    ],
  },
  follow: {
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
  risk: {
    eyebrow: 'Candidate risk',
    title: 'Candidates at risk of dropping out are flagged early.',
    lead: 'Batsi flags candidates who go quiet, miss an interview or have an offer close to expiry. Each flag shows the reason and a suggested next step for HR.',
    points: [
      { text: 'No reply for a set number of days', batsi: true },
      { text: 'Missed or unconfirmed interviews', batsi: true },
      { text: 'Offers close to expiry', batsi: true },
      { text: 'Flags are advice. HR decides every action' },
      { text: 'Thresholds set per company' },
    ],
  },
  offer: {
    eyebrow: 'Offer to onboarding',
    title: 'A signed offer starts onboarding with no retyping.',
    lead: 'When an offer is signed, the candidate moves to Hired and an employee record is created with the details already captured. Onboarding opens and HR is told.',
    points: [
      { text: 'Offer letter from the company template' },
      { text: 'Offer expiry tracked and reminded' },
      { text: 'Name, role and start date carried to the employee record' },
      { text: 'Salary stays hidden on screen' },
      { text: 'Onboarding opens on its own' },
    ],
  },
};

/** The Recruitment page's sub-menu: one tab per section, in the order of the page; the last is the questions. */
export const RECRUITMENT_TABS: readonly LearnTab[] = [
  { id: 'hiring-board', label: 'Hiring board' },
  { id: 'panels', label: 'Interview panels' },
  { id: 'follow-ups', label: 'Reminders and follow-ups' },
  { id: 'risk', label: 'Candidate risk' },
  { id: 'questions', label: 'Questions' },
];

/** The one link the Recruitment page's demos carry: under the last demo's list, to the page that picks up where it ends (kit "Recruitment page"). */
export const RECRUITMENT_OFFER_LINK: { text: string; href: string } = { text: 'Learn more about Onboarding and Offboarding', href: '#' };
