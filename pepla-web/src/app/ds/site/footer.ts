import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpIcon } from '../core/icon';
import { PpLogo } from '../core/logo';
import { PpSiteGradientLine } from './gradient';
import { SITE_FOOTER, SITE_HOME, isInternal } from './content';

/**
 * The bottom of every public page: who Naleko People is, the lists of the menu plus Company, and the legal links.
 * The only motion is the gradient line flowing along the top edge (CSS). Spec: project/components/site/site-footer.md
 */
@Component({
  selector: 'footer[ppSiteFooter]',
  imports: [RouterLink, PpIcon, PpLogo, PpSiteGradientLine],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span ppSiteGradientLine flow></span>
    <div class="pp-site-footer__inner">
      <div class="pp-site-footer__top">
        <div class="pp-site-footer__brand">
          <a ppLogo class="pp-site-footer__logo" [routerLink]="home"></a>
          <p class="pp-site-footer__about">{{ content.about }}</p>
          <span class="pp-site-footer__pin"><svg ppIcon="map-pin" />{{ content.pin }}</span>
        </div>
        <nav class="pp-site-footer__cols" aria-label="Footer">
          @for (col of content.columns; track col.heading) {
            <div class="pp-site-footer__col">
              <h2 class="pp-site-footer__heading">{{ col.heading }}</h2>
              <ul class="pp-site-footer__list">
                @for (link of col.links; track link.name) {
                  <li>
                    @if (isInternal(link.href)) {
                      <a class="pp-site-footer__link" [routerLink]="link.href">{{ link.name }}@if (link.soon) {<span class="pp-site-footer__soon">Coming soon</span>}</a>
                    } @else {
                      <a class="pp-site-footer__link" [href]="link.href">{{ link.name }}@if (link.soon) {<span class="pp-site-footer__soon">Coming soon</span>}</a>
                    }
                  </li>
                }
              </ul>
            </div>
          }
        </nav>
      </div>
      <div class="pp-site-footer__bottom">
        <span class="pp-site-footer__copy">{{ content.copy }}</span>
        <ul class="pp-site-footer__legal">
          @for (link of content.legal; track link.name) {
            <li><a class="pp-site-footer__legal-link" [href]="link.href">{{ link.name }}</a></li>
          }
        </ul>
      </div>
    </div>
  `,
  host: { class: 'pp-site-footer', 'aria-label': 'Site footer' },
})
export class PpSiteFooter {
  protected readonly content = SITE_FOOTER;
  protected readonly home = SITE_HOME;
  protected readonly isInternal = isInternal;
}
