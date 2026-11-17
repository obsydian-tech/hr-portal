import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { PpSiteReveal } from '../motion';
import { DOCUMENT } from '@angular/common';
import { DemoClock } from '../demo-clock';

const STEPS = 6;
interface Read { go: boolean; vals: number; suggest: boolean; pressed: boolean; decided: boolean; follow: boolean }
const BLANK: Read = { go: false, vals: 0, suggest: false, pressed: false, decided: false, follow: false };
/** The "now" line under the progress bar for each step (the kit's data-now words). */
const NOW = ['Offer accepted · onboarding opened', 'Documents requested · 3 of 4 received', 'ID document matches · accepted by Jane Smith', 'Contract signed · copy stored', 'Laptop and access ready · IT confirmed', 'Day one · record active'];

/** The landing page Onboarding and Offboarding section: the sticky John Doe card follows the six steps as they scroll past; on the ID document step Batsi reads the document, suggests Matches and Jane Smith accepts it. Spec: SITE-03, kit site-story. */
@Component({
  selector: 'section[ppSiteLandOnboarding]',
  imports: [PpIcon, PpSiteReveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DemoClock],
  template: `
<div class="pp-site-rings" aria-hidden="true"><div class="pp-site-rings__group"><span class="pp-site-rings__circle pp-site-rings__circle--coral" style="--_x: 230; --_r: 200"></span>
<span class="pp-site-rings__circle pp-site-rings__circle--violet" style="--_x: 300; --_r: 200"></span>
<span class="pp-site-rings__circle pp-site-rings__circle--mint" style="--_x: 370; --_r: 200"></span>
</div>
<div class="pp-site-rings__group pp-site-rings__group--outer"><span class="pp-site-rings__circle pp-site-rings__circle--dot" style="--_x: 300; --_r: 280"></span>
</div>
</div>
<div class="pp-site-wrap"><div class="pp-site-section__head"><div><p class="pp-site-eyebrow" [ppSiteReveal]="0">Onboarding and Offboarding</p>
<h2 class="pp-site-section__title" id="lsd-h" [ppSiteReveal]="1">Offer accepted to day one, in one record.</h2>
</div>
<p class="pp-site-section__lead" [ppSiteReveal]="2">Every new employee moves through documents, checks, contract and equipment. Each step has an owner and a due date.</p>
</div>
<div class="pp-site-story"><div class="pp-site-story__pin"><div class="pp-site-person" aria-live="polite"><div class="pp-site-person__head"><span class="pp-avatar pp-avatar--violet pp-avatar--large" aria-hidden="true">JD</span>
<div><span class="pp-site-person__name">John Doe</span>
<span class="pp-site-person__role">Sales Consultant · starts 1 December</span>
</div>
<span class="pp-site-state"><span class="pp-site-status pp-site-status--brand pp-site-state__item" [class.pp-site-state__item--on]="!active()" [attr.aria-hidden]="active() ? 'true' : null">Onboarding</span>
<span class="pp-site-status pp-site-status--brand pp-site-state__item" [class.pp-site-state__item--on]="active()" [attr.aria-hidden]="active() ? null : 'true'">Active</span>
</span>
</div>
<div><div class="pp-site-person__meter"><span class="pp-site-person__fill" [style.--_p]="progress()"></span>
</div>
<div class="pp-site-person__count"><span>Onboarding</span>
<span>{{ count() }}</span>
</div>
</div>
<div class="pp-site-person__now">{{ now() }}</div>
<div class="pp-site-person__views"><div class="pp-site-person__view" [class.pp-site-person__view--on]="view() === 0" [attr.aria-hidden]="view() === 0 ? null : 'true'" [attr.inert]="view() === 0 ? null : ''"><p class="pp-site-person__label">Offer</p>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>Offer letter · Sales Consultant</span>
<span class="pp-site-status pp-site-status--success">Signed</span>
</div>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>Start date</span>
<span class="pp-site-status pp-site-status--brand">Monday, 1 December</span>
</div>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>Onboarding record</span>
<span class="pp-site-status pp-site-status--success">Opened</span>
</div>
</div>
<div class="pp-site-person__view" [class.pp-site-person__view--on]="view() === 1" [attr.aria-hidden]="view() === 1 ? null : 'true'" [attr.inert]="view() === 1 ? null : ''"><p class="pp-site-person__label">Documents from John Doe</p>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>POPIA consent</span>
<span class="pp-site-status pp-site-status--success">Given</span>
</div>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>ID document</span>
<span class="pp-site-status pp-site-status--brand">Received</span>
</div>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>Bank letter</span>
<span class="pp-site-status pp-site-status--brand">Received</span>
</div>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>Tax number</span>
<span class="pp-site-status pp-site-status--brand">Received</span>
</div>
<div class="pp-site-person__row"><span>UIF reference number</span>
<span class="pp-site-status pp-site-status--danger">Waiting</span>
</div>
</div>
<div class="pp-site-person__view" [class.pp-site-person__view--on]="view() === 2" [attr.aria-hidden]="view() === 2 ? null : 'true'" [attr.inert]="view() === 2 ? null : ''"><p class="pp-site-person__label">ID document</p>
<div class="pp-site-read"><div class="pp-site-read__row"><div class="pp-site-read__doc" [class.pp-site-read__doc--go]="r().go" aria-hidden="true"><span class="pp-site-read__scan"></span>
</div>
<div class="pp-site-read__fields"><div class="pp-site-read__field"><span class="pp-site-read__label">Name</span>
<strong class="pp-site-read__value" [class.pp-site-read__value--in]="r().vals > 0">John Doe</strong></div>
<div class="pp-site-read__field"><span class="pp-site-read__label">ID number</span>
<strong class="pp-site-read__value" [class.pp-site-read__value--in]="r().vals > 1">Hidden · ends 0861</strong></div>
<div class="pp-site-read__field"><span class="pp-site-read__label">Date of birth</span>
<strong class="pp-site-read__value" [class.pp-site-read__value--in]="r().vals > 2">Matches ID</strong></div>
<div class="pp-site-read__field"><span class="pp-site-read__label">Citizenship</span>
<strong class="pp-site-read__value" [class.pp-site-read__value--in]="r().vals > 3">South African</strong></div>
</div>
</div>
<div class="pp-site-read__suggest pp-site-step" [class.pp-site-step--in]="r().suggest"><span class="pp-site-read__who"><svg ppIcon="sparkles" />Batsi</span>
<span>Suggests <strong>Matches</strong> · details agree with the record</span>
<span class="pp-site-read__decide" [class.pp-site-read__decide--done]="r().decided"><button class="pp-button pp-button--primary pp-button--small" [class.pp-button--pressed]="r().pressed" type="button" (click)="acceptNow()">Accept document</button>
<span class="pp-site-read__accepted">Accepted by Jane Smith, 09:42</span>
</span>
</div>
<div class="pp-site-person__follow pp-site-step" [class.pp-site-step--in]="r().follow"><svg ppIcon="sparkles" /><span>UIF reference number missing. Batsi asked John Doe for it at 09:00.</span>
</div>
</div>
</div>
<div class="pp-site-person__view" [class.pp-site-person__view--on]="view() === 3" [attr.aria-hidden]="view() === 3 ? null : 'true'" [attr.inert]="view() === 3 ? null : ''"><p class="pp-site-person__label">Contract</p>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>Employment contract</span>
<span class="pp-site-status pp-site-status--success">Signed</span>
</div>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>Signed copy</span>
<span class="pp-site-status pp-site-status--brand">Stored on the record</span>
</div>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>Probation</span>
<span class="pp-site-status pp-site-status--brand">Ends 31 May</span>
</div>
</div>
<div class="pp-site-person__view" [class.pp-site-person__view--on]="view() === 4" [attr.aria-hidden]="view() === 4 ? null : 'true'" [attr.inert]="view() === 4 ? null : ''"><p class="pp-site-person__label">Laptop and access</p>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>Laptop</span>
<span class="pp-site-status pp-site-status--success">Ready</span>
</div>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>Email account</span>
<span class="pp-site-status pp-site-status--success">Ready</span>
</div>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>System access</span>
<span class="pp-site-status pp-site-status--success">Ready</span>
</div>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>IT request</span>
<span class="pp-site-status pp-site-status--brand">Closed by IT</span>
</div>
</div>
<div class="pp-site-person__view" [class.pp-site-person__view--on]="view() === 5" [attr.aria-hidden]="view() === 5 ? null : 'true'" [attr.inert]="view() === 5 ? null : ''"><p class="pp-site-person__label">Day one</p>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>First-day checklist</span>
<span class="pp-site-status pp-site-status--brand">Sent to manager</span>
</div>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>Welcome email</span>
<span class="pp-site-status pp-site-status--success">Sent</span>
</div>
<div class="pp-site-person__row"><span class="pp-site-ok pp-site-ok--in"><svg ppIcon="check" /></span>
<span>Employee record</span>
<span class="pp-site-status pp-site-status--success">Active</span>
</div>
</div>
</div>
</div>
</div>
<ol class="pp-site-story__steps"><li class="pp-site-story__step" [class.pp-site-story__step--done]="idx() > 0" [class.pp-site-story__step--active]="idx() === 0" data-now="Offer accepted · onboarding opened"><span class="pp-site-story__n" aria-hidden="true"><span class="pp-site-story__digit">1</span>
<span class="pp-site-story__digit pp-site-story__digit--on">1</span>
</span>
<div><h3 class="pp-site-story__title">Offer accepted</h3>
<p class="pp-site-story__text">Signed offer returns to the record. Onboarding opens on its own and Jane Smith is notified.</p>
</div>
</li>
<li class="pp-site-story__step" [class.pp-site-story__step--done]="idx() > 1" [class.pp-site-story__step--active]="idx() === 1" data-now="Documents requested · 3 of 4 received"><span class="pp-site-story__n" aria-hidden="true"><span class="pp-site-story__digit">2</span>
<span class="pp-site-story__digit pp-site-story__digit--on">2</span>
</span>
<div><h3 class="pp-site-story__title">Documents in</h3>
<p class="pp-site-story__text">John Doe gets an email link, gives POPIA consent and uploads from a phone: PDF, JPG or PNG, up to 5 MB.</p>
</div>
</li>
<li class="pp-site-story__step pp-site-story__step--key" [class.pp-site-story__step--done]="idx() > 2" [class.pp-site-story__step--active]="idx() === 2" data-now="ID document matches · accepted by Jane Smith"><span class="pp-site-story__n" aria-hidden="true"><span class="pp-site-story__digit">3</span>
<span class="pp-site-story__digit pp-site-story__digit--on">3</span>
</span>
<div><h3 class="pp-site-story__title">Batsi reads every document. <em class="pp-site-story__em">HR makes every decision.</em></h3>
<p class="pp-site-story__text">Batsi reads each document, fills the fields and suggests Matches or Needs a look. Jane Smith accepts it or asks for a new one. Missing documents are followed up.</p>
<span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span>
</div>
</li>
<li class="pp-site-story__step" [class.pp-site-story__step--done]="idx() > 3" [class.pp-site-story__step--active]="idx() === 3" data-now="Contract signed · copy stored"><span class="pp-site-story__n" aria-hidden="true"><span class="pp-site-story__digit">4</span>
<span class="pp-site-story__digit pp-site-story__digit--on">4</span>
</span>
<div><h3 class="pp-site-story__title">Contract signed</h3>
<p class="pp-site-story__text">Contract generated from the company template and signed electronically.</p>
</div>
</li>
<li class="pp-site-story__step" [class.pp-site-story__step--done]="idx() > 4" [class.pp-site-story__step--active]="idx() === 4" data-now="Laptop and access ready · IT confirmed"><span class="pp-site-story__n" aria-hidden="true"><span class="pp-site-story__digit">5</span>
<span class="pp-site-story__digit pp-site-story__digit--on">5</span>
</span>
<div><h3 class="pp-site-story__title">Laptop and access</h3>
<p class="pp-site-story__text">Laptop, email and system access requested from IT with a due date.</p>
</div>
</li>
<li class="pp-site-story__step" [class.pp-site-story__step--done]="idx() > 5" [class.pp-site-story__step--active]="idx() === 5" data-now="Day one · record active"><span class="pp-site-story__n" aria-hidden="true"><span class="pp-site-story__digit">6</span>
<span class="pp-site-story__digit pp-site-story__digit--on">6</span>
</span>
<div><h3 class="pp-site-story__title">Day one</h3>
<p class="pp-site-story__text">The manager gets the first-day checklist. Probation dates are set on the record.</p>
</div>
</li>
</ol></div>
<div class="pp-site-offboard" [ppSiteReveal]="0"><h3 class="pp-site-offboard__title">Offboarding</h3>
<p class="pp-site-offboard__text">Every exit recorded the same way: last working day, access removed, equipment returned and final documents stored.</p>
<ul class="pp-site-offboard__chips"><li class="pp-site-offboard__chip">Exit date</li>
<li class="pp-site-offboard__chip">Access removed</li>
<li class="pp-site-offboard__chip">Equipment returned</li>
<li class="pp-site-offboard__chip">Exit record</li>
</ul>
</div>
<a class="pp-link pp-link--standalone" href="#onboarding-more" [ppSiteReveal]="0"><span>Learn more about Onboarding and Offboarding</span>
<svg ppIcon="arrow-right" /></a>
</div>

  `,
  host: { '[attr.data-site-live]': 'live() ? "" : null', 'id': 'onboarding', 'class': 'pp-site-section pp-site-section--clip', 'aria-labelledby': 'lsd-h' },
})
export class PpSiteLandOnboarding {
  private readonly clock = inject(DemoClock);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly win = inject(DOCUMENT).defaultView;
  private readonly destroyRef = inject(DestroyRef);
  /** The step whose top is above 55% of the window is the current one; -1 before the first. */
  protected readonly idx = signal(-1);
  protected readonly live = signal(false);
  protected readonly view = computed(() => Math.max(0, this.idx()));
  protected readonly active = computed(() => this.idx() === STEPS - 1);
  protected readonly progress = computed(() => String(Math.max(0, this.idx() + 1) / STEPS));
  protected readonly count = computed(() => `${Math.max(0, this.idx() + 1)} of ${STEPS}`);
  protected readonly now = computed(() => (this.idx() >= 0 ? NOW[this.idx()] : 'Waiting for the signed offer'));
  /** The ID document read (step 3): fields fill from 0.9s, 0.35s apart; Batsi suggests at 2.5s; Accept is pressed at 4.2s; the follow-up shows at 5s. */
  protected readonly r = signal<Read>({ ...BLANK });

