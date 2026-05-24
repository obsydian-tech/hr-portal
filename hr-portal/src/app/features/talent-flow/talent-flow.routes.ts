import { Routes } from '@angular/router';
import { TalentFlowShellComponent } from './shell/talent-flow-shell.component';
import { adminGuard } from './guards/admin.guard';
import { hmRedirectGuard } from './guards/hm-redirect.guard';
import { AdminShellComponent } from './shell/admin-shell/admin-shell.component';

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
      // ── HM Provisioning (IT Request Module) ──────────────────────────
      {
        path: 'hm-provisioning',
        loadComponent: () =>
          import('./pages/hm-provisioning/hm-provisioning-page.component').then(
            (m) => m.HmProvisioningPageComponent,
          ),
      },
      // ── HM Bundle Review Screen (Screen 2) ───────────────────────────
      {
        path: 'hm-provisioning/:bundleId/review',
        loadComponent: () =>
          import('./pages/hm-bundle-review/hm-bundle-review-page.component').then(
            (m) => m.HmBundleReviewPageComponent,
          ),
      },
      // ── HM Bundle Progress Screen (Screen 3) ─────────────────────────
      {
        path: 'hm-provisioning/:bundleId/progress',
        loadComponent: () =>
          import('./pages/hm-bundle-progress/hm-bundle-progress-page.component').then(
            (m) => m.HmBundleProgressPageComponent,
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
  // ── Admin Workspace (/platform/talentflow/admin/*) ───────────────────────
  // Own shell (darker topbar + 220px sidebar). Sibling to TF shell so it
  // renders independently — the regular TF topbar is not visible here.
  {
    path: 'admin',
    canActivate: [adminGuard],
    component: AdminShellComponent,
    children: [
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
      {
        path: 'overview',
        loadComponent: () =>
          import('./pages/admin/overview/admin-overview-page.component').then(
            (m) => m.AdminOverviewPageComponent,
          ),
      },
      {
        path: 'users',
        loadComponent: () =>
          import('./pages/admin/users/admin-users-page.component').then(
            (m) => m.AdminUsersPageComponent,
          ),
      },
    ],
  },
];
