import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { PpSiteReveal } from '../motion';
import { computed } from '@angular/core';
import { DemoClock } from '../demo-clock';

type Field = 'idle' | 'on' | 'set';
const JD = [14, 15, 17, 18];
interface Day { n: number; blank?: boolean; weekend?: boolean; holiday?: boolean; team?: boolean; mine?: boolean }
/** December 2026: starts on a Tuesday; 16, 25 and 26 are public holidays; Employee 2 is away 21 to 23. */
const DAYS: Day[] = [{ n: 0, blank: true }, ...Array.from({ length: 31 }, (_, i): Day => {
  const n = i + 1, dow = (n + 0) % 7; // 1 Dec is a Tuesday, so n % 7 of 5 or 6 is a weekend (5 Dec Sat, 6 Dec Sun)
  return { n, weekend: dow === 5 || dow === 6, holiday: n === 16 || n === 25 || n === 26, team: n >= 21 && n <= 23, mine: JD.includes(n) };
})];

/** The landing page Leave Management section: John Doe fills the request on the phone, the days appear on the calendar, Batsi reminds the line manager, the line manager approves and the balance counts down to 11 days. Spec: SITE-04, kit site-leave, site-request, site-calendar. */
@Component({
  selector: 'section[ppSiteLandLeave]',
  imports: [PpIcon, PpSiteReveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DemoClock],
  template: `
<div class="pp-site-wrap"><div class="pp-site-section__head"><div><p class="pp-site-eyebrow" [ppSiteReveal]="0">Leave Management</p>
<h2 class="pp-site-section__title" id="lld-h" [ppSiteReveal]="1">Leave requests, approvals and balances in one place.</h2>
</div>
<p class="pp-site-section__lead" [ppSiteReveal]="2">Annual, sick, family responsibility and maternity leave follow the BCEA. Employees request leave from a phone, managers approve it and the balance updates on the employee record.</p>
</div>
<div class="pp-site-leave" [ppSiteReveal]="2"><div class="pp-site-request" role="group" aria-label="Sample leave request on a phone"><div class="pp-site-request__frame"><div class="pp-site-request__screen"><span class="pp-site-request__notch" aria-hidden="true"></span>
<div class="pp-site-request__head"><span class="pp-site-request__avatar" aria-hidden="true">JD</span>
<span class="pp-site-request__who"><b class="pp-site-request__name">John Doe</b><span class="pp-site-request__role">Sales Consultant</span>
</span>
</div>
<h3 class="pp-site-request__title">Request leave</h3>
<div class="pp-site-request__field" [class.pp-site-request__field--on]="fs()[0] === 'on'" [class.pp-site-request__field--set]="fs()[0] === 'set'"><span class="pp-site-request__label">Leave type</span>
<div class="pp-site-request__input"><span class="pp-site-request__value">Annual leave</span>
</div>
</div>
<div class="pp-site-request__dates"><div class="pp-site-request__field" [class.pp-site-request__field--on]="fs()[1] === 'on'" [class.pp-site-request__field--set]="fs()[1] === 'set'"><span class="pp-site-request__label">From</span>
<div class="pp-site-request__input"><span class="pp-site-request__value">Mon 14 Dec</span>
</div>
</div>
<div class="pp-site-request__field" [class.pp-site-request__field--on]="fs()[2] === 'on'" [class.pp-site-request__field--set]="fs()[2] === 'set'"><span class="pp-site-request__label">To</span>
<div class="pp-site-request__input"><span class="pp-site-request__value">Fri 18 Dec</span>
</div>
</div>
</div>
<p class="pp-site-request__count" [class.pp-site-request__count--on]="countOn()"><b>4 working days.</b> 16 Dec is a public holiday and is not counted.</p>
<button type="button" class="pp-site-request__submit" [class.pp-site-request__submit--press]="pressing()" [disabled]="sent()" (click)="submit()"><span>Submit request</span>
<span>Request sent</span>
</button>
<div class="pp-site-request__toast" [class.pp-site-request__toast--on]="toast()" role="status"><span class="pp-site-ok pp-site-ok--in" aria-hidden="true"><svg ppIcon="check" /></span>Annual leave approved. 11 days left.</div>
</div>
</div>
</div>
<div class="pp-site-leave__main"><div class="pp-site-leave__card"><div class="pp-site-leave__top"><span class="pp-site-leave__title">Team calendar · December 2026</span>
<span class="pp-site-leave__note">Sample data</span>
</div>
<div class="pp-site-calendar"><div class="pp-site-calendar__grid" role="img" aria-label="December 2026 calendar with John Doe’s annual leave from 14 to 18 December, and public holidays on 16, 25 and 26 December">
  @for (dow of dows; track dow) { <span class="pp-site-calendar__dow">{{ dow }}</span> }
  @for (day of days; track day.n) {
    @if (day.blank) { <span class="pp-site-calendar__day pp-site-calendar__day--blank"></span> }
    @else {
      <span class="pp-site-calendar__day" [class.pp-site-calendar__day--weekend]="day.weekend" [class.pp-site-calendar__day--holiday]="day.holiday" [class.pp-site-calendar__day--team]="day.team" [class.pp-site-calendar__day--requested]="status() !== 'done' && mine(day.n)" [class.pp-site-calendar__day--approved]="approved() && mine(day.n)">
        @if (day.mine) { <span class="pp-site-calendar__layer pp-site-calendar__layer--requested"></span><span class="pp-site-calendar__layer pp-site-calendar__layer--approved"></span> }
        <span class="pp-site-calendar__num">{{ day.n }}</span>
        @if (day.mine) { <span class="pp-site-calendar__num pp-site-calendar__num--requested" aria-hidden="true">{{ day.n }}</span><span class="pp-site-calendar__num pp-site-calendar__num--approved" aria-hidden="true">{{ day.n }}</span> }
      </span>
    }
  }
</div>
<div class="pp-site-calendar__legend"><span class="pp-site-calendar__key"><span class="pp-site-calendar__swatch"></span>John Doe</span>
<span class="pp-site-calendar__key"><span class="pp-site-calendar__swatch pp-site-calendar__swatch--team"></span>Employee 2</span>
<span class="pp-site-calendar__key"><span class="pp-site-calendar__swatch pp-site-calendar__swatch--holiday"></span>Public holiday</span>
</div>
</div>
</div>
<div class="pp-site-leave__row"><div class="pp-site-leave__card"><div class="pp-site-leave__top"><span class="pp-site-leave__title">John Doe · Annual leave</span>
<span class="pp-site-state pp-site-state--end" role="status"><span class="pp-site-status pp-site-state__item" [class.pp-site-state__item--on]="status() === 'none'" [attr.aria-hidden]="status() === 'none' ? null : 'true'">No request</span>
<span class="pp-site-status pp-site-status--warning pp-site-state__item" [class.pp-site-state__item--on]="status() === 'wait'" [attr.aria-hidden]="status() === 'wait' ? null : 'true'">Waiting for approval</span>
<span class="pp-site-status pp-site-status--success pp-site-state__item" [class.pp-site-state__item--on]="status() === 'done'" [attr.aria-hidden]="status() === 'done' ? null : 'true'">Approved</span>
<span class="pp-site-status pp-site-status--brand pp-site-state__item" [class.pp-site-state__item--on]="status() === 'no'" [attr.aria-hidden]="status() === 'no' ? null : 'true'">Declined with a reason</span>
</span>
</div>
<div class="pp-site-approval"><p class="pp-site-approval__meta">14 to 18 Dec · 4 working days · Line manager approval</p>
<div class="pp-site-suggest pp-site-step" [class.pp-site-step--in]="nudge()"><span class="pp-site-suggest__icon" aria-hidden="true"><svg ppIcon="sparkles" /></span>
<span class="pp-site-suggest__text"><span class="pp-site-suggest__lead">Batsi.</span> Waiting 1 day. Reminder sent to the line manager.</span>
</div>
<div class="pp-site-approval__decide" [class.pp-site-approval__decide--done]="status() === 'done'"><button class="pp-button pp-button--primary pp-button--small" [class.pp-button--pressed]="approvePressed()" [disabled]="!canDecide()" type="button" (click)="approve()">Approve</button>
<button class="pp-button pp-button--default pp-button--small" [disabled]="!canDecide()" type="button" (click)="decline()">Decline</button>
<span class="pp-site-approval__accepted"><span class="pp-site-ok pp-site-ok--in" aria-hidden="true"><svg ppIcon="check" /></span>Approved by the line manager, 10:05</span>
</div>
</div>
</div>
<div class="pp-site-leave__card"><h3 class="pp-site-leave__title pp-site-leave__top">John Doe · Balances</h3>
<div class="pp-site-balance"><div class="pp-site-balance__line"><span>Annual leave</span>
<span class="pp-site-balance__num" [class.pp-site-balance__num--flash]="flash()"><span>{{ bal() }} days</span>
<span class="pp-site-balance__flash" aria-hidden="true">{{ bal() }} days</span>
</span>
<span class="pp-site-balance__bar" aria-hidden="true"><span class="pp-site-balance__fill" [style.--_fill]="bal() / 15"></span>
</span>
</div>
<div class="pp-site-balance__line"><span>Sick leave</span>
<span class="pp-site-balance__num"><span>28 days</span>
<span class="pp-site-balance__flash" aria-hidden="true">28 days</span>
</span>
<span class="pp-site-balance__note">36-month cycle</span>
</div>
<div class="pp-site-balance__line"><span>Family responsibility</span>
<span class="pp-site-balance__num"><span>3 days</span>
<span class="pp-site-balance__flash" aria-hidden="true">3 days</span>
</span>
</div>
</div>
</div>
</div>
<button class="pp-site-replay" type="button" (click)="play()"><svg ppIcon="rotate-ccw" />Play again</button>
</div>
</div>
<ul class="pp-site-caps"><li class="pp-site-caps__item" [ppSiteReveal]="0"><h3 class="pp-site-caps__title">Leave types set to the BCEA</h3>
<p class="pp-site-caps__text">Annual, sick, family responsibility and maternity leave. Company leave types added in settings.</p>
</li>
<li class="pp-site-caps__item" [ppSiteReveal]="1"><h3 class="pp-site-caps__title">Requests from a phone</h3>
<p class="pp-site-caps__text">Working days counted, with weekends and public holidays left out.</p>
</li>
<li class="pp-site-caps__item" [ppSiteReveal]="2"><h3 class="pp-site-caps__title">Approvals and reminders</h3>
<p class="pp-site-caps__text">The line manager approves or declines. Requests left waiting are followed up.</p>
<span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span>
</li>
<li class="pp-site-caps__item" [ppSiteReveal]="3"><h3 class="pp-site-caps__title">Balances and team calendar</h3>
<p class="pp-site-caps__text">Balances update on approval. The sick leave cycle is tracked over 36 months.</p>
</li>
</ul>
<a class="pp-link pp-link--standalone" href="#leave-more" [ppSiteReveal]="0"><span>Learn more about Leave Management</span>
<svg ppIcon="arrow-right" /></a>
</div>

  `,
  host: { 'id': 'leave', 'class': 'pp-site-section pp-site-section--cream', 'aria-labelledby': 'lld-h' },
})
export class PpSiteLandLeave {
  private readonly clock = inject(DemoClock);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  protected readonly days = DAYS;
  /** Each request field is waiting, being filled in ("on") or filled ("set"). The first frame is the finished demo, as in the kit's markup. */
  protected readonly fs = signal<Field[]>(['set', 'set', 'set']);
  protected readonly countOn = signal(true);
  protected readonly sent = signal(true);
  protected readonly pressing = signal(false);
  protected readonly toast = signal(true);
  protected readonly status = signal<'none' | 'wait' | 'done' | 'no'>('done');
  protected readonly nudge = signal(true);
  protected readonly canDecide = signal(true);
  protected readonly approvePressed = signal(false);
  protected readonly bal = signal(11);
  protected readonly flash = signal(true);
  /** John Doe's days that show as requested on the calendar (they appear 160ms apart). */
  private readonly asked = signal<ReadonlySet<number>>(new Set(JD));
  protected readonly approved = computed(() => this.status() === 'done');
  protected mine(n: number): boolean { return this.asked().has(n); }

