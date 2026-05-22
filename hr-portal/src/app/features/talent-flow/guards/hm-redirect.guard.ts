import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TalentFlowAuthService } from '../services/talent-flow-auth.service';
import { AuthService } from '../../../core/services/auth.service';

/**
 * hmRedirectGuard — redirects pure HiringManager users away from the TA dashboard.
 * Admins are NOT redirected (they retain full TA view regardless of group membership).
 * Apply to the `path: ''` (TA dashboard) route only.
 */
export const hmRedirectGuard: CanActivateFn = () => {
  const tfAuth     = inject(TalentFlowAuthService);
  const nalekoAuth = inject(AuthService);
  const router     = inject(Router);

  const tfUser     = tfAuth.currentUser();
  const nalekoUser = nalekoAuth.currentUser();

  // TF pool: user is in HiringManager group and not admin
  const isTfHM = (tfUser?.groups.includes('HiringManager') ?? false) && !(tfUser?.isAdmin ?? false);
  // Naleko pool: user is in naleko-talentflow-hiringmanager and not a TF admin
  const isNalekoAdmin = nalekoUser?.groups.includes('naleko-talentflow-admin') ?? false;
  const isNalekoHM = (nalekoUser?.groups.includes('naleko-talentflow-hiringmanager') ?? false) && !isNalekoAdmin;

  if (isTfHM || isNalekoHM) {
    return router.createUrlTree(['/platform/talentflow/hm-dashboard']);
  }
  return true;
};
