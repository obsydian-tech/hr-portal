import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpButton } from '../actions/button';
import { PpLogo } from '../core/logo';
import { PpSiteButton } from './button';
import { PpSiteChrome } from './chrome';
import { SITE_ACTIONS, SITE_HOME, SITE_LOGIN } from './content';
import { PpSiteMenu } from './menu';

/**
 * The bar at the top of every public page: logo, menu, Log in, Get started and Book a demo. After 24px of scroll it turns
 * frosted and a little shorter (a class; nothing animates height). Below 1280px the menu becomes a button that opens the sheet.
 * `<header ppSiteHeader></header>` inside `<div ppSitePage>`. Spec: project/components/site/site-header.md
 */
@Component({
  selector: 'header[ppSiteHeader]',
  imports: [RouterLink, PpButton, PpLogo, PpSiteButton, PpSiteMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="pp-site-header__skip" [href]="'#' + mainId()" (click)="skip($event)">{{ actions.skip }}</a>
    <div class="pp-site-header__bar">
      <a ppLogo class="pp-site-header__logo" [routerLink]="home()"></a>
      <div class="pp-site-header__menu"><nav ppSiteMenu [openList]="openList()"></nav></div>
      <div class="pp-site-header__actions">
        <a ppButton appearance="subtle" class="pp-site-header__login" [routerLink]="login()">{{ actions.login }}</a>
        <a ppSiteButton variant="line" class="pp-site-header__secondary" [href]="actions.secondary.href">{{ actions.secondary.label }}</a>
        <a ppSiteButton class="pp-site-header__primary" [href]="actions.primary.href">{{ actions.primary.label }}</a>
        <button ppButton [iconOnly]="true" icon="menu" class="pp-site-header__burger" type="button" [attr.aria-label]="actions.openMenu"
                [attr.aria-expanded]="chrome.sheetOpen()" [attr.aria-controls]="sheetId()" (click)="chrome.open($event)"></button>
      </div>
    </div>
  `,
  host: { class: 'pp-site-header', '[class.pp-site-header--scrolled]': 'scrolled()' },
})
export class PpSiteHeader {
  protected readonly actions = SITE_ACTIONS;
  protected readonly chrome = inject(PpSiteChrome, { optional: true }) ?? new PpSiteChrome();
  private readonly doc = inject(DOCUMENT);
  /** Where the logo goes. */
  readonly home = input(SITE_HOME);
  /** Where "Log in" goes: the one sign-in page. */
  readonly login = input(SITE_LOGIN);
  /** The id of the page's `main`, which "Skip to content" moves focus to. */
  readonly mainId = input('main');
  /** The id of the sheet the menu button opens. */
  readonly sheetId = input('site-sheet');
  /** A menu list that starts open, for kit and gallery frames. */
  readonly openList = input<string>();
  readonly scrolled = signal(false);

  constructor() {
    const destroyRef = inject(DestroyRef);
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      const win = this.doc.defaultView!;
      // A page scrolls the window; a gallery frame scrolls inside itself.
      const frame = el.closest<HTMLElement>('.pp-site-frame__page');
      const target: HTMLElement | Window = frame ?? win;
      const update = () => this.scrolled.set((frame ? frame.scrollTop : win.scrollY) > 24);
      target.addEventListener('scroll', update, { passive: true });
      destroyRef.onDestroy(() => target.removeEventListener('scroll', update));
      update();
    });
  }

  protected skip(e: Event): void {
    const main = this.doc.getElementById(this.mainId());
    if (!main) return;
    e.preventDefault();
    main.focus();
    main.scrollIntoView();
  }
}
