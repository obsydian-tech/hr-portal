import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { PpSiteLights, SiteLight } from '../lights';
import { PpSiteReveal } from '../motion';
import { PpSiteShine } from '../shine';
import { PpSiteLearnLink } from './learn.link';
import type { LearnTop } from './learn.types';

/** The three lights behind a Learn more page's top, as the kit places them. */
export const LEARN_LIGHTS: readonly SiteLight[] = [
  { tone: 'violet', x: '68%', y: '4%', size: '48cqw', index: 0 },
  { tone: 'mint', x: '94%', y: '92%', size: '37cqw', index: 1 },
  { tone: 'coral', x: '8%', y: '96%', size: '40cqw', index: 2 },
];

/**
 * The top of a Learn more page: breadcrumb, eyebrow, one headline with its shine line, a line under it, Book a demo and Get started,
 * the "Built for" list, and beside or below them a slot for the page's own card (`<div ppSiteLearnCard>` projected into it).
 * Recruitment and Onboarding have rings turning behind it (`top.rings`). Spec: SITE-08, kit "Learn more top".
 */
@Component({
  selector: 'section[ppSiteLearnTop]',
  imports: [PpIcon, PpSiteLights, PpSiteReveal, PpSiteShine, PpSiteLearnLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div ppSiteLights plain [lights]="lights"></div>
@if (top().rings) {<div class="pp-site-rings pp-site-rings--hero" aria-hidden="true"><div class="pp-site-rings__group"><span class="pp-site-rings__circle pp-site-rings__circle--coral" style="--_x: 230; --_r: 200"></span><span class="pp-site-rings__circle pp-site-rings__circle--violet" style="--_x: 300; --_r: 200"></span><span class="pp-site-rings__circle pp-site-rings__circle--mint" style="--_x: 370; --_r: 200"></span></div><div class="pp-site-rings__group pp-site-rings__group--outer"><span class="pp-site-rings__circle pp-site-rings__circle--dot" style="--_x: 300; --_r: 280"></span></div></div>}
<div class="pp-site-wrap pp-site-form-page__grid"><div class="pp-site-form-page__intro"><nav class="pp-site-crumb" aria-label="Breadcrumb" [ppSiteReveal]="1"><ol class="pp-site-crumb__list">@for (c of top().crumb; track c.label) {<li class="pp-site-crumb__item">@if (c.href) {<a ppSiteLearnLink [attr.href]="c.href">{{ c.label }}</a><svg ppIcon="chevron-right" />} @else {<span aria-current="page">{{ c.label }}</span>}</li>}</ol></nav>
<p class="pp-site-eyebrow" [ppSiteReveal]="2">{{ top().eyebrow }}</p>
<h1 class="pp-site-form-page__title" [ppSiteReveal]="3" [id]="titleId()">{{ top().title }} <span ppSiteShine inline [text]="top().shine"></span></h1>
<p class="pp-site-form-page__lead" [ppSiteReveal]="4">{{ top().lead }}</p>
<div class="pp-site-hero__actions" [ppSiteReveal]="5"><a ppSiteLearnLink class="pp-site-button pp-site-button--dark pp-site-button--large" [attr.href]="demoHref()"><span>Book a demo</span><svg ppIcon="arrow-right" /></a><a ppSiteLearnLink class="pp-site-button pp-site-button--line pp-site-button--large" [attr.href]="startHref()"><span>Get started</span></a></div>
<ul class="pp-site-hero__chips pp-site-form-page__facts" aria-label="Built for" [ppSiteReveal]="5">@for (chip of top().chips; track chip) {<li class="pp-site-hero__chip">{{ chip }}</li>}</ul>
</div>
<div class="pp-site-form-page__card" [ppSiteReveal]="4"><ng-content /></div>
</div>
  `,
  host: { class: 'pp-site-hero pp-site-form-page pp-site-form-page--learn', '[attr.aria-labelledby]': 'titleId()' },
})
export class PpSiteLearnTop {
  readonly uid = input.required<string>();
  readonly top = input.required<LearnTop>();
  /** Where Book a demo and Get started lead (`#` until the page they lead to exists: they then stay put). */
  readonly demoHref = input('#');
  readonly startHref = input('#');
  protected readonly lights = LEARN_LIGHTS;
  protected readonly titleId = computed(() => `ph-${this.uid()}-h`);
}
