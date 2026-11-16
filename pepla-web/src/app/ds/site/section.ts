import { ChangeDetectionStrategy, Component, Directive, booleanAttribute, computed, input } from '@angular/core';
import { PpSiteReveal } from './motion';
import { PpSiteShine } from './shine';

export type SiteGround = 'white' | 'cream' | 'violet' | 'violet-fade' | 'mint' | 'coral';
const GROUND: Record<SiteGround, string | null> = {
  white: null, cream: 'pp-site-section--cream', violet: 'pp-site-section--violet', 'violet-fade': 'pp-site-section--violet-fade',
  mint: 'pp-site-section--mint', coral: 'pp-site-section--coral',
};

/** Content at most 1200px wide inside the site gutters. Hero, section and band use it; a page's own layout inside a section may too. */
@Directive({ selector: 'div[ppSiteWrap]', host: { class: 'pp-site-wrap' } })
export class PpSiteWrap {}

/** The small label above a headline, in capitals with a short rule before it. Names the section as a noun: "Recruitment". */
@Directive({ selector: 'p[ppSiteEyebrow]', host: { class: 'pp-site-eyebrow' } })
export class PpSiteEyebrow {}

/** A section's headline when the page lays the head out itself (the head component sets this class on its own title). */
@Directive({ selector: 'h2[ppSiteTitle]', host: { class: 'pp-site-section__title' } })
export class PpSiteTitle {}

/** An empty hidden span at the top of a section that a link can point at when one section answers to more than one address. */
@Directive({ selector: 'span[ppSiteAnchor]', host: { class: 'pp-site-section__anchor' } })
export class PpSiteAnchor {}

/**
 * The block every landing section is built from: a full-width ground, content at most 1200px wide, then the section's own demo.
 * `<section ppSiteSection ground="cream" titleId="recruitment-title">` holds a `<div ppSiteSectionHead>` first.
 * Spec: project/components/site/site-section.md
 */
@Component({
  selector: 'section[ppSiteSection]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="pp-site-wrap"><ng-content /></div>`,
  host: {
    '[class]': 'classes()',
    '[attr.aria-labelledby]': 'titleId() ?? null',
  },
})
export class PpSiteSection {
  readonly ground = input<SiteGround>('white');
  /** Clips what a section draws outside itself (a soft light, a ring) and lets a sticky demo card inside keep sticking. */
  readonly clip = input(false, { transform: booleanAttribute });
  /** The id of the section's heading, which names the section. */
  readonly titleId = input<string>();
  protected readonly classes = computed(() => ['pp-site-section', GROUND[this.ground()], this.clip() && 'pp-site-section--clip'].filter(Boolean).join(' '));
}

/**
 * The head of a section: the label, the headline and the line under it. `accent` is a few words set in the shine, after the title.
 * `<div ppSiteSectionHead eyebrow="Recruitment" title="…" lead="…" titleId="recruitment-title"></div>`
 */
@Component({
  selector: 'div[ppSiteSectionHead]',
  imports: [PpSiteReveal, PpSiteShine],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <p class="pp-site-eyebrow" [ppSiteReveal]="0" [revealOn]="reveal()">{{ eyebrow() }}</p>
      <h2 class="pp-site-section__title" [ppSiteReveal]="1" [revealOn]="reveal()" [id]="titleId() ?? null">{{ title() }}@if (accent()) { <span ppSiteShine [text]="accent()!"></span> }</h2>
    </div>
    @if (lead()) { <p class="pp-site-section__lead" [ppSiteReveal]="2" [revealOn]="reveal()">{{ lead() }}</p> }
  `,
  host: { class: 'pp-site-section__head' },
})
export class PpSiteSectionHead {
  readonly eyebrow = input.required<string>();
  readonly title = input.required<string>();
  readonly lead = input<string>();
  readonly accent = input<string>();
  readonly titleId = input<string>();
  /** The parts arrive one after the other as the section scrolls into view. */
  readonly reveal = input(false, { transform: booleanAttribute });
}
