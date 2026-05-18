import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ScoringWeights, VotePayload, DEFAULT_SCORING_WEIGHTS } from '../../models/talent-flow.models';

/**
 * EvaluationScoringPanel — FE-005 / NH-138
 *
 * Design source: VerificationDetail.jsx (.vd-card, .vd-field scoring rows)
 *                17-stat-card.html (.scard score display)
 *
 * Panel member scores each criterion (0–10). Weighted total auto-computes.
 * Emits VotePayload on submit (interviewId resolved by parent).
 *
 * Criteria → weights mapping:
 *   technical (30%), communication (25%), culturalFit (25%), problemSolving (20%)
 *
 * Decision: HIRE | NO_HIRE | STRONG_NO_VETO
 */

export type DecisionOption = 'HIRE' | 'NO_HIRE' | 'STRONG_NO_VETO';

interface CriterionRow {
  key:    keyof ScoringWeights;
  label:  string;
  icon:   string;
}

const CRITERIA: CriterionRow[] = [
  { key: 'technical',      label: 'Technical Ability',  icon: 'pi-code'        },
  { key: 'communication',  label: 'Communication',      icon: 'pi-comments'    },
  { key: 'culturalFit',    label: 'Cultural Fit',       icon: 'pi-heart'       },
  { key: 'problemSolving', label: 'Problem Solving',    icon: 'pi-lightbulb'   },
];

@Component({
  selector: 'tf-evaluation-scoring-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule],
  templateUrl: './evaluation-scoring-panel.component.html',
  styleUrl:    './evaluation-scoring-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EvaluationScoringPanelComponent {
  readonly weights  = input<ScoringWeights>(DEFAULT_SCORING_WEIGHTS);
  readonly readOnly = input<boolean>(false);
  /** interviewId is required when submitting a vote */
  readonly interviewId = input<string>('');

  readonly scoreSubmitted = output<VotePayload>();

  protected readonly criteria = CRITERIA;

  // ── Score signals per criterion (0–10) ───────────────────────────────────
  protected readonly scores = signal<Record<keyof ScoringWeights, number>>({
    technical:      0,
    communication:  0,
    culturalFit:    0,
    problemSolving: 0,
  });

  protected readonly decision = signal<DecisionOption | null>(null);
  protected readonly notes    = signal<string>('');
  protected readonly submitted = signal<boolean>(false);

  // ── Weighted total (0–10) ─────────────────────────────────────────────────
  protected readonly weightedTotal = computed<number>(() => {
    const s = this.scores();
    const w = this.weights();
    const total = 100;
    return (
      (s.technical      * w.technical      +
       s.communication  * w.communication  +
       s.culturalFit    * w.culturalFit    +
       s.problemSolving * w.problemSolving) / total
    );
  });

  protected readonly totalClass = computed<string>(() => {
    const t = this.weightedTotal();
    if (t >= 7) return 'score--high';
    if (t >= 5) return 'score--mid';
    return 'score--low';
  });

  protected readonly canSubmit = computed<boolean>(() =>
    !this.readOnly() &&
    !this.submitted() &&
    this.decision() !== null &&
    this.interviewId() !== '',
  );

  protected setScore(key: keyof ScoringWeights, value: number): void {
    this.scores.update((s) => ({ ...s, [key]: Math.min(10, Math.max(0, value)) }));
  }

  protected setDecision(d: DecisionOption): void {
    this.decision.set(d);
  }

  protected setNotes(v: string): void {
    this.notes.set(v);
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    const payload: VotePayload = {
      interviewId: this.interviewId(),
      decision:    this.decision()!,
      scores:      { ...this.scores() },
      notes:       this.notes() || undefined,
    };
    this.submitted.set(true);
    this.scoreSubmitted.emit(payload);
  }

  protected scoreBarWidth(key: keyof ScoringWeights): number {
    return (this.scores()[key] / 10) * 100;
  }

  protected weightLabel(key: keyof ScoringWeights): string {
    return `${this.weights()[key]}%`;
  }
}
