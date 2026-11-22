import type { EngineContext } from '../learn.engines';

/**
 * What moves in the Onboarding page's own demos: the new employee's phone, the contract and the two checklists (Laptop and access, Offboarding). Each engine
 * is the kit's preview script for that demo (`scripts/preview/site-onboarding.js`), step for step and with the same times, written against the panel's markup:
 * the design system's classes carry the look and an engine only sets them. The demo section (`PpOnbDemo`) starts one when it comes into view and Play again
 * restarts it. The document read and the follow-ups are the shared `doc-read` and `live-status` engines (SITE-08). Spec: SITE-10. Timings are the approved
 * page's; do not retime them.
 */
export type OnbEngine = 'phone' | 'contract' | 'checklist';

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
const topState = (sec: HTMLElement): HTMLElement => $('.pp-site-demo__top .pp-site-state', sec);
const reflow = (e: HTMLElement): void => { void e.offsetWidth; };

/** The new employee's phone: the link is opened, the consent is ticked, three documents are read, one is blurry and sent again. It has no Play again: it restarts by itself at 16.5s. */
function phone({ sec, clock, start }: EngineContext): void {
  const open = $('.pp-site-phone__open', sec), cons = $('.pp-site-phone__consent', sec), docs = $$('.pp-site-phone__doc', sec), note = $('.pp-site-phone__note', sec);
  const doc = (k: string) => $(`.pp-site-phone__doc[data-doc="${k}"]`, sec);
  const bar = (d: HTMLElement, full: boolean) => {
    const f = $('.pp-site-phone__fill', d);
    f.classList.add('pp-site-phone__fill--reset'); f.classList.toggle('pp-site-phone__fill--full', full); reflow(f); f.classList.remove('pp-site-phone__fill--reset');
    return f;
  };
  const up = (k: string, res: 'ok' | 'bad', label: string) => {
    const d = doc(k), s = $('.pp-site-state', d), t = $('.pp-site-phone__track', d);
    setState(s, 'uploading'); $('.pp-site-phone__fill', d).classList.add('pp-site-phone__fill--full');
    clock.at(1000, () => { setState(s, 'reading'); t.classList.add('pp-site-phone__track--dim'); });
    clock.at(2200, () => { setState(s, label); t.classList.remove('pp-site-phone__track--dim'); d.classList.add(res === 'bad' ? 'pp-site-phone__doc--bad' : 'pp-site-phone__doc--ok'); });
  };
  const reset = () => {
    clock.stop(); open.classList.remove('pp-site-phone__open--press'); cons.classList.remove('pp-site-phone__consent--on'); stepIn(cons, false); stepIn(note, false); setState(note, 'a');
    docs.forEach((d) => { stepIn(d, false); d.classList.remove('pp-site-phone__doc--bad', 'pp-site-phone__doc--ok'); setState($('.pp-site-state', d), 'waiting'); $('.pp-site-phone__track', d).classList.remove('pp-site-phone__track--dim'); bar(d, false); });
  };
  const play = () => {
    live(sec); reset();
    clock.at(700, () => open.classList.add('pp-site-phone__open--press'));
    clock.at(1200, () => stepIn(cons));
    clock.at(1900, () => cons.classList.add('pp-site-phone__consent--on'));
    clock.at(2500, () => docs.forEach((d, i) => clock.at(i * 120, () => stepIn(d))));
    clock.at(3300, () => up('id', 'ok', 'matches'));
    clock.at(4300, () => up('bank', 'bad', 'look'));
    clock.at(5300, () => up('tax', 'ok', 'received'));
    clock.at(9200, () => { const d = doc('bank'); d.classList.remove('pp-site-phone__doc--bad'); bar(d, false); up('bank', 'ok', 'matches'); });
    clock.at(12000, () => { setState(note, 'b'); stepIn(note); });
    clock.at(16500, play);
  };
  // The kit's markup shows the last step of everything but the pressed link; under `data-site-still` that is the page.
  if (clock.still) open.classList.add('pp-site-phone__open--press');
  start(play);
}

/** The contract: details fill in, it is sent, signed on the page, and the probation date is set. */
function contract({ sec, clock, on, start }: EngineContext): void {
  const mf = $$('.pp-site-contract__detail', sec), ink = $('.pp-site-contract__ink', sec), sigT = $('.pp-site-contract__sign-note', sec), p = $('.pp-site-contract__probation', sec), s = topState(sec);
  const mark = (m: HTMLElement, onn: boolean) => {
    m.classList.toggle('pp-site-contract__detail--in', onn); $('.pp-site-contract__label', m).setAttribute('aria-hidden', String(onn));
    if (onn) $('.pp-site-contract__value', m).removeAttribute('aria-hidden'); else $('.pp-site-contract__value', m).setAttribute('aria-hidden', 'true');
  };
  const reset = () => { clock.stop(); mf.forEach((m) => mark(m, false)); ink.classList.remove('pp-site-contract__ink--on'); setState(sigT, 'waiting'); stepIn(p, false); showAgain(sec, false); setState(s, 'draft'); };
  const play = () => {
    live(sec); reset();
    mf.forEach((m, i) => clock.at(600 + i * 500, () => mark(m, true)));
    clock.at(2900, () => setState(s, 'sent'));
    clock.at(4200, () => ink.classList.add('pp-site-contract__ink--on'));
    clock.at(5600, () => { setState(sigT, 'signed'); setState(s, 'signed'); });
    clock.at(6400, () => { stepIn(p); showAgain(sec, true); });
  };
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

/** A checklist: each item is picked up, then ticked, one after another; then the record is closed (Laptop and access, Offboarding). */
function checklist({ sec, clock, on, start }: EngineContext): void {
  const it = $$('.pp-site-checklist__item', sec), done = sec.querySelector<HTMLElement>('.pp-site-checklist__done'), s = sec.querySelector<HTMLElement>('.pp-site-demo__top .pp-site-state');
  const after = (onn: boolean) => { if (done) stepIn(done, onn); if (s) setState(s, onn ? 'closed' : 'open'); };
  const reset = () => { clock.stop(); it.forEach((c) => c.classList.remove('pp-site-checklist__item--done', 'pp-site-checklist__item--now')); showAgain(sec, false); after(false); };
  const play = () => {
    live(sec); reset();
    it.forEach((c, i) => {
      clock.at(500 + i * 850, () => c.classList.add('pp-site-checklist__item--now'));
      clock.at(500 + i * 850 + 550, () => { c.classList.remove('pp-site-checklist__item--now'); c.classList.add('pp-site-checklist__item--done'); });
    });
    clock.at(500 + it.length * 850 + 400, () => { after(true); showAgain(sec, true); });
  };
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

export const ONB_ENGINES: Record<OnbEngine, (c: EngineContext) => void> = { phone, contract, checklist };
