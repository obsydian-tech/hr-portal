import type { EngineContext } from '../learn.engines';

/**
 * What moves in the Compliance page's five demos: the role's requirements, the certificate register, the reminders, the renewal read and not cleared to work. Each
 * engine is the kit's preview script for that demo (`scripts/preview/site-compliance.js`), step for step and with the same times, written against the panel's markup:
 * the design system's classes carry the look and an engine only sets them. The demo section (`PpCompDemo`) starts one when it comes into view and Play again
 * restarts it. Spec: SITE-11. Timings are the approved page's; do not retime them.
 */
export type CompEngine = 'req' | 'reg' | 'rem' | 'read' | 'nc';

const ON = 'pp-site-state__item--on';
const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode): T => r.querySelector<T>(s)!;
const $$ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode): T[] => Array.from(r.querySelectorAll<T>(s));

/** Moves the current state of a stack of states. */
function setState(stack: Element, key: string): void {
  $$('.pp-site-state__item', stack).forEach((i) => {
    const on = i.getAttribute('data-state') === key;
    i.classList.toggle(ON, on);
    if (on) i.removeAttribute('aria-hidden'); else i.setAttribute('aria-hidden', 'true');
  });
}
const stepIn = (e: Element, on?: boolean): void => { e.classList.toggle('pp-site-step--in', on !== false); };
const live = (sec: HTMLElement): void => sec.setAttribute('data-site-live', '');
const again = (sec: HTMLElement): HTMLElement => $('.pp-site-demo__again', sec);
/** Sections whose Play again was pressed: the button hides while the demo plays, so focus goes back to it when it returns. */
const regain = new WeakSet<HTMLElement>();
const showAgain = (sec: HTMLElement, on: boolean): void => {
  const b = again(sec);
  b.classList.toggle('pp-site-demo__again--in', on);
  if (on && regain.has(sec)) { regain.delete(sec); b.focus({ preventScroll: true }); }
};
const topState = (sec: HTMLElement): HTMLElement => $('.pp-site-demo__top > .pp-site-state', sec);
const reflow = (e: HTMLElement): void => { void e.offsetWidth; };

