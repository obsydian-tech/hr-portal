import { ChangeDetectionStrategy, Component, Injectable, OnInit, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  PpAccordion, PpAccordionItem, PpButton, PpCard, PpDrawer, PpDrawerFooter, PpCardFooter, PpDl, PpField, PpForm, PpMaskedField, PpRadioGroup, PpModalDialog, PpModalFooter, PpPersonHeader, PpRevealLog,
  PpSectionMessage, PpTextField, PpTextFieldGroup, PpTextarea, type Reveal,
} from '../../ds';
import { AuthService } from '../../core/auth/auth.service';
import { PERM, ROLE, rolesOf } from '../../core/roles';
import { HireApi, newKey, type HireResponse } from './hire-api';
import { OFFER_TONE, OFFER_WORD, dayOf, money, todayIso, type Offer } from './offer-words';

/** REC-UI-04: the salary reveal asks the server once and hands the value to the field. */
@Injectable()
class OfferRevealLog extends PpRevealLog {
  private readonly api = inject(HireApi);
  override async log(r: Reveal): Promise<string> {
    const res = await this.api.call<Offer>('GET', `/v1/offers/${String(r.ref)}?reveal=salary`);
    if (!res || res.status !== 200 || typeof res.body?.salary !== 'number') throw new Error('not shown');
    return `${money(res.body.salary)} ZAR`;
  }
}

type Form = { salary: string; start: string; expiry: string; benefits: string };
const LINES: Record<string, string> = {
  NO_APPROVER: 'No one else can approve offers yet. Ask an Admin to give someone the Approve offers tick.',
  OFFER_EXISTS: 'This candidate already has an open offer.',
  NOTE_REQUIRED: 'Say what needs to change.',
  NOT_APPROVED: 'This offer is not approved yet.',
  NOT_SENT: 'This offer has changed. It now shows its latest state.', NOT_OPEN: 'This offer has changed. It now shows its latest state.',
  STALE: 'This offer has changed. It now shows its latest state.', NOT_DRAFT: 'This offer has changed. It now shows its latest state.',
  NOT_WAITING: 'This offer has changed. It now shows its latest state.',
  INVALID_SIGNED_KEY: 'The signed copy could not be checked. Upload it again.',
};
const FIELD_LINES: Record<string, string> = {
  salary: 'Enter a salary above 0.', start_date: 'Choose a start date after today.', expiry_date: 'Choose a date after today and on or before the start date.', benefits: 'Keep benefits to 2000 characters.',
};
const GENERIC = 'Your change could not be saved. Try again.';

