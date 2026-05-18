import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SidebarComponent, NavItem } from '../../../shared/components/sidebar/sidebar.component';
import { TopbarComponent } from '../../../shared/components/topbar/topbar.component';
import { TalentFlowAuthService } from '../services/talent-flow-auth.service';
import { TalentFlowStateService } from '../services/talent-flow-state.service';

/**
 * TalentFlowShellComponent — FE-004 / NH-137
 *
 * Provides the Naleko app shell (sidebar + topbar + router-outlet) for all
 * TalentFlow pages. Mirrors the pattern used by HrDashboardComponent.
 *
 * Child routes render inside <router-outlet />.
 */
@Component({
  selector: 'tf-shell',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, TopbarComponent],
  templateUrl: './talent-flow-shell.component.html',
  styleUrl: './talent-flow-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TalentFlowShellComponent {
  private readonly auth = inject(TalentFlowAuthService);
  protected readonly state = inject(TalentFlowStateService);
  private readonly router = inject(Router);

  protected readonly sidebarOpen = signal(true);

  protected readonly navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'pi pi-th-large',  route: '/platform/talentflow',          disabled: false },
    { label: 'Pipeline',  icon: 'pi pi-briefcase', route: '/platform/talentflow/pipeline', disabled: false },
    { label: 'Config',    icon: 'pi pi-cog',        route: '/platform/talentflow/config',   disabled: true  },
  ];

  protected toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  protected onLogout(): void {
    this.auth.logout();
    void this.router.navigate(['/platform/home']);
  }
}
