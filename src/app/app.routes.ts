import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/landing/landing.component').then((m) => m.LandingComponent),
  },
  {
    path: 'hr/:staffId',
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
        path: 'employees/:employeeId',
        loadComponent: () =>
          import(
            './features/hr-dashboard/components/employee-detail/employee-detail.component'
          ).then((m) => m.EmployeeDetailComponent),
      },
    ],
  },
  {
    path: 'employees/:employeeId',
    loadComponent: () =>
      import('./features/employee-dashboard/employee-dashboard.component').then(
        (m) => m.EmployeeDashboardComponent
      ),
  },
  { path: '**', redirectTo: '' },
];
