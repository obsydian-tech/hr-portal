import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { NavSection, PpAppShell, PpDropdownMenu, PpMenuItem, PpMenuSection, PpSideNavigation, PpTopNavigation } from '../../ds';
import { AuthService } from '../../core/auth/auth.service';
import { StartService } from '../../core/start/start.service';
import { MyDocumentsService } from '../../core/start/my-documents.service';
import { navEntries, sectionsFor } from '../../core/nav';
import { ModulesService } from '../../core/modules.service';
import { Launcher } from '../../core/launcher/launcher';
import { rolesOf } from '../../core/roles';

/**
 * The frame for a new employee's own pages: sidebar, top bar with the account menu, and the page.
 * ONB-05 gives it one sidebar item, Today. Later cards add the pages they build. The account menu holds Sign out.
 * There is no bell: employees have no notifications yet.
 */
@Component({
  selector: 'app-employee-shell',
  imports: [RouterOutlet, PpAppShell, PpSideNavigation, PpTopNavigation, PpDropdownMenu, PpMenuSection, PpMenuItem, Launcher],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-app-shell>
      <pp-side-navigation [company]="company()" [sections]="sections()" [(open)]="menuOpen" />
      <pp-top-navigation home="/start" [userName]="userName()" [showLauncher]="true" [launcherOpen]="launcherOpen()" (launcher)="launcherOpen.set(!launcherOpen())" [menuOpen]="menuOpen()" [accountOpen]="accountOpen()" (menu)="menuOpen.set(!menuOpen())" (account)="accountOpen.set(!accountOpen())" />
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
export class EmployeeShell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly start = inject(StartService);
  private readonly documents = inject(MyDocumentsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** Only pages that exist: Documents, My onboarding, My details and Help come with their cards. */
  private readonly modulesService = inject(ModulesService);
  protected readonly sections = computed<NavSection[]>(() => {
    const { roles, perms } = rolesOf(this.auth.user()?.groups);
    return sectionsFor(navEntries(), { roles, perms, modules: this.modulesService.modules() });
  });
  protected readonly company = computed(() => this.start.company());
  protected readonly menuOpen = signal(false);
  protected readonly launcherOpen = signal(false);
  protected readonly accountOpen = signal(false);
  protected readonly userName = () => this.auth.user()?.fullName ?? '';

  protected avatar(): HTMLElement | undefined {
    return this.host.querySelector<HTMLElement>('.pp-top-navigation__avatar') ?? undefined;
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    this.start.forget();
    this.documents.forget();
    await this.router.navigateByUrl('/sign-in');
  }
}
