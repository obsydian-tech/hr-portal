import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { PpSiteChrome } from './chrome';
import { PpSiteSheet } from './sheet';

/**
 * The frame of a public page: header, one `main`, footer, and the phone sheet. While the sheet is open the page behind it is
 * inert. `<div ppSitePage><header ppSiteHeader></header> …sections… <footer ppSiteFooter></footer></div>`
 */
@Component({
  selector: 'div[ppSitePage]',
  imports: [PpSiteSheet],
  providers: [PpSiteChrome],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [attr.inert]="chrome.sheetOpen() ? '' : null">
      <ng-content select="[ppSiteHeader]" />
      <main [id]="mainId()" tabindex="-1"><ng-content /></main>
      <ng-content select="[ppSiteFooter]" />
    </div>
    <div ppSiteSheet [id]="sheetId()"></div>
  `,
})
export class PpSitePage {
  protected readonly chrome = inject(PpSiteChrome);
  readonly mainId = input('main');
  readonly sheetId = input('site-sheet');
}
