import { ApplicationRef, ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { DemoClock } from '../demo-clock';
import { PpSiteReveal } from '../motion';

interface Cand { name: string; note: string; flag: string; state: '' | 'moved' | 'risk' | 'done' }
const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Not hired'] as const;
const DRAFT_TEXT = 'Hi, a reminder that your panel interview for Sales Consultant is on Thursday at 10:00. Please confirm you can attend.';
const QUIET = 'No reply in 5 days';

/** The board as the demo starts: Candidate 4 in Screening, Candidate 1 in Offer, Candidate 3 first in Interview. */
const start = (): { cols: string[][]; cands: Record<string, Cand> } => ({
  cols: [['c7', 'c6'], ['c5', 'c4'], ['c3', 'c2'], ['c1'], [], ['c8']],
  cands: {
    c7: { name: 'Candidate 7', note: 'Sales Consultant · today', flag: QUIET, state: '' },
    c6: { name: 'Candidate 6', note: 'Sales Consultant · 2 days', flag: QUIET, state: '' },
    c5: { name: 'Candidate 5', note: 'Sales Consultant', flag: QUIET, state: '' },
    c4: { name: 'Candidate 4', note: 'Sales Consultant', flag: QUIET, state: '' },
    c3: { name: 'Candidate 3', note: 'Panel booked · Thu', flag: QUIET, state: '' },
    c2: { name: 'Candidate 2', note: 'Feedback 2 of 3', flag: QUIET, state: '' },
    c1: { name: 'Candidate 1', note: 'Offer sent · expires Fri', flag: QUIET, state: '' },
    c8: { name: 'Candidate 8', note: 'Closed with reason', flag: QUIET, state: '' },
  },
});
/** The board after the demo has played, which is what the kit's markup (and the prerendered page) shows. */
const finished = (): ReturnType<typeof start> => {
  const s = start();
  s.cols = [['c7', 'c6'], ['c5'], ['c4', 'c3', 'c2'], [], ['c1'], ['c8']];
  s.cands['c4'].state = 'moved';
  s.cands['c1'] = { ...s.cands['c1'], state: 'moved', note: 'Offer signed · starts 1 Dec' };
  s.cands['c3'] = { ...s.cands['c3'], state: 'done', flag: 'Reminder sent' };
  return s;
};

/**
 * The landing page's Recruitment section: a hiring board where Candidate 4 moves to Interview, Candidate 1 to Hired and Candidate 3 goes
 * quiet, then Batsi drafts a reminder (typed out) and Jane Smith sends it. Plays when it scrolls into view; "Play again" restarts it.
 * Timings are the approved page's. Cards move by transform only (the Web Animations API, 700ms), never by size or position.
 * Spec: SITE-03, kit: project/components/site/site-board.md, site-hiring.md
 */
@Component({
  selector: 'section[ppSiteLandRecruitment]',
  imports: [PpIcon, PpSiteReveal],
  providers: [DemoClock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-wrap">
  <div class="pp-site-section__head">
    <div>
      <p class="pp-site-eyebrow" [ppSiteReveal]="0">Recruitment</p>
      <h2 class="pp-site-section__title" id="recruitment-title" [ppSiteReveal]="1">Every candidate tracked from application to signed offer.</h2>
    </div>
    <p class="pp-site-section__lead" [ppSiteReveal]="2">One hiring board per role. Batsi watches each stage for candidates who go quiet and drafts the follow-up for HR to send.</p>
  </div>
  <div class="pp-site-hiring" [ppSiteReveal]="2">
    <div class="pp-site-board">
      <div #cols class="pp-site-board__cols" role="group" tabindex="0" aria-label="Sample hiring board for a Sales Consultant role, with six stages">
        @for (stage of stages; track stage; let i = $index) {
          <div class="pp-site-board__col">
            <h3 class="pp-site-board__head">{{ stage }}<span class="pp-site-board__count">{{ board().cols[i].length }}</span></h3>
            @for (id of board().cols[i]; track id) {
              <div class="pp-site-board__card" [class.pp-site-board__card--moved]="board().cands[id].state === 'moved'" [class.pp-site-board__card--risk]="board().cands[id].state === 'risk'" [class.pp-site-board__card--done]="board().cands[id].state === 'done'" [attr.data-card]="id">
                <b class="pp-site-board__name">{{ board().cands[id].name }}</b><small class="pp-site-board__note">{{ board().cands[id].note }}</small><span class="pp-site-board__flag">{{ board().cands[id].flag }}</span>
              </div>
            }
          </div>
        }
      </div>
    </div>
    <div class="pp-site-hiring__side">
      <div class="pp-site-hiring__draft" [class.pp-site-hiring__draft--on]="draftOn()" [class.pp-site-hiring__draft--sent]="sent()" aria-live="polite">
        <span class="pp-site-hiring__who"><svg ppIcon="sparkles" />Batsi</span>
        <p class="pp-site-hiring__text">Candidate 3 has not replied in 5 days. The panel interview is on Thursday.</p>
        <p #body class="pp-site-hiring__body" [attr.contenteditable]="editable() ? 'true' : null" [attr.tabindex]="editable() ? 0 : null">{{ draft() }}</p>
        <div class="pp-site-hiring__row">
          <button class="pp-button pp-button--primary pp-button--small" [class.pp-button--pressed]="pressed()" type="button" (click)="sendNow()">Send reminder</button>
          <button class="pp-button pp-button--default pp-button--small" type="button" (click)="edit()">Edit</button>
          <span class="pp-site-hiring__ok">Sent to Candidate 3 · Approved by Jane Smith, 09:42</span>
        </div>
      </div>
      <button class="pp-site-replay" type="button" (click)="play()"><svg ppIcon="rotate-ccw" />Play again</button>
    </div>
  </div>
  <ul class="pp-site-caps">
    <li class="pp-site-caps__item" [ppSiteReveal]="0"><h3 class="pp-site-caps__title">Six hiring stages</h3><p class="pp-site-caps__text">Applied, Screening, Interview, Offer, Hired and Not hired. Every move recorded with a reason.</p></li>
    <li class="pp-site-caps__item" [ppSiteReveal]="1"><h3 class="pp-site-caps__title">Interview panels</h3><p class="pp-site-caps__text">Panel members score against the same criteria. No candidate is rejected automatically.</p></li>
    <li class="pp-site-caps__item" [ppSiteReveal]="2"><h3 class="pp-site-caps__title">Reminders and follow-ups</h3><p class="pp-site-caps__text">Interviewers reminded to submit feedback. Candidates reminded to reply or upload.</p><span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span></li>
    <li class="pp-site-caps__item" [ppSiteReveal]="3"><h3 class="pp-site-caps__title">Candidate risk</h3><p class="pp-site-caps__text">At-risk flags for no reply, missed interviews and offers close to expiry.</p><span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span></li>
  </ul>
  <a class="pp-link pp-link--standalone" href="#recruitment-more" [ppSiteReveal]="0"><span>Learn more about Recruitment</span><svg ppIcon="arrow-right" /></a>
</div>
  `,
  host: { id: 'recruitment', class: 'pp-site-section pp-site-section--cream', 'aria-labelledby': 'recruitment-title' },
})
export class PpSiteLandRecruitment {
  private readonly clock = inject(DemoClock);
  private readonly app = inject(ApplicationRef);
  private readonly colsEl = viewChild.required<ElementRef<HTMLElement>>('cols');
  private readonly bodyEl = viewChild.required<ElementRef<HTMLElement>>('body');
  protected readonly stages = STAGES;
  protected readonly board = signal(finished());
  protected readonly draft = signal(DRAFT_TEXT);
  protected readonly draftOn = signal(true);
  protected readonly sent = signal(true);
  protected readonly pressed = signal(false);
  protected readonly editable = signal(false);

  constructor() {
    afterNextRender(() => this.clock.onView(this.colsEl().nativeElement, () => this.play(), 0.4));
  }

  private reset(): void {
    this.clock.stop();
    this.board.set(start());
    this.draftOn.set(false); this.sent.set(false); this.pressed.set(false); this.editable.set(false);
    this.draft.set('');
  }

  private setCand(id: string, patch: Partial<Cand>): void {
    this.board.update((b) => ({ ...b, cands: { ...b.cands, [id]: { ...b.cands[id], ...patch } } }));
  }

  /** Moves a card to the top of a column and slides it from where it was (transform only). */
  private move(id: string, to: number): void {
    const root = this.colsEl().nativeElement;
    const find = (): HTMLElement | null => root.querySelector<HTMLElement>(`[data-card="${id}"]`);
    const before = find()?.getBoundingClientRect();
    this.board.update((b) => {
      const cols = b.cols.map((c) => c.filter((x) => x !== id));
      cols[to] = [id, ...cols[to]];
      return { ...b, cols };
    });
    this.setCand(id, { state: 'moved' });
    if (this.clock.reduce || !before) return;
    this.app.tick();
    const el = find();
    if (!el || !el.animate) return;
    const after = el.getBoundingClientRect();
    el.animate([{ transform: `translate(${before.left - after.left}px,${before.top - after.top}px)` }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.22,.7,.2,1)' });
  }

  private type(i: number): void {
    if (i > DRAFT_TEXT.length) return;
    this.draft.set(DRAFT_TEXT.slice(0, i));
    this.clock.at(14, () => this.type(i + 3));
  }

  private finish(): void {
    if (this.sent()) return;
    this.sent.set(true);
    this.setCand('c3', { state: 'done', flag: 'Reminder sent' });
  }

  protected play(): void {
    const c = this.clock;
    this.reset();
    c.at(600, () => this.move('c4', 2));
    c.at(1800, () => { this.move('c1', 4); this.setCand('c1', { note: 'Offer signed · starts 1 Dec' }); });
    c.at(3000, () => this.setCand('c3', { state: 'risk' }));
    c.at(3800, () => { this.draftOn.set(true); this.type(0); });
    c.at(7600, () => { this.pressed.set(true); c.at(400, () => this.finish()); });
  }

  protected sendNow(): void { this.clock.stop(); this.draft.set(DRAFT_TEXT); this.finish(); }
  protected edit(): void { this.editable.set(true); this.app.tick(); this.bodyEl().nativeElement.focus(); }
}
