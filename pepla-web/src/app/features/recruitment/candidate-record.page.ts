import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import {
  PpBreadcrumbs, PpButton, PpCard, PpDl, PpLozenge, PpMoveDialog, PpPersonHeader, PpPersonHeaderActions, PpProgressTracker, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup, PpTabs,
  type Crumb, type IconName, type PersonFact, type Status, type Step, type Tab,
} from '../../ds';
import type { components } from '../../core/api/openapi';
import { stageTime } from './candidate-list';
import { HireApi, newKey, optionsOf, type RoleOptions } from './hire-api';
import { shortDate } from './hire-format';
import { INTERVIEWS_TAB_READY, NOTES_TAB_READY, OFFER_TAB_READY } from './hire-flags';
import { NotHiredDialog, SAVE_FAIL } from './not-hired-dialog';

type CandidateRecord = components['schemas']['CandidateRecord'];
type Stage = CandidateRecord['stage'];

const TITLE = 'Naleko People';
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
  imports: [NotHiredDialog, PpBreadcrumbs, PpButton, PpCard, PpDl, PpLozenge, PpMoveDialog, PpPersonHeader, PpPersonHeaderActions, PpProgressTracker, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup, PpTabs],
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
            <pp-tabs [label]="c.name" [tabs]="tabs()" [(selected)]="tab" [panel]="false" />
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
    </div>
    <pp-move-dialog [stages]="stageList()" [request]="moving()" (confirmed)="move($event)" (dismissed)="moving.set(null)" />
    <app-not-hired-dialog [who]="notHiredFor()" [failed]="notHiredFailed()" (record)="recordNotHired($event)" (dismissed)="notHiredOpen.set(false)" />`,
})
export class CandidateRecordPage {
  /** The candidate's id from the address. */
  readonly id = input.required<string>();

  private readonly api = inject(HireApi);
  private readonly title = inject(Title);
  protected readonly saveFail = SAVE_FAIL;
  protected readonly status = signal<'loading' | 'ready' | 'notfound' | 'failed'>('loading');
  protected readonly v = signal<View | null>(null);
  private readonly options = signal<RoleOptions | null>(null);
  protected readonly tab = signal('overview');
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
      untracked(() => void this.open(id));
    });
  }

  protected tryAgain() { void this.open(this.id()); }

  /** Opens an address: nothing of the last candidate stays, the title goes back to "Candidate", and the record and the options are read. */
  private async open(id: string) {
    const run = ++this.run;
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
    await this.reread();
  }
}
