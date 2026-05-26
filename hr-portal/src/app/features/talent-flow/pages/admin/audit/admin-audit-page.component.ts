import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { AdminApiService } from '../../../services/admin-api.service';
import {
  AuditEvent,
  AuditFilters,
  AuditEventsResponse,
  AuditStatsResponse,
  AuditModule,
  AuditRole,
  AuditEventType,
  AuditOutcome,
  AUDIT_EVENT_TYPE_LABELS,
  AUDIT_MODULE_LABELS,
  AUDIT_OUTCOME_SEVERITY,
} from '../../../models/admin.models';
import { EventDetailDrawerComponent } from './components/event-detail-drawer/event-detail-drawer.component';

// ── Filter option lists ──────────────────────────────────────────────────────

const MODULE_OPTIONS: { label: string; value: AuditModule | null }[] = [
  { label: 'All Modules',  value: null        },
  { label: 'TalentFlow',   value: 'TalentFlow' },
  { label: 'IT Request',   value: 'ITRequest'  },
  { label: 'Admin',        value: 'Admin'      },
  { label: 'System',       value: 'System'     },
];

const ROLE_OPTIONS: { label: string; value: AuditRole | null }[] = [
  { label: 'All Roles', value: null     },
  { label: 'TA',        value: 'TA'     },
  { label: 'HM',        value: 'HM'     },
  { label: 'IT',        value: 'IT'     },
  { label: 'Admin',     value: 'Admin'  },
  { label: 'System',    value: 'System' },
];

const EVENT_TYPE_OPTIONS: { label: string; value: AuditEventType | null }[] = [
  { label: 'All Event Types', value: null               },
  { label: 'SLA Breach',      value: 'SLA_BREACH'       },
  { label: 'Config Change',   value: 'CONFIG_CHANGE'    },
  { label: 'Candidate Action',value: 'CANDIDATE_ACTION' },
  { label: 'Offer Action',    value: 'OFFER_ACTION'     },
  { label: 'Provisioning',    value: 'PROVISIONING'     },
  { label: 'User Management', value: 'USER_MANAGEMENT'  },
];

const PAGE_SIZE_OPTIONS = [
  { label: '10 per page',  value: 10  },
  { label: '25 per page',  value: 25  },
  { label: '50 per page',  value: 50  },
  { label: '100 per page', value: 100 },
];

/**
 * AdminAuditPageComponent — Admin-S6
 *
 * Route: /platform/talentflow/admin/audit
 */
