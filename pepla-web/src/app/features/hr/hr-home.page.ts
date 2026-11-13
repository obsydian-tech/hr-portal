import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  PpButton, PpCard, PpCell, PpEmptyState, PpEmptyStateActions, PpLink, PpPageHeader, PpPagination, PpSearch,
  PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup, PpStat, PpStatRow, PpTableDirective, PpTableWrap, formatDate,
} from '../../ds';
import { AuthService } from '../../core/auth/auth.service';
import {
  STEPS, countBySteps, matchesSearch, orderNewEmployees, todayInSouthAfrica, type NewEmployee,
} from '../../core/employees/employee';
import { EmployeesService } from '../../core/employees/employees.service';

const PAGE_SIZE = 20;

/**
 * HR home: who is starting. A count per step, then every new employee, soonest start first, with search.
 * Every page of the employees API is read, so the counts cover everyone. The table shows 20 a page.
 */
@Component({
  selector: 'app-hr-home',
  imports: [
    RouterLink, PpButton, PpCard, PpCell, PpEmptyState, PpEmptyStateActions, PpLink, PpPageHeader, PpPagination, PpSearch,
    PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup, PpStat, PpStatRow, PpTableDirective, PpTableWrap,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-300">
      <pp-page-header [heading]="'Welcome back, ' + firstName()" description="Your team's onboarding progress." />

      @if (status() === 'failed') {
        <pp-section-message tone="danger" heading="New employees could not be loaded.">
          Check your connection and try again.
          <pp-section-message-actions>
            <button ppButton type="button" (click)="load()">Try again</button>
          </pp-section-message-actions>
        </pp-section-message>
      } @else {
        @if (status() === 'loading') {
          <pp-skeleton-group label="Loading counts" class="pp-grid">
            @for (step of steps; track step) { <pp-skeleton shape="card" /> }
          </pp-skeleton-group>
        } @else {
          <pp-stat-row>
            @for (step of steps; track step) { <pp-stat [label]="step" [value]="counts()[step]" /> }
          </pp-stat-row>
        }

        <pp-card heading="New employees" [level]="2">
          @if (status() === 'loading') {
            <pp-skeleton-group label="Loading new employees" class="pp-stack pp-gap-150">
              @for (row of placeholderRows; track row) { <pp-skeleton shape="text" /> }
            </pp-skeleton-group>
          } @else if (!people().length) {
            <pp-empty-state [compact]="true" heading="No new employees yet." />
          } @else {
            <div class="pp-stack pp-gap-200">
              <pp-search label="Search by name or email" [value]="query()" (valueChange)="search($event)" />
              @if (!matches().length) {
                <pp-empty-state [compact]="true" heading="No new employees match" body="Check the spelling, or try part of a name or email.">
                  <pp-empty-state-actions>
                    <button ppButton type="button" (click)="search('')">Clear search</button>
                  </pp-empty-state-actions>
                </pp-empty-state>
              } @else {
                <pp-table-wrap>
                  <table ppTable [stack]="true">
                    <caption class="pp-visually-hidden">New employees</caption>
                    <thead>
                      <tr><th scope="col">Employee</th><th scope="col">Step</th><th scope="col">Start date</th><th scope="col">HR partner</th></tr>
                    </thead>
                    <tbody>
                      @for (p of pageRows(); track p.id) {
                        <tr>
                          <td ppCell>
                            <a ppLink [routerLink]="['/hr/employees', p.id]">{{ p.name }}</a>
                            @if (p.department) { <div class="pp-text pp-text--small pp-text--subtle">{{ p.department }}</div> }
                          </td>
                          <td ppCell label="Step">{{ p.step ?? 'Not set' }}</td>
                          <td ppCell label="Start date">{{ startDate(p) }}</td>
                          <td ppCell label="HR partner">{{ p.hrPartner || 'Not assigned' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </pp-table-wrap>
                <pp-pagination noun="new employees" [total]="matches().length" [pageSize]="pageSize" [(page)]="page" />
              }
            </div>
          }
        </pp-card>
      }
    </div>
  `,
})
export class HrHomePage {
  private readonly auth = inject(AuthService);
  private readonly employees = inject(EmployeesService);

  protected readonly steps = STEPS;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly placeholderRows = [1, 2, 3, 4, 5];
  protected readonly firstName = () => this.auth.user()?.givenName ?? '';

  protected readonly status = signal<'loading' | 'ready' | 'failed'>('loading');
  protected readonly people = signal<NewEmployee[]>([]);
  protected readonly query = signal('');
  protected readonly page = signal(1);

  /** Counts cover everyone loaded, whatever the search says. */
  protected readonly counts = computed(() => countBySteps(this.people()));
  private readonly ordered = computed(() => orderNewEmployees(this.people(), todayInSouthAfrica()));
  protected readonly matches = computed(() => this.ordered().filter((p) => matchesSearch(p, this.query())));
  protected readonly pageRows = computed(() => {
    const from = (this.page() - 1) * PAGE_SIZE;
    return this.matches().slice(from, from + PAGE_SIZE);
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.status.set('loading');
    try {
      this.people.set(await this.employees.loadAll());
      this.status.set('ready');
    } catch {
      this.status.set('failed');
    }
  }

  protected search(value: string | null): void {
    this.query.set(value ?? '');
    this.page.set(1);
  }

  protected startDate(p: NewEmployee): string {
    return p.startDate ? formatDate(`${p.startDate}T12:00:00`, { year: true }) : 'Not set';
  }
}
