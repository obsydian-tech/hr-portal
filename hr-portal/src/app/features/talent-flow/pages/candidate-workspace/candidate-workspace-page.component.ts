import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TalentFlowStateService } from '../../services/talent-flow-state.service';
import { TalentFlowApiService } from '../../services/talent-flow-api.service';
import { CandidateIdentityCardComponent } from '../../components/candidate-identity-card/candidate-identity-card.component';
import { StageSelectorComponent, STAGE_LABELS } from '../../components/stage-selector/stage-selector.component';
import { SlaTimerWidgetComponent } from '../../components/sla-timer-widget/sla-timer-widget.component';
import { Candidate, HiringStage } from '../../models/talent-flow.models';

/**
 * CandidateWorkspacePageComponent — FE-004 / NH-137
 *
 * Design source: EmployeeDetail.jsx master-detail layout
 *   - Left rail: avatar header + identity + stage stepper
 *   - Right panel: tabbed detail (Overview, Timeline, Votes)
 *
 * Route: /talent-flow/candidates/:id
 *
 * On init: reads route param → loads candidate if not in pipeline cache →
 *   sets activeCandidateId on TalentFlowStateService.
 *
 * StageSelector: rendered readonly — hiring managers progress stage
 *   via explicit action buttons, not drag → FE-005/006.
 */

export type WorkspaceTab = 'overview' | 'timeline' | 'votes';

/** All HiringStage values in workflow order */
export const ALL_STAGES: HiringStage[] = Object.keys(STAGE_LABELS) as HiringStage[];

@Component({
  selector: 'tf-candidate-workspace-page',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    CandidateIdentityCardComponent,
    StageSelectorComponent,
    SlaTimerWidgetComponent,
  ],
  templateUrl: './candidate-workspace-page.component.html',
  styleUrl: './candidate-workspace-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CandidateWorkspacePageComponent implements OnInit {
  protected readonly state = inject(TalentFlowStateService);
  private readonly api = inject(TalentFlowApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly activeTab = signal<WorkspaceTab>('overview');
  protected readonly candidateId = signal<string | null>(null);
  protected readonly loading = signal<boolean>(false);
  protected readonly fetchError = signal<string | null>(null);

  /** All stages shown for the stepper */
  protected readonly allStages = ALL_STAGES;

  /**
   * The active candidate, resolved from state cache or individual fetch.
   * Falls back to state.activeCandidate() which is derived from pipeline signal.
   */
  protected readonly candidate = computed<Candidate | undefined>(
    () => this.state.activeCandidate(),
  );

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      void this.router.navigate(['/talent-flow']);
      return;
    }
    this.candidateId.set(id);

    // If candidate already in pipeline cache, just activate it
    const inCache = this.state.pipeline().find((c) => c.id === id);
    if (inCache) {
      this.state.setActiveCandidate(id);
      return;
    }

    // Otherwise load full pipeline first (ensures state consistency)
    this.loading.set(true);
    this.state.loadPipeline();
    // Then set the active candidate — pipeline signal will propagate
    this.state.setActiveCandidate(id);
    this.loading.set(false);
  }

  protected setTab(tab: WorkspaceTab): void {
    this.activeTab.set(tab);
  }

  protected goBack(): void {
    void this.router.navigate(['/talent-flow/pipeline']);
  }

  protected toDate(iso: string): Date {
    return new Date(iso);
  }

  protected readonly defaultThreshold = 72;
}
