import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { NavSection, PpAppShell, PpChatList, PpDropdownMenu, PpMenuItem, PpMenuSection, PpSideNavigation, PpTopNavigation } from '../../ds';
import { AuthService } from '../../core/auth/auth.service';
import { DocumentsService } from '../../core/documents/documents.service';
import { RegistrationService } from '../../core/employees/registration.service';
import { navEntries, sectionsFor } from '../../core/nav';
import { ModulesService } from '../../core/modules.service';
import { Launcher } from '../../core/launcher/launcher';
import { rolesOf } from '../../core/roles';
import { CHAT_PAGE, ChatService } from '../hr-assistant/chat.service';
import { HrChat } from '../hr-assistant/assistant-panel';
import { ChatDialogs } from '../hr-assistant/chat-dialogs';

/**
 * The frame for every HR page: sidebar, top bar with the account menu, and the page. ONB-01 gives it
 * one sidebar item (Today), ONB-13 adds Documents to check with the number waiting; later cards add the rest. The account menu holds Sign out.
 */
@Component({
  selector: 'app-hr-shell',
  imports: [RouterOutlet, PpAppShell, PpChatList, PpChatList, PpSideNavigation, PpTopNavigation, PpDropdownMenu, PpMenuSection, PpMenuItem, HrChat, ChatDialogs, Launcher],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-app-shell>
      @if (chat.onPage()) {
        <pp-chat-list [groups]="chat.groups()" [state]="chat.listState()" [canDeleteAll]="chat.canDeleteAll()" [backLink]="chat.returnTo()" [(open)]="menuOpen"
          (newChat)="chat.newChat()" (openChat)="chat.openChat($event)" (retry)="chat.loadList()" (deleteAll)="chat.confirmAll.set(true)" />
      }
      @else { <pp-side-navigation company="HR" [sections]="sections()" [(open)]="menuOpen" /> }
      <pp-top-navigation home="/hr" [userName]="userName()" [menuOpen]="menuOpen()" [accountOpen]="accountOpen()" [showLauncher]="true" [launcherOpen]="launcherOpen()" (launcher)="launcherOpen.set(!launcherOpen())" [showAsk]="true" [waiting]="chat.waiting()" [askOpen]="askOpen()" (ask)="openAsk()" (menu)="menuOpen.set(!menuOpen())" (account)="accountOpen.set(!accountOpen())" />
      <pp-dropdown-menu [trigger]="false" [(open)]="accountOpen" [origin]="avatar()" [returnTo]="avatar()" label="Your account">
        <pp-menu-section [heading]="userName()">
          <button ppMenuItem icon="log-out" (click)="signOut()">Sign out</button>
        </pp-menu-section>
      </pp-dropdown-menu>
      <router-outlet />
    </pp-app-shell>
    <app-launcher [(open)]="launcherOpen" [askLink]="chatPage" />
    <app-chat-dialogs />
    <app-hr-chat [(open)]="askOpen" (expand)="expand()" />
  `,
})
export class HrShell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  private readonly documents = inject(DocumentsService);
  private readonly registration = inject(RegistrationService);

  /** The number waiting shows once the list has loaded; HR home and the employee page never ask for it. */
  private readonly modulesService = inject(ModulesService);
  protected readonly sections = computed<NavSection[]>(() => {
    const waiting = this.documents.waitingCount();
    const { roles, perms } = rolesOf(this.auth.user()?.groups);
    return sectionsFor(navEntries(), { roles, perms, modules: this.modulesService.modules() }, (e) =>
      e.route === '/hr/documents' && waiting !== null ? { count: waiting, countLabel: 'waiting' } : null);
  });
  protected readonly chat = inject(ChatService);
  protected readonly askOpen = signal(false);
  protected readonly launcherOpen = signal(false);
  protected readonly chatPage = CHAT_PAGE;
  protected readonly menuOpen = signal(false);
  protected readonly accountOpen = signal(false);
  protected readonly userName = () => this.auth.user()?.fullName ?? '';

  /** The avatar button in the top bar: the menu hangs under it and focus returns to it. */
  protected avatar(): HTMLElement | undefined {
    return this.host.querySelector<HTMLElement>('.pp-top-navigation__avatar') ?? undefined;
  }

  /** Ask Batsi in the top bar: the side panel. What waits for the person is read now, not on page load. */
  protected openAsk(): void {
    if (this.router.url.split('?')[0] === CHAT_PAGE) return; // the full page is already the chat
    this.askOpen.set(true);
    this.chat.panelOpened();
    void this.chat.loadWaiting();
  }

  /** The panel's Expand button: the same conversation, as a page. */
  protected expand(): void {
    this.askOpen.set(false);
    this.chat.fromPanel();
    void this.router.navigateByUrl(CHAT_PAGE);
  }

  protected async signOut(): Promise<void> {
    this.chat.clear();
    await this.auth.signOut();
    this.documents.forget();
    this.registration.clear();
    await this.router.navigateByUrl('/sign-in');
  }
}
