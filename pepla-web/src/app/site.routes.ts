import { Routes } from '@angular/router';

/**
 * SITE-01: the router's root. `/` is the public page for everyone; every address app.routes.ts knows
 * loads from there (lazily, so `/` loads no Cognito or feature code); anything else is the not-found
 * page, with no redirect.
 */
export const siteRoutes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./features/public/public-page').then((m) => m.PublicPage), title: 'Naleko People' },
  { path: '', loadChildren: () => import('./app.routes').then((m) => m.routes) },
  { path: '**', loadComponent: () => import('./features/public/public-page').then((m) => m.NotFoundPage), title: 'Naleko People' },
];
