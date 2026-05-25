import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageService, ConfirmationService } from 'primeng/api';
import { AuthService } from '../../../../core/services/auth.service';
import { AdminSidebarComponent } from './components/admin-sidebar/admin-sidebar.component';

@Component({
  selector: 'tf-admin-shell',
  standalone: true,
  imports: [RouterOutlet, ButtonModule, AvatarModule, AdminSidebarComponent, ToastModule, ConfirmDialogModule],
  providers: [MessageService, ConfirmationService],
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
