import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface Criterion {
  name: string;
  /** "Counts for 30%". Left out on a panel summary. */
  weight?: string;
  score: number;
  /** In words: strong, excellent, fair. */
  word: string;
}

/**
 * Interview scores: the overall number, a bar per criterion with the score in words, a note, and who scored.
 * Overall lozenges ("2 say yes") and the footer (`<pp-scorecard-footer>`) go inside.
 * `<pp-scorecard [value]="7.4" word="Strong overall" [criteria]="criteria" note="…"><pp-scorecard-footer>…</pp-scorecard-footer></pp-scorecard>`
 * Spec: records/evaluation-score.md
 */
@Component({
  selector: 'pp-scorecard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-scorecard__overall">
      <span class="pp-scorecard__total"><span class="pp-scorecard__value">{{ value() }}</span><span class="pp-scorecard__out-of">{{ outOf() }}</span></span>
      @if (word()) { <span class="pp-scorecard__word">{{ word() }}</span> }
      <ng-content select="pp-lozenge" />
    </div>
    <ul class="pp-scorecard__criteria" [attr.aria-label]="criteriaLabel()">
      @for (c of criteria(); track c.name) {
        <li class="pp-scorecard__criterion">
          <span class="pp-scorecard__label"><span class="pp-scorecard__name">{{ c.name }}</span>@if (c.weight) {<span class="pp-scorecard__weight">{{ c.weight }}</span>}</span>
          <span class="pp-scorecard__bar" aria-hidden="true"><span class="pp-scorecard__fill" [style.--_pct]="(c.score / max()) * 100 + '%'"></span></span>
          <span class="pp-scorecard__score"><strong>{{ c.score }}</strong> of {{ max() }}, {{ c.word }}</span>
        </li>
      }
    </ul>
    @if (note()) { <div class="pp-scorecard__note">{{ note() }}</div> }
    <ng-content select="pp-scorecard-footer" />
  `,
  host: { class: 'pp-scorecard' },
})
export class PpScorecard {
  readonly value = input.required<number | string>();
  readonly max = input(10);
  /** "out of 10", or "out of 10, average of 3" on a panel summary. */
  readonly outOf = input('out of 10');
  readonly word = input<string>();
  readonly criteria = input.required<Criterion[]>();
  readonly criteriaLabel = input('Scores by criterion');
  readonly note = input<string>();
}

/** Who scored and when, or who is still to score with a reminder. */
@Component({
  selector: 'pp-scorecard-footer',
  template: `<ng-content />@if (when()) {<time class="pp-scorecard__when" [attr.datetime]="at()">{{ when() }}</time>}`,
  host: { class: 'pp-scorecard__footer' }, changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PpScorecardFooter {
  /** When it was scored, in words ("Scored 3 Nov 2026, 15:05"), and the exact time. */
  readonly when = input<string>();
  readonly at = input<string>();
}
