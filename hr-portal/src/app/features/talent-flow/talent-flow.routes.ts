import { Routes } from '@angular/router';
import { TalentFlowShellComponent } from './shell/talent-flow-shell.component';

/**
 * TalentFlow lazy routes (FE-004 / NH-137)
 *
 * Loaded via loadChildren() from app.routes.ts at path: 'talent-flow'
 *
 * TalentFlowShellComponent is the eagerly-loaded parent (provides sidebar +
 * topbar shell). Page components are lazy-loaded as children via loadComponent.
 */
export const talentFlowRoutes: Routes = [
  {
    path: '',
    component: TalentFlowShellComponent,
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/dashboard/dashboard-page.component').then(
            (m) => m.DashboardPageComponent,
          ),
      },
      {
        path: 'pipeline',
        loadComponent: () =>
          import('./pages/pipeline/pipeline-page.component').then(
            (m) => m.PipelinePageComponent,
          ),
      },
      {
        path: 'candidates/:id',
        loadComponent: () =>
          import('./pages/candidate-workspace/candidate-workspace-page.component').then(
            (m) => m.CandidateWorkspacePageComponent,
          ),
      },
    ],
  },
];
