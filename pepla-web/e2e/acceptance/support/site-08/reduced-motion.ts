import type { Page } from '@playwright/test';

/**
 * Child lock .2 helpers (SITE-08): the reduced motion rule of design system PR #49 (ref c3788a5, pinned at 03df8e2).
 * Under `prefers-reduced-motion: reduce` the demos play at their normal timings (fades, colour and status changes, typing, counts, slow ambient light,
 * the CSS loops at the slower durations the kit CSS gives them). Only grain, the flying board card, pointer tilt and other large movement stop.
 * `data-site-still` is a separate rule and still stops every loop and animation.
 * New file: nothing exported by kit.ts or learn-page.ts changes. Same approach as `support/site-04/reduced-motion.ts` (child lock site-04.7).
 */

/**
 * Cancels every timer and interval the page holds (they share one id space), so a page that has played its demos to the end stays on that end
 * state while it is measured or walked with Tab (an Ask Batsi run moves on to the next question some seconds after it ends).
 */
export async function freezeTimers(p: Page): Promise<void> {
  await p.evaluate(() => { const top = window.setTimeout(() => undefined, 0); for (let i = 0; i <= top; i++) window.clearTimeout(i); });
}

/**
 * The CSS loops (animations that never end) running inside each scope right now: animation name and one iteration's length, with the number of
 * elements that run it. Reads the page as it stands; nothing is driven. Under reduced motion the kit's loops run at their slower lengths, so two
 * pages that agree here agree on grain (a grain loop on one side shows as an extra line) and on the slow light.
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
        const key = `${name || 'script'} ${eff!.getTiming().duration}ms`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      for (const [k, n] of [...seen].sort()) out.push(`${k} x${n}`);
    }
    return out;
  }, scopes);
}

/** What moved, in the page: an element (named by tag, pp- classes and own text) and its transform before and after the pointer went over the scope. */
type Moved = { sig: string; from: string; to: string };

function snapshot(scope: string): Array<{ i: number; sig: string; v: string; still: boolean; busy: boolean }> {
  const root = document.querySelector(scope);
  if (!root) return [];
  const out: Array<{ i: number; sig: string; v: string; still: boolean; busy: boolean }> = [];
  let i = 0;
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const cs = getComputedStyle(el);
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim().slice(0, 30);
    const cls = Array.from(el.classList).filter((c) => c.startsWith('pp-')).sort().join('.');
    out.push({ i: i++, sig: `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${own ? ` "${own}"` : ''}`, v: `${cs.transform}|${cs.translate}|${cs.rotate}|${cs.scale}`, still: !el.getAnimations().some((a) => a.effect?.getTiming().iterations === Infinity), busy: el.getAnimations().some((a) => a instanceof CSSTransition) });
  }
  return out;
}

/**
 * Pointer tilt: takes the scope's transforms, moves the pointer across it (corners, edges, centre, then back to a corner), waits for the hover
 * transitions to end and takes them again. Returns the elements whose transform, translate, rotate or scale is different. Elements that run a
 * loop at either look (the light, the rings) are not read; the 900ms wait lets the hover transitions end. A design system hover rule moves things too, so the list is compared with
 * the kit's list (`tiltCompare`): a tilt the kit does not have is the difference.
 */
