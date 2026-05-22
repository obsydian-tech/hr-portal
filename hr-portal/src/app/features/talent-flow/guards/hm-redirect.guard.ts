import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TalentFlowAuthService } from '../services/talent-flow-auth.service';

/**
 * hmRedirectGuard — redirects pure HiringManager users away from the TA dashboard.
 * Admins are NOT redirected (they retain full TA view regardless of group membership).
 * Apply to the `path: ''` (TA dashboard) route only.
 */
export const hmRedirectGuard: CanActivateFn = () => {
  const auth   = inject(TalentFlowAuthService);
  const router = inject(Router);
  const user   = auth.currentUser();

  if (user && user.groups.includes('HiringManager') && !user.isAdmin) {
    return router.createUrlTree(['/platform/talentflow/hm-dashboard']);
  }
  return true;
};
