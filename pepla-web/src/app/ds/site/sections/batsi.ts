import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { DemoClock } from '../demo-clock';
import { PpSiteReveal } from '../motion';

type Tone = 'success' | 'danger' | 'brand';
interface Row { ok: boolean; label: string; status: string; tone: Tone }
interface Sample { q: string; a: string; rows: Row[]; ask: string; go: string; done: string }
type Msg =
  | { id: number; kind: 'me'; text: string }
  | { id: number; kind: 'typing' }
  | { id: number; kind: 'ai'; text: string; rows: Row[]; shown: number; ask?: { go: string; pressed: boolean } | null }
  | { id: number; kind: 'logged'; text: string; plain: boolean };

const rows = (...r: [boolean, string, string, Tone][]): Row[] => r.map(([ok, label, status, tone]) => ({ ok, label, status, tone }));
/** The three sample questions, word for word from the kit (site-landing-sections.js). */
const SAMPLES: readonly Sample[] = [
  { q: 'Is John Doe ready to start on Monday?', a: 'Four of five checks are complete.',
    rows: rows([true, 'ID document', 'Matches', 'success'], [true, 'Bank letter', 'Matches', 'success'], [true, 'Tax number', 'Captured', 'success'], [true, 'Contract', 'Signed', 'success'], [false, 'UIF reference number', 'Missing', 'danger']),
    ask: 'Ask John Doe for his UIF reference number?', go: 'Send request', done: 'Request sent to John Doe.' },
  { q: 'Who hasn’t sent their documents?', a: 'Two new employees are waiting on documents.',
    rows: rows([false, 'John Doe', 'UIF reference number', 'danger'], [false, 'New employee 2', 'Bank letter', 'danger']),
    ask: 'Send both a reminder now? The last one went out yesterday at 09:00.', go: 'Send reminders', done: 'Reminders sent to 2 new employees.' },
  { q: 'Which candidates are at risk?', a: 'Two candidates need attention.',
    rows: rows([false, 'Candidate 3 · Interview', 'No reply in 5 days', 'danger'], [false, 'Candidate 1 · Offer', 'Offer expires in 2 days', 'brand']),
    ask: 'I drafted a reminder to Candidate 3. Send it?', go: 'Approve and send', done: 'Reminder sent to Candidate 3.' },
];
const CYCLE = 11000;
let ids = 0;

/**
 * The landing page's Ask Batsi section: three sample questions that play one after another (11s each, the action is pressed
 * after 2.6s) until a visitor presses a question or an action. Timings, words and markup are the kit's and the approved page's.
 * Before it scrolls into view (and in the prerendered page) it shows the first question answered, as the kit does.
 * Spec: SITE-03, kit: project/components/site/site-batsi.md
 */
