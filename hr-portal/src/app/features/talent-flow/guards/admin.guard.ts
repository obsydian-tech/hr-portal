import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TalentFlowAuthService } from '../services/talent-flow-auth.service';

/**
 * adminGuard — functional route guard (Angular 19 CanActivateFn pattern).
 *
 * Protects all /talent-flow/config/* routes. Non-admin users are authenticated
 * TalentFlow users — they are redirected to the TalentFlow pipeline dashboard,
 * NOT to /login (they have a valid session, just insufficient privilege).
 *
 * isAdmin() reads custom:isAdmin claim injected by the talentFlowPreTokenTrigger
 * Lambda in the TalentFlow Cognito pool. Always sourced from the live JWT —
 * never from local storage or component state.
 *
 * Usage (wired in FE-006 talent-flow.routes.ts):
 *   { path: 'config/scoring', component: ScoringWeightsPageComponent, canActivate: [adminGuard] }
 */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(TalentFlowAuthService);
  const router = inject(Router);

  if (auth.isAdmin()) return true;

  // Authenticated but not admin — redirect to TalentFlow dashboard
  return router.createUrlTree(['/talent-flow']);
};
