import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, Injectable, OnDestroy, afterNextRender, inject, input, numberAttribute } from '@angular/core';

/**
 * Arrival on scroll for the public site. A page hides arrivals only once this script runs
 * (`data-site-reveal` on <html>), then shows each one as it reaches 15% in view, once.
 * Without it (no script, a prerendered page, a screenshot) everything is visible.
 * Spec: project/components/site/site-motion.md. Browser only: nothing here runs on the server.
 */
@Injectable({ providedIn: 'root' })
export class PpSiteMotion {
  private readonly doc = inject(DOCUMENT);
  private io: IntersectionObserver | null = null;
  private watched = 0;

  observe(el: HTMLElement): void {
    const win = this.doc.defaultView;
    if (!win) return;
    if (!('IntersectionObserver' in win)) { el.classList.add('pp-site-reveal--in'); return; }
    if (!this.io) {
      this.io = new win.IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add('pp-site-reveal--in'); this.io?.unobserve(e.target); this.release(); }
      }, { threshold: 0.15 });
    }
    if (el.classList.contains('pp-site-reveal--in')) return;
    this.watched++;
    this.doc.documentElement.setAttribute('data-site-reveal', '');
    this.io.observe(el);
  }

  unobserve(el: HTMLElement): void {
    if (!this.io) return;
    if (!el.classList.contains('pp-site-reveal--in')) { this.io.unobserve(el); this.release(); }
  }

  private release(): void {
    this.watched = Math.max(0, this.watched - 1);
    if (this.watched === 0) this.doc.documentElement.removeAttribute('data-site-reveal');
  }
}

/**
 * An arrival: fades in and rises as it scrolls into view. `[ppSiteReveal]="2"` is its place in a group (--_i), 0 to 4.
 * `[revealOn]="false"` leaves it plain, so a component can offer arrival as an option.
 */
@Directive({
  selector: '[ppSiteReveal]',
  host: { '[class.pp-site-reveal]': 'revealOn()', '[style.--_i]': 'revealOn() ? index() : null' },
})
export class PpSiteReveal implements OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly motion = inject(PpSiteMotion);
  readonly index = input(0, { alias: 'ppSiteReveal', transform: (v: unknown) => numberAttribute(v, 0) });
  readonly revealOn = input(true);
  constructor() { afterNextRender(() => { if (this.revealOn()) this.motion.observe(this.el); }); }
  ngOnDestroy(): void { if (this.revealOn()) this.motion.unobserve(this.el); }
}

/** A soft light drifting about (one loop in 28s, half speed under reduced motion). */
@Directive({ selector: '[ppSiteDrift]', host: { class: 'pp-site-drift' } })
export class PpSiteDrift {}

/** A ring turning (one turn per 70s). */
@Directive({ selector: '[ppSiteTurn]', host: { class: 'pp-site-turn' } })
export class PpSiteTurn {}

/** The radar sweep. */
@Directive({ selector: '[ppSiteSweep]', host: { class: 'pp-site-sweep' } })
export class PpSiteSweep {}

/** A live dot's pulse. */
@Directive({ selector: '[ppSitePulse]', host: { class: 'pp-site-pulse' } })
export class PpSitePulse {}
