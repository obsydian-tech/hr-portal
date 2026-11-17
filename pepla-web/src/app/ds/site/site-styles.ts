import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';

const HREF = 'site.css';
/** A stylesheet that never answers must not hold a page back for ever. */
const GIVE_UP_MS = 4000;

/**
 * SITE-07: the public site's rules live in their own stylesheet, `site.css`, that only pages showing site parts load.
 * `angular.json` writes the file beside the app and links it nowhere; this adds the one `<link>`. It runs through
 * `DOCUMENT`, so it also runs while the page is prerendered and the prerendered `/` already carries the link. Asked
 * again (a second site page, the browser starting on a prerendered page), it finds the link that is there and adds nothing.
 */
@Injectable({ providedIn: 'root' })
export class SiteStyleLoader {
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Puts the link in `<head>` once and answers when the stylesheet is in, so no site part is drawn before its rules. */
  ready(): Promise<void> {
    const head = this.document.head;
    let link = head.querySelector<HTMLLinkElement>(`link[rel="stylesheet"][href="${HREF}"]`);
    if (!link) {
      link = this.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = HREF;
      head.appendChild(link);
    }
    if (!this.browser || link.sheet) return Promise.resolve();
    const el = link;
    return new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); el.removeEventListener('load', done); el.removeEventListener('error', done); resolve(); };
      const timer = setTimeout(done, GIVE_UP_MS);
      el.addEventListener('load', done);
      el.addEventListener('error', done);
    });
  }
}

/**
 * Put this on every route that shows site parts (`canActivate: [siteStyles]`). The guard runs before the route's
 * component is made, so the link is in `<head>`, and loaded, before the first site part is drawn.
 */
export const siteStyles: CanActivateFn = () => inject(SiteStyleLoader).ready().then(() => true);
