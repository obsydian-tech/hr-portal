import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PpButton, PpField, PpForm, PpLink, PpPassword, PpSectionMessage, PpSignInActions, PpSignInPage, PpTextField } from '../../ds';
import { isEmail } from '../../core/auth/auth.errors';
import {
  PASSWORD_EMPTY,
  PASSWORD_GENERAL,
  PASSWORD_HELP,
  PASSWORD_RULE_LINES,
  PASSWORD_RULE_ORDER,
  RESET_MESSAGES,
  ResetProblem,
  SIGN_IN_MESSAGES,
  brokenRules,
} from '../../core/auth/auth.messages';
import { AuthService } from '../../core/auth/auth.service';

const WAIT = 30;

/** ONB-24 (THROWAWAY, not committed): forgot your password, two steps on one address. */
@Component({
  selector: 'app-forgot-password',
  imports: [FormsModule, RouterLink, PpSignInPage, PpSignInActions, PpForm, PpField, PpTextField, PpPassword, PpButton, PpLink, PpSectionMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (step() === 1) {
      <pp-sign-in-page heading="Reset your password" lead="Enter the email you sign in with. We'll send you a 6-digit code.">
        <form ppForm aria-label="Reset your password" (ngSubmit)="send()">
          <pp-field label="Email" [error]="emailError()">
            <input ppTextField type="email" name="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" [ngModel]="email()" (ngModelChange)="email.set($event)" />
          </pp-field>
          @if (problem(); as p) { <pp-section-message tone="danger">{{ p }}</pp-section-message> }
          <pp-sign-in-actions>
            <button ppButton appearance="primary" size="large" type="submit" [busy]="busy()">Send code</button>
            <a ppLink routerLink="/sign-in">Back to sign in</a>
          </pp-sign-in-actions>
        </form>
      </pp-sign-in-page>
    } @else {
      <pp-sign-in-page heading="Enter the code" [lead]="lead()" footer="Haven't set a password yet? Use the link in your welcome email.">
        <form ppForm aria-label="Enter the code" (ngSubmit)="change()">
          <pp-field label="Code" [error]="codeError()">
            <input ppTextField type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" [ngModel]="code()" (ngModelChange)="code.set($event)" />
          </pp-field>
          <pp-field label="New password" [help]="help" [error]="passwordError()">
            <pp-password autocomplete="new-password" [value]="password()" (valueChange)="password.set($event)" />
          </pp-field>
          @if (status()) { <div role="status"><pp-section-message tone="information">{{ status() }}</pp-section-message></div> }
          @if (problem(); as p) { <pp-section-message tone="danger">{{ p }}</pp-section-message> }
          <pp-sign-in-actions>
            <button ppButton appearance="primary" size="large" type="submit" [busy]="busy()">Change password</button>
          </pp-sign-in-actions>
          <button ppButton appearance="link" type="button" [disabled]="left() > 0" (click)="resend()">{{ left() > 0 ? 'Send a new code (' + left() + 's)' : 'Send a new code' }}</button>
          <button ppButton appearance="link" type="button" (click)="different()">Use a different email</button>
        </form>
      </pp-sign-in-page>
    }
  `,
})
export class ForgotPasswordPage implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly help = PASSWORD_HELP;
  protected readonly step = signal<1 | 2>(1);
  protected readonly email = signal('');
  protected readonly code = signal('');
  protected readonly password = signal('');
  protected readonly emailError = signal<string | null>(null);
  protected readonly codeError = signal<string | null>(null);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly status = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly left = signal(0);
  private timer: ReturnType<typeof setInterval> | null = null;
  private until = 0;

  protected readonly lead = computed(() => `If ${this.email().trim()} has a Naleko People account, a 6-digit code is on its way. It works for 1 hour.`);

  constructor() {
    const state = this.router.getCurrentNavigation()?.extras.state as { email?: unknown } | undefined;
    if (typeof state?.email === 'string') this.email.set(state.email);
    setTimeout(() => this.focus('input[type="email"]'));
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  protected async send(): Promise<void> {
    if (this.busy()) return;
    this.problem.set(null);
    if (!isEmail(this.email())) {
      this.emailError.set(SIGN_IN_MESSAGES.badEmail);
      return this.focus('input[type="email"]');
    }
    this.emailError.set(null);
    this.busy.set(true);
    const r = await this.auth.requestPasswordReset(this.email().trim());
    this.busy.set(false);
    if (!r.ok) return this.problem.set(this.words(r.problem));
    this.step.set(2);
    this.status.set(null);
    this.startWait();
    setTimeout(() => this.focus('input[autocomplete="one-time-code"]'));
  }

  protected async resend(): Promise<void> {
    if (this.busy() || this.left() > 0) return;
    this.problem.set(null);
    this.status.set(null);
    this.busy.set(true);
    const r = await this.auth.requestPasswordReset(this.email().trim());
    this.busy.set(false);
    if (!r.ok) return this.problem.set(this.words(r.problem));
    this.status.set(RESET_MESSAGES.newCodeSent);
    this.startWait();
  }

  protected different(): void {
    this.step.set(1);
    this.problem.set(null);
    this.status.set(null);
    this.code.set('');
    this.password.set('');
    setTimeout(() => this.focus('input[type="email"]'));
  }

  protected async change(): Promise<void> {
    if (this.busy()) return;
    this.problem.set(null);
    this.status.set(null);
    const code = this.code().trim();
    const p = this.password();
    this.codeError.set(!code ? RESET_MESSAGES.codeEmpty : /^\d{6}$/.test(code) ? null : RESET_MESSAGES.codeSix);
    const rules = brokenRules(p);
    this.passwordError.set(!p ? PASSWORD_EMPTY : rules.length ? this.lines(rules) : null);
    if (this.codeError()) return this.focus('input[autocomplete="one-time-code"]');
    if (this.passwordError()) return this.focus('input[autocomplete="new-password"]');
    this.busy.set(true);
    const r = await this.auth.confirmPasswordReset(this.email().trim(), code, p);
    this.busy.set(false);
    if (r.ok) {
      await this.router.navigateByUrl('/sign-in', { state: { email: this.email().trim(), changed: true } });
      return;
    }
    if (r.problem === 'wrongCode') {
      this.codeError.set(RESET_MESSAGES.wrongCode);
      return this.focus('input[autocomplete="one-time-code"]');
    }
    if (r.problem === 'badPassword') {
      this.passwordError.set(PASSWORD_GENERAL);
      return this.focus('input[autocomplete="new-password"]');
    }
    this.problem.set(this.words(r.problem));
  }

  private words(p: ResetProblem): string {
    if (p === 'tooMany') return SIGN_IN_MESSAGES.tooMany;
    if (p === 'offline') return SIGN_IN_MESSAGES.offline;
    if (p === 'expired') return RESET_MESSAGES.expired;
    return RESET_MESSAGES.other;
  }

  private lines(rules: string[]): string {
    return rules
      .filter((r) => r in PASSWORD_RULE_LINES)
      .sort((a, b) => PASSWORD_RULE_ORDER.indexOf(a) - PASSWORD_RULE_ORDER.indexOf(b))
      .map((r) => PASSWORD_RULE_LINES[r])
      .join(' ');
  }

  private startWait(): void {
    this.until = Date.now() + WAIT * 1000;
    this.left.set(WAIT);
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      const s = Math.max(0, Math.ceil((this.until - Date.now()) / 1000));
      this.left.set(s);
      if (s === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }, 1000);
  }

  private focus(selector: string): void {
    setTimeout(() => this.host.querySelector<HTMLElement>(selector)?.focus());
  }
}
