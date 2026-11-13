import { ChangeDetectionStrategy, Component, Directive, Injectable, OnDestroy, TemplateRef, computed, contentChildren, effect, inject, input, model, output, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { PpField } from '../forms/field';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { AvatarColour, PpAvatar } from '../core/avatar';
import { PpButton } from '../actions/button';
import { PpLink } from '../actions/link';
import { RouterLink } from '@angular/router';
import { PpLozenge, Status } from '../status/lozenge';
import { PpProgressBar } from '../status/status';
import { daysBetween, formatDate, isoDate, plural, toDate } from '../format';
import { uid } from '../util';

// ------------------------------------------------------------------ deadline

/**
 * A deadline, said in words (rule 5): "Due in 2 days", "Due in 3 hours", "Overdue by 1 day", "Done 3 Nov".
 * `<time ppDeadline [due]="doc.due" [done]="doc.doneAt"></time>`, or `<span ppDeadline paused="until Lerato replies"></span>`.
 * A due time on the day itself counts down in hours (`[timed]="true"`). `subject="Reply"` says what is
 * late ("Reply overdue by 1 day"); `expires` titles it "Expired 10 Nov 2026". `inline` sits in a line of text.
 * Spec: records/deadline-chip.md
 */
@Component({
  selector: 'time[ppDeadline], span[ppDeadline]',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The chip is this element (a <time>, or a <span> when paused), so layouts can place it as a direct child.
  template: `<svg [ppIcon]="d().icon" />@if (truncate()) {<span class="pp-lozenge__text">{{ text() ?? d().words }}</span>} @else {{{ text() ?? d().words }}}`,
  host: {
    '[class]': "'pp-lozenge' + (d().tone ? ' pp-lozenge--' + d().tone : '') + ' pp-deadline' + (inline() ? ' pp-deadline--inline' : '') + extra()",
    '[attr.datetime]': 'd().iso',
    '[attr.title]': 'd().title',
  },
})
export class PpDeadline {
  readonly due = input<Date | string>();
  readonly done = input<Date | string | null>();
  readonly paused = input<string>();
  /** The due time matters (a 17:00 cut-off): on the day, it counts down in hours. */
  readonly timed = input(false);
  /** What is late, when it isn't the thing itself: "Reply" gives "Reply overdue by 1 day". */
  readonly subject = input<string>();
  /** An offer or link that expires rather than falls due. */
  readonly expires = input(false);
  readonly inline = input(false);
  /** For tests and previews; defaults to now. */
  readonly now = input<Date>();
  /** Warn from this many days out. */
  readonly warnDays = input(2);
  /** A class the parent adds (a document row's status). */
  readonly extra = signal('');
  /** The words in pp-lozenge__text, so a narrow row cuts them with an ellipsis (the title has the date). */
  readonly truncate = input(false);
  /** Other words for a summary chip ("1 item overdue"); the tone, icon and date still come from the due date. */
  readonly text = input<string>();

  protected readonly d = computed(() => {
    const now = this.now() ?? new Date();
    if (this.paused()) return { tone: '', icon: 'circle-pause' as IconName, words: `Paused ${this.paused()}`, iso: null, title: null };
    const done = this.done();
    if (done) return { tone: 'success', icon: 'circle-check' as IconName, words: `Done ${formatDate(done, { now })}`, iso: isoDate(done), title: `Done ${formatDate(done, { year: true })}` };
    const due = toDate(this.due() ?? now);
    const timed = this.timed();
    const days = daysBetween(now, due);
    const when = formatDate(due, { year: true, time: timed });
    const iso = isoDate(due, timed);
    const say = (w: string) => (this.subject() ? `${this.subject()} ${w[0].toLowerCase()}${w.slice(1)}` : w);
    const title = days < 0 ? `${this.expires() ? 'Expired' : 'Was due'} ${when}` : `${this.expires() ? 'Expires' : 'Due'} ${when}`;
    if (days < 0) return { tone: 'danger', icon: 'clock-alert' as IconName, words: say(`Overdue by ${plural(-days, 'day')}`), iso, title };
    if (days === 0 && timed) {
      const hours = Math.ceil((due.getTime() - now.getTime()) / 3_600_000);
      if (hours <= 0) return { tone: 'danger', icon: 'clock-alert' as IconName, words: say('Overdue'), iso, title: `${this.expires() ? 'Expired' : 'Was due'} ${when}` };
      return { tone: 'warning', icon: 'clock' as IconName, words: say(`Due in ${plural(hours, 'hour')}`), iso, title };
    }
    if (days === 0) return { tone: 'warning', icon: 'clock' as IconName, words: say('Due today'), iso, title };
    if (days === 1) return { tone: 'warning', icon: 'clock' as IconName, words: say('Due tomorrow'), iso, title };
    return { tone: days <= this.warnDays() ? 'warning' : '', icon: 'clock' as IconName, words: say(`Due in ${days} days`), iso, title };
  });
}

/** A deadline as a document row's status: `<time ppDeadline ppDocumentStatus [due]="…"></time>` */
@Directive({ selector: '[ppDeadline][ppDocumentStatus]' })
export class PpDocumentStatus { constructor() { inject(PpDeadline).extra.set(' pp-document-row__status'); } }

// ------------------------------------------------------------------ role pill

export type Role = 'hr-admin' | 'hiring-manager' | 'it' | 'employee';
const ROLES: Record<Role, { icon: IconName; text: string }> = {
  'hr-admin': { icon: 'user-cog', text: 'HR admin' }, 'hiring-manager': { icon: 'user-plus', text: 'Hiring manager' },
  it: { icon: 'laptop', text: 'IT' }, employee: { icon: 'user', text: 'Employee' },
};

/** Someone's role in Naleko People. Never in the top bar. `current` is the role they are acting as now. Spec: records/role-pill.md */
@Component({
  selector: 'pp-role',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg [ppIcon]="r().icon" /><span class="pp-role__text">{{ r().text }}</span>@if (current()) {<span class="pp-visually-hidden"> (acting as)</span>}`,
  host: { class: 'pp-role', '[class.pp-role--current]': 'current()', '[attr.role]': 'null' },
})
export class PpRole {
  readonly role = input.required<Role>();
  readonly current = input(false);
  protected readonly r = computed(() => ROLES[this.role()]);
}

/** Someone's roles, as a list: `<pp-role-group label="Thandeka Dlamini's roles" [roles]="['hr-admin', 'hiring-manager']" current="hr-admin" />` */
@Component({
  selector: 'pp-role-group',
  imports: [PpRole],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ul class="pp-role-group" [attr.aria-label]="label()">@for (r of roles(); track r) {<li><pp-role [role]="r" [current]="r === current()" /></li>}</ul>`,
})
export class PpRoleGroup {
  readonly roles = input.required<Role[]>();
  readonly label = input.required<string>();
  readonly current = input<Role>();
}

// ------------------------------------------------------------------ restricted value

/**
 * Something this person may not see, with who can and a way to ask (never a blank or a dash).
 * `<pp-restricted reason="Only payroll admins see salaries." (request)="ask()" />`; after asking,
 * `requested="You asked Lerato Mokoena for access, 11 Nov 2026, 10:20"`. `block` covers a whole section,
 * with a `heading` and a link to `whyLink`. Spec: records/restricted-value.md
 */
@Component({
  selector: 'pp-restricted',
  imports: [PpIcon, PpButton, PpLink, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (block()) {
      <svg ppIcon="lock" />
      <span class="pp-restricted__title" role="heading" aria-level="3" [id]="id + '-t'">{{ heading() }}</span>
      <span class="pp-restricted__reason">{{ reason() }}</span>
      @if (requested()) {
        <span class="pp-restricted__status" role="status"><svg ppIcon="clock" />{{ requested() }}</span>
      } @else if (canRequest() || whyLink()) {
        <div class="pp-restricted__actions">
          @if (canRequest()) { <button ppButton size="small" (click)="request.emit()">Request access</button> }
          @if (whyLink()) { <a ppLink [routerLink]="whyLink()">Why some data is restricted</a> }
        </div>
      }
    } @else {
      <span class="pp-restricted__label"><svg ppIcon="lock" />Restricted</span>
      @if (requested()) {
        <span class="pp-restricted__status" role="status"><svg ppIcon="clock" />{{ requested() }}</span>
      } @else {
        <span class="pp-restricted__reason" [id]="id + '-why'">{{ reason() }}</span>
        @if (requestLink()) { <a ppLink [routerLink]="requestLink()" [attr.aria-describedby]="id + '-why'">Request access</a> }
      }
    }
  `,
  // The host is the restricted box itself, so a screen's Layout width (pp-measure-form) sizes it as the design system does.
  host: {
    '[class]': 'block() ? "pp-restricted pp-restricted--block" : "pp-restricted"',
    '[attr.role]': 'block() ? "region" : null',
    '[attr.aria-labelledby]': 'block() ? id + "-t" : null',
  },
})
export class PpRestricted {
  /** Who can see it: "Only payroll admins see salaries." */
  readonly reason = input.required<string>();
  /** In a section (`block`): offer a "Request access" button. Leave it off when no one would grant it. */
  readonly canRequest = input(false);
  /** In a record: where "Request access" goes. */
  readonly requestLink = input<string>();
  /** After asking: "You asked Lerato Mokoena for access, 11 Nov 2026, 10:20". */
  readonly requested = input<string>();
  readonly block = input(false);
  readonly heading = input('');
  readonly whyLink = input<string>();
  readonly request = output<void>();
  protected readonly id = uid('pp-restricted');
}

// ------------------------------------------------------------------ masked field (POPIA)

export interface Reveal { field: string; record: string; at: Date; }

/**
 * Where reveals of personal data are logged. Provide your own in the app config to send them to the
 * audit API: `{ provide: PpRevealLog, useClass: ApiRevealLog }`. The default keeps them in memory.
 * `log` resolves once the reveal is recorded; if it rejects, the value stays hidden.
 */
@Injectable({ providedIn: 'root' })
export class PpRevealLog {
  readonly reveals = signal<Reveal[]>([]);
  log(r: Reveal): Promise<void> { this.reveals.update((all) => [...all, r]); return Promise.resolve(); }
}

export type RevealState = 'hidden' | 'revealing' | 'revealed' | 'failed';

/** Reveal, hide and the 2-minute timer, shared by the record value and the form field. */
@Directive()
abstract class PpRevealable implements OnDestroy {
  /** What it is, for the log and the button: "SA ID number". */
  readonly field = input.required<string>();
  /** Whose it is, for the log: "Kagiso Molefe". */
  readonly record = input.required<string>();
  readonly value = input.required<string>();
  readonly masked = input.required<string>();
  /** The state. Screens leave it alone; the gallery sets it to show each state. */
  readonly state = model<RevealState>('hidden');
  /** When it was shown, for the notice. */
  readonly shownAt = model<Date>();
  readonly revealedChange = output<boolean>();
  protected readonly id = uid('pp-masked');
  private readonly log = inject(PpRevealLog);
  private timer?: ReturnType<typeof setTimeout>;
  protected readonly when = computed(() => (this.shownAt() ? formatDate(this.shownAt()!, { year: true, time: true }) : ''));

  protected async toggle() {
    if (this.state() === 'revealed') return this.hide();
    if (this.state() === 'revealing') return;
    this.state.set('revealing');
    const at = new Date();
    try {
      await this.log.log({ field: this.field(), record: this.record(), at });
    } catch {
      this.state.set('failed');
      return;
    }
    this.shownAt.set(at);
    this.state.set('revealed');
    this.revealedChange.emit(true);
    this.timer = setTimeout(() => this.hide(), 120_000);
  }
  protected hide() { clearTimeout(this.timer); this.state.set('hidden'); this.revealedChange.emit(false); }
  ngOnDestroy() { clearTimeout(this.timer); }
}

/**
 * Personal data on a record, hidden until someone needs it (rule 6). Show is deliberate and recorded
 * before the value appears; if the record fails, the value stays hidden. It hides again after 2 minutes
 * or when the page closes (decided 11 Nov 2026).
 * `<pp-masked-field field="SA ID number" record="Kagiso Molefe" [value]="id" masked="•••••••••0876" [notice]="true" />`
 * Spec: records/masked-field.md
 */
@Component({
  selector: 'pp-masked-field',
  imports: [PpButton, PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() === 'revealed') {
      <span class="pp-masked__value">{{ value() }}</span>
    } @else if (hiddenText()) {
      <span class="pp-masked__value pp-masked__value--hidden" [id]="id + '-v'"><svg ppIcon="eye-off" />{{ hiddenText() }}</span>
    } @else {
      <span class="pp-masked__value" [id]="id + '-v'" [attr.aria-label]="maskedLabel() ?? null">{{ masked() }}</span>
    }
    <button ppButton appearance="link" size="small" [busy]="state() === 'revealing'" [attr.aria-describedby]="describedBy()" (click)="toggle()">{{ state() === 'revealed' ? 'Hide' : state() === 'failed' ? 'Try again' : 'Show' }}</button>
    @if (state() === 'revealed') {
      <span class="pp-masked__notice" role="status"><svg ppIcon="history" /><span>Shown to you, {{ when() }}. Hides again in 2 minutes.</span></span>
    } @else if (state() === 'failed') {
      <span class="pp-masked__notice pp-masked__notice--error" role="alert"><svg ppIcon="octagon-alert" /><span>Batsi could not record the reveal, so the {{ noun() }} stays hidden.</span></span>
    } @else if (notice() && state() === 'hidden') {
      <span class="pp-masked__notice" [id]="id + '-n'"><svg ppIcon="history" /><span>Revealing is recorded</span></span>
    }
  `,
  host: { class: 'pp-masked', '[class.pp-masked--revealed]': 'state() === "revealed"' },
})
export class PpMaskedField extends PpRevealable {
  /** Says "Revealing is recorded" beside the first masked value on a page. */
  readonly notice = input(false);
  /** Words in place of the masked value, for things with no shape: "1 medical note, hidden". */
  readonly hiddenText = input<string>();
  /** A name for the masked value when the dots say nothing: "Salary hidden". */
  readonly maskedLabel = input<string>();
  /** What stays hidden if the reveal can't be recorded: "number". */
  readonly noun = input('number');
  protected readonly describedBy = computed(() => {
    const st = this.state();
    if (st === 'revealing' || st === 'revealed' || st === 'failed') return null;
    return [this.id + '-v', this.notice() && this.id + '-n'].filter(Boolean).join(' ');
  });
}

/**
 * Personal data in a form: hidden, with an eye button to show it. Showing is recorded first.
 * `<pp-field label="Bank account number"><pp-masked-text-field field="bank account number" record="Kagiso Molefe" [value]="acc" masked="•••• •••• 4821" hint="Hidden to protect Kagiso's privacy. Revealing is recorded." /></pp-field>`
 * Put the hint here, not on the field: once shown, it becomes the record of who saw it.
 * Spec: forms/text-field.md (masked)
 */
@Component({
  selector: 'pp-masked-text-field',
  imports: [PpIcon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-text-field pp-text-field--masked">
      @if (state() !== 'revealed') { <span class="pp-text-field__prefix"><svg ppIcon="eye-off" /></span> }
      <input class="pp-text-field__input" [id]="fieldRef?.controlId" type="text" readonly [value]="state() === 'revealed' ? value() : masked()" [attr.aria-describedby]="state() === 'hidden' && !hint() ? null : id + '-h'" />
      <button class="pp-text-field__action" type="button" [attr.aria-pressed]="state() === 'revealed' ? 'true' : 'false'" [attr.aria-busy]="state() === 'revealing' ? 'true' : null"
              [attr.aria-label]="(state() === 'revealed' ? 'Hide ' : 'Show ') + field()" (click)="toggle()"><svg [ppIcon]="state() === 'revealed' ? 'eye-off' : 'eye'" /></button>
    </div>
    <ng-template #lines>
      @if (state() === 'revealed') {
        <div class="pp-text-field-audit" [id]="id + '-h'"><svg ppIcon="history" /><span>Shown to you, {{ when() }}. Hides again in 2 minutes.</span></div>
      } @else if (state() === 'failed') {
        <div class="pp-field__error" [id]="id + '-h'"><svg ppIcon="octagon-alert" /><span>Batsi could not record the reveal, so it stays hidden.</span></div>
      } @else if (hint()) {
        <div class="pp-field__help" [id]="id + '-h'">{{ hint() }} <ng-container [ngTemplateOutlet]="extraContent" /></div>
      }
    </ng-template>
    <ng-template #extraContent><ng-content /></ng-template>
  `,
})
export class PpMaskedTextField extends PpRevealable {
  readonly hint = input<string>();
  protected readonly fieldRef = inject(PpField, { optional: true });
  private readonly lines = viewChild.required<TemplateRef<unknown>>('lines');
  constructor() {
    super();
    // The hint or the record of who saw it sits under the field, where help goes.
    effect(() => this.fieldRef?.extra.set(this.lines()));
  }
}

// ------------------------------------------------------------------ person header

export interface PersonFact {
  icon: IconName;
  text: string;
  /** Read before the text by screen readers: "Start date:". */
  hiddenLabel?: string;
  /** A link after the text: "Reports to" + Sipho Ndlovu. */
  link?: { text: string; to: string };
}

/**
 * The top of a person's page. One status at most, two buttons at most (Calm rule 6).
 * `<pp-person-header name="Thandeka Dlamini" role="Bookkeeper · Finance" [facts]="facts">
 *    <pp-lozenge …/> <pp-person-header-actions>…</pp-person-header-actions></pp-person-header>`
 * Spec: records/person-header.md
 */
@Component({
  selector: 'pp-person-header',
  imports: [PpIcon, PpAvatar, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-person-header__layout">
      <pp-avatar [name]="name()" size="xlarge" [colour]="colour()" [decorative]="true" />
      <div class="pp-person-header__main">
        <div class="pp-person-header__name-row">
          <span class="pp-person-header__name" role="heading" aria-level="1">{{ name() }}</span>
          <div class="pp-person-header__status"><ng-content select="pp-lozenge, [ppDeadline]" /></div>
        </div>
        <span class="pp-person-header__role">{{ role() }}</span>
        @if (facts().length) {
          <ul class="pp-person-header__facts">
            @for (f of facts(); track f.text) {
              <li class="pp-person-header__fact"><svg [ppIcon]="f.icon" /><span>@if (f.hiddenLabel) {<span class="pp-visually-hidden">{{ f.hiddenLabel }} </span>}{{ f.text }}@if (f.link) {&ngsp;<a [routerLink]="f.link.to">{{ f.link.text }}</a>}</span></li>
            }
          </ul>
        }
      </div>
      <ng-content select="pp-person-header-actions" />
    </div>
  `,
  host: { class: 'pp-person-header', '[attr.role]': 'null' }, // the input, not an ARIA role
})
export class PpPersonHeader {
  readonly name = input.required<string>();
  readonly role = input.required<string>();
  /** Their avatar colour, from their record. */
  readonly colour = input<AvatarColour>();
  readonly facts = input<PersonFact[]>([]);
}

@Component({ selector: 'pp-person-header-actions', template: '<ng-content />', host: { class: 'pp-person-header__actions' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpPersonHeaderActions {}

// ------------------------------------------------------------------ documents

/**
 * A document checklist: title, progress and rows.
 * `<pp-document-checklist heading="Kagiso's documents" subheading="…" [done]="2" [total]="6">rows</pp-document-checklist>`
 */
@Component({
  selector: 'pp-document-checklist',
  imports: [PpProgressBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-document-checklist__header">
      <div class="pp-document-checklist__titles">
        <span class="pp-document-checklist__title" role="heading" aria-level="2">{{ heading() }}</span>
        @if (subheading()) { <span class="pp-document-checklist__subtitle">{{ subheading() }}</span> }
      </div>
      @if (done() !== undefined && total()) {
        <pp-progress-bar label="Checked" [value]="done()!" [max]="total()!" [valueText]="done() + ' of ' + total() + ' documents'" [tone]="done() === total() ? 'success' : 'warning'" />
      }
    </div>
    <ul class="pp-document-checklist__list"><ng-content /></ul>
  `,
  host: { class: 'pp-document-checklist' },
})
export class PpDocumentChecklist {
  readonly heading = input.required<string>();
  readonly subheading = input<string>();
  /** Checked so far, for the progress bar. Leave both out on a new employee's own list (the subheading says it). */
  readonly done = input<number>();
  readonly total = input<number>();
}

/**
 * One document: what it is, who uploaded it, its status and the one action.
 * `<li ppDocumentRow name="South African ID" icon="id-card" meta="Uploaded by Kagiso, 9 Nov 2026, 08:02" status="success" statusText="Matches">`
 * Spec: records/document-row.md
 */
@Component({
  selector: 'li[ppDocumentRow]',
  imports: [PpIcon, PpLozenge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pp-icon-tile" [class.pp-icon-tile--brand]="next()" aria-hidden="true"><svg [ppIcon]="icon()" /></span>
    <div class="pp-document-row__body">
      <span class="pp-document-row__name">{{ name() }}</span>
      <!-- With a lozenge (Checked by Batsi) the words get their own span, so the two wrap apart. -->
      @if (badge().length || inMeta()) { <span class="pp-document-row__meta"><span>{{ meta() }}</span><ng-content select="pp-lozenge, [ppDeadline]:not([ppDocumentStatus])" /></span> }
      @else { <span class="pp-document-row__meta">{{ meta() }}</span> }
      @if (reason()) { <span class="pp-document-row__reason"><svg ppIcon="octagon-alert" /><span>{{ reason() }}</span></span> }
    </div>
    @if (statusText()) { <pp-lozenge [status]="status()" [icon]="statusIcon()" class="pp-document-row__status">{{ statusText() }}</pp-lozenge> }
    @else { <ng-content select="[ppDocumentStatus]" /> }
    @if (actions().length || hasActions()) { <div class="pp-document-row__actions"><ng-content /></div> }
  `,
  host: { class: 'pp-document-row', '[class.pp-document-row--attention]': 'status() === "danger"' },
})
export class PpDocumentRow {
  readonly name = input.required<string>();
  readonly icon = input<IconName>('file-text');
  readonly meta = input('');
  readonly status = input<Status>('neutral');
  /** The status in words. Or put a `<time ppDeadline ppDocumentStatus …>` inside instead, for a document that is due. */
  readonly statusText = input<string>();
  /** The new employee's next document: the tile takes the brand colour. */
  readonly next = input(false);
  /** Actions that are not ppButtons (the box shows by itself when a button is inside). */
  readonly hasActions = input(false);
  protected readonly actions = contentChildren(PpButton);
  readonly statusIcon = input<IconName>();
  /** Rejected only: what is wrong and what to do. */
  readonly reason = input<string>();
  protected readonly badge = contentChildren(PpLozenge);
  protected readonly due = contentChildren(PpDeadline);
  protected readonly inMeta = computed(() => this.due().some((d) => !d.extra()));
}

// ------------------------------------------------------------------ checklist (ready for day 1)

/** A checklist with a count and progress: `<pp-checklist heading="Ready for day 1" [done]="4" [total]="6">rows</pp-checklist>` */
@Component({
  selector: 'pp-checklist',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-checklist__header"><span class="pp-checklist__title" role="heading" aria-level="3" [id]="id">{{ heading() }}</span><span class="pp-checklist__count">{{ done() === total() ? 'All ' + total() : done() + ' of ' + total() }} ready</span></div>
    @if (done() < total()) {
      <div class="pp-progress-bar pp-progress-bar--warning">
        <progress class="pp-progress-bar__track pp-progress-bar__track--small" [value]="done()" [max]="total()" [attr.aria-labelledby]="id">{{ done() }} of {{ total() }} ready</progress>
      </div>
    }
    <ul class="pp-checklist__list" [attr.aria-labelledby]="id"><ng-content /></ul>
  `,
  host: { class: 'pp-checklist' },
})
export class PpChecklist {
  readonly heading = input.required<string>();
  readonly done = input.required<number>();
  readonly total = input.required<number>();
  protected readonly id = uid('pp-checklist');
}

/**
 * One item to get ready: `<li ppChecklistRow label="Bank letter" owner="Kagiso" state="open"><time ppDeadline …></time></li>`
 * Spec: records/checklist-row.md
 */
@Component({
  selector: 'li[ppChecklistRow]',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pp-checklist-row__mark" aria-hidden="true"><svg [ppIcon]="mark()" /></span>
    <span class="pp-checklist-row__body"><span class="pp-checklist-row__label">{{ label() }}</span>@if (owner()) {<span class="pp-checklist-row__owner">{{ owner() }}</span>}</span>
    <ng-content />
  `,
  host: { '[class]': '"pp-checklist-row" + (state() !== "open" ? " pp-checklist-row--" + state() : "")' },
})
export class PpChecklistRow {
  readonly label = input.required<string>();
  /** Who does it: "Kagiso", "IT, Sipho Ndlovu". Leave out when it is all one person's list. */
  readonly owner = input<string>();
  readonly state = input<'open' | 'done' | 'agent' | 'overdue'>('open');
  protected readonly mark = computed<IconName>(() => ({ open: 'circle-dashed', done: 'circle-check', agent: 'sparkles', overdue: 'circle-dashed' } as const)[this.state()]);
}

// ------------------------------------------------------------------ audit

/**
 * One line of the audit trail, opening to the details (rule 7). The details go inside.
 * `<ul ppAuditLog><li ppAuditEvent actor="Lerato Mokoena" sentence="changed the start date on Kagiso Molefe's record" [at]="…" where="Web app · Durban">`
 * Spec: records/audit-event-row.md
 */
@Component({
  selector: 'li[ppAuditEvent]',
  imports: [PpIcon, PpAvatar, PpLozenge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="pp-audit-event" [open]="open()">
      <summary class="pp-audit-event__summary">
        <time class="pp-audit-event__when" [attr.datetime]="iso()">{{ when() }}</time>
        <span class="pp-audit-event__what"><pp-avatar [name]="actor()" size="small" [kind]="actor() === 'Batsi' ? 'agent' : 'person'" [colour]="colour()" [decorative]="true" /><span class="pp-audit-event__sentence"><strong>{{ actor() }}</strong> {{ sentence() }}</span></span>
        <span class="pp-audit-event__where">{{ where() }}</span>
        <pp-lozenge [status]="o().status" [icon]="o().icon" class="pp-audit-event__outcome">{{ o().text }}</pp-lozenge>
        <span class="pp-audit-event__chevron" aria-hidden="true"><svg ppIcon="chevron-down" /></span>
      </summary>
      <div class="pp-audit-event__details">
        @if (change(); as c) { <span class="pp-audit-event__change"><span class="pp-visually-hidden">{{ c.field }} changed from</span><del>{{ c.from }}</del><svg ppIcon="arrow-right" /><span class="pp-visually-hidden">to</span><ins>{{ c.to }}</ins></span> }
        <ng-content />
      </div>
    </details>
  `,
})
export class PpAuditEvent {
  readonly actor = input.required<string>();
  readonly sentence = input.required<string>();
  readonly at = input.required<Date | string>();
  readonly where = input.required<string>();
  /** done, failed, denied (not allowed: a permission stopped it) or partial, with `outcomeText` ("2 of 3 done"). */
  readonly outcome = input<'done' | 'failed' | 'denied' | 'partial'>('done');
  readonly outcomeText = input<string>();
  readonly colour = input<AvatarColour>();
  protected readonly o = computed(() => {
    const t = this.outcomeText();
    switch (this.outcome()) {
      case 'failed': return { status: 'danger' as Status, icon: 'octagon-alert' as IconName, text: t ?? 'Failed' };
      case 'denied': return { status: 'danger' as Status, icon: 'lock' as IconName, text: t ?? 'Not allowed' };
      case 'partial': return { status: 'warning' as Status, icon: 'triangle-alert' as IconName, text: t ?? 'Partly done' };
      default: return { status: 'success' as Status, icon: 'circle-check' as IconName, text: t ?? 'Done' };
    }
  });
  readonly change = input<{ field: string; from: string; to: string }>();
  readonly open = input(false);
  protected readonly when = computed(() => formatDate(this.at(), { year: true, time: true }));
  protected readonly iso = computed(() => isoDate(this.at(), true));
}

/** `<ul ppAuditLog>` holding `<li ppAuditEvent …>` rows. */
@Directive({ selector: 'ul[ppAuditLog]', host: { class: 'pp-audit-log', '[attr.aria-label]': 'label()' } })
export class PpAuditLog { readonly label = input('Audit log'); }

// ------------------------------------------------------------------ config version

/** Which version of a setting is live, who published it, compare and roll back. Spec: records/config-version-badge.md */
@Component({
  selector: 'pp-config-version',
  imports: [PpIcon, PpLozenge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pp-config-version__version"><svg ppIcon="history" />Version {{ version() }}</span>
    @if (draft() && byAgent()) { <pp-lozenge status="agent" icon="sparkles">Drafted by Batsi</pp-lozenge> }
    @else if (draft()) { <pp-lozenge icon="pencil">Draft</pp-lozenge> }
    @else { <pp-lozenge status="success" icon="circle-check">Live</pp-lozenge> }
    <span class="pp-config-version__meta">{{ meta() }}</span>
    <ng-content select="pp-config-version-actions" />
  `,
  host: { class: 'pp-config-version', '[class.pp-config-version--boxed]': 'boxed()', '[class.pp-config-version--draft]': 'draft()' },
})
export class PpConfigVersion {
  readonly version = input.required<number>();
  readonly meta = input.required<string>();
  readonly draft = input(false);
  /** A draft Batsi proposed (from hiring data, say): it needs a person to review it. */
  readonly byAgent = input(false);
  readonly boxed = input(true);
}

/** The version's buttons: Compare, then Roll back or Publish. */
@Component({ selector: 'pp-config-version-actions', template: '<ng-content />', host: { class: 'pp-config-version__actions' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpConfigVersionActions {}

// ------------------------------------------------------------------ verification

export interface VerificationCheck { label: string; result: 'match' | 'mismatch' | 'unsure'; note?: string; }

/**
 * The result of an ID, bank or qualification check: what was compared, against what, by whom.
 * Details (a description list with the masked value) go inside. Spec: records/verification-result.md
 */
@Component({
  selector: 'pp-verification',
  imports: [PpIcon, PpLozenge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-card__header">
      <span class="pp-icon-tile" aria-hidden="true"><svg [ppIcon]="icon()" /></span>
      <div class="pp-card__titles"><span class="pp-card__title" role="heading" aria-level="3">{{ heading() }}</span><span class="pp-card__subtitle">{{ subheading() }}</span></div>
      <div class="pp-card__aside"><pp-lozenge [bold]="true" [status]="r().status" [icon]="r().icon">{{ r().text }}</pp-lozenge></div>
    </div>
    @if (checks().length) {
      <ul class="pp-verification__checks" aria-label="What was compared">
        @for (c of checks(); track c.label) {
          <li class="pp-verification__check" [class]="c.result !== 'match' ? 'pp-verification__check--' + c.result : ''"><svg [ppIcon]="c.result === 'match' ? 'check' : c.result === 'mismatch' ? 'x' : 'triangle-alert'" /><span>{{ c.label }}@if (c.note) {&ngsp;<span class="pp-verification__check-note">{{ c.note }}</span>}</span></li>
        }
      </ul>
    }
    <ng-content />
  `,
  host: { class: 'pp-card pp-verification', role: 'article' },
})
export class PpVerification {
  readonly heading = input.required<string>();
  readonly subheading = input.required<string>();
  readonly icon = input<IconName>('id-card');
  /** matches: everything matched. mismatch: something does not match. check: needs a look. reading: the file is still being read. The check only flags; HR decides. */
  readonly result = input.required<'matches' | 'mismatch' | 'check' | 'reading'>();
  /** What was compared. Leave it empty when the page has no comparison to list. */
  readonly checks = input<VerificationCheck[]>([]);
  protected readonly r = computed(() => ({
    matches: { status: 'success' as Status, icon: 'shield-check' as IconName, text: 'Matches' },
    mismatch: { status: 'warning' as Status, icon: 'triangle-alert' as IconName, text: "Doesn't match" },
    check: { status: 'warning' as Status, icon: 'triangle-alert' as IconName, text: 'Needs a look' },
    reading: { status: 'neutral' as Status, icon: 'clock' as IconName, text: 'Being checked' },
  })[this.result()]);
}

/** Who checked it, inside a verification's details: the agent lozenge and the approval line. */
@Component({ selector: 'pp-verification-by', template: '<ng-content />', host: { class: 'pp-verification__by' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpVerificationBy {}

