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
  // ── /unauthorised — authenticated but no module group assigned ─────────────
  {
    path: 'unauthorised',
    loadComponent: () =>
      import('./features/platform/unauthorised.component').then(
        (m) => m.UnauthorisedComponent
      ),
  },
  // ── Epic 5: Platform Shell ────────────────────────────────────────────────
  {
    path: 'platform',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/platform/platform-shell.component').then(
        (m) => m.PlatformShellComponent
      ),
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
        // TODO NH-134: replace with lazy OnboardingModule + moduleGuard('onboarding') when built
        redirectTo: '/platform/home',
      },
      {
        // Epic 5: /platform/talentflow is the canonical TalentFlow entry point
        path: 'talentflow',
        canActivate: [moduleGuard('talentflow')],
        loadChildren: () =>
          import('./features/talent-flow/talent-flow.routes').then(
            (m) => m.talentFlowRoutes,
          ),
      },
      { path: '', redirectTo: 'home', pathMatch: 'full' },
    ],
  },
  // ── /talent-flow legacy redirect (Epic 5) — preserves bookmarks ───────────
  {
    path: 'talent-flow',
    redirectTo: '/platform/talentflow',
  },
  { path: '**', redirectTo: '' },
];
