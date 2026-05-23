import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'tf-admin-overview-page',
  standalone: true,
  imports: [],
  template: `
    <div class="tf-admin-page-stub">
      <h2>Overview</h2>
      <p>Admin dashboard — Step 8.</p>
    </div>
  `,
  styles: [`
    .tf-admin-page-stub {
      padding: 2rem;
      font-family: 'Inter', sans-serif;
      color: var(--naleko-on-surface);
    }
    h2 {
      font-family: 'Manrope', sans-serif;
      font-size: 1.5rem;
      font-weight: 700;
      margin: 0 0 0.5rem;
    }
    p { margin: 0; color: var(--naleko-on-surface-variant); }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOverviewPageComponent {}
