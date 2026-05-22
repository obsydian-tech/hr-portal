import { Component, ChangeDetectionStrategy } from '@angular/core';

// Phase D: full implementation — D044–D051 (HM: My Tasks, My Candidates, Decisions)
@Component({
  selector: 'tf-hm-dashboard-page',
  standalone: true,
  imports: [],
  template: `
    <div class="tf-page-stub">
      <h2>Hiring Manager Dashboard</h2>
      <p>HM view (My Tasks · My Candidates · Decisions) — coming in Phase D.</p>
    </div>
  `,
  styles: [`.tf-page-stub { padding: 2rem; font-family: 'Inter', sans-serif; }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HmDashboardPageComponent {}
