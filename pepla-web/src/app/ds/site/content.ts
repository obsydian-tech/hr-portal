import { IconName } from '../core/icon.registry';

/**
 * The words and link targets of the public site's chrome (header actions, menu, sheet, footer), copied word for
 * word from the design system's kit examples (project/components/site/site-header, site-sheet, site-footer).
 * A page may change a link target; the words stay. Targets are not decided yet (SITE-06 owns them), so a
 * target is the kit's own: a section on the landing page, or `#` where the kit has no destination.
 */
export const SITE_HOME = '/';
export const SITE_LOGIN = '/sign-in';
const SOON = '#';
/** A link that stays inside the app (a route) goes through the router; the others are plain links to a section or page. */
export const isInternal = (href: string): boolean => href.startsWith('/');

export interface SiteMenuEntry { name: string; hint?: string; icon: IconName; tone?: 'brand' | 'agent'; soon?: boolean; href: string }
export interface SiteMenuList { id: string; label: string; width: 'narrow' | 'medium' | 'wide'; entries: SiteMenuEntry[]; foot?: { text: string; link: string; href: string } }

export const SITE_MENU: readonly SiteMenuList[] = [
  {
    id: 'product', label: 'Product', width: 'wide',
    entries: [
      { name: 'Employee Records', hint: 'One record per employee, sensitive data hidden', icon: 'users', href: SOON },
      { name: 'Recruitment', hint: 'Candidates tracked from application to offer', icon: 'user-plus', href: SOON },
      { name: 'Onboarding and Offboarding', hint: 'Offer accepted to day one, and every exit', icon: 'rocket', href: SOON },
      { name: 'Leave Management', hint: 'Requests, approvals and balances', icon: 'calendar-days', href: SOON },
      { name: 'Compliance Management', hint: 'Certificates tracked to their expiry date', icon: 'scale', href: SOON },
      { name: 'HR Help Desk', hint: 'Employee questions in one queue', icon: 'life-buoy', soon: true, href: SOON },
      { name: 'Performance Management', hint: 'Goals, reviews and probation', icon: 'target', soon: true, href: SOON },
      { name: 'Platform', hint: 'Modules, templates and settings per company', icon: 'layout-grid', href: SOON },
    ],
    foot: { text: 'South Africa first: BCEA, UIF, SARS, POPIA', link: 'See it on a call', href: '#demo' },
  },
  {
    id: 'integrations', label: 'Integrations', width: 'medium',
    entries: [
      { name: 'API', hint: 'Per-company keys', icon: 'code', href: SOON },
      { name: 'MCP server', hint: 'For AI assistants', icon: 'sparkles', tone: 'agent', href: SOON },
      { name: 'Events and webhooks', hint: 'React to changes as they happen', icon: 'zap', href: SOON },
      { name: 'Payroll providers', icon: 'plug', soon: true, href: SOON },
      { name: 'Verification providers', icon: 'shield-check', soon: true, href: SOON },
    ],
  },
  {
    id: 'resources', label: 'Resources', width: 'narrow',
    entries: [
      { name: 'Help centre', hint: 'Guides with pictures and short videos', icon: 'life-buoy', href: SOON },
      { name: 'Security and POPIA', hint: 'Approvals, audit and personal data', icon: 'shield-check', href: SOON },
      { name: 'Developer documentation', hint: 'API and MCP reference', icon: 'code', href: SOON },
    ],
  },
  {
    id: 'company', label: 'Company', width: 'narrow',
    entries: [
      { name: 'About Naleko Digital Solutions', hint: 'Who builds Naleko People', icon: 'building-2', href: SOON },
      { name: 'Contact', hint: 'Talk to the team', icon: 'mail', href: SOON },
    ],
  },
];

/** "Ask Batsi" sits between Product and Integrations as a plain link to the Batsi band on the home page. */
export const SITE_MENU_BATSI = { label: 'Ask Batsi', href: '#batsi' };
/** Its place in the row: after this many lists. */
export const SITE_MENU_BATSI_AFTER = 1;

export const SITE_ACTIONS = {
  login: 'Log in',
  secondary: { label: 'Get started', href: '#get-started' },
  primary: { label: 'Book a demo', href: '#demo' },
  openMenu: 'Open menu',
  closeMenu: 'Close menu',
  skip: 'Skip to content',
};

export interface SiteLink { name: string; soon?: boolean; href: string }
export const SITE_SHEET: readonly { heading: string; links: SiteLink[] }[] = [
  { heading: 'Product', links: SITE_MENU[0].entries.map((e) => ({ name: e.name, soon: e.soon, href: e.href })) },
  { heading: 'More', links: [
    { name: 'Ask Batsi', href: SOON }, { name: 'Integrations', href: SOON }, { name: 'Resources', href: SOON }, { name: 'Company', href: SOON },
    { name: 'Log in', href: SITE_LOGIN },
  ] },
];

export const SITE_FOOTER = {
  about: 'HR administration for South African companies: hiring, onboarding, leave and compliance in one app, with Ask Batsi built in.',
  pin: 'All data stays in South Africa',
  columns: [
    { heading: 'Product', links: SITE_MENU[0].entries.map((e) => ({ name: e.name, soon: e.soon, href: SOON })) },
    { heading: 'Ask Batsi', links: [{ name: 'What Batsi answers', href: SOON }, { name: 'Approvals and audit', href: SOON }] },
    { heading: 'Integrations', links: SITE_MENU[1].entries.map((e) => ({ name: e.name, soon: e.soon, href: SOON })) },
    { heading: 'Resources', links: SITE_MENU[2].entries.map((e) => ({ name: e.name, href: SOON })) },
    { heading: 'Company', links: [
      { name: 'About Naleko Digital Solutions', href: SOON }, { name: 'Contact', href: SOON },
      { name: 'Book a demo', href: '#demo' }, { name: 'Get started', href: '#get-started' }, { name: 'Log in', href: SITE_LOGIN },
    ] },
  ] as { heading: string; links: SiteLink[] }[],
  copy: '© 2026 Naleko Digital Solutions',
  legal: [{ name: 'Privacy notice', href: SOON }, { name: 'Terms of use', href: SOON }, { name: 'PAIA manual', href: SOON }, { name: 'Cookie notice', href: SOON }] as SiteLink[],
};
