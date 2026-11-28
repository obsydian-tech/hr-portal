import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { Router } from '@angular/router';
import { PpButton, PpButtonGroup, PpField, PpPageHeader, PpPageHeaderActions, PpSearch, PpSectionMessage, PpSectionMessageActions, PpSelect, PpTabs, PpTooltip, type Tab } from '../../ds';
import { CandidateList } from './candidate-list';
import { AddCandidateDrawer } from './add-candidate.drawer';
import { ListState } from './candidate-list-state';

/** The Pipeline list (REC-UI-02 rule 2): all roles or one, the List | Board switch, "Not hired {n}". */
@Component({
  selector: 'app-pipeline-list',
  imports: [AddCandidateDrawer, CandidateList, PpButton, PpButtonGroup, PpField, PpPageHeader, PpPageHeaderActions, PpSearch, PpSectionMessage, PpSectionMessageActions, PpSelect, PpTabs, PpTooltip],
  providers: [ListState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-200">
      <pp-page-header heading="Pipeline" [description]="s.counts().all + ' candidates'">
        <pp-page-header-actions>
          @if (s.role) {
            <pp-button-group aria-label="View"><button ppButton type="button" icon="list" [pressed]="true">List</button><button ppButton type="button" icon="columns-3" [pressed]="false" (click)="board()">Board</button></pp-button-group>
          } @else if (phone()) {
            <div class="pp-stack pp-gap-050">
              <pp-button-group aria-label="View"><button ppButton type="button" icon="list" [pressed]="true">List</button><button ppButton type="button" icon="columns-3" [pressed]="false" aria-disabled="true" [attr.aria-describedby]="hintId" (click)="board()">Board</button></pp-button-group>
              <span class="pp-text pp-text--small pp-text--subtle" [id]="hintId">{{ hint }}</span>
            </div>
          } @else {
            <pp-button-group aria-label="View"><button ppButton type="button" icon="list" [pressed]="true">List</button><pp-tooltip [text]="hint"><button ppButton type="button" icon="columns-3" [pressed]="false" aria-disabled="true" (click)="board()">Board</button></pp-tooltip></pp-button-group>
          }
          <button ppButton appearance="primary" icon="user-plus" type="button" (click)="adder.openIt()">Add candidate</button>
        </pp-page-header-actions>
      </pp-page-header>
      <app-add-candidate #adder [startRole]="s.role" (added)="s.load()" />
      <pp-tabs label="Views" [tabs]="tabs()" [selected]="s.tab" (selectedChange)="pickTab($event)" [panel]="false" />
      <div class="pp-inline pp-inline--bottom pp-gap-100">
        <pp-search label="Search by name, email or role" placeholder="Search by name, email or role" size="small" [value]="s.search" (valueChange)="pickSearch($event)" />
        <pp-field label="Role"><pp-select size="small" [fit]="true" [options]="roleOptions()" [value]="s.role || 'all'" (valueChange)="pickRole($event)" /></pp-field>
        <button ppButton type="button" size="small" icon="sliders-horizontal">More filters</button>
        <button ppButton type="button" (click)="toggleNotHired()">Not hired {{ s.counts().not_hired }}</button>
      </div>
      @if (s.status() === 'failed') {
        <pp-section-message tone="danger" heading="Candidates could not be loaded."><pp-section-message-actions><button ppButton type="button" (click)="s.load()">Try again</button></pp-section-message-actions></pp-section-message>
      } @else if (s.status() === 'ready') {
        <app-candidate-list [rows]="s.rows()" [levels]="s.levels()" (more)="s.more()" />
      }
    </div>`,
})
export class PipelineListPage implements OnInit {
  readonly role = input('');
  protected readonly s = inject(ListState);
  protected readonly hint = 'Choose one role to see its board.';
  protected readonly hintId = 'pipeline-board-hint';
  protected readonly phone = toSignal(inject(BreakpointObserver).observe('(max-width: 767px)').pipe(map((r) => r.matches)), { initialValue: false });
  private readonly router = inject(Router);
  protected readonly roleOptions = computed(() => [{ value: 'all', label: 'All roles' }, ...this.s.roles().map((r) => ({ value: r.role_id, label: r.job_title }))]);
  protected readonly tabs = computed<Tab[]>(() => { const c = this.s.counts(); return [{ id: 'all', label: 'All', count: c.all }, { id: 'mine', label: 'My candidates', count: c.mine }, { id: 'overdue', label: 'Overdue', count: c.overdue }, { id: 'due_soon', label: 'Due soon', count: c.due_soon }]; });
  async ngOnInit() { this.s.role = this.role() === 'all' ? '' : this.role(); await this.s.init(); await this.s.load(); }
  protected pickTab(id: string) { this.s.tab = id; void this.s.load(); }
  protected pickSearch(v: string | null) { this.s.search = v ?? ''; void this.s.load(); }
  protected pickRole(v: string | null) {
    this.s.role = !v || v === 'all' ? '' : v;
    void this.router.navigate([], { queryParams: { role: this.s.role || 'all', view: 'list' }, replaceUrl: true });
    void this.s.load();
  }
  protected toggleNotHired() { this.s.stage = this.s.stage ? '' : 'NOT_HIRED'; void this.s.load(); }
  protected board() { if (this.s.role) void this.router.navigate([], { queryParams: { role: this.s.role, view: 'board' } }); }
}
