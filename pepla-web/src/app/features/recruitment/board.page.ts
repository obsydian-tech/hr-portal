import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  PpButton, PpButtonGroup, PpCell, PpDropdownMenu, PpEmptyState, PpField, PpLink, PpMenuItem, PpMenuSection, PpModalDialog, PpModalFooter, PpPageHeader, PpPageHeaderActions,
  PpPipelineBoard, PpRadioGroup, PpSearch, PpSectionMessage, PpSectionMessageActions, PpTableDirective, PpTableWrap, PpTabs,
  type PipelineCard, type PipelineCardAction, type PipelineMoveRequest, type PipelineStage, type Tab,
} from '../../ds';
import { HireApi, newKey, type HireCandidate, type HireConfig, type HireCounts, type HireRole } from './hire-api';
import { ADD_CANDIDATE_READY } from './hire-flags';

const SAVE_FAIL = 'Your change could not be saved. Try again.';
const STAGE_NAMES: Record<string, string> = { APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview', OFFER: 'Offer', HIRED: 'Hired' };
/** The eight approved reasons, in the approved order (rule 7). */
const REASONS: ReadonlyArray<readonly [string, string]> = [
  ['NOT_RIGHT_SKILLS', 'Not the right skills'], ['NOT_RIGHT_EXPERIENCE', 'Not the right experience'], ['CHOSE_ANOTHER', 'Chose another candidate'], ['WITHDREW', 'Candidate withdrew'],
  ['SALARY_MISMATCH', 'Salary did not match'], ['DID_NOT_ATTEND', 'Did not attend'], ['ROLE_CLOSED', 'Role closed'], ['OTHER', 'Other'],
];
const DAY = 86_400_000;

/** The hiring board of one role (REC-UI-01): five stages, Move with a reason, Not hired, Close role. The List view is REC-UI-02's. */
@Component({
  selector: 'app-board-page',
  imports: [RouterLink, PpButton, PpButtonGroup, PpCell, PpDropdownMenu, PpEmptyState, PpField, PpLink, PpMenuItem, PpMenuSection, PpModalDialog, PpModalFooter, PpPageHeader, PpPageHeaderActions, PpPipelineBoard, PpRadioGroup, PpSearch, PpSectionMessage, PpSectionMessageActions, PpTableDirective, PpTableWrap, PpTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-250">
      @if (status() === 'notfound') {
        <pp-section-message tone="danger" heading="This role could not be found." />
      } @else if (status() === 'failed') {
        <pp-section-message tone="danger" heading="Candidates could not be loaded.">
          <pp-section-message-actions><button ppButton type="button" (click)="load()">Try again</button></pp-section-message-actions>
        </pp-section-message>
      } @else if (role(); as r) {
        <pp-page-header [heading]="r.job_title" [description]="counts().all + ' candidates · Hiring manager ' + r.hiring_manager_name" [breadcrumbs]="[{ label: 'Roles', link: '/hire/roles' }, { label: r.job_title, link: '/hire/pipeline' }]">
          <pp-page-header-actions>
            <pp-button-group aria-label="View"><button ppButton type="button" [pressed]="false" [disabled]="true">List</button><button ppButton type="button" [pressed]="true">Board</button></pp-button-group>
            @if (addCandidateReady) { <button ppButton appearance="primary" icon="user-plus" type="button">Add candidate</button> }
            <pp-dropdown-menu [label]="'More actions for ' + r.job_title"><pp-menu-section><button ppMenuItem icon="circle-x" (click)="close()">Close role</button></pp-menu-section></pp-dropdown-menu>
          </pp-page-header-actions>
        </pp-page-header>
        @if (failedSave()) { <pp-section-message tone="danger" [heading]="saveFail" /> }
        @if (openCandidates()) {
          <pp-section-message tone="warning" heading="Close role">Move each open candidate to Hired or Not hired before you close this role.</pp-section-message>
        }
        <pp-tabs label="Candidates" [tabs]="tabs()" [selected]="tab()" (selectedChange)="pickTab($event)" [panel]="false" />
        <div class="pp-inline pp-gap-100">
          <pp-search label="Search candidates by name, email or role" placeholder="Search by name, email or role" [value]="query()" (valueChange)="pickQuery($event)" />
          <button ppButton type="button" icon="sliders-horizontal">More filters</button>
          <button ppButton type="button" (click)="toggleNotHired()">Not hired {{ counts().not_hired }}</button>
        </div>
        @if (showNotHired()) {
          @if (!notHired().length) { <pp-empty-state [compact]="true" heading="No one yet" /> }
          @else {
            <pp-table-wrap><table ppTable [stack]="true"><caption class="pp-visually-hidden">Not hired</caption>
              <thead><tr><th scope="col">Candidate</th></tr></thead>
              <tbody>@for (c of notHired(); track c.id) { <tr><td ppCell label="Candidate">{{ c.name }}</td></tr> }</tbody></table></pp-table-wrap>
          }
          @if (oldRows()) { <a ppLink routerLink="/hire/candidates/old-system">Not hired by the old system</a> }
        }
        <pp-pipeline-board [label]="'Hiring stages for ' + r.job_title" [(stages)]="stages" [confirmMoves]="true" (moveRequested)="move($event)" [cardMenu]="cardMenu" (cardAction)="cardAction($event)" />
      }
    </div>
    <pp-modal-dialog [open]="!!nhFor()" [closable]="true" [heading]="first() + ' not hired'" (closed)="closeNh()">
      <div class="pp-stack pp-gap-150">
        <pp-field label="Why? (required)" group="radio" help="Not hired always carries a reason.">
          <pp-radio-group [options]="reasons" [value]="reason()" (valueChange)="reason.set($event)" />
        </pp-field>
        @if (nhFor()?.pending?.awaiting?.name; as who) { <p class="pp-text--small">{{ who }} must confirm before this is final.</p> }
        @if (nhFailed()) { <pp-section-message tone="danger" [heading]="saveFail" /> }
      </div>
      <pp-modal-footer>
        <button ppButton type="button" (click)="closeNh()">Cancel</button>
        <button ppButton appearance="primary" type="button" [disabled]="!canRecord()" (click)="record()">Record not hired</button>
      </pp-modal-footer>
    </pp-modal-dialog>`,
})
export class BoardPage implements OnInit {
  private readonly api = inject(HireApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly saveFail = SAVE_FAIL;
  protected readonly addCandidateReady = ADD_CANDIDATE_READY;
  protected readonly status = signal<'loading' | 'ready' | 'failed' | 'notfound'>('loading');
  protected readonly role = signal<HireRole | null>(null);
  protected readonly stages = signal<PipelineStage[]>([]);
  protected readonly counts = signal<HireCounts>({ all: 0, mine: 0, overdue: 0, due_soon: 0, not_hired: 0 });
  protected readonly tab = signal('all');
  protected readonly query = signal('');
  protected readonly failedSave = signal(false);
  protected readonly openCandidates = signal(false);
  protected readonly showNotHired = signal(false);
  protected readonly notHired = signal<HireCandidate[]>([]);
  protected readonly oldRows = signal(false);
  protected readonly nhFor = signal<HireCandidate | null>(null);
  protected readonly nhFailed = signal(false);
  protected readonly reason = signal<string | null>(null);
  protected readonly reasons = REASONS.map(([value, label]) => ({ value, label }));
  protected readonly first = computed(() => (this.nhFor()?.name ?? '').split(' ')[0]);
  protected readonly canRecord = computed(() => !!this.nhFor()?.pending || !!this.reason());
  private screening = true;
  private rows: HireCandidate[] = [];
  private roleId = '';
  protected readonly tabs = computed<Tab[]>(() => {
    const c = this.counts();
    return [{ id: 'all', label: 'All', count: c.all }, { id: 'mine', label: 'My candidates', count: c.mine }, { id: 'overdue', label: 'Overdue', count: c.overdue }, { id: 'due_soon', label: 'Due soon', count: c.due_soon }];
  });
  /** Each card's More actions: Not hired, and Cancel while a second confirmation is waiting. */
  protected readonly cardMenu = (c: PipelineCard) => {
    const row = this.rows.find((x) => x.id === c.id);
    return row?.pending ? [{ id: 'not-hired', label: 'Not hired' }, { id: 'cancel', label: 'Cancel' }] : [{ id: 'not-hired', label: 'Not hired' }];
  };

  async ngOnInit() {
    this.roleId = this.route.snapshot.queryParamMap.get('role') ?? '';
    await this.load();
  }

  protected async load() {
    this.status.set('loading');
    const [role, cfg] = await Promise.all([
      this.api.call<HireRole>('GET', `/v1/roles/${encodeURIComponent(this.roleId)}`),
      this.api.call<HireConfig>('GET', '/v1/config'),
    ]);
    if (role?.status === 404) return this.status.set('notfound');
    if (!role || role.status !== 200) return this.status.set('failed');
    this.role.set(role.body);
    this.screening = cfg?.body?.screening !== false;
    await this.reload();
  }

  private async reload() {
    const q = new URLSearchParams({ role_id: this.roleId, limit: '100' });
    const t = this.tab();
    if (t === 'overdue') q.set('sla_status', 'OVERDUE'); else if (t === 'due_soon') q.set('sla_status', 'DUE_SOON'); else if (t === 'mine') q.set('mine', 'true');
    if (this.query()) q.set('search', this.query());
    const r = await this.api.call<{ candidates: HireCandidate[]; counts: HireCounts }>('GET', `/v1/candidates?${q}`);
    if (!r || r.status !== 200) return this.status.set('failed');
    this.rows = r.body.candidates;
    this.counts.set(r.body.counts);
    this.stages.set(this.build(this.rows));
    this.status.set('ready');
  }

  private build(rows: HireCandidate[]): PipelineStage[] {
    return Object.keys(STAGE_NAMES).filter((k) => this.screening || k !== 'SCREENING').map((k) => {
      const late = rows.filter((c) => c.stage === k && c.sla_status === 'OVERDUE').length;
      return {
        id: k,
        name: STAGE_NAMES[k]!,
        ...(late ? { alert: { text: `${late} overdue`, tone: 'danger' as const } } : {}),
        cards: rows.filter((c) => c.stage === k).map((c) => this.card(c, k)),
      };
    });
  }

  private card(c: HireCandidate, stage: string): PipelineCard {
    const days = Math.max(1, Math.round((Date.now() - Date.parse(c.stage_entered_at ?? '')) / DAY) + 1);
    const meta = stage === 'APPLIED' ? (c.source ?? 'Applied')
      : stage === 'SCREENING' ? `Day ${days}`
      : stage === 'INTERVIEW' ? `${c.interviews_done ?? 0} of ${c.interviews_required ?? 0} interviews`
      : stage === 'OFFER' ? (c.offer_state === 'SENT' ? 'Offer sent' : 'Offer')
      : STAGE_NAMES[stage]!;
    const card: PipelineCard = { id: c.id, name: c.name, meta };
    if (c.pending?.awaiting?.name) card.lozenge = { status: 'warning', icon: 'clock', text: `${c.pending.awaiting.name} must confirm before this is final.` };
    else if (c.sla_status && c.sla_status !== 'ON_TRACK' && c.due_at) card.deadline = { due: c.due_at };
    return card;
  }

  protected pickTab(id: string) { this.tab.set(id); void this.reload(); }
  protected pickQuery(v: string) { this.query.set(v ?? ''); void this.reload(); }

  /** The card moves only after the server agrees (D-MOVE-1). A refusal leaves it where it was. */
  protected async move(e: PipelineMoveRequest) {
    this.failedSave.set(false);
    const r = await this.api.call('PUT', `/v1/candidates/${e.card.id}/stage`, { to: e.to, reason: e.reason }, newKey());
    if (r?.status !== 200) { this.failedSave.set(true); return; }
    // Keep the page's own list in step, so a later redraw from it (Not hired pending, Cancel) never puts the card back.
    const row = this.rows.find((x) => x.id === e.card.id);
    if (row) row.stage = e.to;
    this.stages.update((all) => all.map((s) => {
      let cards = s.cards.filter((c) => c.id !== e.card.id);
      if (s.id === e.to) cards = [...cards.slice(0, e.index), e.card, ...cards.slice(e.index)];
      return { ...s, cards };
    }));
  }

  protected cardAction(e: PipelineCardAction) {
    const row = this.rows.find((x) => x.id === e.card.id);
    if (!row) return;
    if (e.action === 'cancel') { void this.cancelPending(row); return; }
    this.reason.set(null);
    this.nhFailed.set(false);
    this.nhFor.set(row);
  }

  protected closeNh() {
    const row = this.nhFor();
    this.nhFor.set(null);
    const id = row?.id;
    if (id) setTimeout(() => document.querySelector<HTMLElement>(`[data-more="${CSS.escape(id)}"]`)?.focus());
  }

  protected async record() {
    const row = this.nhFor();
    if (!row) return;
    this.nhFailed.set(false);
    const r = row.pending
      ? await this.api.call<{ pending?: HireCandidate['pending'] }>('POST', `/v1/candidates/${row.id}/not-hired/confirm`, {})
      : await this.api.call<{ pending?: HireCandidate['pending'] }>('POST', `/v1/candidates/${row.id}/not-hired`, { reason: this.reason() });
    if (r?.status !== 200) { this.nhFailed.set(true); return; }
    if (r.body?.pending) {
      row.pending = r.body.pending;
      this.stages.set(this.build(this.rows));
      this.nhFor.set({ ...row });
      return;
    }
    this.nhFor.set(null);
    await this.reload();
  }

  private async cancelPending(row: HireCandidate) {
    const r = await this.api.call('POST', `/v1/candidates/${row.id}/not-hired/cancel`, {});
    if (r?.status !== 200) { this.failedSave.set(true); return; }
    delete row.pending;
    this.stages.set(this.build(this.rows));
  }

  protected async toggleNotHired() {
    if (this.showNotHired()) { this.showNotHired.set(false); return; }
    const [list, old] = await Promise.all([
      this.api.call<{ candidates?: HireCandidate[] }>('GET', `/v1/candidates?role_id=${encodeURIComponent(this.roleId)}&stage=NOT_HIRED&limit=100`),
      this.api.call<{ candidates?: unknown[] }>('GET', '/v1/candidates/old-system'),
    ]);
    this.notHired.set(list?.body?.candidates ?? []);
    this.oldRows.set(!!old?.body?.candidates?.length);
    this.showNotHired.set(true);
  }

  protected async close() {
    this.failedSave.set(false);
    this.openCandidates.set(false);
    const r = await this.api.call<{ code?: string }>('POST', `/v1/roles/${encodeURIComponent(this.roleId)}/close`, {});
    if (r?.status === 409 && r.body?.code === 'OPEN_CANDIDATES') { this.openCandidates.set(true); return; }
    if (r?.status !== 200) { this.failedSave.set(true); return; }
    await this.router.navigateByUrl('/hire/roles');
  }
}
