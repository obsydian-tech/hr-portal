import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { PpSiteReveal } from '../motion';
import { DemoClock } from '../demo-clock';

const NOTE = 'Each Show is logged. Values hide again after 2 minutes.';
interface Row { time: string; agent: boolean; who: string; what: string }
interface AuditRow extends Row { id: number; fresh: boolean; waiting: boolean }
/** The audit log's eight lines, word for word from the kit. */
const ROWS: readonly Row[] = [
  { time: '09:00', agent: true, who: 'Batsi', what: 'Asked John Doe for his UIF reference number' },
  { time: '09:12', agent: false, who: 'John Doe', what: 'Gave POPIA consent' },
  { time: '09:14', agent: false, who: 'John Doe', what: 'Uploaded ID document' },
  { time: '09:15', agent: true, who: 'Batsi', what: 'Read ID document, suggested Matches' },
  { time: '09:42', agent: false, who: 'Jane Smith', what: 'Accepted ID document' },
  { time: '09:43', agent: true, who: 'Batsi', what: 'Drafted a reminder to Candidate 3' },
  { time: '09:44', agent: false, who: 'Jane Smith', what: 'Approved and sent the reminder to Candidate 3' },
  { time: '09:45', agent: false, who: 'Jane Smith', what: 'Viewed John Doe’s ID number' },
];

/** The landing page Trust and POPIA section: audit lines arrive with Agent and Person tags, Batsi's draft waits for approval, Show reveals the ID number and logs it, then it hides again. Spec: SITE-04, kit site-trust, site-audit, site-hidden, site-residency. */
@Component({
  selector: 'section[ppSiteLandTrust]',
  imports: [PpIcon, PpSiteReveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DemoClock],
  template: `
<div class="pp-site-wrap"><div class="pp-site-section__head"><div><p class="pp-site-eyebrow" [ppSiteReveal]="0">Trust and POPIA</p>
<h2 class="pp-site-section__title" id="trust-t" [ppSiteReveal]="1">Every action approved. Every step recorded.</h2>
</div>
<p class="pp-site-section__lead" [ppSiteReveal]="2">Batsi suggests and drafts. HR approves before anything is sent or saved. Each step goes into the audit log with a name, a time and whether a person or Batsi did it. All data stays in South Africa.</p>
</div>
<div class="pp-site-trust" [ppSiteReveal]="2"><div class="pp-site-audit pp-site-audit--card" role="group" aria-label="Sample audit log"><div class="pp-site-audit__head"><span class="pp-site-audit__title">Audit log · John Doe</span>
<span class="pp-site-audit__note">Sample data</span>
</div>
<ol class="pp-site-audit__list" aria-live="polite">
  @for (r of rows(); track r.id) {
    <li class="pp-site-audit__row" [class.pp-site-audit__row--new]="r.fresh" [class.pp-site-audit__row--waiting]="r.waiting">
      <time class="pp-site-audit__time">{{ r.time }}</time><span class="pp-site-who" [class.pp-site-who--agent]="r.agent" [class.pp-site-who--person]="!r.agent"><span class="pp-site-who__kind">{{ r.agent ? 'Agent' : 'Person' }}</span>{{ r.who }}</span>
      <span class="pp-site-audit__what">{{ r.what }}@if (r.waiting) { <span class="pp-site-status pp-site-status--warning">Waiting for approval</span><button class="pp-button pp-button--primary pp-button--small" [class.pp-button--pressed]="approvePressed()" type="button" (click)="approveNow()">Approve</button> }</span>
    </li>
  }
</ol><div class="pp-site-audit__foot"><span>Every entry kept with a name and a time</span>
<span class="pp-site-audit__export"><svg ppIcon="download" />Export to CSV</span>
</div>
</div>
<div class="pp-site-trust__side"><div class="pp-site-hidden pp-site-hidden--card"><h3 class="pp-site-hidden__title"><svg ppIcon="lock" />Personal data, hidden</h3>
<div class="pp-site-hidden__row"><span class="pp-site-hidden__label">ID number</span>
<span class="pp-site-hidden__value" [class.pp-site-hidden__value--shown]="shown()"><span class="pp-site-hidden__copy" [attr.aria-hidden]="shown()">•••••• ••• 0861</span>
<span class="pp-site-hidden__copy pp-site-hidden__copy--shown" [attr.aria-hidden]="!shown()">900101 500 0861</span>
</span>
<button class="pp-button pp-button--default pp-button--small" [class.pp-button--pressed]="showPressed()" type="button" (click)="toggle()">{{ shown() ? 'Hide' : 'Show' }}</button>
</div>
<div class="pp-site-hidden__row"><span class="pp-site-hidden__label">Bank account</span>
<span class="pp-site-hidden__value"><span class="pp-site-hidden__copy">•••• 4417</span>
</span>
</div>
<div class="pp-site-hidden__row"><span class="pp-site-hidden__label">Salary</span>
<span class="pp-site-hidden__value"><span class="pp-site-hidden__copy">R •• •••</span>
</span>
</div>
<p class="pp-site-hidden__note" aria-live="polite">{{ note() }}</p>
</div>
<div class="pp-site-residency pp-site-residency--card"><h3 class="pp-site-residency__title"><svg ppIcon="map-pin" />Where the data is kept</h3>
<div class="pp-site-residency__pin"><span class="pp-site-residency__dot" aria-hidden="true"></span>South Africa</div>
<p class="pp-site-residency__text">Employee records, documents and audit history are stored and processed in South Africa.</p>
</div>
<button class="pp-site-trust__again" type="button" (click)="play()"><svg ppIcon="rotate-ccw" />Play again</button>
</div>
</div>
<ul class="pp-site-caps"><li class="pp-site-caps__item" [ppSiteReveal]="0"><h3 class="pp-site-caps__title">HR approves every action</h3>
<p class="pp-site-caps__text">Batsi suggests, drafts and reminds. Nothing is sent, accepted or changed until HR approves it.</p>
<span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span>
</li>
<li class="pp-site-caps__item" [ppSiteReveal]="1"><h3 class="pp-site-caps__title">Full audit trail</h3>
<p class="pp-site-caps__text">Every upload, check, approval and view, with who did it and when. Exported for an audit in one step.</p>
</li>
<li class="pp-site-caps__item" [ppSiteReveal]="2"><h3 class="pp-site-caps__title">Hidden personal data</h3>
<p class="pp-site-caps__text">ID, bank and salary details hidden by default. Each Show is logged and hides again.</p>
</li>
<li class="pp-site-caps__item" [ppSiteReveal]="3"><h3 class="pp-site-caps__title">POPIA and data in South Africa</h3>
<p class="pp-site-caps__text">Consent recorded before any document is collected. All data stays in South Africa.</p>
</li>
</ul>
<a class="pp-link pp-link--standalone" href="#trust-more" [ppSiteReveal]="0"><span>Learn more about security and POPIA</span>
<svg ppIcon="arrow-right" /></a>
</div>

  `,
  host: { '[attr.data-site-live]': 'live() ? "" : null', 'data-live': '', 'id': 'trust', 'class': 'pp-site-section pp-site-section--violet-fade', 'aria-labelledby': 'trust-t' },
})
export class PpSiteLandTrust {
  private readonly clock = inject(DemoClock);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** The first frame holds every row, as the kit's markup does; the demo then takes them out and adds them back one by one. */
  protected readonly rows = signal<AuditRow[]>(ROWS.map((r, i) => ({ ...r, id: i, fresh: false, waiting: false })));
  protected readonly shown = signal(false);
  protected readonly note = signal(`Hidden again. ${NOTE}`);
  protected readonly showPressed = signal(false);
  protected readonly approvePressed = signal(false);
  protected readonly live = signal(false);
  private nextId = 100;
  private pending = 0;