@Component({
  selector: 'app-offer-page',
  imports: [PpAccordion, PpAccordionItem, PpButton, PpCard, PpCardFooter, PpDl, PpDrawer, PpDrawerFooter, PpField, PpForm, PpMaskedField, PpRadioGroup, PpModalDialog, PpModalFooter, PpPersonHeader, PpSectionMessage, PpTextField, PpTextFieldGroup, PpTextarea],
  providers: [{ provide: PpRevealLog, useClass: OfferRevealLog }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-200">
      @if (status() === 'notfound') {
        <pp-section-message tone="danger" heading="This offer could not be found." />
      } @else if (status() === 'failed') {
        <pp-section-message tone="danger" heading="Your change could not be saved. Try again." />
      } @else if (status() === 'ready') {
        @if (o(); as x) { <pp-person-header [name]="x.candidate_name ?? ''" [role]="(x.role_title ?? '') + (x.department ? ' · ' + x.department : '')" /> }
        <pp-card heading="Offer" [level]="2" [subheading]="subtitle()">
          @if (line()) { <pp-section-message [tone]="'warning'" [heading]="line()!" /> }
          <div class="pp-inline pp-gap-100"><span [class]="'pp-lozenge' + (tone() ? ' pp-lozenge--' + tone() : '')">{{ word() }}</span></div>
          @if (state() === 'DRAFT') {
            @if (sentBack(); as sb) { <pp-section-message tone="warning" [heading]="sb.by + ' sent this back:'">{{ sb.note }}</pp-section-message> }
            @if (o(); as x) { <dl ppDl><dt>Role</dt><dd>{{ x.role_title }}</dd><dt>Department</dt><dd>{{ x.department }}</dd></dl> }
            <form ppForm (submit)="$event.preventDefault()">
              <pp-field label="Salary" [error]="problems()['salary']">
                <pp-text-field-group suffix="ZAR" [numeric]="true"><input ppTextField id="of-salary" inputmode="decimal" [value]="form().salary" (input)="set('salary', $event)" /></pp-text-field-group>
              </pp-field>
              <pp-field label="Start date" [error]="problems()['start_date']"><input ppTextField id="of-start" type="date" [value]="form().start" (input)="set('start', $event)" /></pp-field>
              <pp-field label="Offer expires" [error]="problems()['expiry_date']"><input ppTextField id="of-expiry" type="date" [value]="form().expiry" (input)="set('expiry', $event)" /></pp-field>
              <pp-field label="Benefits" [optional]="true" [error]="problems()['benefits']"><textarea ppTextarea id="of-benefits" [value]="form().benefits" (input)="set('benefits', $event)"></textarea></pp-field>
            </form>
          } @else {
            <dl ppDl>
              @for (f of facts(); track f[0]) { <dt>{{ f[0] }}</dt><dd>{{ f[1] }}</dd> }
            </dl>
          }
          @if (drafterLine()) { <p class="pp-text pp-text--small pp-text--subtle">You drafted this offer, so someone else approves it.</p> }
          @if (canApprove()) {
            <div class="pp-stack pp-gap-100">
              <pp-field label="What needs to change? (required)"><textarea ppTextarea id="of-note" rows="2" [value]="note()" (input)="note.set(val($event))"></textarea></pp-field>
            </div>
          }
          @if (actions().length) {
            <pp-card-footer>
              @for (a of actions(); track a) {
                <button ppButton [appearance]="a === 'Submit for approval' || a === 'Approve' || a === 'Mark as sent' || a === 'Record answer' ? 'primary' : 'default'" type="button"
                        [disabled]="busy() || (a === 'Send back' && !note().trim())" (click)="act(a)">{{ a }}</button>
              }
            </pp-card-footer>
          }
        </pp-card>
        @if (o(); as x) {
          @if (state() !== 'DRAFT') {
            <pp-accordion>
              <details ppAccordionItem heading="Offer details" [meta]="x.role_title ?? ''" open>
                <dl ppDl>
                  <dt>Role</dt><dd>{{ x.role_title }}</dd><dt>Department</dt><dd>{{ x.department }}</dd>
                  <dt>Salary</dt><dd>
                    @if (x.can_reveal_salary) { <pp-masked-field field="Salary" [record]="x.candidate_name ?? ''" [ref]="x.offer_id" masked="R ••• ••• a year, cost to company" maskedLabel="Salary hidden" /> }
                    @else { <span class="pp-text pp-text--subtle" aria-label="Salary hidden">R ••• ••• a year, cost to company</span> }
                  </dd>
                  <dt>Start date</dt><dd>{{ x.start_date ? day(x.start_date) : '' }}</dd><dt>Benefits</dt><dd>{{ x.benefits }}</dd>
                </dl>
              </details>
              <details ppAccordionItem heading="Approval chain" [meta]="x.approval ? 'Approved' : 'Waiting for approval'">{{ chain() }}</details>
            </pp-accordion>
          }
        }
      }
    </div>
    <pp-modal-dialog [closable]="true" [(open)]="withdrawOpen" heading="Withdraw this offer?" tone="danger">
      <pp-field label="Note" [optional]="true"><textarea ppTextarea id="of-wnote" [value]="wnote()" (input)="wnote.set(val($event))"></textarea></pp-field>
      <pp-modal-footer>
        <button ppButton type="button" (click)="withdrawOpen.set(false)">Cancel</button>
        <button ppButton appearance="danger" type="button" [disabled]="busy()" (click)="withdraw()">Withdraw offer</button>
      </pp-modal-footer>
    </pp-modal-dialog>
    <pp-drawer [(open)]="answerOpen" heading="Record answer" [description]="(o()?.candidate_name ?? '') + ' · ' + (o()?.role_title ?? '')">
      <form ppForm (submit)="$event.preventDefault()">
        <pp-field label="Record answer">
          <div class="pp-grid pp-grid--3 pp-gap-100"><pp-radio-group [tiles]="true" [options]="choices" [value]="answer()" (valueChange)="answer.set($event)" /></div>
        </pp-field>
      </form>
      <pp-drawer-footer>
        <button ppButton type="button" (click)="answerOpen.set(false)">Cancel</button>
        <button ppButton appearance="primary" type="button" [disabled]="busy() || !answer()" (click)="record()">Record answer</button>
      </pp-drawer-footer>
    </pp-drawer>`,
})
export class OfferPage implements OnInit {
  private readonly api = inject(HireApi);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly auth = inject(AuthService);
  protected readonly status = signal<'loading' | 'ready' | 'notfound' | 'failed'>('loading');
  protected readonly o = signal<Offer | null>(null);
  protected readonly form = signal<Form>({ salary: '', start: '', expiry: '', benefits: '' });
  private saved: Form = { salary: '', start: '', expiry: '', benefits: '' };
  protected readonly problems = signal<Record<string, string>>({});
  protected readonly line = signal<string | null>(null);
  protected readonly refused403 = signal(false);
  protected readonly busy = signal(false);
  protected readonly note = signal('');
  protected readonly wnote = signal('');
  protected readonly answer = signal<string | null>(null);
  protected readonly withdrawOpen = signal(false);
  protected readonly answerOpen = signal(false);
  protected readonly day = dayOf;
  protected readonly choices = [{ value: 'Declined', label: 'Declined' }, { value: 'Withdrawn', label: 'Withdrawn' }];
  private candidate = '';
  private readonly who = computed(() => rolesOf(this.auth.user()?.groups ?? []));
  private readonly recruiter = computed(() => this.who().roles.includes(ROLE.hrStaff) && this.who().perms.includes(PERM.recruitment));
  private readonly approver = computed(() => this.who().perms.includes(PERM.approveOffers));
  protected readonly state = computed(() => this.o()?.state ?? 'DRAFT');
  protected readonly word = computed(() => OFFER_WORD[this.state()] ?? '');
  protected readonly tone = computed(() => OFFER_TONE[this.state()] ?? '');
  protected readonly subtitle = computed(() => { const x = this.o(); return x?.created_at ? `Created ${dayOf(x.created_at)} by ${x.drafted_by_name ?? ''}` : undefined; });
  protected readonly canApprove = computed(() => this.state() === 'WAITING_APPROVAL' && this.approver() && !this.o()?.drafted_by_me && !this.refused403());
  protected readonly drafterLine = computed(() => this.state() === 'WAITING_APPROVAL' && (!!this.o()?.drafted_by_me || this.refused403()));
  protected readonly actions = computed(() => {
    const s = this.state(), r = this.recruiter();
    if (s === 'DRAFT') return r ? ['Save draft', 'Submit for approval', ...(this.o() ? ['Withdraw offer'] : [])] : [];
    if (s === 'WAITING_APPROVAL') return [...(this.canApprove() ? ['Approve', 'Send back'] : []), ...(r ? ['Withdraw offer'] : [])];
    if (s === 'APPROVED') return r ? ['Mark as sent', 'Withdraw offer'] : [];
    if (s === 'SENT') return r ? ['Record answer', 'Withdraw offer'] : [];
    return [];
  });
  protected readonly sentBack = computed(() => {
    const h = [...(this.o()?.history ?? [])].reverse().find((e) => e.from === 'WAITING_APPROVAL' && e.to === 'DRAFT' && e.note);
    return h ? { by: h.by_name ?? '', note: h.note! } : null;
  });
  protected readonly facts = computed<Array<[string, string]>>(() => {
    const x = this.o();
    if (!x) return [];
    const exp: [string, string] = ['Offer expires', x.expiry_date ? dayOf(x.expiry_date) : ''];
    const last = x.history.at(-1)?.at ?? x.answered_at ?? '';
    switch (x.state) {
      case 'WAITING_APPROVAL': return [exp];
      case 'APPROVED': return [['Approved', x.approval ? dayOf(x.approval.at) : ''], ['Approver', x.approval?.approver_name ?? ''], exp];
      case 'SENT': {
        const n = x.expiry_date ? Math.round((Date.parse(`${x.expiry_date}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / 86_400_000) : 0;
        return [['Sent', x.sent_at ? dayOf(x.sent_at) : ''], ['Reply due', n === 1 ? 'In 1 day' : `In ${n} days`], exp];
      }
      default: return [[OFFER_WORD[x.state] ?? x.state, last ? dayOf(last) : ''], exp];
    }
  });
  protected readonly chain = computed(() => { const a = this.o()?.approval; return a ? `${a.approver_name} approved, ${dayOf(a.at)}.` : 'Not approved yet.'; });

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('offerId');
    if (!id) {
      this.candidate = this.route.snapshot.queryParamMap.get('candidate') ?? '';
      this.status.set('ready');
      return;
    }
    await this.read(id);
  }

  protected val(e: Event) { return (e.target as HTMLInputElement).value; }
  protected set(k: keyof Form, e: Event) { this.form.update((f) => ({ ...f, [k]: this.val(e) })); }

  private async read(id: string) {
    const r = await this.api.call<Offer>('GET', `/v1/offers/${encodeURIComponent(id)}`);
    if (r?.status === 404 || r?.status === 403) return this.status.set('notfound');
    if (!r || r.status !== 200) return this.status.set('failed');
    this.take(r.body);
    this.status.set('ready');
  }
  private take(x: Offer) {
    this.o.set(x);
    this.saved = { salary: '', start: x.start_date ?? '', expiry: x.expiry_date ?? '', benefits: x.benefits ?? '' };
    this.form.set({ ...this.saved });
  }
  private check(f: Form, isNew: boolean): boolean {
    const p: Record<string, string> = {};
    const today = todayIso();
    if (isNew || f.salary.trim() !== '') { const n = Number(f.salary.replace(/\s/g, '')); if (!(n > 0)) p['salary'] = FIELD_LINES['salary']!; }
    if (!(f.start > today)) p['start_date'] = FIELD_LINES['start_date']!;
    if (!(f.expiry > today) || f.expiry > f.start) p['expiry_date'] = FIELD_LINES['expiry_date']!;
    if (f.benefits.length > 2000) p['benefits'] = FIELD_LINES['benefits']!;
    this.problems.set(p);
    return !Object.keys(p).length;
  }
  /** One answer: the new offer, or the line and one fresh read. */
  private async handle(r: HireResponse<any> | null): Promise<boolean> {
    this.line.set(null);
    if (r && (r.status === 200 || r.status === 201)) { this.take(r.body); return true; }
    const code = r?.body?.code as string | undefined;
    if (r?.status === 403) { this.refused403.set(true); return false; }
    if (r?.status === 404) { this.status.set('notfound'); return false; }
    if (r?.status === 400 && code === 'INVALID_FIELD' && r.body?.field && FIELD_LINES[r.body.field]) { this.problems.set({ [r.body.field]: FIELD_LINES[r.body.field]! }); return false; }
    if ((r?.status === 409 || r?.status === 400) && code && LINES[code]) {
      this.line.set(LINES[code]!);
      if (r.status === 409 && this.o()) { const keep = this.line(); const g = await this.api.call<Offer>('GET', `/v1/offers/${this.o()!.offer_id}`); if (g?.status === 200) this.take(g.body); this.line.set(keep); }
      return false;
    }
    this.line.set(GENERIC);
    return false;
  }
  private async save(): Promise<boolean> {
    const f = this.form(), x = this.o();
    if (!this.check(f, !x)) return false;
    if (!x) {
      const body: Record<string, unknown> = { candidate_id: this.candidate, salary: Number(f.salary.replace(/\s/g, '')), start_date: f.start, expiry_date: f.expiry };
      if (f.benefits) body['benefits'] = f.benefits;
      const ok = await this.handle(await this.api.call('POST', '/v1/offers', body, newKey()));
      if (ok) { this.location.replaceState(`/hire/offers/${this.o()!.offer_id}`); this.saved = { ...f }; this.form.set({ ...f }); }
      return ok;
    }
    const body: Record<string, unknown> = { version: x.version };
    if (f.salary.trim() !== '' && f.salary !== this.saved.salary) body['salary'] = Number(f.salary.replace(/\s/g, ''));
    if (f.start !== this.saved.start) body['start_date'] = f.start;
    if (f.expiry !== this.saved.expiry) body['expiry_date'] = f.expiry;
    if (f.benefits !== this.saved.benefits) body['benefits'] = f.benefits;
    if (Object.keys(body).length === 1) return true;
    const ok = await this.handle(await this.api.call('PATCH', `/v1/offers/${x.offer_id}`, body, newKey()));
    if (ok) { this.saved = { ...f }; this.form.set({ ...f }); } else this.form.set({ ...f });
    return ok;
  }
  private dirty(): boolean { const f = this.form(); return !this.o() || (f.salary.trim() !== '' && f.salary !== this.saved.salary) || f.start !== this.saved.start || f.expiry !== this.saved.expiry || f.benefits !== this.saved.benefits; }
  private async post(path: string, body: unknown = {}, key = false) {
    return this.handle(await this.api.call('POST', `/v1/offers/${this.o()!.offer_id}/${path}`, body, key ? newKey() : undefined));
  }
  protected async act(a: string) {
    if (this.busy()) return;
    if (a === 'Withdraw offer') { this.wnote.set(''); this.withdrawOpen.set(true); return; }
    if (a === 'Record answer') { this.answer.set(null); this.answerOpen.set(true); return; }
    this.busy.set(true);
    try {
      if (a === 'Save draft') await this.save();
      else if (a === 'Submit for approval') { if (!this.check(this.form(), !this.o())) return; if (this.dirty() && !(await this.save())) return; await this.post('submit'); }
      else if (a === 'Approve') await this.post('approve', { version: this.o()!.version });
      else if (a === 'Send back') { if (await this.post('send-back', { note: this.note(), version: this.o()!.version })) this.note.set(''); }
      else if (a === 'Mark as sent') await this.post('send');
    } finally { this.busy.set(false); }
  }
  protected async withdraw() {
    if (this.busy()) return;
    this.busy.set(true);
    try { const n = this.wnote(); await this.post('withdraw', n ? { note: n } : {}); this.withdrawOpen.set(false); } finally { this.busy.set(false); }
  }
  protected async record() {
    if (this.busy() || !this.answer()) return;
    this.busy.set(true);
    try { await this.post('answer', { answer: this.answer()!.toUpperCase() }, true); this.answerOpen.set(false); } finally { this.busy.set(false); }
  }
}
