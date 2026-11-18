import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { legacyClaimsOf } from '../services/legacy-claims';

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

  const isAdmin = legacyClaimsOf(auth.currentUser()?.groups ?? []).isAdmin;
  if (isAdmin) return true;

  // Authenticated but not admin — redirect to TalentFlow dashboard
  return router.createUrlTree(['/platform/talentflow']);
};
