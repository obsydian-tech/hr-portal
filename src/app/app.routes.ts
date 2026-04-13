import { Routes } from '@angular/router';
import { hrGuard, employeeGuard, loginPageGuard } from './core/guards/auth.guard';

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
  { path: '**', redirectTo: '' },
];
