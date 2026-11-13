import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** HR pages: signed-out people go to sign-in, and come back to the page they asked for. */
export const hrGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.restore();
  if (auth.isHr()) return true;
  return router.createUrlTree(['/sign-in'], state.url === '/' ? {} : { queryParams: { returnUrl: state.url } });
};

/** The sign-in page: someone already signed in as HR goes on to HR home. */
export const signedOutGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.restore();
  return auth.isHr() ? router.createUrlTree(['/hr']) : true;
};
