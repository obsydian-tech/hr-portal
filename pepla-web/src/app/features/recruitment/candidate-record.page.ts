import { ApplicationRef, ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Location } from '@angular/common';
import { Title } from '@angular/platform-browser';
import {
  PpBreadcrumbs, PpButton, PpCard, PpDl, PpLozenge, PpMoveDialog, PpPersonHeader, PpPersonHeaderActions, PpProgressTracker, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup, PpTabs, PpTimeline,
  type Crumb, type IconName, type PersonFact, type Status, type Step, type Tab,
} from '../../ds';
import type { components } from '../../core/api/openapi';
import { historyDays } from './candidate-history';
import { stageTime } from './candidate-list';
import { HireApi, newKey, optionsOf, type CandidateEventRow, type RoleOptions } from './hire-api';
import { InterviewsTab, defaultInterview, type InterviewList } from './interviews/interviews-tab';
import { ScheduleDrawer } from './interviews/schedule.drawer';
import { CloseInterviewDialog, type CloseAction } from './interviews/close-interview.dialog';
import { shortDate } from './hire-format';
import { INTERVIEWS_TAB_READY, NOTES_TAB_READY, OFFER_TAB_READY } from './hire-flags';
import { NotHiredDialog, SAVE_FAIL } from './not-hired-dialog';

type CandidateRecord = components['schemas']['CandidateRecord'];
type Stage = CandidateRecord['stage'];

const TITLE = 'Naleko People';
const HISTORY_FAIL = 'The history could not be loaded.';
const DAY = 86_400_000;
const STAGES = [['APPLIED', 'Applied'], ['SCREENING', 'Screening'], ['INTERVIEW', 'Interview'], ['OFFER', 'Offer'], ['HIRED', 'Hired']] as const;
const STAGE_NAME: Record<string, string> = Object.fromEntries(STAGES);
const OPEN_STAGES: readonly string[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];

/**
 * What the page draws, taken from the record once, field by field (REC-UI-02 step 3, rule R-2). Nothing else of the record is kept
 * on the page: not the scores, the sentiments, the setting versions, the person who added or decided, the employee id, nor the old
 * and later fields (`strong_no_count`, `reason_code`, `decided_by`, `stage_before_not_hired`, `legacy_stage`).
 */
interface View {
  id: string;
  name: string;
  first: string;
  roleTitle: string | null;
  department: string | null;
  level: string | null;
  source: string | null;
  appliedAt: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  stage: Stage;
  stageEnteredAt: string | null;
  dueAt: string | null;
  slaStatus: NonNullable<CandidateRecord['sla_status']> | null;
  next: { from: string; to: string; blocked: boolean } | null;
  canMove: boolean;
  canDecide: boolean;
}

const text = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function viewOf(r: CandidateRecord): View {
  const first = text(r.firstName);
  const last = text(r.lastName);
  const n = r.next_step;
  return {
    id: r.id, name: [first, last].filter(Boolean).join(' '), first: first ?? '',
    roleTitle: text(r.role_title), department: text(r.department), level: text(r.level), source: text(r.source), appliedAt: text(r.applied_at), location: text(r.location),
    email: text(r.email), phone: text(r.phone), stage: r.stage, stageEnteredAt: text(r.stage_entered_at), dueAt: text(r.due_at), slaStatus: r.sla_status ?? null,
    next: n ? { from: n.from, to: n.to, blocked: n.blocker?.code === 'INTERVIEWS_INCOMPLETE' } : null,
    canMove: r.can_move === true, canDecide: r.can_decide === true,
  };
}

/**
 * One candidate (REC-UI-02 step 3, NH-228): who they are, where they are on the hiring path, what stops them moving on, their
 * contact details, and Move and Not hired. Overview only; the other tabs wait behind flags. Everything it holds lives in this page,
 * so nothing outlives it or a sign-out.
 */
