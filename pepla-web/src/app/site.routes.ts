import { Routes } from '@angular/router';
import { siteStyles } from './ds/site/site-styles';

/**
 * SITE-01: the router's root. `/` is the public page for everyone; every address app.routes.ts knows
 * loads from there (lazily, so `/` loads no Cognito or feature code); anything else is the not-found
 * page, with no redirect. The public routes add the site stylesheet (SITE-07), which signed-in pages never load.
 */
export const siteRoutes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./features/public/public-page').then((m) => m.PublicPage), canActivate: [siteStyles], title: 'Naleko People' },
  { path: 'Home', loadComponent: () => import('./features/public/public-page').then((m) => m.PublicPage), canActivate: [siteStyles], title: 'Naleko People' },
  { path: 'product/recruitment', loadComponent: () => import('./ds/site/learn/recruitment/recruitment.page').then((m) => m.RecruitmentPage), canActivate: [siteStyles], title: 'Naleko People' },
  { path: 'product/onboarding', loadComponent: () => import('./ds/site/learn/onboarding/onboarding.page').then((m) => m.OnboardingPage), canActivate: [siteStyles], title: 'Naleko People' },
  { path: '', loadChildren: () => import('./app.routes').then((m) => m.routes) },
  { path: '**', loadComponent: () => import('./features/public/public-page').then((m) => m.NotFoundPage), canActivate: [siteStyles], title: 'Naleko People' },
];
