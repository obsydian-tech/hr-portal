import { DOCUMENT } from '@angular/common';
import { Injectable, inject, provideEnvironmentInitializer, type EnvironmentProviders } from '@angular/core';

/**
 * SITE-07: the public site's rules live in their own stylesheet, `site.css`, that only pages showing site parts load.
 * `angular.json` writes the file beside the app and links it nowhere; this adds the one `<link>`. It runs through
 * `DOCUMENT`, so it also runs while the page is prerendered and the prerendered `/` already carries the link. Asked
 * again (a second site page, the browser starting on a prerendered page), it finds the link that is there and adds nothing.
 */
@Injectable({ providedIn: 'root' })
export class PpSiteStyles {
  private readonly document = inject(DOCUMENT);

  load(): void {
    const head = this.document.head;
    if (head.querySelector('link[rel="stylesheet"][href="site.css"]')) return;
    const link = this.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'site.css';
    head.appendChild(link);
  }
}

/**
 * Put this on every route that shows site parts (`providers: [provideSiteStyles()]`). The route's providers are created
 * when the route is matched, before its component is drawn, so the link is in `<head>` before the first site part.
 */
export function provideSiteStyles(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => inject(PpSiteStyles).load());
}
