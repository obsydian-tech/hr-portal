import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PpButton, PpField, PpForm, PpPassword, PpSectionMessage, PpSignInActions, PpSignInPage, PpTextField } from '../../ds';
import { isEmail, safeReturnUrl } from '../../core/auth/auth.errors';
import { SIGN_IN_MESSAGES, SignInProblem } from '../../core/auth/auth.messages';
import { AuthService } from '../../core/auth/auth.service';

/**
 * ONB-01: HR signs in with a work email and password. Spec: the ONB-01 card (NH-147).
 * The email and password are checked here before anything is sent. Every problem from Cognito
 * becomes one of a few plain messages; a wrong password and an unknown email read the same.
 */
@Component({
  selector: 'app-sign-in',
  imports: [FormsModule, PpSignInPage, PpSignInActions, PpForm, PpField, PpTextField, PpPassword, PpButton, PpSectionMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-sign-in-page heading="Sign in" footer="Forgot your password? Your Admin can send you a new link.">
      <form ppForm aria-label="Sign in" (ngSubmit)="submit()">
        <pp-field label="Email" [error]="emailError()">
          <input ppTextField type="email" name="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" [ngModel]="email()" (ngModelChange)="email.set($event)" />
        </pp-field>
        <pp-field label="Password" [error]="passwordError()">
          <pp-password autocomplete="current-password" [required]="true" [value]="password()" (valueChange)="password.set($event)" />
        </pp-field>
        @if (problem(); as p) {
          @if (p === 'setPassword') {
            <div role="status"><pp-section-message tone="information">{{ messages[p] }}</pp-section-message></div>
          } @else {
            <pp-section-message tone="danger">{{ messages[p] }}</pp-section-message>
          }
        }
        <pp-sign-in-actions>
          <button ppButton appearance="primary" type="submit" [busy]="busy()">Sign in</button>
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

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.problem.set(null);
    this.emailError.set(isEmail(this.email()) ? null : SIGN_IN_MESSAGES.badEmail);
    this.passwordError.set(this.password() ? null : SIGN_IN_MESSAGES.noPassword);
    if (this.emailError()) return this.focus('input[type="email"]');
    if (this.passwordError()) return this.focus('input[autocomplete="current-password"]');

    this.busy.set(true);
    const result = await this.auth.signIn(this.email(), this.password());
    this.busy.set(false);
    if (result.ok) {
      await this.router.navigateByUrl(safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'), '/hr'));
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
