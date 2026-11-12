// Pepla's own date picker. Angular Aria has no calendar, so the keyboard grid follows the WAI-ARIA
// date picker dialog pattern by hand; the CDK overlay places the panel. Date in, Date out.
// Spec: forms/date-picker.md
import { ChangeDetectionStrategy, Component, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { OverlayModule } from '@angular/cdk/overlay';
import { NgTemplateOutlet } from '@angular/common';
import { PpField } from '../field';
import { PpIcon } from '../../core/icon';
import { PpButton } from '../../actions/button';
import { PpValueControl, uid, valueAccessor } from '../../util';
import { formatDate, isoDate } from '../../format';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = [['Mo', 'Monday'], ['Tu', 'Tuesday'], ['We', 'Wednesday'], ['Th', 'Thursday'], ['Fr', 'Friday'], ['Sa', 'Saturday'], ['Su', 'Sunday']];
const DAY = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last));
};
const same = (a: Date | null | undefined, b: Date | null | undefined) => !!a && !!b && a.getTime() === DAY(b).getTime();
const longLabel = (d: Date) => `${WEEKDAYS[(d.getDay() + 6) % 7][1]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

/** Reads "23 Nov 2026", "23 November 2026", "23/11/2026" and "2026-11-23". */
export function parseDate(text: string): Date | null {
  const t = text.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})$/);
  if (m) return valid(+m[3], +m[2] - 1, +m[1]);
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS.findIndex((name) => name.toLowerCase().startsWith(m![2].toLowerCase().slice(0, 3)));
    return month < 0 ? null : valid(+m[3], month, +m[1]);
  }
  return null;
}
/**
 * Why a typed date is not a date, in words for the field's error:
 * "November has 30 days. Check the date, for example 30 Nov 2026."
 */
export function dateProblem(text: string): string | null {
  const t = text.trim();
  if (!t || parseDate(t)) return null;
  const m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/) ?? t.match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})$/);
  if (m) {
    const month = /^\d+$/.test(m[2]) ? +m[2] - 1 : MONTHS.findIndex((name) => name.toLowerCase().startsWith(m[2].toLowerCase().slice(0, 3)));
    if (month >= 0 && month < 12) {
      const days = new Date(+m[3], month + 1, 0).getDate();
      if (+m[1] > days) return `${MONTHS[month]} has ${days} days. Check the date, for example ${days} ${MONTHS[month].slice(0, 3)} ${m[3]}.`;
    }
  }
  return 'Enter the date like this: 23 Nov 2026.';
}
function valid(y: number, mo: number, d: number) {
  const x = new Date(y, mo, d);
  return x.getFullYear() === y && x.getMonth() === mo && x.getDate() === d ? x : null;
}

/**
 * A date, typed or picked: `<pp-field label="Start date"><pp-date-picker [(value)]="start" [min]="today" /></pp-field>`.
 * Shows dates as "23 Nov 2026"; weeks start on Monday.
 */
@Component({
  selector: 'pp-date-picker',
  imports: [OverlayModule, NgTemplateOutlet, PpIcon, PpButton],
  providers: [valueAccessor(() => PpDatePicker)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #panel>
      <div class="pp-date-picker__panel" role="dialog" aria-modal="false" [attr.aria-labelledby]="id + '-title'" (keydown.escape)="close(true)">
        <div class="pp-date-picker__header">
          <button class="pp-date-picker__nav" type="button" [disabled]="!canGo(-1)" [attr.aria-label]="'Previous month, ' + monthName(-1)" (click)="go(-1)"><svg ppIcon="chevron-left" /></button>
          <div class="pp-date-picker__title" [id]="id + '-title'" aria-live="polite">{{ monthName(0) }}</div>
          <button class="pp-date-picker__nav" type="button" [disabled]="!canGo(1)" [attr.aria-label]="'Next month, ' + monthName(1)" (click)="go(1)"><svg ppIcon="chevron-right" /></button>
        </div>
        <div class="pp-date-picker__grid" role="grid" [attr.aria-labelledby]="id + '-title'" (keydown)="key($event)">
          <div role="row">
            @for (w of weekdays; track w[0]) { <div class="pp-date-picker__weekday" role="columnheader"><abbr [title]="w[1]">{{ w[0] }}</abbr></div> }
          </div>
          @for (week of weeks(); track $index) {
            <div role="row">
              @for (d of week; track d.getTime()) {
                <div class="pp-date-picker__cell" role="gridcell">
                  <button class="pp-date-picker__day" type="button" [id]="id + '-' + iso(d)"
                          [class.pp-date-picker__day--outside]="d.getMonth() !== focus().getMonth()" [class.pp-date-picker__day--today]="isToday(d)"
                          [attr.aria-current]="isToday(d) ? 'date' : null" [attr.aria-pressed]="isSelected(d) ? 'true' : null"
                          [attr.aria-label]="label(d)" [disabled]="!allowed(d)" [tabIndex]="same(d, focus()) ? 0 : -1"
                          (click)="choose(d)">{{ d.getDate() }}</button>
                </div>
              }
            </div>
          }
        </div>
        <div class="pp-date-picker__footer">
          <span>{{ note() }}</span>
          @if (allowed(today)) { <button ppButton appearance="link" size="small" type="button" (click)="choose(today)">Today</button> }
        </div>
      </div>
    </ng-template>
    @if (inline()) { <ng-container [ngTemplateOutlet]="panel" /> } @else {
    <div class="pp-text-field" cdkOverlayOrigin #origin="cdkOverlayOrigin">
      <input class="pp-text-field__input" type="text" autocomplete="off"
             [id]="field?.controlId" [attr.aria-describedby]="field?.describedBy()" [attr.aria-invalid]="field?.invalid() || invalid() ? 'true' : null"
             [attr.required]="field?.required() ? '' : null" [disabled]="disabled()" [readOnly]="readonly()" [value]="text()"
             (input)="typed.set($any($event.target).value)" (blur)="commitTyped()" (keydown.enter)="commitTyped()" />
      @if (!readonly()) {
      <button class="pp-text-field__action" type="button" [disabled]="disabled()" aria-haspopup="dialog" [attr.aria-expanded]="open()"
              [attr.aria-label]="'Choose ' + (fieldLabel() || 'a date')" (click)="toggle()"><svg ppIcon="calendar-days" /></button>
      }
    </div>

    <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="origin" [cdkConnectedOverlayOpen]="open()" cdkConnectedOverlayUsePopover="inline"
                 (overlayOutsideClick)="close(false)" (detach)="close(false)">
      <ng-container [ngTemplateOutlet]="panel" />
    </ng-template>
    }
  `,
  host: { class: 'pp-date-picker' },
})
export class PpDatePicker extends PpValueControl<Date | null> {
  readonly min = input<Date>();
  readonly max = input<Date>();
  /** A line in the calendar's footer, for example "Earliest start is today". */
  readonly note = input('');
  /** The calendar on its own, always open, for a page that is about dates. */
  readonly inline = input(false);
  /** Shows a date that comes from elsewhere ("Read from the ID number"): no calendar. */
  readonly readonly = input(false);
  /** A typed date that is not a date, in words to show as the field's error; null once it is fixed. */
  readonly problem = output<string | null>();
  protected readonly field = inject(PpField, { optional: true });
  private readonly injector = inject(Injector);
  protected readonly id = uid('pp-date');
  protected readonly weekdays = WEEKDAYS;
  protected readonly today = DAY(new Date());
  protected readonly same = same;
  protected readonly iso = (d: Date) => isoDate(d);
  protected readonly open = signal(false);
  protected readonly typed = signal<string | null>(null);
  /** Text as typed, not yet a date ("31 Nov 2026"), for a screen restoring a draft or a preview of the error. */
  readonly entered = input<string>();
  private readonly seed = effect(() => { const t = this.entered(); if (t !== undefined) untracked(() => this.typed.set(t)); });
  protected readonly focus = signal(this.today);
  protected readonly text = computed(() => this.typed() ?? (this.value() ? formatDate(this.value()!, { year: true }) : ''));
  protected readonly fieldLabel = computed(() => this.field?.label().toLowerCase() ?? '');

