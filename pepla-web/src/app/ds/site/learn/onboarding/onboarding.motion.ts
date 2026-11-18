import { Injectable } from '@angular/core';
import { PpSiteMotion } from '../../motion';

/**
 * The Onboarding page shows every arrival in place, as the kit's "Onboarding page" does: the kit page hides nothing and starts no arrival transition
 * (SITE-10 AC-12 compares every transition and animation the page starts with the kit's, both ways). The page provides this in place of `PpSiteMotion`:
 * it watches nothing and never sets `data-site-reveal`, so nothing is hidden and nothing fades or rises on scroll. It does not add `pp-site-reveal--in` either: the class would
 * change the style of what it sits on after the first frame, and a transition (the button arrows) would start that the kit's markup never starts. Spec: SITE-10.
 */
@Injectable()
export class PpOnbMotion extends PpSiteMotion {
  override observe(): void { /* nothing is hidden, so there is nothing to show */ }
  override unobserve(): void { /* nothing is watched */ }
}
