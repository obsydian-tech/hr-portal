import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, input, output, signal, viewChild } from '@angular/core';
import {
  PpButton, PpDatePicker, PpDrawer, PpDrawerFooter, PpErrorSummary, PpField, PpForm, PpFormRow, PpMultiSelect, PpRadioGroup, PpSectionMessage, PpSectionMessageActions,
  PpSelect, PpSkeleton, PpTextField, PpTextarea, type FormError,
} from '../../../ds';
import {
  HireApi, newKey, panelSettingsOf, peopleOf, typesOf, type InterviewListAnswer, type InterviewTypeSetting, type PanelPerson, type PanelSettings,
} from '../hire-api';
import { DRAWER_LINES as L, INTERVIEW_WORDS, typeWords } from './interview-words';

type Item = InterviewListAnswer['interviews'][number];
type Key = 'type' | 'date' | 'time' | 'length' | 'where' | 'place' | 'link' | 'panel' | 'guest';
type Problems = Partial<Record<Key, string>>;

const W = INTERVIEW_WORDS.drawer as Record<string, string>;
const SAST = 2 * 3_600_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pad = (n: number) => String(n).padStart(2, '0');
const TIMES = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);
const LENGTHS = Array.from({ length: 16 }, (_, i) => (i + 1) * 15);
const LABEL: Record<Key, string> = { type: W['type']!, date: W['dateTime']!, time: W['dateTime']!, length: W['length']!, where: W['where']!, place: W['place']!, link: W['link']!, panel: W['panel']!, guest: W['guest']! };
const SERVER_FIELD: Record<string, Key> = { type: 'type', at: 'date', length_minutes: 'length', where: 'where', place: 'place', video_link: 'link', panel: 'panel', guest_email: 'guest' };
const FIELD_WORDS: Record<Key, string> = { type: W['typeEmpty']!, date: W['future']!, time: W['timeEmpty']!, length: W['lengthEmpty']!, where: W['whereEmpty']!, place: W['placeEmpty']!, link: W['badLink']!, panel: W['panelEmpty']!, guest: W['emailWrong']! };
const isLink = (v: string) => { if (!v.startsWith('https://') || /\s/.test(v)) return false; try { new URL(v); return true; } catch { return false; } };

