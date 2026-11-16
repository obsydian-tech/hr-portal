import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { PpSiteLights, SiteLight } from './lights';
import { PpSiteReveal } from './motion';
import { PpSiteShine } from './shine';

let uid = 0;

/**
 * The top of the landing page: what the product is, the regulations it is built for, the headline, a line under it and two buttons.
 * The header floats over its top edge and soft lights drift behind. The intro sentence is projected (`<p ppHeroIntro>`, the product
 * name in `<strong>`), the buttons are the default content, every other word is an input.
 * Spec: project/components/site/site-hero.md
 */
@Component({
  selector: 'section[ppSiteHero]',
  imports: [PpSiteLights, PpSiteReveal, PpSiteShine],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div ppSiteLights [lights]="lights()"></div>
    <div class="pp-site-hero__grain" aria-hidden="true"></div>
    <div class="pp-site-wrap">
      <div class="pp-site-hero__intro" [ppSiteReveal]="1" [revealOn]="reveal()">
        <ng-content select="[ppHeroIntro]" />
        <ul class="pp-site-hero__chips" [attr.aria-label]="chipsLabel()">
          @for (chip of chips(); track chip) { <li class="pp-site-hero__chip">{{ chip }}</li> }
        </ul>
      </div>
    </div>
    <div class="pp-site-wrap pp-site-hero__main">
      <p class="pp-site-eyebrow" [ppSiteReveal]="2" [revealOn]="reveal()">{{ eyebrow() }}</p>
      <h1 class="pp-site-hero__title" [ppSiteReveal]="3" [revealOn]="reveal()" [id]="titleId">
        <span class="pp-site-hero__line">{{ line() }}</span>
        <span ppSiteShine class="pp-site-hero__line" [text]="accent()"></span>
      </h1>
      <p class="pp-site-hero__lead" [ppSiteReveal]="4" [revealOn]="reveal()">{{ lead() }}</p>
      <div class="pp-site-hero__actions" [ppSiteReveal]="5" [revealOn]="reveal()"><ng-content /></div>
    </div>
    <div class="pp-site-hero__cue" aria-hidden="true">{{ cue() }}</div>
  `,
  host: { class: 'pp-site-hero', '[attr.aria-labelledby]': 'titleId' },
})
export class PpSiteHero {
  protected readonly titleId = `site-hero-title-${++uid}`;
  readonly lights = input<readonly SiteLight[]>([]);
  readonly chips = input<readonly string[]>([]);
  /** Names the chips list for a screen reader. */
  readonly chipsLabel = input('Built for');
  readonly eyebrow = input.required<string>();
  /** The first line of the headline, and the accent line that shines. */
  readonly line = input.required<string>();
  readonly accent = input.required<string>();
  readonly lead = input.required<string>();
  /** The word beside the line that draws itself, from 768px. */
  readonly cue = input('Scroll');
  /** Intro, eyebrow, headline, lead and buttons arrive in order as the page loads. */
  readonly reveal = input(false, { transform: booleanAttribute });
}
