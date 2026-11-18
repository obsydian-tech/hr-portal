import type { EngineContext } from '../learn.engines';

/**
 * What moves in the Recruitment page's own demos: the hiring board, the scorecard, the risk list and the offer to onboarding. Each engine is the kit's
 * preview script for that demo (`scripts/preview/site-recruitment.js`), step for step and with the same times, written against the panel's markup: the
 * design system's classes carry the look and an engine only sets them. The demo section (`PpRecruitDemo`) starts one when it comes into view and
 * Play again restarts it. The follow-ups demo is the shared `timeline` engine (SITE-08). Spec: SITE-09. Timings are the approved page's; do not retime them.
 */
export type RecruitEngine = 'board' | 'score' | 'risk' | 'offer';

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

const COLS = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Not hired'] as const;
/** The board as it first stands: [id, name, note] per card, per column. */
const CARDS: readonly (readonly (readonly [string, string, string])[])[] = [
  [['c7', 'Candidate 7', 'Sales Consultant · today'], ['c6', 'Candidate 6', 'Sales Consultant · 2 days']],
  [['c5', 'Candidate 5', 'Sales Consultant'], ['c4', 'Candidate 4', 'Sales Consultant']],
  [['c3', 'Candidate 3', 'Panel booked · Thu'], ['c2', 'Candidate 2', 'Feedback 2 of 3']],
  [['c1', 'Candidate 1', 'Offer sent · expires Fri']],
  [],
  [['c8', 'Candidate 8', 'Closed with reason']],
];
/** The three moves: [card, to column, the reason line, the new note, a win]. */
const MOVES: readonly (readonly [string, number, string, string, boolean])[] = [
  ['c4', 2, 'Moved by Jane Smith', 'Sales Consultant', false],
  ['c1', 4, 'Offer signed', 'Starts 1 Dec', true],
  ['c5', 5, 'Reason: another candidate selected', 'Closed with reason', false],
];

/** Hiring board: three candidates move, the counts follow, the log line appears. A card slides to its new column by transform (not under reduced motion). */
function board({ sec, clock, on, start }: EngineContext): void {
  const cont = $('.pp-site-board__cols', sec), log = $('.pp-site-board__log', sec);
  const build = () => {
    cont.textContent = '';
    CARDS.forEach((cards, i) => {
      const col = document.createElement('div');
      col.className = 'pp-site-board__col'; col.setAttribute('data-col', String(i));
      const head = document.createElement('h3'), count = document.createElement('span');
      head.className = 'pp-site-board__head'; head.append(COLS[i]!);
      count.className = 'pp-site-board__count'; count.textContent = String(cards.length); head.append(count);
      col.append(head);
      for (const [id, name, note] of cards) {
        const card = document.createElement('div'), b = document.createElement('b'), small = document.createElement('small'), why = document.createElement('span');
        card.className = 'pp-site-board__card'; card.setAttribute('data-card', id);
        b.className = 'pp-site-board__name'; b.textContent = name;
        small.className = 'pp-site-board__note'; small.textContent = note;
        why.className = 'pp-site-board__why';
        card.append(b, small, why); col.append(card);
      }
      cont.append(col);
    });
  };
  const count = () => $$('.pp-site-board__col', cont).forEach((c) => { $('.pp-site-board__count', c).textContent = String($$('.pp-site-board__card', c).length); });
  const move = (id: string, col: number, why: string, sub: string, win: boolean) => {
    const e = $(`[data-card="${id}"]`, cont), to = $(`[data-col="${col}"]`, cont), a = e.getBoundingClientRect();
    to.insertBefore(e, (to.children[1] as Element | undefined) ?? null); count();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) { const b = e.getBoundingClientRect(); e.animate([{ transform: `translate(${a.left - b.left}px,${a.top - b.top}px)` }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.22,.7,.2,1)' }); }
    e.classList.add('pp-site-board__card--moved'); if (win) e.classList.add('pp-site-board__card--win');
    if (why) $('.pp-site-board__why', e).textContent = why;
    if (sub) $('.pp-site-board__note', e).textContent = sub;
  };
  const play = () => {
    live(sec); clock.stop(); build(); log.classList.remove('pp-site-board__log--in'); showAgain(sec, false);
    const at = [700, 1900, 3100];
    MOVES.forEach((m, i) => clock.at(at[i]!, () => move(m[0], m[1], m[2], m[3], m[4])));
    clock.at(4000, () => { log.classList.add('pp-site-board__log--in'); showAgain(sec, true); });
  };
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play, 0.3);
}

