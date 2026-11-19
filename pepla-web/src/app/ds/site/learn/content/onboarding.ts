import type { LearnDemoText, LearnEnding, LearnTab, LearnTop } from '../learn.types';

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

/** The Onboarding page's demos: the words beside each sample panel, as in the kit's "Onboarding page" (`data-demo`: phone, read, follow, contract, laptop, exit). */
export const ONBOARDING_DEMOS: Record<'phone' | 'read' | 'follow' | 'contract' | 'laptop' | 'exit', LearnDemoText> = {
  phone: {
    eyebrow: "New employee's side",
    title: 'New employees finish their paperwork from a phone.',
    lead: "An email link opens the new employee's own onboarding page. No app to install and no password to remember.",
    points: [
      { text: 'Secure link to a personal onboarding page' },
      { text: 'POPIA consent before the first upload' },
      { text: 'PDF, JPG or PNG, up to 5 MB' },
      { text: 'Live status on each document as it is read' },
      { text: 'Clear message when a file is too large, blurry or cropped' },
      { text: 'Ask Batsi for help with any document', batsi: true },
    ],
  },
  read: {
    eyebrow: 'Documents read and matched',
    title: 'Batsi reads every document. HR makes every decision.',
    lead: 'Naleko People reads ID documents, qualifications and bank letters as they are uploaded, fills the employee record and checks each detail against it. HR accepts the document or asks for a new one.',
    points: [
      { text: '13-digit ID number present, date of birth matches it' },
      { text: 'Gender and citizenship digits valid' },
      { text: 'Name and surname match the record' },
      { text: 'Bank letter matches the account holder' },
      { text: "Matches, Needs a look or Doesn't match, with the reason", batsi: true },
      { text: 'Every decision logged with who made it' },
    ],
  },
  follow: {
    eyebrow: 'Follow-ups',
    title: 'Missing documents are chased until they arrive.',
    lead: 'Batsi asks again for anything missing or unclear, on a set schedule. When nothing arrives, HR is told.',
    points: [
      { text: 'Missing or unclear documents requested again', batsi: true },
      { text: "Reminders on the company's schedule", batsi: true },
      { text: 'HR told when nothing arrives' },
      { text: 'One list of who is waiting on what' },
    ],
  },
  contract: {
    eyebrow: 'Contract and probation',
    title: 'Contracts come from the company template and are signed online.',
    lead: 'Naleko People fills the contract from the employee record, sends it for signature and stores the signed copy on the record. Probation dates are set at the same time.',
    points: [
      { text: 'Contract templates per company and role' },
      { text: 'Details filled from the record, no retyping' },
      { text: 'Signed online, signed copy stored on the record' },
      { text: 'Salary hidden on screen' },
      { text: 'Probation end date with a reminder to confirm or extend probation' },
    ],
  },
  laptop: {
    eyebrow: 'Laptop and access',
    title: 'Laptop, email and access ready before day one.',
    lead: 'IT requests go out as soon as the contract is signed, each with an owner and a due date. The manager gets the first-day checklist.',
    points: [
      { text: 'IT requests with an owner and a due date' },
      { text: 'Requests closed by IT inside Naleko People' },
      { text: "Manager's first-day checklist" },
      { text: 'Checklists and templates set per company' },
    ],
  },
  exit: {
    eyebrow: 'Offboarding',
    title: 'Every exit closed off the same way.',
    lead: 'An exit checklist opens when a last working day is set. Access removal and equipment returns are tracked, and the final documents stay on the record.',
    points: [
      { text: 'Exit checklist per person' },
      { text: 'Access removed and equipment returned, tracked' },
      { text: 'Certificate of service issued' },
      { text: 'Exit record kept on the employee record' },
    ],
  },
};

/** The sub-menu of the Onboarding page, in the order of the page; the last tab is the questions. The first tab has the typographic apostrophe (the demo's own label has the straight one, as in the kit). */
export const ONBOARDING_TABS: readonly LearnTab[] = [
  { id: 'employee', label: 'New employee’s side' },
  { id: 'documents', label: 'Documents read and matched' },
  { id: 'follow-ups', label: 'Follow-ups' },
  { id: 'contract', label: 'Contract and probation' },
  { id: 'laptop', label: 'Laptop and access' },
  { id: 'offboarding', label: 'Offboarding' },
  { id: 'questions', label: 'Questions' },
];