  constructor() {
    super();
    // The inline calendar opens on the chosen month.
    effect(() => { const v = this.value(); if (this.inline() && v) untracked(() => this.focus.set(DAY(v))); });
  }

  /** Monday-first weeks covering the focused month. */
  protected readonly weeks = computed(() => {
    const f = this.focus();
    const first = new Date(f.getFullYear(), f.getMonth(), 1);
    let d = addDays(first, -((first.getDay() + 6) % 7));
    const out: Date[][] = [];
    while (out.length < 6 && (out.length === 0 || d.getMonth() === f.getMonth())) {
      out.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
      d = addDays(d, 7);
    }
    return out;
  });

  protected monthName(offset: number) {
    const m = addMonths(new Date(this.focus().getFullYear(), this.focus().getMonth(), 1), offset);
    return `${MONTHS[m.getMonth()]} ${m.getFullYear()}`;
  }
  protected isToday(d: Date) { return same(d, this.today); }
  protected isSelected(d: Date) { return same(d, this.value()); }
  protected label(d: Date) { return longLabel(d) + (this.isToday(d) ? ', today' : ''); }
  protected allowed(d: Date) {
    const min = this.min(), max = this.max();
    return (!min || d >= DAY(min)) && (!max || d <= DAY(max));
  }
  protected canGo(offset: number) {
    const f = this.focus();
    const edge = offset < 0 ? new Date(f.getFullYear(), f.getMonth(), 0) : new Date(f.getFullYear(), f.getMonth() + 1, 1);
    return this.allowed(edge);
  }

