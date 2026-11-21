import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpButton, PpCell, PpEmptyState, PpLink, PpLozenge, PpPageHeader, PpPageHeaderActions, PpSectionMessage, PpSectionMessageActions, PpTableDirective, PpTableWrap } from '../../ds';
import { HireApi, type HireRole } from './hire-api';
import { shortDate } from './hire-format';

/** Roles: every open role at the company (REC-UI-01). */
@Component({
  selector: 'app-roles-page',
  imports: [RouterLink, PpButton, PpCell, PpEmptyState, PpLink, PpLozenge, PpPageHeader, PpPageHeaderActions, PpSectionMessage, PpSectionMessageActions, PpTableDirective, PpTableWrap],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-250">
      <pp-page-header heading="Roles" description="Every open role at your company.">
        <pp-page-header-actions><a ppButton appearance="primary" icon="user-plus" routerLink="/hire/roles/new">Open a role</a></pp-page-header-actions>
      </pp-page-header>
      @if (status() === 'failed') {
        <pp-section-message tone="danger" heading="Roles could not be loaded.">
          <pp-section-message-actions><button ppButton type="button" (click)="load()">Try again</button></pp-section-message-actions>
        </pp-section-message>
      } @else if (status() === 'ready') {
        @if (!roles().length) {
          <pp-empty-state heading="No open roles yet" body="Open a role to start its hiring board." />
        } @else {
          <pp-table-wrap>
            <table ppTable [stack]="true">
              <caption class="pp-visually-hidden">Open roles</caption>
              <thead><tr><th scope="col">Role</th><th scope="col">Hiring manager</th><th scope="col">Candidates</th><th scope="col">Opened</th><th scope="col"><span class="pp-visually-hidden">Actions</span></th></tr></thead>
              <tbody>
                @for (r of roles(); track r.role_id) {
                  <tr>
                    <td ppCell label="Role"><a ppLink routerLink="/hire/pipeline" [queryParams]="{ role: r.role_id, view: 'board' }">{{ r.job_title }}</a></td>
                    <td ppCell label="Hiring manager">{{ r.hiring_manager_name }}</td>
                    <td ppCell label="Candidates">
                      <span>{{ r.candidate_count }}</span>
                      @if (r.overdue_count) { <pp-lozenge status="danger">{{ r.overdue_count }} overdue</pp-lozenge> }
                      @else if (r.due_soon_count) { <pp-lozenge status="warning">{{ r.due_soon_count }} due soon</pp-lozenge> }
                    </td>
                    <td ppCell label="Opened">{{ when(r.opened_at) }}</td>
                    <td ppCell="actions"><a ppButton appearance="subtle" size="small" [iconOnly]="true" icon="chevron-right" routerLink="/hire/pipeline" [queryParams]="{ role: r.role_id, view: 'board' }" [attr.aria-label]="'Open ' + r.job_title"></a></td>
                  </tr>
                }
              </tbody>
            </table>
          </pp-table-wrap>
        }
      }
    </div>`,
})
export class RolesPage implements OnInit {
  private readonly api = inject(HireApi);
  protected readonly status = signal<'loading' | 'ready' | 'failed'>('loading');
  protected readonly roles = signal<HireRole[]>([]);
  protected readonly when = shortDate;

  ngOnInit() { void this.load(); }

  protected async load() {
    this.status.set('loading');
    const r = await this.api.call<{ roles?: HireRole[] }>('GET', '/v1/roles?status=OPEN');
    if (!r || r.status !== 200) return this.status.set('failed');
    this.roles.set(r.body?.roles ?? []);
    this.status.set('ready');
  }
}
