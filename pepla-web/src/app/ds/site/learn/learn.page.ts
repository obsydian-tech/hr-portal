import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PpSiteLearnAsk } from './learn.ask';
import { PpSiteLearnFaq, PpSiteLearnRelated, PpSiteLearnStrip } from './learn.ending';
import { PpSiteLearnSubnav } from './learn.subnav';
import { PpSiteLearnTop } from './learn.top';
import type { LearnEnding, LearnTab, LearnTop } from './learn.types';

/**
 * A Learn more page, from its top to its questions: the top (with the page's own hero card projected as `[ppSiteLearnCard]`), the sub-menu,
 * the page's demo sections (the default content, each `<section ppSiteLearnDemo id="…">`), Ask Batsi, the trust strip, "Works together with"
 * and the questions. The closing band, when the page has one, is projected as `[ppSiteLearnBand]`. The header, the pilot bar and the footer
 * belong to the route that holds the page. Every word is data: `top` and `ending` come from `content/<page>.ts`, and the demos hold their own.
 * `uid` makes the ids of this page unique where more than one is shown. The questions section is `#questions`, the last tab's target.
 * Spec: SITE-08 (NH-213), kit "Site pages".
 */
@Component({
  selector: 'div[ppSiteLearnPage]',
  imports: [PpSiteLearnTop, PpSiteLearnSubnav, PpSiteLearnAsk, PpSiteLearnStrip, PpSiteLearnRelated, PpSiteLearnFaq],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<section ppSiteLearnTop [uid]="uid()" [top]="top()"><ng-content select="[ppSiteLearnCard]" /></section>
<nav ppSiteLearnSubnav [name]="top().eyebrow" [tabs]="tabs()"></nav>
<ng-content />
<section ppSiteLearnAsk [uid]="uid()" [ask]="ending().ask" live></section>
<section ppSiteLearnStrip [strip]="ending().strip"></section>
<section ppSiteLearnRelated [uid]="uid()" [tiles]="ending().related"></section>
<section ppSiteLearnFaq id="questions" [uid]="uid()" [faq]="ending().faq"></section>
<ng-content select="[ppSiteLearnBand]" />
<ng-content select="footer" />
  `,
})
export class PpSiteLearnPage {
  readonly uid = input.required<string>();
  readonly top = input.required<LearnTop>();
  /** One tab per section, in the order of the page; the last is `questions`. */
  readonly tabs = input.required<readonly LearnTab[]>();
  readonly ending = input.required<LearnEnding>();
}
