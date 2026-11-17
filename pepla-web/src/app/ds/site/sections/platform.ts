import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { DemoClock } from '../demo-clock';
import { PpSiteReveal } from '../motion';
import type { IconName } from '../../core/icon.registry';

type Mod = 'rec' | 'onb' | 'leave' | 'cmp';
interface ModState { on: boolean; nav: boolean; task: boolean; press: boolean; fresh: boolean }
interface ModInfo { k: Mod; label: string; nav: string; icon: IconName; module: string; task: string; chip?: { tone: string; text: string } }
/** The four switchable modules, with the words the kit's settings card, sidebar and Today list use. */
const MODS: readonly ModInfo[] = [
  { k: 'rec', label: 'Recruitment', nav: 'Recruitment', icon: 'user-plus', module: 'Recruitment', task: 'Candidate 3 has not replied for 2 days', chip: { tone: 'brand', text: 'Reminder drafted' } },
  { k: 'onb', label: 'Onboarding and Offboarding', nav: 'Onboarding', icon: 'rocket', module: 'Onboarding', task: 'John Doe: 2 documents left to upload' },
  { k: 'leave', label: 'Leave Management', nav: 'Leave', icon: 'calendar-days', module: 'Leave Management', task: '1 leave request to approve', chip: { tone: 'warning', text: 'Waiting for approval' } },
  { k: 'cmp', label: 'Compliance Management', nav: 'Compliance', icon: 'scale', module: 'Compliance Management', task: 'John Doe: forklift licence expires in 9 days', chip: { tone: 'warning', text: 'Due soon' } },
];
const ALL_ON = (): Record<Mod, ModState> => ({ rec: { on: true, nav: true, task: true, press: false, fresh: false }, onb: { on: true, nav: true, task: true, press: false, fresh: false }, leave: { on: true, nav: true, task: true, press: false, fresh: false }, cmp: { on: true, nav: true, task: true, press: false, fresh: false } });
const ALL_OFF = (): Record<Mod, ModState> => ({ rec: { on: false, nav: false, task: false, press: false, fresh: false }, onb: { on: false, nav: false, task: false, press: false, fresh: false }, leave: { on: false, nav: false, task: false, press: false, fresh: false }, cmp: { on: false, nav: false, task: false, press: false, fresh: false } });

/**
 * The landing page's Platform section: the settings card switches modules on one after another (1.1s apart) and the sample app beside it
 * gains a sidebar item and a Today task for each; a visitor can flip a switch too. "Play again" restarts it. Words and timings are the kit's.
 * Spec: SITE-04, kit: project/components/site/site-platform.md, site-app.md, site-modules.md
 */
