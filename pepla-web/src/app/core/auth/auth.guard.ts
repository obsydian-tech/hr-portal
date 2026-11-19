import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { allowed, landingFor, type Access } from '../nav';
import { ModulesService } from '../modules.service';
import { rolesOf } from '../roles';

/** One guard for routes (MOD-02 rule 5): the same test as the sidebar. A person who fails it goes to their first page. */
export function accessGuard(need: Access, opts: { returnUrl?: boolean } = {}): CanActivateFn {
  return async (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const modules = inject(ModulesService);
    await auth.restore();
    const user = auth.user();
    if (!user) return router.createUrlTree(['/sign-in'], state.url === '/' || opts.returnUrl === false ? {} : { queryParams: { returnUrl: state.url } });
    if (need.module) await modules.ensure(router.getCurrentNavigation()?.id ?? -2);
    const { roles, perms } = rolesOf(user.groups);
    const set = modules.modules();
    if (allowed(need, { roles, perms, modules: set })) return true;
    return router.createUrlTree([landingFor(roles, perms, [...set])]);
  };
}

/** HR pages: signed-out people go to sign-in, and come back to the page they asked for. */
export const hrGuard: CanActivateFn = accessGuard({ roles: ['hr_staff'] });

/** The sign-in page: someone already signed in goes on to their first page (the table in core/nav.ts). */
export const signedOutGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.restore();
  const user = auth.user();
  if (!user) return true;
  const { roles, perms } = rolesOf(user.groups);
  const to = landingFor(roles, perms, []);
  return to === '/sign-in' ? true : router.createUrlTree([to]);
};

/** CHAT-03: the Admin area. Only the `admin` role of the person's own company; the server refuses anyone else as well. */
export const adminGuard: CanActivateFn = accessGuard({ roles: ['admin'] });

/** ONB-17: the employee's own pages. HR goes to HR home; nobody signed in goes to sign-in. */
export const employeeGuard: CanActivateFn = accessGuard({ roles: ['employee'] }, { returnUrl: false });
