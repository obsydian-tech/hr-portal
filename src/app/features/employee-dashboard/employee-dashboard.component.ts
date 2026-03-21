import { Component, ChangeDetectionStrategy, input } from '@angular/core';

@Component({
  selector: 'app-employee-dashboard',
  standalone: true,
  template: `
    <div class="flex align-items-center justify-content-center" style="min-height: 100vh; background: var(--naleko-surface);">
      <div class="text-center">
        <h1 style="font-size: 2rem; font-weight: 800; color: var(--naleko-primary);">Employee Dashboard</h1>
        <p style="color: var(--naleko-on-surface-variant); margin-top: 0.5rem;">Employee ID: {{ employeeId() }}</p>
        <p style="color: var(--naleko-on-surface-variant); margin-top: 1rem; opacity: 0.6;">Coming soon — this screen will be built from the Stitch design.</p>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeDashboardComponent {
  readonly employeeId = input<string>('');
}