@Component({
  selector: 'section[ppSiteLandPlatform]',
  imports: [PpIcon, PpSiteReveal],
  providers: [DemoClock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-site-wrap">
  <div class="pp-site-section__head">
    <div>
      <p class="pp-site-eyebrow" [ppSiteReveal]="0">Platform</p>
      <h2 class="pp-site-section__title" id="platform-title" [ppSiteReveal]="1">One app. Modules switched on per company.</h2>
    </div>
    <p class="pp-site-section__lead" [ppSiteReveal]="2">Naleko People is one app with one sign-in. Naleko switches on the modules each company needs after the onboarding call. The sidebar, the Today list and each role’s access follow those settings.</p>
  </div>
  <div class="pp-site-platform" [ppSiteReveal]="2">
    <div class="pp-site-platform__card">
      <div class="pp-site-platform__head"><span class="pp-site-platform__title">Settings · Modules</span><span class="pp-site-platform__note">Sample company</span></div>
      <div class="pp-site-modules pp-site-modules--flush">
        <div class="pp-site-modules__row pp-site-modules__row--included">
          <div class="pp-toggle pp-toggle--end"><input class="pp-toggle__input" type="checkbox" role="switch" id="platform-mod-er" checked disabled aria-describedby="platform-mod-er-desc"><label class="pp-toggle__label" for="platform-mod-er">Employee Records<span class="pp-toggle__description" id="platform-mod-er-desc">Included with every company</span></label></div>
        </div>
        @for (m of mods; track m.k) {
          <div class="pp-site-modules__row" [class.pp-site-modules__row--press]="s()[m.k].press">
            <div class="pp-toggle pp-toggle--end"><input class="pp-toggle__input" type="checkbox" role="switch" [id]="'platform-mod-' + m.k" [checked]="s()[m.k].on" (change)="flip(m.k, $any($event.target).checked)"><label class="pp-toggle__label" [for]="'platform-mod-' + m.k">{{ m.label }}<span class="pp-toggle__description"><span class="pp-site-state pp-site-state--start"><span class="pp-site-state__item" [class.pp-site-state__item--on]="!s()[m.k].on" [attr.aria-hidden]="s()[m.k].on ? 'true' : null">Off</span><span class="pp-site-state__item pp-site-modules__on" [class.pp-site-state__item--on]="s()[m.k].on" [attr.aria-hidden]="s()[m.k].on ? null : 'true'">On</span></span></span></label></div>
          </div>
        }
        <div class="pp-site-modules__row pp-site-modules__row--soon"><span class="pp-site-modules__name">HR Help Desk</span><span class="pp-site-status">Coming soon</span></div>
        <div class="pp-site-modules__row pp-site-modules__row--soon"><span class="pp-site-modules__name">Performance Management</span><span class="pp-site-status">Coming soon</span></div>
      </div>
      <div class="pp-site-platform__foot"><span>Switched on by Naleko. Each change logged.</span><button class="pp-site-platform__again" type="button" (click)="play()"><svg ppIcon="rotate-ccw" />Play again</button></div>
    </div>
    <div class="pp-site-platform__card">
      <div class="pp-site-app" role="group" aria-label="Sample of the Naleko People app">
        <nav class="pp-site-app__nav" aria-label="Sample app sidebar">
          <div class="pp-site-app__company"><span class="pp-site-app__mark"></span>Sample company</div>
          <span class="pp-site-app__item pp-site-app__item--current"><svg ppIcon="house" />Today</span>
          <span class="pp-site-app__item"><svg ppIcon="users" />People</span>
          @for (m of mods; track m.k) {
            <span class="pp-site-app__item pp-site-app__item--module" [class.pp-site-app__item--in]="s()[m.k].nav" [class.pp-site-app__item--new]="s()[m.k].fresh"><svg [ppIcon]="m.icon" />{{ m.nav }}</span>
          }
          <span class="pp-site-app__spacer"></span>
          <span class="pp-site-app__item"><svg ppIcon="settings" />Settings</span>
        </nav>
        <div class="pp-site-app__main">
          <h3 class="pp-site-app__title">Today</h3>
          <p class="pp-site-app__sub">Jane Smith · HR</p>
          <p class="pp-site-app__idle" [hidden]="anyTask()">Nothing to do yet. Items appear as modules are switched on.</p>
          @for (m of mods; track m.k) {
            <div class="pp-site-app__task" [class.pp-site-app__task--in]="s()[m.k].task"><span class="pp-site-app__module">{{ m.module }}</span><span>{{ m.task }}</span>@if (m.chip) {<span class="pp-site-status" [class]="'pp-site-status--' + m.chip.tone">{{ m.chip.text }}</span>}</div>
          }
        </div>
      </div>
    </div>
  </div>
  <ul class="pp-site-caps">
    <li class="pp-site-caps__item" [ppSiteReveal]="0"><h3 class="pp-site-caps__title">Modules per company</h3><p class="pp-site-caps__text">Employee Records with every company. Recruitment, Onboarding and Offboarding, Leave Management and Compliance Management switched on as needed.</p></li>
    <li class="pp-site-caps__item" [ppSiteReveal]="1"><h3 class="pp-site-caps__title">Templates and checklists</h3><p class="pp-site-caps__text">Hiring stages, onboarding checklists and document lists set in Settings, without code.</p></li>
    <li class="pp-site-caps__item" [ppSiteReveal]="2"><h3 class="pp-site-caps__title">Leave types and holidays</h3><p class="pp-site-caps__text">South African defaults for BCEA leave and public holidays. Company leave types added in Settings.</p></li>
    <li class="pp-site-caps__item" [ppSiteReveal]="3"><h3 class="pp-site-caps__title">Roles and access</h3><p class="pp-site-caps__text">Administrator, HR, Manager, Employee and Guest. Each role sees only its own modules and records.</p></li>
  </ul>
  <a class="pp-link pp-link--standalone" href="#platform-more" [ppSiteReveal]="0"><span>Learn more about the platform</span><svg ppIcon="arrow-right" /></a>
</div>
  `,
  host: { '[attr.data-site-live]': 'live() ? "" : null', 'data-live': '', id: 'platform', class: 'pp-site-section pp-site-section--cream pp-site-section--clip', 'aria-labelledby': 'platform-title' },
})
export class PpSiteLandPlatform {
  private readonly clock = inject(DemoClock);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly mods = MODS;
  protected readonly live = signal(false);
  /** The first frame has every module on, as the kit's markup does. */
  protected readonly s = signal<Record<Mod, ModState>>(ALL_ON());

  constructor() {
    afterNextRender(() => {
      this.live.set(true);
      // On a phone the two cards stack, so wait until the app is in view.
      const phone = !!this.el.closest('.pp-site-stage--phone');
      this.clock.onView(this.el.querySelector(phone ? '.pp-site-app' : '.pp-site-platform')!, () => this.play(), 0.35);
    });
  }

  protected anyTask(): boolean { return MODS.some((m) => this.s()[m.k].task); }

  private patch(k: Mod, p: Partial<ModState>): void { this.s.update((v) => ({ ...v, [k]: { ...v[k], ...p } })); }

  /** Switching a module on lights its sidebar item (marked new for 1.4s) and, 350ms later, its Today task. */
  private set(k: Mod, on: boolean): void {
    this.patch(k, { on, nav: on });
    if (on) {
      this.patch(k, { fresh: true });
      this.clock.at(1400, () => this.patch(k, { fresh: false }));
      this.clock.at(350, () => this.patch(k, { task: true }));
    } else {
      this.patch(k, { task: false, fresh: false });
    }
  }

  protected flip(k: Mod, on: boolean): void { this.clock.stop(); this.set(k, on); }

  protected play(): void {
    const c = this.clock;
    c.stop();
    this.s.set(ALL_OFF());
    MODS.forEach((m, i) => c.at(700 + i * 1100, () => { this.patch(m.k, { press: true }); c.at(250, () => this.set(m.k, true)); }));
  }
}
