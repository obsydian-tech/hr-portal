import { ChangeDetectionStrategy, Component, ElementRef, HostListener, Injector, afterNextRender, computed, contentChild, inject, input, model, output, signal, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { A11yModule } from '@angular/cdk/a11y';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { PpIcon } from '../core/icon';
import { PpMark } from '../core/mark';
import { IconName } from '../core/icon.registry';
import { PpButton } from '../actions/button';
import { PpTextField } from '../forms/field';
import { PpSkeleton, PpSkeletonGroup } from '../status/status';
import { PpSectionMessage } from '../messages/messages';
import { initials } from '../core/avatar';
import { NgTemplateOutlet } from '@angular/common';
import { uid } from '../util';

export interface NavItem { label: string; icon: IconName; link: string; count?: number; countLabel?: string; }
export interface NavSection { heading?: string; items: NavItem[]; }

/**
 * The one Naleko People frame: banner, sidebar, top bar, main and flags. Pages render inside main.
 * ```html
 * <pp-app-shell>
 *   <pp-side-navigation … /> <pp-top-navigation … />
 *   <router-outlet />
 * </pp-app-shell>
 * ```
 * Under 768px it switches to the phone layout on its own. Spec: navigation/app-shell.md
 */
@Component({
  selector: 'pp-app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="pp-app-shell__skip" href="#main" (click)="skip($event)">Skip to main content</a>
    <ng-content select="pp-banner" />
    <ng-content select="pp-side-navigation" />
    <ng-content select="pp-chat-list" />
    <ng-content select="pp-top-navigation" />
    <main class="pp-app-shell__main" id="main" tabindex="-1" [attr.inert]="drawerOpen() ? '' : null">
      <div class="pp-app-shell__content"><ng-content /></div>
    </main>
    <!-- Phone: behind the open sidebar drawer. A tap closes the drawer. -->
    @if (drawerOpen()) { <div class="pp-app-shell__blanket" (click)="nav()!.open.set(false)"></div> }
    <ng-content select="pp-app-shell-actions" />
    <ng-content select="pp-flag-group" />
  `,
  host: {
    class: 'pp-app-shell', '[class.pp-app-shell--phone]': 'phone()', '[class.pp-app-shell--inline]': 'inline()',
    '[style.--_height]': 'inline() && inlineHeight() ? inlineHeight() + "px" : null',
  },
})
export class PpAppShell {
  /** Forces the phone layout (previews). Real phones get it from the screen width. */
  readonly phone = input(false);
  /** In a fixed-height frame instead of the viewport, for the gallery and docs. */
  readonly inline = input(false);
  /** Height of that frame, in pixels. */
  readonly inlineHeight = input<number>();
  protected readonly nav = contentChild(PpSideNavigation);
  protected readonly drawerOpen = computed(() => !!this.nav()?.open());
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected skip(e: Event) { e.preventDefault(); this.host.querySelector<HTMLElement>('#main')?.focus(); }
}

/** The bottom action bar on phone: the page's one main action, and at most one more. */
@Component({ selector: 'pp-app-shell-actions', template: '<ng-content />', host: { class: 'pp-app-shell__actions' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpAppShellActions {}

/** One chat in the list. */
export interface ChatItem { id: string; title: string; current: boolean; }
/** A heading ("Today", "Yesterday", "October 2026") and the chats under it. */
export interface ChatGroup { name: string; items: ChatItem[]; }

/**
 * The Ask Batsi page's left column in place of the sidebar: the person's past chats, grouped, with New chat, Search chats
 * and Delete all my chats. On phone the top bar menu button opens it as a full-width "Chats" screen.
 * `state` is what reading the list gave: loading rows, the list, a read that failed, or off (the company has not switched Ask Batsi on:
 * only Back to Today and Delete all my chats). Spec: navigation/side-navigation.md, kit page ask-batsi-full-page.
 */
@Component({
  selector: 'pp-chat-list',
  imports: [RouterLink, PpIcon, PpButton, PpTextField, PpSkeleton, PpSkeletonGroup, PpSectionMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!phone()) {
      <div class="pp-side-navigation__header"><a ppButton appearance="subtle" size="small" icon="arrow-left" [routerLink]="backLink()">Back to Today</a></div>
    }
    <div class="pp-side-navigation__body">
      @if (phone()) { <h2 class="pp-heading pp-heading--large">Chats</h2> }
      @if (state() !== 'off') {
        <ul class="pp-side-navigation__section">
          <li><button class="pp-side-navigation__item pp-side-navigation__item--entry" type="button" (click)="newChat.emit(); open.set(false)"><svg ppIcon="plus" /><span class="pp-side-navigation__label">New chat</span></button></li>
          <li>
            @if (!searching()) {
              <button #searchButton class="pp-side-navigation__item pp-side-navigation__item--entry" type="button" (click)="startSearch()"><svg ppIcon="search" /><span class="pp-side-navigation__label">Search chats</span></button>
            } @else {
              <input #searchBox ppTextField type="search" size="small" aria-label="Search chats" [value]="query()" (input)="query.set($any($event.target).value)" (keydown.escape)="stopSearch()" (blur)="leaveSearch()" />
            }
          </li>
        </ul>
      }
      @switch (state()) {
        @case ('loading') {
          <div aria-busy="true"><pp-skeleton-group label="" gap="150"><pp-skeleton shape="text" /><pp-skeleton shape="text" /><pp-skeleton shape="text" /><pp-skeleton shape="text" /></pp-skeleton-group></div>
        }
        @case ('error') {
          <div class="pp-stack pp-gap-100">
            <pp-section-message tone="danger" heading="We could not load your chats." />
            <button ppButton size="small" type="button" (click)="retry.emit()">Try again</button>
          </div>
        }
        @case ('ok') {
          @if (!groups().length) { <p class="pp-text pp-text--small pp-text--subtle pp-side-navigation__heading" role="status">No chats yet.</p> }
          @for (g of shown(); track g.name; let i = $index) {
            <ul class="pp-side-navigation__section" [attr.aria-labelledby]="id + '-g' + i">
              <li><span class="pp-side-navigation__heading" [id]="id + '-g' + i">{{ g.name }}</span></li>
              @for (c of g.items; track c.id) {
                <li><button class="pp-side-navigation__item" type="button" [attr.aria-current]="c.current ? 'page' : null" [attr.aria-label]="c.title" (click)="openChat.emit(c.id); open.set(false)"><span class="pp-side-navigation__label">{{ c.title }}</span></button></li>
              }
            </ul>
          }
          @if (searching() && query().trim() && !shown().length) { <p class="pp-text pp-text--small pp-text--subtle" role="status">No chats found.</p> }
        }
      }
      @if (canDeleteAll()) {
        <ul class="pp-side-navigation__section">
          <li><button class="pp-side-navigation__item pp-side-navigation__item--entry" type="button" (click)="deleteAll.emit()"><svg ppIcon="trash-2" /><span class="pp-side-navigation__label">Delete all my chats</span></button></li>
        </ul>
      }
    </div>
  `,
  host: {
    class: 'pp-side-navigation pp-side-navigation--chats', role: 'navigation', 'aria-label': 'Chats', id: 'pp-side-navigation',
    '[attr.data-open]': 'open() ? "true" : null',
    '[style.top]': 'phone() ? "var(--layout-topbar-height)" : null',
    '[style.height]': 'phone() ? "calc(100% - var(--layout-topbar-height))" : null',
    '[style.width]': 'phone() ? "100%" : null',
    '[style.borderRadius]': 'phone() ? "0" : null',
    '[style.zIndex]': 'phone() ? "5" : null',
  },
})
export class PpChatList {
  readonly groups = input<ChatGroup[]>([]);
  readonly state = input<'loading' | 'ok' | 'error' | 'off'>('loading');
  readonly canDeleteAll = input(false);
  readonly backLink = input('/hr');
  readonly open = model(false);
  readonly newChat = output<void>();
  readonly openChat = output<string>();
  readonly retry = output<void>();
  readonly deleteAll = output<void>();
  protected readonly id = uid('pp-chats');
  private readonly injector = inject(Injector);
  protected readonly phone = toSignal(inject(BreakpointObserver).observe('(max-width: 767px)').pipe(map((r) => r.matches)), { initialValue: false });
  protected readonly searching = signal(false);
  protected readonly query = signal('');
  private readonly searchButton = viewChild<ElementRef<HTMLElement>>('searchButton');
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');
  /** The groups with only the titles that hold what was typed (any case); a group with none is left out. */
  protected readonly shown = computed(() => {
    const q = this.searching() ? this.query().trim().toLowerCase() : '';
    if (!q) return this.groups();
    return this.groups().map((g) => ({ name: g.name, items: g.items.filter((c) => c.title.toLowerCase().includes(q)) })).filter((g) => g.items.length);
  });
  protected startSearch(): void { this.searching.set(true); afterNextRender(() => this.searchBox()?.nativeElement.focus(), { injector: this.injector }); }
  protected stopSearch(): void { this.searching.set(false); this.query.set(''); afterNextRender(() => this.searchButton()?.nativeElement.focus(), { injector: this.injector }); }
  protected leaveSearch(): void { if (!this.query().trim()) { this.searching.set(false); this.query.set(''); } }
}

/**
 * The sidebar: Today, People, the modules this person can use, and Settings at the bottom (One Naleko People).
 * The header shows the company; with more than one company it switches between them.
 * On phone it is a drawer: `[(open)]`. Spec: navigation/side-navigation.md
 */
@Component({
  selector: 'pp-side-navigation',
  imports: [RouterLink, RouterLinkActive, PpIcon, PpMark, A11yModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-side-navigation__header">
      <ng-template #name>
        <svg ppMark />
        <span class="pp-side-navigation__product-name"><span class="pp-side-navigation__wordmark">Naleko People</span>@if (!collapsed()) {<span class="pp-side-navigation__product-area">{{ company() }}</span>}</span>
      </ng-template>
      @if (switchable()) {
        <button class="pp-side-navigation__product" type="button" aria-haspopup="menu" [attr.aria-expanded]="switching()"
                [attr.aria-label]="collapsed() ? 'Switch company, ' + company() : null" (click)="switchCompany.emit()">
          <ng-container [ngTemplateOutlet]="name" />
          @if (!collapsed()) { <svg ppIcon="chevrons-up-down" /><span class="pp-visually-hidden">Switch company</span> }
        </button>
      } @else {
        <!-- One company: its name, not a button. -->
        <div class="pp-side-navigation__product" [attr.aria-label]="collapsed() ? company() : null" [attr.role]="collapsed() ? 'img' : null"><ng-container [ngTemplateOutlet]="name" /></div>
      }
    </div>
    <div class="pp-side-navigation__body">
      @for (s of sections(); track $index) {
        <ul class="pp-side-navigation__section" [attr.aria-labelledby]="s.heading ? id + '-h' + $index : null">
          @if (s.heading) { <li><span class="pp-side-navigation__heading" [id]="id + '-h' + $index">{{ s.heading }}</span></li> }
          @for (i of s.items; track i.link) {
            <li>
              <a class="pp-side-navigation__item" [routerLink]="i.link" routerLinkActive="" ariaCurrentWhenActive="page" (click)="open.set(false)">
                <svg [ppIcon]="i.icon" /><span class="pp-side-navigation__label">{{ i.label }}</span>
                @if (i.count) { <span class="pp-side-navigation__count" [attr.aria-label]="i.countLabel ?? i.count + ' waiting'">{{ i.count }}</span> }
              </a>
            </li>
          }
        </ul>
      }
    </div>
    @if (footer().length) {
      <div class="pp-side-navigation__footer">
        @for (i of footer(); track i.link) {
          <a class="pp-side-navigation__item" [routerLink]="i.link" routerLinkActive="" ariaCurrentWhenActive="page" (click)="open.set(false)"><svg [ppIcon]="i.icon" /><span class="pp-side-navigation__label">{{ i.label }}</span></a>
        }
      </div>
    }
  `,
  host: {
    class: 'pp-side-navigation',
    role: 'navigation',
    'aria-label': 'Main',
    id: 'pp-side-navigation',
    '[class.pp-side-navigation--collapsed]': 'collapsed()',
    '[class.pp-side-navigation--inline]': 'inline()',
    '[style.--_height]': 'inline() && inlineHeight() ? inlineHeight() + "px" : null',
    '[attr.data-open]': 'open() ? "true" : null',
  },
})
export class PpSideNavigation {
  readonly company = input.required<string>();
  readonly switchable = input(false);
  readonly sections = input.required<NavSection[]>();
  readonly footer = input<NavItem[]>([]);
  readonly collapsed = input(false);
  readonly open = model(false);
  /** The company menu is open (the screen owns that menu). */
  readonly switching = input(false);
  /** In place, for the gallery and docs. */
  readonly inline = input(false);
  /** Height in place, in pixels (docs only). */
  readonly inlineHeight = input<number>();
  readonly switchCompany = output<void>();
  protected readonly id = uid('pp-sidenav');
  @HostListener('document:keydown.escape') protected escape() { if (this.open()) this.open.set(false); }
}

/**
 * The top bar: search, notifications and the account menu. Never holds a primary button (Calm rule 1).
 * Spec: navigation/top-navigation.md
 */
@Component({
  selector: 'pp-top-navigation',
  imports: [PpIcon, PpMark, PpButton, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button ppButton appearance="subtle" icon="menu" [iconOnly]="true" class="pp-top-navigation__menu" aria-label="Open menu" [attr.aria-expanded]="menuOpen()" aria-controls="pp-side-navigation" (click)="menu.emit()"></button>
    @if (collapsible()) {
      <button ppButton appearance="subtle" icon="panel-left" [iconOnly]="true" [attr.aria-label]="collapsed() ? 'Expand menu' : 'Collapse menu'" [attr.aria-expanded]="!collapsed()" aria-controls="pp-side-navigation" (click)="collapse.emit()"></button>
    }
    @if (showLauncher()) {
      <button ppButton icon="layout-grid" class="pp-top-navigation__launcher" aria-label="Modules" aria-haspopup="dialog" [attr.aria-expanded]="launcherOpen() ? 'true' : 'false'" (click)="launcher.emit()">Modules</button>
    }
    <a class="pp-top-navigation__brand" [routerLink]="home()" aria-label="Naleko People home"><svg ppMark /></a>
    <label class="pp-top-navigation__search">
      <svg ppIcon="search" />
      <input #searchBox class="pp-top-navigation__search-input" type="search" [placeholder]="searchPlaceholder()" [attr.aria-label]="searchPlaceholder()" (keydown.enter)="search.emit($any($event.target).value)">
      @if (!compact()) { <kbd>/</kbd> }
    </label>
    <div class="pp-top-navigation__actions">
      @if (showAsk()) {
        <!-- Ask Batsi opens the agent panel. The only way in: no floating bubble. A phone shows the icon alone. -->
        @if (narrow() || compact()) {
          <button ppButton appearance="subtle" icon="sparkles" [iconOnly]="true" [attr.aria-label]="askLabel()" aria-haspopup="dialog" [attr.aria-expanded]="askOpen()" (click)="ask.emit()">
            @if (waiting()) { <span class="pp-top-navigation__badge" aria-hidden="true">{{ waiting() }}</span> }
          </button>
        } @else {
          <button ppButton appearance="default" size="small" icon="sparkles" [attr.aria-label]="askLabel()" aria-haspopup="dialog" [attr.aria-expanded]="askOpen()" (click)="ask.emit()">
            <span>Ask Batsi</span>@if (waiting()) { <span class="pp-top-navigation__badge" aria-hidden="true">{{ waiting() }}</span> }
          </button>
        }
      }
      <button ppButton appearance="subtle" icon="search" [iconOnly]="true" class="pp-top-navigation__search-button" aria-label="Search" (click)="search.emit('')"></button>
      <button ppButton appearance="subtle" icon="bell" [iconOnly]="true" [attr.aria-label]="bellLabel()" aria-haspopup="dialog" [attr.aria-expanded]="notificationsOpen()"
              [attr.aria-controls]="notificationsOpen() ? notificationsId() ?? null : null" [pressed]="notificationsOpen() || undefined" (click)="notifications.emit()">
        @if (unread()) { <span class="pp-top-navigation__badge" aria-hidden="true">{{ unread() }}</span> }
      </button>
      <button class="pp-top-navigation__avatar" type="button" [attr.aria-label]="'Your account, ' + userName()" aria-haspopup="menu" [attr.aria-expanded]="accountOpen()" (click)="account.emit()"><span aria-hidden="true">{{ letters() }}</span></button>
    </div>
  `,
  host: { class: 'pp-top-navigation', role: 'banner', '[class.pp-top-navigation--compact]': 'compact()', '[class.pp-top-navigation--inline]': 'inline()' },
})
export class PpTopNavigation {
  readonly userName = input.required<string>();
  /** Where "Naleko People home" goes: the signed-in person's own home (`/hr`, `/start`), since `/` is the public site. */
  readonly home = input('/');
  readonly unread = input(0);
  /** Desktop only: shows the button that collapses the sidebar to icons. */
  readonly collapsible = input(false);
  readonly collapsed = input(false);
  readonly searchPlaceholder = input('Search people and documents');
  /** Phone layout: menu, brand and icon buttons only (previews; real phones get it from the width). */
  readonly compact = input(false);
  readonly inline = input(false);
  /** Whether the sidebar drawer, the notifications panel or the account menu is open, so the buttons say so. */
  readonly menuOpen = input(false);
  readonly notificationsOpen = input(false);
  /** The notifications panel's id, for aria-controls. */
  readonly notificationsId = input<string>();
  readonly accountOpen = input(false);
  /** The Modules button at the left end (off by default). */
  readonly showLauncher = input(false);
  /** The modules popup or drawer is open, so the button says so. */
  readonly launcherOpen = input(false);
  readonly launcher = output<void>();
  /** The Ask Batsi button, before Notifications (off by default). */
  readonly showAsk = input(false);
  /** How many of Batsi's proposals wait for this person; the button says so. */
  readonly waiting = input(0);
  /** The Batsi panel is open, so the button says so. */
  readonly askOpen = input(false);
  readonly ask = output<void>();
  protected readonly narrow = toSignal(inject(BreakpointObserver).observe('(max-width: 767px)').pipe(map((r) => r.matches)), { initialValue: false });
  protected readonly askLabel = computed(() => this.waiting() ? `Ask Batsi, ${this.waiting()} waiting` : 'Ask Batsi');
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');
  /** "/" jumps to search from anywhere except a field. */
  @HostListener('document:keydown', ['$event']) protected slash(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || t.closest('input, textarea, select, [contenteditable="true"]')) return;
    const box = this.searchBox()?.nativeElement;
    if (!box || !box.offsetParent) return;
    e.preventDefault();
    box.focus();
  }
  readonly menu = output<void>();
  readonly collapse = output<void>();
  readonly search = output<string>();
  readonly notifications = output<void>();
  readonly account = output<void>();
  protected readonly letters = computed(() => initials(this.userName()));
  protected readonly bellLabel = computed(() => this.unread() ? `Notifications, ${this.unread()} unread` : 'Notifications');
}
