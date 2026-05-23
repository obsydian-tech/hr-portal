import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
} from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'tf-admin-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ButtonModule, AvatarModule],
  templateUrl: './admin-shell.component.html',
  styleUrl: './admin-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminShellComponent {
  private readonly router       = inject(Router);
  protected readonly nalekoAuth = inject(AuthService);

  protected readonly initials = computed<string>(() => {
    const user = this.nalekoAuth.currentUser();
    if (!user) return 'A';
    return ((user.givenName[0] ?? '') + (user.familyName[0] ?? '')).toUpperCase();
  });

  protected readonly displayName = computed<string>(() => {
    const user = this.nalekoAuth.currentUser();
    return user?.fullName ?? user?.email ?? 'Admin';
  });

  protected backToTalentFlow(): void {
    void this.router.navigate(['/platform/talentflow']);
  }
}
