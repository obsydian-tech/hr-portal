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

/** The sign-in page: someone already signed in as HR goes on to HR home. */
export const signedOutGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.restore();
  if (auth.isHr()) return router.createUrlTree(['/hr']);
  if (auth.isEmployee()) return router.createUrlTree(['/start']);
  return true;
};

/** ONB-17: the employee's own pages. HR goes to HR home; nobody signed in goes to sign-in. */
export const employeeGuard: CanActivateFn = accessGuard({ roles: ['employee'] }, { returnUrl: false });
