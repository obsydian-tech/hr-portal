import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { PpButton, PpField, PpPageHeader, PpSearch, PpSectionMessage, PpSectionMessageActions, PpSelect, PpTabs, type Tab } from '../../ds';
import { CandidateList } from './candidate-list';
import { ListState } from './candidate-list-state';

/** Candidates (REC-UI-02 rule 2): anyone who applied, in any stage. */
@Component({
  selector: 'app-candidates-page',
  imports: [CandidateList, PpButton, PpField, PpPageHeader, PpSearch, PpSectionMessage, PpSectionMessageActions, PpSelect, PpTabs],
  providers: [ListState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-200">
      <pp-page-header heading="Candidates" description="Find anyone who applied, in any stage." />
      <pp-tabs label="Views" [tabs]="tabs()" [selected]="s.tab" (selectedChange)="pickTab($event)" [panel]="false" />
      <div class="pp-inline pp-gap-150">
        <pp-search label="Search by name, email or role" placeholder="Search by name, email or role" size="small" [value]="s.search" (valueChange)="pickSearch($event)" />
        <pp-field label="Role"><pp-select size="small" [fit]="true" [options]="roleOptions()" [value]="s.role || 'all'" (valueChange)="pickRole($event)" /></pp-field>
        <pp-field label="Stage"><pp-select size="small" [fit]="true" [options]="stageOptions" [value]="s.stage || 'all'" (valueChange)="pickStage($event)" /></pp-field>
        <button ppButton type="button" size="small" icon="sliders-horizontal">More filters</button>
      </div>
      @if (s.status() === 'failed') {
        <pp-section-message tone="danger" heading="Candidates could not be loaded."><pp-section-message-actions><button ppButton type="button" (click)="s.load()">Try again</button></pp-section-message-actions></pp-section-message>
      } @else if (s.status() === 'ready') {
        <app-candidate-list [rows]="s.rows()" [levels]="s.levels()" (more)="s.more()" />
      }
    </div>`,
})
export class CandidatesPage implements OnInit {
  protected readonly s = inject(ListState);
  protected readonly stageOptions = [{ value: 'all', label: 'All stages' }, ...[['APPLIED', 'Applied'], ['SCREENING', 'Screening'], ['INTERVIEW', 'Interview'], ['OFFER', 'Offer'], ['HIRED', 'Hired'], ['NOT_HIRED', 'Not hired']].map(([value, label]) => ({ value: value!, label: label! }))];
  protected readonly roleOptions = computed(() => [{ value: 'all', label: 'All roles' }, ...this.s.roles().map((r) => ({ value: r.role_id, label: r.job_title }))]);
  protected readonly tabs = computed<Tab[]>(() => { const c = this.s.counts(); return [{ id: 'all', label: 'All', count: c.all }, { id: 'mine', label: 'My candidates', count: c.mine }, { id: 'overdue', label: 'Overdue', count: c.overdue }, { id: 'due_soon', label: 'Due soon', count: c.due_soon }]; });
  async ngOnInit() { await this.s.init(); await this.s.load(); }
  protected pickTab(id: string) { this.s.tab = id; void this.s.load(); }
  protected pickSearch(v: string | null) { this.s.search = v ?? ''; void this.s.load(); }
  protected pickRole(v: string | null) { this.s.role = !v || v === 'all' ? '' : v; void this.s.load(); }
  protected pickStage(v: string | null) { this.s.stage = !v || v === 'all' ? '' : v; void this.s.load(); }
}
