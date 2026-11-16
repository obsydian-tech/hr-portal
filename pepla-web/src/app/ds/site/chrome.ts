import { Injectable, signal } from '@angular/core';

/**
 * The state the header's menu button and the phone sheet share. `<div ppSitePage>` provides one, so the two find each
 * other without the page wiring them; a header or sheet shown on its own (the gallery) uses its own.
 */
@Injectable()
export class PpSiteChrome {
  readonly sheetOpen = signal(false);
  /** The button that opened the sheet, so focus can go back to it (Safari does not focus a button on click). */
  opener: HTMLElement | null = null;
  open(from: Event | null): void { this.opener = (from?.currentTarget as HTMLElement | null) ?? null; this.sheetOpen.set(true); }
}
