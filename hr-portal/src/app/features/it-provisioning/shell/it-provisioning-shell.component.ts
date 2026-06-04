import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { Popover, PopoverModule } from 'primeng/popover';
import { TalentFlowAuthService } from '../../talent-flow/services/talent-flow-auth.service';
import { AuthService } from '../../../core/services/auth.service';
import { ItProvisioningStateService } from '../services/it-provisioning-state.service';

@Component({
  selector: 'ip-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AvatarModule, ButtonModule, PopoverModule],
  templateUrl: './it-provisioning-shell.component.html',
  styleUrl: './it-provisioning-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItProvisioningShellComponent implements OnInit {
  @ViewChild('bellPanel') private readonly bellPanel!: Popover;

  private readonly router      = inject(Router);
  /** TalentFlow pool auth — ITAdmin / ITSpecialist groups live here. */
  protected readonly tfAuth     = inject(TalentFlowAuthService);
  protected readonly nalekoAuth = inject(AuthService);
  protected readonly itState    = inject(ItProvisioningStateService);

  /** Initials derived from the Naleko pool user (they logged in via main login). */
  protected readonly initials = computed<string>(() => {
    const user = this.nalekoAuth.currentUser();
    if (!user) return '?';
    const parts = (user.fullName ?? '').split(' ');
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
  });

  /** Display name from Naleko pool. */
  protected readonly displayName = computed<string>(() => {
    return this.nalekoAuth.currentUser()?.fullName ?? 'IT Specialist';
  });

  protected readonly bellBadge = computed<string | undefined>(() => {
    const count = this.itState.slaBreachCount();
    return count > 0 ? count.toString() : undefined;
  });

  protected readonly breachedTasks = computed(() => this.itState.breachedTasks());

  async ngOnInit(): Promise<void> {
    // Restore the TalentFlow Cognito session so isItSpecialist() is accurate.
    // ITAdmin / ITSpecialist groups are in the TF pool; no separate IT pool.
    await this.tfAuth.checkSession();
  }

  protected toggleBell(event: Event): void {
    this.bellPanel.toggle(event);
  }

  protected goToTask(taskId: string): void {
    this.bellPanel.hide();
    void this.router.navigate(['/platform/it-requests/task', taskId]);
  }

  protected onLogout(): void {
    this.tfAuth.logout();
    void this.router.navigate(['/platform/home']);
  }
}
