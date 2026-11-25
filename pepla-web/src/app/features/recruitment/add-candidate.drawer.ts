import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import {
  PpAccordion, PpAccordionItem, PpButton, PpDrawer, PpDrawerFooter, PpErrorSummary, PpField, PpForm, PpInlineMessage, PpSectionMessage, PpSelect, PpTextField, type FormError,
} from '../../ds';
import { HireApi, newKey, type HireRole } from './hire-api';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLOSED = 'This role is closed. Choose another role.';
type Problems = Partial<Record<'first' | 'last' | 'email' | 'role' | 'phone', string>>;

/**
 * The Add candidate drawer (REC-UI-02 step 2). One component for the board, the Pipeline list and Candidates.
 * Role choices live in this component only, never in a store or in browser storage, so they cannot outlive a sign-out.
 * The form is drawn only while the drawer is open, so nothing typed survives a close.
 */
@Component({
  selector: 'app-add-candidate',
  imports: [PpAccordion, PpAccordionItem, PpButton, PpDrawer, PpDrawerFooter, PpErrorSummary, PpField, PpForm, PpInlineMessage, PpSectionMessage, PpSelect, PpTextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-drawer [(open)]="open" heading="Add candidate" description="Fill in the details to add a candidate to the pipeline." (closed)="reset()">
      @if (open()) {
      <form ppForm (submit)="$event.preventDefault(); submit()">
        @if (notFound()) { <pp-section-message tone="danger" heading="This role could not be found." /> }
        @if (failed()) { <pp-section-message tone="danger" heading="Your change could not be saved. Try again." /> }
        @if (summary().length) { <pp-error-summary [heading]="summaryHeading()" [errors]="summary()" /> }
        <pp-field label="First name" [error]="problems().first"><input ppTextField id="ac-first" maxlength="80" [value]="first()" (input)="first.set(val($event)); clear('first')" /></pp-field>
        <pp-field label="Last name" [error]="problems().last"><input ppTextField id="ac-last" maxlength="80" [value]="last()" (input)="last.set(val($event)); clear('last')" /></pp-field>
        <pp-field label="Email address" [error]="problems().email"><input ppTextField id="ac-email" type="email" maxlength="254" [value]="email()" (input)="email.set(val($event)); clear('email')" /></pp-field>
        <pp-field label="Role" [error]="rolesFailed() ? 'Role choices could not be loaded.' : problems().role" [help]="noRoles() ? 'No open roles yet' : undefined">
          <pp-select [options]="roleChoices()" placeholder="Choose a role" [value]="role()" (valueChange)="role.set($event); clear('role')" />
          @if (rolesFailed()) { <button ppButton type="button" (click)="loadRoles()">Try again</button> }
        </pp-field>
        <pp-accordion>
          <details ppAccordionItem heading="More details" meta="Phone, source">
            <pp-field label="Phone" [optional]="true" [error]="problems().phone"><input ppTextField id="ac-phone" placeholder="082 000 0000" [value]="phone()" (input)="phone.set(val($event)); clear('phone')" /></pp-field>
            <pp-field label="Source" [optional]="true"><pp-select [options]="sources" [value]="source()" (valueChange)="source.set($event ?? '')" /></pp-field>
          </details>
        </pp-accordion>
        @if (first().trim()) { <pp-inline-message>{{ first().trim() }} gets an email saying what we keep, why and for how long.</pp-inline-message> }
      </form>
      }
      <pp-drawer-footer>
        <button ppButton type="button" (click)="cancel()">Cancel</button>
        <button ppButton appearance="primary" icon="user-plus" type="button" [disabled]="busy() || rolesFailed() || noRoles()" (click)="submit()">Create candidate</button>
      </pp-drawer-footer>
    </pp-drawer>`,
})
export class AddCandidateDrawer {
  private readonly api = inject(HireApi);
  readonly startRole = input<string>('');
  readonly added = output<void>();
  protected readonly open = signal(false);
  protected readonly first = signal('');
  protected readonly last = signal('');
  protected readonly email = signal('');
  protected readonly role = signal<string | null>(null);
  protected readonly phone = signal('');
  protected readonly source = signal('');
  protected readonly roles = signal<HireRole[]>([]);
  protected readonly rolesFailed = signal(false);
  protected readonly rolesLoaded = signal(false);
  protected readonly problems = signal<Problems>({});
  protected readonly failed = signal(false);
  protected readonly notFound = signal(false);
  protected readonly busy = signal(false);
  protected readonly sources = [{ value: '', label: '' }, { value: 'Referral', label: 'Referral' }, { value: 'LinkedIn', label: 'LinkedIn' }];
  protected readonly roleChoices = computed(() => this.roles().map((r) => ({ value: r.role_id, label: r.job_title })));
  protected readonly noRoles = computed(() => this.rolesLoaded() && !this.rolesFailed() && this.roles().length === 0);
  protected readonly summary = computed<FormError[]>(() => {
    const fields: Array<[keyof Problems, string, string]> = [['first', 'First name', 'ac-first'], ['last', 'Last name', 'ac-last'], ['email', 'Email address', 'ac-email'], ['role', 'Role', ''], ['phone', 'Phone', 'ac-phone']];
    // A closed role shows on the Role field only; it is not a mistake in what was typed, so the summary leaves it out.
    return fields.filter(([k]) => this.problems()[k] && this.problems()[k] !== CLOSED).map(([k, label, id]) => ({ text: `${label}: ${this.problems()[k]}`, for: id }));
  });
  protected readonly summaryHeading = computed(() => { const n = this.summary().length; return `Fix ${n} ${n === 1 ? 'thing' : 'things'} to continue`; });
  private key = '';
  private sending = false;

  protected val(e: Event): string { return (e.target as HTMLInputElement).value; }
  protected clear(k: keyof Problems) { if (this.problems()[k]) this.problems.update((p) => { const { [k]: _, ...rest } = p; return rest; }); }

  async openIt() {
    this.reset();
    this.key = newKey();
    this.open.set(true);
    await this.loadRoles();
    const start = this.startRole();
    this.role.set(start && this.roles().some((r) => r.role_id === start) ? start : null);
  }

  protected async loadRoles() {
    const r = await this.api.call<{ roles: HireRole[] }>('GET', '/v1/roles?status=OPEN');
    this.rolesLoaded.set(true);
    if (!r || r.status !== 200) { this.rolesFailed.set(true); this.roles.set([]); return; }
    this.rolesFailed.set(false);
    this.roles.set(r.body.roles);
    if (this.role() && !r.body.roles.some((x) => x.role_id === this.role())) this.role.set(null);
  }

  protected reset() {
    this.first.set(''); this.last.set(''); this.email.set(''); this.role.set(null); this.phone.set(''); this.source.set('');
    this.problems.set({}); this.failed.set(false); this.notFound.set(false); this.busy.set(false); this.sending = false; this.rolesFailed.set(false); this.rolesLoaded.set(false);
  }

  protected cancel() { this.open.set(false); this.reset(); }

  private check(): Problems {
    const p: Problems = {};
    if (!this.first().trim()) p.first = 'Enter the first name';
    if (!this.last().trim()) p.last = 'Enter the last name';
    const e = this.email().trim();
    if (!e) p.email = 'Enter an email address'; else if (!EMAIL.test(e)) p.email = 'Enter an email address, like name@company.co.za';
    if (!this.role()) p.role = 'Choose a role';
    const ph = this.phone().trim(), digits = ph.replace(/\D/g, '').length;
    if (ph && (!/^\+?[\d ]+$/.test(ph) || digits < 9 || digits > 15)) p.phone = 'Use numbers and spaces only, like 081 234 5678.';
    return p;
  }

  protected async submit() {
    if (this.sending) return;
    const p = this.check();
    this.problems.set(p);
    if (Object.keys(p).length) return;
    this.sending = true;
    this.busy.set(true);
    this.failed.set(false); this.notFound.set(false);
    const body: Record<string, string> = { first_name: this.first().trim(), last_name: this.last().trim(), email: this.email().trim(), role_id: this.role()! };
    if (this.phone().trim()) body['phone'] = this.phone().trim();
    if (this.source()) body['source'] = this.source();
    const r = await this.api.call<{ code?: string }>('POST', '/v1/candidates', body, this.key);
    this.sending = false;
    this.busy.set(false);
    if (r && (r.status === 201 || r.status === 200)) { this.open.set(false); this.reset(); this.added.emit(); return; }
    if (r?.status === 409 && r.body?.code === 'ROLE_CLOSED') { this.problems.set({ role: CLOSED }); await this.loadRoles(); return; }
    if (r?.status === 404) { this.notFound.set(true); await this.loadRoles(); return; }
    this.failed.set(true);
  }
}
