import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationCancel, NavigationEnd, NavigationError, Router } from '@angular/router';
import { filter, firstValueFrom, take } from 'rxjs';
import { PpButton, PpField, PpForm, PpPassword, PpSectionMessage, PpSignInActions, PpSignInPage, PpSkeleton, PpSkeletonGroup, PpTextField } from '../../ds';
import { PASSWORD_EMPTY, PASSWORD_GENERAL, PASSWORD_HELP, PASSWORD_RULE_LINES, PASSWORD_RULE_ORDER, SIGN_IN_MESSAGES, brokenRules } from '../../core/auth/auth.messages';
import { AuthService } from '../../core/auth/auth.service';
import { InviteService } from '../../core/auth/invite.service';

const RULE_LINES = PASSWORD_RULE_LINES;
const ORDER = PASSWORD_RULE_ORDER;
const GENERAL = PASSWORD_GENERAL;
const broken = brokenRules;

/** A mangled link (a stray % in the address) is a broken link, not a crash. */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

type State = 'loading' | 'unreachable' | 'form' | 'expired' | 'signInFailed';

@Component({
  selector: 'app-set-password',
  imports: [FormsModule, PpSignInPage, PpSignInActions, PpForm, PpField, PpTextField, PpPassword, PpButton, PpSectionMessage, PpSkeletonGroup, PpSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-sign-in-page [heading]="state() === 'expired' ? 'This link has expired' : 'Set your password'" [company]="state() === 'form' ? companyLine() : undefined" [lead]="state() === 'expired' ? expiredLead() : undefined">
      @switch (state()) {
        @case ('loading') {
          <pp-skeleton-group label="Checking your link"><pp-skeleton shape="field" /><pp-skeleton shape="button" /></pp-skeleton-group>
        }
        @case ('unreachable') {
          <pp-section-message tone="danger">{{ offline }}</pp-section-message>
          <pp-sign-in-actions><button ppButton appearance="primary" size="large" type="button" (click)="lookup()">Try again</button></pp-sign-in-actions>
        }
        @case ('signInFailed') {
          <pp-section-message tone="danger">Your password is set, but signing in did not work. Try again.</pp-section-message>
          <pp-sign-in-actions><button ppButton appearance="primary" size="large" type="button" [busy]="busy()" (click)="signIn()">Try again</button></pp-sign-in-actions>
        }
        @case ('form') {
          <form ppForm aria-label="Set your password" (ngSubmit)="submit()">
            <pp-field label="Email">
              <input ppTextField type="email" name="email" autocomplete="username" readonly [value]="email()" />
            </pp-field>
            <pp-field label="New password" [help]="help" [error]="passwordError()">
              <pp-password autocomplete="new-password" [value]="password()" (valueChange)="password.set($event)" />
            </pp-field>
            @if (problem(); as p) { <pp-section-message tone="danger">{{ p }}</pp-section-message> }
            <pp-sign-in-actions>
              <button ppButton appearance="primary" size="large" type="submit" [busy]="busy()">Set password and continue</button>
            </pp-sign-in-actions>
          </form>
        }
      }
    </pp-sign-in-page>
  `,
})
export class SetPasswordPage {
  private readonly invites = inject(InviteService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly offline = SIGN_IN_MESSAGES.offline;
  protected readonly help = PASSWORD_HELP;
  private readonly token: string | null;
  protected readonly state = signal<State>('loading');
  protected readonly email = signal('');
  private readonly company = signal('');
  private readonly partner = signal('');
  private readonly startDate = signal<string | undefined>(undefined);
  protected readonly password = signal('');
  protected readonly passwordError = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly companyLine = computed(() => {
    const d = this.startDate();
    if (!d) return this.company();
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return this.company();
    const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed);
    return `${this.company()} · Starts ${when}`;
  });
  protected readonly expiredLead = computed(() =>
    this.company() && this.partner()
      ? `Links work once and for 7 days. ${this.partner()} at ${this.company()} can send you a new one.`
      : 'Links work once and for 7 days. HR at your new company can send you a new one.',
  );

  constructor() {
    const m = /(?:^#|&)token=([^&]*)/.exec(window.location.hash);
    this.token = m && m[1] ? safeDecode(m[1]) : null;
    void firstValueFrom(this.router.events.pipe(filter((e) => e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError), take(1))).then(() => {
      history.replaceState(history.state, '', window.location.pathname + window.location.search);
      if (!this.token) return this.state.set('expired');
      void this.lookup();
    });
  }

  protected async lookup(): Promise<void> {
    if (!this.token) return this.state.set('expired');
    this.state.set('loading');
    const r = await this.invites.lookup(this.token);
    if (r.status === 'unreachable') return this.state.set('unreachable');
    if (r.status === 'ok') {
      this.email.set(r.email);
      this.company.set(r.company);
      this.partner.set(r.hrPartnerName);
      this.startDate.set(r.startDate);
      this.state.set('form');
      setTimeout(() => this.focus());
      return;
    }
    if (r.status === 'expired' || r.status === 'used') {
      this.company.set(r.company ?? '');
      this.partner.set(r.hrPartnerName ?? '');
    }
    this.state.set('expired');
  }

  protected async submit(): Promise<void> {
    if (this.busy() || !this.token) return;
    this.problem.set(null);
    const p = this.password();
    if (!p) return this.showRules(null, PASSWORD_EMPTY);
    const rules = broken(p);
    if (rules.length) return this.showRules(rules);
    this.passwordError.set(null);
    this.busy.set(true);
    const r = await this.invites.redeem(this.token, p);
    this.busy.set(false);
    if (r.ok) return this.signIn();
    if (r.kind === 'rules') return this.showRules(r.rules);
    if (r.kind === 'gone') return this.state.set('expired');
    if (r.kind === 'failed') return this.problem.set('Could not set the password. Try again.');
    this.problem.set(this.offline);
  }

  protected async signIn(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    const ok = await this.auth.signInNewEmployee(this.email(), this.password());
    this.busy.set(false);
    if (ok) {
      await this.router.navigateByUrl('/start');
      return;
    }
    this.state.set('signInFailed');
  }

  private showRules(rules: string[] | null, text?: string): void {
    const known = (rules ?? []).filter((r) => r in RULE_LINES).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    this.passwordError.set(text ?? (known.length ? known.map((r) => RULE_LINES[r]).join(' ') : GENERAL));
    setTimeout(() => this.focus());
  }

  private focus(): void {
    this.host.querySelector<HTMLElement>('input[autocomplete="new-password"]')?.focus();
  }
}
