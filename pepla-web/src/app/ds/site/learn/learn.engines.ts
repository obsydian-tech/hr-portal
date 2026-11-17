import type { LearnClock } from './learn.clock';

/**
 * What moves in a Learn more demo. Each engine is the kit's preview script for one demo (`scripts/preview/site-*.js`), step for step and
 * with the same times, written against the panel's markup: the design system's classes carry the look, and an engine only sets them.
 * The demo section (`PpSiteLearnDemo`) starts an engine when it comes into view, and Play again restarts it.
 * Spec: SITE-08. Timings are the approved page's; do not retime them here.
 */
export type LearnEngine = 'steps' | 'timeline' | 'doc-read' | 'suggestion' | 'live-status' | 'approval-log' | 'choices';

export interface EngineContext {
  sec: HTMLElement;
  clock: LearnClock;
  /** Listens to an element and stops when the demo goes. */
  on(el: Element, type: string, fn: (e: Event) => void): void;
  /** Plays the demo when it is first in view (and again when Play again is pressed). The engine's `play` is what it calls. */
  start(play: () => void, threshold?: number): void;
}

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

/** Steps in one by one, then Play again appears (Leave types and the plain "Demo section"). */
function steps({ sec, clock, on, start }: EngineContext): void {
  const rows = $$('.pp-site-demo__row', sec);
  const reset = () => { clock.stop(); rows.forEach((r) => stepIn(r, false)); showAgain(sec, false); };
  const play = () => {
    live(sec); reset();
    rows.forEach((r, i) => clock.at(500 + i * 500 + (i === 4 ? 700 : 0), () => stepIn(r)));
    clock.at(4200, () => showAgain(sec, true));
  };
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

/** Reminders and follow-ups: a chase along a timeline, then a reminder drafted for a person (Recruitment). */
function timeline({ sec, clock, on, start }: EngineContext): void {
  const li = $$('.pp-site-timeline__item', sec), fill = $('.pp-site-timeline__fill', sec), sg = $('.pp-site-suggest', sec), s = topState(sec);
  const reset = () => { clock.stop(); li.forEach((l) => stepIn(l, false)); fill.style.setProperty('--_fill', '0'); stepIn(sg, false); showAgain(sec, false); setState(s, 'f2'); };
  const play = () => {
    live(sec); reset();
    li.forEach((l, i) => {
      clock.at(500 + i * 1100, () => {
        stepIn(l); fill.style.setProperty('--_fill', String(Math.min(1, (l.offsetTop + 10) / fill.offsetHeight)));
        if (i === 2) setState(s, 'f3');
        if (i === 3) setState(s, 'nr');
        if (i === 4) setState(s, 'rs');
      });
      if (i === 3) clock.at(500 + i * 1100 + 500, () => stepIn(sg));
    });
    clock.at(500 + li.length * 1100 + 300, () => showAgain(sec, true));
  };
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

/** Follow-ups for a missing document: the chase steps along a line and the status follows it (Onboarding). */
function liveStatus({ sec, clock, on, start }: EngineContext): void {
  const li = $$('.pp-site-timeline__item', sec), fill = $('.pp-site-timeline__fill', sec), w = $('.pp-site-timeline__waiting', sec), s = topState(sec);
  const reset = () => { clock.stop(); li.forEach((l) => stepIn(l, false)); fill.style.setProperty('--_fill', '0'); stepIn(w, false); showAgain(sec, false); setState(s, 'missing'); };
  const play = () => {
    live(sec); reset();
    li.forEach((l, i) => clock.at(500 + i * 1100, () => {
      stepIn(l); fill.style.setProperty('--_fill', String(Math.min(1, (l.offsetTop + 10) / fill.offsetHeight)));
      if (i === li.length - 1) setState(s, 'received');
    }));
    clock.at(500 + li.length * 1100 + 300, () => { stepIn(w); showAgain(sec, true); });
  };
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

/** A document read: values arrive, checks tick, Batsi suggests, a person accepts (Onboarding). */
function docRead({ sec, clock, on, start }: EngineContext): void {
  const card = $('.pp-site-read__doc', sec), f = $$('.pp-site-read__value', sec), ck = $$('.pp-site-read__check', sec), sg = $('.pp-site-read__suggest', sec), dd = $('.pp-site-read__decide', sec), lg = $('.pp-site-read__log', sec), s = topState(sec), acc = $('.pp-button--primary', dd);
  const reset = () => {
    clock.stop(); card.classList.remove('pp-site-read__doc--go'); reflow(card); f.forEach((b) => b.classList.remove('pp-site-read__value--in'));
    ck.forEach((c) => { stepIn(c, false); $('.pp-site-ok', c).classList.remove('pp-site-ok--in'); });
    [sg, dd, lg].forEach((e) => stepIn(e, false)); dd.classList.remove('pp-site-read__decide--done'); acc.classList.remove('pp-button--pressed'); showAgain(sec, false); setState(s, 'reading');
  };
  const accept = () => {
    if (dd.classList.contains('pp-site-read__decide--done')) return;
    acc.classList.add('pp-button--pressed');
    clock.at(300, () => { dd.classList.add('pp-site-read__decide--done'); setState(s, 'accepted'); stepIn(lg); showAgain(sec, true); });
  };
  const play = () => {
    live(sec); reset();
    clock.at(300, () => card.classList.add('pp-site-read__doc--go'));
    f.forEach((b, i) => clock.at(900 + i * 450, () => b.classList.add('pp-site-read__value--in')));
    ck.forEach((c, i) => clock.at(2900 + i * 500, () => { stepIn(c); clock.at(200, () => $('.pp-site-ok', c).classList.add('pp-site-ok--in')); }));
    clock.at(4700, () => { stepIn(sg); setState(s, 'matches'); });
    clock.at(5400, () => stepIn(dd));
    clock.at(7600, accept);
  };
  on(acc, 'click', () => { clock.stop(); accept(); });
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

/** An approval: the request waits, Batsi reminds, the line manager approves or declines (Leave). */
function suggestion({ sec, clock, on, start }: EngineContext): void {
  const s = $('.pp-site-demo__top > .pp-site-state', sec), n = $('.pp-site-suggest', sec), d = $('.pp-site-approval__decide', sec), ok = $<HTMLButtonElement>('.pp-button--primary', d), no = $<HTMLButtonElement>('.pp-button--default', d), l = $('.pp-site-approval__log', sec);
  const DONE = 'pp-site-approval__decide--done';
  const reset = () => { clock.stop(); setState(s, 'none'); stepIn(n, false); stepIn(l, false); d.classList.remove(DONE); ok.disabled = true; no.disabled = true; ok.classList.remove('pp-button--pressed'); showAgain(sec, false); };
  const approve = () => {
    if (d.classList.contains(DONE)) return;
    clock.stop(); ok.classList.add('pp-button--pressed');
    clock.at(300, () => { d.classList.add(DONE); setState(s, 'done'); stepIn(l); showAgain(sec, true); });
  };
  const play = () => {
    live(sec); reset();
    clock.at(700, () => { setState(s, 'wait'); ok.disabled = false; no.disabled = false; });
    clock.at(2300, () => stepIn(n));
    clock.at(5200, approve);
  };
  on(ok, 'click', approve);
  on(no, 'click', () => { if (no.disabled || d.classList.contains(DONE)) return; clock.stop(); ok.disabled = true; no.disabled = true; setState(s, 'no'); showAgain(sec, true); });
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

/** Approvals: Batsi's reminder and an API write wait; a person approves, and the log line records it (Security). */
function approvalLog({ sec, clock, on, start }: EngineContext): void {
  const items = $$('.pp-site-queue__item', sec), s = $('.pp-site-queue__item--agent .pp-site-state', sec), d = $('.pp-site-approval__decide', sec), ok = $('.pp-button--primary', d), l = $('.pp-site-approval__log', sec);
  const DONE = 'pp-site-approval__decide--done';
  const reset = () => { clock.stop(); [...items, d, l].forEach((e) => stepIn(e, false)); d.classList.remove(DONE); ok.classList.remove('pp-button--pressed'); setState(s, 'wait'); showAgain(sec, false); };
  const approve = () => {
    if (d.classList.contains(DONE)) return;
    clock.stop(); ok.classList.add('pp-button--pressed');
    clock.at(300, () => { d.classList.add(DONE); setState(s, 'done'); stepIn(l); showAgain(sec, true); });
  };
  const play = () => {
    live(sec); reset();
    clock.at(500, () => stepIn(items[0]!));
    clock.at(1400, () => stepIn(items[1]!));
    clock.at(2300, () => stepIn(d));
    clock.at(4800, approve);
  };
  on(ok, 'click', approve);
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

const ROLES: readonly (readonly [name: string, text: string, access: readonly (readonly [string, string | null, string])[]])[] = [
  ['Administrator', 'Sets up the company, users and roles.', [['Settings and users', 'success', 'Full'], ['All modules switched on', 'success', 'Full'], ['Audit log', 'success', 'View']]],
  ['HR', 'Runs people processes across the modules.', [['All employee records', 'success', 'Full'], ['Recruitment, Onboarding, Leave, Compliance', 'success', 'Full'], ['Salary and ID details', 'warning', 'Hidden, each Show logged']]],
  ['Manager', 'Looks after a team.', [['Team members’ records', 'success', 'Team only'], ['Leave requests', 'success', 'Approve'], ['Salary and ID details', null, 'Not shown']]],
  ['Employee', 'Looks after their own record.', [['Own record', 'success', 'View'], ['Leave requests', 'success', 'Request'], ['Other employees', null, 'Not shown']]],
  ['Guest', 'Sees only what they are given.', [['Items shared with them', 'success', 'View'], ['Employee records', null, 'Not shown'], ['Settings', null, 'Not shown']]],
];

/** Roles: the role buttons cycle every 3.2s from 2.6s after the demo is seen; pressing one stops the cycle (Platform). */
function choices({ sec, clock, on, start }: EngineContext): void {
  const btns = $$('.pp-site-slot', sec), n = $('.pp-site-roles__name', sec), p = $('.pp-site-roles__text', sec), acc = $('.pp-site-roles__access', sec);
  let auto = true, i = 0, started = false;
  const show = (k: number) => {
    btns.forEach((b, j) => b.setAttribute('aria-pressed', String(j === k)));
    const r = ROLES[k]!;
    n.textContent = r[0]; p.textContent = r[1]; acc.textContent = '';
    for (const x of r[2]) {
      const d = document.createElement('div'), a = document.createElement('span'), t = document.createElement('span');
      d.className = 'pp-site-roles__item'; a.textContent = x[0]; t.className = `pp-site-status${x[1] ? ` pp-site-status--${x[1]}` : ''}`; t.textContent = x[2];
      d.appendChild(a); d.appendChild(t); acc.appendChild(d);
    }
  };
  const cycle = () => { if (!auto) return; i = (i + 1) % ROLES.length; show(i); clock.at(3200, cycle); };
  btns.forEach((b) => on(b, 'click', () => { auto = false; clock.stop(); show(Number(b.getAttribute('data-r'))); }));
  live(sec); show(0);
  start(() => { if (started) return; started = true; clock.at(2600, cycle); });
}

export const ENGINES: Record<LearnEngine, (c: EngineContext) => void> = {
  steps, timeline, 'doc-read': docRead, suggestion, 'live-status': liveStatus, 'approval-log': approvalLog, choices,
};
