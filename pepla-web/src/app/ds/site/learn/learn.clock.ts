import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { DemoClock } from '../demo-clock';

/**
 * The timers and view observers of one Learn more demo or Ask Batsi band. It is the landing page's `DemoClock` with one difference:
 * under reduced motion the delays are kept (SITE-08 AC-8: a demo still steps, nothing slides). Reduced motion removes movement in the
 * design system's CSS; it does not make the steps wait for nothing. `window.__ppSiteClock` counts these timers and observers too.
 */
@Injectable()
export class LearnClock extends DemoClock {
  override readonly reduce = false;
  private readonly root = inject(DOCUMENT).documentElement;

  /** `data-site-still` is on the page (a picture, a print, a test): every demo shows its last step and nothing is scheduled. */
  get still(): boolean { return this.root.hasAttribute('data-site-still'); }
}
