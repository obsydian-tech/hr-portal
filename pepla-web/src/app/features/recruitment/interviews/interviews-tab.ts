import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { PpAvatarGroup, PpButton, PpCard, PpDropdownMenu, PpMenuItem, PpDeadline, PpEmptyState, PpLozenge, PpPerson, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup, type IconName, type Status } from '../../../ds';
import type { components } from '../../../core/api/openapi';
import { shortDate } from '../hire-format';
import { DRAWER_LINES, INTERVIEW_WORDS as W, typeWords } from './interview-words';
import { CAPTURE_FEEDBACK_READY, CLOSE_ACTIONS_READY, RESCHEDULE_READY, SCHEDULE_READY } from '../hire-flags';
import type { CloseAction } from './close-interview.dialog';

export type InterviewList = components['schemas']['InterviewList'];
type Item = InterviewList['interviews'][number];
type Entry = Item['panel'][number];
const SAST = 2 * 3_600_000;
const DAY = 86_400_000;
const sastMid = (ms: number) => { const d = new Date(ms + SAST); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const hhmm = (iso: string) => { const d = new Date(Date.parse(iso) + SAST); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const valid = (s: string | null | undefined): s is string => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const when = (at: string | null | undefined) => (valid(at) ? `${shortDate(at)}, ${hhmm(at)}` : null);

export type Line = { name: string; meta: string | null; words: string | null; overdue: { due: string; words: string } | null; email: string | null };
export type View = {
  id: string; type: string | null; when: string | null; names: string[]; status: { words: string; tone: Status; icon: IconName } | null;
  length: string | null; where: string | null; link: string | null; reason: string | null; closedNote: string | null; note: string | null; lines: Line[];
};

/**
 * Which interview is chosen (INT-UI-01 M-6): the one the address names; else the newest open one (the last SCHEDULED in the answer's
 * order); else the last one; `null` for an empty list.
 */
export function defaultInterview(list: readonly Item[], wanted: string | null | undefined): string | null {
  if (wanted && list.some((x) => x.id === wanted)) return wanted;
  const open = list.filter((x) => x.status === 'SCHEDULED');
  const pick = open.length ? open[open.length - 1] : list[list.length - 1];
  return pick?.id ?? null;
}

export function viewOf(x: Item, now: number): View {
  const started = valid(x.at) && Date.parse(x.at) < now;
  const waiting = x.panel.filter((e) => e.feedback === 'WAITING').length;
  let status: View['status'] = null;
  if (x.status === 'COMPLETED') status = { words: W.status['COMPLETED']!, tone: 'success', icon: 'circle-check' };
  else if (x.status === 'CANCELLED') status = { words: W.status['CANCELLED']!, tone: 'neutral', icon: 'circle-x' };
  else if (x.status === 'DID_NOT_HAPPEN') status = { words: W.status['DID_NOT_HAPPEN']!, tone: 'neutral', icon: 'circle-slash' };
  else if (x.status === 'SCHEDULED' && started && waiting) status = { words: `Waiting on ${waiting} feedback`, tone: 'information', icon: 'hourglass' };
  const reasons = x.status ? W.reasons[x.status] : undefined;
  const reason = x.closed_reason && reasons ? reasons[x.closed_reason] ?? null : null;
  const link = x.where === 'ONLINE' && typeof x.video_link === 'string' && /^https?:\/\//.test(x.video_link) ? x.video_link : null;
  const where = x.where === 'IN_PERSON' ? [W.lines['inPerson'], x.place].filter(Boolean).join(' · ')
    : x.where === 'ONLINE' ? [W.lines['online'], link ? null : x.video_link].filter(Boolean).join(' · ') : null;
  const lines = x.panel.map((e: Entry): Line => {
    const guest = e.kind === 'GUEST';
    const name = e.name ?? (guest ? W.lines['guest']! : '');
    const meta = guest && e.name ? W.lines['guest']! : e.vote?.on_behalf_by_name ? `Captured by ${e.vote.on_behalf_by_name} for ${(e.name ?? '').split(' ')[0]}` : null;
    let words: string | null = null;
    if (e.no_feedback) words = W.lines['noFeedback']!;
    else if (e.vote) {
      const r = e.vote.rating ? W.ratings[e.vote.rating] ?? null : null;
      const o = typeof e.vote.overall === 'number' ? `${e.vote.overall} out of 5` : null;
      words = r && o ? `${r} · ${o}` : r ?? o;
    }
    let overdue: Line['overdue'] = null;
    if (started && e.feedback === 'WAITING' && !e.no_feedback && valid(e.due_at) && Date.parse(e.due_at) < now) {
      const n = Math.round((sastMid(now) - sastMid(Date.parse(e.due_at))) / DAY);
      overdue = { due: e.due_at, words: n >= 1 ? `Overdue by ${n} day${n === 1 ? '' : 's'}` : 'Overdue' };
    }
    return { name, meta, words, overdue, email: guest && typeof e.email === 'string' && e.email ? e.email : null };
  });
  return {
    id: x.id ?? '', type: typeWords(x.type), when: when(x.at), names: x.panel.map((e, i) => e.name ?? `Guest ${i + 1}`), status,
    length: typeof x.length_minutes === 'number' ? `${x.length_minutes} minutes` : null, where: where || null, link, reason,
    closedNote: typeof x.closed_note === 'string' && x.closed_note ? x.closed_note : null,
    note: typeof x.candidate_note === 'string' && x.candidate_note ? x.candidate_note : null, lines,
  };
}

@Component({
  selector: 'app-interviews-tab',
  imports: [PpAvatarGroup, PpButton, PpCard, PpDropdownMenu, PpMenuItem, PpDeadline, PpEmptyState, PpLozenge, PpPerson, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state()) {
      @case ('failed') {
        <pp-section-message tone="danger" heading="Interviews could not be loaded.">
          <pp-section-message-actions><button ppButton type="button" (click)="retry.emit()">Try again</button></pp-section-message-actions>
        </pp-section-message>
      }
      @case ('ready') {
        @if (!views().length) {
          <pp-card><pp-empty-state heading="No interviews yet." [compact]="true" />
            @if (canSchedule()) { <button ppButton appearance="primary" icon="calendar-plus" type="button" (click)="schedule.emit(null)">{{ ctl['schedule'] }}</button> }
          </pp-card>
        } @else {
          <div class="pp-columns pp-columns--even pp-gap-200">
            <div class="pp-stack pp-gap-150">
              <div class="pp-inline pp-gap-100"><span class="pp-text pp-text--strong">Interviews</span>
                @if (required(); as r) { <span class="pp-text pp-text--subtle">{{ r.done }} of {{ r.total }} required interviews done</span> }
              </div>
              <ul class="pp-stack pp-gap-100" aria-label="Interviews">
                @for (r of views(); track $index) {
                  <li tabindex="0" [attr.aria-current]="r.id === chosen() ? 'true' : null" (click)="choose.emit(r.id)" (keydown.enter)="choose.emit(r.id)" (keydown.space)="$event.preventDefault(); choose.emit(r.id)">
                    <pp-card [compact]="true" [selected]="r.id === chosen()">
                      <div class="pp-inline pp-gap-150 pp-inline--between">
                        <div class="pp-stack pp-gap-025">
                          @if (r.type) { <span class="pp-text pp-text--strong">{{ r.type }}</span> }
                          @if (r.when) { <span class="pp-text pp-text--small pp-text--subtle">{{ r.when }}</span> }
                          @if (r.names.length) { <pp-avatar-group [names]="r.names" label="Interview panel" /> }
                        </div>
                        @if (r.status; as s) { <pp-lozenge [status]="s.tone" [icon]="s.icon">{{ s.words }}</pp-lozenge> }
                      </div>
                    </pp-card>
                  </li>
                }
              </ul>
              @if (canSchedule()) { <span><button ppButton appearance="primary" icon="calendar-plus" type="button" (click)="schedule.emit(null)">{{ ctl['schedule'] }}</button></span> }
            </div>
            @if (current(); as c) {
              <pp-card [heading]="c.type ?? undefined" [subheading]="c.when ?? undefined" [level]="2">
                <div class="pp-stack pp-gap-050">
                  @if (c.status; as s) { <span><pp-lozenge [status]="s.tone" [icon]="s.icon">{{ s.words }}</pp-lozenge></span> }
                  @if (c.reason) { <span class="pp-text pp-text--small">{{ c.reason }}</span> }
                  @if (c.closedNote) { <span class="pp-text pp-text--small">{{ c.closedNote }}</span> }
                  @if (c.length) { <span class="pp-text pp-text--small">{{ c.length }}</span> }
                  @if (c.where || c.link) {
                    <span class="pp-text pp-text--small">{{ c.where }}@if (c.link) { · <a [href]="c.link" target="_blank" rel="noopener noreferrer">{{ c.link }}</a> }</span>
                  }
                  @if (c.note) { <span class="pp-text pp-text--small pp-text--strong">Note for the candidate</span><span class="pp-text pp-text--small">{{ c.note }}</span> }
                </div>
                @if (canReschedule()) { <span><button ppButton icon="calendar-days" type="button" (click)="reschedule.emit(c.id)">{{ ctl['reschedule'] }}</button></span> }
                @if (closeActions().length) {
                  @if (phone()) {
                    @for (a of closeActions(); track a.action) { <button ppButton [icon]="a.icon" type="button" [block]="true" (click)="act.emit({ action: a.action, id: c.id })">{{ a.words }}</button> }
                  } @else {
                    <pp-dropdown-menu [label]="menuName()">
                      @for (a of closeActions(); track a.action) { <button ppMenuItem [icon]="a.icon" (click)="act.emit({ action: a.action, id: c.id })">{{ a.words }}</button> }
                    </pp-dropdown-menu>
                  }
                }
                @if (closedType(); as t) { <span><button ppButton icon="calendar-plus" type="button" [attr.aria-label]="closedName(t)" (click)="schedule.emit(t)">{{ ctl['schedule'] }}</button></span> }
                <ul class="pp-stack pp-gap-150">
                  @for (l of c.lines; track $index) {
                    <li class="pp-inline pp-gap-150 pp-inline--between">
                      <pp-person [name]="l.name" [meta]="l.meta ?? undefined" />
                      @if (l.email) { <span class="pp-text pp-text--small">{{ l.email }}</span> }
                      @if (l.words) { <span class="pp-text pp-text--small">{{ l.words }}</span> }
                      @if (l.overdue; as o) { <time ppDeadline [due]="o.due" [text]="o.words"></time> }
                    </li>
                  }
                </ul>
                @if (canCapture()) { <span><button ppButton icon="message-square" type="button" [block]="phone()" (click)="capture.emit(c.id)">{{ ctl['capture'] }}</button></span> }
              </pp-card>
            }
          </div>
        }
      }
      @default {
        <pp-skeleton-group label="Loading the interviews" class="pp-stack pp-gap-200"><pp-skeleton shape="card" /><pp-skeleton shape="card" /></pp-skeleton-group>
      }
    }`,
})
export class InterviewsTab {
  readonly state = input.required<'idle' | 'loading' | 'ready' | 'failed'>();
  readonly list = input.required<Item[]>();
  readonly required = input<{ done: number; total: number } | null>(null);
  readonly chosen = input<string | null>(null);
  readonly choose = output<string>();
  readonly retry = output<void>();
  /** INT-UI-02: the record is at the Interview stage (the page knows the stage). */
  readonly atInterview = input(false);
  /** Schedule an interview: null from the tab button, the type key from a closed interview (way b). */
  readonly schedule = output<string | null>();
  readonly reschedule = output<string>();
  protected readonly ctl = W.controls;
  protected readonly canSchedule = computed(() => SCHEDULE_READY && this.atInterview() && this.state() === 'ready');
  private readonly chosenItem = computed(() => this.list().find((x) => x.id === this.chosen()) ?? null);
  protected readonly canReschedule = computed(() => RESCHEDULE_READY && this.chosenItem()?.status === 'SCHEDULED' && this.chosenItem()?.can?.reschedule === true);
  protected readonly closedType = computed(() => {
    const x = this.chosenItem();
    return this.canSchedule() && x && (x.status === 'CANCELLED' || x.status === 'DID_NOT_HAPPEN') && x.type ? x.type : null;
  });
  readonly act = output<{ action: CloseAction; id: string }>();
  /** REC-UI-03 step 2: Capture feedback on the chosen interview. */
  readonly capture = output<string>();
  protected readonly canCapture = computed(() => {
    const x = this.chosenItem();
    return CAPTURE_FEEDBACK_READY && this.state() === 'ready' && !!x && x.can?.capture_feedback === true && Array.isArray(x.criteria_snapshot) && x.criteria_snapshot.length > 0;
  });
  protected readonly phone = toSignal(inject(BreakpointObserver).observe('(max-width: 767px)').pipe(map((r) => r.matches)), { initialValue: false });
  protected readonly closeActions = computed(() => {
    const x = this.chosenItem();
    if (!CLOSE_ACTIONS_READY || this.state() !== 'ready' || !x || x.status !== 'SCHEDULED' || !typeWords(x.type)) return [];
    const all: Array<{ action: CloseAction; on: boolean; icon: IconName; words: string }> = [
      { action: 'cancel', on: x.can?.cancel === true, icon: 'calendar-x' as IconName, words: this.ctl['cancel']! },
      { action: 'did_not_happen', on: x.can?.did_not_happen === true, icon: 'circle-slash' as IconName, words: this.ctl['didNotHappen']! },
      { action: 'complete', on: x.can?.mark_done === true, icon: 'circle-check' as IconName, words: this.ctl['markDone']! },
    ];
    return all.filter((a) => a.on);
  });
  protected readonly menuName = computed(() => (W.close['menu'] ?? '').replace('{type}', (typeWords(this.chosenItem()?.type) ?? '').toLowerCase()));
  protected closedName(t: string) { return DRAWER_LINES.closedButton(typeWords(t) ?? t); }
  protected readonly views = computed(() => this.list().map((x) => viewOf(x, Date.now())));
  protected readonly current = computed(() => this.views().find((v) => v.id === this.chosen()) ?? null);
}
