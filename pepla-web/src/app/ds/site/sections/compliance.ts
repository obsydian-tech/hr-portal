import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { PpSiteReveal } from '../motion';
import { DemoClock } from '../demo-clock';
import { computed } from '@angular/core';

const STEPS = 11;
interface Watch { on: boolean; l0: boolean; l1: boolean; read: boolean; go: boolean; vals: number; sug: boolean; pressed: boolean; decided: boolean }
const BLANK: Watch = { on: false, l0: false, l1: false, read: false, go: false, vals: 0, sug: false, pressed: false, decided: false };
const DONE: Watch = { on: true, l0: true, l1: true, read: true, go: false, vals: 4, sug: true, pressed: false, decided: true };
/** The register's four rows; `d` is the days left on 3 November. */
const ROWS = [
  { name: 'John Doe · Forklift licence', sub: 'Warehouse · required for the role', d: 9 },
  { name: 'Employee 2 · First aid level 1', sub: 'Head office', d: 38 },
  { name: 'Employee 3 · Medical certificate', sub: 'Warehouse', d: 16 },
  { name: 'Employee 4 · Work permit', sub: 'Head office', d: 195 },
] as const;

/** The landing page Compliance Management section: the register's days count down from 3 Nov, reminders go out at 60, 30 and 7 days, John Doe's licence goes overdue, Batsi reads the renewal and Jane Smith accepts it. Spec: SITE-04, kit site-ledger, site-radar, site-watch. */
@Component({
  selector: 'section[ppSiteLandCompliance]',
  imports: [PpIcon, PpSiteReveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DemoClock],
  template: `
<div class="pp-site-radar" [class.pp-site-radar--overdue]="late()" aria-hidden="true"><span class="pp-site-radar__ax"></span>
<span class="pp-site-radar__ax pp-site-radar__ax--h"></span>
<i class="pp-site-radar__blip" style="--_x: 30%; --_y: 38%; --_d: .8s"></i><i class="pp-site-radar__blip" style="--_x: 64%; --_y: 30%; --_d: 2.1s"></i><i class="pp-site-radar__blip" style="--_x: 46%; --_y: 68%; --_d: 3.9s"></i><i class="pp-site-radar__blip pp-site-radar__blip--late" style="--_x: 70%; --_y: 62%"></i></div>
<div class="pp-site-wrap"><div class="pp-site-section__head"><div><p class="pp-site-eyebrow" [ppSiteReveal]="0">Compliance Management</p>
<h2 class="pp-site-section__title" id="lcd-h" [ppSiteReveal]="1">Every certificate tracked to its expiry date.</h2>
</div>
<p class="pp-site-section__lead" [ppSiteReveal]="2">Licences, certificates and permits are recorded against the role that needs them. Reminders go out at 60, 30 and 7 days. Anyone with an expired requirement is listed as not cleared to work.</p>
</div>
<div class="pp-site-watch" [ppSiteReveal]="2"><div class="pp-site-ledger" role="group" aria-label="Sample certificate register"><div class="pp-site-ledger__head"><span class="pp-site-ledger__title">Certificates and licences</span>
<span class="pp-site-ledger__today">Today · {{ 3 + k() }} Nov</span>
<span class="pp-site-ledger__note">Sample data</span>
</div>
<ul class="pp-site-ledger__list">
  @for (row of rows; track row.name; let ri = $index) {
    <li class="pp-site-ledger__row" [class.pp-site-ledger__row--renewed]="isRenewed(ri)" [class.pp-site-ledger__row--late]="isLate(ri)">
      <div><b class="pp-site-ledger__name">{{ row.name }}</b><span class="pp-site-ledger__sub">{{ row.sub }}</span></div>
      <span class="pp-site-status" [class]="'pp-site-status--' + chip(ri).tone">{{ chip(ri).text }}</span>
      <div class="pp-site-ledger__pips">Reminders
        @for (p of pips; track p) { <span class="pp-site-ledger__pip" [class.pp-site-ledger__pip--sent]="sentPip(ri, p)" [class.pp-site-ledger__pip--hit]="hit().has(ri + ':' + p)">{{ p }} days</span> }
      </div>
    </li>
  }
</ul>
</div>
<div class="pp-site-watch__side"><div class="pp-site-clear" [class.pp-site-clear--has]="late()" aria-live="polite"><div class="pp-site-clear__box"><h3 class="pp-site-clear__head"><svg ppIcon="shield" aria-hidden="true" />Not cleared to work<span class="pp-site-state pp-site-clear__count" role="status"><span class="pp-site-status pp-site-status--success pp-site-state__item" [class.pp-site-state__item--on]="!late()" [attr.aria-hidden]="late() ? 'true' : null">0</span>
<span class="pp-site-status pp-site-status--danger pp-site-state__item" [class.pp-site-state__item--on]="late()" [attr.aria-hidden]="late() ? null : 'true'">1</span>
</span>
</h3>
<div class="pp-site-clear__stage"><p class="pp-site-clear__empty"><svg ppIcon="check" aria-hidden="true" />Every employee is cleared to work.</p>
<div class="pp-site-clear__who"><span class="pp-site-clear__avatar" aria-hidden="true">JD</span>
<span>John Doe<small class="pp-site-clear__why">Forklift licence expired 2 days ago</small></span>
</div>
</div>
</div>
</div>
<div class="pp-site-watch__renew" [class.pp-site-watch__renew--on]="w().on" aria-live="polite"><span class="pp-site-watch__who"><svg ppIcon="sparkles" />Batsi</span>
<p class="pp-site-watch__idle">Watching expiry dates on 4 certificates.</p>
<p class="pp-site-watch__line pp-site-step" [class.pp-site-step--in]="w().l0"><svg ppIcon="check" /><span>Asked John Doe for the renewed forklift licence. Sent 09:00.</span>
</p>
<p class="pp-site-watch__line pp-site-step" [class.pp-site-step--in]="w().l1"><svg ppIcon="check" /><span>John Doe uploaded the renewed licence at 11:20.</span>
</p>
<div class="pp-site-read pp-site-step" [class.pp-site-step--in]="w().read"><div class="pp-site-read__row"><div class="pp-site-read__doc" [class.pp-site-read__doc--go]="w().go" aria-hidden="true"><span class="pp-site-read__scan"></span>
</div>
<div class="pp-site-read__fields"><div class="pp-site-read__field"><span class="pp-site-read__label">Holder</span>
<strong class="pp-site-read__value" [class.pp-site-read__value--in]="w().vals > 0">John Doe</strong></div>
<div class="pp-site-read__field"><span class="pp-site-read__label">Licence</span>
<strong class="pp-site-read__value" [class.pp-site-read__value--in]="w().vals > 1">Forklift operator</strong></div>
<div class="pp-site-read__field"><span class="pp-site-read__label">Issued</span>
<strong class="pp-site-read__value" [class.pp-site-read__value--in]="w().vals > 2">14 Nov 2026</strong></div>
<div class="pp-site-read__field"><span class="pp-site-read__label">Expires</span>
<strong class="pp-site-read__value" [class.pp-site-read__value--in]="w().vals > 3">13 Nov 2029</strong></div>
</div>
</div>
<div class="pp-site-read__suggest pp-site-step" [class.pp-site-step--in]="w().sug"><span class="pp-site-read__who"><svg ppIcon="sparkles" />Batsi</span>
<span>Suggests <strong>Matches</strong></span>
<span class="pp-site-read__decide" [class.pp-site-read__decide--done]="w().decided"><button class="pp-button pp-button--primary pp-button--small" [class.pp-button--pressed]="w().pressed" type="button" (click)="accept()">Accept certificate</button>
<span class="pp-site-read__accepted">Accepted by Jane Smith, 11:24</span>
</span>
<span class="pp-site-read__why">New expiry date read from the licence: 13 Nov 2029.</span>
</div>
</div>
</div>
<button class="pp-site-replay" type="button" (click)="play()"><svg ppIcon="rotate-ccw" />Play again</button>
</div>
</div>
<ul class="pp-site-caps"><li class="pp-site-caps__item" [ppSiteReveal]="0"><h3 class="pp-site-caps__title">Requirements per role</h3>
<p class="pp-site-caps__text">Each role lists the licences, certificates and permits it needs. New employees inherit them on day one.</p>
</li>
<li class="pp-site-caps__item" [ppSiteReveal]="1"><h3 class="pp-site-caps__title">Reminders at 60, 30 and 7 days</h3>
<p class="pp-site-caps__text">Sent to the employee and the manager before anything expires. Overdue items go to HR.</p>
<span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span>
</li>
<li class="pp-site-caps__item" [ppSiteReveal]="2"><h3 class="pp-site-caps__title">Renewals read</h3>
<p class="pp-site-caps__text">Batsi reads the renewed certificate and suggests the new expiry date. HR accepts it.</p>
<span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span>
</li>
<li class="pp-site-caps__item" [ppSiteReveal]="3"><h3 class="pp-site-caps__title">Not cleared to work</h3>
<p class="pp-site-caps__text">One list of everyone with an expired requirement, updated the moment a renewal is accepted.</p>
</li>
</ul>
<a class="pp-link pp-link--standalone" href="#compliance-more" [ppSiteReveal]="0"><span>Learn more about Compliance Management</span>
<svg ppIcon="arrow-right" /></a>
</div>

  `,
  host: { 'id': 'compliance', 'class': 'pp-site-section pp-site-section--clip', 'aria-labelledby': 'lcd-h' },
})
export class PpSiteLandCompliance {
  private readonly clock = inject(DemoClock);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly rows = ROWS;
  protected readonly pips = [60, 30, 7];
  /** Days since 3 November (0 to 11). The first frame is the finished demo, as in the kit's markup. */
  protected readonly k = signal(STEPS);
  protected readonly renewed = signal(true);
  protected readonly w = signal<Watch>({ ...DONE });
  /** Reminder pips that just lit (a short pulse, 500ms). */
  protected readonly hit = signal<ReadonlySet<string>>(new Set());
  protected readonly late = computed(() => !this.renewed() && this.days(0) < 0);

