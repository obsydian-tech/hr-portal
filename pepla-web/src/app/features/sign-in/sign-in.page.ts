import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PpButton, PpField, PpForm, PpLink, PpPassword, PpSectionMessage, PpSignInActions, PpSignInPage, PpTextField } from '../../ds';
import { feedbackReturn, isEmail, landingFor } from '../../core/auth/auth.errors';
import { RESET_MESSAGES, SIGN_IN_MESSAGES, SignInProblem } from '../../core/auth/auth.messages';
import { AuthService } from '../../core/auth/auth.service';
import { landingFor as firstPage } from '../../core/nav';
import { ROLE, rolesOf } from '../../core/roles';

/**
 * ONB-01 and ONB-23: HR and employees sign in here with an email and password. Spec: the ONB-01 card (NH-147).
 * The email and password are checked here before anything is sent. Every problem from Cognito
 * becomes one of a few plain messages; a wrong password and an unknown email read the same.
 */
@Component({
  selector: 'app-sign-in',
  imports: [FormsModule, RouterLink, PpLink, PpSignInPage, PpSignInActions, PpForm, PpField, PpTextField, PpPassword, PpButton, PpSectionMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-sign-in-page heading="Sign in">
      <form ppForm aria-label="Sign in" (ngSubmit)="submit()">
        <pp-field label="Email" [error]="emailError()">
          <input ppTextField type="email" name="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" [ngModel]="email()" (ngModelChange)="email.set($event)" />
        </pp-field>
        <pp-field label="Password" [error]="passwordError()">
          <pp-password autocomplete="current-password" [required]="true" [value]="password()" (valueChange)="password.set($event)" />
        </pp-field>
        @if (changed()) {
          <div role="status"><pp-section-message tone="success">{{ changedText }}</pp-section-message></div>
        }
        @if (problem(); as p) {
          @if (p === 'setPassword') {
            <div role="status"><pp-section-message tone="information">{{ messages[p] }}</pp-section-message></div>
          } @else {
            <pp-section-message tone="danger">{{ messages[p] }}</pp-section-message>
          }
        }
        <pp-sign-in-actions>
          <button ppButton appearance="primary" type="submit" [busy]="busy()">Sign in</button>
          <a ppLink routerLink="/forgot-password" [state]="{ email: email() }">Forgot your password?</a>
        </pp-sign-in-actions>
      </form>
    </pp-sign-in-page>
  `,
})
export class SignInPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly messages: Record<SignInProblem, string> = SIGN_IN_MESSAGES;
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly emailError = signal<string | null>(null);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly problem = signal<SignInProblem | null>(null);
  protected readonly busy = signal(false);
  protected readonly changedText = RESET_MESSAGES.changed;
  protected readonly changed = signal(false);

  constructor() {
    const state = this.router.getCurrentNavigation()?.extras.state as { email?: unknown; changed?: unknown } | undefined;
    if (typeof state?.email === 'string') this.email.set(state.email);
    if (state?.changed === true) this.changed.set(true);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.problem.set(null);
    this.changed.set(false);
    this.emailError.set(isEmail(this.email()) ? null : SIGN_IN_MESSAGES.badEmail);
    this.passwordError.set(this.password() ? null : SIGN_IN_MESSAGES.noPassword);
    if (this.emailError()) return this.focus('input[type="email"]');
    if (this.passwordError()) return this.focus('input[autocomplete="current-password"]');

    this.busy.set(true);
    const result = await this.auth.signIn(this.email(), this.password());
    this.busy.set(false);
    if (result.ok) {
      // An admin who is not HR (and not an employee) has no HR or employee page: they go to their own first page (CHAT-03).
      const { roles, perms } = rolesOf(result.user.groups);
      const adminOnly = roles.includes(ROLE.admin) && !roles.includes(ROLE.hrStaff);
      const back = this.route.snapshot.queryParamMap.get('returnUrl');
      const to = adminOnly && !feedbackReturn(back) ? firstPage(roles, perms, []) : landingFor(this.auth.isHr(), this.route.snapshot.queryParamMap.get('returnUrl'));
      await this.router.navigateByUrl(to);
      return;
    }
    this.problem.set(result.problem);
    // Only a wrong password empties the field. A connection problem keeps what was typed.
    if (result.problem === 'wrong') this.password.set('');
  }

  private focus(selector: string): void {
    this.host.querySelector<HTMLElement>(selector)?.focus();
  }
}
