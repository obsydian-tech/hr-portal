import { Routes } from '@angular/router';
import { TalentFlowShellComponent } from './shell/talent-flow-shell.component';
import { adminGuard } from './guards/admin.guard';

/**
 * TalentFlow lazy routes (FE-004 / NH-137, updated FE-007 / NH-140)
 *
 * Loaded via loadChildren() from app.routes.ts at path: 'talent-flow'
 *
 * TalentFlowShellComponent is the eagerly-loaded parent (provides sidebar +
 * topbar shell). Page components are lazy-loaded as children via loadComponent.
 *
 * Config routes are protected by adminGuard (checks custom:isAdmin Cognito claim).
 */
export const talentFlowRoutes: Routes = [
  {
    path: '',
    component: TalentFlowShellComponent,
    children: [
      // ── Dashboard ────────────────────────────────────────────────────────
      {
        path: '',
        loadComponent: () =>
          import('./pages/dashboard/dashboard-page.component').then(
            (m) => m.DashboardPageComponent,
          ),
      },
      // ── Pipeline ─────────────────────────────────────────────────────────
      {
        path: 'pipeline',
        loadComponent: () =>
          import('./pages/pipeline/pipeline-page.component').then(
            (m) => m.PipelinePageComponent,
          ),
      },
      // ── Candidate Create ─────────────────────────────────────────────────
      {
        path: 'candidates/new',
        loadComponent: () =>
          import('./pages/candidate-create/candidate-create-page.component').then(
            (m) => m.CandidateCreatePageComponent,
          ),
      },
      // ── Candidate Workspace ──────────────────────────────────────────────
      {
        path: 'candidates/:id',
        loadComponent: () =>
          import('./pages/candidate-workspace/candidate-workspace-page.component').then(
            (m) => m.CandidateWorkspacePageComponent,
          ),
      },
      // ── Evaluation (submit vote) ─────────────────────────────────────────
      {
        path: 'candidates/:id/evaluate',
        loadComponent: () =>
          import('./pages/evaluation/evaluation-page.component').then(
            (m) => m.EvaluationPageComponent,
          ),
      },
      // ── Config — admin-only ──────────────────────────────────────────────
      {
        path: 'config/scoring',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/config/scoring-weights/scoring-weights-page.component').then(
            (m) => m.ScoringWeightsPageComponent,
          ),
      },
      {
        path: 'config/sla',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/config/sla-thresholds/sla-thresholds-page.component').then(
            (m) => m.SLAThresholdsPageComponent,
          ),
      },
      {
        path: 'config/panel',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/config/panel-rules/panel-rules-page.component').then(
            (m) => m.PanelRulesPageComponent,
          ),
      },
    ],
  },
];