/** The day and time of an ISO time in South African time, as the picker (a local calendar date, S-3) and the Time list take them. */
function sastParts(at: string | null | undefined): { date: Date; time: string } | null {
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  const d = new Date(Date.parse(at) + SAST);
  return { date: new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}
const sameDay = (a: Date | null, b: Date | null) => (!a && !b) || (!!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());

/** What the reschedule drawer compares against: the interview as the tab read it. */
interface Base { id: string; type: string; sequence: number; date: Date | null; time: string | null; length: number | null; where: 'IN_PERSON' | 'ONLINE' | null; place: string; link: string; panel: string[]; names: PanelPerson[] }

/**
 * Schedule an interview and Reschedule (INT-UI-02): one drawer, two modes. Everything typed, the people, the types and the request key
 * live in this component only and go when it closes or the page goes (sign-out), so nothing outlives a sign-in (rule 10).
 */
@Component({
  selector: 'app-schedule-drawer',
  imports: [
    PpButton, PpDatePicker, PpDrawer, PpDrawerFooter, PpErrorSummary, PpField, PpForm, PpFormRow, PpMultiSelect, PpRadioGroup, PpSectionMessage, PpSectionMessageActions,
    PpSelect, PpSkeleton, PpTextField, PpTextarea,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The locked record test AC-R8 allows no pp-drawer on the page while nothing is open: the drawer is drawn only while it is used. -->
    @if (alive()) {
    <pp-drawer [(open)]="open" [heading]="title()" [description]="description()" (closed)="dismiss()">
      @if (open()) {
        @if (state() === 'loading') {
          <div class="pp-stack pp-gap-200" aria-busy="true"><pp-skeleton shape="text" /><pp-skeleton shape="text" /><pp-skeleton shape="text" /></div>
        } @else if (state() === 'failed') {
          <pp-section-message tone="danger" [heading]="w['choicesFailed']">
            <pp-section-message-actions><button ppButton type="button" (click)="retry()">{{ w['tryAgain'] ?? 'Try again' }}</button></pp-section-message-actions>
          </pp-section-message>
        } @else {
        <form ppForm (submit)="$event.preventDefault(); press()">
          @if (top(); as t) { <pp-section-message tone="danger" [heading]="t" /> }
          @for (k of [summaryRun()]; track k) { @if (summary().length) { <pp-error-summary [heading]="summaryHeading()" [errors]="summary()" /> } }
          @if (mode() === 'schedule') {
            <pp-field #fType [label]="w['type']" [error]="problems().type" [help]="bookedLine()">
              <pp-select [options]="typeChoices()" placeholder=" " [value]="type()" (valueChange)="chooseType($event)" />
            </pp-field>
          } @else {
            <pp-field [label]="w['type']"><input ppTextField readonly [value]="baseTypeWords()" /></pp-field>
          }
          <fieldset role="group" [attr.aria-labelledby]="ids + '-dt'" style="border:0;padding:0;margin:0;min-width:0" class="pp-stack pp-gap-050">
            <span class="pp-field__label" [id]="ids + '-dt'">{{ w['dateTime'] }}</span>
            <pp-form-row>
              <pp-field #fDate [label]="w['date']" [error]="problems().date">
                <pp-date-picker [value]="date()" [min]="min()" (valueChange)="chooseDate($event)" (problem)="pickerSaid($event)" />
              </pp-field>
              <pp-field #fTime [label]="w['time']" [error]="problems().time">
                <pp-select [options]="timeChoices()" placeholder=" " [value]="time()" (valueChange)="time.set($event); clearDateTime()" />
              </pp-field>
            </pp-form-row>
            <div class="pp-field__help">{{ w['sast'] }}</div>
          </fieldset>
          <pp-field #fLength [label]="w['length']" [error]="problems().length">
            <pp-select [options]="lengthChoices" placeholder=" " [value]="length()" (valueChange)="length.set($event); lengthChosen = true; clear('length')" />
          </pp-field>
          <div [id]="ids + '-where'" tabindex="-1">
            <pp-field group="radio" [label]="w['where']" [error]="problems().where">
              <pp-radio-group [options]="whereChoices" [value]="where()" (valueChange)="chooseWhere($event)" />
            </pp-field>
          </div>
          @if (where() === 'IN_PERSON') {
            <pp-field [label]="w['place']" [error]="problems().place"><input ppTextField [id]="ids + '-place'" maxlength="200" [value]="place()" (input)="place.set(val($event)); clear('place')" /></pp-field>
          } @else if (where() === 'ONLINE') {
            <pp-field [label]="w['link']" [error]="problems().link"><input ppTextField type="url" [id]="ids + '-link'" maxlength="500" [value]="link()" (input)="link.set(val($event)); clear('link')" /></pp-field>
          }
          <pp-field #fPanel [label]="w['panel']" [error]="problems().panel" [help]="people().length ? undefined : w['noPeople']">
            <pp-multi-select [options]="peopleChoices()" noun="people" [value]="panel()" (valueChange)="panel.set($event ?? []); clear('panel')" />
          </pp-field>
          @if (mode() === 'schedule') {
            @if (guestShown()) {
              <pp-field [label]="w['guest']" [optional]="true" [error]="problems().guest" [help]="w['guestHelp']">
                <input ppTextField type="email" [id]="ids + '-guest'" maxlength="254" [value]="guest()" (input)="guest.set(val($event)); clear('guest')" />
              </pp-field>
            }
            <pp-field [label]="w['note']" [optional]="true"><textarea ppTextarea maxlength="1000" [value]="note()" (input)="note.set(val($event))"></textarea></pp-field>
            @if (inviteShown()) { <p class="pp-text pp-text--small">{{ invite() }}</p> }
          } @else {
            <pp-field [label]="w['reason']" [optional]="true"><textarea ppTextarea maxlength="500" [value]="reason()" (input)="reason.set(val($event))"></textarea></pp-field>
            @if (inviteShown()) { <p class="pp-text pp-text--small">{{ w['w5Line'] }}</p> }
          }
        </form>
        }
      }
      <pp-drawer-footer>
        <button ppButton type="button" (click)="cancel()">{{ w['cancel'] }}</button>
        <button ppButton appearance="primary" icon="calendar-days" type="button" [disabled]="mainOff()" (click)="press()">{{ mainWords() }}</button>
      </pp-drawer-footer>
    </pp-drawer>
    }`,
})
export class ScheduleDrawer implements OnDestroy {
  private readonly api = inject(HireApi);
  readonly candidateId = input.required<string>();
  readonly name = input('');
  readonly first = input('');
  readonly roleTitle = input<string | null>(null);
  readonly panelSize = input(3);
  readonly optionsFailed = input(false);
  readonly interviews = input<readonly Item[]>([]);
  /** Repeats the page's failed options read; true when it worked. */
  readonly retryOptions = input<() => Promise<boolean>>(async () => true);
  /** Reads the tab's interviews again and gives the new list (null when that read failed). */
  readonly reread = input<() => Promise<readonly Item[] | null>>(async () => null);
  readonly rereadRecord = input<() => Promise<void>>(async () => undefined);
  /** Saved: the interview to choose, and whether the tab's interviews were already read again after it (S-1). */
  readonly saved = output<{ id: string; fresh: boolean }>();
  /** Closed without saving (Cancel, the close button, Escape). */
  readonly dismissed = output<void>();

  protected readonly w = { ...W, tryAgain: INTERVIEW_WORDS.lines['tryAgain']! } as Record<string, string>;
  protected readonly ids = `sd-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly open = signal(false);
  protected readonly alive = signal(false);
  protected readonly mode = signal<'schedule' | 'reschedule'>('schedule');
  private readonly base = signal<Base | null>(null);
  // Reads.
  private readonly types = signal<InterviewTypeSetting[] | null>(null);
  private readonly settings = signal<PanelSettings | null>(null);
  protected readonly people = signal<PanelPerson[]>([]);
  private failedReads = new Set<'types' | 'settings' | 'people' | 'options'>();
  protected readonly state = signal<'loading' | 'failed' | 'ready'>('loading');
  // What is typed.
  protected readonly type = signal<string | null>(null);
  protected readonly date = signal<Date | null>(null);
  private readonly pickerProblem = signal<string | null>(null);
  protected readonly time = signal<string | null>(null);
  protected readonly length = signal<string | null>(null);
  protected lengthChosen = false;
  protected readonly where = signal<'IN_PERSON' | 'ONLINE' | null>(null);
  protected readonly place = signal('');
  protected readonly link = signal('');
  protected readonly panel = signal<string[]>([]);
  protected readonly guest = signal('');
  protected readonly note = signal('');
  protected readonly reason = signal('');
  protected readonly problems = signal<Problems>({});
  protected readonly summaryRun = signal(0);
  protected readonly top = signal<string | null>(null);
  protected readonly busy = signal(false);
  private readonly hasFeedback = signal(false);
  private key = '';
  private sentBody: string | null = null;
  /** Each opening gets its own run: an answer for an earlier opening, or after the page went, draws nothing. */
  private run = 0;

  private readonly fType = viewChild('fType', { read: PpField });
  private readonly fDate = viewChild('fDate', { read: PpField });
  private readonly fTime = viewChild('fTime', { read: PpField });
  private readonly fLength = viewChild('fLength', { read: PpField });
  private readonly fPanel = viewChild('fPanel', { read: PpField });

  protected readonly title = computed(() => (this.mode() === 'schedule' ? INTERVIEW_WORDS.controls['schedule']! : L.rescheduleTitle(typeWords(this.base()?.type) ?? '')));
  protected readonly description = computed(() => [this.name(), this.roleTitle()].filter(Boolean).join(' · '));
  protected readonly mainWords = computed(() => (this.mode() === 'schedule' ? INTERVIEW_WORDS.controls['schedule']! : INTERVIEW_WORDS.controls['reschedule']!));
  protected readonly baseTypeWords = computed(() => typeWords(this.base()?.type) ?? '');
  /** Today in South African time, as a local calendar date (S-3); no lower bound when rescheduling (M-3). */
  protected readonly min = computed(() => {
    if (this.mode() !== 'schedule') return undefined;
    const s = new Date(Date.now() + SAST);
    return new Date(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  });
  private readonly takenTypes = computed(() => new Set(this.interviews().filter((x) => x.status === 'SCHEDULED' || x.status === 'COMPLETED').map((x) => x.type)));
  protected readonly typeChoices = computed(() => (this.types() ?? []).map((t) => ({ value: t.key, label: typeWords(t.key) ?? t.key, disabled: this.takenTypes().has(t.key) })));
  protected readonly bookedLine = computed(() => { const taken = this.typeChoices().filter((o) => o.disabled).map((o) => o.label); return taken.length ? L.booked(taken) : undefined; });
  protected readonly timeChoices = computed(() => {
    const extra = this.mode() === 'reschedule' ? this.base()?.time : null;
    const all = extra && !TIMES.includes(extra) ? [...TIMES, extra].sort() : TIMES;
    return all.map((t) => ({ value: t, label: t }));
  });
  protected readonly lengthChoices = LENGTHS.map((m) => ({ value: String(m), label: L.length(m) }));
  protected readonly whereChoices = [{ value: 'IN_PERSON', label: W['inPerson']! }, { value: 'ONLINE', label: W['online']! }];
  protected readonly peopleChoices = computed(() => {
    const list = this.people().map((p) => ({ value: p.id, label: p.name }));
    const extra = (this.base()?.names ?? []).filter((n) => !list.some((o) => o.value === n.id)).map((n) => ({ value: n.id, label: n.name }));
    return [...list, ...extra];
  });
  protected readonly guestShown = computed(() => this.settings()?.guestAllowed !== false && this.settings()?.interview_emails === 'ON');
  protected readonly inviteShown = computed(() => this.settings()?.interview_emails === 'ON' && this.settings()?.candidate_interview_emails === 'ON');
  protected readonly invite = computed(() => L.invite(this.first(), !!this.guest().trim()));
  protected readonly summary = computed<FormError[]>(() => {
    const p = this.problems();
    const order: Key[] = ['type', 'date', 'time', 'length', 'where', 'place', 'link', 'panel', 'guest'];
    return order.filter((k) => p[k] && !(k === 'type' && p[k] === W['bookedServer'])).map((k) => ({ text: `${LABEL[k]}: ${p[k]}`, for: this.idOf(k) }));
  });
  protected readonly summaryHeading = computed(() => { const n = this.summary().length; return `Fix ${n} ${n === 1 ? 'thing' : 'things'} to continue`; });
  private readonly changes = computed(() => this.rescheduleBody());
  protected readonly mainOff = computed(() => this.busy() || this.state() !== 'ready' || this.hasFeedback() || (this.mode() === 'reschedule' && Object.keys(this.changes()).length <= 1));

  protected val(e: Event): string { return (e.target as HTMLInputElement).value; }
  private idOf(k: Key): string {
    const f = { type: this.fType(), date: this.fDate(), time: this.fTime(), length: this.fLength(), panel: this.fPanel() }[k as 'type'];
    if (f) return f.controlId;
    return k === 'where' ? `${this.ids}-where` : `${this.ids}-${k}`;
  }
  protected clear(k: Key) { if (this.problems()[k]) this.problems.update((p) => { const { [k]: _, ...rest } = p; return rest; }); }
  protected clearDateTime() { this.clear('time'); if (!this.pickerProblem()) this.clear('date'); }

  openSchedule(preset: string | null) {
    this.reset();
    this.mode.set('schedule');
    this.start(preset);
  }
  openReschedule(x: Item) {
    this.reset();
    this.mode.set('reschedule');
    const parts = sastParts(x.at);
    const persons = x.panel.filter((e) => e.kind === 'PERSON' && typeof (e as { person_id?: unknown }).person_id === 'string');
    const b: Base = {
      id: x.id ?? '', type: x.type ?? '', sequence: typeof x.sequence === 'number' ? x.sequence : 0, date: parts?.date ?? null, time: parts?.time ?? null,
      length: typeof x.length_minutes === 'number' ? x.length_minutes : null, where: x.where === 'IN_PERSON' || x.where === 'ONLINE' ? x.where : null,
      place: typeof x.place === 'string' ? x.place : '', link: typeof x.video_link === 'string' ? x.video_link : '',
      panel: persons.map((e) => (e as { person_id: string }).person_id), names: persons.map((e) => ({ id: (e as { person_id: string }).person_id, name: e.name ?? '' })),
    };
    this.base.set(b);
    this.date.set(b.date); this.time.set(b.time); this.length.set(b.length === null ? null : String(b.length)); this.lengthChosen = b.length !== null;
    this.where.set(b.where); this.place.set(b.place); this.link.set(b.link); this.panel.set([...b.panel]);
    this.start(null);
  }

  private start(preset: string | null) {
    this.key = newKey();
    this.alive.set(true);
    this.open.set(true);
    this.failedReads = new Set(['types', 'settings', 'people', ...(this.optionsFailed() ? ['options' as const] : [])]);
    void this.load(preset);
  }

  private async load(preset: string | null) {
    const run = this.run;
    this.state.set('loading');
    const want = new Set(this.failedReads);
    const [t, s, p, o] = await Promise.all([
      want.has('types') ? this.api.call('GET', '/v1/config?configType=INTERVIEW_TYPES&active=true').then(typesOf) : Promise.resolve(this.types()),
      want.has('settings') ? this.api.call('GET', '/v1/config?configType=PANEL_CONFIG&active=true').then(panelSettingsOf) : Promise.resolve(this.settings()),
      want.has('people') ? this.api.call('GET', '/v1/panel-members').then(peopleOf) : Promise.resolve(this.people()),
      want.has('options') ? this.retryOptions()() : Promise.resolve(true),
    ]);
    if (run !== this.run) return;
    if (t) { this.types.set(t); this.failedReads.delete('types'); }
    if (s) { this.settings.set(s); this.failedReads.delete('settings'); }
    if (p) { this.people.set(p); this.failedReads.delete('people'); }
    if (o && want.has('options') && !this.optionsFailed()) this.failedReads.delete('options');
    if (this.failedReads.size) { this.state.set('failed'); return; }
    if (preset && this.mode() === 'schedule' && (this.types() ?? []).some((x) => x.key === preset) && !this.takenTypes().has(preset)) this.chooseType(preset);
    this.state.set('ready');
    setTimeout(() => { if (run === this.run) document.getElementById(this.fType()?.controlId ?? '')?.focus() ?? this.focusFirst(); });
  }
  private focusFirst() { (document.querySelector('.pp-drawer .pp-drawer__body input, .pp-drawer .pp-drawer__body select') as HTMLElement | null)?.focus(); }

  protected retry() { void this.load(null); }

  protected chooseType(v: string | null) {
    this.type.set(v);
    this.clear('type');
    const d = (this.types() ?? []).find((t) => t.key === v)?.default_length_minutes;
    if (!this.lengthChosen && typeof d === 'number' && LENGTHS.includes(d)) this.length.set(String(d));
  }
  protected chooseDate(d: Date | null) { this.date.set(d); this.pickerProblem.set(null); this.clear('date'); }
  protected pickerSaid(m: string | null) {
    this.pickerProblem.set(m);
    if (m) this.problems.update((p) => ({ ...p, date: m })); else this.clear('date');
  }
  protected chooseWhere(v: string | null) { this.where.set(v === 'IN_PERSON' || v === 'ONLINE' ? v : null); this.clear('where'); this.clear('place'); this.clear('link'); }

  private atOf(): string | null {
    const d = this.date(), t = this.time();
    if (!d || !t) return null;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${t}:00+02:00`;
  }
  private timeChanged(): boolean { const b = this.base(); return !b || !sameDay(this.date(), b.date) || this.time() !== b.time; }

  private check(): Problems {
    const p: Problems = {};
    const resched = this.mode() === 'reschedule';
    const b = this.base();
    if (!resched && !this.type()) p.type = W['typeEmpty'];
    const checkTime = !resched || this.timeChanged();
    if (this.pickerProblem()) p.date = this.pickerProblem()!;
    else if (checkTime && !this.date()) p.date = W['dateEmpty'];
    if (checkTime && !this.time()) p.time = W['timeEmpty'];
    if (checkTime && !p.date && !p.time) { const at = this.atOf(); if (at && Date.parse(at) <= Date.now()) p.date = W['future']; }
    if (!this.length() && !(resched && b?.length === null)) p.length = W['lengthEmpty'];
    if (!this.where() && !(resched && b?.where === null)) p.where = W['whereEmpty'];
    if (this.where() === 'IN_PERSON' && !this.place().trim()) p.place = W['placeEmpty'];
    if (this.where() === 'ONLINE' && !isLink(this.link().trim())) p.link = W['badLink'];
    if (!this.panel().length) p.panel = W['panelEmpty'];
    else if (this.panel().length > this.panelSize()) p.panel = L.panelMax(this.panelSize());
    if (!resched && this.guestShown() && this.guest().trim() && !EMAIL.test(this.guest().trim())) p.guest = W['emailWrong'];
    return p;
  }

  private scheduleBody(): Record<string, unknown> {
    const body: Record<string, unknown> = { type: this.type(), at: this.atOf(), length_minutes: Number(this.length()), where: this.where() };
    if (this.where() === 'IN_PERSON') body['place'] = this.place().trim(); else body['video_link'] = this.link().trim();
    body['panel'] = [...this.panel()];
    if (this.guestShown() && this.guest().trim()) body['guest_email'] = this.guest().trim();
    if (this.note().trim()) body['candidate_note'] = this.note().trim();
    return body;
  }
  private rescheduleBody(): Record<string, unknown> {
    const b = this.base();
    if (!b) return { action: 'reschedule' };
    const body: Record<string, unknown> = { action: 'reschedule' };
    if (this.timeChanged() && (this.date() || this.time())) body['at'] = this.atOf();
    if (this.length() !== null && Number(this.length()) !== b.length) body['length_minutes'] = Number(this.length());
    const where = this.where();
    if (where && where !== b.where) {
      body['where'] = where;
      if (where === 'IN_PERSON') body['place'] = this.place().trim(); else body['video_link'] = this.link().trim();
    } else if (where === 'IN_PERSON' && this.place().trim() !== b.place) body['place'] = this.place().trim();
    else if (where === 'ONLINE' && this.link().trim() !== b.link) body['video_link'] = this.link().trim();
    if (JSON.stringify(this.panel()) !== JSON.stringify(b.panel)) body['panel'] = [...this.panel()];
    if (Object.keys(body).length > 1 && this.reason().trim()) body['reason_note'] = this.reason().trim();
    return body;
  }

  protected async press() {
    if (this.busy() || this.mainOff()) return;
    const p = this.check();
    this.problems.set(p);
    this.summaryRun.update((n) => n + 1);
    if (Object.keys(p).length) return;
    const resched = this.mode() === 'reschedule';
    const body = resched ? this.rescheduleBody() : this.scheduleBody();
    const text = JSON.stringify(body);
    if (this.sentBody !== null && this.sentBody !== text) this.key = newKey();
    this.sentBody = text;
    const run = this.run;
    const before = new Set(this.interviews().map((x) => x.id));
    this.busy.set(true);
    this.top.set(null);
    const id = encodeURIComponent(this.candidateId());
    const r = resched
      ? await this.api.call<{ code?: string; field?: string }>('PATCH', `/v1/candidates/${id}/interviews/${encodeURIComponent(this.base()!.id)}`, body, this.key)
      : await this.api.call<{ code?: string; field?: string; interview_id?: string }>('POST', `/v1/candidates/${id}/interviews`, body, this.key);
    if (run !== this.run) return;
    const code = r?.body && typeof r.body === 'object' ? (r.body as { code?: string }).code : undefined;
    if (r && (r.status === 201 || r.status === 200)) {
      const done = resched ? this.base()!.id : (r.body as { interview_id?: string }).interview_id ?? '';
      this.finish(done);
      return;
    }
    if (!r) {
      // No answer: the request may have saved. Read the tab first (S-1).
      const list = await this.reread()();
      if (run !== this.run) return;
      const found = (list ?? []).find((x) => (resched ? x.id === this.base()!.id && (x.sequence ?? 0) > this.base()!.sequence : !before.has(x.id) && x.type === body['type']));
      if (found?.id) { this.finish(found.id, true); return; }
      this.fail();
      return;
    }
    if (r.status === 400 && (code === 'AT_IN_PAST' || code === 'INVALID_FIELD')) {
      const f = code === 'AT_IN_PAST' ? 'date' : SERVER_FIELD[(r.body as { field?: string }).field ?? ''];
      if (f) {
        this.problems.set({ [f]: FIELD_WORDS[f] });
        this.summaryRun.update((n) => n + 1);
        this.busy.set(false);
        if (f === 'panel') { const pp = peopleOf(await this.api.call('GET', '/v1/panel-members')); if (run === this.run && pp) this.people.set(pp); }
        return;
      }
    }
    if (r.status === 409 && code === 'TYPE_ALREADY_BOOKED' && !resched) {
      this.type.set(null);
      this.problems.set({ type: W['bookedServer'] });
      await this.reread()();
      if (run === this.run) this.busy.set(false);
      return;
    }
    if (r.status === 409 && code === 'GUEST_EMAIL_OFF') {
      const s = panelSettingsOf(await this.api.call('GET', '/v1/config?configType=PANEL_CONFIG&active=true'));
      if (run !== this.run) return;
      if (s) this.settings.set(s);
      if (!this.guestShown()) this.guest.set('');
      this.fail();
      return;
    }
    if (r.status === 409 && code === 'HAS_FEEDBACK' && resched) {
      this.top.set(W['hasFeedback']);
      this.hasFeedback.set(true);
      this.busy.set(false);
      await this.reread()();
      return;
    }
    if (r.status === 409 && code === 'NOT_ALLOWED_NOW') {
      this.fail();
      await Promise.all([this.rereadRecord()(), this.reread()()]);
      return;
    }
    this.fail();
  }

  private fail() { this.top.set(W['saveFail']); this.busy.set(false); }

  private finish(id: string, fresh = false) {
    this.run++;
    this.open.set(false);
    this.reset();
    this.saved.emit({ id, fresh });
  }

  protected cancel() { this.open.set(false); this.dismiss(); }
  /** Cancel, the close button or Escape: everything typed goes, and a late answer draws nothing. */
  protected dismiss() { this.run++; this.reset(); this.dismissed.emit(); }

  private reset() {
    this.run++;
    // Gone from the page once the drawer has closed and handed focus back.
    setTimeout(() => { if (!this.open()) this.alive.set(false); });
    this.types.set(null); this.settings.set(null); this.people.set([]); this.state.set('loading'); this.base.set(null);
    this.type.set(null); this.date.set(null); this.pickerProblem.set(null); this.time.set(null); this.length.set(null); this.lengthChosen = false;
    this.where.set(null); this.place.set(''); this.link.set(''); this.panel.set([]); this.guest.set(''); this.note.set(''); this.reason.set('');
    this.problems.set({}); this.top.set(null); this.busy.set(false); this.hasFeedback.set(false); this.key = ''; this.sentBody = null;
  }

  ngOnDestroy() { this.run++; }
}
