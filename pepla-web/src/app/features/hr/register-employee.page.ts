import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  PpButton, PpButtonGroup, PpCard, PpCardAside, PpDatePicker, PpDl, PpErrorSummary, PpField, PpForm, PpFormFooter, PpFormRow, PpFormSection, PpInlineMessage, PpPageHeader,
  PpProgressTracker, PpRadioGroup, PpSectionMessage, PpSectionMessageActions, PpSelect, PpTextField,
  type FormError, type Option, type Step,
} from '../../ds';
import { AuthService } from '../../core/auth/auth.service';
import { RegistrationService, type HrPartner, type Registered } from '../../core/employees/registration.service';

const DEPARTMENTS: Option[] = ['Engineering', 'Finance', 'Operations', 'People'].map((d) => ({ value: d, label: d }));
const STEP_NAMES = ['Personal information', 'Job and start date', 'HR partner', 'Confirmation'] as const;
const NEXT_WORDS = ['Next: job and start date', 'Next: HR partner', 'Next: check details'] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isoOf(d: Date | null): string {
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dateOf(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!) : null;
}
function words(iso: string): string {
  const d = dateOf(iso);
  return d ? new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }).format(d).replace(/\./g, '') : '';
}

/** South African ID number: 13 digits, a real date, and the check digit. */
function validId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  const yy = +id.slice(0, 2), mm = +id.slice(2, 4), dd = +id.slice(4, 6);
  const real = (y: number) => { const x = new Date(Date.UTC(y, mm - 1, dd)); return x.getUTCFullYear() === y && x.getUTCMonth() === mm - 1 && x.getUTCDate() === dd; };
  if (!real(1900 + yy) && !real(2000 + yy)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let n = +id[12 - i]!;
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

type Problems = Record<string, string>;

/**
 * Register a new employee (ONB-03): four steps, then a page that says the person is registered.
 * The draft lives in the browser tab for the visit; the ID number lives in memory only.
 */
@Component({
  selector: 'app-register-employee',
  imports: [
    RouterLink, PpButton, PpButtonGroup, PpCard, PpCardAside, PpDatePicker, PpDl, PpErrorSummary, PpField, PpForm, PpFormFooter, PpFormRow, PpFormSection, PpInlineMessage,
    PpPageHeader, PpProgressTracker, PpRadioGroup, PpSectionMessage, PpSectionMessageActions, PpSelect, PpTextField,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (registered(); as r) {
      <pp-page-header [heading]="r.name + ' is registered'" [breadcrumbs]="crumbs" />
      <div class="pp-stack pp-gap-300 pp-measure-reading">
        <pp-section-message tone="success" [heading]="r.name + ' has been added.'">{{ r.firstName }} uploads their documents after they sign in.</pp-section-message>
        <pp-card heading="Sign-in details" [level]="2">
          <dl ppDl>
            <dt>Email</dt><dd>{{ r.email }}</dd>
          </dl>
          @if (r.emailSent) {
            <pp-inline-message tone="success" icon="mail">A welcome email was sent to {{ r.email }}.</pp-inline-message>
          } @else {
            <pp-inline-message tone="warning">The welcome email was not sent. {{ r.firstName }} can still be sent a new one later.</pp-inline-message>
          }
        </pp-card>
        <div class="pp-inline pp-gap-100">
          @if (r.employeeId) { <a ppButton appearance="primary" icon="user" [routerLink]="['/hr/employees', r.employeeId]">View employee</a> }
          <button ppButton type="button" icon="user-plus" (click)="another()">Register another</button>
          <a ppButton appearance="subtle" icon="house" routerLink="/hr">Back to home</a>
        </div>
      </div>
    } @else {
      <pp-page-header heading="Register a new employee" [description]="description()" [breadcrumbs]="crumbs" />
      <div class="pp-stack pp-gap-300">
        <pp-progress-tracker label="Register a new employee" [steps]="tracker()" />

        @switch (step()) {
          @case (1) {
            <form ppForm [wide]="true" [raised]="true" (submit)="$event.preventDefault(); next()">
              <fieldset ppFormSection heading="Personal details" description="As on their ID. All fields are required unless marked optional.">
                @if (summary().length) { <pp-error-summary [heading]="summaryHeading()" [errors]="summary()" /> }
                <pp-form-row [columns]="3">
                  <pp-field label="First name" [error]="problems()['first']">
                    <input ppTextField id="reg-first" autocomplete="off" placeholder="For example Sarah" [value]="d().firstName" (input)="set({ firstName: val($event) }, 'first')" />
                  </pp-field>
                  <pp-field label="Middle name" [optional]="true">
                    <input ppTextField id="reg-middle" autocomplete="off" [value]="d().middleName" (input)="set({ middleName: val($event) })" />
                  </pp-field>
                  <pp-field label="Last name" [error]="problems()['last']">
                    <input ppTextField id="reg-last" autocomplete="off" placeholder="For example Nkosi" [value]="d().lastName" (input)="set({ lastName: val($event) }, 'last')" />
                  </pp-field>
                </pp-form-row>
                <pp-field label="Email address" [error]="problems()['email']" [help]="emailHelp()">
                  <div class="pp-inline pp-gap-100">
                    <div class="pp-grow"><input ppTextField id="reg-email" type="email" autocomplete="off" [value]="d().email" (input)="set({ email: val($event) }, 'email'); emailState.set('idle')" /></div>
                    <button ppButton type="button" icon="search" [busy]="emailState() === 'checking'" (click)="checkEmail()">Check email</button>
                  </div>
                </pp-field>
                <pp-form-row>
                  <pp-field label="Phone number" [error]="problems()['phone']">
                    <input ppTextField id="reg-phone" type="tel" autocomplete="off" [value]="d().phone" (input)="set({ phone: val($event) }, 'phone')" />
                  </pp-field>
                  <pp-field label="ID number" [optional]="true" help="13 digits. Optional. Batsi compares it with the ID document." [error]="problems()['id']">
                    <input ppTextField id="reg-id" inputmode="numeric" autocomplete="off" [value]="reg.idNumber()" (input)="reg.idNumber.set(val($event)); clear('id')" />
                  </pp-field>
                </pp-form-row>
              </fieldset>
              <pp-form-footer [status]="saved()" statusIcon="check">
                <pp-button-group [stackPhone]="true">
                  <button ppButton type="button" (click)="cancel()">Cancel</button>
                  <button ppButton type="submit" appearance="primary" iconAfter="arrow-right" [busy]="checking()">{{ nextWords() }}</button>
                </pp-button-group>
              </pp-form-footer>
            </form>
          }
          @case (2) {
            <form ppForm [wide]="true" [raised]="true" (submit)="$event.preventDefault(); next()">
              <fieldset ppFormSection heading="Job and start date" description="All fields are required unless marked optional.">
                @if (summary().length) { <pp-error-summary [heading]="summaryHeading()" [errors]="summary()" /> }
                <pp-form-row>
                  <pp-field #fDept label="Department" [error]="problems()['department']">
                    <pp-select [options]="departments" placeholder="Choose a department" [value]="d().department || null" (valueChange)="set({ department: $event ?? '' }, 'department')" />
                  </pp-field>
                  <pp-field label="Job title" [error]="problems()['job']">
                    <input ppTextField id="reg-job" autocomplete="off" placeholder="For example Bookkeeper" [value]="d().jobTitle" (input)="set({ jobTitle: val($event) }, 'job')" />
                  </pp-field>
                </pp-form-row>
                <pp-form-row>
                  <pp-field #fStart label="Start date" [error]="problems()['start']">
                    <pp-date-picker [value]="startDate()" (valueChange)="set({ startDate: iso($event) }, 'start')" />
                  </pp-field>
                  <pp-field label="Offer accepted" [optional]="true">
                    <pp-date-picker [value]="offerDate()" (valueChange)="set({ offerDate: iso($event) })" />
                  </pp-field>
                </pp-form-row>
              </fieldset>
              <pp-form-footer [status]="saved()" statusIcon="check">
                <pp-button-group [stackPhone]="true">
                  <button ppButton type="button" icon="arrow-left" (click)="previous()">Previous</button>
                  <button ppButton type="submit" appearance="primary" iconAfter="arrow-right">{{ nextWords() }}</button>
                </pp-button-group>
              </pp-form-footer>
            </form>
          }
          @case (3) {
            <form ppForm [wide]="true" [raised]="true" (submit)="$event.preventDefault(); next()">
              <fieldset ppFormSection heading="HR partner" [description]="'The HR partner follows ' + d().firstName + '\\'s documents and decides each one.'">
                @if (summary().length) { <pp-error-summary [heading]="summaryHeading()" [errors]="summary()" /> }
                @if (partnerStatus() === 'loading') {
                  <p class="pp-text" role="status">Loading HR partners.</p>
                } @else if (partnerStatus() === 'failed') {
                  <pp-section-message tone="danger" heading="HR partners could not be loaded.">
                    Check your connection and try again.
                    <pp-section-message-actions><button ppButton type="button" (click)="loadPartners()">Try again</button></pp-section-message-actions>
                  </pp-section-message>
                } @else {
                  <pp-field group="radio" options="tiles" label="Choose an HR partner" [error]="problems()['partner']">
                    <pp-radio-group [tiles]="true" [options]="partnerOptions()" [value]="d().partnerId || null" (valueChange)="set({ partnerId: $event ?? '' }, 'partner')" />
                  </pp-field>
                }
              </fieldset>
              <pp-form-footer [status]="saved()" statusIcon="check">
                <pp-button-group [stackPhone]="true">
                  <button ppButton type="button" icon="arrow-left" (click)="previous()">Previous</button>
                  <button ppButton type="submit" appearance="primary" iconAfter="arrow-right" [disabled]="partnerStatus() !== 'ready'">{{ nextWords() }}</button>
                </pp-button-group>
              </pp-form-footer>
            </form>
          }
          @case (4) {
            <div ppForm [wide]="true" class="pp-stack pp-gap-200">
              @if (registerFailed()) {
                <pp-section-message tone="danger" heading="Registering did not work. Your answers are kept.">
                  <pp-section-message-actions><button ppButton type="button" (click)="register()">Try again</button></pp-section-message-actions>
                </pp-section-message>
              }
              <div class="pp-grid pp-grid--2 pp-gap-200">
                <pp-card heading="Personal details" [level]="2" icon="user">
                  <pp-card-aside><button ppButton appearance="subtle" size="small" icon="pencil" type="button" aria-label="Edit personal details" (click)="go(1)">Edit</button></pp-card-aside>
                  <dl ppDl>
                    <dt>Full name</dt><dd>{{ fullName() }}</dd>
                    <dt>Email</dt><dd>{{ d().email.trim() }}</dd>
                    <dt>Phone</dt><dd>{{ d().phone }}</dd>
                    @if (reg.idNumber().trim()) { <dt>ID number</dt><dd>{{ hiddenId() }}</dd> }
                  </dl>
                </pp-card>
                <pp-card heading="Job and start date" [level]="2" icon="user-plus">
                  <pp-card-aside><button ppButton appearance="subtle" size="small" icon="pencil" type="button" aria-label="Edit job and start date" (click)="go(2)">Edit</button></pp-card-aside>
                  <dl ppDl>
                    <dt>Department</dt><dd>{{ d().department }}</dd>
                    <dt>Job title</dt><dd>{{ d().jobTitle }}</dd>
                    @if (d().offerDate) { <dt>Offer accepted</dt><dd>{{ words(d().offerDate) }}</dd> }
                    <dt>Start date</dt><dd>{{ words(d().startDate) }}</dd>
                  </dl>
                </pp-card>
              </div>
              <pp-inline-message tone="agent">{{ d().firstName }} uploads their documents after they sign in. Batsi checks the ID and bank letter, and you decide each one.</pp-inline-message>
              <pp-card heading="Assigned HR partner" [level]="2" icon="users">
                <dl ppDl>
                  <dt>Name</dt><dd>{{ chosen()?.name }}</dd>
                  <dt>Staff ID</dt><dd>{{ chosen()?.staffId }}</dd>
                  <dt>Email</dt><dd>{{ chosen()?.email }}</dd>
                </dl>
              </pp-card>
              <pp-form-footer status="Registering is recorded with your name and the time." statusIcon="history">
                <pp-button-group [stackPhone]="true">
                  <button ppButton type="button" icon="arrow-left" (click)="previous()">Previous</button>
                  <button ppButton type="button" appearance="primary" icon="check" [busy]="registering()" (click)="register()">Register {{ d().firstName }}</button>
                </pp-button-group>
              </pp-form-footer>
            </div>
          }
        }
      </div>
    }
  `,
})
export class RegisterEmployeePage {
  protected readonly reg = inject(RegistrationService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly departments = DEPARTMENTS;
  protected readonly crumbs = [{ label: 'Home', link: '/hr' }, { label: 'Register a new employee', link: '/hr/employees/new' }];
  protected readonly d = this.reg.draft;
  protected readonly step = computed(() => this.reg.draft().step);
  protected readonly problems = signal<Problems>({});
  protected readonly emailState = signal<'idle' | 'checking' | 'inUse' | 'free'>('idle');
  protected readonly checking = signal(false);
  protected readonly registering = signal(false);
  protected readonly registerFailed = signal(false);
  protected readonly registered = signal<Registered | null>(null);
  protected readonly partners = signal<HrPartner[]>([]);
  protected readonly partnerStatus = signal<'loading' | 'ready' | 'failed'>('loading');
  private readonly fDept = viewChild<PpField>('fDept');
  private readonly fStart = viewChild<PpField>('fStart');

  protected readonly words = words;
  protected readonly startDate = computed(() => dateOf(this.d().startDate));
  protected readonly offerDate = computed(() => dateOf(this.d().offerDate));
  protected readonly fullName = computed(() => [this.d().firstName, this.d().middleName, this.d().lastName].map((x) => x.trim()).filter(Boolean).join(' '));
  protected readonly saved = computed(() => (this.reg.savedAt() ? `Draft saved ${this.reg.savedAt()}` : undefined));
  protected readonly nextWords = computed(() => NEXT_WORDS[this.step() - 1] ?? '');
  protected readonly hiddenId = computed(() => `•••••••••${this.reg.idNumber().trim().slice(-4)}`);
  protected readonly chosen = computed(() => this.partners().find((p) => p.id === this.d().partnerId));
  protected readonly partnerOptions = computed<Option[]>(() => this.partners().map((p) => ({ value: p.id, label: p.name, description: `Staff ID ${p.staffId} · ${p.email}` })));
  protected readonly description = computed(() =>
    this.step() === 4 ? `Check the details, then register ${this.d().firstName}.` : 'Complete all steps to register a new employee in onboarding.');
  protected readonly emailHelp = computed(() => {
    const s = this.emailState();
    return s === 'free' ? 'This email is not used yet.' : 'Batsi checks that no one else uses this email. The welcome email goes here.';
  });
  protected readonly tracker = computed<Step[]>(() =>
    STEP_NAMES.map((label, i) => {
      const n = i + 1, cur = this.step();
      return n < cur ? { label, state: 'done', meta: 'Done' } : n === cur ? { label, state: 'current', meta: `Step ${n} of 4` } : { label, state: 'upcoming' };
    }));
  protected readonly summary = computed<FormError[]>(() => {
    const labels: Record<string, [string, string]> = {
      first: ['First name', 'reg-first'], last: ['Last name', 'reg-last'], email: ['Email address', 'reg-email'], phone: ['Phone number', 'reg-phone'], id: ['ID number', 'reg-id'],
      department: ['Department', this.fDept()?.controlId ?? ''], job: ['Job title', 'reg-job'], start: ['Start date', this.fStart()?.controlId ?? ''], partner: ['HR partner', ''],
    };
    return Object.entries(this.problems()).map(([k, text]) => ({ text: `${labels[k]![0]}: ${text}`, for: labels[k]![1] }));
  });
  protected readonly summaryHeading = computed(() => {
    const n = this.summary().length;
    return `Fix ${n} ${n === 1 ? 'thing' : 'things'} to continue`;
  });

  constructor() {
    // A reload on a later step comes back to it; a draft with no partner list yet loads it.
    effect(() => { if (this.step() === 3 && this.partnerStatus() === 'loading') void this.loadPartners(); });
    if (this.step() === 3) void this.loadPartners();
  }

  protected val(e: Event): string { return (e.target as HTMLInputElement).value; }
  protected iso(d: Date | null): string { return isoOf(d); }
  protected clear(key: string): void {
    if (this.problems()[key]) this.problems.update((p) => { const { [key]: _, ...rest } = p; return rest; });
  }
  protected set(change: Parameters<RegistrationService['patch']>[0], clearKey?: string): void {
    this.reg.patch(change);
    if (clearKey) this.clear(clearKey);
  }

  protected go(step: number): void { this.problems.set({}); this.reg.patch({ step }); }
  protected previous(): void { this.go(this.step() - 1); }
  protected cancel(): void { this.reg.clear(); void this.router.navigateByUrl('/hr'); }
  protected another(): void { this.reg.clear(); this.registered.set(null); this.problems.set({}); this.emailState.set('idle'); this.partnerStatus.set('loading'); }

  protected async checkEmail(): Promise<void> {
    const email = this.d().email.trim();
    if (!EMAIL.test(email)) { this.problems.update((p) => ({ ...p, email: 'Enter an email address, like name@company.co.za' })); return; }
    this.emailState.set('checking');
    try {
      const inUse = await this.reg.emailInUse(email);
      this.emailState.set(inUse ? 'inUse' : 'free');
      if (inUse) this.problems.update((p) => ({ ...p, email: 'This email is already in use' }));
      else this.clear('email');
    } catch {
      this.emailState.set('idle');
    }
  }

  protected async loadPartners(): Promise<void> {
    this.partnerStatus.set('loading');
    try {
      const items = await this.reg.partners();
      this.partners.set(items);
      this.partnerStatus.set('ready');
      if (!this.d().partnerId || !items.some((p) => p.id === this.d().partnerId)) {
        const me = this.auth.user();
        const mine = me ? items.find((p) => p.email.toLowerCase() === me.email.toLowerCase()) : undefined;
        this.reg.patch({ partnerId: mine?.id ?? '' });
      }
    } catch {
      this.partnerStatus.set('failed');
    }
  }

  private check(step: number): Problems {
    const d = this.d(), p: Problems = {};
    if (step === 1) {
      if (!d.firstName.trim()) p['first'] = 'Enter the first name';
      if (!d.lastName.trim()) p['last'] = 'Enter the last name';
      if (!d.email.trim()) p['email'] = 'Enter an email address';
      else if (!EMAIL.test(d.email.trim())) p['email'] = 'Enter an email address, like name@company.co.za';
      const digits = d.phone.replace(/\D/g, '').length;
      if (!d.phone.trim()) p['phone'] = 'Enter a phone number';
      else if (!/^\+?[\d ]+$/.test(d.phone.trim()) || digits < 9 || digits > 15) p['phone'] = 'Use numbers and spaces only, like 081 234 5678.';
      const id = this.reg.idNumber().trim();
      if (id && !validId(id)) p['id'] = 'Check the ID number. It has 13 digits.';
    } else if (step === 2) {
      if (!d.department) p['department'] = 'Choose a department';
      if (!d.jobTitle.trim()) p['job'] = 'Enter the job title';
      if (!d.startDate) p['start'] = 'Choose a start date';
    } else if (step === 3) {
      if (!d.partnerId) p['partner'] = 'Choose an HR partner';
    }
    return p;
  }

  protected async next(): Promise<void> {
    const step = this.step();
    const found = this.check(step);
    if (Object.keys(found).length) { this.problems.set(found); return; }
    if (step === 1) {
      this.checking.set(true);
      try {
        const inUse = await this.reg.emailInUse(this.d().email.trim());
        this.emailState.set(inUse ? 'inUse' : 'free');
        if (inUse) { this.problems.set({ email: 'This email is already in use' }); return; }
      } catch {
        // The check could not be made: the POST's 409 is the backstop.
      } finally {
        this.checking.set(false);
      }
    }
    this.go(step + 1);
  }

  protected async register(): Promise<void> {
    if (this.registering()) return;
    this.registering.set(true);
    this.registerFailed.set(false);
    const result = await this.reg.register();
    this.registering.set(false);
    if (result.ok) { this.registered.set(result.registered); return; }
    if (result.reason === 'duplicate') { this.reg.patch({ step: 1 }); this.problems.set({ email: 'This email is already in use' }); this.emailState.set('inUse'); return; }
    this.registerFailed.set(true);
  }
}
