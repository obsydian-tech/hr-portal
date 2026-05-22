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
import { TalentFlowStateService } from '../../services/talent-flow-state.service';
import { Candidate, HiringStage, PositionLevel, SlaHealthStatus } from '../../models/talent-flow.models';
import { STAGE_LABELS } from '../../components/stage-selector/stage-selector.component';

/**
 * CandidatesPageComponent — Phase B (D059–D063)
 * Search-first: large search hero, quick filter chips,
 * recently viewed 4-card row, full results list.
 */

const RECENTLY_VIEWED_KEY = 'tf_recently_viewed';
const MAX_RECENT = 4;

type HealthFilter    = SlaHealthStatus | 'ALL';
type SeniorityFilter = PositionLevel | 'ALL';

@Component({
  selector: 'tf-candidates-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './candidates-page.component.html',
  styleUrl: './candidates-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CandidatesPageComponent implements OnInit {
  protected readonly state  = inject(TalentFlowStateService);
  private  readonly router  = inject(Router);

  // ── Search & filters ──────────────────────────────────────────────────────
  protected readonly searchQuery     = signal('');
  protected readonly healthFilter    = signal<HealthFilter>('ALL');
  protected readonly seniorityFilter = signal<SeniorityFilter>('ALL');

  // ── Recently viewed IDs (persisted in localStorage) ───────────────────────
  private readonly recentIds = signal<string[]>(this.loadRecentIds());

  // ── Derived: recently viewed candidates from pipeline ─────────────────────
  protected readonly recentlyViewed = computed<Candidate[]>(() => {
    const pipeline = this.state.pipeline();
    return this.recentIds()
      .map(id => pipeline.find(c => c.id === id))
      .filter((c): c is Candidate => c !== undefined)
      .slice(0, MAX_RECENT);
  });

  // ── Filtered candidates ───────────────────────────────────────────────────
  protected readonly filteredCandidates = computed<Candidate[]>(() => {
    let list = this.state.pipeline();
    const q         = this.searchQuery().toLowerCase().trim();
    const health    = this.healthFilter();
    const seniority = this.seniorityFilter();

    if (q) {
      list = list.filter(c =>
        c.firstName.toLowerCase().includes(q) ||
        c.lastName.toLowerCase().includes(q)  ||
        c.email.toLowerCase().includes(q)     ||
        c.role.toLowerCase().includes(q),
      );
    }
    if (health    !== 'ALL') list = list.filter(c => c.slaStatus === health);
    if (seniority !== 'ALL') list = list.filter(c => c.positionLevel === seniority);

    return list;
  });

  protected readonly stageLabels = STAGE_LABELS;
  protected readonly seniorityOptions: SeniorityFilter[] = ['ALL', 'JUNIOR', 'MID', 'SENIOR'];

  ngOnInit(): void {
    this.state.loadPipeline();
  }

  // ── Setters ───────────────────────────────────────────────────────────────
  protected setSearch(v: string): void           { this.searchQuery.set(v); }
  protected setHealth(h: HealthFilter): void     { this.healthFilter.set(h); }
  protected setSeniority(s: SeniorityFilter): void { this.seniorityFilter.set(s); }

  // ── Navigation ────────────────────────────────────────────────────────────
  protected openCandidate(id: string): void {
    this.recordRecentView(id);
    void this.router.navigate(['/platform/talentflow/candidates', id]);
  }

  protected openDashboard(): void {
    void this.router.navigate(['/platform/talentflow']);
  }

  // ── Card helpers ──────────────────────────────────────────────────────────
  protected initials(c: Candidate): string {
    return (c.firstName[0] + c.lastName[0]).toUpperCase();
  }

  protected avatarClass(c: Candidate): string {
    if (c.slaStatus === 'BREACHED') return 'tf-cv-avatar tf-cv-avatar--breached';
    if (c.slaStatus === 'AT_RISK')  return 'tf-cv-avatar tf-cv-avatar--at-risk';
    return 'tf-cv-avatar tf-cv-avatar--healthy';
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

  protected stageLabel(stage: HiringStage): string {
    return STAGE_LABELS[stage] ?? stage;
  }

  // ── Recently viewed persistence ───────────────────────────────────────────
  private loadRecentIds(): string[] {
    try {
      return JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) ?? '[]');
    } catch {
      return [];
    }
  }

  private recordRecentView(id: string): void {
    const current = this.recentIds().filter(i => i !== id);
    const updated  = [id, ...current].slice(0, MAX_RECENT);
    this.recentIds.set(updated);
    try { localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(updated)); } catch { /* quota */ }
  }
}
