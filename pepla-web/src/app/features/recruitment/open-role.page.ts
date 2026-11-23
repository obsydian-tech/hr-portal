import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PpButton, PpField, PpForm, PpPageHeader, PpSectionMessage, PpSectionMessageActions, PpSelect, PpTextField } from '../../ds';
import { HireApi, newKey, optionsOf, type HireRole, type RoleOptions } from './hire-api';

type Choice = { value: string; label: string };

const LOAD_FAILED = 'Role choices could not be loaded.';
const NO_DEPARTMENTS = 'No departments yet. Ask an Admin to add one.';
const NO_MANAGERS = 'No hiring managers yet. Ask an Admin to give someone the manager role.';

/** Open a role (REC-UI-01, REC-14). Every choice comes from one `GET /v1/roles/options` answer; nothing is chosen for the person except the first level. */
@Component({
  selector: 'app-open-role-page',
  imports: [PpButton, PpField, PpForm, PpPageHeader, PpSectionMessage, PpSectionMessageActions, PpSelect, PpTextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-250">
      <pp-page-header heading="Open a role" [breadcrumbs]="[{ label: 'Roles', link: '/hire/roles' }, { label: 'Open a role', link: '/hire/roles/new' }]" />
      @if (status() === 'failed') {
        <pp-section-message tone="danger" [heading]="loadFailed">
          <pp-section-message-actions><button ppButton type="button" (click)="load()">Try again</button></pp-section-message-actions>
        </pp-section-message>
      } @else if (status() === 'ready') {
        @if (failed()) { <pp-section-message tone="danger" heading="Your change could not be saved. Try again." /> }
        <form ppForm class="pp-measure-form" (submit)="$event.preventDefault(); submit()">
          <pp-field label="Job title"><input ppTextField [value]="title()" (input)="title.set($any($event.target).value)" /></pp-field>
          <pp-field label="Department" [help]="departments().length ? undefined : noDepartments"><pp-select [options]="departments()" placeholder="Choose a department" [value]="dept()" (valueChange)="dept.set($event)" /></pp-field>
          <pp-field label="Seniority level"><pp-select [options]="levels()" [value]="level()" (valueChange)="setLevel($event)" /></pp-field>
          <pp-field label="Hiring manager" [help]="managers().length ? undefined : noManagers"><pp-select [options]="managers()" placeholder="Choose a hiring manager" [value]="manager()" (valueChange)="manager.set($event)" /></pp-field>
          <pp-field label="What the panel scores" help="From your company's default. Change it for this role if you need to."><input ppTextField [value]="scores()" (input)="scores.set($any($event.target).value)" /></pp-field>
          <pp-field label="Panel size"><input ppTextField [value]="panel()" (input)="typePanel($any($event.target).value)" /></pp-field>
          <div class="pp-inline pp-gap-100">
            <button ppButton appearance="primary" icon="user-plus" type="submit" [disabled]="!canOpen()">Open a role</button>
            <button ppButton type="button" (click)="router.navigateByUrl('/hire/roles')">Cancel</button>
          </div>
        </form>
      }
    </div>`,
})
export class OpenRolePage implements OnInit {
  private readonly api = inject(HireApi);
  protected readonly router = inject(Router);
  protected readonly loadFailed = LOAD_FAILED;
  protected readonly noDepartments = NO_DEPARTMENTS;
  protected readonly noManagers = NO_MANAGERS;
  protected readonly status = signal<'loading' | 'ready' | 'failed'>('loading');
  protected readonly title = signal('');
  protected readonly dept = signal<string | null>(null);
  protected readonly level = signal<string | null>(null);
  protected readonly manager = signal<string | null>(null);
  protected readonly scores = signal('');
  protected readonly panel = signal('');
  protected readonly departments = signal<Choice[]>([]);
  protected readonly levels = signal<Choice[]>([]);
  protected readonly managers = signal<Choice[]>([]);
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);
  protected readonly canOpen = computed(() => !this.busy() && !!this.title().trim() && !!this.dept() && !!this.level() && !!this.manager());
  private options: RoleOptions | null = null;
  private panelTyped = false;
  /** One key for this form: a retry after a dropped connection reuses it, a new attempt after a refusal gets a new one. */
  private key = newKey();

  ngOnInit() { void this.load(); }

  /** Reads the options once. A failure shows the load message; the form is never half filled. */
  protected async load() {
    this.status.set('loading');
    const o = await this.api.call('GET', '/v1/roles/options').then(optionsOf);
    if (!o) return this.status.set('failed');
    const first = !this.options;
    this.options = o;
    this.departments.set(o.departments.map((d) => ({ value: d.id, label: d.name })));
    this.managers.set(o.hiring_managers.map((m) => ({ value: m.id, label: m.name })));
    const levels = [...o.levels].sort((a, b) => a.order - b.order);
    this.levels.set(levels.map((l) => ({ value: l.key, label: l.label })));
    // A choice stays only while the answer still offers it.
    if (!o.departments.some((d) => d.id === this.dept())) this.dept.set(null);
    if (!o.hiring_managers.some((m) => m.id === this.manager())) this.manager.set(null);
    if (!levels.some((l) => l.key === this.level())) this.setLevel(levels[0]?.key ?? null);
    if (first) this.scores.set(o.criteria.map((c) => c.label).join(', '));
    this.status.set('ready');
  }

  protected setLevel(key: string | null) {
    this.level.set(key);
    if (!this.panelTyped) this.panel.set(key && this.options?.panel_size_by_level[key] != null ? String(this.options.panel_size_by_level[key]) : '');
  }

  protected typePanel(v: string) {
    this.panelTyped = true;
    this.panel.set(v);
  }

  /** After a refusal the lists may have changed: read them once more without touching what the person typed. */
  private async refresh() {
    const o = await this.api.call('GET', '/v1/roles/options').then(optionsOf);
    if (!o) return;
    this.options = o;
    this.departments.set(o.departments.map((d) => ({ value: d.id, label: d.name })));
    this.managers.set(o.hiring_managers.map((m) => ({ value: m.id, label: m.name })));
    this.levels.set([...o.levels].sort((a, b) => a.order - b.order).map((l) => ({ value: l.key, label: l.label })));
    if (!o.departments.some((d) => d.id === this.dept())) this.dept.set(null);
    if (!o.hiring_managers.some((m) => m.id === this.manager())) this.manager.set(null);
  }

  protected async submit() {
    if (!this.canOpen()) return;
    this.busy.set(true);
    this.failed.set(false);
    const kept = this.options?.criteria ?? [];
    const labels = this.scores().split(',').map((s) => s.trim()).filter(Boolean);
    const body = {
      job_title: this.title().trim(),
      department_id: this.dept()!,
      level: this.level()!,
      hiring_manager_id: this.manager()!,
      criteria: labels.map((l) => kept.find((c) => c.label === l)?.key ?? l),
      panel_size: Number(this.panel()),
    };
    const r = await this.api.call<HireRole>('POST', '/v1/roles', body, this.key);
    this.busy.set(false);
    if (r && (r.status === 201 || r.status === 200)) {
      void this.router.navigate(['/hire/pipeline'], { queryParams: { role: r.body.role_id, view: 'board' } });
      return;
    }
    // A refusal means the server saw this attempt; a dropped connection may not have, so it keeps the key.
    if (r) this.key = newKey();
    this.failed.set(true);
    // A 400 or 409 can mean a department was archived or a manager removed meanwhile: read the lists once more.
    if (r && (r.status === 400 || r.status === 409)) await this.refresh();
  }
}
