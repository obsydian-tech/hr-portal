import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

/**
 * AdminSidebarComponent — standalone left-navigation for the Admin workspace.
 *
 * Extracted from AdminShellComponent so navigation state
 * is managed in a single, focused component.
 */
@Component({
  selector: 'tf-admin-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, ToastModule],
  templateUrl: './admin-sidebar.component.html',
  styleUrl: './admin-sidebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSidebarComponent {
  private readonly messageService = inject(MessageService);

  showComingSoon(label: string): void {
    this.messageService.add({
      severity: 'info',
      summary:  'Coming Soon',
      detail:   `${label} will be available in a future release.`,
      life:     3000,
    });
  }
}
