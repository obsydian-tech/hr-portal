import { A11yModule } from '@angular/cdk/a11y';
import { ScrollStrategyOptions } from '@angular/cdk/overlay';
import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, effect, inject, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpButton } from '../actions/button';
import { PpLogo } from '../core/logo';
import { PpSiteButton } from './button';
import { PpSiteChrome } from './chrome';
import { SITE_ACTIONS, SITE_SHEET, isInternal } from './content';

/**
 * The menu on a phone: a panel sliding in from the right over a dimmed page, one level deep, with the two calls to action.
 * Opens from the header's menu button; closes from the close button, the blanket, Escape and a followed link. Focus moves to the
 * close button and is trapped while open, and returns to whatever opened it. The page behind is inert and does not scroll.
 * Spec: project/components/site/site-sheet.md
 */
@Component({
  selector: 'div[ppSiteSheet]',
  imports: [A11yModule, RouterLink, PpButton, PpLogo, PpSiteButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-site-sheet__blanket" (click)="close()"></div>
    <div class="pp-site-sheet__panel" role="dialog" aria-modal="true" aria-label="Menu" [cdkTrapFocus]="chrome.sheetOpen()" (click)="onPanelClick($event)">
      <div class="pp-site-sheet__head">
        <pp-logo size="small" />
        <button #closeButton ppButton [iconOnly]="true" icon="x" type="button" [attr.aria-label]="actions.closeMenu" (click)="close()"></button>
      </div>
      @for (group of groups; track group.heading) {
        <h2 class="pp-site-sheet__heading">{{ group.heading }}</h2>
        <ul class="pp-site-sheet__list">
          @for (link of group.links; track link.name) {
            <li>
              @if (isInternal(link.href)) {
                <a class="pp-site-sheet__link" [routerLink]="link.href">{{ link.name }}@if (link.soon) {<span class="pp-site-sheet__soon">Coming soon</span>}</a>
              } @else {
                <a class="pp-site-sheet__link" [href]="link.href">{{ link.name }}@if (link.soon) {<span class="pp-site-sheet__soon">Coming soon</span>}</a>
              }
            </li>
          }
        </ul>
      }
      <div class="pp-site-sheet__actions">
        <a ppSiteButton large [href]="actions.primary.href">{{ actions.primary.label }}</a>
        <a ppSiteButton variant="line" large [href]="actions.secondary.href">{{ actions.secondary.label }}</a>
      </div>
    </div>
  `,
  host: {
    class: 'pp-site-sheet',
    '[class.pp-site-sheet--open]': 'chrome.sheetOpen()',
    '[attr.inert]': 'chrome.sheetOpen() ? null : ""',
    '(document:keydown.escape)': 'close()',
  },
})
export class PpSiteSheet {
  protected readonly actions = SITE_ACTIONS;
  protected readonly groups = SITE_SHEET;
  protected readonly chrome = inject(PpSiteChrome, { optional: true }) ?? new PpSiteChrome();
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly closeButton = viewChild('closeButton', { read: ElementRef });
  private readonly scroll = inject(ScrollStrategyOptions).block();
  private opener: HTMLElement | null = null;
  private seen = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.scroll.disable());
    effect(() => {
      const open = this.chrome.sheetOpen();
      untracked(() => {
        // The first run is the state the sheet starts in (a gallery frame may start open): nothing to focus or lock.
        if (!this.seen) { this.seen = true; return; }
        if (open) {
          this.opener = this.chrome.opener ?? (this.doc.activeElement as HTMLElement | null);
          this.scroll.enable();
          afterNextRender(() => (this.closeButton()?.nativeElement as HTMLElement | undefined)?.focus(), { injector: this.injector });
        } else {
          this.scroll.disable();
          const back = this.opener;
          this.opener = null;
          afterNextRender(() => back?.focus(), { injector: this.injector });
        }
      });
    });
  }

  protected readonly isInternal = isInternal;

  protected close(): void { this.chrome.sheetOpen.set(false); }

  /** A followed link closes the sheet. */
  protected onPanelClick(e: Event): void {
    if ((e.target as Element).closest('.pp-site-sheet__link, .pp-site-button')) this.close();
  }
}
