import { Routes } from '@angular/router';
import { hrGuard, signedOutGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: 'sign-in', canActivate: [signedOutGuard], loadComponent: () => import('./features/sign-in/sign-in.page').then((m) => m.SignInPage), title: 'Sign in · Naleko People' },
  {
    path: 'hr',
    canActivate: [hrGuard],
    loadComponent: () => import('./features/hr/hr-shell').then((m) => m.HrShell),
    children: [
      { path: '', loadComponent: () => import('./features/hr/hr-home.page').then((m) => m.HrHomePage), title: 'Today · Naleko People' },
      { path: 'employees/:id', loadComponent: () => import('./features/hr/employee-detail.page').then((m) => m.EmployeeDetailPage), title: 'Employee · Naleko People' },
    ],
  },
  { path: 'dev/design-system', loadComponent: () => import('./dev/design-system.page').then((m) => m.DesignSystemPage), title: 'Design system · Naleko People' },
  { path: 'dev/parity', loadComponent: () => import('./dev/parity.page').then((m) => m.ParityPage), title: 'Parity · Naleko People' },
  { path: '', pathMatch: 'full', redirectTo: 'hr' },
  { path: '**', redirectTo: 'hr' },
];