@Component({
  selector: 'tf-admin-audit-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    TableModule,
    SelectModule,
    InputTextModule,
    TagModule,
    TooltipModule,
    EventDetailDrawerComponent,
  ],
  templateUrl: './admin-audit-page.component.html',
  styleUrl:    './admin-audit-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAuditPageComponent implements OnInit, OnDestroy {
  private readonly api            = inject(AdminApiService);
  private readonly messageService = inject(MessageService);
  private readonly destroy$       = new Subject<void>();
  private readonly searchChange$  = new Subject<string>();

  // ── Filter option lists (for template) ────────────────────────────────────
  readonly moduleOptions    = MODULE_OPTIONS;
  readonly roleOptions      = ROLE_OPTIONS;
  readonly eventTypeOptions = EVENT_TYPE_OPTIONS;
  readonly pageSizeOptions  = PAGE_SIZE_OPTIONS;
  readonly eventTypeLabels  = AUDIT_EVENT_TYPE_LABELS;
  readonly moduleLabels     = AUDIT_MODULE_LABELS;
  readonly outcomeSeverity  = AUDIT_OUTCOME_SEVERITY;

  // ── Loading / export states ────────────────────────────────────────────────
  readonly loadingStats    = signal(true);
  readonly loadingEvents   = signal(true);
  readonly exportingAll    = signal(false);
  readonly exportingFilter = signal(false);

  // ── KPI strip ─────────────────────────────────────────────────────────────
  readonly stats = signal<AuditStatsResponse>({
    totalEventsToday:   0,
    configChangesToday: 0,
    slaBreachesToday:   0,
    userActionsToday:   0,
  });

  // ── Events table ──────────────────────────────────────────────────────────
  readonly events      = signal<AuditEvent[]>([]);
  readonly totalCount  = signal(0);
  readonly totalPages  = signal(0);

  // ── Active filters ────────────────────────────────────────────────────────
  readonly filterModule:    { value: AuditModule | null }  = { value: null };
  readonly filterRole:      { value: AuditRole   | null }  = { value: null };
  readonly filterEventType: { value: AuditEventType | null } = { value: null };
  readonly filterDateFrom   = signal<string>(this.todayIso());
  readonly filterDateTo     = signal<string>(this.todayIso());
  readonly searchTerm       = signal('');
  readonly currentPage      = signal(1);
  pageSizeValue             = 25;

  readonly hasActiveFilters = computed(() =>
    !!this.filterModule.value ||
    !!this.filterRole.value   ||
    !!this.filterEventType.value ||
    !!this.searchTerm(),
  );

  readonly resultSummary = computed(() => {
    const count = this.totalCount();
    const page  = this.currentPage();
    const size  = this.pageSizeValue;
    const start = (page - 1) * size + 1;
    const end   = Math.min(page * size, count);
    return count > 0
      ? `Showing ${start}–${end} of ${count} event${count !== 1 ? 's' : ''}`
      : 'No events found';
  });

  // ── Drawer ────────────────────────────────────────────────────────────────
  readonly drawerVisible  = signal(false);
  readonly selectedEvent  = signal<AuditEvent | null>(null);

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.loadStats();
    this.loadEvents();

    // Debounced search
    this.searchChange$.pipe(
      debounceTime(350),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => {
      this.currentPage.set(1);
      this.loadEvents();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Load ─────────────────────────────────────────────────────────────────

  private loadStats(): void {
    this.api.getAuditStats().subscribe({
      next:  (s) => { this.stats.set(s); this.loadingStats.set(false); },
      error: ()  =>   this.loadingStats.set(false),
    });
  }

  loadEvents(): void {
    this.loadingEvents.set(true);
    const filters = this.buildFilters();
    this.api.getAuditEvents(filters).subscribe({
      next: (res: AuditEventsResponse) => {
        this.events.set(res.events);
        this.totalCount.set(res.totalCount);
        this.totalPages.set(res.totalPages);
        this.loadingEvents.set(false);
      },
      error: () => {
        this.loadingEvents.set(false);
        this.toast('error', 'Load failed', 'Could not load audit events.');
      },
    });
  }

  private buildFilters(): AuditFilters {
    return {
      module:    this.filterModule.value    ?? undefined,
      role:      this.filterRole.value      ?? undefined,
      eventType: this.filterEventType.value ?? undefined,
      dateFrom:  this.filterDateFrom(),
      dateTo:    this.filterDateTo(),
      search:    this.searchTerm()          || undefined,
      page:      this.currentPage(),
      pageSize:  this.pageSizeValue,
      sortOrder: 'desc',
    };
  }

  // ── Filter handlers ──────────────────────────────────────────────────────

  onModuleChange(): void    { this.currentPage.set(1); this.loadEvents(); }
  onRoleChange(): void      { this.currentPage.set(1); this.loadEvents(); }
  onEventTypeChange(): void { this.currentPage.set(1); this.loadEvents(); }
  onDateFromChange(v: string): void { this.filterDateFrom.set(v); this.currentPage.set(1); this.loadEvents(); }
  onDateToChange(v: string): void   { this.filterDateTo.set(v);   this.currentPage.set(1); this.loadEvents(); }

  onSearchInput(value: string): void {
    this.searchTerm.set(value);
    this.searchChange$.next(value);
  }

  clearFilters(): void {
    this.filterModule.value    = null;
    this.filterRole.value      = null;
    this.filterEventType.value = null;
    this.filterDateFrom.set(this.todayIso());
    this.filterDateTo.set(this.todayIso());
    this.searchTerm.set('');
    this.currentPage.set(1);
    this.loadEvents();
  }

  // ── Pagination ───────────────────────────────────────────────────────────

  onPageSizeChange(): void { this.currentPage.set(1); this.loadEvents(); }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    this.currentPage.set(page);
    this.loadEvents();
  }

  // ── Row click / drawer ───────────────────────────────────────────────────

  openEvent(event: AuditEvent): void {
    this.selectedEvent.set(event);
    this.drawerVisible.set(true);
  }

  closeDrawer(): void {
    this.drawerVisible.set(false);
    this.selectedEvent.set(null);
  }

  // ── Export ───────────────────────────────────────────────────────────────

  exportAll(): void {
    if (this.exportingAll()) return;
    this.exportingAll.set(true);
    this.api.exportAuditCsv({}, 'all').subscribe({
      next: (blob) => {
        this.triggerDownload(blob, `audit-all-${this.todayIso()}.csv`);
        this.exportingAll.set(false);
      },
      error: () => {
        this.exportingAll.set(false);
        this.toast('error', 'Export failed', 'Could not export audit log.');
      },
    });
  }

  exportFiltered(): void {
    if (this.exportingFilter()) return;
    this.exportingFilter.set(true);
    this.api.exportAuditCsv(this.buildFilters(), 'filtered').subscribe({
      next: (blob) => {
        this.triggerDownload(blob, `audit-filtered-${this.todayIso()}.csv`);
        this.exportingFilter.set(false);
      },
      error: () => {
        this.exportingFilter.set(false);
        this.toast('error', 'Export failed', 'Could not export filtered audit log.');
      },
    });
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  eventTypeSeverity(type: AuditEventType): 'danger' | 'warn' | 'info' | 'secondary' | 'success' {
    const map: Record<AuditEventType, 'danger' | 'warn' | 'info' | 'secondary' | 'success'> = {
      SLA_BREACH:       'danger',
      CONFIG_CHANGE:    'warn',
      CANDIDATE_ACTION: 'info',
      OFFER_ACTION:     'info',
      PROVISIONING:     'secondary',
      USER_MANAGEMENT:  'success',
    };
    return map[type] ?? 'secondary';
  }

  outcomeSev(outcome: AuditOutcome): 'success' | 'danger' | 'warn' {
    return AUDIT_OUTCOME_SEVERITY[outcome] ?? 'warn';
  }

  getEventTypeLabel(type: string): string {
    return (this.eventTypeLabels as Record<string, string>)[type] ?? type;
  }

  getModuleLabel(mod: string): string {
    return (this.moduleLabels as Record<string, string>)[mod] ?? mod;
  }

  private toast(severity: string, summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail, life: 4000 });
  }

  pagesArray(): number[] {
    const total = this.totalPages();
    const cur   = this.currentPage();
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    // Show window around current page
    const pages = new Set([1, total, cur - 1, cur, cur + 1].filter(p => p >= 1 && p <= total));
    return [...pages].sort((a, b) => a - b);
  }
}
