import { Routes } from '@angular/router';
import { hrGuard, employeeGuard, loginPageGuard, authGuard, moduleGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/landing/landing.component').then((m) => m.LandingComponent),
  },
  {
    path: 'login',
    canActivate: [loginPageGuard],
    loadComponent: () =>
      import('./features/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'hr/:staffId',
    canActivate: [hrGuard],
    loadComponent: () =>
      import('./features/hr-dashboard/hr-dashboard.component').then(
        (m) => m.HrDashboardComponent
      ),
    children: [
      {
        path: '',
        loadComponent: () =>
          import(
            './features/hr-dashboard/components/hr-dashboard-home/hr-dashboard-home.component'
          ).then((m) => m.HrDashboardHomeComponent),
      },
      {
        path: 'new-employee',
        loadComponent: () =>
          import(
            './features/hr-dashboard/components/new-employee-registration/new-employee-registration.component'
          ).then((m) => m.NewEmployeeRegistrationComponent),
      },
      {
        path: 'employees/:employeeId',
        loadComponent: () =>
          import(
            './features/hr-dashboard/components/employee-detail/employee-detail.component'
          ).then((m) => m.EmployeeDetailComponent),
      },
      {
        path: 'verifications',
        loadComponent: () =>
          import(
            './features/hr-dashboard/components/verifications-list/verifications-list.component'
          ).then((m) => m.VerificationsListComponent),
      },
      {
        path: 'verifications/:documentId',
        loadComponent: () =>
          import(
            './features/hr-dashboard/components/verification-detail/verification-detail.component'
          ).then((m) => m.VerificationDetailComponent),
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import(
            './features/hr-dashboard/components/notifications/notifications.component'
          ).then((m) => m.NotificationsComponent),
      },
      {
        path: 'support-inbox',
        loadComponent: () =>
          import(
            './features/hr-dashboard/components/support-inbox/support-inbox.component'
          ).then((m) => m.SupportInboxComponent),
      },
    ],
  },
  {
    path: 'employees/:employeeId',
    canActivate: [employeeGuard],
    loadComponent: () =>
      import('./features/employee-dashboard/employee-dashboard.component').then(
        (m) => m.EmployeeDashboardComponent
      ),
  },
  // ── NH-133 Platform Shell ─────────────────────────────────────────────────
  {
    path: 'platform',
    canActivate: [authGuard],
    children: [
      {
        path: 'home',
        loadComponent: () =>
          import('./features/platform-home/platform-home.component').then(
            (m) => m.PlatformHomeComponent
          ),
      },
      {
        path: 'onboarding',
        canActivate: [moduleGuard('onboarding')],
        // TODO NH-134: replace with OnboardingModule lazy route when built
        redirectTo: '/platform/home',
      },
      {
        path: 'talentflow',
        canActivate: [moduleGuard('talentflow')],
        // TODO FE-001: replace with TalentFlowModule lazy route in Epic 4
        loadComponent: () =>
          import('./features/platform-home/platform-home.component').then(
            (m) => m.PlatformHomeComponent
          ),
      },
      { path: '', redirectTo: 'home', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: '' },
];