@Component({
  selector: 'section[ppSiteLandBatsi]',
  imports: [PpIcon, PpSiteReveal],
  providers: [DemoClock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-batsi__glow" aria-hidden="true"></div>
<div class="pp-site-wrap pp-site-batsi__split">
  <div class="pp-site-batsi__text">
    <p class="pp-site-eyebrow" [ppSiteReveal]="0">Ask Batsi</p>
    <h2 class="pp-site-batsi__title" id="batsi-title" [ppSiteReveal]="1">Ask Batsi about any employee or candidate.</h2>
    <p class="pp-site-batsi__lead" [ppSiteReveal]="2">Batsi answers from the employee record, reads documents and drafts the follow-up. Every action waits for HR to approve it.</p>
    <div class="pp-site-qtabs" [class.pp-site-qtabs--paused]="!auto()" role="tablist" aria-label="Sample questions" [ppSiteReveal]="3">
      @for (s of samples; track s.q; let i = $index) {
        <button class="pp-site-qtabs__tab" role="tab" type="button" [attr.aria-selected]="cur() === i" (click)="choose(i)">
          <span class="pp-site-qtabs__n">0{{ i + 1 }}</span>{{ s.q }}@for (k of [round()]; track k) {<span class="pp-site-qtabs__bar"></span>}
        </button>
      }
    </div>
    <ul class="pp-site-facts" [ppSiteReveal]="4">
      <li class="pp-site-facts__item"><svg ppIcon="check" />Answers from the organisation’s own records</li>
      <li class="pp-site-facts__item"><svg ppIcon="check" />HR approves every action</li>
      <li class="pp-site-facts__item"><svg ppIcon="check" />Every step in the audit log</li>
    </ul>
    <a class="pp-link pp-link--standalone" href="#ask-batsi" [ppSiteReveal]="5"><span>Learn more about Ask Batsi</span><svg ppIcon="arrow-right" /></a>
  </div>
  <div class="pp-site-batsi__vis" [ppSiteReveal]="2">
    <div #chat class="pp-site-chat pp-site-chat--tall" role="group" aria-label="Ask Batsi, sample conversation">
      <div class="pp-site-chat__top">
        <span class="pp-site-chat__name"><svg ppIcon="sparkles" />Ask Batsi</span>
        <span class="pp-site-chat__by">· Jane Smith, HR</span>
        <span class="pp-site-chat__note">Sample data</span>
      </div>
      <div class="pp-site-chat__body" aria-live="polite">
        @for (m of messages(); track m.id) {
          @switch (m.kind) {
            @case ('me') { <div class="pp-site-chat__msg pp-site-chat__msg--me">{{ m.text }}</div> }
            @case ('typing') { <span class="pp-site-chat__typing"><i></i><i></i><i></i></span> }
            @case ('logged') {
              <div class="pp-site-chat__logged">@if (!m.plain) {<span class="pp-site-chat__dot" aria-hidden="true"></span>}{{ m.text }}</div>
            }
            @case ('ai') {
              <div class="pp-site-chat__msg pp-site-chat__msg--ai">
                <span class="pp-site-chat__who"><svg ppIcon="sparkles" />Batsi</span>{{ m.text }}
                @if (m.rows.length) {
                  <span class="pp-site-chat__rows">
                    @for (r of m.rows.slice(0, m.shown); track r.label) {
                      <span class="pp-site-chat__row">
                        @if (r.ok) { <span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span> } @else { <span class="pp-site-chat__wait" aria-hidden="true">!</span> }
                        <span>{{ r.label }}</span><span class="pp-site-status" [class]="'pp-site-status--' + r.tone">{{ r.status }}</span>
                      </span>
                    }
                  </span>
                }
                @if (m.ask) {
                  <div class="pp-site-chat__actions">
                    <button class="pp-button pp-button--primary pp-button--small" [class.pp-button--pressed]="m.ask.pressed" type="button" (click)="press(m.id, true)">{{ m.ask.go }}</button>
                    <button class="pp-button pp-button--default pp-button--small" type="button" (click)="press(m.id, false)">Not now</button>
                  </div>
                }
              </div>
            }
          }
        }
      </div>
    </div>
  </div>
</div>
  `,
  host: { id: 'batsi', class: 'pp-site-batsi pp-site-batsi--landing', 'aria-labelledby': 'batsi-title' },
})
export class PpSiteLandBatsi {
  private readonly clock = inject(DemoClock);
  private readonly chat = viewChild.required<ElementRef<HTMLElement>>('chat');
  protected readonly samples = SAMPLES;
  protected readonly cur = signal(0);
  /** Changes on every play, so each tab's progress bar starts again. */
  protected readonly round = signal(0);
  protected readonly auto = signal(true);
  protected readonly messages = signal<Msg[]>(this.answered(0));

  constructor() {
    afterNextRender(() => this.clock.onView(this.chat().nativeElement, () => this.play(0), 0.35));
  }

  /** The first frame: the question answered and the action waiting, exactly the kit's static markup. */
  private answered(i: number): Msg[] {
    const s = SAMPLES[i];
    return [
      { id: ++ids, kind: 'me', text: s.q },
      { id: ++ids, kind: 'ai', text: s.a, rows: s.rows, shown: s.rows.length },
      { id: ++ids, kind: 'ai', text: s.ask, rows: [], shown: 0, ask: { go: s.go, pressed: false } },
    ];
  }

  protected choose(i: number): void { this.auto.set(false); this.play(i); }

  private push(m: Msg): void { this.messages.update((l) => [...l, m]); }
  private patch(id: number, f: (m: Msg) => Msg): void { this.messages.update((l) => l.map((m) => (m.id === id ? f(m) : m))); }

  private play(i: number): void {
    const c = this.clock;
    c.stop();
    this.cur.set(i);
    this.round.update((n) => n + 1);
    this.messages.set([]);
    const s = SAMPLES[i];
    c.at(100, () => this.push({ id: ++ids, kind: 'me', text: s.q }));
    c.at(700, () => this.push({ id: ++ids, kind: 'typing' }));
    c.at(1500, () => {
      this.messages.update((l) => l.filter((m) => m.kind !== 'typing'));
      const id = ++ids;
      this.push({ id, kind: 'ai', text: s.a, rows: s.rows, shown: 0 });
      s.rows.forEach((_, k) => c.at(200 + k * 320, () => this.patch(id, (m) => (m.kind === 'ai' ? { ...m, shown: k + 1 } : m))));
    });
    const askAt = 1700 + s.rows.length * 320 + 500;
    c.at(askAt, () => {
      const id = ++ids;
      this.push({ id, kind: 'ai', text: s.ask, rows: [], shown: 0, ask: { go: s.go, pressed: false } });
      if (this.auto()) c.at(2600, () => {
        this.patch(id, (m) => (m.kind === 'ai' && m.ask ? { ...m, ask: { ...m.ask, pressed: true } } : m));
        c.at(400, () => this.answer(id, true));
      });
    });
    if (this.auto()) c.at(CYCLE, () => this.play((this.cur() + 1) % SAMPLES.length));
  }

  /** A person pressing an action stops the cycle for good. */
  protected press(id: number, sent: boolean): void { this.auto.set(false); this.answer(id, sent); }

  /** A person (or the auto-press) answers the action: their choice, then Batsi's log line 450ms later. */
  protected answer(id: number, sent: boolean): void {
    const m = this.messages().find((x) => x.id === id);
    if (!m || m.kind !== 'ai' || !m.ask) return;
    const s = SAMPLES[this.cur()];
    this.messages.update((l) => l.map((x) => (x.id === id && x.kind === 'ai' ? { ...x, ask: null } : x)));
    this.push({ id: ++ids, kind: 'me', text: sent ? s.go : 'Not now' });
    this.clock.at(450, () => this.push({ id: ++ids, kind: 'logged', plain: !sent, text: sent ? s.done + ' Approved by Jane Smith, 09:42' : 'Nothing sent. Batsi will ask again tomorrow at 09:00.' }));
  }
}
