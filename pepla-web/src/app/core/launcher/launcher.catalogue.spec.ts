import { LAUNCHER_MODULES, firstPage, nameOf, stateOf, type LauncherKey, type LauncherModule } from './launcher.catalogue';
import type { NavEntry, Who } from '../nav';

const mod = (key: LauncherKey): LauncherModule => LAUNCHER_MODULES.find((m) => m.key === key)!;
const who = (roles: string[], modules: string[] = [], perms: string[] = []): Who => ({ roles, perms, modules: new Set(modules) });

describe('launcher catalogue (MOD-03)', () => {
  it('lists the seven modules in the design system order', () => {
    expect(LAUNCHER_MODULES.map((m) => m.key)).toEqual(['records', 'hire', 'onboard', 'leave', 'comply', 'help-desk', 'perform']);
  });

  it('fails closed: with no modules known, Hire and Onboard are Not switched on and Records stays open', () => {
    const nobody = who(['hr_staff']);
    expect(stateOf(mod('records'), nobody)).toBe('open');
    expect(stateOf(mod('hire'), nobody)).toBe('not-on');
    expect(stateOf(mod('onboard'), nobody)).toBe('not-on');
  });

  it('gives each person the card matrix', () => {
    const company = ['recruitment', 'onboarding'];
    expect(['hire', 'onboard'].map((k) => stateOf(mod(k as LauncherKey), who(['hr_staff'], company)))).toEqual(['no-access', 'open']);
    expect(['hire', 'onboard'].map((k) => stateOf(mod(k as LauncherKey), who(['hr_staff'], company, ['perm-recruitment'])))).toEqual(['open', 'open']);
    expect(['hire', 'onboard'].map((k) => stateOf(mod(k as LauncherKey), who(['hr_staff'], company, ['perm-it'])))).toEqual(['no-access', 'open']);
    expect(['hire', 'onboard'].map((k) => stateOf(mod(k as LauncherKey), who(['employee'], company)))).toEqual(['no-access', 'no-access']);
    expect(['hire', 'onboard'].map((k) => stateOf(mod(k as LauncherKey), who(['employee'], company, ['perm-recruitment'])))).toEqual(['no-access', 'no-access']);
    expect(['hire', 'onboard'].map((k) => stateOf(mod(k as LauncherKey), who(['admin'], company)))).toEqual(['no-access', 'open']);
    expect(stateOf(mod('hire'), who(['admin'], company, ['perm-recruitment']))).toBe('no-access');
    expect(stateOf(mod('hire'), who(['hr_staff'], ['onboarding'], ['perm-recruitment']))).toBe('not-on');
    expect(stateOf(mod('hire'), who(['employee'], ['onboarding'], ['perm-recruitment']))).toBe('not-on');
  });

  it('shows Coming soon for every module that is not built, whoever asks', () => {
    for (const k of ['leave', 'comply', 'help-desk', 'perform'] as const) expect(stateOf(mod(k), who(['admin'], ['recruitment', 'onboarding']))).toBe('coming-soon');
  });

  it('names an employee\'s Records tile "My details"', () => {
    expect(nameOf(mod('records'), who(['employee']))).toBe('My details');
    expect(nameOf(mod('records'), who(['hr_staff']))).toBe('Employee Records');
  });

  it('goes to the first entry of the group the person may see, else their own first page', () => {
    const entries: NavEntry[] = [
      { id: 'b', group: 'Hire', label: 'Pipeline', icon: 'columns-3', route: '/hire/pipeline', order: 2, module: 'recruitment', roles: ['hr_staff'] },
      { id: 'a', group: 'Hire', label: 'Roles', icon: 'briefcase', route: '/hire/roles', order: 1, module: 'recruitment', roles: ['hr_staff'] },
    ];
    expect(firstPage(mod('hire'), entries, who(['hr_staff'], ['recruitment']), '/hr')).toBe('/hire/roles');
    expect(firstPage(mod('hire'), entries, who(['employee'], ['recruitment']), '/start')).toBe('/start');
  });
});
