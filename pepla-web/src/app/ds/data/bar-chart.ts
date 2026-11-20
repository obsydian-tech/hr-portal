import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface Bar { label: string; value: number; }

/**
 * CHAT-08: a horizontal bar chart. Each bar is written with its words and its number (never colour alone), in one colour from the
 * design tokens, with no chart library and nothing that moves. The same numbers are in a visually hidden table for screen readers.
 * `<pp-bar-chart title="People by step" [bars]="bars" />`. Spec: data/bar-chart.md
 */
@Component({
  selector: 'pp-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="pp-bar-chart">
      <figcaption class="pp-bar-chart__title">{{ title() }}</figcaption>
      <div class="pp-bar-chart__bars" aria-hidden="true">
        @for (b of bars(); track $index) {
          <div class="pp-bar-chart__row">
            <span class="pp-bar-chart__label">{{ b.label }}</span>
            <span class="pp-bar-chart__track"><span class="pp-bar-chart__bar" [style.--_share]="share(b) + '%'"></span></span>
            <span class="pp-bar-chart__value">{{ b.value }}</span>
          </div>
        }
      </div>
      <table class="pp-visually-hidden">
        <caption>{{ title() }}</caption>
        <tbody>
          @for (b of bars(); track $index) { <tr><th scope="row">{{ b.label }}</th><td>{{ b.value }}</td></tr> }
        </tbody>
      </table>
    </figure>
  `,
  styles: ':host { display: block; }',
})
export class PpBarChart {
  readonly title = input('');
  readonly bars = input<Bar[]>([]);
  private readonly max = computed(() => Math.max(1, ...this.bars().map((b) => b.value)));
  share(b: Bar): number { return Math.round((b.value / this.max()) * 100); }
}
