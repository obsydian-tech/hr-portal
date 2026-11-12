import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PpValueControl, uid, valueAccessor } from '../util';

/**
 * A number on a scale, with its value in words. A field of its own: label, value, scale and help.
 * `<pp-slider label="Technical skills" [min]="1" [max]="10" [(value)]="tech" [words]="scoreWords" scaleStart="1 Weak" scaleEnd="10 Excellent" />`
 * Spec: forms/slider.md
 */
@Component({
  selector: 'pp-slider',
  providers: [valueAccessor(() => PpSlider)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-slider__header">
      <label class="pp-field__label" [attr.for]="id">{{ label() }}</label>
      <output class="pp-slider__value" [attr.for]="id">{{ shown() }}</output>
    </div>
    <input class="pp-slider__input" [id]="id" type="range" [min]="min()" [max]="max()" [step]="step()" [value]="value() ?? min()" [disabled]="disabled()"
           [attr.aria-valuetext]="spoken()" [attr.aria-describedby]="help() ? id + '-help' : null" [style.--_pct]="pct()"
           (input)="set(+$any($event.target).value)" (blur)="onTouched()" />
    @if (scaleStart() || scaleEnd()) { <div class="pp-slider__scale" aria-hidden="true"><span>{{ scaleStart() }}</span><span>{{ scaleEnd() }}</span></div> }
    @if (help()) { <div class="pp-field__help" [id]="id + '-help'">{{ help() }}</div> }
  `,
  host: { class: 'pp-field pp-slider' },
})
export class PpSlider extends PpValueControl<number> {
  readonly label = input.required<string>();
  readonly min = input(0);
  readonly max = input(100);
  readonly step = input(1);
  readonly help = input<string>();
  /** The value in words, shown and read out: v => `${v} out of 10, strong`. */
  readonly words = input<(v: number) => string>((v) => String(v));
  /** What a screen reader says when the shown words are a symbol: v => `${v} percent`. */
  readonly spokenWords = input<(v: number) => string>();
  readonly scaleStart = input<string>();
  readonly scaleEnd = input<string>();
  protected readonly id = uid('pp-slider');
  private readonly v = computed(() => this.value() ?? this.min());
  protected readonly shown = computed(() => this.words()(this.v()));
  protected readonly spoken = computed(() => (this.spokenWords() ?? this.words())(this.v()));
  protected readonly pct = computed(() => `${+((100 * (this.v() - this.min())) / (this.max() - this.min())).toFixed(2)}%`);
}
