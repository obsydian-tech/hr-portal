import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, model } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { PpCard, PpCardAside, PpCardBody, PpDrawer, PpLink, PpLozenge, PpPopup } from '../../ds';
import { AuthService } from '../auth/auth.service';
import { ModulesService } from '../modules.service';
import { landingFor, navEntries, type Who } from '../nav';
import { ROLE, rolesOf } from '../roles';
import { LAUNCHER_MODULES, LAUNCHER_WORDS, LEARN_MORE, firstPage, nameOf, stateOf, type LauncherModule, type LauncherState } from './launcher.catalogue';

interface Tile { m: LauncherModule; state: LauncherState; name: string; to: string; learnMore: string | null; }

/**
 * MOD-03: every module in one place. A popup under the Modules button at 1280, a full-height drawer at 390.
 * One tile per module in the design system's order, each Open, No access, Not switched on or Coming soon. Made of kit parts only (pp-card,
 * pp-lozenge, the popup and drawer classes), with no styles of its own. Ask Batsi is its own row on top.
 * The shell owns the button and the `open` flag; this draws what the flag shows.
 */
@Component({
  selector: 'app-launcher',
  imports: [NgTemplateOutlet, RouterLink, PpCard, PpCardAside, PpCardBody, PpDrawer, PpLink, PpLozenge, PpPopup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #tiles>
      <div class="pp-stack pp-gap-150">
        @if (askLink(); as to) {
          <a ppCard [compact]="true" icon="sparkles" iconTone="agent" [heading]="words.askBatsi" [routerLink]="to" data-module="ask-batsi" data-state="open" (click)="shut()"></a>
        } @else {
          <pp-card [compact]="true" icon="sparkles" iconTone="agent" [heading]="words.askBatsi" data-module="ask-batsi" data-state="open" />
        }
        <ul class="pp-stack pp-gap-100" role="list">
          @for (t of list(); track t.m.key) {
            <li>
              @switch (t.state) {
                @case ('open') {
                  <a ppCard [compact]="true" [icon]="t.m.icon" iconTone="neutral" [heading]="t.name" [routerLink]="t.to" [attr.data-module]="t.m.key" data-state="open" (click)="shut()">
                    <div ppCardBody>{{ t.m.description }}</div>
                  </a>
                }
                @case ('no-access') {
                  <pp-card [compact]="true" icon="lock" iconTone="neutral" [heading]="t.name" [attr.data-module]="t.m.key" data-state="no-access">
                    <pp-card-aside><pp-lozenge icon="lock">{{ words.noAccess }}</pp-lozenge></pp-card-aside>
                    <div ppCardBody>{{ t.m.description }}<br>{{ words.askAdmin }}</div>
                  </pp-card>
                }
                @case ('not-on') {
                  <pp-card [compact]="true" appearance="sunken" [icon]="t.m.icon" iconTone="neutral" [heading]="t.name" [attr.data-module]="t.m.key" data-state="not-on">
                    <pp-card-aside><pp-lozenge icon="circle-dashed">{{ words.notOn }}</pp-lozenge></pp-card-aside>
                    <div ppCardBody>{{ t.m.description }}</div>
                    @if (t.learnMore) { <a ppLink [routerLink]="t.learnMore" (click)="shut()">{{ learnMore }} {{ t.m.name }}</a> }
                  </pp-card>
                }
                @default {
                  <pp-card [compact]="true" appearance="sunken" [icon]="t.m.icon" iconTone="neutral" [heading]="t.name" [attr.data-module]="t.m.key" data-state="coming-soon">
                    <pp-card-aside><pp-lozenge icon="hourglass">{{ words.comingSoon }}</pp-lozenge></pp-card-aside>
                    <div ppCardBody>{{ t.m.description }}</div>
                  </pp-card>
                }
              }
            </li>
          }
        </ul>
      </div>
    </ng-template>

    @if (phone()) {
      <pp-drawer [heading]="words.title" [open]="open()" (openChange)="set($event)"><ng-container [ngTemplateOutlet]="tiles" /></pp-drawer>
    } @else {
      <pp-popup [trigger]="false" text="Modules" [heading]="words.title" [wide]="true" [closable]="true" [open]="open()" (openChange)="set($event)" [origin]="button()" [returnTo]="button()">
        <ng-container [ngTemplateOutlet]="tiles" />
      </pp-popup>
    }
  `,
})
export class Launcher {
  private readonly auth = inject(AuthService);
  private readonly modules = inject(ModulesService);
  /** Where the Ask Batsi row goes, for a person who has Ask Batsi in the top bar. Others see the row without a link. */
  readonly askLink = input<string | null>(null);
  readonly open = model(false);
  protected readonly words = LAUNCHER_WORDS;
  protected readonly learnMore = LEARN_MORE;
  protected readonly phone = toSignal(inject(BreakpointObserver).observe('(max-width: 767px)').pipe(map((r) => r.matches)), { initialValue: false });

  /** The person and the company's modules. Empty modules (unknown, failed, or not answered yet) read as a company with nothing on. */
  private readonly who = computed<Who>(() => {
    const { roles, perms } = rolesOf(this.auth.user()?.groups);
    return { roles, perms, modules: this.modules.modules() };
  });

  protected readonly list = computed<Tile[]>(() => {
    const who = this.who();
    const landing = landingFor(who.roles, who.perms, [...who.modules]);
    const admin = who.roles.includes(ROLE.admin);
    return LAUNCHER_MODULES.map((m) => {
      const state = stateOf(m, who);
      return {
        m, state, name: nameOf(m, who),
        to: state === 'open' ? firstPage(m, navEntries(), who, landing) : '',
        learnMore: state === 'not-on' && admin && m.publicPage ? m.publicPage : null,
      };
    });
  });

  /** The Modules button in the top bar: the popup hangs under it and focus goes back to it. */
  protected button(): HTMLElement | null {
    return document.querySelector<HTMLElement>('pp-top-navigation .pp-top-navigation__launcher');
  }
  protected set(value: boolean): void {
    if (this.open() === value) return;
    this.open.set(value);
    if (!value) this.focusButton();
  }
  protected shut(): void { this.set(false); }
  /** Escape shuts the popup from anywhere (the drawer shuts itself). */
  @HostListener('document:keydown.escape') protected escape(): void { if (this.open() && !this.phone()) this.set(false); }
  protected outside(e: MouseEvent): void {
    if (!this.button()?.contains(e.target as Node)) this.set(false);
  }
  private focusButton(): void { queueMicrotask(() => this.button()?.focus()); }
}
