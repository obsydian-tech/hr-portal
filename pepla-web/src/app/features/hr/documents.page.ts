import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  PpButton, PpCell, PpEmptyState, PpLink, PpLozenge, PpPageHeader, PpPagination, PpSectionMessage, PpSectionMessageActions,
  PpSkeleton, PpSkeletonGroup, PpStat, PpStatRow, PpTableDirective, PpTableWrap, type Crumb, type Status,
} from '../../ds';
import type { WaitingList } from '../../core/documents/documents-to-check';
import { DocumentsService } from '../../core/documents/documents.service';
import type { Check } from '../../core/employees/employee-detail';

const PAGE_SIZE = 20;

const LOZENGE: Record<Check, Status> = {
  READING: 'neutral',
  MATCHES: 'success',
  NEEDS_A_LOOK: 'warning',
  DOESNT_MATCH: 'danger',
};

/**
 * Documents to check: every document waiting for an HR decision, oldest first, as the list answers it.
 * The table shows 20 a page; the stats and the sidebar count cover all of them.
 */
@Component({
  selector: 'app-documents-to-check',
  imports: [
    RouterLink, PpButton, PpCell, PpEmptyState, PpLink, PpLozenge, PpPageHeader, PpPagination, PpSectionMessage,
    PpSectionMessageActions, PpSkeleton, PpSkeletonGroup, PpStat, PpStatRow, PpTableDirective, PpTableWrap,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-300">
      <pp-page-header heading="Documents to check" description="Every document waiting for an HR decision, oldest first." [breadcrumbs]="crumbs" />

      @switch (status()) {
        @case ('failed') {
          <pp-section-message tone="danger" heading="Documents could not be loaded.">
            Check your connection and try again.
            <pp-section-message-actions>
              <button ppButton type="button" (click)="load()">Try again</button>
            </pp-section-message-actions>
          </pp-section-message>
        }
        @case ('loading') {
          <pp-skeleton-group label="Loading counts" class="pp-grid">
            @for (n of statPlaceholders; track n) { <pp-skeleton shape="card" /> }
          </pp-skeleton-group>
          <pp-skeleton-group label="Loading documents" class="pp-stack pp-gap-150">
            @for (n of rowPlaceholders; track n) { <pp-skeleton shape="text" /> }
          </pp-skeleton-group>
        }
        @default {
          <pp-stat-row>
            <pp-stat label="Waiting" [value]="list().total" />
            <pp-stat label="Needs a look" [value]="list().counts.NEEDS_A_LOOK" />
            <pp-stat label="Matches" [value]="list().counts.MATCHES" />
            <pp-stat label="Doesn't match" [value]="list().counts.DOESNT_MATCH" />
          </pp-stat-row>

          @if (!list().documents.length) {
            <pp-empty-state [compact]="true" heading="No documents are waiting for a decision." />
          } @else {
            <div class="pp-stack pp-gap-200">
              <pp-table-wrap>
                <table ppTable [stack]="true">
                  <caption class="pp-visually-hidden">Documents waiting for an HR decision</caption>
                  <thead>
                    <tr><th scope="col">Employee</th><th scope="col">Document</th><th scope="col">Check</th><th scope="col">Arrived</th></tr>
                  </thead>
                  <tbody>
                    @for (d of pageRows(); track d.id) {
                      <tr>
                        <td ppCell><a ppLink [routerLink]="['/hr/employees', d.employeeId]">{{ d.employeeName }}</a></td>
                        <td ppCell label="Document"><a ppLink [routerLink]="['/hr/documents', d.id]" [attr.aria-label]="d.typeName + ', ' + d.employeeName">{{ d.typeName }}</a></td>
                        <td ppCell label="Check"><pp-lozenge [status]="lozenge(d.check)">{{ d.checkWord }}</pp-lozenge></td>
                        <td ppCell label="Arrived">{{ d.arrived }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </pp-table-wrap>
              @if (list().documents.length > pageSize) {
                <pp-pagination noun="documents" [total]="list().documents.length" [pageSize]="pageSize" [(page)]="page" />
              }
            </div>
          }
        }
      }
    </div>
  `,
})
export class DocumentsToCheckPage {
  private readonly documents = inject(DocumentsService);

  protected readonly crumbs: Crumb[] = [{ label: 'Home', link: '/hr' }];
  protected readonly pageSize = PAGE_SIZE;
  protected readonly statPlaceholders = [1, 2, 3, 4];
  protected readonly rowPlaceholders = [1, 2, 3, 4, 5];

  protected readonly status = signal<'loading' | 'ready' | 'failed'>('loading');
  protected readonly list = signal<WaitingList>({ documents: [], total: 0, counts: { READING: 0, MATCHES: 0, NEEDS_A_LOOK: 0, DOESNT_MATCH: 0 } });
  protected readonly page = signal(1);
  protected readonly pageRows = computed(() => {
    const from = (this.page() - 1) * PAGE_SIZE;
    return this.list().documents.slice(from, from + PAGE_SIZE);
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.status.set('loading');
    try {
      this.list.set(await this.documents.loadWaiting());
      this.page.set(1);
      this.status.set('ready');
    } catch {
      this.status.set('failed');
    }
  }

  protected lozenge(check: Check): Status {
    return LOZENGE[check] ?? 'neutral';
  }
}
