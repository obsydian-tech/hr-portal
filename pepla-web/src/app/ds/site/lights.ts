import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

export type SiteLightTone = 'violet' | 'mint' | 'coral' | 'sky';
/** One light: its centre as a share of the parent (`x`, `y`), its diameter (default 44cqw), how far it drifts, and its place (0 to 3) that offsets its start. */
export interface SiteLight { tone: SiteLightTone; x: string; y: string; size?: string; dx?: string; dy?: string; index?: number }

const TONE: Record<SiteLightTone, string> = {
  violet: 'pp-site-light--violet', mint: 'pp-site-light--mint', coral: 'pp-site-light--coral', sky: 'pp-site-light--sky',
};

/**
 * Soft coloured circles drifting behind a hero or the closing band. Decorative (aria-hidden).
 * The parent must create its own stacking context; the hero and band do.
 * Spec: project/components/site/site-lights.md
 */
@Component({
  selector: 'div[ppSiteLights]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (l of lights(); track $index) {
      <span class="pp-site-light" [class]="tone[l.tone]" [style.--_x]="l.x" [style.--_y]="l.y" [style.--_size]="l.size ?? null"
            [style.--_dx]="l.dx ?? null" [style.--_dy]="l.dy ?? null" [style.--_i]="l.index ?? $index"></span>
    }
  `,
  host: { class: 'pp-site-lights', 'aria-hidden': 'true', '[class.pp-site-lights--plain]': 'plain()' },
})
export class PpSiteLights {
  readonly lights = input<readonly SiteLight[]>([]);
  /** Without the thin ring inside each light, as on the Get started and Book a demo pages. */
  readonly plain = input(false, { transform: booleanAttribute });
  protected readonly tone = TONE;
}
