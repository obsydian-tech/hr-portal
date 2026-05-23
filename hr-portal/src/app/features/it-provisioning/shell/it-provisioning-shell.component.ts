import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  OnInit,
} from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { ItProvisioningAuthService } from '../services/it-provisioning-auth.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'ip-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AvatarModule, ButtonModule],
  templateUrl: './it-provisioning-shell.component.html',
  styleUrl: './it-provisioning-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItProvisioningShellComponent implements OnInit {
  private readonly router  = inject(Router);
  protected readonly itAuth     = inject(ItProvisioningAuthService);
  protected readonly nalekoAuth = inject(AuthService);

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

  async ngOnInit(): Promise<void> {
    // Restore IT Provisioning Cognito session if the user previously logged into the IT pool.
    // Works alongside Naleko session — both are needed for full IT module access.
    await this.itAuth.checkSession();
  }

  protected onLogout(): void {
    this.itAuth.logout();
    void this.router.navigate(['/platform/home']);
  }
}