@Component({
  selector: 'app-candidate-record-page',
  imports: [InterviewsTab, NotHiredDialog, ScheduleDrawer, CloseInterviewDialog, PpBreadcrumbs, PpButton, PpCard, PpDl, PpLozenge, PpMoveDialog, PpPersonHeader, PpPersonHeaderActions, PpProgressTracker, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup, PpTabs, PpTimeline],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-200">
      <pp-breadcrumbs [items]="crumbs()" />
      @switch (status()) {
        @case ('loading') {
          <pp-skeleton-group label="Loading this candidate" class="pp-stack pp-gap-200">
            <pp-skeleton shape="avatar" />
            <pp-skeleton shape="heading" width="40%" />
            <pp-skeleton shape="text" width="60%" />
            <pp-skeleton shape="card" />
          </pp-skeleton-group>
        }
        @case ('notfound') { <pp-section-message tone="danger" heading="This candidate could not be found." /> }
        @case ('failed') {
          <pp-section-message tone="danger" heading="This candidate could not be loaded.">
            <pp-section-message-actions><button ppButton type="button" (click)="tryAgain()">Try again</button></pp-section-message-actions>
          </pp-section-message>
        }
        @default {
          @if (v(); as c) {
            <pp-person-header [name]="c.name" [role]="roleLine()" [facts]="facts()">
              @if (lozenge(); as l) { <pp-lozenge [status]="l.status" [icon]="l.icon">{{ l.words }}</pp-lozenge> }
              <pp-person-header-actions>
                @if (showNotHired()) { <button ppButton type="button" (click)="askNotHired()">Not hired</button> }
                @if (c.canMove) { <button ppButton appearance="primary" icon="arrow-right-left" type="button" (click)="askMove()">Move</button> }
              </pp-person-header-actions>
            </pp-person-header>
            @if (saveFailed()) { <pp-section-message tone="danger" [heading]="saveFail" /> }
            <pp-progress-tracker label="Hiring stages" [steps]="steps()" [vertical]="true" />
            <pp-tabs [label]="c.name" [tabs]="tabs()" [selected]="tab()" (selectedChange)="chooseTab($event)" [panel]="false" />
            @if (tab() === 'interviews') {
              <div role="tabpanel" [attr.aria-labelledby]="tabId('interviews')">
                <app-interviews-tab [state]="interviews()" [list]="interviewRows()" [required]="interviewsRequired()" [chosen]="chosenInterview()" [atInterview]="c.stage === 'INTERVIEW'"
                  (choose)="chooseInterview($event)" (retry)="tryInterviewsAgain()" (schedule)="openSchedule($event)" (reschedule)="openReschedule($event)" (act)="openClose($event)" />
              </div>
            } @else if (tab() === 'notes') {
              <div role="tabpanel" class="pp-stack pp-gap-200" [attr.aria-labelledby]="tabId('notes')">
                @if (notes() === 'failed') {
                  <pp-section-message tone="danger" [heading]="historyFail">
                    <pp-section-message-actions><button ppButton type="button" (click)="tryNotesAgain()">Try again</button></pp-section-message-actions>
                  </pp-section-message>
                } @else {
                  <pp-timeline [label]="'History for ' + c.name" [days]="history().days" [events]="history().loose" [loading]="notes() !== 'ready'" empty="No history yet." />
                }
              </div>
            } @else {
            <div class="pp-columns pp-columns--wide-aside pp-gap-200">
              <div class="pp-stack pp-gap-200">
                @if (c.next; as n) {
                  <pp-card heading="Next step" [level]="2" [subheading]="stageName(n.from) + ' to ' + stageName(n.to)">
                    @if (n.blocked && c.first) {
                      <pp-section-message tone="warning" [heading]="c.first + ' cannot move on yet'">Every required interview must be done first.</pp-section-message>
                    }
                  </pp-card>
                }
                <pp-card heading="Candidate details" [level]="2">
                  @if (details().length) {
                    <dl ppDl>@for (d of details(); track d[0]) { <dt>{{ d[0] }}</dt><dd>{{ d[1] }}</dd> }</dl>
                  }
                </pp-card>
              </div>
              <div class="pp-stack pp-gap-200"></div>
            </div>
            }
          }
        }
      }
    </div>
    <app-schedule-drawer [candidateId]="id()" [name]="v()?.name ?? ''" [first]="v()?.first ?? ''" [roleTitle]="v()?.roleTitle ?? null" [panelSize]="panelSize()"
      [optionsFailed]="!options()" [interviews]="interviewRows()" [retryOptions]="retryOptions" [reread]="rereadInterviews" [rereadRecord]="rereadRecord"
      (saved)="scheduled($event)" (dismissed)="drawerClosed()" />
    <app-close-interview-dialog [candidateId]="id()" [reread]="rereadInterviews" (saved)="closeSaved($event)" />
    <pp-move-dialog [stages]="stageList()" [request]="moving()" (confirmed)="move($event)" (dismissed)="moving.set(null)" />
    <app-not-hired-dialog [who]="notHiredFor()" [failed]="notHiredFailed()" (record)="recordNotHired($event)" (dismissed)="notHiredOpen.set(false)" />`,
})
export class CandidateRecordPage {
  /** The candidate's id from the address. */
  readonly id = input.required<string>();
  /** `tab` and `interview` from the address (INT-UI-01 M-6). The page writes them back with `replaceState`, so these only change when the address is opened. */
  readonly tabInAddress = input<string | undefined>(undefined, { alias: 'tab' });
  readonly interviewInAddress = input<string | undefined>(undefined, { alias: 'interview' });
  /** `schedule=new` opens the Schedule drawer (INT-UI-02 rule 2c). */
  readonly scheduleInAddress = input<string | undefined>(undefined, { alias: 'schedule' });
  private readonly drawer = viewChild.required(ScheduleDrawer);
  private readonly closeDialog = viewChild.required(CloseInterviewDialog);
  protected openClose(e: { action: CloseAction; id: string }) {
    const x = this.interviewRows().find((i) => i.id === e.id);
    if (x) this.closeDialog().open(e.action, x);
  }
  protected closeSaved(id: string) {
    this.chosenInterview.set(id);
    this.writeAddress();
    setTimeout(() => (this.host.querySelector('ul[aria-label="Interviews"] > li[aria-current="true"]') as HTMLElement | null)?.focus());
  }
  /** The address asked for the drawer and it is open: `schedule=new` stays in the address until it closes. */
  private scheduleByAddress = false;
  private scheduleWanted: string | null = null;

  private readonly api = inject(HireApi);
  private readonly title = inject(Title);
  private readonly location = inject(Location);
  private readonly app = inject(ApplicationRef);
  protected readonly saveFail = SAVE_FAIL;
  protected readonly status = signal<'loading' | 'ready' | 'notfound' | 'failed'>('loading');
  protected readonly v = signal<View | null>(null);
  protected readonly options = signal<RoleOptions | null>(null);
  /** The panel size for the candidate's level (fact 8): 3 when the level is missing or unknown. */
  protected readonly panelSize = computed(() => { const l = this.v()?.level; const n = l ? this.options()?.panel_size_by_level?.[l] : undefined; return typeof n === 'number' && n > 0 ? n : 3; });
  protected readonly tab = signal('overview');
  protected readonly historyFail = HISTORY_FAIL;
  /** The Notes tab's history (REC-UI-02 step 4): `idle` until Notes is chosen, then read once and kept until the candidate changes or a Move or Not hired is saved. */
  protected readonly notes = signal<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  private readonly noteRows = signal<readonly CandidateEventRow[]>([]);
  protected readonly history = computed(() => historyDays(this.noteRows(), this.v()?.first ?? ''));
  /** The Interviews tab (INT-UI-01): read once when the tab is first shown for this candidate, and only after the record has answered. */
  protected readonly interviews = signal<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  protected readonly interviewRows = signal<InterviewList['interviews']>([]);
  protected readonly interviewsRequired = signal<{ done: number; total: number } | null>(null);
  protected readonly chosenInterview = signal<string | null>(null);
  private interviewRun = 0;
  /** Each read of the history gets its own run: an answer that comes back after the candidate changed or the history was dropped is thrown away. */
  private noteRun = 0;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly saveFailed = signal(false);
  protected readonly moving = signal<{ name: string; from: string; to: string } | null>(null);
  protected readonly notHiredOpen = signal(false);
  protected readonly notHiredFailed = signal(false);
  /** Each address gets its own run: an answer that comes back after the address changed is dropped. */
  private run = 0;

  /** Screening is left out when the company has it off; a failed options read keeps all five (REC-14 rule 24). */
  private readonly stageIds = computed(() => STAGES.filter(([id]) => id !== 'SCREENING' || this.options()?.screening !== false));
  protected readonly stageList = computed(() => this.stageIds().map(([id, name]) => ({ id, name })));
  protected readonly stageName = (id: string) => STAGE_NAME[id] ?? id;

  /** The level's name from the options read, never its key; left out when that read failed or does not know the key. */
  private readonly levelName = computed(() => {
    const key = this.v()?.level;
    return key ? (this.options()?.levels.find((l) => l.key === key)?.label ?? null) : null;
  });
  protected readonly roleLine = computed(() => {
    const c = this.v();
    return c ? [c.roleTitle, c.department, this.levelName()].filter(Boolean).join(' · ') : '';
  });
  protected readonly facts = computed<PersonFact[]>(() => {
    const c = this.v();
    if (!c) return [];
    const out: PersonFact[] = [];
    if (c.source) out.push({ icon: 'users', text: c.source });
    if (c.appliedAt && !Number.isNaN(Date.parse(c.appliedAt))) out.push({ icon: 'calendar-days', text: `Applied ${shortDate(c.appliedAt)}` });
    if (c.location) out.push({ icon: 'map-pin', text: c.location });
    return out;
  });
  protected readonly details = computed<Array<[string, string]>>(() => {
    const c = this.v();
    if (!c) return [];
    const rows: Array<[string, string | null]> = [['Email', c.email], ['Phone', c.phone], ['Level', this.levelName()], ['Source', c.source]];
    return rows.filter((r): r is [string, string] => r[1] !== null);
  });
  protected readonly crumbs = computed<Crumb[]>(() => {
    const name = this.status() === 'ready' ? this.v()?.name : '';
    return [{ label: 'Candidates', link: '/hire/candidates' }, ...(name ? [{ label: name, link: `/hire/candidates/${encodeURIComponent(this.v()!.id)}` }] : [])];
  });
  protected readonly tabs = computed<Tab[]>(() => [
    { id: 'overview', label: 'Overview', icon: 'layout-dashboard' as IconName },
    ...(INTERVIEWS_TAB_READY ? [{ id: 'interviews', label: 'Interviews', icon: 'messages-square' as IconName }] : []),
    ...(OFFER_TAB_READY ? [{ id: 'offer', label: 'Offer', icon: 'file-text' as IconName }] : []),
    ...(NOTES_TAB_READY ? [{ id: 'notes', label: 'Notes', icon: 'pencil' as IconName }] : []),
  ]);

  /** The status beside the name: the lists' own stage-time words while open, then "Hired" or "Not hired". */
  protected readonly lozenge = computed<{ words: string; status: Status; icon: IconName } | null>(() => {
    const c = this.v();
    if (!c) return null;
    if (c.stage === 'HIRED') return { words: 'Hired', status: 'success', icon: 'circle-check' };
    if (c.stage === 'NOT_HIRED') return { words: 'Not hired', status: 'neutral', icon: 'circle-x' };
    const t = stageTime({ due_at: c.dueAt, sla_status: c.slaStatus });
    if (!t) return null;
    return t.tone === 'danger' ? { words: t.words, status: 'danger', icon: 'clock-alert' } : t.tone === 'warning' ? { words: t.words, status: 'warning', icon: 'clock' } : { words: t.words, status: 'neutral', icon: 'clock' };
  });

  protected readonly steps = computed<Step[]>(() => {
    const c = this.v();
    if (!c) return [];
    const ids = this.stageIds().map(([id]) => id as string);
    const at = ids.indexOf(c.stage);
    return this.stageIds().map(([id, label], i): Step => {
      if (c.stage === 'HIRED') return { label, state: 'done', ...(id === 'HIRED' && c.stageEnteredAt ? { meta: `Hired ${shortDate(c.stageEnteredAt)}` } : {}) };
      if (c.stage === 'NOT_HIRED' || at < 0) return { label, state: 'upcoming' };
      if (i < at) return { label, state: 'done' };
      if (i > at) return { label, state: 'upcoming' };
      return { label, state: 'current', ...(this.daysIn(c) !== null ? { meta: this.daysIn(c)! } : {}) };
    });
  });
  private daysIn(c: View): string | null {
    const t = c.stageEnteredAt ? Date.parse(c.stageEnteredAt) : NaN;
    if (Number.isNaN(t)) return null;
    const n = Math.max(0, Math.floor((Date.now() - t) / DAY));
    return `${n} ${n === 1 ? 'day' : 'days'} in stage`;
  }

  /** Not hired is for open stages only: `can_decide` is also true on a Not hired record, where it means "may reopen". */
  protected readonly showNotHired = computed(() => { const c = this.v(); return !!c && c.canDecide && OPEN_STAGES.includes(c.stage); });
  protected readonly notHiredFor = computed(() => { const c = this.v(); return this.notHiredOpen() && c ? { name: c.name, waiting: false, line: null } : null; });

  constructor() {
    effect(() => {
      const id = this.id();
      const tab = this.tabInAddress();
      const interview = this.interviewInAddress();
      const schedule = this.scheduleInAddress();
      untracked(() => { this.scheduleWanted = schedule ?? null; void this.open(id, tab, interview); });
    });
    effect(() => {
      if (this.tab() === 'notes' && this.status() === 'ready' && this.notes() === 'idle') untracked(() => void this.readNotes());
    });
    effect(() => {
      if (this.tab() === 'interviews' && this.status() === 'ready' && this.interviews() === 'idle') untracked(() => void this.readInterviews());
    });
  }

  /** pp-tabs makes each tab's id itself; a tab's panel is labelled by it. */
  protected tabId(name: string): string | null { return this.host.querySelector(`[role="tab"][id$="-${name}"]`)?.id ?? null; }

  /** Choosing a tab writes `tab` into the address with no new history entry; `interview` stays only on the Interviews tab (INT-UI-01 M-6). */
  protected chooseTab(id: string) {
    this.tab.set(id);
    this.writeAddress();
  }

  protected chooseInterview(id: string) {
    this.chosenInterview.set(id);
    this.writeAddress();
  }

  private writeAddress() {
    const [path, query = ''] = this.location.path().split('?');
    const q = new URLSearchParams(query);
    q.set('tab', this.tab());
    const chosen = this.chosenInterview();
    if (this.tab() === 'interviews' && chosen) q.set('interview', chosen); else q.delete('interview');
    if (this.scheduleByAddress) q.set('schedule', 'new'); else q.delete('schedule');
    this.location.replaceState(path, q.toString());
  }

  protected tryInterviewsAgain() {
    const chosen = this.chosenInterview();
    this.dropInterviews();
    this.chosenInterview.set(chosen);
    // The page is zoneless: draw the loading look now, so the failure line is gone the moment "Try again" is clicked.
    this.app.tick();
  }

  private dropInterviews() {
    this.interviewRun++;
    this.interviewRows.set([]);
    this.interviewsRequired.set(null);
    this.chosenInterview.set(null);
    this.interviews.set('idle');
  }

  /** The interviews read for the candidate on the page. An answer that comes back after the address changed is thrown away. */
  private async readInterviews() {
    const run = ++this.interviewRun;
    const id = this.id();
    const wanted = this.chosenInterview();
    this.interviews.set('loading');
    const list = await this.api.candidateInterviews(id);
    if (run !== this.interviewRun) return;
    if (!list) { this.interviews.set('failed'); this.scheduleFromAddress(); return; }
    this.interviewRows.set(list.interviews);
    this.interviewsRequired.set(list.required && typeof list.required === 'object' ? { done: list.required.done, total: list.required.total } : null);
    this.chosenInterview.set(defaultInterview(list.interviews, wanted));
    this.interviews.set('ready');
    if (this.tab() === 'interviews') this.writeAddress();
    this.scheduleFromAddress();
  }

  /** `schedule=new` opens the drawer once the tab has drawn its answer at the Interview stage; anything else is removed from the address. */
  private scheduleFromAddress() {
    const wanted = this.scheduleWanted;
    if (wanted === null) return;
    this.scheduleWanted = null;
    if (wanted === 'new' && this.tab() === 'interviews' && this.interviews() === 'ready' && this.v()?.stage === 'INTERVIEW') {
      this.scheduleByAddress = true;
      this.writeAddress();
      this.drawer().openSchedule(null);
    } else this.dropSchedule();
  }
  private dropSchedule() {
    this.scheduleWanted = null;
    this.scheduleByAddress = false;
    const [path, query = ''] = this.location.path().split('?');
    const q = new URLSearchParams(query);
    if (!q.has('schedule')) return;
    q.delete('schedule');
    this.location.replaceState(path, q.toString());
  }

  protected openSchedule(type: string | null) { this.drawer().openSchedule(type); }
  protected openReschedule(id: string) {
    const x = this.interviewRows().find((i) => i.id === id);
    if (x) this.drawer().openReschedule(x);
  }
  protected readonly retryOptions = async (): Promise<boolean> => {
    const o = optionsOf(await this.api.call('GET', '/v1/roles/options'));
    if (o) this.options.set(o);
    return !!o;
  };
  protected readonly rereadInterviews = async () => {
    await this.readInterviews();
    return this.interviews() === 'ready' ? this.interviewRows() : null;
  };
  protected readonly rereadRecord = () => this.reread();
  protected async scheduled(e: { id: string; fresh: boolean }) {
    this.scheduleByAddress = false;
    this.chosenInterview.set(e.id);
    if (e.fresh) { this.chosenInterview.set(defaultInterview(this.interviewRows(), e.id)); this.writeAddress(); return; }
    await this.readInterviews();
  }
  protected drawerClosed() {
    const byAddress = this.scheduleByAddress;
    this.dropSchedule();
    this.writeAddress();
    if (byAddress) setTimeout(() => (this.host.querySelector('[role="tab"][id$="-interviews"]') as HTMLElement | null)?.focus());
  }

  protected tryNotesAgain() { this.dropNotes(); }

  /** Forgets the kept history and any answer still on its way; if Notes is showing, the effect above reads it again at once. */
  private dropNotes() {
    this.noteRun++;
    this.noteRows.set([]);
    this.notes.set('idle');
  }

  private async readNotes() {
    const run = ++this.noteRun;
    const id = this.id();
    this.notes.set('loading');
    const rows = await this.api.candidateEvents(id);
    if (run !== this.noteRun) return;
    this.noteRows.set(rows ?? []);
    this.notes.set(rows ? 'ready' : 'failed');
  }

  protected tryAgain() { void this.open(this.id(), this.tab(), this.chosenInterview() ?? undefined); }

  /** Opens an address: nothing of the last candidate stays, the title goes back to "Candidate", and the record and the options are read. */
  private async open(id: string, tab?: string, interview?: string) {
    const run = ++this.run;
    this.tab.set(tab && this.tabs().some((t) => t.id === tab) ? tab : 'overview');
    this.dropNotes();
    this.dropInterviews();
    this.chosenInterview.set(interview ?? null);
    this.v.set(null);
    this.status.set('loading');
    this.saveFailed.set(false);
    this.moving.set(null);
    this.notHiredOpen.set(false);
    this.title.setTitle(`Candidate · ${TITLE}`);
    const [rec, opts] = await Promise.all([this.read(id), this.api.call('GET', '/v1/roles/options').then(optionsOf)]);
    if (run !== this.run) return;
    this.options.set(opts);
    this.show(rec);
    if (this.scheduleWanted !== null && (this.status() !== 'ready' || this.tab() !== 'interviews')) this.dropSchedule();
  }

  private read(id: string) { return this.api.call<CandidateRecord>('GET', `/v1/candidates/${encodeURIComponent(id)}`); }

  private show(rec: Awaited<ReturnType<CandidateRecordPage['read']>>) {
    if (rec?.status === 404) { this.status.set('notfound'); return; }
    if (!rec || rec.status !== 200 || !rec.body || typeof rec.body !== 'object') { this.status.set('failed'); return; }
    const c = viewOf(rec.body);
    this.v.set(c);
    this.status.set('ready');
    this.title.setTitle(c.name ? `${c.name} · ${TITLE}` : `Candidate · ${TITLE}`);
  }

  /** After a Move or Not hired the record is read once more, and only then does the page change. */
  private async reread() {
    const run = this.run;
    const id = this.id();
    const rec = await this.read(id);
    if (run !== this.run) return;
    this.show(rec);
  }

  protected askMove() {
    const c = this.v();
    if (!c) return;
    this.saveFailed.set(false);
    this.moving.set({ name: c.name, from: c.stage, to: c.stage });
  }

  /** The same request as the board's Move (REC-UI-01): `PUT /v1/candidates/{id}/stage` with `{ to, reason }` and a new Idempotency-Key. */
  protected async move(e: { to: string; reason: string }) {
    const c = this.v();
    this.moving.set(null);
    if (!c) return;
    const run = this.run;
    const r = await this.api.call('PUT', `/v1/candidates/${encodeURIComponent(c.id)}/stage`, { to: e.to, reason: e.reason }, newKey());
    if (run !== this.run) return;
    if (r?.status !== 200) { this.saveFailed.set(true); return; }
    this.dropNotes();
    await this.reread();
  }

  protected askNotHired() {
    this.saveFailed.set(false);
    this.notHiredFailed.set(false);
    this.notHiredOpen.set(true);
  }

  /** The same request as the board's Not hired (REC-UI-01): `POST /v1/candidates/{id}/not-hired` with the reason's code. */
  protected async recordNotHired(reason: string | null) {
    const c = this.v();
    if (!c || !reason) return;
    this.notHiredFailed.set(false);
    const run = this.run;
    const r = await this.api.call('POST', `/v1/candidates/${encodeURIComponent(c.id)}/not-hired`, { reason });
    if (run !== this.run) return;
    if (r?.status !== 200) { this.notHiredFailed.set(true); return; }
    this.notHiredOpen.set(false);
    this.dropNotes();
    await this.reread();
  }
}