/** Requirements: the role's list is copied onto the new employee, then each certificate is uploaded or given a due date. */
function req({ sec, clock, on, start }: EngineContext): void {
  const box = $$('.pp-site-req__box', sec)[1]!, rows = $$('.pp-site-req__row', box), s = $('.pp-site-req__head .pp-site-state', box);
  const reset = () => { clock.stop(); box.classList.remove('pp-site-req__box--live'); rows.forEach((r) => { stepIn(r, false); setState($('.pp-site-state', r), 'rq'); }); setState(s, 'new'); showAgain(sec, false); };
  const play = () => {
    live(sec); reset();
    clock.at(900, () => { box.classList.add('pp-site-req__box--live'); setState(s, 'added'); });
    rows.forEach((r, i) => clock.at(1300 + i * 500, () => stepIn(r)));
    clock.at(3600, () => setState($('.pp-site-state', rows[0]!), 'up'));
    clock.at(4300, () => setState($('.pp-site-state', rows[1]!), 'up'));
    clock.at(5000, () => { setState($('.pp-site-state', rows[2]!), 'due'); showAgain(sec, true); });
  };
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

/** Register: the filters cycle by themselves (all, expiring, overdue) and answer a click, which stops the cycle for good. It has no Play again. */
function reg({ sec, clock, on, start }: EngineContext): void {
  const btns = $$('.pp-site-register__filter', sec), rows = $$('.pp-site-register__row', sec);
  let auto = true, i = 0, started = false;
  const apply = (f: string) => {
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-f') === f)));
    rows.forEach((r) => r.classList.toggle('pp-site-register__row--off', !(f === 'all' || r.getAttribute('data-s') === f)));
  };
  const cycle = () => { if (!auto) return; const F = ['all', 'due', 'late']; i = (i + 1) % 3; apply(F[i]!); clock.at(3200, cycle); };
  btns.forEach((b) => on(b, 'click', () => { auto = false; clock.stop(); apply(b.getAttribute('data-f')!); }));
  live(sec);
  start(() => { if (started) return; started = true; clock.at(2600, cycle); });
}

/** Reminders: each reminder is sent along the line, the licence expires, the renewal closes it. */
function rem({ sec, clock, on, start }: EngineContext): void {
  const li = $$('.pp-site-timeline__item', sec), fill = $('.pp-site-timeline__fill', sec), c = topState(sec);
  const reset = () => { clock.stop(); li.forEach((l) => stepIn(l, false)); fill.style.setProperty('--_fill', '0'); showAgain(sec, false); setState(c, 'valid'); };
  const play = () => {
    live(sec); reset();
    li.forEach((l, i) => {
      clock.at(500 + i * 1100, () => {
        stepIn(l); fill.style.setProperty('--_fill', String(Math.min(1, (l.offsetTop + 10) / fill.offsetHeight)));
        if (i === 2) setState(c, 'd7');
        if (i === 3) setState(c, 'exp');
        if (i === 4) setState(c, 'ren');
      });
    });
    clock.at(500 + li.length * 1100 + 300, () => showAgain(sec, true));
  };
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

/** Renewals: scan, fields, Batsi suggests, Jane Smith accepts, the register updates. */
function read({ sec, clock, on, start }: EngineContext): void {
  const card = $('.pp-site-read__doc', sec), f = $$('.pp-site-read__value', sec), sg = $('.pp-site-read__suggest', sec), dd = $('.pp-site-read__decide', sec), rr = $('.pp-site-register__row', sec), s = topState(sec), acc = $('.pp-button--primary', dd);
  const reset = () => {
    clock.stop(); card.classList.remove('pp-site-read__doc--go'); reflow(card); f.forEach((b) => b.classList.remove('pp-site-read__value--in'));
    [sg, dd, rr].forEach((e) => stepIn(e, false)); dd.classList.remove('pp-site-read__decide--done'); acc.classList.remove('pp-button--pressed'); showAgain(sec, false); setState(s, 'reading');
  };
  const accept = () => {
    if (dd.classList.contains('pp-site-read__decide--done')) return;
    acc.classList.add('pp-button--pressed');
    clock.at(300, () => { dd.classList.add('pp-site-read__decide--done'); setState(s, 'acc'); stepIn(rr); showAgain(sec, true); });
  };
  const play = () => {
    live(sec); reset();
    clock.at(300, () => card.classList.add('pp-site-read__doc--go'));
    f.forEach((b, i) => clock.at(900 + i * 450, () => b.classList.add('pp-site-read__value--in')));
    clock.at(3000, () => { stepIn(sg); setState(s, 'matches'); });
    clock.at(3700, () => stepIn(dd));
    clock.at(6000, accept);
  };
  on(acc, 'click', () => { clock.stop(); accept(); });
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

/** Not cleared to work: the licence expires, the list fills, HR and the manager are told, the renewal empties it. */
function nc({ sec, clock, on, start }: EngineContext): void {
  const box = $('.pp-site-clear', sec), n = $('.pp-site-clear__count', sec), d = $('.pp-site-day .pp-site-state', sec), t = $('.pp-site-clear__told', sec), sg = $('.pp-site-suggest', sec);
  const reset = () => { clock.stop(); box.classList.remove('pp-site-clear--has'); setState(n, 'z'); setState(d, 'd0'); stepIn(t, false); stepIn(sg, false); showAgain(sec, false); };
  const play = () => {
    live(sec); reset();
    clock.at(900, () => setState(d, 'd1'));
    clock.at(1700, () => { setState(d, 'd2'); box.classList.add('pp-site-clear--has'); setState(n, 'one'); });
    clock.at(2500, () => stepIn(t));
    clock.at(5200, () => { box.classList.remove('pp-site-clear--has'); setState(n, 'z'); stepIn(t, false); stepIn(sg); showAgain(sec, true); });
  };
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

export const COMP_ENGINES: Record<CompEngine, (c: EngineContext) => void> = { req, reg, rem, read, nc };
