import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { PpSiteReveal } from '../motion';

/** The landing page About section. Words are the design system kit's (site-about). Spec: SITE-04. */
@Component({
  selector: 'section[ppSiteLandAbout]',
  imports: [PpIcon, PpSiteReveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  
  template: `
<div class="pp-site-wrap pp-site-about"><div><p class="pp-site-eyebrow" [ppSiteReveal]="0">Company</p>
<h2 class="pp-site-section__title" id="lad-h" [ppSiteReveal]="1">Built by <span class="pp-site-gradient-text pp-site-gradient-text--flow" data-text="Naleko Digital Solutions.">Naleko Digital Solutions.</span>
</h2>
<p class="pp-site-section__lead" [ppSiteReveal]="2">Naleko Digital Solutions builds, hosts and supports Naleko People in South Africa. Every company that signs up gets a call from the Naleko team before any module is switched on.</p>
<a class="pp-link pp-link--standalone" href="#contact" [ppSiteReveal]="3"><span>Contact the Naleko team</span>
<svg ppIcon="arrow-right" /></a>
</div>
<div class="pp-site-about__card" [ppSiteReveal]="2"><span class="pp-site-about__line pp-site-gradient-line pp-site-gradient-line--flow" aria-hidden="true"></span>
<div class="pp-site-about__mark"><span class="pp-site-about__name pp-site-gradient-text pp-site-gradient-text--flow" data-text="Naleko">Naleko</span>
<span class="pp-site-about__sub">Digital Solutions</span>
</div>
<ul class="pp-site-about__list"><li class="pp-site-about__item" [ppSiteReveal]="3"><span class="pp-site-about__dot" style="--_p: 12%"></span>Built and supported in South Africa</li>
<li class="pp-site-about__item" [ppSiteReveal]="4"><span class="pp-site-about__dot" style="--_p: 30%"></span>All data stays in South Africa</li>
<li class="pp-site-about__item" [ppSiteReveal]="5"><span class="pp-site-about__dot" style="--_p: 48%"></span>An onboarding call with every company</li>
<li class="pp-site-about__item" [ppSiteReveal]="6"><span class="pp-site-about__dot" style="--_p: 62%"></span>Modules switched on by the Naleko team</li>
</ul>
</div>
</div>

  `,
  host: { 'id': 'about', 'class': 'pp-site-section', 'aria-labelledby': 'lad-h' },
})
export class PpSiteLandAbout {

}
