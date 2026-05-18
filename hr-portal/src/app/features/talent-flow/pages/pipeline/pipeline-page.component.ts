import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  computed,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TalentFlowStateService } from '../../services/talent-flow-state.service';
import { CandidateIdentityCardComponent } from '../../components/candidate-identity-card/candidate-identity-card.component';
import { SlaTimerWidgetComponent } from '../../components/sla-timer-widget/sla-timer-widget.component';
import { Candidate, HiringStage, PipelineFilters } from '../../models/talent-flow.models';
import { STAGE_LABELS } from '../../components/stage-selector/stage-selector.component';

/**
 * PipelinePageComponent — FE-004 / NH-137
 *
 * Design source: HRDashboard.jsx table + 22-wizard-stepper.html stage progression
 *
 * Kanban column view: 8 primary active stages rendered as columns.
 * Each column contains CandidateIdentityCard + SlaTimerWidget per candidate.
 * Clicking a card navigates to /talent-flow/candidates/:id.
 *
 * Filter bar: SLA health status filter + search by name/email.
 * Reads from TalentFlowStateService.pipeline() signal — zero subscriptions.
 */

/** The 8 primary stages shown as Kanban columns (most common active stages) */
export const KANBAN_STAGES: HiringStage[] = [
  'CREATED',
  'INTERVIEW_1_SCHEDULED',
  'INTERVIEW_1_COMPLETED',
  'EVALUATION_IN_PROGRESS',
  'SHORTLISTED',
  'INTERVIEW_2_SCHEDULED',
  'OFFER_IN_PROGRESS',
  'ONBOARDING_INITIATED',
];

@Component({
  selector: 'tf-pipeline-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CandidateIdentityCardComponent,
    SlaTimerWidgetComponent,
  ],
  templateUrl: './pipeline-page.component.html',
  styleUrl: './pipeline-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PipelinePageComponent implements OnInit {
  protected readonly state = inject(TalentFlowStateService);
  private readonly router = inject(Router);

  // ── Filter state ──────────────────────────────────────────────────────────
  protected readonly slaFilter = signal<'ALL' | 'GREEN' | 'AMBER' | 'RED'>('ALL');
  protected readonly searchQuery = signal<string>('');

  // ── Filtered pipeline ─────────────────────────────────────────────────────
  protected readonly filteredPipeline = computed<Candidate[]>(() => {
    let list = this.state.pipeline();
    const sla = this.slaFilter();
    const q = this.searchQuery().toLowerCase().trim();

    if (sla !== 'ALL') {
      list = list.filter((c) => c.slaHealthStatus === sla);
    }
    if (q) {
      list = list.filter(
        (c) =>
          c.firstName.toLowerCase().includes(q) ||
          c.lastName.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.role.toLowerCase().includes(q),
      );
    }
    return list;
  });

  /** Returns candidates for a specific stage column */
  protected candidatesForStage(stage: HiringStage): Candidate[] {
    return this.filteredPipeline().filter((c) => c.currentStage === stage);
  }

  /** SLA threshold hours per column (default 72h — overridden by config in FE-006) */
  protected readonly defaultThreshold = 72;

  protected readonly stageLabels = STAGE_LABELS;
  protected readonly kanbanStages = KANBAN_STAGES;

  ngOnInit(): void {
    this.state.loadPipeline();
  }

  protected setSlaFilter(f: 'ALL' | 'GREEN' | 'AMBER' | 'RED'): void {
    this.slaFilter.set(f);
  }

  protected setSearch(v: string): void {
    this.searchQuery.set(v);
  }

  protected openCandidate(id: string): void {
    void this.router.navigate(['/talent-flow/candidates', id]);
  }

  protected toDate(iso: string): Date {
    return new Date(iso);
  }
}
