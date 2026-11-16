import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PpButton, PpSignInActions, PpSignInPage } from '../../ds';
import { AuthService } from '../../core/auth/auth.service';

/** ONB-17 holding page for a new employee. ONB-05 replaces it. */
@Component({
  selector: 'app-start',
  imports: [PpSignInPage, PpSignInActions, PpButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-sign-in-page [heading]="heading()" lead="Your password is set. Your onboarding steps will show here.">
      <pp-sign-in-actions><button ppButton appearance="default" size="large" type="button" (click)="signOut()">Sign out</button></pp-sign-in-actions>
    </pp-sign-in-page>
  `,
})
export class StartPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly heading = computed(() => `Welcome, ${this.auth.user()?.givenName ?? ''}`);
  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/sign-in');
  }
}
