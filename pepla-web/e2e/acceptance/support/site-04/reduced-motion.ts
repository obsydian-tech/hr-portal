import type { Page } from '@playwright/test';

/**
 * Child lock 04.7 helpers (SITE-03 and SITE-04): the reduced motion rule of design system PR #49.
 * Under `prefers-reduced-motion: reduce` the demos play at their normal timings, with fades, colour and status changes, typing, counts,
 * slow ambient light and its pointer drift, and the CSS loops at the slower durations the kit CSS gives them. Only grain, the flying
 * board card, pointer tilt and other large movement stop. `data-site-still` is a separate rule and still stops every loop.
 */

/**
 * Cancels every timer and interval the page holds (they share one id space), so a page that has played its demos to the end stays on
 * that end state while it is measured, photographed or walked with Tab (an Ask Batsi run moves on to the next question 11s after it starts).
 */
export async function freezeTimers(p: Page): Promise<void> {
  await p.evaluate(() => { const top = window.setTimeout(() => undefined, 0); for (let i = 0; i <= top; i++) window.clearTimeout(i); });
}

export type Flights = {
  /** Animations or transitions seen running on a board card that move it: a keyframe or transition of transform, translate, rotate, scale or offset. */
  animated: string[];
  /** How many 16ms looks found a card in its final column but off its final place there (a card travelling shows here). */
  offRest: number;
  /** The columns (by index) each card was in, in the order it was found there. */
  columns: Record<string, number[]>;
};

/**
 * Watches the board cards under `scope` every 16ms for `ms` (call it before the run starts, then drive the run). It reports whether any card
 * had a transform animation or transition running and whether any card was seen between its old place and its new one.
 */
export function watchFlights(p: Page, scope: string, ms: number): Promise<Flights> {
  return p.evaluate(([sc, total]) => new Promise<Flights>((resolve) => {
    const root = document.querySelector(sc as string);
    if (!root) return resolve({ animated: [`NO ELEMENT ${sc}`], offRest: 0, columns: {} });
    const MOVES = /^(transform|translate|rotate|scale|offset|offsetPath|offsetDistance)$/;
    const animated = new Set<string>();
    const columns: Record<string, number[]> = {};
    const place = new Map<string, Array<{ col: number; x: number; y: number }>>();
    const t0 = performance.now();
    const look = () => {
      const cols = Array.from(root.querySelectorAll('.pp-site-board__col'));
      for (const card of Array.from(root.querySelectorAll('.pp-site-board__card'))) {
        const id = card.getAttribute('data-card') ?? '?';
        for (const a of card.getAnimations()) {
          const tp = (a as unknown as { transitionProperty?: string }).transitionProperty;
          if (tp && MOVES.test(tp)) animated.add(`${id} transition ${tp}`);
          else if (!tp) { const eff = a.effect as KeyframeEffect | null; for (const kf of eff?.getKeyframes() ?? []) for (const key of Object.keys(kf)) if (MOVES.test(key)) animated.add(`${id} animates ${key}`); }
        }
        const col = cols.findIndex((c) => c.contains(card));
        const seen = (columns[id] ??= []);
        if (seen.at(-1) !== col) seen.push(col);
        const r = card.getBoundingClientRect(), c = cols[col]?.getBoundingClientRect();
        const list = place.get(id) ?? [];
        list.push({ col, x: c ? r.left - c.left : r.left, y: c ? r.top - c.top : r.top });
        place.set(id, list);
      }
      if (performance.now() - t0 >= (total as number)) {
        // A card that crosses columns starts its flight at its old place, so while it flies it sits to one side of where it ends up in its
        // new column: a sample in the final column whose x differs from the last sample's by over 1px is a card still on its way.
        let off = 0;
        for (const list of place.values()) {
          const last = list.at(-1)!;
          const inFinal = list.filter((s) => s.col === last.col);
          for (const s of inFinal.slice(0, -1)) if (Math.abs(s.x - last.x) > 1) off++;
        }
        return resolve({ animated: [...animated].sort(), offRest: off, columns });
      }
      setTimeout(look, 16);
    };
    look();
  }), [scope, ms] as const);
}

/**
 * The CSS loops (animations that never end) running inside each scope right now: animation name and one iteration's length, with the number
 * of elements that run it. Reads the page as it stands; nothing is driven.
 */
export function loopsIn(p: Page, scopes: string[]): Promise<string[]> {
  return p.evaluate((list) => {
    const out: string[] = [];
    for (const sc of list) {
      const root = document.querySelector(sc);
      if (!root) { out.push(`${sc}: NO ELEMENT`); continue; }
      const seen = new Map<string, number>();
      for (const a of document.getAnimations()) {
        const eff = a.effect as KeyframeEffect | null;
        const tg = eff?.target as Element | null | undefined;
        if (!tg || !root.contains(tg) || a.playState !== 'running' || eff!.getTiming().iterations !== Infinity) continue;
        const name = (a as CSSAnimation).animationName ?? '';
        if (name === 'pp-site-blink') continue; // the typing caret: the design system has no still rule for it (cards/site-03.md)
        const key = `${name} ${eff!.getTiming().duration}ms`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      for (const [k, n] of [...seen].sort()) out.push(`${k} x${n}`);
    }
    return out;
  }, scopes);
}

/**
 * An IntersectionObserver that watches only what is inside the section with id `keep` (an init script: `ctx.addInitScript(SCOPED_VIEW, id)`).
 * `gotoLanding(page, [id])` takes the other sections out of the page after it has loaded, but a demo whose section was already in view at the
 * first paint has started by then, and its clock (a Batsi cycle, the Modules typing) stays live and queued. Those timers are counted by
 * `window.__ppSiteClock.pending()`, so a read of the one section would never reach 0 (on a phone the first sections are in view at load).
 * With this in place the sections that are taken out never start, the kept section starts when it scrolls into view, as for a visitor.
 */
export const SCOPED_VIEW = (keep: string): void => {
  const Real = window.IntersectionObserver;
  class Scoped extends Real {
    override observe(el: Element): void { if (el.closest(`[id="${keep}"]`)) super.observe(el); }
  }
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Scoped;
};

/**
 * Scrolls the part of a section a demo watches (`inner`, or the whole of `scope`) to the middle of the window, so a real IntersectionObserver
 * sees enough of it (the demos start at 35% in view, 40% for the board). `scrollIntoViewIfNeeded` only brings the top edge in: on a phone, where
 * Compliance's watch block is 1210px tall in an 844px window, that left 29% of it in view and the demo never started.
 */
export async function centre(p: Page, scope: string, inner = ''): Promise<void> {
  await p.evaluate(([sc, inn]) => { const root = document.querySelector(sc as string)!; ((inn ? root.querySelector(inn as string) : null) ?? root).scrollIntoView({ block: 'center' }); }, [scope, inner] as const);
}