export async function tiltMoves(p: Page, scope: string): Promise<string[]> {
  // The page has just been opened: the arrival transitions (the reveal) are left to end, and an element that is still in one when the first look is taken is not judged (it would read differently on two pages by timing alone).
  await p.waitForTimeout(800);
  const before = await p.evaluate(snapshot, scope);
  const box = await p.locator(scope).first().boundingBox();
  if (!box) return [`NO ELEMENT ${scope}`];
  const v = p.viewportSize() ?? { width: 1280, height: 800 };
  // The points are reached at the same distances from the scope's own top-left corner on both pages (the scope sits lower on one page than on the other: the gallery has a heading above it),
  // and never lower than 400px, so the pointer meets the same things on both and a hover is not found on one page by the luck of where the window ends.
  const x0 = Math.max(2, box.x + 2), y0 = Math.max(2, box.y + 2), x1 = Math.min(v.width - 2, box.x + box.width - 2), y1 = Math.min(v.height - 2, y0 + Math.min(box.height - 4, 400));
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const round = (t: string) => t.replace(/-?\d+(\.\d+)?/g, (n) => String(Math.round(Number(n) * 100) / 100));
  const out = new Set<string>();
  const read = async () => {
    const after = await p.evaluate(snapshot, scope);
    for (const b of before) {
      const a = after[b.i];
      if (a && a.sig === b.sig && !b.busy && b.still && a.still && a.v !== b.v && round(a.v) !== round(b.v)) out.add(`${b.sig}: ${round(b.v)} -> ${round(a.v)}`);
    }
  };
  // Child lock .2 (lock check T-hover): the pointer is read while it is OVER the page, at each stop. A tilt that follows the pointer and settles back when the pointer leaves
  // (a card that leans towards the cursor and resets on mouseleave) shows only while the pointer is there; reading once at the end, after it had left, never saw it.
  for (const [x, y] of [[mx, my], [(x0 + mx) / 2, (y0 + my) / 2], [(x1 + mx) / 2, (y1 + my) / 2], [(x1 + mx) / 2, (y0 + my) / 2], [(x0 + mx) / 2, (y1 + my) / 2]] as const) {
    await p.mouse.move(x, y, { steps: 6 });
    await p.waitForTimeout(600);
    await read();
  }
  // And once more as before: the pointer goes round the edges and back to a corner, and what stays moved is read after the hover transitions end.
  for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [mx, my], [x1, my], [mx, y1], [x0, my], [mx, y0], [mx, my], [x0, y0]] as const) await p.mouse.move(x, y, { steps: 6 });
  await p.waitForTimeout(900);
  await read();
  return [...out].sort();
}

/**
 * The transitions every element of a scope carries right now (property, duration, delay), one line per distinct element and value. Read before anything starts, so both pages
 * are in the same state. Under reduced motion the demos keep their fades at the design system's lengths: a page that slows or removes a transition (`transition: none`
 * in a reduced-motion rule, a longer duration) shows as a line that the kit page does not have. Child lock .2 (lock check T-transition).
 */
export function transitionsIn(p: Page, scope: string): Promise<string[]> {
  return p.evaluate((sc) => {
    const root = document.querySelector(sc);
    if (!root) return [`NO ELEMENT ${sc}`];
    const out = new Set<string>();
    for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
      const cs = getComputedStyle(el);
      const dur = cs.transitionDuration.split(',').map((x) => x.trim()), props = cs.transitionProperty.split(',').map((x) => x.trim()), del = cs.transitionDelay.split(',').map((x) => x.trim());
      if (dur.every((d) => d === '0s')) continue;
      const cls = Array.from(el.classList).filter((c) => c.startsWith('pp-')).sort().join('.');
      out.add(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}: ${props.map((x, i) => `${x} ${dur[i % dur.length]} ${del[i % del.length]}`).join(', ')}`);
    }
    return [...out].sort();
  }, scope);
}

/**
 * Under reduced motion nothing tilts with the pointer: whatever the pointer moves on the page, it moves on the kit page the same way (a hover rule of
 * the design system), and nothing else. Both lists are returned for the caller to compare: every move on the page must be in the kit's list (the other way round is not
 * judged: the two pages are reached at the same relative points, but a hover that the pointer meets on one page and just misses on the other is not a tilt).
 */
export async function tiltCompare(app: Page, kit: Page, appScope: string, kitScope: string): Promise<{ app: string[]; kit: string[] }> {
  const a = await tiltMoves(app, appScope);
  const k = await tiltMoves(kit, kitScope);
  return { app: a, kit: k };
}

/**
 * Control for `tiltMoves`: a pointer handler that tilts one element is put on the page, and the check must name that element among the things that moved.
 * (It is not enough to see more moves than before: the hover moves of the first pass stay in place and are not moves of the second.)
 */
export async function tiltControlSees(p: Page, scope: string): Promise<boolean> {
  await tiltMoves(p, scope);
  const sig = await p.evaluate((sc) => {
    const root = document.querySelector(sc) as HTMLElement;
    const target = (root.querySelector('.pp-site-demo__vis, .pp-site-hero__actions, h2, h1, p') ?? root.firstElementChild) as HTMLElement;
    const tilt = (e: MouseEvent) => { const r = root.getBoundingClientRect(); target.style.transform = `rotate(${((e.clientX - r.left) / r.width - 0.5) * 6}deg)`; };
    root.addEventListener('pointermove', tilt);
    root.addEventListener('mousemove', tilt);
    const own = Array.from(target.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim().slice(0, 30);
    const cls = Array.from(target.classList).filter((c) => c.startsWith('pp-')).sort().join('.');
    return `${target.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${own ? ` "${own}"` : ''}`;
  }, scope);
  return (await tiltMoves(p, scope)).some((m) => m.startsWith(`${sig}: `));
}
