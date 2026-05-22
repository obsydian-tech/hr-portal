import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

/**
 * adminGuard — functional route guard (Angular 19 CanActivateFn pattern).
 *
 * Protects all /platform/talentflow/config/* routes.
 * Checks naleko-talentflow-admin group in the Naleko pool JWT.
 * (Pool consolidation Epic 5 — previously checked TF pool custom:isAdmin claim.)
 *
 * Non-admin users are redirected to the TalentFlow dashboard,
 * NOT to /login (they have a valid session, just insufficient privilege).
 */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const isAdmin = (auth.currentUser()?.groups ?? []).includes('naleko-talentflow-admin');
  if (isAdmin) return true;

  // Authenticated but not admin — redirect to TalentFlow dashboard
  return router.createUrlTree(['/platform/talentflow']);
};
