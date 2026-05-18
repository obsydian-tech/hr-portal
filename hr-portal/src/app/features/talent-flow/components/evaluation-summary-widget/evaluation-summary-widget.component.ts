import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Vote, ScoringWeights, DEFAULT_SCORING_WEIGHTS } from '../../models/talent-flow.models';

/**
 * EvaluationSummaryWidget — FE-005 / NH-138
 *
 * Design source: VerificationDetail.jsx (.vd-card, .vd-tl timeline)
 *                17-stat-card.html (.scard aggregate scores)
 *
 * Read-only aggregated view of all panel votes for a candidate/interview.
 * Shows:
 *   - Vote decision breakdown (HIRE / NO_HIRE / STRONG_NO_VETO tally)
 *   - Weighted avg score per criterion
 *   - Individual vote rows with panelMemberId + decision chip
 */
@Component({
  selector: 'tf-evaluation-summary',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './evaluation-summary-widget.component.html',
  styleUrl:    './evaluation-summary-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EvaluationSummaryWidgetComponent {
  readonly votes   = input<Vote[]>([]);
  readonly weights = input<ScoringWeights>(DEFAULT_SCORING_WEIGHTS);

  // ── Decision tally ────────────────────────────────────────────────────────
  protected readonly hireCount      = computed(() => this.votes().filter((v) => v.decision === 'HIRE').length);
  protected readonly noHireCount    = computed(() => this.votes().filter((v) => v.decision === 'NO_HIRE').length);
  protected readonly vetoCount      = computed(() => this.votes().filter((v) => v.decision === 'STRONG_NO_VETO').length);
  protected readonly totalVotes     = computed(() => this.votes().length);

  protected readonly consensusLabel = computed<string>(() => {
    if (!this.totalVotes()) return 'No votes yet';
    if (this.vetoCount() > 0) return 'Strong No — Veto';
    const hire = this.hireCount();
    const total = this.totalVotes();
    if (hire === total) return 'Unanimous Hire';
    if (hire > total / 2) return 'Majority Hire';
    return 'Majority No Hire';
  });

  protected readonly consensusClass = computed<string>(() => {
    if (!this.totalVotes()) return '';
    if (this.vetoCount() > 0) return 'consensus--veto';
    return this.hireCount() > this.totalVotes() / 2 ? 'consensus--hire' : 'consensus--no-hire';
  });

  // ── Avg scores per criterion ──────────────────────────────────────────────
  private avgScore(key: keyof ScoringWeights): number {
    const vs = this.votes();
    if (!vs.length) return 0;
    const total = vs.reduce((sum, v) => sum + (Number(v.scores[key]) || 0), 0);
    return Math.round((total / vs.length) * 10) / 10;
  }

  protected readonly avgTechnical      = computed(() => this.avgScore('technical'));
  protected readonly avgCommunication  = computed(() => this.avgScore('communication'));
  protected readonly avgCulturalFit    = computed(() => this.avgScore('culturalFit'));
  protected readonly avgProblemSolving = computed(() => this.avgScore('problemSolving'));

  protected readonly weightedAvg = computed<number>(() => {
    const w = this.weights();
    return Math.round(
      ((this.avgTechnical()      * w.technical      +
        this.avgCommunication()  * w.communication  +
        this.avgCulturalFit()    * w.culturalFit    +
        this.avgProblemSolving() * w.problemSolving) / 100) * 10,
    ) / 10;
  });

  protected decisionChipClass(decision: string): string {
    if (decision === 'HIRE')           return 'ev-chip ev-chip--hire';
    if (decision === 'STRONG_NO_VETO') return 'ev-chip ev-chip--veto';
    return 'ev-chip ev-chip--no-hire';
  }

  protected decisionLabel(decision: string): string {
    if (decision === 'HIRE')           return 'Hire';
    if (decision === 'STRONG_NO_VETO') return 'Veto';
    return 'No Hire';
  }

  protected barWidth(score: number): number {
    return (score / 10) * 100;
  }
}
