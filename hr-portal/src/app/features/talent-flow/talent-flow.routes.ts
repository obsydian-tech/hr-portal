import { Routes } from '@angular/router';
import { TalentFlowShellComponent } from './shell/talent-flow-shell.component';
import { adminGuard } from './guards/admin.guard';
import { hmRedirectGuard } from './guards/hm-redirect.guard';

/**
 * TalentFlow lazy routes
 *
 * Shell: TalentFlowShellComponent — horizontal topbar (D022), no sidebar.
 * Add Candidate is a drawer in the shell, NOT a route (D036).
 * HM evaluation panel is inline in the workspace, NOT a route (D047).
 */
export const talentFlowRoutes: Routes = [
  {
    path: '',
    component: TalentFlowShellComponent,
    children: [
      // ── TA Dashboard — HM users are redirected to hm-dashboard ──────────
      {
        path: '',
        canActivate: [hmRedirectGuard],
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
      // ── Candidates (search-first view, D059–D063) ─────────────────────
      {
        path: 'candidates',
        loadComponent: () =>
          import('./pages/candidates/candidates-page.component').then(
            (m) => m.CandidatesPageComponent,
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
      // ── Offers (offer lifecycle view, D064–D071) ──────────────────────
      {
        path: 'offers',
        loadComponent: () =>
          import('./pages/offers/offers-page.component').then(
            (m) => m.OffersPageComponent,
          ),
      },
      // ── HM Dashboard (D044–D051) ─────────────────────────────────────
      {
        path: 'hm-dashboard',
        loadComponent: () =>
          import('./pages/hm-dashboard/hm-dashboard-page.component').then(
            (m) => m.HmDashboardPageComponent,
          ),
      },
      // ── Reports (placeholder — Phase C/D) ────────────────────────────
      {
        path: 'reports',
        redirectTo: '',
        pathMatch: 'full',
      },
      // ── Config hub — admin-only ──────────────────────────────────────────
      {
        path: 'config',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/config/config-hub/config-hub-page.component').then(
            (m) => m.ConfigHubPageComponent,
          ),
      },
    ],
  },
];