  constructor() {
    afterNextRender(() => {
      const win = this.win;
      if (!win) return;
      this.live.set(true);
      const onScroll = (): void => this.scrolled();
      win.addEventListener('scroll', onScroll, { passive: true });
      this.destroyRef.onDestroy(() => win.removeEventListener('scroll', onScroll));
      this.scrolled();
    });
  }

  private scrolled(): void {
    const win = this.win;
    if (!win) return;
    const mid = win.innerHeight * 0.55;
    let idx = -1;
    this.el.querySelectorAll('.pp-site-story__step').forEach((s, i) => { if (s.getBoundingClientRect().top < mid) idx = i; });
    if (idx === this.idx()) return;
    this.idx.set(idx);
    if (Math.max(0, idx) === 2) this.read();
  }

  private read(): void {
    const c = this.clock;
    c.stop();
    this.r.set({ ...BLANK });
    const set = (p: Partial<Read>): void => this.r.update((v) => ({ ...v, ...p }));
    c.at(200, () => set({ go: true }));
    for (let i = 0; i < 4; i++) c.at(900 + i * 350, () => set({ vals: i + 1 }));
    c.at(2500, () => set({ suggest: true }));
    c.at(4200, () => { set({ pressed: true }); c.at(400, () => set({ decided: true })); });
    c.at(5000, () => set({ follow: true }));
  }

  /** Pressing Accept by hand finishes the read at once. */
  protected acceptNow(): void { this.clock.stop(); this.r.set({ go: true, vals: 4, suggest: true, pressed: false, decided: true, follow: true }); }

}