  constructor() {
    afterNextRender(() => this.clock.onView(this.el.querySelector('.pp-site-watch')!, () => this.play(), 0.35));
  }

  private days(i: number): number { return ROWS[i].d - this.k(); }
  protected isRenewed(i: number): boolean { return i === 0 && this.renewed(); }
  protected isLate(i: number): boolean { return !this.isRenewed(i) && this.days(i) < 0; }
  protected sentPip(i: number, p: number): boolean { return !this.isRenewed(i) && this.days(i) <= p; }
  /** The days-left chip: grey-green past 30 days, amber to 30, red once overdue. */
  protected chip(i: number): { tone: string; text: string } {
    if (this.isRenewed(i)) return { tone: 'success', text: '1,095 days' };
    const d = this.days(i);
    if (d < 0) return { tone: 'danger', text: `${-d} ${d === -1 ? 'day' : 'days'} overdue` };
    if (d === 0) return { tone: 'warning', text: 'Expires today' };
    return { tone: d <= 30 ? 'warning' : 'success', text: `${d} ${d === 1 ? 'day' : 'days'}` };
  }

  /** Light the reminder pips in `keys` for 500ms each; every pip ends its own pulse on its own timer, as the kit does. */
  private pulse(keys: readonly string[]): void {
    if (this.clock.reduce || !keys.length) return;
    this.hit.update((h) => new Set([...h, ...keys]));
    for (const key of keys) this.clock.at(500, () => this.hit.update((h) => { const next = new Set(h); next.delete(key); return next; }));
  }

