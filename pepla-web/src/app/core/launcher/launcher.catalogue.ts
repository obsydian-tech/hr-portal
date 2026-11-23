import type { IconName } from '../../ds';
import { allowed, type Access, type NavEntry, type NavGroup, type Who } from '../nav';
import { PERM, ROLE } from '../roles';

/** MOD-03 rule 2: the module launcher's tiles, in the design system's fixed order. */
export type LauncherKey = 'records' | 'hire' | 'onboard' | 'leave' | 'comply' | 'help-desk' | 'perform';
export type LauncherState = 'open' | 'no-access' | 'not-on' | 'coming-soon';

export interface LauncherModule {
  key: LauncherKey;
  /** Name and one-line description: word for word from the approved public site (naleko-concept-d.html), "masked" read as "hidden". */
  name: string;
  description: string;
  icon: IconName;
  /** The sidebar group the module's first page lives in. */
  group: NavGroup;
  /** The key in the company's modules answer. Records needs none; a module that is not built has none either. */
  moduleKey?: string;
  built: boolean;
  /** Who may open it when the company has it. */
  access: Access;
  /** The public module page an Admin can read about a module the company has not switched on. */
  publicPage?: string;
}

export const LAUNCHER_MODULES: readonly LauncherModule[] = [
  { key: 'records', name: 'Employee Records', description: 'One record per employee. ID, bank and salary details hidden, every view logged.', icon: 'user', group: 'Records', built: true, access: {} },
  { key: 'hire', name: 'Recruitment', description: 'Candidates tracked from application to offer, with interview panels and stage reminders.', icon: 'briefcase', group: 'Hire', moduleKey: 'recruitment', built: true,
    access: { roles: [ROLE.hrStaff, ROLE.admin], perms: [PERM.recruitment] }, publicPage: '/product/recruitment' },
  { key: 'onboard', name: 'Onboarding and Offboarding', description: 'Offer accepted to day one. Documents read and matched, IT set up, every exit recorded.', icon: 'user-plus', group: 'Onboard', moduleKey: 'onboarding', built: true,
    access: { roles: [ROLE.hrStaff, ROLE.admin] }, publicPage: '/product/onboarding' },
  { key: 'leave', name: 'Leave Management', description: 'Requests, approvals and balances under BCEA leave rules.', icon: 'calendar-days', group: 'Leave', built: false, access: {} },
  { key: 'comply', name: 'Compliance Management', description: 'Certificates and licences tracked to their expiry date, with renewals followed up.', icon: 'shield-check', group: 'Comply', built: false, access: {} },
  { key: 'help-desk', name: 'HR Help Desk', description: 'Employee questions in one queue, answered from company policy.', icon: 'life-buoy', group: 'Help desk', built: false, access: {} },
  { key: 'perform', name: 'Performance Management', description: 'Goals, reviews and probation outcomes on the employee record.', icon: 'target', group: 'Perform', built: false, access: {} },
];

/** Approved words (Decision D-WORDS-MOD3). */
export const LAUNCHER_WORDS = { title: 'Modules', noAccess: 'No access', notOn: 'Not switched on', askAdmin: 'Ask an Admin.', myDetails: 'My details', comingSoon: 'Coming soon', askBatsi: 'Ask Batsi' } as const;

/** NOT in the approved words (D-WORDS-MOD3): the Admin's link on a Not switched on tile. Recommended wording from the site's own "Learn more about <module>" lines, logged in PIPELINE-DECISIONS.md. Iggie can change it. */
export const LEARN_MORE = 'Learn more about';

/**
 * Rule 3: the state of one tile. Fails closed: a module the company's answer does not hold (unknown, failed or not yet answered) is
 * Not switched on, whoever asks. Employee Records needs no module. A module that is not built is Coming soon for everyone.
 */
export function stateOf(m: LauncherModule, who: Who): LauncherState {
  if (!m.built) return 'coming-soon';
  if (m.moduleKey && !who.modules.has(m.moduleKey)) return 'not-on';
  return allowed({ roles: m.access.roles, perms: m.access.perms }, who) ? 'open' : 'no-access';
}

/** An employee's own Records tile reads "My details" (they open only their own pages). */
export function nameOf(m: LauncherModule, who: Who): string {
  return m.key === 'records' && !who.roles.includes(ROLE.hrStaff) && !who.roles.includes(ROLE.admin) ? LAUNCHER_WORDS.myDetails : m.name;
}

/** Rule 3, Open: the module's first page, the first sidebar entry the person may see in its group; else the person's own first page. */
export function firstPage(m: LauncherModule, entries: readonly NavEntry[], who: Who, landing: string): string {
  const mine = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.group === m.group && allowed(e, who))
    .sort((a, b) => (a.e.order ?? 0) - (b.e.order ?? 0) || a.i - b.i)[0];
  return mine?.e.route ?? landing;
}
