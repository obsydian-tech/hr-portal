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
import { EvaluationScoringPanelComponent } from '../../components/evaluation-scoring-panel/evaluation-scoring-panel.component';
import { EvaluationSummaryWidgetComponent } from '../../components/evaluation-summary-widget/evaluation-summary-widget.component';
import { AiChatPanelComponent } from '../../components/ai-chat-panel/ai-chat-panel.component';
import { Candidate, CandidateEvent, HiringStage, InterviewType, ScheduleInterviewPayload, ScoringWeights, DEFAULT_SCORING_WEIGHTS } from '../../models/talent-flow.models';

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
    EvaluationScoringPanelComponent,
    EvaluationSummaryWidgetComponent,
    AiChatPanelComponent,
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

  protected readonly defaultWeights: ScoringWeights = DEFAULT_SCORING_WEIGHTS;

  protected readonly activeTab = signal<WorkspaceTab>('overview');
  protected readonly candidateId = signal<string | null>(null);
  protected readonly loading = signal<boolean>(false);
  protected readonly fetchError = signal<string | null>(null);
  protected readonly chatVisible = signal<boolean>(false);

  // FE-006: event timeline
  protected readonly eventsLoading = signal<boolean>(false);
  protected readonly eventsError   = signal<string | null>(null);
  protected readonly events         = signal<CandidateEvent[]>([]);
  private _eventsLoaded             = false;

  /** All stages shown for the stepper */
  protected readonly allStages = ALL_STAGES;

  /**
   * Candidate record: prefer pipeline cache (populated when coming from pipeline
   * page), fall back to direct fetch result (when navigating directly via URL).
   */
  private readonly _directCandidate = signal<Candidate | undefined>(undefined);

  protected readonly candidate = computed<Candidate | undefined>(
    () => this.state.activeCandidate() ?? this._directCandidate(),
  );

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      void this.router.navigate(['/platform/talentflow']);
      return;
    }
    this.candidateId.set(id);

    // If candidate already in pipeline cache (e.g. came from pipeline page), use it
    const inCache = this.state.pipeline().find((c) => c.id === id);
    if (inCache) {
      this.state.setActiveCandidate(id);
      return;
    }

    // Not in cache — fetch directly to avoid race condition with pipeline load
    this.loading.set(true);
    this.state.setActiveCandidate(id);
    this.api.getCandidate(id).subscribe({
      next: (c: Candidate) => {
        this._directCandidate.set(c);
        this.loading.set(false);
      },
      error: () => {
        this.fetchError.set('Could not load candidate.');
        this.loading.set(false);
      },
    });
  }

  protected setTab(tab: WorkspaceTab): void {
    this.activeTab.set(tab);
    // FE-006: lazy-load the event timeline on first switch to timeline tab
    if (tab === 'timeline' && !this._eventsLoaded) {
      const id = this.candidateId();
      if (id) this._loadEvents(id);
    }
  }

  private _loadEvents(id: string): void {
    this._eventsLoaded = true;
    this.eventsLoading.set(true);
    this.eventsError.set(null);
    this.api.getCandidateEvents(id, { limit: 100 }).subscribe({
      next: (res) => {
        this.events.set(res.events);
        this.eventsLoading.set(false);
      },
      error: () => {
        this.eventsError.set('Could not load event timeline.');
        this.eventsLoading.set(false);
      },
    });
  }

  protected goBack(): void {
    void this.router.navigate(['/platform/talentflow/pipeline']);
  }

  protected toggleChat(): void {
    this.chatVisible.update((v) => !v);
  }

  protected goToEvaluate(candidateId: string): void {
    void this.router.navigate(['/platform/talentflow/candidates', candidateId, 'evaluate']);
  }

  protected toDate(iso: string): Date {
    return new Date(iso);
  }

  protected readonly defaultThreshold = 72;

  // ── Schedule Interview ─────────────────────────────────────────────────────
  protected readonly showScheduleForm = signal<boolean>(false);
  protected readonly scheduleSubmitting  = signal<boolean>(false);
  protected readonly scheduleSuccess     = signal<string | null>(null);
  protected readonly scheduleError       = signal<string | null>(null);

  /** Mutable form model for the schedule interview panel */
  protected readonly scheduleForm = signal<{
    interviewType: InterviewType;
    scheduledAt: string;
    panelMemberIds: string[];
  }>({
    interviewType: 'TECHNICAL',
    scheduledAt: '',
    panelMemberIds: [],
  });

  /** Hardcoded MVP panel member roster — replace with dynamic lookup in v2 */
  protected readonly PANEL_ROSTER = [
    { id: 'ignecious@obsydiantechnologies.com', name: 'Ignecious (Admin)' },
    { id: 'hr@naleko.co.za', name: 'HR Manager' },
    { id: 'tech.lead@naleko.co.za', name: 'Tech Lead' },
    { id: 'cto@naleko.co.za', name: 'CTO' },
  ];

  protected togglePanelMember(memberId: string): void {
    const current = this.scheduleForm();
    const ids = current.panelMemberIds.includes(memberId)
      ? current.panelMemberIds.filter((id) => id !== memberId)
      : [...current.panelMemberIds, memberId];
    this.scheduleForm.set({ ...current, panelMemberIds: ids });
  }

  protected submitScheduleInterview(candidateId: string): void {
    const form = this.scheduleForm();
    if (!form.scheduledAt || form.panelMemberIds.length === 0) return;

    this.scheduleSubmitting.set(true);
    this.scheduleError.set(null);
    this.scheduleSuccess.set(null);

    const payload: ScheduleInterviewPayload = {
      interviewType: form.interviewType,
      scheduledAt: form.scheduledAt,
      panelMemberIds: form.panelMemberIds,
    };

    this.api.scheduleInterview(candidateId, payload).subscribe({
      next: (res) => {
        this.scheduleSubmitting.set(false);
        this.scheduleSuccess.set(res.interviewId);
        this.showScheduleForm.set(false);
        // Refresh candidate to reflect new stage (TECHNICAL_INTERVIEW)
        this.api.getCandidate(candidateId).subscribe({
          next: (c) => this._directCandidate.set(c),
          error: () => { /* non-fatal */ },
        });
      },
      error: (err) => {
        this.scheduleSubmitting.set(false);
        const msg = err?.error?.error ?? err?.message ?? 'Failed to schedule interview';
        this.scheduleError.set(msg);
      },
    });
  }
}
