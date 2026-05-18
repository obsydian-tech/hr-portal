import { Routes } from '@angular/router';

/**
 * TalentFlow lazy routes (FE-004 / NH-137)
 *
 * Loaded via loadChildren() from app.routes.ts at path: 'talent-flow'
 *
 * Routes:
 *   ''                   → DashboardPageComponent   (KPI overview + recent activity)
 *   'pipeline'           → PipelinePageComponent    (Kanban stage columns)
 *   'candidates/:id'     → CandidateWorkspacePageComponent (master-detail)
 *
 * Admin/config routes (FE-006):
 *   'config/scoring'     → ScoringWeightsPageComponent   (canActivate: adminGuard)
 *   'config/sla'         → SlaConfigPageComponent        (canActivate: adminGuard)
 *
 * NOTE: TalentFlowAuthService session check happens inside each page via effect().
 * There is no route-level TF session guard here — the platform authGuard in
 * app.routes.ts handles the outer shell authentication.
 */
export const talentFlowRoutes: Routes = [
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
];
