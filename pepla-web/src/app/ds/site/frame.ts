import { ChangeDetectionStrategy, Component, ElementRef, OnInit, afterNextRender, booleanAttribute, inject, input } from '@angular/core';
import { PpSiteChrome } from './chrome';

/**
 * A box that stands in for the browser window on kit, spec and gallery pages, so a desktop and a phone version can be
 * shown side by side. The site itself never uses it. The header goes in `[ppSiteHeader]`, the sheet in `[ppSiteSheet]`,
 * the page's content in the middle. A frame scrolls inside itself; `scrolled` starts it scrolled for real.
 * Spec: project/components/site/site-header.md (Frame)
 */
@Component({
  selector: 'div[ppSiteFrame]',
  providers: [PpSiteChrome],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-site-frame__page" [attr.inert]="chrome.sheetOpen() ? '' : null">
      <ng-content select="[ppSiteHeader]" />
      <div class="pp-site-frame__content" [id]="mainId()" tabindex="-1"><ng-content /></div>
      <ng-content select="[ppSiteFooter]" />
    </div>
    <ng-content select="[ppSiteSheet]" />
  `,
  host: { class: 'pp-site-frame', '[class.pp-site-frame--desktop]': 'device() === "desktop"', '[class.pp-site-frame--phone]': 'device() === "phone"' },
})
export class PpSiteFrame implements OnInit {
  protected readonly chrome = inject(PpSiteChrome);
  readonly device = input<'desktop' | 'phone'>('desktop');
  readonly mainId = input('main');
  readonly scrolled = input(false, { transform: booleanAttribute });
  /** The phone sheet starts open (a gallery frame). */
  readonly sheetOpen = input(false, { transform: booleanAttribute });
  ngOnInit(): void { if (this.sheetOpen()) this.chrome.sheetOpen.set(true); }
  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => { if (this.scrolled()) el.querySelector<HTMLElement>('.pp-site-frame__page')!.scrollTop = 80; });
  }
}

/** A box for a whole section or page on kit and gallery pages: as tall as its content, laid out by its own width. The site never uses it. */
@Component({
  selector: 'div[ppSiteStage]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: { class: 'pp-site-stage', 'data-theme': 'light', '[class.pp-site-stage--desktop]': 'device() === "desktop"', '[class.pp-site-stage--phone]': 'device() === "phone"' },
})
export class PpSiteStage {
  readonly device = input<'desktop' | 'phone' | null>(null);
}
