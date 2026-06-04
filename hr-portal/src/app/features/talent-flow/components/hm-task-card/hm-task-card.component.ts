import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SliderModule } from 'primeng/slider';
import { TalentFlowApiService } from '../../services/talent-flow-api.service';
import { Candidate, VotePayload } from '../../models/talent-flow.models';

type VoteDecision = 'STRONG_NO' | 'NO' | 'YES' | 'STRONG_YES';

const STAGE_LABELS: Record<string, string> = {
  APPLICATION_REVIEW: 'Application Review',
  INTERVIEWING:       'Interviewing',
  EVALUATION:         'Evaluation',
};


@Component({
  selector: 'tf-hm-task-card',
  standalone: true,
  imports: [FormsModule, ButtonModule, SliderModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- ── Card header ──────────────────────────────────────────────────── -->
    <div class="hm-card">
      <div class="hm-card__header">
        <div class="hm-card__avatar">
          {{ initials() }}
        </div>

        <div class="hm-card__meta">
          <div class="hm-card__name">{{ candidate().firstName }} {{ candidate().lastName }}</div>
          <div class="hm-card__role">{{ candidate().role }}</div>
          <div class="hm-card__tags">
            <span class="hm-level-badge hm-level-badge--{{ levelClass() }}">{{ candidate().positionLevel }}</span>
            <span class="hm-card__stage">{{ currentStageLabel() }}</span>
            <span class="hm-card__sla hm-card__sla--{{ candidate().slaStatus ?? 'ON_TRACK' }}">
              ●
            </span>
          </div>
        </div>

        @if (voted()) {
          <span class="hm-card__voted-badge">
            <i class="pi pi-check-circle"></i> Voted
          </span>
        } @else {
          <p-button
            [label]="panelOpen() ? 'Close' : 'Evaluate'"
            [icon]="panelOpen() ? 'pi pi-times' : 'pi pi-file-edit'"
            styleClass="hm-card__eval-btn"
            [outlined]="!panelOpen()"
            (onClick)="togglePanel()"
          />
        }
      </div>

      <!-- ── Inline scoring panel (D048 — NOT a modal/drawer) ───────────── -->
      @if (panelOpen()) {
        <div class="hm-scoring-panel">

          <!-- 4 sliders (D049) -->
          <div class="hm-sliders">

            <div class="hm-slider-row">
              <span class="hm-slider-label">Technical</span>
              <p-slider [(ngModel)]="techScore" [min]="1" [max]="10" [step]="1" styleClass="hm-slider" (ngModelChange)="autoAdjustVote()" />
              <span class="hm-slider-value">{{ techScore }}</span>
            </div>

            <div class="hm-slider-row">
              <span class="hm-slider-label">Communication</span>
              <p-slider [(ngModel)]="commScore" [min]="1" [max]="10" [step]="1" styleClass="hm-slider" (ngModelChange)="autoAdjustVote()" />
              <span class="hm-slider-value">{{ commScore }}</span>
            </div>

            <div class="hm-slider-row">
              <span class="hm-slider-label">Cultural Fit</span>
              <p-slider [(ngModel)]="cultureScore" [min]="1" [max]="10" [step]="1" styleClass="hm-slider" (ngModelChange)="autoAdjustVote()" />
              <span class="hm-slider-value">{{ cultureScore }}</span>
            </div>

            <div class="hm-slider-row">
              <span class="hm-slider-label">Problem Solving</span>
              <p-slider [(ngModel)]="problemScore" [min]="1" [max]="10" [step]="1" styleClass="hm-slider" (ngModelChange)="autoAdjustVote()" />
              <span class="hm-slider-value">{{ problemScore }}</span>
            </div>

          </div>

          <!-- Vote grid (D050) — 4 options, "Yes" pre-selected -->
          <div class="hm-vote-grid">
            <!-- Score ≤ 5 → only negative votes; Score > 5 → only positive votes -->
            <button
              class="hm-vote-btn hm-vote-btn--negative"
              [class.hm-vote-btn--active-negative]="vote() === 'STRONG_NO'"
              [disabled]="isHighScore"
              [title]="isHighScore ? 'Scores above 5 — only Yes votes available' : ''"
              type="button"
              (click)="setVote('STRONG_NO')"
            >
              Strong No
            </button>
            <button
              class="hm-vote-btn hm-vote-btn--negative"
              [class.hm-vote-btn--active-negative]="vote() === 'NO'"
              [disabled]="isHighScore"
              [title]="isHighScore ? 'Scores above 5 — only Yes votes available' : ''"
              type="button"
              (click)="setVote('NO')"
            >
              No
            </button>
            <button
              class="hm-vote-btn hm-vote-btn--positive"
              [class.hm-vote-btn--active-positive]="vote() === 'YES'"
              [disabled]="!isHighScore"
              [title]="!isHighScore ? 'Scores must be above 5 to vote Yes' : ''"
              type="button"
              (click)="setVote('YES')"
            >
              Yes
            </button>
            <button
              class="hm-vote-btn hm-vote-btn--positive"
              [class.hm-vote-btn--active-positive]="vote() === 'STRONG_YES'"
              [disabled]="!isHighScore"
              [title]="!isHighScore ? 'Scores must be above 5 to vote Strong Yes' : ''"
              type="button"
              (click)="setVote('STRONG_YES')"
            >
              Strong Yes
            </button>
          </div>

          <!-- Submit -->
          @if (errorMsg()) {
            <div class="hm-error">{{ errorMsg() }}</div>
          }

          <p-button
            label="Submit Vote"
            icon="pi pi-check"
            styleClass="hm-submit-btn"
            [loading]="submitting()"
            [disabled]="!hasInterviewId()"
            (onClick)="submitEvaluation()"
          />

          @if (!hasInterviewId()) {
            <p class="hm-no-interview">No active interview — schedule one first.</p>
          }

        </div>
      }
    </div>
  `,
  styles: [`
    .hm-card {
      background: var(--naleko-surface-container-lowest);
      border: 1.5px solid rgba(200, 197, 205, 0.2);
      border-radius: var(--naleko-radius-lg);
      box-shadow: var(--naleko-shadow-card);
      padding: 1.25rem;
      margin-bottom: 1rem;
    }

    .hm-card__header {
      display: flex;
      align-items: flex-start;
      gap: 0.875rem;
    }

    .hm-card__avatar {
      width: 40px;
      height: 40px;
      min-width: 40px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--naleko-secondary) 15%, transparent);
      color: var(--naleko-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.875rem;
      font-weight: 700;
    }

    .hm-card__meta { flex: 1; }

    .hm-card__name {
      font-size: 0.9375rem;
      font-weight: 600;
      color: var(--naleko-on-surface);
    }

    .hm-card__role {
      font-size: 0.8125rem;
      color: var(--naleko-on-surface-variant);
      margin-top: 0.125rem;
    }

    .hm-card__tags {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.375rem;
    }

    .hm-level-badge {
      font-size: 0.6rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 0.2rem 0.5rem;
      border-radius: var(--naleko-radius-pill);
    }
    .hm-level-badge--junior {
      background: color-mix(in srgb, var(--naleko-success) 15%, transparent);
      color: var(--naleko-success);
    }
    .hm-level-badge--mid {
      background: color-mix(in srgb, var(--naleko-secondary) 12%, transparent);
      color: var(--naleko-secondary);
    }
    .hm-level-badge--senior {
      background: color-mix(in srgb, var(--naleko-warning) 15%, transparent);
      color: var(--naleko-warning);
    }

    .hm-card__stage {
      font-size: 0.72rem;
      color: var(--naleko-on-surface-variant);
    }

    .hm-card__sla { font-size: 0.625rem; }
    .hm-card__sla--ON_TRACK  { color: var(--naleko-success); }
    .hm-card__sla--AT_RISK   { color: var(--naleko-warning); }
    .hm-card__sla--BREACHED  { color: var(--naleko-danger); }

    .hm-scoring-panel {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid rgba(200, 197, 205, 0.25);
    }

    .hm-sliders { display: flex; flex-direction: column; gap: 0.875rem; margin-bottom: 1.25rem; }

    .hm-slider-row {
      display: grid;
      grid-template-columns: 130px 1fr 28px;
      align-items: center;
      gap: 0.75rem;
    }

    .hm-slider-label {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--naleko-on-surface-variant);
      white-space: nowrap;
    }

    .hm-slider-value {
      font-size: 0.875rem;
      font-weight: 700;
      color: var(--naleko-secondary);
      text-align: right;
    }

    .hm-vote-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .hm-vote-btn {
      padding: 0.5rem 0.25rem;
      border-radius: var(--naleko-radius-md);
      border: 2px solid rgba(200, 197, 205, 0.35);
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      background: var(--naleko-surface-container-low);
      color: var(--naleko-on-surface-variant);
    }

    .hm-vote-btn--positive.hm-vote-btn--active-positive {
      background: var(--naleko-secondary);
      color: #fff;
      border-color: var(--naleko-secondary);
    }

    .hm-vote-btn--negative.hm-vote-btn--active-negative {
      background: color-mix(in srgb, var(--naleko-danger) 12%, transparent);
      color: var(--naleko-danger);
      border-color: var(--naleko-danger);
    }

    .hm-error {
      color: var(--naleko-danger);
      font-size: 0.8125rem;
      margin-bottom: 0.5rem;
    }

    .hm-no-interview {
      font-size: 0.75rem;
      color: var(--naleko-on-surface-variant);
      margin-top: 0.375rem;
    }

    .hm-card__voted-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--naleko-success);
      background: color-mix(in srgb, var(--naleko-success) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--naleko-success) 35%, transparent);
      border-radius: var(--naleko-radius-md);
      padding: 0.375rem 0.75rem;
      white-space: nowrap;
    }

    :host ::ng-deep .hm-slider { width: 100%; }

    :host ::ng-deep .hm-submit-btn.p-button {
      width: 100%;
      justify-content: center;
      background: var(--naleko-secondary);
      border-color: var(--naleko-secondary);
    }

    :host ::ng-deep .hm-card__eval-btn.p-button {
      white-space: nowrap;
      border-color: var(--naleko-secondary);
      color: var(--naleko-secondary);
    }

    :host ::ng-deep .hm-card__eval-btn.p-button:hover:not(:disabled) {
      background: color-mix(in srgb, var(--naleko-secondary) 8%, transparent);
    }
  `],
})
export class HmTaskCardComponent {
  private readonly api = inject(TalentFlowApiService);

  // ── Inputs / Outputs ──────────────────────────────────────────────────────
  readonly candidate     = input.required<Candidate>();
  readonly voted         = input<boolean>(false);
  readonly voteSubmitted = output<string>(); // emits candidate ID

  // ── State ─────────────────────────────────────────────────────────────────
  protected readonly panelOpen  = signal(false);
  protected readonly vote       = signal<VoteDecision>('YES');
  protected readonly submitting = signal(false);
  protected readonly errorMsg   = signal('');

  // Plain properties for p-slider ngModel binding (CVA requires mutable ref)
  protected techScore    = 5;
  protected commScore    = 5;
  protected cultureScore = 5;
  protected problemScore = 5;

  /** Average of the 4 sliders (1–10 scale) */
  protected get averageScore(): number {
    return (this.techScore + this.commScore + this.cultureScore + this.problemScore) / 4;
  }

  /**
   * True when average > 5 — only YES/STRONG_YES are valid.
   * False (≤ 5) — only NO/STRONG_NO are valid.
   */
  protected get isHighScore(): boolean {
    return this.averageScore > 5;
  }

  /** Auto-correct the vote direction whenever a slider changes. */
  protected autoAdjustVote(): void {
    if (this.isHighScore && (this.vote() === 'NO' || this.vote() === 'STRONG_NO')) {
      this.vote.set('YES');
    } else if (!this.isHighScore && (this.vote() === 'YES' || this.vote() === 'STRONG_YES')) {
      this.vote.set('NO');
    }
  }

  // ── Computed ──────────────────────────────────────────────────────────────
  protected initials(): string {
    const c = this.candidate();
    return ((c.firstName[0] ?? '') + (c.lastName[0] ?? '')).toUpperCase();
  }

  protected currentStageLabel(): string {
    return STAGE_LABELS[this.candidate().currentStage] ?? this.candidate().currentStage;
  }

  protected levelClass(): string {
    return (this.candidate().positionLevel ?? 'mid').toLowerCase();
  }

  protected hasInterviewId(): boolean {
    return !!this.candidate().currentInterviewId;
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  protected togglePanel(): void {
    if (this.voted()) return;
    this.panelOpen.update((v) => !v);
    this.errorMsg.set('');
  }

  protected setVote(decision: VoteDecision): void {
    this.vote.set(decision);
  }

  protected submitEvaluation(): void {
    const c = this.candidate();
    if (!c.currentInterviewId) return;

    this.submitting.set(true);
    this.errorMsg.set('');

    const payload: VotePayload = {
      interviewId: c.currentInterviewId,
      decision:    this.vote(),
      scores: {
        technical:      this.techScore,
        communication:  this.commScore,
        culturalFit:    this.cultureScore,
        problemSolving: this.problemScore,
      },
      notes: '',
    };

    this.api.submitVote(c.id, payload).subscribe({
      next: () => {
        this.submitting.set(false);
        this.panelOpen.set(false);
        this.voteSubmitted.emit(c.id);
        // Reset sliders for next use
        this.techScore    = 5;
        this.commScore    = 5;
        this.cultureScore = 5;
        this.problemScore = 5;
        this.vote.set('YES');
      },
      error: (err: { message?: string }) => {
        this.submitting.set(false);
        this.errorMsg.set(err?.message ?? 'Submission failed. Please try again.');
      },
    });
  }
}