/** Scorecard: scores arrive panel by panel, the averages settle, a person decides (by themselves, or by pressing Move to Offer). */
function score({ sec, clock, on, start }: EngineContext): void {
  const n = $('.pp-site-score__note', sec), d = $('.pp-site-score__decide', sec), s = topState(sec), go = $('.pp-button--primary', d);
  const col = (c: number) => $$(`.pp-site-score__v[data-c="${c}"]`, sec).forEach((v) => v.classList.add('pp-site-score__v--in'));
  const reset = () => {
    clock.stop(); $$('.pp-site-score__v', sec).forEach((v) => v.classList.remove('pp-site-score__v--in'));
    stepIn(n, false); stepIn(d, false); d.classList.remove('pp-site-score__decide--done'); go.classList.remove('pp-button--pressed'); showAgain(sec, false); setState(s, 'scoring');
  };
  const decide = () => {
    if (d.classList.contains('pp-site-score__decide--done')) return;
    go.classList.add('pp-button--pressed');
    clock.at(300, () => { d.classList.add('pp-site-score__decide--done'); setState(s, 'moved'); showAgain(sec, true); });
  };
  const play = () => {
    live(sec); reset();
    for (let c = 0; c < 4; c++) clock.at(500 + c * 1000, () => col(c));
    clock.at(500 + 4 * 1000 + 300, () => { stepIn(n); setState(s, 'scored'); });
    clock.at(500 + 4 * 1000 + 1100, () => stepIn(d));
    clock.at(500 + 4 * 1000 + 3600, decide);
  };
  on(go, 'click', () => { clock.stop(); decide(); });
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

/** Risk: the flags arrive, Batsi suggests, the expiring offer is signed and the count drops. */
function risk({ sec, clock, on, start }: EngineContext): void {
  const it = $$('.pp-site-risk__item', sec), sg = $('.pp-site-suggest', sec), c = topState(sec), off = $('[data-offer]', sec);
  const offSt = $('.pp-site-state:not(.pp-site-risk__why)', off), offWhy = $('.pp-site-risk__why', off);
  const cnt = (n: number) => setState(c, n === 0 ? 'n' : `c${n}`);
  const reset = () => {
    clock.stop(); it.forEach((e) => { stepIn(e, false); e.classList.remove('pp-site-risk__item--fix'); }); stepIn(sg, false); showAgain(sec, false); cnt(0); setState(offSt, 'exp'); setState(offWhy, 'a');
  };
  const play = () => {
    live(sec); reset();
    it.forEach((e, i) => clock.at(500 + i * 900, () => { stepIn(e); cnt(i + 1); }));
    clock.at(500 + it.length * 900 + 300, () => stepIn(sg));
    clock.at(500 + it.length * 900 + 3400, () => { off.classList.add('pp-site-risk__item--fix'); setState(offSt, 'sg'); setState(offWhy, 'b'); cnt(2); showAgain(sec, true); });
  };
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

/** Offer to onboarding: the offer is signed, the employee record is created and carries the details, onboarding opens. */
function offer({ sec, clock, on, start }: EngineContext): void {
  const cards = $$('.pp-site-offer__card', sec), A = cards[0]!, B = cards[1]!, as = $('.pp-site-state', A), bs = $('.pp-site-state', B), bf = $$('.pp-site-offer__value', B), n = $('.pp-site-suggest', sec), s = topState(sec);
  const reset = () => {
    clock.stop(); A.classList.remove('pp-site-offer__card--live'); B.classList.remove('pp-site-offer__card--live'); setState(as, 'sent'); setState(bs, 'nc');
    bf.forEach((b) => b.classList.remove('pp-site-offer__value--in')); stepIn(n, false); showAgain(sec, false); setState(s, 'sent');
  };
  const play = () => {
    live(sec); reset();
    clock.at(1200, () => { setState(as, 'signed'); setState(s, 'signed'); A.classList.add('pp-site-offer__card--live'); });
    clock.at(2300, () => { setState(bs, 'cr'); B.classList.add('pp-site-offer__card--live'); });
    bf.forEach((b, i) => clock.at(2700 + i * 450, () => b.classList.add('pp-site-offer__value--in')));
    clock.at(4800, () => { stepIn(n); setState(bs, 'ac'); showAgain(sec, true); });
  };
  on(again(sec), 'click', () => { regain.add(sec); play(); });
  start(play);
}

export const RECRUIT_ENGINES: Record<RecruitEngine, (c: EngineContext) => void> = { board, score, risk, offer };
