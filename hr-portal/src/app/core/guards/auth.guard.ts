import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Redirects unauthenticated users to /login.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;

  router.navigate(['/login']);
  return false;
};

/**
 * Allows only authenticated HR staff (hr_staff role).
 */
export const hrGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    router.navigate(['/login']);
    return false;
  }

  if (!auth.isHrStaff()) {
    // Authenticated but wrong role — redirect to their dashboard
    const user = auth.currentUser();
    if (user?.role === 'employee' && user.employeeId) {
      router.navigate(['/employees', user.employeeId]);
    } else {
      router.navigate(['/login']);
    }
    return false;
  }

  return true;
};

/**
 * Allows only authenticated employees (employee role).
 */
export const employeeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    router.navigate(['/login']);
    return false;
  }

  if (!auth.isEmployee()) {
    // Authenticated but wrong role — redirect to their dashboard
    const user = auth.currentUser();
    if (user?.role === 'hr_staff' && user.staffId) {
      router.navigate(['/hr', user.staffId]);
    } else {
      router.navigate(['/login']);
    }
    return false;
  }

  return true;
};

/**
 * Prevents already-authenticated users from seeing the login page.
 * Redirects HR staff to /platform/home, employees to their dashboard.
 */
export const loginPageGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) return true;

  const user = auth.currentUser();
  if (user?.role === 'hr_staff') {
    router.navigate(['/platform/home']);
  } else if (user?.role === 'employee' && user.employeeId) {
    router.navigate(['/employees', user.employeeId]);
  }

  return false;
};

/**
 * Guards a platform module route.
 * Pass the module key (e.g. 'onboarding', 'talentflow').
 * Redirects to /platform/home with a locked=true query param if access denied.
 */
export const moduleGuard = (module: string): CanActivateFn => () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    router.navigate(['/login']);
    return false;
  }

  if (auth.hasModule(module)) return true;

  router.navigate(['/platform/home'], { queryParams: { locked: module } });
  return false;
};
