/**
 * MOD-03 · the stored copy of the approved public site's module cards (landing-concepts/naleko-concept-d.html, lines 873-879),
 * as the Deviation table has it: Iggie's word rule "Hidden, never masked" (13 Nov 20:53) is applied to the Employee Records line.
 * Every test that checks a tile's words reads this table. Nothing here is new copy.
 */

export type Key = 'ask-batsi' | 'records' | 'hire' | 'onboard' | 'leave' | 'comply' | 'help-desk' | 'perform';
export type State = 'open' | 'no-access' | 'not-on' | 'coming-soon';

/** The tiles in the order the launcher draws them (rule 2): Ask Batsi first, then the seven modules. */
export const ORDER: Key[] = ['ask-batsi', 'records', 'hire', 'onboard', 'leave', 'comply', 'help-desk', 'perform'];

export const MODULE_COPY: Record<Exclude<Key, 'ask-batsi'>, { name: string; description: string }> = {
  records: { name: 'Employee Records', description: 'One record per employee. ID, bank and salary details hidden, every view logged.' },
  hire: { name: 'Recruitment', description: 'Candidates tracked from application to offer, with interview panels and stage reminders.' },
  onboard: { name: 'Onboarding and Offboarding', description: 'Offer accepted to day one. Documents read and matched, IT set up, every exit recorded.' },
  leave: { name: 'Leave Management', description: 'Requests, approvals and balances under BCEA leave rules.' },
  comply: { name: 'Compliance Management', description: 'Certificates and licences tracked to their expiry date, with renewals followed up.' },
  'help-desk': { name: 'HR Help Desk', description: 'Employee questions in one queue, answered from company policy.' },
  perform: { name: 'Performance Management', description: 'Goals, reviews and probation outcomes on the employee record.' },
};

/** Approved words (Decision D-WORDS-MOD3, Iggie 17 Nov 13:15 SAST). */
export const WORDS = {
  launcher: 'Modules',
  noAccess: 'No access',
  notOn: 'Not switched on',
  askAdmin: 'Ask an Admin.',
  myDetails: 'My details',
  comingSoon: 'Coming soon',
  askBatsi: 'Ask Batsi',
} as const;

/** The module keys the company's modules answer uses (MOD-01's MODULE_KEYS). Records needs none. Leave, Comply, Help desk and Perform have none yet. */
export const MODULE_KEY: Partial<Record<Key, string>> = { hire: 'recruitment', onboard: 'onboarding' };
export const NOT_BUILT: Key[] = ['leave', 'comply', 'help-desk', 'perform'];

/** Where an Admin's link on a "Not switched on" tile goes: the public module page, by its path on the approved site. */
export const PUBLIC_PAGE: Partial<Record<Key, string>> = { hire: '/recruitment', onboard: '/onboarding' };