  constructor() {
    afterNextRender(() => this.clock.onView(this.el.querySelector('.pp-site-leave')!, () => this.play(), 0.35));
  }

  private reset(): void {
    this.clock.stop();
    this.fs.set(['idle', 'idle', 'idle']); this.countOn.set(false); this.sent.set(false); this.pressing.set(false); this.toast.set(false);
    this.asked.set(new Set()); this.status.set('none'); this.nudge.set(false); this.canDecide.set(false); this.approvePressed.set(false);
    this.flash.set(false); this.bal.set(15);
  }

  private setField(i: number, f: Field): void { this.fs.update((a) => a.map((x, k) => (k === i ? f : x))); }

  private submitted(): void {
    this.sent.set(true);
    this.fs.set(['set', 'set', 'set']);
    this.countOn.set(true);
    JD.forEach((n, i) => this.clock.at(i * 160, () => this.asked.update((s) => new Set([...s, n]))));
    this.status.set('wait');
    this.canDecide.set(true);
  }

  protected submit(): void {
    if (this.sent()) return;
    this.clock.stop();
    this.submitted();
  }

  protected approve(): void {
    if (this.status() === 'done') return;
    const c = this.clock;
    c.stop();
    if (!this.sent()) { this.fs.set(['set', 'set', 'set']); this.countOn.set(true); this.sent.set(true); }
    this.asked.set(new Set(JD));
    this.status.set('done');
    this.nudge.set(true);
    // the balance counts down from 15 to 11, 220ms a day, then the toast shows
    let v = 15;
    const dn = (): void => {
      if (v <= 11) { this.toast.set(true); return; }
      v--;
      this.bal.set(v); this.flash.set(true);
      c.at(220, dn);
    };
    dn();
  }

  protected decline(): void {
    this.clock.stop();
    this.asked.set(new Set());
    this.status.set('no');
    this.canDecide.set(false);
  }

  /** John Doe fills the request on the phone, the days appear on the calendar, Batsi reminds the line manager, the line manager approves and the balance counts down to 11 days. */
  protected play(): void {
    const c = this.clock;
    this.reset();
    for (let i = 0; i < 3; i++) c.at(500 + i * 700, () => { if (i) this.setField(i - 1, 'set'); this.setField(i, 'on'); });
    c.at(2700, () => { this.setField(2, 'set'); this.countOn.set(true); });
    c.at(3700, () => { this.pressing.set(true); c.at(300, () => this.submitted()); });
    c.at(6000, () => this.nudge.set(true));
    c.at(7800, () => { this.approvePressed.set(true); c.at(400, () => this.approve()); });
  }

}
