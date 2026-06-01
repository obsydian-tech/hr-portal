import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  computed,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TalentFlowStateService } from '../../services/talent-flow-state.service';
import { Candidate, HiringStage, PositionLevel, SlaHealthStatus } from '../../models/talent-flow.models';
import { STAGE_LABELS } from '../../components/stage-selector/stage-selector.component';

/**
 * PipelinePageComponent — Phase B rebuild
 * D052 list-first view, D053 5-group filter bar, D054 results bar,
 * D055 sort dropdown, D058 urgency sort default
 */

// D057: Kanban columns are per phase (4 columns), not per stage (12 columns)
export interface KanbanPhase {
  id:     number;
  label:  string;
  sub:    string;
  stages: HiringStage[];
}

export const KANBAN_PHASES: KanbanPhase[] = [
  {
    id:     1,
    label:  'Interview & Evaluation',
    sub:    'Screen, evaluate, decide',
    stages: ['APPLICATION_REVIEW', 'INTERVIEWING', 'EVALUATION'],
  },
  {
    id:     2,
    label:  'Offer Stage',
    sub:    'Create, approve, send',
    stages: ['BACKGROUND_CHECK', 'OFFER_PREPARATION', 'OFFER_APPROVAL', 'OFFER_DELIVERY', 'CONTRACT_SIGNING'],
  },
  {
    id:     3,
    label:  'Accepted',
    sub:    'Signed and confirmed',
    stages: ['PRE_BOARDING'],
  },
  {
    id:     4,
    label:  'Pre-Onboarding',
    sub:    'Prepare and activate',
    stages: ['ONBOARDING'],
  },
];

const ALL_STAGES: HiringStage[] = KANBAN_PHASES.flatMap(p => p.stages);

const STAGE_ORDER: Record<HiringStage, number> = Object.fromEntries(
  ALL_STAGES.map((s, i) => [s, i]),
) as Record<HiringStage, number>;

const HEALTH_ORDER: Record<string, number> = { BREACHED: 0, AT_RISK: 1, ON_TRACK: 2 };

type ViewMode      = 'list' | 'kanban';
type SortBy        = 'urgency' | 'name' | 'stage' | 'applied';
type HealthFilter  = SlaHealthStatus | 'ALL';
type PhaseFilter   = 'ALL' | 1 | 2 | 3 | 4;
type SentimentFilter = 'ALL' | 'POSITIVE' | 'NEUTRAL' | 'HESITANT' | 'EXCITED';

