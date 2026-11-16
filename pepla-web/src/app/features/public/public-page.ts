import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PpSiteHeader } from '../../ds/site/site-header';

/**
 * The public landing page (SITE-01: header only; SITE-02 to SITE-04 add the sections).
 * Imports nothing from core/auth, so it prerenders and `/` loads no signed-in code.
 */
@Component({
  selector: 'app-public-page',
  imports: [PpSiteHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-site-header />
    <main id="main" tabindex="-1"><h1 class="pp-visually-hidden">Naleko People</h1></main>
  `,
})
export class PublicPage {}

/** Any address the app does not know: the same header, no sentence (wording is SITE-06), no redirect. */
@Component({
  selector: 'app-not-found-page',
  imports: [PpSiteHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-site-header />
    <main id="main" tabindex="-1"><h1 class="pp-visually-hidden">Naleko People</h1></main>
  `,
})
export class NotFoundPage {}
