import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { NavSection, PpAppShell, PpDropdownMenu, PpMenuItem, PpMenuSection, PpSideNavigation, PpTopNavigation } from '../../ds';
import { AuthService } from '../../core/auth/auth.service';
import { landingFor, navEntries, sectionsFor } from '../../core/nav';
import { ModulesService } from '../../core/modules.service';
import { Launcher } from '../../core/launcher/launcher';
import { rolesOf } from '../../core/roles';

/**
 * CHAT-03: the frame for the Admin area, drawn like the kit's Admin frame: Back to Today, then Settings with the pages
 * that exist. It calls no HR service (no documents to check, no employees list). The account menu holds Sign out.
 */
@Component({
  selector: 'app-admin-shell',
  imports: [RouterOutlet, PpAppShell, PpSideNavigation, PpTopNavigation, PpDropdownMenu, PpMenuSection, PpMenuItem, Launcher],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-app-shell>
      <pp-side-navigation company="Admin" [sections]="sections()" [(open)]="menuOpen" />
      <pp-top-navigation [home]="today()" [userName]="userName()" [showLauncher]="true" [launcherOpen]="launcherOpen()" (launcher)="launcherOpen.set(!launcherOpen())" [menuOpen]="menuOpen()" [accountOpen]="accountOpen()" (menu)="menuOpen.set(!menuOpen())" (account)="accountOpen.set(!accountOpen())" />
      <pp-dropdown-menu [trigger]="false" [(open)]="accountOpen" [origin]="avatar()" [returnTo]="avatar()" label="Your account">
        <pp-menu-section [heading]="userName()">
          <button ppMenuItem icon="log-out" (click)="signOut()">Sign out</button>
        </pp-menu-section>
      </pp-dropdown-menu>
      <router-outlet />
    </pp-app-shell>
    <app-launcher [(open)]="launcherOpen" />
  `,
})
export class AdminShell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly modulesService = inject(ModulesService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  private readonly who = computed(() => {
    const { roles, perms } = rolesOf(this.auth.user()?.groups);
    return { roles, perms, modules: this.modulesService.modules() };
  });
  /** Back to Today goes to the person's own first page: HR home for an admin who is also HR. */
  protected readonly today = computed(() => landingFor(this.who().roles, this.who().perms, []));
  protected readonly sections = computed<NavSection[]>(() => [
    { items: [{ label: 'Back to Today', icon: 'arrow-left', link: this.today() }] },
    ...sectionsFor(navEntries(), this.who()),
  ]);
  protected readonly menuOpen = signal(false);
  protected readonly launcherOpen = signal(false);
  protected readonly accountOpen = signal(false);
  protected readonly userName = () => this.auth.user()?.fullName ?? '';

  protected avatar(): HTMLElement | undefined {
    return this.host.querySelector<HTMLElement>('.pp-top-navigation__avatar') ?? undefined;
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/sign-in');
  }
}
