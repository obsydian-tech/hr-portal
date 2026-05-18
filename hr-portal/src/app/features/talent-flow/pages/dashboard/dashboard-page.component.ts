import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  computed,
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { TalentFlowStateService } from '../../services/talent-flow-state.service';
import { Candidate } from '../../models/talent-flow.models';

/**
 * DashboardPageComponent — FE-004 / NH-137
 *
 * Design source: HRDashboard.jsx (.hr-stats 4-col grid, .nk-stat cards, .nk-table)
 *
 * Signals-only template: reads directly from TalentFlowStateService — zero subscriptions.
 * Loads pipeline on init; derived KPI signals recompute automatically.
 *
 * KPIs:
 *   - Total Candidates (purple)
 *   - SLA Breached     (red)
 *   - Avg Day-1 Score  (cyan)
 *   - Onboarded        (green)
 */
@Component({
  selector: 'tf-dashboard-page',
  standalone: true,
  imports: [CommonModule, ButtonModule, CardModule, TagModule],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPageComponent implements OnInit {
  protected readonly state = inject(TalentFlowStateService);
  private readonly router = inject(Router);

  // ── KPI derived signals ───────────────────────────────────────────────────

  protected readonly totalCandidates = computed(() => this.state.pipeline().length);

  protected readonly slaBreachCount = computed(() => this.state.slaBreachCount());

  protected readonly avgDay1Score = computed<number>(() => {
    const scored = this.state.pipeline().filter((c) => c.day1ReadinessScore != null);
    if (!scored.length) return 0;
    const total = scored.reduce((sum, c) => sum + (c.day1ReadinessScore ?? 0), 0);
    return Math.round(total / scored.length);
  });

  protected readonly onboardedCount = computed<number>(() =>
    this.state
      .pipeline()
      .filter((c) =>
        (
          ['ONBOARDING_INITIATED', 'COMPLIANCE_IN_PROGRESS', 'PROVISIONING_IN_PROGRESS', 'AWAITING_DAY1', 'ACTIVE'] as string[]
        ).includes(c.currentStage),
      ).length,
  );

  /** Most recent 10 candidates sorted by updatedAt descending */
  protected readonly recentCandidates = computed<Candidate[]>(() =>
    [...this.state.pipeline()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 10),
  );

  ngOnInit(): void {
    this.state.loadPipeline();
  }

  protected openPipeline(): void {
    void this.router.navigate(['/platform/talentflow/pipeline']);
  }

  protected openCandidate(id: string): void {
    void this.router.navigate(['/platform/talentflow/candidates', id]);
  }

  protected slaChipClass(c: Candidate): string {
    return c.slaHealthStatus === 'RED'
      ? 'tf-chip tf-chip--red'
      : c.slaHealthStatus === 'AMBER'
        ? 'tf-chip tf-chip--amber'
        : 'tf-chip tf-chip--green';
  }

  protected slaLabel(c: Candidate): string {
    return c.slaHealthStatus ?? 'OK';
  }
}