  protected toggle() { this.open() ? this.close(false) : this.show(); }
  private show() {
    const v = this.value();
    this.focus.set(this.clamp(v ? DAY(v) : this.today));
    this.open.set(true);
    this.moveFocus();
  }
  protected close(returnFocus: boolean) {
    if (!this.open()) return;
    this.open.set(false);
    if (returnFocus) document.getElementById(this.field?.controlId ?? '')?.focus();
  }
  protected go(offset: number) { this.focus.set(this.clamp(addMonths(this.focus(), offset))); }
  protected choose(d: Date) {
    if (!this.allowed(d)) return;
    this.typed.set(null);
    this.set(DAY(d));
    this.close(true);
  }
  protected commitTyped() {
    const t = this.typed();
    if (t === null) return;
    if (!t.trim()) { this.typed.set(null); this.set(null); this.problem.emit(null); }
    else {
      const d = parseDate(t);
      if (d && this.allowed(d)) { this.typed.set(null); this.set(d); this.problem.emit(null); }
      else this.problem.emit(d ? 'Choose a date the calendar allows.' : dateProblem(t));
    }
    this.onTouched();
  }

  protected key(e: KeyboardEvent) {
    const f = this.focus();
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(f, -1), ArrowRight: () => addDays(f, 1), ArrowUp: () => addDays(f, -7), ArrowDown: () => addDays(f, 7),
      Home: () => addDays(f, -((f.getDay() + 6) % 7)), End: () => addDays(f, 6 - ((f.getDay() + 6) % 7)),
      PageUp: () => addMonths(f, e.shiftKey ? -12 : -1), PageDown: () => addMonths(f, e.shiftKey ? 12 : 1),
    };
    if (!moves[e.key]) return;
    e.preventDefault();
    this.focus.set(this.clamp(moves[e.key]()));
    this.moveFocus();
  }
  private clamp(d: Date) {
    const min = this.min(), max = this.max();
    if (min && d < DAY(min)) return DAY(min);
    if (max && d > DAY(max)) return DAY(max);
    return d;
  }
  private moveFocus() {
    afterNextRender(() => document.getElementById(`${this.id}-${isoDate(this.focus())}`)?.focus(), { injector: this.injector });
  }
}
