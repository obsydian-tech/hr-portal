import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { PpSiteReveal } from '../motion';
import { PpSiteLearnLink } from './learn.link';
import type { LearnFaq, LearnStrip, LearnTile } from './learn.types';

/** The trust strip: what holds on every page, and a link to the page that says more (Security's own strip has none). Spec: SITE-08, kit "Learn more ending". */
@Component({
  selector: 'section[ppSiteLearnStrip]',
  imports: [PpIcon, PpSiteLearnLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-wrap pp-site-strip__inner">@for (i of strip().items; track i.text) {<span class="pp-site-strip__item"><svg [ppIcon]="i.icon" />{{ i.text }}</span>}@if (strip().link; as l) {<a ppSiteLearnLink class="pp-link pp-link--standalone" [attr.href]="l.href"><span>{{ l.text }}</span><svg ppIcon="arrow-right" /></a>}</div>
  `,
  host: { class: 'pp-site-strip', '[attr.aria-label]': 'strip().label' },
})
export class PpSiteLearnStrip {
  readonly strip = input.required<LearnStrip>();
}

/** "Works together with": three cards to the pages a module works with; a card's icon fills on hover. Spec: SITE-08, kit "Learn more ending". */
@Component({
  selector: 'section[ppSiteLearnRelated]',
  imports: [PpIcon, PpSiteReveal, PpSiteLearnLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-wrap"><h2 class="pp-site-related__title" [ppSiteReveal]="0" [id]="titleId()">Works together with</h2>
<ul class="pp-site-related__list">@for (t of tiles(); track t.title; let i = $index) {<li><a ppSiteLearnLink class="pp-site-tile" [ppSiteReveal]="i + 1" [attr.href]="t.href"><span class="pp-site-tile__icon" aria-hidden="true"><span class="pp-site-tile__glyph"><svg [ppIcon]="t.icon" /></span><span class="pp-site-tile__glyph pp-site-tile__glyph--on"><svg [ppIcon]="t.icon" /></span></span>
<h3 class="pp-site-tile__title">{{ t.title }}</h3>
<p class="pp-site-tile__text">{{ t.text }}</p>
<span class="pp-site-tile__more">Learn more<svg ppIcon="arrow-right" /></span></a></li>}</ul>
</div>
  `,
  host: { class: 'pp-site-related', '[attr.aria-labelledby]': 'titleId()' },
})
export class PpSiteLearnRelated {
  readonly uid = input.required<string>();
  readonly tiles = input.required<readonly LearnTile[]>();
  protected readonly titleId = computed(() => `rel-t-${this.uid()}`);
}

/**
 * The questions: each is a button that opens an answer in a region it controls (`aria-expanded`, `aria-controls`), one open at a time,
 * and pressing the open one closes it. Enter and Space work as on any button. `open` is the question open to begin with.
 * Spec: SITE-08, kit "Learn more ending" and "Questions".
 */
@Component({
  selector: 'section[ppSiteLearnFaq]',
  imports: [PpIcon, PpSiteReveal, PpSiteLearnLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-wrap pp-site-faq__inner"><div class="pp-site-faq__side"><h2 class="pp-site-faq__title" [ppSiteReveal]="0" [id]="titleId()">Questions</h2>
<p class="pp-site-faq__lead" [ppSiteReveal]="1">{{ faq().lead }}</p>
<a ppSiteLearnLink class="pp-link pp-link--standalone" [ppSiteReveal]="2" [attr.href]="faq().link.href"><span>{{ faq().link.text }}</span><svg ppIcon="arrow-right" /></a>
</div>
<ul class="pp-site-faq__list" [ppSiteReveal]="1">@for (x of faq().items; track x.q; let i = $index) {<li class="pp-site-faq__item" [class.pp-site-faq__item--open]="cur() === i"><h3 class="pp-site-faq__heading"><button class="pp-site-faq__q" type="button" [id]="'faq-q' + i + '-' + uid()" [attr.aria-expanded]="cur() === i" [attr.aria-controls]="'faq-a' + i + '-' + uid()" (click)="toggle(i)"><span>{{ x.q }}</span><span class="pp-site-faq__mark" aria-hidden="true"><span class="pp-site-faq__bar"></span><span class="pp-site-faq__bar pp-site-faq__bar--v"></span></span></button></h3>
<div class="pp-site-faq__a" role="region" [id]="'faq-a' + i + '-' + uid()" [attr.aria-labelledby]="'faq-q' + i + '-' + uid()"><div class="pp-site-faq__a-in"><p class="pp-site-faq__a-text">{{ x.a }}</p></div></div></li>}</ul>
</div>
  `,
  host: { class: 'pp-site-faq', '[attr.aria-labelledby]': 'titleId()' },
})
export class PpSiteLearnFaq {
  readonly uid = input.required<string>();
  readonly faq = input.required<LearnFaq>();
  /** The question open to begin with (the first); -1 for none. */
  readonly open = input(0);
  protected readonly titleId = computed(() => `faq-t-${this.uid()}`);
  private readonly picked = signal<number | null>(null);
  protected readonly cur = computed(() => this.picked() ?? this.open());
  protected toggle(i: number): void { this.picked.set(this.cur() === i ? -1 : i); }
}
