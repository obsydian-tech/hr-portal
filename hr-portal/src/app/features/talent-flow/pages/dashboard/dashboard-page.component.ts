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
import { TalentFlowStateService } from '../../services/talent-flow-state.service';
import { TalentFlowAuthService } from '../../services/talent-flow-auth.service';
import { AuthService } from '../../../../core/services/auth.service';
import { Candidate, HiringStage, PendingAction } from '../../models/talent-flow.models';
import { STAGE_LABELS } from '../../components/stage-selector/stage-selector.component';

/**
 * DashboardPageComponent — Phase B rebuild
 * D016 signal-first, D020 5-zone layout, D021 no exact times, D024 card anatomy, D025 pipeline summary
 */

const STAGE_CONTEXT: Record<HiringStage, string> = {
  APPLICATION_REVIEW: 'Application under review',
  INTERVIEWING:       'Interview loop in progress',
  EVALUATION:         'Evaluation in progress',
  BACKGROUND_CHECK:   'Background check pending',
  OFFER_PREPARATION:  'Offer being prepared',
  OFFER_APPROVAL:     'Offer awaiting approval',
  OFFER_DELIVERY:     'Offer sent to candidate',
  CONTRACT_SIGNING:   'Contract signing stage',
  PRE_BOARDING:       'Pre-boarding preparation',
  ONBOARDING:         'Onboarding in progress',
};

const PHASE_STAGES: Record<number, HiringStage[]> = {
  1: ['APPLICATION_REVIEW', 'INTERVIEWING', 'EVALUATION'],
  2: ['BACKGROUND_CHECK', 'OFFER_PREPARATION', 'OFFER_APPROVAL', 'OFFER_DELIVERY', 'CONTRACT_SIGNING'],
  3: ['PRE_BOARDING'],
  4: ['ONBOARDING'],
};

const PHASE_META = [
  { phase: 1, name: 'Interview & Evaluation', sub: 'Screen, evaluate, decide' },
  { phase: 2, name: 'Offer & Acceptance',     sub: 'Create, approve, convert' },
  { phase: 3, name: 'Pre-Onboarding',         sub: 'Prepare, provision, clear' },
  { phase: 4, name: 'Onboarding & Day 1',     sub: 'Engage, activate, confirm' },
];

const HEALTH_ORDER: Record<string, number> = { BREACHED: 0, AT_RISK: 1, ON_TRACK: 2 };

const ACTION_TITLES: Record<string, string> = {
  advanceCandidateStage: 'Advance candidate stage',
  scheduleInterview:     'Schedule interview',
  submitVote:            'Vote required',
  createOffer:           'Create offer',
  approveOffer:          'Approve offer',
};

const OFFER_STAGES: HiringStage[] = ['OFFER_DELIVERY', 'CONTRACT_SIGNING', 'PRE_BOARDING', 'ONBOARDING'];