@Component({
  selector: 'tf-pipeline-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule],
  templateUrl: './pipeline-page.component.html',
  styleUrl: './pipeline-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PipelinePageComponent implements OnInit {
  protected readonly state = inject(TalentFlowStateService);
  private  readonly router = inject(Router);
  private  readonly route  = inject(ActivatedRoute);

  // ── View mode (D052: list default) ──────────────────────────────────────────
  protected readonly viewMode = signal<ViewMode>('list');

  // ── Filter state ─────────────────────────────────────────────────────────────
  protected readonly phaseFilter     = signal<PhaseFilter>('ALL');
  protected readonly healthFilter    = signal<HealthFilter>('ALL');
  protected readonly seniorityFilter = signal<PositionLevel | 'ALL'>('ALL');
  protected readonly sentimentFilter = signal<SentimentFilter>('ALL');
  protected readonly searchQuery     = signal<string>('');
  protected readonly sortBy          = signal<SortBy>('urgency');

  // ── Exposed constants ─────────────────────────────────────────────────────────
  protected readonly stageLabels   = STAGE_LABELS;
  protected readonly kanbanPhases  = KANBAN_PHASES;

  protected readonly phaseOptions: { id: PhaseFilter; label: string }[] = [
    { id: 'ALL', label: 'All Stages' },
    { id: 1,     label: 'Interview & Evaluation' },
    { id: 2,     label: 'Offer Stage' },
    { id: 3,     label: 'Accepted' },
    { id: 4,     label: 'Pre-Onboarding' },
  ];
  protected readonly seniorityOptions: (PositionLevel | 'ALL')[] = ['ALL', 'JUNIOR', 'MID', 'SENIOR'];
  protected readonly sentimentOptions: SentimentFilter[] = ['ALL', 'POSITIVE', 'NEUTRAL', 'HESITANT', 'EXCITED'];

  // ── Filtered + sorted pipeline ───────────────────────────────────────────────
  protected readonly filteredPipeline = computed<Candidate[]>(() => {
    let list = this.state.pipeline();

    const phase     = this.phaseFilter();
    const health    = this.healthFilter();
    const seniority = this.seniorityFilter();
    const sentiment = this.sentimentFilter();
    const q         = this.searchQuery().toLowerCase().trim();

    if (phase !== 'ALL') {
      const phaseStages = KANBAN_PHASES.find(p => p.id === phase)?.stages ?? [];
      list = list.filter(c => phaseStages.includes(c.currentStage));
    }
    if (health !== 'ALL')    list = list.filter(c => c.slaStatus === health);
    if (seniority !== 'ALL') list = list.filter(c => c.positionLevel === seniority);
    if (sentiment !== 'ALL') {
      list = list.filter(c =>
        c.interviewSentiment === sentiment || c.acceptanceSentiment === sentiment,
      );
    }
    if (q) {
      list = list.filter(c =>
        c.firstName.toLowerCase().includes(q) ||
        c.lastName.toLowerCase().includes(q)  ||
        c.email.toLowerCase().includes(q)     ||
        c.role.toLowerCase().includes(q),
      );
    }

    return this.sortList([...list], this.sortBy());
  });

  // ── Results bar stats ────────────────────────────────────────────────────────
  protected readonly resultBreachCount = computed(() =>
    this.filteredPipeline().filter(c => c.slaStatus === 'BREACHED').length,
  );
  protected readonly resultAtRiskCount = computed(() =>
    this.filteredPipeline().filter(c => c.slaStatus === 'AT_RISK').length,
  );

  ngOnInit(): void {
    this.state.loadPipeline();
    // Support health pre-filter from dashboard navigation (D020 card click)
    this.route.queryParams.subscribe(params => {
      if (params['health']) this.healthFilter.set(params['health'] as HealthFilter);
    });
  }

  // ── Sort ─────────────────────────────────────────────────────────────────────
  private sortList(list: Candidate[], sort: SortBy): Candidate[] {
    switch (sort) {
      case 'urgency':
        return list.sort((a, b) => {
          const hDiff = (HEALTH_ORDER[a.slaStatus ?? 'ON_TRACK'] ?? 2) -
                        (HEALTH_ORDER[b.slaStatus ?? 'ON_TRACK'] ?? 2);
          if (hDiff !== 0) return hDiff;
          return (STAGE_ORDER[a.currentStage] ?? 0) - (STAGE_ORDER[b.currentStage] ?? 0);
        });
      case 'name':
        return list.sort((a, b) =>
          `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
        );
      case 'stage':
        return list.sort((a, b) =>
          (STAGE_ORDER[a.currentStage] ?? 0) - (STAGE_ORDER[b.currentStage] ?? 0),
        );
      case 'applied':
        return list.sort((a, b) =>
          new Date(b.appliedDate).getTime() - new Date(a.appliedDate).getTime(),
        );
    }
  }

  // ── Filter setters ────────────────────────────────────────────────────────────
  protected setView(v: ViewMode): void               { this.viewMode.set(v); }
  protected setPhaseFilter(p: PhaseFilter): void     { this.phaseFilter.set(p); }
  protected setHealthFilter(h: HealthFilter): void   { this.healthFilter.set(h); }
  protected setSeniorityFilter(s: PositionLevel | 'ALL'): void { this.seniorityFilter.set(s); }
  protected setSentimentFilter(s: SentimentFilter): void { this.sentimentFilter.set(s); }
  protected setSearch(v: string): void               { this.searchQuery.set(v); }
  protected setSortBy(s: SortBy): void               { this.sortBy.set(s); }

  // ── Kanban helpers (D057: per-phase, not per-stage) ───────────────────────────
  protected candidatesForPhase(phase: KanbanPhase): Candidate[] {
    return this.filteredPipeline().filter(c => phase.stages.includes(c.currentStage));
  }

  protected phaseStageLabel(c: Candidate): string {
    return this.stageLabels[c.currentStage] ?? c.currentStage;
  }

  protected hasUrgent(cards: Candidate[]): boolean {
    return cards.some(c => c.slaStatus === 'BREACHED' || c.slaStatus === 'AT_RISK');
  }

  // ── Card helpers ──────────────────────────────────────────────────────────────
  protected initials(c: Candidate): string {
    return (c.firstName[0] + c.lastName[0]).toUpperCase();
  }

  protected avatarClass(c: Candidate): string {
    if (c.slaStatus === 'BREACHED') return 'tf-pl-avatar tf-pl-avatar--breached';
    if (c.slaStatus === 'AT_RISK')  return 'tf-pl-avatar tf-pl-avatar--at-risk';
    return 'tf-pl-avatar tf-pl-avatar--healthy';
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

  protected slaBarWidth(c: Candidate): number {
    if (c.slaStatus === 'BREACHED') return 100;
    if (c.slaStatus === 'AT_RISK')  return 82;
    return 35;
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

  // ── Navigation ────────────────────────────────────────────────────────────────
  protected openCandidate(id: string): void {
    void this.router.navigate(['/platform/talentflow/candidates', id]);
  }

  protected openDashboard(): void {
    void this.router.navigate(['/platform/talentflow']);
  }
}
