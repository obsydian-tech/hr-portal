import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { PpSiteLights, SiteLight } from './lights';
import { PpSiteReveal } from './motion';
import { PpSiteShine } from './shine';

let uid = 0;

/**
 * The last section before the footer: the product name set very large, one sentence, two buttons (the default content) and a
 * line about what happens after Get started. Put `id="demo"` on the element so every "Book a demo" link scrolls to it.
 * Spec: project/components/site/site-band.md
 */
@Component({
  selector: 'section[ppSiteBand]',
  imports: [PpSiteLights, PpSiteReveal, PpSiteShine],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div ppSiteLights [lights]="lights()"></div>
    <div class="pp-site-wrap pp-site-band__inner">
      <p class="pp-site-eyebrow" [ppSiteReveal]="0" [revealOn]="reveal()">{{ eyebrow() }}</p>
      <h2 class="pp-site-band__title" [ppSiteReveal]="1" [revealOn]="reveal()" [id]="titleId">{{ title() }} <span ppSiteShine inline [text]="accent()"></span></h2>
      <p class="pp-site-band__lead" [ppSiteReveal]="2" [revealOn]="reveal()">{{ lead() }}</p>
      <div class="pp-site-band__actions" [ppSiteReveal]="3" [revealOn]="reveal()"><ng-content /></div>
      <p class="pp-site-band__note" [ppSiteReveal]="4" [revealOn]="reveal()">{{ note() }}</p>
    </div>
  `,
  host: { class: 'pp-site-band', '[attr.aria-labelledby]': 'titleId', '[attr.title]': 'null' },
})
export class PpSiteBand {
  protected readonly titleId = `site-band-title-${++uid}`;
  readonly lights = input<readonly SiteLight[]>([]);
  readonly eyebrow = input.required<string>();
  /** The product name, and the word after it that shines. */
  readonly title = input.required<string>();
  readonly accent = input.required<string>();
  readonly lead = input.required<string>();
  readonly note = input.required<string>();
  readonly reveal = input(false, { transform: booleanAttribute });
}
