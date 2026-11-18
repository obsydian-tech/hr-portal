import { signal } from '@angular/core';
import type { IconName, NavSection } from '../ds';
import { ROLE } from './roles';

export const GROUPS = ['Today', 'Records', 'Hire', 'Onboard', 'Leave', 'Comply', 'Help desk', 'Perform', 'Settings'] as const;
export type NavGroup = (typeof GROUPS)[number];
export type Access = { module?: string; roles?: readonly string[]; perms?: readonly string[]; allOf?: readonly string[] };
export type NavEntry = Access & { id: string; group: NavGroup; label: string; icon: IconName; route: string; order?: number };
export type Who = { roles: readonly string[]; perms: readonly string[]; modules: ReadonlySet<string> };

/** Rule 4 and rule 5 in one place: the shell and the route guard ask the same question. */
export function allowed(a: Access, who: Who): boolean {
  if (a.module && !who.modules.has(a.module)) return false;
  if (a.allOf?.length && !a.allOf.every((g) => who.roles.includes(g) || who.perms.includes(g))) return false;
  const lists = [a.roles, a.perms].filter((l): l is readonly string[] => !!l?.length);
  if (!lists.length) return true;
  return (a.roles ?? []).some((r) => who.roles.includes(r)) || (a.perms ?? []).some((p) => who.perms.includes(p));
}

/** The first page for a person, a table. */
const LANDING: ReadonlyArray<{ role: string; to: string }> = [
  { role: ROLE.hrStaff, to: '/hr' },
  { role: ROLE.admin, to: '/hr' },
  { role: ROLE.employee, to: '/start' },
];
export function landingFor(roles: readonly string[], _perms: readonly string[], _modules: readonly string[]): string {
  return LANDING.find((l) => roles.includes(l.role))?.to ?? '/sign-in';
}

const registry = signal<NavEntry[]>([
  { id: 'hr-today', group: 'Today', label: 'Today', icon: 'house', route: '/hr', roles: [ROLE.hrStaff] },
  { id: 'hr-documents', group: 'Today', label: 'Documents to check', icon: 'files', route: '/hr/documents', roles: [ROLE.hrStaff] },
  { id: 'employee-today', group: 'Today', label: 'Today', icon: 'house', route: '/start', roles: [ROLE.employee] },
  { id: 'employee-onboarding', group: 'Today', label: 'My onboarding', icon: 'list-checks', route: '/start/onboarding', roles: [ROLE.employee] },
]);
export const navEntries = registry.asReadonly();
export function registerNav(entries: NavEntry[]): void {
  registry.update((r) => [...r, ...entries.filter((e) => !r.some((x) => x.id === e.id))]);
}

export function sectionsFor(entries: readonly NavEntry[], who: Who, count?: (e: NavEntry) => { count: number; countLabel: string } | null): NavSection[] {
  const sections: NavSection[] = [];
  for (const group of GROUPS) {
    const items = entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.group === group && allowed(e, who))
      .sort((a, b) => (a.e.order ?? 0) - (b.e.order ?? 0) || a.i - b.i)
      .map(({ e }) => ({ label: e.label, icon: e.icon, link: e.route, ...(count?.(e) ?? {}) }));
    if (items.length) sections.push(group === 'Today' ? { items } : { heading: group, items });
  }
  return sections;
}