@Component({
  selector: 'tf-dashboard-page',
  standalone: true,
  imports: [CommonModule, ButtonModule, CardModule],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPageComponent implements OnInit {
  protected readonly state      = inject(TalentFlowStateService);
  protected readonly tfAuth     = inject(TalentFlowAuthService);
  private  readonly nalekoAuth  = inject(AuthService);
  private  readonly router      = inject(Router);

  protected readonly timeOfDay = computed<string>(() => {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  });

  protected readonly greetingName = computed(() =>
    this.tfAuth.currentUser()?.givenName ||
    this.nalekoAuth.currentUser()?.givenName ||
    'there',
  );

  // ── Zone 1: Signal Summary Strip (D020) ─────────────────────────────────────

  protected readonly slaBreachCount    = computed(() => this.state.slaBreachCount());
  protected readonly atRiskCount       = computed(() =>
    this.state.pipeline().filter(c => c.slaStatus === 'AT_RISK').length,
  );
  protected readonly activePipelineCount = computed(() => this.state.pipeline().length);
  protected readonly acceptanceRate    = computed<string>(() => {
    const total = this.state.pipeline().length;
    if (!total) return '—';
    const n = this.state.pipeline().filter(c => OFFER_STAGES.includes(c.currentStage)).length;
    return `${Math.round((n / total) * 100)}%`;
  });

  // ── Zone 2: Candidates at Risk (D024 card anatomy, max 2) ───────────────────

  protected readonly atRiskTotal = computed(() =>
    this.state.pipeline().filter(c => c.slaStatus === 'BREACHED' || c.slaStatus === 'AT_RISK').length,
  );
  protected readonly candidatesAtRisk = computed<Candidate[]>(() =>
    [...this.state.pipeline()]
      .filter(c => c.slaStatus === 'BREACHED' || c.slaStatus === 'AT_RISK')
      .sort((a, b) =>
        (HEALTH_ORDER[a.slaStatus ?? 'ON_TRACK'] ?? 2) -
        (HEALTH_ORDER[b.slaStatus ?? 'ON_TRACK'] ?? 2),
      )
      .slice(0, 2),
  );

  // ── Zone 3: My Actions Today (max 3) ────────────────────────────────────────

  protected readonly myActionsToday = computed(() => this.state.pendingActions().slice(0, 3));

  // ── Zone 4: Pipeline Summary with health dots (D025) ────────────────────────

  protected readonly pipelinePhases = computed(() => {
    const pipeline = this.state.pipeline();
    return PHASE_META.map(p => ({
      ...p,
      candidates: pipeline.filter(c => PHASE_STAGES[p.phase].includes(c.currentStage)),
    }));
  });

  // ── Zone 5: This Month ───────────────────────────────────────────────────────

  protected readonly offersSentCount = computed(() =>
    this.state.pipeline().filter(c => OFFER_STAGES.includes(c.currentStage)).length,
  );
  protected readonly hesitantCount = computed(() =>
    this.state.pipeline().filter(
      c => c.acceptanceSentiment === 'HESITANT' || c.interviewSentiment === 'HESITANT',
    ).length,
  );

  ngOnInit(): void {
    this.state.loadPipeline();
    this.state.loadPendingActions();
  }

  // ── Candidate card helpers (D024) ────────────────────────────────────────────

  protected initials(c: Candidate): string {
    return (c.firstName[0] + c.lastName[0]).toUpperCase();
  }

  protected avatarClass(c: Candidate): string {
    if (c.slaStatus === 'BREACHED') return 'tf-cand-avatar tf-cand-avatar--breached';
    if (c.slaStatus === 'AT_RISK')  return 'tf-cand-avatar tf-cand-avatar--at-risk';
    return 'tf-cand-avatar tf-cand-avatar--healthy';
  }

  protected slaBarWidth(c: Candidate): number {
    if (c.slaStatus === 'BREACHED') return 100;
    if (c.slaStatus === 'AT_RISK')  return 82;
    return 35;
  }

  protected healthPillClass(c: Candidate): string {
    if (c.slaStatus === 'BREACHED') return 'tf-health-pill tf-health-pill--breached';
    if (c.slaStatus === 'AT_RISK')  return 'tf-health-pill tf-health-pill--at-risk';
    return 'tf-health-pill tf-health-pill--on-track';
  }

  protected healthLabel(c: Candidate): string {
    if (c.slaStatus === 'BREACHED') return 'Breached';
    if (c.slaStatus === 'AT_RISK')  return 'At Risk';
    return 'On Track';
  }

  protected sentimentLabel(c: Candidate): string | null {
    const s = c.interviewSentiment ?? c.acceptanceSentiment;
    const map: Record<string, string> = { POSITIVE: 'Positive', NEUTRAL: 'Neutral', HESITANT: 'Hesitant', EXCITED: 'Excited' };
    return s ? (map[s] ?? null) : null;
  }

  protected sentimentPillClass(c: Candidate): string {
    const s = c.interviewSentiment ?? c.acceptanceSentiment;
    if (s === 'HESITANT') return 'tf-sentiment-pill tf-sentiment-pill--hesitant';
    if (s === 'NEUTRAL')  return 'tf-sentiment-pill tf-sentiment-pill--neutral';
    return 'tf-sentiment-pill tf-sentiment-pill--positive';
  }

  protected stageLabel(stage: HiringStage): string {
    return STAGE_LABELS[stage] ?? stage;
  }

  protected stageContext(stage: HiringStage): string {
    return STAGE_CONTEXT[stage] ?? '';
  }

  protected dotClass(c: Candidate): string {
    if (c.slaStatus === 'BREACHED') return 'tf-phase-dot tf-phase-dot--red';
    if (c.slaStatus === 'AT_RISK')  return 'tf-phase-dot tf-phase-dot--amber';
    return 'tf-phase-dot tf-phase-dot--green';
  }

  // ── Action helpers (Zone 3) ──────────────────────────────────────────────────

  protected actionTitle(a: PendingAction): string {
    return ACTION_TITLES[a.toolName] ?? a.toolName;
  }

  protected actionIconClass(a: PendingAction): string {
    const urgency = this.actionUrgency(a);
    return `tf-action-icon tf-action-icon--${urgency}`;
  }

  protected actionPriorityClass(a: PendingAction): string {
    const urgency = this.actionUrgency(a);
    return `tf-priority-tag tf-priority-tag--${urgency}`;
  }

  protected actionPriorityLabel(a: PendingAction): string {
    const urgency = this.actionUrgency(a);
    if (urgency === 'breached') return 'Breached';
    if (urgency === 'at-risk')  return 'At Risk';
    return 'Pending';
  }

  private actionUrgency(a: PendingAction): 'breached' | 'at-risk' | 'pending' {
    const msTillExpiry = new Date(a.expiresAt).getTime() - Date.now();
    if (msTillExpiry < 0)          return 'breached';
    if (msTillExpiry < 86_400_000) return 'at-risk';
    return 'pending';
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  protected openCandidate(id: string): void {
    void this.router.navigate(['/platform/talentflow/candidates', id]);
  }

  protected openPipeline(queryParams?: Record<string, string>): void {
    void this.router.navigate(['/platform/talentflow/pipeline'], queryParams ? { queryParams } : {});
  }

  protected openCandidates(): void {
    void this.router.navigate(['/platform/talentflow/candidates']);
  }
}
