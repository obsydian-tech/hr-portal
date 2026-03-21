import { Component, ChangeDetectionStrategy, input } from '@angular/core';

@Component({
  selector: 'app-hr-dashboard',
  standalone: true,
  template: `
    <div class="flex align-items-center justify-content-center" style="min-height: 100vh; background: var(--naleko-surface);">
      <div class="text-center">
        <h1 style="font-size: 2rem; font-weight: 800; color: var(--naleko-primary);">HR Staff Dashboard</h1>
        <p style="color: var(--naleko-on-surface-variant); margin-top: 0.5rem;">Staff ID: {{ staffId() }}</p>
        <p style="color: var(--naleko-on-surface-variant); margin-top: 1rem; opacity: 0.6;">Coming soon — this screen will be built from the Stitch design.</p>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HrDashboardComponent {
  readonly staffId = input<string>('');
}
