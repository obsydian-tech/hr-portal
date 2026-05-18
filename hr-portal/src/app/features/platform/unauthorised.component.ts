import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';

/**
 * UnauthorisedComponent — Epic 5
 *
 * Shown when a user is authenticated but has no recognised Cognito group
 * (i.e. they exist in the pool but have not been assigned any module).
 * Route: /unauthorised (PUBLIC — no authGuard needed).
 */
@Component({
  selector: 'app-unauthorised',
  standalone: true,
  imports: [RouterLink, ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="unauthorised">
      <div class="unauthorised__card">
        <div class="unauthorised__icon">
          <i class="pi pi-lock" style="font-size: 3rem; color: var(--text-color-secondary)"></i>
        </div>
        <h1 class="unauthorised__title">Access Not Configured</h1>
        <p class="unauthorised__body">
          Your account doesn't have access to any modules yet.<br />
          Please contact your HR administrator to be assigned to a team.
        </p>
        <div class="unauthorised__actions">
          <p-button
            label="Back to Platform Home"
            icon="pi pi-home"
            routerLink="/platform/home"
          />
        </div>
      </div>
    </div>
  `,
  styles: [`
    .unauthorised {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--surface-ground, #f8fafc);
    }

    .unauthorised__card {
      text-align: center;
      padding: 3rem 2rem;
      max-width: 480px;
      background: var(--surface-card, #ffffff);
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
    }

    .unauthorised__icon {
      margin-bottom: 1.5rem;
    }

    .unauthorised__title {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-color, #1e293b);
      margin: 0 0 0.75rem;
    }

    .unauthorised__body {
      font-size: 0.975rem;
      color: var(--text-color-secondary, #64748b);
      line-height: 1.6;
      margin: 0 0 2rem;
    }

    .unauthorised__actions {
      display: flex;
      justify-content: center;
    }
  `],
})
export class UnauthorisedComponent {}
