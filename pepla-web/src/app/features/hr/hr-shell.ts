import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { NavSection, PpAppShell, PpDropdownMenu, PpMenuItem, PpMenuSection, PpSideNavigation, PpTopNavigation } from '../../ds';
import { AuthService } from '../../core/auth/auth.service';
import { DocumentsService } from '../../core/documents/documents.service';

/**
 * The frame for every HR page: sidebar, top bar with the account menu, and the page. ONB-01 gives it
 * one sidebar item (Today), ONB-13 adds Documents to check with the number waiting; later cards add the rest. The account menu holds Sign out.
 */
@Component({
  selector: 'app-hr-shell',
  imports: [RouterOutlet, PpAppShell, PpSideNavigation, PpTopNavigation, PpDropdownMenu, PpMenuSection, PpMenuItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-app-shell>
      <pp-side-navigation company="HR" [sections]="sections()" [(open)]="menuOpen" />
      <pp-top-navigation [userName]="userName()" [menuOpen]="menuOpen()" [accountOpen]="accountOpen()" (menu)="menuOpen.set(!menuOpen())" (account)="accountOpen.set(!accountOpen())" />
      <pp-dropdown-menu [trigger]="false" [(open)]="accountOpen" [origin]="avatar()" [returnTo]="avatar()" label="Your account">
        <pp-menu-section [heading]="userName()">
          <button ppMenuItem icon="log-out" (click)="signOut()">Sign out</button>
        </pp-menu-section>
      </pp-dropdown-menu>
      <router-outlet />
    </pp-app-shell>
  `,
})
export class HrShell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  private readonly documents = inject(DocumentsService);

  /** The number waiting shows once the list has loaded; HR home and the employee page never ask for it. */
  protected readonly sections = computed<NavSection[]>(() => {
    const waiting = this.documents.waitingCount();
    return [{
      items: [
        { label: 'Today', icon: 'house', link: '/hr' },
        { label: 'Documents to check', icon: 'files', link: '/hr/documents', ...(waiting !== null ? { count: waiting, countLabel: 'waiting' } : {}) },
      ],
    }];
  });
  protected readonly menuOpen = signal(false);
  protected readonly accountOpen = signal(false);
  protected readonly userName = () => this.auth.user()?.fullName ?? '';

  /** The avatar button in the top bar: the menu hangs under it and focus returns to it. */
  protected avatar(): HTMLElement | undefined {
    return this.host.querySelector<HTMLElement>('.pp-top-navigation__avatar') ?? undefined;
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    this.documents.forget();
    await this.router.navigateByUrl('/sign-in');
  }
}
