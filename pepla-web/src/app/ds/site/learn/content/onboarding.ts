import type { LearnEnding, LearnTop } from '../learn.types';

/** The Onboarding page's top: the words of the kit's "Learn more top: Onboarding" (the hero card is the page's own). */
export const ONBOARDING_TOP: LearnTop = {
  crumb: [
    { label: 'Home', href: '#' },
    { label: 'Product', href: '#' },
    { label: 'Onboarding and Offboarding' },
  ],
  eyebrow: 'Onboarding and Offboarding',
  title: 'Offer accepted to day one,',
  shine: 'in one record.',
  lead: 'Naleko People moves every new employee through documents, checks, contract, equipment and day one, and closes every exit the same way. Each step has an owner and a due date.',
  chips: ['POPIA consent before upload', 'UIF and SARS details collected', 'Phone friendly'],
  rings: true,
};

/** The Onboarding page's ending: Ask Batsi, the trust strip, "Works together with" and the questions, as in the kit's "Learn more ending: Onboarding". */
export const ONBOARDING_ENDING: LearnEnding = {
  ask: {
    key: 'onboarding',
    title: 'Ask Batsi about any new employee.',
    lead: 'Answers come from the onboarding record. Every action Batsi suggests waits for HR.',
    questions: [
      {
        q: 'Who hasn’t sent their documents?',
        a: 'Two new employees are missing documents.',
        rows: [
          ['John Doe · UIF reference number', 'warning', '2 reminders sent'],
          ['Employee 3 · Matric certificate', 'brand', 'Requested today'],
        ],
        ask: 'Send John Doe another reminder now?',
        button: 'Send reminder',
        done: 'Reminder sent to John Doe at 10:05.',
        log: 'Approved by Jane Smith · logged',
      },
      {
        q: 'Who starts next week?',
        a: 'One new employee starts on Monday 1 December.',
        rows: [
          ['John Doe · Sales Consultant', 'success', 'Ready for day one'],
        ],
      },
      {
        q: 'Which laptops are not ready?',
        a: 'All laptops for December starts are ready. One request is open for January.',
        rows: [
          ['John Doe · laptop', 'success', 'Ready'],
          ['Employee 5 · laptop', 'brand', 'IT · due 9 Jan'],
        ],
      },
    ],
  },
  strip: {
    label: 'Trust',
    items: [
      { icon: 'check', text: 'A person approves every Batsi action' },
      { icon: 'file-text', text: 'Every view and decision logged' },
      { icon: 'lock', text: 'Built for POPIA' },
      { icon: 'map-pin', text: 'All data stays in South Africa' },
    ],
    link: { text: 'Security and POPIA', href: '#' },
  },
  related: [
    {
      icon: 'user-plus',
      title: 'Recruitment',
      text: 'Accepted offers start onboarding with no retyping.',
      href: '#',
    },
    {
      icon: 'scale',
      title: 'Compliance Management',
      text: 'Certificates collected at onboarding go straight onto the register.',
      href: '#',
    },
    {
      icon: 'users',
      title: 'Employee Records',
      text: 'Everything collected lands on one record, sensitive data hidden.',
      href: '#',
    },
  ],
  faq: {
    lead: 'More on the Onboarding call. Every company gets one before modules are switched on.',
    link: { text: 'Book a demo', href: '#' },
    items: [
      {
        q: 'Does Batsi accept documents on its own?',
        a: 'No. Batsi suggests a result with the reason. HR accepts the document or asks for a new one, and the decision is logged with HR’s name.',
      },
      {
        q: 'Can new employees upload from a phone?',
        a: 'Yes. The onboarding link works on any phone or computer. Files can be PDF, JPG or PNG, up to 5 MB.',
      },
      {
        q: 'What happens when a document doesn’t match?',
        a: 'It is marked Needs a look or Doesn’t match, and HR sees why. The new employee can be asked for a new one in one step.',
      },
      {
        q: 'Which documents are read?',
        a: 'South African ID documents, qualifications, bank confirmation letters and tax numbers.',
      },
      {
        q: 'Can the steps and checklists be changed?',
        a: 'Yes. Required documents, reminder schedules, contract templates and checklists are set per company during the Onboarding call.',
      },
      {
        q: 'How is personal information protected?',
        a: 'ID numbers, bank details and salary are hidden. Every view is logged, all data stays in South Africa, and processing is set out in the Privacy notice.',
      },
    ],
  },
};
