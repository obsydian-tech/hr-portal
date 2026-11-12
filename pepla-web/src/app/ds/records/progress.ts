import { ChangeDetectionStrategy, Component, Directive, computed, inject, input } from '@angular/core';
import { PpIcon } from '../core/icon';
import { AvatarColour, AvatarSize, PpPerson } from '../core/avatar';
import { PpProgressBar } from '../status/status';
import { PpDeadline } from './records';
import { daysBetween, toDate } from '../format';

/** Internal: puts the row's class on the deadline chip itself. */
@Directive({ selector: '[ppDeadline][ppPersonProgressDeadline]' })
export class PpPersonProgressDeadline { constructor() { inject(PpDeadline).extra.set(' pp-person-progress__deadline'); } }

/**
 * One person on their way in: who, their documents so far, and the next deadline (or Ready).
 * `<ul ppPersonProgressList><li ppPersonProgress name="Kagiso Molefe" meta="Bookkeeper · Starts Mon 16 Nov" link="/people/42"
 *    [done]="5" [total]="6" next="bank letter" due="2026-11-13" /></ul>`. Spec: records/person-progress.md
 */
@Component({
  selector: 'li[ppPersonProgress]',
  imports: [PpIcon, PpPerson, PpProgressBar, PpDeadline, PpPersonProgressDeadline],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-person [name]="name()" [meta]="meta()" [link]="link()" [colour]="colour()" [size]="size()" />
    <pp-progress-bar [label]="label()" [value]="done()" [max]="total()" [valueText]="valueText()" [tone]="tone()" trackSize="small" />
    @if (ready()) { <span class="pp-lozenge pp-lozenge--success pp-person-progress__deadline"><svg ppIcon="circle-check" /><span class="pp-lozenge__text">Ready</span></span> }
    @else if (due()) { <time ppDeadline ppPersonProgressDeadline [due]="due()" [subject]="subject()" [now]="now()" [truncate]="true"></time> }
  `,
  host: { class: 'pp-person-progress' },
})
export class PpPersonProgress {
  readonly name = input.required<string>();
  readonly meta = input<string>();
  readonly link = input<string>();
  readonly colour = input<AvatarColour>();
  /** Large in a card, medium in a narrow side panel. */
  readonly size = input<AvatarSize>('large');
  readonly label = input('Documents');
  readonly done = input.required<number>();
  readonly total = input.required<number>();
  /** The one they need next: "bank letter" gives "5 of 6 · Next: bank letter". */
  readonly next = input<string>();
  readonly due = input<Date | string>();
  /** What is late, when it is one thing: "ID" gives "ID overdue by 1 day". */
  readonly subject = input<string>();
  readonly now = input<Date>();
  protected readonly ready = computed(() => this.done() >= this.total());
  protected readonly valueText = computed(() => this.ready() ? `All ${this.total()} documents`
    : this.next() ? `${this.done()} of ${this.total()} · Next: ${this.next()}` : `${this.done()} of ${this.total()} documents`);
  protected readonly tone = computed(() => {
    if (this.ready()) return 'success' as const;
    const due = this.due();
    if (!due) return 'neutral' as const;
    const days = daysBetween(this.now() ?? new Date(), toDate(due));
    return days < 0 ? 'danger' as const : days <= 2 ? 'warning' as const : 'neutral' as const;
  });
}

/** The list the rows sit in: `<ul ppPersonProgressList>`. */
@Directive({ selector: 'ul[ppPersonProgressList]', host: { class: 'pp-person-progress-list' } })
export class PpPersonProgressList {}
