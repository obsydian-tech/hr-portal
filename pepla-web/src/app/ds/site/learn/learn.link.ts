import { Directive } from '@angular/core';

/**
 * A link whose address is not known yet (`#`): pressing it leaves the page and the address as they are. The site's `<base href="/">`
 * would otherwise send a `#` link to the home page. A link with a real address behaves as any link.
 */
@Directive({
  selector: 'a[ppSiteLearnLink]',
  host: { '(click)': 'stay($event)' },
})
export class PpSiteLearnLink {
  protected stay(e: Event): void {
    const href = (e.currentTarget as HTMLAnchorElement).getAttribute('href');
    if (!href || href === '#') e.preventDefault();
  }
}
