import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PpAvatarGroup, PpButton, PpCard, PpDeadline, PpEmptyState, PpLozenge, PpPerson, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup, type IconName, type Status } from '../../../ds';
import type { components } from '../../../core/api/openapi';
import { shortDate } from '../hire-format';
import { INTERVIEW_WORDS as W, typeWords } from './interview-words';

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
  imports: [PpAvatarGroup, PpButton, PpCard, PpDeadline, PpEmptyState, PpLozenge, PpPerson, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup],
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
          <pp-card><pp-empty-state heading="No interviews yet." [compact]="true" /></pp-card>
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
  protected readonly views = computed(() => this.list().map((x) => viewOf(x, Date.now())));
  protected readonly current = computed(() => this.views().find((v) => v.id === this.chosen()) ?? null);
}