  private day(n: number): void {
    const before = this.k();
    this.k.set(n);
    const lit: string[] = [];
    ROWS.forEach((r, i) => this.pips.forEach((p) => { if (r.d - before > p && r.d - n <= p) lit.push(`${i}:${p}`); }));
    this.pulse(lit);
  }

  private set(p: Partial<Watch>): void { this.w.update((v) => ({ ...v, ...p })); }

  /** Days count down from 3 Nov, reminders go out at 60, 30 and 7 days, John Doe's licence goes overdue, Batsi reads the renewal, Jane Smith accepts it. */
  protected play(): void {
    const c = this.clock;
    c.stop();
    this.renewed.set(false); this.w.set({ ...BLANK }); this.hit.set(new Set()); this.k.set(0);
    // The pips already on at day 0 pulse once as the register resets, as in the kit.
    const lit0: string[] = [];
    ROWS.forEach((r, i) => this.pips.forEach((p) => { if (r.d <= p) lit0.push(`${i}:${p}`); }));
    this.pulse(lit0);
    let t = 700;
    for (let n = 1; n <= STEPS; n++) { c.at(t, () => this.day(n)); t += n >= 9 ? 650 : 340; }
    c.at(t + 500, () => this.set({ on: true, l0: true }));
    c.at(t + 1500, () => this.set({ l1: true }));
    c.at(t + 2300, () => this.set({ read: true, go: true }));
    for (let i = 0; i < 4; i++) c.at(t + 3000 + i * 320, () => this.set({ vals: i + 1 }));
    c.at(t + 4600, () => this.set({ sug: true }));
    c.at(t + 6300, () => { this.set({ pressed: true }); c.at(400, () => this.accept()); });
  }

  /** Accepting the renewal (by hand or after the press) finishes the demo and clears John Doe. */
  protected accept(): void {
    if (this.w().decided) return;
    this.clock.stop();
    // The press and the document scan stay as they were: only the steps still to come are finished.
    this.w.update((v) => ({ ...DONE, go: v.go, pressed: v.pressed }));
    this.renewed.set(true);
  }

}
