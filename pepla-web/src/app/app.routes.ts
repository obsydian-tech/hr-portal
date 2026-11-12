import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'dev/design-system', loadComponent: () => import('./dev/design-system.page').then((m) => m.DesignSystemPage), title: 'Design system · Pepla' },
  { path: 'dev/parity', loadComponent: () => import('./dev/parity.page').then((m) => m.ParityPage), title: 'Parity · Pepla' },
  { path: '', pathMatch: 'full', redirectTo: 'dev/design-system' },
];
