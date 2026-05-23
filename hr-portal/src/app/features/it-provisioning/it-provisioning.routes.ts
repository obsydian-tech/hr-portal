import { Routes } from '@angular/router';
import { ItProvisioningShellComponent } from './shell/it-provisioning-shell.component';

export const itProvisioningRoutes: Routes = [
  {
    path: '',
    component: ItProvisioningShellComponent,
    children: [
      {
        path: 'queue',
        loadComponent: () =>
          import('./pages/it-queue/it-queue-page.component').then(
            (m) => m.ItQueuePageComponent,
          ),
      },
      {
        path: 'completed',
        loadComponent: () =>
          import('./pages/completed/it-completed-page.component').then(
            (m) => m.ItCompletedPageComponent,
          ),
      },
      { path: '', redirectTo: 'queue', pathMatch: 'full' },
    ],
  },
];
