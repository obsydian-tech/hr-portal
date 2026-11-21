import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpButton, PpCell, PpPageHeader, PpPerson, PpTableDirective, PpTableWrap } from '../../ds';
import { HireApi, type OldSystemRow } from './hire-api';
import { shortDate } from './hire-format';

/** Candidates the old system turned down by a score (REC-UI-01, rule 8). */
@Component({
  selector: 'app-old-system-page',
  imports: [PpButton, PpCell, PpPageHeader, PpPerson, PpTableDirective, PpTableWrap, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-250">
      <pp-page-header heading="Not hired by the old system" description="These candidates were turned down by a score before 17 Nov. Open any of them to look again." [breadcrumbs]="[{ label: 'Candidates', link: '/hire/pipeline' }, { label: 'Not hired by the old system', link: '/hire/candidates/old-system' }]" />
      <pp-table-wrap><table ppTable [stack]="true"><caption class="pp-visually-hidden">Not hired by the old system</caption>
        <thead><tr><th scope="col">Candidate</th><th scope="col">Role</th><th scope="col">Applied</th><th scope="col"><span class="pp-visually-hidden">Open</span></th></tr></thead>
        <tbody>@for (c of rows(); track c.candidate_id) {
          <tr>
            <td ppCell label="Candidate"><pp-person [name]="c.name" [state]="notHired" size="small" [link]="'/hire/candidates/' + c.candidate_id" /></td>
            <td ppCell label="Role">{{ c.role_title }}</td>
            <td ppCell label="Applied">{{ when(c.rejected_at) }}</td>
            <td ppCell="actions"><a ppButton appearance="subtle" size="small" [iconOnly]="true" icon="chevron-right" [routerLink]="['/hire/candidates', c.candidate_id]" [attr.aria-label]="'Open ' + c.name"></a></td>
          </tr>
        }</tbody></table></pp-table-wrap>
    </div>`,
})
export class OldSystemPage implements OnInit {
  private readonly api = inject(HireApi);
  protected readonly rows = signal<OldSystemRow[]>([]);
  protected readonly when = shortDate;
  protected readonly notHired = { status: 'neutral', icon: 'circle-x', text: 'Not hired' } as const;
  async ngOnInit() { this.rows.set((await this.api.call<{ candidates?: OldSystemRow[] }>('GET', '/v1/candidates/old-system'))?.body?.candidates ?? []); }
}
