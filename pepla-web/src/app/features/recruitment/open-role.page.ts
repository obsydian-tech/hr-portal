import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PpButton, PpField, PpForm, PpPageHeader, PpSectionMessage, PpSelect, PpTextField } from '../../ds';
import { HireApi, newKey, type HireConfig, type HireRole } from './hire-api';

type Choice = { value: string; label: string };

/** Open a role (REC-UI-01). Levels, criteria and departments come from the company's settings; managers from the picker. */
@Component({
  selector: 'app-open-role-page',
  imports: [PpButton, PpField, PpForm, PpPageHeader, PpSectionMessage, PpSelect, PpTextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-250">
      <pp-page-header heading="Open a role" [breadcrumbs]="[{ label: 'Roles', link: '/hire/roles' }, { label: 'Open a role', link: '/hire/roles/new' }]" />
      @if (failed()) { <pp-section-message tone="danger" heading="Your change could not be saved. Try again." /> }
      <form ppForm class="pp-measure-form" (submit)="$event.preventDefault(); submit()">
        <pp-field label="Job title"><input ppTextField [value]="title()" (input)="title.set($any($event.target).value)" /></pp-field>
        <pp-field label="Department"><pp-select [options]="departments()" [value]="dept()" (valueChange)="dept.set($event)" /></pp-field>
        <pp-field label="Seniority level"><pp-select [options]="levels()" [value]="level()" (valueChange)="level.set($event)" /></pp-field>
        <pp-field label="Hiring manager"><pp-select [options]="managers()" [value]="manager()" (valueChange)="manager.set($event)" /></pp-field>
        <pp-field label="What the panel scores" help="From your company's default. Change it for this role if you need to."><input ppTextField [value]="scores()" (input)="scores.set($any($event.target).value)" /></pp-field>
        <pp-field label="Panel size"><input ppTextField [value]="panel()" (input)="panel.set($any($event.target).value)" /></pp-field>
        <div class="pp-inline pp-gap-100">
          <button ppButton appearance="primary" icon="user-plus" type="submit" [disabled]="busy()">Open a role</button>
          <button ppButton type="button" (click)="router.navigateByUrl('/hire/roles')">Cancel</button>
        </div>
      </form>
    </div>`,
})
export class OpenRolePage implements OnInit {
  private readonly api = inject(HireApi);
  protected readonly router = inject(Router);
  protected readonly title = signal('');
  protected readonly dept = signal<string | null>(null);
  protected readonly level = signal<string | null>(null);
  protected readonly manager = signal<string | null>(null);
  protected readonly scores = signal('');
  protected readonly panel = signal('3');
  protected readonly departments = signal<Choice[]>([]);
  protected readonly levels = signal<Choice[]>([]);
  protected readonly managers = signal<Choice[]>([]);
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);
  private criteria: HireConfig['criteria'] = [];
  /** One key for this form: a retry after a dropped connection reuses it, a new attempt after a refusal gets a new one. */
  private key = newKey();

  async ngOnInit() {
    const [cfg, hm] = await Promise.all([
      this.api.call<HireConfig>('GET', '/v1/config'),
      this.api.call<{ hiring_managers: { id: string; name: string }[] }>('GET', '/v1/hiring-managers'),
    ]);
    if (cfg?.status === 200 && cfg.body) {
      const c = cfg.body;
      this.departments.set(c.departments.map((d) => ({ value: d, label: d })));
      this.levels.set(c.seniority_levels.map((l) => ({ value: l.key, label: l.label })));
      this.criteria = c.criteria;
      this.scores.set(c.criteria.map((x) => x.label).join(', '));
      this.dept.set(c.departments[0] ?? null);
      this.level.set(c.seniority_levels[0]?.key ?? null);
    }
    if (hm?.status === 200 && hm.body) {
      this.managers.set(hm.body.hiring_managers.map((m) => ({ value: m.id, label: m.name })));
      this.manager.set(hm.body.hiring_managers[0]?.id ?? null);
    }
  }

  protected async submit() {
    if (!this.title().trim() || this.busy()) return;
    this.busy.set(true);
    this.failed.set(false);
    const labels = this.scores().split(',').map((s) => s.trim()).filter(Boolean);
    const body = {
      job_title: this.title().trim(),
      department: this.dept(),
      level: this.level(),
      hiring_manager_id: this.manager(),
      criteria: labels.map((l) => this.criteria.find((c) => c.label === l)?.key ?? l),
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
  }
}
