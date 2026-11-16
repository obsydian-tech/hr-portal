import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpLogo } from '../core/logo';

/**
 * The public site's header (kit site-header, `pp-site-header`): the logo home and "Log in".
 * SITE-02 adds the menu, Get started, Book a demo and the phone sheet. Until the sheet exists,
 * "Log in" stays in the bar at every width (the kit hides it below 1280 because the sheet holds it).
 */
@Component({
  selector: 'pp-site-header',
  imports: [RouterLink, PpLogo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="pp-site-header">
      <a class="pp-site-header__skip" href="#main" (click)="skip($event)">Skip to content</a>
      <div class="pp-site-header__bar">
        <a ppLogo class="pp-site-header__logo" routerLink="/"></a>
        <div class="pp-site-header__actions">
          <a class="pp-button pp-button--subtle" routerLink="/sign-in">Log in</a>
        </div>
      </div>
    </header>
  `,
  // The site pages sit edge to edge, as the kit draws them; the design system has no body reset yet.
  styles: `pp-site-header { display: contents; } body:has(.pp-site-header) { margin: 0; }`,
  encapsulation: ViewEncapsulation.None,
})
export class PpSiteHeader {
  /** Moves focus to <main> without leaving the page: a bare #main would resolve against <base href="/"> and load `/`. */
  protected skip(event: Event): void {
    const main = document.getElementById('main');
    if (!main) return;
    event.preventDefault();
    main.focus();
    main.scrollIntoView();
  }
}
