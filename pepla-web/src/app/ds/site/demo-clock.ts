import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';

/**
 * The timers and the "start when it scrolls into view" rule every landing demo shares. Provide it on the demo component
 * (`providers: [DemoClock]`) so each demo owns its timers: `at()` queues a step, `stop()` cancels every queued step (a
 * replay, a tab change), and the component's end cancels them too. Under `prefers-reduced-motion: reduce` every delay is 0,
 * so a demo shows its final state at once. Nothing here runs on the server: callers start work from `afterNextRender`.
 * Spec: SITE-03 decision 2.
 */
@Injectable()
export class DemoClock {
  /** Every live clock, for the dev test hook below. */
  private static live = new Set<DemoClock>();
  private readonly win = inject(DOCUMENT).defaultView;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private observers = new Set<IntersectionObserver>();
  /** The visitor prefers less motion: delays collapse to 0 and loops are not started. */
  readonly reduce = !!this.win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  /** Timers waiting right now (a test hook: AC-10 expects 0 after the demo ends). */
  get pending(): number { return this.timers.size; }

  constructor() {
    DemoClock.live.add(this);
    DemoClock.installHook(this.win);
    // A tab nobody is looking at runs nothing: cancel the queued steps when it is hidden.
    const doc = inject(DOCUMENT);
    const hidden = () => { if (doc.visibilityState === 'hidden') this.stop(); };
    doc.addEventListener('visibilitychange', hidden);
    inject(DestroyRef).onDestroy(() => {
      this.stop();
      this.observers.forEach((o) => o.disconnect());
      this.observers.clear();
      doc.removeEventListener('visibilitychange', hidden);
      DemoClock.live.delete(this);
    });
  }

  /** Dev gallery pages only: `window.__ppSiteClock` counts waiting timers and watching observers (the SITE-03 tests read it). */
  private static installHook(win: Window | null): void {
    if (!win || !win.location.pathname.startsWith('/dev/')) return;
    (win as unknown as { __ppSiteClock: unknown }).__ppSiteClock = {
      pending: () => { let n = 0; DemoClock.live.forEach((c) => (n += c.timers.size)); return n; },
      observers: () => { let n = 0; DemoClock.live.forEach((c) => (n += c.observers.size)); return n; },
    };
  }

  /** Run `fn` after `ms` (0 when motion is reduced). Returns nothing to hold on to: `stop()` cancels everything. */
  at(ms: number, fn: () => void): void {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, this.reduce ? 0 : ms);
    this.timers.add(t);
  }

  stop(): void { this.timers.forEach(clearTimeout); this.timers.clear(); }

  /** Call `fn` once, the first time `el` is `threshold` in view (at once when motion is reduced or there is no observer). */
  onView(el: Element, fn: () => void, threshold = 0.35): void {
    if (this.reduce || !this.win || !('IntersectionObserver' in this.win)) { fn(); return; }
    const o = new this.win.IntersectionObserver((es) => { if (es[0]?.isIntersecting) { fn(); o.disconnect(); this.observers.delete(o); } }, { threshold });
    this.observers.add(o);
    o.observe(el);
  }
}
