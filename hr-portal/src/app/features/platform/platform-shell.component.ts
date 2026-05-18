import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { AuthService } from '../../core/services/auth.service';

/**
 * PlatformShellComponent — Epic 5
 *
 * Persistent top nav + router-outlet for all /platform/* children.
 * authGuard is applied at the /platform route level in app.routes.ts.
 * This component contains no guard logic — it only renders the shell.
 */
@Component({
  selector: 'app-platform-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="platform-nav">
      <div class="platform-nav__brand">
        <a routerLink="/platform/home" class="platform-nav__logo">
          <span class="platform-nav__logo-text">Naleko</span>
        </a>
      </div>

      <nav class="platform-nav__links">
        <a
          routerLink="/platform/home"
          routerLinkActive="platform-nav__link--active"
          [routerLinkActiveOptions]="{ exact: true }"
          class="platform-nav__link"
        >Home</a>
      </nav>

      <div class="platform-nav__actions">
        <span class="platform-nav__user">{{ displayName() }}</span>
        <p-button
          label="Sign Out"
          icon="pi pi-sign-out"
          [text]="true"
          size="small"
          (onClick)="logout()"
        />
      </div>
    </header>

    <main class="platform-content">
      <router-outlet />
    </main>
  `,
  styles: [`
    .platform-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1.5rem;
      height: 56px;
      background: var(--surface-card, #ffffff);
      border-bottom: 1px solid var(--surface-border, #e2e8f0);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .platform-nav__logo-text {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--primary-color, #3b82f6);
      text-decoration: none;
    }

    .platform-nav__logo {
      text-decoration: none;
    }

    .platform-nav__links {
      display: flex;
      gap: 1.5rem;
    }

    .platform-nav__link {
      font-size: 0.875rem;
      color: var(--text-color-secondary, #64748b);
      text-decoration: none;
      padding: 0.25rem 0;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
    }

    .platform-nav__link:hover,
    .platform-nav__link--active {
      color: var(--primary-color, #3b82f6);
      border-bottom-color: var(--primary-color, #3b82f6);
    }

    .platform-nav__actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .platform-nav__user {
      font-size: 0.875rem;
      color: var(--text-color-secondary, #64748b);
    }

    .platform-content {
      min-height: calc(100vh - 56px);
    }
  `],
})
export class PlatformShellComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly displayName = computed(() => this.auth.currentUser()?.fullName ?? '');

  logout(): void {
    this.auth.logout();
  }
}
