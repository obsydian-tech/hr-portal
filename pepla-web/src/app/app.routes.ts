import { inject, provideEnvironmentInitializer } from '@angular/core';
import { Routes } from '@angular/router';
import { siteStyles } from './ds/site/site-styles';
import { ModulesService } from './core/modules.service';
import { installTestHook, testRoutes } from './core/test-hook';
import { employeeGuard, hrGuard, signedOutGuard } from './core/auth/auth.guard';
import { documentTitle, knownDocumentGuard } from './features/start/document-types';

/**
 * The signed-in app and the sign-in pages. Since SITE-01 these load lazily under site.routes.ts, after `/`
 * (the public page) and before the not-found page, so `/` carries none of this code.
 */
const appRoutes: Routes = [
  ...testRoutes(),
  { path: 'sign-in', canActivate: [signedOutGuard], loadComponent: () => import('./features/sign-in/sign-in.page').then((m) => m.SignInPage), title: 'Sign in · Naleko People' },
  { path: 'forgot-password', canActivate: [signedOutGuard], loadComponent: () => import('./features/forgot-password/forgot-password.page').then((m) => m.ForgotPasswordPage), title: 'Reset your password · Naleko People' },
  { path: 'set-password', loadComponent: () => import('./features/set-password/set-password.page').then((m) => m.SetPasswordPage), title: 'Set your password · Naleko People' },
  {
    path: 'start',
    canActivate: [employeeGuard],
    loadComponent: () => import('./features/start/employee-shell').then((m) => m.EmployeeShell),
    children: [
      { path: '', loadComponent: () => import('./features/start/start.page').then((m) => m.StartPage), title: 'Welcome · Naleko People' },
      { path: 'privacy-notice', loadComponent: () => import('./features/start/privacy-notice.page').then((m) => m.PrivacyNoticePage), title: 'Privacy notice · Naleko People' },
      { path: 'documents/:type', canActivate: [knownDocumentGuard], loadComponent: () => import('./features/start/document-upload.page').then((m) => m.DocumentUploadPage), title: documentTitle },
    ],
  },
  {
    path: 'hr',
    canActivate: [hrGuard],
    loadComponent: () => import('./features/hr/hr-shell').then((m) => m.HrShell),
    children: [
      { path: '', loadComponent: () => import('./features/hr/hr-home.page').then((m) => m.HrHomePage), title: 'Today · Naleko People' },
      { path: 'documents', loadComponent: () => import('./features/hr/documents.page').then((m) => m.DocumentsToCheckPage), title: 'Documents to check · Naleko People' },
      { path: 'documents/:id', loadComponent: () => import('./features/hr/document.page').then((m) => m.DocumentPage), title: 'Document · Naleko People' },
      { path: 'employees/new', loadComponent: () => import('./features/hr/register-employee.page').then((m) => m.RegisterEmployeePage), title: 'Register a new employee · Naleko People' },
      { path: 'employees/:id', loadComponent: () => import('./features/hr/employee-detail.page').then((m) => m.EmployeeDetailPage), title: 'Employee · Naleko People' },
    ],
  },
  { path: 'dev/design-system', loadComponent: () => import('./dev/design-system.page').then((m) => m.DesignSystemPage), title: 'Design system · Naleko People' },
  { path: 'dev/parity', loadComponent: () => import('./dev/parity.page').then((m) => m.ParityPage), title: 'Parity · Naleko People' },
  { path: 'dev/site', loadComponent: () => import('./ds/site/gallery.page').then((m) => m.SiteGalleryPage), canActivate: [siteStyles], title: 'Site parts · Naleko People' },
  { path: 'dev/site-landing', loadComponent: () => import('./ds/site/landing.gallery').then((m) => m.SiteLandingGalleryPage), canActivate: [siteStyles], title: 'Landing sections · Naleko People' },
  { path: 'dev/site-landing-page', loadComponent: () => import('./ds/site/landing.page').then((m) => m.SiteLandingPage), canActivate: [siteStyles], title: 'Naleko People' },
];

export const routes: Routes = [
  { path: '', providers: [provideEnvironmentInitializer(() => installTestHook(inject(ModulesService)))], children: appRoutes },
];