  constructor() {
    afterNextRender(() => { this.live.set(true); this.clock.onView(this.el, () => this.play(), 0.35); });
  }

  private add(tpl: Row, extra: Partial<AuditRow> = {}): number {
    const id = this.nextId++;
    this.rows.update((l) => [...l, { ...tpl, id, fresh: true, waiting: false, ...extra }]);
    return id;
  }

  /** Jane Smith approves Batsi's draft: the waiting row becomes the draft line and the approval is logged. */
  protected approveNow(): void {
    const p = this.pending;
    if (!this.rows().some((r) => r.id === p && r.waiting)) return;
    this.clock.stop();
    this.finishApproval();
  }
  private finishApproval(): void {
    const p = this.pending;
    if (!this.rows().some((r) => r.id === p && r.waiting)) return;
    this.rows.update((l) => l.map((r) => (r.id === p ? { ...r, waiting: false } : r)));
    this.add(ROWS[6]);
  }

  private reveal(): void {
    if (this.shown()) return;
    this.shown.set(true);
    this.note.set('Shown to Jane Smith. Logged at 09:45.');
    this.add(ROWS[7]);
    this.clock.at(2600, () => this.hide());
  }
  private hide(): void { this.shown.set(false); this.note.set(`Hidden again. ${NOTE}`); }

  /** The Show button: reveals the ID number (and logs it), or hides it again. */
  protected toggle(): void {
    if (this.shown()) { this.clock.stop(); this.hide(); return; }
    this.reveal();
  }

  /** Audit rows arrive 650ms apart, Batsi's draft waits for approval, Jane Smith approves, then Show reveals the ID number for 2.6s. */
  protected play(): void {
    const c = this.clock;
    c.stop();
    this.rows.set([]); this.pending = -1;
    this.shown.set(false); this.showPressed.set(false); this.approvePressed.set(false); this.note.set(NOTE);
    ROWS.slice(0, 5).forEach((r, i) => c.at(400 + i * 650, () => this.add(r)));
    const t = 400 + 5 * 650;
    c.at(t, () => { this.pending = this.add(ROWS[5], { waiting: true }); });
    c.at(t + 2200, () => { this.approvePressed.set(true); c.at(400, () => this.finishApproval()); });
    c.at(t + 4000, () => { this.showPressed.set(true); c.at(400, () => this.reveal()); });
  }

}
